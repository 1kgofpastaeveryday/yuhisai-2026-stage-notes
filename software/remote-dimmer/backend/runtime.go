package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type fixtureState struct {
	x, y                     float64
	aimSeq                   int64
	epoch                    string
	ready, owned             bool
	axesLast                 [4]int
	axesSentAt               time.Time
	axisMisses               [4]int
	pendingAim, pendingLevel *movingCommand
	Fixture
	level                      int
	lastNonzero                int
	locked, overridden         bool
	lastSent                   int
	sentAt                     time.Time
	widgetMisses, outputMisses int
	changedAt                  time.Time
	source                     string
	setLog                     setLogState
	pollWarnings               [2]string
}

type FixtureView struct {
	Name       string `json:"name"`
	Level      int    `json:"level"`
	On         bool   `json:"on"`
	Active     bool   `json:"active"`
	Overridden bool   `json:"overridden"`
	FaderMode  string `json:"faderMode"`
}

type State struct {
	Fixtures   []FixtureView `json:"fixtures"`
	Type       string        `json:"type"`
	Device     string        `json:"device"`
	IP         string        `json:"ip"`
	Fixture    *string       `json:"fixture"`
	Level      int           `json:"level"`
	On         bool          `json:"on"`
	Active     bool          `json:"active"`
	Overridden bool          `json:"overridden"`
	QLC        string        `json:"qlc"`
	// Sent only with an assignment; phones without it use their own default.
	FaderTravel float64 `json:"faderTravel,omitempty"`
	FaderMode   string  `json:"faderMode,omitempty"`
}

type Device struct {
	Connected bool      `json:"connected"`
	Fixtures  []string  `json:"fixtures"`
	Binding   string    `json:"binding"`
	ID        string    `json:"id"`
	IP        string    `json:"ip"`
	Fixture   *string   `json:"fixture"`
	Since     time.Time `json:"connectedSince"`
}

type phone struct {
	keyHash   string
	ctx       context.Context
	sequences map[string]int64
	device    Device
	conn      *websocket.Conn
	updates   chan State
	done      chan struct{}
	gone      chan struct{}
	writeMu   sync.Mutex
	closed    bool
	seq       int64
	hasSeq    bool
}

// Runtime owns fixture state, observations, and assignments.
type Runtime struct {
	mu               sync.Mutex
	config           Config
	bindings         map[string]string
	seenKeys         map[string]map[string]time.Time
	fixtures         []*fixtureState
	assignments      map[string]string
	phones           map[string]*phone
	connected        bool
	closing          bool
	logger           *log.Logger
	cancel           context.CancelFunc
	done             chan struct{}
	shutdownDeadline time.Time
	outputTicks      <-chan time.Time // Optional clock for deterministic transport tests.
	shutdownOnce     sync.Once
	shutdownDone     chan struct{}
	maintenanceDone  chan struct{}
	warnings         []string
	projectStamp     time.Time
	projectChecked   bool
	projectError     string
	zeroed           bool
}

func newRuntime(c Config, logs io.Writer) (*Runtime, error) {
	if err := c.validate(); err != nil {
		return nil, err
	}
	a, err := readAssignments(c)
	if err != nil {
		return nil, err
	}
	bindings, err := readBindings(c)
	if err != nil {
		return nil, err
	}
	r := &Runtime{bindings: bindings, seenKeys: map[string]map[string]time.Time{}, config: c, assignments: a, phones: map[string]*phone{}, logger: log.New(logs, "", 0), done: make(chan struct{}), shutdownDone: make(chan struct{})}
	for _, f := range c.Fixtures {
		r.fixtures = append(r.fixtures, &fixtureState{Fixture: f, changedAt: time.Now(), source: "system"})
	}
	r.checkProject()
	return r, nil
}

func (r *Runtime) event(fixture, device, event string, value int, source string, issues ...error) {
	problem := ""
	if len(issues) > 0 {
		problem = issues[0].Error()
	}
	b, _ := json.Marshal(struct {
		Time    time.Time `json:"time"`
		Fixture string    `json:"fixture"`
		Device  string    `json:"device"`
		Event   string    `json:"event"`
		Value   int       `json:"value"`
		Source  string    `json:"source"`
		Error   string    `json:"error,omitempty"`
	}{time.Now(), fixture, device, event, value, source, problem})
	r.logger.Print(string(b))
}

func (r *Runtime) fixtureFor(device string) *fixtureState {
	for _, f := range r.fixtures {
		if r.assignments[f.Name] == device {
			return f
		}
	}
	return nil
}

// fixturesFor follows config order, independently of assignment insertion order.
func (r *Runtime) fixturesFor(device string) []*fixtureState {
	out := []*fixtureState{}
	for _, f := range r.fixtures {
		if !f.moving() && r.assignments[f.Name] == device {
			out = append(out, f)
		}
	}
	return out
}

func (r *Runtime) state(p *phone) State {
	s := State{Type: "state", Device: p.device.ID, IP: p.device.IP, QLC: "disconnected", Fixtures: []FixtureView{}}
	if r.connected {
		s.QLC = "connected"
	}
	if !r.authorized(p) {
		return s
	}
	for _, f := range r.fixturesFor(p.device.ID) {
		s.Fixtures = append(s.Fixtures, FixtureView{f.Name, f.level, f.level > 0, r.connected && !r.closing && !f.locked, f.locked || f.overridden, f.faderMode()})
	}
	if len(s.Fixtures) > 0 {
		f := s.Fixtures[0]
		s.Fixture, s.Level, s.On, s.Active, s.Overridden, s.FaderMode = &f.Name, f.Level, f.On, f.Active, f.Overridden, f.FaderMode
		s.FaderTravel = r.fixturesFor(p.device.ID)[0].faderTravel()
	}
	return s
}

// A slow phone only needs the latest snapshot, never a backlog of stale states.
func (r *Runtime) push(p *phone) {
	s := r.state(p)
	select {
	case <-p.updates:
	default:
	}
	p.updates <- s
}

func (r *Runtime) broadcast() {
	for _, p := range r.phones {
		r.push(p)
	}
}

// changeAssignment is the single operation used by all admin entry points.
func (r *Runtime) changeAssignment(fixture, device string, release bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closing {
		return fmt.Errorf("server is shutting down")
	}
	var f *fixtureState
	for _, candidate := range r.fixtures {
		if candidate.Name == fixture {
			f = candidate
			break
		}
	}
	if f == nil {
		return fmt.Errorf("unknown fixture")
	}
	if !release {
		if !deviceID.MatchString(device) {
			return fmt.Errorf("invalid device ID")
		}
		if f.moving() {
			return fmt.Errorf("moving fixtures are not supported by the app")
		}
		if r.assignments[fixture] == device {
			return fmt.Errorf("fixture already assigned to device")
		}
	}
	if !release {
		if len(r.fixturesFor(device)) >= maxFixturesPerPhone {
			return fmt.Errorf("at most 4 fixtures per phone")
		}
		p := r.phones[device]
		if p == nil || p.conn == nil || (p.ctx != nil && p.ctx.Err() != nil) {
			return fmt.Errorf("no open connection for device")
		}
		if r.keyConflict(device, time.Now()) {
			return fmt.Errorf("key conflict: re-check the phone")
		}
		if p.keyHash == "" {
			return fmt.Errorf("connection has no valid key")
		}
		if bound := r.bindings[device]; bound != "" && bound != p.keyHash {
			return fmt.Errorf("key mismatch")
		}
		if r.bindings[device] == "" {
			bindings := cloneStrings(r.bindings)
			bindings[device] = p.keyHash
			// Persist authority first: an assignment must never outlive its credential.
			if err := saveAssignments(r.config.bindingsFile(), bindings); err != nil {
				return err
			}
			r.bindings = bindings
		}
	}
	a := make(map[string]string, len(r.assignments)+1)
	for k, v := range r.assignments {
		a[k] = v
	}
	old := a[fixture]
	event := "assign"
	if release {
		delete(a, fixture)
		device = old
		event = "release"
	} else {
		a[fixture] = device
	}
	if err := saveAssignments(r.config.AssignmentsFile, a); err != nil {
		return err
	}
	r.assignments = a
	r.renewEpoch(f)
	if release {
		zeroLevel(f, "admin")
	}
	f.changedAt, f.source = time.Now(), "admin"
	r.event(fixture, device, event, f.level, "admin")
	if old != device {
		if p := r.phones[old]; p != nil {
			r.push(p)
		}
	}
	if p := r.phones[device]; p != nil {
		r.push(p)
	}
	return nil
}

func (r *Runtime) apply(p *phone, m message) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closing || r.phones[p.device.ID] != p || !r.connected {
		return
	}
	if !r.authorized(p) || m.Seq == nil {
		return
	}
	fixtures := r.fixturesFor(p.device.ID)
	var f *fixtureState
	if m.Fixture == "" {
		if len(fixtures) != 1 {
			return
		}
		f = fixtures[0]
	} else {
		for _, candidate := range fixtures {
			if candidate.Name == m.Fixture {
				f = candidate
				break
			}
		}
	}
	if f == nil || f.locked || f.moving() || m.ControlEpoch != "" {
		return
	}
	if last, ok := p.sequences[f.Name]; ok && *m.Seq <= last {
		return
	}
	value := f.level
	switch m.Type {
	case "set":
		if m.Level == nil || *m.Level < 0 || *m.Level > 255 {
			return
		}
		value = *m.Level
	case "on":
		value = f.lastNonzero
		if value == 0 {
			value = 255
		}
	case "off":
		value = 0
	default:
		return
	}
	if p.sequences == nil {
		p.sequences = map[string]int64{}
	}
	p.sequences[f.Name] = *m.Seq
	if value > 0 {
		f.lastNonzero = value
	}
	changed := f.level != value
	f.level = value
	now := time.Now()
	if m.Type == "set" {
		r.logSet(f, p.device.ID, value, now)
	} else {
		r.event(f.Name, p.device.ID, m.Type, value, "phone")
	}
	if changed {
		f.changedAt, f.source = now, "phone"
		r.push(p)
	}
}

func (r *Runtime) start() {
	ctx, cancel := context.WithCancel(context.Background())
	r.cancel = cancel
	r.maintenanceDone = make(chan struct{})
	go r.maintain(ctx)
	go r.runQLC(ctx)
}

func (p *phone) write(ctx context.Context, value any) error {
	p.writeMu.Lock()
	defer p.writeMu.Unlock()
	if p.closed {
		return fmt.Errorf("phone closed")
	}
	b, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return p.conn.Write(ctx, websocket.MessageText, b)
}

// zeroLevel uses the desired-level path consumed by the existing QLC+ loop.
// The caller holds r.mu; transport and shutdown verification stay in qlc.go.
func zeroLevel(f *fixtureState, source string) {
	if f.level != 0 {
		f.changedAt, f.source = time.Now(), source
	}
	f.level = 0
}

func (r *Runtime) shutdown() {
	r.shutdownOnce.Do(func() {
		defer close(r.shutdownDone)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		r.mu.Lock()
		r.closing = true
		for _, f := range r.fixtures {
			r.renewEpoch(f)
		}
		phones := make([]*phone, 0, len(r.phones))
		for _, p := range r.phones {
			phones = append(phones, p)
		}
		r.event("", "", "shutdown", 0, "system")
		r.mu.Unlock()
		// Notify all phones before QLC+ receives the zero/PREV_PG sequence.
		var wg sync.WaitGroup
		for _, p := range phones {
			wg.Go(func() {
				p.writeMu.Lock()
				notifyCtx, stop := context.WithTimeout(ctx, 500*time.Millisecond)
				_ = p.conn.Write(notifyCtx, websocket.MessageText, []byte(`{"type":"shutdown"}`))
				stop()
				p.closed = true
				p.writeMu.Unlock()
				_ = p.conn.CloseNow()
				<-p.gone
			})
		}
		wg.Wait()
		// The QLC+ loop uses the same shutdown deadline for its final writes.
		r.mu.Lock()
		r.shutdownDeadline = deadlineOf(ctx)
		for _, f := range r.fixtures {
			zeroLevel(f, "system")
		}
		r.mu.Unlock()
		r.cancel()
		<-r.done
		<-r.maintenanceDone
	})
	<-r.shutdownDone
}

func deadlineOf(ctx context.Context) time.Time { d, _ := ctx.Deadline(); return d }
