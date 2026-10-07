#!/usr/bin/env bash
cd "$(dirname "$0")/.." && node --experimental-websocket --no-warnings tests/smoke.mjs "$@"
