'use strict';
const http = require('http');
const WebSocket = require('ws');
const {caption} = require('./source');
const SceneColorState = require('./scene-color');
const SceneFadeState = require('./scene-fade');
const BrightnessState = require('./scene-brightness');
function flatten(value, out = new Map()) {
    if (Array.isArray(value)) for (const item of value) flatten(item, out);
    else if (value && typeof value === 'object') {
        if (value.id !== undefined && [1,2].includes(value.typeId)) out.set(String(value.id), value);
        for (const item of Object.values(value)) if (item && typeof item === 'object') flatten(item, out);
    }
    return out;
}
function matchingProject(snapshot, json) {
    const widgets = flatten(json);
    return snapshot && !snapshot.error && snapshot.controls.filter(c => c.widgetId && !c.removed).every(c => {
        if (c.type === 'SceneColor') return true;
        if (c.type === 'Page') {
            const page = Array.isArray(json.pages) && json.pages.find(p => p.index === c.pageIndex);
            return !!page && typeof page.caption === 'string' && caption(page.caption) === c.pageCaption;
        }
        const w = widgets.get(c.widgetId);
        // QLC's type string is translated by the UI locale; typeId is stable.
        if (!w || w.typeId !== (c.type === 'Button' ? 1 : 2) || typeof w.caption !== 'string' || caption(w.caption) !== c.name) return false;
        if (c.type === 'Slider' && w.sliderMode !== 'Adjust') return false;
        if (c.type === 'Button') {
            if (w.actionType !== {Toggle:0, Flash:1, Blackout:2, StopAll:3}[c.action]) return false;
            // XML stores the unsigned invalid ID (4294967295); VC JSON emits -1.
            const actual = Number(w.functionId), expected = Number(c.functionId);
            if (['Toggle','Flash'].includes(c.action) && (!Number.isInteger(actual) || !Number.isInteger(expected) ||
                (actual >>> 0) !== (expected >>> 0))) return false;
        }
        return true;
    });
}
function getJson(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, res => {
            if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; if (body.length > 8 * 1024 * 1024) req.destroy(new Error('VC JSON too large')); });
            res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
            res.on('error', reject);
        });
        req.setTimeout(1500, () => req.destroy(new Error('QLC+ request timeout')));
        req.on('error', reject);
    });
}
class CueState {
    constructor(send) { this.send = send; this.held = new Map(); this.levels = new Map(); this.snapshot = null; }
    update(snapshot) { this.snapshot = snapshot; }
    note(pitch, velocity, allowOn = true) {
        const queue = this.held.get(pitch) || [];
        if (velocity > 0) {
            const c = this.snapshot && !this.snapshot.error && this.snapshot.controls[pitch];
            const target = allowOn && c && c.valid ? {...c} : null;
            queue.push(target); this.held.set(pitch, queue);
            if (!target) return;
            if (target.type === 'Page') this.send('VC_PAGE|' + target.pageIndex);
            else if (target.type === 'Slider') this.send(target.widgetId + '|' + Math.round(velocity * 255 / 127));
            else if (target.action !== 'Flash' || queue.filter(q => q && q.widgetId === target.widgetId).length === 1)
                this.send(target.widgetId + '|255');
        } else {
            if (!queue.length) return;
            const target = queue.shift();
            if (!queue.length) this.held.delete(pitch);
            if (!target) return;
            // The target is captured at Note On, even if the saved source changes later.
            const stillHeld = queue.some(q => q && q.widgetId === target.widgetId);
            if (!stillHeld && (target.type === 'Slider' || target.action === 'Flash')) this.send(target.widgetId + '|0');
        }
    }
    level(pitch, value, allowOn = true) {
        if (!Number.isInteger(value) || value < 0 || value > 127) return;
        let target = this.levels.get(pitch);
        if (value > 0) {
            if (!allowOn) return;
            const c = this.snapshot && !this.snapshot.error && this.snapshot.controls[pitch];
            if (!target && c && c.valid && c.type === 'Slider') target = {...c};
            if (!target) return;
            this.levels.set(pitch, target);
        } else {
            if (!target) return;
            this.levels.delete(pitch);
        }
        this.send(target.widgetId + '|' + Math.round(value * 255 / 127));
    }
    panic() {
        const release = new Set();
        for (const c of this.levels.values()) release.add(c.widgetId);
        for (const queue of this.held.values()) for (const c of queue)
            if (c && (c.type === 'Slider' || c.action === 'Flash')) release.add(c.widgetId);
        for (const id of release) this.send(id + '|0');
        this.held.clear();
        this.levels.clear();
    }
}
class WebBridge {
    constructor(endpoint, report) {
        const url = new URL(endpoint);
        if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
            throw new Error('This build connects only to local QLC+');
        this.endpoint = endpoint.replace(/\/$/, ''); this.report = report;
        this.socket = null; this.enabled = false; this.ready = false; this.snapshot = null;
        this.state = new CueState(message => this.send(message));
        this.sceneColor = new SceneColorState(message => this.send(message));
        this.sceneFade = new SceneFadeState(message => this.send(message));
        this.sceneBrightness = new BrightnessState(message => this.send(message));
        this.rgbBrightness = new BrightnessState(message => this.send(message), 'setRGBBrightnessOverride');
        this.deferredBrightnessReset = false;
        this.deferredRGBBrightnessReset = false;
        this.deferredFadeReset = false;
        this.deferredSceneColorReset = false;
        this.deferredReleases = new Set(); this.lastStatus = null;
        this.generation = 0; this.verifiedGeneration = -1;
        this.checking = false; this.checkAgain = false;
    }
    status(value) { if (value !== this.lastStatus) { this.lastStatus = value; this.report(value); } }
    update(snapshot) {
        if (this.snapshot && this.snapshot.source !== snapshot.source) {
            this.panic(); this.deferredReleases.clear();
        }
        this.snapshot = snapshot; this.state.update(snapshot); this.ready = false;
        this.sceneFade.invalidate(); this.sceneBrightness.invalidate();
        this.rgbBrightness.invalidate();
        this.generation++; this.verifiedGeneration = -1;
        if (this.enabled) this.check();
    }
    enable(enabled) {
        if (!!enabled === this.enabled) return;
        this.generation++; this.verifiedGeneration = -1;
        if (!enabled) {
            this.panic(); this.enabled = false; this.ready = false;
            if (this.timer) clearInterval(this.timer);
            this.timer = null;
            if (this.socket) this.socket.close();
            this.socket = null; this.status('Web output off'); return;
        }
        this.enabled = true;
        this.timer = setInterval(() => this.check(), 1000);
        this.check();
    }
    async check() {
        if (!this.enabled) return;
        if (this.checking) { this.checkAgain = true; return; }
        this.checking = true;
        const generation = this.generation, snapshot = this.snapshot;
        try {
            const json = await getJson(this.endpoint + '/vc.json');
            if (!this.enabled || generation !== this.generation) return;
            if (!matchingProject(snapshot, json)) {
                this.verifiedGeneration = -1;
                this.ready = false; this.status('QLC+ project differs from saved source'); return;
            }
            this.verifiedGeneration = generation;
            if (!this.socket) {
                const socket = new WebSocket(this.endpoint.replace(/^http:/, 'ws:') + '/qlcplusWS');
                this.socket = socket;
                socket.on('open', () => {
                    if (this.socket !== socket || !this.enabled) return;
                    // A save or output-mode change may have invalidated the HTTP check
                    // while this handshake was pending. Only a current match opens output.
                    this.markReady(socket);
                    if (!this.ready) this.check();
                });
                socket.on('error', () => {
                    if (this.socket !== socket) return;
                    this.ready = false; this.verifiedGeneration = -1;
                    this.status('QLC+ WebSocket disconnected');
                });
                socket.on('close', () => {
                    if (this.socket === socket) {
                        this.socket = null; this.ready = false; this.verifiedGeneration = -1;
                        this.sceneFade.invalidate(); this.sceneBrightness.invalidate();
                        this.rgbBrightness.invalidate();
                        this.status('QLC+ disconnected');
                    }
                });
            } else if (this.socket.readyState === WebSocket.OPEN) {
                this.markReady(this.socket);
            }
        } catch (e) {
            if (this.enabled && generation === this.generation) {
                this.ready = false; this.verifiedGeneration = -1;
                this.status('QLC+ offline: ' + e.message);
            }
        } finally {
            this.checking = false;
            const again = this.checkAgain; this.checkAgain = false;
            if (again && this.enabled) this.check();
        }
    }
    markReady(socket) {
        if (!this.enabled || this.socket !== socket || this.verifiedGeneration !== this.generation ||
            socket.readyState !== WebSocket.OPEN) return;
        this.ready = true;
        if (this.deferredBrightnessReset) { socket.send('QLC+API|setBrightnessOverride|0|100'); this.deferredBrightnessReset=false; }
        if (this.deferredRGBBrightnessReset) { socket.send('QLC+API|setRGBBrightnessOverride|0|100'); this.deferredRGBBrightnessReset=false; }
        if (this.deferredFadeReset) {
            socket.send('QLC+API|setFadeOverride|0|0|0');
            this.deferredFadeReset = false;
        }
        if (this.deferredSceneColorReset) {
            socket.send('QLC+API|setSceneColorOverride|0|0|0|255');
            this.deferredSceneColorReset = false;
        }
        for (const id of this.deferredReleases) socket.send(id + '|0');
        this.deferredReleases.clear(); this.status('QLC+ connected / Web API');
    }
    send(message) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) this.socket.send(message);
        else if (/^\d+\|0$/.test(message)) this.deferredReleases.add(message.split('|')[0]);
        else if (/^QLC\+API\|setSceneColorOverride\|0\|/.test(message)) this.deferredSceneColorReset = true;
        else if (/^QLC\+API\|setFadeOverride\|0\|/.test(message)) this.deferredFadeReset = true;
        else if (/^QLC\+API\|setBrightnessOverride\|0\|/.test(message)) this.deferredBrightnessReset = true;
        else if (/^QLC\+API\|setRGBBrightnessOverride\|0\|/.test(message)) this.deferredRGBBrightnessReset = true;
        // Never queue Note On: reconnecting must not start old cues late.
    }
    note(pitch, velocity) {
        const c = this.snapshot && !this.snapshot.error && this.snapshot.controls[pitch];
        if (velocity > 0 && c && c.valid && c.type !== 'Page') { this.sceneFade.apply(this.enabled && this.ready); this.sceneBrightness.apply(this.enabled && this.ready); this.rgbBrightness.apply(this.enabled && this.ready); }
        this.state.note(pitch, velocity, this.enabled && this.ready);
    }
    level(pitch, value) {
        const c = this.snapshot && !this.snapshot.error && this.snapshot.controls[pitch];
        if (value > 0 && c && c.valid && c.type === 'Slider') { this.sceneFade.apply(this.enabled && this.ready); this.sceneBrightness.apply(this.enabled && this.ready); this.rgbBrightness.apply(this.enabled && this.ready); }
        this.state.level(pitch, value, this.enabled && this.ready);
    }
    sceneColorCC(cc, value) { this.sceneColor.cc(cc, value, this.enabled && this.ready); }
    sceneFadeConfig(enabled, fadeIn, fadeOut) { this.sceneFade.configure(enabled, fadeIn, fadeOut, this.enabled && this.ready); }
    brightnessConfig(enabled, percent) { this.sceneBrightness.configure(enabled, percent, this.enabled && this.ready); }
    rgbBrightnessConfig(enabled, percent) { this.rgbBrightness.configure(enabled, percent, this.enabled && this.ready); }
    panic() { this.state.panic(); this.sceneColor.reset(); this.sceneFade.reset(); this.sceneBrightness.reset(); this.rgbBrightness.reset(); }
    stop() { this.enable(false); }
}
module.exports = {WebBridge, CueState, matchingProject, flatten};
