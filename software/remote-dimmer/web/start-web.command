#!/bin/zsh
# Start only browser hosting and its tunnel. Existing QLC/backend must be running.
set -eu
cd -- "${0:A:h}"
if ! curl -fsS "http://127.0.0.1:8765/status.json" >/dev/null; then
  print -u2 '先に照明サーバーを起動してください。http://127.0.0.1:8765/status'
  exit 1
fi
if lsof -nP -iTCP:8768 -sTCP:LISTEN >/dev/null 2>&1; then
  print -u2 'Web版は起動済みです。https://knudg.com/yuhisai/2026/dimmer/'
  exit 1
fi
if pgrep -f 'cloudflared tunnel.*run <HOST>' >/dev/null; then
  print -u2 '既存のyuhisai-dimmer Tunnelを停止してから実行してください。'
  exit 1
fi
runtime_dir="../../../.cache/dimmer-web"
mkdir -p "$runtime_dir"
(cd ../backend && GOFLAGS=-buildvcs=false go build -o "../web/$runtime_dir/web-gateway" ./cmd/web-gateway)
"$runtime_dir/web-gateway" &
gateway_pid=$!
cloudflared tunnel --config "$PWD/tunnel.yml" run '<HOST>' &
tunnel_pid=$!
cleanup() {
  kill -TERM "$gateway_pid" "$tunnel_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 0' INT TERM
print 'https://knudg.com/yuhisai/2026/dimmer/'
print 'Ctrl+CでWeb版とTunnelを停止します。照明サーバーの値はそのままです。'
wait "$gateway_pid"
