# ⚔️ Bot Island

**A living map of Boyd's Grok Bot fleet.** Every bot (Michael, Pam, Oscar, Jim, Kelly, Dwight, the tutors,
the Family Times, Pods, Path, Brief, Ryan, Dr. EggBot, TokenMax) gets a little house on the island and a workplace
that matches its job. When a bot's routine runs, it walks to work and a speech bubble shows what it's doing
("Calendar · list events", "Browsing espn.com", "Message from Michael"). At night it goes home and sleeps 💤.
When bots message each other, paper airplanes fly across the island.

Inspired by @poteto's bookmark: *"i built an island that visualizes my bots as they work! it's cute watching them
work and then go to bed and their little houses when they're resting"* (https://x.com/poteto/status/2093023531642863686).
Built by TokenMax from the Grok Bot weekly usage that would otherwise have reset unused on Oct 8, 2026.

![Bot Island // NEON, Oct 27 cyberpunk remaster](screenshots/neon-hero.png)


## What's new (Tue Oct 27 · cyberpunk + pixel remaster)

Visual-only remaster — collector, fleet JSON, API, replay/forecast, places directory, doctor/shipit, and usage HUD numbers are unchanged (pace % still never invented).

* **Cyberpunk pixel city** — magenta/cyan neon palette, CRT vibe, rain haze, glowing plazas and neon paths.
* **Pixel homes & workplaces** — status glow + Zzz at night; workplaces get neon workplace marks.
* **Message drones** — cyan/magenta trails across the island.
* **HUD chrome** — neon panels, remaster tag, mode badges / sky chip / pace HUD / places directory restyled but fully usable.

![Neon dusk](screenshots/dusk.png) · ![Live pace](screenshots/live.png)

## What's new (Sat Oct 10 afternoon remaster)

Deep polish pass on the already-built island (#1 SHORTLIST). Collector unchanged in spirit (still read-only on agent-data); `load_usage` now passes through pace fields from `/workspace/tokenmax/usage.json` and **never invents %**.

* **Richer day / night / dawn / dusk** — sun and crescent moon, warm dawn wash, purple dusk sky, denser starfield, soft porch glow on sleeping houses, ⌂ house markers on roofs.
* **Clearer houses vs workplaces** — legend marks ⌂ house / ⚒ workplace; busy workplaces get a green outline + ⚒ on the sign; **🗺️ Places** directory (toggle or `p` / `?places=1`) lists every building and who's inside, click to focus.
* **Live / forecast / replay UX** — HTML mode badges (⟲ REPLAY · ⏩ FORECAST · ⏪ LOOKBACK), sky-phase chip on the map, clock shows dawn/day/dusk/night.
* **This Week · TokenMax pace HUD** — used% · pace target% · fuel left, dual bar with target tick, behind/ahead/on-track status. Numbers come only from `usage.json` via collect (Sat Oct 10 afternoon read: 4% used, ~23.5% target, gap ~19.5 pts).
* **Offline snapshot** — `dist/bot-island-snapshot.html` rebuilt; fresh screenshots including `screenshots/00-best-home.png`, dawn/dusk/night/forecast.


| Weekday-morning rush (replay) | Michael coordinating the fleet by message |
|---|---|
| ![](screenshots/replay-sep14-morning.png) | ![](screenshots/replay-sep11-messages.png) |
| **Who talks to whom** (message map) | **Night**: everyone home asleep, lighthouse sweeping |
| ![](screenshots/network.png) | ![](screenshots/night.png) |
| **Game day**: Ravens @ Falcons, idle bots pile into the stadium | **Bot card**: weekday × hour heatmap, routines in plain English |
| ![](screenshots/gameday.png) | ![](screenshots/detail-jim.png) |
| **Close-up** (scroll to zoom): Michael gets Oscar's message, Oscar searches Drive, Boyd strolls by | **Post-restore replay** (Tue Oct 6): Path's drills and the Pods feed, from output files |
| ![](screenshots/closeup-hq.png) | ![](screenshots/replay-oct06-outputs.png) |
| **Fleet Doctor weekly report** (`python3 doctor.py`) | |
| ![](screenshots/doctor-weekly-report.png) | |

| **🩺 Fleet Doctor** tab: score, findings, a fix for each one, routine cost table | **📊 Ship-it Stats** tab: bots × days heatmap, streaks, leaderboards |
|---|---|
| ![](screenshots/doctor.png) | ![](screenshots/shipit.png) |

🎬 Timelapse of a real day (Mon Sep 14, 5 AM to 11:30 PM, 5 sim-minutes per frame, bots walking between jobs):
`screenshots/timelapse-2026-09-14.gif` (island only) and `.mp4` (full UI).

![timelapse](screenshots/timelapse-2026-09-14.gif)

## Run it

```bash
cd /workspace/tokenmax/bot-island
./run.sh                    # starts the server in the background (idempotent)
# open http://127.0.0.1:4747 in the box browser
```

No installs or dependencies are needed (Python 3 stdlib + one HTML/JS page). `python3 server.py` runs it in the foreground.
Change the port in `config.json` or with `BOT_ISLAND_PORT=5000 python3 server.py`.

## What you're looking at

| Place | Who works there |
|---|---|
| 🏛️ Chief of Staff HQ (Orioles + Ravens flags on top) | Michael |
| 📚 Research Library / 🔭 Trend Observatory | Jim / Kelly |
| 🏦 Island Bank | Oscar |
| 🏡 Family Clubhouse | Pam |
| 🏫 Schoolhouse | Char Tutor, Vic Tutor, Path |
| 📰 Family Times Press (smokestack puffs while printing) | Boyd Family Times (+ archive) |
| 📻 Pods Radio Tower (broadcasts radio waves when working) | Pods |
| 📮 Morning Post Office | Brief |
| 🛠️ Dwight's Workshop (the gear spins faster when he's coding) | Dwight |
| 🥚 EggBot Hatchery (one egg per not-yet-configured bot) | Dr. EggBot |
| 💡 Idea Lighthouse (sweeps a beam at night) | Ryan |
| 🚀 TokenMax Launch Pad (fuel gauge = unused weekly usage) | TokenMax |
| 🏟️ Purple Stadium (Ravens, Orioles, Chelsea and Terps flags) | Idle bots go watch the game |

* **Live mode** (default): real Eastern time. Bots follow their real cron schedules (Pam's 7:30 AM weekday calendar scan,
  Oscar's 8:31/8:45 money checks, the tutors' 5:45/6:15 PM homework check-ins, Jim's 8 PM interest note, and so on).
  Bots without local routines use an observed rhythm, worked out from when their output files actually change
  (e.g. Family Times at about 5:16 AM, Pods at about 6:48 AM). Speed up time (60×, 5 min/s, 30 min/s) to forecast the rest of the day.
* **Replay mode**: pick any logged day (🔥 = busiest) to watch what really happened, with every tool call,
  browser visit, routine run and bot-to-bot message on its real timestamp.
* **Timeline** (bottom): 24-hour Gantt of every bot's shifts. Solid bars are real activity and dashed bars are scheduled
  or usual shifts. Click or drag it to scrub time.
* **Island wire** (bottom right): a running ticker of what's happening.
* **Click a bot** (on the map or in the roster) for its card: what it's doing now, next shift, routines in plain
  English, last tool activity and last output written to disk. Hover buildings to see who's inside.
* **🧑 Boyd is on the island too** (Ravens #8 jersey). He lives at Boyd's Place, walks over to whichever bot he's
  chatting with (replays use the real times he messaged them), and heads to the stadium on game days.
* **📰 Island Gazette** (sidebar): an auto-written summary of the day (busiest bot, top tools, bot-to-bot message
  count and the chattiest pair, how often Boyd checked in, most-visited site, first and last activity). On days with no logs it shows the schedule forecast instead.
* **✉️ Who talks to whom**: toggle in the map legend. Draws the message network between bot houses (all-time in Live, that day in Replay).
  Michael shows up as the hub, as designed.
* **Three tabs** in the header: 🏝️ Island · 🩺 Fleet Doctor · 📊 Ship-it Stats (`?tab=doctor`, `?tab=stats`).
* **🩺 Fleet Doctor** (tab, sidebar card, CLI and weekly HTML report): read-only, pstack-style checks that change nothing.
  Every finding comes with a suggested fix. Five categories:
  * *Routine duplication*: the same routine name on two bots, near-identical prompts (word overlap ≥ 45%, compared in memory
    and never written out), two active bots doing one job in the same building, leftover paused copies, and same-bot routines
    firing within 20 minutes of each other.
  * *Failing or stale*: runs that didn't finish ok, scheduled fires with no run nearby (more than 20% missed), routines with no
    run in 14+ days, newspaper editions that only made a PDF because the printer was offline, and (live, from
    today's output files) any daily-output bot that missed its usual time: Family Times about 5:16 AM, Pods about 6:48, Path about 6:50, Jim about 8:16 PM.
  * *Token-heavy*: agent-minutes per week (median run length × fires per week) and tool calls per run, top 3 routines, plus heavy
    desktop (computer-use) time.
  * *Quiet bots*: no routines and no activity in 14+ days, and unhatched eggs.
  * *Data & coverage*: what the doctor could and couldn't see.

  Score = 100 − 15 per high, 6 per medium, 2 per low. `python3 doctor.py` writes `reports/fleet-health-<date>.html`
  (`--json` for raw output, `--html PATH` to choose the file). Each CLI run also saves the score to `reports/history.jsonl`, so next week's report shows the trend (▲/▼ vs. the last run). The server also serves it at `/api/doctor/report`, and the JSON at `/api/doctor`.
* **📊 Ship-it Stats** (tab): what the fleet shipped (completed routine runs + days with published output + bot-to-bot handoffs),
  a bots × days activity heatmap (last 49 days), 🔥 current and best streaks, whole-fleet daily bars, and six leaderboards
  (most shipped, tool calls, routine runs, handoffs sent, chats with Boyd, current streak).
* **🏟️ Game days** (`config.json → gameDays`): during a game, idle bots and Boyd fill the stadium, the scoreboard lights up
  and the lights come on. A **Game watch** panel in the sidebar lists the next fixtures in ET. Real schedules for Oct 7–21, 2026
  (checked Oct 7, sources in `config.json`):
  | When (ET) | Game | TV |
  |---|---|---|
  | Sat Oct 10, 10:00 AM | Chelsea v Bournemouth (PL, 3 PM BST) | USA/Peacock |
  | Sat Oct 10, 4:15 PM | Terps @ Ohio State | BTN |
  | Sun Oct 11, 8:20 PM | Ravens @ Falcons (SNF) | NBC/Peacock |
  | Sat Oct 17, 7:30 AM | Everton v Chelsea (PL, 12:30 PM BST) | USA/Peacock |
  | Sat Oct 17, 12:30 PM | Terps v Rutgers (Homecoming) | BTN |
  | Sun Oct 18, 1:00 PM | Ravens @ Browns | FOX |

  Orioles: the season is over (79–82, eliminated Sep 24), so there are no games in the window. That's noted in `gameNotes`.
* **🎃 October**: every house gets a pumpkin, and the pumpkins glow at night.
* **🎬 Cinema mode** `/?cinema=1`: loops the 6 busiest real days at 30 min/s. Leave it on a spare monitor or TV.
* **Double-click the rocket** to launch it 🚀. It also launches by itself when the weekly usage reset arrives.
* **Zoom and pan**: scroll to zoom (up to 4×) and drag to pan. `0` resets the view.
* **🔈 Sound** (header, off by default): a soft pentatonic chime when a bot clocks in and a whoosh for each bot-to-bot message.
* Keyboard: `space` play/pause · `esc` close card · `n` message map · `l` back to live · `+`/`-`/`0` zoom.

Handy URLs (also used for screenshots):
* `/?mode=replay&day=2026-09-11&hour=13.3&speed=60`: Michael coordinating the whole fleet by message
* `/?mode=replay&day=2026-09-14&hour=8.6`: the weekday-morning rush (Pam, Oscar, Brief)
* `/?t=2026-10-07T23:30:00-04:00&play=0`: tonight, everyone asleep
* `&select=Jim` opens a bot's card · `&net=1` turns on the message map · `&health=1` opens the health card
* `/?tab=doctor` / `/?tab=stats`: open straight onto Fleet Doctor or Ship-it Stats
* `/?cinema=1`: attract mode
* `&focus=commons&zoom=2.2`: open zoomed in on a building (`hq`, `library`, `bank`, `launchpad`, `stadium`…)

## How it works

```
collect.py   reads fleet METADATA read-only → data/fleet.json
doctor.py    Fleet Doctor: analyze(fleet) → findings + fixes; CLI writes reports/fleet-health-<date>.html
server.py    serves web/ + /api/fleet (re-collects every 60 s), /api/doctor, /api/doctor/report, /api/refresh, /api/health
web/         index.html + style.css + app.js (canvas renderer, no libraries, no network calls)
config.json  port, bot → building map, artifact folders per bot, dated outputs, game days, usageFile path
../usage.json  the fuel gauge's numbers (see below)
```

What the collector reads, all read-only:
* `/home/box/agent-data/agents/*/profile.json`: bot name, title, avatar color and shape (the bots on the island
  use each bot's real avatar shape and color: Jim's blue hex, Pam's cyan tablet, TokenMax's magenta sparkle…)
* `…/automations/*/automation.json` + `runs.json`: routine names, cron schedules, enabled flag, run start and finish times
* `…/audit.jsonl`: tool-event timestamps and types. It keeps only the app/tool name and the URL **hostname**,
  never commands, page titles or arguments.
* `…/store.db` (opened `mode=ro`): message timestamps and sender (Boyd vs. which bot). **Never message content.**
* mtimes of each bot's output folders in /workspace (e.g. `newspaper/`, `pods/`, `subs/`, `feed_*.xml`, `hspt/`, `ij_*.md`),
  never their contents. Mtimes from before the Oct 3 restore (`artifactsIgnoreBefore`) are ignored because the restore reset them.
* `newspaper/edition-log.jsonl`: edition date, sheet count and print status (printed / PDF-only) only. **No headlines.**
* Dated outputs (`config.json → datedOutputs`): when a bot writes one file per day (`ij_2026-09-24.md`, newspaper edition folders),
  the date in the file name marks a real shift. It's placed at that bot's usual time and labelled *time approx.* This is what fills
  Sep 17 to Oct 7, after the local logs end.
* Automation folder touches (e.g. a routine's state file updated) count as "ran" events for that routine.

### Fresh-data hunt (Oct 7)
After the Oct 3 restore, these on-box sources are all frozen at or before Sep 16: agent transcripts, `audit.jsonl`, the shared `audit-outbox.json`, `runs.json`,
`store.db` transcript rows (one tutor DB was touched Oct 6 with no new rows) and user memory. The bots now run server-side,
so the freshest real signals on the box are their **outputs**: daily newspaper editions plus the edition log (through Oct 7),
Path's `hspt/` drills (about 6:50 AM daily), Pods' `subs/` and RSS feeds (about 6:48 AM), Jim's interest-journal files (about 8:15 PM) and
TokenMax's own files. Live and Replay use all of them through today. Boyd's Gmail (metadata-only view), Drive (recent files) and Slack (channel list), all checked read-only,
held no bot-originated activity, so nothing from them is used.

### Fuel gauge / This Week pace: `/workspace/tokenmax/usage.json`
```json
{"used_pct": 4, "reset_date": "2026-10-15", "checked_at": "2026-10-10T13:16-04:00",
 "label": "Grok Bot weekly included usage", "reset_at": "2026-10-15T19:42-04:00",
 "target_pct": 23.5, "week_elapsed_pct": 24.75, "gap_pts": 19.5,
 "source": "Cursor spending dashboard (hard-reloaded by TokenMax daily-usage-check)"}
```
* `used_pct` (0–100): share of the weekly included usage already spent. The HUD shows used%, fuel left (`100 − used_pct`), and never invents a number.
* `target_pct` / `gap_pts` / `week_elapsed_pct` (optional): straight-line 95%-by-reset pace from TokenMax's daily check. When present, the dual bar draws a target tick and a behind/ahead status.
* `reset_date` (YYYY-MM-DD): the day the weekly allowance resets. With no `reset_at`, the earliest possible reset is assumed:
  00:00 UTC on that date (8:00 PM ET the evening before). The countdown says "as early as".
* `reset_at` (optional ISO timestamp): an exact reset time, if known. It overrides the assumption.
* `checked_at` (ISO timestamp): when the numbers were read. Shown as "Checked …".
* `label`, `source`, `account`, `on_demand`, `monthly_reset`: display only.

The file is re-read on every collect (60 s), so editing it updates the gauge and rocket within a minute. There's no automatic
Cursor usage feed, so someone (or a bot) has to update the file. `config.json → usageFile` points at it, and `tokenFuel` is only a fallback.

No secrets, prompts, memories or message text leave the agent folders. Nothing is written outside this project folder.

## Known gaps
* The local audit and transcript logs on this box stop on **Sep 16, 2026** (the box was restored from an older snapshot on Oct 3).
  Newer bot activity lives server-side, so recent days rely on schedules, file mtimes and observed rhythms. Replay is richest for Aug 20 to Sep 16.
* Fuel / pace numbers come from `usage.json` (TokenMax daily-usage-check). Nothing invents %; the file must be updated by a check or by hand.
* Sep 17 to Oct 7 replays only show outputs (dated files and the edition log), not tool calls or messages, so Ship-it Stats and streaks undercount those weeks.
* Fleet Doctor's "missed runs" and "token-heavy" checks use the run history that's on the box (through Sep 16). Agent-minutes are a stand-in for tokens, because no token counts are logged locally.
* Some bots (Kelly, Dwight, Path) have no local routines or recent output, so they mostly hang out.
* Game schedules are hand-entered (from web lookups on Oct 7). Flex scheduling or TV changes won't show up until `config.json → gameDays` is edited.
* Houses are assigned alphabetically around the rim, and workplaces come from `config.json → buildings` (new bots default to Town Square).

## Take it anywhere (no server)
```bash
python3 export_static.py      # → dist/bot-island-snapshot.html (~650 KB, UI + data in one file)
```
Open that file in any browser on any computer. It's a frozen snapshot, so live mode keeps ticking but the data doesn't refresh.

## Tests
```bash
tests/run.sh        # headless Chrome over CDP: 28 checks (modes, replay, gazette, network, card, health,
                    # timeline scrub, game day, game watch, night, rocket, Doctor tab + filters,
                    # Ship-it Stats, tab switching, /api/doctor, weekly report, API, zero page errors)
```

## Re-rendering assets
```bash
./screenshot.sh live ""                                         # → screenshots/live.png
./screenshot.sh morning "mode=replay&day=2026-09-14&hour=8.7&play=0"
./make_timelapse.sh 2026-09-14 5 5 23.5                         # 5-min steps, bots walk between frames → mp4 + gif (~2 min)
python3 doctor.py                                               # → reports/fleet-health-<date>.html
python3 collect.py                                              # rebuild data/fleet.json by hand
```

## Files
* `dist/bot-island-snapshot.html`: self-contained snapshot (open anywhere)
* `tests/`: CDP smoke test
* `reports/`: Fleet Doctor weekly HTML reports
* `timelapse.mjs`: CDP frame renderer used by `make_timelapse.sh`
* `screenshots/`: rendered with headless Chrome via `./screenshot.sh <name> "<query>"`
* `SHORTLIST.md` (one folder up): the other 9 project ideas from Boyd's bookmarks

---
## Repo notes
- **Built:** Oct 8, 2026, by TokenMax (Boyd's Grok Bot) on the Grok Bot box.
- **Run:** `./run.sh` (then open the localhost URL it prints).
- Imported from `/workspace/tokenmax/bot-island` on Oct 23, 2026. node_modules, virtualenvs, logs and files over 20 MB were left out.
