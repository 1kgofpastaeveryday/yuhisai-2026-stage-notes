from pathlib import Path
import shutil

runtime=Path('<PATH>').resolve()
for name in ('uninstall.exe','qlcplus5-before-20261016.exe'):
    target=runtime/name
    assert target.resolve().parent==runtime
    if target.exists():
        target.unlink()
for translation in Path('<PATH>').glob('qlcplus_*.qm'):
    shutil.copy2(translation,runtime/translation.name)
print('Portable candidate contains current app only; master translations copied.')
