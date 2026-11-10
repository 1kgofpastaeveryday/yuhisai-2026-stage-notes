#!/usr/bin/env python3
"""Build an offline TouchOSC show-control prototype and matching PNG previews.

The .tosc serializer follows the v6 lexml format in the existing TouchOSC export.
All MIDI messages are intentionally disabled in this reviewable UI prototype.
"""
import argparse
import csv
import json
import uuid
import xml.etree.ElementTree as ET
import zlib
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 744, 1133
COLORS = {
    'bg': '#10141C', 'surface': '#1B2330', 'surface2': '#242F40',
    'line': '#354255', 'text': '#F2F5FA', 'muted': '#A9B4C5',
    'blue': '#A8C8FF', 'green': '#CAE9A8', 'green_text': '#14230C',
    'selected': '#2A405C',
    'red': '#FF9C91', 'red_bg': '#302329',
}
NAMESPACE = uuid.UUID('25d23160-4ec8-4c99-a38f-9093d6306087')


def example():
    return {
        'title': '雄飛祭2026', 'size': [W, H], 'midi_enabled': False,
        'performances': [
            {'id': f'act{i:02}', 'title': f'演目{i:02}', 'songs': [
                {'id': f'song{j:02}', 'title': f'曲{j:02}',
                 'locator': f'ACT{i:02}_SONG{j:02}', 'channel': 16,
                 'note': (i - 1) * 4 + j - 1}
                for j in range(1, 5)]}
            for i in range(1, 13)],
        'resume': {'channel': 16, 'cc': 119, 'connection': 1, 'action': 'SETCONT'},
        'live_stop': {'channel': 16, 'cc': 118, 'connection': 1, 'action': 'Live Stop'},
        'metronome': {'channel': 16, 'on_cc': 117, 'off_cc': 116, 'connection': 1},
        'qlc_stop': {'channel': 1, 'note': 111, 'connection': 2,
                     'vc_button_id': 3, 'action': 'StopAll'},
        'qlc_border': {'channel': 1, 'cc': 117, 'connection': 2,
                       'function_id': 10, 'fixture_id': 0, 'dmx_channel': 1,
                       'action': 'Flash', 'receiver_configured': False},
    }


def color(hex_value, alpha=1):
    return dict(zip(('r', 'g', 'b'), (int(hex_value[i:i + 2], 16) / 255 for i in (1, 3, 5))), a=alpha)


def prop(node, name, value):
    if isinstance(value, bool):
        kind, fields = 'b', None
    elif isinstance(value, int):
        kind, fields = 'i', None
    elif isinstance(value, float):
        kind, fields = 'f', None
    elif isinstance(value, dict):
        kind, fields = ('r', ('x', 'y', 'w', 'h')) if 'w' in value else ('c', ('r', 'g', 'b', 'a'))
    else:
        kind, fields = 's', None
    item = ET.SubElement(node.find('properties'), 'property', type=kind)
    ET.SubElement(item, 'key').text = name
    val = ET.SubElement(item, 'value')
    if fields:
        for key in fields:
            ET.SubElement(val, key).text = str(value[key])
    else:
        val.text = str(int(value)) if isinstance(value, bool) else str(value)


def node(kind, name, rect, **overrides):
    item = ET.Element('node', ID=str(uuid.uuid5(NAMESPACE, name)), type=kind)
    ET.SubElement(item, 'properties')
    values = ET.SubElement(item, 'values')
    defaults = {'background': kind == 'BOX', 'color': color(COLORS['text']),
                'cornerRadius': 0.0, 'frame': dict(zip(('x', 'y', 'w', 'h'), rect)),
                'grabFocus': True, 'interactive': kind == 'BUTTON', 'locked': False,
                'name': name, 'orientation': 0, 'outline': False, 'outlineStyle': 1,
                'pointerPriority': 0, 'shape': 1, 'visible': True}
    if kind == 'BUTTON':
        defaults.update(buttonType=0, press=True, release=True, valuePosition=False)
    if kind == 'LABEL':
        defaults.update(font=0, textAlignH=1, textAlignV=2, textClip=True,
                        textColor=color(COLORS['text']), textLength=0, textSize=24)
    defaults.update(overrides)
    for key, value in sorted(defaults.items()):
        prop(item, key, value)
    value_defaults = {'touch': False}
    if kind == 'BUTTON':
        value_defaults['x'] = 0
    if kind == 'LABEL':
        value_defaults['text'] = ''
    for key, value in value_defaults.items():
        part = ET.SubElement(values, 'value')
        ET.SubElement(part, 'key').text = key
        ET.SubElement(part, 'locked').text = '0'
        ET.SubElement(part, 'lockedDefaultCurrent').text = '1' if key == 'text' else '0'
        ET.SubElement(part, 'default').text = str(value).lower() if isinstance(value, bool) else str(value)
        ET.SubElement(part, 'defaultPull').text = '0'
    if kind == 'GROUP':
        ET.SubElement(item, 'children')
    return item


def lua_quote(value):
    return json.dumps(value, ensure_ascii=False)


def on_press(body):
    return 'function onValueChanged(key)\n  if key ~= "x" or self.values.x == 0 then return end\n' + body + '\nend\n'


class Builder:
    def __init__(self, spec):
        self.spec = spec
        self.root = node('GROUP', 'show_control', (0, 0, W, H), background=True,
                         color=color(COLORS['bg']), grabFocus=False)
        self.primitives = []
        self.buttons = []
        self.mapping = []
        self.song_act = {}

    def append(self, parent, item):
        parent.find('children').append(item)
        return item

    def group(self, name, visible):
        return self.append(self.root, node('GROUP', name, (0, 0, W, H), visible=visible))

    def box(self, parent, name, rect, fill, page='all', radius=8, shape=1):
        self.primitives.append(dict(kind='box', name=name, rect=rect, fill=fill,
                                    page=page, radius=radius, shape=shape))
        return self.append(parent, node('BOX', name, rect, color=color(fill),
                                       cornerRadius=float(radius), shape=shape,
                                       orientation=1 if shape == 3 else 0))

    def label(self, parent, name, rect, text, size=24, fill=None, page='all', align=1, bold=False):
        fill = fill or COLORS['text']
        self.primitives.append(dict(kind='text', name=name, rect=rect, text=text,
                                    size=size, fill=fill, page=page, align=align, bold=bold))
        item = node('LABEL', name, rect, textSize=size, textColor=color(fill), textAlignH=align)
        item.find("./values/value[key='text']/default").text = text
        return self.append(parent, item)

    def selection_highlight(self, parent, key, rect, page):
        group = self.append(parent, node('GROUP', key + '_selected', (0, 0, W, H),
                                         visible=False, grabFocus=False))
        x, y, w, h = rect
        self.box(group, key + '_selected_outline', rect, COLORS['blue'], page)
        self.primitives[-1]['selected_for'] = key
        self.box(group, key + '_selected_fill', (x + 3, y + 3, w - 6, h - 6),
                 COLORS['selected'], page, radius=5)
        self.primitives[-1]['selected_for'] = key

    def button(self, parent, name, rect, body='', midi=None):
        item = node('BUTTON', name, rect, color=color('#FFFFFF', .16), cornerRadius=8.0)
        prop(item, 'script', on_press(body))
        if midi:
            message = ET.SubElement(ET.SubElement(item, 'messages'), 'midi')
            for key, value in (('enabled', '0'), ('send', '1'), ('receive', '0'),
                               ('feedback', '0'), ('noDuplicates', '0')):
                ET.SubElement(message, key).text = value
            ET.SubElement(message, 'connections').text = format(1 << (midi['connection'] - 1), '010b')
            trigger = ET.SubElement(ET.SubElement(message, 'triggers'), 'trigger')
            ET.SubElement(trigger, 'var').text = 'x'
            ET.SubElement(trigger, 'condition').text = 'RISE'
            data = ET.SubElement(message, 'message')
            for key, value in (('type', midi['type']), ('channel', midi['channel'] - 1),
                               ('data1', midi['number']), ('data2', midi['value'])):
                ET.SubElement(data, key).text = str(value)
            vals = ET.SubElement(message, 'values')
            for index in range(3):
                value = ET.SubElement(vals, 'value')
                for key, val in (('type', 'CONSTANT'),
                                  ('key', ''), ('scaleMin', 0),
                                  ('scaleMax', 15 if index == 0 else 127)):
                    ET.SubElement(value, key).text = str(val)
            self.mapping.append(dict(control=name, **midi, enabled=False))
        self.buttons.append({'name': name, 'rect': rect})
        return self.append(parent, item)

    def show_page_script(self, page):
        names = ['overview'] + [act['id'] for act in self.spec['performances']]
        return '\n'.join('  root:findByName(' + lua_quote(name) + ', true).visible = ' +
                         str(name == page).lower() for name in names)

    def select_song_script(self, act_id, song_id):
        act_names = [act['id'] for act in self.spec['performances']]
        song_names = [act['id'] + '_' + song['id']
                      for act in self.spec['performances'] for song in act['songs']]
        return '\n'.join([
            '  local selectedAct = ' + lua_quote(act_id),
            '  local selectedSong = ' + lua_quote(song_id),
            '  local deselect = root:findByName(selectedSong .. "_selected", true).visible',
            '  for _, name in ipairs({' + ', '.join(map(lua_quote, act_names)) + '}) do',
            '    root:findByName(name .. "_selected", true).visible = not deselect and name == selectedAct',
            '  end',
            '  for _, name in ipairs({' + ', '.join(map(lua_quote, song_names)) + '}) do',
            '    root:findByName(name .. "_selected", true).visible = not deselect and name == selectedSong',
            '  end',
            '  if deselect then return true end',
        ])

    def build(self):
        r = self.root
        self.label(r, 'brand', (24, 23, 510, 44), self.spec['title'], 32, bold=True)
        self.box(r, 'preview_badge', (538, 30, 182, 32), COLORS['surface2'], radius=16)
        self.label(r, 'preview_badge_text', (538, 30, 182, 32), '試作　送信OFF', 17, COLORS['muted'], align=2)

        self.box(r, 'qlc_stop_outline', (24, 98, 288, 76), COLORS['red'])
        self.box(r, 'qlc_stop_base', (26, 100, 284, 72), COLORS['red_bg'], radius=6)
        self.label(r, 'qlc_stop_title', (40, 111, 256, 50), 'QLC+ 全停止', 28, COLORS['red'], align=2, bold=True)
        qlc = self.spec['qlc_stop']
        self.button(r, 'qlc_stop_all', (24, 98, 288, 76), midi={
            'type': 'NOTE_ON', 'channel': qlc['channel'], 'number': qlc['note'], 'value': 127,
            'connection': qlc['connection'],
            'target': f"VC button {qlc['vc_button_id']} / {qlc['action']}", 'role': 'qlc_stop_all'})

        self.box(r, 'border_panel', (336, 98, 384, 76), COLORS['surface'])
        self.label(r, 'border_title', (350, 110, 126, 52), 'ボーダー', 23)
        border = self.spec['qlc_border']
        for name, x, text, value, fill, ink in (
                ('on', 480, 'ON', 127, COLORS['blue'], COLORS['bg']),
                ('off', 596, 'OFF', 0, COLORS['surface2'], COLORS['text'])):
            self.box(r, 'border_' + name + '_base', (x, 110, 108, 52), fill, radius=6)
            self.label(r, 'border_' + name + '_text', (x, 110, 108, 52), text, 24, ink, align=2, bold=True)
            self.button(r, 'border_' + name, (x, 110, 108, 52), midi={
                'type': 'CONTROLCHANGE', 'channel': border['channel'], 'number': border['cc'], 'value': value,
                'connection': border['connection'],
                'target': f"Scene {border['function_id']} / {border['action']} / DMX {border['dmx_channel']}",
                'role': 'qlc_border_' + name})

        overview = self.group('overview', True)
        self.label(overview, 'overview_title', (24, 214, 510, 42), '演目', 30, page='overview', bold=True)
        for index, act in enumerate(self.spec['performances']):
            col, row = index % 2, index // 2
            x, y = 24 + col * 356, 270 + row * 86
            page = 'overview'
            self.box(overview, act['id'] + '_tile', (x, y, 340, 76), COLORS['surface'], page)
            self.selection_highlight(overview, act['id'], (x, y, 340, 76), page)
            self.label(overview, act['id'] + '_title', (x + 20, y + 15, 220, 46), act['title'], 29, page=page, bold=True)
            self.label(overview, act['id'] + '_song_count', (x + 250, y + 18, 70, 40), f"{len(act['songs'])}曲", 19, COLORS['muted'], page, align=3)
            self.button(overview, 'open_' + act['id'], (x, y, 340, 76), self.show_page_script(act['id']))

            detail = self.group(act['id'], False)
            self.box(detail, act['id'] + '_back_base', (24, 214, 48, 48), COLORS['surface2'], act['id'], radius=6)
            self.label(detail, act['id'] + '_back_icon', (24, 211, 48, 48), '‹', 44, page=act['id'], align=2)
            self.button(detail, 'back_' + act['id'], (24, 214, 48, 48), self.show_page_script('overview'))
            self.label(detail, act['id'] + '_heading', (94, 214, 606, 48), act['title'], 34, page=act['id'], bold=True)
            self.label(detail, act['id'] + '_song_heading', (24, 289, 696, 32), '曲を頭出し', 24, COLORS['muted'], act['id'])
            for song_index, song in enumerate(act['songs']):
                tag = act['id'] + '_' + song['id']
                y = 342 + song_index * 110
                self.box(detail, tag + '_base', (24, y, 696, 100), COLORS['surface'], act['id'])
                self.selection_highlight(detail, tag, (24, y, 696, 100), act['id'])
                self.song_act[tag] = act['id']
                self.label(detail, tag + '_index', (43, y + 26, 52, 48), f'{song_index + 1:02}', 26, COLORS['muted'], act['id'], align=2)
                self.label(detail, tag + '_title', (116, y + 28, 400, 44), song['title'], 31, page=act['id'], bold=True)
                self.label(detail, tag + '_cue', (550, y + 25, 147, 50), '頭出し', 25, COLORS['blue'], act['id'], align=2)
                self.button(detail, tag, (24, y, 696, 100), self.select_song_script(act['id'], tag), midi={
                    'type': 'NOTE_ON', 'channel': song['channel'], 'number': song['note'],
                    'value': 127, 'connection': 1, 'target': song['locator'], 'role': 'song_locator'})

        self.box(r, 'metronome_panel', (24, 794, 696, 76), COLORS['surface'])
        self.label(r, 'metronome_title', (44, 806, 348, 52), 'メトロノーム', 25)
        metro = self.spec['metronome']
        for name, x, text, fill, ink in (
                ('on', 480, 'ON', COLORS['blue'], COLORS['bg']),
                ('off', 596, 'OFF', COLORS['surface2'], COLORS['text'])):
            self.box(r, 'metronome_' + name + '_base', (x, 806, 108, 52), fill, radius=6)
            self.label(r, 'metronome_' + name + '_text', (x, 806, 108, 52), text, 24, ink, align=2, bold=True)
            self.button(r, 'metronome_' + name, (x, 806, 108, 52), midi={
                'type': 'CONTROLCHANGE', 'channel': metro['channel'], 'number': metro[name + '_cc'], 'value': 127,
                'connection': metro['connection'], 'target': 'METRO ' + text, 'role': 'metronome_' + name})

        self.box(r, 'resume_base', (24, 886, 696, 104), COLORS['green'])
        self.box(r, 'resume_icon', (52, 920, 26, 34), COLORS['green_text'], radius=0, shape=3)
        self.label(r, 'resume_title', (105, 909, 584, 58), 'Live 続きから再開', 35, COLORS['green_text'], bold=True)
        resume = self.spec['resume']
        self.button(r, 'resume', (24, 886, 696, 104),
                    midi={'type': 'CONTROLCHANGE', 'channel': resume['channel'], 'number': resume['cc'],
                          'value': 127, 'connection': resume['connection'], 'target': resume['action'], 'role': 'resume'})

        self.box(r, 'live_stop_base', (24, 1010, 696, 98), COLORS['surface2'])
        self.box(r, 'live_stop_icon', (52, 1045, 28, 28), COLORS['text'], radius=2)
        self.label(r, 'live_stop_title', (105, 1030, 584, 58), 'Live 再生停止', 35, bold=True)
        stop = self.spec['live_stop']
        self.button(r, 'live_stop', (24, 1010, 696, 98), midi={
            'type': 'CONTROLCHANGE', 'channel': stop['channel'], 'number': stop['cc'], 'value': 127,
            'connection': stop['connection'], 'target': stop['action'], 'role': 'live_stop'})
        return self

    def write(self, out):
        out.mkdir(parents=True, exist_ok=True)
        document = ET.Element('lexml', version='6')
        document.append(self.root)
        xml = ET.tostring(document, encoding='utf-8', xml_declaration=True)
        (out / 'show-control-prototype.tosc').write_bytes(zlib.compress(xml, 9))
        (out / 'show-control-prototype.xml').write_bytes(xml)
        with (out / 'midi-mapping.csv').open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.DictWriter(stream, fieldnames=list(self.mapping[0]))
            writer.writeheader()
            writer.writerows(self.mapping)
        report = {'canvas': [W, H], 'performances': len(self.spec['performances']),
                  'songs': sum(len(a['songs']) for a in self.spec['performances']),
                  'buttons': len(self.buttons), 'midi_messages': len(self.mapping),
                  'midi_enabled': False, 'smallest_button_height': min(b['rect'][3] for b in self.buttons)}
        assert report['performances'] == 12
        assert len({(m['connection'], m['channel'], m['type'], m['number'], m['value']) for m in self.mapping}) == len(self.mapping)
        for b in self.buttons:
            x, y, w, h = b['rect']
            assert w >= 44 and h >= 44, b
            assert x >= 0 and y >= 0 and x + w <= W and y + h <= H, b
        assert all(m.findtext('enabled') == '0' for m in self.root.findall('.//messages/midi'))
        (out / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        return report

    def render(self, page, out, selected=None):
        scale = 2
        canvas_width, canvas_height = self.spec['size']
        im = Image.new('RGB', (canvas_width * scale, canvas_height * scale), COLORS['bg'])
        draw = ImageDraw.Draw(im)
        font_dir = Path('<PATH>')
        if font_dir.exists():
            font_paths = [font_dir / 'YuGothM.ttc', font_dir / 'YuGothB.ttc']
        else:
            import unicodedata
            font_dir = Path('/System/Library/Fonts')
            font_paths = [next(p for p in font_dir.iterdir() if
                          unicodedata.normalize('NFC', p.name) == name)
                          for name in ('ヒラギノ角ゴシック W3.ttc', 'ヒラギノ角ゴシック W6.ttc')]
        fonts = {}
        for p in self.primitives:
            if p['page'] not in ('all', page):
                continue
            if p.get('selected_for') and p['selected_for'] not in (selected, self.song_act.get(selected)):
                continue
            x, y, w, h = [v * scale for v in p['rect']]
            if p['kind'] == 'box':
                if p['shape'] == 3:
                    draw.polygon([(x, y), (x + w, y + h / 2), (x, y + h)], fill=p['fill'])
                else:
                    draw.rounded_rectangle((x, y, x + w, y + h), radius=p['radius'] * scale, fill=p['fill'])
            else:
                size = p['size'] * scale
                key = (size, p['bold'])
                if key not in fonts:
                    fonts[key] = ImageFont.truetype(str(font_paths[int(p['bold'])]), size)
                font = fonts[key]
                text = p['text']
                bbox = draw.textbbox((0, 0), text, font=font)
                tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
                if tw > w:
                    raise ValueError(f"Text does not fit: {p['name']} ({tw / scale} > {w / scale})")
                tx = x + (w - tw) / 2 if p['align'] == 2 else x + w - tw if p['align'] == 3 else x
                ty = y + (h - th) / 2 - bbox[1]
                draw.text((tx, ty), text, font=font, fill=p['fill'])
        im.save(out)
        return im


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--spec', type=Path, default=Path(__file__).parent / 'layouts' / 'manipulation-12.json')
    parser.add_argument('--out', type=Path, default=Path(__file__).parent / 'prototype')
    args = parser.parse_args()
    if not args.spec.exists():
        args.spec.parent.mkdir(parents=True, exist_ok=True)
        args.spec.write_text(json.dumps(example(), ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    spec = json.loads(args.spec.read_text(encoding='utf-8'))
    assert spec['midi_enabled'] is False, 'This builder produces an offline prototype only.'
    assert len(spec['performances']) == 12
    assert all(1 <= len(a['songs']) <= 4 for a in spec['performances'])
    builder = Builder(spec).build()
    report = builder.write(args.out)
    overview = builder.render('overview', args.out / 'preview-overview.png', selected='act01_song02')
    detail = builder.render('act01', args.out / 'preview-songs.png', selected='act01_song02')
    contact = Image.new('RGB', (W * 2 + 48, H + 56), '#080C12')
    font = ImageFont.truetype('<PATH>', 20)
    draw = ImageDraw.Draw(contact)
    draw.text((16, 12), '演目一覧', font=font, fill=COLORS['muted'])
    draw.text((W + 32, 12), '演目内の曲を頭出し', font=font, fill=COLORS['muted'])
    contact.paste(overview.resize((W, H), Image.Resampling.LANCZOS), (16, 48))
    contact.paste(detail.resize((W, H), Image.Resampling.LANCZOS), (W + 32, 48))
    contact.save(args.out / 'preview.png')
    print(json.dumps(report))


if __name__ == '__main__':
    main()
