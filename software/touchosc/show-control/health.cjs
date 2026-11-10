'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const WebSocket=require('ws');
async function check(url,profile){
 const began=Date.now();
 await new Promise((resolve,reject)=>{
  const request=http.get(url.replace('ws:','http:').replace('/qlcplusWS','/vc.json'),response=>{
   let body='';response.on('data',b=>body+=b);response.on('end',()=>{
    try{if(response.statusCode!==200)throw Error('HTTP '+response.statusCode);JSON.parse(body);resolve();}catch(e){reject(e);}
   });
  });request.on('error',reject);request.setTimeout(1000,()=>request.destroy(Error('HTTP timeout')));
 });
 const ws=new WebSocket(url,{handshakeTimeout:700});ws.on('error',()=>{});
 try{
  await new Promise((resolve,reject)=>{ws.once('open',resolve);ws.once('error',reject);ws.once('close',()=>reject(Error('WebSocket closed')));});
  const message=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Web API timeout')),700);
   ws.on('message',data=>{const text=String(data);if(text.startsWith('QLC+API|getFunctionsList|')){clearTimeout(timer);resolve(text);}});
   ws.send('QLC+API|getFunctionsList');
  });
  const parts=message.slice('QLC+API|getFunctionsList|'.length).split('|');const functions={};
  for(let i=0;i<parts.length;i+=2)functions[parts[i]]=parts[i+1];
  const expected=profile.functions;
  if(Object.keys(expected).length!==Object.keys(functions).length||Object.keys(expected).some(id=>functions[id]!==expected[id]))throw Error('QLC+ show does not match '+profile.title);
  return {success:true,profile:profile.id,functions:Object.keys(functions).length,ms:Date.now()-began};
 }finally{ws.terminate();}
}
module.exports={check};
if(require.main===module){
 const profiles=JSON.parse(fs.readFileSync(path.join(__dirname,'profiles.json'),'utf8'));
 const profile=profiles.shows.find(s=>s.id===(process.argv[2]||'c2'));
 if(!profile)throw Error('Unknown show');
 check(process.argv[3]||'ws://127.0.0.1:9999/qlcplusWS',profile).then(result=>console.log(JSON.stringify(result)),e=>{console.log(JSON.stringify({success:false,error:e.message}));process.exitCode=1;});
}
