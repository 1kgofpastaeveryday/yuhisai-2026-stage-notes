"use strict";
class BrightnessState {
    constructor(send, command='setBrightnessOverride') { this.send=send; this.command=command; this.enabled=false; this.percent=100; this.applied=null; this.active=false; }
    configure(enabled, percent, allowOn=true) {
        if (![0,1].includes(enabled) || !Number.isFinite(percent) || percent<0 || percent>100) return;
        this.enabled=!!enabled; this.percent=percent; this.apply(allowOn);
    }
    apply(allowOn=true) {
        if (!this.enabled) { this.reset(); return; }
        if (!allowOn) return;
        const command='QLC+API|'+this.command+'|1|'+Math.round(this.percent);
        if (this.applied===command) return;
        this.send(command); this.applied=command; this.active=true;
    }
    invalidate() { this.applied=null; }
    reset() { if(this.active) this.send('QLC+API|'+this.command+'|0|100'); this.active=false; this.applied=null; }
}
module.exports=BrightnessState;
