// Shared behavior for journal pages: theme toggle, GoatCounter click events,
// reading progress bar, and table-of-contents highlighting.
(function () {
  var themeBtn = document.getElementById('theme-toggle');
  function syncThemeBtn() {
    var light = document.documentElement.dataset.theme === 'light';
    themeBtn.textContent = light ? '☾ Dark' : '☀ Light';
    themeBtn.setAttribute('aria-label', light ? 'Switch to dark mode' : 'Switch to light mode');
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var root = document.documentElement;
      if (root.dataset.theme === 'light') { delete root.dataset.theme; localStorage.removeItem('mb-theme'); }
      else { root.dataset.theme = 'light'; localStorage.setItem('mb-theme', 'light'); }
      syncThemeBtn();
    });
    syncThemeBtn();
  }

  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-gc]') : null;
    if (a && window.goatcounter && window.goatcounter.count) {
      window.goatcounter.count({ path: a.dataset.gc, title: a.dataset.gc, event: true });
    }
  });

  // Reading progress bar (episode pages only).
  var bar = document.getElementById('progress-bar');
  if (bar) {
    var onScroll = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      bar.style.width = (max > 0 ? (window.scrollY / max) * 100 : 0) + '%';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // TOC: highlight the section currently in view (episode pages, wide screens).
  // Scroll-driven rather than IntersectionObserver: cheap at this page size.
  var tocLinks = document.querySelectorAll('.toc a[href^="#"]');
  if (tocLinks.length) {
    var sections = [];
    tocLinks.forEach(function (a) {
      var el = document.getElementById(a.getAttribute('href').slice(1));
      if (el) sections.push({ el: el, link: a });
    });
    var current = null;
    var highlight = function () {
      var line = window.innerHeight * 0.3;
      var best = sections[0];
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].el.getBoundingClientRect().top <= line) best = sections[i];
      }
      var doc = document.documentElement;
      if (window.scrollY + window.innerHeight >= doc.scrollHeight - 4) best = sections[sections.length - 1];
      if (best && best.link !== current) {
        if (current) current.classList.remove('active');
        current = best.link;
        current.classList.add('active');
      }
    };
    window.addEventListener('scroll', highlight, { passive: true });
    highlight();
  }
})();
