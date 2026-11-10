'use strict';
// In-memory routing and a temporary watcher fixture only. No QLC/MIDI outputs.
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm');
const source = require('./source'), pages = require('./page-registry');
const Router = require('./midi-router'), {CueState} = require('./web-bridge'), {exportMidi} = require('./export-midi');
const {DOMParser} = require('@xmldom/xmldom');
const xml = '<Workspace xmlns="http://www.qlcplus.org/Workspace"><Engine><InputOutputMap><Universe ID="0"/></InputOutputMap>' +
    '<Function ID="1" Type="Scene" Name="shared"/><Function ID="2" Type="Scene" Name="local"/></Engine><VirtualConsole>' +
    '<Frame Caption="DFS"><Button ID="1" Caption="shared"><Action>Flash</Action><Function ID="1"/></Button></Frame>' +
    '<Frame Caption="C2"><Button ID="2" Caption="local"><Action>Flash</Action><Function ID="2"/></Button>' +
    '<Button ID="3" Caption="stop"><Action>StopAll</Action></Button></Frame></VirtualConsole></Workspace>';
const controls = source.parseWorkspace(xml), identity = Array.from({length:128}, (_,i)=>i);
const registry = {version:2, defaultLayout:identity, defaultPage:0, commonWidgetIds:['1'], pagesWithoutSharedRows:[1], bindings:[
    {widgetId:'scene-color', channel:0, liveNote:0}, {widgetId:'1', channel:0, liveNote:1},
    {widgetId:'page:0', channel:0, liveNote:127}, {widgetId:'page:1', channel:0, liveNote:126},
    {widgetId:'scene-color', channel:2, liveNote:0}, {widgetId:'2', channel:2, liveNote:1},
    {widgetId:'3', channel:2, liveNote:120}, {widgetId:'page:0', channel:2, liveNote:127},
    {widgetId:'page:1', channel:2, liveNote:126}], deferred:[]};
assert.deepStrictEqual(source.allocate(controls, registry), registry, 'Page-owned synthetic controls survive refresh');
const data = source.snapshot(controls, registry, 'test', '1');
assert.equal(data.pageViews[0][1].functionName, 'shared');
assert.equal(data.pageViews[1][1].functionName, 'local');
assert.equal(data.pageViews[1][1].channel, 2);
assert.equal(data.pageViews[1][127].type, 'Page');
assert.equal(data.pageViews[1][0].type, 'SceneColor');
for (const setting of [[1,1], [15], [-1], ['1'], null])
    assert.throws(()=>source.validateRegistry({...registry, pagesWithoutSharedRows:setting}));
assert.throws(()=>source.validateRegistry({...registry, pagesWithoutSharedRows:[]}));
assert.throws(()=>source.validateRegistry({...registry, bindings:[...registry.bindings, {widgetId:'2', channel:1, liveNote:80}]}));
// Omitting shared rows grants the full 128-pitch address space, including global tombstones.
const removed = {...registry, bindings:registry.bindings.filter(b=>b.channel!==2)};
assert.equal(source.snapshot(controls, removed, 'test','2').pageViews[1][1].widgetId, null);
const more = source.allocate([...controls, {widgetId:'4', type:'Button', action:'Flash', pageIndex:1, valid:true}], removed);
assert.equal(more.bindings.find(b=>b.widgetId==='2').liveNote, 0);
const normal = {version:2, defaultLayout:identity, defaultPage:0, commonWidgetIds:['1'], bindings:registry.bindings.filter(b=>b.channel===0)};
const defaultData = source.snapshot(controls, source.allocate(controls, normal), 'test','3');
assert.equal(defaultData.pageViews[1][1].functionName,'shared', 'Missing setting retains old behavior');
// The existing permutation is sufficient: rebase bindings, never clip notes.
const permuted = JSON.parse(JSON.stringify(registry));
[permuted.defaultLayout[1],permuted.defaultLayout[83]] = [83,1];
permuted.bindings.find(b=>b.widgetId==='2').liveNote = 83;
const mapped = source.snapshot(controls, permuted, 'test','4');
const context = vm.createContext({});
for (const file of ['page-scope.js','note-layout.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,file),'utf8'),context);
const view = context.layoutControls(mapped.pageViews[1],0,permuted.defaultLayout,true);
const packets=[], calls=[], colors=[], router = new Router(p=>packets.push(p), (local,ch,n,v)=>calls.push([local,ch,n,v]), ()=>{}, (...a)=>colors.push(a));
router.update(view);
router.packet([144,1,127]); router.packet([128,1,0]);
router.packet([144,120,127]); router.packet([128,120,0]);
router.packet([144,127,127]); router.packet([128,127,0]);
router.packet([144,0,127]); router.packet([128,0,0]);
assert.deepStrictEqual(packets, [[146,83,127],[130,83,0],[146,120,127],[130,120,0]]);
assert.deepStrictEqual(colors, [[23,127],[23,0]]);
const commands=[], state=new CueState(c=>commands.push(c)); state.update(mapped);
for (const [,ch,n,v] of calls) state.note((ch-1)*128+n,v);
assert.deepStrictEqual(commands, ['2|255','2|0','3|255','VC_PAGE|0']);
const exported = new DOMParser().parseFromString(exportMidi(xml,permuted),'text/xml');
const buttons=Array.from(exported.getElementsByTagName('Button'));
for (const [id,n] of [['2',83],['3',120]])
    assert.equal(Number(buttons.find(b=>b.getAttribute('ID')===id).getElementsByTagName('Input')[0].getAttribute('Channel')),2*4096+128+n);
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'qlc-shared-rows-')), file=path.join(folder,'show.qxw'), map=file+'.live-map.json';
let watcher;
try {
    fs.writeFileSync(file,xml); fs.writeFileSync(map,JSON.stringify(normal));
    const updates=[]; watcher=new source.WorkspaceWatcher(x=>updates.push(x)); watcher.start(file); watcher.stop();
    assert(!updates[0].error);
    fs.writeFileSync(map,JSON.stringify(registry)); watcher.refresh();
    assert.equal(updates.length,2,'Map-only edits must refresh without saving the QXW');
    assert.equal(updates[1].pageViews[1][1].functionName,'local');
    watcher.refresh(); assert.equal(updates.length,2,'Stable files do not re-emit');
} finally { if(watcher)watcher.stop(); fs.rmSync(folder,{recursive:true,force:true}); }
console.log('PASS: optional shared rows, page-owned controls, map-only refresh, unchanged default maps, local layout rebasing, Web/MIDI targets and exported inputs');
