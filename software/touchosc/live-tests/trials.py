#!/usr/bin/env python3
"""Repeat a 'go to locator and play' note sequence and check where Live really started.

trials.py SEQ GAPS_MS N   SEQ: slp (stop, locator, play) | lp (locator, play) | l (locator only)
GAPS_MS: one gap for every step ("40"), or one per step ("40,0" = 40 ms after stop, none before play)
Each trial alternates between starting from 'playing' and 'stopped', and between targets.
Reads probe.log (written by probe_midi.py; run it first) to find the beat the transport actually ran from.
"""
import os
import random
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
FIFO, LOG = os.path.join(HERE, "cmd.fifo"), os.path.join(HERE, "probe.log")
STOP, PLAY = 104, 105
LOCATORS = {100: 0, 101: 32, 102: 64, 103: 96}  # note -> beat in locator-test.als


def send(*cmds):
    with open(FIFO, "w", encoding="utf-8") as f:
        f.write("".join(c + "\n" for c in cmds))


def log_lines_after(marker):
    lines = open(LOG, encoding="utf-8").read().splitlines()
    idx = max(i for i, l in enumerate(lines) if marker in l)
    return lines[idx + 1:]


def position_now(after):
    """Beat of the last clock/songpos line after the marker, and whether running."""
    beat, running = None, False
    for l in log_lines_after(after):
        m = re.search(r"(clock|songpos|continue|stop|start)\S* .*?beat=([\d.]+)", l) or re.search(r" (start)$", l)
        if " start" in l and "beat" not in l:
            beat, running = 0.0, True
        elif m:
            kind, beat = m.group(1), float(m.group(2))
            running = kind != "stop"
    return beat, running


def main():
    seq, n = sys.argv[1], int(sys.argv[3])
    gaps = [int(g) / 1000 for g in sys.argv[2].split(",")]
    random.seed(1)
    results = []
    for t in range(n):
        from_playing = t % 2 == 0
        # Put the transport into the wanted state at a random position
        prep = f"prep-{seq}-{sys.argv[2]}-{t}"
        send(f"mark {prep}", f"on {STOP}")
        time.sleep(0.3)
        if from_playing:
            send(f"on {random.choice(list(LOCATORS))}")
            time.sleep(0.1)
            send(f"on {PLAY}")
            time.sleep(1.1 + random.random() * 1.5)  # mid-bar at a random point
        target = random.choice([k for k in LOCATORS])
        notes = {"slp": [STOP, target, PLAY], "lp": [target, PLAY], "l": [target]}[seq]
        mark = f"trial-{seq}-{sys.argv[2]}-{t}"
        send(f"mark {mark}")
        for i, note in enumerate(notes):
            send(f"on {note}")
            if i < len(notes) - 1:
                g = gaps[i] if len(gaps) > 1 else gaps[0]
                if g:
                    time.sleep(g)
        time.sleep(0.9)
        # Where is the transport now? Expected: running, about 0.9 s (1.8 beats) after the target
        beat, running = position_now(mark)
        expect = LOCATORS[target]
        ok = running and beat is not None and expect <= beat <= expect + 2.5
        results.append(ok)
        print(f"{mark} from={'playing' if from_playing else 'stopped'} target={expect} now={beat} running={running} {'OK' if ok else 'NG'}")
    send(f"on {STOP}")
    print(f"{seq} gaps={sys.argv[2]}ms: {sum(results)}/{len(results)} OK")


if __name__ == "__main__":
    main()
