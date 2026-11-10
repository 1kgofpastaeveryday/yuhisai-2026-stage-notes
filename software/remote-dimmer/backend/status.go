package main

import (
	"html/template"
	"net"
	"net/http"
	"sort"
	"time"
)

type MovingStatus struct {
	Kind   string  `json:"kind"`
	X      float64 `json:"x"`
	Y      float64 `json:"y"`
	Pan16  int     `json:"pan16"`
	Tilt16 int     `json:"tilt16"`
	Owned  bool    `json:"owned"`
}
type fixtureStatus struct {
	*MovingStatus
	Name       string    `json:"name"`
	Device     string    `json:"device"`
	Connected  bool      `json:"connected"`
	IP         string    `json:"ip"`
	Level      int       `json:"level"`
	Percent    int       `json:"percent"`
	Active     bool      `json:"active"`
	Overridden bool      `json:"overridden"`
	Locked     bool      `json:"locked"`
	ChangedAt  time.Time `json:"lastChange"`
	Source     string    `json:"source"`
}
type statusSnapshot struct {
	Devices      []Device        `json:"devices"`
	QLC          string          `json:"qlc"`
	Closing      bool            `json:"closing"`
	ShuttingDown bool            `json:"shuttingDown"`
	Fixtures     []fixtureStatus `json:"fixtures"`
	Unassigned   []Device        `json:"unassigned"`
	Warnings     []string        `json:"warnings"`
}

func (r *Runtime) status() statusSnapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	s := statusSnapshot{Devices: []Device{}, QLC: "disconnected", Closing: r.closing, ShuttingDown: r.zeroed, Fixtures: []fixtureStatus{}, Unassigned: []Device{}, Warnings: append([]string{}, r.warnings...)}
	if r.connected {
		s.QLC = "connected"
	}
	for _, f := range r.fixtures {
		for _, warning := range f.pollWarnings {
			if warning != "" {
				s.Warnings = append(s.Warnings, warning)
			}
		}
		row := fixtureStatus{Name: f.Name, Device: r.assignments[f.Name], Level: f.level, Percent: (f.level*100 + 127) / 255, Active: r.connected && !r.closing && !f.locked, Overridden: f.locked || f.overridden, Locked: f.locked, ChangedAt: f.changedAt, Source: f.source}
		if f.moving() {
			row.MovingStatus = &MovingStatus{"moving", f.x, f.y, f.axesLast[0]<<8 | f.axesLast[1], f.axesLast[2]<<8 | f.axesLast[3], f.owned}
			row.Active = row.Active && f.ready
		}
		if p := r.phones[row.Device]; p != nil {
			row.Connected, row.IP = true, p.device.IP
		}
		// An unassigned fixture has no active operator.
		row.Active = row.Active && row.Device != "" && !f.moving() && r.bindings[row.Device] != ""
		s.Fixtures = append(s.Fixtures, row)
	}
	ids := map[string]bool{}
	for id := range r.bindings {
		ids[id] = true
	}
	for _, id := range r.assignments {
		ids[id] = true
	}
	for id := range r.phones {
		ids[id] = true
	}
	for id := range ids {
		s.Devices = append(s.Devices, r.deviceView(id))
	}
	sort.Slice(s.Devices, func(i, j int) bool { return s.Devices[i].ID < s.Devices[j].ID })
	for _, p := range r.phones {
		if r.fixtureFor(p.device.ID) == nil {
			s.Unassigned = append(s.Unassigned, p.device)
		}
	}
	sort.Slice(s.Unassigned, func(i, j int) bool { return s.Unassigned[i].ID < s.Unassigned[j].ID })
	return s
}
func (r *Runtime) handleStatus(w http.ResponseWriter, req *http.Request) {
	ip := net.ParseIP(remoteIP(req.RemoteAddr))
	if ip == nil || !ip.IsLoopback() {
		jsonReply(w, http.StatusForbidden, map[string]string{"error": "loopback only"})
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	s := r.status()
	if req.URL.Path == "/status.json" {
		jsonReply(w, http.StatusOK, s)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = statusTemplate.Execute(w, s)
}

var statusTemplate = template.Must(template.New("status").Parse(`<!doctype html>
<html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ディマー状態</title>
<style>body{margin:0;background:#181818;color:#fff;font:18px system-ui}header{padding:2rem;background:#b40000;font-size:clamp(24px,4vw,56px);font-weight:bold}body.offline header{background:#555}main{padding:1.5rem}table{border-collapse:collapse;width:100%;margin:1rem 0 2rem}td,th{padding:.6rem;text-align:left;border-bottom:1px solid #666}button,select{font:inherit;padding:.4rem}select{min-width:10em}#error{color:#ffbaba}.scroll{overflow:auto}</style>
<body><header id="banner">{{if .ShuttingDown}}停止（0 に戻し済み）{{else}}iPhone 稼働中　Ableton の前にサーバーを止める{{end}}</header><main><p>QLC+ <span id="qlc">{{.QLC}}</span></p><p id="error"></p><ul id="warnings">{{range .Warnings}}<li>{{.}}</li>{{end}}</ul>
<h2>端末</h2><div class="scroll"><table><thead><tr><th>端末ID</th><th>灯体</th><th>接続</th></tr></thead><tbody id="devices">{{range .Devices}}<tr><td>{{.ID}} {{.Binding}}</td><td>{{range .Fixtures}}<div>{{.}} <button data-release="{{.}}" {{if $.Closing}}disabled{{end}}>解除</button></div>{{end}}{{if lt (len .Fixtures) 4}}<select data-device="{{.ID}}" {{if or $.Closing (not .Connected) (eq .Binding "key conflict")}}disabled{{end}}><option value="">灯体を追加</option>{{range $.Fixtures}}{{if not .Device}}{{if not .MovingStatus}}<option value="{{.Name}}">{{.Name}}</option>{{end}}{{end}}{{end}}</select>{{end}} <button data-forget="{{.ID}}" {{if $.Closing}}disabled{{end}}>登録を削除</button></td><td>{{if .Connected}}接続中 {{.IP}}{{else}}未接続{{end}}</td></tr>{{end}}</tbody></table></div>
<h2>灯体</h2><div class="scroll"><table><thead><tr><th>灯体</th><th>端末ID</th><th>明るさ</th><th>状態</th><th>最終変更</th></tr></thead><tbody id="fixtures">{{range .Fixtures}}<tr><td>{{.Name}}</td><td>{{.Device}}</td><td>{{.Percent}}%</td><td>{{if .Locked}}ロック{{else if .Overridden}}上書き{{end}}{{if .MovingStatus}} x {{printf "%.2f" .X}} y {{printf "%.2f" .Y}}・{{.Pan16}}/{{.Tilt16}}{{end}}</td><td>{{.ChangedAt.Format "15:04:05"}} {{.Source}}</td></tr>{{end}}</tbody></table></div></main>
<script>
let last = {shuttingDown: {{.ShuttingDown}}, fixtures: [], devices: []};
let shown = "";
const el=id=>document.getElementById(id);
const hms=t=>{const d=new Date(t);return isNaN(d)?"":d.toLocaleTimeString("ja-JP",{hour12:false});};
const sources={phone:"iPhone",admin:"管理",system:"システム"};
function cell(row,value){const c=row.insertCell();c.textContent=value;return c;}
function option(select,value,label,selected){const o=document.createElement("option");o.value=value;o.textContent=label;o.selected=selected;select.append(o);}
function render(s){
 last=s;document.body.classList.remove("offline");el("banner").textContent=s.shuttingDown?"停止（0 に戻し済み）":"iPhone 稼働中　Ableton の前にサーバーを止める";el("qlc").textContent=s.qlc;
 el("warnings").replaceChildren();for(const warning of s.warnings){const li=document.createElement("li");li.textContent=warning;el("warnings").append(li);}
 // Rebuilding while an assignment dropdown is open would close it and lose the choice.
 if(document.activeElement&&document.activeElement.tagName==="SELECT")return;
 const key=JSON.stringify([s.fixtures,s.devices,s.closing]);if(key===shown)return;shown=key;
 const devices=el("devices");devices.replaceChildren();
 for(const d of s.devices){const row=devices.insertRow();cell(row,d.id+" "+d.binding);
  const controls=cell(row,"");
  for(const name of d.fixtures){const line=document.createElement("div");line.textContent=name+" ";const button=document.createElement("button");button.textContent="解除";button.dataset.release=name;button.disabled=s.closing;line.append(button);controls.append(line);}
  if(d.fixtures.length<4){const select=document.createElement("select");select.dataset.device=d.id;select.disabled=s.closing||!d.connected||d.binding==="key conflict";option(select,"","灯体を追加",true);
   for(const f of s.fixtures)if(!f.device&&f.kind!=="moving")option(select,f.name,f.name,false);
   controls.append(select);}
  const forget=document.createElement("button");forget.textContent="登録を削除";forget.dataset.forget=d.id;forget.disabled=s.closing;controls.append(forget);
  cell(row,d.connected?"接続中 "+d.ip:"未接続");}
 const fixtures=el("fixtures");fixtures.replaceChildren();
 for(const f of s.fixtures){const row=fixtures.insertRow();
  for(const v of [f.name,f.device||"",f.percent+"%",(f.locked?"ロック":f.overridden?"上書き":"")+(f.kind==="moving"?" x "+f.x.toFixed(2)+" y "+f.y.toFixed(2)+"・"+f.pan16+"/"+f.tilt16:""),hms(f.lastChange)+" "+(sources[f.source]||f.source)])cell(row,v);}
}
async function refresh(){try{const res=await fetch("/status.json",{cache:"no-store"});if(!res.ok)throw Error(res.status);render(await res.json());}catch(e){document.body.classList.add("offline");el("banner").textContent=last.shuttingDown?"停止（0 に戻し済み）":"サーバー応答なし（iPhone の値が QLC+ に残っている可能性あり）";}}
async function post(path,body){const res=await fetch("/admin/"+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw Error(data.error);}
async function action(control,path,body){control.disabled=true;try{await post(path,body);el("error").textContent="";}catch(err){el("error").textContent=String(err);}control.blur();shown="";await refresh();}
document.addEventListener("change",e=>{const select=e.target;if(select.dataset.device&&select.value)action(select,"assign",{device:select.dataset.device,fixture:select.value});});
document.addEventListener("click",e=>{const button=e.target;if(button.dataset.release)action(button,"release",{fixture:button.dataset.release});if(button.dataset.forget)action(button,"forget",{device:button.dataset.forget});});
refresh();setInterval(refresh,1000);
</script></html>`))
