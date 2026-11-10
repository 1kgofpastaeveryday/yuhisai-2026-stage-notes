// TEST DOUBLE ONLY: a small QLC+ 5.3.0 protocol subset, not a lighting engine.
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function frame(payload, opcode = 1) {
  const b = Buffer.from(payload), h = Buffer.alloc(b.length < 126 ? 2 : 4);
  h[0] = 0x80 | opcode;
  if (b.length < 126) h[1] = b.length;
  else { h[1] = 126; h.writeUInt16BE(b.length, 2); }
  return Buffer.concat([h,b]);
}
// Incremental framing for our small text messages, including masked client frames.
export function decoder(receive) {
  let pending = Buffer.alloc(0), fragments = [];
  return chunk => {
    pending = Buffer.concat([pending,chunk]);
    while (pending.length >= 2) {
      const first = pending[0], masked = pending[1] & 128;
      let n = pending[1] & 127, offset = 2;
      if (n === 126) { if (pending.length < 4) return; n = pending.readUInt16BE(2); offset = 4; }
      if (n === 127) throw Error('test double does not support 64-bit payload lengths');
      const total = offset + (masked ? 4 : 0) + n;
      if (pending.length < total) return;
      const mask = masked ? pending.subarray(offset,offset+4) : null;
      if (mask) offset += 4;
      const body = Buffer.from(pending.subarray(offset,total));
      if (mask) for (let i=0;i<body.length;i++) body[i] ^= mask[i%4];
      pending = pending.subarray(total);
      const op = first & 15;
      if (op === 1 || op === 0) {
        fragments.push(body);
        if (first & 128) { receive(Buffer.concat(fragments).toString(),1); fragments = []; }
      } else receive(body,op);
    }
  };
}
export async function startFake({logFile, defaults = {}, initial = {}, port = 9999} = {}) {
  const commands = [], channels = new Map(), sliders = new Map([[45,0],[47,0]]), sockets = new Set();
  const sliderChannels = new Map([[45,1],[47,20]]);
  let page = 0;
  const channel = abs => {
    if (!channels.has(abs)) channels.set(abs,{value: initial[abs] ?? defaults[abs] ?? 0, isOverride:0});
    return channels.get(abs);
  };
  const server = createServer((req,res) => {res.writeHead(404);res.end();});
  server.on('upgrade',(req,socket,head) => {
    if (req.url !== '/qlcplusWS') {socket.destroy();return;}
    const accept = createHash('sha1').update(req.headers['sec-websocket-key']+'<REDACTED>').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    const receive = decoder((text,op) => {
      if (op === 8) {socket.end(frame(text,8));return;}
      if (op === 9) {socket.write(frame(text,10));return;}
      if (op !== 1) return;
      const record = {time:new Date().toISOString(),command:text};commands.push(record);
      if (logFile) appendFileSync(logFile,JSON.stringify(record)+'\n');
      const p = text.split('|');
      if (p[0] === 'CH') Object.assign(channel(+p[1]),{value:+p[2],isOverride:1});
      else if (p[0] === 'QLC+API') {
        if (p[1] === 'getWidgetStatus') socket.write(frame('QLC+API|getWidgetStatus|'+(sliders.has(+p[2]) ? p[2]+'|'+sliders.get(+p[2]) : '')));
        if (p[1] === 'getChannelsValues') {
          const fields = ['QLC+API','getChannelsValues'];
          for (let i=0;i<+(p[4]??1);i++) {
            const addr = +p[3]+i, c = channel((+p[2]-1)*512+addr);
            fields.push(addr,c.value,'0.#000000',c.isOverride);
          }
          socket.write(frame(fields.join('|')));
        }
        if (p[1] === 'sdResetChannel') {
          Object.assign(channel(+p[2]),{value:defaults[+p[2]]??0,isOverride:0});
          const fields=['QLC+API','getChannelsValues'];
          for(let address=1;address<=32;address++){const c=channel(address);fields.push(address,c.value,'0.#000000',c.isOverride);}
          socket.write(frame(fields.join('|')));
        }
      } else if (p[1] === 'NEXT_PG') page = 1;
      else if (p[1] === 'PREV_PG') page = 0;
      else if (sliders.has(+p[0])) {
        sliders.set(+p[0],+p[1]);const c=channel(sliderChannels.get(+p[0]));
        if (!c.isOverride) c.value = +p[1];
      }
    });
    socket.on('data',receive);if(head.length)receive(head);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {port:server.address().port,commands,channel,sliders,get page(){return page;}, async close(){for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));}};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fake = await startFake({logFile:process.env.FAKE_LOG ?? 'fake-qlc5.log', defaults:JSON.parse(process.env.FAKE_DEFAULTS ?? '{}'),initial:JSON.parse(process.env.FAKE_INITIAL ?? '{}')});
  console.log('TEST DOUBLE ws://127.0.0.1:9999/qlcplusWS');
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await fake.close();});
}
