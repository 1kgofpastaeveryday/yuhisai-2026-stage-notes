"""Native Windows Live check; requires the existing muted countdown test copy."""
import hashlib
import json
import socket
import sys
import time
import types
from pathlib import Path
# Loading the pure OSC codecs does not instantiate a Live control surface.
sys.modules['_Framework']=types.ModuleType('_Framework')
base=types.ModuleType('_Framework.ControlSurface');base.ControlSurface=object
sys.modules['_Framework.ControlSurface']=base
from StageControl import packet,decode
from live_set_countdown import LiveClient,read_set,DEFAULT_SET,validate_live_cues,OUT


def main():
    # Importing StageControl requires Live's _Framework; use a stub solely to load codecs outside Live.
    _,manifest=read_set(DEFAULT_SET)
    client=LiveClient();validate_live_cues(client,manifest)
    info=client.request('get_session_info')
    assert info['master_track']['volume']==0, 'Muted test set required'
    udp=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);udp.bind(('127.0.0.1',0));udp.settimeout(.2)
    peer=('127.0.0.1',8001);last_hello=0;request_id=0;observed={};results=[]
    def poll():
        nonlocal last_hello
        if time.monotonic()-last_hello>.45:
            udp.sendto(packet('/stage/hello',udp.getsockname()[1]),peer);last_hello=time.monotonic()
        try:
            address,args=decode(udp.recvfrom(8192)[0]);observed[address]=args
            return address,args
        except socket.timeout:return None,None
    def until(predicate,timeout=3):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            address,args=poll()
            if address and predicate(address,args):return args
        raise AssertionError('Live state timeout: '+repr(observed))
    def command(action,value=''):
        nonlocal request_id
        request_id+=1;udp.sendto(packet('/stage/control',request_id,action,value),peer)
        reply=until(lambda a,v:a=='/stage/ack' and v[0]==request_id)
        assert reply[1]==1,reply
    def state(predicate,timeout=3):return until(lambda a,v:a=='/stage/state' and predicate(v),timeout)
    try:
        state(lambda v:True)
        command('stop');state(lambda v:v[2]==0)
        for value,expected in [('on',1),('off',0)]:
            command('metronome',value);until(lambda a,v:a=='/stage/panel' and v[1]==expected)
        targets=[(a['start_locator'],a['start']) for a in manifest['acts']]
        targets += [(c['name'],c['beat']) for c in manifest['cues']
                    if any(a['start']<c['beat']<a['end'] for a in manifest['acts'])]
        for name,beat in targets:
            command('locate',name)
            prepared=state(lambda v:v[2]==0 and abs(v[1]-beat)<.01)
            command('resume')
            started=state(lambda v:v[2]==1)
            assert beat-.01<=started[1]<beat+1.2,(name,beat,started)
            command('stop');paused=state(lambda v:v[2]==0)
            command('stop');held=state(lambda v:v[2]==0)
            assert abs(paused[1]-held[1])<.01,(name,paused,held)
            command('resume');continued=state(lambda v:v[2]==1)
            assert paused[1]-.01<=continued[1]<paused[1]+1.2,(name,paused,continued)
            command('stop');state(lambda v:v[2]==0)
            results.append({'locator':name,'target':beat,'prepared':prepared[1],'started':started[1],
                            'paused':paused[1],'continued':continued[1],'repeated_stop_holds':True})
        # Auto-stop and resume beyond the same boundary exercise the ClyphX handoff.
        auto=[]
        for act in manifest['acts']:
            command('locate',act['start_locator']);state(lambda v:v[2]==0 and abs(v[1]-act['start'])<.01)
            command('resume');state(lambda v:v[2]==1)
            client.request('set_current_song_time',time=act['end']-1.5)
            # A jump may itself activate a crossed ClyphX action; settle, then prepare forward traversal.
            time.sleep(.25)
            command('resume')
            stopped=state(lambda v:v[2]==0 and v[1]>=act['end'],timeout=4)
            command('resume');continued=state(lambda v:v[2]==1 and v[1]>=stopped[1])
            command('stop');state(lambda v:v[2]==0)
            auto.append({'act':act['title'],'boundary':act['end'],'stopped':stopped[1],'continued':continued[1]})
        assert hashlib.sha256(DEFAULT_SET.read_bytes()).hexdigest()==manifest['source_sha256']
        report={'result':'PASS','native_live':'11.3.43 Windows','targets':results,'clyphx_boundaries':auto,
                'metronome_on_off_verified':True,'source_unchanged':True,'source_sha256':manifest['source_sha256']}
        (OUT/'iphone-air/control-live-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(json.dumps({'result':'PASS','native_locator_targets':len(results),'native_auto_stop_resume':len(auto)}))
    finally:
        try:command('stop')
        finally:udp.close();client.close()


if __name__=='__main__':
    # Live's base class is not used by the test process.
    main()
