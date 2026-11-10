from pathlib import Path
import hashlib
import json
import shutil
import xml.etree.ElementTree as ET

root = Path(__file__).parent
src = Path('<PATH>')
build = Path('<PATH>')
runtime = Path('<PATH>')
shutil.copytree('<PATH>', runtime, dirs_exist_ok=True,
                ignore=shutil.ignore_patterns('uninstall.exe','qlcplus5-before-*.exe'))
shutil.copy2(build / 'qmlui/qlcplus5.exe', runtime / 'qlcplus5.exe')
shutil.copy2(build / 'engine/src/qlcplusengine.dll', runtime / 'qlcplusengine.dll')
for translation in (build/'qmlui').glob('qlcplus_*.qm'):
    shutil.copy2(translation,runtime/translation.name)
plugins = list((build / 'plugins').rglob('*.dll'))
assert len(plugins) == 11, [str(p) for p in plugins]
for plugin in plugins:
    shutil.copy2(plugin, runtime / 'Plugins' / plugin.name)
shutil.copy2(build / 'engine/audio/plugins/sndfile/sndfileplugin.dll', runtime / 'Plugins/Audio/sndfileplugin.dll')
resource_dirs = {'fixtures':'Fixtures', 'gobos':'Gobos', 'inputprofiles':'InputProfiles', 'miditemplates':'MidiTemplates', 'modifierstemplates':'ModifiersTemplates', 'rgbscripts':'RGBScripts', 'colorfilters':'ColorFilters', 'meshes':'Meshes'}
for source, target in resource_dirs.items():
    shutil.copytree(src / 'resources' / source, runtime / target, dirs_exist_ok=True, ignore=shutil.ignore_patterns('CMakeLists.txt','scripts','*.cpp','*.h'))
# Keep the packaged Qt 6.10.2 and the existing QTBUG-148459 backport unchanged.
for name in ('Qt6Qml.dll', 'Qt6QmlMeta.dll'):
    assert (runtime / name).read_bytes() == (Path('<PATH>') / name).read_bytes()
testdir = build / 'candidate-tests'
for name in ('Fixtures','RGBScripts','InputProfiles','ModifiersTemplates','ColorFilters'):
    shutil.copytree(runtime / name, testdir / name, dirs_exist_ok=True)
# Frozen fixture for historical color/caption assertions; never use live show.
fixture = ET.parse('<PATH>')
ns = {'q': 'http://www.qlcplus.org/Workspace'}
ET.register_namespace('', ns['q'])
for parent in fixture.getroot().iter():
    for child in list(parent):
        if child.tag.rsplit('}',1)[-1] in ('Input','Output','Feedback','NetworkServer'):
            parent.remove(child)
(root / 'regression-fixture.qxw').write_bytes(b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Workspace>\n' + ET.tostring(fixture.getroot(), encoding='utf-8'))
assert not any(fixture.findall('.//q:'+tag, ns) for tag in ('Input','Output','Feedback','NetworkServer'))
paths = [runtime / 'qlcplus5.exe', runtime / 'qlcplusengine.dll', *plugins, runtime / 'Qt6Qml.dll', runtime / 'Qt6QmlMeta.dll']
(root / 'candidate-binaries.json').write_text(json.dumps({str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}, indent=2) + '\n')
print('Candidate staged:', runtime)
print('Rebuilt I/O plugins:', len(plugins))
