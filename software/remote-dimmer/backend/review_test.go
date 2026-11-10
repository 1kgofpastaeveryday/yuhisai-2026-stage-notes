package main

import (
	"bytes"
	"encoding/json"
	"html"
	"io"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func statusJSON(t *testing.T, r *Runtime) statusSnapshot {
	t.Helper()
	req := httptest.NewRequest("GET", "/status.json", nil)
	req.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	r.handler().ServeHTTP(w, req)
	var s statusSnapshot
	if w.Code != 200 {
		t.Fatalf("status code %d", w.Code)
	}
	if err := json.Unmarshal(w.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestMalformedPollKeepsConnection(t *testing.T) {
	for _, tc := range []struct{ name, query, reply string }{
		{"missing widget", "QLC+API|getWidgetStatus|45", "QLC+API|getWidgetStatus|"},
		{"wrong widget ID", "QLC+API|getWidgetStatus|45", "QLC+API|getWidgetStatus|46|255"},
		{"empty widget value", "QLC+API|getWidgetStatus|45", "QLC+API|getWidgetStatus|45|"},
		{"non-numeric widget", "QLC+API|getWidgetStatus|45", "QLC+API|getWidgetStatus|45|bad"},
		{"negative widget", "QLC+API|getWidgetStatus|45", "QLC+API|getWidgetStatus|45|-1"},
		{"high widget", "QLC+API|getWidgetStatus|45", "QLC+API|getWidgetStatus|45|256"},
		{"short widget", "QLC+API|getWidgetStatus|45", "QLC+API|getWidgetStatus"},
		{"extra widget fields", "QLC+API|getWidgetStatus|45", "QLC+API|getWidgetStatus|45|0|extra"},
		{"v4 channel reply", "QLC+API|getChannelsValues|1|9|1", "QLC+API|getChannelsValues|9|255|0.#000000"},
		{"extra channel field", "QLC+API|getChannelsValues|1|9|1", "QLC+API|getChannelsValues|9|255|0.#000000|0|extra"},
		{"missing channel", "QLC+API|getChannelsValues|1|9|1", "QLC+API|getChannelsValues|"},
		{"wrong channel ID", "QLC+API|getChannelsValues|1|9|1", "QLC+API|getChannelsValues|10|255|0.#000000|0"},
		{"non-numeric channel", "QLC+API|getChannelsValues|1|9|1", "QLC+API|getChannelsValues|9|bad|0.#000000|0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q := newFakeQLC(t)
			q.pollReplies = map[string]string{tc.query: tc.reply}
			c := testConfig(t, q)
			c.Project = "testdata/valid.qxw"
			var logs bytes.Buffer
			r, err := newRuntime(c, &logs)
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
			p.state(t, func(s State) bool { return s.QLC == "connected" && s.Active })
			eventually(t, func() bool { return len(statusJSON(t, r).Warnings) == 1 })
			warning := statusJSON(t, r).Warnings[0]
			if !strings.Contains(warning, "中央: QLC+") {
				t.Fatal(warning)
			}
			req := httptest.NewRequest("GET", "/status", nil)
			req.RemoteAddr = "127.0.0.1:1234"
			w := httptest.NewRecorder()
			r.handler().ServeHTTP(w, req)
			if !strings.Contains(html.UnescapeString(w.Body.String()), warning) {
				t.Fatal("HTML warning missing")
			}
			// A normal channel sample must not clear a bad widget warning, and vice versa.
			// Keep polling beyond the old timeout and retry window while another fixture changes.
			q.mu.Lock()
			q.outputs[[2]int{1, 10}] = 100
			q.mu.Unlock()
			eventually(t, func() bool { return statusJSON(t, r).Fixtures[1].Overridden })
			until := time.Now().Add(2200 * time.Millisecond)
			for time.Now().Before(until) {
				state := statusJSON(t, r)
				if state.QLC != "connected" || len(state.Warnings) != 1 || state.Fixtures[0].Locked || state.Fixtures[0].Overridden || state.Fixtures[0].Level != 0 {
					t.Fatalf("invalid sample changed state: %+v", state)
				}
				time.Sleep(20 * time.Millisecond)
			}
			q.mu.Lock()
			count := q.count
			delete(q.pollReplies, tc.query)
			q.mu.Unlock()
			if count != 1 {
				t.Fatalf("reconnected %d times", count-1)
			}
			eventually(t, func() bool { return len(statusJSON(t, r).Warnings) == 0 })
			// Prove phones stayed active and every queued state kept qlc=connected.
			command(t, r, p, "K7Q2MX", "set", 30, 1)
			p.state(t, func(s State) bool {
				if s.QLC != "connected" {
					t.Fatal("phone saw disconnect")
				}
				return s.Level == 30 && s.Active
			})
			eventually(t, func() bool {
				q.mu.Lock()
				defer q.mu.Unlock()
				return q.widgets[45] == 30
			})
			// A later failure starts a new warning episode and must log again.
			q.mu.Lock()
			q.pollReplies[tc.query] = tc.reply
			q.mu.Unlock()
			eventually(t, func() bool { return len(statusJSON(t, r).Warnings) == 1 })
			r.shutdown()
			if got := strings.Count(logs.String(), `"event":"qlc_warning"`); got != 2 {
				t.Fatalf("warning log count %d: %s", got, logs.String())
			}
		})
	}
}

func TestUnansweredPollReconnects(t *testing.T) {
	for _, reply := range []string{"", "QLC+API|unrelated|45|0", "OTHER|getWidgetStatus|45|0"} {
		t.Run(reply, func(t *testing.T) {
			q := newFakeQLC(t)
			q.pollReplies = map[string]string{"QLC+API|getWidgetStatus|45": reply}
			r, err := newRuntime(testConfig(t, q), io.Discard)
			if err != nil {
				t.Fatal(err)
			}
			r.start()
			defer r.shutdown()
			startup(t, q, r)
			eventually(t, func() bool { q.mu.Lock(); defer q.mu.Unlock(); return q.count >= 2 })
		})
	}
}
