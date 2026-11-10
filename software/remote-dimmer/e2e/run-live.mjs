// Drives real UI via the gated XCUITest. All sockets bind/connect to loopback.
import {spawn, spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {appendFileSync, openSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {startReal} from './real-qlc5.mjs';
import {openQLC, query} from './qlc.mjs';
const cwd = fileURLToPath(new URL('.', import.meta.url));
const udid = '<REDACTED>';
const derived = '<PATH>';
const pause = ms => new Promise(r=>setTimeout(r,ms));
let backend, qlc, idleStart;
const record = data => {console.log(JSON.stringify(data)); appendFileSync(cwd+'observations.log', JSON.stringify({time:new Date().toISOString(),...data})+'\n');};
async function ready(url) {
  for(let i=0;i<100;i++) {try {const r=await fetch(url); if(r.ok)return await r.json();}catch{} await pause(100);}
  throw Error('not ready '+url);
}
async function startBackend() {
  backend=spawn('./remote-dimmer',['-config','config5.json'],{cwd,stdio:['ignore',openSync(cwd+'backend-stdout.log','a'),openSync(cwd+'backend-stderr.log','a')]});
  await ready('http://127.0.0.1:8765/status.json');
}
async function stopBackend(signal='SIGTERM') {
  if(backend && backend.exitCode===null && backend.signalCode===null) {const exited=once(backend,'exit');backend.kill(signal);await exited;}
}
async function read() {
  const ws=await openQLC();
  try {
    const slider=await query(ws,'QLC+API|getWidgetStatus|45');
    const channel=await query(ws,'QLC+API|getChannelsValues|1|1|1');
    return {slider:Number(slider.split('|')[3]),channel:Number(channel.split('|')[3]),raw:[slider,channel]};
  } finally {ws.close();}
}
async function send(frame) {const ws=await openQLC();ws.send(frame);await pause(100);ws.close();}
const controller=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');let result={};
    switch(url.pathname) {
      case '/read': result=await read(); break;
      case '/override': await send('CH|1|220'); result=await read(); break;
      case '/clearOverride': await send('QLC+API|sdResetChannel|1'); result=await read(); break;
      case '/direct': await send('45|102'); result=await read(); break;
      case '/stop': await stopBackend('SIGINT'); await pause(100); result=await read(); break;
      case '/kill': await stopBackend('SIGKILL'); result=await read(); break;
      case '/restart': await startBackend(); result=await ready('http://127.0.0.1:8765/status.json'); break;
      case '/idleStart': idleStart=await ready('http://127.0.0.1:8765/admin/devices');result={devices:idleStart};break;
      case '/idleEnd': {const devices=await ready('http://127.0.0.1:8765/admin/devices');result={devices,sameConnection:devices.length===1 && devices[0].connectedSince===idleStart[0].connectedSince};break;}
      case '/snapshot': {
        const name=url.searchParams.get('name');if(!/^[a-z-]+$/.test(name))throw Error('bad screenshot name');
        // Capture after SwiftUI has settled its initial safe-area layout.
        await pause(1200);
        const r=spawnSync('xcrun',['simctl','io',udid,'screenshot',cwd+'screenshots/'+name+'-v5.png']);
        if(r.status!==0)throw Error(r.stderr.toString());result={screenshot:'e2e/screenshots/'+name+'-v5.png'};break;
      }
      default: throw Error('unknown action');
    }
    record({action:url.pathname,...result});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
  }catch(e){record({error:String(e)});res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
});
try {
  qlc=await startReal({cwd});
  const built=spawnSync('go',['build','-o',cwd+'remote-dimmer','.'],{cwd:cwd+'../backend',env:{...process.env,GOFLAGS:'-buildvcs=false'}});if(built.status!==0)throw Error(built.stderr.toString());
  await pause(1500);
  await startBackend();
  controller.listen(8766,'127.0.0.1');await once(controller,'listening');
  // Assignment is persisted; repeat runs use the same Keychain device ID.
  const assigner=setInterval(async()=>{
    try {const devices=await (await fetch('http://127.0.0.1:8765/admin/devices')).json();for(const d of devices)if(!d.fixture)await fetch('http://127.0.0.1:8765/admin/assign',{method:'POST',body:JSON.stringify({device:d.id,fixture:'中央'})});}catch{}
  },100);
  const args=['-project',cwd+'../ios/DimmerRemote.xcodeproj','-scheme','DimmerRemote','-destination','platform=iOS Simulator,id='+udid,'-derivedDataPath',derived,'-parallel-testing-enabled','NO','-only-testing:DimmerRemoteUITests/DimmerRemoteUITests/testLiveFader','test'];
  record({command:'DIMMER_LIVE_TEST=1 xcodebuild '+args.join(' ')});
  const log=openSync(cwd+'uitest-live.log','w');
  const test=spawn('xcodebuild',args,{cwd,env:{...process.env,DIMMER_LIVE_TEST:'1'},stdio:['ignore',log,log]});
  const [code]=await once(test,'exit');clearInterval(assigner);process.exitCode=code??1;
}finally{
  controller.close();await stopBackend();
  if(qlc)await qlc.close();
  // XCUITest terminates its app at teardown; leave the real client open as requested.
  spawnSync('xcrun',['simctl','launch',udid,'<REDACTED>','-serverURL','ws://127.0.0.1:8765/ws']);
}
