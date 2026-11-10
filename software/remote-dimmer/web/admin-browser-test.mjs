// Isolated GUI -> actual backend -> fake QLC integration. No live lighting calls.
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {startFake} from '../e2e/fake-qlc5.mjs';
const require=createRequire(import.meta.url);
const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright');
const dir=mkdtempSync(join(tmpdir(),'dimmer-admin-test-')),children=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function eventually(fn){for(let n=0;n<100;n++){try{if(await fn())return;}catch{}await sleep(100);}throw Error('Timed out');}
function start(binary,args){const p=spawn(binary,args,{stdio:'ignore'});children.push(p);return p;}
async function snapshot(){return (await fetch('http://127.0.0.1:18765/status.json')).json();}
const fake=await startFake({port:19999});
writeFileSync(join(dir,'config.json'),JSON.stringify({listen:'127.0.0.1:18765',publicListen:'127.0.0.1:18766',qlcURL:'ws://127.0.0.1:19999/qlcplusWS',project:resolve('yuhisai-2026/remote-dimmer/e2e/show5.qxw'),indicatorFrame:120,assignmentsFile:join(dir,'assignments.json'),logFile:join(dir,'runtime.log'),fixtures:[{name:'中央',slider:45,universe:1,address:1},{name:'右',slider:47,universe:1,address:20}]}));
const backend=start('/tmp/<HOST>-test-backend',['-config',join(dir,'config.json')]);
start('/tmp/<HOST>-web',['-listen','127.0.0.1:18768','-upstream','ws://127.0.0.1:18766/ws']);
start('/tmp/<HOST>-admin',['-listen','127.0.0.1:18769','-backend','http://127.0.0.1:18765']);
const results=[];
try{
 await eventually(async()=>(await snapshot()).qlc==='connected');
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,executablePath:process.env[name==='chromium'?'CHROMIUM_EXECUTABLE':'WEBKIT_EXECUTABLE']});
  try{
   const adminContext=await browser.newContext({viewport:{width:1440,height:1080}}),phoneContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   const page=await adminContext.newPage(),phone=await phoneContext.newPage(),errors=[],failed=[];
   page.on('pageerror',e=>errors.push(String(e)));page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url())});
   await page.goto('http://127.0.0.1:18769/');await page.waitForFunction(()=>document.getElementById('server-label').textContent.includes('稼働中'));
   await page.locator('#enlarge-qr img').screenshot({path:join(dir,name+'-qr.png')});
   const decoded=execFileSync('zbarimg',['--quiet','--raw',join(dir,name+'-qr.png')],{encoding:'utf8'}).trim();assert.equal(decoded,'https://knudg.com/yuhisai/2026/dimmer/');
   await page.locator('#show-qr').click();assert(await page.locator('#qr-dialog').isVisible());await page.locator('#close-qr').click();
   await phone.goto('http://127.0.0.1:18768/yuhisai/2026/dimmer/');if(await phone.locator('#display-help').isVisible())await phone.locator('#close-display').click();await phone.waitForFunction(()=>document.getElementById('connection').textContent==='接続済み');
   const id=await phone.locator('#device').innerText();const row=page.locator(`[data-device="${id}"]`);await row.waitFor();
   await page.locator('#device-search').fill('ZZZZZZ');await page.waitForFunction(()=>document.getElementById('devices').textContent.includes('該当する端末'));
   await page.locator('#device-search').fill(id);
   await row.getByRole('combobox').selectOption('中央');await page.waitForTimeout(1200);assert.equal(await row.getByRole('combobox').inputValue(),'中央');
   await row.getByRole('button',{name:'割り当て',exact:true}).click();await phone.waitForFunction(()=>document.getElementById('fixture').textContent==='中央');
   await eventually(async()=>(await snapshot()).fixtures[0].device===id);
   await page.locator('[data-filter="unassigned"]').click();await page.waitForTimeout(1200);assert.equal(await page.locator('#fixtures tr').count(),1);
   await page.locator('[data-filter="all"]').click();
   page.once('dialog',async dialog=>{assert(dialog.message().includes('この灯体は0になります'));await dialog.accept();});
   await row.getByRole('button',{name:`${id}の中央を解除`}).click();await phone.waitForFunction(()=>!document.getElementById('waiting').hidden);
   await row.getByRole('combobox').selectOption('右');await row.getByRole('button',{name:'割り当て',exact:true}).click();await phone.waitForFunction(()=>document.getElementById('fixture').textContent==='右');
   await row.getByRole('button',{name:`${id}の登録を削除`}).click();await page.locator('#cancel-forget').click();assert((await snapshot()).fixtures[1].device===id);
   await row.getByRole('button',{name:`${id}の登録を削除`}).click();await page.locator('#confirm-forget').click();await phone.waitForFunction(()=>!document.getElementById('waiting').hidden);
   await eventually(async()=>(await snapshot()).fixtures[1].device==='');
   await page.screenshot({path:join(dir,name+'-desktop.png'),fullPage:true});
   for(const width of [1280,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:join(dir,name+'-'+width+'.png'),fullPage:true});}
   await phoneContext.close();await adminContext.close();assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
   results.push({engine:name,qrDecoded:decoded,search:true,selectPreservedDuringRefresh:true,assign:true,release:true,forgetCancelAndConfirm:true,filter:true,noOverflow:[1440,1280,390],noPageErrors:true,noFailedAssets:true});
  }finally{await browser.close()}
 }
 // Stop the isolated backend, verify stale data is marked unavailable and controls disabled.
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE});try{
  const page=await browser.newPage();await page.goto('http://127.0.0.1:18769/');await page.waitForFunction(()=>document.getElementById('server-label').textContent.includes('稼働中'));
  backend.kill('SIGTERM');await page.waitForFunction(()=>document.body.classList.contains('offline'),null,{timeout:12000});
  assert.equal(await page.locator('#qlc-label').innerText(),'QLC+ 確認できず');results.push({backendUnavailable:true});
 }finally{await browser.close()}
 console.log(JSON.stringify({dir,results},null,2));
}finally{for(const p of children)p.kill('SIGTERM');await sleep(1000);for(const p of children)if(p.exitCode===null)p.kill('SIGKILL');await fake.close();}
