'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
const token = () => crypto.randomBytes(32).toString('base64url');
const id = () => crypto.randomUUID();
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k)+':'+canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file+'.'+id()+'.tmp';
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    try { fs.writeFileSync(fd, JSON.stringify(value,null,2)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
  } catch (error) {
    try { fs.unlinkSync(temp); } catch { /* preserve the original failure */ }
    throw error;
  }
}
function adapter(python, op, data, sourceRoot) {
  return new Promise((resolve,reject) => {
    const child = spawn(python, ['-I', '-B', path.join(__dirname,'adapters.py')], {
      windowsHide: true, stdio: ['pipe','pipe','pipe'],
      env: {...process.env, PYTHONDONTWRITEBYTECODE:'1', ...(sourceRoot ? {CFP_SOURCE_ROOT:sourceRoot} : {})}
    });
    let out='', err='', settled=false;
    const finish=(e,r)=>{if(settled)return;settled=true;clearTimeout(timer);e?reject(e):resolve(r);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('adapter timeout'));},10000);
    child.on('error',e=>finish(new Error(`ADAPTER_START_FAILED: could not launch Python ${JSON.stringify(python)} (${e.code||e.message}). Set CFP_PYTHON to a working interpreter.`)));child.stdin.on('error',()=>{});
    child.stdout.on('data',b=>{out+=b;if(out.length>262144){child.kill();finish(new Error('adapter output limit'));}});
    child.stderr.on('data',b=>{err=(err+b).slice(-2000);});
    child.on('close',(code,signal)=>{
      if(settled)return;
      const status=signal?`signal ${signal}`:`exit ${code}`;
      const diagnostic=err.trim()?`\n${err.trim()}`:'';
      let r;
      try {r=out.trim()?JSON.parse(out):null;}catch { /* report process evidence below */ }
      if(r&&r.ok===false)return finish(new Error('adapter failed: '+String(r.error||'unspecified adapter error')+diagnostic));
      if(code!==0)return finish(new Error(`ADAPTER_EXIT_FAILED: Python ${JSON.stringify(python)} ended with ${status}.${diagnostic}`));
      if(!out.trim())return finish(new Error(`ADAPTER_EMPTY_OUTPUT: Python ${JSON.stringify(python)} exited successfully but returned no JSON.${diagnostic}`));
      if(!r||r.ok!==true||!Object.hasOwn(r,'result'))return finish(new Error(`ADAPTER_INVALID_OUTPUT: Python returned an invalid adapter response (${status}).${diagnostic}`));
      finish(null,r.result);
    });
    child.stdin.end(JSON.stringify({op,data}));
  });
}
const OPS = ['echo','sha256','model.evaluate','state.merge'];
function payload(op, value) {
  if (!OPS.includes(op)) throw new Error('UNSUPPORTED_OPERATION');
  const finite=(v,depth=0)=>{
    if(depth>32)throw new Error('JSON_DEPTH_LIMIT');
    if(typeof v==='number'&&!Number.isFinite(v))throw new Error('NONFINITE_NUMBER');
    if(v&&typeof v==='object')for(const x of Object.values(v))finite(x,depth+1);
  };
  finite(value);
  if(value===undefined)throw new Error('PAYLOAD_REQUIRED');
  if (Buffer.byteLength(JSON.stringify(value))>16384) throw new Error('PAYLOAD_LIMIT');
  if (['echo','sha256'].includes(op) && typeof value!=='string') throw new Error('TEXT_REQUIRED');
  if (!['echo','sha256'].includes(op) && (!value || typeof value!=='object' || Array.isArray(value))) throw new Error('OBJECT_REQUIRED');
  if(op==='model.evaluate') {
    if(!['exact','numeric','token-f1'].includes(value.metric??'exact'))throw new Error('UNSUPPORTED_METRIC');
    if(!Array.isArray(value.rows)||!value.rows.length||value.rows.length>4096)throw new Error('EVALUATION_ROWS_REQUIRED');
    for(const row of value.rows){
      if(!row||typeof row!=='object'||Array.isArray(row))throw new Error('BAD_EVALUATION_ROW');
      const refs=row.gt??row.ground_truth,items=Array.isArray(refs)?refs:[refs];
      if(!items.length||items.length>32||items.some(x=>x==null||typeof x==='object'))throw new Error('INVALID_REFERENCES');
      const prediction=row.answer_extracted??row.response;
      if(prediction!=null&&typeof prediction!=='string')throw new Error('RESPONSE_MUST_BE_TEXT');
    }
  }
  if(op==='state.merge') {
    if(typeof value.key!=='string'||!value.key.length||!Array.isArray(value.replicas)||!value.replicas.length||value.replicas.some(x=>typeof x!=='string'||!x.length)||new Set(value.replicas).size!==value.replicas.length)throw new Error('MERGE_KEY_AND_REPLICAS_REQUIRED');
    if(!Array.isArray(value.writes)||value.writes.length>128)throw new Error('MERGE_WRITES_REQUIRED');
    for(const w of value.writes)if(!w||typeof w!=='object'||typeof w.value!=='string'||!value.replicas.includes(w.site)||!w.vector||typeof w.vector!=='object'||Array.isArray(w.vector)||!Object.hasOwn(w.vector,w.site)||Object.entries(w.vector).some(([k,v])=>!value.replicas.includes(k)||!Number.isSafeInteger(v)||v<=0))throw new Error('INVALID_MERGE_WRITE');
  }
  return value;
}
module.exports={ROOT,sha,token,id,canonical,atomic,adapter,OPS,payload};
