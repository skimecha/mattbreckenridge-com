/* ────────────────────────────────────────────────────────────
   ground-school/exam.js — exam runner (window.gsExam)

   Runs one bank (banks/<id>.json) as a timed, scored, review-
   afterward exam. State under the gs: namespace, synced via
   shared/kv-sync.js when signed in (app "groundschool"):
     gs:exam-history            [{id, bank, ts, secs, score, total, pct, answers, flagged}]
     gs:exam-inprogress-<bank>  {startedAt, elapsed, idx, answers, flagged}

   Banks are never mixed in one session; the runner labels the
   bank's source on every screen. Figures are page images from
   the FAA testing supplement (banks/figures/).
   ──────────────────────────────────────────────────────────── */
(function () {
  "use strict";
  var NS = "gs:";
  var HISTORY_KEY = "exam-history";
  var MAX_HISTORY = 100;
  var sync = null; // set by init()
  var banks = {};  // id → loaded bank

  function init(syncHandle) { sync = syncHandle; }
  function lsGet(key) { try { return JSON.parse(localStorage.getItem(NS + key)); } catch (e) { return null; } }
  function lsSet(key, val) { localStorage.setItem(NS + key, JSON.stringify(val)); if (sync) sync.pushKey(key); }
  function lsDel(key) { localStorage.removeItem(NS + key); if (sync) sync.deleteKey(key); }

  function loadBank(id) {
    if (banks[id]) return Promise.resolve(banks[id]);
    return fetch("banks/" + id + ".json?v=1").then(function (r) {
      if (!r.ok) throw new Error("bank " + id + " failed to load (" + r.status + ")");
      return r.json();
    }).then(function (b) { banks[id] = b; return b; });
  }
  function history() { return lsGet(HISTORY_KEY) || []; }
  function historyFor(bankId) { return history().filter(function (h) { return h.bank === bankId; }).sort(function (a, b) { return b.ts - a.ts; }); }
  function inProgress(bankId) { return lsGet("exam-inprogress-" + bankId); }
  function best(bankId) {
    var hs = historyFor(bankId); if (!hs.length) return null;
    return hs.reduce(function (m, h) { return h.pct > m.pct ? h : m; }, hs[0]);
  }
  function fmtTime(secs) {
    secs = Math.max(0, Math.round(secs));
    var h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
    return (h ? h + ":" : "") + (h ? String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function letter(i) { return String.fromCharCode(65 + i); }
  function taskOf(code) { return code.split(".").slice(0, 3).join("."); } // PA.I.E.K1 → PA.I.E

  function score(bank, answers) {
    var total = bank.questions.length, right = 0;
    bank.questions.forEach(function (q) { if (answers[q.n] === q.answer) right++; });
    return { score: right, total: total, pct: Math.round(100 * right / total) };
  }

  /* ── runner ── */
  function Runner(bank, root, opts) {
    this.bank = bank; this.root = root; this.opts = opts || {};
    var saved = inProgress(bank.id);
    this.state = saved && saved.answers ? saved : { startedAt: Date.now(), elapsed: 0, idx: 0, answers: {}, flagged: [] };
    this.tickFrom = Date.now();
    this.zoomed = {};
    var self = this;
    this.timer = setInterval(function () { self.tick(); }, 1000);
    this.onKey = function (e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") self.go(self.state.idx + 1);
      else if (e.key === "ArrowLeft") self.go(self.state.idx - 1);
      else if (/^[1-3]$/.test(e.key)) self.pick(letter(parseInt(e.key, 10) - 1));
      else if (e.key.toLowerCase() === "f") self.toggleFlag();
    };
    document.addEventListener("keydown", this.onKey);
    this.render();
  }
  Runner.prototype.elapsed = function () { return this.state.elapsed + (Date.now() - this.tickFrom) / 1000; };
  Runner.prototype.remaining = function () { return this.bank.timeLimitMin * 60 - this.elapsed(); };
  Runner.prototype.tick = function () {
    var el = this.root.querySelector(".timer");
    var rem = this.remaining();
    if (el) { el.textContent = fmtTime(rem); el.classList.toggle("low", rem < 600); }
    if (rem <= 0) { this.submit(true); return; }
    if (Math.round(this.elapsed()) % 15 === 0) this.save();
  };
  Runner.prototype.save = function () {
    this.state.elapsed = this.elapsed(); this.tickFrom = Date.now();
    lsSet("exam-inprogress-" + this.bank.id, this.state);
  };
  Runner.prototype.destroy = function () {
    clearInterval(this.timer);
    document.removeEventListener("keydown", this.onKey);
  };
  Runner.prototype.exit = function () { this.save(); this.destroy(); if (this.opts.onExit) this.opts.onExit(); };
  Runner.prototype.go = function (i) {
    if (i < 0 || i >= this.bank.questions.length) return;
    this.state.idx = i; this.save(); this.render(); window.scrollTo(0, 0);
  };
  Runner.prototype.pick = function (L) {
    var q = this.bank.questions[this.state.idx];
    if (!q.options[L.charCodeAt(0) - 65]) return;
    this.state.answers[q.n] = L; this.save(); this.render();
  };
  Runner.prototype.toggleFlag = function () {
    var n = this.bank.questions[this.state.idx].n;
    var i = this.state.flagged.indexOf(n);
    if (i >= 0) this.state.flagged.splice(i, 1); else this.state.flagged.push(n);
    this.save(); this.render();
  };
  Runner.prototype.submit = function (auto) {
    var unanswered = this.bank.questions.filter(function (q) { return !this.state.answers[q.n]; }, this).length;
    if (!auto && unanswered > 0 && !window.confirm(unanswered + " question" + (unanswered === 1 ? "" : "s") + " unanswered. Submit anyway? Unanswered questions count as wrong.")) return;
    if (!auto && unanswered === 0 && !window.confirm("Submit the exam and see your score?")) return;
    var sc = score(this.bank, this.state.answers);
    var result = {
      id: "r" + Date.now().toString(36), bank: this.bank.id, ts: Date.now(), secs: Math.round(this.elapsed()),
      score: sc.score, total: sc.total, pct: sc.pct, answers: this.state.answers, flagged: this.state.flagged.slice(),
      timedOut: !!auto,
    };
    var hs = history(); hs.push(result); if (hs.length > MAX_HISTORY) hs = hs.slice(-MAX_HISTORY);
    lsSet(HISTORY_KEY, hs);
    lsDel("exam-inprogress-" + this.bank.id);
    this.destroy();
    if (this.opts.onSubmit) this.opts.onSubmit(result);
  };
  Runner.prototype.figureHtml = function (q) {
    var self = this, html = "";
    (q.images || []).forEach(function (src) {
      html += '<div class="fig inline"><img src="banks/' + esc(src) + '" alt="Question image"></div>';
    });
    (q.figures || []).forEach(function (f) {
      var fig = self.bank.figures[f]; if (!fig) return;
      html += '<div class="fig' + (self.zoomed[f] ? " zoom" : "") + '" data-fig="' + esc(f) + '">' +
        '<img src="banks/' + esc(fig.file) + '" alt="' + esc(fig.title) + '" loading="lazy">' +
        '<div class="cap"><span>' + esc(fig.title) + ' · FAA-CT-8080-2H</span>' +
        '<a href="banks/' + esc(fig.file) + '" target="_blank" rel="noopener">Open full size &nearr;</a></div></div>';
    });
    return html;
  };
  Runner.prototype.render = function () {
    var b = this.bank, st = this.state, q = b.questions[st.idx], n = b.questions.length;
    var answered = Object.keys(st.answers).length;
    var flagged = st.flagged.indexOf(q.n) >= 0;
    var self = this;
    var html = '<button class="back" data-act="exit">&larr; Exit (progress saved)</button>' +
      '<div class="panel"><div class="qhead">' +
        '<span><b>' + esc(b.title.toUpperCase()) + '</b> · ' + (b.kind === "faa" ? "verbatim FAA bank" : "authored bank") + '</span>' +
        '<span>Question <b>' + (st.idx + 1) + '</b> / ' + n + ' &nbsp;·&nbsp; <span class="timer">' + fmtTime(this.remaining()) + '</span></span>' +
      '</div>' +
      '<div class="bar" style="margin-bottom:16px"><i style="width:' + Math.round(100 * answered / n) + '%"></i></div>' +
      '<div class="stem">' + esc(q.stem) + '</div>' +
      this.figureHtml(q);
    q.options.forEach(function (o, i) {
      var L = letter(i);
      html += '<button class="opt' + (st.answers[q.n] === L ? " sel" : "") + '" data-pick="' + L + '"><b>' + L + '</b><span>' + esc(o) + '</span></button>';
    });
    html += '<div class="qnav">' +
      '<button class="btn ghost" data-act="prev"' + (st.idx === 0 ? " disabled" : "") + '>&larr; Previous</button>' +
      '<div class="grp"><button class="btn ghost' + (flagged ? " flagged" : "") + '" data-act="flag">' + (flagged ? "Flagged" : "Flag for review") + '</button>' +
      (st.idx + 1 < n ? '<button class="btn" data-act="next">Next &rarr;</button>' : '<button class="btn" data-act="submit">Submit exam</button>') +
      '</div></div></div>';
    html += '<div class="panel"><div class="row"><span class="label">Questions · ' + answered + ' of ' + n + ' answered' +
      (st.flagged.length ? ' · ' + st.flagged.length + ' flagged' : "") + '</span>' +
      '<button class="btn small ghost" data-act="submit">Submit exam</button></div><div class="grid">';
    b.questions.forEach(function (qq, i) {
      html += '<button data-go="' + i + '" class="' + (st.answers[qq.n] ? "ans " : "") + (st.flagged.indexOf(qq.n) >= 0 ? "flag " : "") + (i === st.idx ? "cur" : "") + '">' + (i + 1) + '</button>';
    });
    html += '</div><div class="note" style="margin-top:10px">Keys: 1 2 3 pick an answer, &larr; &rarr; move, F flags. ' +
      (b.kind === "faa" ? 'Passing is ' + b.passPct + '%, ' + b.timeLimitMin + ' minutes as at the testing center.' : 'Passing is ' + b.passPct + '%.') + '</div></div>';
    this.root.innerHTML = html;
    this.root.querySelectorAll("[data-pick]").forEach(function (el) { el.onclick = function () { self.pick(el.dataset.pick); }; });
    this.root.querySelectorAll("[data-go]").forEach(function (el) { el.onclick = function () { self.go(parseInt(el.dataset.go, 10)); }; });
    this.root.querySelectorAll("[data-act]").forEach(function (el) {
      el.onclick = function () {
        var a = el.dataset.act;
        if (a === "exit") self.exit(); else if (a === "prev") self.go(st.idx - 1); else if (a === "next") self.go(st.idx + 1);
        else if (a === "flag") self.toggleFlag(); else if (a === "submit") self.submit(false);
      };
    });
    this.root.querySelectorAll(".fig:not(.inline) img").forEach(function (img) {
      img.onclick = function () { var f = img.parentElement.dataset.fig; self.zoomed[f] = !self.zoomed[f]; img.parentElement.classList.toggle("zoom", !!self.zoomed[f]); };
    });
  };

  /* ── review ── */
  function reviewHtml(bank, result, chapterTitle, chapterHref) {
    var pass = result.pct >= bank.passPct;
    var byTask = {};
    bank.questions.forEach(function (q) {
      var t = taskOf(q.acs); byTask[t] = byTask[t] || { right: 0, total: 0 };
      byTask[t].total++; if (result.answers[q.n] === q.answer) byTask[t].right++;
    });
    var missed = bank.questions.filter(function (q) { return result.answers[q.n] !== q.answer; });
    var html = '<div class="eyebrow">' + esc(bank.title) + ' · ' + (result.timedOut ? "time expired" : "completed in " + fmtTime(result.secs)) + ' · ' + new Date(result.ts).toLocaleDateString() + '</div>' +
      '<h1>' + result.score + ' / ' + result.total + ' &nbsp;<span class="score' + (pass ? "" : " fail") + '">' + result.pct + '%</span></h1>' +
      '<p class="sub">Passing is ' + bank.passPct + '%. ' + (missed.length === 0 ? "Clean sheet." : missed.length + (missed.length === 1 ? " to chase down." : " to chase down.")) +
      (bank.answerKey && bank.answerKey.source === "derived" ? ' <span title="' + esc(bank.answerKey.note) + '">Answer key is derived, not FAA-published.</span>' : "") + '</p>';
    html += '<div class="panel"><span class="label">By ACS task</span><div style="margin-top:10px">';
    Object.keys(byTask).sort().forEach(function (t) {
      var r = byTask[t], p = Math.round(100 * r.right / r.total);
      html += '<div class="acs"><span>' + esc(t.replace("PA.", "") + " " + (bank.acs[t] || t)) + '</span><div class="bar"><i class="' + (p === 100 ? "done" : p < bank.passPct ? "fail" : "") + '" style="width:' + p + '%"></i></div><span>' + r.right + '/' + r.total + '</span></div>';
    });
    html += '</div></div>';
    html += '<div class="panel"><span class="label">' + (missed.length ? "Missed questions" : "No misses") + '</span><div style="margin-top:10px">';
    missed.forEach(function (q) {
      var yours = result.answers[q.n] || "—";
      html += '<div class="rv" data-rq="' + q.n + '"><span>Q' + q.n + ' · ' + esc(q.stem.split("\n")[0].replace(/^\(Refer to FAA-CT-8080-2H, [^)]*\)\s*/, "").slice(0, 90)) + (q.stem.length > 90 ? "…" : "") +
        ' <span class="ch">' + esc(chapterTitle(q.chapter)) + '</span></span><span class="miss">' + (yours === "—" ? "skipped" : "missed · " + yours) + ', was ' + q.answer + '</span></div>';
    });
    if (missed.length) html += '<p class="note" style="margin:12px 0 0">Click a miss to see the question. Each one names its chapter: drill it, re-encode the section, or re-quiz.</p>';
    html += '</div></div>';
    html += '<div class="panel"><div class="row"><span class="label">All questions</span><button class="btn small ghost" data-act="toggle-all">Show all</button></div><div id="rv-all" class="hidden" style="margin-top:10px"></div></div>';
    return html;
  }
  function questionReviewHtml(bank, q, yours, chapterTitle, chapterHref) {
    var html = '<div class="panel" id="rq-' + q.n + '"><div class="qhead"><span>Question <b>' + q.n + '</b> · ' + esc(q.acs) + ' · ' + esc(bank.acs[taskOf(q.acs)] || "") + '</span>' +
      '<a href="' + esc(chapterHref(q.chapter)) + '" style="color:var(--gold-lt);text-decoration:none">' + esc(chapterTitle(q.chapter)) + ' &rarr;</a></div>' +
      '<div class="stem">' + esc(q.stem) + '</div>';
    (q.images || []).forEach(function (src) { html += '<div class="fig inline"><img src="banks/' + esc(src) + '" alt="Question image"></div>'; });
    (q.figures || []).forEach(function (f) {
      var fig = bank.figures[f]; if (!fig) return;
      html += '<div class="fig"><img src="banks/' + esc(fig.file) + '" alt="' + esc(fig.title) + '" loading="lazy"><div class="cap"><span>' + esc(fig.title) + '</span><a href="banks/' + esc(fig.file) + '" target="_blank" rel="noopener">Open full size &nearr;</a></div></div>';
    });
    q.options.forEach(function (o, i) {
      var L = letter(i), cls = L === q.answer ? " right" : (L === yours ? " wrong" : "");
      html += '<div class="opt' + cls + '"><b>' + L + '</b><span>' + esc(o) + (L === yours && L !== q.answer ? ' <span class="miss" style="font:600 11px var(--mono);color:var(--red)">· your answer</span>' : "") + '</span></div>';
    });
    if (q.note) html += '<div class="qnote">' + esc(q.note) + '</div>';
    return html + '</div>';
  }
  function mountReview(root, bank, result, ctx) {
    root.innerHTML = '<a class="back" href="' + esc(ctx.backHref) + '">&larr; ' + esc(ctx.backLabel) + '</a>' + reviewHtml(bank, result, ctx.chapterTitle, ctx.chapterHref);
    var all = root.querySelector("#rv-all"), shown = false;
    var renderAll = function () {
      all.innerHTML = bank.questions.map(function (q) { return questionReviewHtml(bank, q, result.answers[q.n], ctx.chapterTitle, ctx.chapterHref); }).join("");
      all.querySelectorAll(".fig img").forEach(function (img) { img.onclick = function () { img.parentElement.classList.toggle("zoom"); }; });
    };
    root.querySelector("[data-act=toggle-all]").onclick = function (e) {
      shown = !shown; all.classList.toggle("hidden", !shown); e.target.textContent = shown ? "Hide" : "Show all";
      if (shown && !all.innerHTML) renderAll();
    };
    root.querySelectorAll("[data-rq]").forEach(function (el) {
      el.onclick = function () {
        if (!shown) { shown = true; all.classList.remove("hidden"); root.querySelector("[data-act=toggle-all]").textContent = "Hide"; if (!all.innerHTML) renderAll(); }
        var t = document.getElementById("rq-" + el.dataset.rq); if (t) t.scrollIntoView({ block: "start" });
      };
    });
  }

  window.gsExam = {
    init: init, loadBank: loadBank, history: history, historyFor: historyFor, best: best, inProgress: inProgress,
    fmtTime: fmtTime, score: score, Runner: Runner, mountReview: mountReview,
    discard: function (bankId) { lsDel("exam-inprogress-" + bankId); },
  };
})();
