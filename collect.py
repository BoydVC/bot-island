#!/usr/bin/env python3
"""Bot Island collector: reads Grok Bot fleet *metadata* (read-only) and writes data/fleet.json.

Privacy rules: no prompts, transcripts, commands, page titles, memory contents, or secrets are
exported. Only names, titles, avatar colors, routine names + cron schedules, run timestamps,
tool-event timestamps/types (with tool names and URL hostnames), and file modification times.
"""
import glob
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))


def load_config():
    with open(os.path.join(HERE, "config.json")) as f:
        return json.load(f)


def read_json(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat().replace("+00:00", "Z")


SERVER_LABELS = {
    "user-Google-calendar": "Calendar",
    "user-Slack": "Slack",
    "user-Gmail": "Gmail",
    "user-Gmail--miranda": "Gmail (Miranda)",
    "user-Google-drive": "Drive",
    "user-Notion": "Notion",
    "user-X": "X",
    "user-Composio": "Composio",
    "user-Finance-xai": "Finance",
}


def event_summary(d):
    t = d.get("type")
    out = {"ts": d.get("ts"), "type": t}
    if d.get("durationMs") is not None:
        out["ms"] = d.get("durationMs")
    if t == "mcp_tool_call":
        srv = d.get("serverIdentifier") or ""
        tool = d.get("toolName") or ""
        short = tool[len(srv) + 1:] if srv and tool.startswith(srv + "-") else tool
        out["app"] = SERVER_LABELS.get(srv, srv.replace("user-", "") or "tool")
        out["tool"] = short[:48]
        if d.get("status") and d.get("status") != "ok":
            out["status"] = d.get("status")
    elif t == "shell_command":
        out["app"] = "Shell" if d.get("target") != "user_machine" else "Boyd's PC"
    elif t == "browser_navigation":
        host = ""
        try:
            host = urlparse(d.get("url") or "").hostname or ""
        except Exception:
            pass
        out["app"] = "Browser"
        out["host"] = host[:60]
    elif t == "computer_use_session":
        out["app"] = "Computer use"
    return out


def latest_mtime(patterns, root):
    best = 0
    for pat in patterns:
        for p in glob.glob(os.path.join(root, pat)):
            try:
                best = max(best, os.path.getmtime(p))
                if os.path.isdir(p):
                    for dp, dn, fn in os.walk(p):
                        for n in fn[:2000]:
                            try:
                                best = max(best, os.path.getmtime(os.path.join(dp, n)))
                            except OSError:
                                pass
                        if dp.count(os.sep) - p.count(os.sep) > 2:
                            dn[:] = []
            except OSError:
                pass
    return best


def artifact_events(patterns, root, since_ts, cap=1500):
    """Yield (mtime) for files under the bot's artifact globs written since since_ts. Names are not exported."""
    times = []
    for pat in patterns:
        for p in glob.glob(os.path.join(root, pat)):
            paths = [p]
            if os.path.isdir(p):
                paths = []
                for dp, dn, fn in os.walk(p):
                    paths.extend(os.path.join(dp, n) for n in fn)
            for fp in paths:
                try:
                    m = os.path.getmtime(fp)
                except OSError:
                    continue
                if m >= since_ts:
                    times.append((m, os.path.splitext(fp)[1].lower()[:8]))
    times.sort()
    return times[-cap:]


def observed_rhythm(times, tzname, days=21, min_share=0.3):
    """Infer daily work windows from artifact writes: hours (local) active on >= min_share of active days."""
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(tzname)
    except Exception:
        tz = None
    cutoff = time.time() - days * 86400
    by_hour = {}
    active_days = set()
    for m, _ in times:
        if m < cutoff:
            continue
        dt = datetime.fromtimestamp(m, tz=tz)
        day = dt.date().isoformat()
        active_days.add(day)
        by_hour.setdefault(dt.hour, {}).setdefault(day, []).append(dt.minute)
    out = []
    if not active_days:
        return out
    for h, dmap in sorted(by_hour.items()):
        share = len(dmap) / len(active_days)
        if share >= min_share and len(dmap) >= 2:
            firsts = sorted(min(v) for v in dmap.values())
            minute = firsts[len(firsts) // 2]
            out.append({"hour": h, "minute": minute, "share": round(share, 2), "days": len(dmap)})
    return out


def chat_events(adir, aid):
    """Message metadata only (who/when) from the bot's transcript store, opened read-only. No content."""
    import sqlite3
    db = os.path.join(adir, "store.db")
    out = []
    if not os.path.exists(db):
        return out
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        rows = con.execute("select entry from transcript_entries order by seq").fetchall()
        con.close()
    except Exception:
        return out
    for (raw,) in rows:
        try:
            e = json.loads(raw)
        except Exception:
            continue
        if e.get("kind") != "message" or e.get("role") != "user":
            continue
        try:
            ts = iso(int(e.get("timestampMs")))
        except Exception:
            continue
        fa = e.get("fromAgent") or {}
        if isinstance(fa, dict) and fa.get("id"):
            out.append({"ts": ts, "type": "agent_msg", "app": "Message", "from": fa.get("id"), "bot": aid})
        else:
            out.append({"ts": ts, "type": "boyd_msg", "app": "Boyd", "bot": aid})
    return out


def load_usage(cfg):
    """Fuel gauge source: /workspace/tokenmax/usage.json (written by TokenMax's daily usage check)."""
    path = cfg.get("usageFile", "/workspace/tokenmax/usage.json")
    u = read_json(path, None)
    fb = cfg.get("tokenFuel", {}) or {}
    if not isinstance(u, dict):
        return dict(fb, source="config.json fallback (usage.json missing or invalid)")
    used = u.get("used_pct")
    try:
        used = max(0.0, min(100.0, float(used)))
    except (TypeError, ValueError):
        used = fb.get("usedPct", 0)
    reset_date = u.get("reset_date")
    reset_at = u.get("reset_at")
    if not reset_at and reset_date:
        # Cursor cycles roll on UTC dates, so the earliest possible reset is 00:00 UTC on reset_date.
        reset_at = f"{reset_date}T00:00:00Z"
    # Pass through pace fields from usage.json only — never invent percentages.
    def _num(key, *alts):
        for k in (key,) + alts:
            if k in u and u[k] is not None:
                try:
                    return float(u[k])
                except (TypeError, ValueError):
                    pass
        return None

    out = {
        "label": u.get("label") or fb.get("label") or "weekly included usage",
        "usedPct": round(used, 1),
        "resetDate": reset_date,
        "resetAtISO": reset_at,
        "resetExact": bool(u.get("reset_at")),
        "checkedAt": u.get("checked_at"),
        "source": path,
        "account": u.get("account"),
        "onDemand": u.get("on_demand"),
        "monthlyReset": u.get("monthly_reset"),
        "resetNote": u.get("reset_note"),
    }
    for src, dst in (
        ("target_pct", "targetPct"),
        ("week_elapsed_pct", "weekElapsedPct"),
        ("gap_pts", "gapPts"),
        ("cursor_models_pct", "cursorModelsPct"),
        ("other_models_pct", "otherModelsPct"),
    ):
        v = _num(src)
        if v is not None:
            out[dst] = round(v, 2)
    return out


def newspaper_editions(ws):
    """Operational fields only from the Family Times edition log (no headlines)."""
    out = []
    path = os.path.join(ws, "newspaper", "edition-log.jsonl")
    try:
        lines = open(path).read().splitlines()
    except OSError:
        return out
    for line in lines:
        try:
            e = json.loads(line)
        except Exception:
            continue
        p = (e.get("print") or "").lower()
        status = "printed" if ("complete" in p or "printed" in p) else ("pdf-only" if ("offline" in p or "pdf-only" in p or "pdf only" in p) else ("unknown" if not p else "other"))
        out.append({"date": e.get("date"), "sheets": e.get("sheets"), "print": status})
    return out


def automation_touches(adir, since):
    """Routine folders whose state files changed after `since` = evidence the routine ran (mtime only)."""
    out = []
    for d in glob.glob(os.path.join(adir, "automations", "*")):
        name = os.path.basename(d)
        a = read_json(os.path.join(d, "automation.json"), {}) or {}
        for f in glob.glob(os.path.join(d, "*")):
            if os.path.basename(f) == "automation.json":
                continue
            try:
                m = os.path.getmtime(f)
            except OSError:
                continue
            if m >= since:
                out.append({"ts": iso(m * 1000), "type": "routine_touch", "app": "Routine", "tool": a.get("name") or name})
    return out


def source_summary(root, ws, events):
    """Where the data came from and how fresh each source is (for the UI + Fleet Doctor)."""
    def newest(pattern):
        best = 0
        for p in glob.glob(pattern):
            try:
                best = max(best, os.path.getmtime(p))
            except OSError:
                pass
        return iso(best * 1000) if best else None
    by_type = {}
    for e in events:
        t = e.get("type")
        if e.get("ts") and (t not in by_type or e["ts"] > by_type[t]):
            by_type[t] = e["ts"]
    return {
        "auditNewest": max([v for k, v in by_type.items() if k in ("mcp_tool_call", "shell_command", "browser_navigation", "computer_use_session")] or [None], key=lambda x: x or ""),
        "chatNewest": max([v for k, v in by_type.items() if k in ("agent_msg", "boyd_msg")] or [None], key=lambda x: x or ""),
        "filesNewest": by_type.get("file_write"),
        "routineTouchNewest": by_type.get("routine_touch"),
        "transcriptsNewest": newest(os.path.join(os.path.dirname(root), "agent-transcripts", "*", "*.jsonl")),
    }


def dated_output_events(cfg, ws, bots, events):
    """Approximate shifts from outputs whose names carry a date, for days with no exact timestamps."""
    import re
    try:
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(cfg.get("timezone", "UTC"))
    except Exception:
        tz = timezone.utc
    by_name = {b["name"]: b for b in bots}
    out = []
    for spec in cfg.get("datedOutputs", []):
        b = by_name.get(spec.get("bot"))
        if not b:
            continue
        dates = set()
        if spec.get("source") == "editionLog":
            dates |= {e["date"] for e in newspaper_editions(ws) if e.get("date")}
        for pat in spec.get("glob", []):
            for p in glob.glob(os.path.join(ws, pat)):
                m = re.search(r"(\d{4}-\d{2}-\d{2})", os.path.basename(p))
                if m:
                    dates.add(m.group(1))
        have = set()
        for e in events:
            if e.get("bot") == b["id"] and e.get("ts"):
                dt = datetime.fromisoformat(e["ts"].replace("Z", "+00:00")).astimezone(tz)
                have.add(dt.date().isoformat())
        rh = (b.get("observedRhythm") or [None])[0]
        hh, mm = (rh["hour"], rh["minute"]) if rh else map(int, spec.get("defaultTime", "09:00").split(":"))
        for d in sorted(dates):
            if d in have:
                continue
            try:
                local = datetime.fromisoformat(f"{d}T{hh:02d}:{mm:02d}:00").replace(tzinfo=tz)
            except ValueError:
                continue
            out.append({"ts": local.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"), "type": "dated_output",
                        "app": "Output", "tool": spec.get("label", "output"), "approx": True, "bot": b["id"]})
    return out


def collect():
    cfg = load_config()
    root = cfg["agentDataDir"]
    ws = cfg["workspaceDir"]
    bots, eggs, events = [], [], []
    for prof_path in sorted(glob.glob(os.path.join(root, "*", "profile.json"))):
        aid = os.path.basename(os.path.dirname(prof_path))
        prof = read_json(prof_path, {}) or {}
        name = prof.get("name") or aid[:8]
        if name in cfg.get("hide", []) or not (prof.get("description") or "").strip():
            eggs.append({"id": aid, "name": name})
            continue
        adir = os.path.dirname(prof_path)
        routines = []
        for apath in sorted(glob.glob(os.path.join(adir, "automations", "*", "automation.json"))):
            a = read_json(apath, {}) or {}
            runs = read_json(os.path.join(os.path.dirname(apath), "runs.json"), []) or []
            run_list, durs = [], []
            for r in runs:
                s, f = r.get("startedAt"), r.get("finishedAt")
                if not s:
                    continue
                run_list.append({"start": iso(s), "end": iso(f) if f else None, "status": r.get("status"),
                                 "trigger": r.get("trigger")})
                if f and f > s:
                    durs.append((f - s) / 60000)
            run_list.sort(key=lambda r: r["start"])
            routines.append({
                "name": a.get("name") or os.path.basename(os.path.dirname(apath)),
                "cron": a.get("schedule"),
                "enabled": a.get("enabled", True),
                "lastRunAt": a.get("lastRunAt"),
                "medianMinutes": round(statistics.median(durs), 1) if durs else None,
                "runs": run_list[-60:],
            })
        n_events = 0
        audit = os.path.join(adir, "audit.jsonl")
        if os.path.exists(audit):
            with open(audit, errors="replace") as f:
                for line in f:
                    try:
                        d = json.loads(line)
                    except Exception:
                        continue
                    ev = event_summary(d)
                    ev["bot"] = aid
                    events.append(ev)
                    n_events += 1
        ib0 = cfg.get("artifactsIgnoreBefore")
        since0 = datetime.fromisoformat(ib0.replace("Z", "+00:00")).timestamp() if ib0 else 0
        for ev in automation_touches(adir, since0):
            ev["bot"] = aid
            events.append(ev)
        chats = chat_events(adir, aid)
        events.extend(chats)
        mem_m = 0
        for p in glob.glob(os.path.join(adir, "memory", "*")):
            try:
                mem_m = max(mem_m, os.path.getmtime(p))
            except OSError:
                pass
        art_m = latest_mtime(cfg.get("artifacts", {}).get(name, []), ws)
        since = time.time() - 30 * 86400
        ib = cfg.get("artifactsIgnoreBefore")
        if ib:
            since = max(since, datetime.fromisoformat(ib.replace("Z", "+00:00")).timestamp())
        art_times = artifact_events(cfg.get("artifacts", {}).get(name, []), ws, since, cap=100000)
        if art_m and art_m < since:
            art_m = 0
        seen_min = set()
        dedup = []
        for m, ext in art_times:
            k = int(m // 60)
            if k in seen_min:
                continue
            seen_min.add(k)
            dedup.append((m, ext))
        art_times = dedup[-1500:]
        for m, ext in art_times:
            events.append({"ts": iso(m * 1000), "type": "file_write", "app": "Files", "ext": ext, "bot": aid})
        rhythm = observed_rhythm(art_times, cfg.get("timezone", "UTC"))
        bots.append({
            "id": aid,
            "name": name,
            "title": prof.get("title") or "",
            "color": prof.get("avatarColor") or "gray",
            "shape": prof.get("avatarShape") or "circle",
            "building": cfg.get("buildings", {}).get(name, "commons"),
            "routines": routines,
            "observedRhythm": rhythm,
            "artifactWrites30d": len(art_times),
            "eventCount": n_events,
            "chatCount": len(chats),
            "memoryUpdatedAt": iso(mem_m * 1000) if mem_m else None,
            "artifactUpdatedAt": iso(art_m * 1000) if art_m else None,
        })
    events.extend(dated_output_events(cfg, ws, bots, events))
    events.sort(key=lambda e: e.get("ts") or "")
    days = sorted({(e.get("ts") or "")[:10] for e in events if e.get("ts")})
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "timezone": cfg.get("timezone"),
        "tokenFuel": load_usage(cfg),
        "gameDays": cfg.get("gameDays", []),
        "gameNotes": cfg.get("gameNotes", []),
        "gameDaysCheckedAt": cfg.get("gameDaysCheckedAt"),
        "editions": newspaper_editions(ws),
        "sources": source_summary(root, ws, events),
        "bots": bots,
        "eggs": eggs,
        "events": events,
        "eventDaysUTC": days,
    }


def main():
    t0 = time.time()
    data = collect()
    out = os.path.join(HERE, "data", "fleet.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(data, f, separators=(",", ":"))
    os.replace(tmp, out)
    if "-q" not in sys.argv:
        print(f"wrote {out}: {len(data['bots'])} bots, {len(data['eggs'])} eggs, "
              f"{len(data['events'])} events, {sum(len(b['routines']) for b in data['bots'])} routines "
              f"in {time.time() - t0:.2f}s")


if __name__ == "__main__":
    main()
