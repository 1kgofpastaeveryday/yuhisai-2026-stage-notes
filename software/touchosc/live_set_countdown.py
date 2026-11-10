#!/usr/bin/env python3
"""Read a Live set and forward Live's observed transport to TouchOSC over OSC."""
import argparse
import gzip
import hashlib
import json
import re
import socket
import struct
import time
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / 'live-countdown'
DEFAULT_SET = HERE.parent / 'project-files' / 'Dance_Free_Style Project' / '小講堂1日目.als'


def read_set(path):
    raw = path.read_bytes()
    root = ET.fromstring(gzip.decompress(raw))
    cues = sorted(({'name': n.find('Name').get('Value'), 'beat': float(n.find('Time').get('Value'))}
                   for n in root.findall('.//Locators/Locators/Locator')), key=lambda c: c['beat'])
    starts, ends, issues = {}, {}, []
    for cue in cues:
        m = re.fullmatch(r'\[([^\]]+)\]\s*(SETSTOP)?', cue['name'].strip(), re.I)
        if not m: continue
        key = m[1].strip().casefold()
        bucket = ends if m[2] else starts
        if key in bucket: issues.append('Duplicate ' + cue['name'])
        bucket[key] = dict(cue, title=m[1].strip())
    acts = []
    for key in starts.keys() | ends.keys():
        if key not in starts or key not in ends:
            issues.append('Unpaired ' + (starts.get(key) or ends[key])['name'])
            continue
        a, b = starts[key], ends[key]
        if a['beat'] >= b['beat']:
            issues.append('End before start: ' + a['name']); continue
        acts.append({'title': a['title'], 'start': a['beat'], 'end': b['beat'],
                     'start_locator': a['name'], 'end_locator': b['name']})
    acts.sort(key=lambda a: a['start'])
    for a, b in zip(acts, acts[1:]):
        if a['end'] > b['start']: issues.append('Overlapping acts: ' + a['title'] + ', ' + b['title'])
    return root, {'source': str(path.resolve()), 'source_sha256': hashlib.sha256(raw).hexdigest(),
                  'acts': acts, 'cues': cues, 'issues': issues,
                  'updated_at': datetime.now().astimezone().isoformat(timespec='seconds')}


def make_test_copy(path, root, manifest):
    """Keep timing/locators; disable clip output in a separate sibling set."""
    counts = {'disabled_clips': 0, 'midi_outputs_disconnected': 0, 'muted_tracks': 0}
    for track in root.findall('LiveSet/Tracks/*') + root.findall('LiveSet/MasterTrack'):
        mixer = track.find('DeviceChain/Mixer')
        if mixer is not None:
            for key, value in [('Speaker', 'false'), ('Volume', '0')]:
                manual = mixer.find(key + '/Manual')
                if manual is not None: manual.set('Value', value)
            counts['muted_tracks'] += 1
        route = track.find('.//MidiOutputRouting')
        if route is not None:
            route.find('Target').set('Value', 'MidiOut/None')
            route.find('UpperDisplayString').set('Value', 'None')
            route.find('LowerDisplayString').set('Value', '')
            counts['midi_outputs_disconnected'] += 1
    for tag in ('AudioClip', 'MidiClip'):
        for clip in root.findall('.//' + tag):
            disabled = clip.find('Disabled')
            if disabled is None: raise ValueError('Clip has no Disabled property')
            disabled.set('Value', 'true')
            counts['disabled_clips'] += 1
    assert counts['disabled_clips'] > 0
    copy = path.with_name(path.stem + '-countdown-test-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.als')
    with copy.open('xb') as stream:
        stream.write(gzip.compress(ET.tostring(root, encoding='utf-8', xml_declaration=True), mtime=0))
    assert hashlib.sha256(path.read_bytes()).hexdigest() == manifest['source_sha256']
    evidence = dict(counts, test_copy=str(copy.resolve()),
                    test_copy_sha256=hashlib.sha256(copy.read_bytes()).hexdigest(),
                    source_sha256=manifest['source_sha256'], source_unchanged=True)
    (OUT / 'test-copy.json').write_text(json.dumps(evidence, indent=2, ensure_ascii=False)+'\n', encoding='utf-8')
    return evidence


class LiveClient:
    """The installed AbletonMCP JSON/TCP protocol; one request in flight."""
    def __init__(self, port=9877):
        self.socket = socket.create_connection(('127.0.0.1', port), timeout=2)
        self.socket.settimeout(2)

    def request(self, command, **params):
        self.socket.sendall(json.dumps({'type': command, 'params': params}).encode('utf-8'))
        buffer = b''
        while len(buffer) < 8 * 1024 * 1024:
            chunk = self.socket.recv(65536)
            if not chunk: raise ConnectionError('Live closed the connection')
            buffer += chunk
            try: result = json.loads(buffer.decode('utf-8'))
            except (ValueError, UnicodeDecodeError): continue
            if result['status'] != 'success': raise RuntimeError(result)
            return result['result']
        raise ValueError('Live response too large')

    def close(self): self.socket.close()


def validate_live_cues(client, manifest):
    snapshot = client.request('get_session_snapshot', include_notes=False, include_params=False)
    actual = sorted((c['name'], round(c['time'], 6)) for c in snapshot['cue_points'])
    expected = sorted((c['name'], round(c['beat'], 6)) for c in manifest['cues'])
    if actual != expected: raise ValueError('Loaded Live locators do not match the selected set')
    return snapshot


def select_act(acts, beat):
    current = acts[0]
    for act in acts:
        if act['start'] > beat: break
        current = act
    return current


def osc_string(value):
    data = value.encode('utf-8') + b'\0'
    return data + b'\0' * (-len(data) % 4)


def state_packet(sequence, info, act):
    # Stable schema: sequence, position, playing, tempo, meter, act and endpoints.
    return (osc_string('/stage/state') + osc_string(',ififiisff') +
            struct.pack('>ififii', sequence, float(info['current_song_time']),
                        int(info['is_playing']), float(info['tempo']),
                        int(info['signature_numerator']), int(info['signature_denominator'])) +
            osc_string(act['title']) + struct.pack('>ff', act['start'], act['end']))


def stream(manifest, host, port, duration=None, log=None):
    if not manifest['acts'] or manifest['issues']: raise ValueError(manifest['issues'])
    sequence, started, samples = 0, time.monotonic(), []
    client = LiveClient()
    validate_live_cues(client, manifest)
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        while duration is None or time.monotonic() - started < duration:
            tick = time.monotonic()
            info = client.request('get_session_info')
            act = select_act(manifest['acts'], info['current_song_time'])
            sequence += 1
            udp.sendto(state_packet(sequence, info, act), (host, port))
            if log:
                samples.append(dict(info, sequence=sequence, act=act['title'], start=act['start'],
                                    end=act['end'], elapsed=time.monotonic()-started))
            time.sleep(max(0, 0.05 - (time.monotonic() - tick)))
    finally:
        client.close(); udp.close()
        if log: Path(log).write_text(json.dumps(samples, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('command', choices=['inspect', 'copy', 'stream'])
    p.add_argument('--set', type=Path, default=DEFAULT_SET)
    p.add_argument('--host', default='127.0.0.1')
    p.add_argument('--port', type=int, default=8000)
    p.add_argument('--duration', type=float)
    p.add_argument('--log', type=Path)
    a = p.parse_args()
    root, manifest = read_set(a.set)
    OUT.mkdir(parents=True, exist_ok=True)
    if a.command in ('inspect', 'copy'):
        (OUT/'set-manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
        print(json.dumps(manifest if a.command == 'inspect' else make_test_copy(a.set,root,manifest),ensure_ascii=False))
    else: stream(manifest,a.host,a.port,a.duration,a.log)


if __name__ == '__main__': main()
