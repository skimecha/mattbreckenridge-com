# Flashcards

Personal spaced-repetition flashcards at `/flashcards` (unlisted: `noindex`, not linked from the homepage).

## How it works

- `index.html` — self-contained app. SM-2 style scheduler (Again/Hard/Good/Easy), learning steps 1m/10m, per-deck daily new-card limit (default 20). New cards are drawn from across the whole deck in shuffled order by default (per-deck "In order" setting available). Progress lives in browser `localStorage` (`fc1:<deckId>` keys); export/import buttons on the home screen.
- Per-deck **Directions** setting: front → back (default) or both directions. In both mode every card also schedules a reverse sibling under the key `<cardId>~r`, tracked independently of the forward direction — so deck totals and daily load roughly double. Switching back to forward-only just hides the reverse siblings; their progress is kept and returns if you re-enable it. Suspending in Browse suspends both directions. The scheduler avoids showing a card's two directions within three answers of each other.
- `decks/manifest.json` — lists available decks: `{id, file, name, count}`.
- `decks/*.json` — one file per deck.

## Deck file format

```json
{
  "id": "unique-deck-id",
  "name": "Display Name",
  "description": "Shown on the deck list.",
  "front_label": "Abbreviation",
  "back_label": "Meaning",
  "cards": [
    { "id": "stable-slug", "front": "AGL", "back": "Above Ground Level" }
  ]
}
```

Rules for updating decks (for Claude or anyone else):

- `front_label` / `back_label` name the two sides in the Directions setting and on reversed cards (defaults: Front / Back).
- Card `id`s must be unique within a deck and **stable** — progress is keyed on them. Editing `front`/`back` keeps progress; changing `id` resets that card.
- To add a deck: create the JSON file, add an entry to `manifest.json`.
- Removing a card from the JSON simply drops it; leftover progress entries are harmless.

## Current decks

- `faa-abbr-ppl` — curated PPL-relevant FAA abbreviations (source: FAA abbreviations glossary, `Airport-Codes.xlsx` from the Pilot Institute course materials). Where the glossary listed several meanings, the pilot-relevant one was kept.
- `faa-abbr-full` — the full glossary (1,747 merged entries).

Known gaps in the source glossary: TRSA, UNICOM, PIC (pilot-in-command sense) are absent; add manually if wanted.
