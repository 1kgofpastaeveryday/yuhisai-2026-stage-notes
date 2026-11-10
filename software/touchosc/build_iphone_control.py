#!/usr/bin/env python3
"""Build the iPhone Air control panel with an observed beat countdown."""
import json
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path
from build_countdown_demo import CountdownBuilder, replace_property
from build_manipulation_prototype import example, COLORS
from live_set_countdown import read_set, DEFAULT_SET, OUT

HERE=Path(__file__).resolve().parent
OUTPUT=OUT/'iphone-air'
STEM='day01-iphone-air-control'


def build():
    _,manifest=read_set(DEFAULT_SET)
    assert not manifest['issues'] and len(manifest['acts'])==12
    b=CountdownBuilder(example());b.spec['size']=[420,912]
    replace_property(b.root,'frame',dict(x=0,y=0,w=420,h=912))
    def group(name,visible):
        g=b.group(name,visible);replace_property(g,'frame',dict(x=0,y=0,w=420,h=912));return g
    def button(g,name,rect,title,action,fill=None,size=21,ink=None):
        b.box(g,name+'_base',rect,fill or COLORS['surface2'])
        b.label(g,name+'_label',rect,title,size,ink or COLORS['text'],align=2)
        b.button(g,name,rect,'  root:notify("panel", '+json.dumps(action,ensure_ascii=False)+')')
    b.box(b.root,'focus_surface',(16,80,388,784),COLORS['surface'])
    b.label(b.root,'performance_name',(24,88,296,56),manifest['acts'][0]['title'],32,bold=True)
    button(b.root,'open_acts',(328,92,68,48),'演目','acts',size=19)
    b.label(b.root,'connection_error',(24,676,372,22),'Live未接続',16,COLORS['red'])
    button(b.root,'expand',(328,148,68,44),'拡大','expand',size=18)
    button(b.root,'back_to_monitor',(328,148,68,44),'戻る','monitor',size=18)
    # Names used by the common layout callback.
    for old,new in [('back_to_monitor_base','back_base'),('back_to_monitor_label','back_label')]:
        for n in b.root.iter('node'):
            if n.findtext("./properties/property[key='name']/value")==old:replace_property(n,'name',new)
        for p in b.primitives:
            if p['name']==old:p['name']=new
    monitor=group('monitor',True)
    b.box(monitor,'progress_track',(24,194,372,8),COLORS['surface2'],radius=0)
    b.box(monitor,'progress_fill',(24,194,372,8),COLORS['blue'],radius=0)
    for i in range(1,5):
        x=24+(i-1)*96
        b.box(monitor,f'beat_pad_{i}',(x,214,84,152),COLORS['surface2'])
        b.box(monitor,f'beat_pulse_{i}',(x+8,222,68,136),COLORS['surface2'],radius=6)
    for i in range(1,17):
        x=25+(i-1)*22+(i-1)//4*5
        b.box(monitor,f'remaining_beat_{i}',(x,388,16,28),COLORS['blue'],radius=3)
    meter=group('level_meter',True)
    b.label(meter,'level_now_heading',(24,426,132,18),'現在',13)
    b.label(meter,'level_average_heading',(164,426,132,18),'1分平均',13)
    b.label(meter,'level_now',(24,446,132,34),'REW待ち',21,COLORS['blue'])
    b.label(meter,'level_average',(164,446,132,34),'—',21,COLORS['blue'])
    button(meter,'level_reference',(304,436,92,44),'基準','level_reference',size=19)
    acts=group('act_picker',False)
    for i,act in enumerate(manifest['acts']):
        x,y=24+i%2*192,180+i//2*50
        button(acts,f'act_{i+1}',(x,y,180,44),act['title'],'act:'+str(i+1),size=20)
    picker=group('cue_picker',False)
    b.label(picker,'cue_heading',(24,146,292,28),'',22,COLORS['blue'])
    button(picker,'act_start',(24,180,372,44),'演目の頭へ','act_start')
    for i in range(1,5):button(picker,f'cue_{i}',(24,230+(i-1)*50,372,44),'','cue:'+str(i),size=19)
    button(picker,'previous_cues',(24,432,180,44),'前へ','previous',size=18)
    button(picker,'next_cues',(216,432,180,44),'次へ','next',size=18)
    aux=group('auxiliary',True)
    b.label(aux,'metro_heading',(24,492,170,52),'メトロノーム',19)
    button(aux,'metro_on',(202,492,92,52),'ON','metronome:on')
    button(aux,'metro_off',(304,492,92,52),'OFF','metronome:off')
    button(aux,'qlc_stop',(24,558,372,52),'QLC+ 全停止','qlc_stop',COLORS['red_bg'],ink=COLORS['red'])
    b.label(aux,'border_heading',(24,624,170,52),'ボーダー',20)
    button(aux,'border_on',(202,624,92,52),'ON','border:on')
    button(aux,'border_off',(304,624,92,52),'OFF','border:off')
    b.label(b.root,'command_error',(24,676,372,22),'',16,COLORS['red'])
    button(b.root,'resume',(24,702,372,64),'続きから再開','resume','#2B4036',24,COLORS['green'])
    button(b.root,'live_stop',(24,782,372,64),'再生停止','stop',COLORS['red_bg'],24,COLORS['red'])
    for edge,rect in [('top',(8,76,404,4)),('bottom',(8,864,404,4)),('left',(8,80,4,784)),('right',(408,80,4,784))]:
        n=b.box(b.root,'stop_edge_'+edge,rect,COLORS['red'],radius=0);replace_property(n,'visible',False)
    data=[]
    for act in manifest['acts']:
        cues=[c for c in manifest['cues'] if act['start']<c['beat']<act['end']]
        data.append('{title='+json.dumps(act['title'])+',locator='+json.dumps(act['start_locator'])+',cues={'+
                    ','.join('{name='+json.dumps(c['name'],ensure_ascii=False)+'}' for c in cues)+'}}')
    script='local ACTS={'+','.join(data)+'}\n'+(HERE/'live_countdown.lua').read_text(encoding='utf-8')+'\n'+(HERE/'iphone_control.lua').read_text(encoding='utf-8')+'\n'+(HERE/'relative_level.lua').read_text(encoding='utf-8')
    replace_property(b.root,'script',script)
    b.nodes={n.findtext("./properties/property[key='name']/value"):n for n in b.root.iter('node')}
    assert not b.root.findall('.//messages/midi')
    for n in b.root.findall(".//node[@type='BUTTON']"):
        p=n.find("./properties/property[key='frame']/value")
        assert float(p.findtext('w'))>=44 and float(p.findtext('h'))>=44
        assert 'root:notify' in n.findtext("./properties/property[key='script']/value")
    OUTPUT.mkdir(parents=True,exist_ok=True)
    doc=ET.Element('lexml',version='6');doc.append(b.root)
    xml=ET.tostring(doc,encoding='utf-8',xml_declaration=True)
    (OUTPUT/(STEM+'.xml')).write_bytes(xml)
    (OUTPUT/(STEM+'.tosc')).write_bytes(zlib.compress(xml,9))
    return b,manifest


if __name__=='__main__':
    b,m=build()
    print(json.dumps({'file':str(OUTPUT/(STEM+'.tosc')),'buttons':len(b.buttons),'acts':len(m['acts'])}))
