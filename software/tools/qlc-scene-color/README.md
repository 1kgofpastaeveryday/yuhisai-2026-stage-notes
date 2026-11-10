# Runtime Scene / RGB Matrix colour and fade overrides

Local QLC+ 5.3.0 patch against `f0f302f901b0bb56c2e8d5d6838c3aeed20013c0`.
Retains the existing caption, Scene editor lifetime/autosave and Qt patches.

`runtime-color.patch` changes the engine and Web API. Scene and RGB Matrix faders are tagged
when created. While the global override is enabled, each single-head 8-bit RGB
fixture's current native envelope is recoloured using its maximum RGB component.
Stored Function values, Matrix algorithms, fade progress, intensity, blend mode and note handling
are retained. Untagged faders, dimmers, multi-head and 16-bit RGB are unaffected.
Disabling the override immediately restores the original output.

The2026-10-17 extension tags Matrix faders at creation and uses the same post-fade
RGB recolouring as Scenes. Pattern timing, dark pixels and the Intensity slider
are preserved; no Matrix algorithm or stored Color property is modified.
The existing N0 Color Override and RGB parameters work without reloading Live.

WebSocket command:

```
QLC+API|setSceneColorOverride|enabled|red|green|blue
```

`enabled` is 0 or 1; components are integers 0–255. Invalid commands are ignored.
The override is runtime-only and resets when its owning WebSocket closes, the
workspace reloads or the Web server shuts down. Auto Sync also resets on panic,
transport stop and Output Off.

Auto Sync 0.6.0 reserves CC20/21/22 for RGB and CC23 for enable (64–127).

Auto Sync 0.7.0 adds named `Fade In` / `Fade Out` Float percentage parameters
and an independent `Fade Override` switch. 0–100% maps to0–1000ms, with1ms
rounding rather than7-bit quantization. No new MIDI notes or CC numbers are used.

```
QLC+API|setFadeOverride|enabled|fadeInMs|fadeOutMs
```

Scene fades (including the normally instantaneous Flash fade-in) and RGBMatrix
pixel/start/stop transitions use the runtime millisecond values. Scene children
of Sequence/Chaser also use them. Stored Function speeds and tempo type remain
unchanged; beat-mode Functions still use absolute milliseconds for the override.
Unrelated Simple Desk, Blackout/StopAll actions and EFX trajectories retain
their behavior. Disabling restores native speed selection for future transitions.

The fade override has its own WebSocket owner and resets on owner close,
workspace load and server destruction. Values and enable state are validated.
The bridge suspends native fades on transport stop/panic/output-off while retaining
the requested UI values, then reapplies them before the next valid cue or slider.
Source matching and reconnect gates prevent starting outdated actions.

Build with the pinned Qt 6.10.2 / MinGW 13.1 SDK used by the other QLC tools.
Use `build.ps1`. Both `qlcplus5.exe` and `qlcplusengine.dll` must be deployed
together after saving and closing QLC. Original binaries are backed up under
`<PATH>`.

Auto Sync 0.10.0 adds independent RGB-only brightness:

```
QLC+API|setRGBBrightnessOverride|enabled|percent
```

`enabled` is 0 or 1 and `percent` is an integer 0–100. It uses the same absolute
RGB normalization and native fade/pattern envelopes as the full brightness
override, without modifying Dimmer channels. When both scopes are enabled,
RGB uses the RGB-only value and Dimmer retains the full override value.
Disabling RGB-only falls back to the full override or native RGB values.
Its separate WebSocket owner resets on close, document load and server teardown.

`full-runtime.patch` is the complete delta from the pinned source, including
caption, Scene lifetime/autosave and same-name Function tree fixes. The build
script applies or verifies that cumulative patch, so overlapping intermediate
patches do not fail their reverse checks. `runtime-color.patch` contains only
the engine/Web RGB and fade changes for focused review.

Native regression tests run against an output-free workspace and cover native
flash output, idle fixtures, RGB Matrix isolation, fade in/out equivalence,
colour restoration and unchanged Scene XML, plus the prior caption/Undo tests.
`name-sync-test.exe` needs the rebuilt engine adjacent to it and the installed
Fixtures directory (a local junction is sufficient). The runner from
`../qlc-v5-name-sync/verify.py` rejects external output mappings.
