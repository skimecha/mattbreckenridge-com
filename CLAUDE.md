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

- `/` — portfolio landing page (`index.html`), `resume.html`, `journal/`
  (RTS game dev journal).
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
