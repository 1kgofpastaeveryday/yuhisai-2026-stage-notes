#!/usr/bin/env python3
"""Check beat-driven visuals and fake transport; render actual Lua states."""
import hashlib
import json

from build_countdown_demo import CountdownBuilder, example
from countdown_test_runtime import DemoRuntime, FOLDER


def main():
    d = DemoRuntime()
    c = d.controls
    checks = []
    assert c.countdown_focus.visible and not c.overview.visible
    assert d.filled_ticks() == 16 and c.progress_fill.frame.w == 656
    assert 'countdown_time' not in d.nodes
    assert not any('秒' in n.findtext('./values/value[key="text"]/default', '')
                   for n in d.nodes.values())
    d.advance(5000)
    assert c.progress_fill.frame.w == 656
    d.press('resume'); d.advance(500)
    # 120 BPM: exactly one beat, not one second.
    assert c.progress_fill.frame.w == 656 * 63 / 64
    assert c.beat_pad_2.color.r > 0.5 and c.beat_pad_1.color.r < 0.5
    d.press('live_stop')
    frozen = d.snapshot()
    d.advance(10000)
    assert d.snapshot() == frozen
    checks.append('beat phase and segment progress follow transport; paused visuals stay frozen')

    d.press('to_overview')
    assert c.overview.visible and c.countdown_summary.visible and not c.countdown_focus.visible
    d.press('countdown_seek_16')
    assert d.filled_ticks() == 16
    d.press('resume')
    assert c.countdown_focus.visible and not c.overview.visible
    assert not c.to_overview.visible
    assert c.stop_edge_left.visible and c.stop_edge_left.color.g == 0.80
    d.advance(500)
    assert d.filled_ticks() == 15
    # Even an attempted navigation during the final window is overridden.
    d.press('to_overview')
    assert c.countdown_focus.visible and not c.overview.visible
    d.press('countdown_seek_4')
    assert d.filled_ticks() == 4 and c.stop_edge_left.color.g == 0.48
    for remaining in (4, 3, 2, 1):
        assert d.filled_ticks() == remaining
        assert sum(c[f'beat_pulse_{i}'].color.r > 0.5 for i in range(1, 5)) == remaining
        d.advance(500)
    assert d.filled_ticks() == 0 and d.read('stop_stamp') == 'SETSTOP'
    assert d.read('countdown_state') == '停止' and not c.progress_fill.visible
    frozen = d.snapshot(); d.advance(120000)
    assert d.snapshot() == frozen
    d.press('to_overview')
    assert c.overview.visible and not c.countdown_focus.visible
    assert d.read('stop_stamp') == 'SETSTOP'
    d.press('to_focus')
    assert c.countdown_focus.visible
    d.press('resume')
    assert d.read('countdown_target') == '[DEMO_02] SETSTOP'
    assert d.read('stop_stamp') == '' and d.filled_ticks() == 16
    checks.append('16-beat auto-focus and amber border; final 4 large pads drain beat by beat; stop holds; resume chooses next stop')

    d.press('live_stop'); d.press('act02_song01')
    # Tempo changes from 90 to 180 BPM at beat 100; visualization stays in beats.
    assert abs(c.progress_fill.frame.w - 656 * 64 / 68) < 1e-8
    d.press('act02_song03'); d.press('resume')
    before = c.progress_fill.frame.w
    d.advance(1000)
    assert abs(before - c.progress_fill.frame.w - 656 * 3 / 68) < 1e-8
    d.press('live_stop'); d.press('act02_song01'); d.press('resume')
    d.press('to_overview')
    assert c.overview.visible and not c.countdown_focus.visible
    d.advance(32000)
    assert d.read('stop_stamp') == 'SETSTOP' and c.countdown_focus.visible
    d.press('act01_song04')
    assert d.read('countdown_target') == '[DEMO_01] SETSTOP'
    assert d.filled_ticks() == 16
    d.press('resume'); d.advance(500)
    assert d.filled_ticks() == 15
    assert d.press('act01_song04') is True
    assert d.filled_ticks() == 15
    checks.append('tempo change affects pulse speed, not beat distances; backward/forward seeks recalculate; deselection does not seek')

    d.press('live_stop')
    for i in range(1, 13):
        act = f'act{i:02}'
        d.press('to_overview'); d.press('open_' + act)
        assert c[act].visible and c.countdown_summary.visible
        for j in range(1, 5):
            song = f'{act}_song{j:02}'
            if c[song + '_selected'].visible: d.press(song)
            d.press(song)
            assert d.read('countdown_target') == f'[DEMO_{i:02}] SETSTOP'
            assert sum(bool(c[f'act{a:02}_song{s:02}_selected'].visible)
                       for a in range(1, 13) for s in range(1, 5)) == 1
        before = c.progress_fill.frame.w
        d.press('back_' + act)
        assert c.overview.visible and c.progress_fill.frame.w == before
        d.press('to_focus')
        assert c.countdown_focus.visible and not c.overview.visible
    d.press('resume'); d.advance(100000)
    assert d.read('stop_stamp') == 'SETSTOP'
    d.press('resume'); d.advance(1000)
    assert d.read('stop_stamp') == '終了' and d.filled_ticks() == 0
    assert d.read('countdown_target') == '停止点なし'
    checks.append('all 48 song seeks and 14 pages, selection/navigation, final stop and no next target')

    # Non-aligned stop: drain after fractional beat distances, never a full beat early.
    d.env.DEMO_CUES = d.lua.table_from([
        d.lua.table(beat=1, name='NOTSETSTOP'), d.lua.table(beat=2, name='SETSTOPPED'),
        d.lua.table(beat=3.5, name='[FRACTIONAL] SETSTOP')])
    d.env.init(); assert d.filled_ticks() == 4
    d.press('resume'); d.advance(249); assert d.filled_ticks() == 4
    d.advance(1); assert d.filled_ticks() == 3
    d.advance(1500); assert d.read('stop_stamp') == 'SETSTOP'
    checks.append('fractional-beat stop and exact boundaries; lookalike locator names ignored')

    messages = d.xml.findall('.//messages/midi')
    assert len(messages) == 55 and all(m.findtext('enabled') == '0' for m in messages)
    assert not d.xml.findall('.//messages/osc')
    # Determine actual per-page visibility through the parent tree.
    parents = {child: parent for parent in d.xml.iter('node') for child in parent.findall('./children/node')}
    names = {v:k for k,v in d.nodes.items()}
    def is_visible(item):
        if not c[names[item]].visible: return False
        return is_visible(parents[item]) if item in parents else True
    d.env.init()
    for page in ['focus', 'overview'] + [f'act{i:02}' for i in range(1, 13)]:
        if page == 'focus': d.press('to_focus')
        else:
            d.press('to_overview')
            if page != 'overview': d.press('open_' + page)
        targets = []
        for name,item in d.nodes.items():
            if item.attrib['type'] != 'BUTTON' or not is_visible(item): continue
            f = c[name].frame; x,y,w,h = (f[k] for k in ('x','y','w','h'))
            assert w >= 44 and h >= 44 and x >= 0 and y >= 0 and x+w <= 744 and y+h <= 1133
            for other,(bx,by,bw,bh) in targets:
                assert not(x < bx+bw and bx < x+w and y < by+bh and by < y+h), (page,name,other)
            targets.append((name,(x,y,w,h)))
    checks.append('all 83 touch targets >=44pt and non-overlapping across 14 pages; 55 MIDI outputs disabled, no OSC output')

    builder = CountdownBuilder(example()).build()
    fresh = DemoRuntime()
    builder.render('focus', FOLDER / 'preview-focus.png', state=fresh.snapshot())
    frames = []
    fresh.press('countdown_seek_16'); fresh.press('resume')
    for index in range(65):
        state = fresh.snapshot()
        if index in (0, 32, 48, 56, 60, 64):
            builder.render('focus', FOLDER / f'preview-beat-{index:02}.png', state=state)
        temporary = FOLDER / 'animation-frame.png'
        im = builder.render('focus', temporary, state=state)
        frames.append(im.resize((558,850)))
        fresh.advance(125)
    temporary.unlink()
    frames[0].save(FOLDER / 'preview-beats.gif', save_all=True, append_images=frames[1:],
                   duration=[125]*64+[1200], loop=0)
    checks.append('static previews and animated GIF rendered from generated Lua control states')
    report = {'result':'PASS', 'runtime':str(d.lua.eval('_VERSION')),
              'file_sha256':hashlib.sha256((FOLDER/'setstop-countdown-demo.tosc').read_bytes()).hexdigest(),
              'compiled_scripts':len(list(d.envs)), 'checks':checks,
              'display_basis':'quarter-note beats; 4/4 demo',
              'auto_focus_threshold_beats':16, 'large_pad_countdown_threshold_beats':4,
              'midi_messages_disabled':len(messages), 'live_or_qlc_commands_sent':False,
              'real_live_transport_tested':False, 'ipad_tested':False}
    (FOLDER/'verification.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False))


if __name__ == '__main__': main()
