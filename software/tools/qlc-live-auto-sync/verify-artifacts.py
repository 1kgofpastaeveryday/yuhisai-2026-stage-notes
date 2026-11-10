"""Static package verification and evidence; no app launch or live lighting."""
from pathlib import Path
from datetime import datetime
import argparse
import gzip
import hashlib
import json
import struct
import xml.etree.ElementTree as ET
import zipfile
HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[1] / 'project-files'
INSTALLED = Path(r'<PATH>')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
workspace = Path(json.loads((HERE / 'config.json').read_text(encoding='utf8'))['defaultSource'])
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--expected-workspace-sha256', help='Verify the workspace against this review-specific hash.')
parser.add_argument('--report', type=Path, default=PROJECT / 'verification/current-artifacts-check.json')
parser.add_argument('--installed-dir', type=Path, default=INSTALLED, help='Runtime directory to compare; defaults to User Library. Use an isolated staging folder before deployment.')
args = parser.parse_args()
INSTALLED = args.installed_dir
if args.expected_workspace_sha256:
    assert sha(workspace) == args.expected_workspace_sha256, 'Workspace changed after review'
ET.parse(workspace)  # The editable show is not a frozen test fixture.
rack_file = PROJECT / '261009-QLC-Live-Auto-Labels.adg'
raw_rack = gzip.decompress(rack_file.read_bytes())
try:
    rack = ET.fromstring(raw_rack)
except ET.ParseError as e:
    print(repr(raw_rack.decode('utf8').splitlines()[e.position[0]-1]))
    raise
branches = rack.find('GroupDevicePreset/BranchPresets')
assert len(branches) == 128
for note, b in enumerate(branches):
    assert int(b.get('Id')) == note
    assert all(int(e.get('Value')) == note for e in b.find('ZoneSettings/KeyRange'))
    assert b.find('Name').get('Value') == '[empty N' + str(note) + ']'
assert rack.find('.//MidiEffectGroupDevice/On/Manual').get('Value') == 'false'
device = HERE / 'QLC Live Auto Sync.amxd'
binary = device.read_bytes()
assert struct.unpack('<I', binary[28:32])[0] == len(binary) - 32
patch = json.loads(binary[32:].rstrip(b'\0'))['patcher']
boxes = {e['box']['id']: e['box'] for e in patch['boxes']}
for name in ['Red', 'Green', 'Blue']:
    key = 'scene_' + name.lower()
    attrs = boxes[key]['saved_attribute_attributes']['valueof']
    assert patch['parameters'][key][0] == name
    assert attrs['parameter_type'] == 0 and attrs['parameter_mmin'] == 0 and attrs['parameter_mmax'] == 100
    assert attrs['parameter_modmode'] == 4 and attrs['parameter_modmin'] == 0 and attrs['parameter_modmax'] == 100
    assert attrs['parameter_unitstyle'] == 5
    assert boxes[key]['parameter_enable'] == 1
    assert any(e['patchline']['source'] == [key + '-msg', 0] and
               e['patchline']['destination'] == ['live-js', 0] for e in patch['lines'])
for key, name, index in [('fade_in', 'Fade In', 0), ('fade_out', 'Fade Out', 1)]:
    attrs = boxes[key]['saved_attribute_attributes']['valueof']
    assert patch['parameters'][key][0] == name
    assert attrs['parameter_type'] == 0 and attrs['parameter_mmin'] == 0 and attrs['parameter_mmax'] == 100
    assert attrs['parameter_modmode'] == 4 and attrs['parameter_modmin'] == 0 and attrs['parameter_modmax'] == 100
    assert attrs['parameter_unitstyle'] == 5
    assert boxes[key + '-msg']['text'] == 'prepend fade_parameter ' + str(index)
    assert any(e['patchline']['source'] == [key + '-msg', 0] and e['patchline']['destination'] == ['live-js', 0] for e in patch['lines'])
assert patch['parameters']['brightness_enabled'][0] == 'Brightness Override'
assert boxes['brightness_enabled']['saved_attribute_attributes']['valueof']['parameter_initial'] == [0]
attrs = boxes['brightness']['saved_attribute_attributes']['valueof']
assert attrs['parameter_initial'] == [100] and attrs['parameter_mmin'] == 0 and attrs['parameter_mmax'] == 100
assert attrs['parameter_modmode'] == 4 and attrs['parameter_unitstyle'] == 5
assert patch['parameters']['rgb_brightness_enabled'][0] == 'RGB Brightness Override'
assert boxes['rgb_brightness_enabled']['saved_attribute_attributes']['valueof']['parameter_initial'] == [0]
rgb_attrs = boxes['rgb_brightness']['saved_attribute_attributes']['valueof']
assert rgb_attrs['parameter_initial'] == [100] and rgb_attrs['parameter_mmin'] == 0 and rgb_attrs['parameter_mmax'] == 100
assert rgb_attrs['parameter_modmode'] == 4 and rgb_attrs['parameter_unitstyle'] == 5
for key in ['rgb_brightness', 'rgb_brightness_enabled']:
    assert any(e['patchline']['source'] == [key + '-msg',0] and e['patchline']['destination'] == ['live-js',0] for e in patch['lines'])
for key in ['brightness', 'brightness_enabled']:
    assert any(e['patchline']['source'] == [key + '-msg',0] and e['patchline']['destination'] == ['live-js',0] for e in patch['lines'])
assert patch['parameters']['fade_enabled'][0] == 'Fade Override' 
assert boxes['fade_enabled']['saved_attribute_attributes']['valueof']['parameter_initial'] == [0]
assert boxes['fade-enable-msg']['text'] == 'prepend fade_override'
for box in boxes.values():
    if box.get('presentation'):
        x,y,w,h = box['presentation_rect']
        assert x >= 0 and y >= 0 and x+w <= patch['devicewidth'] and y+h <= 169, box['id']
assert boxes['mode-menu']['saved_attribute_attributes']['valueof']['parameter_initial'] == [0]
assert boxes['page-menu']['saved_attribute_attributes']['valueof']['parameter_initial'] == [0]
assert len(boxes['page-menu']['saved_attribute_attributes']['valueof']['parameter_enum']) == 129
assert patch['parameters']['page-menu'][0] == 'Track page'
assert boxes['page-menu']['presentation_rect'][1] + boxes['page-menu']['presentation_rect'][3] <= 169
assert boxes['source-file']['varname'] == 'source_filename'
assert boxes['source-file']['presentation_rect'][1] + boxes['source-file']['presentation_rect'][3] <= 169
assert any(d['name'] == 'page-scope.js' for d in patch['dependency_cache'])
assert any(d['name'] == 'note-layout.js' for d in patch['dependency_cache'])
assert boxes['layout-state']['varname'] == 'note_layout'
assert boxes['layout-state']['restore'] == ['identity']
assert patch['parameters']['layout-state'][0] == 'Note layout'
assert boxes['tidy']['text'] == 'Tidy notes'
assert boxes['tidy']['presentation_rect'][1] + boxes['tidy']['presentation_rect'][3] <= 169
assert any(e['patchline']['source'] == ['tidy-msg',0] and
           e['patchline']['destination'] == ['live-js',0] for e in patch['lines'])
assert boxes['source-path']['saved_attribute_attributes']['valueof']['parameter_type'] == 3
assert boxes['source-path']['restore'] == [str(workspace).replace('\\', '/')]
assert '@autostart 0' in boxes['watch']['text']
archive_file = PROJECT / '261009-QLC-Live-Auto-Sync.zip'
runtime_hashes = {}
with zipfile.ZipFile(archive_file) as archive:
    assert archive.testzip() is None
    for name in archive.namelist():
        relative = name.removeprefix('QLC Live Auto Sync/')
        if relative == 'README.md': file = PROJECT / '261009-QLC-Live-Auto-Sync.md'
        elif relative == rack_file.name: file = rack_file
        else: file = HERE / relative
        assert hashlib.sha256(archive.read(name)).hexdigest() == sha(file), relative
        if relative.endswith(('.js','.json','.amxd','.adg')):
            assert (INSTALLED / relative).read_bytes() == file.read_bytes(), relative
            runtime_hashes[relative] = sha(file)
verification = {
    'updated_at': datetime.now().astimezone().isoformat(timespec='seconds'),
    'status': 'PASS',
    'verified_runtime_directory': str(INSTALLED),
    'verified_user_library': INSTALLED.resolve() == Path(r'<PATH>').resolve(),
    'production_workspace_sha256': sha(workspace),
    'package_sha256': sha(archive_file),
    'runtime_sha256': runtime_hashes
}
args.report.parent.mkdir(parents=True, exist_ok=True)
args.report.write_text(json.dumps(verification, ensure_ascii=False, indent=2)+'\n', encoding='utf8')
print('PASS: artifacts, package, selected runtime directory and workspace XML. Native evidence is recorded separately.')
