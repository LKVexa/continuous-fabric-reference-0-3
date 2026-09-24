'use strict';
const path=require('node:path');
const {Journal}=require('./journal');
const {adapter,id,canonical}=require('./common');
const {parseCommand,help,version,terminalVersion}=require('./commands');
class Fabric {
  constructor({stateDir,python,sourceRoot,clock=Date.now}) {
    Object.assign(this,{python,sourceRoot,clock});
    this.journal=new Journal(path.join(stateDir,'jobs.jsonl'));this.jobs=new Map();this.peers=new Map();this.tail=Promise.resolve();
    for(const event of this.journal.events) {
      if(event.type!=='job')throw new Error('UNKNOWN_JOURNAL_EVENT');
      this.jobs.set(event.job.id,event.job);
    }
    for(const j of this.jobs.values())if(j.state==='ASSIGNED')this.record({...j,state:'UNKNOWN',reason:'HUB_RESTART: query original executor; never automatically resubmit'});
  }
  serial(fn) { const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p; }
  record(job) { this.journal.append({type:'job',job});this.jobs.set(job.id,job);return job; }
  view(j) { return {id:j.id,key:j.key,target:j.target,op:j.op,state:j.state,node:j.node||null,reason:j.reason||null,result:j.result??null,created:j.created,completed:j.completed??null,terminal:['SUCCEEDED','FAILED','ABANDONED'].includes(j.state),outcomeKnown:['SUCCEEDED','FAILED'].includes(j.state)}; }
  async command(principal,args) {
    return this.serial(async()=>{
      const parsed=parseCommand(args),{verb,rest}=parsed;
      const visible=()=>[...this.jobs.values()].filter(j=>j.tenant===principal.tenant);
      if(verb==='help')return help(principal.submit);
      if(verb==='status')return {platform:'Continuous Fabric Reference '+version,terminal:'HERMIT '+terminalVersion+' / hermit.vws.v2 / LOCAL_VOLATILE',
        jobs:'durable single-hub journal',connectedAgents:[...this.peers.values()].filter(p=>p.tenant===principal.tenant&&this.clock()-p.seen<15000).length,
        registeredAgents:[...this.peers.values()].filter(p=>p.tenant===principal.tenant).length,permission:principal.submit?'submit-enabled':'read-only',production:'NOT_QUALIFIED'};
      if(verb==='nodes')return [...this.peers.values()].filter(p=>p.tenant===principal.tenant).map(p=>({id:p.id,site:p.site,online:this.clock()-p.seen<15000,lastSeen:p.seen,observedAt:this.clock(),operations:p.operations,isolation:'trusted built-ins in a process; no tenant sandbox',attestation:'OPERATOR_ENROLLED_NOT_HARDWARE_ATTESTED'}));
      if(verb==='jobs')return visible().slice(-30).map(j=>this.view(j));
      if(verb==='job'){const j=this.jobs.get(rest[0]);if(!j||j.tenant!==principal.tenant)throw new Error('NOT_FOUND');return this.view(j);}
      if(verb==='sources')return {packages:require('../catalog/sources.json').packages.length,integrated:['HERMIT hosted runtime','SCH-01 engine','_model offline evaluation (on request)','GAP-05 causal merge core (on request)'],health:'Integration inventory only; run node bin/cfp.js doctor in the host terminal to verify source hashes',remaining:'catalog/INTEGRATION_MATRIX.md; staged, not promoted'};
      if(!principal.submit)throw new Error('FORBIDDEN: fabric capability required');
      if(verb==='abandon') {
        const j=this.jobs.get(rest[0]);if(!j||j.tenant!==principal.tenant)throw new Error('NOT_FOUND');
        if(!['UNKNOWN','QUEUED'].includes(j.state))throw new Error('ONLY_UNKNOWN_OR_QUEUED_CAN_BE_ABANDONED');
        return this.view(this.record({...j,state:'ABANDONED',reason:'Operator abandoned; remote effects, if any, are not undone'}));
      }
      const {target,op,data}=parsed, key=parsed.key||id();
      const old=visible().find(j=>j.sub===principal.sub&&j.key===key);
      if(old){if(canonical([old.target,old.op,old.data])!==canonical([target,op,data]))throw new Error('IDEMPOTENCY_CONFLICT');return this.view(old);}
      if(this.jobs.size>=1000)throw new Error('JOB_RETENTION_LIMIT: archive the stopped hub before starting a fresh state directory');
      const j=this.record({id:id(),key,sub:principal.sub,tenant:principal.tenant,target,op,data,state:'QUEUED',created:this.clock()});
      await this.schedule();return this.view(this.jobs.get(j.id));
    });
  }
  async schedule() {
    for(const job of this.jobs.values()) {
      if(job.state!=='QUEUED')continue;
      const now=this.clock();
      const peers=[...this.peers.values()].filter(p=>p.tenant===job.tenant &&
        (job.target==='auto'||job.target===p.id||job.target==='site:'+p.site));
      const nodes=peers.map(p=>({name:p.id,site:p.site,tiers:['process'],capabilities:p.operations,
        free_slots:[...this.jobs.values()].some(j=>j.node===p.id&&['ASSIGNED','UNKNOWN'].includes(j.state))?0:1,
        reported_at:Math.floor(p.seen/1000),thermally_excluded:now-p.seen>=15000,occupants:{}}));
      if(!nodes.length){job.reason='NO_CONNECTED_MATCHING_AGENT';continue;}
      let placement;
      try { placement=await adapter(this.python,'place',{workload:{name:job.id,tenant:job.tenant,provenance:'internal',needs:[job.op]},nodes,now:Math.floor(now/1000)},this.sourceRoot); }
      catch{job.reason='SCHEDULER_UNAVAILABLE: hub operator should run doctor';continue;}
      if(placement.refused){job.reason=placement.refused.code;continue;}
      const peer=this.peers.get(placement.node);
      // Recheck after the asynchronous decision; authority lives at commit.
      if(!peer||!peers.includes(peer)||this.clock()-peer.seen>=15000)continue;
      const assigned=this.record({...job,state:'ASSIGNED',node:peer.id,lease:id(),deadline:this.clock()+30000,placement,reason:null});
      if(!peer.send({type:'execute',job:{id:assigned.id,lease:assigned.lease,deadline:assigned.deadline,op:assigned.op,data:assigned.data}})) {
        this.record({...assigned,state:'UNKNOWN',reason:'TRANSPORT_OUTCOME_UNKNOWN'});
      }
    }
  }
  register(grant,operations,send) {
    if(this.peers.has(grant.id))throw new Error('DUPLICATE_AGENT');
    if(!Array.isArray(operations)||operations.length>16||operations.some(x=>typeof x!=='string'||!grant.operations.includes(x)))throw new Error('CAPABILITY_ESCALATION');
    const peer={...grant,operations:[...new Set(operations)],send,seen:this.clock()};
    this.peers.set(grant.id,peer);return peer;
  }
  disconnect(peer) { return this.serial(()=>{
    if(this.peers.get(peer.id)!==peer)return;
    this.peers.delete(peer.id);
    for(const j of this.jobs.values())if(j.node===peer.id&&j.state==='ASSIGNED')this.record({...j,state:'UNKNOWN',reason:'AGENT_DISCONNECTED: await original receipt'});
  }); }
  receipt(peer,r) { return this.serial(async()=>{
    const j=this.jobs.get(r.id);
    if(!j||j.node!==peer.id||j.tenant!==peer.tenant||j.lease!==r.lease)throw new Error('FOREIGN_OR_STALE_RECEIPT');
    if(!['SUCCEEDED','FAILED','UNKNOWN'].includes(r.state))throw new Error('BAD_RESULT_STATE');
    if(Buffer.byteLength(JSON.stringify(r.result??null))>32768)throw new Error('RESULT_LIMIT');
    const result=r.result??null;
    if(['SUCCEEDED','FAILED','ABANDONED'].includes(j.state)) {
      if(j.state==='ABANDONED')return {type:'receipt.ack',id:j.id,lease:j.lease,state:j.state};
      if(j.state!==r.state||canonical(j.result)!==canonical(result))throw new Error('RESULT_EQUIVOCATION');
    } else this.record({...j,state:r.state,result,reason:r.state==='UNKNOWN'?'EXECUTOR_RESTART_OR_UNCERTAIN':null,completed:r.state==='UNKNOWN'?null:this.clock()});
    await this.schedule();return {type:'receipt.ack',id:j.id,lease:j.lease,state:r.state};
  }); }
  tick() { return this.serial(async()=>{
    for(const j of this.jobs.values())if(j.state==='ASSIGNED'&&j.deadline<this.clock())this.record({...j,state:'UNKNOWN',reason:'DEADLINE_EXPIRED: no automatic retry'});
    await this.schedule();
  }); }
}
module.exports={Fabric};
