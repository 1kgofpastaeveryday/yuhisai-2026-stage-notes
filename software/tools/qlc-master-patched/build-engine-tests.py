from pathlib import Path
import os
import subprocess

root=Path(__file__).parent
env=os.environ.copy()
env['PATH']='<PATH>'+env['PATH']
env['PKG_CONFIG_PATH']=str(root/'deps/mingw64/lib/pkgconfig')
env['MSYSTEM_CARCH']='x86_64'
targets=['scene_test','scenevalue_test','genericfader_test','function_test','rgbmatrix_test','chaserrunner_test','chaser_test','showrunner_test','show_test','sequence_test','cuestack_test','mastertimer_test','universe_test','fixture_test','rgbalgorithm_test','fadechannel_test']
(root/'engine-test-targets.txt').write_text('\n'.join(targets)+'\n')
with (root/'engine-tests-build.log').open('w') as log:
    r=subprocess.run(['<PATH>','--build','<PATH>','--target',*targets,'--parallel','8'],env=env,stdout=log,stderr=subprocess.STDOUT)
print('Engine test build:',r.returncode)
print((root/'engine-tests-build.log').read_text(errors='replace')[-2500:])
raise SystemExit(r.returncode)
