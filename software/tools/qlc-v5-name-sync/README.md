# QLC+5.3.0 Function to VC button name sync

The local `<PATH>` now updates every linked VC button
when its Function is assigned, when an existing workspace is loaded, and when
the Function is renamed. Save QLC to propagate the captions through the
existing Auto Sync watcher into Live. Use `project-files/Open QLC+5.lnk`.

On 2026-10-16 the user requested removal of both stock QLC+5 and old QLC+4.
Only `<PATH>` remains installed. The Start Menu entry
`QLC+5 (patched)` and both `.qxw`/`.qxf` associations target it. Opening the
canonical workspace by file association was verified, and button19's stale
`004-hnyflsh-Red Starfield` caption was corrected to the assigned Function's
`005-hnyflsh-Red Starfield` name and saved. Engine data, non-caption button
properties and the note registry were preserved. The caption regression passes
3/0. Cleanup evidence is in `project-files/verification/runtime-cleanup`.
The removed runtimes, original shortcuts and settings are backed up under
`<PATH>`.

The Function name is authoritative, including for previously different saved
captions. A manual caption edit does not rename the Function; assigning a
Function, reopening the workspace or renaming the Function replaces it.
Retargeting/detaching a button disconnects the old Function. This
patch changes captions only, including RGBMatrix captions; it does not change
button actions, playback or note assignments.

## Implementation

Pinned upstream QLC+_5.3.0 commit:
`f0f302f901b0bb56c2e8d5d6838c3aeed20013c0`.
`function-caption.patch` changes `vcbutton.cpp`, `vcbutton.h` and `tardis.h`.
The frontend subscribes to the attached Function's `nameChanged(uint)` signal.
Caption changes are recorded in the same history batch as the Function rename.
Undo/redo replays the recorded caption, preserving a previously custom caption.
Assignment also records its caption change; history replay restores the recorded
caption instead of deriving it again. Initial loading synchronizes old captions
while normal workspace loading suppresses history records.

The installed engine exposes this signal through its Qt meta-object but does
not declare Function with DLL import/export annotations. A typed signal-pointer
connection failed across this Windows DLL boundary. The canonical meta-object
signature connects correctly; the regression uses the actual installed engine.

Only the executable is rebuilt. The installed engine and I/O plugins stay
unchanged. The earlier Qt Qml/QmlMeta lifetime fix remains installed separately.
This is a local build, not an official QLC release.

## Rebuild and test

Prerequisites: Windows x64, Git, Python, CMake/Ninja, Qt6.10.2 MinGW64 SDK and
its MinGW13.1 compiler. Required Qt modules: Core/Gui/Widgets/Network/PrintSupport,
Qml/Quick/Test/LinguistTools, Svg, Multimedia/MultimediaWidgets, WebSockets,
3DCore/3DInput/3DLogic/3DQuick/3DQuickExtras/3DRender. The current patched runtime
supplies the unchanged `qlcplusengine.dll`; the script checks its original hash.
`StockRuntime` now defaults to `<PATH>`.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
python .\make_fixture.py '<project-files>\261009-ableton-hold-midi.qxw' `
  <PATH>
python .\verify.py --build-dir <PATH>`
  --qt-prefix <PATH>`
  --compiler-bin <PATH>`
  --runtime <PATH>`
  --fixture <PATH>`
  --report <PATH>
```

`build.ps1` supports explicit paths, checks the source commit and patch, and
builds the executable and native test without deploying either. `make_fixture.py`
uses this show's Scene button16 and RGBMatrix button19, duplicates Scene
button16 as120 with a custom caption, and removes all external Input/Output/
Feedback mappings and disables the saved network server autostart. It is a
regression fixture generator for this project.

The backend test covers shared Function bindings, rename notifications,
modified state, custom-caption undo/redo, retargeting, detaching, Japanese names,
manual caption editing, save/reload and the Scene editor's rename path.
It also verifies initial correction of differing saved captions and assignment
undo/redo with a previously custom caption.
The harness waits for history using `QThread::msleep`, without pumping its hidden
QML view. Offscreen rendering of that hidden view can crash in
`QQuickShaderEffectSource`; visual behavior is tested in the normal native app.
Use the SDK `QT_PLUGIN_PATH` for `qoffscreen.dll`, not QLC's Windows-only plugin
folder. The runner suppresses crash dialogs and reports failures.

## Verified on 2026-10-12

- Native regression: 3 passed, 0 failed, 0 skipped.
- Output-free native WebBridge run: 398 cue cycles and 39 absolute-page checks
  in90.138 seconds, with internal DMX press/release samples.
- Canonical native QLC: renamed Function187 to `004-sync-check`, saved, observed
  button19 and Live N3 update, then undid and saved the original name. Live was
  stopped with Output Off and MIDI To No Output throughout this rename check.
- Follow-up: corrected initial/assignment synchronization. Reloaded the existing
  canonical workspace, observed pink buttons16-18 change to001/002/003-hnyflsh-pink
  without dummy renames, saved QLC, observed Live N0-N2 update and saved Live.
  Updated regression passes3/0; a new isolated15-second WebBridge smoke run is
  recorded in `qlc-existing-caption-native-stress.json`.

Records are under `project-files/verification/name-sync` and
`261012-function-caption-sync-check.json`. Physical DMX/MIDI and full-show
duration are not covered by these checks.
The follow-up evidence is `261012-existing-caption-sync-check.json`. Its isolated
fixture has NetworkServer AutoStart False, so workspace loading cannot start the
default9999 server before the CLI's separate10099 port is configured.

## Recovery

`project-files/261012-QLC5-Qt-hotfix.zip` includes the executable under `bin/`,
this patch and build/test tools under `qlc-name-sync/`, and pinned upstream QLC
source under `corresponding-source/`. Apply the patch to reconstruct the modified
source. It also retains the two Qt fixes and their source/licensing materials.
Close QLC normally before restoring the three binary files into a complete copy
of the matching original installation. Preserve the executable's file name and
the existing shortcut arguments. This archive is a delta, not a full installer.

To remove only caption sync while keeping the Qt fix, close QLC and extract
`QLC+5/qlcplus5.exe` from
`<PATH>` into
`<PATH>`. Saved show files remain compatible.
To remove the Qt fix too, use the Qt hotfix README rollback.

QLC retains its Apache2 license; qhttpserver and http-parser retain their
included third-party licenses. See `LICENSE`, `qhttpserver.LICENSE` and
`http-parser.LICENSE-MIT`, and the upstream source for the remaining notices.
