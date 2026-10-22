# CLAUDE.md — mattbreckenridge.com (portfolio site)

Read this fully before making changes. Update this file whenever you make an
architectural change (new app, new backend, data model change, cross-repo
coordination) — it is the only context a fresh session gets.

## What this repo is

Matt Breckenridge's portfolio site (repo `skimecha/mattbreckenridge-com`),
live at https://mattbreckenridge.com. Pure static hosting on GitHub Pages:
pushes to `main` deploy via `.github/workflows/deploy-pages.yml`. HTTPS
enforced, Cloudflare Web Analytics beacon on public pages.

No build step anywhere, deliberately: Matt's machine has no Node toolchain.
React apps load UMD bundles from CDNs and transpile JSX in the browser via
@babel/standalone. Verify changes in the browser preview (`portfolio` entry
in `.claude/launch.json`, python http.server on :8765).

## Site map

- `/` — portfolio landing page (`index.html`), `resume.html`.
- Black Magic (RTS) content UNPUBLISHED 2026-10-08 at Matt's request
  ("for now", i.e. expected to return): the homepage project card and the
  whole `journal/` section were removed in one commit. To restore, revert
  that commit (`git log --diff-filter=D -- journal/` finds it). The
  skimecha/black-magic GitHub repo is separate and was not touched.
- `/bench/` — Calibration Bench PUBLIC DEMO (see two-instance warning below).
  React 18 + Recharts UMD + in-browser Babel. App state = one JSON blob under
  localStorage key `calbench:calbench-v1`, accessed via `window.storage`
  (bench/storage-adapter.js).
- `/flashcards/` — unlisted spaced-repetition flashcards app. File decks are
  JSON in `flashcards/decks/` (committed; Claude edits them on request).
  Also lists browser-stored "local decks" (ids `ld-*`, under
  `fc1:localdecks`) fed by the bench's Import library. Progress + local
  decks sync via `shared/kv-sync.js` when signed in (`app: "flashcards"`).
- `/ppl/` — unlisted PPL training tracker (Pilot Institute course order).
  Progress in localStorage, NOT yet synced.
- `/wx/` — unlisted Weather Report Drills (METAR/TAF/PIREP). Vanilla JS,
  no auth, no sync; quiz history only in localStorage `wx1:history`.
  See "Weather Report Drills" below.
- `/ground-school/` — Ground School hub (unlisted, noindex until P6).
  P0+P1 shipped 2026-10-21; see "Ground School hub" below and
  GROUND-SCHOOL-PLAN.md (the signed-off plan, source of truth for P2+).
- `/account/` — sign-in page (email/password + Google via Supabase).
- `/shared/auth.js` — site-wide auth module, exposes `window.mbAuth`.
- `/shared/kv-sync.js` — generic localStorage⇄kv_store sync engine
  (`window.mbKvSync.attach({ns, app})`), used by flashcards and by the
  bench's flashcard-routing importer. bench/storage-adapter.js predates it
  and carries its own copy of the same LWW logic for `calbench:`.

## Auth + cross-device sync (added 2026-08-05)

Supabase project `rwdiveoezdvcjvwikgnw` (org Skimecha, free tier).
- Email/password + Google sign-in. Public signups DISABLED — Matt's account
  only, created via dashboard. Multi-user-ready via RLS; opening signups
  later is a dashboard toggle.
- Table `kv_store (user_id, app, key, value, updated_at)`, RLS
  `auth.uid() = user_id`. App names: `calbench` (live), `flashcards` and
  `ppl` reserved for the pending ports.
- The publishable key in shared/auth.js is safe to commit. NEVER handle the
  secret key; the one Matt once pasted into chat was revoked.
- `bench/storage-adapter.js` v2: localStorage is always the read source;
  signed in, every key mirrors to kv_store with per-key last-write-wins
  (meta in `calbench:__sync`), dirty-flag retry, 5s boot timeout. Pre-sync
  local data loses to any existing remote copy.
- Google OAuth: Google Cloud project `mattbreckenridge-com`, External,
  testing mode, callback = `https://rwdiveoezdvcjvwikgnw.supabase.co/auth/v1/callback`.
- Phase 2 (NOT done): port flashcards + ppl onto the shared adapter.
- Keep-alive + PLANNED FIREBASE MIGRATION (status as of 2026-10-21):
  Supabase free tier pauses projects after ~7 days without API activity.
  HISTORY: warnings led to a Mon+Thu cron ping (Oct 15, verified 200),
  but the project was paused anyway by Oct 19, likely already queued
  from pre-ping warnings; Matt restored it Oct 21 (restore stays
  available until Nov 2027 per the pause screen, data safe throughout).
  NOW: `.github/workflows/supabase-keepalive.yml` pings the REST
  endpoint DAILY; a failed run emails Matt and is the paused-project
  alarm (it worked). Post-restore manual run verified 200 on Oct 21,
  which starts the observe window (through ~Nov 7). DIRECTION (Matt,
  2026-10-21): migrate to Firebase (Auth + Firestore) in the near
  future regardless; the observe window only sets urgency. If the
  project pauses again before migration, migrate immediately; either
  way don't re-litigate the backend choice. Matt suspects only real
  user activity counts for Supabase's pause criterion (unconfirmed;
  the daily ping is the test — he should NOT have to log in manually).
  A pause never breaks this site (localStorage is always the read
  source): restore from dashboard, run the workflow manually. Matt's
  separate Strength Tracker project (lockinstrength.com, no offline
  fallback, Matt is its only user) paused and was restored at the same
  time; its decisions belong to the LOCKIN_STRENGTH session.

## Calibration Bench instances (split being retired, 2026-08-05)

Matt decided to converge on THIS repo's build as his daily driver. The
public `/bench/` now has the full feature set: Supabase sync, plus the
importer ported from the private instance (`importBackup`, `importLibrary`
with `flashcards[]` routing into the flashcards app's local decks). Import
buttons appear in the bench footer only when signed in; visitors still get
the export-only DEMO framing (seed in `bench/demo-library.js`).

The old private instance — repo `skimecha/calibration-bench`, local copy
`C:\Users\mattb\OneDrive\Documents\Calibration-Bench`, deployed at
https://calibration-bench.matt-breckenridge.workers.dev behind Cloudflare
Access — is slated for retirement once Matt migrates his data (export
backup there → Import backup at mattbreckenridge.com/bench/). It has its
own dedicated Claude Code session and HANDOFF.md; never push to it from
here. Its `imports/` folder holds Matt's drill JSONs
(subjects[].items[].prompt/steps + flashcards[]), which the public
importer now accepts.

Matt's libraries derive from copyrighted training material (Gleim, PHAK):
never publish drill data or import files in this public repo.

Drill authoring pipeline (decided 2026-08-08): chapter PDFs become drill
JSONs via Claude Code sessions in the archive folder above (its
`.claude/skills/author-chapter/SKILL.md` codifies the importLibrary schema
and quality rules), not via any in-app PDF feature. Authored files land in
that folder's `imports/`; Matt imports them in the browser while signed in.
Authored items may carry `section`, `pages`, and `misconception` fields;
the importer ignores them today (reserved for Encode mode, see backlog).

## Encode mode (bench; shipped 2026-08-08 in 0524e57, live on /bench/)

Third tab next to Bench/Library: the first-pass read-recall-check loop run
while reading a chapter. Sections come from `section`/`pages`/`misconception`
fields on drill items (authored via the archive folder's author-chapter
skill). Flow: pick a section, read those pages in your own PDF viewer (no
in-app PDF rendering), then per item: free recall, reveal the key-ideas
checklist, self-check, misconception callout, re-read nudge on miss.
Results append to `skill.encodes[]` (ts/accuracy/missed/secs) and do NOT
touch attempts, the gauge, or the scheduler. storage-adapter v6 persists
the three fields on import and backfills them onto existing dedup-matched
items. Deferred, needs sign-off: encode results influencing drill order.

## Weather Report Drills (`/wx/`, added 2026-10-21)

Student-pilot drill app: read a raw METAR, TAF or PIREP in a segmented
LCD-style display (DSEG14 font from jsdelivr, OFL licensed, with an
"all segments lit then scramble" animation on every new report), reveal a
token-by-token plain-English breakdown, or run FAA-style multiple-choice
sets of 5/10/20 (70% pass line).

Files: `wx/index.html` (UI), `wx/decode.js` (parsers; `window.wxDecode`),
`wx/quiz.js` (question templates; `window.wxQuiz`),
`wx/data/reports.json` (the corpus).

Data pipeline: aviationweather.gov's data API blocks browser CORS (verified
2026-10-21), so the site cannot fetch reports live. Instead
`.github/scripts/refresh-wx.py` tiles the US into bounding boxes (the API
caps 400 rows per call), keeps US stations (K/PA/PH), scores reports for
teachable content, merges into a capped pool (600 METAR / 400 TAF / 400
PIREP) and writes `reports.json`. `.github/workflows/refresh-wx.yml` runs
it Sundays, commits if changed, then dispatches `deploy-pages.yml`
(pushes by GITHUB_TOKEN do not trigger the Pages workflow by themselves).
Run by hand with `py -3 .github/scripts/refresh-wx.py`. Military-format
TAFs (metric visibility, QNH..INS, TX/TN) are excluded from the corpus
because the FAA written tests the civilian format; the decoder still
understands those groups if one is pasted. `index.html` carries a tiny
built-in fallback set in case `reports.json` fails to load.

Alternatives considered and not chosen: a Cloudflare Worker CORS proxy
(new infra for a drill app that does not need real-time data) and a
hand-written sample set (loses the "real reports at random stations"
ask). Revisit the proxy only if Matt wants live, current-hour reports.

## Ground School hub (`/ground-school/`, P0+P1 shipped 2026-10-21)

Plan: GROUND-SCHOOL-PLAN.md (Matt signed off 2026-10-21). P0 = course
spine + hub shell, P1 = exam runner + FAA bank. Vanilla JS, hash routes
(`#/`, `#/ch/<id>`, `#/exam/<bank>`, `#/result/<bank>/<id>`).

Files: `index.html` (shell + CSS, the approved mock's look), `app.js`
(hub, chapter view, routing, progress readers), `exam.js` (runner +
score review, `window.gsExam`), `course-spine.json`,
`banks/faa-par.json`, `banks/figures/` (14 supplement figures as JPEG
plus the two inline images for Q48/Q49, ~4 MB).

- Spine: 33 chapters in Pilot Institute order (titles, order, stage,
  video counts only; no course content). Per chapter: `bench.subjects`
  (bench subject names from Matt's drill imports), `decks` (flashcard
  deck ids; `ld-*` are browser-local decks fed by the bench importer),
  `ppl` (section id + bit offset/count into the legacy /ppl/ tracker's
  194-bit string; MUST stay in sync with ppl/index.html SECTIONS),
  `onenote` (section name; `onenote.baseUrl` is null until Matt supplies
  the notebook URL, so the hub shows the name only), `tools` (wx live;
  radio-recall has no public URL yet, shown as "not published").
- Transition scaffolding (temporary, per plan): chapter progress = ppl
  checkbox bits; Learn/Drill launch `/bench/?gs=1&view=encode|bench&
  subject=…` (bench reads `view`, `subject`, `discipline`, `source`,
  `gs=1` from the URL at boot; Encode listing honors the session scope);
  Cards launch `/flashcards/#/study/<deckId>` (no flashcards change
  needed). Test = disabled until P2.
- Hub state under `gs:` via shared/kv-sync.js (`app: "groundschool"`,
  no Supabase schema change): `gs:exam-history` (last 100 results) and
  `gs:exam-inprogress-<bank>` (resume after exit; 150-minute countdown
  auto-submits).
- FAA bank: the FAA PAR sample set (dated 2021-08-10, public domain),
  61 questions verbatim including the backtick apostrophes in the PDF.
  THE FAA PUBLISHES NO ANSWER KEY: `answerKey.source = "derived"`; the
  key was worked from the figures and FAR/AIM/PHAK on 2026-10-21, every
  figure answer re-checked against the rendered figure. Q59 is flagged
  `contested` (61.3(l) also lists law enforcement; the long-standing
  key is A). Each question carries `acs` (FAA ACS code, used for the
  by-task breakdown) and `chapter` (spine id, used for "each miss links
  to its chapter"). Never edit question text; the authored bank
  (P2, `banks/authored/<chapter>.json`) is where editing happens.
- Figures: rendered from FAA-CT-8080-2H (176 MB, not in the repo) with
  PyMuPDF at 170 dpi, cropped to the page's content bbox (Appendix 2
  page "2-N" is PDF page 34+N). The source PDFs and render scripts
  lived in the session scratchpad; re-download from faa.gov to redo.
- Next: P2 (extend the author-chapter skill with `questions[]`, pilot
  2-3 chapters, chapter quizzes + first stage exam). Then P3+ per plan.

## Backlog (deferred ideas, not approved)

- **Calibration-aware interval growth** (bench scheduler,
  `nextInterval` in bench/calibration-bench.jsx). Carried over from the
  decommissioned private instance (skimecha/calibration-bench, archived
  2026-08-06); proposed there, never approved. Today the scheduler grows
  an item's review interval from recall accuracy, with an overconfidence
  penalty. The idea: also reward calibration itself. When a streak of
  attempts is both accurate AND well-calibrated (predicted recall matched
  actual), grow the interval faster than accuracy alone would. Rationale:
  reliably predicting what you know is evidence you need to see the item
  less often. This is a scheduler change, so before implementing, present
  trade-offs and a recommendation and get Matt's sign-off first (standing
  feedback below). Open questions for that discussion: what
  predicted-vs-actual gap counts as well-calibrated, required streak
  length, growth multiplier, and how it interacts with the existing
  overconfidence penalty.

## Working with Matt

- Consult BEFORE architectural/infra forks: present trade-offs + a
  recommendation, let him decide. Explicit standing feedback.
- Copy style: concise, no em dashes, no filler, no phone/address.
- Verify changes end-to-end in the browser preview and show proof; don't
  ask him to check manually. Commit/push only when he confirms.
- Cache-bust script includes (`?v=N`) whenever you edit them.
- Other local projects that may come up: `radio-recall-src` (Radio Recall,
  separate folder, has its own launch.json entry), the RTS game (Unity 6,
  dev journal on this site).
