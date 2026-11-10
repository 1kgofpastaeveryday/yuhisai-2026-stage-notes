local monitorInit,monitorUpdate,monitorReceive=init,update,onReceiveOSC
local selectedShow,selectedAct,actPage,cuePage,page=1,1,1,1,'monitor'
local requestId,heartbeat,panelSeen=0,-1000,nil
local pending={}
local orders={}
local confirmedOrders={}
local observed,observedSequence,observedAt=nil,-1,-1000
local function c(name) return root:findByName(name,true) end
local function text(name,v) c(name).values.text=v end
local function visible(name,v) c(name).visible=v end
local function show() return SHOWS[selectedShow] end
local function act() return show().acts[selectedAct] end
-- SHOWS holds the panel's profiles; GROUPS lists the group buttons and, for
-- DFS, one profile per day. A day is a profile, so each keeps its own order.
local function currentGroup()
  for g,group in ipairs(GROUPS) do for k,index in ipairs(group.shows) do if index==selectedShow then return group,k end end end
end
local function toggleButton(name,v)
  for _,suffix in ipairs({'','_base','_label'}) do visible(name..suffix,v) end
end
local function layout()
  for _,name in ipairs({'monitor','show_picker','act_picker','cue_picker','order_picker'}) do visible(name,page==({monitor='monitor',show_picker='shows',act_picker='acts',cue_picker='cues',order_picker='order'})[name]) end
  visible('auxiliary',page=='monitor')
  text('brand',show().title);text('stop_warning',show().automatic and '' or '手動停止')
  text('open_acts_label',page=='acts' and '戻る' or '演目')
  text('open_shows_label',page=='shows' and '戻る' or '団体')
  local group,current=currentGroup()
  visible('performance_name',not (page=='acts' and #group.shows>1))
  for k=1,2 do
    local available=#group.shows>1 and group.shows[k]~=nil
    toggleButton('variant_'..k,available)
    if available then
      text('variant_'..k..'_label',group.labels[k])
      c('variant_'..k..'_base').color=k==current and Color(.29,.40,.55,1) or Color(.14,.18,.25,1)
    end
  end
end
local function refresh()
  for i=1,7 do
    local slot=(actPage-1)*7+i;local index=orders[selectedShow][slot];local a=index and show().acts[index]
    toggleButton('act_'..i,a~=nil)
    if a then text('act_'..i..'_label',slot..'  '..a.title);text('order_title_'..i,slot..'  '..a.title) end
    visible('order_row_'..i,a~=nil);visible('order_title_'..i,a~=nil)
    toggleButton('order_up_'..i,a~=nil and slot>1);toggleButton('order_down_'..i,a~=nil and slot<#show().acts)
  end
  toggleButton('acts_previous',actPage>1);toggleButton('acts_next',actPage*7<#show().acts)
  toggleButton('order_previous',actPage>1);toggleButton('order_next',actPage*7<#show().acts)
  text('cue_heading',act().title)
  for i=1,4 do
    local cue=act().cues[(cuePage-1)*4+i];toggleButton('cue_'..i,cue~=nil)
    if cue then text('cue_'..i..'_label',cue.name) end
  end
  toggleButton('cues_previous',cuePage>1);toggleButton('cues_next',cuePage*4<#act().cues)
end
local function selectShow(nextShow)
  selectedShow=nextShow;selectedAct,actPage,cuePage=1,1,1;panelSeen=nil;heartbeat=-1000;pending={};observed=nil;observedSequence=-1;observedAt=-1000;monitorInit()
  text('performance_name',act().title);text('connection_error','Live未接続');refresh()
end
local function send(action,value)
  requestId=requestId+1;pending[requestId]={action=action,time=getMillis()};visible('command_error',false)
  sendOSC({'/stage/control',{{tag='i',value=requestId},{tag='s',value=action},{tag='s',value=value or ''}}},{true})
end
function init()
  monitorInit();selectedShow,selectedAct,actPage,cuePage,page=1,1,1,1,'monitor'
  orders={};confirmedOrders={}
  for i,s in ipairs(SHOWS) do orders[i]={};confirmedOrders[i]={};for j=1,#s.acts do orders[i][j]=s.order[j];confirmedOrders[i][j]=s.order[j] end end
  pending={};requestId,heartbeat,panelSeen=0,-1000,nil;visible('command_error',false);layout();refresh()
end
function update()
  monitorUpdate();local now=getMillis()
  if now-heartbeat>=500 then
    heartbeat=now;sendOSC({'/stage/hello',{{tag='i',value=8000},{tag='s',value=show().id}}},{true})
  end
  visible('connection_error',not panelSeen or now-panelSeen>=750)
  for id,p in pairs(pending) do if now-p.time>2000 then
    text('command_error',p.action=='qlc_stop' and 'QLC+未接続' or '応答なし');visible('command_error',true);pending[id]=nil
  end end
  if c('command_error').visible then visible('connection_error',false) end
end
function onReceiveNotify(key,value)
  if key~='panel' then return end
  if value=='shows' then page=page=='shows' and 'monitor' or 'shows'
  elseif value=='acts' then page=page=='acts' and 'monitor' or 'acts';refresh()
  elseif value=='cues' then page='cues';cuePage=1;refresh()
  elseif value=='order' then page='order';refresh()
  elseif string.sub(value,1,3)=='up:' or string.sub(value,1,5)=='down:' then
    local kind,index=string.match(value,'^(%a+):(%d+)$');local slot=(actPage-1)*7+tonumber(index)
    local target=slot+(kind=='up' and -1 or 1)
    if target>=1 and target<=#show().acts then
      local order=orders[selectedShow];order[slot],order[target]=order[target],order[slot]
      send('reorder',table.concat(order,','));refresh()
    end
  elseif string.sub(value,1,5)=='show:' then
    -- Re-selecting the current group keeps the chosen DFS day.
    local group=GROUPS[tonumber(string.sub(value,6))];local nextShow=group.shows[1]
    for _,index in ipairs(group.shows) do if index==selectedShow then nextShow=index end end
    if SHOWS[nextShow].blocked then text('command_error','停止点未設定');visible('command_error',true);return end
    page='monitor';if nextShow~=selectedShow then selectShow(nextShow) end
  elseif string.sub(value,1,8)=='variant:' then
    local nextShow=currentGroup().shows[tonumber(string.sub(value,9))]
    if nextShow and nextShow~=selectedShow then
      if SHOWS[nextShow].blocked then text('command_error','停止点未設定');visible('command_error',true);return end
      selectShow(nextShow)
    end
    page='acts';refresh()
  elseif value=='acts_previous' or value=='acts_next' or value=='order_previous' or value=='order_next' then actPage=actPage+((value=='acts_next' or value=='order_next') and 1 or -1);refresh()
  elseif value=='cues_previous' or value=='cues_next' then cuePage=cuePage+(value=='cues_next' and 1 or -1);refresh()
  elseif string.sub(value,1,4)=='act:' then
    selectedAct=orders[selectedShow][(actPage-1)*7+tonumber(string.sub(value,5))];cuePage=1;page='cues';refresh()
  elseif value=='act_start' then send('locate',act().locator);page='monitor'
  elseif string.sub(value,1,4)=='cue:' then
    local cue=act().cues[(cuePage-1)*4+tonumber(string.sub(value,5))]
    if cue then send('locate',cue.name);page='monitor' end
  else local action,arg=string.match(value,'^([^:]+):?(.*)$');send(action,arg) end
  layout()
end
function onReceiveOSC(message,connections)
  local address,a=message[1],message[2]
  if address=='/stage/panel' and #a==2 then
    panelSeen=getMillis();visible('connection_error',false)
    c('resume_base').color=a[1].value==1 and Color(.79,.91,.66,1) or Color(.17,.25,.21,1)
    c('resume_label').textColor=a[1].value==1 and Color(.08,.14,.05,1) or Color(.79,.91,.66,1)
    c('metro_on_base').color=a[2].value==1 and Color(.29,.40,.55,1) or Color(.14,.18,.25,1)
    c('metro_off_base').color=a[2].value==0 and Color(.29,.40,.55,1) or Color(.14,.18,.25,1);return true
  elseif address=='/stage/error' then
    panelSeen=nil;text('connection_error',a[1].value);visible('connection_error',true);return true
  elseif address=='/stage/ack' and #a==3 then
    local p=pending[a[1].value]
    if p then pending[a[1].value]=nil
      if a[2].value==0 then
        text('command_error',p.action=='qlc_stop' and 'QLC+未接続' or a[3].value);visible('command_error',true)
        if p.action=='reorder' then orders[selectedShow]={};for i,v in ipairs(confirmedOrders[selectedShow]) do orders[selectedShow][i]=v end;refresh() end
      end
    end
    return true
  elseif address=='/stage/order_state' and #a==2 and a[1].value==show().id then
    for _,p in pairs(pending) do if p.action=='reorder' then return true end end
    local parsed,seen={},{}
    for number in string.gmatch(a[2].value,'%d+') do
      local n=tonumber(number);if n<1 or n>#show().acts or seen[n] then return true end
      seen[n]=true;parsed[#parsed+1]=n
    end
    if #parsed==#show().acts then
      orders[selectedShow]=parsed;confirmedOrders[selectedShow]={};for i,v in ipairs(parsed) do confirmedOrders[selectedShow][i]=v end;refresh()
    end
    return true
  elseif address=='/stage/state' and #a==9 then
    if a[1].value>observedSequence or getMillis()-observedAt>=750 then
      observedSequence=a[1].value;observedAt=getMillis();observed={title=a[7].value,position=a[2].value,finish=a[9].value}
      if page=='monitor' then for i,row in ipairs(show().acts) do if row.title==a[7].value then selectedAct=i end end end
    end
  end
  return monitorReceive(message,connections)
end
