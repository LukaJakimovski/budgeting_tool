// Paint the last-used theme before the app loads (no white flash in dark mode).
// Kept as a separate file so the Content-Security-Policy needs no inline scripts.
try {
  var boot = JSON.parse(localStorage.getItem('tally-theme-boot') || 'null');
  if (boot) {
    var s = document.createElement('style');
    s.id = 'tally-theme';
    s.textContent = boot.css;
    document.head.appendChild(s);
    document.documentElement.dataset.mode = boot.mode;
  }
} catch (e) {}
