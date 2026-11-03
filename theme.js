'use strict';
/* Light/dark theme. Loaded in <head> right after the stylesheet so the theme is set before first paint.
   Mode is 'system' (follow the OS, the default), 'light' or 'dark'; only an explicit choice is stored.
   CSS reads :root[data-theme]; with no attribute it follows prefers-color-scheme (see styles.css). */
(function () {
  var KEY = 'riftscan.theme';
  var GROUND = { light: '#f2f4f7', dark: '#0d1117' }; // keep in step with --ground in styles.css (browser bar colour)
  var root = document.documentElement;
  var mq = window.matchMedia('(prefers-color-scheme: dark)');

  function mode() {
    try { var v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; }
    catch (e) { return 'system'; }
  }
  function effective() { var m = mode(); return m === 'system' ? (mq.matches ? 'dark' : 'light') : m; }
  function apply() {
    var m = mode();
    if (m === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', m);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', GROUND[effective()]);
    window.dispatchEvent(new CustomEvent('themechange', { detail: { mode: m, effective: effective() } }));
  }
  function set(m) {
    try { if (m === 'light' || m === 'dark') localStorage.setItem(KEY, m); else localStorage.removeItem(KEY); } catch (e) { /* private mode */ }
    apply();
  }
  if (mq.addEventListener) mq.addEventListener('change', function () { if (mode() === 'system') apply(); });
  window.Theme = { mode: mode, effective: effective, set: set };
  apply();
})();
