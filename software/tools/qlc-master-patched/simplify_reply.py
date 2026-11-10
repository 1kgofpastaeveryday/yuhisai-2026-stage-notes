from pathlib import Path

draft = Path('<PATH>')
old = draft.read_text(encoding='utf-8')
assert old.startswith('I retested current master d86decb384b0 on the same Windows 11 PC where the original crashes occurred,')
backup = draft.with_name('github-reply-before-simplification.txt')
if not backup.exists():
    backup.write_text(old, encoding='utf-8')
text = '''I retested master d86decb384b0 on the same Windows 11 PC where the original crashes occurred.

The Scene-console lifetime tests now pass: all 4 focused cases and 100 native open/edit/close cycles. Thanks for including the fix.

The separate same-name Scene bug still reproduces:
- Renaming the second Scene removes the first row and duplicates the renamed Scene's reference.
- Deleting the second Scene removes the first row and leaves a reference to the deleted Scene.

Tested with a fresh master build, stock Qt 6.10.2, temporary settings, and no show file or external I/O. This confirms the tree bug; its connection to the original crash remains unproven.

AI assistance (Codex) was used for this retest.
'''
draft.write_text(text, encoding='utf-8')
print('Reply simplified:', len(text.split()), 'words')
