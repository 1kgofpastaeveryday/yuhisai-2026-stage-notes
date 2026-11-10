from pathlib import Path
import datetime
import hashlib
import json
import subprocess

root = Path(__file__).parent
old = Path('<PATH>')
src = Path('<PATH>')
patch = subprocess.check_output(['git', 'diff', '--binary', '--', '.', ':(exclude)qmlui/sceneeditor.cpp', ':(exclude)qmlui/sceneeditor.h', ':(exclude)qmlui/qml/fixturesfunctions/SceneFixtureConsole.qml'], cwd=old)
(root / 'original-local-changes.patch').write_bytes(patch)
before = {name: hashlib.sha256((Path('<PATH>') / name).read_bytes()).hexdigest() for name in ['qlcplus5.exe', 'qlcplusengine.dll', 'Qt6Qml.dll', 'Qt6QmlMeta.dll']}
(root / 'installed-before.json').write_text(json.dumps(before, indent=2) + '\n')
sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=src, text=True).strip()
(root / 'source-base.json').write_text(json.dumps({'upstream_master': sha, 'source': str(src), 'source_of_local_changes': str(old), 'excluded_already_upstream': ['qmlui/sceneeditor.cpp', 'qmlui/sceneeditor.h', 'qmlui/qml/fixturesfunctions/SceneFixtureConsole.qml']}, indent=2) + '\n')
p = Path('<PATH>')
d = json.loads(p.read_text(encoding='utf-8'))
now = datetime.datetime.now().astimezone().isoformat(timespec='seconds')
d['active_task'] = {'feature_id': 'lighting', 'phase': 'building-master-with-local-patches', 'note': f'User requested a master-based candidate preserving local Auto Sync, Function-tree and save/Qt fixes. Migrating onto {sha[:12]}, then build and isolated regression/integration checks. Existing installation retained while preparing candidate.', 'updated_at': now, 'idle_abandon_hours': 3}
d['updated_at'] = now
p.write_text(json.dumps(d, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
r = subprocess.run(['git', 'apply', '--3way', str(root / 'original-local-changes.patch')], cwd=src, capture_output=True, text=True)
(root / 'apply.log').write_text(r.stdout + r.stderr)
print(r.stdout + r.stderr)
print('Apply exit:', r.returncode)
