#!/bin/zsh
set -eu
cd -- "${0:A:h}"
source_file=$(/usr/bin/python3 -c 'import json; print(json.load(open("config.json"))["defaultSource"])')
exec "/Applications/QLC+ 5 Live Sync.app/Contents/MacOS/qlcplus5" -w "$source_file"
