'use strict';
(() => {
 const $=id=>document.getElementById(id);
 const joinURL='https://knudg.com/yuhisai/2026/dimmer/';
 let snapshot=null, online=false, busy=false, refreshing=false, filter='all', selectedForget=null, toastTimer;
 const selected=new Map();
 const bindingLabels={'bound':'登録済み','unbound':'未登録','key conflict':'キー競合'};
 const sourceLabels={phone:'端末',admin:'管理',system:'システム'};
 const errorLabels={
  'server is shutting down':'照明サーバーは停止処理中です。',
  'unknown fixture':'灯体が見つかりません。',
  'fixture already assigned to device':'この端末にはすでに割り当てられています。',
  'no open connection for device':'iPhoneの接続が切れています。接続し直してから割り当ててください。',
  'key conflict: re-check the phone':'端末IDのキーが競合しています。手元のiPhoneを確認し、競合が解消してから割り当ててください。',
  'connection has no valid key':'端末の認証情報を確認してください。',
  'key mismatch':'端末のキーが変わっています。登録を削除してから接続し直してください。'
 };
 function node(tag,className,text){const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;}
 function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,3000);}
 function status(label,tone){const s=node('span','status');s.dataset.tone=tone||'';const dot=node('span','dot');dot.setAttribute('aria-hidden','true');s.append(dot,document.createTextNode(label));return s;}
 function button(text,style,action){const b=node('button',`fd-button ${style||''}`,text);b.type='button';b.addEventListener('click',action);return b;}
 function fail(message){$('error').textContent=message;$('error').hidden=false;}
 function localTime(value){const d=new Date(value);return Number.isNaN(d.valueOf())?'—':d.toLocaleTimeString('ja-JP',{hour12:false});}
 function renderStatus(){
  document.body.classList.toggle('offline',!online);
  const strip=$('connection-strip');
  if(!online){strip.dataset.tone='danger';$('server-label').textContent='照明サーバーに接続できません';$('qlc-label').textContent='QLC+ 確認できず';return;}
  const s=snapshot, connected=s.devices.filter(d=>d.connected).length;
  strip.dataset.tone=s.shuttingDown||s.closing?'warning':s.qlc==='connected'?'success':'danger';
  $('server-label').textContent=s.shuttingDown?'停止（0への送信完了）':s.closing?'照明サーバーを停止中':`照明サーバー稼働中 · ${connected}台接続`;
  $('qlc-label').textContent=s.qlc==='connected'?'QLC+ 接続済み':'QLC+ 未接続';
  $('updated').textContent=`更新 ${new Date().toLocaleTimeString('ja-JP',{hour12:false})}`;
  $('safety-text').textContent=s.shuttingDown?'0への送信が完了しました。実際の消灯は灯体で確認してください。':'Abletonを使う前に照明サーバーを停止してください。';
 }
 function renderDevices(){
  const s=snapshot;if(!s)return;
  $('device-count').textContent=s.devices.length;
  // Keep native dropdowns stable during the one-second refresh.
  if($('devices').contains(document.activeElement)&&document.activeElement.tagName==='SELECT')return;
  const list=$('devices');list.replaceChildren();
  const query=$('device-search').value.trim().toUpperCase();
  const devices=s.devices.filter(d=>d.id.toUpperCase().includes(query));
  if(!devices.length){
   const empty=node('p','empty');empty.append(node('span','empty-title',query?'該当する端末がありません':'iPhoneの接続を待っています'));
   if(!query)empty.append(document.createTextNode('QRコードから操作画面を開いてください。'));
   list.append(empty);return;
  }
  for(const d of devices){
   const row=node('article','device-row');row.dataset.device=d.id;row.setAttribute('aria-label',`端末 ${d.id}`);
   const identity=node('div','device-identity');identity.append(node('span','device-id',d.id));
   const meta=node('div','device-meta');meta.append(status(d.connected?'接続中':'未接続',d.connected?'success':''),node('span',`binding ${d.binding==='key conflict'?'conflict':''}`,bindingLabels[d.binding]||d.binding));identity.append(meta);row.append(identity);
   const assignment=node('div','device-assignment');
   for(const name of d.fixtures){
    const line=node('div','assignment-row');line.append(node('span','assignment-name',name));
    const release=button('解除','fd-button--transparent',()=>{if(confirm(`${name}の割り当てを解除しますか？\n解除すると、この灯体は0になります。`))mutate('release',{fixture:name},`${name}の割り当てを解除しました`);});
    release.setAttribute('aria-label',`${d.id}の${name}を解除`);release.disabled=busy||!online||s.closing;line.append(release);assignment.append(line);
   }
   if(d.fixtures.length===0){
    const form=node('form','assign-form'),select=node('select','fd-input');
    select.setAttribute('aria-label',`${d.id}に割り当てる灯体`);
    select.append(new Option('灯体を選択',''));
    for(const f of s.fixtures)if(f.device!==d.id&&f.kind!=='moving')select.append(new Option(f.device?`${f.name}（${f.device}から移す・明るさはそのまま）`:f.name,f.name));
    if([...select.options].some(o=>o.value===selected.get(d.id)))select.value=selected.get(d.id);
    const disabled=busy||!online||s.closing||!d.connected||d.binding==='key conflict';select.disabled=disabled;
    const assign=button('割り当て','fd-button--emphasized',()=>{});assign.type='submit';assign.disabled=disabled||!select.value;
    const updateAssignLabel=()=>{assign.textContent=s.fixtures.some(f=>f.name===select.value&&f.device)?'移す（明るさはそのまま）':'割り当て';};updateAssignLabel();
    select.addEventListener('change',()=>{selected.set(d.id,select.value);assign.disabled=disabled||!select.value;updateAssignLabel();});
    form.addEventListener('submit',e=>{e.preventDefault();if(!select.value)return;mutate('assign',{device:d.id,fixture:select.value},`${d.id}に${select.value}を割り当てました`);});
    form.append(select,assign);assignment.append(form);
   }
   if(d.fixtures.length>1)assignment.append(node('p','device-note','Web版で操作する場合は1灯体にしてください。'));
   if(d.binding==='key conflict')assignment.append(node('p','device-note','iPhoneの端末IDと登録を確認してください。'));
   row.append(assignment);
   const forget=button('登録を削除','fd-button--transparent forget',()=>{selectedForget=d.id;$('forget-device').textContent=d.id;$('forget-dialog').showModal();});
   forget.disabled=busy||!online||s.closing;forget.setAttribute('aria-label',`${d.id}の登録を削除`);row.append(forget);list.append(row);
  }
 }
 function renderFixtures(){
  if(!snapshot)return;
  $('fixture-count').textContent=snapshot.fixtures.length;
  const body=$('fixtures');body.replaceChildren();
  const fixtures=snapshot.fixtures.filter(f=>filter!=='unassigned'||!f.device);$('fixtures-empty').hidden=fixtures.length!==0;
  for(const f of fixtures){
   const row=node('tr','fd-table__row');
   const cell=(element,cls='')=>{const c=node('td',`fd-table__cell ${cls}`);if(typeof element==='string')c.textContent=element;else c.append(element);row.append(c);return c;};
   cell(f.name,'fixture-name');
   const brightness=node('div','brightness');brightness.append(node('strong','',`${f.percent}%`));
   const meter=node('div','meter'),fill=node('div','meter-fill');fill.style.width=`${Math.min(100,Math.max(0,f.percent))}%`;meter.append(fill);brightness.append(meter);cell(brightness);
   cell(f.device||'—','mono');
   const label=f.locked?'QLC+操作でロック':f.overridden?'ほかの出力で上書き':f.kind==='moving'?'ムービング':!f.device?'未割り当て':!online?'確認できず':snapshot.qlc!=='connected'?'QLC+未接続':!f.connected?'端末未接続':f.active?'操作可能':'操作停止';
   cell(status(label,f.locked?'danger':f.overridden?'warning':label==='操作可能'?'success':''));
   const change=node('div','source');change.append(document.createTextNode(localTime(f.lastChange)),node('br'),document.createTextNode(sourceLabels[f.source]||f.source||''));cell(change);body.append(row);
  }
 }
 function renderWarnings(){const warnings=snapshot?.warnings||[];$('warnings-panel').hidden=!warnings.length;$('warnings').replaceChildren(...warnings.map(text=>node('li','',text)));}
 function render(){renderStatus();renderDevices();renderFixtures();renderWarnings();}
 async function refresh(){
  if(refreshing)return;refreshing=true;
  try{
   const res=await fetch('/api/status',{cache:'no-store',signal:AbortSignal.timeout(4500)});if(!res.ok)throw Error('status');
   const s=await res.json();if(!Array.isArray(s.devices)||!Array.isArray(s.fixtures))throw Error('status');
   snapshot=s;online=true;render();
  }catch{online=false;renderStatus();document.querySelectorAll('#devices button,#devices select').forEach(e=>e.disabled=true);renderFixtures();}
  finally{refreshing=false;}
 }
 async function mutate(action,body,message){
  if(busy||!online||snapshot?.closing)return;
  busy=true;$('error').hidden=true;document.activeElement?.blur();renderDevices();
  try{
   const res=await fetch(`/api/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
   const data=await res.json();if(!res.ok)throw Error(errorLabels[data.error]||data.error||'操作に失敗しました。');
   selected.delete(body.device);toast(message);
  }catch(err){fail(err.name==='TimeoutError'?'応答を確認できません。現在の割り当てを確認してください。':err.message);}
  finally{busy=false;await refresh();renderDevices();}
 }
 $('refresh').onclick=refresh;$('device-search').addEventListener('input',renderDevices);
 for(const b of document.querySelectorAll('[data-filter]'))b.onclick=()=>{filter=b.dataset.filter;for(const btn of document.querySelectorAll('[data-filter]')){btn.classList.toggle('selected',btn===b);btn.setAttribute('aria-pressed',String(btn===b));}renderFixtures();};
 $('copy-link').onclick=async()=>{try{await navigator.clipboard.writeText(joinURL);toast('リンクをコピーしました');}catch{fail('リンクを選択してコピーしてください。 '+joinURL);}};
 $('enlarge-qr').onclick=$('show-qr').onclick=()=>$('qr-dialog').showModal();$('close-qr').onclick=()=>$('qr-dialog').close();
 $('cancel-forget').onclick=()=>$('forget-dialog').close();$('confirm-forget').onclick=()=>{$('forget-dialog').close();if(selectedForget)mutate('forget',{device:selectedForget},`${selectedForget}の登録を削除しました`);};
 $('connection-strip').dataset.tone='loading';
 refresh();setInterval(refresh,1000);
})();
