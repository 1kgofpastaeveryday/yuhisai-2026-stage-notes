'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {DOMParser} = require('@xmldom/xmldom');
const NS = 'http://www.qlcplus.org/Workspace';
const CAPACITY = 128;
const caption = name => name.replace(/\r?\n/g, ' / ');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function child(e, tag) {
    return Array.from(e.childNodes).find(n => n.nodeType === 1 && n.localName === tag && n.namespaceURI === NS);
}
function parseWorkspace(xml) {
    const errors = [];
    const doc = new DOMParser({onError: (level, message) => errors.push(message)}).parseFromString(xml, 'text/xml');
    if (errors.length) throw new Error('Invalid workspace XML: ' + errors[0]);
    if (!doc.documentElement || doc.documentElement.localName !== 'Workspace' || doc.documentElement.namespaceURI !== NS)
        throw new Error('Not a QLC+ workspace');
    const vc = doc.getElementsByTagNameNS(NS, 'VirtualConsole')[0];
    if (!vc) throw new Error('Workspace has no Virtual Console');
    const functions = new Map(Array.from(doc.getElementsByTagNameNS(NS, 'Function'))
        .filter(e => e.hasAttribute('Type')).map(e => [e.getAttribute('ID'), caption(e.getAttribute('Name'))]));
    const controls = [];
    const ids = new Set();
    const pages = Array.from(vc.childNodes).filter(e => e.nodeType === 1 && e.localName === 'Frame' && e.namespaceURI === NS);
    for (const e of Array.from(vc.getElementsByTagNameNS(NS, '*'))) {
        if (e.localName !== 'Button' && e.localName !== 'Slider') continue;
        const id = e.getAttribute('ID');
        if (!/^\d+$/.test(id) || ids.has(id)) throw new Error('Invalid or duplicate control ID');
        ids.add(id);
        let ancestor = e.parentNode;
        while (ancestor && ancestor.parentNode !== vc) ancestor = ancestor.parentNode;
        const pageIndex = pages.indexOf(ancestor);
        let layoutX = 0, layoutY = 0;
        for (let item = e; item && item !== ancestor && item !== vc; item = item.parentNode) {
            const window = child(item, 'WindowState');
            if (window) { layoutX += Number(window.getAttribute('X')); layoutY += Number(window.getAttribute('Y')); }
        }
        const input = child(e, 'Input');
        const raw = input && Number(input.getAttribute('Channel'));
        const preferred = input && Number(input.getAttribute('Universe')) === 0 && Number.isInteger(raw) &&
            Math.floor(raw / 4096) === 0 && raw % 4096 >= 128 && raw % 4096 < 256 ? raw % 4096 - 128 : null;
        if (e.localName === 'Button') {
            const action = child(e, 'Action');
            const fn = child(e, 'Function');
            const actionName = action ? action.textContent.trim() : 'Toggle';
            const functionId = fn ? fn.getAttribute('ID') : null;
            const valid = ['Blackout', 'StopAll'].includes(actionName) ||
                ['Toggle', 'Flash'].includes(actionName) && functions.has(functionId);
            controls.push({widgetId: id, name: caption(e.getAttribute('Caption')), type: 'Button',
                action: actionName, functionId, functionName: functions.get(functionId), valid, preferred, pageIndex, layoutX, layoutY});
        } else {
            const mode = child(e, 'SliderMode');
            const adjust = child(e, 'Adjust');
            // Other slider types require different messages and are not registered.
            if (!mode || mode.textContent.trim() !== 'Adjust' || !adjust || adjust.getAttribute('Attribute') !== '0') continue;
            const functionId = adjust.getAttribute('Function');
            controls.push({widgetId: id, name: caption(e.getAttribute('Caption')), type: 'Slider',
                action: 'Intensity', functionId, functionName: functions.get(functionId), valid: functions.has(functionId), preferred, pageIndex, layoutX, layoutY});
        }
    }
    // QLC pages have no durable widget ID. Bind absolute tab positions explicitly.
    pages.forEach((e, pageIndex) => controls.push({widgetId: 'page:' + pageIndex,
        name: '[Page ' + (pageIndex + 1) + '] ' + caption(e.getAttribute('Caption')),
        pageCaption: caption(e.getAttribute('Caption')), pageIndex, type: 'Page',
        action: 'SelectPage', functionId: null, valid: true, preferred: null}));
    return controls;
}
function validateRegistry(registry) {
    if (registry && registry.version === 2) return require('./page-registry').validate(registry);
    if (!registry || registry.version !== 1 || !Array.isArray(registry.bindings)) throw new Error('Invalid Live note map');
    const ids = new Set(), notes = new Set(), ccs = new Set();
    for (const b of registry.bindings) {
        if (!/^(?:\d+|page:\d+|scene-color)$/.test(b.widgetId) || !Number.isInteger(b.liveNote) || b.liveNote < 0 || b.liveNote >= CAPACITY ||
            (!b.retired && ids.has(b.widgetId)) || notes.has(b.liveNote)) throw new Error('Invalid or duplicate Live note binding');
        if (!b.retired) ids.add(b.widgetId);
        notes.add(b.liveNote);
        if (b.ccNumber !== undefined) {
            if (!Number.isInteger(b.ccNumber) || b.ccNumber < 0 || b.ccNumber >= 120 || ccs.has(b.ccNumber))
                throw new Error('Invalid or duplicate slider CC binding');
            ccs.add(b.ccNumber);
            if (b.ccNumber >= 20 && b.ccNumber <= 23) throw new Error('CC20-23 are reserved for global Scene color');
        }
    }
    return registry;
}
function allocate(controls, registry = {version: 1, bindings: []}) {
    if (registry.version === 2) return require('./page-registry').allocate(controls, registry);
    validateRegistry(registry);
    const next = JSON.parse(JSON.stringify(registry));
    const currentIds = new Set(['scene-color', ...controls.map(c => c.widgetId)]);
    for (const b of next.bindings) if (!currentIds.has(b.widgetId) && !b.widgetId.startsWith('page:')) b.retired = true;
    const ids = new Set(next.bindings.filter(b => !b.retired).map(b => b.widgetId));
    const used = new Set(next.bindings.map(b => b.liveNote));
    // Reserve a pitch only when a new control can actually run. Empty VC grids
    // must not exhaust the registry before their buttons receive Functions.
    // Existing bindings remain reserved even if a control becomes unconfigured.
    const pending = controls.filter(c => c.valid && !ids.has(c.widgetId));
    for (const c of pending) {
        if (c.preferred !== null && !used.has(c.preferred)) {
            next.bindings.push({widgetId: c.widgetId, liveNote: c.preferred});
            used.add(c.preferred); ids.add(c.widgetId);
        }
    }
    for (const c of pending) {
        if (ids.has(c.widgetId)) continue;
        const hint = Math.max(35, ...used) + 1;
        const order = Array.from({length: CAPACITY}, (_, i) => (hint + i) % CAPACITY);
        const liveNote = order.find(n => !used.has(n));
        if (liveNote === undefined) throw new Error('All 128 Live pitches are reserved in this workspace');
        next.bindings.push({widgetId: c.widgetId, liveNote});
        used.add(liveNote); ids.add(c.widgetId);
    }
    const usedCCs = new Set([20,21,22,23, ...next.bindings.filter(b => b.ccNumber !== undefined).map(b => b.ccNumber)]);
    for (const c of controls.filter(c => c.valid && c.type === 'Slider')) {
        const b = next.bindings.find(b => !b.retired && b.widgetId === c.widgetId);
        if (b.ccNumber !== undefined) continue;
        const preferred = c.preferred !== null && c.preferred < 120 ? c.preferred : b.liveNote;
        const order = [preferred, ...Array.from({length:120}, (_,i)=>(i+20)%120)];
        const cc = order.find(n => n >= 0 && n < 120 && !usedCCs.has(n));
        if (cc === undefined) throw new Error('All 120 slider CC numbers are reserved in this workspace');
        b.ccNumber = cc; usedCCs.add(cc);
    }
    if (!next.bindings.some(b => b.widgetId === 'scene-color')) {
        const liveNote = Array.from({length: CAPACITY}, (_, i) => i).find(n => !used.has(n));
        if (liveNote === undefined) throw new Error('No free pitch for Color Override');
        next.bindings.push({widgetId: 'scene-color', liveNote});
    }
    // Deleted cues retain their pitch reservation. Page pitches address absolute tab slots,
    // so removing/readding the same slot preserves its note, just like renaming a tab.
    return next;
}
function snapshot(controls, registry, source, revision) {
    if (registry.version === 2) return require('./page-registry').snapshot(controls, registry, source, revision);
    const byId = new Map(controls.map(c => [c.widgetId, c]));
    byId.set('scene-color', {widgetId: 'scene-color', name: 'Color Override', type: 'SceneColor', valid: true});
    const slots = Array.from({length: CAPACITY}, (_, liveNote) => ({liveNote, chainIndex: liveNote,
        channel: 0, note: liveNote, widgetId: null, name: '[empty N' + liveNote + ']', valid: false}));
    for (const binding of registry.bindings) {
        const control = binding.retired ? null : byId.get(binding.widgetId);
        slots[binding.liveNote] = {...slots[binding.liveNote], ...binding, ...(control || {}),
            valid: !!control && control.valid, removed: !control,
            name: control ? control.name : binding.widgetId.startsWith('page:') ?
                '[Page ' + (Number(binding.widgetId.slice(5)) + 1) + ': no page]' : '[removed ID' + binding.widgetId + ']'};
    }
    return {source, revision, controls: slots, registered: controls.length,
        playable: controls.filter(c => c.valid).length, reserved: registry.bindings.length};
}
function atomicSave(file, text) {
    const temp = file + '.tmp-' + process.pid;
    try { fs.writeFileSync(temp, text, {encoding: 'utf8', flag: 'wx'}); fs.renameSync(temp, file); }
    finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
// Explicit OS path rules also let the regression suite exercise Mac paths on Windows.
function workspacePath(source, setPath, platform = process.platform) {
    const originalSource = source;
    source = source.replace(/\\/g, '/');
    setPath = setPath.replace(/\\/g, '/');
    const windows = platform === 'win32', paths = windows ? path.win32 : path.posix;
    const nativeAbsolute = value => windows ? /^(?:[a-z]:\/|\/\/[^/]+\/[^/]+)/i.test(value) :
        value.startsWith('/') && !value.startsWith('//');
    const absolute = /^(?:\/|[^/]+:)/.test(source);
    if (!source) throw new Error('Choose a saved QLC+ workspace first');
    if (absolute && !nativeAbsolute(source)) throw new Error('Choose .qxw: unavailable path ' + source);
    if (!absolute && !nativeAbsolute(setPath)) throw new Error('Choose .qxw: save the Live Set to resolve ' + source);
    const resolved = paths.normalize(absolute ? source : paths.join(paths.dirname(setPath), source)).replace(/\\/g, '/');
    let stored = originalSource;
    if (nativeAbsolute(setPath) && (!windows ||
        paths.parse(setPath).root.toLowerCase() === paths.parse(resolved).root.toLowerCase())) {
        const relative = paths.relative(paths.dirname(setPath), resolved).replace(/\\/g, '/');
        // Keep only relative results within the same filesystem root.
        if (!paths.isAbsolute(relative)) stored = relative;
    }
    return {resolved, stored};
}
class WorkspaceWatcher {
    constructor(emit, interval = 500) {
        this.emit = emit; this.interval = interval; this.timer = null;
    }
    start(source) {
        this.stop(); this.source = path.resolve(source); this.revision = null; this.error = null;
        this.refresh(); this.timer = setInterval(() => this.refresh(), this.interval);
    }
    refresh(force = false) {
        if (!this.source) return;
        try {
            const xml = fs.readFileSync(this.source, 'utf8');
            const revision = hash(xml);
            const mapFile = this.source + '.live-map.json';
            const mapText = fs.existsSync(mapFile) ? fs.readFileSync(mapFile, 'utf8') : '';
            const mapRevision = hash(mapText);
            if (!force && revision === this.revision && mapRevision === this.mapRevision && !this.error) return;
            const controls = parseWorkspace(xml);
            const previous = mapText ? validateRegistry(JSON.parse(mapText)) : {version: 1, bindings: []};
            const registry = allocate(controls, previous);
            const changed = JSON.stringify(previous) !== JSON.stringify(registry) || !mapText;
            const savedMap = changed ? JSON.stringify(registry, null, 2) + '\n' : mapText;
            if (changed) atomicSave(mapFile, savedMap);
            this.revision = revision; this.error = null;
            this.mapRevision = hash(savedMap);
            this.emit(snapshot(controls, registry, this.source, revision));
        } catch (e) {
            if (e.message !== this.error) this.emit({source: this.source, error: e.message});
            this.error = e.message;
        }
    }
    stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
}
module.exports = {parseWorkspace, validateRegistry, allocate, snapshot, WorkspaceWatcher, workspacePath, caption, atomicSave};
