-- Receive-only monitor. Live supplies the observed position and play state.
local last = nil
local sequence = -1
local s = nil
local cache = {}
local function c(name)
  if not cache[name] then cache[name] = root:findByName(name, true) end
  return cache[name]
end

local function render()
  local online = last and getMillis() - last < 750
  local dim = Color(0.14, 0.18, 0.25, 1)
  if not online then
    -- Stale input has no metronome motion or lit countdown cells.
    for i=1,4 do c('beat_pad_'..i).color=dim; c('beat_pulse_'..i).color=dim end
    for i=1,16 do c('remaining_beat_'..i).color=dim end
    for _,edge in ipairs({'top','bottom','left','right'}) do c('stop_edge_'..edge).visible=false end
    c('progress_fill').visible=false
    c('focus_surface').color=Color(0.106,0.137,0.188,1)
    c('performance_name').textColor=Color(0.45,0.49,0.55,1)
    return
  end
  -- song time uses quarter notes; denominator converts it to notated beats.
  local factor = s.denominator / 4
  local remaining = math.max(0,(s.finish-s.position)*factor)
  local count=math.ceil(remaining-0.000001)
  local urgent=remaining<=16
  local final=remaining<=4
  local observedStop=not s.playing and s.position>=s.finish-0.000001
  local crossed=s.position>=s.finish
  local ink=final and Color(1,0.48,0.40,1) or
            (urgent and Color(1,0.80,0.35,1) or Color(0.66,0.78,1,1))
  c('performance_name').values.text=s.title
  c('performance_name').textColor=ink
  c('focus_surface').color=final and Color(0.20,0.085,0.10,1) or Color(0.106,0.137,0.188,1)
  local beat=(s.position-s.start)*factor
  local phase=beat-math.floor(beat)
  local active=final and (5-count) or (math.floor(beat)%4+1)
  local energy=s.playing and (0.55+0.45*(1-phase)) or 0.7
  for i=1,4 do
    local alive=not crossed and (not final or i>4-count)
    -- The whole area holds its color on an observed stop; no local auto-stop.
    c('beat_pad_'..i).color=observedStop and ink or (alive and i==active and ink or dim)
    c('beat_pulse_'..i).color=observedStop and ink or
       (alive and i==active and Color(ink.r*energy,ink.g*energy,ink.b*energy,1) or (alive and final and ink or dim))
  end
  for i=1,16 do
    c('remaining_beat_'..i).color=(remaining>0 and i>16-math.min(16,count)) and ink or dim
  end
  local ratio=math.min(1,math.max(0,(s.finish-s.position)/(s.finish-s.start)))
  c('progress_fill').frame.w=math.max(1,c('progress_track').frame.w*ratio)
  c('progress_fill').visible=ratio>0
  c('progress_fill').color=ink
  for _,edge in ipairs({'top','bottom','left','right'}) do
    c('stop_edge_'..edge).visible=urgent
    c('stop_edge_'..edge).color=ink
  end
end

function init()
  last,sequence,s=nil,-1,nil
  render()
end

function update() render() end

function onReceiveOSC(message, connections)
  if message[1]~='/stage/state' then return end
  local a=message[2]
  if #a~=9 then return true end
  local now=getMillis()
  if last and now-last<750 and a[1].value<=sequence then return true end
  if a[9].value<=a[8].value then return true end
  sequence,last=a[1].value,now
  s={position=a[2].value,playing=a[3].value==1,tempo=a[4].value,
     numerator=a[5].value,denominator=a[6].value,title=a[7].value,
     start=a[8].value,finish=a[9].value}
  render()
  return true
end
