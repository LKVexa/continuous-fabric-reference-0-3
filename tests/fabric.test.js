'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Journal}=require('../lib/journal');
const {Fabric}=require('../lib/fabric');
const {createHub}=require('../lib/hub');
const {startAgent}=require('../lib/agent');
const {adapter,atomic,sha,token}=require('../lib/common');
const {Client}=require('../runtime/hermit/tests/helpers');
const python=require('../lib/python').resolvePython();
const principal={sub:'alice',tenant:'fabric',submit:true};
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cfp-test-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,ms=15000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await sleep(50);}throw new Error('timeout: '+label);}

test('journal persists, detects tampering and torn tail, and refuses quota overflow',()=>{
  const dir=temp(),file=path.join(dir,'events');
  const j=new Journal(file);j.append({ok:1});assert.equal(new Journal(file).events.length,1);
  const original=fs.readFileSync(file,'utf8');fs.writeFileSync(file,original.replace('"ok":1','"ok":2'));assert.throws(()=>new Journal(file),/INTEGRITY/);
  fs.writeFileSync(file,original.slice(0,-1));assert.throws(()=>new Journal(file),/TORN_TAIL/);
  fs.writeFileSync(file,original);assert.throws(()=>new Journal(file,{maxBytes:1}),/LIMIT/);
});

test('actual source adapters: model numerical score, causal conflict preservation, hard scheduler constraints',async()=>{
  const score=await adapter(python,'model.evaluate',{metric:'numeric',rows:[{response:'1/2',gt:'50%'},{response:'wrong',gt:'7'}]});
  assert.equal(score.mean_score,0.5);assert.equal(score.advisory_only,true);
  const data={key:'shared',replicas:['local','cloud'],writes:[{value:'one',site:'local',vector:{local:1}},{value:'two',site:'cloud',vector:{cloud:1}}]};
  const merge=await adapter(python,'state.merge',data),reverse=await adapter(python,'state.merge',{...data,writes:data.writes.slice().reverse()});
  assert.equal(merge.value,null);assert.equal(merge.conflicts.open,true);assert.equal(merge.conflicts.total_unresolved,2);assert.deepEqual(merge,reverse);
  const refused=await adapter(python,'place',{workload:{name:'a',tenant:'fabric',provenance:'public',needs:['echo']},nodes:[{name:'local',site:'local',tiers:['process'],capabilities:['echo'],free_slots:1,reported_at:1}],now:1});
  assert.equal(refused.refused.code,'NO_CANDIDATE');
});

test('idempotency, tenant isolation, restart UNKNOWN, stale receipts, and single-slot admission',async()=>{
  const dir=temp(),f=new Fabric({stateDir:dir,python});let messages=[];
  const peer=f.register({id:'local',tenant:'fabric',site:'local',operations:['echo']},['echo'],m=>{messages.push(m);return true;});
  const j=await f.command(principal,['submit','one','auto','echo','hello']);assert.equal(j.state,'ASSIGNED');
  const again=await f.command(principal,['submit','one','auto','echo','hello']);assert.equal(again.id,j.id);assert.equal(messages.length,1);
  await assert.rejects(f.command(principal,['submit','one','auto','echo','changed']),/IDEMPOTENCY_CONFLICT/);
  await assert.rejects(f.command({...principal,tenant:'other'},['job',j.id]),/NOT_FOUND/);
  await assert.rejects(f.command({...principal,submit:false},['run','auto','echo','no']),/FORBIDDEN/);
  const queued=await f.command(principal,['submit','two','auto','echo','two']);assert.equal(queued.state,'QUEUED');
  const receipt={id:j.id,lease:messages[0].job.lease,state:'SUCCEEDED',result:{text:'hello'}};
  await assert.rejects(f.receipt(peer,{...receipt,lease:'wrong'}),/STALE/);
  const restart=new Fabric({stateDir:dir,python});assert.equal(restart.jobs.get(j.id).state,'UNKNOWN');
  const p=restart.register({id:'local',tenant:'fabric',site:'local',operations:['echo']},['echo'],()=>true);
  await restart.receipt(p,receipt);assert.equal(restart.jobs.get(j.id).state,'SUCCEEDED');
  await restart.receipt(p,receipt);
  await assert.rejects(restart.receipt(p,{...receipt,result:{text:'different'}}),/EQUIVOCATION/);
});

test('real HERMIT terminal -> hub -> outbound agent; receipt survives disconnect and reconnect',async()=>{
  const dir=temp(),operator=token(),agentToken=token();
  const principalsFile=path.join(dir,'principals.json'),agentsFile=path.join(dir,'agents.json');
  atomic(principalsFile,[{sub:'alice',tenant:'fabric',tokenSha256:sha(operator),capabilities:['terminal','fabric']}]);
  atomic(agentsFile,[{id:'cloud-test',tenant:'fabric',site:'cloud',tokenSha256:sha(agentToken),operations:['echo','sha256']}]);
  const hub=await createHub({stateDir:dir,python,port:0,principalsFile,agentsFile});
  let client,agent;
  try {
    let release,started=false;
    agent=startAgent({url:`ws://127.0.0.1:${hub.port}/ws/agent`,token:agentToken,operations:['echo','sha256'],stateFile:path.join(dir,'receipts.json')},
      {executor:async(_op,data)=>{started=true;await new Promise(r=>{release=r;});return {text:data};}});
    await until(()=>hub.fabric.peers.size===1,'agent registration');
    client=await new Client(`ws://127.0.0.1:${hub.port}/ws/terminal`,operator).open();
    await client.run('cfp submit e2e-one site:cloud echo circuit-complete','"state": "ASSIGNED"');
    await until(()=>started,'actual agent execution');
    const job=[...hub.fabric.jobs.values()][0];assert.equal(job.node,'cloud-test');
    agent.socket.close();await until(()=>hub.fabric.jobs.get(job.id).state==='UNKNOWN','disconnect marked unknown');
    release();await until(()=>hub.fabric.jobs.get(job.id).state==='SUCCEEDED','outbox delivered on reconnect');
    assert.deepEqual(hub.fabric.jobs.get(job.id).result,{text:'circuit-complete'});
    client.close();client=await new Client(`ws://127.0.0.1:${hub.port}/ws/terminal`,operator).open();
    await client.run('cfp jobs','"state": "SUCCEEDED"');
    assert.equal(hub.fabric.jobs.size,1);
    atomic(agentsFile,[{id:'cloud-test',tenant:'fabric',site:'cloud',tokenSha256:sha(agentToken),operations:['echo','sha256'],revoked:true}]);
    await until(()=>hub.fabric.peers.size===0,'live revocation');
    const denied=await fetch(`http://127.0.0.1:${hub.port}/internal/fabric`,{method:'POST',body:'{}'});assert.equal(denied.status,403);
  } finally {client?.close();await agent?.stop();await hub.stop();}
});

test('agent rejects off-loopback cleartext; hub refuses non-TLS public binding',async()=>{
  assert.throws(()=>startAgent({url:'ws://example.com/ws/agent'}),/TLS_REQUIRED/);
  const dir=temp();await assert.rejects(createHub({stateDir:dir,python,host:'0.0.0.0',port:0}),/TLS/);
  assert.equal(fs.existsSync(path.join(dir,'hub.lock')),false);
});

test('deadline expiration preserves unknown outcome and never redispatches; agent cannot self-grant operations',async()=>{
  let now=100000,count=0;
  const f=new Fabric({stateDir:temp(),python,clock:()=>now});
  assert.throws(()=>f.register({id:'evil',tenant:'fabric',site:'local',operations:['echo']},['model.evaluate'],()=>true),/CAPABILITY_ESCALATION/);
  f.register({id:'local',tenant:'fabric',site:'local',operations:['echo']},['echo'],()=>{count++;return true;});
  const j=await f.command(principal,['run','auto','echo','expire']);assert.equal(j.state,'ASSIGNED');
  now+=31000;await f.tick();assert.equal(f.jobs.get(j.id).state,'UNKNOWN');await f.tick();assert.equal(count,1);
});

test('changed bound donor is refused before scheduler import',async()=>{
  const root=temp(),binding=require('../catalog/bindings.json').files.scheduler;
  const destination=path.join(root,binding.path);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,'raise RuntimeError("MUST NOT EXECUTE")');
  await assert.rejects(adapter(python,'place',{},root),/SOURCE_DIGEST_MISMATCH/);
});

test('native HTTPS listener validates a trusted test certificate and serves the terminal configuration',async()=>{
  const https=require('node:https');
  const dir=temp(),principalsFile=path.join(dir,'principals.json'),agentsFile=path.join(dir,'agents.json');
  atomic(principalsFile,[]);atomic(agentsFile,[]);
  const tls={cert:path.join(__dirname,'fixtures/test-only-cert.pem'),key:path.join(__dirname,'fixtures/test-only-key.pem')};
  const hub=await createHub({stateDir:dir,python,port:0,host:'127.0.0.1',principalsFile,agentsFile,tls});
  try {
    const response=await new Promise((resolve,reject)=>{https.get(`https://127.0.0.1:${hub.port}/config.json`,{ca:fs.readFileSync(tls.cert)},res=>{
      let body='';res.on('data',b=>{body+=b;});res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(body)}));
    }).on('error',reject);});
    assert.equal(response.status,200);assert.equal(response.body.protocol,'hermit.vws.v2');assert.notEqual(hub.port,hub.internalPort);
  } finally {await hub.stop();}
});

test('agent storage failure stops delivery instead of reporting an unpersisted success',async()=>{
  const dir=temp(),secret=token(),principalsFile=path.join(dir,'principals.json'),agentsFile=path.join(dir,'agents.json'),stateFile=path.join(dir,'receipts.json');
  atomic(principalsFile,[]);atomic(agentsFile,[{id:'disk-test',tenant:'fabric',site:'local',tokenSha256:sha(secret),operations:['echo']}]);
  const hub=await createHub({stateDir:dir,python,port:0,principalsFile,agentsFile});let agent;const states=[];
  try {
    agent=startAgent({url:`ws://127.0.0.1:${hub.port}/ws/agent`,token:secret,operations:['echo'],stateFile},
      {onState:s=>states.push(s),executor:async()=>{fs.unlinkSync(stateFile);fs.mkdirSync(stateFile);return {text:'must not be accepted'};}});
    await until(()=>hub.fabric.peers.size===1,'disk-test registration');
    const job=await hub.fabric.command(principal,['run','auto','echo','test']);
    await until(()=>states.includes('durable-state-failed'),'durability failure detected');
    await until(()=>hub.fabric.jobs.get(job.id).state==='UNKNOWN','hub retained uncertain outcome');
    assert.equal(hub.fabric.jobs.get(job.id).result,undefined);
  } finally {await agent?.stop();await hub.stop();}
});
