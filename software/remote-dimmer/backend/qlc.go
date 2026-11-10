package main

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/coder/websocket"
)

const outputInterval = time.Second / 30

func writeQLC(ctx context.Context, c *websocket.Conn, frame string) error {
	return c.Write(ctx, websocket.MessageText, []byte(frame))
}

func (r *Runtime) levels() []int {
	r.mu.Lock()
	defer r.mu.Unlock()
	values := make([]int, len(r.fixtures))
	for i, f := range r.fixtures {
		values[i] = f.level
	}
	return values
}

func (r *Runtime) connection(connected bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.connected == connected {
		return
	}
	r.connected = connected
	if !connected {
		for _, f := range r.fixtures {
			if f.moving() {
				f.ready = false
				f.pendingAim = nil
				f.pendingLevel = nil
				if !f.locked {
					f.level = f.lastSent
				}
			}
		}
	}
	event := "qlc_disconnect"
	if connected {
		event = "qlc_connect"
	}
	r.event("", "", event, 0, "system")
	if !r.closing {
		r.broadcast()
	}
}

func (r *Runtime) runQLC(ctx context.Context) {
	defer close(r.done)
	for ctx.Err() == nil {
		dialCtx, cancel := context.WithTimeout(ctx, time.Second)
		conn, _, err := websocket.Dial(dialCtx, r.config.QLCURL, nil)
		cancel()
		if err == nil {
			r.serveQLC(ctx, conn)
			_ = conn.CloseNow()
			r.connection(false)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Second):
		}
	}
}

func (r *Runtime) serveQLC(ctx context.Context, conn *websocket.Conn) {
	// Reading is necessary to detect disconnects and consume control frames.
	// Unknown QLC+ notifications, including FUNCTION events, are intentionally ignored.
	readDone := make(chan struct{})
	replies := make(chan string, 64)
	readCtx, stopReading := context.WithCancel(context.Background())
	defer stopReading()
	go func() {
		defer close(readDone)
		for {
			kind, b, err := conn.Read(readCtx)
			if err != nil {
				return
			}
			if kind == websocket.MessageText {
				select {
				case replies <- string(b):
				case <-readCtx.Done():
					return
				}
			}
		}
	}()
	defer func() { stopReading(); _ = conn.CloseNow(); <-readDone }()
	pendingMethod := ""
	readbackSafe := true
	defer func() {
		if ctx.Err() != nil {
			// Finish the outstanding poll before issuing a shutdown readback.
			if pendingMethod != "" {
				timer := time.NewTimer(500 * time.Millisecond)
				waiting := true
				for waiting {
					select {
					case reply := <-replies:
						p := strings.Split(reply, "|")
						if len(p) >= 2 && p[0] == "QLC+API" && p[1] == pendingMethod {
							waiting = false
						}
					case <-timer.C:
						readbackSafe = false
						waiting = false
					case <-readDone:
						waiting = false
					}
				}
				timer.Stop()
			}
			r.finishQLC(conn, replies, readbackSafe)
		}
	}()
	send := func(frame string) error {
		r.mu.Lock()
		closing := r.closing
		r.mu.Unlock()
		if closing {
			return nil
		}
		writeCtx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		return writeQLC(writeCtx, conn, frame)
	}
	sendLevel := func(i, value int) error {
		r.mu.Lock()
		defer r.mu.Unlock()
		if r.closing {
			return nil
		}
		f := r.fixtures[i]
		writeCtx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()
		if err := writeQLC(writeCtx, conn, fmt.Sprintf("%d|%d", f.Slider, value)); err != nil {
			return err
		}
		f.lastSent, f.sentAt = value, time.Now()
		f.widgetMisses, f.outputMisses = 0, 0
		return nil
	}
	last := r.levels()
	for i := range r.fixtures {
		f := r.fixtures[i]
		if f.moving() {
			r.mu.Lock()
			locked := f.locked
			f.ready = false
			f.owned = false
			last[i] = f.lastSent
			if !locked {
				f.level = f.lastSent
			}
			f.pendingAim = nil
			f.pendingLevel = nil
			r.mu.Unlock()
			if locked {
				continue
			}
		}
		if err := sendLevel(i, last[i]); err != nil {
			return
		}
		if f.moving() && last[i] == 0 {
			if err := readWidget(context.WithoutCancel(ctx), conn, replies, f.Slider); err != nil {
				readbackSafe = false
				r.event(f.Name, "", "qlc_warning", 0, "system", err)
				return
			}
		}
		if f.moving() {
			if err := r.acquireAxes(context.WithoutCancel(ctx), conn, replies, i); err != nil {
				readbackSafe = false
				r.event(f.Name, "", "qlc_warning", 0, "system", err)
				return
			}
		}
	}
	if err := send(fmt.Sprintf("%d|NEXT_PG", r.config.IndicatorFrame)); err != nil {
		return
	}
	r.connection(true)
	output := time.NewTicker(outputInterval)
	indicator := time.NewTicker(3 * time.Second)
	outputC := output.C
	if r.outputTicks != nil {
		outputC = r.outputTicks
	}
	defer output.Stop()
	defer indicator.Stop()
	poll := time.NewTicker(pollInterval)
	defer poll.Stop()
	// Channel replies omit the universe. Keep exactly one request outstanding,
	// including across universes with identical addresses. Reconnect on timeout
	// so a late reply can never be mistaken for another fixture's sample.
	cursor := -1
	var requested time.Time
	request := func() error {
		f := r.fixtures[cursor/2]
		frame := fmt.Sprintf("QLC+API|getWidgetStatus|%d", f.Slider)
		if cursor%2 == 1 {
			frame = fmt.Sprintf("QLC+API|getChannelsValues|%d|%d|1", f.Universe, f.Address)
		}
		requested = time.Now()
		pendingMethod = "getWidgetStatus"
		if cursor%2 == 1 {
			pendingMethod = "getChannelsValues"
		}
		return send(frame)
	}
	for {
		// Give shutdown priority over a ready output tick.
		if ctx.Err() != nil {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-readDone:
			return
		case now := <-poll.C:
			if cursor >= 0 {
				if now.Sub(requested) >= time.Second {
					return
				}
			} else {
				cursor = 0
				if err := request(); err != nil {
					return
				}
			}
		case reply := <-replies:
			if cursor < 0 {
				continue
			}
			f := r.fixtures[cursor/2]
			widget := cursor%2 == 0
			parts := strings.Split(reply, "|")
			method, id, fields := "getChannelsValues", f.Address, 6
			if widget {
				method, id, fields = "getWidgetStatus", f.Slider, 4
			}
			if len(parts) < 2 || parts[0] != "QLC+API" || parts[1] != method {
				continue
			}
			pendingMethod = ""
			// A reply for the outstanding method completes this sample even when
			// QLC+ cannot supply a usable value (e.g. a missing VC widget).
			valid := len(parts) == fields && parts[2] == strconv.Itoa(id)
			value := -1
			if valid {
				var err error
				value, err = strconv.Atoi(parts[3])
				valid = err == nil && value >= 0 && value <= 255
			}
			r.pollWarning(cursor/2, widget, valid)
			if valid {
				r.observe(cursor/2, widget, value, requested, time.Now())
			}
			cursor++
			if cursor == len(r.fixtures)*2 {
				cursor = -1
				for i, mf := range r.fixtures {
					if !mf.moving() {
						continue
					}
					r.mu.Lock()
					owned := mf.owned && !mf.locked
					r.mu.Unlock()
					if !owned {
						continue
					}
					at := time.Now()
					b, held, err := readAxes(context.WithoutCancel(ctx), conn, replies, mf.Fixture)
					if err != nil {
						readbackSafe = false
						r.event(mf.Name, "", "qlc_warning", 0, "system", err)
						return
					}
					r.observeAxes(i, b, held, at, time.Now())
				}
			} else if err := request(); err != nil {
				return
			}
		case <-indicator.C:
			if err := send(fmt.Sprintf("%d|NEXT_PG", r.config.IndicatorFrame)); err != nil {
				return
			}
		case <-outputC:
			values := r.levels()
			for i, f := range r.fixtures {
				if f.moving() {
					writeCtx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
					err := r.flushMoving(writeCtx, conn, i)
					cancel()
					if err != nil {
						return
					}
					continue
				}
				r.mu.Lock()
				locked := f.locked
				r.mu.Unlock()
				if locked || values[i] == last[i] {
					continue
				}
				if err := sendLevel(i, values[i]); err != nil {
					return
				}
				last[i] = values[i]
			}
		}
	}
}

func (r *Runtime) finishQLC(conn *websocket.Conn, replies <-chan string, readbackSafe bool) {
	r.mu.Lock()
	deadline := r.shutdownDeadline
	r.mu.Unlock()
	ctx, cancel := context.WithDeadline(context.Background(), deadline)
	defer cancel()
	verified := true
	for _, f := range r.fixtures {
		if err := writeQLC(ctx, conn, fmt.Sprintf("%d|0", f.Slider)); err != nil {
			r.event(f.Name, "", "shutdown", 0, "system", err)
			return
		}
		if f.moving() {
			if !readbackSafe {
				verified = false
				r.event(f.Name, "", "shutdown", 0, "system", fmt.Errorf("outstanding QLC+ reply was not drained; slider zero sent, axes retained without release"))
				continue
			}
			if err := readWidget(ctx, conn, replies, f.Slider); err != nil {
				r.event(f.Name, "", "shutdown", 0, "system", err)
				return
			}
			r.mu.Lock()
			locked := f.locked
			r.mu.Unlock()
			if locked {
				r.event(f.Name, "", "shutdown_axes_locked", 0, "system")
				continue
			}
			for _, ch := range f.axisChannels() {
				// Reset replies contain the current Simple Desk page, not the requested axes.
				// Consume each reply before asking for the exact final axis snapshot.
				if _, err := query(ctx, conn, replies, fmt.Sprintf("QLC+API|sdResetChannel|%d", absolute(ch)), "getChannelsValues"); err != nil {
					r.event(f.Name, "", "shutdown", 0, "system", err)
					return
				}
			}
			b, held, err := readAxes(ctx, conn, replies, f.Fixture)
			if err == nil {
				err = checkAxes(f.Fixture, b, [4]int{}, held, false)
			}
			if err != nil {
				r.event(f.Name, "", "shutdown", 0, "system", err)
				return
			}
			r.mu.Lock()
			f.owned = false
			r.mu.Unlock()
		}
	}
	if err := writeQLC(ctx, conn, fmt.Sprintf("%d|PREV_PG", r.config.IndicatorFrame)); err != nil {
		r.event("", "", "shutdown", 0, "system", err)
		return
	}
	r.mu.Lock()
	r.zeroed = verified
	r.mu.Unlock()
}

// Keep runtime poll warnings separate from saved-project validation warnings.
// A valid reply clears only its own method's warning, not the other sample's.
func (r *Runtime) pollWarning(index int, widget, valid bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	f := r.fixtures[index]
	slot := 1
	if widget {
		slot = 0
	}
	if valid {
		f.pollWarnings[slot] = ""
		return
	}
	alreadyWarned := f.pollWarnings[0] != "" || f.pollWarnings[1] != ""
	warning := fmt.Sprintf("%s: QLC+ returned an invalid output value for universe %d address %d", f.Name, f.Universe, f.Address)
	if widget {
		warning = fmt.Sprintf("%s: QLC+ returned no valid value for slider %d (widget missing?)", f.Name, f.Slider)
	}
	f.pollWarnings[slot] = warning
	if !alreadyWarned {
		r.event(f.Name, "", "qlc_warning", 0, "system", fmt.Errorf("%s", warning))
	}
}
