# Multiple fixtures per phone (protocol v2)

Owner decision 2026-10-29: one phone may control **up to 4 dimmers independently**; fixture names are always given by the server (config `fixtures[].name`). Moving heads are dropped ("ムービングは使わないから捨ててOK"): the app no longer contains any moving code, and the server never assigns a moving fixture to a phone. This file is the contract between `backend/` and `ios/`; DESIGN.md (Japanese) records the reasons.

The app build is frozen once installed on volunteers' phones (Ad Hoc). Everything the app does here must stay correct for any later server change that keeps this contract.

## Assignment (server)

- A fixture has at most one phone. A phone has 0–4 fixtures (`maxFixturesPerPhone = 4`, constant).
- Order on the phone = order of `fixtures` in config.json. The phone never sorts.
- `assignments.json` keeps its shape `{"<fixture name>": "<device ID>"}`; several fixtures may map to the same device.
- `/admin/assign {device, fixture}` succeeds when the fixture is free and the device has fewer than 4 fixtures. `/admin/release {fixture}` releases one fixture. Releasing never changes a level.
- Moving fixtures in config: assignment is refused with an error (`moving fixtures are not supported by the app`). Existing moving code paths may stay in the server but must be unreachable from phones.
- The status page lets the staff add fixtures to a device until it has 4, and release each one.

## Server → phone: `state`

Sent on hello and whenever anything in it changes (latest snapshot only, as today).

```json
{"type":"state","device":"B31EJ4","ip":"…","qlc":"connected",
 "fixtures":[
   {"name":"中央","level":178,"on":true,"active":true,"overridden":false,"faderMode":"relative"},
   {"name":"右","level":0,"on":false,"active":false,"overridden":true,"faderMode":"absolute"}
 ],
 "fixture":"中央","level":178,"on":true,"active":true,"overridden":false,"faderMode":"relative"}
```

- `fixtures` is always present (empty array when unassigned) and is authoritative. Each entry: `name` (string), `level` 0–255, `on` (= level > 0), `active` (QLC+ connected, server not closing, fixture not locked by a direct QLC+ touch), `overridden` (real output differs, or locked), `faderMode` (`relative` | `absolute`, default `relative`).
- The top-level `fixture`/`level`/`on`/`active`/`overridden`/`faderMode` mirror `fixtures[0]` (or `fixture: null` when empty) for older builds. New apps ignore them when `fixtures` is present.
- The app must ignore unknown keys and must tolerate an entry with an unknown `faderMode` (treat as `relative`). An entry with a missing or invalid `name`/`level`/`active`/`overridden` makes the whole message invalid → the app keeps its previous state and does **not** disconnect (log only). (Today a decode error drops the socket, which would loop forever against a slightly different server.)
- More than 4 entries: the app shows the first 4.

## Phone → server

- `hello {"type":"hello","device":ID,"key":KEY,"app":version,"proto":2}`. `key` is the per-phone secret (see the auth section in DESIGN.md); `proto` tells the server this client understands `fixtures`. The server may ignore both for now.
- `set {"type":"set","fixture":name,"level":0-255,"seq":n}`, `on {"type":"on","fixture":name,"seq":n}`, `off {"type":"off","fixture":name,"seq":n}`.
- `fixture` is required. The server applies a mutation only if that fixture is currently assigned to this phone, active, and `seq` is greater than the last accepted seq **for that fixture on this connection**. Missing `fixture` is accepted only when the phone has exactly one fixture (older builds).
- `seq` is one counter per connection, assigned when the message is actually written to the socket (as today), so it is strictly increasing in send order.
- `on` restores that fixture's last non-zero level (or 255), `off` sets 0; the server owns the remembered value per fixture (as today).

## App behaviour

### Sending
- Per fixture, at most one `set` every 33 ms (≈30/s, as today); later drag values replace a waiting `set` **only if the last queued message for that same fixture is a `set`** (so `[set F, off F]` followed by a new `set F` appends rather than rewriting history before the `off`).
- Different fixtures do not wait for each other's throttle.
- On disconnect, everything queued is dropped (as today).

### Local state
- Per fixture: displayed level, last non-zero level, dragging flag, last local change time, echo reconciliation 500 ms after the last local change (today's `reconcileLevel`, per fixture). A server `state` never moves a strip that is being dragged.
- When the set of assigned fixture names changes, strips for removed names disappear, new names appear with the server's level; a strip whose fixture stays keeps its gesture state **while the layout stays multi-strip**. Crossing between 1 and 2+ fixtures swaps the whole screen, so every in-progress drag is cancelled and the operator touches again (cross-review 2026-10-29: the swapped-out touch surface may never deliver a cancel, which would leave a fixture stuck "dragging"). On the 1-fixture screen, replacing fixture A with B rebuilds the screen, so A's touch never drives B.

### Layout
- 0 fixtures: today's unassigned screen (large device ID, IP/server rows, disconnect banner + Wi-Fi button).
- 1 fixture: **exactly today's screen** (`ControlPanel`: relative drag anywhere / absolute bar, tap to toggle, banners, info rows).
- 2–4 fixtures: portrait, the screen split into N equal-width vertical strips with thin gaps. Each strip, top to bottom: fixture name (server-given; up to 2 lines, scales down to fit), percentage, a reserved banner slot (same height whether or not a banner shows, so the bar height never changes), the level bar (fills the remaining height). Below all strips, the full-width info rows (device ID, IP, server) as today, not touchable. Above all strips, the full-width server-disconnected banner and the Wi-Fi button, shown only while disconnected.
- Per strip gestures, each strip independent and usable **at the same time with different fingers**:
  - `relative`: a vertical drag that starts anywhere inside the strip column changes that fixture by finger travel (strip bar height = 0–100%); a tap anywhere in the strip toggles that fixture.
  - `absolute`: touching inside that strip's bar sets the level from the touch height; a tap in the strip outside the bar toggles.
- Per-strip banner texts are the owner's existing three texts, unchanged, at a small size so they wrap inside the strip: locked → 「照明卓で直接操作されています。」, overridden → 「照明卓の操作が優先されています。」. Server disconnected uses the full-width banner 「サーバーから切断されています。」. QLC+ disconnected: strips grey, no banner (as today). No other copy.
- Inactive strip (not `active`, or server disconnected): grey fill, gestures ignored.
- Haptic on each fixture's on/off transition (as today, per fixture). Screen stays awake (as today).
- Accessibility: each strip is one adjustable element labelled with the fixture name, value = percentage, activate = toggle.

## Identity, key and authentication (Codex design review 2026-10-29, triaged by Claude)

App (frozen today):
- Keychain: create the ID or the key **only** when `SecItemCopyMatching` returns `errSecItemNotFound`. Any other read error → do not create, do not connect; retry the read on the next foreground/reconnect attempt (the screen shows the disconnected banner). After `SecItemAdd`, use the value only if it returned `errSecSuccess`; on `errSecDuplicateItem` re-read and use the stored value. Validate stored values (ID: the Crockford regex, 6 chars; key: base64url of exactly 32 bytes); an invalid stored value is treated like a read error, never silently replaced.
- The key uses `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (a phone restored from another phone's backup must not become a second copy of the same credential). The ID keeps `kSecAttrAccessibleAfterFirstUnlock` (existing items).
- The key is generated from `SecRandomCopyBytes` (32 bytes) and sent base64url (no padding) in every `hello`. It is never displayed or logged.
- Foreground: when the app leaves `.active`, all strips stop accepting input, queued messages are dropped, and an in-progress drag is cancelled. On `.active` the app always reconnects (force) and accepts input again only after the first `state` of the new connection.
- Default server: `wss://<HOST>/ws` (Cloudflare Tunnel, owner 2026-10-29 wants internet operation). The Settings value still overrides it. The venue Wi-Fi button is shown only while disconnected **and** the configured server host is a private IPv4 address (10/8, 172.16/12, 192.168/16): joining the internet-less lighting Wi-Fi would cut a phone off from the public server.

Server (may land after distribution, before 11/6; the public listener must not stay open without it):
- Validate `key` strictly (base64url, 32 bytes). Bindings `{deviceID: sha256(key)}` persist next to assignments (same temp-file + rename pattern).
- A hello for a bound ID with a missing or different key is rejected **before** touching `r.phones`, epochs or the existing connection; log `key_mismatch` without the key.
- Binding happens at assignment time, under the same lock as the assignment change, to the key of the connection that is currently open for that ID. If two different keys were seen for that ID in the last 60 s, or no connection is open, assignment is refused (the staff re-checks the phone in hand).
- Unbound IDs may connect (to show up in the list) but control nothing. An explicit admin `forget <ID>` removes the binding and releases that ID's fixtures.
- `publicListen` must be a loopback address (validated at startup).

Accepted residual risks (owner may revisit): the key is a bearer secret, so a `ws://` LAN connection carries it in clear text; an operator could be talked into typing a hostile `wss://` URL. Both are out of scope for this show.

## Mock states (`-mockState`)
Keep the existing dimmer mock scenarios (unassigned, active, activeAbsolute, off, overridden, locked, offline) and add `multi2` (two strips, one active, one overridden), `multi4` (four strips: active, off, locked, absolute). Remove `moving` and `movingLocked`.
