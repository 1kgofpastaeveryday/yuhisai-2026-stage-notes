from pathlib import Path
from copy import deepcopy
import gzip
import json
import struct
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parents[1] / 'project-files'
config = json.loads((HERE / 'config.json').read_text(encoding='utf8'))
# Every MIDI pitch has a fixed native key zone. New controls only change names.
rack = ET.fromstring(gzip.decompress((HERE / 'assets/label-rack-template.adg').read_bytes()))
group = rack.find('GroupDevicePreset')
device = group.find('Device/MidiEffectGroupDevice')
device.find('UserName').set('Value', config['rackName'])
device.find('Annotation').set('Value', 'QLC Live Auto Sync. Keep this label Rack bypassed; 128 fixed pitches.')
device.find('On/Manual').set('Value', 'false')
branches = group.find('BranchPresets')
template_branch = deepcopy(branches[0])
branches.clear()
for note in range(128):
    branch = deepcopy(template_branch)
    branch.set('Id', str(note))
    branch.find('Name').set('Value', '[empty N' + str(note) + ']')
    for key in branch.find('ZoneSettings/KeyRange'):
        key.set('Value', str(note))
    branches.append(branch)
ET.indent(rack, '\t')
(PROJECT / '261009-QLC-Live-Auto-Labels.adg').write_bytes(gzip.compress(ET.tostring(rack, encoding='utf-8', xml_declaration=True), mtime=0))

template = Path(r'<PATH>').read_bytes()
document = json.loads(template[32:].rstrip(b'\x00'))
p = document['patcher']
p.update(title='QLC Live Auto Sync', rect=[50, 50, 1370, 880], openrect=[0, 0, 1320, 169],
         openinpresentation=1, devicewidth=1320, default_fontname='Arial', default_fontsize=12)
p['boxes'] = []; p['lines'] = []
def box(id, cls, text, rect, ins=1, outs=1, presentation=None, **extra):
    b = dict(id=id, maxclass=cls, patching_rect=rect, numinlets=ins, numoutlets=outs, **extra)
    if text is not None: b['text'] = text
    if presentation is not None: b.update(presentation=1, presentation_rect=presentation)
    p['boxes'].append({'box': b})
def line(src, dst, out=0, inp=0):
    p['lines'].append({'patchline': {'source': [src, out], 'destination': [dst, inp]}})
box('midi-in', 'newobj', 'midiin', [25, 250, 50, 22])
box('live-js', 'newobj', 'js qlc-live.js', [25, 320, 110, 22], outs=5)
box('midi-out', 'newobj', 'midiout', [25, 400, 55, 22], outs=0)
box('watch', 'newobj', 'node.script qlc-watch.js @autostart 0 @defer 1', [260, 250, 345, 22], outs=2)
box('live-ready', 'newobj', 'live.thisdevice', [25, 100, 100, 22], outs=3)
box('ready-msg', 'message', 'live_ready', [25, 150, 90, 22])
box('heading', 'comment', 'QLC+ → Live / Auto-register VC controls', [20, 20, 500, 22], outs=0,
    presentation=[12, 8, 510, 22], fontsize=14, fontface=1)
box('status', 'comment', 'Starting QLC+ watcher...', [260, 350, 530, 36], outs=0,
    presentation=[12, 32, 510, 22], fontsize=12)
box('midi-status', 'comment', 'Output off', [260, 400, 530, 22], outs=0,
    presentation=[12, 56, 510, 20], fontsize=11)
box('hint', 'comment', 'QLC+でボタンを追加して保存すると、空きノートへ自動登録。', [20, 48, 600, 22], outs=0,
    presentation=[12, 94, 510, 22], fontsize=11)
box('source-file', 'comment', 'Source: (not selected)', [260, 560, 530, 22], outs=0,
    presentation=[12, 106, 510, 20], fontsize=11, varname='source_filename')
box('choose', 'textbutton', 'Choose .qxw', [260, 100, 110, 24], outs=3, presentation=[12, 128, 110, 26])
box('open', 'newobj', 'opendialog', [260, 150, 85, 22], outs=2)
box('source', 'newobj', 'prepend source', [260, 210, 110, 22])
box('source-path', 'newobj', 'pattr source_path', [260, 178, 150, 22], outs=3, varname='source_path',
    saved_object_attributes={'parameter_enable': 1, 'parameter_mappable': 0},
    restore=[config['defaultSource'].replace('\\', '/')], saved_attribute_attributes={'valueof': {
        'parameter_longname': 'Source workspace', 'parameter_shortname': 'Source', 'parameter_type': 3,
        'parameter_invisible': 1, 'parameter_initial_enable': 1,
        'parameter_initial': [config['defaultSource'].replace('\\', '/')]
    }})
box('refresh', 'message', 'refresh', [420, 150, 65, 22], presentation=[135, 130, 65, 22])
box('panic', 'message', 'panic', [500, 150, 60, 22], presentation=[214, 130, 60, 22])
box('mode-menu', 'live.menu', None, [610, 100, 130, 22], outs=3, presentation=[365, 128, 158, 26],
    varname='output_mode', parameter_enable=1, items=['Off', ',', 'Web API', ',', 'MIDI'],
    saved_attribute_attributes={'valueof': {'parameter_longname': 'Output mode', 'parameter_shortname': 'Output',
        'parameter_type': 2, 'parameter_enum': ['Off', 'Web API', 'MIDI'], 'parameter_initial_enable': 1, 'parameter_initial': [0]}})
box('mode', 'newobj', 'prepend mode', [610, 150, 100, 22])
box('mode-label', 'comment', 'Output', [610, 70, 90, 22], outs=0, presentation=[310, 131, 50, 22])
box('export-midi', 'textbutton', 'MIDI copy', [610, 195, 100, 24], outs=3, presentation=[12, 80, 80, 24])
box('export-msg', 'message', 'export_midi', [610, 225, 100, 22])
page_items = ['All pages'] + [f'Page {i}' for i in range(1, 129)]
box('page-label', 'comment', 'Track page', [610, 460, 90, 22], outs=0, presentation=[102, 82, 80, 22])
box('page-menu', 'live.menu', None, [610, 490, 130, 22], outs=3, presentation=[190, 80, 333, 24],
    varname='page_scope', parameter_enable=1,
    items=[item for i, title in enumerate(page_items) for item in ([',', title] if i else [title])],
    saved_attribute_attributes={'valueof': {'parameter_longname': 'Track page', 'parameter_shortname': 'Page',
        'parameter_type': 2, 'parameter_enum': page_items, 'parameter_invisible': 1,
        'parameter_initial_enable': 1, 'parameter_initial': [0]}})
box('page-msg', 'newobj', 'prepend page', [610, 530, 100, 22])
box('tidy', 'textbutton', 'Tidy notes', [20, 580, 90, 24], outs=3, presentation=[270, 80, 85, 24])
box('tidy-msg', 'message', 'tidy_notes', [20, 615, 90, 22])
box('layout-state', 'newobj', 'pattr note_layout', [120, 580, 150, 22], outs=3, varname='note_layout',
    saved_object_attributes={'parameter_enable': 1, 'parameter_mappable': 0}, restore=['identity'],
    saved_attribute_attributes={'valueof': {'parameter_longname': 'Note layout', 'parameter_shortname': 'Layout',
        'parameter_type': 3, 'parameter_invisible': 1, 'parameter_initial_enable': 1, 'parameter_initial': ['identity']}})
box('layout-msg', 'newobj', 'prepend layout_state', [120, 615, 150, 22])
for item in p['boxes']:
    if item['box']['id'] == 'page-menu': item['box']['presentation_rect'] = [190, 80, 333, 24]
    if item['box']['id'] == 'export-midi': item['box']['presentation_rect'] = [290, 128, 75, 26]
    if item['box']['id'] == 'tidy': item['box']['presentation_rect'] = [212, 128, 74, 26]
    if item['box']['id'] == 'panic': item['box']['presentation_rect'] = [160, 130, 48, 22]
    if item['box']['id'] == 'refresh': item['box']['presentation_rect'] = [112, 130, 45, 22]
    if item['box']['id'] == 'choose': item['box']['presentation_rect'] = [12, 128, 96, 26]
    if item['box']['id'] == 'mode-label': item['box']['presentation_rect'] = [368, 106, 80, 20]
    if item['box']['id'] == 'source-file': item['box']['presentation_rect'] = [12, 106, 350, 20]
p['boxes'] = [item for item in p['boxes'] if item['box']['id'] != 'hint']
for src, dst, out in [('midi-in','live-js',0),('live-js','midi-out',0),('live-js','status',1),
    ('live-js','midi-status',2),('watch','live-js',0),('live-ready','ready-msg',0),('ready-msg','live-js',0),
    ('choose','open',0),('open','source-path',0),('source-path','source',0),('source','live-js',0),
    ('live-js','source-path',3),('live-js','watch',4),('refresh','live-js',0),('panic','live-js',0),
    ('mode-menu','mode',0),('mode','live-js',0),('export-midi','export-msg',0),('export-msg','live-js',0),
    ('page-menu','page-msg',0),('page-msg','live-js',0),
    ('tidy','tidy-msg',0),('tidy-msg','live-js',0),('layout-state','layout-msg',0),('layout-msg','live-js',0)]: line(src,dst,out)
p['parameters'] = {'source-path': ['Source workspace','Source',0], 'mode-menu': ['Output mode','Output',0],
                   'page-menu': ['Track page','Page',0], 'layout-state': ['Note layout','Layout',0]}
box('color-heading', 'comment', 'Scene color / N0 hold', [760, 20, 180, 22], outs=0,
    presentation=[540, 8, 188, 22])
for i, name in enumerate(['Red', 'Green', 'Blue']):
    key = 'scene_' + name.lower()
    box(key, 'live.dial', None, [760 + i * 55, 60, 50, 70], outs=2,
        presentation=[544 + i * 62, 40, 54, 78], varname=key, parameter_enable=1,
        saved_attribute_attributes={'valueof': {'parameter_longname': name, 'parameter_shortname': name,
            'parameter_type': 0, 'parameter_mmin': 0, 'parameter_mmax': 100,
            'parameter_modmode': 4, 'parameter_modmin': 0, 'parameter_modmax': 100,
            'parameter_initial_enable': 1, 'parameter_initial': [100 if i == 2 else 0], 'parameter_unitstyle': 5}})
    box(key + '-msg', 'newobj', 'prepend scene_parameter ' + str(20 + i), [760, 650 + i * 28, 185, 22])
    line(key, key + '-msg'); line(key + '-msg', 'live-js')
    p['parameters'][key] = [name, name, 0]
box('color-hint', 'comment', 'Hold Color Override note\nto use RGB; release restores Scene.',
    [760, 160, 185, 42], outs=0, presentation=[540, 120, 188, 40], fontsize=10)
box('fade-heading', 'comment', 'Scene / Matrix fade', [950, 20, 200, 22], outs=0,
    presentation=[744, 8, 204, 22])
box('fade_enabled', 'live.toggle', None, [950, 50, 24, 24], outs=1,
    presentation=[744, 34, 22, 22], varname='fade_enabled', parameter_enable=1,
    saved_attribute_attributes={'valueof': {'parameter_longname': 'Fade Override', 'parameter_shortname': 'Fade',
        'parameter_type': 2, 'parameter_enum': ['Off', 'On'],
        'parameter_initial_enable': 1, 'parameter_initial': [0]}})
box('fade-enable-label', 'comment', 'Fade Override', [980, 50, 150, 22], outs=0,
    presentation=[772, 34, 176, 22])
box('fade-enable-msg', 'newobj', 'prepend fade_override', [950, 750, 175, 22])
line('fade_enabled', 'fade-enable-msg'); line('fade-enable-msg', 'live-js')
p['parameters']['fade_enabled'] = ['Fade Override', 'Fade', 0]
for i, name in enumerate(['Fade In', 'Fade Out']):
    key = ['fade_in', 'fade_out'][i]
    box(key, 'live.dial', None, [950 + i * 85, 90, 70, 78], outs=2,
        presentation=[758 + i * 92, 61, 78, 78], varname=key, parameter_enable=1,
        saved_attribute_attributes={'valueof': {'parameter_longname': name, 'parameter_shortname': name,
            'parameter_type': 0, 'parameter_mmin': 0, 'parameter_mmax': 100,
            'parameter_modmode': 4, 'parameter_modmin': 0, 'parameter_modmax': 100,
            'parameter_initial_enable': 1, 'parameter_initial': [0], 'parameter_unitstyle': 5}})
    box(key + '-msg', 'newobj', 'prepend fade_parameter ' + str(i), [950, 790 + i * 28, 190, 22])
    line(key, key + '-msg'); line(key + '-msg', 'live-js')
    p['parameters'][key] = [name, name, 0]
box('fade-hint', 'comment', '0-100% = 0-1000ms', [950, 180, 200, 22], outs=0,
    presentation=[744, 141, 204, 20], fontsize=11)
box('brightness-heading', 'comment', 'Brightness', [1160, 20, 170, 22], outs=0, presentation=[970, 8, 160, 22])
box('brightness_enabled', 'live.toggle', None, [1160, 50, 24, 24], presentation=[970, 34, 22, 22],
    varname='brightness_enabled', parameter_enable=1,
    saved_attribute_attributes={'valueof': {'parameter_longname': 'Brightness Override', 'parameter_shortname': 'Brightness On',
        'parameter_type': 2, 'parameter_enum': ['Off', 'On'], 'parameter_initial_enable': 1, 'parameter_initial': [0]}})
box('brightness-label', 'comment', 'Override', [1190, 50, 130, 22], outs=0, presentation=[998, 34, 130, 22])
box('brightness', 'live.dial', None, [1160, 90, 78, 78], outs=2, presentation=[1000, 61, 78, 78],
    varname='brightness', parameter_enable=1,
    saved_attribute_attributes={'valueof': {'parameter_longname': 'Brightness', 'parameter_shortname': 'Brightness',
        'parameter_type': 0, 'parameter_mmin': 0, 'parameter_mmax': 100, 'parameter_modmode': 4,
        'parameter_modmin': 0, 'parameter_modmax': 100, 'parameter_initial_enable': 1,
        'parameter_initial': [100], 'parameter_unitstyle': 5}})
for key, message in [('brightness_enabled', 'brightness_override'), ('brightness', 'brightness_parameter')]:
    box(key+'-msg', 'newobj', 'prepend '+message, [1160, 800 if key=='brightness' else 760, 200, 22])
    line(key, key+'-msg'); line(key+'-msg', 'live-js')
p['parameters']['brightness_enabled'] = ['Brightness Override', 'Brightness On', 0]
p['parameters']['brightness'] = ['Brightness', 'Brightness', 0]
box('brightness-hint', 'comment', '100% = full / Off = native', [1160, 180, 190, 22], outs=0, presentation=[970, 141, 166, 20], fontsize=10)
box('rgb-brightness-heading', 'comment', 'RGB brightness', [1380, 20, 180, 22], outs=0, presentation=[1150, 8, 166, 22])
box('rgb_brightness_enabled', 'live.toggle', None, [1380, 50, 24, 24], presentation=[1150, 34, 22, 22],
    varname='rgb_brightness_enabled', parameter_enable=1,
    saved_attribute_attributes={'valueof': {'parameter_longname': 'RGB Brightness Override', 'parameter_shortname': 'RGB Brightness On',
        'parameter_type': 2, 'parameter_enum': ['Off', 'On'], 'parameter_initial_enable': 1, 'parameter_initial': [0]}})
box('rgb-brightness-label', 'comment', 'Override', [1410, 50, 130, 22], outs=0, presentation=[1178, 34, 130, 22])
box('rgb_brightness', 'live.dial', None, [1380, 90, 78, 78], outs=2, presentation=[1180, 61, 78, 78],
    varname='rgb_brightness', parameter_enable=1,
    saved_attribute_attributes={'valueof': {'parameter_longname': 'RGB Brightness', 'parameter_shortname': 'RGB Brightness',
        'parameter_type': 0, 'parameter_mmin': 0, 'parameter_mmax': 100, 'parameter_modmode': 4,
        'parameter_modmin': 0, 'parameter_modmax': 100, 'parameter_initial_enable': 1,
        'parameter_initial': [100], 'parameter_unitstyle': 5}})
for key, message in [('rgb_brightness_enabled', 'rgb_brightness_override'), ('rgb_brightness', 'rgb_brightness_parameter')]:
    box(key+'-msg', 'newobj', 'prepend '+message, [1380, 800 if key=='rgb_brightness' else 760, 230, 22])
    line(key, key+'-msg'); line(key+'-msg', 'live-js')
p['parameters']['rgb_brightness_enabled'] = ['RGB Brightness Override', 'RGB Brightness On', 0]
p['parameters']['rgb_brightness'] = ['RGB Brightness', 'RGB Brightness', 0]
box('rgb-brightness-hint', 'comment', 'RGB only / Dimmer unchanged', [1380, 180, 200, 22], outs=0, presentation=[1150, 141, 166, 20], fontsize=10)
p['dependency_cache'] = [{'name': n,'bootpath':'.','patcherrelativepath':'.','type':'TEXT','implicit':1}
    for n in ['qlc-live.js','midi-router.js','page-scope.js','note-layout.js','qlc-watch.js']]
body = json.dumps(document, ensure_ascii=False, indent=2).encode('utf8') + b'\x00'
(HERE / 'QLC Live Auto Sync.amxd').write_bytes(template[:28] + struct.pack('<I', len(body)) + body)
print('Built automatic-registration device and 128-pitch label Rack.')
