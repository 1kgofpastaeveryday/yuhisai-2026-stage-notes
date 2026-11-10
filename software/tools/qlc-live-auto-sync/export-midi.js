'use strict';
const fs = require('fs');
const path = require('path');
const {DOMParser, XMLSerializer} = require('@xmldom/xmldom');
const {parseWorkspace, validateRegistry, allocate, atomicSave} = require('./source');
const NS = 'http://www.qlcplus.org/Workspace';
function exportMidi(xml, registry) {
    const controls = parseWorkspace(xml);
    validateRegistry(registry);
    const notes = new Map(registry.bindings.filter(b => !b.retired).map(b => [b.widgetId, {note:b.liveNote,channel:b.channel || 0}]));
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const vc = doc.getElementsByTagNameNS(NS, 'VirtualConsole')[0];
    if (registry.version === 2) vc.setAttribute('MIDIPageChannels', 'True');
    const widgets = new Map(Array.from(vc.getElementsByTagNameNS(NS, '*'))
        .filter(e => e.localName === 'Button' || e.localName === 'Slider').map(e => [e.getAttribute('ID'), e]));
    for (const c of controls) {
        if (c.type === 'Page') continue; // Top-level tab selection is Web-only in QLC5.3.
        if (!notes.has(c.widgetId)) {
            if (!c.valid) continue;
            throw new Error('Missing registered pitch for widget ' + c.widgetId);
        }
        const widget = widgets.get(c.widgetId);
        const inputs = Array.from(widget.childNodes).filter(e => e.nodeType === 1 && e.localName === 'Input' &&
            e.namespaceURI === NS && (e.getAttribute('ID') === '0' || !e.hasAttribute('ID')));
        // This exported copy uses one ch1 binding per control; keyboard bindings remain.
        for (const input of inputs) {
            if (input.hasAttribute('Key')) { input.removeAttribute('Universe'); input.removeAttribute('Channel'); }
            else widget.removeChild(input);
        }
        const input = doc.createElementNS(NS, 'Input');
        for (const [k,v] of Object.entries({ID:'0', Universe:'0', Channel:String(4096 * notes.get(c.widgetId).channel + 128 + notes.get(c.widgetId).note)})) input.setAttribute(k,v);
        widget.appendChild(input);
    }
    const io = doc.getElementsByTagNameNS(NS, 'InputOutputMap')[0];
    const universe = Array.from(io.getElementsByTagNameNS(NS, 'Universe')).find(e => e.getAttribute('ID') === '0');
    if (!universe) throw new Error('Workspace needs Universe0 for the exported MIDI input');
    const old = Array.from(universe.childNodes).find(e => e.nodeType === 1 && e.localName === 'Input');
    const input = old || doc.createElementNS(NS, 'Input');
    // Keep the user's already selected virtual MIDI input in exported copies.
    if (!old || old.getAttribute('Plugin') !== 'MIDI')
        for (const [k,v] of Object.entries({Plugin:'MIDI', Name:'None', UID:'None', Line:'1'})) input.setAttribute(k,v);
    if (!old) universe.appendChild(input);
    return new XMLSerializer().serializeToString(doc);
}
function createMidiCopy(source) {
    source = path.resolve(source);
    const xml = fs.readFileSync(source, 'utf8');
    const map = source + '.live-map.json';
    const registry = allocate(parseWorkspace(xml), fs.existsSync(map) ? validateRegistry(JSON.parse(fs.readFileSync(map,'utf8'))) : undefined);
    atomicSave(map, JSON.stringify(registry,null,2)+'\n');
    const target = source.replace(/\.qxw$/i, '') + '-midi.qxw';
    if (target === source) throw new Error('Source must have .qxw extension');
    atomicSave(target, exportMidi(xml, registry));
    atomicSave(target + '.live-map.json', JSON.stringify(registry,null,2)+'\n');
    return target;
}
if (require.main === module) {
    const target = createMidiCopy(process.argv[2] || require('./config.json').defaultSource);
    console.log('Wrote '+ target + '; original unchanged. Select the virtual MIDI input in QLC+ Universe0.');
}
module.exports = {exportMidi, createMidiCopy};
