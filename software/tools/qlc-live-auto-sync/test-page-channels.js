'use strict';
// Pure registry/router/export tests. No Live, MIDI ports or physical outputs.
const assert=require('assert'), pages=require('./page-registry');
const {validateRegistry,allocate,snapshot}=require('./source');
const {CueState,matchingProject}=require('./web-bridge');
const Router=require('./midi-router'),{exportMidi}=require('./export-midi');
const {DOMParser}=require('@xmldom/xmldom');
const identity=Array.from({length:128},(_,i)=>i);
const common=Array.from({length:42},(_,i)=>({widgetId:String(1000+i),name:'Shared '+i,type:'Button',action:'Flash',valid:true,pageIndex:0,layoutX:i,layoutY:0}));
const controls=[...common];
for(let page=0;page<2;page++) {
 controls.push({widgetId:'page:'+page,type:'Page',name:'Page '+page,pageCaption:'Page '+page,pageIndex:page,valid:true});
 for(let i=0;i<80;i++) controls.push({widgetId:String(2000+page*100+i),name:'Cue '+page+':'+i,type:'Button',action:'Flash',valid:true,pageIndex:page,layoutY:1,layoutX:i});
}
const seed={version:2,defaultLayout:identity,defaultPage:0,commonWidgetIds:common.map(c=>c.widgetId),bindings:[{widgetId:'scene-color',channel:0,liveNote:0},...common.map((c,i)=>({widgetId:c.widgetId,channel:0,liveNote:i+1}))]};
const registry=allocate(controls,seed),data=snapshot(controls,registry,'test','1');
assert.equal(registry.deferred.length,0);assert(registry.bindings.length>128);
assert.equal(data.controls.length,2048);assert.equal(data.pageViews.length,2);
for(let i=0;i<43;i++) assert.deepEqual(data.pageViews[0][i],data.pageViews[1][i]);
const one=registry.bindings.find(b=>b.widgetId==='2000'),two=registry.bindings.find(b=>b.widgetId==='2100');
assert.equal(one.liveNote,two.liveNote);assert.equal(one.channel,1);assert.equal(two.channel,2);
const packets=[],router=new Router(p=>packets.push(p));
router.update(data.pageViews[0]);router.packet([144,one.liveNote,127]);router.packet([128,one.liveNote,0]);
router.update(data.pageViews[1]);router.packet([144,two.liveNote,127]);router.packet([128,two.liveNote,0]);
assert.deepEqual(packets,[[145,one.liveNote,127],[129,one.liveNote,0],[146,two.liveNote,127],[130,two.liveNote,0]]);
const commands=[],state=new CueState(s=>commands.push(s));state.update(data);
state.note(pages.key(one),127);state.note(pages.key(two),127);state.note(pages.key(one),0);state.note(pages.key(two),0);
assert.deepEqual(commands,['2000|255','2100|255','2000|0','2100|0']);
// Remapping between Note On and Off must release the captured channel/target.
packets.length=0;router.update(data.pageViews[0]);router.packet([144,one.liveNote,90]);router.update(data.pageViews[1]);router.packet([128,one.liveNote,0]);
assert.deepEqual(packets,[[145,one.liveNote,90],[129,one.liveNote,0]]);
const removed=allocate(controls.filter(c=>c.widgetId!=='2000'),registry);
const recreated=allocate(controls,removed);const replacement=recreated.bindings.find(b=>!b.retired&&b.widgetId==='2000');
assert.notEqual(replacement.liveNote,one.liveNote);assert.equal(replacement.channel,one.channel);
assert.deepEqual(recreated.bindings.find(b=>!b.retired&&b.widgetId==='2100'),two);
// One full page defers only its new controls; other pages and existing cues run.
const extra={widgetId:'9999',name:'Overflow',type:'Button',action:'Flash',valid:true,pageIndex:0};
const full=JSON.parse(JSON.stringify(registry));
for(let n=0;n<128;n++) if(!full.bindings.some(b=>(b.channel===0||b.channel===1)&&b.liveNote===n)) full.bindings.push({widgetId:String(8000+n),channel:1,liveNote:n,retired:true});
const overflow=allocate([...controls,extra],full);assert(overflow.deferred.some(c=>c.widgetId==='9999'));
assert(snapshot([...controls,extra],overflow,'test','2').controls[pages.key(two)].valid);
const bad=JSON.parse(JSON.stringify(registry));bad.bindings.push({...one,widgetId:'9998'});assert.throws(()=>validateRegistry(bad));
assert.throws(()=>allocate([...controls,{widgetId:'page:15',type:'Page',pageIndex:15,valid:true}],registry));
// Native QLC channel encoding: 4096*channel + 128 + note.
const xml='<Workspace xmlns="http://www.qlcplus.org/Workspace"><Engine><InputOutputMap><Universe ID="0"/></InputOutputMap><Function ID="1" Type="Scene" Name="one"/></Engine><VirtualConsole><Frame Caption="P"><Button ID="2000" Caption="one"><Action>Flash</Action><Function ID="1"/></Button></Frame></VirtualConsole></Workspace>';
const exported=new DOMParser().parseFromString(exportMidi(xml,registry),'text/xml');
const input=exported.getElementsByTagName('Button')[0].getElementsByTagName('Input')[0];
assert.equal(Number(input.getAttribute('Channel')),4096*one.channel+128+one.liveNote);
assert.equal(exported.getElementsByTagName('VirtualConsole')[0].getAttribute('MIDIPageChannels'),'True');
console.log('PASS: >128 targets, page channels, 42 shared rows, exact MIDI/Web routing, held releases, page-local tombstones, overflow isolation and MIDI export');

// Top-level page IDs are tab indices and can collide with actual widget IDs.
const collision={pages:[{index:0,caption:'A',id:0,typeId:4,children:[{id:2,typeId:1,caption:'Cue',actionType:1,functionId:9}]},{index:2,id:2,typeId:4,caption:'C',children:[]}]};
assert(matchingProject({controls:[{widgetId:'2',name:'Cue',type:'Button',action:'Flash',functionId:'9'}]},collision));
