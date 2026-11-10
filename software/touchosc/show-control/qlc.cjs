'use strict';
// Local QLC+ adapter; install dependencies with npm ci --ignore-scripts.
const dgram = require('node:dgram');
const WebSocket = require('ws');
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));

function oscString(s) {
  const b=Buffer.from(s+'\0');return Buffer.concat([b,Buffer.alloc((4-b.length%4)%4)]);
}
function packet(address,args) {
  const tags=','+args.map(a=>typeof a==='number'?'i':'s').join('');
  return Buffer.concat([oscString(address),oscString(tags),...args.map(a=>{
    if(typeof a!=='number')return oscString(a);
    const b=Buffer.alloc(4);b.writeInt32BE(a);return b;
  })]);
}
function decode(b) {
  let i=0;function str(){const end=b.indexOf(0,i);if(end<0)throw Error('OSC');const s=b.toString('utf8',i,end);i=(end+4)&~3;return s;}
  const address=str(),tags=str(),args=[];
  for(const tag of tags.slice(1)) {
    if(tag==='s')args.push(str());
    else if(tag==='i'){args.push(b.readInt32BE(i));i+=4;}
    else throw Error('OSC type');
  }
  return {address,args};
}
const OPERATION_TIMEOUT=1100; // Live expires pending QLC commands after 1500 ms.
async function execute(url,action,value) {
  if(action!=='qlc_stop'||value!=='')throw Error('Unknown lighting action');
  const deadline=Date.now()+OPERATION_TIMEOUT;
  const remaining=()=>{const ms=deadline-Date.now();if(ms<=0)throw Error('QLC+ operation timeout');return ms;};
  const ws=new WebSocket(url,{handshakeTimeout:Math.min(600,remaining())});
  ws.on('error',()=>{});
  try {
    await new Promise((resolve,reject)=>{
      function cleanup(){ws.off('open',open);ws.off('close',closed);ws.off('error',failed);}
      function open(){cleanup();resolve();}
      function closed(){cleanup();reject(Error('QLC+ connection closed'));}
      function failed(e){cleanup();reject(e);}
      ws.once('open',open);ws.once('close',closed);ws.once('error',failed);
    });
    function send(command){remaining();if(ws.readyState!==WebSocket.OPEN)throw Error('QLC+ connection closed');ws.send(command);}
    const rpc=cmd=>new Promise((resolve,reject)=>{
      const prefix=cmd.split('|').slice(0,2).join('|')+'|';
      const timer=setTimeout(()=>{cleanup();reject(Error('QLC+ response timeout'));},Math.min(650,remaining()));
      function cleanup(){clearTimeout(timer);ws.off('message',on);ws.off('close',closed);ws.off('error',failed);}
      function closed(){cleanup();reject(Error('QLC+ connection closed'));}
      function failed(e){cleanup();reject(e);}
      function on(b){const s=b.toString();if(s.startsWith(prefix)){cleanup();resolve(s.slice(prefix.length));}}
      ws.on('message',on);ws.once('close',closed);ws.once('error',failed);
      try{send(cmd);}catch(e){cleanup();reject(e);}
    });
    const list=(await rpc('QLC+API|getFunctionsList')).split('|');
    const ids=list.filter((v,i)=>i%2===0&&/^\d+$/.test(v));
    if(!ids.length)throw Error('QLC+ functions missing');
    for(const id of ids)send('QLC+API|setFunctionStatus|'+id+'|0');
    await wait(Math.min(100,remaining()));
    for(const id of ids)if(await rpc('QLC+API|getFunctionStatus|'+id)!=='Stopped')throw Error('Function still running');
    return {functions:ids.length};
  } finally {
    if(ws.readyState===WebSocket.OPEN){ws.close();setTimeout(()=>ws.terminate(),150).unref();}
    else ws.terminate();
  }
}
function start({port=8002,url='ws://127.0.0.1:9999/qlcplusWS'}={}) {
  const udp=dgram.createSocket('udp4');let active=null;
  udp.on('error',e=>{console.error(JSON.stringify({event:'udp_error',error:e.message}));udp.close();process.exitCode=1;});
  udp.on('message',(b,source)=>{
    try {
      const {address,args}=decode(b);
      if(address==='/stage/qlc_health'&&args.length===1&&Number.isInteger(args[0])&&source.address==='127.0.0.1'){
        udp.send(packet('/stage/qlc_health_ack',[args[0],2]),source.port,source.address);return;
      }
      if(address!=='/stage/qlc'||args.length!==3)return;
      const [id,action,value]=args;
      if(!Number.isInteger(id)||action!=='qlc_stop'||value!==''||source.address!=='127.0.0.1')return;
      const began=Date.now();
      // Repeated stop presses share the in-flight result; no late command queue.
      if(!active)active=execute(url,action,value).finally(()=>{active=null;});
      active.then(result=>{
        udp.send(packet('/stage/qlc_ack',[id,1,'']),source.port,source.address);
        console.log(JSON.stringify({time:new Date().toISOString(),event:'stop_verified',id,ms:Date.now()-began,...result}));
      },e=>{
        udp.send(packet('/stage/qlc_ack',[id,0,e.message]),source.port,source.address);
        console.error(JSON.stringify({time:new Date().toISOString(),event:'stop_failed',id,ms:Date.now()-began,error:e.message}));
      });
    } catch(e) { /* Ignore non-stage UDP packets. */ }
  });
  udp.bind(port,'127.0.0.1');return udp;
}
module.exports={execute,start,packet,decode,OPERATION_TIMEOUT};
if(require.main===module){start({url:process.argv[2]||undefined});console.log('Stage QLC+ adapter listening on localhost:8002');}
