'use strict';
// Deterministic loopback faults only. Never connect to the user's QLC or MIDI ports.
const assert = require('assert');
const http = require('http');
const {WebSocketServer} = require('ws');
const {WebBridge, matchingProject} = require('./web-bridge');
const MidiRouter = require('./midi-router');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, ms = 1500) {
    const end = Date.now() + ms;
    while (!predicate()) { if (Date.now() > end) throw new Error('Timed out'); await pause(5); }
}
function source(name = 'Flash', revision = '1') {
    const controls = Array.from({length:128}, (_, liveNote) => ({liveNote, valid:false}));
    controls[36] = {liveNote:36, channel:0, note:36, widgetId:'1', name,
        type:'Button', action:'Flash', functionId:'10', valid:true, pageIndex:0};
    return {source:'debug.qxw', revision, controls};
}
function project(name = 'Flash') {
    return {pages:[{index:0, caption:'Page1', children:[{id:1, typeId:1,
        caption:name, actionType:1, functionId:10}]}]};
}
async function withServer(run) {
    const env = {json:project(), messages:[], upgrades:[], requests:0, holdHttp:false, holdUpgrade:false};
    const server = http.createServer((req,res) => {
        env.requests++;
        const body = JSON.stringify(env.json);
        const reply = () => {res.setHeader('Content-Type','application/json');res.end(body);};
        if (env.holdHttp) {env.holdHttp=false;env.reply=reply;} else reply();
    });
    const wss = new WebSocketServer({noServer:true});
    server.on('upgrade', (req,socket,head) => {
        const accept = () => wss.handleUpgrade(req,socket,head,ws => wss.emit('connection',ws,req));
        env.upgrades.push(accept);
        if (!env.holdUpgrade) accept();
    });
    wss.on('connection', ws => ws.on('message', m => env.messages.push(m.toString())));
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const statuses=[];
    const bridge = new WebBridge('http://127.0.0.1:'+server.address().port,s=>statuses.push(s));
    try { await run(bridge,env,statuses); }
    finally {
        if (env.reply) env.reply();
        bridge.stop();
        for (const ws of wss.clients) ws.terminate();
        await new Promise(resolve => wss.close(resolve));
        await new Promise(resolve => server.close(resolve));
    }
}
async function main() {
    const selected = process.argv[2];
    {
        const data = source(), json = project();
        data.controls[36].valid = false;
        data.controls[36].functionId = '4294967295';
        json.pages[0].children[0].functionId = -1;
        assert.equal(matchingProject(data,json),true,'Unsigned XML and signed JSON invalid Function IDs match');
        json.pages[0].children[0].functionId = 10;
        assert.equal(matchingProject(data,json),false,'A detached saved button must not match an attached running button');
    }
    if (!selected || selected === 'slider') {
        const data=source(),json=project();
        data.controls[36].type='Slider';data.controls[36].action='Intensity';
        const widget=json.pages[0].children[0];widget.typeId=2;widget.sliderMode='Level';
        assert.equal(matchingProject(data,json),false,'A same-name Level slider is not an Intensity control');
        widget.sliderMode='Adjust';assert.equal(matchingProject(data,json),true);
    }
    if (!selected || selected === 'handshake') await withServer(async (bridge,env,statuses) => {
        env.holdUpgrade=true;
        bridge.update(source());bridge.enable(true);
        await until(()=>env.upgrades.length===1);
        // A new save invalidates the HTTP match while the socket is still connecting.
        bridge.update(source('Changed','2'));
        await until(()=>statuses.includes('QLC+ project differs from saved source'));
        env.upgrades[0]();
        await until(()=>bridge.socket && bridge.socket.readyState===1);
        assert.equal(bridge.ready,false,'A stale handshake must not reopen the output gate');
        bridge.note(36,127);bridge.note(36,0);await pause(20);
        assert.deepEqual(env.messages,[]);
        env.json=project('Changed');await bridge.check();await until(()=>bridge.ready);
        bridge.note(36,127);bridge.note(36,0);await until(()=>env.messages.length===2);
        assert.deepEqual(env.messages,['1|255','1|0']);
    });
    if (!selected || selected === 'http') await withServer(async (bridge,env,statuses) => {
        env.holdHttp=true;
        bridge.update(source());bridge.enable(true);await until(()=>env.reply);
        bridge.enable(false);bridge.enable(true);
        env.json={pages:[]};const reply=env.reply;env.reply=null;reply();
        await until(()=>statuses.includes('QLC+ project differs from saved source'),500);
        assert(env.requests>=2,'Re-enable must check the current project again');
        assert.equal(env.upgrades.length,0,'The HTTP response from the old session must be discarded');
        assert.equal(bridge.ready,false);
    });
    if (!selected || selected === 'old-socket') await withServer(async (bridge,env) => {
        bridge.update(source());bridge.enable(true);await until(()=>bridge.ready);
        const old=bridge.socket;bridge.enable(false);bridge.enable(true);await until(()=>bridge.ready);
        // Deliver a delayed callback from the retired connection after a new one opened.
        old.emit('error',new Error('Delayed retired socket error'));
        assert.equal(bridge.ready,true,'A retired socket cannot change the new connection');
    });
    if (!selected || selected === 'partial-note') {
        const packets=[],router=new MidiRouter(p=>packets.push(p));
        router.update(source().controls);
        router.byte(144);router.byte(36);router.panic();router.byte(127);
        assert.deepEqual(packets,[],'Stop must discard the partial pre-stop Note On');
        for (const b of [144,36,127,128,36,0]) router.byte(b);
        assert.deepEqual(packets,[[144,36,127],[128,36,0]]);
    }
    console.log('PASS: slider-mode mismatch, save/handshake race, stale HTTP response, retired socket and partial-note stop regression checks.');
}
main().catch(error=>{console.error(error);process.exit(1);});
