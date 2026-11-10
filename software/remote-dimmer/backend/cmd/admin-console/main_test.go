package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func localRequest(method, path string) *http.Request {
	r := httptest.NewRequest(method, "http://127.0.0.1:8769"+path, strings.NewReader(`{"device":"K7Q2MX","fixture":"中央"}`))
	r.RemoteAddr = "127.0.0.1:1234"
	r.Header.Set("Content-Type", "application/json")
	return r
}
func TestAdminAllowlistAndLocalScope(t *testing.T) {
	var calls []string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"ok":true}`)
	}))
	defer backend.Close()
	target, _ := url.Parse(backend.URL)
	h := adminHandler(target)
	for _, test := range []struct{ method, path, upstream string }{{"GET", "/api/status", "GET /status.json"}, {"POST", "/api/assign", "POST /admin/assign"}, {"POST", "/api/release", "POST /admin/release"}, {"POST", "/api/forget", "POST /admin/forget"}} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, localRequest(test.method, test.path))
		if w.Code != 200 || calls[len(calls)-1] != test.upstream {
			t.Fatal(test, w.Code, calls)
		}
	}
	before := len(calls)
	for _, path := range []string{"/status.json", "/admin/assign", "/api/shutdown", "/api/status/../assign", "/ws"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, localRequest("GET", path))
		if w.Code == 200 {
			t.Fatal("unexpected path", path)
		}
	}
	for _, mutate := range []func(*http.Request){func(r *http.Request) { r.RemoteAddr = "<HOST>:1234" }, func(r *http.Request) { r.Host = "attacker.example:8769" }, func(r *http.Request) { r.Header.Set("Origin", "https://attacker.example") }, func(r *http.Request) { r.Header.Set("Origin", "null") }} {
		r := localRequest("POST", "/api/assign")
		mutate(r)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal(w.Code)
		}
	}
	w := httptest.NewRecorder()
	r := localRequest("POST", "/api/assign")
	r.Header.Set("Content-Type", "text/plain")
	h.ServeHTTP(w, r)
	if w.Code != 415 {
		t.Fatal(w.Code)
	}
	if len(calls) != before {
		t.Fatal("blocked requests reached backend", calls)
	}
}
func TestAdminAssetsAndUnavailableBackend(t *testing.T) {
	target, _ := url.Parse("http://127.0.0.1:1")
	h := adminHandler(target)
	for _, path := range []string{"/", "/app.js", "/style.css", "/join-qr.svg", "/vendor/button.css"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, localRequest("GET", path))
		if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatal(path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, localRequest("GET", "/api/status"))
	if w.Code != 502 || !strings.Contains(w.Body.String(), "照明サーバー") {
		t.Fatal(w.Code, w.Body.String())
	}
}
