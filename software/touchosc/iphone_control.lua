-- Transport controls share the monitor's observed Live state.
local monitorInit, monitorUpdate, monitorReceive = init, update, onReceiveOSC
local requestId, heartbeat, panelSeen = 0, -1000, nil
local pending = {}
local selected, cuePage, expanded = 1, 1, false
local page = 'monitor'
local function control(name) return root:findByName(name,true) end
local function show(name, value) control(name).visible=value end
local function text(name, value) control(name).values.text=value end
local function osc(address,args) sendOSC({address,args},{true}) end

local function send(action,value)
  requestId=requestId+1
  pending[requestId]={action=action,time=getMillis()}
  osc('/stage/control',{{tag='i',value=requestId},{tag='s',value=action},{tag='s',value=value or ''}})
end

local function layout()
  show('monitor',page=='monitor')
  show('act_picker',page=='acts')
  show('cue_picker',page=='cues')
  show('auxiliary',not expanded or page~='monitor')
  show('level_meter',not expanded and page=='monitor')
  text('expand_label',expanded and '縮小' or '拡大')
  show('expand',page=='monitor');show('expand_base',page=='monitor');show('expand_label',page=='monitor')
  show('back_to_monitor',page~='monitor');show('back_base',page~='monitor');show('back_label',page~='monitor')
  local big=expanded and page=='monitor'
  for i=1,4 do
    control('beat_pad_'..i).frame.h=big and 392 or 152
    control('beat_pulse_'..i).frame.h=big and 376 or 136
  end
  for i=1,16 do control('remaining_beat_'..i).frame.y=big and 630 or 388 end
end

local function cues()
  local act=ACTS[selected]
  text('cue_heading',act.title)
  text('act_start_label','演目の頭へ')
  for i=1,4 do
    local cue=act.cues[(cuePage-1)*4+i]
    for _,suffix in ipairs({'','_base','_label'}) do show('cue_'..i..suffix,cue~=nil) end
    if cue then text('cue_'..i..'_label',cue.name) end
  end
  local multiple=#act.cues>4
  for _,suffix in ipairs({'','_base','_label'}) do
    show('previous_cues'..suffix,multiple and cuePage>1)
    show('next_cues'..suffix,multiple and cuePage*4<#act.cues)
  end
end

function init()
  monitorInit()
  requestId,heartbeat,panelSeen=0,-1000,nil
  pending={};selected,cuePage,expanded,page=1,1,false,'monitor'
  layout();cues()
end

function update()
  monitorUpdate()
  local now=getMillis()
  if now-heartbeat>=500 then
    heartbeat=now
    osc('/stage/hello',{{tag='i',value=8000}})
  end
  local online=panelSeen and now-panelSeen<750
  show('connection_error',not online)
  if not online then text('connection_error','Live未接続') end
  for id,p in pairs(pending) do
    if now-p.time>2000 then
      text('command_error',(p.action=='qlc_stop' or p.action=='border') and 'QLC+未接続' or '応答なし')
      show('command_error',true);pending[id]=nil
    end
  end
  if control('command_error').visible then show('connection_error',false) end
end

function onReceiveNotify(key,value)
  if key~='panel' then return end
  if value=='acts' then page='acts';layout()
  elseif value=='monitor' then page='monitor';layout()
  elseif value=='expand' then expanded=not expanded;layout()
  elseif string.sub(value,1,4)=='act:' then
    selected=tonumber(string.sub(value,5));cuePage=1;page='cues';cues();layout()
  elseif value=='previous' or value=='next' then
    cuePage=cuePage+(value=='next' and 1 or -1);cues()
  elseif value=='act_start' then
    send('locate',ACTS[selected].locator);page='monitor';layout()
  elseif string.sub(value,1,4)=='cue:' then
    local cue=ACTS[selected].cues[(cuePage-1)*4+tonumber(string.sub(value,5))]
    if cue then send('locate',cue.name);page='monitor';layout() end
  else
    local action,arg=string.match(value,'^([^:]+):?(.*)$')
    show('command_error',false)
    send(action,arg)
  end
end

function onReceiveOSC(message,connections)
  if message[1]=='/stage/panel' and #message[2]==2 then
    panelSeen=getMillis()
    local playing=message[2][1].value==1
    local metro=message[2][2].value==1
    control('resume_base').color=playing and Color(0.79,0.91,0.66,1) or Color(0.17,0.25,0.21,1)
    control('resume_label').textColor=playing and Color(0.08,0.14,0.05,1) or Color(0.79,0.91,0.66,1)
    control('metro_on_base').color=metro and Color(0.29,0.40,0.55,1) or Color(0.14,0.18,0.25,1)
    control('metro_off_base').color=not metro and Color(0.29,0.40,0.55,1) or Color(0.14,0.18,0.25,1)
    show('connection_error',false)
    return true
  elseif message[1]=='/stage/ack' and #message[2]==3 then
    local id=message[2][1].value;local p=pending[id]
    if p then
      pending[id]=nil
      if message[2][2].value==0 then
        text('command_error',(p.action=='qlc_stop' or p.action=='border') and 'QLC+未接続' or '操作失敗')
        show('command_error',true)
      end
    end
    return true
  elseif message[1]=='/stage/error' then
    text('connection_error','ロケーター未設定');show('connection_error',true)
    return true
  end
  return monitorReceive(message,connections)
end
