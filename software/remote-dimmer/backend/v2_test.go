package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/coder/websocket"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

func mustDigest(t *testing.T, key string) string {
	t.Helper()
	hash, ok := keyDigest(key)
	if !ok {
		t.Fatal("invalid test key")
	}
	return hash
}

func checkV2State(t *testing.T, s State, count int) {
	t.Helper()
	b, err := json.Marshal(s)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]json.RawMessage
	if err := json.Unmarshal(b, &wire); err != nil {
		t.Fatal(err)
	}
	if len(s.Fixtures) != count || string(wire["fixtures"]) == "null" || wire["fixtures"] == nil {
		t.Fatalf("bad fixtures: %s", b)
	}
	for _, field := range []string{"kind", "x", "y", "aimSeq", "controlEpoch", "gainX", "gainY", "stripSide", "stripToggle", "acceleration"} {
		if wire[field] != nil {
			t.Fatalf("moving field %s: %s", field, b)
		}
	}
	if count == 0 {
		if s.Fixture != nil || s.Active || s.Level != 0 || s.On || s.Overridden {
			t.Fatal(s)
		}
		return
	}
	f := s.Fixtures[0]
	if s.Fixture == nil || *s.Fixture != f.Name || s.Level != f.Level || s.On != f.On || s.Active != f.Active || s.Overridden != f.Overridden || s.FaderMode != f.FaderMode {
		t.Fatalf("mirror: %s", b)
	}
	var entries []map[string]any
	if err := json.Unmarshal(wire["fixtures"], &entries); err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if len(entry) != 6 {
			t.Fatal(entry)
		}
		for _, field := range []string{"name", "level", "on", "active", "overridden", "faderMode"} {
			if _, ok := entry[field]; !ok {
				t.Fatal(entry)
			}
		}
	}
}

func TestV2AssignmentsOrderLimitsAndPersistence(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	for i := 2; i < 5; i++ {
		c.Fixtures = append(c.Fixtures, Fixture{Name: fmt.Sprintf("F%d", i), Slider: 45 + i, Universe: 1, Address: 9 + i})
	}
	c.Fixtures[1].FaderMode = "absolute"
	r, s := setup(t, c)
	connected(t, r, true)
	p := hello(t, s, "K7Q2MX")
	checkV2State(t, p.packet(t, "state").State, 0)
	for _, index := range []int{3, 1, 2, 0} {
		assign(t, s, "K7Q2MX", c.Fixtures[index].Name, 200)
	}
	st := p.state(t, func(s State) bool { return len(s.Fixtures) == 4 })
	checkV2State(t, st, 4)
	for i, f := range st.Fixtures {
		if f.Name != c.Fixtures[i].Name || !f.Active || f.FaderMode != c.Fixtures[i].faderMode() {
			t.Fatal(st)
		}
	}
	assign(t, s, "K7Q2MX", "F4", 400)
	assign(t, s, "AAAAAA", "中央", 400)
	a, err := readAssignments(c)
	if err != nil || len(a) != 4 {
		t.Fatal(a, err)
	}
	next, err := newRuntime(c, io.Discard)
	if err != nil || !reflect.DeepEqual(next.assignments, r.assignments) || !reflect.DeepEqual(next.bindings, r.bindings) {
		t.Fatal("restart", err)
	}
	// A persisted fifth assignment is rejected too.
	a["F4"] = "K7Q2MX"
	if err := saveAssignments(c.AssignmentsFile, a); err != nil {
		t.Fatal(err)
	}
	if _, err := newRuntime(c, io.Discard); err == nil {
		t.Fatal("persisted limit bypass")
	}
}

func TestV2MutationRoutingAndLateReassignment(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	assign(t, s, "K7Q2MX", "左", 200)
	p.state(t, func(s State) bool { return len(s.Fixtures) == 2 })
	r.mu.Lock()
	session := r.phones["K7Q2MX"]
	r.mu.Unlock()
	apply := func(kind, name string, level int, seq int64) {
		r.apply(session, message{Type: kind, Fixture: name, Level: &level, Seq: &seq})
	}
	// Per-fixture acceptance, including independent counters and on/off memory.
	apply("set", "中央", 83, 10)
	apply("set", "左", 99, 1)
	apply("off", "中央", 0, 10)
	apply("set", "unknown", 200, 1000)
	apply("set", "", 200, 1001)
	apply("off", "左", 0, 2)
	apply("on", "左", 0, 3)
	r.mu.Lock()
	if r.fixtures[0].level != 83 || r.fixtures[1].level != 99 || len(session.sequences) != 2 {
		t.Fatal("routing or stale sequence")
	}
	r.mu.Unlock()
	// Invalid payloads and inactive mutations must not consume their sequence.
	apply("set", "中央", 256, 11)
	r.mu.Lock()
	r.fixtures[0].locked = true
	r.mu.Unlock()
	apply("off", "中央", 0, 11)
	r.mu.Lock()
	r.fixtures[0].locked = false
	r.mu.Unlock()
	apply("off", "中央", 0, 11)
	apply("on", "中央", 0, 12)
	other := hello(t, s, "AAAAAA")
	other.packet(t, "state")
	assign(t, s, "AAAAAA", "中央", 200)
	apply("set", "中央", 200, 5000) // Arrives after the old fixture has moved to another phone.
	apply("set", "", 100, 4)      // Legacy omission is valid with exactly one remaining fixture.
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fixtures[0].level != 83 || r.fixtures[1].level != 100 || session.sequences["中央"] != 12 {
		t.Fatal("late reassignment or legacy routing")
	}
	checkV2State(t, r.state(session), 1)
}

func TestV2AuthenticationProtectsLiveConnection(t *testing.T) {
	q := newFakeQLC(t)
	var logs bytes.Buffer
	r, err := newRuntime(testConfig(t, q), &logs)
	if err != nil {
		t.Fatal(err)
	}
	r.start()
	s := httptest.NewServer(r.handler())
	defer s.Close()
	defer r.shutdown()
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.state(t, func(s State) bool { return s.Active })
	r.mu.Lock()
	live := r.phones["K7Q2MX"]
	epoch := r.fixtures[0].epoch
	r.mu.Unlock()
	for _, key := range []string{"", testKey(2), testKey(1) + "=", "invalid"} {
		bad := dialPhone(t, s, map[string]any{"type": "hello", "device": "K7Q2MX", "key": key})
		if bad.packet(t, "rejected").Reason != "key_mismatch" {
			t.Fatal("wrong rejection")
		}
		bad.closed(t)
		r.mu.Lock()
		if r.phones["K7Q2MX"] != live || r.fixtures[0].epoch != epoch {
			t.Fatal("rejected key disturbed authority")
		}
		r.mu.Unlock()
	}
	command(t, r, p, "K7Q2MX", "set", 77, 1)
	p.state(t, func(s State) bool { return s.Level == 77 })
	replacement := hello(t, s, "K7Q2MX")
	replacement.state(t, func(s State) bool { return s.Active && s.Level == 77 })
	p.closed(t)
	r.shutdown()
	// A fresh runtime reads bindings before accepting a hello.
	restarted, restartedServer := setup(t, r.config)
	connected(t, restarted, true)
	wrong := dialPhone(t, restartedServer, map[string]any{"type": "hello", "device": "K7Q2MX", "key": testKey(2)})
	if wrong.packet(t, "rejected").Reason != "key_mismatch" {
		t.Fatal("restart forgot binding")
	}
	wrong.closed(t)
	correct := hello(t, restartedServer, "K7Q2MX")
	correct.state(t, func(s State) bool { return len(s.Fixtures) == 1 && s.Active && s.Level == 0 })
	if !strings.Contains(logs.String(), `"event":"key_mismatch"`) || strings.Contains(logs.String(), testKey(1)) || strings.Contains(logs.String(), testKey(2)) {
		t.Fatal("auth log content")
	}
}

func TestV2BindingConflictAndOpenConnection(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	assign(t, s, "K7Q2MX", "中央", 400)
	first := hello(t, s, "K7Q2MX")
	first.packet(t, "state")
	second := dialPhone(t, s, map[string]any{"type": "hello", "device": "K7Q2MX", "key": testKey(2)})
	checkV2State(t, second.packet(t, "state").State, 0)
	first.closed(t)
	assign(t, s, "K7Q2MX", "中央", 400)
	if r.status().Devices[0].Binding != "key conflict" {
		t.Fatal("conflict not visible")
	}
	r.mu.Lock()
	if len(r.assignments) != 0 || len(r.bindings) != 0 {
		t.Fatal("conflict bound")
	}
	now := time.Now()
	for hash := range r.seenKeys["K7Q2MX"] {
		r.seenKeys["K7Q2MX"][hash] = now.Add(-keyConflictWindow - time.Second)
	}
	r.observeKey("K7Q2MX", mustDigest(t, testKey(2)), now)
	r.mu.Unlock()
	assign(t, s, "K7Q2MX", "中央", 200)
	second.state(t, func(s State) bool { return s.Active })
	_ = second.conn.CloseNow()
	second.closed(t)
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return len(r.phones) == 0 })
	assign(t, s, "K7Q2MX", "左", 400)
	if r.status().Devices[0].Binding != "bound" {
		t.Fatal("binding status")
	}
}

func TestV2ForgetAndRestart(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	r, s := setup(t, c)
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	assign(t, s, "K7Q2MX", "左", 200)
	p.state(t, func(s State) bool { return len(s.Fixtures) == 2 })
	r.mu.Lock()
	session := r.phones["K7Q2MX"]
	r.mu.Unlock()
	v := 91
	seq := int64(1)
	r.apply(session, message{Type: "set", Fixture: "中央", Level: &v, Seq: &seq})
	v = 137
	r.apply(session, message{Type: "set", Fixture: "左", Level: &v, Seq: &seq})
	q.expect(t, "45|91")
	q.expect(t, "46|137")
	admin(t, s, "/admin/forget", map[string]string{"device": "K7Q2MX"}, 200)
	p.state(t, func(s State) bool { return len(s.Fixtures) == 0 })
	seq++
	r.apply(session, message{Type: "off", Fixture: "中央", Seq: &seq})
	r.mu.Lock()
	if r.fixtures[0].level != 0 || r.fixtures[1].level != 0 || len(r.assignments) != 0 || len(r.bindings) != 0 {
		t.Fatal("forget failed")
	}
	r.mu.Unlock()
	q.expect(t, "45|0")
	q.expect(t, "46|0")
	next, err := newRuntime(c, io.Discard)
	if err != nil || len(next.assignments) != 0 || len(next.bindings) != 0 {
		t.Fatal("forget persistence", err)
	}
	if r.status().Devices[0].Binding != "unbound" {
		t.Fatal("forget binding status")
	}
	// Both files are replaced atomically without leftover temporary files.
	leftovers, _ := filepath.Glob(filepath.Join(filepath.Dir(c.AssignmentsFile), ".assignments-*"))
	if len(leftovers) > 0 {
		t.Fatal(leftovers)
	}
}

func TestV2StrictKeysAndBadBindingsFailStartup(t *testing.T) {
	for _, key := range []string{"", testKey(1) + "=", testKey(1) + "\n", strings.Repeat("A", 42), strings.Repeat("A", 44), strings.Repeat("/", 43), testKey(1)[:42] + "F"} {
		if _, ok := keyDigest(key); ok {
			t.Fatalf("accepted invalid key %q", key)
		}
	}
	if _, ok := keyDigest(testKey(255)); !ok {
		t.Fatal("valid base64url key")
	}
	c := testConfig(t, nil)
	valid := mustDigest(t, testKey(1))
	for _, contents := range []string{"{", "null", "[]", `{"K7Q2MX":"bad"}`, `{"IIIIII":"` + valid + `"}`, `{"K7Q2MX":null}`, `{"K7Q2MX":"` + strings.ToUpper(valid) + `"}`, `{"K7Q2MX":"` + valid + `","K7Q2MX":"` + valid + `"}`, `{} {}`} {
		if err := os.WriteFile(c.bindingsFile(), []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := newRuntime(c, io.Discard); err == nil {
			t.Fatalf("accepted invalid bindings: %s", contents)
		}
	}
}

func TestV2UnboundCannotClaimOldAssignments(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	// Valid keys cannot claim assignments left over from the pre-authentication server.
	if err := saveAssignments(c.AssignmentsFile, map[string]string{"中央": "K7Q2MX"}); err != nil {
		t.Fatal(err)
	}
	r, s := setup(t, c)
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	checkV2State(t, p.packet(t, "state").State, 0)
	r.mu.Lock()
	session := r.phones["K7Q2MX"]
	r.mu.Unlock()
	seq := int64(1)
	r.apply(session, message{Type: "on", Fixture: "中央", Seq: &seq})
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fixtures[0].level != 0 {
		t.Fatal("unbound ID controlled old assignment")
	}
}

func TestV2PublicListenerAndMux(t *testing.T) {
	c := testConfig(t, nil)
	for _, address := range []string{":8766", "0.0.0.0:8766", "[::]:8766", "<HOST>:8766", "localhost:8766", "127.0.0.1", "example.com:8766"} {
		c.PublicListen = address
		if c.validate() == nil {
			t.Fatalf("accepted %s", address)
		}
	}
	for _, address := range []string{"", "127.0.0.1:0", "[::1]:0", "[::ffff:127.0.0.1]:0"} {
		c.PublicListen = address
		if err := c.validate(); err != nil {
			t.Fatal(err)
		}
	}
	r, err := newRuntime(c, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/", "/status", "/status.json", "/admin/devices", "/admin/assign", "/admin/release", "/admin/forget", "/ws/", "/ws/extra"} {
		for _, method := range []string{"GET", "POST"} {
			req := httptest.NewRequest(method, path, nil)
			req.RemoteAddr = "127.0.0.1:1234"
			w := httptest.NewRecorder()
			r.publicHandler().ServeHTTP(w, req)
			if w.Code != 404 {
				t.Fatalf("public %s %s=%d", method, path, w.Code)
			}
		}
	}
	req := httptest.NewRequest("GET", "/ws", nil)
	w := httptest.NewRecorder()
	r.publicHandler().ServeHTTP(w, req)
	if w.Code == 404 {
		t.Fatal("missing ws")
	}
}

// These tests exercise assignment, authorization, state, mutations and persistence
// without a listener, so they also run inside a sandbox which denies bind(2).
func TestV2CoreWithoutSockets(t *testing.T) {
	c := testConfig(t, nil)
	for i := 2; i < 5; i++ {
		c.Fixtures = append(c.Fixtures, Fixture{Name: fmt.Sprintf("F%d", i), Slider: 45 + i, Universe: 1, Address: 9 + i})
	}
	c.Fixtures[1].FaderMode = "absolute"
	r, err := newRuntime(c, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	r.connected = true
	if err := r.changeAssignment("中央", "K7Q2MX", false); err == nil {
		t.Fatal("assigned offline device")
	}
	p := unitPhone(t, "K7Q2MX", 1)
	r.phones[p.device.ID] = p
	checkV2State(t, r.state(p), 0)
	for _, i := range []int{3, 1, 2, 0} {
		if err := r.changeAssignment(c.Fixtures[i].Name, p.device.ID, false); err != nil {
			t.Fatal(err)
		}
	}
	if err := r.changeAssignment("F4", p.device.ID, false); err == nil {
		t.Fatal("fifth assignment")
	}
	st := r.state(p)
	checkV2State(t, st, 4)
	for i, f := range st.Fixtures {
		if f.Name != c.Fixtures[i].Name || f.FaderMode != c.Fixtures[i].faderMode() || !f.Active {
			t.Fatal(st)
		}
	}
	next, err := newRuntime(c, io.Discard)
	if err != nil || !reflect.DeepEqual(r.bindings, next.bindings) || !reflect.DeepEqual(r.assignments, next.assignments) {
		t.Fatal("persistence", err)
	}
	// Windows reports 0666 for any writable file: Go does not map ACLs to Unix mode bits.
	if mode, err := os.Stat(c.bindingsFile()); err != nil || (runtime.GOOS != "windows" && mode.Mode().Perm()&0077 != 0) {
		t.Fatal("binding permissions", err)
	}
	mutate := func(name, kind string, seq int64, level int) {
		r.apply(p, message{Type: kind, Fixture: name, Seq: &seq, Level: &level})
	}
	mutate("中央", "set", 10, 83)
	mutate("左", "set", 1, 99)
	mutate("中央", "off", 10, 0)
	mutate("unknown", "set", 1000, 200)
	mutate("", "set", 1001, 200)
	mutate("左", "off", 2, 0)
	mutate("左", "on", 3, 0)
	if r.fixtures[0].level != 83 || r.fixtures[1].level != 99 {
		t.Fatal("independent sequences, routing or memory")
	}
	mutate("中央", "set", 11, 256)
	r.fixtures[0].locked = true
	mutate("中央", "off", 11, 0)
	r.fixtures[0].locked = false
	if p.sequences["中央"] != 10 {
		t.Fatal("invalid or locked mutation consumed seq")
	}
	mutate("中央", "off", 11, 0)
	mutate("中央", "on", 12, 0)
	for _, name := range []string{"中央", "F2", "F3"} {
		if err := r.changeAssignment(name, "", true); err != nil {
			t.Fatal(err)
		}
	}
	other := unitPhone(t, "AAAAAA", 2)
	r.phones[other.device.ID] = other
	if err := r.changeAssignment("中央", other.device.ID, false); err != nil {
		t.Fatal(err)
	}
	mutate("中央", "set", 5000, 200)
	mutate("", "set", 4, 100)
	if r.fixtures[0].level != 0 || r.fixtures[1].level != 100 || p.sequences["中央"] != 12 {
		t.Fatal("late reassignment or legacy omission")
	}
	r.fixtures[1].overridden = true
	checkV2State(t, r.state(p), 1)
	if !r.state(p).Overridden || !r.state(p).Active {
		t.Fatal("override should retain control")
	}
	r.fixtures[1].locked = true
	if r.state(p).Active {
		t.Fatal("locked should not be active")
	}
	if err := r.forget(p.device.ID); err != nil {
		t.Fatal(err)
	}
	checkV2State(t, r.state(p), 0)
	if r.fixtures[1].level != 0 || r.bindings[p.device.ID] != "" || r.deviceView(p.device.ID).Binding != "unbound" {
		t.Fatal("forget")
	}
	mutate("左", "off", 9999, 0)
	if r.fixtures[1].level != 0 {
		t.Fatal("forgotten device mutated")
	}
	next, err = newRuntime(c, io.Discard)
	if err != nil || next.bindings[p.device.ID] != "" || next.assignments["左"] != "" {
		t.Fatal("forget restart", err)
	}
}

func unitPhone(t *testing.T, id string, key byte) *phone {
	t.Helper()
	return &phone{device: Device{ID: id}, keyHash: mustDigest(t, testKey(key)), conn: new(websocket.Conn), updates: make(chan State, 1)}
}

func TestV2ConflictWindowWithoutSockets(t *testing.T) {
	r, err := newRuntime(testConfig(t, nil), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	id := "K7Q2MX"
	first := mustDigest(t, testKey(1))
	second := mustDigest(t, testKey(2))
	now := time.Now()
	r.observeKey(id, first, now.Add(-59*time.Second))
	r.observeKey(id, second, now)
	if !r.keyConflict(id, now) {
		t.Fatal("lost conflict across replacement")
	}
	p := unitPhone(t, id, 2)
	r.phones[id] = p
	if err := r.changeAssignment("中央", id, false); err == nil {
		t.Fatal("bound conflicting device")
	}
	if len(r.bindings) != 0 || len(r.assignments) != 0 {
		t.Fatal("refusal changed persisted authority")
	}
	if r.deviceView(id).Binding != "key conflict" {
		t.Fatal("conflict status")
	}
	if r.keyConflict(id, now.Add(time.Second)) {
		t.Fatal("60s cutoff")
	}
	if err := r.changeAssignment("中央", id, false); err != nil {
		t.Fatal(err)
	}
	if r.deviceView(id).Binding != "bound" {
		t.Fatal("bound status")
	}
}

func TestV2PersistenceFailureWithoutSockets(t *testing.T) {
	c := testConfig(t, nil)
	r, err := newRuntime(c, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	p := unitPhone(t, "K7Q2MX", 1)
	r.phones[p.device.ID] = p
	// A directory cannot be replaced by a binding JSON file.
	if err := os.Mkdir(c.bindingsFile(), 0700); err != nil {
		t.Fatal(err)
	}
	if err := r.changeAssignment("中央", p.device.ID, false); err == nil {
		t.Fatal("ignored binding save failure")
	}
	if len(r.bindings) != 0 || len(r.assignments) != 0 {
		t.Fatal("memory changed after failed binding persistence")
	}
	if err := os.Remove(c.bindingsFile()); err != nil {
		t.Fatal(err)
	}
	if err := r.changeAssignment("中央", p.device.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(c.bindingsFile()); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(c.bindingsFile(), 0700); err != nil {
		t.Fatal(err)
	}
	if err := r.forget(p.device.ID); err == nil {
		t.Fatal("ignored forget save failure")
	}
	if len(r.assignments) != 0 || r.bindings[p.device.ID] == "" {
		t.Fatal("failed forget did not retain fail-closed authority")
	}
}

func TestV2StatusControlsWithoutSockets(t *testing.T) {
	r, err := newRuntime(testConfig(t, nil), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	p := unitPhone(t, "K7Q2MX", 1)
	r.phones[p.device.ID] = p
	if r.deviceView(p.device.ID).Binding != "unbound" {
		t.Fatal("unbound label")
	}
	if err := r.changeAssignment("左", p.device.ID, false); err != nil {
		t.Fatal(err)
	}
	if err := r.changeAssignment("中央", p.device.ID, false); err != nil {
		t.Fatal(err)
	}
	snapshot := r.status()
	if len(snapshot.Devices) != 1 || snapshot.Devices[0].Binding != "bound" || !reflect.DeepEqual(snapshot.Devices[0].Fixtures, []string{"中央", "左"}) {
		t.Fatal(snapshot.Devices)
	}
	var page bytes.Buffer
	if err := statusTemplate.Execute(&page, snapshot); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`data-release="中央"`, `data-release="左"`, `data-forget="K7Q2MX"`, `data-device="K7Q2MX"`, "bound"} {
		if !strings.Contains(page.String(), want) {
			t.Fatalf("missing %s", want)
		}
	}
	b, err := json.Marshal(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{testKey(1), p.keyHash} {
		if strings.Contains(string(b), secret) || strings.Contains(page.String(), secret) {
			t.Fatal("credential in status")
		}
	}
	if err := r.changeAssignment("左", "", true); err != nil {
		t.Fatal(err)
	}
	if err := r.changeAssignment("中央", "", true); err != nil {
		t.Fatal(err)
	}
	delete(r.phones, p.device.ID)
	d := r.status().Devices
	if len(d) != 1 || d[0].Connected || len(d[0].Fixtures) != 0 || d[0].Binding != "bound" {
		t.Fatal("offline binding cannot be forgotten from status")
	}
}
