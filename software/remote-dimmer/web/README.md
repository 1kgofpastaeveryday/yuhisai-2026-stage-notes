# Browser dimmer remote

Public link: https://knudg.com/yuhisai/2026/dimmer/

## Current venue checklist (2026-11-04, issue #31)

The owner confirmed that the Oct 29 meeting decided only the minimal Web
migration. Use the browser URL and the Windows show-host instructions below;
native iOS Ad Hoc/TestFlight distribution is not required for this route.

- Verify Windows backend, gateway, local admin and public-route connectivity on
  the venue Internet connection. Check which host owns the tunnel before switching.
- Decide the operators, their single-fixture assignments and how they receive cues.
  One browser supports one fixture; multiple assignments disable its controls.
- On the actual iPhone, verify registration, dimming, on/off, background/foreground
  recovery and reconnection. Verify the real lamp/address and DMX output.
- Rehearse switching between `261029-iphone-remote.qxw` and the other show files.
  Stop the remote backend before switching QLC+ projects; starting/stopping it
  requests zero levels for its configured channels. Integrated-show creation
  remains deferred until the owner requests it.

Source review plus isolated gateway/admin `go test -count=1`, `go vet`, and both
JavaScript syntax checks passed on Nov 4. This review started no live host or
tunnel and performed no physical iPhone/fixture test. Existing Oct 29 browser
test results below are historical evidence, not a Windows venue acceptance run.

Camera positions, the 30 m HDMI cable, adapters, ATEM and power are separate
setup checks in issues #9/#34. They were not completed by the Web migration.

The Mac hosts the HTML/CSS/JavaScript and a WebSocket relay on loopback port
8768. Cloudflare Tunnel forwards only the browser assets/socket there. A
separate `<HOST>-web` Worker owns only the dimmer path on knudg.com;
the existing stage/video Worker is unchanged. The relay connects to the
existing backend's public `/ws` on 8766. It never proxies the admin listener.
The backend, its assignments, and QLC+ remain the authority for light output.

## Try it now

1. Keep the Mac awake and connected; keep QLC+, the existing backend, gateway,
   and tunnel running.
2. Open the public link in Safari on the iPhone. No app installation is needed.
3. Read the six-character device ID. On this Mac open
   http://127.0.0.1:8765/status and assign exactly one dimmer to that ID.
   If another device owns the dimmer, use the admin console's
   “移す（明るさはそのまま）” action or `assign <new-device> <fixture>`.
   This transfers ownership directly and preserves brightness; do not release first.
4. Swipe the bar up/down to adjust brightness. In relative mode a tap toggles
   on/off; the explicit buttons do the same. Absolute fixtures follow the
   touched position in the bar. Keyboard arrows, Home, End also work.

The current live backend uses the pre-existing `中央` / `右` configuration.
This publication did not switch QLC+ projects or install the 14-fixture venue
configuration. Physical DMX/fixture output and a physical iPhone still need
an operator check.

One dimmer per browser is intentional. With two or more assignments, controls
are blocked until the Mac operator reduces the assignment to one. The server's
iOS multi-fixture support is unchanged. Use one tab per browser: tabs share the
same credential and a new connection replaces the older connection.

Credentials are generated with Web Crypto and stored in this origin's
localStorage, never in a URL or log. Reloading preserves the ID/key. Clearing
browser data, using a different browser/profile, or using a separate Home Screen
storage context may require registration again. The existing backend requires
operator approval of the observed key before accepting any control command.

The client sends at most one coalesced drag update per 34 ms, followed by the
final value on pointer-up. It drops pending input when assignment, mode,
connection, or visibility changes. A cancelled touch never toggles. There is
no offline command queue. Every two seconds, the relay checks the actual backend
socket with a protocol ping before returning an application pong; missing pongs
for 6.5 seconds disable controls and reconnect. Connection loss/tab closure
retains the backend level, following the existing backend policy.

## Restart

The existing backend must already expose `ws://127.0.0.1:8766/ws`. The original
`https://<HOST>/ws` iOS route is preserved by `tunnel.yml`.

`start-web.command` builds the gateway and starts it with the tunnel. It refuses
to start a second gateway/tunnel. Stop an existing Web gateway/Tunnel first;
do not stop QLC+ or the lighting backend just to update the Web UI. Ctrl+C in
the launcher stops Web hosting and its tunnel; it does not zero the lights.

The initial setup in this session is running as two foreground tool sessions,
not a login service. For a later restart, run `start-web.command` from Terminal.
The launcher requires Go and cloudflared on this Mac. Gateway flags:

```sh
/tmp/<HOST>-web -listen 127.0.0.1:8768 -upstream ws://127.0.0.1:8766/ws
cloudflared tunnel --config tunnel.yml run <HOST>
```

The tunnel YAML references this Mac's existing credential file; credentials are
not included here. Its exact whitelist includes only the three browser assets
and socket, plus the existing native `/ws`. `/status`, `/status.json`, and
`/admin/*` must remain inaccessible publicly.

Only the dedicated dimmer Worker needs deploying:

```sh
wrangler deploy --config wrangler.toml
```

## Windows show host (<HOST>)

Run these launchers in separate terminals, in order:

1. Prepare QLC+ on the same PC using
   `<PATH>`, Web API port 9999, and
   `<PATH>`.
2. Run `start-server.cmd` (uses `../venue/config.windows.json`).
3. Run `start-web.cmd` for the browser gateway and existing `<HOST>`
   tunnel. Before switching hosts, check `cloudflared tunnel info <HOST>`
   and stop the Mac connector yourself if it is active; two connectors split
   traffic between hosts.
4. Run `start-admin.cmd`, then open http://127.0.0.1:8769/.

Go and cloudflared must be on PATH. Builds, Go build cache, assignments, and
server logs stay under `<PATH>`. The Windows tunnel
config uses `<PATH><HOST>.json`;
credentials stay outside the repository. The native iPhone endpoint remains
`wss://<HOST>/ws`. Ctrl+C stops the launcher in that terminal;
stopping Web/admin leaves the backend running. Stopping the server requests
zero levels, as described in the backend README.

Firewall commands from `../backend/README.md`: **run as administrator, not yet applied**.

```powershell
New-NetFirewallRule -DisplayName "Remote dimmer QLC LAN block" -Direction Inbound -Action Block -Protocol TCP -LocalPort 9999 -Profile Any
New-NetFirewallRule -DisplayName "Remote dimmer phones" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -Profile Private
```

The phone rule requires the venue network to use the Private profile. Network
profile and firewall settings have not been changed by this setup.

## Verification

Validated on 2026-10-29: gateway Go race tests and vet passed. Chromium and
mobile WebKit passed the isolated control suite, including rapid touch toggles
and recovery after suspending the test relay. Both engines also reached the
public URL and received three backend-confirmed heartbeat pongs in seven
seconds. The deployed JavaScript SHA-256 matched the local final asset.
Existing backend PID 40014 and levels 195 / 130 were preserved.

The session transcript was captured as a private local review candidate; it has
not been fully reviewed or published. No commit or push was performed.

From `../backend`:

```sh
GOFLAGS=-buildvcs=false go test -race ./cmd/web-gateway
GOFLAGS=-buildvcs=false go vet ./cmd/web-gateway
GOFLAGS=-buildvcs=false go build -o /tmp/<HOST>-web ./cmd/web-gateway
GOFLAGS=-buildvcs=false go build -o /tmp/<HOST>-test-backend .
```

From the stages repository root, `node
yuhisai-2026/remote-dimmer/web/browser-test.mjs` uses isolated ports 18765,
18766, 18768 and 19999, a temporary credential directory, the real backend,
and the existing fake QLC test double. It never connects to live QLC+.
Set `PLAYWRIGHT_MODULE` if Playwright is installed elsewhere; optional
`CHROMIUM_EXECUTABLE` / `WEBKIT_EXECUTABLE` select installed browser binaries.

Cloudflare references used for this implementation:
[WebSocket response preservation](https://developers.cloudflare.com/workers/runtime-apis/response/)
and [Tunnel ingress path rules](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/).


## Local administration GUI

Open http://127.0.0.1:8769/ on this Mac. `start-admin.command` builds and starts
it separately from the browser gateway/tunnel. Stopping this GUI does not stop
the lighting backend or alter brightness. The old http://127.0.0.1:8765/status
page remains available.

The console includes the public-link QR (click to enlarge), copy-link button,
live device search, single-fixture assignment/release, credential deletion with
a confirmation dialog, fixture level meters/filtering, QLC state and warnings.
It displays server/transport state; a displayed level is not physical DMX proof.
Existing multi-fixture native assignments are shown with individual release
controls, while new console assignments are limited to one fixture per device.
Release sets that fixture's brightness to 0. Deleting a device registration
(`forget`) sets all fixtures assigned to that device to 0. Both console actions
ask for confirmation. To preserve brightness, move the fixture directly to
another connected device with no existing fixture using the assignment selector.

The console listens only on loopback. It rejects non-loopback Host/peer values
and browser cross-origin requests. Its proxy exposes only GET `/api/status` and
POST `/api/assign`, `/api/release`, `/api/forget`; there is no tunnel ingress or
public Worker route to port 8769. The public gateway is unchanged.

Fundamental Styles 0.42.0 and the SAP Horizon theme 11.36.5 are bundled locally,
including the six used 72 font faces; upstream licenses and modification notes
are in `backend/cmd/admin-console/admin/vendor/`.

On 2026-10-29, admin and gateway Go race tests passed, and admin vet passed.
`admin-browser-test.mjs` ran against isolated actual backend/fake QLC instances:
Chromium and WebKit passed device search, assignment/release, deletion cancel
and confirm, dropdown stability during polling, fixture filters and no horizontal
page overflow at 1440/1280/390 px. Both rendered QR images decoded with zbarimg
to `https://knudg.com/yuhisai/2026/dimmer/`. The unavailable-backend state also
passed. Live display was checked without changing assignments or brightness.
Physical iPhone scanning and operator use remain unverified.

Build the admin binary from `../backend` before running the integration script:

```sh
GOFLAGS=-buildvcs=false go build -o /tmp/<HOST>-admin ./cmd/admin-console
GOFLAGS=-buildvcs=false go test -race ./cmd/admin-console ./cmd/web-gateway
GOFLAGS=-buildvcs=false go vet ./cmd/admin-console
```

From the repository root: `node yuhisai-2026/remote-dimmer/web/admin-browser-test.mjs`.
It uses the same browser environment overrides as `browser-test.mjs` and
requires `zbarimg` for QR verification. Build the backend/gateway test binaries
as described above first. No live QLC+ ports are used by this integration test.


## Phone viewport and full-screen launch

The no-scroll/fullscreen request applies to the phone client, not the admin
console. The admin remains in its original scrolling layout, without the
fullscreen startup dialog or pagination introduced by the mistaken change.

The phone document now uses a fixed dynamic viewport, preventing page scrolling
in portrait and landscape. On browsers supporting the Fullscreen API, the default
entry offers one-click fullscreen and the footer toggles enter/exit, synchronized
with fullscreenchange. Windowed choice is remembered within the tab session.
Fullscreen/display changes cancel pending touches to avoid a brightness jump.

On unsupported browsers (including the tested mobile WebKit configuration), the
footer opens Home Screen installation instructions. iPhone users add the page
to the Home Screen and launch that icon to run without Safari's browser bars.
The manifest requests fullscreen with standalone fallback; the Apple capable
meta tag and app icon are also supplied. A Home Screen app cannot be converted
back to a normal Safari tab with the Fullscreen API; its Display settings explain
opening the same link in Safari instead. The actual behavior is feature-detected,
not based on user-agent strings. Safari and installed contexts may use separate
credentials, so assign the device ID shown in the context you will operate from.

No service worker/offline queue was added. Live socket connectivity and operator
approval are still required. Manifest and icon are the only added public paths;
admin APIs remain excluded.

`mobile-display-test.mjs` passed in Chromium and mobile WebKit with an isolated
mock socket: no scrolling, visible footer and positive fader area at 390×844,
320×568, 844×390, 568×320; native fullscreen entry/exit in the supporting engine;
non-support help and simulated installed-context behavior; manifest/icon checks.
The real-backend/fake-QLC control regression also passed in both engines.
Physical iPhone installation, standalone launch, and leaving it for Safari have
not been tested.

Apple standalone guidance:
https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html
