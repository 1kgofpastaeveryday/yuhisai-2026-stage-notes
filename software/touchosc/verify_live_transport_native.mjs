// Run inside the computer-use Node REPL with its selected Live window.
import net from 'node:net';
import dgram from 'node:dgram';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function rpc(type, params = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({host:'127.0.0.1',port:9877});
    let bytes = Buffer.alloc(0);
    socket.setTimeout(3000, () => socket.destroy(new Error('Live request timeout')));
    socket.on('error',reject);
    socket.on('connect',()=>socket.write(JSON.stringify({type,params})));
    socket.on('data',chunk=>{
      bytes=Buffer.concat([bytes,chunk]);
      let value;
      try {value=JSON.parse(bytes.toString('utf8'));} catch {return;}
      socket.end();
      if(value.status!=='success') reject(new Error(JSON.stringify(value)));
      else resolve(value.result);
    });
  });
}
function oscString(s) {
  const b=Buffer.from(s+'\0','utf8');
  return Buffer.concat([b,Buffer.alloc((4-b.length%4)%4)]);
}
function packet(n,s,a) {
  const b=Buffer.alloc(24),e=Buffer.alloc(8);
  b.writeInt32BE(n,0);b.writeFloatBE(s.current_song_time,4);b.writeInt32BE(Number(s.is_playing),8);
  b.writeFloatBE(s.tempo,12);b.writeInt32BE(s.signature_numerator,16);b.writeInt32BE(s.signature_denominator,20);
  e.writeFloatBE(a.start,0);e.writeFloatBE(a.end,4);
  return Buffer.concat([oscString('/stage/state'),oscString(',ififiisff'),b,oscString(a.title),e]);
}

export async function run({sky,window,folder,write,host='127.0.0.1',port=8000}) {
  const manifest=JSON.parse(await fs.readFile(path.join(folder,'set-manifest.json'),'utf8'));
  const copy=JSON.parse(await fs.readFile(path.join(folder,'test-copy.json'),'utf8'));
  const snapshot=await rpc('get_session_snapshot',{include_notes:false,include_params:false});
  const cues=v=>JSON.stringify(v.map(c=>[c.name,c.time??c.beat]).sort());
  if(cues(snapshot.cue_points)!==cues(manifest.cues)) throw new Error('Wrong set locators');
  if(snapshot.session.master_track.volume!==0||!snapshot.tracks.every(t=>t.mute)) throw new Error('Test copy must be muted');
  const udp=dgram.createSocket('udp4'),samples=[],results=[];
  let sequence=0;
  async function sample() {
    const s=await rpc('get_session_info');
    const a=manifest.acts.filter(a=>a.start<=s.current_song_time).at(-1)||manifest.acts[0];
    sequence++;
    udp.send(packet(sequence,s,a),port,host);
    samples.push({...s,sequence,act:a.title,start:a.start,end:a.end,monotonic:performance.now()/1000});
    return s;
  }
  try {
    for(const [index,a] of manifest.acts.entries()) {
      if((await sample()).is_playing) await rpc('stop_playback');
      const target=a.end-(index===0?16:6);
      // Prepare an actual paused transport position. Assigning song time while
      // stopped changes the displayed cursor, not Live's Continue marker.
      await rpc('start_playback');
      await pause(200);
      await rpc('set_current_song_time',{time:target});
      const waitStart=performance.now();
      while(Math.abs((await sample()).current_song_time-target)>1) {
        if(performance.now()-waitStart>3000)throw new Error('Playhead did not settle');
        await pause(50);
      }
      await pause(250);
      if((await sample()).is_playing)await rpc('stop_playback');
      await pause(150);
      const paused=await sample();
      if(paused.is_playing||paused.current_song_time<target||paused.current_song_time>=a.end-1)throw new Error('Invalid paused test position');
      // The input is the fixed, documented Continue hotkey. Reobserve the same
      // returned window before each action; no element indices or coordinates.
      const before=await sky.get_window_state({window,include_screenshot:false,include_text:true});
      if(!before.window.title?.includes('countdown-test')) throw new Error('Wrong Live window');
      await sky.press_key({window:before.window,key:'Shift_L+space'});
      await sky.get_window_state({window:before.window,include_screenshot:false,include_text:true});
      const started=performance.now();let playing=false,s;
      do {
        s=await sample();playing ||= s.is_playing;
        if(playing&&!s.is_playing)break;
        await pause(50);
      } while(performance.now()-started<12000);
      const offset=s.current_song_time-a.end;
      const result={act:a.title,start_from:paused.current_song_time,target:a.end,observed_end:s.current_song_time,
        observed_playing:playing,auto_stopped:!s.is_playing,offset_beats:offset,
        passed:playing&&!s.is_playing&&offset>=0&&offset<1};
      results.push(result);write(JSON.stringify(result));
      if(!result.passed)break;
    }
    if(results.every(r=>r.passed)) {
      const stopped=(await sample()).current_song_time;
      await pause(250);
      if(Math.abs((await sample()).current_song_time-stopped)>1e-6)throw new Error('Stopped position moved');
    }
  } finally {
    if((await rpc('get_session_info')).is_playing)await rpc('stop_playback');
    udp.close();
    await fs.writeFile(path.join(folder,'live-trace.json'),JSON.stringify(samples,null,2)+'\n');
  }
  const hash=crypto.createHash('sha256').update(await fs.readFile(manifest.source)).digest('hex');
  const report={result:results.length===12&&results.every(r=>r.passed)&&hash===manifest.source_sha256?'PASS':'PARTIAL',
    source_sha256:hash,source_unchanged:hash===manifest.source_sha256,test_copy:copy.test_copy,
    master_volume:0,all_tracks_muted:true,transport_start:'Native Shift+Space Continue',acts:results,
    samples:samples.length,osc_destination:[host,port],ipad_tested:false};
  await fs.writeFile(path.join(folder,'live-transport-verification.json'),JSON.stringify(report,null,2)+'\n');
  return {result:report.result,acts:results.length,samples:samples.length,source_unchanged:report.source_unchanged};
}
