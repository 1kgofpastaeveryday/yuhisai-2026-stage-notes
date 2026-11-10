from pathlib import Path
import ctypes
import json
import os
import shutil
import subprocess

root=Path(__file__).parent
build=Path('<PATH>')
src=Path('<PATH>')
runtime=Path('<PATH>')
sdk=Path('<PATH>')
ctypes.windll.kernel32.SetErrorMode(0x8003)
for source,target in [('Fixtures','fixtures'),('RGBScripts','rgbscripts'),('InputProfiles','inputprofiles')]:
    shutil.copytree(runtime/source,build/'resources'/target,dirs_exist_ok=True)
for path in (src/'engine/test').rglob('*'):
    if path.is_file() and ('.xml' in path.name or path.suffix in ('.ts_','.qm')):
        dest=build/path.relative_to(src)
        dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copy2(path,dest)
env=os.environ.copy()
env.update(PATH=str(runtime)+';'+str(sdk/'bin')+';'+env['PATH'],QT_QPA_PLATFORM='offscreen',QT_PLUGIN_PATH=str(sdk/'plugins'),QML2_IMPORT_PATH=str(runtime/'qml'))
results=[]
for target in (root/'engine-test-targets.txt').read_text().splitlines():
    exe=next(build.rglob(target+'.exe'))
    log=root/'tests'/(target+'.txt')
    try:
        r=subprocess.run([str(exe),'-o',str(log)+',txt','-maxwarnings','100000'],cwd=exe.parent,env=env,capture_output=True,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
        (root/'tests'/(target+'-stderr.txt')).write_bytes(r.stderr)
        data=log.read_text(errors='replace') if log.exists() else ''
        entry={'target':target,'exit_code':hex(r.returncode&0xffffffff),'summary':[s for s in data.splitlines() if s.startswith(('Totals:','FAIL!','SKIP','QFATAL'))]}
    except subprocess.TimeoutExpired:
        entry={'target':target,'exit_code':'timeout'}
    results.append(entry)
    (root/'engine-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(entry),flush=True)
