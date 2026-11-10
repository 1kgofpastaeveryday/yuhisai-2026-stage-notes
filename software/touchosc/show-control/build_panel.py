"""One TouchOSC document; show data comes from profiles.json."""
import json,pathlib,sys,xml.etree.ElementTree as E,zlib
HERE=pathlib.Path(__file__).resolve().parent
SHARED=HERE.parent
sys.path.insert(0,str(SHARED))
from build_countdown_demo import CountdownBuilder,replace_property
from build_manipulation_prototype import example,COLORS
from build_profiles import build as profiles

def lua(v):
    if isinstance(v,str):return json.dumps(v,ensure_ascii=False)
    if isinstance(v,bool):return str(v).lower()
    if v is None:return 'nil'
    if isinstance(v,list):return '{'+','.join(lua(x) for x in v)+'}'
    if isinstance(v,dict):return '{'+','.join(k+'='+lua(x) for k,x in v.items())+'}'
    return str(v)

# The phone offers the three groups only. C'2 and DFS run from the unified set;
# RUMY keeps its own set. DFS has one view per day: same acts, separately saved
# order. Legacy per-group profiles stay in profiles.json for the launchers.
PANEL_GROUPS=[("C'2",[('unified-c2','')]),('RUMY',[('rumy','')]),('DFS',[('unified-dfs-day1','1日目'),('unified-dfs-day2','2日目')])]

def build():
    data=profiles();b=CountdownBuilder(example());b.spec['size']=[420,912]
    by_id={s['id']:s for s in data['shows']}
    panel_shows=[by_id[key] for _,variants in PANEL_GROUPS for key,_ in variants]
    groups=[];index=0
    for title,variants in PANEL_GROUPS:
        groups.append(dict(title=title,shows=list(range(index+1,index+1+len(variants))),labels=[label for _,label in variants]));index+=len(variants)
    data['panel_shows']=panel_shows;data['groups']=groups
    replace_property(b.root,'frame',dict(x=0,y=0,w=420,h=912))
    def group(name,visible):
        g=b.group(name,visible);replace_property(g,'frame',dict(x=0,y=0,w=420,h=912));return g
    def button(g,name,rect,title,action,fill=None,size=20,ink=None):
        b.box(g,name+'_base',rect,fill or COLORS['surface2'])
        b.label(g,name+'_label',rect,title,size,ink or COLORS['text'],align=2)
        b.button(g,name,rect,'  root:notify("panel", '+json.dumps(action)+')')
    b.label(b.root,'brand',(24,22,174,36),"C'2",25,bold=True)
    button(b.root,'open_shows',(214,20,82,44),'団体','shows',size=19)
    button(b.root,'open_acts',(306,20,90,44),'演目','acts',size=19)
    b.box(b.root,'focus_surface',(16,80,388,778),COLORS['surface'])
    b.label(b.root,'performance_name',(24,88,372,40),'Love Language',25,bold=True)
    b.label(b.root,'stop_warning',(24,130,372,20),'',14,COLORS['red'])
    monitor=group('monitor',True)
    b.box(monitor,'progress_track',(24,160,372,8),COLORS['surface2'],radius=0)
    b.box(monitor,'progress_fill',(24,160,372,8),COLORS['blue'],radius=0)
    for i in range(1,5):
        x=24+(i-1)*96
        b.box(monitor,f'beat_pad_{i}',(x,184,84,224),COLORS['surface2'])
        b.box(monitor,f'beat_pulse_{i}',(x+8,192,68,208),COLORS['surface2'],radius=6)
    for i in range(1,17):b.box(monitor,f'remaining_beat_{i}',(25+(i-1)*22+(i-1)//4*5,430,16,28),COLORS['blue'],radius=3)
    shows=group('show_picker',False)
    for i,g in enumerate(groups,1):
        pending=any(panel_shows[s-1]['issues'] for s in g['shows'])
        button(shows,f'show_{i}',(24,180+(i-1)*88,372,64),g['title']+(' 確認待ち' if pending else ''),'show:'+str(i),size=23)
    acts=group('act_picker',False)
    for k in range(1,max(len(g['shows']) for g in groups)+1):
        # Above the list, in place of the act name: far from the transport buttons.
        button(acts,f'variant_{k}',(24+(k-1)*192,90,180,48),'','variant:'+str(k),size=19)
    for i in range(1,8):button(acts,f'act_{i}',(24,150+(i-1)*62,372,54),'','act:'+str(i),size=21)
    button(acts,'acts_previous',(24,612,100,44),'前へ','acts_previous',size=19)
    button(acts,'open_order',(136,612,164,44),'順番','order',size=19)
    button(acts,'acts_next',(312,612,84,44),'次へ','acts_next',size=19)
    order=group('order_picker',False)
    for i in range(1,8):
        b.box(order,f'order_row_{i}',(24,150+(i-1)*62,244,54),COLORS['surface2'])
        b.label(order,f'order_title_{i}',(32,150+(i-1)*62,228,54),'',19)
        button(order,f'order_up_{i}',(278,150+(i-1)*62,52,54),'上','up:'+str(i),size=19)
        button(order,f'order_down_{i}',(344,150+(i-1)*62,52,54),'下','down:'+str(i),size=19)
    button(order,'order_previous',(24,612,100,44),'前へ','order_previous',size=19)
    button(order,'order_back',(136,612,164,44),'戻る','acts',size=19)
    button(order,'order_next',(312,612,84,44),'次へ','order_next',size=19)
    picker=group('cue_picker',False)
    b.label(picker,'cue_heading',(24,150,372,32),'',23,COLORS['blue'])
    button(picker,'cue_act_start',(24,196,372,52),'演目の頭へ','act_start',size=21)
    for i in range(1,5):button(picker,f'cue_{i}',(24,266+(i-1)*66,372,54),'','cue:'+str(i),size=18)
    button(picker,'cues_previous',(24,558,180,44),'前へ','cues_previous',size=19)
    button(picker,'cues_next',(216,558,180,44),'次へ','cues_next',size=19)
    aux=group('auxiliary',True)
    button(aux,'act_start',(24,488,270,52),'演目の頭へ','act_start',size=21)
    button(aux,'open_cues',(304,488,92,52),'区間','cues',size=20)
    b.label(aux,'metro_heading',(24,558,170,52),'メトロノーム',19)
    button(aux,'metro_on',(202,558,92,52),'ON','metronome:on')
    button(aux,'metro_off',(304,558,92,52),'OFF','metronome:off')
    button(aux,'qlc_stop',(24,628,372,52),'QLC+ 全停止','qlc_stop',COLORS['red_bg'],ink=COLORS['red'])
    b.label(b.root,'connection_error',(24,866,372,22),'Live未接続',15,COLORS['red'])
    b.label(b.root,'command_error',(24,866,372,22),'',15,COLORS['red'])
    button(b.root,'resume',(24,706,372,64),'続きから再開','resume','#2B4036',24,COLORS['green'])
    button(b.root,'live_stop',(24,786,372,64),'再生停止','stop',COLORS['red_bg'],24,COLORS['red'])
    for edge,rect in [('top',(8,76,404,4)),('bottom',(8,858,404,4)),('left',(8,80,4,778)),('right',(408,80,4,778))]:
        n=b.box(b.root,'stop_edge_'+edge,rect,COLORS['red'],radius=0);replace_property(n,'visible',False)
    rows=[dict(id=s['id'],title=s['title'],automatic=s['automatic_stops'],blocked=bool(s['issues']),order=[[a['start_locator'] for a in s['acts']].index(n)+1 for n in s.get('default_order',[a['start_locator'] for a in s['acts']])],acts=[dict(title=a['title'],locator=a['start_locator'],cues=[dict(name=c['name']) for c in a['cues']]) for a in s['acts']]) for s in panel_shows]
    script='local SHOWS='+lua(rows)+'\nlocal GROUPS='+lua(groups)+'\n'+(SHARED/'live_countdown.lua').read_text(encoding='utf8').replace('local beat=(s.position-s.start)*factor','local beat=s.position*factor')+'\n'+(HERE/'panel.lua').read_text(encoding='utf8')
    replace_property(b.root,'script',script)
    doc=E.Element('lexml',version='6');doc.append(b.root);xml=E.tostring(doc,encoding='utf-8',xml_declaration=True)
    (HERE/'Stage-control.xml').write_bytes(xml);(HERE/'Stage-control.tosc').write_bytes(zlib.compress(xml,9))
    return b,data
if __name__=='__main__':
    b,d=build();print(json.dumps({'shows':len(d['shows']),'buttons':len(b.buttons)}))
