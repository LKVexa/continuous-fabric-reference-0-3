'use strict';
// SPIRAL virtual-shell grammar. Quote provenance prevents literal payload expansion.
const OPERATORS=['&&','||','>>',';','|','>','<'];
const syntax=message=>{throw new SyntaxError('syntax error: '+message);};
function tokenize(line) {
  const tokens=[];let i=0;
  while(i<line.length) {
    if(/\s/.test(line[i])){i++;continue;}
    if(line[i]==='#')break;
    const op=OPERATORS.find(x=>line.startsWith(x,i));
    if(op){tokens.push({type:'op',value:op});i+=op.length;continue;}
    const parts=[];let quoted=false;
    const add=(value,expand,tilde=false)=>parts.push({value,expand,tilde});
    while(i<line.length&&!/\s/.test(line[i])&&!OPERATORS.some(x=>line.startsWith(x,i))) {
      const c=line[i++];
      if(c==='\\') {
        if(i===line.length)syntax('trailing escape');
        add(line[i++],false);continue;
      }
      if(c==="'"||c==='"') {
        quoted=true;let chunk='';
        while(i<line.length&&line[i]!==c) {
          if(c==='"'&&line[i]==='\\'&&'"\\$`'.includes(line[i+1])) {
            add(chunk,true);chunk='';i++;add(line[i++],false);
          } else chunk+=line[i++];
        }
        if(i===line.length)syntax('unterminated '+(c==="'"?'single':'double')+' quote');
        i++;add(chunk,c==='"');continue;
      }
      let chunk=c;
      while(i<line.length&&!/\s/.test(line[i])&&!['\\',"'",'"'].includes(line[i])&&!OPERATORS.some(x=>line.startsWith(x,i)))chunk+=line[i++];
      add(chunk,true,parts.length===0);
    }
    tokens.push({type:'word',value:parts.map(p=>p.value).join(''),quoted,parts});
  }
  return tokens;
}
function expandWord(token,env) {
  if(typeof token==='string')return token;
  return (token.parts||[{value:token.value,expand:!token.quoted,tilde:!token.quoted}]).map(p=>{
    let s=p.value;
    if(p.tilde&&(s==='~'||s.startsWith('~/')))s=(env.get('HOME')||'/home/operator')+s.slice(1);
    if(!p.expand)return s;
    return s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*|\?)\}|\$([A-Za-z_][A-Za-z0-9_]*)|\$\?/g,
      (m,a,b)=>String(env.get(m==='$?'?'?':(a||b))??''));
  }).join('');
}
function parse(line,env,{deferExpansion=false}={}) {
  const tokens=tokenize(line),segments=[];
  let current={op:null,pipeline:[]},cmd={argv:[],redirects:[]},lastOp=null;
  const word=t=>deferExpansion?t:expandWord(t,env);
  const flush=()=>{
    if(!cmd.argv.length)syntax('expected a command'+(lastOp?' after '+lastOp:''));
    current.pipeline.push(cmd);cmd={argv:[],redirects:[]};
  };
  for(let i=0;i<tokens.length;i++) {
    const t=tokens[i];
    if(t.type==='word'){cmd.argv.push(word(t));lastOp=null;continue;}
    if(['>','>>','<'].includes(t.value)) {
      const target=tokens[++i];if(!target||target.type!=='word')syntax('expected a path after '+t.value);
      const type=t.value==='<'?'in':t.value==='>'?'out':'append';
      if(cmd.redirects.some(r=>(r.type==='in')===(type==='in')))syntax('multiple redirects for the same stream are unsupported');
      cmd.redirects.push({type,target:word(target)});continue;
    }
    flush();lastOp=t.value;
    if(t.value!=='|'){segments.push(current);current={op:t.value===';'?null:t.value,pipeline:[]};}
  }
  if(cmd.argv.length||cmd.redirects.length)flush();
  else if(lastOp&&lastOp!==';')syntax('expected a command after '+lastOp);
  if(current.pipeline.length)segments.push(current);
  return segments;
}
module.exports={tokenize,expandWord,parse};
