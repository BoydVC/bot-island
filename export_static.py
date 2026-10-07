#!/usr/bin/env python3
"""Export a single self-contained HTML snapshot (UI + current fleet data) that opens anywhere, no server needed."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import collect  # noqa: E402
import doctor  # noqa: E402


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "dist", "bot-island-snapshot.html")
    data = collect.collect()
    web = os.path.join(HERE, "web")
    html = open(os.path.join(web, "index.html")).read()
    css = open(os.path.join(web, "style.css")).read()
    js = open(os.path.join(web, "app.js")).read()
    blob = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    doc = json.dumps(doctor.analyze(data), separators=(",", ":"), default=str).replace("</", "<\\/")
    html = html.replace('<link rel="stylesheet" href="style.css">', f"<style>{css}</style>")
    html = html.replace('<script src="app.js"></script>',
                        f"<script>window.BOT_ISLAND_SNAPSHOT={blob};window.BOT_ISLAND_DOCTOR={doc};window.BOT_ISLAND_DOCTOR_HTML={json.dumps(doctor.render_html(json.loads(doc))).replace("</", "<\\/")};</script>\n<script>{js}</script>")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write(html)
    print(f"wrote {out} ({os.path.getsize(out) // 1024} KB, snapshot {data['generatedAt']})")


if __name__ == "__main__":
    main()
