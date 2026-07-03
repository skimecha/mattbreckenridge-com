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

/* Demo build: the import functions (importBackup, importLibrary) live only
   in the private personal instance. The public demo is seeded from
   demo-library.js and exposes export only. */
window.storage = storage;
window.exportBackup = exportBackup;
