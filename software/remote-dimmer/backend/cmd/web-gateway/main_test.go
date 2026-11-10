package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestAssetsAndAdminIsolation(t *testing.T) {
	h := handler("ws://127.0.0.1:1/ws")
	for _, path := range []string{base, base + "app.js", base + "style.css", base + "manifest.webmanifest", base + "icon.png"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(path, w.Code)
		}
	}
	for _, path := range []string{"/status", "/status.json", "/admin/devices", base + "status", base + "admin/assign", base + "../../status", base + "unknown"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code == 200 {
			t.Fatal("exposed", path)
		}
	}
}

func TestRelayAndHeartbeat(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		defer c.CloseNow()
		for {
			kind, b, err := c.Read(r.Context())
			if err != nil {
				return
			}
			if c.Write(r.Context(), kind, b) != nil {
				return
			}
		}
	}))
	defer backend.Close()
	gateway := httptest.NewServer(handler("ws" + strings.TrimPrefix(backend.URL, "http") + "/ws"))
	defer gateway.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(gateway.URL, "http")+base+"ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"https://knudg.com"}}})
	if err != nil {
		t.Fatal(err)
	}
	defer c.CloseNow()
	for _, s := range []string{`{"type":"hello","device":"K7Q2MX","key":"opaque"}`, `{"type":"set","fixture":"中央","level":128,"seq":1}`, `{"type":"ping"}`} {
		if err := c.Write(ctx, websocket.MessageText, []byte(s)); err != nil {
			t.Fatal(err)
		}
		_, got, err := c.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		want := s
		if s == `{"type":"ping"}` {
			want = `{"type":"pong"}`
		}
		if string(got) != want {
			t.Fatalf("%s != %s", got, want)
		}
	}
	_, response, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(gateway.URL, "http")+base+"ws", &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{"https://untrusted.example"}}})
	if err == nil {
		t.Fatal("unexpected cross-origin success")
	}
	if response != nil {
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
	}
}
