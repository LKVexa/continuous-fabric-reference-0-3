'use strict';
const {COMMANDS,CommandError,help,parseCommand,publicError,version,terminalVersion}=require('./commands');
const ABOUT=[
  `Continuous Fabric Reference v${version}`,
  `HERMIT ${terminalVersion} · hermit.vws.v2 · browser WebSocket terminal`,
  '',
  'SPIRAL virtual shell: in-memory files, pipes, redirects and command history.',
  'Session storage: LOCAL_VOLATILE; reconnect opens a fresh terminal.',
  'CFP hub: durable job journal, pinned SCH-01 placement, outbound agents.',
  'Operations: echo, sha256, _model offline evaluation, GAP-05 causal merge.',
  'Mobile browsers control jobs; enrolled local/cloud agents execute them.',
  'Runtime scope: fixed trusted operations in a process; reference build.',
  '',
  'Use cfp help, cfp status, cfp nodes, cfp jobs and cfp job JOB_ID.',
  'fabric is a compatibility alias for cfp. Submit acceptance is not job success.',
  'Native DF VM execution, Photon delegation and desktop browser panes are disabled.',
  'Use the host PowerShell/Linux terminal for node bin/cfp.js administration.'
].join('\n');
async function responseBody(response) {
  if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||''))throw new Error('BAD_RESPONSE');
  const reader=response.body?.getReader();if(!reader)throw new Error('BAD_RESPONSE');
  const chunks=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2097152)throw new Error('BAD_RESPONSE');chunks.push(Buffer.from(value));}}
  catch(e){await reader.cancel().catch(()=>{});throw e;}
  let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('BAD_RESPONSE');}
  if(!body||typeof body!=='object')throw new Error('BAD_RESPONSE');return body;
}
function install(kernel,env,{fetchImpl=fetch}={}) {
  if(!env.CFP_BRIDGE_URL||!env.CFP_BRIDGE_KEY)return;
  const submit=env.CFP_SUBMIT==='1';
  const usage=Object.values(COMMANDS).join('\n  ');
  kernel.host.banner=()=>`\r\n  Continuous Fabric Reference v${version} / HERMIT ${terminalVersion}\r\n  WebSocket virtual shell · volatile session · durable submitted jobs\r\n  Type help, about, cfp help or cfp nodes.\r\n\r\n`;
  kernel.registry.register({name:'cfp',aka:['fabric'],summary:'continuous fabric jobs and agent status; cfp help for examples',usage,
    complete:()=>Object.keys(COMMANDS),async run(ctx){
      const args=ctx.argv; // generic getopt removes leading-dash payloads from ctx.args
      try {
        const command=parseCommand(args);
        if(command.verb==='help'){ctx.stdout.write(JSON.stringify(help(submit),null,2)+'\n');return 0;}
        const response=await fetchImpl(env.CFP_BRIDGE_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+env.CFP_BRIDGE_KEY},
          body:JSON.stringify({principal:{sub:env.CFP_SUB,tenant:env.CFP_TENANT,submit},args}),signal:AbortSignal.any([ctx.signal,AbortSignal.timeout(12000)])});
        const body=await responseBody(response);
        if(!response.ok){
          if(typeof body.error!=='string'||typeof body.message!=='string')throw new Error('BAD_RESPONSE');
          ctx.stderr.write(JSON.stringify(body,null,2)+'\n');return body.exitCode===2?2:1;
        }
        ctx.stdout.write(JSON.stringify(body,null,2)+'\n');return 0;
      }catch(e){
        if(e instanceof CommandError){const error=publicError(e).body;ctx.stderr.write(JSON.stringify(error)+'\n');return error.exitCode;}
        const interrupted=ctx.signal.aborted;
        ctx.stderr.write(JSON.stringify({error:interrupted?'INTERRUPTED':e.message==='BAD_RESPONSE'?'INVALID_BRIDGE_RESPONSE':'BRIDGE_UNAVAILABLE',
          message:'Outcome may be unknown. Query cfp jobs before retrying; reuse the same submit key and content.'})+'\n');
        return interrupted?130:1;
      }
    }});
  for(const name of ['help','man']) {
    const original=kernel.registry.resolve(name);
    kernel.registry.register({...original,run(ctx){
      if(ctx.argv.length>1||name==='man'&&!ctx.argv.length){ctx.stderr.write('usage: '+original.usage+'\n');return 2;}
      return original.run({...ctx,args:ctx.argv});
    }});
  }
  kernel.registry.register({name:'exit',aka:['logout','quit'],summary:'close this virtual session',usage:'exit [0-255]',run(ctx){
    if(ctx.argv.length>1||ctx.argv.length===1&&(!/^\d{1,3}$/.test(ctx.argv[0])||Number(ctx.argv[0])>255)){ctx.stderr.write('usage: exit [0-255]\n');return 2;}
    const code=Number(ctx.argv[0]||0);ctx.stdout.write('logout\n');ctx.exit(code);return code;
  }});
  kernel.registry.register({name:'about',summary:'show this hosted platform and its supported capabilities',usage:'about',run(ctx){
    if(ctx.argv.length){ctx.stderr.write('usage: about\n');return 2;}ctx.stdout.write(ABOUT+'\n');return 0;}});
  kernel.registry.register({name:'sysinfo',summary:'show virtual session information and authenticated scope',usage:'sysinfo',run(ctx){
    if(ctx.argv.length){ctx.stderr.write('usage: sysinfo\n');return 2;}
    ctx.stdout.write(JSON.stringify({platformVersion:version,terminalVersion,transport:'hermit.vws.v2',shell:'SPIRAL virtual shell',
      principal:env.CFP_SUB,tenant:env.CFP_TENANT,permission:submit?'submit-enabled':'read-only',
      session:{cwd:ctx.session.cwd,cols:ctx.cols,rows:ctx.rows,storage:'LOCAL_VOLATILE'},
      commands:kernel.registry.names(),hostAdministration:'Use PowerShell or a Linux host terminal; this shell has no host OS commands.'},null,2)+'\n');return 0;}});
  kernel.registry.register({name:'whoami',summary:'show the authenticated terminal principal',usage:'whoami',run(ctx){
    if(ctx.argv.length){ctx.stderr.write('usage: whoami\n');return 2;}ctx.stdout.write(env.CFP_SUB+'\n');return 0;}});
  kernel.registry.register({name:'uname',summary:'identify the virtual shell (host details are not exposed)',usage:'uname [-a]',run(ctx){
    if(ctx.argv.length>1||ctx.argv.length===1&&ctx.argv[0]!=='-a'){ctx.stderr.write('usage: uname [-a]\n');return 2;}
    ctx.stdout.write(ctx.argv.length?`SPIRAL virtual shell / CFP ${version} / HERMIT ${terminalVersion}\n`:'SPIRAL\n');return 0;}});
}
module.exports={install,ABOUT,responseBody};
