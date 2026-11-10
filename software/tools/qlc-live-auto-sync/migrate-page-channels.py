"""Build a reviewable v2 registry from a saved Live set; never edits the show/set."""
from pathlib import Path
import argparse, gzip, json, subprocess, xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('workspace', type=Path)
parser.add_argument('live_set', type=Path)
parser.add_argument('output_map', type=Path)
parser.add_argument('--output-live', type=Path, required=True)
parser.add_argument('--align-page', action='append', default=[], help='TRACK=1-based-page; copied notes use the existing show layout')
args = parser.parse_args()
assert args.output_map.resolve() != Path(str(args.workspace) + '.live-map.json').resolve()
root = ET.fromstring(gzip.decompress(args.live_set.read_bytes()))
before = ET.fromstring(gzip.decompress(args.live_set.read_bytes()))
assert args.output_live.resolve() != args.live_set.resolve()
overrides = dict(item.rsplit('=', 1) for item in args.align_page)
layouts = []
devices = []
for track in root.findall('.//Tracks/MidiTrack'):
    for device in track.findall('.//MxDeviceMidiEffect'):
        blob = device.find('BlobSlot/Value/MxDBlob/Blob')
        if blob is None:
            continue
        try:
            state = json.loads(bytes.fromhex(blob.text).rstrip(b'\0'))
        except (ValueError, UnicodeError):
            continue
        if 'Note layout' not in state:
            continue
        source = Path(state.get('Source workspace', [''])[0])
        if source.resolve() != args.workspace.resolve():
            continue
        text = state['Note layout'][0]
        name = track.find('Name/EffectiveName').get('Value')
        layout = None if text == 'identity' else list(map(int, text[3:].split('|')[0].split(',')))
        if layout is not None:
            assert sorted(layout) == list(range(128))
        page = int(state.get('Track page', [0])[0]) - 1
        aligned = name in overrides
        if aligned:
            page = int(overrides[name]) - 1
        assert page >= 0, 'Choose a concrete Track page before migrating this track'
        used = {int(k.find('MidiKey').get('Value')) for k in track.findall('.//MidiClip/Notes/KeyTracks/KeyTrack')
                if k.findall('Notes/MidiNoteEvent')}
        layouts.append({'layout': layout, 'page': page, 'used': sorted(used), 'name':name, 'aligned':aligned})
        devices.append((track, blob, state))
assert layouts, 'No saved QLC Auto Sync layout found for this workspace'
canonical = next(x['layout'] for x in layouts if x['layout'] is not None)
for item in layouts:
    if item['layout'] is None:
        assert not item['used'] or item['aligned'], 'Uninitialized track has notes; specify an approved page alignment'
        item['layout'] = canonical
metadata = {'tracks': layouts, 'defaultLayout': canonical, 'defaultPage': layouts[0]['page']}
script = r"""
const fs=require('fs'),assert=require('assert'),path=require('path');
const source=require(path.join(process.argv[1],'source'));
const page=require(path.join(process.argv[1],'page-registry'));
const workspace=process.argv[2],output=process.argv[3],metadata=JSON.parse(process.argv[4]);
const controls=source.parseWorkspace(fs.readFileSync(workspace,'utf8'));
const previous=source.validateRegistry(JSON.parse(fs.readFileSync(workspace+'.live-map.json','utf8')));
assert.equal(previous.version,1,'Migration is only for legacy registries');
const groups=['Red Bottom','Blue Bottom','Blue Top','Red Top','Green Top','Green Bottom'];
const common=controls.filter(c=>c.valid&&c.type==='Button'&&/^(Red|Green|Blue) (Top|Bottom) 0[1-7]$/.test(c.name))
 .sort((a,b)=>groups.indexOf(a.name.slice(0,-3))-groups.indexOf(b.name.slice(0,-3))||a.name.localeCompare(b.name));
assert.equal(common.length,42,'Review the intended six RGB Singular groups');
assert.equal(new Set(common.map(c=>c.name)).size,42,'Ambiguous duplicated RGB names');
const old=new Map(previous.bindings.filter(b=>!b.retired).map(b=>[b.liveNote,b]));
const byId=new Map(controls.map(c=>[c.widgetId,c]));
const commonIds=new Set(common.map(c=>c.widgetId));
for(const t of metadata.tracks) for(const local of t.used) {
 const wire=t.layout[local],binding=old.get(wire);
 assert(binding,'A saved note references a deleted/unregistered target at N'+local);
 const control=byId.get(binding.widgetId);
 assert(binding.widgetId==='scene-color'||control,'A saved note references a deleted widget at N'+local);
 if(control&&!control.valid) console.error('Preserving inert/unconfigured saved target at N'+local+' ID'+binding.widgetId);
 assert(t.aligned||binding.widgetId==='scene-color'||control.type==='Page'||control.pageIndex===t.page,
  'A saved note currently points outside its Track page; review before migration');
}
const registry=page.migrate(controls,previous,metadata.defaultLayout,[...commonIds],metadata.defaultPage);
assert.equal(registry.deferred.length,0,'Not enough rows in one of the pages');
const pitchMaps=[];
for(const t of metadata.tracks) {
 const migration={};
 for(const local of t.used) {
  const original=old.get(t.layout[local]),control=byId.get(original.widgetId);
  const binding=registry.bindings.find(b=>!b.retired&&b.widgetId===original.widgetId);
  if(binding&&(binding.channel===0||binding.channel===t.page+1)) migration[local]=binding.liveNote;
  else {
   assert(t.aligned&&control&&!control.valid,'A copied note references another performance cue');
   const used=new Set(registry.bindings.filter(b=>b.channel===0||b.channel===t.page+1).map(b=>b.liveNote));
   const slot=Array.from({length:128},(_,i)=>127-i).find(n=>!used.has(n));assert(slot!==undefined);
   registry.bindings.push({widgetId:original.widgetId,channel:t.page+1,liveNote:slot,retired:true});
   migration[local]=slot;
  }
 }
 pitchMaps.push(migration);
}
page.validate(registry);
fs.writeFileSync(output,JSON.stringify(registry,null,2)+'\n');
console.log(JSON.stringify({status:'PASS',candidate:output,common:common.length,pitchMaps,
 pages:controls.filter(c=>c.type==='Page').length,bindings:registry.bindings.length,
 noteTargetsPreserved:true,retiredArchived:previous.bindings.filter(b=>b.retired).length,
 perPage:controls.filter(c=>c.type==='Page').map(c=>({page:c.pageIndex+1,name:c.pageCaption,
 midiChannel:c.pageIndex+2,own:registry.bindings.filter(b=>b.channel===c.pageIndex+1).length,
 shared:registry.bindings.filter(b=>b.channel===0).length}))}));
"""
result = subprocess.run(['node', '-e', script, str(Path(__file__).resolve().parent),
                str(args.workspace.resolve()), str(args.output_map.resolve()), json.dumps(metadata)], check=True, capture_output=True, text=True, encoding='utf8')
report = json.loads(result.stdout)
registry = json.loads(args.output_map.read_text())
for (track, blob, state), info, migration in zip(devices, layouts, report['pitchMaps']):
    for key in track.findall('.//MidiClip/Notes/KeyTracks/KeyTrack'):
        if key.findall('Notes/MidiNoteEvent'):
            pitch = key.find('MidiKey')
            pitch.set('Value', str(migration[pitch.get('Value')]))
    state['Track page'] = [info['page'] + 1]
    state['Note layout'] = ['v2:' + ','.join(map(str,range(128))) + '|' + ','.join(map(str,range(128)))]
    blob.text = json.dumps(state,ensure_ascii=False,separators=(',',':')).encode('utf8').hex().upper()
def structure(node):
    return (node.tag,dict(node.attrib),(node.text or '').strip(),[structure(c) for c in node])
assert len(before.findall('.//MidiNoteEvent')) == len(root.findall('.//MidiNoteEvent'))
assert [structure(n) for n in before.findall('.//MidiNoteEvent')] == [structure(n) for n in root.findall('.//MidiNoteEvent')]
for tag in ['AudioClip','Envelopes','PerNoteEventStore']:
    assert [structure(n) for n in before.iter(tag)] == [structure(n) for n in root.iter(tag)], tag + ' changed'
args.output_live.write_bytes(gzip.compress(ET.tostring(root,encoding='utf-8',xml_declaration=True),mtime=0))
report.update(candidate_live=str(args.output_live),notes=len(root.findall('.//MidiNoteEvent')),audio_clips=len(root.findall('.//AudioClip')),note_attributes_and_automation_preserved=True)
print(json.dumps(report,ensure_ascii=True))
