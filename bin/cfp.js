#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {ROOT,atomic,token,sha,adapter}=require('../lib/common');
const {createHub}=require('../lib/hub');
const {startAgent}=require('../lib/agent');
const {resolvePython}=require('../lib/python');
const state=path.resolve(process.env.CFP_STATE_DIR||path.join(ROOT,'.state'));
const file=name=>path.join(state,name);
const read=name=>JSON.parse(fs.readFileSync(file(name),'utf8'));
async function main(args) {
  const [cmd,...rest]=args;
  const usage='Host CLI: cfp init | start | doctor | version | enroll NODE local|cloud WSS_URL | revoke NODE | agent CONFIG | recover-lock [LOCK_FILE]';
  if(!cmd||['help','--help','-h'].includes(cmd)){if(rest.length)throw new Error(usage);console.log(usage);return;}
  if(['version','--version','-v'].includes(cmd)){if(rest.length)throw new Error('Usage: cfp version');console.log(require('../package.json').version);return;}
  const arity={init:[0,0],start:[0,0],doctor:[0,0],enroll:[3,3],revoke:[1,1],agent:[1,1],'recover-lock':[0,1]};
  if(!Object.hasOwn(arity,cmd))throw new Error('UNKNOWN_COMMAND: '+usage);
  if(rest.length<arity[cmd][0]||rest.length>arity[cmd][1])throw new Error('USAGE: '+usage);
  if(cmd==='init') {
    if(fs.existsSync(file('hub.json')))throw new Error('ALREADY_INITIALIZED');
    fs.mkdirSync(state,{recursive:true});
    const python=resolvePython();
    await adapter(python,'doctor',{});
    const operator=token(),agent=token();
    atomic(file('principals.json'),[{sub:'operator',tenant:'fabric',tokenSha256:sha(operator),capabilities:['terminal','fabric']}]);
    atomic(file('agents.json'),[{id:'local-1',tenant:'fabric',site:'local',tokenSha256:sha(agent),operations:['echo','sha256','model.evaluate','state.merge']}]);
    atomic(file('local-agent.json'),{url:'ws://127.0.0.1:8740/ws/agent',token:agent,operations:['echo','sha256','model.evaluate','state.merge'],python,stateFile:file('local-receipts.json')});
    atomic(file('operator-login.json'),{token:operator,note:'Paste token into HERMIT Sign in. Keep this local credential private.'});
    atomic(file('hub.json'),{host:'127.0.0.1',port:8740,python,stateDir:state,principalsFile:file('principals.json'),agentsFile:file('agents.json')});
    console.log('Initialized. Browser credential: '+file('operator-login.json')+'\nStart: node bin/cfp.js start');return;
  }
  if(cmd==='doctor') {
    const python=resolvePython(fs.existsSync(file('hub.json'))?read('hub.json').python:undefined);
    console.error('Python: '+python);
    const report=await adapter(python,'doctor',{});
    console.log(JSON.stringify(report,null,2));
    if(Object.values(report.bindings).some(x=>x!=='HASH_MATCH'))process.exitCode=1;
    return;
  }
  if(cmd==='start') {
    const cfg=read('hub.json');cfg.python=resolvePython(cfg.python);
    const hub=await createHub(cfg);
    const local=read('local-agent.json');local.python=cfg.python;local.url=`ws://127.0.0.1:${hub.internalPort}/ws/agent`;
    let agent;try{agent=startAgent(local);}catch(e){await hub.stop();throw e;}
    console.log(`Continuous Fabric Reference v${require('../package.json').version}: ${cfg.tls?'https':'http'}://${cfg.host}:${hub.port}\nSign-in credential file: ${file('operator-login.json')}\nIn the browser terminal, try: cfp help`);
    let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await agent.stop();await hub.stop();};
    process.on('SIGINT',()=>stop().then(()=>process.exit(0)));process.on('SIGTERM',()=>stop().then(()=>process.exit(0)));return;
  }
  if(cmd==='enroll') {
    const [name,site,url]=rest;
    if(!/^[A-Za-z0-9_.-]{1,64}$/.test(name||'')||!['local','cloud'].includes(site))throw new Error('Usage: enroll NODE local|cloud wss://hub/ws/agent');
    const u=new URL(url);if(u.protocol!=='wss:'||u.pathname!=='/ws/agent'||u.search||u.hash||u.username||u.password)throw new Error('WSS_AGENT_URL_REQUIRED');
    const grants=read('agents.json');if(grants.some(g=>g.id===name)||grants.length>=32)throw new Error('DUPLICATE_OR_LIMIT');
    const secret=token();grants.push({id:name,tenant:'fabric',site,tokenSha256:sha(secret),operations:['echo','sha256']});atomic(file('agents.json'),grants);
    const destination=file(name+'-agent.json');atomic(destination,{url,token:secret,operations:['echo','sha256'],stateFile:'./agent-state/'+name+'-receipts.json'});
    console.log('Copy this private configuration to that agent: '+destination);return;
  }
  if(cmd==='revoke') {
    const grants=read('agents.json'),grant=grants.find(g=>g.id===rest[0]);if(!grant)throw new Error('NOT_FOUND');grant.revoked=true;atomic(file('agents.json'),grants);console.log('Revoked; active agent connection expires within one second.');return;
  }
  if(cmd==='agent') {
    const cfg=JSON.parse(fs.readFileSync(path.resolve(rest[0]),'utf8'));
    if(cfg.operations?.some(op=>['model.evaluate','state.merge'].includes(op)))cfg.python=resolvePython(cfg.python);
    const agent=startAgent(cfg,{onState:s=>console.log(s)});
    process.on('SIGINT',async()=>{await agent.stop();process.exit(0);});process.on('SIGTERM',async()=>{await agent.stop();process.exit(0);});return;
  }
  if(cmd==='recover-lock') {
    const p=path.resolve(rest[0]||file('hub.lock'));
    // Operator-selected exact lock, with a live-process check; never clears automatically.
    if(!p.endsWith('.lock'))throw new Error('LOCK_FILE_REQUIRED');
    const pid=Number(fs.readFileSync(p,'utf8'));if(!Number.isInteger(pid)||pid<=0)throw new Error('INVALID_LOCK');
    try {process.kill(pid,0);throw new Error('OWNER_STILL_RUNNING');}catch(e){if(e.code!=='ESRCH')throw e;}
    fs.unlinkSync(p);console.log('Removed stale lock: '+p);return;
  }
  console.log('cfp init | start | doctor | enroll NODE local|cloud WSS_URL | revoke NODE | agent CONFIG | recover-lock [LOCK_FILE]');
}
main(process.argv.slice(2)).catch(e=>{console.error(e.message);process.exitCode=1;});
