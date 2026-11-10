# Moving-head control — first-build spec (2026-10-16)

**Status (owner, 2026-10-16): not used in the 雄飛祭2026 show; the rental was dropped for cost.** The implementation is complete and verified against real QLC+ 5.3.0 (simulator app, Mac). It stays dormant: with no `kind: "moving"` fixture in config, phones and backend behave exactly as dimmer-only. Resume from section 6 if moving heads are used later.

Authoritative implementation spec for moving-head control in the iPhone app and the Go backend. The owner's intent is in `DESIGN.md` ("ムービングの操作", Japanese). This spec was converged in a three-round design review between Claude and Codex; the review files are kept outside the repo. Where this file and `backend/PLANS.md` differ for moving fixtures, this file wins. Dimmer fixtures are unchanged.

## Owner decisions this spec serves

- Moving-head control is activated from the server only: a phone shows the moving screen only when assigned to a fixture of kind `moving`. With no moving fixtures in config, nothing changes for anyone.
- It must be usable without app updates after the first TestFlight build, so every behavior we may need to switch after rehearsal ships in the first build behind a server field.
- Input is trackpad style (relative). Gyro and rate joystick are not built.
- The show runs on QLC+ 5.3.0. Moving heads are likely to be used in the show (owner, 2026-10-16); treat this as production.

## 1. Screen (iPhone)

- Orientation: the moving screen is locked to `UIInterfaceOrientation.landscapeLeft`. The unassigned/ID screen and the dimmer screen stay portrait. Info.plist supports portrait and landscapeLeft; the app chooses the allowed orientation per screen (app delegate `supportedInterfaceOrientationsFor` + `UIWindowScene.requestGeometryUpdate`). Do not rotate a SwiftUI subview inside a portrait scene. Input is disabled until the landscape layout is complete and a complete moving state has arrived. Leaving the moving screen (unassign, dimmer assignment, unknown kind) cancels input first, then returns to portrait.
- Control rectangle `R` = safe area inset 8 pt on every edge. Contacts that start outside `R` do nothing.
- Dimmer strip: 56 pt wide, full height of `R`, on the left (server `stripSide: "right"` mirrors it). Same deep amber fill as the dimmer screen, filled from the bottom by level, 1 pt amber border. 8 pt non-interactive gutter between strip and aiming area.
- Aiming area `A` = the rest of `R`. `W` = `A.width`.
- Dot: 10 pt diameter, drawn from the accepted `state.x/state.y` (x right, y up) inside `A` inset 6 pt. Grey when control is unavailable; keep the last dot greyed on disconnect; no dot before the first valid target. It is server-accepted intent, not beam position.
- Overlays inside `A`, never hit-testable: fixture name top centre (24 pt medium), percent below (36 pt monospaced digits), 12 pt top padding, 6 pt gap; the existing banners below, unchanged wording and colours; device ID / IP / server as a compact bottom-left block (12 pt text, 4 pt line spacing, 12 pt inset). No hints, buttons, or new copy (stop-describing-ui policy). Contacts that start on an overlay still aim.

## 2. Gestures (iPhone)

Implement touch handling in a UIKit view (`touchesBegan/Moved/Ended/Cancelled`, multiple touch enabled) wrapped for SwiftUI. Keep the gesture logic in a pure Swift type that is fed touch events, so it can be unit-tested.

- Role latching: each contact gets its role at touch-down (strip, aim, or ignored) and keeps it until it ends; crossing regions never changes it. At most one aim contact and one strip contact at a time; any further contact is ignored for its whole life and is never promoted later. System cancellation ends a contact with no toggle and no final movement.
- Aim: suppress motion until the contact has moved more than 2 pt from touch-down; at that sample reset the anchor to the current point and discard the displacement so far. Then for every sample with positive elapsed time (view `dy` positive down):

  ```
  x = clamp(x + gainX * m * dx / W, 0, 1)
  y = clamp(y - gainY * m * dy / W, 0, 1)
  ```

  Both axes use `W`. Clamp per increment, discard outward excess, always advance the anchor. No inertia, axis snapping, prediction or position smoothing. Aim taps, holds and lifts do nothing.
- Acceleration `m` (shipped, server-disabled by default; `m = 1` when disabled):

  ```
  speed = hypot(dx, dy) / (W * dtSeconds)
  a = 1 - exp(-dtSeconds / (filterMs / 1000))
  filteredSpeed += a * (speed - filteredSpeed)
  z = clamp((filteredSpeed - lowSpeed) / (highSpeed - lowSpeed), 0, 1)
  m = 1 + (maxMultiplier - 1) * (3z² - 2z³)
  ```

  Reset `filteredSpeed` at each new aim contact's slop crossing. Speed is filtered, position never.
- Strip: relative vertical, `faderTravel` points of finger travel = 255 levels, fractional accumulator, rounded only for the `set` message. A strip contact starts as a toggle candidate; once its cumulative path exceeds 4 pt it becomes a drag for the rest of its life (discard movement up to that sample) and can never toggle.
  - `stripToggle: "tap"` (default): on lift, toggle if elapsed ≤ 250 ms and path ≤ 4 pt.
  - `stripToggle: "hold"`: toggle once at 350 ms if still down and path ≤ 4 pt; the rest of that contact does nothing.
  - Toggle sends the existing `on`/`off` (by current level); the server restores the last non-zero level.
- Accumulation: keep a private command target `(x, y)`, initialised from the authoritative state when control starts. Send it as absolute `aim` messages. While local aim movement is pending or unacknowledged (`aimSeq` in state lower than the last sent aim seq), display/accumulate locally; once acknowledged with nothing pending, take the server's `x/y`. No 500 ms echo window for aim.
- Invalidation: any change of `fixture`, `kind`, `active`, `qlc`, `controlEpoch`, a disconnect, app backgrounding, or a layout change cancels all contacts and timers and drops unsent mutations. Control resumes only from the new authoritative state, after layout readiness, and only for a fresh touch-down; contacts still down never resume.
- Haptics (`UIImpactFeedbackGenerator`, light): one pulse when an aim increment first reaches or pushes against an x/y bound; that bound re-arms after the accepted target moves at least 0.02 inward; simultaneous bounds give one pulse; latches reset on epoch change. When operable control is lost: two light pulses 100 ms apart, once per loss (not at launch, not while unassigned, not per reconnect attempt).

## 3. Protocol additions

Dimmer fixtures keep the existing contract exactly.

`state` for a moving fixture adds:

| Field | Meaning, default |
|---|---|
| `kind` | `"dimmer"` or `"moving"`; absent = `"dimmer"`. Unknown kind → the phone shows the unassigned/ID screen with no controls. |
| `x`, `y` | Accepted target in screen space, finite, [0,1]. Required for moving; missing → input disabled. |
| `aimSeq` | Last accepted `aim` seq in this epoch, 0 initially. Dimmer messages do not advance it. |
| `controlEpoch` | Opaque string. Changes on socket replacement, any assignment change (also back to the same fixture), and lock. Required for moving. |
| `gainX`, `gainY` | Positive, default 0.35. |
| `stripSide` | `"left"` (default) or `"right"`. |
| `stripToggle` | `"tap"` (default) or `"hold"`. |
| `faderTravel` | Moving strip only: finger travel in points for a full 0–255 strip swipe, default 500 (about 8 cm; the owner chose 500 on the dimmer screen of a real iPhone, 2026-10-16, after full screen height was too slow and 300 too sensitive). The dimmer screen now uses its bar height instead (see `faderMode`). |
| `faderMode` | Dimmer screen only. Both modes draw a full-width level bar between the name/percentage and the device information block, as the owner marked on a real phone (clear of the top edge, Notification Center, and the bottom edge, home gesture). `"relative"` (default): a drag anywhere moves the level by finger travel, one bar height = 0–255, so the fill moves exactly with the finger and nothing jumps on touch; a tap anywhere toggles (owner, 2026-10-16: "the most intuitive"). `"absolute"`: the touched height in the bar is the level immediately; a tap outside the bar toggles (owner: wants the speed). Sent with every assigned state. |
| `acceleration` | `{enabled:false, lowSpeed:0.25, highSpeed:1.50, maxMultiplier:1.75, filterMs:40}` |

`active` covers both aim and the phone dimmer for a moving fixture. `overridden` keeps its dimmer meaning (banner only).

Phone → server for a moving fixture (one strictly increasing `seq` per socket across all of these; every one carries the fixture name and the current epoch):

```json
{"type":"aim","fixture":"Spot L","x":0.43,"y":0.58,"seq":22,"controlEpoch":"…"}
{"type":"set","fixture":"Spot L","level":160,"seq":23,"controlEpoch":"…"}
{"type":"off","fixture":"Spot L","seq":24,"controlEpoch":"…"}
{"type":"on","fixture":"Spot L","seq":25,"controlEpoch":"…"}
```

The server accepts a moving mutation only for the current socket, the current assignment name, the current epoch, `active=true`, a valid payload and an increasing seq; it rechecks assignment/epoch/active when flushing output. Non-finite x/y are rejected; finite values are clamped to [0,1]. The phone coalesces `aim` to the newest target and `set` to the newest level, each at most 30 Hz, without reordering discrete `on`/`off` (drop unsent `set`s that precede a toggle). A normal aim release sends the final target in the next slot; a cancelled one discards it.

## 4. Backend (QLC+ 5.3.0)

### Config for a moving fixture

Existing fields keep their meaning: `name`, `slider` (the fixture's dimmer VC Level slider, monitoring off), `universe`/`address` (the dimmer channel). New:

```json
{
  "name": "Spot L", "kind": "moving", "slider": 47, "universe": 1, "address": 20,
  "pan":  {"universe": 1, "coarse": 21, "fine": 22, "min": 10000, "max": 50000},
  "tilt": {"universe": 1, "coarse": 23, "fine": 24, "min": 16000, "max": 42000},
  "swapAxes": false, "invertPan": false, "invertTilt": false,
  "gainX": 0.35, "gainY": 0.35, "stripSide": "left", "stripToggle": "tap", "faderTravel": 500,
  "acceleration": {"enabled": false, "lowSpeed": 0.25, "highSpeed": 1.5, "maxMultiplier": 1.75, "filterMs": 40}
}
```

Addresses are 1-based within the universe (as for dimmers); the Simple Desk absolute channel is `(universe-1)*512 + address`. `min`/`max` are inclusive 16-bit DMX values, `0 ≤ min < max ≤ 65535`, and are the physically calibrated safe range on one continuous pan branch (values above are illustrative). Refuse to start on invalid moving config (bad enums, non-positive gains, `lowSpeed ≥ highSpeed`, `maxMultiplier < 1`, `filterMs ≤ 0`, overlapping or duplicate channels across fixtures, pan/tilt channels equal to a dimmer channel). `.qxw` validation (warning only): the four channels belong to one fixture and its channel groups are Pan/Tilt (coarse and fine) in the project.

Config is read only at startup.

### Output

Pan/tilt are written through Simple Desk, not a VC XY pad: in 5.3.0 an XY pad cannot be released over the web API, so after the iPhone slot every stopping Ableton scene would swing the head back to the pad position. Simple Desk holds the channels at the highest priority while the backend runs and is released once at stop.

```
(p, t) = (y, x) if swapAxes else (x, y)
if invertPan:  p = 1 - p
if invertTilt: t = 1 - t
pan16  = round(pan.min  + p * (pan.max  - pan.min))
tilt16 = round(tilt.min + t * (tilt.max - tilt.min))
```

Send `CH|<abs>|<byte>` for pan coarse, pan fine, tilt coarse, tilt fine, in that order, as one group; coalesce whole groups at 30 Hz (newest target only); never queue per-byte. Do not resend unchanged groups. Keep the accepted floating-point `x/y` for state echoes.

### Readback and lock

Poll the four channels (`QLC+API|getChannelsValues|<universe>|<address>|<count>`, 4 fields per channel: address, value, type, isOverride) at 5 Hz. While owned, each channel must read `isOverride=1` and the last written byte. Use the existing two-consecutive-polls and 500 ms-since-last-write rule before deciding. A mismatch or `isOverride=0` → lock the fixture (`active=false`, new epoch, stop all output for it, log `qlc_direct`), the same as a dimmer direct touch; the lock clears only on restart. Do not reassert or reset locked axes. The phone dimmer slider keeps the existing dimmer detection.

### Startup, per moving fixture

Precondition (operations, not code): the console operator has the head dark and has paused any cue that moves it, and does not touch these four Simple Desk channels while the backend runs.

1. Validate config/project; start inactive, no epoch, nothing queued.
2. Connect to QLC+, set the dimmer slider to 0 and read it back as 0.
3. Read the four channels. Whether or not Simple Desk already holds them (it does after a crash; restart-then-stop is the recovery rule, as for dimmer sliders), take the current 16-bit pan/tilt, clamp each into `[min, max]`, convert to `x/y` (inverse of the mapping above), and write that group. Clamping may move the head; the precondition makes that move dark. Read back: bytes match and `isOverride=1` on all four, else stay inactive and log which channels.
4. Initialise `x/y`, level 0, `aimSeq=0`; start polling; issue an epoch when a phone is assigned; publish `active=true`.

### Graceful stop, per moving fixture

Precondition (operations): the console operator has the head dark before stopping the backend, and has a park cue running that sets the head's pan/tilt (dimmer 0). Simple Desk keeps the axes while the backend runs, so starting the park cue changes nothing until release; at release the head goes to the park position. Without a running cue the axes go to the fixture default, which on the 5.3.0 test fixture (Varytec Hero Spot 230) was pan/tilt 0/0, a full swing to one corner (observed 2026-10-16, real QLC+ 5.3.0).

1. Go inactive, revoke epochs, reject phone mutations, drop queued output; let an in-flight group finish, then write nothing else for the fixture.
2. Write the dimmer slider 0 and read it back as 0.
3. If the fixture is locked, leave its axes untouched (log it). Otherwise send `QLC+API|sdResetChannel|<abs>` for pan coarse, pan fine, tilt coarse, tilt fine.
4. Read back `isOverride=0` on all four; report any channel still held. Releasing exposes the fixture default or the next scene's value; no position is preserved.

Phone disconnect alone: hold target and level, revoke that socket's epoch, drop its pending commands. QLC+ loss: disable control, drop pending output; on reconnect rerun startup step 3 for owned fixtures (lock stays).

## 5. Not in the first build

Stage-plane mapping, pan branch switching, gyro, rate joystick, axis snapping, inertia, smoothing, presets, home/recovery gestures, zoom/focus/colour, portrait moving layout, on-phone settings, configurable strip width, curve editors, automatic disconnect blackout.

## 6. Must be tested before show use

Smallest phone in landscape with both thumbs and simultaneous contacts; mapping/inversion and 16-bit precision on the real fixture; tracking latency (target: median finger-to-first-motion ≤ 100 ms, p95 ≤ 150 ms; above 300 ms p95 no live tracking by volunteers); A→B→A stale aim/dimmer rejection; takeover during a queued group; CH precedence over a running Ableton scene; dark startup and release; observed default/scene output after release; crash recovery (restart then stop). The owner's rehearsal plan (15 minutes per operator) and the DFS/Ableton slot ownership question live in the operations notes, not here.
