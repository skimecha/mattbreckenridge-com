/* ────────────────────────────────────────────────────────────
   shared/kv-sync.js
   Generic localStorage ⇄ Supabase kv_store sync. Load after
   /shared/auth.js. Each page attaches one handle per namespace:

     const sync = window.mbKvSync.attach({ ns: "fc1:", app: "flashcards" });
     await sync.ready;          // reconciled (or timed out / signed out)
     sync.pushKey("deck-id");   // after writing localStorage[ns + key]
     sync.deleteKey("deck-id"); // after removing localStorage[ns + key]

   Reconcile on attach, per key, last-write-wins by timestamp:
     remote only                  → pull remote
     local only                   → push local
     both                         → newer timestamp wins
     local without meta + remote  → remote wins (pre-sync local data)
   Meta lives in localStorage[ns + "__sync"]:
     { keys: { <key>: { t: epoch_ms, dirty: bool } } }
   Keys beginning with "__" are internal and never synced.
   Signed out, every method is a no-op and ready resolves at once.
   (bench/storage-adapter.js predates this module and carries its
   own copy of the same logic for the calbench namespace.)
   ──────────────────────────────────────────────────────────── */

(function () {
  function attach(cfg) {
    var NS = cfg.ns;
    var APP = cfg.app;
    var TIMEOUT = cfg.timeoutMs || 5000;
    var META_KEY = NS + "__sync";

    function loadMeta() {
      try { return JSON.parse(localStorage.getItem(META_KEY)) || { keys: {} }; }
      catch (e) { return { keys: {} }; }
    }
    function saveMeta(meta) { localStorage.setItem(META_KEY, JSON.stringify(meta)); }
    function isInternal(key) { return key.indexOf("__") === 0; }
    function db() { return window.mbAuth ? window.mbAuth.client : null; }
    function userId() {
      var u = window.mbAuth && window.mbAuth.user();
      return u ? u.id : null;
    }

    function pushKey(key, tMs) {
      var uid = userId();
      if (!uid || isInternal(key)) return Promise.resolve(false);
      var value = localStorage.getItem(NS + key);
      if (value === null) return Promise.resolve(false);
      var t = tMs || Date.now();
      var meta = loadMeta();
      meta.keys[key] = { t: t, dirty: true };
      saveMeta(meta);
      return db()
        .from("kv_store")
        .upsert({ user_id: uid, app: APP, key: key, value: value, updated_at: new Date(t).toISOString() })
        .then(function (r) {
          if (r.error) { console.warn(APP + " sync push failed:", r.error.message); return false; }
          var m = loadMeta();
          m.keys[key] = { t: t, dirty: false };
          saveMeta(m);
          return true;
        })
        .catch(function (e) { console.warn(APP + " sync push failed:", e); return false; });
    }

    function deleteKey(key) {
      var meta = loadMeta();
      delete meta.keys[key];
      saveMeta(meta);
      var uid = userId();
      if (!uid || isInternal(key)) return Promise.resolve(false);
      return db()
        .from("kv_store")
        .delete()
        .eq("user_id", uid).eq("app", APP).eq("key", key)
        .then(function (r) {
          if (r.error) console.warn(APP + " sync delete failed:", r.error.message);
          return !r.error;
        })
        .catch(function () { return false; });
    }

    function flushDirty() {
      var meta = loadMeta();
      Object.keys(meta.keys).forEach(function (key) {
        var m = meta.keys[key];
        if (m.dirty && localStorage.getItem(NS + key) !== null) pushKey(key, m.t);
      });
    }

    function reconcile(session) {
      if (!session) return Promise.resolve();
      return db()
        .from("kv_store")
        .select("key,value,updated_at")
        .eq("app", APP)
        .then(function (r) {
          if (r.error) { console.warn(APP + " sync pull failed:", r.error.message); return; }
          var meta = loadMeta();
          var remote = {};
          (r.data || []).forEach(function (row) { remote[row.key] = row; });

          Object.keys(remote).forEach(function (key) {
            var row = remote[key];
            var remoteT = new Date(row.updated_at).getTime();
            var local = localStorage.getItem(NS + key);
            var m = meta.keys[key];
            if (local === null || !m || remoteT > m.t) {
              localStorage.setItem(NS + key, row.value);
              meta.keys[key] = { t: remoteT, dirty: false };
            }
          });
          saveMeta(meta);

          for (var i = 0; i < localStorage.length; i++) {
            var k = localStorage.key(i);
            if (!k || k.indexOf(NS) !== 0) continue;
            var key = k.slice(NS.length);
            if (isInternal(key)) continue;
            var m2 = meta.keys[key];
            var row2 = remote[key];
            var t = (m2 && m2.t) || Date.now();
            if (!row2 || (m2 && m2.dirty && t >= new Date(row2.updated_at).getTime())) {
              pushKey(key, t);
            }
          }
        })
        .catch(function (e) { console.warn(APP + " sync pull failed:", e); });
    }

    var ready = Promise.resolve();
    if (window.mbAuth) {
      var timeout = new Promise(function (res) { setTimeout(res, TIMEOUT); });
      ready = Promise.race([window.mbAuth.ready.then(reconcile), timeout]);
      window.addEventListener("online", flushDirty);
    }

    return { ready: ready, pushKey: pushKey, deleteKey: deleteKey, flushDirty: flushDirty };
  }

  window.mbKvSync = { attach: attach };
})();
