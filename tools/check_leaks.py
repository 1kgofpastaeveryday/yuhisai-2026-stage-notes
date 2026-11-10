"""Fail if any tracked text could leak private data.

Run by the pre-commit hook (on staged files) and by CI (on the whole tree and the built site).
Patterns are ported from the private stages repo's build-stage-pages.py audit.
"""
import hashlib
import pathlib
import re
import subprocess
import sys
import zlib

PATTERNS = {
    'local_path': r'/Users/|/home/|[CD]:\\|\.agent-history|\.jsonl\b|rollout-',
    # Loopback (127.x, localhost, ::1) is not private and code needs it; real hosts are.
    'host_identifier': r'junhwi|tail36b310|\.ts\.net|Mac4m',
    'ip_address': r'\b(?!127\.|0\.0\.0\.0\b)(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b',
    'email': r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    'phone': r'\b0\d{1,3}-\d{2,4}-\d{4}\b',
    'private_key': r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'credential': r'\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{30,})\b',
    'personal_name': r'渡邉|渡辺|勇真|霜鳥|武井',
    # Group (club) names are published on purpose: owner decision 2026-11-10.
    'internal_note': r'<!--|根拠：|抽出元',
    'image_metadata': r'image_metadata_present:\w+',
}
# This file and the workflow name the patterns themselves.
SKIP = {'tools/check_leaks.py'}


def java_strings(raw):
    """Strings stored in a Java-serialized file (REW .mdat): TC_STRING 0x74, u16 length, UTF-8."""
    out = []
    for m in re.finditer(b'\x74', raw):
        n = int.from_bytes(raw[m.start() + 1:m.start() + 3], 'big')
        chunk = raw[m.start() + 3:m.start() + 3 + n]
        if 3 <= n <= 4096 and len(chunk) == n:
            try:
                s = chunk.decode('utf-8')
            except UnicodeDecodeError:
                continue
            if s.isprintable():
                out.append(s)
    return '\n'.join(out)


def glb_json(raw):
    """The JSON chunk of a binary glTF (.glb): names, generator, URIs."""
    n = int.from_bytes(raw[12:16], 'little')
    return raw[20:20 + n].decode('utf-8')


def image_metadata(raw):
    """Images must carry no metadata at all (EXIF/GPS/XMP/text chunks); returns a marker if they do."""
    found = []
    if raw.startswith(b'\x89PNG'):
        i = 8
        while i + 8 <= len(raw):
            n, kind = int.from_bytes(raw[i:i + 4], 'big'), raw[i + 4:i + 8]
            if kind in (b'tEXt', b'iTXt', b'zTXt', b'eXIf'):
                found.append(kind.decode())
            i += 12 + n
    elif raw.startswith(b'\xff\xd8'):
        i = 2
        while i + 4 <= len(raw) and raw[i] == 0xFF:
            marker, n = raw[i + 1], int.from_bytes(raw[i + 2:i + 4], 'big')
            if marker == 0xDA:
                break
            if marker == 0xE1 or marker == 0xFE:
                found.append(f'APP{marker:02X}')
            i += 2 + n
    else:
        return None
    return ''.join(f'image_metadata_present:{k}\n' for k in found)


# Binary formats are scanned through an extractor that returns their text content.
# Any other binary file fails the check: nothing opaque gets published unread.
def tosc_xml(raw):
    """TouchOSC layouts (.tosc) are zlib-compressed XML."""
    return zlib.decompress(raw).decode('utf-8')


def amxd_text(raw):
    """Max for Live devices (.amxd): a short binary header, then the patcher as JSON text."""
    return raw.decode('latin-1')


BINARY = {'.tosc': tosc_xml, '.amxd': amxd_text, '.mdat': java_strings, '.glb': glb_json, '.png': image_metadata, '.jpg': image_metadata, '.jpeg': image_metadata}
# Opaque files the owner approved by content hash after review of what could be read
# (strings): Capture and Blender projects of the venue (owner, 2026-11-10).
APPROVED_OPAQUE = {
    # files/venue/capture/small-auditorium.c2s: strings and the raw-DEFLATE body scanned clean
    'a9fdb2e012f427d569112356c7928b14072a801404499650fc4061b938e0b912': 'Capture venue project',
    # files/venue/model/small-auditorium.blend: three local paths blanked; decompressed strings scanned clean
    '0aedbe1e26af0038ca1926784b9bd5ca7274699235c4dffcc74efd6f9e760101': 'Blender venue model',
}


def text_of(name, raw):
    if hashlib.sha256(raw).hexdigest() in APPROVED_OPAQUE:
        return ''
    ext = pathlib.PurePath(name).suffix.lower()
    if ext in BINARY:
        return BINARY[ext](raw)
    try:
        return raw.decode('utf-8')
    except UnicodeDecodeError:
        return None


def scan(path, text):
    hits = []
    for category, pattern in PATTERNS.items():
        for m in re.finditer(pattern, text, re.I):
            line = text.count('\n', 0, m.start()) + 1
            hits.append(f'{path}:{line}: {category}: {m.group(0)!r}')
    return hits


def main(argv):
    if argv and argv[0] == '--staged':
        # -z: NUL-separated, so file names with spaces stay whole.
        names = [n for n in subprocess.run(['git', 'diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'],
                                           capture_output=True, text=True, check=True).stdout.split('\0') if n]
        files = [(n, subprocess.run(['git', 'show', f':{n}'], capture_output=True, check=True).stdout) for n in names]
    else:
        roots = [pathlib.Path(a) for a in argv] or [pathlib.Path('.')]
        files = []
        for root in roots:
            for p in ([root] if root.is_file() else sorted(root.rglob('*'))):
                if p.is_file() and '.git' not in p.parts:
                    files.append((p.as_posix(), p.read_bytes()))
    hits = []
    for name, raw in files:
        if name in SKIP or name.startswith('./') and name[2:] in SKIP:
            continue
        text = text_of(name, raw)
        if text is None:
            hits.append(f'{name}: unreadable_binary: add an extractor for this format or leave it out')
            continue
        hits += scan(name, text)
    for h in hits:
        print(h)
    if hits:
        sys.exit(f'leak check failed: {len(hits)} match(es)')
    print(f'leak check ok: {len(files)} file(s)')


if __name__ == '__main__':
    main(sys.argv[1:])
