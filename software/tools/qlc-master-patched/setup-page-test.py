from pathlib import Path
import copy
import xml.etree.ElementTree as ET

root=Path(__file__).parent
ns={'q':'http://www.qlcplus.org/Workspace'}
n='{'+ns['q']+'}'
ET.register_namespace('',ns['q'])
tree=ET.parse(root/'regression-fixture.qxw')
vc=tree.find('q:VirtualConsole',ns)
template=next(b for b in vc.findall('.//q:Button',ns) if b.get('ID')=='16')
for child in list(vc):
    vc.remove(child)
for page,widget,function in ((0,16,'183'),(1,120,'190')):
    frame=ET.SubElement(vc,n+'Frame',{'Caption':'Page '+str(page+1),'ID':str(page)})
    ET.SubElement(frame,n+'WindowState',{'Visible':'True','X':'0','Y':'0','Width':'800','Height':'600'})
    button=copy.deepcopy(template)
    button.set('ID',str(widget))
    button.find('q:Function',ns).set('ID',function)
    for old in list(button.findall('q:Input',ns)):
        button.remove(old)
    ET.SubElement(button,n+'Input',{'ID':'0','Universe':'0','Channel':str(4096*(page+1)+128+44)})
    frame.append(button)
for enabled in (False,True):
    vc.set('MIDIPageChannels','True' if enabled else 'False')
    (root/('page-routing-on.qxw' if enabled else 'page-routing-off.qxw')).write_bytes(b'<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE Workspace>\n'+ET.tostring(tree.getroot(),encoding='utf-8'))
p=root/'CMakeLists.txt'
text=p.read_text()
text+='\nadd_executable(page_routing_test page-routing-test.cpp $<TARGET_OBJECTS:candidate_test_resources>)\ntarget_link_libraries(page_routing_test PRIVATE candidate_frontend Qt${QT_MAJOR_VERSION}::Test)\n'
p.write_text(text)
