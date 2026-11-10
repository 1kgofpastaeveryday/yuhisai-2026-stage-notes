'use strict';
// Schema 2: channel 1 is shared; channels 2-16 address absolute VC page slots.
// liveNote remains the stable wire pitch. defaultLayout maps local Live rows
// onto wire pitches, preserving the existing show's permutation unchanged.
const SIZE = 128;
const key = b => b.channel * SIZE + b.liveNote;
const usesSharedRows = (registry, page) => !(registry.pagesWithoutSharedRows || []).includes(page);
const synthetic = id => id === 'scene-color' || /^page:\d+$/.test(id);
function validate(registry) {
    if (!registry || registry.version !== 2 || !Array.isArray(registry.bindings) ||
        !Array.isArray(registry.commonWidgetIds) || !Array.isArray(registry.defaultLayout) ||
        registry.defaultLayout.length !== SIZE || new Set(registry.defaultLayout).size !== SIZE ||
        registry.defaultLayout.some(n => !Number.isInteger(n) || n < 0 || n >= SIZE) ||
        !Number.isInteger(registry.defaultPage) || registry.defaultPage < 0 || registry.defaultPage >= 15)
        throw new Error('Invalid page-channel registry');
    if (registry.pagesWithoutSharedRows !== undefined &&
        (!Array.isArray(registry.pagesWithoutSharedRows) ||
         new Set(registry.pagesWithoutSharedRows).size !== registry.pagesWithoutSharedRows.length ||
         registry.pagesWithoutSharedRows.some(p => !Number.isInteger(p) || p < 0 || p >= 15)))
        throw new Error('Invalid pagesWithoutSharedRows');
    const ids = new Set(), addresses = new Set(), ccs = new Set();
    for (const b of registry.bindings) {
        if (!/^(?:\d+|page:\d+|scene-color)$/.test(b.widgetId) ||
            !Number.isInteger(b.liveNote) || b.liveNote < 0 || b.liveNote >= SIZE ||
            !Number.isInteger(b.channel) || b.channel < 0 || b.channel > 15 ||
            addresses.has(key(b)) || (!b.retired && ids.has(b.widgetId + ':' +
                (synthetic(b.widgetId) ? b.channel : 'widget'))))
            throw new Error('Duplicate or invalid page-channel binding');
        if (synthetic(b.widgetId) && b.channel !== 0 && usesSharedRows(registry, b.channel - 1))
            throw new Error('Page-owned synthetic controls require a page without shared rows');
        addresses.add(key(b)); if (!b.retired) ids.add(b.widgetId + ':' +
            (synthetic(b.widgetId) ? b.channel : 'widget'));
        if (b.ccNumber !== undefined) {
            const cc = b.channel + ':' + b.ccNumber;
            if (!Number.isInteger(b.ccNumber) || b.ccNumber < 0 || b.ccNumber >= 120 ||
                (b.ccNumber >= 20 && b.ccNumber <= 23) || ccs.has(cc)) throw new Error('Invalid page slider CC');
            ccs.add(cc);
        }
    }
    const shared = new Set(registry.bindings.filter(b => b.channel === 0).map(b => b.liveNote));
    if (registry.bindings.some(b => b.channel !== 0 && usesSharedRows(registry, b.channel - 1) && shared.has(b.liveNote)))
        throw new Error('A page cue occupies a shared row');
    return registry;
}
function channelFor(c, registry) {
    return c.type === 'Page' || c.type === 'SceneColor' || registry.commonWidgetIds.includes(c.widgetId) ? 0 : c.pageIndex + 1;
}
function allocate(controls, registry) {
    validate(registry);
    if (controls.some(c => c.pageIndex >= 15)) throw new Error('At most 15 VC pages are supported with the shared channel');
    const next = JSON.parse(JSON.stringify(registry));
    const byId = new Map(controls.map(c => [c.widgetId, c]));
    byId.set('scene-color', {widgetId:'scene-color', type:'SceneColor', valid:true});
    for (const b of next.bindings) {
        const c = byId.get(b.widgetId);
        const pageOwned = synthetic(b.widgetId) && b.channel > 0 && !usesSharedRows(next, b.channel - 1);
        if (!c || (!b.retired && !pageOwned && channelFor(c, next) !== b.channel)) b.retired = true;
    }
    const pending = [...byId.values()].filter(c => c.valid && !next.bindings.some(b => !b.retired && b.widgetId === c.widgetId))
        .sort((a,b) => (b.type === 'Page') - (a.type === 'Page') || (a.pageIndex || 0) - (b.pageIndex || 0) ||
            (a.layoutY || 0) - (b.layoutY || 0) || (a.layoutX || 0) - (b.layoutX || 0));
    next.deferred = [];
    for (const c of pending) {
        const channel = channelFor(c, next);
        const shares = channel === 0 || usesSharedRows(next, channel - 1);
        const shared = new Set(next.bindings.filter(b => shares && b.channel === 0).map(b => b.liveNote));
        const occupies = b => channel === 0 ? b.channel === 0 || usesSharedRows(next, b.channel - 1) :
            b.channel === channel || shares && b.channel === 0;
        const used = new Set(next.bindings.filter(occupies).map(b => b.liveNote));
        const cueRows = next.bindings.filter(b => !b.retired && (b.channel === channel || shares && b.channel === 0))
            .filter(b => { const item = byId.get(b.widgetId); return item && item.type !== 'Page' && item.type !== 'SceneColor'; })
            .map(b => next.defaultLayout.indexOf(b.liveNote));
        const end = Math.max(-1,...cueRows);
        const rows = next.defaultLayout.map((note,row) => ({note,row})).filter(x => !used.has(x.note) && !shared.has(x.note));
        const slot = c.type === 'Page' ? rows[rows.length-1] : rows.find(x => x.row > end) || rows[0];
        if (!slot) { next.deferred.push({widgetId:c.widgetId,channel,name:c.name,reason:'128 rows reserved on this page'}); continue; }
        const binding = {widgetId:c.widgetId, liveNote:slot.note, channel};
        if (c.type === 'Slider') {
            const usedCCs = new Set(next.bindings.filter(b => b.channel === channel || shares && b.channel === 0).map(b => b.ccNumber));
            const cc = [c.preferred, ...Array.from({length:120},(_,i)=>i)].find(n => Number.isInteger(n) && n >= 0 && n < 120 && (n < 20 || n > 23) && !usedCCs.has(n));
            if (cc === undefined) { next.deferred.push({widgetId:c.widgetId,channel,name:c.name,reason:'No free slider CC'}); continue; }
            binding.ccNumber = cc;
        }
        next.bindings.push(binding);
    }
    return validate(next);
}
function snapshot(controls, registry, source, revision) {
    validate(registry);
    const byId = new Map(controls.map(c => [c.widgetId,c]));
    byId.set('scene-color',{widgetId:'scene-color',name:'Color Override',type:'SceneColor',valid:true});
    const empty = (channel,note) => ({liveNote:note,note,channel,chainIndex:note,widgetId:null,name:'[empty N'+note+']',valid:false});
    const slots = Array.from({length:16*SIZE},(_,i)=>empty(Math.floor(i/SIZE),i%SIZE));
    for (const b of registry.bindings) {
        const c = b.retired ? null : byId.get(b.widgetId);
        slots[key(b)] = {...empty(b.channel,b.liveNote),...b,...(c||{}),shared:b.channel===0,
            valid:!!c&&c.valid,removed:!c,name:c?c.name:'[removed ID'+b.widgetId+']'};
    }
    const pageCount = controls.filter(c=>c.type==='Page').length;
    const shared = slots.slice(0,SIZE);
    const pageViews = Array.from({length:pageCount},(_,page)=>Array.from({length:SIZE},(_,note)=>
        usesSharedRows(registry,page) && shared[note].widgetId ? {...shared[note]} : {...slots[(page+1)*SIZE+note]}));
    return {schema:2,source,revision,controls:slots,pageViews,defaultLayout:registry.defaultLayout,
        defaultPage:registry.defaultPage,registered:controls.length,playable:controls.filter(c=>c.valid).length,
        reserved:registry.bindings.length,deferred:registry.deferred||[]};
}
function migrate(controls, previous, oldLayout, commonWidgetIds, defaultPage) {
    const byId = new Map(controls.map(c=>[c.widgetId,c]));
    const next = {version:2,defaultLayout:Array.from({length:128},(_,i)=>i),defaultPage,commonWidgetIds:[...commonWidgetIds],bindings:[]};
    next.bindings.push({widgetId:'scene-color',channel:0,liveNote:0});
    commonWidgetIds.forEach((widgetId,i)=>next.bindings.push({widgetId,channel:0,liveNote:i+1}));
    const pageControls=controls.filter(c=>c.type==='Page');
    if(pageControls.length>15) throw new Error('At most 15 VC pages are supported');
    pageControls.forEach((c,i)=>next.bindings.push({widgetId:c.widgetId,channel:0,liveNote:127-i}));
    const existing=previous.bindings.filter(b=>!b.retired&&byId.has(b.widgetId)&&
        !commonWidgetIds.includes(b.widgetId)&&byId.get(b.widgetId).type!=='Page')
        .sort((a,b)=>oldLayout.indexOf(a.liveNote)-oldLayout.indexOf(b.liveNote));
    for(const b of existing) {
        const c=byId.get(b.widgetId),channel=c.pageIndex+1;
        const used=new Set(next.bindings.filter(x=>x.channel===0||x.channel===channel).map(x=>x.liveNote));
        const liveNote=Array.from({length:128},(_,i)=>i).find(n=>!used.has(n));
        if(liveNote===undefined) throw new Error('Existing page has no free row');
        next.bindings.push({...b,liveNote,channel});
    }
    return allocate(controls,validate(next));
}
module.exports = {validate,allocate,snapshot,migrate,key,usesSharedRows};
