'use strict';
// Actual Max script against an isolated Live API model; never opens a MIDI port.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const {parseWorkspace, allocate, snapshot} = require('./source');

function model(options = {}) {
    const controls = Array.from({length:128}, (_,pitch) => ({liveNote:pitch,note:pitch,channel:0,
        widgetId:null,name:'empty',valid:false}));
    for (let i=0;i<4;i++) controls[114+i] = {...controls[114+i],widgetId:String(16+i),
        name:String(i+1).padStart(3,'0'),type:'Button',action:'Flash',pageIndex:1,layoutX:i*100,layoutY:0,valid:true};
    controls[113] = {...controls[113],widgetId:'page:1',name:'[Page 2] Test',pageCaption:'Test',
        type:'Page',action:'SelectPage',pageIndex:1,valid:true};
    controls[112] = {...controls[112],widgetId:'page:0',name:'[Page 1] Other',pageCaption:'Other',
        type:'Page',action:'SelectPage',pageIndex:0,valid:true};
    if(options.initialCue) controls[118]={...controls[118],widgetId:'20',name:'005',
        type:'Button',action:'Flash',pageIndex:1,layoutX:400,layoutY:0,valid:true};
    const layout = options.layout ? options.layout.slice() : [114,115,116,117,...Array.from({length:128},(_,i)=>i)
        .filter(i=>![114,115,116,117,112,113].includes(i)),113,112];
    function put(local,global) { const source=layout.indexOf(global); [layout[local],layout[source]]=[layout[source],layout[local]]; }
    if (options.reservations) {
        controls[60] = {...controls[60],widgetId:'removed',removed:true}; put(4,60);
        controls[70] = {...controls[70],widgetId:'unconfigured'}; put(5,70);
        controls[36] = {...controls[36],widgetId:'other-page',type:'Slider',pageIndex:0,valid:true}; put(6,36);
    }
    if (options.sourceControls) controls.splice(0,128,...options.sourceControls);
    const original = layout.slice(), oldCuePitch = layout.indexOf(118);
    const notes = new Map([[501,[{note_id:1,pitch:0,start_time:0,duration:2,velocity:90,probability:0.75},
        {note_id:2,pitch:3,start_time:2,duration:0.125,velocity:127,mute:1}]],
        [502,[{note_id:3,pitch:options.usedDestination ? 4 : options.usedSource ? oldCuePitch : 1,
            start_time:-1,duration:8,velocity:100,release_velocity:64}]]]);
    if(options.additionalNotes) notes.get(502).push(...options.additionalNotes);
    const beforeNotes = JSON.stringify(Array.from(notes));
    let saved = options.saved || (options.identity ? 'identity' : 'v1:'+layout.join(',')), playing=options.playing || 0;
    let readFailure=false, writeFailures=0, noteWrites=0;
    const names = Array(128).fill(''), events=[];
    let context;
    function LiveAPI(callback,address) {
        this.id=address==='this_device'?1:address==='live_set'?999:Number(address.slice(3));
        this.get = key => {
            if (this.id===999 && key==='is_playing') return [playing];
            if (this.id===1 && key==='canonical_parent') return ['id',2];
            if (this.id===2 && key==='has_midi_input') return [1];
            if (this.id===2 && key==='devices') return ['id',1,'id',3];
            if (this.id===2 && key==='arrangement_clips') return ['id',501];
            if (this.id===2 && key==='clip_slots') return ['id',600,'id',601];
            if (this.id===600 && key==='clip') return ['id',501];
            if (this.id===601 && key==='clip') return ['id',502];
            if (notes.has(this.id) && key==='is_midi_clip') return [1];
            if (this.id===3 && key==='name') return ['QLC Live Auto Labels'];
            if (this.id===3 && key==='chains') return names.flatMap((_,i)=>['id',100+i]);
            if (this.id===3 && key==='parameters') return [];
            if (this.id>=100 && this.id<228 && key==='name') return [names[this.id-100]];
            return [];
        };
        this.set = (key,value) => { if(key==='name') names[this.id-100]=value; };
        this.call = (method, data) => {
            if(method==='get_all_notes_extended') {
                if(readFailure) throw Error('Injected clip read failure');
                return [JSON.stringify({notes:notes.get(this.id)})];
            }
            if(method==='apply_note_modifications') { noteWrites++; notes.set(this.id,JSON.parse(data).notes); return []; }
            throw Error('Unexpected API call '+method);
        };
    }
    const parameter={message(...atoms) {
        if(atoms[0]!=='bang') saved=atoms.join(' ');
        if(writeFailures) { writeFailures--; throw Error('Injected layout persistence failure'); }
        context.layout_state(saved);
    }};
    context=vm.createContext({LiveAPI,outlet:(...e)=>events.push(e),arrayfromargs:a=>Array.from(a),
        Dict:function(){this.stringify=()=>JSON.stringify({source:'isolated.qxw',controls});},
        Task:function(){this.cancel=()=>{};this.repeat=()=>{};},
        patcher:{getnamed:name=>name==='note_layout'?parameter:{message(){},getvalueof(){return 0;}}},
        include:name=>vm.runInContext(fs.readFileSync(name,'utf8'),context)});
    vm.runInContext(fs.readFileSync('qlc-live.js','utf8'),context);
    context.live_ready(); context.watcher_ready(); context.page(2); context.dictionary('initial');
    function add() {
        controls[118]={...controls[118],widgetId:'20',name:'005',type:'Button',action:'Flash',pageIndex:1,layoutX:400,layoutY:0,valid:true};
        context.dictionary('added');
    }
    function note(pitch,velocity) { for(const byte of [velocity?144:128,pitch,velocity])context.msg_int(byte); }
    return {context,controls,names,events,notes,original,oldCuePitch,add,note,
        setPlaying:value=>{playing=value;},setReadFailure:value=>{readFailure=value;},
        setWriteFailures:value=>{writeFailures=value;},saved:()=>saved,noteWrites:()=>noteWrites,
        unchanged:()=>{for(const [id,oldNotes] of JSON.parse(beforeNotes)) {
            const actual=notes.get(id); assert.deepEqual(actual,oldNotes,'Automatic registration never edits clip notes');
            oldNotes.forEach((n,i)=>{assert.equal(context.noteLayout[actual[i].pitch],(options.identity ? n.pitch : original[n.pitch]),'Each note still addresses its original global target');
                assert.deepEqual({...actual[i],pitch:n.pitch},n,'Only pitch may change');});
        }}};
}

let m=model(); m.add();
assert.deepEqual(Array.from(m.context.noteLayout).slice(0,5),[114,115,116,117,118]);
assert.equal(m.names[4],'N4 005'); m.unchanged(); assert.equal(m.noteWrites(),0);
const settled=m.saved();m.context.dictionary('again');assert.equal(m.saved(),settled,'Repeated sync is idempotent');
let loaded=model({initialCue:true});
assert.deepEqual(Array.from(loaded.context.noteLayout),loaded.original,'Upgrade freezes the current layout, including existing high rows');loaded.unchanged();
loaded=model({initialCue:true,saved:settled});assert.equal(loaded.saved(),settled,'Saved placement survives reload');loaded.unchanged();
const baseline=model().saved();
loaded=model({initialCue:true,saved:baseline});assert.equal(loaded.context.noteLayout[4],118,'An addition while Live is closed is detected on reload');loaded.unchanged();
m.context.mode(1);m.note(4,96);m.note(4,0);m.note(0,90);m.note(0,0);
assert.deepEqual(m.events.filter(e=>e[1]==='cue').slice(-4),
    [[4,'cue',118,96],[4,'cue',118,0],[4,'cue',114,90],[4,'cue',114,0]]);
m.controls[117].name='999 imported scene';m.controls[117].functionName='000';
m.controls[117].layoutX=-100;m.controls[117].layoutY=-100;m.context.dictionary('rename-move');
assert.equal(m.saved(),settled);assert.equal(m.names[3],'N3 999 imported scene');m.unchanged();
m.context.mode(0);m.context.tidy_notes();assert.equal(m.saved(),settled,'Repeated Tidy never reorders already placed controls');m.unchanged();

m=model({usedDestination:true});m.add();
assert.equal(m.context.noteLayout[5],118,'A note on an empty destination reserves that row');m.unchanged();
m=model({usedSource:true});m.add();
assert.equal(m.context.noteLayout[m.oldCuePitch],118,'A note already on the new target keeps its row');m.unchanged();
m=model({reservations:true});m.add();
assert.equal(m.context.noteLayout[4],118,'An unreferenced deleted row can be reused');
assert.equal(m.context.noteLayout[5],70,'A cleared, still existing widget retains its row');
assert.equal(m.context.noteLayout[6],36,'Other-page controls retain their rows');
assert.deepEqual(Array.from(m.context.noteLayout).slice(-2),[113,112]);m.unchanged();

m=model({playing:1});m.add();assert.deepEqual(Array.from(m.context.noteLayout),m.original);
m.setPlaying(0);m.context.stopped(['is_playing',0]);assert.equal(m.context.noteLayout[4],118);m.unchanged();
m=model();m.context.mode(1);m.note(0,100);m.add();
assert.deepEqual(Array.from(m.context.noteLayout),m.original,'Held input defers registration');
m.note(0,0);m.context.syncLabels();assert.equal(m.context.noteLayout[4],118);
assert.deepEqual(m.events.filter(e=>e[1]==='cue').slice(-1)[0],[4,'cue',114,0]);m.unchanged();
m=model();m.context.mode(1);m.context.msg_int(144);m.context.msg_int(0);m.add();
assert.deepEqual(Array.from(m.context.noteLayout),m.original,'A partial Note On cannot cross registration');
m.context.msg_int(100);m.note(0,0);m.context.syncLabels();assert.equal(m.context.noteLayout[4],118);m.unchanged();

m=model();m.setReadFailure(true);m.add();assert.deepEqual(Array.from(m.context.noteLayout),m.original);
m.setReadFailure(false);m.context.syncLabels();assert.equal(m.context.noteLayout[4],118);m.unchanged();
m=model();const oldSaved=m.saved();m.setWriteFailures(1);m.add();
assert.equal(m.saved(),oldSaved,'Failed persistence restores the previous state');
assert.deepEqual(Array.from(m.context.noteLayout),m.original);m.unchanged();
m.context.dictionary('retry');assert.equal(m.context.noteLayout[4],118);
m=model();m.setWriteFailures(2);m.add();m.context.syncLabels();
assert.equal(m.context.labelsReady,false);assert.equal(m.context.router.enabled,false,'Failed rollback cannot reopen output');m.unchanged();
m=model({identity:true});m.add();assert.equal(m.saved(),'identity','Uninitialized layouts remain unchanged');m.unchanged();

// Delete, then recreate even with the same widget ID: the source allocator assigns a fresh stable pitch.
m=model();m.controls[114]={...m.controls[114],removed:true,valid:false};m.context.dictionary('delete');
assert.equal(m.names[0],'\u200b');assert.deepEqual(Array.from(m.context.noteLayout),m.original);
m.add();m.controls[118].widgetId='16';m.context.dictionary('reused-id');
assert.equal(m.context.noteLayout[0],114,'Deleted row with existing notes stays reserved');
assert.equal(m.context.noteLayout[4],118);m.context.mode(1);const start=m.events.length;m.note(0,100);m.note(0,0);m.note(4,100);m.note(4,0);
assert.deepEqual(m.events.slice(start).filter(e=>e[1]==='cue'),[[4,'cue',118,100],[4,'cue',118,0]],'Old notes never trigger the replacement button');m.unchanged();
m=model();m.controls[116]={...m.controls[116],removed:true,valid:false};m.context.dictionary('delete-unused');m.add();
assert.equal(m.context.noteLayout[2],116,'An interior deleted row stays empty while tail space is available');
assert.equal(m.context.noteLayout[4],118,'New cues continue after established cues');
assert.equal(m.context.noteLayout[3],117,'Deletion never compacts surviving controls');m.unchanged();
// Interior gaps must not split new groups, even when cues are saved one at a time.
m=model();m.controls[116]={...m.controls[116],removed:true,valid:false};m.context.dictionary('interior-hole');
m.add();
for (let i=0;i<2;i++) {
    m.controls[119+i]={...m.controls[119+i],widgetId:String(21+i),name:'Imported '+i,
        type:'Button',action:'Flash',pageIndex:1,layoutX:600+i*100,layoutY:0,valid:true};
    m.context.dictionary('serial-addition');
}
assert.deepEqual(Array.from(m.context.noteLayout).slice(2,7),[116,117,118,119,120]);
m.unchanged();assert.equal(m.noteWrites(),0);
// A gap can still be used when there is no available tail row.
let fullControls=model().controls, fullLayout=model().original;
for(let i=4;i<126;i++) {
    const global=fullLayout[i];if(global===118)continue;
    fullControls[global]={...fullControls[global],widgetId:'full-'+i,type:'Button',pageIndex:1,valid:true};
}
m=model({sourceControls:fullControls});m.controls[116]={...m.controls[116],removed:true,valid:false};
m.context.dictionary('delete-full-tail');m.add();
assert.equal(m.context.noteLayout[2],118,'Exhausted tail falls back to an unreferenced gap');m.unchanged();
m=model();m.controls[116].valid=false;m.context.dictionary('clear');m.add();
assert.equal(m.context.noteLayout[2],116);m.controls[116].valid=true;m.context.dictionary('reattach');
assert.equal(m.context.noteLayout[2],116,'Detach and reattach preserve the original row');m.unchanged();

// A batch of imported names follows VC position only for the new controls.
m=model();m.controls[119]={...m.controls[119],widgetId:'21',name:'000',functionName:'000',type:'Button',action:'Flash',pageIndex:1,layoutX:600,layoutY:0,valid:true};
m.controls[118]={...m.controls[118],widgetId:'20',name:'zzz',functionName:'999',type:'Button',action:'Flash',pageIndex:1,layoutX:500,layoutY:0,valid:true};
m.context.dictionary('batch');assert.deepEqual(Array.from(m.context.noteLayout).slice(0,6),[114,115,116,117,118,119]);m.unchanged();
assert.equal(m.noteWrites(),0);
assert.throws(()=>m.context.parsePlacedTargets('v2:'+m.original.join(',')+'|1,1'));
assert.throws(()=>m.context.parsePlacedTargets('v2:'+m.original.join(',')+'|128'));
assert.throws(()=>m.context.parsePlacedTargets('v2:'+m.original.join(',')));
// Regression: allocator wraps127 ->1 while a new batch occupies low provisional rows.
// One button has already been placed; the rest arrive together on a later save.
const wrapLayout=[114,115,116,117,...Array.from({length:127},(_,i)=>i+1)
    .filter(i=>![114,115,116,117,112,113].includes(i)),0,113,112];
function addWrappedGroup(model) {
    function add(pitch,number) { model.controls[pitch]={...model.controls[pitch],widgetId:String(25+number),
        name:'Red Bottom '+String(number).padStart(2,'0'),type:'Button',action:'Flash',pageIndex:1,
        layoutX:(number-1)*111,layoutY:117,valid:true}; }
    add(125,1);model.context.dictionary('first-wrapped-button');
    for(const [pitch,number] of [[127,7],[1,6],[2,5],[3,4],[126,2],[4,3]])add(pitch,number);
    model.context.dictionary('remaining-wrapped-batch');
}
m=model({layout:wrapLayout});addWrappedGroup(m);
assert.deepEqual(Array.from(m.context.noteLayout).slice(4,11),[125,126,4,3,2,1,127],
    'A wrapped batch uses provisional rows together, in VC order, without reusing a destination');
assert.deepEqual(m.names.slice(4,11),[1,2,3,4,5,6,7].map(i=>'N'+(3+i)+' Red Bottom 0'+i));
assert.deepEqual(Array.from(m.context.noteLayout).slice(0,4),[114,115,116,117]);
assert.equal(new Set(m.context.noteLayout).size,128);m.unchanged();assert.equal(m.noteWrites(),0);
const wrappedSaved=m.saved();m.context.dictionary('repeat-wrapped-batch');assert.equal(m.saved(),wrappedSaved);
loaded=model({layout:wrapLayout,sourceControls:m.controls,saved:wrappedSaved});assert.equal(loaded.saved(),wrappedSaved);
// Written notes in a provisional row reserve it even while other new controls move.
m=model({layout:wrapLayout,additionalNotes:[{note_id:4,pitch:6,start_time:12,duration:2,velocity:99,mute:1}]});
addWrappedGroup(m);assert.equal(m.context.noteLayout[6],3,'A Session note reserves the provisional source row');
assert.equal(new Set(m.context.noteLayout).size,128);m.unchanged();assert.equal(m.noteWrites(),0);
// All new controls arriving together must also be independent of their global pitch order.
m=model({layout:wrapLayout});
for(const [pitch,number] of [[127,7],[1,6],[2,5],[3,4],[126,2],[4,3],[125,1]])
    m.controls[pitch]={...m.controls[pitch],widgetId:String(25+number),name:'Imported '+number,
        type:'Button',action:'Flash',pageIndex:1,layoutX:number*111,layoutY:117,valid:true};
m.context.dictionary('one-wrapped-batch');
assert.deepEqual(Array.from(m.context.noteLayout).slice(4,11),[125,126,4,3,2,1,127]);m.unchanged();
// Full saved-XML -> tombstone registry -> actual Max script, including reused numeric IDs.
const xml=(omitFirst=false)=>`<Workspace xmlns="http://www.qlcplus.org/Workspace"><Engine>
${[0,1,2,3].map(i=>`<Function ID="${1000+i}" Type="Scene" Name="${999-i}"/>`).join('')}</Engine><VirtualConsole>
<Frame Caption="Other"/><Frame Caption="Test"><WindowState X="900" Y="900"/>
<Frame ID="15"><WindowState X="100" Y="200"/>
${[0,1,2,3].filter(i=>!omitFirst||i).map(i=>`<Button ID="${16+i}" Caption="${999-i}"><WindowState X="${i*100+7}" Y="8"/><Function ID="${1000+i}"/><Action>Flash</Action></Button>`).join('')}
</Frame></Frame></VirtualConsole></Workspace>`;
let realControls=parseWorkspace(xml());
assert.deepEqual([realControls[0].layoutX,realControls[0].layoutY],[107,208],'Nested frame offsets count; top-level page window position does not');
let realRegistry=allocate(realControls,{version:1,bindings:[...[0,1,2,3].map(i=>({widgetId:String(16+i),liveNote:114+i})),
    {widgetId:'page:0',liveNote:112},{widgetId:'page:1',liveNote:113},{widgetId:'scene-color',liveNote:0}]});
m=model({sourceControls:snapshot(realControls,realRegistry,'test.qxw','1').controls});
assert.deepEqual(Array.from(m.context.tidyLayout(m.controls,2)).slice(0,5),[0,114,115,116,117],'Initial VC order ignores reverse numeric names');
realControls=parseWorkspace(xml(true));realRegistry=allocate(realControls,realRegistry);
m.controls.splice(0,128,...snapshot(realControls,realRegistry,'test.qxw','2').controls);m.context.dictionary('saved-delete');
realControls=parseWorkspace(xml());realRegistry=allocate(realControls,realRegistry);
const replacement=realRegistry.bindings.find(b=>b.widgetId==='16'&&!b.retired).liveNote;
assert.equal(replacement,118);
m.controls.splice(0,128,...snapshot(realControls,realRegistry,'test.qxw','3').controls);m.context.dictionary('saved-recreate');
assert.equal(m.context.noteLayout[0],114);assert.equal(m.context.noteLayout[5],118);
m.context.mode(1);const routed=m.events.length;m.note(0,100);m.note(0,0);m.note(5,100);m.note(5,0);
assert.deepEqual(m.events.slice(routed).filter(e=>e[1]==='cue'),[[4,'cue',118,100],[4,'cue',118,0]]);m.unchanged();
const savedReplacement=m.saved();
loaded=model({sourceControls:m.controls,saved:savedReplacement});assert.equal(loaded.saved(),savedReplacement,'Deleted reservations and replacement rows survive Set reload');
// Reproduce Blue Top01 at N22, with existing Blue Bottom atN23-29.
const hole=JSON.parse(fs.readFileSync('test-fixtures/interior-hole.json','utf8'));
function realHole(){return model({layout:hole.saved.slice(3).split('|')[0].split(',').map(Number),saved:hole.saved,sourceControls:hole.controls.slice()});}
function addReal(model,control){model.controls[control.liveNote]={...control};}
for(const serial of [false,true]){
    m=realHole();
    const first=hole.additions.find(c=>c.name==='Blue Top 01');
    if(serial){addReal(m,first);m.context.dictionary('BlueTop01-saved-first');}
    for(const c of hole.additions)addReal(m,c);
    m.context.dictionary('Blue-and-Red-Top-added');
    assert.equal(m.names[22],'\u200b','The old interior hole stays empty');
    assert.deepEqual(m.names.slice(23,30),[1,2,3,4,5,6,7].map(i=>'N'+(22+i)+' Blue Bottom 0'+i));
    assert.deepEqual(m.names.slice(30,44),['Blue','Red'].flatMap((color,j)=>[1,2,3,4,5,6,7].map(i=>'N'+(29+j*7+i)+' '+color+' Top 0'+i)),
        'Imported groups stay consecutive for one batch or serial saves');
    m.unchanged();assert.equal(m.noteWrites(),0);
    const saved=m.saved();m.context.dictionary('repeat');assert.equal(m.saved(),saved);
    loaded=model({layout:m.original,sourceControls:m.controls,saved});assert.equal(loaded.saved(),saved);
}
console.log('PASS: tail-first additions across interior holes and pitch wrap, serial/batch imports, frozen existing rows, capacity fallback, delete/recreate safety, exact clip preservation, routing, deferral and persistence rollback.');
