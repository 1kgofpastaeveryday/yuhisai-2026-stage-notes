/* ES5: each Live track keeps its own page scope; QLC's visible page is unrelated. */
function scopeControls(controls, pageNumber) {
    if (pageNumber === 0) return controls;
    return controls.map(function (control) {
        if (!control.widgetId || control.removed || control.type === 'SceneColor' || control.pageIndex === pageNumber - 1) return control;
        var scoped = {};
        for (var key in control) if (control.hasOwnProperty(key)) scoped[key] = control[key];
        scoped.valid = false; scoped.scopeExcluded = true;
        scoped.name = '[other page N' + control.liveNote + ']';
        return scoped;
    });
}
if (typeof module !== 'undefined') module.exports = scopeControls;
