"""Run from the local deployed folder; no GUI automation or automatic project switching."""
import argparse,json,os,pathlib,socket,struct,subprocess,sys,time,urllib.request
ROOT=pathlib.Path(__file__).resolve().parent

def run(args,**kw):return subprocess.run(args,capture_output=True,text=True,encoding='utf8',timeout=5,**kw)
def listening(port):
    try:
        with socket.create_connection(('127.0.0.1',port),timeout=.3):return True
    except OSError:return False
def process_running(name):
    if os.name=='nt':
        p=run(['powershell.exe','-NoProfile','-Command',f"@(Get-Process -Name '{name}' -ErrorAction SilentlyContinue).Count"])
        return p.stdout.strip()!='0'
    return run(['pgrep','-x',name]).returncode==0
def launch(args,env=None):
    logs=ROOT/'logs';logs.mkdir(exist_ok=True)
    stem=pathlib.Path(args[0]).stem
    with (logs/(stem+'.stdout.log')).open('ab') as out,(logs/(stem+'.stderr.log')).open('ab') as err:
        return subprocess.Popen(args,cwd=ROOT,env=env,stdout=out,stderr=err,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
def osc_string(s):
    b=s.encode()+b'\0';return b+b'\0'*(-len(b)%4)
def live_health(profile):
    packet=osc_string('/stage/health_probe')+osc_string(',is')+struct.pack('>i',7319)+osc_string(profile)
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as udp:
        udp.bind(('127.0.0.1',0));udp.settimeout(1)
        udp.sendto(packet,('127.0.0.1',8001))
        try:data,_=udp.recvfrom(8192)
        except OSError:return {'success':False,'error':'StageShowControl is not responding on UDP 8001'}
    offset=(data.index(b'\0')+4)&~3;offset=(data.index(b'\0',offset)+4)&~3
    nonce,ok=struct.unpack_from('>ii',data,offset)
    return {'success':nonce==7319 and ok==1,'error':'' if ok else 'Live set does not match the selected show'}

def adapter_health():
    data=osc_string('/stage/qlc_health')+osc_string(',i')+struct.pack('>i',7320)
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as udp:
        udp.bind(('127.0.0.1',0));udp.settimeout(.5);udp.sendto(data,('127.0.0.1',8002))
        try:reply,_=udp.recvfrom(1024)
        except OSError:return False
    expected=osc_string('/stage/qlc_health_ack')+osc_string(',ii')+struct.pack('>ii',7320,2)
    return reply==expected

def editor_health():
    try:
        body=json.dumps({'jsonrpc':'2.0','id':7319,'method':'tools/call','params':{'name':'get_document','arguments':{'depth':0}}}).encode()
        request=urllib.request.Request('http://127.0.0.1:13579/mcp',data=body,headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream'})
        with urllib.request.urlopen(request,timeout=1) as reply:text=reply.read().decode()
        if not text.lstrip().startswith('{'):text=next(line[5:] for line in text.splitlines() if line.startswith('data:'))
        result=json.loads(text)['result'];document=json.loads(''.join(c.get('text','') for c in result['content']))
        return pathlib.Path(document['file']).name=='Stage-control.tosc'
    except Exception:return False

def main():
    profiles=json.loads((ROOT/'profiles.json').read_text(encoding='utf8'))
    p=argparse.ArgumentParser();p.add_argument('action',choices=['check','start']);p.add_argument('show',choices=[s['id'] for s in profiles['shows']]);a=p.parse_args()
    deployment=json.loads((ROOT/'deployment.json').read_text(encoding='utf8'))
    profile=next(s for s in profiles['shows'] if s['id']==a.show)
    node=deployment['node'];env=os.environ.copy()
    if deployment.get('qlc_runtime'):env['PATH']=deployment['qlc_runtime']+os.pathsep+env['PATH']
    if a.action=='start':
        if not listening(9999):
            if process_running('qlcplus5') or process_running('qlcplus5-webapi'):
                raise RuntimeError('QLC+ is running without a working Web API; save/close it before starting the host. A second output instance was not launched.')
            launch([deployment['qlc'],'--web','--web-port','9999','--open',str(pathlib.Path(deployment['stage_root'])/profile['qlc'])],env=env)
            deadline=time.monotonic()+15
            while not listening(9999) and time.monotonic()<deadline:time.sleep(.1)
        health=run([node,str(ROOT/'health.cjs'),a.show])
        if health.returncode:raise RuntimeError(health.stdout.strip() or health.stderr.strip())
        # A UDP bind check avoids starting duplicate middleware processes.
        with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as probe:
            try:probe.bind(('127.0.0.1',8002));available=True
            except OSError:available=False
        if available:launch([node,str(ROOT/'qlc.cjs')])
        if not listening(6666):
            launch([deployment['touchosc'],'--mcp.enabled=true','--editor.network.state=SERVER',str(ROOT/'Stage-control.tosc')])
    qlc=run([node,str(ROOT/'health.cjs'),a.show])
    try:qlc_result=json.loads(qlc.stdout)
    except ValueError:qlc_result={'success':False,'error':qlc.stderr.strip()}
    result={'show':a.show,'qlc':qlc_result,'live':live_health(a.show),'editor_server':listening(6666),'correct_editor_document':editor_health(),'qlc_adapter':adapter_health()}
    result['ready']=result['qlc'].get('success',False) and result['live']['success'] and result['editor_server'] and result['correct_editor_document'] and result['qlc_adapter']
    print(json.dumps(result,ensure_ascii=False,indent=2));return 0 if result['ready'] else 1
if __name__=='__main__':
    try:sys.exit(main())
    except Exception as e:print(json.dumps({'ready':False,'error':str(e)},ensure_ascii=False));sys.exit(1)
