"""Exercise gestures, OSC routing, state feedback and the Live trace in real Lua."""
import hashlib
import json
import sys
from pathlib import Path
from build_iphone_control import build,OUTPUT,STEM
from countdown_test_runtime import DemoRuntime
from verify_live_countdown import decode_packet
from live_set_countdown import state_packet,select_act,OUT


def main():
    b,m=build();d=DemoRuntime(OUTPUT/(STEM+'.xml'))
    sends=[]
    d.lua.globals().sendOSC=lambda msg,connections:sends.append((msg,connections))
    def receive(address,*args):
        values=d.lua.table_from([d.lua.table(value=a) for a in args])
        return d.env.onReceiveOSC(d.lua.table_from([address,values]),d.lua.table_from([True]))
    def take(action,value=''):
        assert len(sends)==1,len(sends)
        msg,connections=sends.pop()
        assert connections[1] is True and connections[2] is None
        assert msg[1]=='/stage/control'
        args=msg[2]
        assert [(args[i].tag,args[i].value) for i in (2,3)]==[('s',action),('s',value)]
        assert args[1].tag=='i'
        receive('/stage/ack',args[1].value,1,'')
    for name,action,value in [('resume','resume',''),('live_stop','stop',''),('metro_on','metronome','on'),('metro_off','metronome','off'),('qlc_stop','qlc_stop',''),('border_on','border','on'),('border_off','border','off')]:
        d.press(name);take(action,value)
    # Browsing never fires a seek. Each real cue, including the second page, seeks once.
    sought=0
    for index,act in enumerate(m['acts'],1):
        d.press('open_acts');assert d.controls.act_picker.visible
        d.press('act_'+str(index));assert d.controls.cue_picker.visible and not sends
        d.press('act_start');take('locate',act['start_locator']);sought+=1
        cues=[c for c in m['cues'] if act['start']<c['beat']<act['end']]
        for ci,cue in enumerate(cues):
            d.press('open_acts');d.press('act_'+str(index))
            if ci>=4:d.press('next_cues')
            d.press('cue_'+str(ci%4+1));take('locate',cue['name']);sought+=1
    receive('/stage/panel',1,1)
    assert d.controls.resume_base.color.g>.8 and d.controls.metro_on_base.color.b>.5
    receive('/stage/panel',0,0)
    assert d.controls.resume_base.color.g<.8 and d.controls.metro_off_base.color.b>.5
    d.press('expand');assert not d.controls.auxiliary.visible
    assert d.controls.beat_pad_1.frame.h==392
    assert d.controls.resume.visible and d.controls.live_stop.visible
    b.render('main',OUTPUT/'control-expanded-preview.png',state=d.snapshot())
    d.press('expand');assert d.controls.auxiliary.visible
    trace=json.loads((OUT/'live-trace.json').read_text(encoding='utf-8'))
    for seq,sample in enumerate(trace,1):
        act=select_act(m['acts'],sample['current_song_time'])
        address,tags,values=decode_packet(state_packet(seq,sample,act))
        receive(address,*values)
        assert d.read('performance_name')==act['title']
    d.press('qlc_stop');msg,_=sends.pop();receive('/stage/ack',msg[2][1].value,0,'Unavailable')
    assert d.read('command_error')=='QLC+未接続' and d.controls.command_error.visible
    # Timeout and stale-input handling must not animate a fake clock.
    d.advance(800);assert not d.controls.progress_fill.visible
    assert any(msg[1]=='/stage/hello' for msg,_ in sends);sends.clear()
    d.press('resume');sends.clear();d.advance(2100)
    assert d.read('command_error')=='応答なし'
    # Reset for clean, observed previews (no mocked playback is shipped in .tosc).
    d=DemoRuntime(OUTPUT/(STEM+'.xml'));d.lua.globals().sendOSC=lambda *a:None
    receive('/stage/state',1,m['acts'][0]['end']-8,1,120,4,4,'OP',0,m['acts'][0]['end'])
    receive('/stage/panel',1,0)
    b.render('main',OUTPUT/'control-preview.png',state=d.snapshot())
    d.press('open_acts');b.render('main',OUTPUT/'control-acts-preview.png',state=d.snapshot())
    d.press('act_10');b.render('main',OUTPUT/'control-cues-preview.png',state=d.snapshot())
    # Every page keeps transport buttons and every target is at least 44 points.
    for button in b.buttons:
        x,y,w,h=button['rect'];assert w>=44 and h>=44 and x>=16 and y>=80 and x+w<=404 and y+h<=864,button
    report={'result':'PASS','canvas':[420,912],'buttons':len(b.buttons),'actual_locator_targets':sought,
            'live_trace_samples':len(trace),'checks':['press only; no release commands','all seven transport/lighting controls send OSC on connection 1',
            '12 acts and every ordinary cue including page 2','no seek while browsing','observed playing/metronome feedback','expanded countdown retains transport',
            'negative acknowledgements and timeout visible','stale input dims countdown','all hit targets >=44 points'],
            'tosc_sha256':hashlib.sha256((OUTPUT/(STEM+'.tosc')).read_bytes()).hexdigest(),'iphone_tested':False}
    (OUTPUT/'control-verification.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':main()
