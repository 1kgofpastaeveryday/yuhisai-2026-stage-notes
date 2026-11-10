"""Fail if any tracked text could leak private data.

Run by the pre-commit hook (on staged files) and by CI (on the whole tree and the built site).
Patterns are ported from the private stages repo's build-stage-pages.py audit.
"""
import pathlib
import re
import subprocess
import sys

PATTERNS = {
    'local_path': r'/Users/|/home/|[CD]:\\|\.agent-history|\.jsonl\b|rollout-',
    'host_identifier': r'junhwi|tail36b310|\.ts\.net|localhost|Mac4m|127\.0\.0\.1',
    'ip_address': r'\b(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}\b',
    'email': r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
    'phone': r'\b0\d{1,3}-\d{2,4}-\d{4}\b',
    'private_key': r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
    'credential': r'\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9_-]{30,})\b',
    'personal_name': r'渡邉|渡辺|勇真|霜鳥|武井',
    'organization_name': r'研究会|同好会',
    'internal_note': r'<!--|根拠：|抽出元',
}
# This file and the workflow name the patterns themselves.
SKIP = {'tools/check_leaks.py'}


def scan(path, text):
    hits = []
    for category, pattern in PATTERNS.items():
        for m in re.finditer(pattern, text, re.I):
            line = text.count('\n', 0, m.start()) + 1
            hits.append(f'{path}:{line}: {category}: {m.group(0)!r}')
    return hits


def main(argv):
    if argv and argv[0] == '--staged':
        names = subprocess.run(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR'],
                               capture_output=True, text=True, check=True).stdout.split()
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
        hits += scan(name, raw.decode('utf-8', errors='replace'))
    for h in hits:
        print(h)
    if hits:
        sys.exit(f'leak check failed: {len(hits)} match(es)')
    print(f'leak check ok: {len(files)} file(s)')


if __name__ == '__main__':
    main(sys.argv[1:])
