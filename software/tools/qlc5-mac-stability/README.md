# QLC+ 5.3.0 Mac stability build

Base: QLC+_5.3.0, `f0f302f901b0bb56c2e8d5d6838c3aeed20013c0`.
The selected working changes were read directly from <HOST> on 2026-10-17.

## Included changes

- Guard Scene editor delegates with QPointer; unregister by object identity and clear stale row bindings.
- Clear public editor references before destruction; remove Function tree entries by object identity before deleting their Function. Duplicate names must not leave dangling tree references.
- Save atomically with QSaveFile and keep the 30 previous revisions. Named modified workspaces save every 30 seconds to their original file, matching <HOST>. Use a copy of a show if you want to experiment without changing the original.
- Preserve the opt-in `VirtualConsole MIDIPageChannels="True"` workspace setting, allowing MIDI delivery to other pages. This does not automatically enable it on existing shows.
- Backport the same upstream QTBUG-148459 QML garbage-collection lifetime fix to Mac Qt 6.10.3. Build QtQml and QtQmlMeta. Also apply `qt-canvas-lifetime.patch` to QtQuick: a deferred Canvas initialization may run after GC has removed its QML engine. The context must not be created without a valid engine. Keep the other official framework/plugin versions.

Additional color, brightness and fade web overrides and forced VC button caption synchronization are excluded. Engine and I/O plugins are retained from the installed official Mac 5.3.0 app.

## Build

Install Qt 6.10.3 macOS SDK with qt3d, qtmultimedia, qtserialport, qtwebsockets, qtshadertools and qttools. Use the official QLC+ 5.3.0 app as QLC_RUNTIME (`Contents` directory).
Apply stability.patch to the clean QLC+ source, and both QTBUG-148459.patch and qt-canvas-lifetime.patch to qtdeclarative v6.10.3. Configure qtdeclarative against that SDK with `QT_BUILD_TESTS=OFF`, `QT_BUILD_EXAMPLES=OFF`, Release, arm64; build targets Qml, QmlMeta and Quick.

```sh
cmake -S . -B build -DQLC_SOURCE=/path/to/patched/qlcplus -DQLC_RUNTIME="/Applications/QLC+ 5.app/Contents" -DCMAKE_PREFIX_PATH=/path/to/Qt/6.10.3/macos -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64
cmake --build build --target qlcplus5 stability-test -j 5
```

Copy the official app to a separate bundle. Replace `Contents/MacOS/qlcplus5`, QtQml, QtQmlMeta and QtQuick with these builds, remove absolute build RPATHs and add `@executable_path/../Frameworks`, then ad-hoc sign the bundle. Never overwrite the working official app or copy Windows DLLs into it.

## Verification boundaries

Tests use a copy of the <HOST> show with all Input, Output and Feedback bindings removed, and isolated settings. No physical output is exercised. The app test covers cue start/stop, Scene editor open/close/GC, delegate lifetime, duplicate Function names, atomic saves and 30-revision retention. The upstream Qt GC regressions and a Canvas GC/context-teardown regression are run separately. Run each App test in a separate process; App/Tardis retain process-level singleton state.

Actual MIDI mapping, fixture output, blackout/reconnect behavior and a complete performance with Ableton require rehearsal on this Mac. Test results and exact bundle hashes are recorded in build-manifest.json when complete.

## Canvas failure evidence

The native looping test initially crashed on the main GUI thread in QtQuick at image offset `0x33f794`. Disassembly identifies `qmlEngine(this)->handle()` in `QQuickCanvasItem::initializeContext`, called from the posted `delayedCreate`. `qmlEngine` returned null (faulting load at offset 0x10). The standalone Canvas test explicitly collects a JavaScript-owned Canvas, verifies its QML engine is null, then pumps pending events before deferred deletion. The official QtQuick crashes with SIGSEGV; the patched QtQuick must pass 100 repetitions. This is a separate failure from QTBUG-148459.

The initial broad App regression passed cue traversal, lifetime and save checks, but its first soak candidate was an empty Chaser. Its wait is not evidence of continuous playback. The final dedicated soak uses Function 14 (RED WHOLE FLASH, two steps, Loop), checks isRunning every second for 120 seconds and verifies stop.

## Run isolated verification

The generated bundle includes test executables and QtTest for local verification. They run only when invoked explicitly.

```sh
python3 verify.py --bundle "/Applications/QLC+ 5 Stable.app" --show /path/to/show.qxw --reports /tmp/qlc-mac-reports
```

This regression suite targets the captured 2026-10-17 `261009-ableton-hold-midi.qxw` snapshot (344 functions, looping Chaser ID 14). It is not a generic acceptance test for arbitrary workspaces.

The verifier strips all hardware mappings from a temporary copy and preserves the mandatory Workspace DOCTYPE. Production show files are not changed by this verifier. Normal use of the app does retain the original <HOST> automatic-save behavior.
