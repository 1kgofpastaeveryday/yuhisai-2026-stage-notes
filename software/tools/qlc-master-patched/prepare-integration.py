from pathlib import Path
import copy
import xml.etree.ElementTree as ET

root=Path(__file__).parent
src=Path('<PATH>')
ns={'q':'http://www.qlcplus.org/Workspace'}
n='{'+ns['q']+'}'
ET.register_namespace('',ns['q'])
tree=ET.parse(root/'regression-fixture.qxw')
doc=tree.getroot()
functions={f.get('ID'):f.get('Name') for f in doc.findall('q:Engine/q:Function',ns)}
for button in doc.findall('.//q:Button',ns):
    f=button.find('q:Function',ns)
    if f is not None and f.get('ID') in functions:
        button.set('Caption',functions[f.get('ID')])
def write(tree,path):
    path.write_bytes(b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Workspace>\n'+ET.tostring(tree.getroot(),encoding='utf-8'))
write(tree,root/'integration-fixture.qxw')

cmake=root/'CMakeLists.txt'
text=cmake.read_text()
text+='\nadd_executable(integration_host integration-host.cpp $<TARGET_OBJECTS:candidate_test_resources>)\ntarget_link_libraries(integration_host PRIVATE candidate_frontend)\n'
cmake.write_text(text)
print('Integration host and fixture prepared.')
