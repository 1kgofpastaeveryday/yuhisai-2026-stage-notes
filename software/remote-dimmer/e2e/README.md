# QLC+ 5.3.0 end-to-end checks on this Mac

Requires the installed official `/Applications/QLC+ 5.app`, Node 26, Go and Xcode. These runners use only simulator `<REDACTED>`. Derived data stays in the brief's scratchpad `DerivedData`. Run sequentially from the repository root, with ports 8765, 8766, 8767, 9998 and 9999 free. QLC+ windows appear; no GUI scripting is used.

```sh
node yuhisai-2026/remote-dimmer/e2e/run-live.mjs
node yuhisai-2026/remote-dimmer/e2e/run-live-moving.mjs
node yuhisai-2026/remote-dimmer/e2e/run-runtime5.mjs
```

`run-live.mjs` builds the backend and runs the gated `testLiveFader` against real QLC+ 5.3.0. `run-live-moving.mjs` builds the backend in scratchpad and runs `testLiveMoving` against real QLC+ by default. `--fake` retains the former test-double run:

```sh
node --test yuhisai-2026/remote-dimmer/e2e/fake-qlc5.test.mjs
node yuhisai-2026/remote-dimmer/e2e/run-live-moving.mjs --fake
```

The moving runner forwards app traffic from 8765 to the real backend on 8767 and records state/sequence/epoch messages. In real mode, a second observation-only bridge forwards backend QLC+ traffic from 9999 to real QLC+ on 9998. It records commands; slider/channel values are refreshed only from QLC+'s own `getWidgetStatus` and `getChannelsValues` replies. It never synthesizes QLC+ responses or channel values. `real-qlc5-wire.log` and `real-qlc5-readbacks.log` retain that evidence. `moving-observations.log` records every assertion group, and `moving-wire.log` records phone traffic. Logs are local test artifacts.

`run-runtime5.mjs` additionally checks Scene/slider HTP, Simple Desk override/reset, page boundary idempotence, startup clamp, holding axes against a newly started Scene, graceful release to a running Scene and to fixture defaults, a two-minute autosave observation, and a Monitor-on negative project. Its evidence is `runtime5-observations.log`. `--monitor-only` and `--pages-only` repeat those subsets in separate observation files. A Monitor-on same-value zero write is recorded as a failed unconditional audit expectation; a value-changing zero write demonstrates the override hazard. It uses the backend built by the dimmer runner.

`show5.qxw` uses two generic 1ch dimmers at addresses 1/2, sliders 45/46, and a Varytec Hero Spot 230 in 18 Channel mode at address 21. Its Pan/Pan fine/Tilt/Tilt fine are addresses 21/22/23/24; dimmer is 26, slider 47. Frame 120 has two pages, no looping and a hidden header. Function 0 sets dimmer 1 to 100; function 1 sets moving Pan=30000, Tilt=40000 and dimmer=100. All fades are zero. `show5-monitor.qxw` enables monitoring on slider 45 only, for the negative test. `show5-hidden.qxw` places slider 46 on the indicator frame's hidden second page to test output while invisible. Configurations for real runs are `config5.json` and `config-moving5.json`. The old `show.qxw` and configurations remain for the fake.

The moving validator's sole expected warning says Pan/Tilt groups cannot be verified from a workspace; their groups/presets live in the shipped `.qxf`, which must be checked separately. Configured travel ranges are test values, not real-fixture safety limits.

Simulator screenshots in real mode have a `-v5.png` suffix. Runners stop the backend, bridges and QLC+ (SIGTERM then SIGKILL if necessary), without saving over the project. The UI runners leave only the simulator client open; with no backend it displays disconnected. Moving assignments are cleared at shutdown. After an interrupted run, inspect `moving-assignments.json` before clearing it to `{}`.

Ordinary iOS tests run without a backend and skip gated live tests:

```sh
xcodebuild -project yuhisai-2026/remote-dimmer/ios/DimmerRemote.xcodeproj \
  -scheme DimmerRemote \
  -destination 'platform=iOS Simulator,id=<REDACTED>' \
  -derivedDataPath <PATH> \
  -parallel-testing-enabled NO test
```

The installed official app starts with `qlcplus5 -w show5.qxw`. `-p` aborts startup. Use `--web-port 9998` to select a port: the audited `-wp 9998` spelling also aborts in this binary. The web API cannot toggle VC edit mode or read the document-modified flag. These checks do not prove Windows-build behavior, physical iPhone gestures/haptics/latency, firewall enforcement from another host, or physical DMX/fixture output.
