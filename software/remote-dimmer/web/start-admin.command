#!/bin/zsh
set -eu
cd -- "${0:A:h}"
if lsof -nP -iTCP:8769 -sTCP:LISTEN >/dev/null 2>&1; then
  print '管理コンソールは起動済みです。http://127.0.0.1:8769/'
  exit 0
fi
admin_runtime_dir="${PWD}/../../../.cache/dimmer-web"
mkdir -p "$admin_runtime_dir"
(cd ../backend && GOFLAGS=-buildvcs=false go build -o "$admin_runtime_dir/admin-console" ./cmd/admin-console)
print '管理コンソール http://127.0.0.1:8769/'
print 'Ctrl+Cで管理コンソールのみ停止します。'
exec "$admin_runtime_dir/admin-console"
