"""Test-only TouchOSC adapter for generated Lua, with a controlled clock."""
import xml.etree.ElementTree as ET
from pathlib import Path

from lupa import LuaRuntime

FOLDER = Path(__file__).resolve().parent / 'countdown-demo'


def properties(n):
    return {p.findtext('key'): p.find('value') for p in n.findall('./properties/property')}


class DemoRuntime:
    def __init__(self, path=None):
        self.xml = ET.parse(path or FOLDER / 'setstop-countdown-demo.xml').getroot().find('node')
        self.nodes = {properties(n)['name'].text: n for n in self.xml.iter('node')}
        self.lua = LuaRuntime(unpack_returned_tuples=True)
        self.lua.execute('''
          now = 0; controls = {}; environments = {}
          function getMillis() return now end
          function Color(r,g,b,a) return {r=r,g=g,b=b,a=a} end
          function sendMIDI() error('Unexpected MIDI output') end
          function sendOSC() error('Unexpected OSC output') end
          function makeEnvironment(control, source)
            local env = setmetatable({self=control, root=controls.show_control}, {__index=_G})
            assert(load(source, control.name, 't', env))()
            return env
          end
        ''')
        self.controls, self.envs = self.lua.globals().controls, self.lua.globals().environments
        for name, item in self.nodes.items():
            p = properties(item)
            c = self.lua.table(name=name, visible=p['visible'].text == '1')
            c['values'] = self.lua.table(x=0)
            for value in item.findall('./values/value'):
                if value.findtext('key') == 'text': c['values']['text'] = value.findtext('default') or ''
            for key in ('frame', 'color', 'textColor'):
                if key in p:
                    c[key] = self.lua.table_from({v.tag: float(v.text) for v in p[key]})
            self.controls[name] = c
        self.lua.execute('''
          function controls.show_control:findByName(name, recursive)
            assert(recursive and controls[name], name)
            return controls[name]
          end
          function controls.show_control:notify(key, value)
            return environments.show_control.onReceiveNotify(key, value)
          end
        ''')
        for name, item in self.nodes.items():
            source = properties(item).get('script')
            if source is not None:
                self.envs[name] = self.lua.globals().makeEnvironment(self.controls[name], source.text)
        self.env = self.envs.show_control
        self.clock = 0
        self.env.init()

    def advance(self, milliseconds):
        self.clock += milliseconds
        self.lua.globals().now = self.clock
        self.env.update()

    def press(self, name):
        self.controls[name]['values'].x = 1
        handled = self.envs[name].onValueChanged('x')
        self.controls[name]['values'].x = 0
        self.envs[name].onValueChanged('x')
        return handled

    def read(self, name):
        return self.controls[name]['values']['text']

    def filled_ticks(self):
        return sum(self.controls[f'remaining_beat_{i}'].color.r > 0.5 for i in range(1, 17))

    def snapshot(self):
        state = {}
        for name in self.nodes:
            c = self.controls[name]
            state[name] = {'visible': bool(c.visible)}
            for key in ('frame', 'color', 'textColor'):
                if c[key] is not None: state[name][key] = dict(c[key].items())
            if c['values']['text'] is not None: state[name]['text'] = c['values']['text']
        return state
