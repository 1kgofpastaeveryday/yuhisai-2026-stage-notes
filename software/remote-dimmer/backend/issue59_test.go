package main

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAssignMovesOwnedFixtureThroughCLI(t *testing.T) {
	q := newFakeQLC(t)
	c := testConfig(t, q)
	r, s := setup(t, c)
	startup(t, q, r)
	c.Listen = strings.TrimPrefix(s.URL, "http://")
	old := hello(t, s, "K7Q2MX")
	old.packet(t, "state")
	next := hello(t, s, "AAAAAA")
	next.packet(t, "state")
	assign(t, s, "K7Q2MX", "中央", 200)
	assign(t, s, "AAAAAA", "左", 200) // Recipient is already bound.
	command(t, r, old, "K7Q2MX", "set", 143, 1)
	old.state(t, func(s State) bool { return s.Level == 143 })
	q.expect(t, "45|143")
	if err := adminCLI(c, []string{"assign", "AAAAAA", "中央"}, io.Discard); err != nil {
		t.Fatal(err)
	}
	old.state(t, func(s State) bool { return len(s.Fixtures) == 0 && !s.Active })
	next.state(t, func(s State) bool {
		return len(s.Fixtures) == 2 && s.Fixtures[0].Name == "中央" && s.Level == 143 && s.Active
	})
	saved, err := readAssignments(c)
	if err != nil || saved["中央"] != "AAAAAA" {
		t.Fatal("transfer not persisted", saved, err)
	}
	r.mu.Lock()
	stale := r.phones["K7Q2MX"]
	session := r.phones["AAAAAA"]
	r.mu.Unlock()
	value, seq := 0, int64(2)
	r.apply(stale, message{Type: "set", Fixture: "中央", Level: &value, Seq: &seq})
	r.mu.Lock()
	level, memory := r.fixtures[0].level, r.fixtures[0].lastNonzero
	r.mu.Unlock()
	if level != 143 || memory != 143 {
		t.Fatalf("transfer changed brightness/memory: %d/%d", level, memory)
	}
	value, seq = 144, int64(1)
	r.apply(session, message{Type: "set", Fixture: "中央", Level: &value, Seq: &seq})
	next.state(t, func(s State) bool { return s.Level == 144 })
	// Any intervening zero from the transfer would fail this frame assertion.
	q.expect(t, "45|144")
}

func TestMoveRetainsRecipientChecks(t *testing.T) {
	for _, name := range []string{"invalid ID", "offline", "closed context", "missing key", "key mismatch", "key conflict", "fixture limit", "same owner", "persistence failure"} {
		t.Run(name, func(t *testing.T) {
			c := testConfig(t, nil)
			for i := 2; i < 5; i++ {
				c.Fixtures = append(c.Fixtures, Fixture{Name: fmt.Sprintf("F%d", i), Slider: 45 + i, Universe: 1, Address: 9 + i})
			}
			r, err := newRuntime(c, io.Discard)
			if err != nil {
				t.Fatal(err)
			}
			old, next := unitPhone(t, "K7Q2MX", 1), unitPhone(t, "AAAAAA", 2)
			r.phones[old.device.ID], r.phones[next.device.ID] = old, next
			r.bindings[old.device.ID], r.bindings[next.device.ID] = old.keyHash, next.keyHash
			if err := r.changeAssignment("中央", old.device.ID, false); err != nil {
				t.Fatal(err)
			}
			<-old.updates
			r.fixtures[0].level = 143
			target := next.device.ID
			switch name {
			case "invalid ID":
				target = "invalid"
			case "offline":
				next.conn = nil
			case "closed context":
				ctx, cancel := context.WithCancel(context.Background())
				cancel()
				next.ctx = ctx
			case "missing key":
				next.keyHash = ""
			case "key mismatch":
				r.bindings[target] = old.keyHash
			case "key conflict":
				r.observeKey(target, old.keyHash, time.Now())
				r.observeKey(target, next.keyHash, time.Now())
			case "fixture limit":
				for _, f := range r.fixtures[1:] {
					r.assignments[f.Name] = target
				}
			case "same owner":
				target = old.device.ID
			case "persistence failure":
				r.config.AssignmentsFile = filepath.Join(t.TempDir(), "missing", "assignments.json")
			}
			if err := r.changeAssignment("中央", target, false); err == nil {
				t.Fatal("invalid transfer accepted")
			}
			if r.assignments["中央"] != old.device.ID || r.fixtures[0].level != 143 || len(old.updates) != 0 || len(next.updates) != 0 {
				t.Fatal("failed transfer disturbed ownership, level or phone state")
			}
		})
	}
}

func TestForgetOnlyZeroesOwnedFixturesAndReleaseRequiresPersistence(t *testing.T) {
	r, err := newRuntime(testConfig(t, nil), io.Discard)
	if err != nil {
		t.Fatal(err)
	}
	old, other := unitPhone(t, "K7Q2MX", 1), unitPhone(t, "AAAAAA", 2)
	r.phones[old.device.ID], r.phones[other.device.ID] = old, other
	for name, id := range map[string]string{"中央": old.device.ID, "左": other.device.ID} {
		if err := r.changeAssignment(name, id, false); err != nil {
			t.Fatal(err)
		}
	}
	r.fixtures[0].level, r.fixtures[1].level = 91, 137
	path := r.config.AssignmentsFile
	r.config.AssignmentsFile = filepath.Join(t.TempDir(), "missing", "assignments.json")
	if err := r.changeAssignment("中央", "", true); err == nil {
		t.Fatal("release ignored persistence failure")
	}
	if err := r.forget(old.device.ID); err == nil {
		t.Fatal("forget ignored persistence failure")
	}
	if r.fixtures[0].level != 91 || r.assignments["中央"] != old.device.ID {
		t.Fatal("failed revocation changed level or ownership")
	}
	r.config.AssignmentsFile = path
	if err := r.forget(old.device.ID); err != nil {
		t.Fatal(err)
	}
	if r.fixtures[0].level != 0 || r.fixtures[1].level != 137 || r.assignments["左"] != other.device.ID {
		t.Fatal("forget changed another device's fixture")
	}
}
