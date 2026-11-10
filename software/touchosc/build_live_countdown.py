#!/usr/bin/env python3
"""Build a receive-only, full-height performance monitor for the real Live set."""
import json
import argparse
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

from build_countdown_demo import CountdownBuilder, replace_property
from build_manipulation_prototype import example
from live_set_countdown import DEFAULT_SET, OUT, read_set


def build(device='ipad'):
    if device not in ('ipad','iphone-air'): raise ValueError(device)
    output=OUT if device=='ipad' else OUT/'iphone-air'
    stem='day01-live-countdown' if device=='ipad' else 'day01-iphone-air'
    _, manifest=read_set(DEFAULT_SET)
    assert len(manifest['acts'])==12 and not manifest['issues'], manifest['issues']
    b=CountdownBuilder(example()).build()
    def name(n): return n.findtext("./properties/property[key='name']/value")
    for n in list(b.root.find('children')):
        if name(n)!='countdown_focus' and not name(n).startswith('stop_edge_'):
            b.root.find('children').remove(n)
    focus=next(n for n in b.root.find('children') if name(n)=='countdown_focus')
    for n in list(focus.find('children')):
        if name(n).startswith(('to_overview','countdown_seek_')) or name(n) in ('countdown_target','countdown_state','stop_stamp'):
            focus.find('children').remove(n)
    heading=next(n for n in focus.find('children') if name(n)=='focus_heading')
    replace_property(heading,'name','performance_name')
    heading.find("./values/value[key='text']/default").text=manifest['acts'][0]['title']
    replace_property(heading,'textSize',56)
    b.nodes={name(n):n for n in b.root.iter('node')}
    b.primitives=[p for p in b.primitives if p['name'] in b.nodes or p['name']=='focus_heading']
    for p in b.primitives:
        if p['name']=='focus_heading': p.update(name='performance_name',text=manifest['acts'][0]['title'],size=56)
    b.move('focus_surface',(24,24,696,1084))
    b.move('performance_name',(44,72,656,96))
    b.move('progress_track',(44,212,656,12)); b.move('progress_fill',(44,212,656,12))
    for i in range(1,5):
        x=44+(i-1)*168
        b.move(f'beat_pad_{i}',(x,278,152,570))
        b.move(f'beat_pulse_{i}',(x+12,290,128,546))
    for i in range(1,17):
        x=44+(i-1)*41+(i-1)//4*3
        b.move(f'remaining_beat_{i}',(x,922,30,92))
    if device=='iphone-air':
        b.spec['size']=[420,912]
        for group in b.root.iter('node'):
            if group.get('type')=='GROUP':
                replace_property(group,'frame',dict(x=0,y=0,w=420,h=912))
        b.move('focus_surface',(16,84,388,780))
        b.move('performance_name',(28,108,364,64))
        replace_property(b.nodes['performance_name'],'textSize',36)
        for primitive in b.primitives:
            if primitive['name']=='performance_name': primitive['size']=36
        b.move('progress_track',(28,202,364,8));b.move('progress_fill',(28,202,364,8))
        for i in range(1,5):
            x=28+(i-1)*94
            b.move(f'beat_pad_{i}',(x,248,82,464))
            b.move(f'beat_pulse_{i}',(x+8,256,66,448))
        for i in range(1,17):
            x=31+(i-1)*22+(i-1)//4*4
            b.move(f'remaining_beat_{i}',(x,756,16,52))
        for edge,rect in [('top',(8,76,404,4)),('bottom',(8,864,404,4)),
                          ('left',(8,80,4,784)),('right',(408,80,4,784))]:
            b.move('stop_edge_'+edge,rect)
    replace_property(b.root,'script',(Path(__file__).parent/'live_countdown.lua').read_text(encoding='utf-8'))
    assert not b.root.findall('.//messages/midi')
    assert not b.root.findall('.//messages/osc')
    assert not b.root.findall(".//node[@type='BUTTON']")
    output.mkdir(exist_ok=True,parents=True)
    doc=ET.Element('lexml',version='6'); doc.append(b.root)
    xml=ET.tostring(doc,encoding='utf-8',xml_declaration=True)
    (output/(stem+'.xml')).write_bytes(xml)
    (output/(stem+'.tosc')).write_bytes(zlib.compress(xml,9))
    (output/'set-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    b.render('focus',output/'preview.png')
    b.output=output;b.file_stem=stem;b.device=device
    return b,manifest


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--device',choices=['ipad','iphone-air'],default='ipad')
    a=p.parse_args();b,m=build(a.device)
    print(json.dumps({'device':a.device,'canvas':b.spec['size'],'acts':len(m['acts']),'issues':m['issues'],'out':str(b.output)},ensure_ascii=False))
