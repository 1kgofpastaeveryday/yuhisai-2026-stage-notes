"""Compare MIDI notes in native Live saves before/after Tidy notes; no Live API or output."""
import argparse
from decimal import Decimal, InvalidOperation
import gzip
import json
from pathlib import Path
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('before', type=Path)
parser.add_argument('after', type=Path)
args = parser.parse_args()

def load(path):
    return ET.fromstring(gzip.decompress(path.read_bytes()).decode('utf8'))

def normalized(value):
    try:
        return Decimal(value)
    except InvalidOperation:
        return value

def notes(root):
    result = {}
    for clip in root.iter('MidiClip'):
        name = clip.find('Name').get('Value')
        assert name not in result, 'Use uniquely named proof clips'
        result[name] = {}
        for key in clip.findall('Notes/KeyTracks/KeyTrack'):
            for note in key.findall('Notes/MidiNoteEvent'):
                result[name][note.get('NoteId')] = (
                    int(key.find('MidiKey').get('Value')),
                    {k: normalized(v) for k, v in note.attrib.items()})
    return result

before, after = load(args.before), load(args.after)
blob = after.find('.//MxDeviceMidiEffect/BlobSlot/Value/MxDBlob/Blob')
state = json.loads(bytes.fromhex(blob.text).rstrip(b'\0'))
assert len(state['Note layout']) == 1 and state['Note layout'][0].startswith(('v1:', 'v2:'))
layout = [int(v) for v in state['Note layout'][0][3:].split('|')[0].split(',')]
assert sorted(layout) == list(range(128))
old, new = notes(before), notes(after)
assert old.keys() == new.keys()
count = 0
for name, entries in old.items():
    assert entries.keys() == new[name].keys(), 'Note IDs changed'
    for note_id, (pitch, metadata) in entries.items():
        actual_pitch, actual_metadata = new[name][note_id]
        assert actual_pitch == layout.index(pitch), 'Incorrect pitch migration'
        assert metadata == actual_metadata, 'Non-pitch note attributes changed'
        count += 1
assert count, 'No proof notes'
def event_tree(node):
    return (node.tag, node.attrib, (node.text or '').strip(), [event_tree(c) for c in node])
assert [event_tree(n) for n in before.iter('PerNoteEventStore')] == [
    event_tree(n) for n in after.iter('PerNoteEventStore')]
print(f'PASS: {count} notes in {len(old)} clips, saved128-pitch permutation, note IDs/attributes and per-note events preserved.')
