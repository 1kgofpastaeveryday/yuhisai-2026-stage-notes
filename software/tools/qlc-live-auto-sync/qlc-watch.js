'use strict';
const max = require('max-api');
const fs = require('fs');
const config = require('./config.json');
const {WorkspaceWatcher, workspacePath} = require('./source');
const {WebBridge} = require('./web-bridge');
const {createMidiCopy} = require('./export-midi');
const bridge = new WebBridge(config.endpoint, status => max.outlet('connection', status));
const watcher = new WorkspaceWatcher(snapshot => { bridge.update(snapshot); max.outlet(snapshot); });
max.addHandler('source_context', (...parts) => {
    const request = parts.join(' '), context = JSON.parse(request);
    try {
        const target = workspacePath(context.source, context.setPath);
        // Never migrate a missing absolute path or search for another copy.
        if (target.stored !== context.source && fs.existsSync(target.resolved))
            max.outlet('source_stored', JSON.stringify({request, stored: target.stored}));
        watcher.start(target.resolved);
    } catch (e) {
        watcher.stop(); watcher.source = null;
        const error = {source: context.source, error: e.message};
        bridge.update(error); max.outlet(error);
    }
});
max.addHandler('refresh', () => watcher.refresh(true));
max.addHandler('mode', mode => bridge.enable(Number(mode) === 1));
max.addHandler('cue', (pitch, velocity) => bridge.note(Number(pitch), Number(velocity)));
max.addHandler('level', (pitch, value) => bridge.level(Number(pitch), Number(value)));
max.addHandler('scene_color', (cc, value) => bridge.sceneColorCC(Number(cc), Number(value)));
max.addHandler('brightness', (enabled, percent) => bridge.brightnessConfig(Number(enabled), Number(percent)));
max.addHandler('rgb_brightness', (enabled, percent) => bridge.rgbBrightnessConfig(Number(enabled), Number(percent)));
max.addHandler('scene_fade', (enabled, fadeIn, fadeOut) => bridge.sceneFadeConfig(Number(enabled), Number(fadeIn), Number(fadeOut)));
max.addHandler('panic', () => bridge.panic());
max.addHandler('export_midi', () => {
    try {
        if (!watcher.source) throw new Error('Choose a saved QLC+ workspace first');
        const target = createMidiCopy(watcher.source);
        max.outlet('connection', 'MIDI copy saved: ' + target.split(/[\\\/]/).pop());
    } catch (e) { max.outlet('connection', 'MIDI copy error: ' + e.message); }
});
max.addHandler('stop', () => { bridge.stop(); watcher.stop(); });
max.outlet('watcher_ready');
process.on('exit', () => { bridge.stop(); watcher.stop(); });
