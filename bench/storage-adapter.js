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

  /* Demo build: the import functions (importBackup, importLibrary) live only
     in the private personal instance. The public demo is seeded from
     demo-library.js and exposes export only. */
  window.storage = storage;
  window.exportBackup = exportBackup;
})();
