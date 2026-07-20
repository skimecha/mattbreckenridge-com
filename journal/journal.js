// Shared behavior for journal pages: theme toggle + GoatCounter click events.
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
})();
