package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/coder/websocket"
)

type qlcFrame struct {
	connection int
	text       string
}
type fakeQLC struct {
	server      *httptest.Server
	frames      chan qlcFrame
	connections chan *websocket.Conn
	mu          sync.Mutex
	traffic     []string
	count       int
	allow       bool
	onFrame     func(qlcFrame)
	widgets     map[int]int
	overrides   map[[2]int]bool
	outputs     map[[2]int]int
	polls       chan string
	pollReplies map[string]string // Override a query reply; empty means no reply.
}

func newFakeQLC(t *testing.T) *fakeQLC {
	t.Helper()
	q := &fakeQLC{frames: make(chan qlcFrame, 4096), connections: make(chan *websocket.Conn, 32), allow: true, widgets: map[int]int{}, overrides: map[[2]int]bool{}, outputs: map[[2]int]int{}, polls: make(chan string, 4096)}
	q.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q.mu.Lock()
		allow := q.allow
		q.mu.Unlock()
		if !allow {
			http.Error(w, "offline", 503)
			return
		}
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		q.mu.Lock()
		q.count++
		id := q.count
		q.mu.Unlock()
		q.connections <- c
		for {
			_, b, err := c.Read(r.Context())
			if err != nil {
				return
			}
			q.mu.Lock()
			q.traffic = append(q.traffic, string(b))
			q.mu.Unlock()
			parts := strings.Split(string(b), "|")
			if len(parts) >= 3 && parts[0] == "QLC+API" {
				q.polls <- string(b)
				key, _ := strconv.Atoi(parts[2])
				q.mu.Lock()
				if parts[1] == "sdResetChannel" {
					ch := [2]int{(key-1)/512 + 1, (key-1)%512 + 1}
					q.overrides[ch] = false
					// QLC+ 5 responds to resets with the current 32-slider page.
					reply := "QLC+API|getChannelsValues"
					for address := 1; address <= 32; address++ {
						held := 0
						if q.overrides[[2]int{1, address}] {
							held = 1
						}
						reply += fmt.Sprintf("|%d|%d|0.#000000|%d", address, q.outputs[[2]int{1, address}], held)
					}
					q.mu.Unlock()
					if err := c.Write(r.Context(), websocket.MessageText, []byte(reply)); err != nil {
						return
					}
					frame := qlcFrame{id, string(b)}
					q.frames <- frame
					continue
				}
				reply := ""
				if parts[1] == "getWidgetStatus" {
					reply = fmt.Sprintf("QLC+API|getWidgetStatus|%d|%d", key, q.widgets[key])
				} else if parts[1] == "getChannelsValues" {
					address, _ := strconv.Atoi(parts[3])
					count := 1
					if len(parts) > 4 {
						count, _ = strconv.Atoi(parts[4])
					}
					reply = "QLC+API|getChannelsValues"
					for j := 0; j < count; j++ {
						ch := [2]int{key, address + j}
						value, ok := q.outputs[ch]
						if !ok {
							value = q.widgets[address+j+36]
						}
						held := 0
						if q.overrides[ch] {
							held = 1
						}
						reply += fmt.Sprintf("|%d|%d|0.#000000|%d", address+j, value, held)
					}
				}
				override, overridden := q.pollReplies[string(b)]
				q.mu.Unlock()
				if overridden {
					reply = override
				}
				if reply == "" {
					continue
				}
				if err := c.Write(r.Context(), websocket.MessageText, []byte(reply)); err != nil {
					return
				}
				continue
			}
			if len(parts) == 3 && parts[0] == "CH" {
				abs, _ := strconv.Atoi(parts[1])
				v, _ := strconv.Atoi(parts[2])
				ch := [2]int{(abs-1)/512 + 1, (abs-1)%512 + 1}
				q.mu.Lock()
				q.outputs[ch] = v
				q.overrides[ch] = true
				q.mu.Unlock()
			}
			if len(parts) == 2 {
				slider, e1 := strconv.Atoi(parts[0])
				value, e2 := strconv.Atoi(parts[1])
				if e1 == nil && e2 == nil {
					q.mu.Lock()
					q.widgets[slider] = value
					q.mu.Unlock()
				}
			}
			frame := qlcFrame{id, string(b)}
			q.mu.Lock()
			observe := q.onFrame
			q.mu.Unlock()
			if observe != nil {
				observe(frame)
			}
			q.frames <- frame
		}
	}))
	t.Cleanup(q.server.Close)
	return q
}

func (q *fakeQLC) url() string       { return "ws" + strings.TrimPrefix(q.server.URL, "http") }
func (q *fakeQLC) online(allow bool) { q.mu.Lock(); q.allow = allow; q.mu.Unlock() }
func (q *fakeQLC) expect(t *testing.T, text string) qlcFrame {
	t.Helper()
	select {
	case f := <-q.frames:
		if f.text != text {
			t.Fatalf("QLC+ frame = %q, want %q", f.text, text)
		}
		return f
	case <-time.After(4 * time.Second):
		t.Fatalf("missing QLC+ frame %q", text)
	}
	return qlcFrame{}
}

func testConfig(t *testing.T, q *fakeQLC) Config {
	t.Helper()
	url := "ws://127.0.0.1:0"
	if q != nil {
		url = q.url()
	}
	return Config{Listen: "127.0.0.1:0", QLCURL: url, IndicatorFrame: 120, AssignmentsFile: filepath.Join(t.TempDir(), "assignments.json"), Fixtures: []Fixture{{Name: "中央", Slider: 45, Universe: 1, Address: 9}, {Name: "左", Slider: 46, Universe: 1, Address: 10}}}
}

func setup(t *testing.T, c Config) (*Runtime, *httptest.Server) {
	t.Helper()
	r, err := newRuntime(c, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	r.start()
	s := httptest.NewServer(r.handler())
	t.Cleanup(func() { r.shutdown(); s.Close() })
	return r, s
}

func eventually(t *testing.T, f func() bool) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		if f() {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("condition not reached")
}

func connected(t *testing.T, r *Runtime, expected bool) {
	t.Helper()
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return r.connected == expected })
}

func startup(t *testing.T, q *fakeQLC, r *Runtime) *websocket.Conn {
	t.Helper()
	var c *websocket.Conn
	select {
	case c = <-q.connections:
	case <-time.After(4 * time.Second):
		t.Fatal("QLC+ did not connect")
	}
	q.expect(t, "45|0")
	q.expect(t, "46|0")
	q.expect(t, "120|NEXT_PG")
	connected(t, r, true)
	return c
}

type phonePacket struct {
	State
	Reason string `json:"reason"`
}
type fakePhone struct {
	conn    *websocket.Conn
	packets chan phonePacket
	done    chan struct{}
}

func dialPhone(t *testing.T, s *httptest.Server, hello any) *fakePhone {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	p := &fakePhone{c, make(chan phonePacket, 4096), make(chan struct{})}
	t.Cleanup(func() { _ = c.CloseNow(); <-p.done })
	go func() {
		defer close(p.done)
		for {
			_, b, err := c.Read(context.Background())
			if err != nil {
				return
			}
			var packet phonePacket
			if json.Unmarshal(b, &packet) == nil {
				p.packets <- packet
			}
		}
	}()
	p.send(t, hello)
	return p
}
func testKey(n byte) string { return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{n}, 32)) }

func hello(t *testing.T, s *httptest.Server, id string) *fakePhone {
	return dialPhone(t, s, map[string]any{"type": "hello", "device": id, "app": "test", "key": testKey(1), "proto": 2})
}
func (p *fakePhone) send(t *testing.T, v any) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	if err = p.conn.Write(ctx, websocket.MessageText, b); err != nil {
		t.Fatal(err)
	}
}
func (p *fakePhone) state(t *testing.T, match func(State) bool) State {
	t.Helper()
	timer := time.NewTimer(4 * time.Second)
	defer timer.Stop()
	for {
		select {
		case v := <-p.packets:
			if v.Type == "state" && match(v.State) {
				return v.State
			}
		case <-timer.C:
			t.Fatal("missing phone state")
			return State{}
		}
	}
}
func (p *fakePhone) packet(t *testing.T, kind string) phonePacket {
	t.Helper()
	select {
	case v := <-p.packets:
		if v.Type != kind {
			t.Fatalf("packet = %+v, want %s", v, kind)
		}
		return v
	case <-time.After(4 * time.Second):
		t.Fatalf("missing %s", kind)
	}
	return phonePacket{}
}
func (p *fakePhone) closed(t *testing.T) {
	t.Helper()
	select {
	case <-p.done:
	case <-time.After(4 * time.Second):
		t.Fatal("phone still connected")
	}
}
func admin(t *testing.T, s *httptest.Server, path string, body any, want int) []byte {
	t.Helper()
	method := "POST"
	if body == nil {
		method = "GET"
	}
	b, _ := json.Marshal(body)
	req, err := http.NewRequest(method, s.URL+path, bytes.NewReader(b))
	if err != nil {
		t.Fatal(err)
	}
	resp, err := s.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	result, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != want {
		t.Fatalf("%s = %d: %s", path, resp.StatusCode, result)
	}
	return result
}
func assign(t *testing.T, s *httptest.Server, d, f string, want int) {
	t.Helper()
	admin(t, s, "/admin/assign", map[string]string{"device": d, "fixture": f}, want)
}
func command(t *testing.T, r *Runtime, p *fakePhone, id, kind string, level int, seq int64) {
	t.Helper()
	p.send(t, map[string]any{"type": kind, "level": level, "seq": seq})
	eventually(t, func() bool {
		r.mu.Lock()
		defer r.mu.Unlock()
		return r.phones[id] != nil && r.phones[id].sequences["中央"] == seq
	})
}

func TestAssignmentLifecycle(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	r, s := setup(t, c)
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	initial := p.packet(t, "state")
	if initial.Fixture != nil || initial.Active || initial.QLC != "connected" || initial.Device != "K7Q2MX" || net.ParseIP(initial.IP) == nil {
		t.Fatalf("initial = %+v", initial)
	}
	var devices []Device
	if err := json.Unmarshal(admin(t, s, "/admin/devices", nil, 200), &devices); err != nil {
		t.Fatal(err)
	}
	if len(devices) != 1 || devices[0].ID != "K7Q2MX" || devices[0].Fixture != nil || devices[0].Since.IsZero() {
		t.Fatalf("devices = %+v", devices)
	}
	assign(t, s, "K7Q2MX", "中央", 200)
	p.state(t, func(s State) bool { return s.Fixture != nil && *s.Fixture == "中央" && s.Active })
	assign(t, s, "AAAAAA", "中央", 400)
	assign(t, s, "K7Q2MX", "中央", 400) // Fixture already held; multiple different fixtures are allowed.
	command(t, r, p, "K7Q2MX", "set", 99, 1)
	p.state(t, func(s State) bool { return s.Level == 99 })
	q.expect(t, "45|99")
	admin(t, s, "/admin/release", map[string]string{"fixture": "中央"}, 200)
	p.state(t, func(s State) bool { return s.Fixture == nil && !s.Active })
	r.mu.Lock()
	level := r.fixtures[0].level
	r.mu.Unlock()
	if level != 0 {
		t.Fatalf("release did not zero level: %d", level)
	}
	q.expect(t, "45|0")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.state(t, func(s State) bool { return s.Fixture != nil && s.Level == 0 })
	command(t, r, p, "K7Q2MX", "set", 99, 2)
	p.state(t, func(s State) bool { return s.Level == 99 })
	q.expect(t, "45|99")
	replacement := hello(t, s, "K7Q2MX")
	replacement.state(t, func(s State) bool { return s.Fixture != nil && s.Level == 99 })
	p.closed(t)
	// Disconnecting and reconnecting does not change the desired level.
	_ = replacement.conn.CloseNow()
	replacement.closed(t)
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return len(r.phones) == 0 })
	next, err := newRuntime(c, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if next.assignments["中央"] != "K7Q2MX" || next.fixtures[0].level != 0 {
		t.Fatal("assignment persistence or zero-on-start failed")
	}
	r.shutdown()
	q.expect(t, "45|0")
	q.expect(t, "46|0")
	q.expect(t, "120|PREV_PG")
	r2, s2 := setup(t, c)
	startup(t, q, r2)
	afterRestart := hello(t, s2, "K7Q2MX")
	afterRestart.state(t, func(s State) bool { return s.Fixture != nil && *s.Fixture == "中央" && s.Active && s.Level == 0 })
}

func TestSequenceAndOnOff(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.packet(t, "state")
	command(t, r, p, "K7Q2MX", "on", 0, 0)
	p.state(t, func(s State) bool { return s.Level == 255 && s.On })
	command(t, r, p, "K7Q2MX", "set", 83, 2)
	p.state(t, func(s State) bool { return s.Level == 83 })
	// A later valid command acts as a read barrier after both stale messages.
	p.send(t, map[string]any{"type": "set", "level": 12, "seq": 2})
	p.send(t, map[string]any{"type": "off", "seq": 1})
	command(t, r, p, "K7Q2MX", "off", 0, 3)
	p.state(t, func(s State) bool { return s.Level == 0 && !s.On })
	command(t, r, p, "K7Q2MX", "off", 0, 4)
	command(t, r, p, "K7Q2MX", "on", 0, 5)
	p.state(t, func(s State) bool { return s.Level == 83 })
	r.mu.Lock()
	level, memory := r.fixtures[0].level, r.fixtures[0].lastNonzero
	r.mu.Unlock()
	if level != 83 || memory != 83 {
		t.Fatalf("level=%d memory=%d", level, memory)
	}
	// Sequence numbers belong to the connection, not the persistent device identity.
	p2 := hello(t, s, "K7Q2MX")
	p2.packet(t, "state")
	p.closed(t)
	command(t, r, p2, "K7Q2MX", "set", 17, -1)
	p2.state(t, func(s State) bool { return s.Level == 17 })
}

func TestQLCReconnectAndInactiveCommands(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	conn := startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.packet(t, "state")
	command(t, r, p, "K7Q2MX", "set", 87, 1)
	p.state(t, func(s State) bool { return s.Level == 87 })
	q.expect(t, "45|87")
	q.online(false)
	_ = conn.CloseNow()
	p.state(t, func(s State) bool { return s.QLC == "disconnected" && !s.Active && s.Level == 87 })
	for _, kind := range []string{"set", "on", "off"} {
		p.send(t, map[string]any{"type": kind, "level": 11, "seq": 100})
	}
	// The same read loop processes this invalid type after all three commands.
	p.send(t, map[string]string{"type": "barrier"})
	p.packet(t, "rejected")
	p.closed(t)
	r.mu.Lock()
	value := r.fixtures[0].level
	r.mu.Unlock()
	if value != 87 {
		t.Fatalf("inactive command changed level: %d", value)
	}
	p2 := hello(t, s, "K7Q2MX")
	p2.state(t, func(s State) bool { return s.QLC == "disconnected" })
	q.online(true)
	select {
	case <-q.connections:
	case <-time.After(4 * time.Second):
		t.Fatal("no reconnect")
	}
	if f := q.expect(t, "45|87"); f.connection != 2 {
		t.Fatalf("connection = %d", f.connection)
	}
	q.expect(t, "46|0")
	q.expect(t, "120|NEXT_PG")
	p2.state(t, func(s State) bool { return s.QLC == "connected" && s.Active && s.Level == 87 })
	command(t, r, p2, "K7Q2MX", "off", 0, 1)
	p2.state(t, func(s State) bool { return s.Level == 0 })
}

func TestBadHelloAndLoopbackOnlyAdmin(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	for _, id := range []string{"", "K7Q2M", "K7Q2MXX", "k7q2mx", "IIIIII", "OOOOOO", "UUUUUU", "A1B2L3"} {
		t.Run(fmt.Sprintf("ID_%q", id), func(t *testing.T) {
			p := hello(t, s, id)
			if v := p.packet(t, "rejected"); v.Reason != "bad_request" {
				t.Fatalf("reason=%s", v.Reason)
			}
			p.closed(t)
		})
	}
	p := dialPhone(t, s, map[string]any{"type": "set", "level": 1, "seq": 1})
	if v := p.packet(t, "rejected"); v.Reason != "bad_request" {
		t.Fatal(v)
	}
	p.closed(t)
	for _, addr := range []string{"<HOST>:4422", "[2001:db8::1]:4422", "not-an-address"} {
		for _, path := range []string{"/admin/devices", "/admin/assign", "/admin/release"} {
			req := httptest.NewRequest("POST", path, strings.NewReader(`{"fixture":"中央","device":"K7Q2MX"}`))
			req.RemoteAddr = addr
			w := httptest.NewRecorder()
			r.handler().ServeHTTP(w, req)
			if w.Code != 403 {
				t.Fatalf("%s %s = %d", addr, path, w.Code)
			}
		}
	}
	for _, addr := range []string{"127.0.0.1:12", "[::1]:12", "[::ffff:127.0.0.1]:12"} {
		req := httptest.NewRequest("GET", "/admin/devices", nil)
		req.RemoteAddr = addr
		req.Header.Set("X-Forwarded-For", "<HOST>")
		w := httptest.NewRecorder()
		r.handler().ServeHTTP(w, req)
		if w.Code != 200 {
			t.Fatal(w.Code)
		}
	}
}

func TestGracefulShutdown(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.packet(t, "state")
	command(t, r, p, "K7Q2MX", "set", 111, 1)
	p.state(t, func(s State) bool { return s.Level == 111 })
	q.expect(t, "45|111")
	notified := make(chan bool, 2)
	r.mu.Lock()
	session := r.phones["K7Q2MX"]
	r.mu.Unlock()
	q.mu.Lock()
	q.onFrame = func(frame qlcFrame) {
		if frame.text == "45|0" || frame.text == "46|0" {
			session.writeMu.Lock()
			closed := session.closed
			session.writeMu.Unlock()
			notified <- closed
		}
	}
	q.mu.Unlock()
	start := time.Now()
	r.shutdown()
	if time.Since(start) > 2*time.Second {
		t.Fatal("shutdown exceeded 2 seconds")
	}
	p.packet(t, "shutdown")
	p.closed(t)
	q.expect(t, "45|0")
	q.expect(t, "46|0")
	q.expect(t, "120|PREV_PG")
	for range 2 {
		if !<-notified {
			t.Fatal("slider zeroed before phone shutdown notification")
		}
	}
	// shutdown is idempotent and all desired levels are zero.
	r.shutdown()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, f := range r.fixtures {
		if f.level != 0 {
			t.Fatal("nonzero shutdown level")
		}
	}
}

func TestConfigAndPersistenceErrors(t *testing.T) {
	good := testConfig(t, nil)
	cases := []Config{good, good, good, good}
	cases[0].Fixtures = nil
	cases[1].Fixtures = []Fixture{{Name: "same", Slider: 1, Universe: 1, Address: 1}, {Name: "same", Slider: 2, Universe: 1, Address: 2}}
	cases[2].Fixtures = []Fixture{{Name: "a", Slider: 1, Universe: 1, Address: 1}, {Name: "b", Slider: 1, Universe: 1, Address: 2}}
	cases[3].Fixtures = []Fixture{{Name: "a", Slider: 1, Universe: 1, Address: 1}, {Name: "b", Slider: 2, Universe: 1, Address: 1}}
	for _, c := range cases {
		if c.validate() == nil {
			t.Fatal("invalid config accepted")
		}
	}
	for _, contents := range []string{`null`, `{"中央":"IIIIII"}`, `{"unknown":"K7Q2MX"}`, `{`} {
		if err := os.WriteFile(good.AssignmentsFile, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
		if _, err := newRuntime(good, io.Discard); err == nil {
			t.Fatalf("accepted %s", contents)
		}
	}
	if err := os.Remove(good.AssignmentsFile); err != nil {
		t.Fatal(err)
	}
	r, err := newRuntime(good, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	// Open connections supply the keys being bound by these persistence operations.
	r.phones["K7Q2MX"] = &phone{device: Device{ID: "K7Q2MX"}, conn: &websocket.Conn{}, keyHash: mustDigest(t, testKey(1)), updates: make(chan State, 1)}
	r.phones["AAAAAA"] = &phone{device: Device{ID: "AAAAAA"}, conn: &websocket.Conn{}, keyHash: mustDigest(t, testKey(2)), updates: make(chan State, 1)}
	// Atomic replacement must also work when the destination already exists.
	if err = r.changeAssignment("中央", "K7Q2MX", false); err != nil {
		t.Fatal(err)
	}
	if err = r.changeAssignment("中央", "", true); err != nil {
		t.Fatal(err)
	}
	if err = r.changeAssignment("左", "AAAAAA", false); err != nil {
		t.Fatal(err)
	}
	a, err := readAssignments(good)
	if err != nil {
		t.Fatal(err)
	}
	if len(a) != 1 || a["左"] != "AAAAAA" {
		t.Fatal(a)
	}
	leftovers, _ := filepath.Glob(filepath.Join(filepath.Dir(good.AssignmentsFile), ".assignments-*"))
	if len(leftovers) != 0 {
		t.Fatal(leftovers)
	}
	r.config.AssignmentsFile = filepath.Join(t.TempDir(), "missing", "assignments.json")
	if err = r.changeAssignment("中央", "K7Q2MX", false); err == nil {
		t.Fatal("missing persistence failure")
	}
	if r.assignments["中央"] != "" {
		t.Fatal("assignment applied without persistence")
	}
}

func TestCLI(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	c := r.config
	c.Listen = strings.TrimPrefix(s.URL, "http://")
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	for _, args := range [][]string{{"devices"}, {"assign", "K7Q2MX", "中央"}, {"release", "中央"}, {"forget", "K7Q2MX"}} {
		var out bytes.Buffer
		if err := adminCLI(c, args, &out); err != nil {
			t.Fatal(err)
		}
		if !json.Valid(out.Bytes()) {
			t.Fatalf("CLI response: %s", out.String())
		}
	}
	if err := adminCLI(c, []string{"assign", "K7Q2MX", "unknown"}, io.Discard); err == nil {
		t.Fatal("CLI swallowed admin error")
	}
}

func TestCoalescingAtOutputTicks(t *testing.T) {
	q := newFakeQLC(t)
	r, err := newRuntime(testConfig(t, q), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	ticks := make(chan time.Time)
	r.outputTicks = ticks
	r.start()
	s := httptest.NewServer(r.handler())
	t.Cleanup(func() { r.shutdown(); s.Close() })
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.packet(t, "state")
	for i := 1; i <= 200; i++ {
		p.send(t, map[string]any{"type": "set", "level": i, "seq": i})
	}
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return r.phones["K7Q2MX"].sequences["中央"] == 200 })
	select {
	case frame := <-q.frames:
		t.Fatalf("write outside output tick: %+v", frame)
	default:
	}
	ticks <- time.Now()
	q.expect(t, "45|200")
	// The next tick also sends only the final desired value.
	for i := 201; i <= 240; i++ {
		p.send(t, map[string]any{"type": "set", "level": i, "seq": i})
	}
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return r.phones["K7Q2MX"].sequences["中央"] == 240 })
	ticks <- time.Now()
	q.expect(t, "45|240")
	ticks <- time.Now()
	select {
	case frame := <-q.frames:
		t.Fatalf("extra output: %+v", frame)
	case <-time.After(100 * time.Millisecond):
	}
	if outputInterval != time.Second/30 {
		t.Fatalf("output interval = %s", outputInterval)
	}
}

func TestUnassignedCommandsAndUnknownQLCMessages(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	conn := startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	for _, kind := range []string{"set", "on", "off"} {
		p.send(t, map[string]any{"type": kind, "seq": 10, "level": 66})
	}
	p.send(t, map[string]string{"type": "barrier"})
	p.packet(t, "rejected")
	p.closed(t)
	r.mu.Lock()
	level := r.fixtures[0].level
	r.mu.Unlock()
	if level != 0 {
		t.Fatal("unassigned command changed light")
	}
	p = hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.state(t, func(s State) bool { return s.Fixture != nil })
	// Invalid commands must not advance the last-applied sequence number.
	p.send(t, map[string]any{"type": "set", "level": 256, "seq": 999})
	p.send(t, map[string]any{"type": "set", "level": -1, "seq": 999})
	p.send(t, map[string]any{"type": "set", "level": 10})
	command(t, r, p, "K7Q2MX", "set", 42, 1)
	p.state(t, func(s State) bool { return s.Level == 42 })
	q.expect(t, "45|42")
	for _, frame := range []string{"FUNCTION|1|Running", "FUNCTION|1|Stopped", "99|SLIDER|12|12", "unknown"} {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		err := conn.Write(ctx, websocket.MessageText, []byte(frame))
		cancel()
		if err != nil {
			t.Fatal(err)
		}
	}
	command(t, r, p, "K7Q2MX", "set", 43, 2)
	p.state(t, func(s State) bool { return s.Active && s.Level == 43 })
	q.expect(t, "45|43")
}

func TestIndicatorAndPhoneHeartbeat(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	// A reading client automatically answers ping control frames.
	good := hello(t, s, "K7Q2MX")
	good.packet(t, "state")
	// This client sends hello, then never reads, so it never answers pings.
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	bad, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.URL, "http")+"/ws", nil)
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	defer bad.CloseNow()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	err = bad.Write(ctx, websocket.MessageText, []byte(`{"type":"hello","device":"AAAAAA","key":"`+testKey(1)+`"}`))
	cancel()
	if err != nil {
		t.Fatal(err)
	}
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return len(r.phones) == 2 })
	q.expect(t, "120|NEXT_PG")
	q.expect(t, "120|NEXT_PG")
	// The first ping is at two seconds and its pong deadline is six seconds later.
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		_, badPresent := r.phones["AAAAAA"]
		_, goodPresent := r.phones["K7Q2MX"]
		r.mu.Unlock()
		if !goodPresent {
			t.Fatal("healthy phone dropped")
		}
		if !badPresent {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("phone missing pongs was not dropped")
}

func TestMalformedHelloJSON(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	if err = c.Write(ctx, websocket.MessageText, []byte(`{"type":"hello",`)); err != nil {
		t.Fatal(err)
	}
	_, b, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]string
	if json.Unmarshal(b, &v) != nil || v["type"] != "rejected" || v["reason"] != "bad_request" {
		t.Fatalf("bad rejection: %s", b)
	}
	if _, _, err = c.Read(ctx); err == nil {
		t.Fatal("rejected connection left open")
	}
}

func TestEventLog(t *testing.T) {
	q := newFakeQLC(t)
	var first, second bytes.Buffer
	r, err := newRuntime(testConfig(t, q), io.MultiWriter(&first, &second))
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
	p.state(t, func(s State) bool { return s.Fixture != nil })
	command(t, r, p, "K7Q2MX", "set", 61, 1)
	p.state(t, func(s State) bool { return s.Level == 61 })
	command(t, r, p, "K7Q2MX", "off", 0, 2)
	p.state(t, func(s State) bool { return s.Level == 0 })
	command(t, r, p, "K7Q2MX", "on", 0, 3)
	p.state(t, func(s State) bool { return s.Level == 61 })
	admin(t, s, "/admin/release", map[string]string{"fixture": "中央"}, 200)
	p.state(t, func(s State) bool { return s.Fixture == nil })
	r.shutdown()
	p.packet(t, "shutdown")
	p.closed(t)
	if first.String() != second.String() {
		t.Fatal("log destinations differ")
	}
	seen := map[string]bool{}
	for _, line := range strings.Split(strings.TrimSpace(first.String()), "\n") {
		var v map[string]any
		if err = json.Unmarshal([]byte(line), &v); err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"time", "fixture", "device", "event", "value", "source"} {
			if _, ok := v[key]; !ok {
				t.Fatalf("log missing %s: %s", key, line)
			}
		}
		if v["source"] != "phone" && v["source"] != "admin" && v["source"] != "system" {
			t.Fatal("invalid source")
		}
		seen[v["event"].(string)] = true
	}
	for _, event := range []string{"qlc_connect", "hello", "assign", "set", "off", "on", "release", "shutdown", "disconnect", "qlc_disconnect"} {
		if !seen[event] {
			t.Fatalf("missing %s log", event)
		}
	}
}

func TestSignalShutdownProcess(t *testing.T) {
	if path := os.Getenv("REMOTE_DIMMER_TEST_CONFIG"); path != "" {
		if err := run([]string{"-config", path}, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		os.Exit(0)
	}
	if runtime.GOOS == "windows" {
		t.Skip("os.Process.Signal cannot send console events on Windows")
	}
	for _, signal := range []os.Signal{os.Interrupt, syscall.SIGTERM} {
		t.Run(signal.String(), func(t *testing.T) {
			q := newFakeQLC(t)
			c := testConfig(t, q)
			c.Listen = "127.0.0.1:0"
			c.LogFile = filepath.Join(t.TempDir(), "events.log")
			path := filepath.Join(t.TempDir(), "config.json")
			b, err := json.Marshal(c)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(path, b, 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.Command(os.Args[0], "-test.run=^TestSignalShutdownProcess$")
			cmd.Env = append(os.Environ(), "REMOTE_DIMMER_TEST_CONFIG="+path)
			var output bytes.Buffer
			cmd.Stdout = &output
			cmd.Stderr = &output
			if err = cmd.Start(); err != nil {
				t.Fatal(err)
			}
			waited := false
			defer func() {
				if !waited {
					_ = cmd.Process.Kill()
					_ = cmd.Wait()
				}
			}()
			q.expect(t, "45|0")
			q.expect(t, "46|0")
			q.expect(t, "120|NEXT_PG")
			if err = cmd.Process.Signal(signal); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() { done <- cmd.Wait() }()
			select {
			case err = <-done:
				waited = true
				if err != nil {
					t.Fatalf("signal exit: %v\n%s", err, output.String())
				}
			case <-time.After(4 * time.Second):
				_ = cmd.Process.Kill()
				<-done
				waited = true
				t.Fatal("signal shutdown timed out")
			}
			q.expect(t, "45|0")
			q.expect(t, "46|0")
			q.expect(t, "120|PREV_PG")
			saved, err := os.ReadFile(c.LogFile)
			if err != nil {
				t.Fatal(err)
			}
			if string(saved) != output.String() || !bytes.Contains(saved, []byte(`"event":"shutdown"`)) {
				t.Fatal("stdout/file event log mismatch or shutdown not logged")
			}
		})
	}
}
