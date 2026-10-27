// ==UserScript==
// @name         AutoFish panel (lofi.town)
// @namespace    http://localhost/autofish
// @version      1.0
// @description  In-game fishing control panel: sessions, clock window, guards.
// @match        https://app.lofi.town/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  'use strict';
  if (window.__panel && window.__panel.mounted) return;
  // fishserve fills __FISHSERVE__ with its own host:port as this file is served, so a server on
  // any port (8731 may already be taken on Windows) injects the panel from itself.
  var BASE = 'http://__FISHSERVE__';
  var s = document.createElement('script');
  s.src = BASE + '/panel.js?t=' + Date.now();
  s.onerror = function () {
    console.warn('AutoFish: cannot reach ' + BASE + ' — start it with "node fishserve.js"');
  };
  document.documentElement.appendChild(s);
})();
