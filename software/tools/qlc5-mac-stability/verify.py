#!/usr/bin/env python3
"""Run isolated native/Qt regressions; never operate mapped hardware."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('--bundle', type=Path, required=True)
parser.add_argument('--show', type=Path, required=True)
parser.add_argument('--reports', type=Path, required=True)
a = parser.parse_args()
a.reports.mkdir(parents=True, exist_ok=True)
bin_dir = a.bundle.resolve() / 'Contents/MacOS'
source = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='qlc-mac-verify-') as temp:
    tree = ET.parse(a.show)
    ET.register_namespace('', 'http://www.qlcplus.org/Workspace')
    for parent in tree.iter():
        for child in list(parent):
            if child.tag.split('}')[-1] in {'Input', 'Output', 'Feedback'}:
                parent.remove(child)
    show = Path(temp) / 'isolated.qxw'
    xml = ET.tostring(tree.getroot(), encoding='unicode')
    show.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Workspace>\n' + xml)
    env = dict(os.environ, QLC_TEST_SHOW=str(show), QLC_IDENTITY_NATIVE='1')
    cases = ['copiedShowPlaybackAndLifetime', 'duplicateNamesRenameAndDelete',
             'duplicateNamesDeleteSecond', 'nativeRepeatedDuplicateNames', 'loopingChaserSoak']
    for case in cases:
        with (a.reports / (case + '.log')).open('w') as log:
            # App/Tardis are process singletons: each case needs a fresh process.
            result = subprocess.run([str(bin_dir / 'stability-test'), case, '-maxwarnings', '30000'],
                                    env=env, stdout=log, stderr=subprocess.STDOUT, timeout=240)
        if result.returncode:
            raise SystemExit(f'FAIL {case}: exit {result.returncode}')
        print('PASS', case)
    with (a.reports / 'qt-gc.log').open('w') as log:
        subprocess.run([str(bin_dir / 'qt-gc-test'), str(source / 'gcCollectedOwner.qml'),
                        str(source / 'gcCollectedListOwner.qml')], stdout=log,
                       stderr=subprocess.STDOUT, check=True, timeout=60)
    print('PASS upstream Qt GC regressions')

with (a.reports / 'qt-canvas.log').open('w') as log:
    subprocess.run([str(bin_dir / 'qt-canvas-test')], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=60)
print('PASS Canvas GC/context teardown regression')
