'use strict';
// Local files and an ephemeral loopback mock only. No live QLC+, MIDI port or DMX.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const vm = require('vm');
const {DOMParser, XMLSerializer} = require('@xmldom/xmldom');
const {WebSocketServer} = require('ws');
const {parseWorkspace, allocate, snapshot, WorkspaceWatcher, workspacePath} = require('./source');
const {CueState, WebBridge, matchingProject} = require('./web-bridge');
const {exportMidi, createMidiCopy} = require('./export-midi');
const MidiRouter = require('./midi-router');
const NS = 'http://www.qlcplus.org/Workspace';
// Freeze the baseline: editing the user's show must not change unit-test inputs.
const production = path.join(__dirname, 'test-fixtures/workspace-61.qxw');
const xml = fs.readFileSync(production, 'utf8');
// Lexical path rules for both hosts, without accessing either host's show files.
for (const [workspace, set, platform, resolved, stored] of [
    ['<PATH>', '<PATH>', 'win32',
        '<PATH>', '../Lighting/main.qxw'],
    ['<PATH>', '<PATH>', 'win32',
        '<PATH>', '../Lighting/main.qxw'],
    ['<PATH>', '<PATH>', 'darwin',
        '<PATH>', '../Lighting/main.qxw'],
    ['../Lighting/main.qxw', '<PATH>', 'win32',
        '<PATH>', '../Lighting/main.qxw'],
    ['../Lighting/main.qxw', '/Volumes/Shows/Moved Show/Sets/Main.als', 'darwin',
        '/Volumes/Shows/Moved Show/Lighting/main.qxw', '../Lighting/main.qxw'],
    ['main.qxw', '/Show/Main.als', 'darwin', '/Show/main.qxw', 'main.qxw'],
    ['<PATH>', '', 'win32', '<PATH>', '<PATH>'],
    ['<PATH>', '', 'win32', '<PATH>', '<PATH>'],
    ['/Show/main.qxw', '', 'darwin', '/Show/main.qxw', '/Show/main.qxw'],
    ['<PATH>', '<PATH>', 'win32', '<PATH>', '<PATH>'],
    ['//host/share/Lighting/main.qxw', '//host/share/Sets/Main.als', 'win32',
        '//host/share/Lighting/main.qxw', '../Lighting/main.qxw'],
    ['//host/other/main.qxw', '//host/share/Sets/Main.als', 'win32',
        '//host/other/main.qxw', '//host/other/main.qxw']
]) assert.deepEqual(workspacePath(workspace, set, platform), {resolved, stored});
assert.throws(() => workspacePath('../main.qxw', '', 'darwin'), /save the Live Set/);
assert.throws(() => workspacePath('<PATH>', '/Show/Main.als', 'darwin'), /<PATH>/);
assert.throws(() => workspacePath('<PATH>', '<PATH>', 'win32'), /unavailable path/);
console.log('PASS: relative conversion/resolution, Windows native/slash/UNC and Mac paths, moved folders, unsaved Set and different drives/shares.');

function testWorkerPaths(folder, workspace) {
    // Execute the real Node entry point. Only the Max IPC and WebBridge are mocked.
    const handlers = {}, messages = [], watchers = [];
    class TestWatcher extends WorkspaceWatcher {
        constructor(emit) { super(emit); watchers.push(this); }
    }
    const setFolder = path.join(folder, 'Live Sets 日本語');
    fs.mkdirSync(setFolder);
    const setPath = path.join(setFolder, 'Main.als'); // No .als is created or opened.
    const modules = {
        'max-api': {addHandler: (name, handler) => { handlers[name] = handler; }, outlet: (...args) => messages.push(args)},
        './source': {WorkspaceWatcher: TestWatcher, workspacePath},
        './web-bridge': {WebBridge: class { update() {} stop() {} }},
        './config.json': {endpoint: 'unused'}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'qlc-watch.js'), 'utf8'), {
        require: name => modules[name] || require(name), process: {on() {}}
    });
    const load = (source, set = setPath) => {
        messages.length = 0;
        const request = JSON.stringify({source, setPath: set});
        handlers.source_context(request);
        return messages.filter(m => m[0] === 'source_stored').map(m => JSON.parse(m[1]));
    };
    try {
        const stored = '../workspace.qxw';
        const migrated = load(workspace);
        assert.deepEqual(migrated, [{request: JSON.stringify({source: workspace, setPath}), stored}]);
        assert.equal(watchers[0].source, path.resolve(workspace));
        assert(messages.some(m => m[0].controls && !m[0].error));
        assert.deepEqual(load(stored), [], 'Restored relative path needs no write-back');
        assert.equal(watchers[0].source, path.resolve(workspace));
        assert.deepEqual(load(workspace, ''), [], 'Unsaved Set retains the absolute value');
        if (process.platform === 'win32') {
            const otherDrive = path.parse(workspace).root[0].toUpperCase() === 'D' ? 'E' : 'D';
            assert.deepEqual(load(workspace, otherDrive + ':/Sets/Main.als'), [], 'Different drive retains the absolute value');
            assert.equal(watchers[0].source, path.resolve(workspace));
        }

        // A same-named file next to the Set must never rescue a missing absolute path.
        fs.writeFileSync(path.join(setFolder, 'workspace.qxw'), xml);
        const missing = path.join(folder, 'missing', 'workspace.qxw');
        assert.deepEqual(load(missing), [], 'Missing absolute path is never converted');
        assert.equal(watchers[0].source, missing);
        assert(messages.some(m => m[0].error && m[0].source === missing && m[0].error.includes('ENOENT')));
        assert(!messages.some(m => m[0].controls), 'No filename search or fallback');
        assert.deepEqual(load('../missing/workspace.qxw'), []);
        assert.equal(watchers[0].source, missing);
        assert(messages.some(m => m[0].error && m[0].source === missing));
        assert.deepEqual(load('../workspace.qxw', ''), []);
        assert.equal(watchers[0].source, null, 'Unresolvable relative value stops the previous watch');
        assert(messages.some(m => m[0].error && m[0].source === '../workspace.qxw'));
    } finally { handlers.stop(); }
    console.log('PASS: actual Node source handler, existing-file migration/watch, relative reload, unsaved Set, missing paths visible and no filename fallback.');
}
const initial = parseWorkspace(xml);
const registry = allocate(initial);
assert.equal(initial.length, 62);
const old = initial.filter(c => c.preferred !== null);
assert.equal(old.length, 59);
for (const c of old) assert.equal(registry.bindings.find(b => b.widgetId === c.widgetId).liveNote, c.preferred);
function addButton(text, id, name, action = 'Flash') {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    const engine = doc.getElementsByTagNameNS(NS, 'Engine')[0];
    const fn = doc.createElementNS(NS, 'Function');
    fn.setAttribute('ID', id); fn.setAttribute('Type', 'Scene'); fn.setAttribute('Name', name); engine.appendChild(fn);
    const parent = doc.getElementsByTagNameNS(NS, 'VirtualConsole')[0].getElementsByTagNameNS(NS, 'Frame')[0];
    const b = doc.createElementNS(NS, 'Button'); b.setAttribute('ID', id); b.setAttribute('Caption', name);
    const f = doc.createElementNS(NS, 'Function'); f.setAttribute('ID', id); b.appendChild(f);
    const a = doc.createElementNS(NS, 'Action'); a.appendChild(doc.createTextNode(action)); b.appendChild(a); parent.appendChild(b);
    return new XMLSerializer().serializeToString(doc);
}
const addedXml = addButton(xml, '9999', 'New 日本語 & blue');
const controls = parseWorkspace(addedXml);
const extended = allocate(controls, registry);
const newNote = extended.bindings.find(b => b.widgetId === '9999').liveNote;
assert.equal(newNote, 113);
assert.deepEqual(extended.bindings.slice(0, registry.bindings.length), registry.bindings);
const addedSnapshot = snapshot(controls, extended, 'test.qxw', '1');
assert.equal(addedSnapshot.controls[newNote].name, 'New 日本語 & blue');
assert.equal(addedSnapshot.controls[newNote].valid, true);
const removed = allocate(initial, extended);
const another = allocate(parseWorkspace(addButton(xml, '10000', 'Next')), removed);
assert.equal(another.bindings.find(b => b.widgetId === '10000').liveNote, newNote + 1);
assert.equal(snapshot(initial, removed, 'test.qxw','2').controls[newNote].removed, true);
const reused = allocate(controls, removed);
assert.equal(reused.bindings.find(b => b.widgetId === '9999' && !b.retired).liveNote, newNote + 1);
assert.equal(snapshot(controls, reused, 'test.qxw', '3').controls[newNote].removed, true);
assert.throws(() => allocate(initial, {version:1, bindings:[{widgetId:'4',liveNote:36},{widgetId:'7',liveNote:36}]}));

// A large unfinished VC grid must leave pitches available for configured cues.
const gridDoc = new DOMParser().parseFromString(addedXml, 'text/xml');
const grid = gridDoc.getElementsByTagNameNS(NS, 'VirtualConsole')[0].getElementsByTagNameNS(NS, 'Frame')[0];
for (let i = 0; i < 200; i++) {
    const button = gridDoc.createElementNS(NS, 'Button');
    button.setAttribute('ID', String(20000 + i)); button.setAttribute('Caption', 'Empty ' + i);
    const fn = gridDoc.createElementNS(NS, 'Function'); fn.setAttribute('ID', '4294967295'); button.appendChild(fn);
    grid.appendChild(button);
}
const gridXml = new XMLSerializer().serializeToString(gridDoc);
const gridControls = parseWorkspace(gridXml), gridRegistry = allocate(gridControls, extended);
assert.deepEqual(gridRegistry, extended, 'Unconfigured new buttons consume no pitch reservations');
assert.equal(parseWorkspace(exportMidi(gridXml, gridRegistry)).filter(c => c.widgetId >= 20000 && c.preferred !== null).length, 0);
const configured = gridControls.map(c => c.widgetId === '20000' ? {...c, valid:true, functionId:'9999'} : c);
const configuredRegistry = allocate(configured, gridRegistry);
const configuredNote = configuredRegistry.bindings.find(b => b.widgetId === '20000').liveNote;
assert.equal(configuredRegistry.bindings.length, extended.bindings.length + 1);
assert.equal(snapshot(configured, configuredRegistry, 'grid.qxw', '1').controls[configuredNote].valid, true);
const clearedRegistry = allocate(gridControls, configuredRegistry);
assert.deepEqual(clearedRegistry, configuredRegistry, 'Clearing a previously configured cue keeps its binding');
assert.equal(snapshot(gridControls, clearedRegistry, 'grid.qxw', '2').controls[configuredNote].valid, false);
assert.equal(allocate(configured, clearedRegistry).bindings.find(b => b.widgetId === '20000').liveNote, configuredNote);

const output = [];
const state = new CueState(m => output.push(m)); state.update(addedSnapshot);
state.note(newNote,127); state.note(newNote,100); state.note(newNote,0);
assert.deepEqual(output, ['9999|255']);
state.update(snapshot(initial, removed, 'test.qxw','2')); state.note(newNote,0);
assert.deepEqual(output, ['9999|255','9999|0']);
const onOnly = snapshot(parseWorkspace(addButton(xml,'9999','Toggle','Toggle')), extended, 'test.qxw','3');
state.update(onOnly); state.note(newNote,127); state.note(newNote,0);
assert.deepEqual(output.slice(-1), ['9999|255']); // QLC Toggle ignores Note Off.
state.update(addedSnapshot); state.note(newNote,127); state.panic(); assert.equal(output.slice(-1)[0], '9999|0');
const packets=[], reports=[];
const router = new MidiRouter(p => packets.push(p), (...args) => reports.push(args));
router.update(addedSnapshot.controls);
for (const b of [144,newNote,100,248,newNote,110,128,newNote,0]) router.byte(b);
assert.deepEqual(packets, [[144,newNote,100],[248],[144,newNote,110],[128,newNote,0]]);
router.panic(); assert.deepEqual(reports.slice(-1)[0], [newNote,1,newNote,0]);

const exported = exportMidi(addedXml, extended);
const midiControls = parseWorkspace(exported);
for (const c of midiControls.filter(c => c.type !== 'Page')) assert.equal(c.preferred, extended.bindings.find(b => b.widgetId === c.widgetId).liveNote);
const originalDoc = new DOMParser().parseFromString(addedXml,'text/xml');
const exportDoc = new DOMParser().parseFromString(exported,'text/xml');
const serialize = e => new XMLSerializer().serializeToString(e);
assert.equal(serialize(originalDoc.getElementsByTagNameNS(NS,'Engine')[0]), serialize(exportDoc.getElementsByTagNameNS(NS,'Engine')[0]));
assert.equal(serialize(originalDoc.getElementsByTagNameNS(NS,'Output')[0]), serialize(exportDoc.getElementsByTagNameNS(NS,'Output')[0]));

async function until(predicate, ms = 4000) {
    const end = Date.now()+ms;
    while (!predicate()) { if (Date.now()>end) throw new Error('Timed out'); await new Promise(r=>setTimeout(r,20)); }
}
async function main() {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(),'qlc-auto-test-'));
    const source = path.join(folder,'workspace.qxw'); fs.writeFileSync(source,xml);
    testWorkerPaths(folder, source);
    const updates=[]; const watcher=new WorkspaceWatcher(s=>updates.push(s),30); watcher.start(source);
    fs.writeFileSync(source,addedXml); await until(()=>updates.some(s=>s.registered===initial.length+1));
    assert.equal(updates[updates.length-1].controls[newNote].name,'New 日本語 & blue');
    const copy = createMidiCopy(source);
    assert.equal(fs.readFileSync(source,'utf8'),addedXml);
    assert.deepEqual(JSON.parse(fs.readFileSync(copy+'.live-map.json','utf8')), extended);
    fs.writeFileSync(source,'<Workspace'); await until(()=>updates.some(s=>s.error));
    const renamedDoc = new DOMParser().parseFromString(addedXml, 'text/xml');
    const renamedButton = Array.from(renamedDoc.getElementsByTagNameNS(NS, 'Button'))
        .find(b => b.getAttribute('ID') === '9999');
    renamedButton.setAttribute('Caption', 'Renamed 日本語 & blue');
    fs.writeFileSync(source, new XMLSerializer().serializeToString(renamedDoc));
    await until(()=>updates.some(s=>s.controls && s.controls[newNote].name.startsWith('Renamed')));
    watcher.stop();
    const reloaded=[]; const reload=new WorkspaceWatcher(s=>reloaded.push(s)); reload.start(source); reload.stop();
    assert.equal(reloaded[0].controls[newNote].widgetId,'9999');
    const gridSource = path.join(folder, 'unfinished-grid.qxw');
    fs.writeFileSync(gridSource, gridXml);
    const gridUpdates = [], gridWatcher = new WorkspaceWatcher(s => gridUpdates.push(s), 30);
    gridWatcher.start(gridSource);
    assert.equal(gridUpdates[0].reserved, extended.bindings.length);
    assert(!gridUpdates[0].error);
    const emptyButton = Array.from(gridDoc.getElementsByTagNameNS(NS, 'Button')).find(b => b.getAttribute('ID') === '20000');
    const emptyFunction = emptyButton.getElementsByTagNameNS(NS, 'Function')[0];
    emptyFunction.setAttribute('ID', '9999');
    fs.writeFileSync(gridSource, new XMLSerializer().serializeToString(gridDoc));
    await until(() => gridUpdates.some(s => s.controls && s.controls.some(c => c.widgetId === '20000' && c.valid)));
    const gridNote = gridUpdates[gridUpdates.length - 1].controls.find(c => c.widgetId === '20000').liveNote;
    emptyFunction.setAttribute('ID', '4294967295');
    fs.writeFileSync(gridSource, new XMLSerializer().serializeToString(gridDoc));
    await until(() => gridUpdates.some(s => s.controls && s.controls[gridNote].widgetId === '20000' && !s.controls[gridNote].valid));
    gridWatcher.stop();
    const savedGridRegistry = JSON.parse(fs.readFileSync(gridSource + '.live-map.json', 'utf8'));
    assert.equal(savedGridRegistry.bindings.length, extended.bindings.length + 1);
    assert.equal(savedGridRegistry.bindings.find(b => b.widgetId === '20000').liveNote, gridNote);
    const widgets=controls.filter(c=>c.type!=='Page').map(c=>({id:Number(c.widgetId),type:c.type==='Button'?'ボタン':'フェダー',
        typeId:c.type==='Button'?1:2,actionType:{Toggle:0,Flash:1,Blackout:2,StopAll:3}[c.action],
        functionId:Number(c.functionId),caption:c.name,sliderMode:c.type==='Slider'?'Adjust':undefined}));
    const page=controls.find(c=>c.type==='Page');
    const makeJson=()=>({pages:[{index:0,caption:page.pageCaption,children:widgets}]});
    let json=makeJson();
    assert(matchingProject(addedSnapshot,json));
    assert(!matchingProject(addedSnapshot,{pages:[]}));
    const received=[];
    const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(json));});
    const wss=new WebSocketServer({server,path:'/qlcplusWS'});
    wss.on('connection',ws=>ws.on('message',m=>received.push(m.toString())));
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const bridge=new WebBridge('http://127.0.0.1:'+server.address().port,()=>{}); bridge.update(addedSnapshot); bridge.enable(true);
    await until(()=>bridge.ready);
    bridge.note(newNote,127); bridge.note(newNote,0); await until(()=>received.length===2);
    assert.deepEqual(received,['9999|255','9999|0']);
    bridge.note(newNote,100); await until(()=>received.length===3); bridge.panic(); await until(()=>received.length===4);
    assert.equal(received[3],'9999|0');
    bridge.ready=false; bridge.note(newNote,127); bridge.note(newNote,0);
    assert.equal(received.length,4);
    // A real socket disconnect during a held note: release on reconnect, no late Note On.
    bridge.note(newNote,127); bridge.note(newNote,0); // gated while not ready
    await bridge.check(); await until(()=>bridge.ready);
    bridge.note(newNote,127); await until(()=>received.length===5);
    for (const ws of wss.clients) ws.terminate();
    await until(()=>bridge.socket===null);
    bridge.note(newNote,0); bridge.note(newNote,127); bridge.note(newNote,0);
    await bridge.check(); await until(()=>bridge.ready && received.length===6);
    assert.equal(received[5], '9999|0');
    json = {pages:[]}; await bridge.check(); assert.equal(bridge.ready, false);
    bridge.note(newNote,127); bridge.note(newNote,0); assert.equal(received.length,6);
    json = makeJson();
    await bridge.check(); await until(()=>bridge.ready);
    const pageNote = addedSnapshot.controls.find(c=>c.type==='Page').liveNote;
    bridge.note(pageNote,127); bridge.note(pageNote,0); bridge.panic();
    await until(()=>received.length===7);
    assert.equal(received[6],'VC_PAGE|0');
    bridge.stop(); for (const ws of wss.clients) ws.terminate();
    await new Promise(r=>wss.close(r)); await new Promise(r=>server.close(r));
    assert.equal(fs.readFileSync(production,'utf8'),xml);
    console.log('PASS: existing59 pitches, new buttons,200 unconfigured buttons, configure/clear saves, Unicode labels, tombstones, persisted map, held/repeated notes, Toggle/Flash, MIDI export, invalid saves and real local WebSocket roundtrip.');
}
main().catch(e=>{console.error(e);process.exit(1);});
