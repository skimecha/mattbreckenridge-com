/* ────────────────────────────────────────────────────────────
   storage-adapter.js (v2 — cloud sync)
   Drop-in replacement for the Claude artifact `window.storage`
   API. localStorage is always the source for reads (fast,
   offline-safe); when signed in via /shared/auth.js, every key
   is mirrored to the Supabase `kv_store` table and reconciled
   on load with per-key last-write-wins.

   API shape (unchanged from v1 — CalibrationBench.jsx runs as-is):
     await window.storage.get(key)          → {key, value, shared} | throws if missing
     await window.storage.set(key, value)   → {key, value, shared}
     await window.storage.delete(key)       → {key, deleted, shared}
     await window.storage.list(prefix?)     → {keys, prefix, shared}

   Sync metadata lives in one localStorage key (calbench:__sync):
     { keys: { <key>: { t: <epoch ms of last local write>, dirty: bool } } }
   Reconcile rules per key:
     - remote only            → pull remote
     - local only             → push local
     - both, remote newer     → pull remote
     - both, local newer      → push local
     - local has no meta (pre-sync data) and remote exists → remote wins
   ──────────────────────────────────────────────────────────── */

(function () {
  var NS = "calbench:";      // localStorage namespace
  var APP = "calbench";      // `app` column in kv_store
  var META_KEY = NS + "__sync";
  var SYNC_TIMEOUT_MS = 5000; // never block first paint longer than this

  /* ── sync metadata ── */
  function loadMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) || { keys: {} }; }
    catch (e) { return { keys: {} }; }
  }
  function saveMeta(meta) { localStorage.setItem(META_KEY, JSON.stringify(meta)); }

  function isInternal(key) { return key.indexOf("__") === 0; }

  /* ── remote helpers (no-ops when signed out) ── */
  function db() { return window.mbAuth ? window.mbAuth.client : null; }
  function userId() {
    var u = window.mbAuth && window.mbAuth.user();
    return u ? u.id : null;
  }

  function pushKey(key, value, tMs) {
    var uid = userId();
    if (!uid) return Promise.resolve(false);
    return db()
      .from("kv_store")
      .upsert({
        user_id: uid,
        app: APP,
        key: key,
        value: value,
        updated_at: new Date(tMs).toISOString(),
      })
      .then(function (r) {
        if (r.error) { console.warn("calbench sync push failed:", r.error.message); return false; }
        var meta = loadMeta();
        meta.keys[key] = { t: tMs, dirty: false };
        saveMeta(meta);
        return true;
      })
      .catch(function (e) { console.warn("calbench sync push failed:", e); return false; });
  }

  function deleteRemote(key) {
    var uid = userId();
    if (!uid) return Promise.resolve(false);
    return db()
      .from("kv_store")
      .delete()
      .eq("user_id", uid).eq("app", APP).eq("key", key)
      .then(function (r) {
        if (r.error) console.warn("calbench sync delete failed:", r.error.message);
        return !r.error;
      })
      .catch(function () { return false; });
  }

  function flushDirty() {
    var meta = loadMeta();
    Object.keys(meta.keys).forEach(function (key) {
      var m = meta.keys[key];
      if (!m.dirty) return;
      var raw = localStorage.getItem(NS + key);
      if (raw !== null) pushKey(key, raw, m.t);
    });
  }

  /* ── initial reconcile ── */
  function reconcile(session) {
    if (!session) return Promise.resolve();
    return db()
      .from("kv_store")
      .select("key,value,updated_at")
      .eq("app", APP)
      .then(function (r) {
        if (r.error) { console.warn("calbench sync pull failed:", r.error.message); return; }
        var meta = loadMeta();
        var remoteByKey = {};
        (r.data || []).forEach(function (row) { remoteByKey[row.key] = row; });

        // remote → local
        Object.keys(remoteByKey).forEach(function (key) {
          var row = remoteByKey[key];
          var remoteT = new Date(row.updated_at).getTime();
          var local = localStorage.getItem(NS + key);
          var m = meta.keys[key];
          var pull =
            local === null ||  // nothing local
            !m ||              // pre-sync local data: remote wins
            remoteT > m.t;     // remote newer (incl. dirty conflict: last write wins)
          if (pull) {
            localStorage.setItem(NS + key, row.value);
            meta.keys[key] = { t: remoteT, dirty: false };
          }
        });
        saveMeta(meta);

        // local → remote (keys remote doesn't have, or dirty-and-newer)
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (!k || k.indexOf(NS) !== 0) continue;
          var key = k.slice(NS.length);
          if (isInternal(key)) continue;
          var row = remoteByKey[key];
          var m2 = meta.keys[key];
          var t = (m2 && m2.t) || Date.now();
          if (!row || (m2 && m2.dirty && t >= new Date(row.updated_at).getTime())) {
            pushKey(key, localStorage.getItem(k), t);
          }
        }
      })
      .catch(function (e) { console.warn("calbench sync pull failed:", e); });
  }

  var syncReady = Promise.resolve();
  if (window.mbAuth) {
    var timeout = new Promise(function (res) { setTimeout(res, SYNC_TIMEOUT_MS); });
    syncReady = Promise.race([window.mbAuth.ready.then(reconcile), timeout]);
    window.addEventListener("online", flushDirty);
  }

  /* ── public API (unchanged shape) ── */
  var storage = {
    async get(key, shared = false) {
      await syncReady;
      var raw = localStorage.getItem(NS + key);
      if (raw === null) throw new Error("Key not found: " + key);
      return { key: key, value: raw, shared: shared };
    },

    async set(key, value, shared = false) {
      await syncReady;
      localStorage.setItem(NS + key, value);
      var t = Date.now();
      var meta = loadMeta();
      meta.keys[key] = { t: t, dirty: true };
      saveMeta(meta);
      pushKey(key, value, t); // fire-and-forget; retried on 'online' / next load
      return { key: key, value: value, shared: shared };
    },

    async delete(key, shared = false) {
      await syncReady;
      localStorage.removeItem(NS + key);
      var meta = loadMeta();
      delete meta.keys[key];
      saveMeta(meta);
      deleteRemote(key);
      return { key: key, deleted: true, shared: shared };
    },

    async list(prefix = "", shared = false) {
      await syncReady;
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(NS + prefix) === 0) {
          var key = k.slice(NS.length);
          if (!isInternal(key)) keys.push(key);
        }
      }
      return { keys: keys, prefix: prefix, shared: shared };
    },
  };

  /* ── backup helpers (wired to the footer row in index.html) ── */
  function exportBackup() {
    var dump = {};
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(NS) === 0 && !isInternal(k.slice(NS.length))) {
        dump[k] = localStorage.getItem(k);
      }
    }
    var blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "calibration-bench-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ── importers (ported from the private instance, sync-aware) ──
     Signed-in only in the UI; every write goes through storage.set /
     the fc1 sync handle so imports replicate to all devices.
     The fc1: namespace belongs to the flashcards app — rote pairs in
     import documents are routed into its browser-stored decks. ── */
  var FC = "fc1:";
  var fcSync = window.mbKvSync
    ? window.mbKvSync.attach({ ns: FC, app: "flashcards" })
    : null;

  function slugify(s) {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "deck";
  }

  function importFlashcards(fcards, defaultDeckName) {
    var DECKS_KEY = FC + "localdecks";
    var decks = {};
    try { var raw = localStorage.getItem(DECKS_KEY); if (raw) decks = JSON.parse(raw) || {}; } catch (e) {}
    var norm = function (v) { return typeof v === "string" ? v.trim() : ""; };
    var added = 0, duplicates = 0, invalid = 0;
    var touched = [];
    fcards.forEach(function (c) {
      var front = norm(c && c.front), back = norm(c && c.back);
      if (!front || !back) { invalid++; return; }
      var deckName = norm(c.deck) || defaultDeckName;
      var id = "ld-" + slugify(deckName);
      if (!decks[id]) {
        decks[id] = {
          id: id, name: deckName,
          description: "Imported deck. Cards arrive here through the bench's Import library.",
          front_label: "Prompt", back_label: "Answer", cards: [],
        };
      }
      var deck = decks[id];
      var pairKey = (front + "|" + back).toLowerCase();
      if (deck.cards.some(function (k) { return (k.front + "|" + k.back).toLowerCase() === pairKey; })) { duplicates++; return; }
      var cid = slugify(front), n = 2;
      while (deck.cards.some(function (k) { return k.id === cid; })) cid = slugify(front) + "-" + n++;
      deck.cards.push({ id: cid, front: front, back: back });
      if (touched.indexOf(deckName) < 0) touched.push(deckName);
      added++;
    });
    localStorage.setItem(DECKS_KEY, JSON.stringify(decks));
    if (fcSync) fcSync.pushKey("localdecks");
    return { added: added, duplicates: duplicates, invalid: invalid, decks: touched };
  }

  async function importLibrary(json) {
    var doc = typeof json === "string" ? JSON.parse(json) : json;

    // Flatten to a single item list, tagging each with its enclosing subject (shape C).
    var items;
    if (Array.isArray(doc)) {
      items = doc;
    } else if (Array.isArray(doc.items)) {
      items = doc.items;
    } else if (Array.isArray(doc.subjects)) {
      items = [];
      doc.subjects.forEach(function (g) {
        var groupSubject = (g && typeof g.name === "string") ? g.name : "";
        var groupSource = (g && typeof g.source === "string") ? g.source : "";
        (Array.isArray(g.items) ? g.items : []).forEach(function (it) {
          items.push(Object.assign({ _groupSubject: groupSubject, _groupSource: groupSource }, it));
        });
      });
    }
    if (!Array.isArray(items)) items = [];
    var fcards = [];
    if (Array.isArray(doc.flashcards)) {
      fcards = doc.flashcards;
    } else if (doc.flashcards && Array.isArray(doc.flashcards.cards)) {
      var dn = typeof doc.flashcards.deck === "string" ? doc.flashcards.deck : "";
      fcards = doc.flashcards.cards.map(function (c) { return Object.assign({ deck: dn }, c); });
    }
    if (items.length === 0 && fcards.length === 0) {
      throw new Error("Nothing to import — expected items[], subjects[].items, or flashcards[]");
    }
    var defaults = {
      discipline: (doc.discipline || "").trim(),
      subject: (doc.subject || "").trim(),
      source: (typeof doc.source === "string" ? doc.source : "").trim(),
    };

    var data = { skills: [] };
    try {
      var raw = localStorage.getItem(NS + "calbench-v1");
      if (raw) data = JSON.parse(raw);
    } catch (e) {}
    data.skills = data.skills || [];

    var VALID = ["fact", "concept", "procedure"];
    var norm = function (v) { return typeof v === "string" ? v.trim() : ""; };
    var keyOf = function (d, s, n) { return [d, s, n].join("|").toLowerCase(); };
    var byKey = new Map(data.skills.map(function (s) {
      return [keyOf(norm(s.discipline), norm(s.subject || s.tag), norm(s.name)), s];
    }));
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    var uid = function () { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36); };

    var added = 0, duplicates = 0, updated = 0, invalid = 0;
    items.forEach(function (it) {
      var type = VALID.indexOf(it.type) >= 0 ? it.type : null;
      var name = norm(it.name) || norm(it.prompt);
      var steps = Array.isArray(it.steps) ? it.steps.map(norm).filter(Boolean) : [];
      var stepsOk = type === "fact" ? steps.length === 1 : type === "procedure" ? steps.length >= 2 : steps.length >= 1;
      if (!type || !name || !stepsOk) { invalid++; return; }
      var discipline = norm(it.discipline) || defaults.discipline;
      var subject = norm(it.subject) || norm(it._groupSubject) || defaults.subject;
      var source = norm(it.source) || norm(it._groupSource) || defaults.source;
      var k = keyOf(discipline, subject, name);
      var existing = byKey.get(k);
      if (existing) {
        duplicates++;
        if (source && !norm(existing.source)) { existing.source = source; updated++; }
        return;
      }
      var skill = {
        id: uid(), type: type, name: name, cue: norm(it.cue),
        discipline: discipline, subject: subject, tag: subject, source: source,
        steps: steps, created: Date.now(), intervalDays: 1, due: midnight.getTime(), attempts: [],
      };
      byKey.set(k, skill);
      data.skills.push(skill);
      added++;
    });

    await storage.set("calbench-v1", JSON.stringify(data));
    var cards = fcards.length
      ? importFlashcards(fcards, (defaults.discipline || "General") + " rote pairs")
      : null;
    return { added: added, duplicates: duplicates, updated: updated, invalid: invalid, total: items.length, cards: cards };
  }

  /* Full-state restore from a private-instance or public backup file.
     opts.bench / opts.cards select which sections to apply. */
  async function importBackup(json, opts) {
    var dump = typeof json === "string" ? JSON.parse(json) : json;
    opts = opts || { bench: true, cards: true };
    var benchKeys = 0, cardKeys = 0;
    for (var k in dump) {
      if (!Object.prototype.hasOwnProperty.call(dump, k)) continue;
      var v = dump[k];
      var value = typeof v === "string" ? v : JSON.stringify(v);
      if (opts.bench && k.indexOf(NS) === 0 && !isInternal(k.slice(NS.length))) {
        await storage.set(k.slice(NS.length), value);
        benchKeys++;
      } else if (opts.cards && k.indexOf(FC) === 0 && k.slice(FC.length).indexOf("__") !== 0) {
        localStorage.setItem(k, value);
        if (fcSync) fcSync.pushKey(k.slice(FC.length));
        cardKeys++;
      }
    }
    return { benchKeys: benchKeys, cardKeys: cardKeys };
  }

  window.storage = storage;
  window.exportBackup = exportBackup;
  window.importBackup = importBackup;
  window.importLibrary = importLibrary;
})();
