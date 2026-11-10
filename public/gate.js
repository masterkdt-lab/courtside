// public/gate.js: a deliberately soft launch gate (KC, 2026-11-09). One shared code, hardcoded, checked
// in the browser. It keeps casual visitors out during the soft launch and nothing more: the pages are
// still in the HTML, so search engines and link previews read them as before. Remove this file and its
// <script> tag in public/index.html (then run node scripts/make-pages.js) to open the site.
//
// Lenient on purpose: case, spaces, punctuation and curly apostrophes are ignored, so "I'minvited!",
// "I’m invited" and "iminvited" all work. Passing is remembered in localStorage on this device.
// Not gated: /privacy (linked from the cookie banner and emails) and personal links (#/join/…), which
// guests already received from Courtside or their group host.
(function () {
  'use strict';
  var CODE = "I'minvited!";
  var KEY = 'courtside-gate';
  var norm = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var passed = false;
  try { passed = localStorage.getItem(KEY) === norm(CODE); } catch (e) { /* storage blocked: ask each visit */ }
  if (passed) return;
  if (/^\/privacy/.test(location.pathname) || /^#\/join/.test(location.hash)) return;

  var root = document.documentElement;
  root.classList.add('gated');
  var style = document.createElement('style');
  style.textContent =
    'html.gated body>*:not(#cs-gate){display:none!important}' +
    '#cs-gate{position:fixed;inset:0;z-index:1000;background:var(--paper,#f8f6f0);color:var(--ink,#302c24);display:flex;padding:24px 16px;overflow:auto}' +
    '#cs-gate form{width:100%;max-width:380px;margin:auto;text-align:center}' +
    '#cs-gate .logo{margin:0 auto 34px}' +
    '#cs-gate h1{font-size:clamp(34px,8vw,46px);letter-spacing:-1px}' +
    '#cs-gate h1 em{color:var(--rust,#a45b3c)}' +
    '#cs-gate p{color:var(--muted,#777368);font-size:14px;margin-top:12px}' +
    '#cs-gate input{margin-top:26px;text-align:center;font-size:16px}' +
    '#cs-gate .btn{width:100%;margin-top:10px}' +
    '#cs-gate .gate-error{color:#a34e39;font-size:12px;min-height:18px;margin-top:10px}';
  document.head.appendChild(style);

  function build() {
    var gate = document.createElement('div');
    gate.id = 'cs-gate';
    gate.innerHTML =
      '<form novalidate>' +
      '<div class="logo" aria-hidden="true">Courtside<small>TRAVEL CO.</small></div>' +
      '<h1>You’re on the <em>list?</em></h1>' +
      '<p>Courtside is opening to invited guests first. Enter your code to come in.</p>' +
      '<label for="cs-gate-code" class="hp">Invitation code</label>' +
      '<input id="cs-gate-code" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Invitation code" required>' +
      '<button class="btn" type="submit">Enter</button>' +
      '<div class="gate-error" role="alert"></div>' +
      '</form>';
    document.body.appendChild(gate);
    var input = gate.querySelector('input');
    var error = gate.querySelector('.gate-error');
    gate.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      if (norm(input.value) !== norm(CODE)) {
        error.textContent = 'That code doesn’t match. Check your invitation and try again.';
        input.select();
        return;
      }
      try { localStorage.setItem(KEY, norm(CODE)); } catch (err) { /* this visit only */ }
      gate.remove();
      root.classList.remove('gated');
    });
    input.focus();
  }
  if (document.body) build(); else document.addEventListener('DOMContentLoaded', build);
})();
