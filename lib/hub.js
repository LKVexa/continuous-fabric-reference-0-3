'use strict';
const fs=require('node:fs');
const path=require('node:path');
const https=require('node:https');
const {Fabric}=require('./fabric');
const {token,sha}=require('./common');
const {publicError}=require('./commands');
const {load}=require('../runtime/hermit/gateway/config');
const {createGateway}=require('../runtime/hermit/gateway/server');
const {WsConnection,checkUpgrade,acceptUpgrade,rejectUpgrade}=require('../runtime/hermit/gateway/ws');
const loopback=x=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(x);
async function createHub(options) {
  const stateDir=path.resolve(options.stateDir);fs.mkdirSync(stateDir,{recursive:true});
  const lock=path.join(stateDir,'hub.lock');const fd=fs.openSync(lock,'wx',0o600);fs.writeFileSync(fd,String(process.pid));fs.closeSync(fd);
  let gw,external,tick;
  const sockets=new Set();
  try {
    if(options.host&&!['127.0.0.1','localhost','::1'].includes(options.host)&&!options.tls)throw new Error('TLS_CERT_AND_KEY_REQUIRED_OFF_LOOPBACK');
    const fabric=new Fabric(options), bridge={key:token(),url:null};
    const base=load({VWS_HOST:'127.0.0.1',VWS_PRINCIPALS_FILE:options.principalsFile,VWS_SECURE_COOKIES:options.tls?'1':'0',VWS_LOG:'error',VWS_FABRIC:'0'});
    gw=createGateway({...base,port:options.tls?0:options.port,cfp:bridge});
    const json=(res,status,value)=>{const b=JSON.stringify(value);res.writeHead(status,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(b),'Cache-Control':'no-store'});res.end(b);};
    const originalRequest=gw.server.listeners('request')[0];gw.server.removeAllListeners('request');
    const request=(req,res)=>{
      if(req.url!=='/internal/fabric')return originalRequest(req,res);
      if(req.method!=='POST'||!loopback(req.socket.remoteAddress)||req.headers.origin||req.headers.authorization!=='Bearer '+bridge.key){req.resume();return json(res,403,{error:'FORBIDDEN'});}
      const chunks=[];let n=0,over=false;
      req.on('data',b=>{n+=b.length;if(n>32768){over=true;req.destroy();}else chunks.push(b);});
      req.on('error',()=>{});
      req.on('end',async()=>{
        if(over)return;
        try{
          let m;
          try{m=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new (require('./commands').CommandError)('INVALID_JSON','Malformed bridge request.');}
          if(!m||!m.principal||typeof m.principal.sub!=='string'||typeof m.principal.tenant!=='string'||typeof m.principal.submit!=='boolean'||!Array.isArray(m.args)||m.args.length>32||m.args.some(x=>typeof x!=='string'))throw new (require('./commands').CommandError)('BAD_COMMAND','Invalid command envelope.');
          json(res,200,await fabric.command(m.principal,m.args));
        }catch(e){const error=publicError(e);json(res,error.status,error.body);}
      });
    };
    gw.server.on('request',request);
    const originalUpgrade=gw.server.listeners('upgrade')[0];gw.server.removeAllListeners('upgrade');
    const getGrants=()=>{
      const values=JSON.parse(fs.readFileSync(options.agentsFile,'utf8'));
      if(!Array.isArray(values)||values.length>32)throw new Error('BAD_GRANT_STORE');
      return values;
    };
    const upgrade=(req,socket,head)=>{
      socket.on('error',()=>{});
      if(req.url!=='/ws/agent')return originalUpgrade(req,socket,head);
      try {
        if(gw.registry.draining||req.headers.origin||sockets.size>=32)return rejectUpgrade(socket,403,'agent channel unavailable');
        const up=checkUpgrade(req,'cfp.agent.v1');if(!up.ok)return rejectUpgrade(socket,up.status,up.reason);
        if(head.length)return rejectUpgrade(socket,400,'unexpected data');
        const auth=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization||'');
        const grant=auth&&getGrants().find(g=>!g.revoked&&g.tokenSha256===sha(auth[1]));
        if(!grant)return rejectUpgrade(socket,401,'unauthorized');
        if(fabric.peers.has(grant.id))return rejectUpgrade(socket,409,'duplicate agent');
        acceptUpgrade(socket,up.key,'cfp.agent.v1');
        const ws=new WsConnection(socket,{maxMessageBytes:65536,sendQueueBytes:131072,closeWaitMs:100});sockets.add(ws);
        let peer=null,seen=Date.now(),count=0,window=Date.now();
        const send=m=>ws.sendText(JSON.stringify(m));
        const timer=setInterval(()=>{
          try {
            const current=getGrants().find(g=>g.id===grant.id&&!g.revoked&&g.tokenSha256===grant.tokenSha256);
            if(!current||JSON.stringify(current)!==JSON.stringify(grant)||Date.now()-seen>(peer?15000:5000))ws.terminate(1008,'expired or revoked');
          }catch{ws.terminate(1008,'grant unavailable');}
        },1000);
        ws.on('binary',()=>ws.close(1003,'text only'));
        ws.on('text',bytes=>{
          try {
            if(Date.now()-window>1000){window=Date.now();count=0;}if(++count>20)throw new Error('rate');
            const m=JSON.parse(bytes.toString('utf8'));seen=Date.now();
            if(!peer) {
              if(m.type!=='register')throw new Error('registration required');
              peer=fabric.register(grant,m.operations,send);send({type:'welcome',node:grant.id,heartbeatMs:3000});fabric.tick().catch(()=>ws.close(1011,'control unavailable'));return;
            }
            if(m.type==='heartbeat'){peer.seen=Date.now();return;}
            if(m.type==='receipt'){fabric.receipt(peer,m).then(r=>send(r)).catch(()=>ws.close(1008,'receipt rejected'));return;}
            throw new Error('unknown message');
          }catch{ws.close(1008,'bad agent message');}
        });
        ws.on('close',()=>{clearInterval(timer);sockets.delete(ws);if(peer)fabric.disconnect(peer).catch(()=>{});});
      }catch{rejectUpgrade(socket,503,'admission unavailable');}
    };
    gw.server.on('upgrade',upgrade);
    const address=await gw.listen();bridge.url=`http://127.0.0.1:${address.port}/internal/fabric`;
    let port=address.port;
    if(options.tls) {
      external=https.createServer({cert:fs.readFileSync(options.tls.cert),key:fs.readFileSync(options.tls.key)},request);
      external.on('upgrade',upgrade);external.on('clientError',(_e,s)=>s.destroy());external.headersTimeout=10000;external.requestTimeout=10000;
      await new Promise((resolve,reject)=>{external.once('error',reject);external.listen(options.port,options.host||'0.0.0.0',resolve);});port=external.address().port;
    }
    tick=setInterval(()=>fabric.tick().catch(e=>{console.error('fabric control failure:',e.message);for(const ws of sockets)ws.close(1011,'control unavailable');}),3000);
    return {fabric,gw,port,bridge,internalPort:address.port,
      async stop(){clearInterval(tick);for(const ws of sockets)ws.terminate(1001,'hub stopped');if(external){external.close();external.closeAllConnections();}await gw.shutdown();await fabric.tail;if(fs.existsSync(lock))fs.unlinkSync(lock);}};
  } catch(e) {clearInterval(tick);if(external)external.close();if(gw)await gw.shutdown();if(fs.existsSync(lock))fs.unlinkSync(lock);throw e;}
}
module.exports={createHub};
