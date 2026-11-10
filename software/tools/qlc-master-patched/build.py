from pathlib import Path
import os
import subprocess
import sys

root = Path(__file__).parent
src = Path('<PATH>')
build = Path('<PATH>')
env = os.environ.copy()
env['PATH'] = ';'.join(['<PATH>', '<PATH>', '<PATH>', env['PATH']])
env['PKG_CONFIG_PATH'] = str(root / 'deps/mingw64/lib/pkgconfig')
env['MSYSTEM_CARCH'] = 'x86_64'
cmake = '<PATH>'
if '--build-only' not in sys.argv:
    with (root / 'configure.log').open('w') as log:
        r = subprocess.run([cmake, '-S', str(src), '-B', str(build), '-G', 'Ninja', '-Dqmlui=ON', '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_PREFIX_PATH=<PATH>', '-DPKG_CONFIG_EXECUTABLE=<PATH>'], env=env, stdout=log, stderr=subprocess.STDOUT)
    print('Configure:', r.returncode, flush=True)
    if r.returncode:
        print((root / 'configure.log').read_text(errors='replace')[-9000:])
        sys.exit(r.returncode)
targets = ['qlcplus5', 'sceneeditor_test', 'function_identity_test', 'local_features_test', 'save_regression_test', 'artnet', 'e131', 'loopback', 'osc', 'os2l', 'dmxusb', 'peperoni', 'udmx', 'midiplugin', 'enttecwing', 'hidplugin', 'sndfileplugin']
with (root / ('build-incremental.log' if '--build-only' in sys.argv else 'build.log')).open('w') as log:
    r = subprocess.run([cmake, '--build', str(build), '--target', *targets, '--parallel', '8'], env=env, stdout=log, stderr=subprocess.STDOUT)
print('Build:', r.returncode, flush=True)
print(log.name, flush=True)
print(Path(log.name).read_text(errors='replace')[-5000:])
sys.exit(r.returncode)
