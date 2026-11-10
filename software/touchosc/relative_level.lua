-- Separate OSC connection 2 keeps REW independent of Live transport.
local panelInit, panelUpdate, panelReceive, panelNotify = init, update, onReceiveOSC, onReceiveNotify
local levelLast, levelHeartbeat, levelSession, levelSequence = nil, -1000, nil, -1
local levelCurrent, levelAverage, levelElapsed, levelReference = nil, nil, nil, nil

local function levelControl(name) return root:findByName(name,true) end
local function levelText(name,value) levelControl(name).values.text=value end
local function renderLevel()
  local online=levelLast and getMillis()-levelLast<1500
  if not online then
    levelReference=nil
    levelText('level_now','REW待ち');levelText('level_average','—')
  elseif not levelReference then
    levelText('level_now','基準未設定');levelText('level_average','—')
  else
    levelText('level_now',string.format('%+.1f dB',levelCurrent-levelReference))
    levelText('level_average',string.format('%+.1f dB',levelAverage-levelReference))
  end
  levelText('level_average_heading',levelElapsed and levelElapsed<60 and
    string.format('平均 %.0f秒',levelElapsed) or '1分平均')
end

function init()
  panelInit()
  levelLast,levelHeartbeat,levelSession,levelSequence=nil,-1000,nil,-1
  levelCurrent,levelAverage,levelElapsed,levelReference=nil,nil,nil,nil
  renderLevel()
end

function update()
  panelUpdate()
  local now=getMillis()
  if now-levelHeartbeat>=500 then
    levelHeartbeat=now
    sendOSC({'/stage/level/hello',{{tag='i',value=8000}}},{false,true})
  end
  renderLevel()
end

function onReceiveNotify(key,value)
  if key=='panel' and value=='level_reference' then
    if levelLast and getMillis()-levelLast<1500 then
      levelReference=levelCurrent
      renderLevel()
    end
    return
  end
  return panelNotify(key,value)
end

function onReceiveOSC(message,connections)
  if message[1]=='/stage/level' then
    local a=message[2]
    if #a~=5 then return true end
    local session,seq=a[1].value,a[2].value
    if session==levelSession and seq<=levelSequence then return true end
    if session~=levelSession or (levelLast and getMillis()-levelLast>=1500) then
      levelReference=nil
    end
    levelSession,levelSequence,levelLast=session,seq,getMillis()
    levelCurrent,levelAverage,levelElapsed=a[3].value,a[4].value,a[5].value
    renderLevel()
    return true
  end
  return panelReceive(message,connections)
end
