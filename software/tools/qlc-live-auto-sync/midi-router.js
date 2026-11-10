/* ES5: shared by Max 8's js object and the offline tests. */
function MidiRouter(emit, report, reportLevel, reportSceneColor) {
    this.emit = emit;
    this.report = report || function () {};
    this.reportLevel = reportLevel || function () {};
    this.reportSceneColor = reportSceneColor || function () {};
    this.levels = {};
    this.colorNotes = {};
    this.map = {};
    this.enabled = false;
    this.active = {};
    this.status = 0;
    this.data = [];
    this.sysex = false;
}
MidiRouter.prototype.update = function (controls) {
    var next = {}, ccs = {};
    for (var i = 0; i < controls.length; i++) {
        var c = controls[i];
        if (c.valid) next[c.liveNote] = {channel: c.channel, note: c.note, type: c.type};
        if (c.valid && c.type === 'Slider' && typeof c.ccNumber === 'number')
            ccs[c.ccNumber] = {channel: c.channel, note: c.note, type: c.type};
    }
    this.map = next;
    this.ccMap = ccs;
    this.enabled = true;
};
MidiRouter.prototype.panic = function () {
    // A later byte must not complete a Note On that began before transport stop.
    this.status = 0; this.data = []; this.sysex = false;
    for (var key in this.active) if (this.active.hasOwnProperty(key)) {
        var queue = this.active[key];
        for (var i = 0; i < queue.length; i++) if (queue[i]) {
            if (queue[i].type === 'SceneColor') continue;
            if (queue[i].type !== 'Page') this.emit([128 + queue[i].channel, queue[i].note, 0]);
            this.report(Number(key.split(':')[1]), queue[i].channel + 1, queue[i].note, 0);
        }
    }
    this.active = {};
    if (Object.keys(this.colorNotes).length) this.reportSceneColor(23, 0);
    this.colorNotes = {};
    for (var cc in this.levels) if (this.levels.hasOwnProperty(cc)) {
        var target = this.levels[cc];
        this.emit([128 + target.channel, target.note, 0]);
        this.reportLevel(Number(cc.split(':')[1]), target.channel + 1, target.note, 0);
    }
    this.levels = {};
};
MidiRouter.prototype.packet = function (bytes) {
    var status = bytes[0], kind = status & 240;
    if (kind === 176 && bytes[1] >= 20 && bytes[1] <= 23) {
        if (this.enabled) this.reportSceneColor(bytes[1], bytes[2]);
        return;
    }
    if (kind === 176 && bytes[1] < 120) {
        var ccKey = (status & 15) + ':' + bytes[1];
        var levelTarget = this.levels[ccKey];
        var mapped = this.enabled && this.ccMap && this.ccMap[bytes[1]];
        if (levelTarget || (mapped && mapped.type === 'Slider')) {
            if (bytes[2] > 0 && !this.enabled) return;
            levelTarget = levelTarget || mapped;
            if (bytes[2] > 0) this.levels[ccKey] = levelTarget;
            else delete this.levels[ccKey];
            // QLC MIDI input expects note/velocity; Web uses a persistent level.
            this.emit([(bytes[2] ? 144 : 128) + levelTarget.channel, levelTarget.note, bytes[2]]);
            this.reportLevel(bytes[1], levelTarget.channel + 1, levelTarget.note, bytes[2]);
            return;
        }
    }
    if (status < 240 && (kind === 128 || kind === 144)) {
        var pitch = bytes[1], velocity = bytes[2], key = (status & 15) + ':' + pitch;
        var on = kind === 144 && velocity !== 0;
        var queue = this.active[key] || [];
        var target;
        if (on) {
            target = this.enabled ? this.map[pitch] : null;
            queue.push(target || null);
            this.active[key] = queue;
        } else {
            // A note released after a saved remap must stop its original target.
            if (!queue.length) return;
            target = queue.shift();
            if (!queue.length) delete this.active[key];
        }
        if (target) {
            if (target.type === 'SceneColor') {
                if (on) this.colorNotes[key] = (this.colorNotes[key] || 0) + 1;
                else if (--this.colorNotes[key] <= 0) delete this.colorNotes[key];
                this.reportSceneColor(23, Object.keys(this.colorNotes).length ? 127 : 0);
                return;
            }
            // Top-level page selection uses QLC's Web command, not a cue MIDI input.
            // In particular, Note Off/panic must never switch back to an older page.
            if (target.type !== 'Page') this.emit([(on ? 144 : 128) + target.channel, target.note, on ? velocity : 0]);
            this.report(pitch, target.channel + 1, target.note, on ? velocity : 0);
        }
    } else {
        if (kind === 176 && (bytes[1] === 120 || bytes[1] === 123)) this.panic();
        this.emit(bytes);
    }
};
MidiRouter.prototype.byte = function (value) {
    var b = value & 255;
    if (b >= 248) { this.emit([b]); return; }
    if (this.sysex) {
        if (b < 128 || b === 247) { this.emit([b]); if (b === 247) this.sysex = false; return; }
        this.sysex = false;
    }
    if (b >= 128) {
        this.data = [];
        this.status = b;
        if (b === 240) { this.sysex = true; this.status = 0; this.emit([b]); }
        else if (b === 246 || b === 247 || b === 244 || b === 245) { this.emit([b]); this.status = 0; }
        return;
    }
    if (!this.status) return;
    this.data.push(b);
    var kind = this.status & 240;
    var count = (this.status === 241 || this.status === 243 || kind === 192 || kind === 208) ? 1 : 2;
    if (this.data.length === count) {
        this.packet([this.status].concat(this.data));
        this.data = [];
        if (this.status >= 240) this.status = 0;
    }
};
if (typeof module !== 'undefined') module.exports = MidiRouter;
