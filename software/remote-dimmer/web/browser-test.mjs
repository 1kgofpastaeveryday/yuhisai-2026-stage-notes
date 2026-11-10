// Isolated integration test: real backend + gateway + fake QLC, never live lights.
import {createRequire} from 'node:module';
import {mkdtempSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {startFake} from '../e2e/fake-qlc5.mjs';
const require = createRequire(import.meta.url);
const {chromium, webkit} = require(process.env.PLAYWRIGHT_MODULE || '/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright');
const dir = mkdtempSync(join(tmpdir(),'dimmer-web-test-'));
const base='http://127.0.0.1:18768/yuhisai/2026/dimmer/';
const admin='http://127.0.0.1:18765';
const children=[];
const sleep = ms => new Promise(r=>setTimeout(r,ms));
async function eventually(fn) { for(let n=0;n<100;n++){try{const v=await fn();if(v)return v;}catch{} await sleep(100);}throw Error('Timed out'); }
async function post(path,data){const r=await fetch(admin+'/admin/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});assert.equal(r.status,200,await r.text());}
async function snapshot(){return (await fetch(admin+'/status.json')).json();}
function start(binary,args){const p=spawn(binary,args,{stdio:'ignore'});children.push(p);return p;}
const fake=await startFake({port:19999});
writeFileSync(join(dir,'config.json'),JSON.stringify({listen:'127.0.0.1:18765',publicListen:'127.0.0.1:18766',qlcURL:'ws://127.0.0.1:19999/qlcplusWS',project:resolve('yuhisai-2026/remote-dimmer/e2e/show5.qxw'),indicatorFrame:120,assignmentsFile:join(dir,'assignments.json'),logFile:join(dir,'runtime.log'),fixtures:[{name:'中央',slider:45,universe:1,address:1},{name:'右',slider:47,universe:1,address:20,faderMode:'absolute'}]}));
start('/tmp/<HOST>-test-backend',['-config',join(dir,'config.json')]);
const gateway = start('/tmp/<HOST>-web',['-listen','127.0.0.1:18768','-upstream','ws://127.0.0.1:18766/ws']);
const results=[];
try {
 await eventually(async()=>(await snapshot()).qlc==='connected');
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true, executablePath: process.env[name === 'chromium' ? 'CHROMIUM_EXECUTABLE' : 'WEBKIT_EXECUTABLE']});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(base);if(await page.locator('#display-help').isVisible())await page.locator('#close-display').click();await page.waitForFunction(()=>document.getElementById('connection').textContent==='接続済み');
   const id=await page.locator('#device').innerText(); assert.match(id,/^[0-9A-HJKMNP-TV-Z]{6}$/);
   assert.equal(await page.locator('#control').isVisible(),false);
   await post('assign',{device:id,fixture:'中央'});
   await page.waitForFunction(()=>document.getElementById('surface').getAttribute('aria-disabled')==='false');
   await page.locator('#surface').focus();await page.keyboard.press('End');
   await eventually(async()=>(await snapshot()).fixtures[0].level===255);
   await page.locator('#off').tap();await eventually(async()=>(await snapshot()).fixtures[0].level===0);
   await page.locator('#toggle').tap();await eventually(async()=>(await snapshot()).fixtures[0].level===255);
   const box=await page.locator('#surface').boundingBox();
   await page.mouse.move(box.x+100,box.y+80);await page.mouse.down();await page.mouse.move(box.x+100,box.y+box.height/2,{steps:12});await page.mouse.up();
   await eventually(async()=>{const n=(await snapshot()).fixtures[0].level;return n>50&&n<220});
   const relative=(await snapshot()).fixtures[0].level;
   await page.locator('#surface').tap();await eventually(async()=>(await snapshot()).fixtures[0].level===0);
   await page.locator('#surface').tap();await eventually(async()=>(await snapshot()).fixtures[0].level===relative);
   await page.reload();if(await page.locator('#display-help').isVisible())await page.locator('#close-display').click();await page.waitForFunction(()=>document.getElementById('surface').getAttribute('aria-disabled')==='false');
   assert.equal(await page.locator('#device').innerText(),id);
   // A second fixture must block this deliberately single-fixture web client.
   await post('assign',{device:id,fixture:'右'});
   await page.waitForFunction(()=>document.getElementById('status').textContent.includes('1灯体'));
   assert.equal(await page.locator('#control').isVisible(),false);
   await post('release',{fixture:'中央'});
   await page.waitForFunction(()=>document.getElementById('fixture').textContent==='右');
   const abs=await page.locator('#surface').boundingBox();await page.touchscreen.tap(abs.x+abs.width/2,abs.y+abs.height/2);
   await eventually(async()=>Math.abs((await snapshot()).fixtures[1].level-128)<=2);
   // Suspend the actual relay: WebKit offline emulation leaves established sockets alive.
   gateway.kill('SIGSTOP');
   await page.waitForFunction(()=>document.getElementById('surface').getAttribute('aria-disabled')==='true',null,{timeout:12000});
   gateway.kill('SIGCONT');
   await page.waitForFunction(()=>document.getElementById('surface').getAttribute('aria-disabled')==='false');
   assert(Math.abs((await snapshot()).fixtures[1].level-128)<=2);
   await post('release',{fixture:'右'});
   await page.waitForFunction(()=>!document.getElementById('waiting').hidden);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:join(dir,name+'-unassigned.png')});
   assert.deepEqual(errors,[]);
   await post('forget',{device:id});await context.close();
   results.push({engine:name,identityPersistence:true,assignment:true,relativeDragLevel:relative,nativeTouchToggle:true,absoluteTouch:true,multiBlocked:true,stalledSocketRecovery:true,unassigned:true,noOverflow:true});
  }finally{await browser.close()}
 }
 console.log(JSON.stringify({dir,results},null,2));
}finally{
 for(const p of children){p.kill('SIGCONT');p.kill('SIGTERM');}
 await sleep(1100);for(const p of children)if(p.exitCode===null)p.kill('SIGKILL');await fake.close();
}
