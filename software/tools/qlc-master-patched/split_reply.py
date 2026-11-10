from pathlib import Path

base = Path('<PATH>')
draft = base / 'github-reply-draft.txt'
old = draft.read_text(encoding='utf-8')
(base / 'github-reply-before-issue-split.txt').write_text(old, encoding='utf-8')
draft.write_text('''I retested master d86decb384b0 on the same Windows 11 PC where the original crashes occurred.

The Scene-console lifetime tests now pass: all 4 focused cases and 100 native open/edit/close cycles, with no crash during those cycles. Thanks for including the fix.

The separate same-name Scene issue from my earlier comment still reproduces and should be tracked separately.

Tested with a fresh master build and stock Qt 6.10.2, without loading the show or using external I/O. AI assistance (Codex) was used for the retest.
''', encoding='utf-8')
(base / 'separate-issue-draft.txt').write_text('''Title: [QLC+5] Same-named functions can leave a dangling Function reference after rename/delete

On current master d86decb384b0, renaming or deleting the second of two same-named Scenes in the same folder can remove the first Scene's tree row instead.

Reproduction:
1. Create two Scenes in the same folder and give both the same name.
2. Delete the second Scene.
3. Its Function is removed from Doc, but its tree row remains and the first Scene's row disappears.

Renaming the second Scene instead also removes the first Scene's row and leaves two references to the renamed Scene.

Expected: rename/delete updates the row belonging to that Function, regardless of duplicate names.

Source: deleteFunction and moveFunction remove by name/path. slotFunctionNameChanged finds the correct Function by identity, then removes by the old label/path, which can select the other same-named row.

Verified on the same Windows 11 PC as #2199 with a fresh master engine/frontend build and stock Qt 6.10.2. Both rename and deletion identity tests fail; the native repeated-cycle test fails on rename in its first cycle. Tests use temporary settings and an empty document with no external I/O. The deleted Function is absent from Doc but still has one tree reference. No original access violation is claimed reproduced.

This is separate from the Scene-console lifetime fix in 0eee616b5 / #2200. The connection to the original Function* crash in #2199 remains unproven. A local fix removes exact TreeModelItem instances using Function identity; it is currently being retested on master.

AI assistance (Codex) was used for the investigation and tests.
''', encoding='utf-8')
print('Original-issue reply and separate-issue draft saved.')
