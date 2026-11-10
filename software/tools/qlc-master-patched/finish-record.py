from pathlib import Path
import datetime
import hashlib
import json
import zipfile

root=Path(__file__).parent
workspace=Path('<PATH>')
dest=workspace/'yuhisai-2026/project-files/verification/261101-master-patched'
manifest=json.loads((dest/'build-manifest.json').read_text(encoding='utf-8'))
runtime=Path(manifest['runtime'])
for name,value in manifest['runtime_files'].items():
    assert hashlib.sha256((runtime/name).read_bytes()).hexdigest()==value,name
archive=workspace/'yuhisai-2026/project-files/QLCplus5-master-patched-20261101.zip'
with zipfile.ZipFile(archive) as z:
    assert z.testzip() is None
    names=z.namelist()
    assert 'QLCplus5-master-patched-20261101/qlcplus5.exe' in names
    assert not any(name.endswith('/integration_host.exe') for name in names)
    assert z.read('QLCplus5-master-patched-20261101/qlcplus5.exe')==(runtime/'qlcplus5.exe').read_bytes()
    assert z.read('QLCplus5-master-patched-20261101/qlcplusengine.dll')==(runtime/'qlcplusengine.dll').read_bytes()
now=datetime.datetime.now().astimezone().isoformat(timespec='seconds')
url='https://github.com/mcallegari/qlcplus/issues/2199#issuecomment-6554791690'
posting={'url':url,'verified_by':'GitHub issue-comment readback','body':(workspace/'yuhisai-2026/project-files/verification/261101-master-retest/github-reply-final.txt').read_text(encoding='utf-8').strip(),'recorded_at':now,'separate_issue_posted':False}
(dest/'github-posting.json').write_text(json.dumps(posting,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
old=workspace/'yuhisai-2026/project-files/verification/261101-master-retest'
p=old/'summary.json'
d=json.loads(p.read_text(encoding='utf-8'))
d['github_reply_url']=url
d['github_reply_verified_at']=now
d['limits']=[line for line in d['limits'] if line!='No GitHub comment posted']
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=old/'report.txt'
text=p.read_text(encoding='utf-8').replace('GitHub reply text is prepared in github-reply-draft.txt; it has not been posted.','GitHub retest reply posted and read back: '+url+'\nThe separate same-name issue remains a local draft.')
p.write_text(text,encoding='utf-8')
p=workspace/'docs/roadmap.json'
d=json.loads(p.read_text(encoding='utf-8'))
feature=next(feature for feature in d['features'] if feature['id']=='lighting')
summary='Built QLC+5.3.1 GIT candidate on upstream master d86decb384b0 plus required local identity/caption/save/Auto Sync patches. Rebuilt 11 I/O and one audio plugin; retained verified Qt6.10.2 backport. Scene lifetime 4 cases/100 native cycles, same-name identity/50 native cycles, local override/caption/save tests, page routing on/off, 16 upstream engine targets, 10 JS suites and two 1000-cycle Qt GC cases pass. Native WebBridge 90.029s/1345 cycles/67 page checks, RGB/brightness/fade/panic/mismatch gating pass; observed output readback p95 33ms/max49ms. Earlier fixed-35ms readback assertion failure is retained in evidence. Runtime ZIP CRC/hashes verified; current installed runtime unchanged. Physical MIDI/DMX, full performance/real Ableton seek/3D/other platforms unverified. Retest reply posted and read back at '+url+'. Separate issue remains a draft. Evidence: project-files/verification/261101-master-patched.'
if '2026-11-01: '+summary not in feature['done']:
    feature['done'].append('2026-11-01: '+summary)
if 'Master-based candidate built and verified; side-by-side runtime' not in feature['current_state']:
    feature['current_state']+=' 2026-11-01: Master-based candidate built and verified; side-by-side runtime <PATH>'+url
feature['remaining_issues']=[line.replace('Reply draft not posted.','Retest reply posted at issuecomment-6554791690; separate same-name issue remains a draft.') for line in feature['remaining_issues']]
issue='Master-patched candidate has no physical MIDI/DMX, full-performance or actual Ableton transport/seek/3D record. Existing installed Patched remains the default. Native QML teardown warnings persist; optional FFTW/OLA unavailable (existing patched engine also did not link FFTW).'
if issue not in feature['remaining_issues']:
    feature['remaining_issues'].append(issue)
feature['next_actions']=[line for line in feature['next_actions'] if not line.startswith('Before replacing the installed Patched build, prepare a master-based candidate')]
action='Use Open QLC+5 Master Patched.lnk to inspect the verified side-by-side candidate; coordinate physical MIDI/DMX and full-show/Ableton validation before changing the default installation. Review separate-issue-draft.txt if reporting the same-name Function-tree bug separately.'
if action not in feature['next_actions']:
    feature['next_actions'].append(action)
title='Master-based patched candidate built and verified; upstream retest reply sent'
if not any(entry.get('title')==title for entry in feature['changelog']):
    feature['changelog'].append({'date':now,'title':title,'details':summary})
d['active_task']={'feature_id':'lighting','phase':'Complete','note':'Master-based patched candidate, ZIP and launcher ready; all scoped regressions/integration checks pass. Existing installation unchanged. #2199 reply posted/read back; separate issue draft only.','updated_at':now,'idle_abandon_hours':3}
d['updated_at']=now
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
result={'archive_crc':'PASS','runtime_hashes':'PASS','archive_files':len(names),'archive_bytes':archive.stat().st_size,'installed_unchanged':True,'github_reply':url,'stage_unchanged':feature['stage']}
(dest/'final-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2),flush=True)
