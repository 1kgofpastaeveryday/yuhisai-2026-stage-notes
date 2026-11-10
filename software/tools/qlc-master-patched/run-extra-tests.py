from pathlib import Path
import ctypes
import json
import os
import subprocess
import sys
import tempfile

root=Path(__file__).parent
runtime=Path('<PATH>')
sdk=Path('<PATH>')
build=Path('<PATH>')
qt=Path('<PATH>')
ctypes.windll.kernel32.SetErrorMode(0x8003)
env=os.environ.copy()
env.update(PATH=str(runtime)+';'+str(sdk/'bin')+';'+env['PATH'],QT_QPA_PLATFORM='windows',QT_PLUGIN_PATH=str(runtime),QML2_IMPORT_PATH=str(runtime/'qml'))
cases=[]
for enabled in (False,True):
    case_env=env.copy()
    case_env['QLC_PAGE_ROUTING_FIXTURE']=str(root/('page-routing-on.qxw' if enabled else 'page-routing-off.qxw'))
    if enabled:
        case_env['QLC_PAGE_CHANNELS_TEST']='1'
    cases.append(('page-routing-'+('on' if enabled else 'off'),[str(build/'candidate-tests/page_routing_test.exe')],case_env,True))
for name,file in [('connections','tests/auto/qml/qqmlconnections/data/gcCollectedOwner.qml'),('list','tests/auto/qml/qqmlecmascript/data/gcCollectedListOwner.qml')]:
    cases.append(('qt-gc-'+name,[str(Path('<PATH>')),str(qt/file),str(runtime/'qml'),'1000'],env,False))
cases.append(('packaged-executable-help',[str(runtime/'qlcplus5.exe'),'--help'],env,False))
if len(sys.argv)>1:
    selected=set(sys.argv[1:])
    cases=[case for case in cases if case[0] in selected]
    results=[r for r in json.loads((root/'extra-results.json').read_text()) if r['name'] not in selected]
else:
    results=[]
for name,args,case_env,qttest in cases:
    log=root/'tests'/(name+'.txt')
    if qttest:
        args+=['-o',str(log)+',txt','-maxwarnings','100000']
    with tempfile.TemporaryDirectory(prefix='qlc-master-extra-') as cwd:
        r=subprocess.run(args,env=case_env,cwd=cwd,capture_output=True,timeout=90,creationflags=subprocess.CREATE_NO_WINDOW)
    if not qttest:
        log.write_bytes(r.stdout+r.stderr)
    else:
        (root/'tests'/(name+'-stderr.txt')).write_bytes(r.stderr)
    data=log.read_text(errors='replace') if log.exists() else ''
    entry={'name':name,'exit_code':hex(r.returncode&0xffffffff),'summary':[s for s in data.splitlines() if s.startswith(('Totals:','FAIL!','PASS ','SKIP','QFATAL'))]}
    results.append(entry)
    (root/'extra-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(entry),flush=True)
