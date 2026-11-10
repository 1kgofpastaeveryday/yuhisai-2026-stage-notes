'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const surface = $('surface');
  let identity, socket, retry, heartbeat, reconcile, pending, flushTimer, drag;
  let state = null, fixture = null, level = 0, seq = 0, ready = false;
  let lastPong = 0, lastInput = 0, lastSend = 0, generation = 0, rejected = false, lastNonzero = 255;
  const clamp = n => Math.min(255, Math.max(0, Math.round(n)));
  function credentials() {
    const name = 'dimmer-web-identity-v1';
    const stored = localStorage.getItem(name);
    if (stored) {
      const value = JSON.parse(stored);
      if (!/^[0-9A-HJKMNP-TV-Z]{6}$/.test(value.id) || !/^[A-Za-z0-9_-]{43}$/.test(value.key)) throw Error('identity');
      return value;
    }
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const value = {
      id: [...crypto.getRandomValues(new Uint8Array(6))].map(n => alphabet[n % 32]).join(''),
      key: btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
    };
    localStorage.setItem(name, JSON.stringify(value));
    return value;
  }
  function canOperate() {
    return ready && !document.hidden && !$('display-help').open && state?.qlc === 'connected' && state.fixtures.length === 1 && fixture?.active === true;
  }
  function cancelInput() {
    generation++;
    drag = null; pending = null;
    clearTimeout(flushTimer); flushTimer = null; clearTimeout(reconcile);
  }
  function render() {
    const enabled = canOperate();
    const assigned = state?.fixtures.length === 1;
    $('waiting').hidden = assigned;
    $('control').hidden = !assigned;
    $('percent').hidden = !assigned;
    $('fixture').textContent = assigned ? fixture.name : '照明リモート';
    $('percent').replaceChildren(document.createTextNode(String(Math.round(level / 255 * 100))), Object.assign(document.createElement('span'), {textContent:'%'}));
    $('fill').style.height = `${level / 255 * 100}%`;
    surface.setAttribute('aria-valuenow', String(level));
    surface.setAttribute('aria-valuetext', `${Math.round(level / 255 * 100)}%`);
    surface.setAttribute('aria-disabled', String(!enabled));
    $('off').disabled = $('toggle').disabled = !enabled;
    $('toggle').textContent = level > 0 ? '消灯' : '点灯';
    let text = '操作できます', tone = '';
    if (rejected) { text = '端末の登録をMacで確認してください'; tone = 'danger'; }
    else if (!ready) { text = '再接続中'; tone = 'danger'; }
    else if (state.fixtures.length > 1) { text = 'Macで割り当てを1灯体にしてください'; tone = 'warning'; }
    else if (!assigned) { text = 'Macで灯体を割り当ててください'; }
    else if (state.qlc !== 'connected') { text = 'QLC+未接続'; tone = 'danger'; }
    else if (!fixture.active) { text = 'QLC+側で操作中'; tone = 'danger'; }
    else if (fixture.overridden) { text = 'ほかの出力で上書き中'; tone = 'warning'; }
    $('status').textContent = text; $('status').dataset.tone = tone;
    $('connection').textContent = ready ? '接続済み' : '未接続';
  }
  function send(fields) {
    if (!canOperate() || socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 16384) return false;
    socket.send(JSON.stringify({...fields, fixture:fixture.name, seq:++seq}));
    return true;
  }
  function flush() {
    clearTimeout(flushTimer); flushTimer = null;
    if (!pending) return;
    const command = pending; pending = null;
    if (command.generation !== generation || command.name !== fixture?.name) return;
    if (send({type:'set', level:command.level})) lastSend = performance.now();
  }
  function reconcileLevel() {
    clearTimeout(reconcile);
    if (drag || !fixture) return;
    const delay = 500 - (performance.now() - lastInput);
    if (delay > 0) { reconcile = setTimeout(reconcileLevel, delay); return; }
    level = fixture.level; if (level > 0) lastNonzero = level; render();
  }
  function setLevel(value) {
    if (!canOperate()) return;
    level = clamp(value); if (level > 0) lastNonzero = level; lastInput = performance.now();
    pending = {level, name:fixture.name, generation};
    if (!flushTimer) flushTimer = setTimeout(flush, Math.max(0, 34 - (performance.now() - lastSend)));
    render(); reconcileLevel();
  }
  function toggle(off = false) {
    if (!canOperate()) return;
    flush();
    // Server owns last-nonzero recall, avoiding stale local recall after reconnect.
    const turnOff = off || level > 0;
    if (send({type:turnOff ? 'off' : 'on'})) {
      if (level > 0) lastNonzero = level;
      level = turnOff ? 0 : lastNonzero; lastInput = performance.now();
      render(); reconcileLevel();
    }
  }
  function drop(ws) {
    if (socket !== ws) return;
    socket = null; ready = false; cancelInput(); clearInterval(heartbeat);
    ws.close(); render();
    if (!document.hidden && !rejected) { clearTimeout(retry); retry = setTimeout(connect, 1000); }
  }
  function connect() {
    clearTimeout(retry);
    if (document.hidden || rejected || socket) return;
    const url = new URL('./ws', location.href); url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(url); socket = ws; seq = 0; lastPong = performance.now();
    ws.onopen = () => {
      if (socket !== ws) return;
      ws.send(JSON.stringify({type:'hello', device:identity.id, key:identity.key, proto:2, app:'web-1.0'}));
    };
    ws.onmessage = event => {
      if (socket !== ws || document.hidden) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'pong') { lastPong = performance.now(); return; }
        if (message.type === 'rejected') { rejected = true; drop(ws); return; }
        if (message.type === 'shutdown') { drop(ws); return; }
        if (message.type !== 'state' || !Array.isArray(message.fixtures) || !['connected','disconnected'].includes(message.qlc)) return;
        if (message.fixtures.some(f => typeof f.name !== 'string' || !Number.isInteger(f.level) || f.level < 0 || f.level > 255 || typeof f.active !== 'boolean')) return;
        const next = message.fixtures.length === 1 ? message.fixtures[0] : null;
        const changed = fixture?.name !== next?.name || fixture?.faderMode !== next?.faderMode;
        if (changed || !next?.active || message.qlc !== 'connected') cancelInput();
        state = message; fixture = next; ready = true;
        if (changed && fixture) { level = fixture.level; lastNonzero = level || 255; }
        reconcileLevel(); render();
      } catch { drop(ws); }
    };
    ws.onclose = ws.onerror = () => drop(ws);
    heartbeat = setInterval(() => {
      if (performance.now() - lastPong > 6500) { drop(ws); return; }
      if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"ping"}');
    }, 2000);
  }
  surface.addEventListener('pointerdown', event => {
    if (!canOperate() || drag || !event.isPrimary || event.button !== 0) return;
    event.preventDefault(); surface.setPointerCapture(event.pointerId);
    const bounds = surface.getBoundingClientRect();
    drag = {id:event.pointerId, y:event.clientY, start:level, moved:false, generation, bounds};
    clearTimeout(reconcile);
    if (fixture.faderMode === 'absolute') setLevel((bounds.bottom - event.clientY) / bounds.height * 255);
  });
  surface.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id || drag.generation !== generation || !canOperate()) return;
    const delta = drag.y - event.clientY;
    if (Math.abs(delta) >= 9) drag.moved = true;
    if (fixture.faderMode === 'absolute') setLevel((drag.bounds.bottom - event.clientY) / drag.bounds.height * 255);
    else if (drag.moved) setLevel(drag.start + delta / drag.bounds.height * 255);
  });
  surface.addEventListener('pointerup', event => {
    if (!drag || drag.id !== event.pointerId) return;
    const tap = !drag.moved && fixture?.faderMode !== 'absolute';
    drag = null; flush();
    if (tap) toggle();
    reconcileLevel();
  });
  for (const type of ['pointercancel','lostpointercapture']) surface.addEventListener(type, () => {
    if (drag) { drag = null; pending = null; clearTimeout(flushTimer); flushTimer = null; reconcileLevel(); }
  });
  surface.addEventListener('keydown', event => {
    const changes = {ArrowUp:13, ArrowRight:13, ArrowDown:-13, ArrowLeft:-13, PageUp:26, PageDown:-26};
    if (event.key in changes) { event.preventDefault(); setLevel(level + changes[event.key]); }
    else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setLevel(event.key === 'Home' ? 0 : 255); }
    else if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); toggle(); }
  });
  const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches;
  function syncDisplay() {
    const active = !!document.fullscreenElement;
    $('fullscreen').textContent = active ? '全画面を解除' : standalone() ? '表示設定' : '全画面表示';
    $('fullscreen').setAttribute('aria-pressed', String(active));
  }
  function showDisplayHelp(nativeStart = false) {
    cancelInput();
    $('install-help').hidden = nativeStart;
    $('native-start').hidden = !nativeStart;
    $('display-title').textContent = nativeStart ? '全画面で開く' : standalone() ? '通常表示に戻す' : '全画面で使う';
    $('install-help').firstElementChild.hidden = standalone();
    $('display-help').showModal(); render();
  }
  async function enterFullscreen() {
    cancelInput();
    try { await document.documentElement.requestFullscreen(); sessionStorage.setItem('dimmer-display', 'fullscreen'); }
    catch { showDisplayHelp(); }
  }
  $('fullscreen').onclick = async () => {
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); sessionStorage.setItem('dimmer-display', 'windowed'); }
      catch { showDisplayHelp(); }
    } else if (document.fullscreenEnabled && !standalone()) await enterFullscreen();
    else showDisplayHelp();
  };
  $('close-display').onclick = () => { sessionStorage.setItem('dimmer-display', 'windowed'); $('display-help').close(); };
  $('start-fullscreen').onclick = async () => { $('display-help').close(); await enterFullscreen(); };
  $('display-help').addEventListener('close', () => { reconcileLevel(); render(); });
  document.addEventListener('fullscreenchange', () => { cancelInput(); reconcileLevel(); syncDisplay(); render(); });
  window.addEventListener('resize', () => { cancelInput(); reconcileLevel(); });
  syncDisplay();
  $('toggle').onclick = () => toggle(); $('off').onclick = () => toggle(true);
  document.addEventListener('visibilitychange', () => { if (socket) drop(socket); if (!document.hidden) connect(); });
  window.addEventListener('pagehide', () => { clearTimeout(retry); if (socket) drop(socket); clearTimeout(retry); });
  window.addEventListener('pageshow', () => { if (identity) connect(); });
  window.addEventListener('online', () => { if (socket) drop(socket); connect(); });
  try {
    identity = credentials(); $('device').textContent = $('large-id').textContent = identity.id;
    render(); connect();
    if (document.fullscreenEnabled && !standalone() && sessionStorage.getItem('dimmer-display') !== 'windowed') showDisplayHelp(true);
  } catch {
    $('status').textContent = 'Safariの通常タブで開いてください'; $('status').dataset.tone = 'danger';
  }
})();
