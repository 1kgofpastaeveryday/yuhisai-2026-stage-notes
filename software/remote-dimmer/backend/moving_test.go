package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"io"
	"math"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func movingFixture(t *testing.T) Fixture {
	t.Helper()
	var f Fixture
	if err := json.Unmarshal([]byte(`{"name":"Spot L","kind":"moving","slider":47,"universe":1,"address":20,"pan":{"universe":1,"coarse":21,"fine":22,"min":10000,"max":50000},"tilt":{"universe":1,"coarse":23,"fine":24,"min":16000,"max":42000}}`), &f); err != nil {
		t.Fatal(err)
	}
	return f
}
func movingConfig(t *testing.T, q *fakeQLC) Config {
	c := testConfig(t, q)
	c.Fixtures = []Fixture{movingFixture(t)}
	return c
}
func expectGroup(t *testing.T, q *fakeQLC, f Fixture, b [4]int) {
	t.Helper()
	for i, ch := range f.axisChannels() {
		q.expect(t, fmt.Sprintf("CH|%d|%d", absolute(ch), b[i]))
	}
}
func movingSetup(t *testing.T, manual bool) (*Runtime, *fakeQLC, *httptest.Server, chan time.Time) {
	t.Helper()
	q := newFakeQLC(t)
	c := movingConfig(t, q)
	r, err := newRuntime(c, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	ticks := make(chan time.Time)
	if manual {
		r.outputTicks = ticks
	}
	r.start()
	s := httptest.NewServer(r.handler())
	t.Cleanup(func() { r.shutdown(); s.Close() })
	q.expect(t, "47|0")
	expectGroup(t, q, c.Fixtures[0], c.Fixtures[0].mapAim(0, 0))
	q.expect(t, "120|NEXT_PG")
	connected(t, r, true)
	return r, q, s, ticks
}
func TestMovingMapping(t *testing.T) {
	f := movingFixture(t)
	for _, swap := range []bool{false, true} {
		for _, ip := range []bool{false, true} {
			for _, it := range []bool{false, true} {
				f.SwapAxes, f.InvertPan, f.InvertTilt = swap, ip, it
				for _, xy := range [][2]float64{{0, 0}, {1, 1}, {.234, .876}, {.5, .5}} {
					b := f.mapAim(xy[0], xy[1])
					p, tilt := b[0]<<8|b[1], b[2]<<8|b[3]
					a, c := xy[0], xy[1]
					if swap {
						a, c = c, a
					}
					if ip {
						a = 1 - a
					}
					if it {
						c = 1 - c
					}
					if p != int(math.Round(10000+a*40000)) || tilt != int(math.Round(16000+c*26000)) {
						t.Fatal(b)
					}
					x, y := f.unmapAim(b)
					if math.Abs(x-xy[0]) > 1.0/26000 || math.Abs(y-xy[1]) > 1.0/26000 {
						t.Fatal(x, y)
					}
				}
			}
		}
	}
	f.Pan.Universe = 4
	f.Pan.Coarse = 512
	if absolute(f.axisChannels()[0]) != 2048 {
		t.Fatal("absolute channel")
	}
}
func TestMovingConfig(t *testing.T) {
	good := movingConfig(t, nil)
	if err := good.validate(); err != nil {
		t.Fatal(err)
	}
	changes := []func(*Fixture){
		func(f *Fixture) { f.Kind = "other" }, func(f *Fixture) { f.GainX = 0 }, func(f *Fixture) { f.GainY = -1 }, func(f *Fixture) { f.GainY = math.NaN() },
		func(f *Fixture) { f.StripSide = "top" }, func(f *Fixture) { f.StripToggle = "double" }, func(f *Fixture) { f.Acceleration.LowSpeed = f.Acceleration.HighSpeed },
		func(f *Fixture) { f.Acceleration.MaxMultiplier = .9 }, func(f *Fixture) { f.Acceleration.FilterMs = 0 }, func(f *Fixture) { f.Acceleration.HighSpeed = math.Inf(1) },
		func(f *Fixture) { f.Pan.Min = -1 }, func(f *Fixture) { f.Pan.Max = 65536 }, func(f *Fixture) { f.Pan.Max = f.Pan.Min }, func(f *Fixture) { f.Tilt.Universe = 5 }, func(f *Fixture) { f.Tilt.Fine = 0 },
		func(f *Fixture) { f.Pan.Fine = f.Pan.Coarse }, func(f *Fixture) { f.Tilt.Coarse = f.Pan.Coarse }, func(f *Fixture) { f.Pan.Fine = f.Address },
	}
	for i, change := range changes {
		c := good
		c.Fixtures = append([]Fixture{}, good.Fixtures...)
		change(&c.Fixtures[0])
		if c.validate() == nil {
			t.Fatalf("case %d accepted", i)
		}
	}
	c := good
	c.Fixtures = append(append([]Fixture{}, good.Fixtures...), Fixture{Name: "dimmer", Slider: 48, Universe: 1, Address: 21})
	if c.validate() == nil {
		t.Fatal("axis/dimmer overlap accepted")
	}
	f := good.Fixtures[0]
	if f.GainX != .35 || f.GainY != .35 || f.StripSide != "left" || f.StripToggle != "tap" || f.Acceleration != defaultAcceleration() {
		t.Fatal(f)
	}
	path := filepath.Join(t.TempDir(), "config.json")
	b, _ := json.Marshal(good)
	if err := os.WriteFile(path, b, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadConfig(path); err != nil {
		t.Fatal(err)
	}
}
func TestDimmerStateBytesUnchanged(t *testing.T) {

	r, err := newRuntime(testConfig(t, nil), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	p := &phone{device: Device{ID: "K7Q2MX", IP: "127.0.0.1"}, keyHash: mustDigest(t, testKey(1))}
	checkV2State(t, r.state(p), 0)
	r.bindings[p.device.ID] = p.keyHash
	r.assignments["中央"] = p.device.ID
	r.connected = true
	r.fixtures[0].level = 178
	checkV2State(t, r.state(p), 1)

}

func TestMovingGatesAndAssignmentEpoch(t *testing.T) {

	r, err := newRuntime(movingConfig(t, nil), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if err := r.changeAssignment("Spot L", "K7Q2MX", false); err == nil || err.Error() != "moving fixtures are not supported by the app" {
		t.Fatal(err)
	}
	// Even an internally injected legacy assignment cannot expose or control moving heads.
	p := &phone{device: Device{ID: "K7Q2MX"}, keyHash: mustDigest(t, testKey(1)), updates: make(chan State, 1)}
	r.phones[p.device.ID] = p
	r.bindings[p.device.ID] = p.keyHash
	r.assignments["Spot L"] = p.device.ID
	r.connected = true
	f := r.fixtures[0]
	f.ready = true
	r.renewEpoch(f)
	seq := int64(1)
	x, y := .25, .75
	level := 123
	for _, kind := range []string{"aim", "set", "on", "off"} {
		r.apply(p, message{Type: kind, Fixture: f.Name, ControlEpoch: f.epoch, Seq: &seq, X: &x, Y: &y, Level: &level})
	}
	if f.level != 0 || f.pendingAim != nil || f.pendingLevel != nil || len(p.sequences) != 0 {
		t.Fatal("moving command accepted")
	}
	checkV2State(t, r.state(p), 0)
	epoch := f.epoch
	if err := r.changeAssignment(f.Name, "", true); err != nil {
		t.Fatal(err)
	}
	if f.epoch == epoch {
		t.Fatal("release did not revoke legacy moving queue")
	}

}

func TestMovingGroupCoalescingAndFlushGates(t *testing.T) {

	r, q, s, ticks := movingSetup(t, true)
	// Exercise retained internal transport without granting phone authority.
	client := hello(t, s, "K7Q2MX")
	client.packet(t, "state")
	r.mu.Lock()
	p := r.phones["K7Q2MX"]
	p.hasSeq, p.seq = true, 20
	f := r.fixtures[0]
	r.assignments[f.Name] = p.device.ID
	r.renewEpoch(f)
	for seq := int64(1); seq <= 20; seq++ {
		f.pendingAim = &movingCommand{phone: p, epoch: f.epoch, fixture: f.Name, seq: seq, bytes: f.mapAim(float64(seq)/20, .5)}
	}
	r.mu.Unlock()
	ticks <- time.Now()
	expectGroup(t, q, f.Fixture, f.mapAim(1, .5))
	r.mu.Lock()
	p.seq = 21
	f.pendingLevel = &movingCommand{phone: p, epoch: f.epoch, fixture: f.Name, seq: 21, level: 77}
	r.mu.Unlock()
	ticks <- time.Now()
	q.expect(t, "47|77")
	r.mu.Lock()
	f.pendingLevel = &movingCommand{phone: p, epoch: f.epoch, fixture: f.Name, seq: 21, level: 150}
	r.renewEpoch(f)
	p.seq = 22
	f.pendingLevel = &movingCommand{phone: p, epoch: f.epoch, fixture: f.Name, seq: 22, level: 78}
	r.mu.Unlock()
	ticks <- time.Now()
	q.expect(t, "47|78")
	r.shutdown()
	q.expect(t, "47|0")
	for _, ch := range f.axisChannels() {
		q.expect(t, fmt.Sprintf("QLC+API|sdResetChannel|%d", absolute(ch)))
	}
	q.expect(t, "120|PREV_PG")

}

func TestMovingLockRules(t *testing.T) {
	for _, lost := range []bool{false, true} {
		t.Run(fmt.Sprint(lost), func(t *testing.T) {
			r, err := newRuntime(movingConfig(t, nil), io.Discard)
			if err != nil {
				t.Fatal(err)
			}
			f := r.fixtures[0]
			r.connected = true
			f.ready, f.owned = true, true
			r.renewEpoch(f)
			epoch := f.epoch
			start := time.Now()
			f.axesSentAt = start
			f.axesLast = f.mapAim(.5, .5)
			b := f.axesLast
			held := [4]bool{true, true, true, true}
			if lost {
				held[2] = false
			} else {
				b[1]++
			}
			r.observeAxes(0, b, held, start.Add(-time.Millisecond), start.Add(time.Second))
			if f.axisMisses[1] != 0 || f.axisMisses[2] != 0 {
				t.Fatal("stale sample")
			}
			r.observeAxes(0, b, held, start, start.Add(200*time.Millisecond))
			r.observeAxes(0, b, held, start, start.Add(400*time.Millisecond))
			if f.locked {
				t.Fatal("locked before settle")
			}
			r.observeAxes(0, f.axesLast, [4]bool{true, true, true, true}, start, start.Add(450*time.Millisecond))
			r.observeAxes(0, b, held, start, start.Add(600*time.Millisecond))
			if f.locked {
				t.Fatal("locked on first mismatch")
			}
			r.observeAxes(0, b, held, start, start.Add(800*time.Millisecond))
			if !f.locked || f.epoch == epoch || f.owned {
				t.Fatal("failed to revoke ownership")
			}
		})
	}
}
func TestMovingStartupCrashAndReconnect(t *testing.T) {
	q := newFakeQLC(t)
	c := movingConfig(t, q)
	f := c.Fixtures[0]
	// Crash residue is held, outside both calibrated safe ranges.
	q.mu.Lock()
	for i, ch := range f.axisChannels() {
		q.outputs[ch] = [4]int{0, 1, 255, 255}[i]
		q.overrides[ch] = true
	}
	q.mu.Unlock()
	r, _ := setup(t, c)
	q.expect(t, "47|0")
	target := f.mapAim(0, 1)
	expectGroup(t, q, f, target)
	q.expect(t, "120|NEXT_PG")
	connected(t, r, true)
	r.mu.Lock()
	if !r.fixtures[0].ready || r.fixtures[0].x != 0 || r.fixtures[0].y != 1 {
		t.Fatal("startup coordinates or ownership")
	}
	r.mu.Unlock()
	// Reconnect must adopt new current output, including axes no longer held.
	conn := <-q.connections
	q.online(false)
	_ = conn.CloseNow()
	connected(t, r, false)
	q.mu.Lock()
	for i, ch := range f.axisChannels() {
		q.outputs[ch] = f.mapAim(.5, .5)[i]
		q.overrides[ch] = false
	}
	q.mu.Unlock()
	q.online(true)
	q.expect(t, "47|0")
	expectGroup(t, q, f, f.mapAim(.5, .5))
	q.expect(t, "120|NEXT_PG")
	connected(t, r, true)
	eventually(t, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		f := r.fixtures[0]
		return f.ready && f.x == .5 && f.y == .5
	})
	snap := r.status()
	if snap.Fixtures[0].Pan16 != 30000 || !snap.Fixtures[0].Owned {
		t.Fatal(snap)
	}
	var html bytes.Buffer
	if err := statusTemplate.Execute(&html, snap); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(html.String(), "30000") {
		t.Fatal("status missing pan")
	}
	r.shutdown()
	q.expect(t, "47|0")
	for _, ch := range f.axisChannels() {
		q.expect(t, fmt.Sprintf("QLC+API|sdResetChannel|%d", absolute(ch)))
	}
	q.expect(t, "120|PREV_PG")
	q.mu.Lock()
	defer q.mu.Unlock()
	for _, ch := range f.axisChannels() {
		if q.overrides[ch] {
			t.Fatal("stop held channel")
		}
	}
}
func TestMovingPollLockAndNoReset(t *testing.T) {
	for _, lost := range []bool{false, true} {
		t.Run(fmt.Sprint(lost), func(t *testing.T) {
			r, q, _, _ := movingSetup(t, false)
			r.mu.Lock()
			epoch := r.fixtures[0].epoch
			r.mu.Unlock()
			q.mu.Lock()
			if lost {
				q.overrides[[2]int{1, 22}] = false
			} else {
				q.outputs[[2]int{1, 22}]++
			}
			q.mu.Unlock()
			eventually(t, func() bool { return r.status().Fixtures[0].Locked })
			r.mu.Lock()
			if r.fixtures[0].epoch == epoch {
				t.Fatal("lock epoch")
			}
			r.mu.Unlock()
			conn := <-q.connections
			q.online(false)
			_ = conn.CloseNow()
			connected(t, r, false)
			q.online(true)
			q.expect(t, "120|NEXT_PG")
			connected(t, r, true)
			r.shutdown()
			q.expect(t, "47|0")
			q.expect(t, "120|PREV_PG")
		})
	}
}
func TestMovingPatchWarning(t *testing.T) {
	f := movingFixture(t)
	// Project patch verification is independent of the slider warning path.
	path := filepath.Join(t.TempDir(), "show.qxw")
	project := `<Workspace xmlns="` + workspaceNS + `"><Engine><Fixture><ID>1</ID><Universe>0</Universe><Address>19</Address><Channels>5</Channels><Mode>16bit</Mode></Fixture></Engine></Workspace>`
	if err := os.WriteFile(path, []byte(project), 0600); err != nil {
		t.Fatal(err)
	}
	warnings := validateProject(Config{Project: path, Fixtures: []Fixture{f}})
	if !strings.Contains(strings.Join(warnings, "\n"), "groups cannot be verified") {
		t.Fatal(warnings)
	}
	f.Tilt.Fine = 26
	warnings = validateProject(Config{Project: path, Fixtures: []Fixture{f}})
	if !strings.Contains(strings.Join(warnings, "\n"), "must belong to one") {
		t.Fatal(warnings)
	}
}

func TestMovingSocketEpochAndPendingDisconnect(t *testing.T) {

	r, q, s, ticks := movingSetup(t, true)
	client := hello(t, s, "K7Q2MX")
	client.packet(t, "state")
	r.mu.Lock()
	f := r.fixtures[0]
	p := r.phones["K7Q2MX"]
	r.assignments[f.Name] = p.device.ID
	r.renewEpoch(f)
	epoch := f.epoch
	p.seq = 1
	p.hasSeq = true
	f.pendingLevel = &movingCommand{phone: p, epoch: epoch, fixture: f.Name, seq: 1, level: 199}
	r.mu.Unlock()
	_ = client.conn.CloseNow()
	client.closed(t)
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return len(r.phones) == 0 })
	r.mu.Lock()
	if f.epoch == epoch || f.pendingLevel != nil {
		t.Fatal("disconnect did not revoke queue")
	}
	r.mu.Unlock()
	ticks <- time.Now()
	c := <-q.connections
	q.online(false)
	_ = c.CloseNow()
	connected(t, r, false)
	q.online(true)
	q.expect(t, "47|0")
	expectGroup(t, q, f.Fixture, f.mapAim(0, 0))
	q.expect(t, "120|NEXT_PG")
	connected(t, r, true)

}

func TestMovingReadbackAndStopOrder(t *testing.T) {
	r, q, _, _ := movingSetup(t, false)
	q.mu.Lock()
	before := len(q.traffic)
	q.mu.Unlock()
	r.shutdown()
	eventually(t, func() bool {
		q.mu.Lock()
		defer q.mu.Unlock()
		return len(q.traffic) > before && q.traffic[len(q.traffic)-1] == "120|PREV_PG"
	})
	q.mu.Lock()
	defer q.mu.Unlock()
	// Reset page snapshots must be consumed before the final exact axis readback.
	if !r.zeroed || r.fixtures[0].owned {
		t.Fatalf("stop failed to verify release: zeroed=%t owned=%t", r.zeroed, r.fixtures[0].owned)
	}
	traffic := strings.Join(q.traffic[before:], "\n")
	want := "47|0\nQLC+API|getWidgetStatus|47\nQLC+API|sdResetChannel|21\nQLC+API|sdResetChannel|22\nQLC+API|sdResetChannel|23\nQLC+API|sdResetChannel|24\nQLC+API|getChannelsValues|1|21|4\n120|PREV_PG"
	if !strings.Contains(traffic, want) {
		t.Fatalf("stop did not zero/read/reset/read in order:\n%s", traffic)
	}
}
func TestMovingStartupReadbackMismatch(t *testing.T) {
	q := newFakeQLC(t)
	c := movingConfig(t, q)
	f := c.Fixtures[0]
	q.mu.Lock()
	q.onFrame = func(frame qlcFrame) {
		if frame.text == "CH|24|128" {
			q.mu.Lock()
			q.pollReplies = map[string]string{"QLC+API|getChannelsValues|1|21|4": "QLC+API|getChannelsValues|21|39|0.#000000|1|22|16|0.#000000|1|23|62|0.#000000|1|24|128|0.#000000|0"}
			q.mu.Unlock()
		}
	}
	q.mu.Unlock()
	r, _ := setup(t, c)
	q.expect(t, "47|0")
	expectGroup(t, q, f, f.mapAim(0, 0))
	q.expect(t, "120|NEXT_PG")
	connected(t, r, true)
	r.mu.Lock()
	if r.fixtures[0].ready {
		t.Fatal("unconfirmed startup ownership became ready")
	}
	r.mu.Unlock()
	q.mu.Lock()
	q.pollReplies = nil
	q.onFrame = nil
	q.mu.Unlock()
}
func TestMovingNoncontiguousMultiUniverseReadback(t *testing.T) {
	q := newFakeQLC(t)
	f := movingFixture(t)
	f.Pan.Universe = 2
	f.Pan.Coarse = 50
	f.Pan.Fine = 49
	f.Tilt.Universe = 3
	f.Tilt.Coarse = 50
	f.Tilt.Fine = 51
	q.mu.Lock()
	for i, ch := range f.axisChannels() {
		q.outputs[ch] = i + 31
		q.overrides[ch] = true
	}
	q.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, q.url(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	replies := make(chan string, 16)
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			_, b, err := c.Read(ctx)
			if err != nil {
				return
			}
			replies <- string(b)
		}
	}()
	defer func() { cancel(); _ = c.CloseNow(); <-done }()
	b, held, err := readAxes(ctx, c, replies, f)
	if err != nil || b != ([4]int{31, 32, 33, 34}) || held != ([4]bool{true, true, true, true}) {
		t.Fatal(b, held, err)
	}
	q.mu.Lock()
	q.pollReplies = map[string]string{"QLC+API|getChannelsValues|2|49|2": "QLC+API|getChannelsValues|49|32|0|50|31|0"}
	q.mu.Unlock()
	if _, _, err := readAxes(ctx, c, replies, f); err == nil {
		t.Fatal("v4 shape accepted")
	}
}
func TestMovingPendingAuthorityRecheck(t *testing.T) {
	r, err := newRuntime(movingConfig(t, nil), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	f := r.fixtures[0]
	p := &phone{device: Device{ID: "K7Q2MX"}, hasSeq: true, seq: 3}
	r.phones[p.device.ID] = p
	r.assignments[f.Name] = p.device.ID
	r.connected = true
	f.ready = true
	r.renewEpoch(f)
	pending := &movingCommand{phone: p, epoch: f.epoch, fixture: f.Name, seq: 2}
	if !r.validMoving(f, pending) {
		t.Fatal("fresh authority rejected")
	}
	for _, mutate := range []func(){func() { r.connected = false }, func() { r.closing = true }, func() { f.ready = false }, func() { f.locked = true }, func() { pending.epoch = "old" }, func() { pending.fixture = "other" }, func() { r.assignments[f.Name] = "AAAAAA" }, func() { r.phones[p.device.ID] = &phone{} }, func() { pending.seq = 4 }} {
		mutate()
		if r.validMoving(f, pending) {
			t.Fatal("stale output authority accepted")
		}
		r.connected = true
		r.closing = false
		f.ready = true
		f.locked = false
		pending.epoch = f.epoch
		pending.fixture = f.Name
		r.assignments[f.Name] = p.device.ID
		r.phones[p.device.ID] = p
		pending.seq = 2
	}
}

func TestMovingStopWithUnansweredPoll(t *testing.T) {
	r, q, _, _ := movingSetup(t, false)
	// Consume startup traffic so the next widget query is the deliberately held poll.
	draining := true
	for draining {
		select {
		case <-q.polls:
		default:
			draining = false
		}
	}
	q.mu.Lock()
	q.pollReplies = map[string]string{"QLC+API|getWidgetStatus|47": ""}
	q.mu.Unlock()
	select {
	case frame := <-q.polls:
		if frame != "QLC+API|getWidgetStatus|47" {
			t.Fatal(frame)
		}
	case <-time.After(time.Second):
		t.Fatal("missing held poll")
	}
	r.shutdown()
	q.expect(t, "47|0")
	q.expect(t, "120|PREV_PG")
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.zeroed {
		t.Fatal("unconfirmed stop reported verified")
	}
}
func TestDimmerStillRejectsAim(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.packet(t, "state")
	p.send(t, map[string]any{"type": "aim", "seq": 1, "x": .5, "y": .5})
	p.packet(t, "rejected")
	p.closed(t)
}

// A moving packet can already be in flight when the operator assigns a dimmer.
// It must neither mutate the new fixture nor consume its next sequence number.
func TestStaleMovingMutationAfterDimmerAssignment(t *testing.T) {
	for _, kind := range []string{"set", "on", "off", "aim"} {
		t.Run(kind, func(t *testing.T) {
			q := newFakeQLC(t)
			r, s := setup(t, testConfig(t, q))
			startup(t, q, r)
			p := hello(t, s, "K7Q2MX")
			p.packet(t, "state")
			assign(t, s, "K7Q2MX", "中央", 200)
			p.packet(t, "state")
			p.send(t, map[string]any{"type": "set", "seq": 1, "level": 7})
			p.state(t, func(s State) bool { return s.Level == 7 })
			q.expect(t, "45|7")
			p.send(t, map[string]any{"type": kind, "fixture": "Spot L", "controlEpoch": "old-moving-epoch", "seq": 2, "level": 200, "x": .9, "y": .1})
			// The same seq on a valid dimmer packet is a processing barrier.
			p.send(t, map[string]any{"type": "set", "seq": 2, "level": 8})
			p.state(t, func(s State) bool { return s.Level == 8 })
			q.expect(t, "45|8")
		})
	}
}
