package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const keyConflictWindow = 60 * time.Second

func keyDigest(key string) (string, bool) {
	// Re-encoding also rejects padding, whitespace, CR/LF and noncanonical bits.
	b, err := base64.RawURLEncoding.Strict().DecodeString(key)
	if err != nil || len(b) != 32 || base64.RawURLEncoding.EncodeToString(b) != key {
		return "", false
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), true
}

func (c Config) bindingsFile() string {
	return filepath.Join(filepath.Dir(c.AssignmentsFile), "bindings.json")
}

// A malformed binding file prevents startup. Never interpret corruption as unbound.
func readBindings(c Config) (map[string]string, error) {
	b, err := os.ReadFile(c.bindingsFile())
	if os.IsNotExist(err) {
		return map[string]string{}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read bindings: %w", err)
	}
	invalid := func() (map[string]string, error) { return nil, fmt.Errorf("invalid binding file") }
	dec := json.NewDecoder(strings.NewReader(string(b)))
	start, err := dec.Token()
	if err != nil || start != json.Delim('{') {
		return invalid()
	}
	bindings := map[string]string{}
	for dec.More() {
		name, err := dec.Token()
		if err != nil {
			return invalid()
		}
		id, ok := name.(string)
		if !ok || !deviceID.MatchString(id) {
			return invalid()
		}
		var hash string
		if dec.Decode(&hash) != nil {
			return invalid()
		}
		decoded, err := hex.DecodeString(hash)
		if err != nil || len(decoded) != sha256.Size || hex.EncodeToString(decoded) != hash || bindings[id] != "" {
			return invalid()
		}
		bindings[id] = hash
	}
	if end, err := dec.Token(); err != nil || end != json.Delim('}') {
		return invalid()
	}
	if _, err := dec.Token(); err != io.EOF {
		return invalid()
	}
	return bindings, nil
}

func cloneStrings(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

// These helpers are called with r.mu held. Observations survive socket replacement.
func (r *Runtime) keyConflict(id string, now time.Time) bool {
	keys := r.seenKeys[id]
	for hash, seen := range keys {
		if now.Sub(seen) >= keyConflictWindow {
			delete(keys, hash)
		}
	}
	return len(keys) > 1
}
func (r *Runtime) observeKey(id, hash string, now time.Time) {
	r.keyConflict(id, now)
	if r.seenKeys[id] == nil {
		r.seenKeys[id] = map[string]time.Time{}
	}
	r.seenKeys[id][hash] = now
}
func (r *Runtime) authorized(p *phone) bool {
	return p.keyHash != "" && r.bindings[p.device.ID] == p.keyHash
}
func (r *Runtime) deviceView(id string) Device {
	d := Device{ID: id, Fixtures: []string{}, Binding: "unbound"}
	if p := r.phones[id]; p != nil {
		d = p.device
		d.Connected = true
		d.Binding = "unbound"
		d.Fixtures = []string{}
	}
	for _, f := range r.fixturesFor(id) {
		d.Fixtures = append(d.Fixtures, f.Name)
	}
	if len(d.Fixtures) > 0 {
		d.Fixture = &d.Fixtures[0]
	}
	if r.bindings[id] != "" {
		d.Binding = "bound"
	}
	if r.keyConflict(id, time.Now()) {
		d.Binding = "key conflict"
	}
	return d
}

func (r *Runtime) forget(id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closing {
		return fmt.Errorf("server is shutting down")
	}
	if !deviceID.MatchString(id) {
		return fmt.Errorf("invalid device ID")
	}
	assignments := cloneStrings(r.assignments)
	for fixture, device := range assignments {
		if device == id {
			delete(assignments, fixture)
		}
	}
	// Revoke assignments before removing a credential, including across a crash.
	if err := saveAssignments(r.config.AssignmentsFile, assignments); err != nil {
		return err
	}
	for _, f := range r.fixtures {
		if r.assignments[f.Name] == id {
			r.renewEpoch(f)
			zeroLevel(f, "admin")
			f.changedAt, f.source = time.Now(), "admin"
		}
	}
	r.assignments = assignments
	if p := r.phones[id]; p != nil {
		r.push(p)
	}
	bindings := cloneStrings(r.bindings)
	delete(bindings, id)
	if err := saveAssignments(r.config.bindingsFile(), bindings); err != nil {
		return err
	}
	r.bindings = bindings
	r.event("", id, "forget", 0, "admin")
	if p := r.phones[id]; p != nil {
		r.push(p)
	}
	return nil
}
