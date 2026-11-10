'use strict';
// Run ONLY against an isolated show with all external mappings removed.
const fs=require('fs'),path=require('path'),assert=require('assert'),http=require('http');
const {spawn}=require('child_process');const WebSocket=require('ws');
const {WorkspaceWatcher}=require('./source'),{WebBridge}=require('./web-bridge');
const {DOMParser}=require('@xmldom/xmldom');
const [bundle,show,report]=process.argv.slice(2);if(!bundle||!show||!report)throw Error('bundle show report required');
const original=fs.readFileSync(show,'utf8');const doc=new DOMParser().parseFromString(original,'text/xml');
for(const tag of ['Input','Output','Feedback','NetworkServer'])assert.equal(doc.getElementsByTagName(tag).length,0,'External mappings forbidden');
const events=[];const record=(kind,data)=>events.push({kind,data});const wait=ms=>new Promise(r=>setTimeout(r,ms));
const until=async(f,ms=15000)=>{const start=Date.now();while(!f()){if(Date.now()-start>ms)throw Error('Timed out');await wait(30);}};
const app=spawn(path.join(bundle,'Contents/MacOS/qlcplus5'),['-w','--web-port','10099','--no3d','-o',show],{stdio:['ignore','ignore','pipe']});
let stderr='';app.stderr.on('data',b=>stderr+=b);let snapshot;const statuses=[];
const bridge=new WebBridge('http://127.0.0.1:10099',s=>statuses.push(s));
const watcher=new WorkspaceWatcher(s=>{snapshot=s;bridge.update(s);},500);let ws;
async function rpc(cmd,prefix){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',on);reject(Error('No reply '+cmd));},3000);const on=b=>{const s=b.toString();if(s.startsWith(prefix)){clearTimeout(timer);ws.off('message',on);resolve(s);}};ws.on('message',on);ws.send(cmd);});}
(async()=>{try{
 watcher.start(show);assert(snapshot&&!snapshot.error);bridge.enable(true);await until(()=>bridge.ready);record('source-match',{controls:snapshot.controls.length,playable:snapshot.playable,status:statuses.at(-1)});
 ws=new WebSocket('ws://127.0.0.1:10099/qlcplusWS');await new Promise((r,j)=>{ws.once('open',r);ws.once('error',j);});
 for(const [api,args] of [['setSceneColorOverride','1|0|255|0'],['setFadeOverride','1|0|0'],['setBrightnessOverride','1|50']]){assert.equal(await rpc('QLC+API|'+api+'|'+args,'QLC+API|'+api+'|'),'QLC+API|'+api+'|OK');}
 record('override-apis','all three acknowledge');
 await rpc('QLC+API|setSceneColorOverride|0|0|0|0','QLC+API|setSceneColorOverride|');await rpc('QLC+API|setBrightnessOverride|0|100','QLC+API|setBrightnessOverride|');
 const fixtures=Array.from(doc.getElementsByTagName('Fixture'));const fixture=fixtures.find(f=>f.getElementsByTagName('ID')[0]?.textContent==='14');assert(fixture);const addr=Number(fixture.getElementsByTagName('Address')[0].textContent)+1;
 const rgb=async()=>{const s=await rpc(`QLC+API|getChannelsValues|1|${addr}|3`,'QLC+API|getChannelsValues|');return s.slice('QLC+API|getChannelsValues|'.length).split('|').filter((_,i)=>i%4===1).map(Number);};
 ws.send('QLC+API|setFunctionStatus|17|1');await wait(150);assert.equal(await rpc('QLC+API|getFunctionStatus|17','QLC+API|getFunctionStatus|'),'QLC+API|getFunctionStatus|Running');
 const native=await rgb();assert.deepEqual(native,[255,0,0]);
 await rpc('QLC+API|setSceneColorOverride|1|0|255|0','QLC+API|setSceneColorOverride|');await wait(100);assert.deepEqual(await rgb(),[0,255,0]);
 await rpc('QLC+API|setBrightnessOverride|1|50','QLC+API|setBrightnessOverride|');await wait(100);const half=await rgb();assert(half[0]===0&&half[2]===0&&Math.abs(half[1]-128)<=1);record('engine-output',{native,color:[0,255,0],half});
 await rpc('QLC+API|setBrightnessOverride|0|100','QLC+API|setBrightnessOverride|');await rpc('QLC+API|setSceneColorOverride|0|0|0|0','QLC+API|setSceneColorOverride|');await wait(100);assert.deepEqual(await rgb(),native);
 await rpc('QLC+API|setFadeOverride|1|0|500','QLC+API|setFadeOverride|');ws.send('QLC+API|setFunctionStatus|17|0');await wait(100);const fading=await rgb();assert(fading[0]>0&&fading[0]<255);await wait(600);assert.deepEqual(await rgb(),[0,0,0]);record('fade-output',{at100ms:fading,after700ms:[0,0,0]});
 await rpc('QLC+API|setFadeOverride|0|0|0','QLC+API|setFadeOverride|');
 const flash=snapshot.controls.findIndex(c=>c&&c.valid&&c.type==='Button'&&c.action==='Flash');assert(flash>=0);const fid=snapshot.controls[flash].functionId;bridge.note(flash,127);await wait(150);assert.deepEqual(await rgb(),[255,0,0]);bridge.panic();await wait(200);assert.deepEqual(await rgb(),[0,0,0]);record('note-panic',{flash,fid,pressed:[255,0,0],released:[0,0,0]});
 const renamed=original.replace(/Caption="([^"]+)"/,(_,n)=>'Caption="MAC TEST '+n+'"');assert.notEqual(renamed,original);fs.writeFileSync(show,renamed);watcher.refresh(true);await bridge.check();assert.equal(bridge.ready,false);record('mismatch-gate',statuses.at(-1));fs.writeFileSync(show,original);watcher.refresh(true);await until(()=>bridge.ready);record('restored-match',statuses.at(-1));
 console.log('PASS real Mac QLC: matching source, override output/readbacks, fade, Flash/panic, watcher rename gate and reconnect');
 }finally{watcher.stop();bridge.stop();if(ws)ws.close();fs.writeFileSync(show,original);app.kill('SIGTERM');await wait(200);fs.writeFileSync(report,JSON.stringify({events,statuses,stderr,exitCode:app.exitCode},null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
