'use strict';
// All mutating requests in this test target disposable loopback mock servers.
const assert=require('node:assert/strict'),dgram=require('node:dgram'),fs=require('node:fs'),http=require('node:http'),path=require('node:path');
const {WebSocketServer}=require('ws');
const {execute,start,packet,decode,OPERATION_TIMEOUT}=require('./qlc.cjs');
const {check}=require('./health.cjs');
const profiles=JSON.parse(fs.readFileSync(path.join(__dirname,'profiles.json'),'utf8')).shows;
const results={success:false,live_mutations:false,checks:[]};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(functions,mode='normal'){
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{}');});
 const ws=new WebSocketServer({server});const trace={connections:0,stops:[],reads:[]};
 ws.on('connection',s=>{trace.connections++;s.on('message',b=>{
  const c=String(b);trace.reads.push(c);
  if(mode==='silent')return;
  if(c==='QLC+API|getFunctionsList')s.send('QLC+API|getFunctionsList|'+Object.entries(functions).flat().join('|'));
  else if(c.startsWith('QLC+API|setFunctionStatus|'))trace.stops.push(c.split('|')[2]);
  else if(c.startsWith('QLC+API|getFunctionStatus|')){
   if(mode==='disconnect'){s.terminate();return;}
   const reply=()=>{if(s.readyState===1)s.send('QLC+API|getFunctionStatus|'+(mode==='running'?'Running':'Stopped'));};
   if(mode==='delayed')setTimeout(reply,200);else reply();
  }
 });});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 return {url:`ws://127.0.0.1:${server.address().port}/qlcplusWS`,trace,async close(){for(const s of ws.clients)s.terminate();await new Promise(r=>ws.close(r));await new Promise(r=>server.close(r));}};
}
async function main(){
 for(const profile of profiles){
  assert(Object.values(profile.functions).every(n=>typeof n==='string'&&n.length));
  const f=await fixture(profile.functions);
  try{
   assert((await check(f.url,profile)).success);
   const altered={...profile,functions:{...profile.functions}};const id=Object.keys(altered.functions)[0];altered.functions[id]+=' wrong';
   await assert.rejects(check(f.url,altered),/does not match/);
   assert.equal(f.trace.stops.length,0,'preflight must be read only');
   const result=await execute(f.url,'qlc_stop','');
   assert.equal(result.functions,Object.keys(profile.functions).length);
   assert.deepEqual(new Set(f.trace.stops),new Set(Object.keys(profile.functions)));
   results.checks.push({profile:profile.id,functions:result.functions,matching_preflight:true,wrong_name_rejected:true,stop_verified:true});
  }finally{await f.close();}
 }
 for(const mode of ['silent','disconnect','running','delayed']){
  const f=await fixture(Object.fromEntries(Array.from({length:20},(_,i)=>[i,'Test '+i])),mode);const began=performance.now();
  try{await assert.rejects(execute(f.url,'qlc_stop',''));const ms=performance.now()-began;assert(ms<OPERATION_TIMEOUT+150);results.checks.push({fault:mode,rejected:true,ms:Math.round(ms)});}
  finally{await f.close();}
 }
 // Concurrent stop taps must share one operation, never queue late stops.
 for(const mode of ['normal','silent']){
  const f=await fixture({'0':'First','1':'Second'},mode);const adapter=start({port:0,url:f.url});
  await new Promise(r=>adapter.once('listening',r));
  const client=dgram.createSocket('udp4');await new Promise(r=>client.bind(0,'127.0.0.1',r));
  const acks=new Map();let health=false;
  client.on('message',b=>{const {address,args}=decode(b);if(address==='/stage/qlc_ack')acks.set(args[0],args[1]);if(address==='/stage/qlc_health_ack')health=args[0]===99&&args[1]===2;});
  try{
   client.send(packet('/stage/qlc_health',[99]),adapter.address().port,'127.0.0.1');
   await sleep(30);assert(health);assert.equal(f.trace.connections,0);
   for(let i=1;i<=20;i++)client.send(packet('/stage/qlc',[i,'qlc_stop','']),adapter.address().port,'127.0.0.1');
   const end=Date.now()+OPERATION_TIMEOUT+200;while(acks.size<20&&Date.now()<end)await sleep(10);
   assert.equal(acks.size,20);assert([...acks.values()].every(v=>v===(mode==='normal'?1:0)));
   const messages=f.trace.reads.length;await sleep(300);
   assert.equal(f.trace.connections,1);assert.equal(f.trace.reads.length,messages);
   results.checks.push({burst:mode,requests:20,connections:1,all_acknowledged:true,no_late_commands:true,diagnostic_read_only:true});
  }finally{client.close();adapter.close();await f.close();}
 }
 results.success=true;console.log(JSON.stringify({success:true,checks:results.checks.length,live_mutations:false}));
}
main().catch(e=>{results.error=String(e.stack);console.error(e);process.exitCode=1;}).finally(()=>fs.writeFileSync(path.join(__dirname,'webapi-verification.json'),JSON.stringify(results,null,2)+'\n'));
