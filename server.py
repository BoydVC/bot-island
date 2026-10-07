#!/usr/bin/env python3
"""Bot Island server: serves the web UI and a fresh fleet snapshot (stdlib only)."""
import http.server
import json
import os
import socketserver
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import importlib  # noqa: E402
import collect  # noqa: E402
import doctor  # noqa: E402

CFG = collect.load_config()
PORT = int(os.environ.get("BOT_ISLAND_PORT", CFG.get("port", 4747)))
HOST = os.environ.get("BOT_ISLAND_HOST", "127.0.0.1")
REFRESH_SECONDS = 60
_lock = threading.Lock()
_cache = {"body": b"{}", "at": 0, "doctor": b"{}"}


def refresh():
    try:
        importlib.reload(collect)
        importlib.reload(doctor)
        data = collect.collect()
        body = json.dumps(data, separators=(",", ":")).encode()
        doc = json.dumps(doctor.analyze(data), separators=(",", ":"), default=str).encode()
        with _lock:
            _cache["body"], _cache["at"], _cache["doctor"] = body, time.time(), doc
    except Exception as e:  # keep serving the last good snapshot
        print("collect failed:", e, file=sys.stderr)


def loop():
    while True:
        time.sleep(REFRESH_SECONDS)
        refresh()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=os.path.join(HERE, "web"), **kw)

    def log_message(self, fmt, *args):
        pass

    def _json(self, body):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/api/fleet":
            with _lock:
                body = _cache["body"]
            return self._json(body)
        if path == "/api/doctor":
            with _lock:
                body = _cache["doctor"]
            return self._json(body)
        if path == "/api/doctor/report":
            with _lock:
                rep = json.loads(_cache["doctor"])
            page = doctor.render_html(rep).encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(page)))
            self.end_headers()
            self.wfile.write(page)
            return
        if path == "/api/refresh":
            refresh()
            return self._json(b'{"ok":true}')
        if path == "/api/health":
            return self._json(json.dumps({"ok": True, "snapshotAge": round(time.time() - _cache["at"], 1)}).encode())
        return super().do_GET()


class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == "__main__":
    refresh()
    threading.Thread(target=loop, daemon=True).start()
    print(f"Bot Island running at http://{HOST}:{PORT}  (snapshot refreshes every {REFRESH_SECONDS}s)")
    Server((HOST, PORT), Handler).serve_forever()
