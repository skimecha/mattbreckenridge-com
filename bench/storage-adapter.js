/* ────────────────────────────────────────────────────────────
   storage-adapter.js
   Drop-in replacement for the Claude artifact `window.storage`
   API, backed by localStorage. Import this ONCE, before the
   app mounts (top of main.jsx), and CalibrationBench.jsx runs
   unmodified.

   API shape matched exactly:
     await window.storage.get(key)          → {key, value, shared} | throws if missing
     await window.storage.set(key, value)   → {key, value, shared}
     await window.storage.delete(key)       → {key, deleted, shared}
     await window.storage.list(prefix?)     → {keys, prefix, shared}

   The `shared` flag is accepted but ignored — localStorage is
   per-browser by definition. When you later want cross-device
   sync, replace ONLY this file with a Supabase/Worker-backed
   version; the component never changes.
   ──────────────────────────────────────────────────────────── */

const NS = "calbench:"; // namespace so we never collide with anything else on the site

const storage = {
  async get(key, shared = false) {
    const raw = localStorage.getItem(NS + key);
    if (raw === null) throw new Error(`Key not found: ${key}`);
    return { key, value: raw, shared };
  },

  async set(key, value, shared = false) {
    localStorage.setItem(NS + key, value);
    return { key, value, shared };
  },

  async delete(key, shared = false) {
    localStorage.removeItem(NS + key);
    return { key, deleted: true, shared };
  },

  async list(prefix = "", shared = false) {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS + prefix)) keys.push(k.slice(NS.length));
    }
    return { keys, prefix, shared };
  },
};

/* ── backup helpers (wired to the footer row in index.html) ── */
function exportBackup() {
  const dump = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(NS)) dump[k] = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `calibration-bench-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function importBackup(json) {
  const dump = typeof json === "string" ? JSON.parse(json) : json;
  Object.entries(dump).forEach(([k, v]) => {
    if (k.startsWith(NS)) localStorage.setItem(k, v);
  });
}

/* ── additive library import ─────────────────────────────────
   Accepts a "calibration-bench-library" JSON document (or a bare
   array of items) and MERGES the items into the existing library.
   Nothing is overwritten: existing items and their drill history
   are untouched, and duplicates (same discipline+subject+name)
   are skipped. Each imported item is scheduled as new (due today).

   Accepted document shapes (all merge additively):
     A) { "discipline": "Aviation", "subject": "FAA Regulations",
          "items": [ { "type": "fact"|"concept"|"procedure",
                       "name": "...", "cue": "...", "steps": ["..."] } ] }
     B) a bare array of those item objects
     C) { "discipline": "Aviation",
          "subjects": [ { "name": "FAA Regulations",
                          "items": [ { "type": "...", "prompt": "...", "steps": [...] } ] } ] }
   In every shape: `prompt` is accepted as an alias for `name`, an item's own
   `subject` wins over its enclosing group name, and both fall back to the
   top-level `subject`/`discipline` defaults.
   ──────────────────────────────────────────────────────────── */
function importLibrary(json) {
  const doc = typeof json === "string" ? JSON.parse(json) : json;

  // Flatten to a single item list, tagging each with its enclosing subject (shape C).
  let items;
  if (Array.isArray(doc)) {
    items = doc;
  } else if (Array.isArray(doc.items)) {
    items = doc.items;
  } else if (Array.isArray(doc.subjects)) {
    items = [];
    doc.subjects.forEach((g) => {
      const groupSubject = (g && typeof g.name === "string") ? g.name : "";
      (Array.isArray(g.items) ? g.items : []).forEach((it) => {
        items.push(Object.assign({ _groupSubject: groupSubject }, it));
      });
    });
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("No items found — expected an items array or subjects[].items");
  }
  const defaults = { discipline: (doc.discipline || "").trim(), subject: (doc.subject || "").trim() };

  const KEY = NS + "calbench-v1";
  let data = { skills: [] };
  try { const raw = localStorage.getItem(KEY); if (raw) data = JSON.parse(raw); } catch (e) {}
  data.skills = data.skills || [];

  const VALID = ["fact", "concept", "procedure"];
  const norm = (v) => (typeof v === "string" ? v.trim() : "");
  const keyOf = (d, s, n) => [d, s, n].join("|").toLowerCase();
  const seen = new Set(data.skills.map((s) => keyOf(norm(s.discipline), norm(s.subject || s.tag), norm(s.name))));
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);

  let added = 0, duplicates = 0, invalid = 0;
  items.forEach((it) => {
    const type = VALID.includes(it.type) ? it.type : null;
    const name = norm(it.name) || norm(it.prompt);
    const steps = Array.isArray(it.steps) ? it.steps.map(norm).filter(Boolean) : [];
    const stepsOk = type === "fact" ? steps.length === 1 : type === "procedure" ? steps.length >= 2 : steps.length >= 1;
    if (!type || !name || !stepsOk) { invalid++; return; }
    const discipline = norm(it.discipline) || defaults.discipline;
    const subject = norm(it.subject) || norm(it._groupSubject) || defaults.subject;
    const k = keyOf(discipline, subject, name);
    if (seen.has(k)) { duplicates++; return; }
    seen.add(k);
    data.skills.push({
      id: uid(), type, name, cue: norm(it.cue), discipline, subject, tag: subject,
      steps, created: Date.now(), intervalDays: 1, due: midnight.getTime(), attempts: [],
    });
    added++;
  });

  localStorage.setItem(KEY, JSON.stringify(data));
  return { added, duplicates, invalid, total: items.length };
}

window.storage = storage;
window.exportBackup = exportBackup;
window.importBackup = importBackup;
window.importLibrary = importLibrary;
