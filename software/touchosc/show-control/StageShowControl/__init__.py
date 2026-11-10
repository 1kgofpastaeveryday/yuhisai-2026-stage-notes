"""Profile-checked TouchOSC control for C2, RUMY and DFS; Live main thread only."""
import json,os,pathlib,socket,struct,time
from _Framework.ControlSurface import ControlSurface

PORT=8001
QLC_PORT=8002

def osc_string(s):
    data=s.encode('utf8')+b'\0';return data+b'\0'*(-len(data)%4)

def packet(address,*args):
    tags=',';data=b''
    for a in args:
        if isinstance(a,str):tags+='s';data+=osc_string(a)
        elif isinstance(a,int):tags+='i';data+=struct.pack('>i',a)
        else:tags+='f';data+=struct.pack('>f',a)
    return osc_string(address)+osc_string(tags)+data

def decode(data):
    offset=0
    def string():
        nonlocal offset
        end=data.index(b'\0',offset);s=data[offset:end].decode('utf8');offset=(end+4)&~3;return s
    address,tags=string(),string()
    if not tags.startswith(','):raise ValueError('OSC tags')
    args=[]
    for tag in tags[1:]:
        if tag=='s':args.append(string())
        elif tag in ('i','f'):args.append(struct.unpack_from('>'+tag,data,offset)[0]);offset+=4
        else:raise ValueError('OSC type')
    if offset!=len(data):raise ValueError('OSC size')
    return address,args

def acts_for_song(profile,song):
    if profile['issues']:raise ValueError('停止点未設定')
    points={cue.name:cue for cue in song.cue_points};acts=[]
    for act in profile['acts']:
        start=points.get(act['start_locator']);end=points.get(act['end_locator'])
        if start is None or end is None or end.time<=start.time:raise ValueError('セット不一致')
        acts.append((act['title'],float(start.time),float(end.time)))
    return sorted(acts,key=lambda a:a[1])

def create_instance(c_instance):return StageShowControl(c_instance)

class StageShowControl(ControlSurface):
    def __init__(self,c_instance):
        super(StageShowControl,self).__init__(c_instance)
        profiles=json.loads(pathlib.Path(__file__).with_name('profiles.json').read_text(encoding='utf8'))
        self._profiles={s['id']:s for s in profiles['shows']}
        self._order_file=pathlib.Path(__file__).with_name('order.json')
        saved=json.loads(self._order_file.read_text(encoding='utf8')) if self._order_file.exists() else {}
        self._orders={}
        for key,profile in self._profiles.items():
            names=[a['start_locator'] for a in profile['acts']];prior=saved.get(key,profile.get('default_order',names))
            self._orders[key]=[names.index(n)+1 for n in prior] if sorted(prior)==sorted(names) else list(range(1,len(names)+1))
        self._udp=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);self._udp.bind(('',PORT));self._udp.setblocking(False)
        self._peer=None;self._profile=None;self._peer_seen=0.;self._prepared=None;self._pending={};self._seq=0;self._running=True;self._play_generation=0
        self.schedule_message(1,self._tick);self.log_message('StageShowControl ready on UDP 8001')
    def disconnect(self):
        self._running=False;self._udp.close();super(StageShowControl,self).disconnect()
    def _send(self,address,*args):
        if self._peer:self._udp.sendto(packet(address,*args),self._peer)
    def _control(self,action,value):
        song=self.song();profile=self._profiles[self._profile]
        if action=='reorder':
            if song.is_playing:raise ValueError('曲順は停止中に変更してください')
            order=[int(x) for x in value.split(',')]
            if sorted(order)!=list(range(1,len(profile['acts'])+1)):raise ValueError('Invalid order')
            updated=dict(self._orders);updated[self._profile]=order
            stored={key:[self._profiles[key]['acts'][i-1]['start_locator'] for i in indices] for key,indices in updated.items()}
            temporary=self._order_file.with_suffix('.json.tmp')
            with temporary.open('w',encoding='utf8') as f:
                json.dump(stored,f,ensure_ascii=False,indent=2);f.flush();os.fsync(f.fileno())
            os.replace(str(temporary),str(self._order_file));self._orders=updated
            return
        acts_for_song(profile,song)
        if action=='resume':
            if not song.is_playing:
                prepared=self._prepared;self._prepared=None
                if prepared is not None and abs(float(song.current_song_time)-prepared)<.0001:song.start_playing()
                else:song.continue_playing()
        elif action=='stop':
            self._play_generation+=1
            if song.is_playing:song.stop_playing()
        elif action=='metronome':
            if value not in ('on','off'):raise ValueError('Metronome value')
            song.metronome=value=='on'
        elif action=='locate':
            self._play_generation+=1
            allowed={a['start_locator'] for a in profile['acts']}|{c['name'] for a in profile['acts'] for c in a['cues']}
            if value not in allowed:raise ValueError('区間未設定')
            if song.is_playing:song.stop_playing()
            cue=next((c for c in song.cue_points if c.name==value),None)
            if cue is None:raise ValueError('区間未設定')
            cue.jump();self._prepared=float(cue.time)
        else:raise ValueError('Unknown action')
    def _advance(self,request):
        song=self.song();profile=self._profiles[self._profile];acts=acts_for_song(profile,song)
        if song.is_playing:raise ValueError('再生中です')
        position=float(song.current_song_time);current=acts[0]
        for a in acts:
            if a[1]>position:break
            current=a
        if position<current[2]-.0001:raise ValueError('停止点に到達していません')
        index=next(i+1 for i,a in enumerate(profile['acts']) if a['title']==current[0])
        order=self._orders[self._profile];slot=order.index(index)+1
        if slot>=len(order):raise ValueError('セット終了')
        target=profile['acts'][order[slot]-1]['start_locator']
        self._control('locate',target)
        generation=self._play_generation;selected=self._profile;peer=self._peer
        def play():
            try:
                if generation!=self._play_generation or selected!=self._profile or peer!=self._peer:raise ValueError('操作をキャンセルしました')
                acts_for_song(self._profiles[selected],self.song())
                if not self.song().is_playing:self._control('resume','')
                self._send('/stage/ack',request,1,'')
            except Exception as e:self._send('/stage/ack',request,0,str(e))
        self.schedule_message(1,play)
    def _at_end(self):
        song=self.song()
        if song.is_playing:return False
        acts=acts_for_song(self._profiles[self._profile],song);position=float(song.current_song_time);current=acts[0]
        for a in acts:
            if a[1]>position:break
            current=a
        return position>=current[2]-.0001
    def _receive(self):
        for _ in range(32):
            try:data,source=self._udp.recvfrom(8192)
            except BlockingIOError:break
            try:
                address,args=decode(data)
                if address=='/stage/health_probe' and len(args)==2 and source[0]=='127.0.0.1':
                    nonce,profile=args
                    try:
                        acts_for_song(self._profiles[profile],self.song())
                        response=(nonce,1,profile,'')
                    except (ValueError,KeyError) as e:response=(nonce,0,profile,str(e))
                    self._udp.sendto(packet('/stage/health',*response),source)
                elif address=='/stage/hello' and len(args)==2:
                    port,profile=args
                    if not isinstance(port,int) or not 1024<=port<=65535 or profile not in self._profiles:continue
                    if self._profile!=profile:self._prepared=None;self._play_generation+=1
                    self._profile=profile;self._peer=(source[0],port);self._peer_seen=time.monotonic()
                elif address=='/stage/control' and len(args)==3:
                    if not self._peer or source[0]!=self._peer[0]:continue
                    request,action,value=args
                    if not isinstance(request,int) or not isinstance(action,str) or not isinstance(value,str):continue
                    if action=='qlc_stop':
                        self._pending[request]=time.monotonic()
                        self._udp.sendto(packet('/stage/qlc',request,action,value),('127.0.0.1',QLC_PORT))
                    else:
                        try:
                            if action=='advance' or (action=='resume' and self._at_end()):self._advance(request)
                            else:self._control(action,value);self._send('/stage/ack',request,1,'')
                        except Exception as e:self._send('/stage/ack',request,0,str(e))
                elif address=='/stage/qlc_ack' and source==('127.0.0.1',QLC_PORT) and len(args)==3 and args[0] in self._pending:
                    del self._pending[args[0]];self._send('/stage/ack',*args)
            except (ValueError,KeyError,TypeError,UnicodeError,struct.error):continue
        for request,began in list(self._pending.items()):
            if time.monotonic()-began>1.5:
                del self._pending[request];self._send('/stage/ack',request,0,'QLC+ unavailable')
    def _broadcast(self):
        if not self._peer or time.monotonic()-self._peer_seen>3:return
        self._send('/stage/order_state',self._profile,','.join(str(i) for i in self._orders[self._profile]))
        song=self.song()
        try:acts=acts_for_song(self._profiles[self._profile],song)
        except ValueError as e:self._send('/stage/error',str(e));return
        position=float(song.current_song_time);act=acts[0]
        for candidate in acts:
            if candidate[1]>position:break
            act=candidate
        self._seq+=1
        self._send('/stage/state',self._seq,position,int(song.is_playing),float(song.tempo),int(song.signature_numerator),int(song.signature_denominator),*act)
        self._send('/stage/panel',int(song.is_playing),int(song.metronome))
    def _tick(self):
        if not self._running:return
        try:self._receive();self._broadcast()
        except Exception as e:self.log_message('StageShowControl: '+str(e))
        finally:
            if self._running:self.schedule_message(1,self._tick)
