"""Capture real Live OSC feedback over loopback without transport commands.

TouchOSC's next heartbeat restores its feedback destination after this probe.
"""
import argparse
import json
import socket
import struct
import time
from pathlib import Path


def string(value):
    data = value.encode('utf8') + b'\0'
    return data + b'\0' * (-len(data) % 4)


def decode(data):
    offset = 0

    def read_string():
        nonlocal offset
        end = data.index(b'\0', offset)
        value = data[offset:end].decode('utf8')
        offset = (end + 4) & ~3
        return value

    address, tags = read_string(), read_string()
    args = []
    for tag in tags[1:]:
        if tag == 's':
            args.append(read_string())
        elif tag in ('i', 'f'):
            args.append(struct.unpack_from('>' + tag, data, offset)[0])
            offset += 4
        else:
            raise ValueError('Unsupported OSC tag: ' + tag)
    return address, args


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('show', choices=['c2', 'rumy', 'dfs-day1'])
    parser.add_argument('label')
    args = parser.parse_args()
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as client:
        client.bind(('127.0.0.1', 0))
        client.settimeout(2)
        hello = (string('/stage/hello') + string(',is') +
                 struct.pack('>i', client.getsockname()[1]) + string(args.show))
        client.sendto(hello, ('127.0.0.1', 8001))
        while True:
            data, source = client.recvfrom(8192)
            assert source == ('127.0.0.1', 8001)
            address, values = decode(data)
            if address == '/stage/error':
                raise RuntimeError(values)
            if address == '/stage/state':
                break
    result = dict(label=args.label, show=args.show, timestamp=time.time(),
                  position=values[1], playing=bool(values[2]), tempo=values[3],
                  act=values[6], act_start=values[7], act_end=values[8])
    path = Path(__file__).resolve().parent / 'results' / 'touchosc-live-osc.json'
    prior = json.loads(path.read_text()) if path.exists() else []
    prior.append(result)
    path.write_text(json.dumps(prior, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
