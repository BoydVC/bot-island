#!/usr/bin/env bash
# Start Bot Island in the background (idempotent) and print the URL.
cd "$(dirname "$0")"
PORT=$(python3 -c "import json;print(json.load(open('config.json')).get('port',4747))")
if curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "Bot Island already running: http://127.0.0.1:$PORT"; exit 0
fi
setsid nohup python3 server.py > data/server.log 2>&1 &
sleep 1
echo "Bot Island started (pid $!): http://127.0.0.1:$PORT"
