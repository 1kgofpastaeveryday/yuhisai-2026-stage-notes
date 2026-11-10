-- Standalone test transport. It never sends MIDI or OSC to Live or QLC+.
-- The builder prepends DEMO_CUES and DEMO_TEMPOS, all positions in beats.
local position = 0
local playing = false
local reached = nil
local focusOnStop = false
local previousMillis = nil
local epsilon = 0.000001
local cachedControls = {}

local function control(name)
  if not cachedControls[name] then cachedControls[name] = root:findByName(name, true) end
  return cachedControls[name]
end

local function isStop(cue)
  -- Match the action token, not names such as NOTSETSTOP or SETSTOPPED.
  return cue.name:match('%f[%w_]SETSTOP%f[^%w_]') ~= nil
end

local function nextStop()
  if reached then return reached end
  for _, cue in ipairs(DEMO_CUES) do
    if isStop(cue) and cue.beat >= position - epsilon then
      if not playing or cue.beat > position + epsilon then return cue end
    end
  end
end

local function secondsAt(beat)
  local seconds = 0
  for i, event in ipairs(DEMO_TEMPOS) do
    local finish = math.min(beat, DEMO_TEMPOS[i + 1] and DEMO_TEMPOS[i + 1].beat or beat)
    if finish > event.beat then seconds = seconds + (finish - event.beat) * 60 / event.bpm end
    if finish >= beat then break end
  end
  return seconds
end

local function beatAt(seconds)
  for i, event in ipairs(DEMO_TEMPOS) do
    local following = DEMO_TEMPOS[i + 1]
    local duration = following and (following.beat - event.beat) * 60 / event.bpm or math.huge
    if seconds <= duration then return event.beat + seconds * event.bpm / 60 end
    seconds = seconds - duration
  end
end

local function showFocus()
  control('overview').visible = false
  for i = 1, 12 do control(string.format('act%02d', i)).visible = false end
  control('countdown_summary').visible = false
  control('countdown_focus').visible = true
end

local function render()
  local target = nextStop()
  local remaining = target and math.max(0, target.beat - position) or 0
  local count = math.ceil(remaining - epsilon)
  local atStop = target and remaining <= epsilon
  local urgent = target and remaining <= 16 + epsilon
  local final = target and remaining <= 4 + epsilon
  local ink = final and Color(1, 0.48, 0.40, 1) or
              (urgent and Color(1, 0.80, 0.35, 1) or Color(0.66, 0.78, 1, 1))
  local dim = Color(0.14, 0.18, 0.25, 1)
  local line = Color(0.23, 0.29, 0.38, 1)
  -- The last 16 beats take priority over browsing; the stop stays visible.
  if (playing and urgent) or focusOnStop then showFocus() end
  focusOnStop = false
  local canBrowse = not (playing and urgent)
  for _, name in ipairs({'to_overview', 'to_overview_base', 'to_overview_label'}) do
    control(name).visible = canBrowse
  end
  for _, edge in ipairs({'top', 'bottom', 'left', 'right'}) do
    control('stop_edge_' .. edge).visible = urgent or false
    control('stop_edge_' .. edge).color = ink
  end
  control('focus_surface').color = final and Color(0.20, 0.085, 0.10, 1) or Color(0.106, 0.137, 0.188, 1)
  local phase = math.max(0, position - math.floor(position + epsilon))
  local active = final and (5 - count) or (math.floor(position + epsilon) % 4 + 1)
  local energy = playing and (0.55 + 0.45 * (1 - phase)) or 0.7
  for i = 1, 4 do
    local alive = target and not atStop and (not final or i > 4 - count)
    local pulse = Color(ink.r * energy, ink.g * energy, ink.b * energy, 1)
    control('beat_pad_' .. i).visible = not atStop and target ~= nil
    control('beat_pulse_' .. i).visible = not atStop and target ~= nil
    control('beat_pad_' .. i).color = (alive and i == active) and ink or line
    control('beat_pulse_' .. i).color = (alive and i == active) and pulse or (alive and final and ink or dim)
    control('summary_beat_' .. i).color = (alive and i == active) and ink or dim
  end
  for i = 1, 16 do
    local alive = target and remaining > epsilon and i > 16 - math.min(16, count)
    control('remaining_beat_' .. i).color = alive and ink or dim
  end
  local start = 0
  if target then
    for _, cue in ipairs(DEMO_CUES) do
      if isStop(cue) and cue.beat < target.beat then start = cue.beat end
    end
  end
  local ratio = target and math.min(1, remaining / math.max(epsilon, target.beat - start)) or 0
  control('progress_fill').frame.w = math.max(1, 656 * ratio)
  control('progress_fill').visible = remaining > epsilon
  control('progress_fill').color = ink
  control('stop_stamp').values.text = atStop and 'SETSTOP' or (not target and '終了' or '')
  control('stop_stamp').textColor = ink
  local state = atStop and '停止' or (playing and 'テスト再生中' or 'テスト停止中')
  for _, name in ipairs({'countdown_state', 'summary_state'}) do control(name).values.text = state end
  for _, name in ipairs({'countdown_target', 'summary_target'}) do
    control(name).values.text = target and target.name or '停止点なし'
  end
end

local function advance(now)
  if previousMillis and playing then
    local target = nextStop()
    local nextPosition = beatAt(secondsAt(position) + math.max(0, now - previousMillis) / 1000)
    if target and nextPosition >= target.beat - epsilon then
      position = target.beat
      reached = target
      focusOnStop = true
      playing = false
    else position = nextPosition end
  end
  previousMillis = now
end

function init()
  position, playing, reached, focusOnStop = 0, false, nil, false
  previousMillis = getMillis()
  showFocus()
  render()
end

function update()
  advance(getMillis())
  render()
end

function onReceiveNotify(key, value)
  if key ~= 'countdown_demo' then return end
  advance(getMillis())
  if value == 'resume' then
    reached = nil
    -- nextStop excludes the current position while playing.
    playing = true
  elseif value == 'stop' then playing = false
  elseif value == 'focus' then showFocus()
  elseif value == 'overview' then
    control('countdown_focus').visible = false
    control('countdown_summary').visible = true
    control('overview').visible = true
    for i = 1, 12 do control(string.format('act%02d', i)).visible = false end
  elseif value == '16' or value == '4' then
    local target = nextStop()
    if target then
      position = math.max(0, target.beat - tonumber(value))
      reached = nil
    end
  else
    for _, cue in ipairs(DEMO_CUES) do
      if cue.name == value then position, reached = cue.beat, nil; break end
    end
  end
  render()
end
