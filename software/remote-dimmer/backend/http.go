package main

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"sort"
	"time"

	"github.com/coder/websocket"
)

type message struct {
	Key          string   `json:"key"`
	Proto        int      `json:"proto"`
	Fixture      string   `json:"fixture"`
	ControlEpoch string   `json:"controlEpoch"`
	X            *float64 `json:"x"`
	Y            *float64 `json:"y"`
	Type         string   `json:"type"`
	Device       string   `json:"device"`
	App          string   `json:"app"`
	Level        *int     `json:"level"`
	Seq          *int64   `json:"seq"`
}

func remoteIP(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

// publicHandler serves only the phone socket. A tunnel (Cloudflare) connects from
// 127.0.0.1, so /status and /admin must never be reachable through it: their loopback
// check would pass for every internet client (owner 2026-10-29: internet operation).
func (r *Runtime) publicHandler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", r.handlePhone)
	return mux
}

func (r *Runtime) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /ws", r.handlePhone)
	mux.HandleFunc("GET /status", r.handleStatus)
	mux.HandleFunc("GET /status.json", r.handleStatus)
	mux.Handle("/admin/", http.HandlerFunc(r.handleAdmin))
	return mux
}

func jsonReply(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (r *Runtime) handleAdmin(w http.ResponseWriter, req *http.Request) {
	ip := net.ParseIP(remoteIP(req.RemoteAddr))
	if ip == nil || !ip.IsLoopback() {
		jsonReply(w, http.StatusForbidden, map[string]string{"error": "loopback only"})
		return
	}
	if req.Method == "GET" && req.URL.Path == "/admin/devices" {
		r.mu.Lock()
		devices := make([]Device, 0, len(r.phones))
		for _, p := range r.phones {
			d := r.deviceView(p.device.ID)
			devices = append(devices, d)
		}
		r.mu.Unlock()
		sort.Slice(devices, func(i, j int) bool { return devices[i].ID < devices[j].ID })
		jsonReply(w, http.StatusOK, devices)
		return
	}
	if req.Method != "POST" || (req.URL.Path != "/admin/assign" && req.URL.Path != "/admin/release" && req.URL.Path != "/admin/forget") {
		http.NotFound(w, req)
		return
	}
	var in struct {
		Device  string `json:"device"`
		Fixture string `json:"fixture"`
	}
	dec := json.NewDecoder(http.MaxBytesReader(w, req.Body, 4096))
	if err := dec.Decode(&in); err != nil {
		jsonReply(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	var extra any
	if err := dec.Decode(&extra); err != io.EOF {
		jsonReply(w, http.StatusBadRequest, map[string]string{"error": "bad_request"})
		return
	}
	var err error
	if req.URL.Path == "/admin/forget" {
		err = r.forget(in.Device)
	} else {
		err = r.changeAssignment(in.Fixture, in.Device, req.URL.Path == "/admin/release")
	}
	if err != nil {
		jsonReply(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	jsonReply(w, http.StatusOK, map[string]bool{"ok": true})
}

func (r *Runtime) handlePhone(w http.ResponseWriter, req *http.Request) {
	conn, err := websocket.Accept(w, req, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(4096)
	ctx, cancel := context.WithCancel(req.Context())
	defer cancel()
	rejectReason := func(device, reason string) {
		r.event("", device, reason, 0, "phone")
		writeCtx, stop := context.WithTimeout(ctx, 500*time.Millisecond)
		defer stop()
		b, _ := json.Marshal(map[string]string{"type": "rejected", "reason": reason})
		_ = conn.Write(writeCtx, websocket.MessageText, b)
	}
	reject := func(device string) { rejectReason(device, "bad_request") }
	helloCtx, stop := context.WithTimeout(ctx, 6*time.Second)
	kind, b, err := conn.Read(helloCtx)
	stop()
	var m message
	if err != nil {
		return
	}
	if kind != websocket.MessageText || json.Unmarshal(b, &m) != nil || m.Type != "hello" || !deviceID.MatchString(m.Device) {
		reject(m.Device)
		return
	}
	hash, validKey := keyDigest(m.Key)
	p := &phone{keyHash: hash, ctx: ctx, sequences: map[string]int64{}, device: Device{ID: m.Device, IP: remoteIP(req.RemoteAddr), Since: time.Now()}, conn: conn, updates: make(chan State, 1), done: make(chan struct{}), gone: make(chan struct{})}
	r.mu.Lock()
	if r.closing {
		r.mu.Unlock()
		return
	}
	if validKey {
		r.observeKey(m.Device, hash, time.Now())
	}
	if bound := r.bindings[m.Device]; bound != "" && (!validKey || hash != bound) {
		r.mu.Unlock()
		rejectReason(m.Device, "key_mismatch")
		return
	}
	if !validKey {
		r.mu.Unlock()
		reject(m.Device)
		return
	}
	old := r.phones[m.Device]
	r.phones[m.Device] = p
	name, value := "", 0
	if f := r.fixtureFor(m.Device); f != nil {
		name, value = f.Name, f.level
		for _, assigned := range r.fixturesFor(m.Device) {
			r.renewEpoch(assigned)
		}
	}
	r.event(name, m.Device, "hello", value, "phone")
	r.push(p)
	r.mu.Unlock()
	if old != nil {
		_ = old.conn.CloseNow()
	}
	go p.writeLoop(ctx)
	go p.pingLoop(ctx)
	defer func() {
		defer close(p.gone)
		cancel()
		_ = conn.CloseNow()
		<-p.done
		r.mu.Lock()
		defer r.mu.Unlock()
		f := r.fixtureFor(p.device.ID)
		name, value := "", 0
		if f != nil {
			name, value = f.Name, f.level
		}
		if r.phones[p.device.ID] == p {
			delete(r.phones, p.device.ID)
			if f != nil {
				r.renewEpoch(f)
			}
		}
		r.event(name, p.device.ID, "disconnect", value, "phone")
	}()
	for {
		kind, b, err = conn.Read(ctx)
		if err != nil {
			return
		}
		m = message{}
		if kind != websocket.MessageText || json.Unmarshal(b, &m) != nil {
			reject(p.device.ID)
			return
		}
		if m.Type != "set" && m.Type != "on" && m.Type != "off" && m.Type != "aim" {
			reject(p.device.ID)
			return
		}
		if m.Type == "aim" {
			r.mu.Lock()
			f := r.fixtureFor(p.device.ID)
			moving := f != nil && f.moving()
			r.mu.Unlock()
			// A tagged aim may be in flight across an assignment change. Drop it
			// through apply's authority check without disconnecting the phone.
			if !moving && m.Fixture == "" && m.ControlEpoch == "" {
				reject(p.device.ID)
				return
			}
		}
		r.apply(p, m)
	}
}

func (p *phone) writeLoop(ctx context.Context) {
	defer close(p.done)
	for {
		select {
		case <-ctx.Done():
			return
		case s := <-p.updates:
			writeCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
			err := p.write(writeCtx, s)
			cancel()
			if err != nil {
				_ = p.conn.CloseNow()
				return
			}
		}
	}
}

func (p *phone) pingLoop(ctx context.Context) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			go func() {
				pingCtx, cancel := context.WithTimeout(ctx, 6*time.Second)
				defer cancel()
				if err := p.conn.Ping(pingCtx); err != nil {
					_ = p.conn.CloseNow()
				}
			}()
		}
	}
}
