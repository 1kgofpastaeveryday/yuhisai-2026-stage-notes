package main

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math"
	"time"
)

type Axis struct {
	Universe int `json:"universe"`
	Coarse   int `json:"coarse"`
	Fine     int `json:"fine"`
	Min      int `json:"min"`
	Max      int `json:"max"`
}
type Acceleration struct {
	Enabled       bool    `json:"enabled"`
	LowSpeed      float64 `json:"lowSpeed"`
	HighSpeed     float64 `json:"highSpeed"`
	MaxMultiplier float64 `json:"maxMultiplier"`
	FilterMs      float64 `json:"filterMs"`
}

func defaultAcceleration() Acceleration { return Acceleration{false, .25, 1.5, 1.75, 40} }
func (a *Acceleration) UnmarshalJSON(b []byte) error {
	type plain Acceleration
	v := plain(defaultAcceleration())
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*a = Acceleration(v)
	return nil
}
func (f *Fixture) UnmarshalJSON(b []byte) error {
	type plain Fixture
	v := plain{GainX: .35, GainY: .35, StripSide: "left", StripToggle: "tap", Acceleration: defaultAcceleration()}
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	*f = Fixture(v)
	return nil
}
func (f Fixture) moving() bool { return f.Kind == "moving" }

// 500 pt (about 8 cm on an iPhone 18 Pro): the owner tried full screen height (too
// slow), 300 pt (too sensitive) and 500 pt (good) on a real phone on 2026-10-16.
const defaultFaderTravel = 500

func (f Fixture) faderMode() string {
	if f.FaderMode == "" {
		return "relative"
	}
	return f.FaderMode
}

func (f Fixture) faderTravel() float64 {
	if f.FaderTravel == 0 {
		return defaultFaderTravel
	}
	return f.FaderTravel
}
func finite(v float64) bool   { return !math.IsNaN(v) && !math.IsInf(v, 0) }
func positive(v float64) bool { return finite(v) && v > 0 }
func clamp(v float64) float64 { return math.Max(0, math.Min(1, v)) }
func (f Fixture) axisChannels() [4][2]int {
	return [4][2]int{{f.Pan.Universe, f.Pan.Coarse}, {f.Pan.Universe, f.Pan.Fine}, {f.Tilt.Universe, f.Tilt.Coarse}, {f.Tilt.Universe, f.Tilt.Fine}}
}
func absolute(ch [2]int) int { return (ch[0]-1)*512 + ch[1] }
func (f Fixture) mapAim(x, y float64) [4]int {
	p, t := x, y
	if f.SwapAxes {
		p, t = t, p
	}
	if f.InvertPan {
		p = 1 - p
	}
	if f.InvertTilt {
		t = 1 - t
	}
	pan := int(math.Round(float64(f.Pan.Min) + p*float64(f.Pan.Max-f.Pan.Min)))
	tilt := int(math.Round(float64(f.Tilt.Min) + t*float64(f.Tilt.Max-f.Tilt.Min)))
	return [4]int{pan >> 8, pan & 255, tilt >> 8, tilt & 255}
}
func (f Fixture) unmapAim(b [4]int) (float64, float64) {
	p := clamp(float64((b[0]<<8|b[1])-f.Pan.Min) / float64(f.Pan.Max-f.Pan.Min))
	t := clamp(float64((b[2]<<8|b[3])-f.Tilt.Min) / float64(f.Tilt.Max-f.Tilt.Min))
	if f.InvertPan {
		p = 1 - p
	}
	if f.InvertTilt {
		t = 1 - t
	}
	if f.SwapAxes {
		p, t = t, p
	}
	return p, t
}
func (f Fixture) validateMoving() error {
	if !f.moving() {
		if f.Kind != "" && f.Kind != "dimmer" {
			return fmt.Errorf("%s: unknown kind", f.Name)
		}
		return nil
	}
	for _, a := range []Axis{f.Pan, f.Tilt} {
		if a.Universe < 1 || a.Universe > 4 || a.Coarse < 1 || a.Coarse > 512 || a.Fine < 1 || a.Fine > 512 || a.Min < 0 || a.Min >= a.Max || a.Max > 65535 {
			return fmt.Errorf("%s: invalid axis", f.Name)
		}
	}
	a := f.Acceleration
	if !positive(f.GainX) || !positive(f.GainY) || (f.StripSide != "left" && f.StripSide != "right") || (f.StripToggle != "tap" && f.StripToggle != "hold") || !finite(a.LowSpeed) || !finite(a.HighSpeed) || a.LowSpeed >= a.HighSpeed || !finite(a.MaxMultiplier) || a.MaxMultiplier < 1 || !positive(a.FilterMs) {
		return fmt.Errorf("%s: invalid moving controls", f.Name)
	}
	return nil
}

type MovingState struct {
	Kind         string       `json:"kind"`
	X            float64      `json:"x"`
	Y            float64      `json:"y"`
	AimSeq       int64        `json:"aimSeq"`
	ControlEpoch string       `json:"controlEpoch"`
	GainX        float64      `json:"gainX"`
	GainY        float64      `json:"gainY"`
	StripSide    string       `json:"stripSide"`
	StripToggle  string       `json:"stripToggle"`
	Acceleration Acceleration `json:"acceleration"`
}

// Each pending output retains the authority that accepted it. Never infer authority
// from a fixture's latest desired value when the transport eventually flushes.
type movingCommand struct {
	phone   *phone
	epoch   string
	fixture string
	seq     int64
	bytes   [4]int
	level   int
}

func (r *Runtime) renewEpoch(f *fixtureState) {
	if !f.moving() {
		return
	}
	f.epoch = rand.Text()
	f.aimSeq = 0
	f.pendingAim = nil
	f.pendingLevel = nil
}
func (r *Runtime) validMoving(f *fixtureState, c *movingCommand) bool {
	return c != nil && !r.closing && r.connected && f.ready && !f.locked && c.epoch == f.epoch && c.fixture == f.Name && r.phones[c.phone.device.ID] == c.phone && r.fixtureFor(c.phone.device.ID) == f && c.phone.hasSeq && c.seq <= c.phone.seq
}
func (r *Runtime) lockMoving(f *fixtureState, now time.Time) {
	f.locked = true
	f.owned = false
	r.renewEpoch(f)
	f.changedAt, f.source = now, "system"
	r.event(f.Name, r.assignments[f.Name], "qlc_direct", f.level, "system")
}
func (r *Runtime) observeAxes(index int, b [4]int, held [4]bool, requested, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f := r.fixtures[index]
	if r.closing || !r.connected || !f.owned || f.locked {
		return
	}
	if requested.Before(f.axesSentAt) {
		f.axisMisses = [4]int{}
		return
	}
	for i := range b {
		if b[i] == f.axesLast[i] && held[i] {
			f.axisMisses[i] = 0
		} else {
			f.axisMisses[i]++
			if f.axisMisses[i] >= 2 && now.Sub(f.axesSentAt) >= settleInterval {
				r.lockMoving(f, now)
				r.broadcast()
				return
			}
		}
	}
}
