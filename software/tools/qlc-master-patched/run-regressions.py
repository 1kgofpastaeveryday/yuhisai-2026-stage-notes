from pathlib import Path
import ctypes
import json
import os
import psutil
import subprocess
import sys
import tempfile
import time

root = Path(__file__).parent
logs = root / 'tests'
logs.mkdir(exist_ok=True)
build = Path('<PATH>')
runtime = Path('<PATH>')
sdk = Path('<PATH>')
ctypes.windll.kernel32.SetErrorMode(0x8003)
env = os.environ.copy()
env.update(PATH=str(runtime)+';'+str(sdk/'bin')+';<PATH>'+env['PATH'], QT_PLUGIN_PATH=str(runtime), QML2_IMPORT_PATH=str(runtime/'qml'), QML_IMPORT_PATH=str(runtime/'qml'), QLC_NAME_SYNC_FIXTURE=str(root/'regression-fixture.qxw'))
env.pop('QLC_SCENE_UI_TEST',None)
env.pop('QLC_IDENTITY_NATIVE',None)
cases = [
 ('scene-focused','sceneeditor_test',['destroyedDelegate','replacementDelegate','rebuiltFixtureList','replacedSceneConsole'],False,None),
 ('scene-native-100','sceneeditor_test',['nativeEditorCycles'],True,'QLC_SCENE_UI_TEST'),
 ('identity-rename','function_identity_test',['duplicateNamesRenameAndDelete'],False,None),
 ('identity-delete','function_identity_test',['duplicateNamesDeleteSecond'],False,None),
 ('identity-native-50','function_identity_test',['nativeRepeatedDuplicateNames'],True,'QLC_IDENTITY_NATIVE'),
 ('local-features','local_features_test',[],True,None),
 ('save-native','save_regression_test',[],True,'QLC_SCENE_UI_TEST'),
]
if len(sys.argv)>1:
    selected=set(sys.argv[1:])
    cases=[case for case in cases if case[0] in selected]
    results=[r for r in json.loads((root/'regression-results.json').read_text()) if r['name'] not in selected]
else:
    results=[]
for name,target,tests,native,flag in cases:
    case_env = env.copy()
    case_env['QT_QPA_PLATFORM'] = 'windows' if native else 'offscreen'
    if not native:
        case_env['QT_PLUGIN_PATH'] = str(sdk/'plugins')
    if flag:
        case_env[flag]='1'
    log = logs/(name+'.txt')
    exe = build/'candidate-tests'/(target+'.exe')
    modules={}
    started=time.monotonic()
    with tempfile.TemporaryDirectory(prefix='qlc-master-patched-test-') as cwd, (logs/(name+'-stdout.txt')).open('wb') as out, (logs/(name+'-stderr.txt')).open('wb') as err:
        proc=subprocess.Popen([str(exe),*tests,'-o',str(log)+',txt','-maxwarnings','100000'],cwd=cwd,env=case_env,stdout=out,stderr=err,creationflags=subprocess.CREATE_NO_WINDOW)
        monitored=psutil.Process(proc.pid)
        timeout=False
        while proc.poll() is None:
            if time.monotonic()-started>180:
                proc.kill();timeout=True;break
            if len(modules)<4:
                try:
                    for mapping in monitored.memory_maps():
                        path=Path(mapping.path)
                        if path.name.lower() in ('qt6core.dll','qt6qml.dll','qt6qmlmeta.dll','qlcplusengine.dll'):
                            modules[path.name]=str(path)
                except (psutil.Error,OSError):
                    pass
            time.sleep(.1)
        code=proc.wait()
    text=log.read_text(encoding='utf-8',errors='replace') if log.exists() else ''
    result={'name':name,'exit_code':hex(code&0xffffffff),'timeout':timeout,'seconds':round(time.monotonic()-started,3),'summary':[line for line in text.splitlines() if line.startswith(('Totals:','FAIL!','PASS ','SKIP','QFATAL'))],'loaded_modules':modules}
    results.append(result)
    (root/'regression-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(result),flush=True)
print('Regression cases complete.',flush=True)
