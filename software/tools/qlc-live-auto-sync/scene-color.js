'use strict';
// Global runtime Scene RGB override. Saved QLC Scene values are never edited.
class SceneColorState {
    constructor(send) {
        this.send = send;
        this.rgb = [0,0,255];
        this.enabled = false;
    }
    command() {
        this.send('QLC+API|setSceneColorOverride|' + Number(this.enabled) + '|' + this.rgb.join('|'));
    }
    cc(number, value, allowOn = true) {
        if (!Number.isInteger(number) || number < 20 || number > 23 ||
            !Number.isInteger(value) || value < 0 || value > 127) return;
        // A release is allowed through a failed match, just like Note Off.
        if (!allowOn && !(number === 23 && value < 64)) return;
        if (number === 23) this.enabled = value >= 64;
        else this.rgb[number - 20] = Math.round(value * 255 / 127);
        this.command();
    }
    reset() { if (this.enabled) { this.enabled = false; this.command(); } }
}
module.exports = SceneColorState;
