'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {ROOT,adapter}=require('../lib/common');
const {resolvePython,selectPython}=require('../lib/python');
const python=resolvePython();
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cfp startup '));

test('interpreter discovery rejects non-Python programs and resolves a real absolute executable',()=>{
  assert.equal(selectPython([{command:process.execPath},{command:python}]),python);
  assert.throws(()=>selectPython([{command:path.join(temp(),'missing-python')}]),/PYTHON_UNAVAILABLE.*Python 3\.10/s);
});

test('launch error reports executable and actionable interpreter configuration',async()=>{
  await assert.rejects(adapter(path.join(temp(),'missing-python'),'doctor',{}),e=>/ADAPTER_START_FAILED/.test(e.message)&&/CFP_PYTHON/.test(e.message));
});

test('process failure preserves exit status and stderr instead of a JSON parser error',async()=>{
  await assert.rejects(adapter(process.execPath,'doctor',{}),e=>/ADAPTER_EXIT_FAILED/.test(e.message)&&/exit \d+/.test(e.message)&&/bad option/.test(e.message)&&!e.message.includes('Unexpected end'));
});

test('empty and malformed adapter responses are distinguished from an unsuccessful process',async()=>{
  const dir=temp();fs.copyFileSync(path.join(ROOT,'lib/common.js'),path.join(dir,'common.js'));
  const local=require(path.join(dir,'common.js'));
  const script=path.join(dir,'adapters.py');
  fs.writeFileSync(script,'pass\n');
  await assert.rejects(local.adapter(python,'doctor',{}),/ADAPTER_EMPTY_OUTPUT/);
  fs.writeFileSync(script,'print("not json")\n');
  await assert.rejects(local.adapter(python,'doctor',{}),/ADAPTER_INVALID_OUTPUT/);
  fs.writeFileSync(script,'import sys\nsys.stderr.write("interpreter initialization failed\\n")\nsys.exit(17)\n');
  await assert.rejects(local.adapter(python,'doctor',{}),e=>/exit 17/.test(e.message)&&/interpreter initialization failed/.test(e.message));
  fs.writeFileSync(script,'import sys\nprint(\'{"ok":true,"result":{}}\')\nsys.exit(17)\n');
  await assert.rejects(local.adapter(python,'doctor',{}),/ADAPTER_EXIT_FAILED/);
});

test('relocated CLI initializes and checks sources without CFP_PYTHON or a caller working-directory dependency',()=>{
  const base=temp(),relocated=path.join(base,'Relocated Fabric With Spaces');
  fs.cpSync(ROOT,relocated,{recursive:true,filter:p=>!path.relative(ROOT,p).split(path.sep).includes('.state')});
  const env={...process.env,CFP_STATE_DIR:path.join(base,'private state')};delete env.CFP_PYTHON;
  const call=command=>spawnSync(process.execPath,[path.join(relocated,'bin/cfp.js'),command],{cwd:base,env,encoding:'utf8',windowsHide:true,timeout:20000});
  const init=call('init');assert.equal(init.status,0,init.stderr);
  const cfg=JSON.parse(fs.readFileSync(path.join(env.CFP_STATE_DIR,'hub.json'),'utf8'));
  assert.ok(path.isAbsolute(cfg.python));assert.ok(fs.existsSync(cfg.python));
  const doctor=call('doctor');assert.equal(doctor.status,0,doctor.stderr);
  assert.ok(Object.values(JSON.parse(doctor.stdout).bindings).every(v=>v==='HASH_MATCH'));
  const invalid=spawnSync(process.execPath,[path.join(relocated,'bin/cfp.js'),'doctor'],{
    env:{...env,CFP_PYTHON:path.join(base,'missing-override')},encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(invalid.status,1);assert.match(invalid.stderr,/PYTHON_UNAVAILABLE/);
});
