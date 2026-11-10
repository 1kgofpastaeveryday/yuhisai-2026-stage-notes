"""Real Lua + isolated UDP/profile/order persistence and cancellation checks."""
import importlib.util,json,pathlib,select,shutil,socket,sys,tempfile,types
from build_panel import build,HERE,SHARED
sys.path.insert(0,str(SHARED))
from countdown_test_runtime import DemoRuntime

def main():
    b,data=build();d=DemoRuntime(HERE/'Stage-control.xml');sends=[]
    d.lua.globals().sendOSC=lambda message,connections:sends.append((message,connections))
    def receive(address,*args):
        return d.env.onReceiveOSC(d.lua.table_from([address,d.lua.table_from([d.lua.table(value=a) for a in args])]),d.lua.table_from([True]))
    def take(action,value=''):
        assert len(sends)==1
        message,connections=sends.pop();args=message[2]
        assert message[1]=='/stage/control' and connections[1] is True
        assert args[2].value==action and args[3].value==value,(args[2].value,args[3].value,action,value)
        receive('/stage/ack',args[1].value,1,'')
    panel_shows,groups=data['panel_shows'],data['groups']
    # The phone lists exactly the three groups; C'2 and DFS use the unified set.
    assert [g['title'] for g in groups]==["C'2",'RUMY','DFS']
    assert [s['id'] for s in panel_shows]==['unified-c2','rumy','unified-dfs-day1','unified-dfs-day2']
    assert all(a['start_locator'].startswith('[C2_') for a in panel_shows[0]['acts'])
    assert all(a['start_locator'].startswith('[DFS_') for s in panel_shows[2:] for a in s['acts'])
    assert panel_shows[2]['acts']==panel_shows[3]['acts']
    def open_acts(si):
        # Group button, then the act list; a DFS day is chosen inside the act list.
        g,k=next((g,k) for g,group in enumerate(groups,1) for k,index in enumerate(group['shows'],1) if index==si)
        d.press('open_shows');d.press('show_'+str(g));assert not sends
        d.press('open_acts')
        multiple=len(groups[g-1]['shows'])>1
        for v in (1,2):assert bool(d.controls['variant_'+str(v)].visible)==multiple
        if multiple:d.press('variant_'+str(k));assert d.read('brand')==panel_shows[si-1]['title']
        assert not sends
    def slot_of(show,ai):
        # Zero-based list position: the act list follows the profile's initial order.
        names=[a['start_locator'] for a in show['acts']]
        return show.get('default_order',names).index(names[ai])
    targets=0
    for si,show in enumerate(panel_shows,1):
        for ai,act in enumerate(show['acts']):
            d=DemoRuntime(HERE/'Stage-control.xml');d.lua.globals().sendOSC=lambda m,c:sends.append((m,c));sends.clear()
            open_acts(si)
            slot=slot_of(show,ai)
            for _ in range(slot//7):d.press('acts_next')
            d.press('act_'+str(slot%7+1));assert not sends
            # Incoming playback feedback must not overwrite a browsed act.
            first=show['acts'][0]
            receive('/stage/state',targets+1,first['start'],0,120,4,4,first['title'],first['start'],first['end'])
            d.press('cue_act_start');take('locate',act['start_locator']);targets+=1
    # Directly verify deterministic complete cue routing without relying on
    # the previous navigation state's page index.
    for si,show in enumerate(panel_shows,1):
        for ai,act in enumerate(show['acts']):
            for ci,cue in enumerate(act['cues']):
                d=DemoRuntime(HERE/'Stage-control.xml');d.lua.globals().sendOSC=lambda m,c:sends.append((m,c));sends.clear()
                open_acts(si)
                slot=slot_of(show,ai)
                for _ in range(slot//7):d.press('acts_next')
                d.press('act_'+str(slot%7+1))
                for _ in range(ci//4):d.press('cues_next')
                d.press('cue_'+str(ci%4+1));take('locate',cue['name']);targets+=1
    # DFS day 1 and day 2 keep separate orders on the phone.
    day1,day2=panel_shows[2],panel_shows[3];n=len(day1['acts'])
    # Day 2 starts from the supplied setlist, not locator order.
    titles=[a['title'] for a in day2['acts']]
    day2_default=[titles.index(t)+1 for t in ['OP','1new','CLAPUNITY','1ja','haruka','2JA','2NEW','MoNaChi','LOCK','3NEW','3ja','POP']]
    day1_value=','.join(map(str,[2,1]+list(range(3,n+1))))
    day2_order=list(day2_default);day2_order[1:3]=day2_order[2:0:-1];day2_value=','.join(map(str,day2_order))
    d=DemoRuntime(HERE/'Stage-control.xml');d.lua.globals().sendOSC=lambda m,c:sends.append((m,c));sends.clear()
    open_acts(3);d.press('open_order')
    d.press('order_down_1');take('reorder',day1_value)
    receive('/stage/order_state',day1['id'],day1_value)
    d.press('order_back');d.press('variant_2');assert d.read('brand')==day2['title']
    for slot,index in enumerate(day2_default[:7],1):assert d.read('act_'+str(slot)+'_label')==str(slot)+'  '+titles[index-1]
    d.press('open_order');d.press('order_down_2');take('reorder',day2_value)
    receive('/stage/order_state',day2['id'],day2_value)
    d.press('order_back');d.press('variant_1')
    assert d.read('act_1_label')=='1  '+day1['acts'][1]['title'] and d.read('act_2_label')=='2  '+day1['acts'][0]['title']
    # Re-selecting DFS keeps the chosen day; C'2 hides the day buttons.
    d.press('open_shows');d.press('show_3');assert d.read('brand')==day1['title']
    d.press('open_shows');d.press('show_1');d.press('open_acts');assert not d.controls['variant_1'].visible
    d=DemoRuntime(HERE/'Stage-control.xml');d.lua.globals().sendOSC=lambda m,c:sends.append((m,c));sends.clear()
    open_acts(3);d.press('open_order');d.press('order_down_1');take('reorder',day1_value)
    b.render('main',HERE/'order-preview.png',state=d.snapshot())
    # Receiver-side unified order across three pages remains supported for the launcher profile.
    unified=next(s for s in data['shows'] if s['id']=='unified')
    unified_order=list(range(1,20));unified_order[7:9]=[9,8]
    unified_value=','.join(map(str,unified_order))
    for button in b.buttons:
        x,y,w,h=button['rect'];assert w>=44 and h>=44 and 0<=x and x+w<=420 and y+h<=858
    # Import the unchanged receiver logic with just its host API substituted.
    class Base:
        def __init__(self,song):self.fake_song=song;self.deferred=[]
        def song(self):return self.fake_song
        def schedule_message(self,t,callback):
            if callback.__name__!='_tick':self.deferred.append(callback)
        def log_message(self,*args):pass
        def disconnect(self):pass
    sys.modules['_Framework']=types.ModuleType('_Framework');module=types.ModuleType('_Framework.ControlSurface');module.ControlSurface=Base;sys.modules['_Framework.ControlSurface']=module
    with tempfile.TemporaryDirectory(prefix='show-control-') as temp:
        folder=pathlib.Path(temp);shutil.copy(HERE/'profiles.json',folder/'profiles.json');shutil.copy(HERE/'StageShowControl/__init__.py',folder/'__init__.py')
        spec=importlib.util.spec_from_file_location('TestStageShowControl',folder/'__init__.py');receiver=importlib.util.module_from_spec(spec);spec.loader.exec_module(receiver)
        receiver.PORT=0  # Never bind the production receiver's UDP port in tests.
        class Song:
            is_playing=False;current_song_time=0.;tempo=120.;signature_numerator=4;signature_denominator=4;metronome=False;starts=0;continues=0
            def start_playing(self):self.is_playing=True;self.starts+=1
            def continue_playing(self):self.is_playing=True;self.continues+=1
            def stop_playing(self):self.is_playing=False
        song=Song()
        class Cue:
            def __init__(self,name,time):self.name=name;self.time=time
            def jump(self):song.current_song_time=self.time
        panel=receiver.StageShowControl(song);client=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);client.bind(('127.0.0.1',0));client.settimeout(1);request=0
        # Without a saved order the receiver uses the day-2 setlist; day 1 uses locator order.
        assert panel._orders['unified-dfs-day2']==day2_default and panel._orders['unified-dfs-day1']==list(range(1,n+1))
        def pump():
            # UDP delivery can lag sendto even on loopback. Wait for readiness
            # before running the receiver tick, as the real host does repeatedly.
            assert select.select([panel._udp],[],[],1)[0], "Isolated UDP delivery timed out"
            panel._receive()
        def load_show(show):
            song.is_playing=False;song.cue_points=[Cue(a[key],a[beat]) for a in show['acts'] for key,beat in [('start_locator','start'),('end_locator','end')]]
            song.cue_points += [Cue(c['name'],c['beat']) for a in show['acts'] for c in a['cues']]
            client.sendto(receiver.packet('/stage/hello',client.getsockname()[1],show['id']),('127.0.0.1',panel._udp.getsockname()[1]));pump()
        def command(action,value='',deferred=True):
            nonlocal request
            request+=1;client.sendto(receiver.packet('/stage/control',request,action,value),('127.0.0.1',panel._udp.getsockname()[1]));pump()
            if deferred:
                pending,panel.deferred=panel.deferred,[]
                for callback in pending:callback()
            return request
        def ack(id):
            while True:
                address,args=receiver.decode(client.recv(8192))
                if address=='/stage/ack' and args[0]==id:return args
        sequences=0
        try:
            for show in data['shows']:
                load_show(show)
                for act in show['acts']:
                    assert ack(command('locate',act['start_locator']))[1]==1
                    assert not song.is_playing and song.current_song_time==act['start']
                    assert ack(command('resume'))[1]==1 and song.is_playing
                    assert ack(command('stop'))[1]==1 and not song.is_playing
                    position=song.current_song_time;assert ack(command('stop'))[1]==1 and song.current_song_time==position
                    sequences+=1
                # Exercise internal song cues through the real receiver logic,
                # including a seek during playback and resume from that cue.
                for act in show['acts']:
                    for cue in act['cues']:
                        song.is_playing=True
                        assert ack(command('locate',cue['name']))[1]==1
                        assert not song.is_playing and song.current_song_time==cue['beat']
                        assert ack(command('resume'))[1]==1 and song.is_playing
                        assert song.current_song_time==cue['beat']
                        assert ack(command('stop'))[1]==1 and not song.is_playing
            c2=data['shows'][0];load_show(c2)
            observer=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);observer.bind(('127.0.0.1',0));observer.settimeout(1)
            prior_peer,prior_profile=panel._peer,panel._profile
            observer.sendto(receiver.packet('/stage/health_probe',714,'c2'),('127.0.0.1',panel._udp.getsockname()[1]));pump()
            address,args=receiver.decode(observer.recv(8192));observer.close()
            assert address=='/stage/health' and args==[714,1,'c2','']
            assert panel._peer==prior_peer and panel._profile==prior_profile
            assert ack(command('reorder','2,1,3,4,5,6,7'))[1]==1
            song.current_song_time=c2['acts'][1]['end']
            assert ack(command('resume'))[1]==1 and song.current_song_time==c2['acts'][0]['start'] and song.is_playing
            assert ack(command('reorder','1,2,3,4,5,6,7'))[1]==0
            song.is_playing=False;song.current_song_time=c2['acts'][1]['end']
            pending=command('resume',deferred=False)
            assert ack(command('stop'))[1]==1
            assert ack(pending)[1]==0 and not song.is_playing
            # Select RUMY while a C2 set is loaded: playback must be rejected.
            client.sendto(receiver.packet('/stage/hello',client.getsockname()[1],'rumy'),('127.0.0.1',panel._udp.getsockname()[1]));pump()
            assert ack(command('resume'))[1]==0 and not song.is_playing
            load_show(unified)
            assert ack(command('reorder',unified_value))[1]==1
            song.current_song_time=unified['acts'][6]['end']
            assert ack(command('resume'))[1]==1 and song.current_song_time==unified['acts'][8]['start']
            song.is_playing=False
            observer=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);observer.bind(('127.0.0.1',0));observer.settimeout(1)
            prior_peer,prior_profile=panel._peer,panel._profile
            observer.sendto(receiver.packet('/stage/health_probe',715,'unified'),('127.0.0.1',panel._udp.getsockname()[1]));pump()
            address,args=receiver.decode(observer.recv(8192));observer.close()
            assert address=='/stage/health' and args==[715,1,'unified','']
            assert panel._peer==prior_peer and panel._profile==prior_profile
            # Each DFS day is its own profile: orders are saved separately.
            load_show(day1);assert ack(command('reorder',day1_value))[1]==1
            load_show(day2);assert ack(command('reorder',day2_value))[1]==1
            # After OP, day 2 advances to the act saved in slot 2, not the next locator.
            song.current_song_time=day2['acts'][0]['end']
            assert ack(command('resume'))[1]==1 and song.current_song_time==day2['acts'][day2_order[1]-1]['start']
            song.is_playing=False
            # The C'2 view must not reach DFS locators.
            load_show(panel_shows[0]);assert ack(command('locate',day1['acts'][0]['start_locator']))[1]==0
            panel.disconnect();panel=receiver.StageShowControl(song);assert panel._orders['c2']==[2,1,3,4,5,6,7]
            assert panel._orders['unified']==unified_order
            assert panel._orders[day1['id']]==[int(x) for x in day1_value.split(',')]
            assert panel._orders[day2['id']]==[int(x) for x in day2_value.split(',')]
        finally:panel.disconnect();client.close()
    report={'success':True,'shows':len(data['shows']),'performances':sum(len(s['acts']) for s in data['shows']),'locator_targets':targets,'buttons':len(b.buttons),'lua_tested':True,'isolated_udp_tested':True,'transport_sequences':sequences,'persistent_order':True,'unified_dfs_order_and_advance':True,'panel_groups':[g['title'] for g in groups],'dfs_day_orders_independent':True,'dfs_day2_default_setlist':[titles[i-1] for i in day2_default],'c2_view_rejects_dfs_locators':True,'unified_read_only_health':True,'stop_cancels_pending_advance':True,'wrong_show_rejected':True,'read_only_health_keeps_phone_peer':True,'native_live_tested':False}
    (HERE/'control-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
if __name__=='__main__':main()
