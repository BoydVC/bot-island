#!/usr/bin/env bash
# Render a timelapse of a replay day → screenshots/timelapse-<day>.mp4 + .gif
# One headless-Chrome page; sim time is stepped in sub-steps so bots visibly walk between buildings.
# Usage: ./make_timelapse.sh [DAY=2026-09-14] [STEP_MINUTES=5] [FROM_HOUR=5] [TO_HOUR=23.5]
cd "$(dirname "$0")"
DAY=${1:-2026-09-14}; STEP=${2:-5}; FROM=${3:-5}; TO=${4:-23.5}
PORT=$(python3 -c "import json;print(json.load(open('config.json')).get('port',4747))")
TMP=$(mktemp -d)
node --experimental-websocket --no-warnings timelapse.mjs "$PORT" "$DAY" "$FROM" "$TO" "$STEP" "$TMP" || exit 1
ffmpeg -y -loglevel error -framerate 12 -i "$TMP/f%04d.png" -vf "scale=1280:-2" -c:v libx264 -pix_fmt yuv420p "screenshots/timelapse-$DAY.mp4"
# GIF: just the island stage (crop), every other frame, 8 fps, 96-colour palette
ffmpeg -y -loglevel error -framerate 12 -i "$TMP/f%04d.png" -vf "crop=1208:938:20:71,select=not(mod(n\,2)),setpts=N/8/TB,fps=8,scale=760:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" "screenshots/timelapse-$DAY.gif"
rm -rf "$TMP"; ls -la screenshots/timelapse-$DAY.*
