autowatch = 0;
inlets = 1;
outlets = 5;
include('midi-router.js');
include('page-scope.js');
include('note-layout.js');
var snapshot = null, ready = false, labelsReady = false, workerStarted = false, workerReady = false;
var transport = 0, labelTask = null, transportObserver = null;
var sourceRequest = null, writingSource = false;
var pageNumber = 0;
var noteLayout = identityLayout(), cleanLayout = false, updatingLayout = false;
var placedTargets = null, savedLayoutText = 'identity';
var autoTidyPending = false, autoLayoutFailed = false;
var pageMenuSignature = null, updatingPageMenu = false;
var rackName = 'QLC Live Auto Labels';
var rackPresetName = '261009-QLC-Live-Auto-Labels';
var sceneRGB = [0, 0, 127];
var fadeEnabled = 0, fadeTimes = [0, 0];
var brightnessEnabled = 0, brightnessValue = 100;
var rgbBrightnessEnabled = 0, rgbBrightnessValue = 100;
function sendRGBBrightnessState() { if (workerReady) outlet(4, 'rgb_brightness', rgbBrightnessEnabled, rgbBrightnessValue); }
function rgb_brightness_override(value) { value=Number(value); if (value!==0 && value!==1) return; rgbBrightnessEnabled=value; sendRGBBrightnessState(); }
function rgb_brightness_parameter(value) { value=Number(value); if (!isFinite(value) || value<0 || value>100) return; rgbBrightnessValue=value; sendRGBBrightnessState(); }
function sendBrightnessState() { if (workerReady) outlet(4, 'brightness', brightnessEnabled, brightnessValue); }
function brightness_override(value) { value=Number(value); if (value!==0 && value!==1) return; brightnessEnabled=value; sendBrightnessState(); }
function brightness_parameter(value) { value=Number(value); if (!isFinite(value) || value<0 || value>100) return; brightnessValue=value; sendBrightnessState(); }
function sendFadeState() {
    if (workerReady) outlet(4, 'scene_fade', fadeEnabled, fadeTimes[0], fadeTimes[1]);
}
function fade_override(value) {
    value = Number(value);
    if (value !== 0 && value !== 1) return;
    fadeEnabled = value; sendFadeState();
}
function fade_parameter(index, value) {
    index = Number(index); value = Number(value);
    if ((index !== 0 && index !== 1) || !isFinite(value) || value < 0 || value > 100) return;
    fadeTimes[index] = Math.round(value * 10); sendFadeState();
}
var router = new MidiRouter(function (packet) {
    if (transport === 2) for (var i = 0; i < packet.length; i++) outlet(0, packet[i]);
}, function (liveNote, channel, note, velocity) {
    if (transport === 1 && workerReady) outlet(4, 'cue', (channel - 1) * 128 + note, velocity);
    var control = snapshot && !snapshot.error && snapshot.controls[(channel - 1) * 128 + note];
    if (control && control.type === 'Page') {
        if (velocity > 0) outlet(2, 'set', transport === 2 ? 'Page selection requires Web API output' : control.name);
        return;
    }
    outlet(2, 'set', 'MIDI N' + liveNote + ' velocity ' + velocity + (transport === 2 ? ' -> QLC+ MIDI ch' + channel : ' -> Web API'));
}, function (liveCC, channel, note, value) {
    if (transport === 1 && workerReady) outlet(4, 'level', (channel - 1) * 128 + note, value);
    outlet(2, 'set', 'CC' + liveCC + ' level ' + value + (transport === 2 ? ' -> QLC+ MIDI ch' + channel : ' -> Web API'));
}, scene_color_cc);
function scene_color_cc(cc, value) {
    if (cc < 23) {
        var changed = sceneRGB[cc - 20] !== value;
        sceneRGB[cc - 20] = value;
        var control = patcher.getnamed('scene_' + ['red', 'green', 'blue'][cc - 20]);
        if (control && changed) control.message('set', value * 100 / 127);
    }
    if (transport === 1 && workerReady) {
        // Always send RGB before enabling, including after loading a saved Set.
        if (cc === 23 && value >= 64) for (var i = 0; i < 3; i++) outlet(4, 'scene_color', 20 + i, sceneRGB[i]);
        outlet(4, 'scene_color', cc, value);
        outlet(2, 'set', 'Scene color CC' + cc + ' = ' + value + ' / CC20 R, CC21 G, CC22 B, CC23 enable');
    } else outlet(2, 'set', 'Scene color CC requires Web API output');
}
function scene_parameter(cc, value) {
    cc = Number(cc); value = Math.round(Number(value) * 127 / 100);
    if (cc < 20 || cc > 22 || cc !== Math.floor(cc) || value < 0 || value > 127 || !isFinite(value)) return;
    sceneRGB[cc - 20] = value;
    if (router.enabled) scene_color_cc(cc, value);
}
function msg_int(value) { router.byte(value); }
function list() { var v = arrayfromargs(arguments); for (var i = 0; i < v.length; i++) router.byte(v[i]); }
function status(text) { outlet(1, 'set', text); }
function connection() { outlet(2, 'set', arrayfromargs(arguments).join(' ')); }
function panic() {
    router.panic();
    if (workerReady) outlet(4, 'panic');
    outlet(2, 'set', 'Released held notes');
}
function mode(value) {
    if (Number(value) !== transport) panic();
    transport = Number(value);
    router.enabled = transport !== 0 && labelsReady && !!snapshot && !snapshot.error;
    if (workerReady) outlet(4, 'mode', transport);
    outlet(2, 'set', transport === 0 ? 'Output off' : transport === 1 ? 'Connecting to QLC+...' : 'MIDI output / choose virtual port in Live');
}
function watcher_ready() { workerReady = true; sourceRequest = null; outlet(4, 'mode', transport); sendFadeState(); sendBrightnessState(); sendRGBBrightnessState(); outlet(3, 'bang'); }
function sourceText(value) { return value instanceof Array ? value.join(' ') : String(value || ''); }
function storedSource() {
    var parameter = this.patcher.getnamed('source_path');
    return parameter && parameter.getvalueof ? sourceText(parameter.getvalueof()) : null;
}
function source() {
    if (!workerReady || writingSource) return;
    var path = arrayfromargs(arguments).join(' ');
    var stored = storedSource(), setPath = '';
    // conformpath slash boot may expand a relative value against Max's folder.
    // Read that value directly from pattr; absolute dialog paths still use conformpath.
    if (stored !== null && !/^(?:[\\\/]|[^\\\/]+:)/.test(stored)) path = stored;
    try { setPath = sourceText(new LiveAPI(null, 'live_set').get('file_path')); }
    catch (e) { /* Unavailable file_path behaves like an unsaved Set. */ }
    var request = JSON.stringify({source: path, setPath: setPath});
    if (request === sourceRequest) return;
    sourceRequest = request;
    panic(); showSource(path); outlet(4, 'source_context', request);
}
function source_stored() {
    var result = JSON.parse(arrayfromargs(arguments).join(' '));
    if (result.request !== sourceRequest || storedSource() === result.stored) return;
    // Set the next request before pattr emits, including a deferred conformpath echo.
    sourceRequest = JSON.stringify({source: result.stored, setPath: JSON.parse(result.request).setPath});
    writingSource = true;
    try { outlet(3, result.stored); }
    finally { writingSource = false; }
}
function refresh() { if (workerReady) outlet(4, 'refresh'); }
function export_midi() { if (workerReady) outlet(4, 'export_midi'); }
function page(value) {
    if (updatingPageMenu) return;
    var next = Number(value);
    if (next !== Math.floor(next) || next < 0 || next > 128) return;
    if (next !== pageNumber) panic();
    if (next !== pageNumber) autoTidyPending = cleanLayout;
    pageNumber = next; labelsReady = false; router.enabled = false;
    syncPageMenu();
    if (snapshot && !snapshot.error) router.update(currentControls());
    router.enabled = false; retryLabels(); syncLabels();
}
function stopped(args) {
    if (args[0] === 'is_playing' && Number(args[1]) === 0) {
        panic();
        if (autoTidyPending) { retryLabels(); syncLabels(); }
    }
}
function live_ready() {
    ready = true;
    // Restored live.menu values do not necessarily emit on load. Read the
    // track's saved page before the worker's default-page snapshot arrives.
    var restoredPage = this.patcher.getnamed('page_scope');
    if (restoredPage && restoredPage.getvalueof) page(Number(restoredPage.getvalueof()));
    for (var j = 0; j < 2; j++) {
        var fade = this.patcher.getnamed(['fade_in', 'fade_out'][j]);
        if (fade) fade.message('bang');
    }
    // bang toggles live.toggle rather than reading it. Query the restored value.
    var fadeToggle = this.patcher.getnamed('fade_enabled');
    if (fadeToggle) fade_override(Number(fadeToggle.getvalueof()));
    var brightnessDial = this.patcher.getnamed('brightness');
    if (brightnessDial) brightnessDial.message('bang');
    var brightnessToggle = this.patcher.getnamed('brightness_enabled');
    if (brightnessToggle) brightness_override(Number(brightnessToggle.getvalueof()));
    var rgbBrightnessDial = this.patcher.getnamed('rgb_brightness');
    if (rgbBrightnessDial) rgbBrightnessDial.message('bang');
    var rgbBrightnessToggle = this.patcher.getnamed('rgb_brightness_enabled');
    if (rgbBrightnessToggle) rgb_brightness_override(Number(rgbBrightnessToggle.getvalueof()));
    for (var i = 0; i < 3; i++) {
        var color = this.patcher.getnamed('scene_' + ['red', 'green', 'blue'][i]);
        if (color) color.message('bang');
    }
    var savedLayout = this.patcher.getnamed('note_layout');
    if (savedLayout) savedLayout.message('bang');
    if (!transportObserver) { transportObserver = new LiveAPI(stopped, 'live_set'); transportObserver.property = 'is_playing'; }
    if (!workerStarted) { workerStarted = true; outlet(4, 'script', 'start'); }
    retryLabels();
}
function dictionary(name) {
    try {
        var next = JSON.parse(new Dict(name).stringify());
        showSource(next.source);
        if (next.error) { snapshot = next; labelsReady = false; router.enabled = false; status('Source error: ' + next.error); return; }
        snapshot = next; autoTidyPending = cleanLayout;
        if (next.schema === 2) {
            if (!pageNumber) pageNumber = next.defaultPage + 1;
            // A single row permutation is shared across all performance tracks.
            // Never auto-migrate existing clip notes when selecting another page.
            noteLayout = next.defaultLayout.slice(); cleanLayout = true;
            autoTidyPending = false;
        }
        if (cleanLayout && placedTargets === null) placedTargets = registeredTargets(next.controls);
        labelsReady = false; router.update(currentControls()); router.enabled = false;
        syncPageMenu();
        retryLabels(); syncLabels();
    } catch (e) { router.enabled = false; status('Sync error: ' + e.message); }
}
function pageControls() {
    if (!snapshot.pageViews) return snapshot.controls;
    if (pageNumber > 0 && snapshot.pageViews[pageNumber - 1]) return snapshot.pageViews[pageNumber - 1];
    return snapshot.controls.slice(0, 128); // Missing page retains only shared controls.
}
function currentControls() { return layoutControls(pageControls(), snapshot.schema === 2 ? 0 : pageNumber, noteLayout, cleanLayout); }
function layout_state() {
    if (updatingLayout) return;
    try {
        var wasClean = cleanLayout;
        var text = arrayfromargs(arguments).join(' ');
        var saved = parseLayout(text), placed = parsePlacedTargets(text);
        noteLayout = saved || identityLayout(); cleanLayout = !!saved;
        placedTargets = placed; savedLayoutText = text;
        autoTidyPending = cleanLayout && (autoTidyPending || !wasClean);
        autoLayoutFailed = false;
        if (snapshot && snapshot.schema === 2) { noteLayout = snapshot.defaultLayout.slice(); cleanLayout = true; autoTidyPending = false; }
        if (snapshot && !snapshot.error) { router.update(currentControls()); retryLabels(); syncLabels(); }
    } catch (e) { labelsReady = false; router.enabled = false; status('Layout error: ' + e.message); }
}
function writeLayoutState(text) {
    updatingLayout = true;
    try {
        // pattr stores an arbitrary message verbatim; "set" would become part of its data.
        this.patcher.getnamed('note_layout').message(text);
        savedLayoutText = text;
    } finally { updatingLayout = false; }
}
function storeLayout(layout, clean, placed) {
    writeLayoutState(clean ? 'v2:' + layout.join(',') + '|' + placed.join(',') : 'identity');
}
function clipNotes(clip) {
    var raw = clip.call('get_all_notes_extended');
    var data = JSON.parse(String(raw));
    if (!data || !(data.notes instanceof Array)) throw new Error('Cannot read clip notes');
    return data.notes;
}
function trackClips(track) {
    var result = [], seen = {}, clips = ids(track.get('arrangement_clips'));
    var slots = ids(track.get('clip_slots'));
    for (var i = 0; i < slots.length; i++) {
        var slot = new LiveAPI(null, 'id ' + slots[i]);
        clips = clips.concat(ids(slot.get('clip')));
    }
    for (var i = 0; i < clips.length; i++) if (clips[i] && !seen[clips[i]]) {
        seen[clips[i]] = true;
        var clip = new LiveAPI(null, 'id ' + clips[i]);
        if (Number(clip.get('is_midi_clip')) === 1) result.push(clip);
    }
    return result;
}
function writeClipNotes(clip, notes) {
    clip.call('apply_note_modifications', JSON.stringify({notes: notes}));
    var actual = clipNotes(clip), expected = {};
    for (var i = 0; i < notes.length; i++) expected[notes[i].note_id] = notes[i];
    if (actual.length !== notes.length) throw new Error('Clip note count changed');
    for (var i = 0; i < actual.length; i++) {
        var wanted = expected[actual[i].note_id];
        if (!wanted) throw new Error('Clip note ID changed');
        for (var key in wanted) if (wanted.hasOwnProperty(key) &&
            JSON.stringify(actual[i][key]) !== JSON.stringify(wanted[key])) throw new Error('Clip note verification failed: ' + key);
    }
}
function autoTidy(track) {
    if (snapshot && snapshot.schema === 2) { autoTidyPending = false; return; }
    if (!autoTidyPending || !cleanLayout) return;
    if (savedLayoutText.slice(0, 3) === 'v2:' && placedTargets !== null &&
        !newTargets(snapshot.controls, pageNumber, placedTargets).length) {
        autoTidyPending = false; return;
    }
    if (Number(new LiveAPI(null, 'live_set').get('is_playing')) || router.data.length || router.sysex) return;
    for (var key in router.active) if (router.active.hasOwnProperty(key)) return;
    applyAdditions(track);
}
function applyAdditions(track) {
    var previousText = savedLayoutText, attempted = false;
    try {
        if (Number(track.get('has_midi_input')) !== 1) throw new Error('Place Sync directly on the lighting MIDI track');
        // Upgrade an existing track in place. Its current rows are the baseline;
        // renames, moves and removals must never cause automatic compaction.
        var placed = placedTargets === null ? registeredTargets(snapshot.controls) : placedTargets;
        var pending = newTargets(snapshot.controls, pageNumber, placed), referenced = {};
        if (pending.length) {
            var clips = trackClips(track);
            for (var i = 0; i < clips.length; i++) {
                var notes = clipNotes(clips[i]);
                for (var n = 0; n < notes.length; n++) referenced[notes[n].pitch] = true;
            }
        }
        var result = appendTargets(snapshot.controls, noteLayout, placed, pending, referenced);
        attempted = true; storeLayout(result.layout, true, result.placed);
        noteLayout = result.layout; placedTargets = result.placed; autoTidyPending = false;
        router.update(currentControls());
        if (pending.length) outlet(2, 'set', 'Registered ' + pending.length + ' new controls / existing notes unchanged');
    } catch (e) {
        if (attempted) {
            try { writeLayoutState(previousText); }
            catch (rollback) { autoLayoutFailed = true; throw new Error('Registration rollback incomplete. Keep Output Off.'); }
        }
        throw e;
    }
}
function tidy_notes() {
    if (snapshot && snapshot.schema === 2) { status("Page-channel rows stay fixed; new buttons are appended automatically"); return; }
    if (!ready || !labelsReady || !snapshot || snapshot.error) { status('Wait for label synchronization before Tidy notes'); return; }
    if (transport !== 0 || Number(new LiveAPI(null, 'live_set').get('is_playing'))) {
        status('Stop Live and set Output Off before Tidy notes'); return;
    }
    var self = new LiveAPI(null, 'this_device');
    var track = new LiveAPI(null, 'id ' + ids(self.get('canonical_parent'))[0]);
    if (cleanLayout) {
        try { applyAdditions(track); syncLabels(); outlet(2, 'set', 'Existing note positions are fixed / new controls registered'); }
        catch (e) { labelsReady = false; router.enabled = false; status('Registration failed: ' + e.message); }
    } else applyTidy(track, false);
}
function applyTidy(track, automatic) {
    var plans = [], applied = [], previous = noteLayout.slice(), wasClean = cleanLayout, layoutWriteAttempted = false;
    var previousPlaced = placedTargets, previousText = savedLayoutText;
    try {
        if (Number(track.get('has_midi_input')) !== 1) throw new Error('Place Sync directly on the lighting MIDI track');
        var next = tidyLayout(snapshot.controls, pageNumber), migration = layoutMigration(previous, next);
        var clips = trackClips(track), moved = 0;
        for (var i = 0; i < clips.length; i++) {
            var oldNotes = clipNotes(clips[i]), newNotes = migratedNotes(oldNotes, migration), changed = false;
            for (var n = 0; n < oldNotes.length; n++) if (oldNotes[n].pitch !== newNotes[n].pitch) { changed = true; moved++; }
            if (changed) plans.push({clip: clips[i], before: oldNotes, after: newNotes});
        }
        if (!automatic) panic();
        labelsReady = false; router.enabled = false;
        for (var i = 0; i < plans.length; i++) { applied.push(plans[i]); writeClipNotes(plans[i].clip, plans[i].after); }
        layoutWriteAttempted = true;
        var placed = registeredTargets(snapshot.controls);
        storeLayout(next, true, placed);
        noteLayout = next; cleanLayout = true; autoTidyPending = false;
        placedTargets = placed;
        router.update(currentControls());
        if (!automatic) { retryLabels(); syncLabels(); }
        outlet(2, 'set', 'Tidied this track / moved ' + moved + ' notes in ' + plans.length + ' clips');
    } catch (e) {
        var rollbackFailed = false;
        for (var i = applied.length - 1; i >= 0; i--) {
            try { writeClipNotes(applied[i].clip, applied[i].before); } catch (rollback) { rollbackFailed = true; }
        }
        if (layoutWriteAttempted) {
            try { writeLayoutState(previousText); } catch (rollback) { rollbackFailed = true; }
        }
        noteLayout = previous; cleanLayout = wasClean;
        placedTargets = previousPlaced;
        if (rollbackFailed) autoLayoutFailed = true;
        if (!automatic) autoTidyPending = false;
        labelsReady = false; router.enabled = false;
        if (automatic) throw new Error(rollbackFailed ? 'Tidy rollback incomplete. Keep Output Off.' : e.message);
        if (rollbackFailed) status('Tidy failed; clip rollback incomplete. Keep Output Off.');
        else { router.update(currentControls()); retryLabels(); syncLabels(); status('Tidy cancelled: ' + e.message); }
    }
}
function showSource(path) {
    var display = this.patcher.getnamed('source_filename');
    if (!display || !path) return;
    display.message('set', 'Source: ' + path.split(/[\\\/]/).pop());
    display.message('hint', path);
}
function syncPageMenu() {
    if (!snapshot || snapshot.error) return;
    var menu = this.patcher.getnamed('page_scope');
    if (!menu) return;
    var limit = pageNumber;
    for (var c = 0; c < snapshot.controls.length; c++) {
        var control = snapshot.controls[c];
        if (control.type === 'Page' && !control.removed) limit = Math.max(limit, control.pageIndex + 1);
    }
    var labels = [snapshot.schema === 2 ? 'Shared controls only' : 'All pages'];
    for (var i = 1; i <= limit; i++) labels.push('Page ' + i + ' / (not in workspace)');
    for (var c = 0; c < snapshot.controls.length; c++) {
        var control = snapshot.controls[c];
        if (control.type === 'Page' && !control.removed)
            labels[control.pageIndex + 1] = 'Page ' + (control.pageIndex + 1) + ' / ' + control.pageCaption;
    }
    var signature = JSON.stringify(labels);
    if (signature === pageMenuSignature) return;
    updatingPageMenu = true;
    try {
        menu.message('_parameter_range', labels);
        menu.message('set', pageNumber);
        pageMenuSignature = signature;
    } finally { updatingPageMenu = false; }
}
function ids(values) {
    var result = [];
    for (var i = 0; i < values.length; i++) if (values[i] === 'id' && i + 1 < values.length) result.push(Number(values[++i]));
    return result;
}
function retryLabels() {
    if (!ready) return;
    if (!labelTask) labelTask = new Task(syncLabels, this);
    labelTask.cancel(); labelTask.interval = 1000; labelTask.repeat();
}
function syncLabels() {
    if (!snapshot || snapshot.error || !ready || autoLayoutFailed) return;
    try {
        var self = new LiveAPI(null, 'this_device');
        if (!self.id) return;
        var parent = new LiveAPI(null, 'id ' + ids(self.get('canonical_parent'))[0]);
        var devices = ids(parent.get('devices')), rack = null;
        for (var i = 0; i < devices.length; i++) {
            var d = new LiveAPI(null, 'id ' + devices[i]);
            var title = String(d.get('name'));
            if (title === rackName || title === rackPresetName && String(d.get('class_name')) === 'MidiEffectGroupDevice') { rack = d; break; }
        }
        if (!rack) { labelsReady = false; router.enabled = false; status('Add QLC Live Auto Labels to this track'); return; }
        var chains = ids(rack.get('chains'));
        if (chains.length !== 128) { labelsReady = false; router.enabled = false; status('Load the supplied 128-note Rack'); return; }
        if (String(rack.get('name')) !== rackName) rack.set('name', rackName);
        var params = ids(rack.get('parameters'));
        if (params.length) {
            var activator = new LiveAPI(null, 'id ' + params[0]);
            if (Number(activator.get('value')) !== 0) activator.set('value', 0);
        }
        autoTidy(parent);
        var scopedControls = currentControls(), count = 0, pageTitle = 'All pages';
        for (var c = 0; c < 128; c++) {
            var control = scopedControls[c];
            if (control.widgetId && !control.removed && !control.scopeExcluded && (!cleanLayout || control.valid)) count++;
            if (control.type === 'Page' && control.pageIndex === pageNumber - 1 && !control.removed) pageTitle = control.name;
            var name = control.name;
            if (!cleanLayout && control.widgetId && !control.removed && !control.valid && !control.scopeExcluded) name = '[no function] ' + name;
            var chain = new LiveAPI(null, 'id ' + chains[c]);
            if (String(chain.get('name')) !== name) chain.set('name', name);
        }
        labelsReady = true; router.enabled = transport !== 0;
        status(pageNumber && pageTitle === 'All pages' ? 'Page ' + pageNumber + ' is not in saved workspace' :
            'Synced ' + count + '/128 / ' + pageTitle + (snapshot.schema === 2 ? ' / page ch' + (pageNumber + 1) + ', shared ch1' : ' / RGB CC20-22 / Color Override note') + (snapshot.deferred && snapshot.deferred.length ? ' / ' + snapshot.deferred.length + ' controls waiting for free rows' : ''));
        if (labelTask && !autoTidyPending) labelTask.cancel();
    } catch (e) { labelsReady = false; router.enabled = false; status('Live API: ' + e.message); }
}
function notifydeleted() { if (labelTask) labelTask.cancel(); panic(); if (workerReady) outlet(4, 'stop'); }
