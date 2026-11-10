package main

import "time"

const pollInterval = 200 * time.Millisecond
const settleInterval = 500 * time.Millisecond

// observe is called only for the outstanding request on the current connection.
// A write after the request invalidates that sample, even if its reply is delayed.
func (r *Runtime) observe(index int, widget bool, value int, requested, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closing || !r.connected || value < 0 || value > 255 {
		return
	}
	f := r.fixtures[index]
	oldLevel, oldOverride, oldLock := f.level, f.overridden, f.locked
	if widget && f.locked {
		f.level = value
	} else {
		misses := &f.outputMisses
		expected := f.level
		if widget {
			misses, expected = &f.widgetMisses, f.lastSent
		}
		if requested.Before(f.sentAt) {
			*misses = 0
			return
		}
		if value == expected {
			*misses = 0
			if !widget {
				f.overridden = false
			}
		} else {
			*misses++
			if *misses >= 2 && now.Sub(f.sentAt) >= settleInterval {
				if widget {
					f.locked, f.level = true, value
					if f.moving() {
						f.owned = false
						r.renewEpoch(f)
					}
					r.event(f.Name, r.assignments[f.Name], "qlc_direct", value, "system")
				} else {
					f.overridden = true
				}
			}
		}
	}
	if f.level != oldLevel || f.overridden != oldOverride || f.locked != oldLock {
		f.changedAt, f.source = now, "system"
		r.broadcast()
	}
}
