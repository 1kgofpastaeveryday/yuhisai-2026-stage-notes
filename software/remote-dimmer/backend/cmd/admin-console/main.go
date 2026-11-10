// admin-console hosts a local GUI for the already-running lighting backend.
package main

import (
	"embed"
	"flag"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
)

//go:embed admin
var assets embed.FS

func loopbackHost(hostport string) bool {
	host, _, err := net.SplitHostPort(hostport)
	if err != nil {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func adminHandler(target *url.URL) http.Handler {
	files, _ := fs.Sub(assets, "admin")
	static := http.FileServer(http.FS(files))
	proxy := httputil.NewSingleHostReverseProxy(target)
	director := proxy.Director
	proxy.Director = func(req *http.Request) { director(req); req.Host = target.Host; req.URL.RawQuery = "" }
	proxy.Transport = &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 2 * time.Second}).DialContext, ResponseHeaderTimeout: 3 * time.Second, IdleConnTimeout: 30 * time.Second}
	proxy.ErrorHandler = func(w http.ResponseWriter, req *http.Request, err error) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"error":"照明サーバーに接続できません"}`))
	}
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ip, _, err := net.SplitHostPort(req.RemoteAddr)
		if err != nil || net.ParseIP(ip) == nil || !net.ParseIP(ip).IsLoopback() || !loopbackHost(req.Host) {
			http.Error(w, "loopback only", http.StatusForbidden)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Robots-Tag", "noindex")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
		// Never accept a browser's cross-origin administration request.
		if origin := req.Header.Get("Origin"); origin != "" {
			u, err := url.Parse(origin)
			if err != nil || u.Scheme != "http" || !strings.EqualFold(u.Host, req.Host) {
				http.Error(w, "same origin only", http.StatusForbidden)
				return
			}
		}
		path := ""
		switch req.URL.Path {
		case "/api/status":
			if req.Method == "GET" {
				path = "/status.json"
			}
		case "/api/assign", "/api/release", "/api/forget":
			if req.Method == "POST" {
				path = "/admin/" + strings.TrimPrefix(req.URL.Path, "/api/")
			}
		}
		if path != "" {
			if req.Method == "POST" {
				if !strings.HasPrefix(req.Header.Get("Content-Type"), "application/json") {
					http.Error(w, "JSON required", http.StatusUnsupportedMediaType)
					return
				}
				req.Body = http.MaxBytesReader(w, req.Body, 4096)
			}
			req.URL.Path = path
			req.URL.RawPath = ""
			proxy.ServeHTTP(w, req)
			return
		}
		if strings.HasPrefix(req.URL.Path, "/api/") || (req.Method != "GET" && req.Method != "HEAD") {
			http.NotFound(w, req)
			return
		}
		static.ServeHTTP(w, req)
	})
}

func main() {
	listen := flag.String("listen", "127.0.0.1:8769", "local admin GUI listener")
	backend := flag.String("backend", "http://127.0.0.1:8765", "existing local admin listener")
	flag.Parse()
	host, _, err := net.SplitHostPort(*listen)
	if err != nil || net.ParseIP(host) == nil || !net.ParseIP(host).IsLoopback() {
		log.Fatal("listen must be a loopback IP and port")
	}
	target, err := url.Parse(*backend)
	if err != nil || target.Scheme != "http" || net.ParseIP(target.Hostname()) == nil || !net.ParseIP(target.Hostname()).IsLoopback() || target.User != nil || target.RawQuery != "" || (target.Path != "" && target.Path != "/") {
		log.Fatal("backend must be a loopback http:// IP origin")
	}
	target.Path = ""
	log.Printf("Lighting administration http://%s/", *listen)
	log.Fatal((&http.Server{Addr: *listen, Handler: adminHandler(target), ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
