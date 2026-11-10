# remote-dimmer backend — implementation plan

`../DESIGN.md` (Japanese) explains the owner's intent. This file is the implementation spec and is authoritative for protocol fields, message formats, timings, and behavior details. Where this file is more specific than DESIGN.md, follow this file. Stop and report only if this file contradicts an intent stated in DESIGN.md (for example, which source wins, or what the operator can do), not for differences in wording or level of detail.

## What it is

A small Go server that lets each lighting operator control exactly one dimmer channel from their own iPhone. iPhones talk to this backend over Wi-Fi (WebSocket, JSON). The backend talks to QLC+ 5.3.0 over its built-in web API (WebSocket on localhost). Each operated dimmer has one QLC+ Virtual Console (VC) slider in Level mode bound to that single dimmer channel; the backend moves that slider.

```
iPhone --WS :8765 /ws--> backend --WS ws://127.0.0.1:9999/qlcplusWS--> QLC+ --USB-DMX--> dimmers
```

Priority (decided by the owner): direct QLC+ operation > Ableton > iPhone. Ableton and iPhones are not used at the same time; the backend is started for iPhone slots and stopped for Ableton slots. The backend does NOT lock iPhones when Ableton starts scenes. Instead, while it runs it shows a loud indicator inside QLC+ and on its own status page.

Must build and run on both Windows (amd64) and macOS (arm64) from one codebase. No cgo.

## QLC+ web API facts (target: QLC+ 5.3.0, source audit of tag `QLC+_5.3.0`, f0f302f)

- Start with `qlcplus5 -w <show.qxw>` (web access, default port 9999); `-wp <port>` also enables web access. Windows uses `qlcplus5.exe` from the install folder. The macOS bundle binary is `Contents/MacOS/qlcplus5`; the installed bundle path is unverified. v5 has no Operate mode or `-p` option; VC sliders write DMX regardless of edit mode.
- Messages are plain text frames, fields separated by `|`.
- Set a VC slider: send `<widgetID>|<value 0-255>`.
- Switch a multi-page VC frame: send `<frameID>|NEXT_PG` or `<frameID>|PREV_PG`. With page looping off, these are no-ops at the last/first page, so they are idempotent.
- Read a widget value: send `QLC+API|getWidgetStatus|<widgetID>`; reply is `QLC+API|getWidgetStatus|<widgetID>|<value>`.
- Read channel output: send `QLC+API|getChannelsValues|<universe 1-based>|<address 1-based>|1`; reply is `QLC+API|getChannelsValues|<address>|<value>|<type>|<isOverride>` (exactly six parts for one channel, unlike v4's five). `isOverride` reports Simple Desk ownership and is not used by the backend yet. The value is the Simple Desk value if Simple Desk holds the channel, else the merged pre-Grand-Master universe value.
- QLC+ pushes `FUNCTION|<id>|Running` / `FUNCTION|<id>|Stopped` to all clients. Ignore them (no auto-lock by design), but do not treat them as errors.
- QLC+ pushes `<id>|SLIDER|<value>|<display>` only after `GET /vc.json` wires widget signals; loading a project clears that wiring. Do not rely on pushes; poll instead. Ignore unknown messages.
- In v5 any DMX write to a monitored slider, including a web write, enables forced-LTP Override priority. iPhone sliders must have channel monitoring off: `<SliderMode>` must omit `Monitor` or set it to exactly `false`. A present attribute with any other value enables monitoring.
- v5 saves looping on as `<Multipage PagesLoop="True" .../>`, omitting the attribute when off. Its loader treats any present `PagesLoop` attribute as on. The legacy sibling `<PagesLoop>` element is also accepted.
- The indicator frame is visible only while its VC page is selected. Every page command marks the project modified, even at an endpoint; source inference: the three-second refresh restarts the 30-second autosave timer indefinitely. Save before starting the backend.
- Without `-wa`, QLC+ has no auth. Port 9999 will be blocked from the LAN by the OS firewall (operations doc, not code).

## Config (`config.json`)

```json
{
  "listen": ":8765",
  "qlcURL": "ws://127.0.0.1:9999/qlcplusWS",
  "project": "<PATH>",
  "indicatorFrame": 120,
  "assignmentsFile": "assignments.json",
  "logFile": "remote-dimmer.log",
  "fixtures": [
    { "name": "中央", "slider": 45, "universe": 1, "address": 9 }
  ]
}
```

Validate at startup and refuse to start on: duplicate `name`, `slider`, or (`universe`,`address`); empty fixtures. `project` is used only in step 2.

## Step 1 — core runtime

1. Device identity and server-side assignment (owner decision 2026-10-15: who operates which fixture is decided on the server, never on the phone).
   - Each iPhone generates a device ID once and keeps it (Keychain): 6 characters of Crockford base32 (`0-9A-HJKMNP-TV-Z`), shown to the operator. The server treats it as the identity; IP addresses are informational only (they can change with DHCP and iOS private Wi-Fi addresses).
   - Assignments are persisted in `assignmentsFile` (JSON map fixture name to device ID, written atomically via temp file + rename). One device = at most one fixture; one fixture = at most one device. Assigning a fixture that already has a device, or a device that already has a fixture, is an error (release first).
   - Admin endpoints, accepted only from loopback addresses: `GET /admin/devices` (every currently connected device: ID, remote IP, assigned fixture or null, connected since), `POST /admin/assign` `{"device":"K7Q2MX","fixture":"中央"}`, `POST /admin/release` `{"fixture":"中央"}`. CLI subcommands `remote-dimmer devices`, `remote-dimmer assign <device> <fixture>`, `remote-dimmer release <fixture>` call these endpoints and print the result.
   - Assigning or releasing takes effect immediately for a connected phone (push `state`). Releasing does not change the light level of that fixture.
   - The same device connecting again replaces its older connection (close the old one).
   - Keep assign/release as one internal operation that both the HTTP admin endpoints and the CLI go through. A host iPhone app may later call the same operation over the LAN with its own authentication; do not build that now.
2. Phone WebSocket at `/ws` (JSON text frames).
   - Client to server: `{"type":"hello","device":"K7Q2MX","app":"<version>"}`, `{"type":"set","level":0-255,"seq":<int>}`, `{"type":"on","seq":<int>}`, `{"type":"off","seq":<int>}`.
   - Server to client: `{"type":"state","device":"K7Q2MX","ip":"<remote IP as seen by server>","fixture":"中央" or null,"level":0,"on":false,"active":true,"overridden":false,"qlc":"connected" or "disconnected"}` right after a valid `hello` and whenever any field changes; `{"type":"rejected","reason":"bad_request"}` then close for a malformed hello or a device ID that is not 6 valid Crockford base32 characters; `{"type":"shutdown"}` before closing on graceful exit.
   - An unassigned device stays connected with `fixture:null`, `active:false`, and appears in `/admin/devices`.
   - `seq` is per connection; drop messages whose seq is not greater than the last applied one.
   - `off` sets level 0 and remembers the last non-zero level; `on` restores it (255 if none). `on` is derived as `level > 0`.
   - `active` is true only when the device is assigned and QLC+ is connected (step 2 adds the direct-touch lock). Drop `set/on/off` while not active.
   - Send WebSocket pings every 2 s; drop connections that miss pongs for 6 s. Dropping a phone does NOT change its level.
   - Messages before a successful `hello`, other than `hello`, get `bad_request`.
3. QLC+ client.
   - Connect to `qlcURL`; on failure retry every 1 s forever. Report connection state to phones (`qlc` field).
   - Keep the latest desired level per slider; a 30 Hz ticker sends only sliders whose desired level changed since the last send. Never queue stale intermediate values.
   - On every (re)connect: send the current desired level of every fixture (all 0 right after process start), then `<indicatorFrame>|NEXT_PG`. Re-send `NEXT_PG` every 3 s while running.
4. Start and shutdown.
   - Process start: all desired levels are 0 (do not restore previous levels from disk).
   - On os.Interrupt and SIGTERM (Go delivers Windows console close/logoff/shutdown events as SIGTERM; confirm in Go docs and note it in RESULTS.md): send `shutdown` to phones, set every fixture slider to 0, send `<indicatorFrame>|PREV_PG`, wait until those frames are written (bounded, at most 2 s), then exit 0.
5. Log one line per event to `logFile` and stdout: time, fixture, device ID, event (hello/rejected/assign/release/set/on/off/disconnect/qlc_connect/qlc_disconnect/shutdown), value, source (`phone`/`admin`/`system`).
6. Tests (`go test ./...` must pass, no network beyond loopback): use an in-process fake QLC+ WebSocket server and fake phone clients to cover: assignment rules (unassigned device stays connected and is listed, assign pushes state to the connected phone, both one-to-one violations rejected, release pushes fixture null and keeps the light level, assignments survive restart, same-device reconnect replacing the old connection, loopback-only admin, malformed device ID rejected), seq dropping, on/off memory, 30 Hz coalescing (many sets → one send of the latest value per tick), zero-on-connect plus `NEXT_PG`, QLC+ reconnect re-sending levels, graceful shutdown order (phones notified, sliders zeroed, `PREV_PG`), dropping set/on/off while QLC+ is disconnected.

## Step 2 — detection, validation, status page (separate dispatch)

1. Direct-touch lock: poll `getWidgetStatus` for each fixture slider at 5 Hz. If the polled value differs from the last value the backend sent on two consecutive polls, and the backend sent nothing to that slider in the previous 500 ms, mark the fixture locked: `active=false`, `overridden=true`, adopt the QLC+ value as the fixture level, log `qlc_direct`. The lock clears only on backend restart.
2. Override display: poll `getChannelsValues` for each fixture at 5 Hz. If the output differs from the backend's level (same two-poll / 500 ms rule), set `overridden=true` but keep `active` unchanged; clear when they match again. (Catches Simple Desk overrides and leftover scenes; cannot see Grand Master.)
3. `.qxw` validation at startup and whenever the file's mtime changes (check every 2 s). The file is XML with namespace `http://www.qlcplus.org/Workspace`. For each fixture: a `<Slider ID="<slider>">` exists under `<VirtualConsole>`; its `<SliderMode>` text is `Level` and `Monitor` is absent or exactly `false`; its `<Level>` element contains exactly one `<Channel Fixture="<fid>"><ch></Channel>`; that fixture's `<Universe>`(0-based) and `<Address>`(0-based) plus `ch` equal the config `universe`/`address` (1-based); `<Level LowLimit>` is 0 and `HighLimit` is 255. The indicator frame: a `<Frame ID="<indicatorFrame>">` with `<Multipage PagesNum="2" ...>` and page looping off. Problems are warnings (log + status page), never a refusal to run.
4. Status page `GET /status` (loopback only) and `GET /status.json`. Full-screen; while the backend runs, a red banner "iPhone 稼働中　Ableton の前にサーバーを止める". Table per fixture: name, assigned device ID or none, whether that device is connected and its IP, level %, active, overridden, locked, last change time and source. A second table lists connected devices that have no fixture (ID, IP, connected since). Each unassigned device row has a fixture dropdown and an assign button, and each fixture row has a release button; they call the loopback admin endpoints. Shows QLC+ connection and validation warnings. The page polls `/status.json` every 1 s; if the fetch fails it turns grey with "サーバー応答なし（iPhone の値が QLC+ に残っている可能性あり）"; if the last payload said the server was shutting down, it shows "停止（0 に戻し済み）".
5. Config range checks (found in Step 1 review): refuse to start if `universe` is not 1-4, `address` is not 1-512, `slider` or `indicatorFrame` is negative, or `indicatorFrame` equals any fixture `slider`.
6. Log volume (found in Step 1 review): a phone drag produces up to 30 `set` events per second. Log `set` at most once per fixture per 500 ms, and always log the final value once the fixture has been still for 500 ms. Keep logging every `on`, `off`, assign, release, connect, disconnect, lock, and shutdown event unthrottled.
7. `README.md` in Japanese for the owner: how to start QLC+ (`qlcplus5 -w <show.qxw>`), firewall steps on Windows and macOS (block 9999 from LAN, allow 8765), how to run, `devices` / `assign` / `release`, the status page, and cross-compiling (`GOOS=windows GOARCH=amd64`, `GOOS=darwin GOARCH=arm64`).

## Rules for every dispatch

- Write only inside `yuhisai-2026/remote-dimmer/backend/`. Do not edit other files in the repo. Do not commit or push.
- Pure Go, no cgo. One WebSocket library is allowed (prefer `github.com/coder/websocket`). Go module downloads are allowed; installing system packages is not.
- Do not start long-running servers except inside tests.
- Before deviating from the plan or implementing more than it asks, stop and answer two questions in writing (results file / commit message): is the deviation actually right, and is there a simpler way that serves the UX better? If the answer is not a clear yes, do the planned scope only and list the idea as a follow-up.
- Finish with `RESULTS.md` in this directory: what was built, every file with a one-line summary, exact test commands and their output summary, deviations with the two answers above, and open questions.

## Moving heads

Moving fixtures follow [`../MOVING.md`](../MOVING.md), sections 3 and 4, including the moving-only protocol, Simple Desk ownership, startup and release. That spec takes precedence for moving fixtures. Dimmer fixtures retain the contract above; their phone messages contain no moving fields.
