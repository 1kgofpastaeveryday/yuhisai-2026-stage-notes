'use strict';
// Execute the actual ES5 Max script against a small Live API model. No MIDI ports.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const {parseWorkspace, allocate, snapshot} = require('./source');
const source = path.join(__dirname, 'test-fixtures/workspace-61.qxw');
const controls = parseWorkspace(fs.readFileSync(source, 'utf8'));
const data = snapshot(controls, allocate(controls), source, 'model-test');
const colorControl = {...data.controls.find(c=>c.type==='SceneColor')};
data.controls[colorControl.liveNote] = {liveNote:colorControl.liveNote,note:colorControl.liveNote,channel:0,
    widgetId:null,name:'[empty N'+colorControl.liveNote+']',valid:false};
const events = [];
const namedRGB = {};
let savedFadeEnabled = 0, fadeToggleBangs = 0;
let savedRGBBrightnessEnabled = 0, rgbBrightnessToggleBangs = 0, savedRGBBrightness = 100;
const rgbBrightnessToggleControl = {getvalueof:()=>savedRGBBrightnessEnabled, message(method) {
    if(method==='bang'){rgbBrightnessToggleBangs++;savedRGBBrightnessEnabled=1-savedRGBBrightnessEnabled;}
}};
const rgbBrightnessDialControl = {message(method) {if(method==='bang')context.rgb_brightness_parameter(savedRGBBrightness);}};
const fadeToggleControl = {getvalueof:()=>savedFadeEnabled, message(method) {
    if (method === 'bang') { fadeToggleBangs++; savedFadeEnabled = 1 - savedFadeEnabled; }
}};
const rgbControl = name => ({message(method,value) { if(method==='set') namedRGB[name]=value; }});
let missing = false;
let dictionaryData = data;
const names = Array.from({length:128}, (_,i)=>'[empty N'+i+']');
const values = new Map([[900,1]]);
let rackTitle = '261009-QLC-Live-Auto-Labels';
let menuLabels = [], menuSelection = 0, sourceLabel = '', sourceHint = '';
let savedLayout = 'identity', playing = 0, failClip = 0, failLayout = false;
const clipData = new Map([[501,[{note_id:11,pitch:49,start_time:0,duration:1,velocity:93,mute:0,probability:0.6,release_velocity:44}]],
    [502,[{note_id:21,pitch:48,start_time:-2,duration:3,velocity:99,mute:1,velocity_deviation:12}]],
    [503,[{note_id:31,pitch:113,start_time:128,duration:2,velocity:127,mute:0}]]]);
const savedLayoutParameter = {message(...atoms) {
    if(atoms[0]!=='bang') savedLayout=atoms.join(' ');
    if(failLayout) { failLayout=false; throw new Error('Injected pattr write failure'); }
    context.layout_state(savedLayout);
}};
const pageMenu = {getvalueof:()=>menuSelection, message(method,value) {
    if (method === '_parameter_range') {
        menuLabels = Array.from(value);
        // Some UI updates emit a value. Caption refresh must not select Page0.
        context.page(0);
    }
    if (method === 'set') menuSelection = value;
}};
const sourceDisplay = {message(method,value) {
    if (method === 'set') sourceLabel = value;
    if (method === 'hint') sourceHint = value;
}};
function LiveAPI(callback, address) {
    this.id = address === 'this_device' ? 1 : address === 'live_set' ? 999 : Number(address.slice(3));
    this.callback = callback;
    this.get = function(key) {
        if (this.id===999 && key==='is_playing') return [playing];
        if (this.id===1 && key==='canonical_parent') return ['id',2];
        if (this.id===2 && key==='has_midi_input') return [1];
        if (this.id===2 && key==='arrangement_clips') return ['id',501,'id',502];
        if (this.id===2 && key==='clip_slots') return ['id',600,'id',601];
        if (this.id===600 && key==='clip') return ['id',501]; // Same clip is migrated once.
        if (this.id===601 && key==='clip') return ['id',503];
        if (clipData.has(this.id) && key==='is_midi_clip') return [1];
        if (this.id===2 && key==='devices') return missing ? [] : ['id',1,'id',3];
        if (this.id===3 && key==='name') return [rackTitle];
        if (this.id===3 && key==='class_name') return ['MidiEffectGroupDevice'];
        if (this.id===3 && key==='chains') return names.flatMap((n,i)=>['id',100+i]);
        if (this.id===3 && key==='parameters') return ['id',900];
        if (this.id>=100 && this.id<228 && key==='name') return [names[this.id-100]];
        if (key==='value') return [values.get(this.id)];
        return [];
    };
    this.set = function(key,value) {
        if (key==='name' && this.id===3) rackTitle=value;
        else if (key==='name') names[this.id-100]=value;
        if (key==='value') values.set(this.id,value);
    };
    this.call = function(method,json) {
        if(method==='get_all_notes_extended') return [JSON.stringify({notes:clipData.get(this.id)})];
        if(method==='apply_note_modifications') {
            const notes=JSON.parse(json).notes;
            assert.deepEqual(notes.map(n=>n.note_id),clipData.get(this.id).map(n=>n.note_id));
            clipData.set(this.id,notes);
            if(failClip===this.id){failClip=0;throw Error('Injected failure after partial clip write');}
            return [];
        }
        throw Error('Unexpected model API call '+method);
    };
}
const context = vm.createContext({outlet:(...e)=>events.push(e), arrayfromargs:a=>Array.from(a),
    patcher:{getnamed:name=>name==='rgb_brightness_enabled'?rgbBrightnessToggleControl:name==='rgb_brightness'?rgbBrightnessDialControl:name==='fade_enabled'?fadeToggleControl:name==='page_scope'?pageMenu:name==='source_filename'?sourceDisplay:name==='note_layout'?savedLayoutParameter:name.indexOf('scene_')===0?rgbControl(name):null},
    LiveAPI, Dict:function(){this.stringify=()=>JSON.stringify(dictionaryData);},
    Task:function(fn){this.cancel=()=>{};this.repeat=()=>{};},
    include:name=>vm.runInContext(fs.readFileSync(name,'utf8'),context)});
vm.runInContext(fs.readFileSync('qlc-live.js','utf8'),context);
context.live_ready(); context.watcher_ready(); context.dictionary('data');
assert.equal(fadeToggleBangs,0,'Initializing must never bang/toggle the restored enable switch');
assert.equal(rgbBrightnessToggleBangs,0);
savedRGBBrightnessEnabled=1;savedRGBBrightness=73.5;context.live_ready();
assert.equal(context.rgbBrightnessEnabled,1);assert.equal(context.rgbBrightnessValue,73.5);
assert.equal(rgbBrightnessToggleBangs,0,'Restore RGB enable without toggling it');
savedRGBBrightnessEnabled=0;context.live_ready();assert.equal(context.rgbBrightnessEnabled,0);
assert.equal(context.fadeEnabled,0,'New devices start with fade override Off');
savedFadeEnabled=1; context.live_ready();
assert.equal(context.fadeEnabled,1,'Read saved On without changing the toggle');
savedFadeEnabled=0; context.live_ready();
assert.equal(context.fadeEnabled,0,'Saved Off also remains Off');
assert.equal(rackTitle,'QLC Live Auto Labels','Recognize and normalize the filename-derived Rack name');
assert.equal(menuLabels.length,2,'Only All pages and the existing first page are listed');
assert.equal(menuLabels[1],'Page 1 / '+data.controls.find(c=>c.type==='Page').pageCaption);
assert.equal(sourceLabel,'Source: workspace-61.qxw');assert.equal(sourceHint,source);
assert.equal(values.get(900),0);
assert.deepEqual(names,data.controls.map(c=>c.widgetId&&!c.valid?'[no function] '+c.name:c.name));
function note(pitch,velocity) {for(const b of [velocity ? 144:128,pitch,velocity])context.msg_int(b);}
note(49,127); note(49,0);
assert.equal(events.filter(e=>e[0]===0||e[1]==='cue').length,0);
context.mode(1); note(49,127); note(49,0);
assert.deepEqual(events.filter(e=>e[1]==='cue').slice(-2),[[4,'cue',49,127],[4,'cue',49,0]]);
for (const b of [176,49,32,49,96,49,0]) context.msg_int(b);
assert.deepEqual(events.filter(e=>e[1]==='level').slice(-3),
    [[4,'level',49,32],[4,'level',49,96],[4,'level',49,0]], 'Actual Max script forwards continuous CC to Web');
for (const b of [176,20,127,21,26,22,127,23,127]) context.msg_int(b);
assert.deepEqual(events.filter(e=>e[1]==='scene_color').slice(-4),
    [[4,'scene_color',20,127],[4,'scene_color',21,26],[4,'scene_color',22,127],[4,'scene_color',23,127]],
    'Actual Max script forwards global Scene RGB and enable CCs to the worker');
context.scene_color_cc(22,64);assert.equal(namedRGB.scene_blue,64*100/127);context.scene_color_cc(22,127);
assert.equal(namedRGB.scene_red,100);assert.equal(namedRGB.scene_green,26*100/127);assert.equal(namedRGB.scene_blue,100,'Raw CCs update normalized percentage controls');
for(const value of [0,0.25,0.5,0.75,125/127,1]) {
    context.scene_parameter(20,value*100);
    assert.deepEqual(events.filter(e=>e[1]==='scene_color').slice(-1)[0],[4,'scene_color',20,Math.round(value*127)],'Percentage control emits the correct raw7-bit RGB');
}
const invalidStart=events.length;context.scene_parameter(20,101);context.scene_parameter(20,NaN);
assert.equal(events.length,invalidStart);
context.fade_parameter(0, 12.3); context.fade_parameter(1, 100); context.fade_override(1);
assert.deepEqual(events.filter(e=>e[1]==='scene_fade').slice(-1)[0], [4,'scene_fade',1,123,1000], 'Independent percentage fades preserve1ms resolution');
const badFadeStart = events.length;
context.fade_parameter(0, -1); context.fade_parameter(1, 101); context.fade_parameter(0, NaN); context.fade_parameter(2, 25); context.fade_override(2);
assert.equal(events.length, badFadeStart, 'Reject invalid fades and enable state');
context.mode(0); context.fade_parameter(0, 50);
assert.deepEqual(events.filter(e=>e[1]==='scene_fade').slice(-1)[0], [4,'scene_fade',1,500,1000], 'Cache requested fades with Output Off; worker gates application');
context.fade_override(0); context.mode(1);
const page = data.controls.find(c=>c.type==='Page');
assert.equal(names[page.liveNote], '[Page 1] ' + page.pageCaption);
note(page.liveNote,127); note(page.liveNote,0);
assert.deepEqual(events.filter(e=>e[1]==='cue').slice(-2),[[4,'cue',page.liveNote,127],[4,'cue',page.liveNote,0]]);
note(49,127); context.stopped(['is_playing',0]);
assert.deepEqual(events.filter(e=>e[1]==='cue').slice(-1)[0],[4,'cue',49,0]);
context.mode(2); note(49,100); note(49,0);
assert.deepEqual(events.filter(e=>e[0]===0).slice(-6).map(e=>e[1]),[144,49,100,128,49,0]);
const pageStart=events.length; note(page.liveNote,127); note(page.liveNote,0);
assert.equal(events.slice(pageStart).filter(e=>e[0]===0||e[1]==='cue').length,0);
assert(events.slice(pageStart).some(e=>e.includes('Page selection requires Web API output')));
// A second top-level page owns red, while white stays on Page1.
const empty113=data.controls[113];
data.controls[49].pageIndex=1;
data.controls[113]={liveNote:113,note:113,channel:0,widgetId:'page:1',name:'[Page 2] Group B',
    pageCaption:'Group B',pageIndex:1,type:'Page',action:'SelectPage',valid:true};
context.dictionary('data');context.page(2);context.mode(1);
data.controls[113].pageCaption='DFS-3JAZZ / 日本語';
data.controls[113].name='[Page 2] DFS-3JAZZ / 日本語';
const captionsStart=events.length;context.dictionary('renamed');
assert.equal(menuLabels[2],'Page 2 / DFS-3JAZZ / 日本語');
assert.equal(menuLabels.length,3);
assert.equal(menuSelection,2);assert.equal(context.pageNumber,2);
assert.equal(events.slice(captionsStart).filter(e=>e[1]==='cue').length,0);
assert.equal(names[49],data.controls[49].name);assert.equal(names[48],'[other page N48]');
assert.equal(names[113],'[Page 2] DFS-3JAZZ / 日本語');assert.equal(names[112],'[other page N112]');
const scopedStart=events.length;note(48,127);note(48,0);
assert.equal(events.slice(scopedStart).filter(e=>e[1]==='cue').length,0);
note(49,127);context.page(1);
assert.deepEqual(events.filter(e=>e[1]==='cue').slice(-2),[[4,'cue',49,127],[4,'cue',49,0]]);
assert.equal(names[48],data.controls[48].name);assert.equal(names[49],'[other page N49]');
context.page(99);
assert.equal(Object.keys(context.router.map).length,0);
assert.equal(menuSelection,99);assert.equal(menuLabels[99],'Page 99 / (not in workspace)');
assert(events.some(e=>e.includes('Page 99 is not in saved workspace')));
data.controls[49].pageIndex=0;data.controls[113]=empty113;
context.page(0);context.dictionary('data');
assert.equal(menuLabels.length,2);
assert.deepEqual(names,data.controls.map(c=>c.widgetId&&!c.valid?'[no function] '+c.name:c.name));
// QLC's save can briefly produce an unreadable source. Releases must still work.
note(49,127);
dictionaryData={source:data.source,error:'Invalid workspace XML during save'};
context.dictionary('error');
assert.equal(sourceLabel,'Source: workspace-61.qxw');
assert.doesNotThrow(()=>context.stopped(['is_playing',0]));
assert.deepEqual(events.filter(e=>e[1]==='cue').slice(-1)[0],[4,'cue',49,0]);
dictionaryData=data;context.dictionary('recovered');
note(49,127);note(49,0);
assert.deepEqual(events.filter(e=>e[1]==='cue').slice(-2),[[4,'cue',49,127],[4,'cue',49,0]]);
// Explicit cleanup migrates both Arrangement and Session clips, preserving note IDs/data.
data.controls[49].pageIndex=1;data.controls[113]={liveNote:113,note:113,channel:0,widgetId:'page:1',name:'[Page 2] Group B',
    pageCaption:'Group B',pageIndex:1,type:'Page',action:'SelectPage',valid:true};
data.controls[80].type='Button';data.controls[80].action='Flash';data.controls[80].pageIndex=1;
data.controls[80].functionName='999';data.controls[49].functionName='000';
data.controls[80].layoutX=0;data.controls[80].layoutY=0;data.controls[49].layoutX=100;data.controls[49].layoutY=0;
context.dictionary('data');context.page(2);context.mode(0);
const beforeTidy=new Map(Array.from(clipData,([id,notes])=>[id,JSON.parse(JSON.stringify(notes))]));
context.tidy_notes();
const arranged=Array.from(context.noteLayout),inverse=arranged.reduce((m,g,l)=>(m[g]=l,m),{});
assert.deepEqual(arranged.slice(0,2),[80,49],'Initial layout uses VC positions independent of Function names');
assert.equal(arranged[126],113);assert.equal(arranged[127],page.liveNote,'Page selectors occupy the final slots');
assert.equal(new Set(arranged).size,128);assert(savedLayout.startsWith('v2:'));
for(const [id,notes] of clipData) for(let i=0;i<notes.length;i++)
    assert.deepEqual(notes[i],{...beforeTidy.get(id)[i],pitch:inverse[beforeTidy.get(id)[i].pitch]});
assert.equal(names[0],'N0 '+data.controls[80].name.replace(/^N\d+\s+/,''));
assert.equal(names[1],'N1 '+data.controls[49].name.replace(/^N\d+\s+/,''));
assert.equal(names[126],'N126 [Page 2] Group B');
const inactiveCount=data.controls.filter(c=>!c.widgetId||c.removed||!c.valid).length;
assert(names.slice(2,2+inactiveCount).every(n=>n==='\u200b'));
assert(names[127].includes('[other page]'));
context.mode(1);note(1,101);note(1,0);
assert.deepEqual(events.filter(e=>e[1]==='cue').slice(-2),[[4,'cue',49,101],[4,'cue',49,0]]);
context.mode(2);note(1,100);note(1,0);
assert.deepEqual(events.filter(e=>e[0]===0).slice(-6).map(e=>e[1]),[144,49,100,128,49,0]);
context.mode(0);const settled=JSON.stringify(Array.from(clipData));
context.tidy_notes();assert.equal(JSON.stringify(Array.from(clipData)),settled,'Repeated cleanup is idempotent');
// Initial packing still verifies and rolls back partial clip/layout writes.
savedLayout='identity';context.layout_state(savedLayout);
for(const [id,notes] of beforeTidy) clipData.set(id,JSON.parse(JSON.stringify(notes)));
const rawNotes=JSON.stringify(Array.from(clipData));
playing=1;context.tidy_notes();assert.equal(savedLayout,'identity');playing=0;
failClip=502;context.tidy_notes();
assert.equal(JSON.stringify(Array.from(clipData)),rawNotes,'Roll back all clips, including the partially failed clip');
assert.equal(savedLayout,'identity');
failLayout=true;context.tidy_notes();
assert.equal(JSON.stringify(Array.from(clipData)),rawNotes,'A partial pattr write rolls back clip pitches');
assert.equal(savedLayout,'identity');
assert(events.some(e=>String(e[2]).includes('Tidy cancelled:')));
context.tidy_notes();assert.deepEqual(Array.from(context.noteLayout),arranged);
context.layout_state(savedLayout);assert.deepEqual(Array.from(context.noteLayout),arranged);
assert.throws(()=>context.parseLayout('v1:'+Array(128).fill('0').join(',')));
// New cues fill free local rows without renumbering any clip or existing used target.
context.page(2);
data.controls[114]={liveNote:114,note:114,channel:0,widgetId:'new-button',name:'Added cue',functionName:'001-B',
    pageIndex:1,type:'Button',action:'Flash',functionId:'1',valid:true};
context.dictionary('added-button');
assert.deepEqual(Array.from(context.noteLayout).slice(0,3),[80,49,114]);
assert.equal(clipData.get(501)[0].pitch,1,'New controls never move existing notes');
assert.equal(names[2],'N2 Added cue');
// Repeating Tidy on an initialized layout only registers additions.
context.tidy_notes();
const repacked=Array.from(context.noteLayout);
assert.deepEqual(repacked.slice(0,3),[80,49,114]);
assert.equal(clipData.get(501)[0].pitch,1,'Existing slider note remains fixed');
assert.equal(clipData.get(501)[0].note_id,11);
context.mode(1);note(1,90);note(1,0);
assert.deepEqual(events.filter(e=>e[1]==='cue').slice(-2),[[4,'cue',49,90],[4,'cue',49,0]]);
missing=true; context.syncLabels(); context.mode(0); context.mode(2);
const before=events.length; note(49,127); note(49,0);
assert.equal(events.slice(before).filter(e=>e[0]===0).length,0);
context.notifydeleted();
missing=false;context.mode(0);data.controls[colorControl.liveNote]=colorControl;
const previousNotes=JSON.parse(JSON.stringify(Array.from(clipData)));
context.dictionary('color-note');context.tidy_notes();
const colorLocal=context.noteLayout.indexOf(colorControl.liveNote);
assert.equal(colorLocal,3,'An added Color Override never evicts already placed controls');
assert.equal(names[colorLocal],'N3 Color Override');
for(const [id,notes] of previousNotes) assert.deepEqual(clipData.get(id).map(n=>({...n,pitch:0})),notes.map(n=>({...n,pitch:0})));
context.scene_parameter(20,80*100/127);context.scene_parameter(21,12*100/127);context.scene_parameter(22,100*100/127);
context.mode(1);const colorStart=events.length;note(colorLocal,90);note(colorLocal,70);note(colorLocal,0);
assert.deepEqual(events.filter(e=>e[1]==='scene_color').slice(-1)[0],[4,'scene_color',23,127], 'Overlapping notes keep override enabled');
note(colorLocal,0);
assert.deepEqual(events.slice(colorStart).filter(e=>e[1]==='scene_color').slice(0,4),
    [[4,'scene_color',20,80],[4,'scene_color',21,12],[4,'scene_color',22,100],[4,'scene_color',23,127]]);
assert.deepEqual(events.filter(e=>e[1]==='scene_color').slice(-1)[0],[4,'scene_color',23,0]);
assert(!events.slice(colorStart).some(e=>e[1]==='cue'||e[0]===0),'Override notes never trigger a QLC widget or MIDI output');
note(colorLocal,100);context.panic();assert.deepEqual(events.filter(e=>e[1]==='scene_color').slice(-1)[0],[4,'scene_color',23,0]);
context.mode(0);const gated=events.length;note(colorLocal,100);note(colorLocal,0);context.scene_parameter(20,40*100/127);
assert(!events.slice(gated).some(e=>e[1]==='scene_color'));
console.log('PASS: Max labels, saved routing, note migration/rollback, named RGB, percentage RGB conversion, fixed override hold/overlap/release/panic and output gates.');

context.brightness_override(1);context.brightness_parameter(67.5);
assert.equal(context.brightnessEnabled,1);assert.equal(context.brightnessValue,67.5);
context.brightness_override(0);assert.equal(context.brightnessEnabled,0);
context.brightness_parameter(101);assert.equal(context.brightnessValue,67.5);
context.rgb_brightness_override(1);context.rgb_brightness_parameter(82.5);
assert.equal(context.rgbBrightnessEnabled,1);assert.equal(context.rgbBrightnessValue,82.5);
assert.deepEqual(events.filter(e=>e[1]==='rgb_brightness').slice(-1)[0],[4,'rgb_brightness',1,82.5]);
assert.equal(context.brightnessEnabled,0);assert.equal(context.brightnessValue,67.5,'RGB controls leave full brightness state unchanged');
const beforeBadRGB=events.length;
context.rgb_brightness_parameter(101);context.rgb_brightness_parameter(NaN);context.rgb_brightness_override(2);
assert.equal(events.length,beforeBadRGB);
context.rgb_brightness_override(0);assert.equal(context.rgbBrightnessEnabled,0);

{
 const before=JSON.stringify([...clipData]);
 const slots=Array.from({length:2048},(_,i)=>({liveNote:i%128,note:i%128,channel:Math.floor(i/128),valid:false}));
 const shared={liveNote:10,note:10,channel:0,widgetId:'9900',name:'Common RGB',type:'Button',action:'Flash',valid:true,shared:true};slots[10]=shared;
 const views=[1,2].map(channel=>Array.from({length:128},(_,note)=>note===10?{...shared}:{...slots[channel*128+note]}));
 for(let page=0;page<2;page++){const cue={liveNote:5,note:5,channel:page+1,widgetId:String(9910+page),name:'Page cue',type:'Button',action:'Flash',valid:true};slots[(page+1)*128+5]=cue;views[page][5]=cue;}
 dictionaryData={schema:2,source:'pages',controls:slots,pageViews:views,defaultLayout:Array.from({length:128},(_,i)=>i),defaultPage:0};
 context.dictionary('data');context.mode(1);context.page(1);let start=events.length;note(5,100);note(5,0);note(10,100);note(10,0);
 assert.deepEqual(events.slice(start).filter(e=>e[1]==='cue').map(e=>e.slice(2)),[[133,100],[133,0],[10,100],[10,0]]);
 context.page(2);start=events.length;note(5,100);note(5,0);note(10,100);note(10,0);
 assert.deepEqual(events.slice(start).filter(e=>e[1]==='cue').map(e=>e.slice(2)),[[261,100],[261,0],[10,100],[10,0]]);
 assert.equal(JSON.stringify([...clipData]),before,'Page changes never rewrite existing clip notes');
 console.log('PASS: actual Max ES5 page-channel callbacks, identical common RGB rows and unchanged clip notes');
}

menuSelection=2;context.pageNumber=1;context.live_ready();assert.equal(context.pageNumber,2,'Read saved page on startup before worker fallback');

// Exercise actual ES5 source callbacks with pattr and conformpath feedback models.
for (const deferred of [false, true]) {
    let stored = '<PATH>', setPath = '<PATH>';
    let apiUnavailable = false, writes = 0;
    const requests = [], pending = [];
    const sourceParameter = {getvalueof: () => stored};
    let ctx;
    ctx = vm.createContext({arrayfromargs: a => Array.from(a),
        patcher: {getnamed: name => name === 'source_path' ? sourceParameter : null},
        LiveAPI: function() { this.get = key => {
            assert.equal(key, 'file_path');
            if (apiUnavailable) throw Error('Runtime file_path unavailable');
            return [setPath];
        }; },
        include: name => vm.runInContext(fs.readFileSync(name, 'utf8'), ctx),
        outlet: (index, selector, value) => {
            if (index === 4 && selector === 'source_context') requests.push(value);
            if (index === 3 && selector !== 'bang') {
                assert(++writes < 4, 'Write-back must terminate');
                stored = selector;
                const echo = () => ctx.source('/Max/Application/' + stored); // Deliberate conformpath expansion.
                if (deferred) pending.push(echo); else echo();
            }
        }});
    vm.runInContext(fs.readFileSync('qlc-live.js', 'utf8'), ctx);
    ctx.workerReady = true;
    ctx.source(stored);
    const first = requests[0];
    assert.deepEqual(JSON.parse(first), {source: stored, setPath});
    ctx.source_stored(JSON.stringify({request: first, stored: '../Lighting/main.qxw'}));
    pending.splice(0).forEach(fn => fn());
    assert.equal(stored, '../Lighting/main.qxw');
    assert.equal(writes, 1); assert.equal(requests.length, 1, 'No immediate or deferred write-back loop');
    ctx.source_stored(JSON.stringify({request: first, stored: '../Lighting/main.qxw'}));
    assert.equal(writes, 1, 'Duplicate/stale replies do not write');

    // Loading on Mac/moving the Set reuses the raw relative pattr, not Max's expansion.
    setPath = '/Volumes/Shows/Show 日本語/Sets/Main.als';
    ctx.source('/Max/Application/Lighting/main.qxw');
    assert.deepEqual(JSON.parse(requests[1]), {source: '../Lighting/main.qxw', setPath});
    stored = '/new/other.qxw'; ctx.source(stored);
    ctx.source_stored(JSON.stringify({request: requests[1], stored: '../old.qxw'}));
    assert.equal(stored, '/new/other.qxw', 'A previous selection cannot overwrite a newer choice');
    setPath = ''; ctx.source(stored);
    assert.equal(JSON.parse(requests[3]).setPath, '', 'Unsaved Set is sent as empty');
    apiUnavailable = true; stored = '/new/third.qxw'; ctx.source(stored);
    assert.equal(JSON.parse(requests[4]).setPath, '', 'Unsupported API keeps existing absolute behavior');
    apiUnavailable = false; setPath = '/new/Sets/First Save.als';
    assert.equal(requests.length, 5, 'First save alone adds no observer or migration mechanism');
    ctx.source(stored); // An explicit reselection/reload reads the newly saved location.
    assert.equal(JSON.parse(requests[5]).setPath, setPath);
}
console.log('PASS: actual Max source callbacks, Live Set file_path, raw relative pattr survives simulated conformpath expansion, immediate/deferred feedback and stale-reply guards.');
