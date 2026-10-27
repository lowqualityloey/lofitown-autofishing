// ==UserScript==
// @name         AutoFish panel (lofi.town)
// @namespace    http://127.0.0.1:8731/
// @version      1.0
// @description  In-game fishing control panel: sessions, clock window, guards.
// @match        https://app.lofi.town/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (window.__panel && window.__panel.mounted) return;
  var s = document.createElement('script');
  s.src = 'http://127.0.0.1:8731/panel.js?t=' + Date.now();
  s.onerror = function () {
    console.warn('AutoFish: cannot reach fishserve on 127.0.0.1:8731 — run "node fishserve.js"');
  };
  document.documentElement.appendChild(s);
})();
