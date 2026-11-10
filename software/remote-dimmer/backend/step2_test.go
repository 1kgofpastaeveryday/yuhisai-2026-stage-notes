package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestConfigRanges(t *testing.T) {
	good := Config{IndicatorFrame: 120, Fixtures: []Fixture{{Name: "a", Slider: 0, Universe: 1, Address: 1}, {Name: "b", Slider: 3, Universe: 4, Address: 512}}}
	if err := good.validate(); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name   string
		change func(*Config)
	}{
		{"universe low", func(c *Config) { c.Fixtures[0].Universe = 0 }},
		{"universe high", func(c *Config) { c.Fixtures[0].Universe = 5 }},
		{"address low", func(c *Config) { c.Fixtures[0].Address = 0 }},
		{"address high", func(c *Config) { c.Fixtures[0].Address = 513 }},
		{"slider", func(c *Config) { c.Fixtures[0].Slider = -1 }},
		{"indicator", func(c *Config) { c.IndicatorFrame = -1 }},
		{"collision", func(c *Config) { c.IndicatorFrame = 3 }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c := good
			c.Fixtures = append([]Fixture{}, good.Fixtures...)
			tc.change(&c)
			if c.validate() == nil {
				t.Fatal("accepted invalid range")
			}
		})
	}
}

func TestDetectionRules(t *testing.T) {
	for _, widget := range []bool{true, false} {
		t.Run(map[bool]string{true: "direct", false: "output"}[widget], func(t *testing.T) {
			q := newFakeQLC(t)
			r, err := newRuntime(testConfig(t, q), io.Discard)
			if err != nil {
				t.Fatal(err)
			}
			r.connected = true
			f := r.fixtures[0]
			base := time.Now()
			f.sentAt = base
			f.lastSent = 0
			sample := func(value int, d time.Duration) { r.observe(0, widget, value, base.Add(d), base.Add(d)) }
			sample(80, 499*time.Millisecond)
			sample(80, 499*time.Millisecond)
			if f.locked || f.overridden {
				t.Fatal("500ms guard failed")
			}
			sample(80, 500*time.Millisecond)
			if widget && !f.locked || !widget && !f.overridden {
				t.Fatal("two polls plus 500ms did not trigger")
			}
			f.locked, f.overridden, f.level = false, false, 0
			f.widgetMisses, f.outputMisses = 0, 0
			sample(0, 600*time.Millisecond)
			sample(80, 700*time.Millisecond)
			if f.locked || f.overridden {
				t.Fatal("match did not reset streak")
			}
			// A write after the query invalidates the old response.
			r.observe(0, widget, 80, base.Add(-time.Second), base.Add(time.Second))
			sample(80, time.Second)
			if f.locked || f.overridden {
				t.Fatal("stale reply counted")
			}
			sample(81, 1200*time.Millisecond)
			if widget {
				if !f.locked || f.level != 81 {
					t.Fatal("direct touch not adopted")
				}
				sample(0, 1400*time.Millisecond)
				if !f.locked {
					t.Fatal("lock cleared on match")
				}
				r.connection(false)
				r.connection(true)
				if !f.locked {
					t.Fatal("reconnect cleared lock")
				}
			} else {
				if !f.overridden || f.locked || f.level != 0 {
					t.Fatal("output override changed active/level")
				}
				sample(0, 1400*time.Millisecond)
				if f.overridden {
					t.Fatal("override did not clear")
				}
			}
		})
	}
}

func TestPollingPhoneLockAndOverride(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.packet(t, "state")
	command(t, r, p, "K7Q2MX", "set", 60, 1)
	q.expect(t, "45|60")
	q.mu.Lock()
	q.outputs[[2]int{1, 9}] = 150
	q.mu.Unlock()
	p.state(t, func(s State) bool { return s.Level == 60 && s.Active && s.Overridden })
	q.mu.Lock()
	delete(q.outputs, [2]int{1, 9})
	q.mu.Unlock()
	p.state(t, func(s State) bool { return s.Level == 60 && s.Active && !s.Overridden })
	q.mu.Lock()
	q.widgets[45] = 77
	q.mu.Unlock()
	p.state(t, func(s State) bool { return s.Level == 77 && !s.Active && s.Overridden })
	for _, kind := range []string{"set", "on", "off"} {
		p.send(t, map[string]any{"type": kind, "level": 10, "seq": 2})
	}
	p.send(t, map[string]string{"type": "barrier"})
	p.packet(t, "rejected")
	p.closed(t)
	r.mu.Lock()
	if r.fixtures[0].level != 77 {
		t.Error("locked commands changed level")
	}
	r.mu.Unlock()
	admin(t, s, "/admin/release", map[string]string{"fixture": "中央"}, 200)
	next := hello(t, s, "AAAAAA")
	next.packet(t, "state")
	assign(t, s, "AAAAAA", "中央", 200)
	next.state(t, func(s State) bool { return !s.Active && s.Overridden && s.Level == 77 })
	q.mu.Lock()
	q.widgets[45] = 82
	q.mu.Unlock()
	next.state(t, func(s State) bool { return !s.Active && s.Overridden && s.Level == 82 })
	// Ordinary output ticks must never write back an adopted locked value.
	select {
	case frame := <-q.frames:
		if frame.text != "120|NEXT_PG" {
			t.Fatalf("locked write: %s", frame.text)
		}
	case <-time.After(100 * time.Millisecond):
	}
	fresh, err := newRuntime(r.config, io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	if fresh.fixtures[0].locked {
		t.Fatal("restart retained lock")
	}
	seen := map[string]bool{}
	for len(q.polls) > 0 {
		seen[<-q.polls] = true
	}
	for _, query := range []string{"QLC+API|getWidgetStatus|45", "QLC+API|getChannelsValues|1|9|1", "QLC+API|getWidgetStatus|46", "QLC+API|getChannelsValues|1|10|1"} {
		if !seen[query] {
			t.Errorf("missing query %s", query)
		}
	}
	if pollInterval != time.Second/5 {
		t.Fatal("wrong polling interval")
	}
}

func TestProjectValidation(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	c.Project = "testdata/valid.qxw"
	b, err := os.ReadFile(c.Project)
	if err != nil {
		t.Fatal(err)
	}
	if w := validateProject(c); len(w) != 0 {
		t.Fatal(w)
	}
	cases := []struct{ name, old, new string }{
		{"namespace", workspaceNS, "urn:wrong"},
		{"VC required", "<VirtualConsole>", "<Other>"},
		{"slider ID", "ID=\"45\"", "ID=\"99\""},
		{"mode", "<SliderMode>Level</SliderMode>", "<SliderMode>Playback</SliderMode>"},
		{"level missing", "<Level LowLimit=\"0\" HighLimit=\"255\"><Channel Fixture=\"7\">1</Channel></Level>", ""},
		{"channel missing", "<Channel Fixture=\"7\">1</Channel>", ""},
		{"multiple channels", "<Channel Fixture=\"7\">1</Channel>", "<Channel Fixture=\"7\">1</Channel><Channel Fixture=\"7\">2</Channel>"},
		{"fixture missing", "Fixture=\"7\"", "Fixture=\"8\""},
		{"fixture ID child", "<ID>7</ID>", "<ID>8</ID>"},
		{"universe", "<Universe>0</Universe>", "<Universe>1</Universe>"},
		{"address", "<Address>7</Address>", "<Address>8</Address>"},
		{"channel offset", ">1</Channel>", ">0</Channel>"},
		{"invalid number", ">1</Channel>", ">x</Channel>"},
		{"low limit", "LowLimit=\"0\"", "LowLimit=\"1\""},
		{"high limit", "HighLimit=\"255\"", "HighLimit=\"254\""},
		{"indicator", "ID=\"120\"", "ID=\"121\""},
		{"pages", "PagesNum=\"2\"", "PagesNum=\"3\""},
		{"multipage missing", "<Multipage PagesNum=\"2\" CurrentPage=\"0\"/>", ""},
		{"loop", "<PagesLoop>False</PagesLoop>", "<PagesLoop>True</PagesLoop>"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := strings.Replace(string(b), tc.old, tc.new, 1)
			if tc.name == "VC required" {
				data = strings.Replace(data, "</VirtualConsole>", "</Other>", 1)
			}
			path := filepath.Join(t.TempDir(), "show.qxw")
			if err := os.WriteFile(path, []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			c.Project = path
			if w := validateProject(c); len(w) == 0 {
				t.Fatal("missing validation warning")
			}
			// Warnings must never prevent startup.
			if _, err := newRuntime(c, io.Discard); err != nil {
				t.Fatal(err)
			}
		})
	}
	for _, data := range []string{"<Workspace>", strings.Replace(string(b), "<PagesLoop>False</PagesLoop>", "", 1)} {
		path := filepath.Join(t.TempDir(), "extra.qxw")
		os.WriteFile(path, []byte(data), 0600)
		c.Project = path
		w := validateProject(c)
		if strings.Contains(data, "<VirtualConsole>") && len(w) != 0 {
			t.Fatal("QLC default loop off rejected", w)
		}
		if data == "<Workspace>" && len(w) == 0 {
			t.Fatal("invalid XML accepted")
		}
	}
	c.Project = filepath.Join(t.TempDir(), "missing.qxw")
	if w := validateProject(c); len(w) == 0 {
		t.Fatal("missing file warning")
	}
}

func TestQLC5ProjectValidation(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	b, err := os.ReadFile("testdata/valid.qxw")
	if err != nil {
		t.Fatal(err)
	}
	// v5 omits the legacy PagesLoop element and writes attributes only when on.
	base := strings.Replace(string(b), "<PagesLoop>False</PagesLoop>", "", 1)
	for _, tc := range []struct {
		name, old, replacement, warning string
	}{
		{"v5 loop off", "", "", ""},
		{"v5 loop on", `CurrentPage="0"`, `CurrentPage="0" PagesLoop="True"`, "indicator: PagesLoop must be False"},
		{"v5 loop attribute presence", `CurrentPage="0"`, `CurrentPage="0" PagesLoop="False"`, "indicator: PagesLoop must be False"},
		{"v5 empty loop attribute", `CurrentPage="0"`, `CurrentPage="0" PagesLoop=""`, "indicator: PagesLoop must be False"},
		{"monitor off", "<SliderMode>", `<SliderMode Monitor="false">`, ""},
		{"monitor on", "<SliderMode>", `<SliderMode Monitor="true">`, "中央: channel monitoring must be off for iPhone sliders"},
		{"monitor case sensitive", "<SliderMode>", `<SliderMode Monitor="False">`, "中央: channel monitoring must be off for iPhone sliders"},
		{"monitor empty attribute", "<SliderMode>", `<SliderMode Monitor="">`, "中央: channel monitoring must be off for iPhone sliders"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := base
			if tc.old != "" {
				data = strings.Replace(data, tc.old, tc.replacement, 1)
			}
			c.Project = filepath.Join(t.TempDir(), "v5.qxw")
			if err := os.WriteFile(c.Project, []byte(data), 0600); err != nil {
				t.Fatal(err)
			}
			var logs bytes.Buffer
			// Construction succeeds even with warnings, using the normal validation path.
			r, err := newRuntime(c, &logs)
			if err != nil {
				t.Fatal(err)
			}
			warnings := statusJSON(t, r).Warnings
			if tc.warning == "" {
				if len(warnings) != 0 {
					t.Fatal(warnings)
				}
				return
			}
			if len(warnings) != 1 || warnings[0] != tc.warning {
				t.Fatalf("warnings = %v; want %q", warnings, tc.warning)
			}
			if !strings.Contains(logs.String(), "validation_warning") || !strings.Contains(logs.String(), tc.warning) {
				t.Fatalf("validation log missing: %s", logs.String())
			}
			req := httptest.NewRequest("GET", "/status", nil)
			req.RemoteAddr = "127.0.0.1:1234"
			w := httptest.NewRecorder()
			r.handler().ServeHTTP(w, req)
			if w.Code != 200 || !strings.Contains(w.Body.String(), tc.warning) {
				t.Fatal("status page validation warning missing")
			}
		})
	}
}

func TestProjectMtimeAndWarnings(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	c.Project = filepath.Join(t.TempDir(), "show.qxw")
	os.WriteFile(c.Project, []byte("broken"), 0600)
	r, s := setup(t, c)
	startup(t, q, r)
	if len(r.status().Warnings) == 0 {
		t.Fatal("startup warning missing")
	}
	b, _ := os.ReadFile("testdata/valid.qxw")
	os.WriteFile(c.Project, b, 0600)
	future := time.Now().Add(time.Second)
	os.Chtimes(c.Project, future, future)
	eventually(t, func() bool { return len(r.status().Warnings) == 0 })
	os.WriteFile(c.Project, []byte("broken again"), 0600)
	// Same mtime intentionally leaves the last validation unchanged.
	os.Chtimes(c.Project, future, future)
	time.Sleep(2100 * time.Millisecond)
	if len(r.status().Warnings) != 0 {
		t.Fatal("reparsed unchanged mtime")
	}
	future = future.Add(time.Second)
	os.Chtimes(c.Project, future, future)
	eventually(t, func() bool { return len(r.status().Warnings) > 0 })
	p := hello(t, s, "K7Q2MX")
	p.state(t, func(s State) bool { return s.QLC == "connected" })
}

func TestStatusEndpoints(t *testing.T) {
	q := newFakeQLC(t)
	r, s := setup(t, testConfig(t, q))
	startup(t, q, r)
	p := hello(t, s, "K7Q2MX")
	p.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	p.packet(t, "state")
	unassigned := hello(t, s, "AAAAAA")
	unassigned.packet(t, "state")
	for _, path := range []string{"/status", "/status.json"} {
		for _, addr := range []string{"127.0.0.1:1", "[::1]:1", "[::ffff:127.0.0.1]:1", "<HOST>:1", "[2001:db8::1]:1", "bad"} {
			req := httptest.NewRequest("GET", path, nil)
			req.RemoteAddr = addr
			req.Header.Set("X-Forwarded-For", "127.0.0.1")
			w := httptest.NewRecorder()
			r.handler().ServeHTTP(w, req)
			allowed := strings.HasPrefix(addr, "127.") || strings.HasPrefix(addr, "[::")
			if !allowed {
				if w.Code != 403 {
					t.Fatal(addr, w.Code)
				}
				continue
			}
			if w.Code != 200 {
				t.Fatal(w.Code)
			}
			if w.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("cached status")
			}
			if path == "/status" {
				for _, text := range []string{"iPhone 稼働中　Ableton の前にサーバーを止める", "中央", "K7Q2MX", "AAAAAA", "data-device=", "<select", "setInterval(refresh,1000)", "サーバー応答なし（iPhone の値が QLC+ に残っている可能性あり）", "停止（0 に戻し済み）", "/admin/", "/status.json"} {
					if !strings.Contains(w.Body.String(), text) {
						t.Errorf("missing %s", text)
					}
				}
			} else {
				var v statusSnapshot
				if json.Unmarshal(w.Body.Bytes(), &v) != nil {
					t.Fatal("invalid status JSON")
				}
				if v.QLC != "connected" || len(v.Warnings) == 0 || len(v.Fixtures) != 2 || len(v.Unassigned) != 1 {
					t.Fatalf("status %+v", v)
				}
				f := v.Fixtures[0]
				if f.Device != "K7Q2MX" || !f.Connected || f.IP == "" || !f.Active || f.ChangedAt.IsZero() || f.Source != "admin" {
					t.Fatalf("fixture %+v", f)
				}
			}
		}
	}
	r.shutdown()
	v := r.status()
	if !v.ShuttingDown || !v.Closing || v.Fixtures[0].Active || v.Fixtures[0].Level != 0 {
		t.Fatal(v)
	}
}

func TestSetLogThrottle(t *testing.T) {
	q := newFakeQLC(t)
	var logs bytes.Buffer
	r, err := newRuntime(testConfig(t, q), &logs)
	if err != nil {
		t.Fatal(err)
	}
	logs.Reset()
	f := r.fixtures[0]
	base := time.Now()
	for i := 0; i < 30; i++ {
		r.logSet(f, "K7Q2MX", i, base.Add(time.Duration(i)*time.Second/30))
	}
	r.flushSetLogs(base.Add(1400 * time.Millisecond))
	if !f.setLog.pending {
		t.Fatal("final log emitted before quiet interval")
	}
	r.flushSetLogs(base.Add(1500 * time.Millisecond))
	r.flushSetLogs(base.Add(3 * time.Second))
	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 3 {
		t.Fatalf("burst logged %d events: %s", len(lines), logs.String())
	}
	var final struct{ Value int }
	json.Unmarshal([]byte(lines[2]), &final)
	if final.Value != 29 {
		t.Fatal("missing final value")
	}
	// Separate fixtures do not share a throttle window.
	r.logSet(r.fixtures[1], "AAAAAA", 44, base)
	for _, event := range []string{"on", "off", "assign", "release", "hello", "disconnect", "qlc_connect", "qlc_disconnect", "qlc_direct", "shutdown"} {
		r.event(f.Name, "K7Q2MX", event, 1, "system")
		r.event(f.Name, "K7Q2MX", event, 2, "system")
	}
	if got := len(strings.Split(strings.TrimSpace(logs.String()), "\n")); got != 24 {
		t.Fatal("events throttled", got)
	}
}

func TestTrailingSetLogInRuntime(t *testing.T) {
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
	p.packet(t, "state")
	for i := 1; i <= 25; i++ {
		p.send(t, map[string]any{"type": "set", "seq": i, "level": i})
	}
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return r.fixtures[0].level == 25 })
	eventually(t, func() bool { r.mu.Lock(); defer r.mu.Unlock(); return !r.fixtures[0].setLog.pending })
	r.shutdown()
	type event struct {
		Time                    time.Time
		Event                   string
		Value                   int
		Fixture, Device, Source string
	}
	sets := []event{}
	for _, line := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
		var v event
		if err := json.Unmarshal([]byte(line), &v); err != nil {
			t.Fatal(err)
		}
		if v.Event == "set" {
			sets = append(sets, v)
		}
	}
	if len(sets) != 2 || sets[1].Value != 25 || sets[1].Time.Sub(sets[0].Time) < settleInterval || sets[1].Fixture != "中央" || sets[1].Device != "K7Q2MX" || sets[1].Source != "phone" {
		t.Fatalf("trailing sets %+v", sets)
	}
}

func TestPollingSameAddressDifferentUniverses(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	c.Fixtures[1].Universe = 2
	c.Fixtures[1].Address = 9
	q.mu.Lock()
	q.outputs[[2]int{1, 9}] = 0
	q.outputs[[2]int{2, 9}] = 100
	q.mu.Unlock()
	r, _ := setup(t, c)
	startup(t, q, r)
	eventually(t, func() bool { s := r.status(); return s.Fixtures[1].Overridden })
	s := r.status()
	if s.Fixtures[0].Overridden || s.Fixtures[0].Locked || s.Fixtures[1].Locked {
		t.Fatalf("misattributed channel reply: %+v", s)
	}
}

func TestQuietBurstFinalBeforeNextSet(t *testing.T) {
	q := newFakeQLC(t)
	var logs bytes.Buffer
	r, err := newRuntime(testConfig(t, q), &logs)
	if err != nil {
		t.Fatal(err)
	}
	logs.Reset()
	f := r.fixtures[0]
	base := time.Now()
	r.logSet(f, "K7Q2MX", 10, base)
	r.logSet(f, "K7Q2MX", 20, base.Add(10*time.Millisecond))
	// A new drag can arrive between the quiet deadline and the maintenance tick.
	r.logSet(f, "K7Q2MX", 30, base.Add(511*time.Millisecond))
	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	if len(lines) != 2 || !strings.Contains(lines[1], `"value":20`) {
		t.Fatalf("previous final value lost: %s", logs.String())
	}
	r.flushSetLogs(base.Add(1100 * time.Millisecond))
	if !strings.Contains(logs.String(), `"value":30`) {
		t.Fatal("next final value lost")
	}
}
