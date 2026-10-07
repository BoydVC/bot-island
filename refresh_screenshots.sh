#!/usr/bin/env bash
# Re-render every README screenshot (server must be running on the configured port).
cd "$(dirname "$0")"
curl -s "http://127.0.0.1:$(python3 -c "import json;print(json.load(open('config.json')).get('port',4747))")/api/refresh" >/dev/null
./screenshot.sh live ""
./screenshot.sh replay-sep14-morning "mode=replay&day=2026-09-14&hour=8.7&play=0"
./screenshot.sh replay-sep11-messages "mode=replay&day=2026-09-11&hour=13.3&play=0"
./screenshot.sh network "mode=replay&day=2026-09-11&hour=13.3&play=0&net=1"
./screenshot.sh night "t=2026-10-07T23:30:00-04:00&play=0"
./screenshot.sh gameday "t=2026-10-11T21:00:00-04:00&play=0"
./screenshot.sh detail-jim "select=Jim"
./screenshot.sh health "health=1"
./screenshot.sh closeup-hq "mode=replay&day=2026-09-14&hour=8.72&play=0&focus=hq&zoom=2.4"
./screenshot.sh zoom-launch "focus=launchpad&zoom=2.4"
./screenshot.sh replay-oct06-outputs "mode=replay&day=2026-10-06&hour=6.85&play=0"
SIZE=1600,1800 ./screenshot.sh doctor "tab=doctor"
SIZE=1600,1700 ./screenshot.sh shipit "tab=stats"
python3 doctor.py -q
REPORT=$(ls -t reports/fleet-health-*.html | head -1)
SIZE=1100,1500 google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1100,1500 --user-data-dir=/tmp/bot-island-chrome --screenshot="screenshots/doctor-weekly-report.png" "file://$PWD/$REPORT" 2>/dev/null
ls -la screenshots/doctor-weekly-report.png
