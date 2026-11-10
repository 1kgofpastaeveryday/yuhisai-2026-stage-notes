#!/usr/bin/env python3
"""Build a separate, self-contained TouchOSC countdown test document."""
import json
import copy
from pathlib import Path

from build_manipulation_prototype import Builder, COLORS, example, prop, on_press

HERE = Path(__file__).resolve().parent
OUT = HERE / 'countdown-demo'


def replace_property(item, key, value):
    old = item.find(f"./properties/property[key='{key}']")
    if old is not None:
        item.find('properties').remove(old)
    prop(item, key, value)


class CountdownBuilder(Builder):
    def build(self):
        super().build()
        self.nodes = {n.findtext("./properties/property[key='name']/value"): n
                      for n in self.root.iter('node')}
        self.move('overview_title', (24, 354, 510, 42))
        for i, act in enumerate(self.spec['performances']):
            key = act['id']
            x, y = 24 + i % 2 * 356, 406 + i // 2 * 62
            self.move(key + '_tile', (x, y, 340, 56))
            self.move(key + '_selected_outline', (x, y, 340, 56))
            self.move(key + '_selected_fill', (x + 3, y + 3, 334, 50))
            self.move(key + '_title', (x + 20, y + 6, 220, 44))
            self.move(key + '_song_count', (x + 250, y + 8, 70, 40))
            self.move('open_' + key, (x, y, 340, 56))
            self.move(key + '_back_base', (24, 354, 48, 48))
            self.move(key + '_back_icon', (24, 351, 48, 48))
            self.move('back_' + key, (24, 354, 48, 48))
            self.move(key + '_heading', (94, 354, 606, 48))
            self.move(key + '_song_heading', (24, 416, 696, 32))
            for j, song in enumerate(act['songs']):
                tag, y = key + '_' + song['id'], 458 + j * 82
                for suffix in ('_base', '_selected_outline', ''):
                    self.move(tag + suffix, (24, y, 696, 72))
                self.move(tag + '_selected_fill', (27, y + 3, 690, 66))
                self.move(tag + '_index', (43, y + 12, 52, 48))
                self.move(tag + '_title', (116, y + 14, 400, 44))
                self.move(tag + '_cue', (550, y + 11, 147, 50))
                script = self.nodes[tag].findtext("./properties/property[key='script']/value")
                body, ending = script.rsplit('\nend\n', 1)
                replace_property(self.nodes[tag], 'script', body + '\n  root:notify("countdown_demo", ' + json.dumps(song['locator']) + ')\nend\n' + ending)
        self.text('preview_badge_text', '単体テスト')
        self.text('resume_title', 'テスト 続きから再開')
        self.text('live_stop_title', 'テスト 再生停止')
        for key, action in [('resume', 'resume'), ('live_stop', 'stop')]:
            replace_property(self.nodes[key], 'script', on_press('  root:notify("countdown_demo", "' + action + '")'))
        summary = self.group('countdown_summary', False)
        self.box(summary, 'countdown_panel', (24, 194, 696, 146), COLORS['surface'])
        self.label(summary, 'countdown_caption', (44, 206, 350, 32), '次のSETSTOP', 22, COLORS['muted'])
        self.label(summary, 'summary_target', (44, 242, 350, 32), '[DEMO_01] SETSTOP', 22)
        self.label(summary, 'summary_state', (44, 290, 350, 32), 'テスト停止中', 22, COLORS['muted'])
        for i in range(1, 5):
            self.box(summary, f'summary_beat_{i}', (418 + (i-1)*74, 210, 62, 52), COLORS['surface2'])
        self.box(summary, 'to_focus_base', (418, 282, 286, 48), COLORS['surface2'], radius=6)
        self.label(summary, 'to_focus_label', (418, 282, 286, 48), 'カウント', 22, align=2)
        self.button(summary, 'to_focus', (418, 282, 286, 48), '  root:notify("countdown_demo", "focus")')

        focus = self.group('countdown_focus', True)
        replace_property(self.nodes['overview'], 'visible', False)
        self.box(focus, 'focus_surface', (24, 194, 696, 584), COLORS['surface'])
        self.label(focus, 'focus_heading', (44, 206, 490, 50), 'SETSTOP', 40, bold=True)
        self.label(focus, 'countdown_target', (44, 260, 656, 38), '[DEMO_01] SETSTOP', 26)
        self.box(focus, 'to_overview_base', (580, 206, 120, 48), COLORS['surface2'], radius=6)
        self.label(focus, 'to_overview_label', (580, 206, 120, 48), '演目', 24, align=2)
        self.button(focus, 'to_overview', (580, 206, 120, 48), '  root:notify("countdown_demo", "overview")')
        self.box(focus, 'progress_track', (44, 316, 656, 12), COLORS['surface2'], radius=0)
        self.box(focus, 'progress_fill', (44, 316, 656, 12), COLORS['blue'], radius=0)
        for i in range(1, 5):
            x = 44 + (i - 1) * 168
            self.box(focus, f'beat_pad_{i}', (x, 354, 152, 256), COLORS['surface2'])
            self.box(focus, f'beat_pulse_{i}', (x + 12, 366, 128, 232), COLORS['surface2'], radius=6)
        for i in range(1, 17):
            x = 44 + (i-1)*41 + (i-1)//4*3
            self.box(focus, f'remaining_beat_{i}', (x, 638, 30, 44), COLORS['blue'], radius=3)
        self.label(focus, 'countdown_state', (44, 704, 342, 48), 'テスト停止中', 24, COLORS['muted'])
        for beats, x in [(16, 418), (4, 568)]:
            name = 'countdown_seek_' + str(beats)
            self.box(focus, name + '_base', (x, 704, 132, 48), COLORS['surface2'], radius=6)
            self.label(focus, name + '_label', (x, 704, 132, 48), str(beats) + '拍前', 22, align=2)
            self.button(focus, name, (x, 704, 132, 48), '  root:notify("countdown_demo", "' + str(beats) + '")')
        self.label(focus, 'stop_stamp', (44, 382, 656, 170), '', 88, COLORS['red'], align=2, bold=True)
        for name, rect in [('top', (0, 0, 744, 8)), ('bottom', (0, 1125, 744, 8)),
                           ('left', (0, 8, 8, 1117)), ('right', (736, 8, 8, 1117))]:
            border = self.box(self.root, 'stop_edge_' + name, rect, COLORS['red'], radius=0)
            replace_property(border, 'visible', False)

        # Page navigation also updates the shared summary visibility.
        for name, item in self.nodes.items():
            if name.startswith(('open_', 'back_')):
                source = item.findtext("./properties/property[key='script']/value")
                replace_property(item, 'script', source.replace('\nend\n', '\n  root:findByName("countdown_focus", true).visible = false\n  root:findByName("countdown_summary", true).visible = true\nend\n'))
        cues, tempos = [], []
        for i, act in enumerate(self.spec['performances']):
            start = i * 68
            tempos.append({'beat': start, 'bpm': [120, 90, 150][i % 3]})
            for j, song in enumerate(act['songs']):
                cues.append({'beat': start + j * 16, 'name': song['locator']})
            cues.append({'beat': start + 64, 'name': f'[DEMO_{i + 1:02}] SETSTOP'})
        # Tempo only drives the fake transport; the visualization uses beats.
        tempos.append({'beat': 100, 'bpm': 180})
        tempos.sort(key=lambda e: e['beat'])
        self.timeline = {'cues': cues, 'tempos': tempos, 'beats_per_bar': 4, 'source': 'synthetic; no Live project read or modified'}
        def lua_rows(rows, fields):
            return '{' + ',\n'.join('{' + ','.join(key + '=' + json.dumps(row[key], ensure_ascii=False) for key in fields) + '}' for row in rows) + '}'
        script = 'DEMO_CUES = ' + lua_rows(cues, ('beat', 'name')) + '\nDEMO_TEMPOS = ' + lua_rows(tempos, ('beat', 'bpm')) + '\n'
        script += (HERE / 'countdown_demo.lua').read_text(encoding='utf-8')
        prop(self.root, 'script', script)
        return self

    def render(self, page, out, selected=None, state=None):
        """Render the same control tree, optionally with values captured from Lua."""
        items = {n.findtext("./properties/property[key='name']/value"): n for n in self.root.iter('node')}
        parents = {c: p for p in self.root.iter('node') for c in p.findall('./children/node')}
        names = {v: k for k, v in items.items()}
        state = copy.deepcopy(state) if state else {}
        for name, item in items.items():
            s = state.setdefault(name, {})
            s.setdefault('visible', item.findtext("./properties/property[key='visible']/value") == '1')
            if name == 'overview' or name in {a['id'] for a in self.spec['performances']} or name == 'countdown_focus':
                s['visible'] = name == ('countdown_focus' if page == 'focus' else page)
            if name == 'countdown_summary': s['visible'] = page != 'focus'
            if name.endswith('_selected') and selected:
                s['visible'] = name in (selected + '_selected', self.song_act.get(selected, '') + '_selected')
        def visible(item):
            if not state[names[item]]['visible']: return False
            return visible(parents[item]) if item in parents else True
        def hex_color(v):
            return '#' + ''.join(f'{max(0,min(255,round(v[k]*255))):02x}' for k in ('r', 'g', 'b'))
        saved = self.primitives
        self.primitives = []
        for primitive in saved:
            name = primitive['name']
            if not visible(items[name]): continue
            p, s = dict(primitive), state[name]
            p['page'] = 'all'
            p.pop('selected_for', None)
            if 'frame' in s: p['rect'] = tuple(s['frame'][k] for k in ('x','y','w','h'))
            if p['kind'] == 'text':
                if 'text' in s: p['text'] = s['text']
                if 'textColor' in s: p['fill'] = hex_color(s['textColor'])
            elif 'color' in s: p['fill'] = hex_color(s['color'])
            self.primitives.append(p)
        try: return super().render(page, out, selected)
        finally: self.primitives = saved

    def move(self, name, rect):
        replace_property(self.nodes[name], 'frame', dict(zip(('x', 'y', 'w', 'h'), rect)))
        for p in self.primitives + self.buttons:
            if p['name'] == name:
                p['rect'] = rect

    def text(self, name, text):
        self.nodes[name].find("./values/value[key='text']/default").text = text
        for p in self.primitives:
            if p['name'] == name:
                p['text'] = text


def main():
    builder = CountdownBuilder(example()).build()
    report = builder.write(OUT)
    (OUT / 'show-control-prototype.tosc').replace(OUT / 'setstop-countdown-demo.tosc')
    (OUT / 'show-control-prototype.xml').replace(OUT / 'setstop-countdown-demo.xml')
    (OUT / 'demo-timeline.json').write_text(json.dumps(builder.timeline, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    builder.render('focus', OUT / 'preview-focus.png')
    builder.render('overview', OUT / 'preview-overview.png')
    builder.render('act01', OUT / 'preview-songs.png', selected='act01_song01')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
