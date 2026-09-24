'use strict';
const {OPS,payload}=require('./common');
const version=require('../package.json').version;
const terminalVersion=require('../runtime/hermit/package.json').version;
const COMMANDS=Object.freeze({
  help:'cfp help', status:'cfp status', nodes:'cfp nodes', jobs:'cfp jobs',
  job:'cfp job JOB_ID', sources:'cfp sources',
  run:'cfp run TARGET OP PAYLOAD', submit:'cfp submit REQUEST_KEY TARGET OP PAYLOAD',
  abandon:'cfp abandon JOB_ID'
});
class CommandError extends Error {
  constructor(code,message,status=400,exitCode=2){super(code+': '+message);Object.assign(this,{code,status,exitCode,detail:message});}
}
function bad(code,message){throw new CommandError(code,message);}
function parseCommand(args) {
  if(!Array.isArray(args)||args.length>32||args.some(x=>typeof x!=='string')||Buffer.byteLength(JSON.stringify(args))>24576)bad('BAD_COMMAND','Expected at most 32 string arguments, within 24 KiB.');
  const [raw='help',...rest]=args, verb=['--help','-h'].includes(raw)?'help':raw;
  if(!Object.hasOwn(COMMANDS,verb))bad('UNKNOWN_COMMAND','Use cfp help for available commands.');
  const needed=['run','submit'].includes(verb)?(verb==='run'?3:4):(['job','abandon'].includes(verb)?1:0);
  if(rest.length<needed||(!['run','submit'].includes(verb)&&rest.length!==needed))bad('USAGE',COMMANDS[verb]);
  if(['job','abandon'].includes(verb)&&!/^[A-Za-z0-9_.-]{1,96}$/.test(rest[0]))bad('BAD_JOB_ID',COMMANDS[verb]);
  if(!['run','submit'].includes(verb))return {verb,rest};
  const key=verb==='submit'?rest.shift():null;
  if(verb==='submit'&&!/^[A-Za-z0-9_.-]{1,96}$/.test(key))bad('BAD_REQUEST_KEY','Use 1–96 letters, digits, underscores, dots or dashes.');
  const [target,op,...input]=rest;
  if(!/^(auto|[A-Za-z0-9_.-]{1,64}|site:[A-Za-z0-9_.-]{1,64})$/.test(target))bad('BAD_TARGET','Use auto, a node ID, or site:NAME.');
  if(!OPS.includes(op))bad('UNSUPPORTED_OPERATION','Supported operations: '+OPS.join(', '));
  let data=input.join(' ');
  if(!['echo','sha256'].includes(op)) {
    try{data=JSON.parse(data);}catch{bad('INVALID_JSON','Supply one single-quoted JSON object; see cfp help examples.');}
  }
  try{data=payload(op,data);}catch(e){bad('INVALID_PAYLOAD',e.message);}
  return {verb,rest,key,target,op,data};
}
function help(submit=true){return {
  commands:Object.values(COMMANDS), alias:'fabric is a compatibility alias for cfp',
  targets:'auto | NODE_ID | site:NAME', operations:OPS, permission:submit?'submit-enabled':'read-only',
  examples:["cfp submit my-hash local-1 sha256 'hello $USER --literal'",`cfp submit my-score local-1 model.evaluate '{"metric":"numeric","rows":[{"response":"1/2","gt":"50%"}]}'`,
    `cfp submit my-merge local-1 state.merge '{"key":"shared","replicas":["local","cloud"],"writes":[{"value":"one","site":"local","vector":{"local":1}}]}'`],
  semantics:'Exit 0 means the command was accepted/read successfully, not that the job succeeded. Query cfp job JOB_ID for the execution result.',
  quoting:'Single quotes preserve literal dollars, dashes and JSON. Quote spaces to preserve them. Text arguments are joined by one space. Empty text requires quoted empty string. No host shell or command substitution.',
  recovery:'After interrupted submission, query cfp jobs or repeat cfp submit with the SAME key and content. cfp run creates a new key each time. Abandon does not undo remote effects.'
};}
function publicError(e){
  if(e instanceof CommandError)return {status:e.status,body:{error:e.code,message:e.detail,exitCode:e.exitCode}};
  const code=String(e?.message||'').split(':')[0];
  const known={FORBIDDEN:[403,'Fabric submission capability required.',1],NOT_FOUND:[404,'No visible job with this ID.',1],
    IDEMPOTENCY_CONFLICT:[409,'This request key already has different content.',1],
    ONLY_UNKNOWN_OR_QUEUED_CAN_BE_ABANDONED:[409,'Only UNKNOWN or QUEUED jobs can be abandoned.',1],
    JOB_RETENTION_LIMIT:[409,'Hub job retention limit reached; contact the hub operator.',1]};
  const [status,message,exitCode]=known[code]||[503,'Hub could not complete this request. Query jobs before retrying a submission.',1];
  return {status,body:{error:known[code]?code:'CONTROL_UNAVAILABLE',message,exitCode}};
}
module.exports={COMMANDS,CommandError,parseCommand,help,publicError,version,terminalVersion};
