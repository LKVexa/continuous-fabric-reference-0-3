'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {parse}=require('../runtime/hermit/src/main/spiral/pipeline');
const {SpiralKernel}=require('../runtime/hermit/src/main/spiral/kernel');
const {commandFilter}=require('../runtime/hermit/worker/capabilities');
const {install,responseBody}=require('../lib/terminal-command');
const {parseCommand,version,publicError}=require('../lib/commands');
const {Fabric}=require('../lib/fabric'),{createHub}=require('../lib/hub'),{startAgent}=require('../lib/agent');
const {atomic,token,sha}=require('../lib/common');
const {Client}=require('../runtime/hermit/tests/helpers');
const python=require('../lib/python').resolvePython();
const principal={sub:'alice',tenant:'fabric',submit:true};
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cfp-terminal-'));
function virtual(fetchImpl=async()=>Response.json({ok:true}),submit=true) {
  const kernel=new SpiralKernel({commandFilter:commandFilter({fabric:false})});
  install(kernel,{CFP_BRIDGE_URL:'http://127.0.0.1/internal/fabric',CFP_BRIDGE_KEY:'test',CFP_SUB:'alice',CFP_TENANT:'fabric',CFP_SUBMIT:submit?'1':'0'},{fetchImpl});
  const {sessionId}=kernel.openSession({deferStart:true}),session=kernel.sessions.get(sessionId);
  let output='';kernel.on('data',e=>output+=e.chunk);
  return {kernel,session,async run(line){output='';const code=await kernel._executeLine(session,line);return {code,text:output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'')};}};
}
test('quotes, escapes, empty words and comment boundaries preserve literal data',()=>{
  const env={get:n=>({USER:'alice',HOME:'/home/alice','?':'7'})[n]};
  const argv=parse(String.raw`echo '$USER' "$USER" \$USER "\$USER" a'$USER' "$USER"end '' a#b # comment`,env)[0].pipeline[0].argv;
  assert.deepEqual(argv,['echo','$USER','alice','$USER','$USER','a$USER','aliceend','','a#b']);
  assert.deepEqual(parse(`echo '~' ~/x`,env)[0].pipeline[0].argv,['echo','~','/home/alice/x']);
});
test('malformed quotes/operators/redirects reject the whole line before side effects',async()=>{
  let calls=0;const v=virtual(async()=>{calls++;return Response.json({ok:true});});
  for(const line of ["cfp run auto echo ok; echo 'oops",'cfp run auto echo ok |','cfp run auto echo ok &&','| echo x','echo x || ; echo y','echo x >','echo x > a > b','echo x \\']) {
    await assert.rejects(v.run(line),/syntax error/);assert.equal(v.session.env.get('?'),'2');
  }
  assert.equal(calls,0);assert.equal(v.kernel.vfs.exists('/home/operator/a'),false);
});
test('exit status expands at execution time and supports correct conditional recovery',async()=>{
  const v=virtual();
  const r=await v.run('missing_command; echo $?; cfp nonsense || echo recovered:$?');
  assert.match(r.text,/127/);assert.match(r.text,/recovered:2/);assert.equal(r.code,0);
  const failed=await v.run('cfp nonsense && echo MUST_NOT_RUN');assert.equal(failed.code,2);assert.doesNotMatch(failed.text,/MUST_NOT_RUN/);
  const piped=await v.run("echo 'abc' | rev > result; cat result");assert.match(piped.text,/cba/);
});
test('CFP raw argv preserves leading dashes, negative numbers, literal dollars and empty text',async()=>{
  const seen=[],v=virtual(async(_url,options)=>{seen.push(JSON.parse(options.body).args);return Response.json({state:'QUEUED'});});
  for(const text of ["'--hello $USER'",'-12',"''"]){assert.equal((await v.run('cfp run auto echo '+text)).code,0);}
  assert.deepEqual(seen.map(a=>a[3]),['--hello $USER','-12','']);
  assert.equal((await v.run('fabric status')).code,0);assert.deepEqual(seen[3],['status']);
});
test('command grammar rejects malformed requests without journaling a job',async()=>{
  const f=new Fabric({stateDir:temp(),python});
  for(const args of [['status','extra'],['job'],['jobs','--typo'],['run','auto','echo'],['run','auto','bad','{}'],['run','auto','model.evaluate','{'],['run','auto','model.evaluate','{}'],['run','auto','model.evaluate','{"rows":[{"gt":1e999}]}']]) {
    await assert.rejects(f.command(principal,args));
  }
  assert.equal(f.jobs.size,0);assert.equal(f.journal.events.length,0);
  assert.throws(()=>parseCommand(['run','auto','model.evaluate','{']),/INVALID_JSON/);
  assert.throws(()=>parseCommand(['run','auto','nope','']),/UNSUPPORTED_OPERATION/);
});
test('hosted identity, help, banner and about describe the running build',async()=>{
  const v=virtual();
  const banner=v.kernel._banner(v.session);assert.match(banner,new RegExp(version));assert.doesNotMatch(banner,/fabric status|Photon/);
  const about=await v.run('about');assert.ok(about.text.includes("Continuous Fabric Reference v"+version));assert.doesNotMatch(about.text,/contextBridge|VB-JA21|four nodes/);
  const help=await v.run('help cfp');assert.match(help.text,/submit REQUEST_KEY/);
  const index=await v.run('help');assert.doesNotMatch(index.text,/dockable|Photon/);
  const who=await v.run('export USER=impersonated; whoami');assert.match(who.text,/alice/);assert.doesNotMatch(who.text,/impersonated/);
  const uname=await v.run('uname -a');assert.doesNotMatch(uname.text,/x86_64/);
  assert.equal((await v.run('cfp --help')).code,0);
});
test('HTTP errors go to stderr, are not piped as successful output, and preserve status',async()=>{
  const v=virtual(async()=>Response.json({error:'FORBIDDEN',message:'Submission denied',exitCode:1},{status:403}));
  const r=await v.run('cfp run auto echo denied > response; cat response');
  assert.match(r.text,/FORBIDDEN/);assert.equal(v.kernel.vfs.readFile('/home/operator/response'),'');
  assert.equal((await v.run('cfp run auto echo denied')).code,1);
  assert.doesNotMatch(JSON.stringify(publicError(new Error('disk C:/private/secret.json'))),/private|secret/);
});
test('empty, malformed, non-JSON and oversized bridge responses fail with actionable diagnostics',async()=>{
  for(const make of [()=>new Response('',{headers:{'content-type':'application/json'}}),()=>new Response('{',{headers:{'content-type':'application/json'}}),()=>new Response('<html>error</html>')]) {
    const r=await virtual(async()=>make()).run('cfp status');assert.equal(r.code,1);assert.match(r.text,/INVALID_BRIDGE_RESPONSE/);assert.doesNotMatch(r.text,/Unexpected end/);
  }
  await assert.rejects(responseBody(Response.json({data:'x'.repeat(2097152)})),/BAD_RESPONSE/);
});
test('node freshness and job responses distinguish unavailable outcomes from terminal results',async()=>{
  let now=100000;const f=new Fabric({stateDir:temp(),python,clock:()=>now});
  f.register({id:'node',site:'local',tenant:'fabric',operations:['echo']},['echo'],()=>true);now+=15000;
  assert.equal((await f.command(principal,['status'])).connectedAgents,0);
  assert.equal((await f.command(principal,['nodes']))[0].online,false);
  const j=await f.command(principal,['run','auto','echo','queued']);assert.equal(j.state,'QUEUED');assert.equal(j.result,null);assert.equal(j.terminal,false);assert.equal(j.outcomeKnown,false);
  assert.equal((await f.command(principal,['abandon',j.id])).outcomeKnown,false);
});
test('host CLI rejects typos and extra arguments; version is the platform version',()=>{
  const cli=path.resolve(__dirname,'../bin/cfp.js');
  for(const args of [['typo'],['doctor','oops'],['init','oops'],['enroll']])assert.notEqual(spawnSync(process.execPath,[cli,...args],{encoding:'utf8'}).status,0);
  const r=spawnSync(process.execPath,[cli,'--version'],{encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout.trim(),version);
});
test('cancelled bridge requests report interrupt status without automatic retries',async()=>{
  let count=0;
  const v=virtual(async(_url,options)=>{count++;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));});
  const pending=v.run('cfp submit interrupt auto echo hello');
  v.session.running.abort('SIGINT');const r=await pending;assert.equal(r.code,130);assert.match(r.text,/INTERRUPTED/);assert.equal(count,1);
});
test('help and exit reject ignored or malformed arguments',async()=>{
  const v=virtual();
  for(const line of ['help cfp extra','man','exit banana','exit -1','exit 256','exit 2junk'])assert.equal((await v.run(line)).code,2);
  assert.equal((await v.run('help --bogus')).code,1);assert.equal(v.session.alive,true);
});
test('browser adapter closes malformed binary frames instead of crashing its handler',async()=>{
  globalThis.HermitVWS={codec:require('../runtime/hermit/protocol/codec')};
  require('../runtime/hermit/client/transport');require('../runtime/hermit/client/ws-adapter');
  let socket;
  class FakeSocket {
    constructor(){socket=this;this.readyState=1;}
    close(code){this.readyState=3;this.code=code;this.onclose({code});}
  }
  const transport=globalThis.HermitVWS.WsTransport({base:'http://127.0.0.1',WebSocketImpl:FakeSocket,autoReconnect:false,fetchImpl:async url=>{
    if(url.endsWith('/config.json'))return Response.json({protocol:'hermit.vws.v2',auth:'none',ticketPath:'/ticket',wsPath:'/terminal',capabilities:{}});
    if(url.endsWith('/ticket'))return Response.json({});
    return Response.json(JSON.parse(fs.readFileSync(path.join(__dirname,'../runtime/hermit',new URL(url).pathname))));
  }});
  const events=[];transport.onState(e=>events.push(e.state));
  const opening=transport.open({cols:80,rows:24});
  while(!socket)await new Promise(r=>setImmediate(r));
  assert.doesNotThrow(()=>socket.onmessage({data:new Uint8Array([2]).buffer}));
  await assert.rejects(opening,/closed before open/);assert.equal(socket.code,1002);assert.deepEqual(events,['protocol-error']);
});
test('real WebSocket: updated presentation, literal payload round trip, JSON errors and read-only authorization',async()=>{
  const dir=temp(),operator=token(),readonly=token(),agentToken=token();
  const principalsFile=path.join(dir,'principals.json'),agentsFile=path.join(dir,'agents.json');
  atomic(principalsFile,[{sub:'alice',tenant:'fabric',tokenSha256:sha(operator),capabilities:['terminal','fabric']},{sub:'viewer',tenant:'fabric',tokenSha256:sha(readonly),capabilities:['terminal']}]);
  atomic(agentsFile,[{id:'test',tenant:'fabric',site:'local',tokenSha256:sha(agentToken),operations:['echo','sha256']}]);
  const hub=await createHub({stateDir:dir,python,port:0,principalsFile,agentsFile});let client,viewer,agent;
  async function run(c,line){const start=c.text().length,seq=c.input(line+'\r');await c.until(()=>c.type('input.ack').some(m=>m.payload.executedSeq>=seq),10000,'command completed');return c.text().slice(start);}
  try {
    const config=await (await fetch(`http://127.0.0.1:${hub.port}/config.json`)).json();assert.equal(config.build.version,version);assert.equal(config.capabilities.cfp,true);assert.equal(config.capabilities.fabric,false);assert.doesNotMatch(JSON.stringify(config),new RegExp(hub.bridge.key));
    client=await new Client(`ws://127.0.0.1:${hub.port}/ws/terminal`,operator).open();assert.ok(client.text().includes("Continuous Fabric Reference v"+version));
    assert.match(await run(client,'about'),/durable job journal/);
    assert.match(await run(client,'fabric status'),/submit-enabled/);
    assert.match(await run(client,"cfp run auto model.evaluate '{'"),/INVALID_JSON/);
    assert.match(await run(client,'echo $?'),/2/);
    agent=startAgent({url:`ws://127.0.0.1:${hub.port}/ws/agent`,token:agentToken,operations:['echo','sha256'],stateFile:path.join(dir,'receipts.json')});
    await client.until(()=>hub.fabric.peers.size===1,8000,'agent');
    await run(client,"cfp submit literals auto echo '--dash $USER  two spaces'");
    await client.until(()=>[...hub.fabric.jobs.values()].some(j=>j.state==='SUCCEEDED'),8000,'literal receipt');
    const job=[...hub.fabric.jobs.values()][0];assert.deepEqual(job.result,{text:'--dash $USER  two spaces'});
    assert.match(await run(client,'cfp job '+job.id),/"terminal": true/);
    viewer=await new Client(`ws://127.0.0.1:${hub.port}/ws/terminal`,readonly).open();
    assert.match(await run(viewer,'cfp status'),/read-only/);
    assert.match(await run(viewer,'cfp run auto echo forbidden'),/FORBIDDEN/);assert.equal(hub.fabric.jobs.size,1);
  }finally{client?.close();viewer?.close();await agent?.stop();await hub.stop();}
});
