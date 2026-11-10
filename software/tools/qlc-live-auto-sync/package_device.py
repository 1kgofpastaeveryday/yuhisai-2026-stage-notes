"""Bundle the device, adjacent runtime and third-party licenses."""
from pathlib import Path
import zipfile
HERE = Path(__file__).resolve().parent
PROJECT = HERE
output = PROJECT / '261009-QLC-Live-Auto-Sync.zip'
names = ['QLC Live Auto Sync.amxd', 'qlc-live.js', 'qlc-watch.js', 'midi-router.js', 'page-scope.js', 'note-layout.js', 'source.js',
         'page-registry.js', 'test-page-channels.js', 'test-page-shared-rows.js', 'migrate-page-channels.py', 'web-bridge.js', 'scene-color.js', 'scene-brightness.js', 'test-scene-brightness.js', 'export-midi.js', 'config.json', 'package.json', 'package-lock.json',
         'test.js', 'test-max.js', 'test-auto-layout.js', 'test-pages.js', 'test-debug.js', 'test-cc.js', 'test-scene-color.js', 'build_device.py', 'package_device.py',
         'verify-note-layout.py', 'verify-artifacts.py', 'Open QLC Live Sync.command', 'test-real-mac.js']
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for name in names:
        archive.write(HERE / name, 'QLC Live Auto Sync/' + name)
    archive.write(HERE / 'scene-fade.js', 'QLC Live Auto Sync/scene-fade.js')
    archive.write(HERE / 'test-scene-fade.js', 'QLC Live Auto Sync/test-scene-fade.js')
    for file in (HERE / 'test-fixtures').rglob('*'):
        if file.is_file():
            archive.write(file, 'QLC Live Auto Sync/' + file.relative_to(HERE).as_posix())
    for file in (HERE / 'assets').rglob('*'):
        if file.is_file():
            archive.write(file, 'QLC Live Auto Sync/' + file.relative_to(HERE).as_posix())
    for file in (HERE / 'node_modules').rglob('*'):
        if file.is_file():
            archive.write(file, 'QLC Live Auto Sync/' + file.relative_to(HERE).as_posix())
    archive.write(PROJECT / '261009-QLC-Live-Auto-Labels.adg', 'QLC Live Auto Sync/261009-QLC-Live-Auto-Labels.adg')
    guide = HERE / 'README.md'
    if guide.exists(): archive.write(guide, 'QLC Live Auto Sync/README.md')
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    for dep in ['@xmldom/xmldom', 'ws']:
        assert 'QLC Live Auto Sync/node_modules/' + dep + '/LICENSE' in archive.namelist()
print(f'Bundled {output.name}: {output.stat().st_size} bytes, both dependency licenses included.')
