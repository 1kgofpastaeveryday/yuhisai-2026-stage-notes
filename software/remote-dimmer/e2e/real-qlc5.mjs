// Observation-only bridge: all values below come from the real QLC+ readbacks.
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {connect} from 'node:net';
import {once} from 'node:events';
import {openSync,appendFileSync} from 'node:fs';
import {decoder} from './fake-qlc5.mjs';
import {openQLC,query} from './qlc.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function startReal({cwd,project='show5.qxw',port=9999,bridge=false}) {
 const commands=[],sliders=new Map(),channels=new Map(),sockets=new Set();
 const log=openSync(cwd+'qlc5.log','a');
 const app=spawn('/Applications/QLC+ 5.app/Contents/MacOS/qlcplus5',['-w',...(bridge?['--web-port','9998']:[]),cwd+project],{cwd,stdio:['ignore',log,log]});
 let server;
 if(bridge){
  server=createServer();server.on('upgrade',(req,client,head)=>{
   const upstream=connect(9998,'127.0.0.1');sockets.add(client);sockets.add(upstream);
   const observe=decoder((text,op)=>{if(op===1){const entry={time:new Date().toISOString(),command:text};commands.push(entry);appendFileSync(cwd+'real-qlc5-wire.log',JSON.stringify(entry)+'\n');}});
   upstream.on('connect',()=>{upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n`+req.rawHeaders.reduce((s,v,i)=>s+v+(i%2?'\r\n':': '),'')+'\r\n');if(head.length){observe(head);upstream.write(head);}});
   client.on('data',b=>{observe(b);upstream.write(b);});upstream.on('data',b=>client.write(b));
   client.on('error',()=>upstream.destroy());upstream.on('error',()=>client.destroy());client.on('close',()=>{sockets.delete(client);upstream.destroy();});upstream.on('close',()=>{sockets.delete(upstream);client.destroy();});
  });server.listen(port,'127.0.0.1');await once(server,'listening');
 }
 let ws;
 for(let i=0;i<100;i++){try{ws=await openQLC();break;}catch{}await pause(100);}
 if(!ws){for(const s of sockets)s.destroy();if(server)await new Promise(r=>server.close(r));if(app.exitCode===null&&app.signalCode===null)app.kill('SIGKILL');throw Error('real QLC+ startup failed');}ws.close();
 const result={commands,sliders,channel:c=>channels.get(c),app,
 async refresh(){const ws=await openQLC();try{
  for(const id of [45,46,47,120]){const raw=await query(ws,'QLC+API|getWidgetStatus|'+id);sliders.set(id,+raw.split('|')[3]);appendFileSync(cwd+'real-qlc5-readbacks.log',JSON.stringify({time:new Date().toISOString(),raw})+'\n');}
  for(const address of [1,2,21,22,23,24,26]){const raw=await query(ws,`QLC+API|getChannelsValues|1|${address}|1`),p=raw.split('|');channels.set(address,{value:+p[3],isOverride:+p[5]});appendFileSync(cwd+'real-qlc5-readbacks.log',JSON.stringify({time:new Date().toISOString(),raw})+'\n');}
 }finally{ws.close();}},
 async close(){for(const s of sockets)s.destroy();if(server)await new Promise(r=>server.close(r));if(app.exitCode===null&&app.signalCode===null){app.kill('SIGTERM');await Promise.race([once(app,'exit'),pause(2000)]);if(app.exitCode===null&&app.signalCode===null){app.kill('SIGKILL');await once(app,'exit');}}}};
 await result.refresh();return result;
}
