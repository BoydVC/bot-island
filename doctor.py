#!/usr/bin/env python3
"""Fleet Doctor: read-only health checks for Boyd's Grok Bot fleet (pstack-style: verify, reflect, blast radius).

Usage:
  python3 doctor.py                      # writes reports/fleet-health-<date>.html and prints a summary
  python3 doctor.py --html out.html      # choose the HTML path
  python3 doctor.py --json out.json      # also write machine-readable findings
It changes nothing: it only reads metadata through collect.py (+ routine prompts, locally, for similarity scoring;
prompt text is never written to any output).
"""
import argparse
import glob
import html
import json
import os
import re
import statistics
import sys
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import collect  # noqa: E402

try:
    from zoneinfo import ZoneInfo
    TZ = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover
    TZ = timezone.utc

SEV_W = {"high": 15, "medium": 6, "low": 2, "info": 0}
CAT = {"duplication": "🔁 Routine duplication", "failing": "🧯 Failing or stale", "heavy": "🔥 Token-heavy",
       "quiet": "😴 Quiet bots", "data": "🛰️ Data & coverage"}


def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def local(dt):
    return dt.astimezone(TZ)


def fmt(dt):
    if not dt:
        return "never"
    d = local(dt)
    return d.strftime("%a %b %-d, %-I:%M %p ET")


def cron_fires(cron, start, end):
    """Yield datetimes (ET) between start and end matching a 5-field cron."""
    def field(f, lo, hi):
        out = set()
        for part in str(f).split(","):
            rng, _, step = part.partition("/")
            step = int(step) if step else 1
            if rng == "*":
                a, b = lo, hi
            elif "-" in rng:
                a, b = map(int, rng.split("-"))
            else:
                a = b = int(rng)
                if step > 1:
                    b = hi
            out |= {(v % 7 if hi == 6 else v) for v in range(a, b + 1, step)}
        return out
    try:
        m, h, dom, mon, dow = cron.split()[:5]
    except Exception:
        return []
    M, Hh, D, Mo, W = field(m, 0, 59), field(h, 0, 23), field(dom, 1, 31), field(mon, 1, 12), field(dow, 0, 6)
    out = []
    day = local(start).replace(hour=0, minute=0, second=0, microsecond=0)
    while day <= local(end):
        wd = (day.weekday() + 1) % 7
        ok_day = (dom == "*" and dow == "*") or (dom == "*" and wd in W) or (dow == "*" and day.day in D) or \
                 (dom != "*" and dow != "*" and (day.day in D or wd in W))
        if day.month in Mo and ok_day:
            for hh in sorted(Hh):
                for mm in sorted(M):
                    t = day.replace(hour=hh, minute=mm)
                    if start <= t <= end:
                        out.append(t)
        day += timedelta(days=1)
    return out


def words(text):
    return {w for w in re.findall(r"[a-z]{4,}", (text or "").lower())}


def jaccard(a, b):
    return len(a & b) / max(1, len(a | b))


def read_prompts(root):
    """{(botId, routineName): set(words)}. Text stays in memory only."""
    out = {}
    for p in glob.glob(os.path.join(root, "*", "automations", "*", "automation.json")):
        aid = p.split(os.sep)[-4]
        a = collect.read_json(p, {}) or {}
        out[(aid, a.get("name"))] = words(a.get("prompt", ""))
    return out


def analyze(data=None):
    cfg = collect.load_config()
    data = data or collect.collect()
    now = datetime.now(timezone.utc)
    bots = {b["id"]: b for b in data["bots"]}
    events = [dict(e, _t=ts(e["ts"])) for e in data["events"] if e.get("ts")]
    logged = [e for e in events if e["type"] not in ("file_write", "dated_output", "routine_touch")]
    log_end = max((e["_t"] for e in logged), default=now)
    findings = []

    def add(cat, sev, title, detail, fix, bot=None, key=None):
        findings.append({"id": key or f"{cat}-{len(findings)}", "category": cat, "severity": sev, "bot": bot,
                         "title": title, "detail": detail, "fix": fix})

    # ---------- routine table ----------
    routines = []
    by_bot_events = {}
    for e in logged:
        by_bot_events.setdefault(e["bot"], []).append(e)
    for b in data["bots"]:
        for r in b.get("routines", []):
            runs = [x for x in r.get("runs", []) if x.get("start")]
            starts = [ts(x["start"]) for x in runs]
            tool_counts = []
            for x in runs:
                s, f = ts(x["start"]), ts(x["end"]) if x.get("end") else ts(x["start"]) + timedelta(minutes=10)
                tool_counts.append(sum(1 for e in by_bot_events.get(b["id"], []) if s - timedelta(seconds=30) <= e["_t"] <= f + timedelta(seconds=30)))
            fires_per_week = len(cron_fires(r.get("cron") or "", now, now + timedelta(days=7))) if r.get("cron") else 0
            med = r.get("medianMinutes") or 0
            exp = []
            if starts and r.get("cron"):
                exp = cron_fires(r["cron"], min(starts) - timedelta(minutes=1), max(log_end, max(starts)))
            hit = sum(1 for t in exp if any(abs((s - t).total_seconds()) < 3 * 3600 for s in starts))
            routines.append({
                "bot": b["name"], "botId": b["id"], "name": r["name"], "cron": r.get("cron"), "enabled": r.get("enabled", True),
                "runs": len(runs), "ok": sum(1 for x in runs if x.get("status") == "ok"),
                "failed": sum(1 for x in runs if x.get("status") not in (None, "ok")),
                "medianMinutes": med, "firesPerWeek": fires_per_week,
                "minutesPerWeek": round(med * fires_per_week, 1),
                "toolCallsPerRun": round(statistics.median(tool_counts), 1) if tool_counts else 0,
                "toolCallsPerWeek": round((statistics.median(tool_counts) if tool_counts else 0) * fires_per_week),
                "lastRun": runs[-1]["start"] if runs else None,
                "expected": len(exp), "hit": hit,
            })

    # ---------- 1. duplication ----------
    by_name = {}
    for r in routines:
        by_name.setdefault(r["name"].strip().lower(), []).append(r)
    for name, lst in by_name.items():
        if len({r["botId"] for r in lst}) < 2:
            continue
        enabled = [r for r in lst if r["enabled"] is not False]
        owners = ", ".join(f"{r['bot']}{'' if r['enabled'] is not False else ' (paused)'}" for r in lst)
        if len(enabled) >= 2:
            add("duplication", "high", f"“{lst[0]['name']}” runs on {len(enabled)} bots", f"Enabled on {owners}. Both copies fire on the same schedule, so the work (and tokens) is done twice.",
                f"Keep it on the bot that owns the job and delete the other copy.", key=f"dup-{name}")
        else:
            keep = enabled[0]["bot"] if enabled else lst[0]["bot"]
            add("duplication", "low", f"Leftover paused copy of “{lst[0]['name']}”", f"Exists on {owners}. Only {keep} runs it, so the paused copy is clutter that could be re-enabled by mistake.",
                f"Delete the paused copy so {keep} is the single owner.", key=f"dup-{name}")
    prompts = read_prompts(cfg["agentDataDir"])
    seen = set()
    for i, a in enumerate(routines):
        for b2 in routines[i + 1:]:
            if a["name"].lower() == b2["name"].lower() or a["botId"] == b2["botId"]:
                continue
            sim = jaccard(prompts.get((a["botId"], a["name"]), set()), prompts.get((b2["botId"], b2["name"]), set()))
            if sim >= 0.45 and (a["name"], b2["name"]) not in seen:
                seen.add((a["name"], b2["name"]))
                twins = bots[a["botId"]]["building"] == bots[b2["botId"]]["building"]
                if twins:
                    add("duplication", "low", f"Twin routines: “{a['name']}” and “{b2['name']}”",
                        f"{a['bot']} and {b2['bot']} run near-identical instructions ({round(sim * 100)}% overlap). That's deliberate (one per kid), but fixes have to be made twice.",
                        "Move the shared rules into one skill or doc that both prompts reference, and keep only the kid-specific parts in each routine.")
                    continue
                add("duplication", "medium", f"“{a['name']}” ({a['bot']}) and “{b2['name']}” ({b2['bot']}) look alike",
                    f"Their instructions overlap {round(sim * 100)}% by vocabulary, which usually means two bots are covering the same ground.",
                    "Merge them into one routine, or narrow each prompt so the two don't overlap.")
    by_b = {}
    for r in routines:
        if r["enabled"] is not False and r["cron"]:
            by_b.setdefault(r["bot"], []).append(r)
    for bname, lst in by_b.items():
        fires = []
        for r in lst:
            for t in cron_fires(r["cron"], now, now + timedelta(days=7)):
                fires.append((t, r["name"]))
        fires.sort()
        clash = {}
        for (t1, n1), (t2, n2) in zip(fires, fires[1:]):
            if n1 != n2 and (t2 - t1).total_seconds() <= 20 * 60:
                clash[(n1, n2)] = clash.get((n1, n2), 0) + 1
        for (n1, n2), c in clash.items():
            add("duplication", "low", f"{bname}: “{n1}” and “{n2}” fire within 20 minutes", (f"{c} times in the next 7 days." if c != 1 else "Once in the next 7 days.") + " Back-to-back runs usually re-gather the same context.",
                "Merge them into one morning run, or stagger them so the second can reuse the first's results.")
    # two producers in one building
    by_building = {}
    for b in data["bots"]:
        active = any(r.get("enabled") is not False for r in b.get("routines", [])) or b.get("observedRhythm")
        if active:
            by_building.setdefault(b["building"], []).append(b)
    for bl, lst in by_building.items():
        if bl in ("school", "commons") or len(lst) < 2:
            continue
        names = " and ".join(b["name"] for b in lst)
        add("duplication", "medium", f"Two active bots share one job: {names}",
            "Both still have an enabled schedule or a recent daily output for the same kind of work.",
            "Confirm which one is current, then pause the other's routine (e.g. retire the archive bot's daily run).", key=f"dup-building-{bl}")

    # ---------- 2. failing or stale ----------
    for r in routines:
        if r["failed"]:
            add("failing", "high" if r["failed"] / max(1, r["runs"]) > 0.25 else "medium", f"{r['bot']}: {r['failed']} of {r['runs']} “{r['name']}” runs failed",
                "Runs that end in an error usually leave the job half done.", "Open the last failed run, fix the root cause, and add a verification step at the end of the prompt.", bot=r["bot"])
        if r["enabled"] is not False and r["expected"] >= 4:
            miss = r["expected"] - r["hit"]
            if miss / r["expected"] > 0.2:
                add("failing", "medium", f"{r['bot']}: “{r['name']}” missed {miss} of {r['expected']} scheduled runs",
                    f"Logged between its first run and {fmt(log_end)}.", "Check the schedule is still enabled and whether a run is being skipped (quiet hours, errors, or the bot being busy).", bot=r["bot"])
        if r["enabled"] is not False and r["lastRun"] and r["firesPerWeek"] and (log_end - ts(r["lastRun"])).days > max(3, 21 / max(1, r["firesPerWeek"])):
            add("failing", "medium", f"{r['bot']}: “{r['name']}” has gone stale", f"Last run {fmt(ts(r['lastRun']))}, even though it's scheduled {r['firesPerWeek']}×/week.",
                "Re-save or re-create the routine and run it once by hand to confirm.", bot=r["bot"])
    eds = data.get("editions", [])[-7:]
    pdf = [e for e in eds if e.get("print") == "pdf-only"]
    if pdf:
        add("failing", "medium" if len(pdf) >= 3 else "low", f"Family Times couldn't print {len(pdf)} of the last {len(eds)} editions",
            f"PDF-only on {', '.join(e['date'][5:] for e in pdf)} (printer offline). The latest edition, {eds[-1]['date'][5:]}, was {eds[-1]['print']}.",
            "Give the newspaper a printer-health preflight (wake the printer or fall back to a second printer) and have it tell Boyd when printing is skipped.", bot="Boyd Family Times")

    # ---------- 3. token-heavy ----------
    heavy = sorted([r for r in routines if r["enabled"] is not False], key=lambda r: (r["minutesPerWeek"], r["toolCallsPerWeek"]), reverse=True)
    for r in heavy[:3]:
        if r["minutesPerWeek"] < 20 and r["toolCallsPerRun"] < 25:
            continue
        sev = "medium" if r["minutesPerWeek"] >= 60 or r["toolCallsPerRun"] >= 40 else "low"
        tips = []
        if r["firesPerWeek"] >= 7:
            tips.append("skip weekends or run every other day if the content allows")
        if r["toolCallsPerRun"] >= 25:
            tips.append("cache the gather step (reuse yesterday's sources and fetch only what's new)")
        tips.append("cap the run with a short checklist so it stops when the output is verified")
        add("heavy", sev, f"{r['bot']}: “{r['name']}” ≈ {r['minutesPerWeek']:.0f} agent-minutes/week",
            f"{r['firesPerWeek']} runs/week × ~{r['medianMinutes']} min, with ~{r['toolCallsPerRun']:.0f} tool calls per run (≈{r['toolCallsPerWeek']} per week).",
            "To trim tokens: " + "; ".join(tips) + ".", bot=r["bot"])
    cu = {}
    for e in logged:
        if e["type"] == "computer_use_session":
            cu[e["bot"]] = cu.get(e["bot"], 0) + (e.get("ms") or 0)
    for bid, ms in sorted(cu.items(), key=lambda x: -x[1])[:2]:
        if ms > 30 * 60000:
            add("heavy", "low", f"{bots[bid]['name']}: {ms / 60000:.0f} min of screen-driving (computer use)",
                "Driving a desktop takes screenshots every step and is the priciest way to read a page.",
                "Swap repeat browsing for a script or a connector (e.g. turn the PowerSchool or X checks into a saved script).", bot=bots[bid]["name"])

    # ---------- 4. quiet bots ----------
    last = {}
    for e in events:
        if e["type"] == "dated_output":
            continue
        last[e["bot"]] = max(last.get(e["bot"], e["_t"]), e["_t"])
    for b in data["bots"]:
        has_rt = any(r.get("enabled") is not False for r in b.get("routines", []))
        lt = last.get(b["id"])
        if not lt and not has_rt and not b.get("observedRhythm"):
            add("quiet", "low", f"{b['name']} has no activity on this box", "No routines, tool calls, messages or output files were found locally.",
                "Either give it a routine (a weekly check-in is enough to keep it useful) or archive it.", bot=b["name"])
        elif lt and not has_rt and (log_end - lt).days >= 14 and (now - lt).days >= 14:
            add("quiet", "low", f"{b['name']} has been quiet since {local(lt).strftime('%b %-d')}",
                f"{(log_end - lt).days} days of silence before the local logs end, and no routines.",
                "Give it a small recurring job that fits its role, or retire it to cut clutter.", bot=b["name"])
    for egg in data.get("eggs", []):
        add("quiet", "low", f"Unfinished bot in the Hatchery: {egg['name']}", "It has no persona or description yet.",
            "Ask Dr. EggBot to finish it, or delete it.")

    # ---------- 5. daily outputs today (live signal from output files) ----------
    on_time, late = [], []
    for b in data["bots"]:
        rh = b.get("observedRhythm") or []
        au = ts(b.get("artifactUpdatedAt")) if b.get("artifactUpdatedAt") else None
        if not rh or not au:
            continue
        r0 = max(rh, key=lambda x: x.get("share", 0))
        nl = local(now)
        due = nl.replace(hour=r0["hour"], minute=r0["minute"], second=0, microsecond=0)
        if due + timedelta(hours=2) > nl:      # today's slot hasn't passed (plus 2 h grace), so check yesterday's
            due -= timedelta(days=1)
        if local(au) >= due - timedelta(minutes=45):
            on_time.append(f"{b['name']} {local(au).strftime('%a %-I:%M %p')}")
        else:
            late.append(b["name"])
            add("failing", "medium", f"{b['name']} missed its usual {due.strftime('%-I:%M %p')} output",
                f"It normally writes around {due.strftime('%-I:%M %p')} ET every day ({r0.get('days', 0)} days observed), but the newest output is from {fmt(au)}.",
                "Open the bot's latest run and check for a failed tool or auth prompt. If the schedule moved on purpose, nothing to do.", bot=b["name"])
    if on_time:
        add("data", "info", f"Daily outputs on time ({len(on_time)} of {len(on_time) + len(late)})",
            "Newest output vs. each bot's usual time: " + " · ".join(on_time) + " (ET).",
            "No action needed. This check re-runs every minute in Bot Island.")

    # ---------- data coverage ----------
    src = data.get("sources", {})
    add("data", "info", "Local activity logs end " + fmt(ts(src.get("auditNewest"))),
        f"Tool and message logs on this box stop then (the box was restored on Oct 3). Newer days use output files, the edition log and schedules. Newest output file: {fmt(ts(src.get('filesNewest')))}.",
        "No action needed. If bots start writing local logs again, Bot Island picks them up automatically.")

    order = {"high": 0, "medium": 1, "low": 2, "info": 3}
    findings.sort(key=lambda f: (order[f["severity"]], list(CAT).index(f["category"])))
    score = max(0, 100 - sum(SEV_W[f["severity"]] for f in findings))
    botrows = []
    for b in data["bots"]:
        ev = [e for e in events if e["bot"] == b["id"] and e["type"] != "dated_output"]
        botrows.append({"name": b["name"], "title": b.get("title"), "routines": sum(1 for r in b.get("routines", []) if r.get("enabled") is not False),
                        "events7": sum(1 for e in ev if (log_end - e["_t"]).days < 7), "events30": sum(1 for e in ev if (log_end - e["_t"]).days < 30),
                        "lastActive": last.get(b["id"]).isoformat() if last.get(b["id"]) else None})
    return {"generatedAt": now.isoformat(), "logEnd": log_end.isoformat(), "score": score,
            "counts": {s: sum(1 for f in findings if f["severity"] == s) for s in order},
            "findings": findings, "routines": routines, "bots": botrows, "categories": CAT}


HISTORY = os.path.join(HERE, "reports", "history.jsonl")


def load_history():
    try:
        with open(HISTORY) as f:
            return [json.loads(l) for l in f if l.strip()]
    except OSError:
        return []


def trend_html(rep):
    """Compare with the newest saved run from an earlier day (written by the CLI)."""
    today = local(datetime.fromisoformat(rep["generatedAt"])).strftime("%Y-%m-%d")
    prev = [h for h in load_history() if h.get("date") < today]
    if not prev:
        return " · first saved report, so no trend yet"
    p = prev[-1]
    d = rep["score"] - p["score"]
    arrow = "▲" if d > 0 else "▼" if d < 0 else "＝"
    return f" · {arrow} {abs(d)} vs {html.escape(p['date'])} ({p['score']})"


def render_html(rep):
    e = html.escape
    sev_col = {"high": "#f87171", "medium": "#fbbf24", "low": "#60a5fa", "info": "#94a3b8"}
    gen = local(datetime.fromisoformat(rep["generatedAt"]))
    rows = []
    for cat, label in rep["categories"].items():
        fs = [f for f in rep["findings"] if f["category"] == cat]
        if not fs:
            continue
        rows.append(f"<h2>{e(label)} <span class=n>{len(fs)}</span></h2>")
        for f in fs:
            rows.append(f"""<div class="f"><span class="sev" style="background:{sev_col[f['severity']]}">{f['severity']}</span>
<div><b>{e(f['title'])}</b><div class="d">{e(f['detail'])}</div><div class="fix">💊 {e(f['fix'])}</div></div></div>""")
    rt = "".join(f"<tr><td>{e(r['bot'])}</td><td>{e(r['name'])}{'' if r['enabled'] is not False else ' <i>(paused)</i>'}</td><td>{e(r['cron'] or '')}</td><td>{r['runs']}</td><td>{r['ok']}/{r['runs']}</td><td>{r['medianMinutes'] or ''}</td><td>{r['minutesPerWeek']:.0f}</td><td>{r['toolCallsPerRun']:.0f}</td><td>{r['hit']}/{r['expected']}</td></tr>"
                 for r in sorted(rep["routines"], key=lambda r: -r["minutesPerWeek"]))
    bt = "".join(f"<tr><td>{e(b['name'])}</td><td>{e(b['title'] or '')}</td><td>{b['routines']}</td><td>{b['events7']}</td><td>{b['events30']}</td><td>{fmt(datetime.fromisoformat(b['lastActive'])) if b['lastActive'] else 'never'}</td></tr>"
                 for b in sorted(rep["bots"], key=lambda b: -(b["events30"])))
    c = rep["counts"]
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>Fleet Doctor · {gen:%b %-d, %Y}</title>
<style>body{{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1324;color:#e8eefc;margin:0;padding:28px 36px;max-width:1100px}}
h1{{margin:0 0 4px}}.sub{{color:#8fa3c9}}.top{{display:flex;gap:18px;align-items:center;margin:18px 0 8px}}
.score{{font-size:46px;font-weight:800;color:{'#4ade80' if rep['score'] >= 75 else '#fbbf24' if rep['score'] >= 50 else '#f87171'}}}
.pill{{background:#16233f;border:1px solid #22325a;border-radius:999px;padding:4px 10px;margin-right:6px}}
h2{{font-size:15px;margin:22px 0 8px;color:#ffb547}} h2 .n{{background:#22325a;color:#e8eefc;border-radius:999px;padding:0 8px;font-size:12px}}
.f{{display:grid;grid-template-columns:70px 1fr;gap:10px;background:#111c33;border:1px solid #22325a;border-radius:12px;padding:10px 12px;margin:8px 0}}
.sev{{color:#111;font-weight:700;font-size:11px;text-transform:uppercase;border-radius:6px;padding:2px 6px;height:fit-content;text-align:center}}
.d{{color:#c3d1ee;margin-top:2px}}.fix{{margin-top:6px;color:#bbf7d0}}
table{{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:8px}}th,td{{text-align:left;padding:5px 6px;border-bottom:1px solid #1c2a4b}}th{{color:#8fa3c9;font-weight:600}}
.foot{{color:#8fa3c9;margin-top:24px;font-size:12px}}</style></head><body>
<h1>🩺 Fleet Doctor: weekly health report</h1>
<div class="sub">Boyd's Grok Bot fleet · generated {gen:%a %b %-d, %Y %-I:%M %p} ET · local logs through {fmt(datetime.fromisoformat(rep['logEnd']))} · read-only, nothing was changed</div>
<div class="top"><div class="score">{rep['score']}</div><div><div>fleet health score (100 = nothing to fix){trend_html(rep)}</div>
<div style="margin-top:6px"><span class="pill">🔴 {c['high']} high</span><span class="pill">🟡 {c['medium']} medium</span><span class="pill">🔵 {c['low']} low</span><span class="pill">ℹ️ {c['info']} info</span></div></div></div>
{''.join(rows)}
<h2>Routines, heaviest first</h2>
<table><tr><th>Bot</th><th>Routine</th><th>Cron</th><th>Runs</th><th>OK</th><th>Median min</th><th>Agent-min/week</th><th>Tool calls/run</th><th>On schedule</th></tr>{rt}</table>
<h2>Bots</h2>
<table><tr><th>Bot</th><th>Role</th><th>Active routines</th><th>Events (7d)</th><th>Events (30d)</th><th>Last active</th></tr>{bt}</table>
<div class="foot">Windows are counted back from the end of the local logs. Agent-minutes are a stand-in for token spend (minutes per run × runs per week). Made by TokenMax · Bot Island · doctor.py</div>
</body></html>"""


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--html", help="output HTML path (default reports/fleet-health-<date>.html)")
    ap.add_argument("--json", help="also write findings JSON here")
    ap.add_argument("-q", action="store_true", help="quiet")
    a = ap.parse_args()
    rep = analyze()
    out = a.html or os.path.join(HERE, "reports", f"fleet-health-{local(datetime.now(timezone.utc)):%Y-%m-%d}.html")
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w") as f:
        f.write(render_html(rep))
    today = local(datetime.now(timezone.utc)).strftime("%Y-%m-%d")
    hist = [h for h in load_history() if h.get("date") != today]
    hist.append({"date": today, "score": rep["score"], "counts": rep["counts"]})
    with open(HISTORY, "w") as f:
        f.write("".join(json.dumps(h) + "\n" for h in hist[-104:]))
    if a.json:
        with open(a.json, "w") as f:
            json.dump(rep, f, indent=1)
    if not a.q:
        c = rep["counts"]
        print(f"Fleet health {rep['score']}/100 · {c['high']} high, {c['medium']} medium, {c['low']} low, {c['info']} info → {out}")
        for f in rep["findings"]:
            print(f"  [{f['severity']:<6}] {f['title']}")


if __name__ == "__main__":
    main()
