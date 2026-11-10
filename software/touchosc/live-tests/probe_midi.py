#!/usr/bin/env python3
"""MIDI probe for testing Live locator recall.

Creates a virtual MIDI port pair named "ClaudeProbe":
- source (Live input): notes written to cmd.fifo are sent here ("on 100" = note on only,
  like the TouchOSC trigger buttons; "note 100" = note on then off).
- destination (Live output): with Sync enabled in Live, clock/start/stop/SPP arrive here
  and are logged with timestamps, plus the transport position in beats.
"""
import os
import sys
import threading
import time

import mido

HERE = os.path.dirname(os.path.abspath(__file__))
FIFO = os.path.join(HERE, "cmd.fifo")
LOG = os.path.join(HERE, "probe.log")
T0 = time.monotonic()

lock = threading.Lock()
state = {"clocks": 0, "base_beats": 0.0, "running": False}


def log(msg):
    with lock, open(LOG, "a", encoding="utf-8") as f:
        f.write(f"{time.monotonic() - T0:9.3f} {msg}\n")


def beats():
    return state["base_beats"] + state["clocks"] / 24


def on_midi(msg):
    t = msg.type
    if t == "clock":
        state["clocks"] += 1
        if state["clocks"] % 24 == 0:
            log(f"clock beat={beats():.2f}")
    elif t == "songpos":
        state["base_beats"], state["clocks"] = msg.pos / 4, 0
        log(f"songpos pos16={msg.pos} beat={beats():.2f}")
    elif t == "start":
        state["base_beats"], state["clocks"], state["running"] = 0.0, 0, True
        log("start")
    elif t == "continue":
        state["running"] = True
        log(f"continue beat={beats():.2f}")
    elif t == "stop":
        state["running"] = False
        log(f"stop beat={beats():.2f}")
    else:
        log(f"in {msg}")


def main():
    if not os.path.exists(FIFO):
        os.mkfifo(FIFO)
    out = mido.open_output("ClaudeProbe", virtual=True)
    mido.open_input("ClaudeProbe", virtual=True, callback=on_midi)
    log("ready")
    while True:
        with open(FIFO, encoding="utf-8") as f:  # blocks until a writer opens it
            for line in f:
                parts = line.split()
                if not parts:
                    continue
                if parts[0] in ("on", "note") and len(parts) == 2:
                    n = int(parts[1])
                    out.send(mido.Message("note_on", channel=0, note=n, velocity=127))
                    log(f"sent note_on {n}")
                    if parts[0] == "note":
                        time.sleep(0.05)
                        out.send(mido.Message("note_off", channel=0, note=n, velocity=0))
                elif parts[0] == "mark":
                    log("mark " + " ".join(parts[1:]))
                elif parts[0] == "quit":
                    log("quit")
                    sys.exit(0)


if __name__ == "__main__":
    main()
