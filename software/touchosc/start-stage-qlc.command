#!/bin/zsh
cd -- "${0:A:h}" || exit 1
exec /opt/homebrew/bin/node stage-qlc.cjs "${1:-ws://127.0.0.1:9999/qlcplusWS}"
