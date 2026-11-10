// Headless web-API observations against the installed official QLC+ 5.3.0.
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {writeFileSync,appendFileSync,existsSync,statSync,openSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {startReal} from './real-qlc5.mjs';
import {openQLC,query} from './qlc.mjs';
const cwd=fileURLToPath(new URL('.',import.meta.url));
const pagesOnly=process.argv.includes('--pages-only');
const monitorOnly=process.argv.includes('--monitor-only');
const observationFile=pagesOnly?'runtime5-pages-observations.log':monitorOnly?'runtime5-monitor-observations.log':'runtime5-observations.log';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const record=(check,result,pass=true)=>{const row={time:new Date().toISOString(),check,pass,result};console.log(JSON.stringify(row));appendFileSync(cwd+observationFile,JSON.stringify(row)+'\n');};
let qlc,ws,backend;
const send=async text=>{ws.send(text);await pause(180);};
const channel=async address=>{const raw=await query(ws,`QLC+API|getChannelsValues|1|${address}|1`);const p=raw.split('|');assert.equal(p.length,6);return {value:+p[3],isOverride:+p[5],raw};};
const axes=async()=>{const values=[];for(const c of [21,22,23,24])values.push(await channel(c));return values;};
const read=async path=>(await fetch('http://127.0.0.1:8767'+path)).json();
async function wait(fn){for(let i=0;i<100;i++){try{const v=await fn();if(v)return v;}catch{}await pause(100);}throw Error('condition timeout');}
async function startBackend(){backend=spawn(cwd+'remote-dimmer',['-config','config-moving5.json'],{cwd,stdio:['ignore',openSync(cwd+'runtime5-backend.log','a'),openSync(cwd+'runtime5-backend.log','a')]});await wait(async()=>{const s=await read('/status.json');return s.fixtures.find(f=>f.name==='Spot L').owned?s:null;});}
async function stopBackend(){if(backend&&backend.exitCode===null&&backend.signalCode===null){const p=once(backend,'exit');backend.kill('SIGINT');await p;}}
function find(obj,id){if(!obj||typeof obj!=='object')return;if(+obj.id===id)return obj;for(const v of Object.values(obj)){const r=find(v,id);if(r)return r;}}
try{
 writeFileSync(cwd+observationFile,'');
 for(const args of [['-w','-p'],['-wp','9998']]){const r=spawnSync('/Applications/QLC+ 5.app/Contents/MacOS/qlcplus5',args,{timeout:10000});assert.equal(r.status,1);record('rejected-startup-options',{args,status:r.status,stdout:r.stdout.toString(),stderr:r.stderr.toString()});}
 if(!pagesOnly&&!monitorOnly){
 qlc=await startReal({cwd});ws=await openQLC();
 for(const id of [45,46,47,120])record('widget-type-'+id,await query(ws,'QLC+API|getWidgetType|'+id));
 await send('45|128');const before=await channel(1);await send('CH|1|50');const after=await channel(1);await send('QLC+API|sdResetChannel|1');const reset=await channel(1);assert.equal(before.value,128);assert.equal(before.isOverride,0);assert.equal(after.value,50);assert.equal(after.isOverride,1);assert.equal(reset.value,128);assert.equal(reset.isOverride,0);record('six-field-simple-desk',{before,after,reset});
 await send('45|50');await send('QLC+API|setFunctionStatus|0|1');const low=await channel(1);await send('45|200');const high=await channel(1);assert.equal(low.value,100);assert.equal(high.value,200);record('scene-HTP',{low,high});
 await send('CH|1|50');const override=await channel(1);await send('QLC+API|sdResetChannel|1');const released=await channel(1);assert.equal(override.value,50);assert.equal(released.value,200);record('scene-simple-desk-override',{override,released});await send('QLC+API|setFunctionStatus|0|0');await send('45|0');
 for(const cmd of ['NEXT_PG','PREV_PG']){const observations=[];for(let i=0;i<3;i++){await send('120|'+cmd);const vc=await (await fetch('http://127.0.0.1:9999/vc.json')).json();const f=find(vc,120);assert(f);assert.equal(f.currentPage,cmd==='NEXT_PG'?1:0);assert.equal(f.pagesLoop,false);observations.push(f);}record('page-'+cmd,observations);}
 await send('VC_PAGE|1');await send('45|128');const hiddenPage=await channel(1);assert.equal(hiddenPage.value,128);await send('VC_PAGE|0');await send('1|FRAME_DISABLE|1');await send('45|129');const disabled=await channel(1);assert.equal(disabled.value,129);record('other-page-and-disabled-frame',{hiddenPage,disabled,disabledPass:disabled.value===129});await send('1|FRAME_DISABLE|0');await send('45|0');
 for(const [c,v] of [[21,0],[22,0],[23,255],[24,255]])await send(`CH|${c}|${v}`);
 await startBackend();const startup=await read('/status.json');const startupAxes=await axes();assert.deepEqual(startupAxes.map(c=>c.value),[39,16,164,16]);assert(startupAxes.every(c=>c.isOverride===1));record('startup-clamp',{startup,axes:startupAxes});
 await send('QLC+API|setFunctionStatus|1|1');await pause(800);const held=await axes();assert.deepEqual(held.map(c=>c.value),startupAxes.map(c=>c.value));assert(held.every(c=>c.isOverride===1));record('axes-held-against-new-scene',held);
 await stopBackend();await pause(180);const sceneAxes=await axes();assert.deepEqual(sceneAxes.map(c=>c.value),[117,48,156,64]);assert(sceneAxes.every(c=>c.isOverride===0));record('graceful-release-to-scene',sceneAxes);
 await send('QLC+API|setFunctionStatus|1|0');const defaultsBefore=await axes();await startBackend();await stopBackend();await pause(180);const defaults=await axes();assert(defaults.every(c=>c.isOverride===0));record('graceful-release-to-default',{before:defaultsBefore,after:defaults,pan16:defaults[0].value*256+defaults[1].value,tilt16:defaults[2].value*256+defaults[3].value});
 await startBackend();const start=Date.now(),stamp=statSync(cwd+'show5.qxw').mtimeMs,samples=[];
 while(Date.now()-start<120000){samples.push({elapsedMs:Date.now()-start,autosave:existsSync(cwd+'show5.autosave.qxw'),mtimeMs:statSync(cwd+'show5.qxw').mtimeMs});await pause(1000);}
 record('two-minute-autosave',{elapsedMs:Date.now()-start,samples,projectUnchanged:statSync(cwd+'show5.qxw').mtimeMs===stamp,modified:'not verifiable here: web API exposes no docModified/window-title readback'});await stopBackend();ws.close();await qlc.close();qlc=null;
 }
 if(!pagesOnly){
 qlc=await startReal({cwd,project:'show5-monitor.qxw'});ws=await openQLC();
 await send('45|0');await send('QLC+API|setFunctionStatus|0|1');const unchanged=await channel(1);
 record('monitor-zero-noop',{channel:unchanged,auditExpected:0,observation:'same-value zero write does not engage override; this contradicts the unconditional audit claim'},unchanged.value===0);
 const monitoredBefore=await query(ws,'QLC+API|getWidgetStatus|45');
 await send('45|0');const monitored=await channel(1);assert.equal(monitored.value,0);
 await send('QLC+API|setFunctionStatus|0|0');await send('QLC+API|setFunctionStatus|0|1');const restarted=await channel(1);assert.equal(restarted.value,0);
 const monitorVC=await (await fetch('http://127.0.0.1:9999/vc.json')).json();
 record('monitor-on-negative',{monitoredBefore,monitored,restarted,slider:find(monitorVC,45)});
 ws.close();await qlc.close();qlc=null;
 }
 if(!monitorOnly){
 qlc=await startReal({cwd,project:'show5-hidden.qxw'});ws=await openQLC();
 const vc=await (await fetch('http://127.0.0.1:9999/vc.json')).json();const parent=find(vc,120),slider=find(vc,46);assert.equal(parent.currentPage,0);assert.equal(slider.page,1);assert.equal(slider.visible,false);
 await send('46|128');const hidden=await channel(2);assert.equal(hidden.value,128);record('slider-on-hidden-frame-page',{frame:parent.currentPage,sliderPage:slider.page,visible:slider.visible,channel:hidden});
 record('edit-mode',{status:'not verifiable here',reason:'No web API toggles the VC edit state; no GUI scripting was used.'},null);
 }
 record('complete',{});
}catch(e){record('runner',{error:e.stack},false);process.exitCode=1;}
finally{await stopBackend();if(ws)ws.close();if(qlc)await qlc.close();}
