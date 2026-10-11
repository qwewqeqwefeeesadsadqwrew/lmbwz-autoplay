/*
 * playable-patch.js - local-only helper for the mirrored copy (NOT for redeploy).
 *
 * 1) Activation bypass: the browser build gates battle entry on
 *    `yzll.gameConfig.isZB && !userData.startGameRights`. startGameRights normally
 *    comes back from the server cdkey endpoint; offline we seed it in localStorage
 *    and keep it pinned while the page runs.
 * 2) Anti-leech lock: 20s after boot the build checks location.href for
 *    `yuanzililiang` and, if missing, inserts a full-screen input blocker.
 *    We neutralize just that timer callback.
 * 3) Melee-weapon pickup popup (WeaponAddPopup): every dropped weapon on the map
 *    stops the game to offer "watch an ad for +1 melee weapon". During unattended
 *    playback it fires every few seconds and ruins the view. We make
 *    RoleBase.weaponColliderCheck a no-op so touching a drop does nothing at all
 *    (no popup, no PAUSE, no cooldown). Drops stay on the map; nothing else changes.
 *
 * URL switches:
 *   ?rights=0  disable the activation bypass
 *   ?gm=1      force GM mode (no ads / debug entries)
 *   ?weaponpopup=0  restore the melee-weapon pickup popup
 */
(function () {
  'use strict';
  var qs = new URLSearchParams(location.search);
  var grantRights = qs.get('rights') !== '0';
  var forceGM = qs.get('gm') === '1';
  var SAVE_KEY = 'ch_lmbwz_gameSave';

  function readSave() {
    var raw = null;
    try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function ensureRights() {
    if (!grantRights) return;
    var data = readSave();
    if (!data || typeof data !== 'object') data = {};
    if (!data.customData || typeof data.customData !== 'object') data.customData = {};
    var ud = data.customData.UserData;
    if (!ud || typeof ud !== 'object') ud = {};
    if (ud.startGameRights === true) return;
    ud.startGameRights = true;
    data.customData.UserData = ud;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  }

  // seed before boot
  ensureRights();

  // pin through the game's own writes
  try {
    var nativeSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (grantRights && key === SAVE_KEY && typeof value === 'string') {
        try {
          var data = JSON.parse(value);
          if (data && typeof data === 'object') {
            if (!data.customData || typeof data.customData !== 'object') data.customData = {};
            var ud = data.customData.UserData;
            if (!ud || typeof ud !== 'object') ud = {};
            ud.startGameRights = true;
            data.customData.UserData = ud;
            value = JSON.stringify(data);
          }
        } catch (e) {}
      }
      return nativeSet.call(this, key, value);
    };
  } catch (e) {}

  var nativeTimeout = window.setTimeout;
  // neutralize the 20s anti-leech blocker (only that callback)
  try {
    window.setTimeout = function (fn, delay) {
      if (typeof fn === 'function' && delay >= 15000 && delay <= 30000) {
        var src = String(fn);
        if (src.indexOf('BlockInputEvents') >= 0 && src.indexOf('location.href') >= 0) {
          return nativeTimeout(function () {}, delay);
        }
      }
      return nativeTimeout.apply(window, arguments);
    };
  } catch (e) {}

  // optional GM flags
  try {
    var t = window.setInterval(function () {
      if (window.yzll && window.yzll.gameConfig) {
        if (grantRights) window.yzll.gameConfig.zbTestRights = true;
        if (forceGM) window.yzll.gameConfig.isGM = true;
        clearInterval(t);
      }
    }, 50);
    nativeTimeout.call(window, function () { clearInterval(t); }, 30000);
  } catch (e) {}

  // 3) silence the melee-weapon pickup popup (WeaponAddPopup)
  if (qs.get('weaponpopup') !== '0') {
    var wpnTries = 0;
    var wpnTimer = setInterval(function () {
      wpnTries++;
      if (wpnTries > 43200) { clearInterval(wpnTimer); return; } // ~6h, then give up
      var cls = null;
      try {
        if (window.cc && cc.js && typeof cc.js.getClassByName === 'function') {
          cls = cc.js.getClassByName('RoleBase');
        }
        if (!cls && typeof window.__require === 'function') {
          var mod = window.__require('RoleBase');
          cls = mod && (mod.default || mod);
        }
      } catch (e) { cls = null; }
      if (!cls || !cls.prototype || typeof cls.prototype.weaponColliderCheck !== 'function') return;
      if (!cls.prototype.weaponColliderCheck.__wpnNoop) {
        cls.prototype.__origWeaponColliderCheck = cls.prototype.weaponColliderCheck;
        var noop = function () {};
        noop.__wpnNoop = true;
        cls.prototype.weaponColliderCheck = noop;
        try { console.log('[playable-patch] melee-weapon popup suppressed'); } catch (e) {}
      }
      clearInterval(wpnTimer);
    }, 500);
  }
})();
