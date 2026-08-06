/* ────────────────────────────────────────────────────────────
   shared/auth.js
   Site-wide Supabase auth. Classic script; load AFTER the
   Supabase UMD bundle:

     <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
     <script src="/shared/auth.js"></script>

   Exposes window.mbAuth:
     .client            supabase-js client (auth + database)
     .ready             Promise<Session|null> — resolves once the
                        stored session (if any) has been restored
     .session()         current session or null (sync, post-ready)
     .user()            current user or null
     .onChange(cb)      cb(session|null) on every auth change,
                        called once immediately after ready
     .signOut()         sign out + notify listeners

   The publishable key is safe to ship publicly — all data access
   is enforced by row-level security on the server.
   ──────────────────────────────────────────────────────────── */

(function () {
  var SUPABASE_URL = "https://rwdiveoezdvcjvwikgnw.supabase.co";
  var SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b5bXz9e4W2WnjpK-Yjm3pA_x0BBhzvI";

  if (!window.supabase || !window.supabase.createClient) {
    console.error("mbAuth: Supabase UMD bundle not loaded before shared/auth.js");
    window.mbAuth = null;
    return;
  }

  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  var current = null;
  var listeners = [];

  var ready = client.auth
    .getSession()
    .then(function (r) {
      current = (r.data && r.data.session) || null;
      return current;
    })
    .catch(function () {
      current = null;
      return null;
    });

  client.auth.onAuthStateChange(function (_event, session) {
    current = session || null;
    listeners.forEach(function (cb) {
      try { cb(current); } catch (e) { console.error("mbAuth listener:", e); }
    });
  });

  window.mbAuth = {
    client: client,
    ready: ready,
    session: function () { return current; },
    user: function () { return current ? current.user : null; },
    onChange: function (cb) {
      listeners.push(cb);
      ready.then(function () { cb(current); });
    },
    signOut: function () { return client.auth.signOut(); },
  };
})();
