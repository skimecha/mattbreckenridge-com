/* ────────────────────────────────────────────────────────────
   ground-school/app.js — the hub.

   Reads course-spine.json and, during the transition, the other
   apps' localStorage in place (read-only):
     ppl1:tracker-v2       legacy checkbox bits → chapter progress
     calbench:calbench-v1  bench library → drills due / encoded per subject
     fc1:localdecks, fc1:* flashcard decks → cards due per deck
   Hub-owned state lives under gs: (exam results; see exam.js) and
   syncs through shared/kv-sync.js when signed in (app "groundschool").

   Routes (hash): #/  hub · #/ch/<id>  chapter · #/exam/<bank>  runner
                  #/result/<bank>/<resultId>  score review
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var SYNC = window.mbKvSync ? window.mbKvSync.attach({ ns: "gs:", app: "groundschool" }) : null;
  window.gsExam.init(SYNC);
  var app = document.getElementById("app");
  var spine = null;
  var runner = null;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function chapter(id) { return spine.chapters.find(function (c) { return c.id === id; }); }
  function chapterTitle(id) { var c = chapter(id); return c ? c.title : id; }
  function chapterHref(id) { return "#/ch/" + id; }
  function lsJson(key) { try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; } }

  /* ── progress sources (read in place) ── */
  function pplBits() { var b = localStorage.getItem("ppl1:tracker-v2"); return b && /^[01]+$/.test(b) ? b : ""; }
  function pplPct(ch) {
    if (!ch.ppl) return null;
    var bits = pplBits(); if (bits.length < ch.ppl.offset + ch.ppl.items) return 0;
    var done = 0; for (var i = 0; i < ch.ppl.items; i++) if (bits[ch.ppl.offset + i] === "1") done++;
    return Math.round(100 * done / ch.ppl.items);
  }
  function benchSkills() { var d = lsJson("calbench:calbench-v1"); return d && Array.isArray(d.skills) ? d.skills : []; }
  function benchStats(ch) {
    var subs = (ch.bench && ch.bench.subjects) || [];
    var items = benchSkills().filter(function (s) { return subs.indexOf(s.subject || s.tag || "") >= 0; });
    var now = Date.now();
    var due = items.filter(function (s) { return !s.due || s.due <= now; }).length;
    var secs = {}, encodedSecs = {};
    items.forEach(function (s) {
      var sec = (s.section || "").trim(); if (!sec) return;
      secs[sec] = true; if ((s.encodes || []).length) encodedSecs[sec] = true;
    });
    var encodes = items.reduce(function (n, s) { return n + ((s.encodes || []).length ? 1 : 0); }, 0);
    var last = items.reduce(function (m, s) { var e = s.encodes || []; var l = e[e.length - 1]; return l && (!m || l.ts > m.ts) ? l : m; }, null);
    return { items: items.length, due: due, sections: Object.keys(secs).length, encodedSections: Object.keys(encodedSecs).length, encoded: encodes, lastEncode: last };
  }
  function endOfToday() { var d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); }
  function deckInfo(id) {
    var local = lsJson("fc1:localdecks") || {};
    var deck = local[id];
    var st = lsJson("fc1:" + id) || { cards: {}, sus: {} };
    var total = deck ? deck.cards.length : null;
    var eod = endOfToday(), due = 0, seen = 0;
    Object.keys(st.cards || {}).forEach(function (uid) { var cs = st.cards[uid]; seen++; if (cs && (cs.st === "l" || cs.due <= eod)) due++; });
    return { id: id, name: deck ? deck.name : null, exists: !!deck, total: total, due: due, seen: seen };
  }

  /* ── hub ── */
  function renderHub() {
    var contents = spine.chapters.filter(function (c) { return c.kind === "content" && c.ppl; });
    var pcts = contents.map(pplPct);
    var started = pcts.filter(function (p) { return p > 0; }).length;
    var bits = pplBits();
    var totalItems = contents.reduce(function (n, c) { return n + c.ppl.items; }, 0);
    var doneItems = contents.reduce(function (n, c) { var d = 0; for (var i = 0; i < c.ppl.items; i++) if (bits[c.ppl.offset + i] === "1") d++; return n + d; }, 0);
    var mastery = totalItems ? Math.round(100 * doneItems / totalItems) : 0;
    var now = Date.now();
    var drillsDue = benchSkills().filter(function (s) { return !s.due || s.due <= now; }).length;
    var faaBest = window.gsExam.best("faa-par");
    var user = window.mbAuth && window.mbAuth.user();

    var html = '<div class="eyebrow">FAA Private Pilot</div><h1>Ground School</h1>' +
      '<p class="sub">The whole course in one place. Learn, drill, review, and test each chapter, in course order.</p>' +
      '<div class="panel"><div class="row" style="margin-bottom:8px"><span class="label">Course mastery</span><span class="big">' + mastery + '%</span></div>' +
      '<div class="bar"><i class="' + (mastery === 100 ? "done" : "") + '" style="width:' + mastery + '%"></i></div>' +
      '<div class="stat-row">' +
      '<div class="stat"><b>' + started + '/' + contents.length + '</b><span>chapters started</span></div>' +
      '<div class="stat"><b>' + drillsDue + '</b><span>drills due</span></div>' +
      '<div class="stat"><b>—</b><span>last stage exam</span></div>' +
      '<div class="stat"><b>' + (faaBest ? faaBest.pct + '%' : '—') + '</b><span>FAA sample exam</span></div>' +
      '</div></div>';
    if (!user) html += '<p class="note" style="margin:-4px 0 10px">Chapter progress comes from the <a href="/ppl/">mastery tracker</a>, drills from the <a href="/bench/">bench</a>, cards from <a href="/flashcards/">flashcards</a>, all read from this browser. <a href="/account/?next=/ground-school/">Sign in</a> to sync exam results across devices.</p>';

    spine.stages.forEach(function (st) {
      var chs = spine.chapters.filter(function (c) { return c.stage === st.id; });
      if (!chs.length) return;
      html += '<div class="stage-label">' + esc(st.title) + '</div>';
      chs.forEach(function (c) {
        var num = String(c.order).padStart(2, "0");
        if (c.kind === "exam") {
          var live = !!c.bank, b = live ? window.gsExam.best(c.bank) : null, ip = live ? window.gsExam.inProgress(c.bank) : null;
          var right = !live ? '<span class="chip">Authored bank · P2</span>' :
            (b ? '<span class="pct ' + (b.pct >= 70 ? "done" : "fail") + '">' + b.pct + '%</span>' : '') +
            ' <a class="btn ghost small" href="#/exam/' + c.bank + '">' + (ip ? "Resume" : b ? "Retake" : "Start") + '</a>';
          // A div, not an <a>: the row holds its own Start/Resume link and anchors cannot nest.
          html += '<div class="chap exam-row' + (live ? " live" : "") + '" data-href="#/ch/' + c.id + '" role="link" tabindex="0">' +
            '<div class="num">' + (c.stage === "final" ? "F" : "S" + c.stage) + '</div>' +
            '<div><div class="title">' + esc(c.title) + (live ? ' · 61 questions, verbatim' : '') + '</div><div class="meta">' + (live ? "FAA bank · timed · figures" : "checkpoint") + '</div></div>' +
            '<div style="text-align:right">' + right + '</div></div>';
          return;
        }
        var pct = pplPct(c);
        var chips;
        if (c.kind === "tool") chips = '<span class="chip tool">Tool chapter</span>';
        else if (c.kind === "meta") chips = '<span class="chip">Orientation</span>';
        else {
          var bs = benchStats(c);
          chips = '<span class="chip ' + (bs.sections ? "on" : "") + '">Learn</span>' +
            '<span class="chip ' + (bs.items ? "on" : "") + '">Drill' + (bs.due ? " · " + bs.due : "") + '</span>' +
            '<span class="chip ' + ((c.decks || []).some(function (d) { return deckInfo(d).exists; }) ? "on" : "") + '">Cards</span>' +
            '<span class="chip">Test</span>' +
            (c.tools || []).map(function (t) { var tool = spine.tools[t]; return '<span class="chip tool">' + esc(tool.label) + (tool.url ? " &nearr;" : "") + '</span>'; }).join("");
        }
        html += '<a class="chap" href="#/ch/' + c.id + '">' +
          '<div class="num">' + num + '</div>' +
          '<div><div class="title">' + esc(c.title) + '</div><div class="meta">' + c.videos + ' videos</div></div>' +
          '<div class="pct ' + (pct === 100 ? "done" : "") + '">' + (pct == null ? "" : pct + "%") + '</div>' +
          '<div class="cbar bar"><i class="' + (pct === 100 ? "done" : "") + '" style="width:' + (pct || 0) + '%"></i></div>' +
          '<div class="chips">' + chips + '</div></a>';
      });
    });
    html += '<p class="note" style="margin-top:22px">Chapter order and video counts follow the Pilot Institute course. The FAA sample exam is the FAA\'s published PAR question set, verbatim, with figures from the Airman Knowledge Testing Supplement. Authored chapter quizzes and stage exams arrive in the next phase.</p>';
    app.innerHTML = html;
    app.querySelectorAll("[data-href]").forEach(function (row) {
      var go = function (e) { if (e.target.closest("a")) return; location.hash = row.dataset.href; };
      row.onclick = go;
      row.onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(e); } };
    });
  }

  /* ── chapter ── */
  function renderChapter(id) {
    var c = chapter(id);
    if (!c) { location.hash = "#/"; return; }
    var st = spine.stages.find(function (s) { return s.id === c.stage; });
    var onenote = spine.onenote.baseUrl
      ? '<a href="' + esc(spine.onenote.baseUrl.replace(/\/$/, "") + "/" + encodeURIComponent(c.onenote)) + '" target="_blank" rel="noopener">OneNote: ' + esc(c.onenote) + ' &nearr;</a>'
      : '<span title="OneNote section in ' + esc(spine.onenote.notebook + " › " + spine.onenote.group) + '">OneNote section: <code>' + esc(c.onenote) + '</code></span>';
    var html = '<a class="back" href="#/">&larr; All chapters</a>' +
      '<div class="eyebrow">' + esc(st ? st.title : "") + ' · Chapter ' + c.order + '</div><h1>' + esc(c.title) + '</h1>' +
      '<p class="sub">' + c.videos + ' video' + (c.videos === 1 ? "" : "s") + (c.blurb ? ' · ' + esc(c.blurb) : "") + '<br>' + onenote + '</p>';

    if (c.kind === "exam") {
      html += renderExamCard(c);
      app.innerHTML = html; return;
    }
    if (c.kind !== "content") {
      html += '<div class="panel note">' + (c.kind === "tool" ? "Tool chapter: watch the videos and practice with the device. Nothing to drill or test here; the written exam tests the underlying navigation and performance knowledge, which lives in the content chapters." : "Course orientation. Nothing to drill or test.") + '</div>';
      app.innerHTML = html; return;
    }

    var pct = pplPct(c);
    html += '<div class="panel" style="padding:12px 18px"><div class="row" style="margin-bottom:8px"><span class="label">Chapter mastery</span><span class="big" style="font-size:18px">' + (pct == null ? "—" : pct + "%") + '</span></div>' +
      '<div class="bar"><i class="' + (pct === 100 ? "done" : "") + '" style="width:' + (pct || 0) + '%"></i></div>' +
      '<p class="note" style="margin:8px 0 0">Topic checklist from the <a href="/ppl/">mastery tracker</a>' + (c.ppl ? ' (' + c.ppl.items + ' topics)' : '') + '. Deriving this from real activity is a later phase.</p></div>';

    var bs = benchStats(c);
    var subjects = (c.bench && c.bench.subjects) || [];
    var benchUrl = function (view, subj) { return "/bench/?gs=1&view=" + view + (subj ? "&subject=" + encodeURIComponent(subj) : ""); };
    html += '<div class="modes">';
    // Learn
    html += '<div class="mode"><h3>Learn</h3><p>' + (bs.sections
      ? 'Encode pass while reading. ' + bs.encodedSections + ' of ' + bs.sections + ' sections encoded' + (bs.lastEncode ? '; last ' + Math.round(bs.lastEncode.accuracy * 100) + '%.' : '.')
      : 'Encode pass while reading: read a section, explain each idea from memory, check immediately. Activates once this chapter\'s drill library is imported with section anchors.') +
      '</p><div class="acts">' + (subjects.length ? subjects.map(function (s) { return '<a class="btn ghost" href="' + esc(benchUrl("encode", s)) + '">' + (bs.sections ? "Continue encoding" : "Open Encode") + (subjects.length > 1 ? ' · ' + esc(s) : '') + '</a>'; }).join("") : '<span class="btn ghost disabled">No subject mapped</span>') + '</div></div>';
    // Drill
    html += '<div class="mode"><h3>Drill</h3><p>' + (bs.items
      ? 'Calibration drills scoped to this chapter. ' + bs.items + ' items, <b>' + bs.due + ' due now</b>.'
      : 'Calibration drills scoped to this chapter. No items yet under ' + esc(subjects.join(" / ") || "this chapter") + '; import the chapter library in the bench while signed in.') +
      '</p><div class="acts">' + (subjects.length ? subjects.map(function (s) { return '<a class="btn ghost" href="' + esc(benchUrl("bench", s)) + '">Drill' + (subjects.length > 1 ? ' · ' + esc(s) : ' all due') + '</a>'; }).join("") : '<span class="btn ghost disabled">No subject mapped</span>') + '</div></div>';
    // Cards
    var decks = (c.decks || []).map(deckInfo);
    var have = decks.filter(function (d) { return d.exists; });
    html += '<div class="mode"><h3>Cards</h3><p>' + (have.length
      ? have.map(function (d) { return esc(d.name) + ': ' + d.total + ' cards, <b>' + d.due + ' due</b>'; }).join('; ') + '.'
      : (decks.length ? 'Deck' + (decks.length > 1 ? 's' : '') + ' ' + decks.map(function (d) { return '<code>' + esc(d.id) + '</code>'; }).join(", ") + ' not in this browser yet (imported via the bench, signed in).' : 'No deck mapped to this chapter yet.')) +
      '</p><div class="acts">' + (have.length ? have.map(function (d) { return '<a class="btn ghost" href="/flashcards/#/study/' + encodeURIComponent(d.id) + '">Review' + (have.length > 1 ? ' · ' + esc(d.name) : ' cards') + '</a>'; }).join("") : '<a class="btn ghost" href="/flashcards/">Open flashcards</a>') + '</div></div>';
    // Test
    html += '<div class="mode"><h3>Test <span class="tag soon">Authored bank · next phase</span></h3><p>Chapter quiz from the authored question bank (original questions from PHAK and FAR/AIM). Not built yet; the stage exam row below lands with it. Until then, the FAA sample exam is the only bank.</p>' +
      '<div class="acts"><span class="btn disabled">Start quiz</span><a class="btn ghost" href="#/ch/final-exam">FAA sample exam</a></div></div>';
    html += '</div>';

    (c.tools || []).forEach(function (t) {
      var tool = spine.tools[t];
      html += '<div class="panel" style="margin-top:14px"><span class="label">Chapter tool</span><p class="note" style="margin:6px 0 10px"><b style="color:var(--text)">' + esc(tool.label) + '.</b> ' + esc(tool.blurb) + '</p>' +
        (tool.url ? '<a class="btn ghost" href="' + esc(tool.url) + '">Open ' + esc(tool.label) + ' &nearr;</a>' : '<span class="btn ghost disabled">Not published yet</span>') + '</div>';
    });
    app.innerHTML = html;
  }

  function renderExamCard(c) {
    if (!c.bank) {
      return '<div class="panel"><h3 style="margin:0 0 4px">Stage checkpoint <span class="tag soon">Authored bank · next phase</span></h3><p class="note">Stage exams draw on the authored question bank, which is the next build phase. Chapter quizzes and stage exams go live together.</p><span class="btn disabled">Start</span></div>';
    }
    var hs = window.gsExam.historyFor(c.bank), best = window.gsExam.best(c.bank), ip = window.gsExam.inProgress(c.bank);
    var html = '<div class="panel callout"><h3 style="margin:0 0 4px">FAA Sample Exam <span class="tag faa">FAA bank · verbatim</span></h3>' +
      '<p class="note">The FAA\'s published PAR sample set: 61 questions, 150 minutes, 70% to pass. Questions and figures are the FAA\'s own; the answer key is derived (the FAA publishes none), so treat a disputed item as a prompt to check the source.</p>' +
      '<div class="acts" style="display:flex;gap:8px;flex-wrap:wrap">' +
      (ip ? '<a class="btn" href="#/exam/' + c.bank + '">Resume · ' + Object.keys(ip.answers).length + ' answered</a><button class="btn danger" id="discard">Discard attempt</button>' : '<a class="btn" href="#/exam/' + c.bank + '">' + (hs.length ? "Retake" : "Start") + ' exam</a>') +
      '</div></div>';
    html += '<div class="panel"><span class="label">Attempts' + (best ? ' · best ' + best.pct + '%' : '') + '</span>';
    if (!hs.length) html += '<p class="note" style="margin:8px 0 0">No attempts yet.</p>';
    else {
      html += '<div class="hist" style="margin-top:10px">';
      hs.forEach(function (h) {
        html += '<span class="d">' + new Date(h.ts).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) + '</span>' +
          '<span class="s ' + (h.pct >= 70 ? "pass" : "fail") + '">' + h.score + '/' + h.total + ' · ' + h.pct + '%' + (h.timedOut ? ' · time expired' : '') + '</span>' +
          '<a class="btn small ghost" href="#/result/' + c.bank + '/' + h.id + '">Review</a>';
      });
      html += '</div>';
    }
    html += '</div>';
    setTimeout(function () {
      var d = document.getElementById("discard");
      if (d) d.onclick = function () { if (window.confirm("Discard the in-progress attempt? Its answers are lost.")) { window.gsExam.discard(c.bank); renderChapter(c.id); } };
    }, 0);
    return html;
  }

  /* ── exam + review ── */
  function examChapter(bankId) { return spine.chapters.find(function (c) { return c.bank === bankId; }); }
  function renderExam(bankId) {
    var ch = examChapter(bankId);
    app.innerHTML = '<div class="note" style="font-family:var(--mono);letter-spacing:.15em;text-transform:uppercase;font-size:12px;text-align:center;padding:60px 0">Loading bank…</div>';
    window.gsExam.loadBank(bankId).then(function (bank) {
      if (location.hash !== "#/exam/" + bankId) return; // navigated away while loading
      runner = new window.gsExam.Runner(bank, app, {
        onExit: function () { runner = null; location.hash = ch ? "#/ch/" + ch.id : "#/"; },
        onSubmit: function (result) { runner = null; location.hash = "#/result/" + bankId + "/" + result.id; },
      });
    }).catch(function (e) { app.innerHTML = '<a class="back" href="#/">&larr; Hub</a><div class="panel note">' + esc(e.message) + '</div>'; });
  }
  function renderResult(bankId, resultId) {
    var ch = examChapter(bankId);
    var result = window.gsExam.history().find(function (h) { return h.id === resultId; });
    if (!result) { location.hash = ch ? "#/ch/" + ch.id : "#/"; return; }
    window.gsExam.loadBank(bankId).then(function (bank) {
      window.gsExam.mountReview(app, bank, result, {
        backHref: ch ? "#/ch/" + ch.id : "#/", backLabel: "Back to " + (ch ? ch.title : "hub"),
        chapterTitle: chapterTitle, chapterHref: chapterHref,
      });
    });
  }

  /* ── routing ── */
  function route() {
    if (runner) { runner.save(); runner.destroy(); runner = null; }
    var parts = (location.hash || "#/").slice(2).split("/");
    if (parts[0] === "ch" && parts[1]) renderChapter(decodeURIComponent(parts[1]));
    else if (parts[0] === "exam" && parts[1]) return renderExam(parts[1]);
    else if (parts[0] === "result" && parts[1] && parts[2]) return renderResult(parts[1], parts[2]);
    else renderHub();
    window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", route);
  window.addEventListener("beforeunload", function () { if (runner) runner.save(); });

  function authNote() {
    var el = document.getElementById("sync-note");
    if (!window.mbAuth) return;
    window.mbAuth.onChange(function (session) {
      el.innerHTML = session ? "Synced · " + esc(session.user.email) : 'Progress is stored in this browser · <a href="/account/?next=/ground-school/">Sign in to sync</a>';
    });
  }

  fetch("course-spine.json?v=1").then(function (r) { return r.json(); }).then(function (s) {
    spine = s;
    authNote();
    // First paint waits for the cloud reconcile (bounded by kv-sync's timeout) so
    // another device's exam results are in before the hub renders.
    return SYNC ? SYNC.ready : null;
  }).then(route).catch(function (e) {
    app.innerHTML = '<div class="panel note">Could not load the course spine: ' + esc(e.message) + '</div>';
  });
})();
