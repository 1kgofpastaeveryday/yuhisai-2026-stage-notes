'use strict';
// Offline routing and state tests. No QLC, Live, MIDI port or DMX connection.
const assert = require('assert');
const MidiRouter = require('./midi-router');
const {CueState} = require('./web-bridge');
const {allocate,validateRegistry} = require('./source');
const sliders = [{widgetId:'1',type:'Slider',valid:true,preferred:48},
    {widgetId:'2',type:'Slider',valid:true,preferred:49}];
const registry = allocate(sliders);
assert.deepEqual(registry.bindings.filter(b=>b.ccNumber!==undefined).map(b=>b.ccNumber),[48,49]);
assert.deepEqual(allocate(sliders.slice().reverse(),registry),registry,'Slider CC assignments persist across source reordering');
const duplicate = JSON.parse(JSON.stringify(registry));duplicate.bindings[1].ccNumber=48;
assert.throws(()=>validateRegistry(duplicate),/CC binding/);
const output = [], packets = [];
const controls = Array.from({length:128}, () => ({valid:false}));
controls[119] = {valid:true, type:'Slider', widgetId:'121'};
controls[118] = {valid:true, type:'Slider', widgetId:'120'};
controls[117] = {valid:true, type:'Button', widgetId:'19', action:'Toggle'};
const state = new CueState(message => output.push(message));
state.update({controls});
const router = new MidiRouter(packet => packets.push(packet), null,
    (cc, channel, note, value) => state.level(note, value));
router.update([
    {valid:true, liveNote:5, ccNumber:5, channel:0, note:119, type:'Slider'},
    {valid:true, liveNote:6, ccNumber:6, channel:0, note:118, type:'Slider'},
    {valid:true, liveNote:3, channel:0, note:117, type:'Button'}
]);
function cc(number, value) { for (const b of [176,number,value]) router.byte(b); }
for (let value=127; value>=0; value--) { cc(5,value); cc(6,127-value); }
assert.equal(state.levels.size,1,'A complete fade holds only the nonzero slider');
assert.equal(state.held.size,0,'CC updates do not accumulate Note On queues');
assert(output.includes('121|129') && output.includes('120|126'),'Both midpoint levels reach Web');
assert.equal(output.at(-2),'121|0'); assert.equal(output.at(-1),'120|255');
router.panic(); assert.equal(output.at(-1),'120|0'); assert.equal(state.levels.size,0);
assert.deepEqual(packets.at(-1),[128,118,0],'MIDI mode can release the translated slider input');
const before=output.length; cc(3,127); assert.equal(output.length,before,'CC must never toggle a button');
assert.deepEqual(packets.at(-1),[176,3,127],'Unmapped CC passes through unchanged');
router.update([
    {valid:true,liveNote:3,ccNumber:5,channel:0,note:119,type:'Slider'},
    {valid:true,liveNote:4,ccNumber:6,channel:0,note:118,type:'Slider'}
]);
cc(5,127);assert.equal(output.at(-1),'121|255','Tidy changes the note row while CC5 still addresses the same slider');cc(5,0);
cc(5,100);
router.update([{valid:true, liveNote:5, ccNumber:5, channel:0, note:118, type:'Slider'}]);
state.update({controls:controls.map((c,i)=>i===119?{...c,widgetId:'999'}:c)});
cc(5,50); assert.equal(output.at(-1),'121|100','An active CC retains its original target after remapping');
router.enabled=false; cc(5,90); assert.equal(output.at(-1),'121|100','Disabled output ignores increasing levels');
cc(5,0); assert.equal(output.at(-1),'121|0','Disabled output still releases the original target');
router.enabled=true; cc(5,127); cc(123,0); assert.equal(state.levels.size,0,'All Notes Off releases CC levels');
const blocked=new CueState(message=>{throw Error('Unexpected output '+message);}); blocked.update({controls});
blocked.level(119,100,false); blocked.level(117,100); blocked.level(119,-1); blocked.level(119,128);
assert.equal(blocked.levels.size,0);
console.log('PASS: continuous CC crossfade, remapping, output-off, stop and button isolation.');
