from pathlib import Path
import datetime
import hashlib
import json
import re
import shutil
import subprocess
import zipfile

root=Path(__file__).parent
runtime=Path('<PATH>')
source=Path('<PATH>')
build=Path('<PATH>')
dest=Path('<PATH>')
toolkit=Path('<PATH>')
dest.mkdir(parents=True,exist_ok=True)
toolkit.mkdir(parents=True,exist_ok=True)
regressions=json.loads((root/'regression-results.json').read_text())
engine=json.loads((root/'engine-results.json').read_text())
extra=json.loads((root/'extra-results.json').read_text())
integration=json.loads((root/'integration-results.json').read_text())
assert len(regressions)==7 and all(r['exit_code']=='0x0' and not r['timeout'] for r in regressions)
assert len(engine)==16 and all(r['exit_code']=='0x0' for r in engine)
assert len(extra)==5 and all(r['exit_code']=='0x0' for r in extra)
assert integration['success'] and integration['hostExitCode']==0
gate=next(event for event in integration['events'] if event['kind']=='mismatch-gate')
assert gate['data']=='QLC+ project differs from saved source'
installed=json.loads((root/'installed-before.json').read_text())
assert all(hashlib.sha256((Path('<PATH>')/name).read_bytes()).hexdigest()==value for name,value in installed.items())
sha=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
patch=subprocess.check_output(['git','diff','HEAD','--binary','--','.',':(exclude)CMakeLists.txt'],cwd=source)
(root/'master-local.patch').write_bytes(patch)
(toolkit/'master-local.patch').write_bytes(patch)
# The validation helper is not part of the delivered application.
helper=runtime/'integration_host.exe'
if helper.exists():
    assert helper.resolve().parent==runtime.resolve()
    helper.unlink()
# Generated metadata must not contain hashes of its own previous revision.
files={p.relative_to(runtime).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in runtime.rglob('*') if p.is_file() and p not in (runtime/'BUILD-INFO.json',runtime/'README.txt')}
version=re.search(r'#define APPVERSION "([^"]+)"',(source/'engine/src/qlcconfig.h').read_text()).group(1)
summary={
 'created_at':datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
 'upstream_master':sha,'version':version,'source':str(source),'build':str(build),'runtime':str(runtime),
 'local_production_patch':'master-local.patch','patch_sha256':hashlib.sha256(patch).hexdigest(),
 'preserved':['same-name Function-tree identity removal','editor pointer teardown order','Function-to-button caption sync and undo/redo','global RGB, dimmer/RGB brightness and fade APIs','MIDIPageChannels','30-second periodic saves, atomic writes, 30 prior revisions','Qt6.10.2 QTBUG-148459 backport'],
 'already_upstream_not_reapplied':['Scene console lifetime management from 0eee616b5'],
 'rebuilt_io_plugins':11,'rebuilt_audio_plugins':1,
 'regressions':regressions,'engine_tests':engine,'extra_tests':extra,
 'integration':{key:value for key,value in integration.items() if key not in ('stderr','stdout')},
 'loaded_modules':'loaded-candidate-modules.json','installed_binaries_unchanged':installed,
 'not_verified':['full performance duration and real Ableton transport/seek integration','physical MIDI/DMX and hardware drivers','3D operation','Linux/macOS builds','entire upstream test suite'],
 'build_notes':['Fresh Windows MinGW/GCC13.1 Qt6.10.2 build; all frontend tests share the production frontend object files','Optional FFTW/OLA unavailable in this build; the existing patched engine also did not link FFTW','Nonfatal QML teardown warnings remain in native tests','Isolated App host uses temporary QSettings and an output-free frozen show; it runs the same frontend objects and packaged engine/Qt/plugins','One fixed-35ms readback assertion failed during an earlier soak. With bounded output polling and latency recording, 1345 cycles pass; observed command-to-readback p95 33ms, maximum 49ms. No production source change was needed for this test timing correction.'],
 'github_retest_reply':'https://github.com/mcallegari/qlcplus/issues/2199#issuecomment-6554791690',
 'runtime_files':files,
}
(root/'build-manifest.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
brief={key:value for key,value in summary.items() if key!='runtime_files'}
(runtime/'BUILD-INFO.json').write_text(json.dumps(brief,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
readme=f'''QLC+ 5 Master Patched candidate

Base: {sha}
Version string: {version}
Runtime: {runtime}

Start with Open QLC+5 Master Patched.lnk in project-files. This opens an empty
workspace with Web access enabled. Open the desired workspace from the app.
The existing QLC+5 (patched) installation and its shortcuts remain unchanged.
Close the other QLC instance before using the same Web port or physical outputs.

This candidate combines current master with the existing local Auto Sync,
Function-tree, caption and periodic-save changes. The Scene console lifetime
fix is supplied by master. Qt6Qml/Qt6QmlMeta retain the installed QTBUG-148459
backport. All 11 I/O plugins and the sndfile decoder were rebuilt for master's
updated plugin interface. Other bundled Qt/runtime dependencies were retained.

Verification: Scene lifetime 4 focused tests and 100 native cycles; same-name
rename/delete and 50 native cycles; color/fade/brightness/caption/undo/save;
30-second continuous-edit periodic save, backup retention/failure handling;
page-channel routing on/off; 16 upstream engine test targets; 10 Auto Sync JS
suites; both Qt GC reproductions at 1000 iterations; native WebBridge soak,
output readbacks, page actions, panic, and source mismatch gating.
See build-manifest.json and integration-results.json for exact counts.

Not covered: physical MIDI/DMX, full performance, real Ableton transport/seek,
3D, other platforms, or the entire upstream suite. Nonfatal QML teardown
warnings remain. Optional FFTW/OLA were unavailable (the existing patched
engine also did not link FFTW).

Rebuild on this PC:
1. Check out the base commit into the source directory above.
2. Apply master-local.patch. Scene lifetime files must remain upstream's.
3. The saved setup/build scripts use the Qt6.10.2/MinGW13.1 SDK in
   <PATH>
4. setup-build.py adds local CMake/test wiring; prepare-integration.py and
   setup-page-test.py add the two additional validation targets.
5. build.py builds the application, local tests and matching I/O/audio plugins.
   build-engine-tests.py builds the selected upstream engine test targets.

The source checkout, build tree, staged dependencies and all original evidence
remain under <PATH>
No deployment or file-association change was performed. The user authorized
the #2199 retest reply, posted at issuecomment-6554791690. The separate
same-name Function-tree issue is still a local draft.
'''
(runtime/'README.txt').write_text(readme,encoding='utf-8')
(toolkit/'README.txt').write_text(readme,encoding='utf-8')
for p in root.iterdir():
    if p.is_file() and p.suffix in ('.py','.cpp','.txt','.json','.log','.js','.patch'):
        shutil.copy2(p,dest/p.name)
        if p.suffix in ('.py','.cpp','.js') or p.name in ('CMakeLists.txt','dependencies.json','source-base.json','build-manifest.json'):
            shutil.copy2(p,toolkit/p.name)
shutil.copytree(root/'tests',dest/'tests',dirs_exist_ok=True)
archive=Path('<PATH>')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as z:
    for p in runtime.rglob('*'):
        if p.is_file():
            z.write(p,Path('QLCplus5-master-patched-20261101')/p.relative_to(runtime))
    z.write(root/'master-local.patch','source/master-local.patch')
    z.write(root/'build-manifest.json','source/build-manifest.json')
(dest/'archive.json').write_text(json.dumps({'archive':str(archive),'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest()},indent=2)+'\n')
print(json.dumps({'runtime':str(runtime),'archive':str(archive),'manifest':str(dest/'build-manifest.json'),'upstream_master':sha,'installed_unchanged':True},indent=2),flush=True)
