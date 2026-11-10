"""TouchOSC stage transport. Live API calls run only on Live's main thread."""
import re
import socket
import struct
import time

from _Framework.ControlSurface import ControlSurface

PORT = 8001
QLC_PORT = 8002


def osc_string(value):
    data = value.encode('utf-8') + b'\0'
    return data + b'\0' * (-len(data) % 4)


def packet(address, *args):
    tags, data = ',', b''
    for value in args:
        if isinstance(value, str):
            tags += 's'; data += osc_string(value)
        elif isinstance(value, int):
            tags += 'i'; data += struct.pack('>i', value)
        else:
            tags += 'f'; data += struct.pack('>f', value)
    return osc_string(address) + osc_string(tags) + data


def decode(data):
    offset = 0
    def string():
        nonlocal offset
        end = data.index(b'\0', offset)
        value = data[offset:end].decode('utf-8')
        offset = (end + 4) & ~3
        return value
    address, tags = string(), string()
    if not tags.startswith(','): raise ValueError('Invalid OSC type tags')
    args = []
    for tag in tags[1:]:
        if tag == 's': args.append(string())
        elif tag in ('i', 'f'):
            args.append(struct.unpack_from('>' + tag, data, offset)[0]); offset += 4
        else: raise ValueError('Unsupported OSC type')
    if offset != len(data): raise ValueError('Invalid OSC size')
    return address, args


def acts_from_cues(cues):
    starts, ends = {}, {}
    for cue in cues:
        match = re.fullmatch(r'\[([^\]]+)\]\s*(SETSTOP)?', cue.name.strip(), re.I)
        if match:
            title = match[1].strip()
            (ends if match[2] else starts)[title.casefold()] = (title, float(cue.time))
    return sorted([(title, beat, ends[key][1]) for key, (title, beat) in starts.items()
                   if key in ends and ends[key][1] > beat], key=lambda act: act[1])


def create_instance(c_instance):
    return StageControl(c_instance)


class StageControl(ControlSurface):
    def __init__(self, c_instance):
        super(StageControl, self).__init__(c_instance)
        self._udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._udp.bind(('', PORT))
        self._udp.setblocking(False)
        self._peer = None
        self._peer_seen = 0
        self._sequence = 0
        self._pending_qlc = {}
        self._prepared_cue = None
        self._running = True
        self.schedule_message(1, self._tick)
        self.log_message('StageControl ready on OSC UDP %d' % PORT)

    def disconnect(self):
        self._running = False
        self._udp.close()
        super(StageControl, self).disconnect()

    def _send(self, address, *args):
        if self._peer: self._udp.sendto(packet(address, *args), self._peer)

    def _control(self, action, value):
        song = self.song()
        if action == 'resume':
            if not song.is_playing:
                cue = self._prepared_cue
                self._prepared_cue = None
                if cue is not None and abs(song.current_song_time - cue.time) < 0.00001:
                    # cue.jump() prepares the insertion marker, whereas Continue
                    # resumes Live's previous stop marker. Consume this selection once.
                    song.start_playing()
                else:
                    song.continue_playing()
        elif action == 'stop':
            if song.is_playing: song.stop_playing()
        elif action == 'metronome':
            if value not in ('on', 'off'): raise ValueError('Invalid metronome value')
            song.metronome = value == 'on'
        elif action == 'locate':
            cue = next((c for c in song.cue_points if c.name == value), None)
            if cue is None: raise ValueError('Locator missing')
            # Locating is an explicit preparation step; never starts playback.
            if song.is_playing: song.stop_playing()
            cue.jump()
            self._prepared_cue = cue
        else: raise ValueError('Unknown stage action')

    def _receive(self):
        for _ in range(32):
            try: data, source = self._udp.recvfrom(8192)
            except BlockingIOError: break
            try:
                address, args = decode(data)
                if address == '/stage/hello' and len(args) == 1:
                    port = args[0]
                    if not isinstance(port, int) or not 1024 <= port <= 65535: continue
                    self._peer = (source[0], port)
                    self._peer_seen = time.monotonic()
                elif address == '/stage/control' and len(args) == 3:
                    request, action, value = args
                    if not self._peer or source[0] != self._peer[0]: continue
                    if not isinstance(request, int) or not isinstance(action, str) or not isinstance(value, str): continue
                    if action in ('qlc_stop', 'border'):
                        self._pending_qlc[request] = time.monotonic()
                        self._udp.sendto(packet('/stage/qlc', request, action, value), ('127.0.0.1', QLC_PORT))
                    else:
                        try:
                            self._control(action, value)
                            self._send('/stage/ack', request, 1, '')
                        except Exception as exc:
                            self._send('/stage/ack', request, 0, str(exc))
                elif address == '/stage/qlc_ack' and source == ('127.0.0.1', QLC_PORT) and len(args) == 3:
                    if args[0] in self._pending_qlc:
                        del self._pending_qlc[args[0]]
                        self._send('/stage/ack', *args)
            except (ValueError, UnicodeError, struct.error):
                continue
        now = time.monotonic()
        for request, started in list(self._pending_qlc.items()):
            if now - started > 1.5:
                del self._pending_qlc[request]
                self._send('/stage/ack', request, 0, 'QLC+ unavailable')

    def _broadcast(self):
        if not self._peer or time.monotonic() - self._peer_seen > 3: return
        song = self.song()
        acts = acts_from_cues(song.cue_points)
        if not acts:
            self._send('/stage/error', 'Locators missing')
            return
        position = float(song.current_song_time)
        act = acts[0]
        for candidate in acts:
            if candidate[1] > position: break
            act = candidate
        self._sequence += 1
        self._send('/stage/state', self._sequence, position, int(song.is_playing), float(song.tempo),
                   int(song.signature_numerator), int(song.signature_denominator), *act)
        self._send('/stage/panel', int(song.is_playing), int(song.metronome))

    def _tick(self):
        if not self._running: return
        try:
            self._receive()
            self._broadcast()
        except Exception as exc:
            self.log_message('StageControl: %s' % exc)
        finally:
            if self._running: self.schedule_message(1, self._tick)
