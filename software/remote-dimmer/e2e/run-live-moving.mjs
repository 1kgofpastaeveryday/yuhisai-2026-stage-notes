// Real app + real backend + real QLC+ 5 by default; --fake retains the test double.
import {spawn,spawnSync} from 'node:child_process';
import {createServer,request} from 'node:http';
import {connect} from 'node:net';
import {once} from 'node:events';
import {appendFileSync,writeFileSync,openSync,readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {startReal} from './real-qlc5.mjs';
import {openQLC,query} from './qlc.mjs';
import {startFake,decoder,frame} from './fake-qlc5.mjs';
const real=!process.argv.includes('--fake');
const config=real?'config-moving5.json':'config-moving.json';
const cwd=fileURLToPath(new URL('.',import.meta.url));
const scratch='<PATH>';
const udid='<REDACTED>';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const record=data=>{console.log(JSON.stringify(data));appendFileSync(cwd+'moving-observations.log',JSON.stringify({time:new Date().toISOString(),...data})+'\n');};
const packets=[],tunnels=new Set();let backend,fake,device,since,appTunnel,mark=0,wireMark=0,baseline,oldEpoch;
function run(cmd,args,options={}) {const r=spawnSync(cmd,args,{cwd,...options});if(r.status!==0)throw Error(cmd+': '+r.stderr?.toString());return r.stdout?.toString();}
const cli=(...args)=>run(scratch+'moving-backend',['-config',config,...args]);
const get=async path=>{const r=await fetch('http://127.0.0.1:8767'+path);assert.equal(r.status,200);return r.json();};
async function waitFor(fn) {for(let i=0;i<100;i++){try{const v=await fn();if(v)return v;}catch{}await pause(100);}throw Error('condition timeout');}
const status=async()=>{if(real)await fake.refresh();return get('/status.json');};
const moving=s=>s.fixtures.find(f=>f.name==='Spot L');
const writes=()=>fake.commands.slice(mark).filter(e=>e.command.startsWith('CH|'));
const latestState=()=>packets.filter(p=>p.direction==='server'&&p.message.type==='state'&&p.message.kind==='moving').at(-1)?.message;
async function startBackend(){backend=spawn(scratch+'moving-backend',['-config',config],{cwd,stdio:['ignore',openSync(cwd+'moving-backend-stdout.log','a'),openSync(cwd+'moving-backend-stderr.log','a')]});await waitFor(async()=>moving(await status()).owned);}
async function stopBackend(){if(backend&&backend.exitCode===null&&backend.signalCode===null){const exited=once(backend,'exit');backend.kill('SIGINT');await exited;}}
async function assign(name){const d=(await get('/admin/devices'))[0];assert(d);if(!device){device=d.id;since=d.connectedSince;}assert.equal(d.id,device);assert.equal(d.connectedSince,since);if(d.fixture)cli('release',d.fixture);cli('assign',device,name);await pause(400);return status();}
// Transparent byte forwarding lets assertions inspect real phone state/seq echoes.
// HTTP is forwarded too, so the public app endpoint remains exactly :8765/ws.
const proxy=createServer((req,res)=>{const upstream=request({hostname:'127.0.0.1',port:8767,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});
proxy.on('upgrade',(req,client,head)=>{
  const upstream=connect(8767,'127.0.0.1');const tunnel={client,upstream};tunnels.add(tunnel);appTunnel=tunnel;
  const observe=direction=>decoder((text,op)=>{if(op!==1)return;const message=JSON.parse(text);const p={time:new Date().toISOString(),direction,message};packets.push(p);appendFileSync(cwd+'moving-wire.log',JSON.stringify(p)+'\n');});
  const fromClient=observe('client'),fromServer=observe('server');let header=Buffer.alloc(0),upgraded=false;
  upstream.on('connect',()=>{upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`+req.rawHeaders.reduce((s,v,i)=>s+v+(i%2?'\r\n':': '),'')+'\r\n');if(head.length){fromClient(head);upstream.write(head);}});
  client.on('data',b=>{fromClient(b);upstream.write(b);});
  upstream.on('data',b=>{client.write(b);if(!upgraded){header=Buffer.concat([header,b]);const at=header.indexOf('\r\n\r\n');if(at<0)return;upgraded=true;b=header.subarray(at+4);}if(b.length)fromServer(b);});
  client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());
  client.on('close',()=>{upstream.destroy();tunnels.delete(tunnel);});upstream.on('close',()=>client.destroy());
});
function replay(message){const b=Buffer.from(JSON.stringify(message)),f=frame(b),h=f.length-b.length,mask=Buffer.from([19,37,71,97]);f[1]|=128;const payload=Buffer.from(b);for(let i=0;i<b.length;i++)payload[i]^=mask[i%4];appTunnel.upstream.write(Buffer.concat([f.subarray(0,h),mask,payload]));}
let savedAim,savedSet;
const controller=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');let result;
  switch(url.pathname){
   case '/assign-moving':
    await waitFor(async()=>(await get('/admin/devices')).length===1);
    result=await assign('Spot L');baseline=moving(result);
    assert.equal(baseline.pan16,10000);assert.equal(baseline.tilt16,42000);
    assert.equal(baseline.x,0);assert.equal(baseline.y,1);assert(baseline.active);
    oldEpoch=latestState().controlEpoch;mark=fake.commands.length;wireMark=packets.length;break;
   case '/aim':{
    await pause(600);result=await status();const m=moving(result),w=writes();
    assert(w.length>=4);assert.equal(w.length%4,0);
    for(let i=0;i<w.length;i+=4){const group=w.slice(i,i+4).map(e=>e.command.split('|').map((s,j)=>j?+s:s));assert.deepEqual(group.map(p=>p[1]),[21,22,23,24]);const pan=group[0][2]*256+group[1][2],tilt=group[2][2]*256+group[3][2];assert(pan>=10000&&pan<=50000);assert(tilt>=16000&&tilt<=42000);}
    if(real){assert.equal(fake.channel(21).value*256+fake.channel(22).value,m.pan16);assert.equal(fake.channel(23).value*256+fake.channel(24).value,m.tilt16);assert([21,22,23,24].every(c=>fake.channel(c).isOverride===1));}
    assert(m.pan16>baseline.pan16);assert(m.tilt16<baseline.tilt16);
    const echo=latestState();savedAim=packets.slice(wireMark).filter(p=>p.direction==='client'&&p.message.type==='aim').at(-1).message;
    assert.equal(echo.aimSeq,savedAim.seq);assert.equal(echo.x,savedAim.x);assert.equal(echo.y,savedAim.y);assert.equal(m.x,echo.x);assert.equal(m.y,echo.y);
    result={status:result,echo,groups:w.length/4,first:w.slice(0,4),last:w.slice(-4)};break;}
   case '/strip-level':await pause(600);result=await status();assert(moving(result).level>0);assert.equal(fake.sliders.get(47),moving(result).level);if(real)assert.equal(fake.channel(26).value,moving(result).level);savedSet=packets.filter(p=>p.direction==='client'&&p.message.type==='set').at(-1).message;mark=fake.commands.length;wireMark=packets.length;break;
   case '/off':await pause(500);result=await status();assert.equal(moving(result).level,0);assert.equal(fake.sliders.get(47),0);if(real)assert.equal(fake.channel(26).value,0);break;
   case '/on':{
    await pause(500);result=await status();assert.equal(moving(result).level,savedSet.level);assert.equal(fake.sliders.get(47),savedSet.level);if(real)assert.equal(fake.channel(26).value,savedSet.level);
    assert.deepEqual(packets.slice(wireMark).filter(p=>p.direction==='client'&&['on','off'].includes(p.message.type)).map(p=>p.message.type),['off','on']);
    assert.deepEqual(fake.commands.slice(mark).filter(p=>p.command.startsWith('47|')).map(p=>p.command),['47|0','47|'+savedSet.level]);break;}
   case '/to-dimmer':{
    result=await assign('中央');mark=fake.commands.length;wireMark=packets.length;baseline=moving(result);
    const stale=[{...savedSet,seq:90000,level:17},{...savedAim,seq:90001,x:0.9,y:0.1}];
    stale.forEach(replay);await pause(600);
    const devices=await get('/admin/devices');assert.equal(devices.length,1);assert.equal(devices[0].connectedSince,since);
    result=await status();assert.equal(result.fixtures.find(f=>f.name==='中央').level,0);assert.equal(fake.sliders.get(45),0);assert.equal(writes().length,0);
    assert.equal(fake.commands.slice(mark).filter(c=>c.command.startsWith('45|')).length,0);
    result={status:result,replayed:stale,sameSocket:true};break;}
   case '/back-moving':{
    assert.equal(writes().length,0);assert.equal(fake.sliders.get(45),0);
    result=await assign('Spot L');const epoch=latestState().controlEpoch;assert.notEqual(epoch,oldEpoch);assert.equal(latestState().aimSeq,0);
    mark=fake.commands.length;
    const staleAim={...savedAim,seq:100000,x:0.9,y:0.1},staleSet={...savedSet,seq:100001,level:17};
    replay(savedAim);replay(savedSet);replay(staleAim);replay(staleSet);await pause(600);
    result=await status();assert.equal(writes().length,0);assert.equal(moving(result).x,baseline.x);assert.equal(moving(result).y,baseline.y);assert.equal(moving(result).level,baseline.level);assert.equal(latestState().aimSeq,0);
    result={status:result,oldEpoch,newEpoch:epoch,replayed:[savedAim,savedSet,staleAim,staleSet],sameSocket:(await get('/admin/devices'))[0].connectedSince===since};assert(result.sameSocket);break;}
   case '/stop':{
    mark=fake.commands.length;const before=await status();await stopBackend();
    const commands=fake.commands.slice(mark).map(p=>p.command),resets=commands.filter(c=>c.startsWith('QLC+API|sdResetChannel|'));
    assert.deepEqual(resets,[21,22,23,24].map(c=>'QLC+API|sdResetChannel|'+c));assert(commands.indexOf('47|0')<commands.indexOf(resets[0]));
    if(real)await fake.refresh();
    const axes=[21,22,23,24].map(c=>({...fake.channel(c)}));assert(axes.every(c=>c.isOverride===0));assert.equal(fake.sliders.get(47),0);
    result={before,commands,axes};break;}
   case '/restart':await startBackend();await waitFor(async()=>(await get('/admin/devices')).length===1);since=(await get('/admin/devices'))[0].connectedSince;result=await status();break;
   case '/lock':{
    // Use the public QLC+ protocol, just as a console Simple Desk edit would.
    const ws=new WebSocket('ws://127.0.0.1:9999/qlcplusWS');await once(ws,'open');ws.send('CH|21|200');await pause(100);ws.close();
    result=await waitFor(async()=>{const s=await status();return moving(s).locked?s:null;});assert.equal(moving(result).active,false);mark=fake.commands.length;break;}
   case '/locked-check':await pause(600);result=await status();assert.equal(writes().length,0);assert(moving(result).locked);break;
   case '/final-dimmer':result=await assign('中央');break;
   case '/snapshot':{const name=url.searchParams.get('name');assert(/^[a-z-]+$/.test(name));await pause(600);run('xcrun',['simctl','io',udid,'screenshot',cwd+'screenshots/'+name+(real?'-v5':'')+'.png']);result={screenshot:name};break;}
   default:throw Error('unknown action '+url.pathname);
  }
  record({check:url.pathname,pass:true,result});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 }catch(e){record({check:req.url,pass:false,error:e.stack});res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
});
try{
 for(const file of ['moving-observations.log','moving-wire.log','fake-qlc5.log','moving-backend.log','moving-backend-stdout.log','moving-backend-stderr.log'])writeFileSync(cwd+file,'');
 if(existsSync(cwd+'moving-assignments.json'))assert.equal(readFileSync(cwd+'moving-assignments.json','utf8').trim(),'{}','previous assignment file must be cleared explicitly before repeat');
 writeFileSync(cwd+'moving-assignments.json','{}');
 run('go',['build','-o',scratch+'moving-backend','.'],{cwd:cwd+'../backend'});
 fake=real?await startReal({cwd,bridge:true}):await startFake({logFile:cwd+'fake-qlc5.log',initial:{21:0,22:0,23:255,24:255},defaults:{21:100,22:0,23:100,24:0}});
 if(real){const ws=await openQLC();for(const [ch,v] of [[21,0],[22,0],[23,255],[24,255]])ws.send(`CH|${ch}|${v}`);await pause(150);ws.close();}
 await startBackend();record({check:'startup',status:await status()});
 proxy.listen(8765,'127.0.0.1');await once(proxy,'listening');controller.listen(8766,'127.0.0.1');await once(controller,'listening');
 const args=['-project',cwd+'../ios/DimmerRemote.xcodeproj','-scheme','DimmerRemote','-destination','platform=iOS Simulator,id='+udid,'-derivedDataPath',scratch+'DerivedData','-parallel-testing-enabled','NO','-only-testing:DimmerRemoteUITests/DimmerRemoteUITests/testLiveMoving','test'];
 const log=openSync(cwd+'uitest-live-moving.log','w');const test=spawn('xcodebuild',args,{cwd,env:{...process.env,DIMMER_LIVE_TEST:'moving'},stdio:['ignore',log,log]});const [code]=await once(test,'exit');assert.equal(code,0,'XCUITest failed; see uitest-live-moving.log');
 const checks=readFileSync(cwd+'moving-observations.log','utf8').trim().split('\n').map(JSON.parse);for(const check of ['/assign-moving','/aim','/strip-level','/off','/on','/to-dimmer','/back-moving','/stop','/restart','/lock','/locked-check','/final-dimmer'])assert(checks.some(c=>c.check===check&&c.pass));assert.equal(checks.filter(c=>c.check==='/snapshot'&&c.pass).length,3);assert(!checks.some(c=>c.pass===false));
 record({check:'complete',pass:true});
} catch(e){record({check:'runner',pass:false,error:e.stack});process.exitCode=1;}
finally{
 await stopBackend();for(const t of tunnels){t.client.destroy();t.upstream.destroy();}proxy.close();controller.close();if(fake)await fake.close();
 writeFileSync(cwd+'moving-assignments.json','{}');
 run('xcrun',['simctl','launch',udid,'<REDACTED>','-serverURL','ws://127.0.0.1:8765/ws']);
}
