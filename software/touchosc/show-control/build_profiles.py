"""Build show definitions from the actual saved Live sets, without editing them."""
import gzip,hashlib,json,pathlib,re,xml.etree.ElementTree as E
HERE=pathlib.Path(__file__).resolve().parent
STAGE=HERE.parents[1]

def read(path):
    data=path.read_bytes();root=E.fromstring(gzip.decompress(data))
    tracks=root.findall('LiveSet/Tracks/*')
    names=[t.find('Name/EffectiveName').get('Value') for t in tracks]
    cues=sorted([dict(name=c.find('Name').get('Value'),beat=float(c.find('Time').get('Value'))) for c in root.findall('LiveSet/Locators/Locators/Locator')],key=lambda c:c['beat'])
    return root,names,cues,hashlib.sha256(data).hexdigest()

def acts_from_cues(cues,numbered_end_prefix=None):
    ends={};acts=[];issues=[]
    for c in cues:
        match=re.fullmatch(r'\[([^\]]+)\](?:\s*SETSTOP)?',c['name'].strip(),re.I)
        if match and '_' in match[1] and any(ch.isspace() for ch in match[1]):
            raise ValueError('Spaces are not allowed in GROUP_NAME locators: '+c['name'])
        end=re.fullmatch(r'\[([^\]]+)\]\s*SETSTOP',c['name'].strip(),re.I)
        if end:ends[end[1].strip().casefold()]=c
    for c in cues:
        match=re.fullmatch(r'\[([^\]]+)\]',c['name'].strip())
        if not match:continue
        name=match[1].strip()
        numbered=re.fullmatch(r'(\d{2}) (.+)',name) if numbered_end_prefix else None
        end_name=numbered_end_prefix+numbered[1] if numbered else name
        end=ends.get(end_name.casefold())
        if end is None:
            issues.append('Missing SETSTOP for '+c['name']);continue
        title=numbered[2] if numbered else name.split('_',1)[-1]
        acts.append(dict(title=title,start=c['beat'],end=end['beat'],start_locator=c['name'],end_locator=end['name']))
    return acts,issues

def build(definitions=None,output_dir=None):
    definitions=definitions if definitions is not None else json.loads((HERE/'shows.json').read_text(encoding='utf8'))
    destination=pathlib.Path(output_dir) if output_dir is not None else HERE
    shows=[]
    for definition in definitions:
        key,title,live,qlc=(definition[field] for field in ('id','title','live','qlc'))
        root,names,cues,digest=read(STAGE/live)
        acts,issues=acts_from_cues(cues,definition.get('numbered_end_prefix'))
        if definition.get('locator_group'):
            prefix='['+definition['locator_group']+'_'
            acts=[a for a in acts if a['start_locator'].startswith(prefix)]
        for a in acts:
            assert a['end']>a['start']
            a['cues']=[c for c in cues if a['start']<c['beat']<a['end'] and 'SETSTOP' not in c['name'].upper()]
        assert acts and all(a['end']<=b['start'] for a,b in zip(acts,acts[1:])),key
        qlc_bytes=(STAGE/qlc).read_bytes();workspace=E.fromstring(qlc_bytes)
        # Engine definitions have names; nested Function elements are references
        # and must never overwrite the corresponding definition.
        engine=next(n for n in workspace if n.tag.rsplit('}',1)[-1]=='Engine')
        functions={n.get('ID'):n.get('Name') for n in engine if n.tag.rsplit('}',1)[-1]=='Function'}
        assert functions and all(i is not None and name is not None for i,name in functions.items()),qlc
        show=dict(id=key,title=title,live=live,qlc=qlc,source_sha256=digest,qlc_sha256=hashlib.sha256(qlc_bytes).hexdigest(),functions=functions,tracks=names,acts=acts,issues=issues,automatic_stops=True)
        # A setlist that differs from locator order (DFS day 2) is the initial
        # order until the phone saves one; it must name every act exactly once.
        if definition.get('default_order'):
            assert sorted(definition['default_order'])==sorted(a['start_locator'] for a in acts),key
            show['default_order']=definition['default_order']
        shows.append(show)
    data={'version':1,'osc_port':8001,'qlc_adapter_port':8002,'shows':shows}
    (destination/'profiles.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    if output_dir is not None:return data
    adapter=(STAGE/'project-files/C2 Project/TouchOSC/c2-qlc.cjs').read_text(encoding='utf8')
    adapter=adapter.replace("require('../Devices/QLC Live Auto Sync/node_modules/ws')","require('ws')").replace('/c2/','/stage/').replace('port=8004','port=8002').replace('localhost:8004','localhost:8002')
    if not (HERE/'qlc.cjs').exists():(HERE/'qlc.cjs').write_text(adapter,encoding='utf8')
    return data

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--integrated',action='store_true',help='Refresh integrated group profiles from the saved set; never rebuild the set')
    args=parser.parse_args()
    if args.integrated:
        unified=next(d for d in json.loads((HERE/'shows.json').read_text(encoding='utf8')) if d['id']=='unified')
        definitions=[dict(unified,id=key,title=title,locator_group=group) for key,title,group in [('c2',"C'2",'C2'),('dfs-day1','DFS','DFS')]]
        data=build(definitions,STAGE/'project-files/integrated')
    else:data=build()
    print(json.dumps([(s['id'],len(s['acts']),sum(len(a['cues']) for a in s['acts'])) for s in data['shows']]))
