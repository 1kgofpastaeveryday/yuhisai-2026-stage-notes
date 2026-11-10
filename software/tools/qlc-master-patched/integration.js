'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert'),net=require('net'),http=require('http');
const sync='<PATH>';
const WebSocket=require(path.join(sync,'node_modules/ws'));
const {DOMParser}=require(path.join(sync,'node_modules/@xmldom/xmldom'));
const {WorkspaceWatcher}=require(path.join(sync,'source'));
const {WebBridge}=require(path.join(sync,'web-bridge'));
const {spawn}=require('child_process');
const root=__dirname,runtime='<PATH>';
const show=path.join(root,'integration-fixture.qxw');
const original=fs.readFileSync(show,'utf8');
const document=new DOMParser().parseFromString(original,'text/xml');
for(const tag of ['Input','Output','Feedback','NetworkServer'])assert.equal(document.getElementsByTagName(tag).length,0);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const until=async(check,ms=15000)=>{const start=Date.now();while(!check()){if(Date.now()-start>ms)throw Error('Timed out waiting for host/source');await wait(25);}};
const events=[],statuses=[];let snapshot,ws,app,watcher,bridge,stderr='',stdout='';
const record=(kind,data)=>events.push({kind,data});
async function rpc(command,prefix){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off('message',on);reject(Error('No response: '+command));},3000);function on(data){const message=String(data);if(message.startsWith(prefix)){clearTimeout(timer);ws.off('message',on);resolve(message);}}ws.on('message',on);ws.send(command);});}
async function main(){
 const reserve=net.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const env={...process.env,PATH:runtime+';<PATH>'+process.env.PATH,QT_QPA_PLATFORM:'windows',QT_PLUGIN_PATH:runtime,QML2_IMPORT_PATH:path.join(runtime,'qml')};
 fs.copyFileSync('<PATH>',path.join(runtime,'integration_host.exe'));
 app=spawn(path.join(runtime,'integration_host.exe'),[show,String(port),'120000'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 app.stderr.on('data',data=>{stderr+=data;fs.writeFileSync(path.join(root,'integration-stderr.txt'),stderr);});app.stdout.on('data',data=>{stdout+=data;fs.writeFileSync(path.join(root,'integration-stdout.txt'),stdout);});
 const readyStarted=Date.now();
 while(true){
   const ready=await new Promise(resolve=>{const request=http.get(`http://127.0.0.1:${port}/vc.json`,response=>{response.resume();resolve(response.statusCode===200);});request.on('error',()=>resolve(false));request.setTimeout(1000,()=>request.destroy());});
   if(ready)break;
   if(app.exitCode!==null||Date.now()-readyStarted>15000)throw Error('Host HTTP server did not become ready');
   await wait(100);
 }
 record('host',{pid:app.pid,port});
 watcher=new WorkspaceWatcher(value=>{snapshot=value;if(bridge)bridge.update(value);},250);watcher.start(show);assert(snapshot&&!snapshot.error);
 bridge=new WebBridge('http://127.0.0.1:'+port,value=>statuses.push(value));bridge.update(snapshot);bridge.enable(true);await until(()=>bridge.ready);
 record('source-match',{controls:snapshot.controls.length,playable:snapshot.playable});
 ws=new WebSocket(`ws://127.0.0.1:${port}/qlcplusWS`);await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
 const reset=async()=>{for(const [api,args] of [['setSceneColorOverride','0|0|0|0'],['setBrightnessOverride','0|100'],['setRGBBrightnessOverride','0|100'],['setFadeOverride','0|0|0']])assert.equal(await rpc('QLC+API|'+api+'|'+args,'QLC+API|'+api+'|'),'QLC+API|'+api+'|OK');};
 await reset();
 const button=Array.from(document.getElementsByTagName('Button')).find(b=>b.getAttribute('ID')==='16');assert(button);
 const functionID=button.getElementsByTagName('Function')[0].getAttribute('ID');
 const scene=Array.from(document.getElementsByTagName('Function')).find(f=>f.getAttribute('ID')===functionID&&f.getAttribute('Type')==='Scene');assert(scene);
 const fixtureID=scene.getElementsByTagName('FixtureVal')[0].getAttribute('ID');
 const fixture=Array.from(document.getElementsByTagName('Fixture')).find(f=>f.getElementsByTagName('ID')[0]?.textContent===fixtureID);assert(fixture);const address=Number(fixture.getElementsByTagName('Address')[0].textContent)+1;
 async function rgb(){const result=await rpc(`QLC+API|getChannelsValues|1|${address}|3`,'QLC+API|getChannelsValues|');return result.slice('QLC+API|getChannelsValues|'.length).split('|').filter((_,i)=>i%4===1).map(Number);}
 const note=snapshot.controls.findIndex(c=>c&&c.valid&&c.widgetId==='16'&&c.type==='Button'&&c.action==='Flash');assert(note>=0,'Frozen fixture needs Flash button 16');
 bridge.note(note,127);await wait(100);const native=await rgb();assert(Math.max(...native)>0);record('press-native',native);
 assert.equal(await rpc('QLC+API|setSceneColorOverride|1|0|255|0','QLC+API|setSceneColorOverride|'),'QLC+API|setSceneColorOverride|OK');await wait(80);const green=await rgb();assert.equal(green[0],0);assert(green[1]>0);assert.equal(green[2],0);
 await rpc('QLC+API|setRGBBrightnessOverride|1|50','QLC+API|setRGBBrightnessOverride|');await wait(80);const half=await rgb();assert(Math.abs(half[1]-128)<=1);record('override-output',{green,half});
 await reset();await wait(80);assert.deepEqual(await rgb(),native);
 await rpc('QLC+API|setFadeOverride|1|0|500','QLC+API|setFadeOverride|');bridge.note(note,0);await wait(100);const fading=await rgb();assert(Math.max(...fading)>0);await wait(600);assert.deepEqual(await rgb(),[0,0,0]);record('fade-release',{at100ms:fading,after700ms:[0,0,0]});await reset();
 let cycles=0,pageChecks=0;const latencies=[];const started=Date.now();
 async function outputSettled(pressed){
   const before=Date.now();let values;
   await wait(20);
   while(true){
     values=await rgb();
     if(pressed?Math.max(...values)>0:values.every(value=>value===0))break;
     if(Date.now()-before>500){record('unsettled-output',{pressed,values,cycles,pageChecks,elapsed:Date.now()-started,held:[...bridge.state.held],statuses:statuses.slice(-5)});throw Error('Cue output did not settle within 500ms');}
     await wait(10);
   }
   latencies.push(Date.now()-before);
 }
 while(Date.now()-started<90000){
   bridge.note(note,127);await outputSettled(true);
   bridge.note(note,0);await outputSettled(false);cycles++;
   if(cycles%20===0){
     const pages=[0,1].map(index=>snapshot.controls.findIndex(c=>c&&c.valid&&c.type==='Page'&&c.pageIndex===index));assert(pages.every(index=>index>=0));
     bridge.note(pages[1],127);await wait(20);bridge.note(pages[1],0);
     bridge.note(pages[0],127);await wait(20);bridge.note(pages[0],0);pageChecks++;
   }
 }
 latencies.sort((a,b)=>a-b);
 record('soak',{milliseconds:Date.now()-started,cycles,pageChecks,outputObservationMs:{p50:latencies[Math.floor(latencies.length*.5)],p95:latencies[Math.floor(latencies.length*.95)],max:latencies.at(-1)},deadlineMs:500});
 bridge.note(note,127);await wait(70);bridge.panic();await wait(100);assert.deepEqual(await rgb(),[0,0,0]);record('panic-release','zero');
 const changed=original.replace('Caption="Ableton MIDI"','Caption="Validation changed page"');assert.notEqual(changed,original);fs.writeFileSync(show,changed);watcher.refresh(true);await bridge.check();await until(()=>statuses.at(-1)==='QLC+ project differs from saved source',3000);assert.equal(bridge.ready,false);record('mismatch-gate',statuses.at(-1));fs.writeFileSync(show,original);watcher.refresh(true);await until(()=>bridge.ready);record('restored-match',statuses.at(-1));
 console.log(JSON.stringify({result:'PASS',events}));
}
main().catch(error=>{record('error',String(error.stack));console.error(error);process.exitCode=1;}).finally(async()=>{
 if(bridge)bridge.stop();if(watcher)watcher.stop();if(ws)ws.close();fs.writeFileSync(show,original);
 if(app){
   if(process.exitCode)app.kill();
   if(app.exitCode===null&&app.signalCode===null)await new Promise(resolve=>{const timer=setTimeout(()=>{app.kill();resolve();},160000);app.once('exit',()=>{clearTimeout(timer);resolve();});});
 }
 fs.writeFileSync(path.join(root,'integration-results.json'),JSON.stringify({success:!process.exitCode,events,statuses,stderr,stdout,hostExitCode:app?.exitCode},null,2));
});
