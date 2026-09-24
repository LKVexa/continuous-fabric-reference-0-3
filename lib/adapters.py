"""Bounded JSON adapter. Donor code is hashed before import; source trees stay read only."""
import hashlib, importlib.util, json, os, sys
from pathlib import Path
sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
LOCK = json.loads((ROOT/'catalog/bindings.json').read_text(encoding='utf-8'))
SOURCE = (ROOT / os.environ.get('CFP_SOURCE_ROOT', LOCK['source_root'])).resolve()

def checked(key):
    rec=LOCK['files'][key]; p=(SOURCE/rec['path']).resolve()
    if not p.is_relative_to(SOURCE):
        raise ValueError('SOURCE_PATH_ESCAPE: '+key)
    if hashlib.sha256(p.read_bytes()).hexdigest()!=rec['sha256']:
        raise ValueError('SOURCE_DIGEST_MISMATCH: '+key)
    return p

def module(key):
    p=checked(key); name='cfp_bound_'+key
    spec=importlib.util.spec_from_file_location(name,p)
    mod=importlib.util.module_from_spec(spec);sys.modules[name]=mod;spec.loader.exec_module(mod)
    return mod

def dispatch(req):
    op=req['op']; data=req.get('data',{})
    if op=='doctor':
        result={}
        for key in LOCK['files']:
            try: checked(key);result[key]='HASH_MATCH'
            except (OSError,ValueError):result[key]='MISSING_OR_CHANGED'
        return {'bindings':result,'full_model_mission':'BLOCKED: standalone _model lacks MODEL_CONFIG.json and mission/bootstrap.py at its expected parent',
                'promotion':'NO_PRODUCTION_CLAIM'}
    if op=='place':
        m=module('scheduler')
        w=m.Workload(**{**data['workload'],'needs':frozenset(data['workload']['needs'])})
        ns=[m.NodeReport(**{**n,'tiers':frozenset(n['tiers']),'capabilities':frozenset(n['capabilities'])}) for n in data['nodes']]
        try:return m.place(w,ns,now=data['now'],lease_ticks=30)
        except m.Unplaceable as e:return {'refused':e.as_dict()}
    if op=='model.evaluate':
        for key in LOCK['files']:
            if key.startswith('model/'):checked(key)
        sys.path.insert(0,str(SOURCE/'_model'))
        from reasoning_center.evaluation import evaluate
        return evaluate(data['rows'],data.get('metric','exact'))
    if op=='state.merge':
        m=module('replication')
        if not isinstance(data['writes'],list) or len(data['writes'])>128:raise ValueError('write count')
        state=m.ReplicatedKey(data['key'],frozenset(data['replicas']))
        for w in data['writes']:
            state.apply(m.Write(key=data['key'],value=w['value'],site=w['site'],vector=tuple(w['vector'].items())))
        conflicts=state.conflict_set()
        return {'schema':'CFP_CAUSAL_PREVIEW/1','conflicts':conflicts,'value':state.value() if conflicts['total_unresolved']==1 else None,
                'scope':'pure causal merge computation, no replication transport or persistent application state'}
    raise ValueError('unknown adapter')

if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(131073)
        if len(raw)>131072:raise ValueError('input limit')
        result=dispatch(json.loads(raw))
        print(json.dumps({'ok':True,'result':result},allow_nan=False))
    except Exception as e:
        print(json.dumps({'ok':False,'error':type(e).__name__+': '+str(e)[:300]}))
        sys.exit(1)
