#!/usr/bin/env python3
"""Build a performer playback layout in the open TouchOSC document from a JSON spec.

Usage: python3 build_layout.py layouts/sample.json

The design rules (sizes, colors, icons, note numbers) are explained in DESIGN.md.
This script replaces everything in the active TouchOSC document.
"""
import json
import sys
from pathlib import Path

from tosc_mcp import call

# --- Design tokens (DESIGN.md "トークン") -----------------------------------
CANVAS_W, CANVAS_H = 744, 1133  # iPad mini (6th gen and later), portrait, in points
MARGIN, GAP, PAD = 24, 16, 16
HEADER_H, STOP_H = 48, 112


def rgb(hex_color, a=1.0):
    h = hex_color.lstrip("#")
    return {"r": int(h[0:2], 16) / 255, "g": int(h[2:4], 16) / 255, "b": int(h[4:6], 16) / 255, "a": a}


BG = rgb("#0D0E11")
SURFACE = rgb("#1A1D23")
SURFACE_2 = rgb("#272B34")
TEXT_1 = rgb("#F5F5F5")
TEXT_2 = rgb("#A0A6B0")
PLAY = rgb("#1FA463")
JUMP = rgb("#3D8BFF")
STOP = rgb("#E5484D")
FLASH = rgb("#FFFFFF", 0.35)
TRACK = rgb("#A0A6B0", 0.25)

SHAPE_RECT, SHAPE_CIRCLE, SHAPE_TRIANGLE = 1, 2, 3
POINT_RIGHT = 1
ALIGN_LEFT, ALIGN_CENTER = 1, 2

# --- Note numbers (DESIGN.md "MIDI の割り当て") -------------------------------
STOP_NOTE = 36
SONG_BASE_NOTE, SONG_STRIDE, MAX_JUMPS = 60, 8, 7


def song_note(song_index, jump_index=0):
    """song_index and jump_index are 0-based; jump_index 0 means from the top."""
    return SONG_BASE_NOTE + SONG_STRIDE * song_index + jump_index


# --- Primitives ---------------------------------------------------------------
def frame(x, y, w, h):
    return {"x": x, "y": y, "w": w, "h": h}


def box(name, f, color, shape=SHAPE_RECT, radius=0, orientation=0):
    return call("create_control", type="BOX", name=name, frame=f,
                properties={"color": color, "shape": shape, "cornerRadius": radius, "orientation": orientation})


def label(name, f, text, size, color=TEXT_1, align=ALIGN_LEFT):
    ctl = call("create_control", type="LABEL", name=name, frame=f,
               properties={"textSize": size, "textColor": color, "textAlignH": align,
                           "background": False, "outline": False, "interactive": False})
    call("set_control_value", id=ctl["id"], key="text", current=text, default=text)
    return ctl


def trigger(name, f, note):
    """Invisible momentary button on top of a component: flashes white and sends one note on press."""
    ctl = call("create_control", type="BUTTON", name=name, frame=f,
               properties={"color": FLASH, "background": False, "outline": False, "cornerRadius": 3})
    call("update_message", id=ctl["id"], kind="midi", index=0, message={
        "receive": False,
        "connections": [1],
        "triggers": {"x": "RISE"},
        "message": {"type": "NOTE_ON", "channel": 0, "data1": note, "data2": 127},
        "values": {
            "channel": {"type": "CONSTANT", "key": "", "scaleMin": 0, "scaleMax": 15},
            "data1": {"type": "CONSTANT", "key": "", "scaleMin": 0, "scaleMax": 127},
            "data2": {"type": "VALUE", "key": "x", "scaleMin": 0, "scaleMax": 127},
        },
    })
    call("remove_message", id=ctl["id"], kind="osc", index=0)
    return ctl


# --- Icons (Material Symbols geometry rebuilt from TouchOSC shapes) -----------
def icon_play(name, x, y, size, color):  # play_arrow
    box(name, frame(x + size * 0.15, y, size * 0.8, size), color, SHAPE_TRIANGLE, orientation=POINT_RIGHT)


def icon_resume(name, x, y, size, color):  # resume: a cue bar, then play
    box(name + "_bar", frame(x, y + size * 0.1, size * 0.2, size * 0.8), color)
    box(name + "_tri", frame(x + size * 0.32, y, size * 0.68, size), color, SHAPE_TRIANGLE, orientation=POINT_RIGHT)


def icon_stop(name, x, y, size, color):  # stop
    box(name, frame(x + size * 0.1, y + size * 0.1, size * 0.8, size * 0.8), color, radius=1)


# --- Components ---------------------------------------------------------------
PRIMARY_W, PRIMARY_H = 280, 104
CHIP_W, CHIP_H = 210, 80
CARD_W = CANVAS_W - 2 * MARGIN


def card_height(song):
    return PAD + PRIMARY_H + (GAP + CHIP_H if song.get("jumps") else 0) + PAD


def song_card(i, song, y):
    n = i + 1
    x = MARGIN
    box(f"song{n}_card", frame(x, y, CARD_W, card_height(song)), SURFACE, radius=4)
    label(f"song{n}_number", frame(x + PAD, y + PAD, 44, PRIMARY_H), str(n), 32, TEXT_2, ALIGN_CENTER)
    title_w = CARD_W - PAD * 3 - 44 - PRIMARY_W
    label(f"song{n}_title", frame(x + PAD + 52, y + PAD, title_w, PRIMARY_H), song["title"], 36)

    # Primary: play from the top
    px, py = x + CARD_W - PAD - PRIMARY_W, y + PAD
    box(f"song{n}_top_base", frame(px, py, PRIMARY_W, PRIMARY_H), PLAY, radius=3)
    icon_play(f"song{n}_top_icon", px + 36, py + (PRIMARY_H - 44) / 2, 44, TEXT_1)
    label(f"song{n}_top_label", frame(px + 96, py, PRIMARY_W - 112, PRIMARY_H), "最初から", 32)
    trigger(f"song{n}_top", frame(px, py, PRIMARY_W, PRIMARY_H), song_note(i))

    # Secondary: play from a cue point, labelled with the section name the performers use
    jumps = song.get("jumps", [])[:MAX_JUMPS]
    cy = py + PRIMARY_H + GAP
    for j, jump in enumerate(jumps):
        cx = x + PAD + j * (CHIP_W + GAP)
        tag = f"song{n}_jump{j + 1}"
        box(tag + "_base", frame(cx, cy, CHIP_W, CHIP_H), SURFACE_2, radius=3)
        icon_resume(tag + "_icon", cx + 16, cy + 16, 30, JUMP)
        label(tag + "_label", frame(cx + 56, cy + 6, CHIP_W - 64, 48), jump["label"], 26)
        # Seek-bar metaphor: the filled part and the thumb show where in the song this cue starts
        track_w, track_y = CHIP_W - 32, cy + CHIP_H - 16
        fill_w = max(6, track_w * jump["position"])
        box(tag + "_track", frame(cx + 16, track_y, track_w, 6), TRACK, radius=10)
        box(tag + "_pos", frame(cx + 16, track_y, fill_w, 6), JUMP, radius=10)
        box(tag + "_thumb", frame(cx + 16 + fill_w - 8, track_y - 5, 16, 16), TEXT_1, SHAPE_CIRCLE)
        trigger(tag, frame(cx, cy, CHIP_W, CHIP_H), song_note(i, j + 1))
    return y + card_height(song)


def header(spec):
    y = MARGIN
    label("header_title", frame(MARGIN, y, 240, HEADER_H), spec["title"], 30, TEXT_2)
    # Legend: the three actions, so the meaning of each icon is on screen
    lx = MARGIN + 250
    for key, draw, color, text in (("top", icon_play, PLAY, "最初から"),
                                   ("jump", icon_resume, JUMP, "途中から"),
                                   ("stop", icon_stop, STOP, "停止")):
        draw(f"legend_{key}_icon", lx, y + (HEADER_H - 24) / 2, 24, color)
        label(f"legend_{key}_label", frame(lx + 32, y, 110, HEADER_H), text, 22, TEXT_2)
        lx += 150
    return y + HEADER_H


def stop_bar():
    h = STOP_H
    y = CANVAS_H - MARGIN - h
    box("stop_base", frame(MARGIN, y, CARD_W, h), STOP, radius=3)
    icon_stop("stop_icon", MARGIN + CARD_W / 2 - 110, y + (h - 48) / 2, 48, TEXT_1)
    label("stop_label", frame(MARGIN + CARD_W / 2 - 40, y, 200, h), "停止", 44)
    trigger("stop", frame(MARGIN, y, CARD_W, h), STOP_NOTE)
    return y


def build(spec):
    doc = call("get_document")
    if doc["mode"] != "EDITOR":
        raise SystemExit("TouchOSC must be in EDITOR mode")
    ids = [c["id"] for c in doc["root"]["children"]]
    if ids:
        call("delete_controls", ids=ids)
    call("set_document_size", width=CANVAS_W, height=CANVAS_H)
    call("set_document_color", color=BG)

    y = header(spec) + GAP
    stop_top = None
    rows = []
    for i, song in enumerate(spec["songs"]):
        if y + card_height(song) > CANVAS_H - MARGIN - STOP_H - GAP:
            raise SystemExit(f"Song {i + 1} does not fit; split the songs over pages (DESIGN.md)")
        y = song_card(i, song, y) + GAP
        rows.append((i + 1, song["title"], "最初から", song_note(i)))
        for j, jump in enumerate(song.get("jumps", [])[:MAX_JUMPS]):
            rows.append((i + 1, song["title"], jump["label"], song_note(i, j + 1)))
    stop_top = stop_bar()
    rows.append(("-", "", "停止", STOP_NOTE))
    print("song | title | action | note (channel 1)")
    for r in rows:
        print(" | ".join(str(c) for c in r))
    return stop_top


if __name__ == "__main__":
    build(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")))
