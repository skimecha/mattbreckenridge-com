# Ground School Hub: consolidation plan (draft for Matt's review, 2026-10-21)

Decisions already made (Matt, 2026-10-21): consolidate into ONE app as the
end state; audience is personal + portfolio demo (the bench pattern); two
question banks, FAA sample and authored, kept strictly separate.

## 1. The spine

One committed data file, `ground-school/course-spine.json`, derived from the
Pilot Institute course inventory in `C:\Users\mattb\Downloads\build-ppl-onenote.ps1`
(33 chapters, 604 videos, course order, stage boundaries). Per chapter:

- `id`, `title`, `order`, `stage` (1-7, or `final`)
- `kind`: `content` (~20 chapters), `tool` (E6B, CX-3, Sporty's, ForeFlight),
  `meta` (the two Introduction chapters), `exam` (stage practice exams)
- mappings: bench `subject` name(s), flashcard deck ids, OneNote section
  name, and per-chapter tool links (`/wx/` on Weather Services,
  radio-recall on Radio Communications)

Every experience reads this one file. No app carries its own copy of the
course structure again.

## 2. Information architecture

New app at `/ground-school/` (working name; naming open). Same no-build
stack as the bench. One screen hierarchy:

- **Hub**: chapters in course order, grouped by stage. Per chapter: progress
  at a glance and the modes available. Stage rows end in a checkpoint exam.
- **Chapter view**: Learn / Drill / Cards / Test for that chapter, plus its
  OneNote section link and chapter tools.
  - **Learn** = Encode mode scoped to the chapter (Encode shipped to
    /bench/ 2026-08-08; the only open Encode question is whether encode
    results should influence drill order, and the hub does not need that
    answered).
  - **Drill** = bench drill loop scoped to the chapter's subject.
  - **Cards** = flashcards filtered to the chapter's decks.
  - **Test** = quizzes from the authored bank; stage/final exams.
- **Exam runner** (new build): timed, scored, review-afterward mode,
  supports figure images. Runs three things: per-chapter quizzes (authored
  bank), stage checkpoint exams (authored), and the FAA sample exam (FAA
  bank, verbatim).

## 3. Question banks (strictly separate, per Matt)

- `ground-school/banks/faa-par.json`: the FAA's published PAR sample set,
  verbatim, IMMUTABLE by convention. Measured 2026-10-21 from
  par_questions.pdf (dated 2021-08-10): **61 questions**, numbered 1-61.
  Public domain. Many reference figures from the FAA Airman Knowledge
  Testing Supplement (FAA-CT-8080-2H, also public domain); those figure
  images are a build task of their own. This bank is one exam's worth:
  it is the authenticity benchmark, not the practice pool.
- `ground-school/banks/authored/<chapter-id>.json`: original questions
  authored from PHAK / FAR-AIM / AFH via an extension of the existing
  author-chapter skill (new `questions[]` output alongside drills).
  Editable, grows over time, chapter-mapped by construction. Target size:
  30-60 per content chapter -> **600-1,200 total**, which is commercial
  test-prep scale (ASA/Gleim class banks run ~700-1,000). Authored files
  are original work and safe to publish; they cite public-domain sources.
- The exam runner never mixes banks in one session, and the UI labels the
  source of every question.

## 4. Storage and sync

- All apps already share the origin, so consolidation is mostly UI
  consolidation: the hub can read `calbench:` (attempts, encodes), `fc1:`
  (decks), and ppl progress directly during the transition.
- New hub state (exam results, quiz history, per-chapter progress
  overrides) lives under a new `gs:` namespace via `shared/kv-sync.js`
  (`app: "groundschool"`), so it syncs when signed in and swaps backends
  with the planned Firebase migration for free. No new Supabase surface
  beyond one more `app` value.
- End state: one store under `gs:`, with a one-time import of legacy
  namespaces when each app is absorbed. Until then, read-in-place.

## 5. Sequencing (consolidation that never goes dark)

- **P0 Spine + hub shell**: course-spine.json; `/ground-school/` hub
  listing stages/chapters; links launch existing apps scoped via URL
  params (transitional scaffolding, explicitly temporary). Small changes
  to bench/flashcards to accept scope params.
- **P1 Exam runner + FAA bank**: the genuinely new build. FAA sample exam
  end-to-end, including figures. This is the highest-value new capability
  and proves the runner before bank-authoring scales.
- **P2 Authored banks**: extend author-chapter skill; author 2-3 chapters
  as the pilot batch; per-chapter quizzes + first stage exam live.
- **P3 Absorb Drill + Encode** into the hub as views (prereq: Encode
  sign-off). Bench remains available at /bench/ as the public demo.
- **P4 Absorb Cards.**
- **P5 Retire /ppl**: hub derives chapter progress from real activity
  (encodes, attempts, card reviews, quiz scores) with manual override;
  one-time import of ppl checkbox state.
- **P6 Demo framing + portfolio launch**: seeded demo content, visitor
  copy, homepage card. Signed-in Matt gets the real thing, visitors get
  the demo (bench pattern: gated features appear when authed).
- `/wx/` and radio-recall stay linked chapter tools for now; absorb or
  keep-linked is a per-tool decision deferred until P3+.

## 6. Open items needing Matt

1. Sign off this plan shape, or redline it.
2. (RESOLVED 2026-10-21: Encode shipped in August; CLAUDE.md's
   "uncommitted" note was stale. P3 is unblocked. The optional question
   of encode results influencing drill order stays in the backlog.)
3. Naming: `/ground-school/` vs something brandable.
4. Priority call: start with P0+P1 together, or P0 alone first?
5. OneNote linking depth: section links are easy; per-video page links
   mean storing 604 page ids. Recommend section links only.

## 7. Guardrails

- Never publish Pilot Institute content (video scripts, quizbank), Gleim
  material, or Matt's personal drill data in this public repo. The course
  spine (chapter/video TITLES in course order) is factual metadata and
  fine; full video titles stay out of the public JSON anyway since only
  chapters matter to the hub.
- FAA bank stays verbatim and immutable; authored bank is where editing
  happens. Never cross-pollinate.
- Each phase ships verified in preview and leaves every existing tool
  working.
