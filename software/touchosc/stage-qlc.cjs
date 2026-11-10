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
async function execute(url,action,value) {
  const ws=new WebSocket(url,{handshakeTimeout:600});
  try {
    await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);});
    const rpc=cmd=>new Promise((resolve,reject)=>{
      const prefix=cmd.split('|').slice(0,2).join('|')+'|';
      const timer=setTimeout(()=>{ws.off('message',on);reject(Error('QLC+ response timeout'));},650);
      function on(b){const s=b.toString();if(s.startsWith(prefix)){clearTimeout(timer);ws.off('message',on);resolve(s.slice(prefix.length));}}
      ws.on('message',on);ws.send(cmd);
    });
    const list=(await rpc('QLC+API|getFunctionsList')).split('|');
    const ids=list.filter((v,i)=>i%2===0&&/^\d+$/.test(v));
    if(!ids.length)throw Error('QLC+ functions missing');
    if(action==='border') {
      if(!ids.includes('10')||!['on','off'].includes(value))throw Error('Border scene missing');
      ws.send('QLC+API|setFunctionStatus|10|'+(value==='on'?'1':'0'));
      await wait(100);
      const actual=await rpc('QLC+API|getFunctionStatus|10');
      if(actual!==(value==='on'?'Running':'Stopped'))throw Error('Border state mismatch');
    } else if(action==='qlc_stop') {
      for(const id of ids)ws.send('QLC+API|setFunctionStatus|'+id+'|0');
      await wait(100);
      for(const id of ids)if(await rpc('QLC+API|getFunctionStatus|'+id)!=='Stopped')throw Error('Function still running');
    } else throw Error('Unknown lighting action');
  } finally {ws.on('error',()=>{});ws.close();}
}
function start({port=8002,url='ws://127.0.0.1:9999/qlcplusWS'}={}) {
  const udp=dgram.createSocket('udp4');let queue=Promise.resolve();
  udp.on('message',(b,source)=>{
    try {
      const {address,args}=decode(b);
      if(address!=='/stage/qlc'||args.length!==3)return;
      const [id,action,value]=args;
      queue=queue.then(async()=>{
        try{await execute(url,action,value);udp.send(packet('/stage/qlc_ack',[id,1,'']),source.port,source.address);}
        catch(e){udp.send(packet('/stage/qlc_ack',[id,0,e.message]),source.port,source.address);}
      });
    } catch(e) { /* Ignore non-stage UDP packets. */ }
  });
  udp.bind(port,'127.0.0.1');return udp;
}
module.exports={execute,start,packet,decode};
if(require.main===module){start({url:process.argv[2]||undefined});console.log('Stage QLC+ adapter listening on localhost:8002');}
