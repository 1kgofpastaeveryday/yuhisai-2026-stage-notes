"""Run the native backend regression without external lighting outputs."""
import argparse
import ctypes
import os
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--build-dir', type=Path, required=True)
    parser.add_argument('--qt-prefix', type=Path, required=True)
    parser.add_argument('--compiler-bin', type=Path, required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    args = parser.parse_args()
    root = ET.parse(args.fixture).getroot()
    ns = {'q': root.tag.split('}')[0][1:]}
    io = root.find('q:Engine/q:InputOutputMap', ns)
    if io is None or any(io.findall('.//q:' + tag, ns) for tag in ['Input', 'Output', 'Feedback']):
        parser.error('The test fixture must have no external Input/Output/Feedback mappings')
    # Suppress Windows crash dialogs; preserve the process failure status.
    ctypes.windll.kernel32.SetErrorMode(0x8003)
    env = os.environ.copy()
    env.pop('QT_QPA_PLATFORM_PLUGIN_PATH', None)
    env.update(QT_QPA_PLATFORM='offscreen',
               QT_PLUGIN_PATH=str(args.qt_prefix / 'plugins'),
               QML2_IMPORT_PATH=str(args.runtime / 'qml'),
               QLC_NAME_SYNC_FIXTURE=str(args.fixture.resolve()))
    env['PATH'] = os.pathsep.join(map(str, [args.runtime, args.qt_prefix / 'bin',
                                          args.compiler_bin])) + os.pathsep + env['PATH']
    args.report.parent.mkdir(parents=True, exist_ok=True)
    process = subprocess.run([str(args.build_dir / 'name-sync-test.exe'), '-o',
                              str(args.report.resolve()) + ',txt'],
                             env=env, capture_output=True, timeout=40)
    print(f'exit 0x{process.returncode & 0xffffffff:08x}')
    result = args.report.read_text(encoding='utf-8', errors='replace') if args.report.exists() else ''
    print('\n'.join(line for line in result.splitlines()
                    if any(key in line for key in ['PASS', 'FAIL', 'Totals', 'Actual', 'Expected'])))
    if process.returncode or '0 failed' not in result:
        print(process.stderr.decode('utf-8', errors='replace')[-3000:])
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
