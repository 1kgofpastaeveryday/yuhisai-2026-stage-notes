package main

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

// query is used only by the QLC goroutine, with no other request outstanding.
// A timed-out transaction ends the connection to exclude late, universe-less replies.
func query(ctx context.Context, c *websocket.Conn, replies <-chan string, frame, method string) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()
	if err := writeQLC(ctx, c, frame); err != nil {
		return nil, err
	}
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case reply := <-replies:
			p := strings.Split(reply, "|")
			if len(p) >= 2 && p[0] == "QLC+API" && p[1] == method {
				return p, nil
			}
		}
	}
}
func readWidget(ctx context.Context, c *websocket.Conn, replies <-chan string, id int) error {
	p, err := query(ctx, c, replies, fmt.Sprintf("QLC+API|getWidgetStatus|%d", id), "getWidgetStatus")
	if err != nil {
		return err
	}
	if len(p) != 4 || p[2] != strconv.Itoa(id) || p[3] != "0" {
		return fmt.Errorf("slider %d: zero readback failed: %v", id, p)
	}
	return nil
}
func readAxes(ctx context.Context, c *websocket.Conn, replies <-chan string, f Fixture) ([4]int, [4]bool, error) {
	var b [4]int
	var held [4]bool
	channels := f.axisChannels()
	order := []int{0, 1, 2, 3}
	sort.Slice(order, func(i, j int) bool { return absolute(channels[order[i]]) < absolute(channels[order[j]]) })
	for start := 0; start < 4; {
		end := start + 1
		for end < 4 && channels[order[end]][0] == channels[order[start]][0] && channels[order[end]][1] == channels[order[end-1]][1]+1 {
			end++
		}
		ch := channels[order[start]]
		count := end - start
		p, err := query(ctx, c, replies, fmt.Sprintf("QLC+API|getChannelsValues|%d|%d|%d", ch[0], ch[1], count), "getChannelsValues")
		if err != nil {
			return b, held, err
		}
		if len(p) != 2+count*4 {
			return b, held, fmt.Errorf("%s: malformed axis readback: %v", f.Name, p)
		}
		for j := 0; j < count; j++ {
			k := 2 + j*4
			v, e := strconv.Atoi(p[k+1])
			index := order[start+j]
			if p[k] != strconv.Itoa(ch[1]+j) || e != nil || v < 0 || v > 255 || (p[k+3] != "0" && p[k+3] != "1") {
				return b, held, fmt.Errorf("%s: invalid channel %v", f.Name, p[k:k+4])
			}
			b[index] = v
			held[index] = p[k+3] == "1"
		}
		start = end
	}
	return b, held, nil
}
func writeAxes(ctx context.Context, c *websocket.Conn, f Fixture, b [4]int) error {
	// The sole writer always completes a whole group before any other work.
	for i, ch := range f.axisChannels() {
		if err := writeQLC(ctx, c, fmt.Sprintf("CH|%d|%d", absolute(ch), b[i])); err != nil {
			return err
		}
	}
	return nil
}
func checkAxes(f Fixture, b, want [4]int, held [4]bool, owned bool) error {
	var problems []string
	for i, ch := range f.axisChannels() {
		if held[i] != owned || (owned && b[i] != want[i]) {
			problems = append(problems, fmt.Sprintf("channel %d value=%d isOverride=%t expected value=%d isOverride=%t", absolute(ch), b[i], held[i], want[i], owned))
		}
	}
	if len(problems) > 0 {
		return fmt.Errorf("%s: %s", f.Name, strings.Join(problems, "; "))
	}
	return nil
}
func (r *Runtime) acquireAxes(ctx context.Context, c *websocket.Conn, replies <-chan string, index int) error {
	f := r.fixtures[index]
	b, _, err := readAxes(ctx, c, replies, f.Fixture)
	if err != nil {
		return err
	}
	x, y := f.unmapAim(b)
	target := f.mapAim(x, y)
	// Hold the mutex across the group so a lock/shutdown cannot bisect it.
	r.mu.Lock()
	if r.closing || f.locked {
		r.mu.Unlock()
		return nil
	}
	writeCtx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	err = writeAxes(writeCtx, c, f.Fixture, target)
	cancel()
	if err == nil {
		f.axesLast = target
		f.axesSentAt = time.Now()
		f.axisMisses = [4]int{}
	}
	r.mu.Unlock()
	if err != nil {
		return err
	}
	b, held, err := readAxes(ctx, c, replies, f.Fixture)
	if err != nil {
		return err
	}
	if err = checkAxes(f.Fixture, b, target, held, true); err != nil {
		r.event(f.Name, "", "qlc_warning", 0, "system", err)
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.closing && !f.locked {
		f.x, f.y = x, y
		f.ready, f.owned = true, true
		f.aimSeq = 0
	}
	return nil
}
func (r *Runtime) flushMoving(ctx context.Context, c *websocket.Conn, index int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	f := r.fixtures[index]
	if pending := f.pendingLevel; pending != nil {
		f.pendingLevel = nil
		if r.validMoving(f, pending) && pending.level != f.lastSent {
			if err := writeQLC(ctx, c, fmt.Sprintf("%d|%d", f.Slider, pending.level)); err != nil {
				return err
			}
			f.lastSent, f.sentAt = pending.level, time.Now()
			f.widgetMisses, f.outputMisses = 0, 0
		}
	}
	if pending := f.pendingAim; pending != nil {
		f.pendingAim = nil
		if r.validMoving(f, pending) && pending.bytes != f.axesLast {
			if err := writeAxes(ctx, c, f.Fixture, pending.bytes); err != nil {
				return err
			}
			f.axesLast, f.axesSentAt = pending.bytes, time.Now()
			f.axisMisses = [4]int{}
		}
	}
	return nil
}
