#!/usr/bin/env bash
# Render screenshots of the running app with headless Chrome. Usage: ./screenshot.sh [name] [query]
cd "$(dirname "$0")"
NAME=${1:-live}; Q=${2:-}
PORT=$(python3 -c "import json;print(json.load(open('config.json')).get('port',4747))")
google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=${SIZE:-1600,1240} --virtual-time-budget=6000 --user-data-dir=/tmp/bot-island-chrome \
  --screenshot="screenshots/$NAME.png" "http://127.0.0.1:$PORT/?$Q" 2>/dev/null
ls -la "screenshots/$NAME.png"
