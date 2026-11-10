from pathlib import Path
import shutil

root=Path(__file__).parent
p=root/'regression-fixture.qxw'
text=p.read_bytes()
assert b'<!DOCTYPE Workspace>' not in text
first,rest=text.split(b'\n',1)
p.write_bytes(first+b'\n<!DOCTYPE Workspace>\n'+rest)
for name in ('local-features','save-native'):
    shutil.copy2(root/'tests'/(name+'.txt'),root/'tests'/(name+'-before-fixture-fix.txt'))
print('Restored required Workspace DOCTYPE in test fixture.')
