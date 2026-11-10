package main

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
)

type Fixture struct {
	Kind         string       `json:"kind,omitempty"`
	Pan          Axis         `json:"pan"`
	Tilt         Axis         `json:"tilt"`
	SwapAxes     bool         `json:"swapAxes"`
	InvertPan    bool         `json:"invertPan"`
	InvertTilt   bool         `json:"invertTilt"`
	GainX        float64      `json:"gainX"`
	GainY        float64      `json:"gainY"`
	StripSide    string       `json:"stripSide"`
	StripToggle  string       `json:"stripToggle"`
	Acceleration Acceleration `json:"acceleration"`
	// Finger travel in points for a full 0-255 brightness swipe (owner 2026-10-16:
	// full screen height was too much). 0 means the default.
	FaderTravel float64 `json:"faderTravel"`
	// "relative" (default): full-screen swipe by finger travel. "absolute": a
	// faderTravel-tall bar where the touched position is the level (owner
	// 2026-10-16: wants the speed of jumping straight to a level).
	FaderMode string `json:"faderMode"`
	Name      string `json:"name"`
	Slider    int    `json:"slider"`
	Universe  int    `json:"universe"`
	Address   int    `json:"address"`
}

type Config struct {
	Listen          string    `json:"listen"`
	PublicListen    string    `json:"publicListen"` // phone socket only, for a tunnel; empty = off
	QLCURL          string    `json:"qlcURL"`
	Project         string    `json:"project"`
	IndicatorFrame  int       `json:"indicatorFrame"`
	AssignmentsFile string    `json:"assignmentsFile"`
	LogFile         string    `json:"logFile"`
	Fixtures        []Fixture `json:"fixtures"`
}

const maxFixturesPerPhone = 4

var deviceID = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{6}$`)

func loadConfig(path string) (Config, error) {
	c := Config{Listen: ":8765", QLCURL: "ws://127.0.0.1:9999/qlcplusWS", AssignmentsFile: "assignments.json", LogFile: "remote-dimmer.log"}
	b, err := os.ReadFile(path)
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal(b, &c); err != nil {
		return c, err
	}
	return c, c.validate()
}

func (c Config) validate() error {
	if c.PublicListen != "" {
		host, _, err := net.SplitHostPort(c.PublicListen)
		ip := net.ParseIP(host)
		if err != nil || ip == nil || !ip.IsLoopback() {
			return fmt.Errorf("publicListen must be a loopback IP address with a port")
		}
	}

	if len(c.Fixtures) == 0 {
		return fmt.Errorf("fixtures must not be empty")
	}
	if c.IndicatorFrame < 0 {
		return fmt.Errorf("indicatorFrame must be nonnegative")
	}
	names, sliders, channels := map[string]bool{}, map[int]bool{}, map[[2]int]bool{}
	for _, f := range c.Fixtures {
		if err := f.validateMoving(); err != nil {
			return err
		}
		if f.FaderTravel < 0 || !finite(f.FaderTravel) {
			return fmt.Errorf("%s: faderTravel must be positive", f.Name)
		}
		if f.FaderMode != "" && f.FaderMode != "relative" && f.FaderMode != "absolute" {
			return fmt.Errorf("%s: faderMode must be relative or absolute", f.Name)
		}
		if f.Universe < 1 || f.Universe > 4 || f.Address < 1 || f.Address > 512 || f.Slider < 0 || f.Slider == c.IndicatorFrame {
			return fmt.Errorf("invalid universe, address, slider, or indicator collision: %s", f.Name)
		}
		ch := [2]int{f.Universe, f.Address}
		if names[f.Name] || sliders[f.Slider] || channels[ch] {
			return fmt.Errorf("duplicate fixture name, slider, or channel: %s", f.Name)
		}
		names[f.Name], sliders[f.Slider], channels[ch] = true, true, true
	}
	for _, f := range c.Fixtures {
		if f.moving() {
			for _, ch := range f.axisChannels() {
				if channels[ch] {
					return fmt.Errorf("%s: overlapping moving channel %v", f.Name, ch)
				}
				channels[ch] = true
			}
		}
	}
	return nil
}

func readAssignments(c Config) (map[string]string, error) {
	a := map[string]string{}
	b, err := os.ReadFile(c.AssignmentsFile)
	if os.IsNotExist(err) {
		return a, nil
	}
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal(b, &a); err != nil {
		return nil, err
	}
	if a == nil {
		return nil, fmt.Errorf("assignments must be a JSON object")
	}
	known, devices := map[string]bool{}, map[string]int{}
	for _, f := range c.Fixtures {
		known[f.Name] = !f.moving()
	}
	for f, d := range a {
		if !known[f] || !deviceID.MatchString(d) || devices[d] >= maxFixturesPerPhone {
			return nil, fmt.Errorf("invalid assignment %q: %q", f, d)
		}
		devices[d]++
	}
	return a, nil
}

func saveAssignments(path string, a map[string]string) error {
	b, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".assignments-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err = f.Write(append(b, '\n')); err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
