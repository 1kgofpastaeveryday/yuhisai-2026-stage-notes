// Protocol smoke checks for the double; these do not certify real QLC+ behavior.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {startFake,decoder,frame} from './fake-qlc5.mjs';
test('incremental framing handles masked, fragmented text and ping',()=>{
  const received=[],read=decoder((s,op)=>received.push([s.toString(),op]));
  const key=Buffer.from([1,2,3,4]),payload=Buffer.from('CH|21|45');
  for(let i=0;i<payload.length;i++)payload[i]^=key[i%4];
  const wire=Buffer.concat([Buffer.from([0x81,0x80|payload.length]),key,payload]);
  for(const byte of wire)read(Buffer.from([byte]));
  const first=frame('hel');first[0]=1;read(first);read(frame('lo',0));read(frame('ping',9));
  const long='x'.repeat(130);read(frame(long));
  assert.deepEqual(received,[['CH|21|45',1],['hello',1],['ping',9],[long,1]]);
});
test('v5 readback, Simple Desk precedence, release defaults, widget and pages',async()=>{
  const fake=await startFake({port:0,initial:{21:255},defaults:{21:17,1:9}});
  const ws=new WebSocket(`ws://127.0.0.1:${fake.port}/qlcplusWS`);
  try{
    await once(ws,'open');
    async function query(command){const reply=once(ws,'message');ws.send(command);return (await reply)[0].data;}
    ws.send('45|80');
    assert.equal(await query('QLC+API|getWidgetStatus|45'),'QLC+API|getWidgetStatus|45|80');
    assert.equal(await query('QLC+API|getWidgetStatus|99'),'QLC+API|getWidgetStatus|');
    ws.send('CH|1|22');ws.send('45|200');
    assert.equal(await query('QLC+API|getChannelsValues|1|1|1'),'QLC+API|getChannelsValues|1|22|0.#000000|1');
    const reset=(await query('QLC+API|sdResetChannel|1')).split('|');
    assert.equal(reset.length,2+32*4);
    assert.deepEqual(reset.slice(0,6),['QLC+API','getChannelsValues','1','9','0.#000000','0']);
    assert.equal(await query('QLC+API|getChannelsValues|1|1|1'),'QLC+API|getChannelsValues|1|9|0.#000000|0');
    assert.equal(await query('QLC+API|getChannelsValues|1|21|2'),'QLC+API|getChannelsValues|21|255|0.#000000|0|22|0|0.#000000|0');
    ws.send('120|NEXT_PG');ws.send('120|NEXT_PG');await query('QLC+API|getWidgetStatus|45');assert.equal(fake.page,1);
    ws.send('120|PREV_PG');ws.send('120|PREV_PG');await query('QLC+API|getWidgetStatus|45');assert.equal(fake.page,0);
    assert(fake.commands.every(c=>!Number.isNaN(Date.parse(c.time))));
  }finally{ws.close();await fake.close();}
});
