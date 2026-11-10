// web-gateway adds a browser client without restarting the lighting backend.
package main

import (
	"context"
	"embed"
	"encoding/json"
	"flag"
	"log"
	"net"
	"net/http"
	"net/url"
	"time"

	"github.com/coder/websocket"
)

//go:embed web/*
var assets embed.FS

const base = "/yuhisai/2026/dimmer/"

func handler(upstream string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET "+base+"ws", func(w http.ResponseWriter, req *http.Request) {
		// Explicit public origin, plus the same-origin local browser allowed by Accept.
		client, err := websocket.Accept(w, req, &websocket.AcceptOptions{OriginPatterns: []string{"knudg.com"}})
		if err != nil {
			return
		}
		defer client.CloseNow()
		client.SetReadLimit(4096)
		ctx, cancel := context.WithCancel(req.Context())
		defer cancel()
		dialCtx, stop := context.WithTimeout(ctx, 5*time.Second)
		backend, _, err := websocket.Dial(dialCtx, upstream, nil)
		stop()
		if err != nil {
			_ = client.Close(websocket.StatusTryAgainLater, "backend unavailable")
			return
		}
		defer backend.CloseNow()
		backend.SetReadLimit(16384)
		go func() {
			defer cancel()
			defer client.CloseNow()
			for {
				kind, data, err := backend.Read(ctx)
				if err != nil {
					return
				}
				writeCtx, done := context.WithTimeout(ctx, 3*time.Second)
				err = client.Write(writeCtx, kind, data)
				done()
				if err != nil {
					return
				}
			}
		}()
		for {
			kind, data, err := client.Read(ctx)
			if err != nil {
				return
			}
			var envelope struct {
				Type string `json:"type"`
			}
			_ = json.Unmarshal(data, &envelope)
			writeCtx, done := context.WithTimeout(ctx, 3*time.Second)
			if kind == websocket.MessageText && envelope.Type == "ping" {
				// Browsers cannot send protocol pings. Check the actual backend socket,
				// not just the HTTP listener, before acknowledging application liveness.
				err = backend.Ping(writeCtx)
				if err == nil {
					err = client.Write(writeCtx, websocket.MessageText, []byte(`{"type":"pong"}`))
				}
			} else {
				err = backend.Write(writeCtx, kind, data)
			}
			done()
			if err != nil {
				return
			}
		}
	})
	for path, name := range map[string]string{base: "index.html", base + "app.js": "app.js", base + "style.css": "style.css", base + "manifest.webmanifest": "manifest.webmanifest", base + "icon.png": "icon.png"} {
		mux.HandleFunc("GET "+path, func(w http.ResponseWriter, req *http.Request) {
			if req.URL.Path != path {
				http.NotFound(w, req)
				return
			}
			w.Header().Set("Cache-Control", "no-store")
			w.Header().Set("X-Robots-Tag", "noindex")
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Referrer-Policy", "no-referrer")
			w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
			data, _ := assets.ReadFile("web/" + name)
			switch name {
			case "manifest.webmanifest":
				w.Header().Set("Content-Type", "application/manifest+json; charset=utf-8")
			case "icon.png":
				w.Header().Set("Content-Type", "image/png")
			case "app.js":
				w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
			case "style.css":
				w.Header().Set("Content-Type", "text/css; charset=utf-8")
			default:
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
			}
			_, _ = w.Write(data)
		})
	}
	return mux
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8768", "loopback web listener")
	upstream := flag.String("upstream", "ws://127.0.0.1:8766/ws", "existing backend public socket")
	flag.Parse()
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		log.Fatal("listen must be a loopback IP and port")
	}
	u, err := url.Parse(*upstream)
	if err != nil || u.Scheme != "ws" || net.ParseIP(u.Hostname()) == nil || !net.ParseIP(u.Hostname()).IsLoopback() || u.Path != "/ws" || u.RawQuery != "" || u.User != nil {
		log.Fatal("upstream must be a loopback ws:// IP /ws endpoint")
	}
	log.Printf("Browser remote http://%s%s", *listen, base)
	log.Fatal((&http.Server{Addr: *listen, Handler: handler(*upstream), ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
