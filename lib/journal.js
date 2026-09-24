'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {sha,canonical}=require('./common');
class Journal {
  constructor(file,{maxBytes=32*1024*1024}={}) {
    this.file=file;this.maxBytes=maxBytes;this.seq=0;this.head='0'.repeat(64);this.events=[];
    fs.mkdirSync(path.dirname(file),{recursive:true});
    if(fs.existsSync(file)) {
      if(fs.statSync(file).size>maxBytes)throw new Error('JOURNAL_LIMIT');
      const raw=fs.readFileSync(file,'utf8');
      if(raw && !raw.endsWith('\n'))throw new Error('JOURNAL_TORN_TAIL: preserve evidence and repair offline');
      for(const line of raw.split('\n').filter(Boolean)) {
        const r=JSON.parse(line), {hash,...body}=r;
        if(r.seq!==this.seq+1||r.prev!==this.head||sha(canonical(body))!==hash)throw new Error('JOURNAL_INTEGRITY');
        this.seq=r.seq;this.head=hash;this.events.push(r.event);
      }
    }
  }
  append(event) {
    const body={seq:this.seq+1,prev:this.head,event};const hash=sha(canonical(body));
    const line=JSON.stringify({...body,hash})+'\n';
    if((fs.existsSync(this.file)?fs.statSync(this.file).size:0)+Buffer.byteLength(line)>this.maxBytes)throw new Error('JOURNAL_LIMIT');
    const fd=fs.openSync(this.file,'a',0o600);
    try {fs.writeFileSync(fd,line);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    this.seq++;this.head=hash;this.events.push(event);return event;
  }
}
module.exports={Journal};
