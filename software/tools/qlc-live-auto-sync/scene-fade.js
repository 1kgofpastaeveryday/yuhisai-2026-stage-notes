'use strict';
// Runtime-only, millisecond-accurate fades. Keep the user's requested settings
// through a transport stop, but release the native override until the next cue.
class SceneFadeState {
    constructor(send) {
        this.send = send;
        this.enabled = false;
        this.fadeIn = 0;
        this.fadeOut = 0;
        this.applied = null;
        this.active = false;
    }
    configure(enabled, fadeIn, fadeOut, allowOn = true) {
        if (![0,1].includes(enabled) || !Number.isInteger(fadeIn) || fadeIn < 0 || fadeIn > 1000 ||
            !Number.isInteger(fadeOut) || fadeOut < 0 || fadeOut > 1000) return;
        this.enabled = !!enabled; this.fadeIn = fadeIn; this.fadeOut = fadeOut;
        this.apply(allowOn);
    }
    apply(allowOn = true) {
        if (!this.enabled) { this.reset(); return; }
        if (!allowOn) return;
        const command = 'QLC+API|setFadeOverride|1|' + this.fadeIn + '|' + this.fadeOut;
        if (this.applied === command) return;
        this.send(command); this.applied = command; this.active = true;
    }
    invalidate() { this.applied = null; }
    reset() {
        if (this.active) this.send('QLC+API|setFadeOverride|0|0|0');
        this.active = false; this.applied = null;
    }
}
module.exports = SceneFadeState;
