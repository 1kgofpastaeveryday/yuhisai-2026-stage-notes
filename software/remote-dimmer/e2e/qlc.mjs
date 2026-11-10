// Node 26 built-in WebSocket; only loopback traffic.
export async function openQLC() {
  const ws = new WebSocket('ws://127.0.0.1:9999/qlcplusWS');
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, {once: true});
    ws.addEventListener('error', reject, {once: true});
  });
  return ws;
}
export async function query(ws, frame) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {ws.removeEventListener('message', receive); reject(Error('timeout: '+frame));}, 2000);
    function receive(e) {
      const fields = frame.split('|');
      const prefix = fields[1] === 'getChannelsValues'
        ? fields.slice(0, 2).join('|') + '|' + fields[3] + '|'
        : fields.slice(0, 3).join('|') + '|';
      if (!e.data.startsWith(prefix)) return;
      clearTimeout(timer); ws.removeEventListener('message', receive); resolve(e.data);
    }
    ws.addEventListener('message', receive);
    ws.send(frame);
  });
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const ws = await openQLC();
  for (const frame of process.argv.slice(2)) {
    if (frame.startsWith('QLC+API|get')) console.log(await query(ws, frame));
    else {ws.send(frame); await new Promise(r=>setTimeout(r,100)); console.log('sent '+frame);}
  }
  ws.close();
}
