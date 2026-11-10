"""Create disposable muted Live fixtures from canonical repository inputs."""
import gzip
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
CONTROL = HERE.parent
STAGE = CONTROL.parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def points(root):
    return [(p.find('Name').get('Value'), float(p.find('Time').get('Value')))
            for p in root.findall('LiveSet/Locators/Locators/Locator')]


def prepare():
    profiles = json.loads((CONTROL / 'profiles.json').read_text(encoding='utf8'))
    work = HERE / 'work'
    results = HERE / 'results'
    work.mkdir(exist_ok=True)
    results.mkdir(exist_ok=True)
    report = []
    for profile in profiles['shows']:
        source = STAGE / profile['live']
        before = sha(source)
        if before != profile['source_sha256']:
            raise ValueError('Source changed; regenerate profiles before validation: ' + profile['id'])
        root = ET.fromstring(gzip.decompress(source.read_bytes()))
        original_points = points(root)
        cue_map = dict(original_points)
        assert all(cue_map[a[key]] == a[beat] for a in profile['acts']
                   for key, beat in [('start_locator', 'start'), ('end_locator', 'end')])
        clips = list(root.iter('AudioClip')) + list(root.iter('MidiClip'))
        for clip in clips:
            clip.find('Disabled').set('Value', 'true')
        removed_devices = 0
        for devices in root.iter('Devices'):
            for device in list(devices):
                devices.remove(device)
                removed_devices += 1
        silence_targets = set()
        for mixer in root.iter('Mixer'):
            for key, value in [('Speaker', 'false'), ('Volume', '0')]:
                manual = mixer.find(key + '/Manual')
                if manual is not None:
                    manual.set('Value', value)
                target = mixer.find(key + '/AutomationTarget')
                if target is not None:
                    silence_targets.add(target.get('Id'))
        for envelopes in root.iter('Envelopes'):
            for envelope in list(envelopes):
                target = envelope.find('EnvelopeTarget/PointeeId')
                if target is not None and target.get('Value') in silence_targets:
                    envelopes.remove(envelope)
        for routing in root.iter('MidiOutputRouting'):
            for key, value in [('Target', 'MidiOut/None'), ('UpperDisplayString', 'None'), ('LowerDisplayString', '')]:
                routing.find(key).set('Value', value)
        for arm in root.findall('.//Arm/Manual'):
            arm.set('Value', 'false')
        transport = root.find('LiveSet/Transport')
        for key in ('LoopOn', 'Metronome'):
            node = transport.find(key) if transport is not None else None
            if node is not None:
                node.set('Value', 'false')
        destination = work / (profile['id'] + '-NATIVE-TEST-SILENT.als')
        destination.write_bytes(gzip.compress(ET.tostring(root, encoding='utf-8', xml_declaration=True), mtime=0))
        checked = ET.fromstring(gzip.decompress(destination.read_bytes()))
        assert points(checked) == original_points
        assert not checked.findall('.//Devices/*')
        assert all(c.find('Disabled').get('Value') == 'true'
                   for tag in ('AudioClip', 'MidiClip') for c in checked.iter(tag))
        assert all(r.find('Target').get('Value') == 'MidiOut/None' for r in checked.iter('MidiOutputRouting'))
        assert all(m.find('Speaker/Manual') is None or m.find('Speaker/Manual').get('Value') == 'false'
                   for m in checked.iter('Mixer'))
        assert all(m.find('Volume/Manual') is None or m.find('Volume/Manual').get('Value') == '0'
                   for m in checked.iter('Mixer'))
        assert sha(source) == before
        report.append(dict(show=profile['id'], source=profile['live'], source_sha256=before,
                           copy=destination.relative_to(CONTROL).as_posix(), copy_sha256=sha(destination),
                           clips_disabled=len(clips), devices_removed=removed_devices,
                           locators_preserved=True, source_unchanged=True, native_opened=False))
    (results / 'silent-copy-preparation.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'success': True, 'sets': len(report), 'clips_disabled': sum(r['clips_disabled'] for r in report),
                      'native_tested': False}))


if __name__ == '__main__':
    prepare()
