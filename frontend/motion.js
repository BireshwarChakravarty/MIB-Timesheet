// Motion layer. Plays entrance animations when the screen or admin tab changes, counts up the
// headline figures and lifts the header shadow on scroll. Does nothing when the visitor asks
// for reduced motion. Partial re-renders (saving or deleting an entry) do not replay animations.
(function () {
  'use strict';
  var app = document.getElementById('app');
  if (!app) return;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var lastSig = '', timer = null;

  function signature() {
    var root = app.firstElementChild;
    var tab = app.querySelector('.tab[aria-selected="true"]');
    var h1 = app.querySelector('h1');
    return (root ? root.className : '') + '|' + (h1 ? h1.textContent : '') + '|' + (tab ? tab.getAttribute('data-tab') : '');
  }

  function countUp(el) {
    var text = el.textContent.trim();
    if (!/^\d+(\.\d+)?$/.test(text)) return;
    var target = parseFloat(text), decimals = (text.split('.')[1] || '').length;
    if (!target) return;
    var start = performance.now(), dur = 900;
    function frame(now) {
      var t = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - t, 3);
      el.textContent = t < 1 ? (target * eased).toFixed(decimals) : text;
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function enter() {
    app.setAttribute('data-enter', '');
    clearTimeout(timer);
    timer = setTimeout(function () { app.removeAttribute('data-enter'); }, 1600);
    app.querySelectorAll('.fig b').forEach(countUp);
  }

  if (!reduce) {
    new MutationObserver(function () {
      var sig = signature();
      if (sig !== lastSig) { lastSig = sig; enter(); }
    }).observe(app, { childList: true, subtree: true });
  }

  function onScroll() {
    var bar = app.querySelector('.topbar');
    if (bar) bar.classList.toggle('scrolled', window.scrollY > 4);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
})();
