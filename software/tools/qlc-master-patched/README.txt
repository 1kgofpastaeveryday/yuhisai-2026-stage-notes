QLC+ 5 Master Patched candidate

Base: d86decb384b09fd6bd691348eb808238314c10fc
Version string: 5.3.1 GIT
Runtime: <PATH>

Start with Open QLC+5 Master Patched.lnk in project-files. This opens an empty
workspace with Web access enabled. Open the desired workspace from the app.
The existing QLC+5 (patched) installation and its shortcuts remain unchanged.
Close the other QLC instance before using the same Web port or physical outputs.

This candidate combines current master with the existing local Auto Sync,
Function-tree, caption and periodic-save changes. The Scene console lifetime
fix is supplied by master. Qt6Qml/Qt6QmlMeta retain the installed QTBUG-148459
backport. All 11 I/O plugins and the sndfile decoder were rebuilt for master's
updated plugin interface. Other bundled Qt/runtime dependencies were retained.

Verification: Scene lifetime 4 focused tests and 100 native cycles; same-name
rename/delete and 50 native cycles; color/fade/brightness/caption/undo/save;
30-second continuous-edit periodic save, backup retention/failure handling;
page-channel routing on/off; 16 upstream engine test targets; 10 Auto Sync JS
suites; both Qt GC reproductions at 1000 iterations; native WebBridge soak,
output readbacks, page actions, panic, and source mismatch gating.
See build-manifest.json and integration-results.json for exact counts.

Not covered: physical MIDI/DMX, full performance, real Ableton transport/seek,
3D, other platforms, or the entire upstream suite. Nonfatal QML teardown
warnings remain. Optional FFTW/OLA were unavailable (the existing patched
engine also did not link FFTW).

Rebuild on this PC:
1. Check out the base commit into the source directory above.
2. Apply master-local.patch. Scene lifetime files must remain upstream's.
3. The saved setup/build scripts use the Qt6.10.2/MinGW13.1 SDK in
   <PATH>
4. setup-build.py adds local CMake/test wiring; prepare-integration.py and
   setup-page-test.py add the two additional validation targets.
5. build.py builds the application, local tests and matching I/O/audio plugins.
   build-engine-tests.py builds the selected upstream engine test targets.

The source checkout, build tree, staged dependencies and all original evidence
remain under <PATH>
No deployment or file-association change was performed. The user authorized
the #2199 retest reply, posted at issuecomment-6554791690. The separate
same-name Function-tree issue is still a local draft.
