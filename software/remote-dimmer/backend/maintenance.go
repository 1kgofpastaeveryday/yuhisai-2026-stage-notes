package main

import (
	"context"
	"time"
)

type setLogState struct {
	lastLog, lastSet time.Time
	pending          bool
	device           string
	value            int
}

// logSet and flushSetLogs run with the runtime mutex held.
func (r *Runtime) logSet(f *fixtureState, device string, value int, now time.Time) {
	r.flushSetLogs(now)
	s := &f.setLog
	s.device, s.value, s.lastSet, s.pending = device, value, now, true
	if s.lastLog.IsZero() || now.Sub(s.lastLog) >= settleInterval {
		r.event(f.Name, device, "set", value, "phone")
		s.lastLog = now
	}
}

func (r *Runtime) flushSetLogs(now time.Time) {
	for _, f := range r.fixtures {
		s := &f.setLog
		if s.pending && now.Sub(s.lastSet) >= settleInterval && now.Sub(s.lastLog) >= settleInterval {
			r.event(f.Name, s.device, "set", s.value, "phone")
			s.lastLog, s.pending = now, false
		}
	}
}

func (r *Runtime) maintain(ctx context.Context) {
	defer close(r.maintenanceDone)
	logs := time.NewTicker(50 * time.Millisecond)
	project := time.NewTicker(2 * time.Second)
	defer logs.Stop()
	defer project.Stop()
	for {
		select {
		case now := <-logs.C:
			r.mu.Lock()
			r.flushSetLogs(now)
			r.mu.Unlock()
		case <-project.C:
			r.checkProject()
		case <-ctx.Done():
			// Finish pending trailing logs without delaying lighting shutdown.
			r.mu.Lock()
			var due time.Time
			for _, f := range r.fixtures {
				if f.setLog.pending {
					d := f.setLog.lastSet.Add(settleInterval)
					if d.After(due) {
						due = d
					}
				}
			}
			r.mu.Unlock()
			if delay := time.Until(due); delay > 0 {
				timer := time.NewTimer(delay)
				<-timer.C
			}
			r.mu.Lock()
			r.flushSetLogs(time.Now())
			r.mu.Unlock()
			return
		}
	}
}
