'use strict';
// Saved files/in-memory messages only; no native app, MIDI port or DMX output.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {DOMParser, XMLSerializer} = require('@xmldom/xmldom');
const {parseWorkspace, allocate, snapshot} = require('./source');
const {CueState, WebBridge, matchingProject} = require('./web-bridge');
const {exportMidi} = require('./export-midi');
const MidiRouter = require('./midi-router');
const scopeControls = require('./page-scope');
const NS = 'http://www.qlcplus.org/Workspace';
const original = fs.readFileSync(path.join(__dirname, 'test-fixtures/workspace-61.qxw'), 'utf8');
const doc = new DOMParser().parseFromString(original, 'text/xml');
const vc = doc.getElementsByTagNameNS(NS, 'VirtualConsole')[0];
for (const name of ['Group A', 'Group B']) {
    const page = doc.createElementNS(NS, 'Frame');
    page.setAttribute('Caption', name); // Native new pages need not have a widget ID.
    vc.appendChild(page);
}
const xml = new XMLSerializer().serializeToString(doc);
const controls = parseWorkspace(xml), registry = allocate(controls);
const data = snapshot(controls, registry, 'pages.qxw', '1');
const pages = data.controls.filter(c => c.type === 'Page');
assert.deepEqual(pages.map(c => c.pageIndex), [0,1,2]);
assert.deepEqual(pages.map(c => c.liveNote), [112,113,114]);
assert.equal(pages[2].name, '[Page 3] Group B');
assert(controls.filter(c=>c.type!=='Page').every(c=>c.pageIndex===0));
const page1=scopeControls(data.controls,1),page3=scopeControls(data.controls,3);
assert.equal(page1[49].valid,true);assert.equal(page3[49].valid,false);
assert.equal(page3[114].valid,true);assert.equal(page3[112].valid,false);
assert.equal(data.controls[49].valid,true); // Track scope never mutates the shared source.
assert.deepEqual(scopeControls(data.controls,99).filter(c=>c.valid).map(c=>c.type),['SceneColor']);
const commands = [], state = new CueState(m => commands.push(m)); state.update(data);
state.note(114,127); state.note(114,0); state.note(112,1); state.note(114,100); state.note(114,0);
state.note(112,0); state.panic();
assert.deepEqual(commands, ['VC_PAGE|2','VC_PAGE|0','VC_PAGE|2']);
const offline = new WebBridge('http://127.0.0.1:9999', () => {});
offline.send('VC_PAGE|0');
assert.equal(offline.deferredReleases.size, 0); // Page1 is not a widget release.
state.note(114,127,false); state.note(114,0); assert.equal(commands.length,3);
const packets=[], reports=[], router = new MidiRouter(p=>packets.push(p),(...r)=>reports.push(r));
router.update(data.controls); router.byte(144); router.byte(114); router.byte(127);
router.panic(); router.byte(128); router.byte(114); router.byte(0);
assert.deepEqual(packets, []); // Never send a page cue to a physical MIDI input.
assert.deepEqual(reports.map(r=>[r[0],r[3]]), [[114,127],[114,0]]);
const widgets=controls.filter(c=>c.type!=='Page').map(c=>({id:Number(c.widgetId),typeId:c.type==='Button'?1:2,
    caption:c.name,actionType:{Toggle:0,Flash:1,Blackout:2,StopAll:3}[c.action],functionId:Number(c.functionId),
    sliderMode:c.type==='Slider'?'Adjust':undefined}));
const json={pages:pages.map((p,i)=>({index:i,caption:p.pageCaption,children:i===0?widgets:[]}))};
assert(matchingProject(data,json));
json.pages[1].caption='Unsaved rename'; assert(!matchingProject(data,json));
const beforeRename=registry.bindings.find(b=>b.widgetId==='page:1').liveNote;
vc.childNodes[vc.childNodes.length-2].setAttribute('Caption','Renamed group');
const renamed=parseWorkspace(new XMLSerializer().serializeToString(doc));
assert.equal(allocate(renamed,registry).bindings.find(b=>b.widgetId==='page:1').liveNote,beforeRename);
const withoutLast=allocate(controls.filter(c=>c.widgetId!=='page:2'),registry);
assert(!withoutLast.bindings.find(b=>b.widgetId==='page:2').retired);
const missing=snapshot(controls.filter(c=>c.widgetId!=='page:2'),withoutLast,'pages.qxw','2');
assert.equal(missing.controls[114].valid,false); assert.equal(missing.controls[114].name,'[Page 3: no page]');
assert.equal(allocate(controls,withoutLast).bindings.find(b=>b.widgetId==='page:2').liveNote,114);
const exported=parseWorkspace(exportMidi(xml,registry));
assert(exported.filter(c=>c.type==='Page').every(c=>c.preferred===null));
console.log('PASS: absolute Page3->Page1->Page3, repeated notes, NoteOff/panic do not switch, unsaved-page mismatch, stable tab-slot notes, missing slots and MIDI isolation.');
