"""Create an output-free workspace with two buttons bound to one Scene."""
import argparse
import copy
from pathlib import Path
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
root = ET.parse(args.source).getroot()
uri = root.tag.split('}')[0][1:]
ET.register_namespace('', uri)
n = '{' + uri + '}'
io = root.find(n + 'Engine/' + n + 'InputOutputMap')
assert io is not None
server = io.find(n + 'NetworkServer')
if server is not None:
    server.set('AutoStart', 'False')
for parent in io.iter():
    for child in list(parent):
        if child.tag in (n + 'Input', n + 'Output', n + 'Feedback'):
            parent.remove(child)
buttons = root.findall('.//' + n + 'Button')
first = next(b for b in buttons if b.get('ID') == '16')
matrix = next(b for b in buttons if b.get('ID') == '19')
matrix.find(n + 'Function').set('ID', '188')
duplicate = copy.deepcopy(first)
duplicate.set('ID', '120')
duplicate.set('Caption', 'Custom caption before rename')
parent = next(x for x in root.iter() if first in list(x))
parent.append(duplicate)
assert not io.findall('.//' + n + 'Output')
assert not io.findall('.//' + n + 'Input')
args.output.write_bytes(b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Workspace>\n' + ET.tostring(root, encoding='utf-8'))
