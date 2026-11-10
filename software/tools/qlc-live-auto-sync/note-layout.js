/* ES5: local Live pitches are a permutation of the stable workspace pitches. */
function identityLayout() {
    var result = [];
    for (var i = 0; i < 128; i++) result.push(i);
    return result;
}
function parseLayout(text) {
    if (text === 'identity') return null;
    if (text.slice(0, 3) !== 'v1:' && text.slice(0, 3) !== 'v2:') throw new Error('Invalid saved note layout');
    if (text.slice(0, 3) === 'v2:') parsePlacedTargets(text);
    else if (text.indexOf('|') >= 0) throw new Error('Invalid saved note layout');
    var values = text.slice(3).split('|')[0].split(','), seen = {};
    if (values.length !== 128) throw new Error('Note layout must contain 128 pitches');
    for (var i = 0; i < 128; i++) {
        if (!/^\d+$/.test(values[i])) throw new Error('Invalid layout pitch');
        var n = Number(values[i]);
        if (n > 127 || seen[n]) throw new Error('Duplicate or out-of-range layout pitch');
        seen[n] = true; values[i] = n;
    }
    return values;
}
function parsePlacedTargets(text) {
    if (text.slice(0, 3) !== 'v2:') return null;
    var parts = text.split('|'), seen = {}, result = [];
    if (parts.length !== 2) throw new Error('Invalid saved placed targets');
    var values = parts[1] ? parts[1].split(',') : [];
    for (var i = 0; i < values.length; i++) {
        if (!/^\d+$/.test(values[i])) throw new Error('Invalid placed target');
        var n = Number(values[i]);
        if (n > 127 || seen[n]) throw new Error('Duplicate or out-of-range placed target');
        seen[n] = true; result.push(n);
    }
    return result;
}
function registeredTargets(controls) {
    var result = [];
    for (var i = 0; i < 128; i++) if (controls[i].widgetId) result.push(i);
    return result;
}
function comparePosition(controls, a, b) {
    var left = controls[a], right = controls[b];
    return (left.pageIndex || 0) - (right.pageIndex || 0) ||
        (left.layoutY || 0) - (right.layoutY || 0) ||
        (left.layoutX || 0) - (right.layoutX || 0) || a - b;
}
function newTargets(controls, pageNumber, placed) {
    var scoped = scopeControls(controls, pageNumber), result = [];
    for (var i = 0; i < 128; i++) if (scoped[i].valid && !scoped[i].removed &&
        placed.indexOf(i) < 0) result.push(i);
    return result.sort(function (a, b) { return comparePosition(controls, a, b); });
}
function appendTargets(controls, layout, placed, pending, referenced) {
    var next = layout.slice(), known = placed.slice(), movable = {}, available = [], taken = {}, ends = {};
    for (var n = 0; n < pending.length; n++) {
        var global = pending[n];
        if (!referenced[layout.indexOf(global)]) movable[global] = true;
    }
    // New targets' provisional rows belong to this batch, not to established
    // controls. Collect all eligible destinations before any swaps so a row
    // freed by a later cue cannot reverse the already allocated batch order.
    for (var i = 0; i < 128; i++) {
        var c = controls[layout[i]];
        if (!referenced[i] && (!c.widgetId || c.removed || movable[layout[i]])) available.push(i);
        // Additions continue after the page's established cues. Filling an old
        // interior hole can split a new group even when VC order is correct.
        if (c.widgetId && !c.removed && placed.indexOf(layout[i]) >= 0 &&
            c.type !== 'Page' && c.type !== 'SceneColor') {
            var page = c.pageIndex || 0;
            ends[page] = Math.max(ends[page] === undefined ? -1 : ends[page], i);
        }
    }
    for (var n = 0; n < pending.length; n++) {
        var global = pending[n], source = next.indexOf(global), target = -1;
        // Written notes, including notes on deleted/empty rows, reserve their pitches.
        // A registered but unconfigured widget retains its own original row too.
        if (movable[global]) {
            var page = controls[global].pageIndex || 0;
            if (controls[global].type !== 'Page' && controls[global].type !== 'SceneColor') {
                var end = ends[page] === undefined ? -1 : ends[page];
                for (var i = 0; i < available.length; i++) {
                    var local = available[i];
                    if (local > end && !taken[local]) { target = local; break; }
                }
            }
            // Only reuse an interior hole when the tail has no free row.
            for (var i = 0; i < available.length; i++) {
                if (target >= 0) break;
                var local = available[controls[global].type === 'Page' ? available.length - 1 - i : i];
                if (!taken[local]) { target = local; break; }
            }
            if (target >= 0) { taken[target] = true; next[source] = next[target]; next[target] = global; }
        }
        if (controls[global].type !== 'Page' && controls[global].type !== 'SceneColor') {
            var page = controls[global].pageIndex || 0;
            ends[page] = Math.max(ends[page] === undefined ? -1 : ends[page], next.indexOf(global));
        }
        known.push(global);
    }
    return {layout: next, placed: known};
}
function tidyLayout(controls, pageNumber) {
    var scoped = scopeControls(controls, pageNumber), color = [], cues = [], inactive = [], other = [], pages = [], otherPages = [];
    for (var i = 0; i < 128; i++) {
        var c = scoped[i];
        if (!c.widgetId || c.removed || !controls[i].valid) inactive.push(i);
        else if (c.type === 'SceneColor') color.push(i);
        else if (c.type === 'Page') (c.scopeExcluded ? otherPages : pages).push(i);
        else if (c.scopeExcluded) other.push(i);
        else cues.push(i);
    }
    function compare(a, b) { return comparePosition(controls, a, b); }
    cues.sort(compare); other.sort(compare);
    return color.concat(cues, inactive, other, pages, otherPages);
}
function layoutControls(controls, pageNumber, layout, clean) {
    var scoped = scopeControls(controls, pageNumber), result = [];
    for (var i = 0; i < 128; i++) {
        var original = scoped[layout[i]], c = {};
        for (var key in original) if (original.hasOwnProperty(key)) c[key] = original[key];
        c.liveNote = i;
        if (clean) {
            // Live resets whitespace-only names to "Chain". U+200B keeps an intentionally blank label.
            if (!c.widgetId || c.removed || !controls[layout[i]].valid) c.name = '\u200b';
            else c.name = 'N' + i + ' ' + (c.scopeExcluded ? '[other page] ' : '') +
                controls[layout[i]].name.replace(/^N\d+\s+/, '');
        }
        result.push(c);
    }
    return result;
}
function layoutMigration(previous, next) {
    var inverse = [], migration = [];
    for (var i = 0; i < 128; i++) inverse[next[i]] = i;
    for (var i = 0; i < 128; i++) migration[i] = inverse[previous[i]];
    return migration;
}
function migratedNotes(notes, migration) {
    return notes.map(function (original) {
        if (typeof original.note_id !== 'number' || original.pitch !== Math.floor(original.pitch) ||
            original.pitch < 0 || original.pitch > 127) throw new Error('Invalid clip note data');
        var note = {};
        for (var key in original) if (original.hasOwnProperty(key)) note[key] = original[key];
        note.pitch = migration[original.pitch];
        return note;
    });
}
if (typeof module !== 'undefined') module.exports = {
    identityLayout: identityLayout, parseLayout: parseLayout, tidyLayout: tidyLayout,
    layoutControls: layoutControls, layoutMigration: layoutMigration, migratedNotes: migratedNotes,
    parsePlacedTargets: parsePlacedTargets, registeredTargets: registeredTargets,
    newTargets: newTargets, appendTargets: appendTargets
};
