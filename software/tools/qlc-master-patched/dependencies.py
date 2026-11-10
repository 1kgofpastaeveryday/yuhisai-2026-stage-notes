from pathlib import Path
import hashlib
import json
import re
import subprocess
import urllib.request
import zipfile

root = Path(__file__).parent
deps = root / 'deps'
deps.mkdir(exist_ok=True)
packages = [
    ('mingw-w64-x86_64-libusb-1.0.30-1-any.pkg.tar.zst', '124edc26b009678a4c5e759481a364abf63ed7f2f49a53092e8bd0a47c0c0740'),
    ('mingw-w64-x86_64-libsndfile-1.2.2-1-any.pkg.tar.zst', '28f6a9be61c474fb96142be8426d551cec5f126b8a8b7ce2116379aa427e7dca'),
]
records = []
for name, expected in packages:
    archive = deps / name
    url = 'https://repo.msys2.org/mingw/mingw64/' + name
    if not archive.exists():
        urllib.request.urlretrieve(url, archive)
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    assert actual == expected, (name, actual)
    subprocess.run(['<PATH>', '-xf', str(archive), '-C', str(deps)], check=True)
    records.append({'url': url, 'sha256': actual})
    print(name, 'verified and extracted', flush=True)

pcdir = deps / 'mingw64/lib/pkgconfig'
for pc in pcdir.glob('*.pc'):
    text = pc.read_text()
    text = text.replace('/mingw64', (deps / 'mingw64').as_posix())
    text = re.sub(r'^prefix=.*$', 'prefix=' + (deps / 'mingw64').as_posix(), text, flags=re.M)
    # Only shared-library import libraries are used. No static codec linking.
    if pc.name == 'sndfile.pc':
        text = re.sub(r'^(Requires\.private|Libs\.private):.*$', r'\1:', text, flags=re.M)
    pc.write_text(text)

sdkroot = deps / 'D2XXSDK'
sdkroot.mkdir(exist_ok=True)
# The FTDI and QLC-hosted SDK archives reject automated requests. Use the
# unmodified vendor header distributed by the ftdi-rs FFI source repository.
repo = 'https://api.github.com/repos/ftdi-rs/libftd2xx-ffi'
info = json.load(urllib.request.urlopen(repo, timeout=30))
branch = info['default_branch']
tree = json.load(urllib.request.urlopen(repo + '/git/trees/' + branch + '?recursive=1', timeout=30))
headers = [entry for entry in tree['tree'] if entry['path'].lower().endswith('/ftd2xx.h') and 'windows' in entry['path'].lower()]
assert headers, [entry['path'] for entry in tree['tree'] if 'ftd2xx.h' in entry['path'].lower()]
entry = next((entry for entry in headers if 'x64' in entry['path'].lower()), headers[0])
url = 'https://raw.githubusercontent.com/ftdi-rs/libftd2xx-ffi/' + tree['sha'] + '/' + entry['path']
header = urllib.request.urlopen(url, timeout=30).read()
(sdkroot / 'ftd2xx.h').write_bytes(header)
# Match the exact DLL already used by the installed runtime.
objdump = '<PATH>'
exports = subprocess.check_output([objdump, '-p', '<PATH>'], text=True)
names = re.findall(r'^\s*\[\s*\d+\]\s+(FT_[A-Za-z0-9_]+)\s*$', exports, re.M)
assert len(names) > 50, len(names)
definition = deps / 'ftd2xx.def'
definition.write_text('LIBRARY ftd2xx64.dll\nEXPORTS\n' + '\n'.join(sorted(set(names))) + '\n')
amd64 = sdkroot / 'amd64'
amd64.mkdir(exist_ok=True)
subprocess.run(['<PATH>', '-m', 'i386:x86-64', '-k', '--input-def', str(definition), '--dllname', 'ftd2xx64.dll', '--output-lib', str(amd64 / 'libftd2xx.a')], check=True)
records.append({'url': url, 'sha256': hashlib.sha256(header).hexdigest(), 'sdk_root': str(sdkroot), 'import_library_dll': '<PATH>', 'exports': len(set(names))})
(root / 'dependencies.json').write_text(json.dumps(records, indent=2) + '\n')
print('FTDI SDK:', sdkroot, flush=True)
