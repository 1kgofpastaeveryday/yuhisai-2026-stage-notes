// Read-only mock socket; no live control commands are sent.
import {createRequire} from 'node:module';import {spawn} from 'node:child_process';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const {chromium,webkit}=require(process.env.PLAYWRIGHT_MODULE||'/opt/homebrew/lib/node_modules/@playwright/cli/node_modules/playwright');
const server=spawn('/tmp/<HOST>-web',['-listen','127.0.0.1:18768','-upstream','ws://127.0.0.1:1/ws'],{stdio:'ignore'});const results=[];
try{
 for(let n=0;n<50;n++){try{await fetch('http://127.0.0.1:18768/yuhisai/2026/dimmer/');break;}catch{await new Promise(r=>setTimeout(r,100));}}
 for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await engine.launch({headless:true,executablePath:process.env[name==='chromium'?'CHROMIUM_EXECUTABLE':'WEBKIT_EXECUTABLE']});
  try{
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage();
   await page.routeWebSocket('**/ws',ws=>ws.onMessage(message=>{const m=JSON.parse(message);if(m.type==='ping')ws.send('{"type":"pong"}');if(m.type==='hello')ws.send(JSON.stringify({type:'state',device:m.device,qlc:'connected',fixtures:[{name:'中央',level:128,active:true,overridden:false,faderMode:'relative'}]}));}));
   await page.goto('http://127.0.0.1:18768/yuhisai/2026/dimmer/');
   await page.waitForFunction(()=>document.getElementById('connection').textContent==='接続済み');
   const api=await page.evaluate(()=>document.fullscreenEnabled);
   if(api){assert(await page.locator('#native-start').isVisible());await page.locator('#start-fullscreen').tap();await page.waitForFunction(()=>!!document.fullscreenElement);await page.locator('#fullscreen').tap();await page.waitForFunction(()=>!document.fullscreenElement);await page.waitForFunction(()=>document.getElementById('fullscreen').textContent==='全画面表示');}
   for(const [width,height] of [[390,844],[320,568],[844,390],[568,320]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(100);
    const info=await page.evaluate(()=>({scroll:document.documentElement.scrollHeight>innerHeight||document.documentElement.scrollWidth>innerWidth,surface:document.getElementById('surface').getBoundingClientRect().height,footer:document.querySelector('footer').getBoundingClientRect().bottom,height:innerHeight}));
    assert.equal(info.scroll,false);assert(info.surface>20,JSON.stringify(info));assert(info.footer<=height+1,JSON.stringify(info));
    if(name==='chromium')await page.mouse.wheel(0,300);else await page.evaluate(()=>window.scrollTo(0,300));assert.equal(await page.evaluate(()=>scrollY),0);results.push({engine:name,width,height,noScroll:true,footerVisible:true});
   }
   await page.setViewportSize({width:390,height:844});await page.screenshot({path:`/tmp/dimmer-phone-display-${name}.png`});
   const manifest=await (await context.request.get('http://127.0.0.1:18768/yuhisai/2026/dimmer/manifest.webmanifest')).json();assert.equal(manifest.display,'standalone');
   assert.equal((await context.request.get('http://127.0.0.1:18768/yuhisai/2026/dimmer/icon.png')).status(),200);
   await context.close();
   const safari=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   await safari.addInitScript(()=>{Object.defineProperty(document,'fullscreenEnabled',{get:()=>false});});const p=await safari.newPage();
   await p.goto('http://127.0.0.1:18768/yuhisai/2026/dimmer/');await p.locator('#fullscreen').tap();assert(await p.locator('#install-help').isVisible());assert((await p.locator('#install-help').innerText()).includes('ホーム画面に追加'));await p.locator('#close-display').tap();await safari.close();
   const installed=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   await installed.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{get:()=>true});});const home=await installed.newPage();await home.goto('http://127.0.0.1:18768/yuhisai/2026/dimmer/');assert.equal(await home.locator('#display-help').isVisible(),false);assert.equal(await home.locator('#fullscreen').innerText(),'表示設定');await home.locator('#fullscreen').tap();assert.equal(await home.locator('#display-title').innerText(),'通常表示に戻す');await installed.close();
   results.push({engine:name,fullscreenSupported:api,manifest:true,unsupportedHelp:true,standaloneBehavior:true});
  }finally{await browser.close()}
 }
 console.log(JSON.stringify(results,null,2));
}finally{server.kill('SIGTERM');}
