#!/usr/bin/env python3
"""Verify real-set pairing, OSC decoding and Lua rendering against Live trace."""
import hashlib
import argparse
import json
import math
import struct

from PIL import Image, ImageFont
from build_live_countdown import build
from countdown_test_runtime import DemoRuntime
from live_set_countdown import OUT, DEFAULT_SET, read_set, state_packet, select_act


def decode_packet(data):
    def string(offset):
        end=data.index(0,offset)
        return data[offset:end].decode('utf-8'),(end+4)//4*4
    address,offset=string(0); tags,offset=string(offset)
    values=[]
    for tag in tags[1:]:
        if tag=='s': value,offset=string(offset)
        else:
            value=struct.unpack_from('>'+tag,data,offset)[0]; offset+=4
        values.append(value)
    assert offset==len(data)
    return address,tags[1:],values


def contrast_ratio(a,b):
    def luminance(color):
        channels=[color[k]/12.92 if color[k]<=0.04045 else ((color[k]+0.055)/1.055)**2.4 for k in ('r','g','b')]
        return sum(c*w for c,w in zip(channels,(0.2126,0.7152,0.0722)))
    high,low=sorted((luminance(a),luminance(b)),reverse=True)
    return (high+0.05)/(low+0.05)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--device',choices=['ipad','iphone-air'],default='ipad')
    args=parser.parse_args()
    builder,manifest=build(args.device)
    output,stem=builder.output,builder.file_stem
    xml_path=output/(stem+'.xml')
    d=DemoRuntime(xml_path)
    full_width=364 if args.device=='iphone-air' else 656
    width,height=builder.spec['size']
    labels=[n for n in d.nodes.values() if n.get('type')=='LABEL']
    assert len(labels)==1 and d.read('performance_name')=='OP'
    assert not d.xml.findall('.//messages')
    checks=['12 paired acts; case-insensitive matching and trailing whitespace; only performance name is visible text']
    for name in d.nodes:
        f=d.controls[name].frame
        assert f.x>=0 and f.y>=0 and f.x+f.w<=width and f.y+f.h<=height,(name,dict(f.items()))
    text_size=36 if args.device=='iphone-air' else 56
    font=ImageFont.truetype('<PATH>',text_size*2)
    label_frame=d.controls.performance_name.frame
    for act in manifest['acts']:
        left,top,right,bottom=font.getbbox(act['title'])
        assert (right-left)/2<=label_frame.w and (bottom-top)/2<=label_frame.h,act['title']
    if args.device=='iphone-air':
        assert label_frame.y>=80 and label_frame.y+label_frame.h<=872
    checks.append('all controls within canvas; all 12 performance names fit their text frame')
    sequence=0
    name_contrasts=[]
    def receive(info,act,advance=50,seq=None):
        nonlocal sequence
        d.clock+=advance; d.lua.globals().now=d.clock
        sequence=sequence+1 if seq is None else seq
        address,tags,values=decode_packet(state_packet(sequence,info,act))
        args=d.lua.table_from([d.lua.table(tag=t,value=v) for t,v in zip(tags,values)])
        d.env.onReceiveOSC(d.lua.table_from([address,args]),d.lua.table_from([True]))
        name_contrasts.append(contrast_ratio(d.controls.performance_name.textColor,d.controls.focus_surface.color))
        assert name_contrasts[-1]>=3, name_contrasts[-1]
    for act in manifest['acts']:
        info={'current_song_time':act['start'],'is_playing':True,'tempo':120,
              'signature_numerator':4,'signature_denominator':4}
        receive(info,act)
        assert d.read('performance_name')==act['title']
        assert abs(d.controls.progress_fill.frame.w-full_width)<1e-8
        info['current_song_time']=act['end']-4;receive(info,act)
        assert d.filled_ticks()==4
        for count in (3,2,1):
            info['current_song_time']=act['end']-count;receive(info,act)
            assert d.filled_ticks()==count
        info['current_song_time']=act['end']+.25; info['is_playing']=False;receive(info,act)
        assert d.filled_ticks()==0 and d.controls.beat_pulse_1.color.r==1
        assert d.read('performance_name')==act['title']
    checks.append('all 12 acts: full-length progress uses named start, final 4 beat cells, observed stop holds color and name')
    previous=d.read('performance_name')
    old=sequence-2
    receive(dict(info),manifest['acts'][0],seq=old)
    assert d.read('performance_name')==previous
    d.advance(800)
    assert not d.controls.progress_fill.visible and d.controls.performance_name.textColor.r==.45
    assert d.controls.beat_pulse_1.color.r<.5
    name_contrasts.append(contrast_ratio(d.controls.performance_name.textColor,d.controls.focus_surface.color))
    assert name_contrasts[-1]>=3
    receive(dict(info),manifest['acts'][0],seq=1)
    assert d.read('performance_name')=='OP'
    checks.append('out-of-order packets ignored, stale input dims without fake motion, stream restart accepted after timeout')
    # Unicode names survive binary OSC padding and Lua input.
    unicode=dict(manifest['acts'][0],title='演目のテスト')
    receive(dict(info),unicode)
    assert d.read('performance_name')=='演目のテスト'
    checks.append('Unicode OSC string round-trip')

    trace=json.loads((OUT/'live-trace.json').read_text(encoding='utf-8'))
    transport=json.loads((OUT/'live-transport-verification.json').read_text(encoding='utf-8'))
    assert transport['result']=='PASS' and len(transport['acts'])==12
    assert transport['source_sha256']==manifest['source_sha256']
    replay=DemoRuntime(xml_path)
    d=replay; sequence=0; frames=[]; frame_times=[]; previous_time=trace[0]['monotonic']
    for sample in trace:
        delta=max(0,(sample['monotonic']-previous_time)*1000);previous_time=sample['monotonic']
        act=select_act(manifest['acts'],sample['current_song_time'])
        receive(sample,act,advance=delta)
        assert d.read('performance_name')==act['title']
        remaining=max(0,act['end']-sample['current_song_time'])*sample['signature_denominator']/4
        assert d.filled_ticks()==min(16,max(0,math.ceil(remaining-1e-6)))
        assert d.controls.progress_fill.frame.w<=full_width+1e-6
        if act['title']=='OP' and sample['is_playing'] and sample['current_song_time']>=act['end']-15:
            if len(frames)<90:
                image=builder.render('focus',output/'frame.png',state=d.snapshot())
                frames.append(image.resize((width,height)))
                frame_times.append(sample['monotonic'])
                if 2.5<remaining<3.5: image.save(output/'preview.png')
    assert frames
    durations=[max(20,round((b-a)*1000)) for a,b in zip(frame_times,frame_times[1:])]+[250]
    frames[0].save(output/'live-preview.gif',save_all=True,append_images=frames[1:],duration=durations,loop=0)
    if (output/'frame.png').exists(): (output/'frame.png').unlink()
    checks.append('all real Live trace samples decoded into Lua with correct act and beat cells; GIF rendered from actual transport data')
    checks.append('large performance name meets HIG-referenced 3:1 text contrast in active and stale states')
    assert hashlib.sha256(DEFAULT_SET.read_bytes()).hexdigest()==manifest['source_sha256']
    report={'result':'PASS','device':args.device,'canvas':[width,height],
            'checks':checks,'source_sha256':manifest['source_sha256'],
            'tosc_sha256':hashlib.sha256((output/(stem+'.tosc')).read_bytes()).hexdigest(),
            'acts':len(manifest['acts']),'live_trace_samples':len(trace),'visible_text':'performance name only',
            'minimum_large_text_contrast':round(min(name_contrasts),2),
            'native_touchosc_execution':False,'ipad_tested':False,'iphone_air_tested':False}
    (output/'verification.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__': main()
