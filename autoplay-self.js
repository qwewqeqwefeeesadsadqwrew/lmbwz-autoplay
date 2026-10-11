/* autoplay-self.js — LMBWZ 页内自播 v35（手机链接自动玩）· 2026-10-11
 * 生成器：work/build-self-autoplay.js（战斗逻辑整段来自 work/autoplay-v32.js v34，勿手改本文件后忘了回灌）。
 * 用法：index.html?auto=1 → 洗牌③~⑫ 无限连打；?chmax=N 可缩范围（调试用）。不带参数时整个脚本 no-op。
 * 纪律：只驱动本地镜像副本；只点 免费/取消/放弃/普通领取/请点击页面/挑战第2章；广告按钮一律不点。
 */
(function () {
'use strict';
if (!/[?&]auto=1(&|$)/.test(location.search)) return; // 只有 ?auto=1 才自动玩
// ===== 页内自播 v35 · 前置（打开 index.html?auto=1 时生效；其余情况本脚本整体 no-op）=====
// 目标：与 work/autoplay-v32.js（v34 CDP 版）同逻辑，改由页面自己驱动：
//   - 走位/点击：合成 touch 事件（手机引擎只注册触摸监听；桌面走 mouse）→ __fire() 分流
//   - 读世界/找按钮：直接在当前页执行原脚本里的探针代码（等价 CDP Runtime.evaluate）
//   - 改档：自动跳到同源 autosave.html 写 localStorage 再跳回（防游戏写档覆盖，同 max-save.js 思路）
//   - 选关：③~⑫ 洗牌轮播、轮内不重复，轮完重洗（与 v33 一致）
// 状态存 sessionStorage：lm_auto_state_v1（跨刷新续接）；改档跳转信息：lm_auto_jump
// 纪律：只驱动我们自己的镜像副本（playable/），不改游戏本体；广告按钮一律不点。

window.__auto = window.__auto || { events: [], samples: null, state: null, lastShot: null };

// ---- 0) 本地档纪律（与自动化测试浏览器同口径）：拦游戏后端 + 反调试脚本 ----
// v35.1: 拦截方式与 CDP 版「URL 屏蔽」对齐——把请求改指到本机死端口，
//   立刻以「网络错误」快速失败（回调正常触发，游戏能按无网降级）；
//   早前用 abort() 静默取消会让游戏回调永远等不到，卡在「请求服务器...」。
var BLOCK_RE = /(yuanzililiang|iyingyao)/i;
var BLOCK_TARGET = 'http://127.0.0.1:1/__autoplay_block__';
var __blkLog = function (u) {
  try {
    window.__auto.blocked = window.__auto.blocked || [];
    if (window.__auto.blocked.length < 60) window.__auto.blocked.push(String(u).slice(0, 140));
  } catch (e) {}
};
try {
  var XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) {
    var args = Array.prototype.slice.call(arguments);
    try {
      if (BLOCK_RE.test(String(u))) { __blkLog(u); args[1] = BLOCK_TARGET + '?u=' + encodeURIComponent(String(u).slice(0, 120)); }
    } catch (e) {}
    return XO.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function () {
    return XS.apply(this, arguments);
  };
  if (window.fetch) {
    var __f0 = window.fetch.bind(window);
    window.fetch = function (u) {
      var uu = (u && u.url) || u;
      if (BLOCK_RE.test(String(uu))) { __blkLog(uu); return __f0(BLOCK_TARGET, arguments[1]); }
      return __f0.apply(null, arguments);
    };
  }
  console.log('AUTO: net hook on (local-only save)');
} catch (e) { console.log('AUTO: net hook failed ' + e); }
try {
  // 反调试脚本 ConsoleBan 会因 devtools 误判把页面重定向到 /404，直接架空它
  Object.defineProperty(window, 'ConsoleBan', {
    configurable: true,
    get: function () { return { init: function () {}, redirect: '' }; },
    set: function () {},
  });
} catch (e) {}

// ---- 1) 小工具（语义与原驱动一致）----
// v35.1: 战斗段头部常量（v34 里在 autoplay-v32.js 行 175/202 定义，切段时不在 S1 范围内，必须在这里补）
// v36.2: 单局时长上限（秒）——建筑压到最低后高关是持久战；默认 3600（60分钟，只当天花板，先打完就先进下一关），URL ?runsec=N 可调（60~21600，sessionStorage 粘住）
var RUN_SEC = (function () {
  var m = /[?&]runsec=(\d+)/.exec(location.search);
  var v = m ? Number(m[1]) : NaN;
  if (!isFinite(v)) { try { v = Number(sessionStorage.getItem('lm_auto_runsec')); } catch (e) { v = NaN; } }
  if (isFinite(v) && v >= 60 && v <= 21600) { try { sessionStorage.setItem('lm_auto_runsec', String(v)); } catch (e) {} return v; }
  return 3600;
})();
var CX = 246, CY = 560, R = 70; // 走位触点几何（按 414x896 视口实测调过）
var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
var has = function (labels, t) { return labels.some(function (l) { return l.indexOf(t) >= 0; }); };
var eqLab = function (l, t) { return l.replace(/\s+/g, '') === t; };
var isHome = function (labels) {
  return labels.some(function (l) { return eqLab(l, '普通模式'); }) &&
    has(labels, '遗物') && labels.some(function (l) { return eqLab(l, '战斗'); });
};
var waveOf = function (labels) {
  return labels.find(function (l) { return l.indexOf('波') >= 0 && l.indexOf('关') >= 0; }) || null;
};
var battleLive = function (labels) {
  return !!waveOf(labels) && !has(labels, '完成波数') && !has(labels, '复活') &&
    !labels.some(function (l) { return eqLab(l, '普通领取'); }) && !isHome(labels);
};

// ---- 2) 状态（跨刷新续接）----
var ST = null;
try { ST = JSON.parse(sessionStorage.getItem('lm_auto_state_v1') || 'null'); } catch (e) { ST = null; }
if (!ST || typeof ST !== 'object') {
  ST = { v: 1, n: 0, q: [], round: 0, last: 0, maxed: false, pending: null, stats: [], bootTries: 0 };
}
window.__auto.state = ST;
function saveState() { try { sessionStorage.setItem('lm_auto_state_v1', JSON.stringify(ST)); } catch (e) {} }
function __pushEv(o) {
  try {
    window.__auto.events.push(o);
    if (window.__auto.events.length > 400) window.__auto.events.splice(0, window.__auto.events.length - 400);
  } catch (e) {}
}
var ev = function (t, kind, detail) {
  try { console.log('[ev] ' + kind + ' ' + JSON.stringify(detail === undefined ? null : detail)); } catch (e) {}
  __pushEv({ t: Math.round(t), k: kind, d: detail });
};

// ---- 3) 洗牌轮播（③~⑫；?chmax=N 可缩范围，仅调试用）----
var RAND_MIN = 3;
var RAND_MAX = (function () {
  var m = /[?&]chmax=(\d+)/.exec(location.search);
  var v = m ? Number(m[1]) : 12;
  return (v >= RAND_MIN && v <= 30) ? v : 12;
})();
var shuffleQ = (ST.q && ST.q.slice()) || [];
var shuffleRound = ST.round || 0;
var lastPlayedCh = ST.last || 0;
var CHFIX = (function () { // 调试：?chfix=N 固定每局都打第 N 关
  var m = /[?&]chfix=(\d+)/.exec(location.search);
  var v = m ? Number(m[1]) : 0;
  return (v >= 1 && v <= 30) ? v : 0;
})();
function nextShuffleChapter() {
  if (CHFIX) {
    lastPlayedCh = CHFIX;
    ST.last = lastPlayedCh; saveState();
    console.log('SHUFFLE fixed(chfix): ch=' + CHFIX);
    return CHFIX;
  }
  if (!shuffleQ.length) {
    var hi = Math.max(RAND_MIN, RAND_MAX);
    var arr = [];
    for (var c = RAND_MIN; c <= hi; c++) arr.push(c);
    for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tv = arr[i]; arr[i] = arr[j]; arr[j] = tv; }
    if (arr.length > 1 && arr[0] === lastPlayedCh) { var tv2 = arr[0]; arr[0] = arr[1]; arr[1] = tv2; }
    shuffleQ = arr; shuffleRound++;
    console.log('SHUFFLE round#' + shuffleRound + ': ' + arr.join(' -> '));
  }
  var c2 = shuffleQ.shift();
  lastPlayedCh = c2;
  ST.q = shuffleQ.slice(); ST.round = shuffleRound; ST.last = lastPlayedCh; saveState();
  return c2;
}

// ---- 4) 页内 eval（间接求值 = CDP Runtime.evaluate 的全局语义）----
// ---- 3.5) 建筑/兵员/宠物 全压到最低战力（v36.1：只有主人物满战力）----
//   做法：只挂 EnemyBase.beAttack。「非英雄武器」（WEAPON1/2/3 = 1/2/3 之外的来源）单发伤害封顶到 怪满血/K。
//   覆盖 BUILD2/6/7/8（炮台/兵丁/射士/神机）、宠物、火焰、陷阱等一切非人物来源；英雄与武器伤害原样不动。
//   K 越大越弱：K=5 是「每发掉 20%」、K=100 是「每发掉 1%」、K=1000 是「每发掉 0.1%」。
//   ?bnerf=K 可调（1~100000，默认见 BUILD_K_DEF）；同标签页内设一次即粘住（跨改档跳转不丢）。
var BUILD_K_DEF = 1000;
var BUILD_K = (function () {
  var m = /[?&]bnerf=([0-9.]+)/.exec(location.search);
  var v = m ? Number(m[1]) : NaN;
  if (!isFinite(v)) { try { v = Number(sessionStorage.getItem('lm_auto_bnerf')); } catch (e) { v = NaN; } }
  if (isFinite(v)) { try { sessionStorage.setItem('lm_auto_bnerf', String(v)); } catch (e) {} }
  return (isFinite(v) && v >= 1 && v <= 100000) ? v : BUILD_K_DEF;
})();
window.__auto.nerf = { hits: 0, capped: 0, kills: 0, heroHits: 0, dmgHero: 0, dmgOtherRaw: 0, dmgOther: 0 };
  window.__auto.cfg = { ver: 'v36.3', buildK: BUILD_K, runsec: RUN_SEC };
(function attachBuildNerf() {
  var tries = 0;
  var timer = setInterval(function () {
    if (++tries > 43200) { clearInterval(timer); return; } // 6h 保险（正常 <1s 就挂上）
    var cls = null;
    try {
      if (window.cc && cc.js && typeof cc.js.getClassByName === 'function') cls = cc.js.getClassByName('EnemyBase');
      if (!cls && typeof window.__require === 'function') { var mod = window.__require('EnemyBase'); cls = mod && (mod.default || mod); }
    } catch (e) { cls = null; }
    if (!cls || !cls.prototype || typeof cls.prototype.beAttack !== 'function') return;
    if (cls.prototype.beAttack.__bnerf) { clearInterval(timer); return; }
    var orig = cls.prototype.beAttack;
    var patched = function (t, e, a, o) {
      try {
        var st = window.__auto.nerf;
        if (t && typeof t.num === 'number') {
          if (e === 1 || e === 2 || e === 3) { st.heroHits++; st.dmgHero += t.num; }
          else {
            st.hits++; st.dmgOtherRaw += t.num;
            if (this && this._hpMax > 0) {
              var cap = this._hpMax / BUILD_K;
              try {
                // v36.3: beAttack internally multiplies (1+i+n) artifact bonus AFTER this hook,
                // so divide that bonus out first to keep the FINAL hit <= hpMax/K.
                var bp = window.__bp;
                if (bp && typeof bp.getArtifaceValue === 'function') {
                  var mult = 1;
                  if (this._childType === 5) mult += bp.getArtifaceValue(13) || 0;        // HURT_ADD_BOSS
                  if (this._hp < 0.3 * this._hpMax) mult += bp.getArtifaceValue(15) || 0; // ATK_ADD_LOWHP
                  if (mult > 1) cap = cap / mult;
                }
              } catch (e3) {}
              if (t.num > cap) { t = { num: cap, isCrit: !!t.isCrit }; st.capped++; }
            }
            st.dmgOther += t.num;
          }
        }
      } catch (err) {}
      return orig.call(this, t, e, a, o);
    };
    patched.__bnerf = true; patched.__orig = orig;
    cls.prototype.beAttack = patched;
    if (typeof cls.prototype.dealDie === 'function' && !cls.prototype.dealDie.__bnerfKill) {
      var od = cls.prototype.dealDie;
      cls.prototype.dealDie = function (x) { try { window.__auto.nerf.kills++; } catch (err) {} return od.call(this, x); };
      cls.prototype.dealDie.__bnerfKill = true;
    }
    clearInterval(timer);
    console.log('NERF: non-hero dmg cap = hpMax/' + BUILD_K + ' (hero weapons untouched), stats at __auto.nerf');
  }, 300);
})();

var __EVAL = eval;
function __evalRaw(src) {
  try { return __EVAL(src); } catch (e) { return { err: String(e) }; }
}

// ---- 5) 合成 touch / 鼠标（手机只认 touch；桌面走 mouse）----
var TOUCH_MODE = null;
function __isTouch() {
  if (TOUCH_MODE === null) {
    try {
      var cap = (window.cc && cc.sys && cc.sys.capabilities) || {};
      TOUCH_MODE = !!(cc.sys && cc.sys.isMobile) || (!!cap.touches && !cap.mouse);
    } catch (e) { TOUCH_MODE = false; }
  }
  return TOUCH_MODE;
}
function __makeTouch(cv, x, y, id) {
  var o = {
    identifier: id, target: cv,
    clientX: Math.round(x), clientY: Math.round(y),
    pageX: Math.round(x), pageY: Math.round(y),
    screenX: Math.round(x), screenY: Math.round(y),
    radiusX: 2.5, radiusY: 2.5, rotationAngle: 0, force: 1,
  };
  try { return new Touch(o); } catch (e) { return o; }
}
function __fireTouch(cv, type, x, y) {
  var name = type === 'mousedown' ? 'touchstart' : type === 'mouseup' ? 'touchend' : type === 'mousemove' ? 'touchmove' : null;
  if (!name) return;
  var t = __makeTouch(cv, x, y, 1);
  var list = name === 'touchend' ? [] : [t]; // 抬起：touches 必须为空数组
  var e2 = null;
  try {
    e2 = new TouchEvent(name, { bubbles: true, cancelable: true, view: window, touches: list, targetTouches: list, changedTouches: [t] });
  } catch (e) {
    e2 = new CustomEvent(name, { bubbles: true, cancelable: true });
    e2.touches = list; e2.targetTouches = list; e2.changedTouches = [t];
  }
  cv.dispatchEvent(e2);
}
function __fire(type, x, y) {
  var cv = document.getElementById('GameCanvas');
  if (!cv) return;
  if (__isTouch()) { __fireTouch(cv, type, x, y); return; }
  cv.dispatchEvent(new MouseEvent(type, {
    clientX: Math.round(x), clientY: Math.round(y), bubbles: true, cancelable: true,
    view: window, button: 0, buttons: type === 'mousedown' ? 1 : 0,
  }));
}

// ---- 6) s.* shim（与 lib-cdp 会话 API 同形；clickLabel 走真实点位点击：touch 或 mouse）----
var FIND_SRC = `window.__find = function (text, exact) {
  var q = String(text).replace(/\\s+/g, '');
  var out = [];
  (function walk(n) {
    var l = n.getComponent && n.getComponent(cc.Label);
    if (l && l.string) {
      var s = String(l.string);
      var norm = s.replace(/\\s+/g, '');
      var ok = exact ? (norm === q) : (norm.indexOf(q) >= 0);
      if (ok && n.activeInHierarchy) {
        var wp = n.convertToWorldSpaceAR(cc.v2(0, 0));
        var cs = n.getContentSize();
        out.push({ node: n.name, s: s.slice(0, 40), wx: wp.x, wy: wp.y, w: cs.width, h: cs.height });
      }
    }
    (n.children || []).forEach(walk);
  })(cc.director.getScene());
  return out;
};
window.__toCss = function (wx, wy) {
  var c = document.querySelector('canvas');
  var r = c.getBoundingClientRect();
  var vp = cc.view.getViewportRect();
  var sx = cc.view.getScaleX(), sy = cc.view.getScaleY();
  var px = vp.x + wx * sx;
  var py = vp.y + wy * sy;
  return { x: r.left + px / vp.width * r.width, y: r.top + (1 - py / vp.height) * r.height };
};`;

function __labelsSrc(limit) {
  return `(function(){
    var out = [];
    (function walk(n) {
      var l = n.getComponent && n.getComponent(cc.Label);
      if (l && l.string && String(l.string).length) out.push({ node: n.name, s: String(l.string).slice(0, 60), active: n.activeInHierarchy });
      (n.children || []).forEach(walk);
    })(cc.director.getScene());
    return out.slice(0, ${limit || 800});
  })()`;
}

function __makeShim() {
  var api = {};
  api.eval = async function (expr) {
    var r = __evalRaw(expr);
    if (r && typeof r.then === 'function') { try { return await r; } catch (e) { return { err: String(e) }; } }
    return r;
  };
  api.evalAsync = function (expr) { return api.eval(expr); };
  api.shot = function (name) { try { window.__auto.lastShot = { name: name, t: Date.now() }; } catch (e) {} return name; };
  api.labels = async function (limit) { return __evalRaw(__labelsSrc(limit)); };
  api.waitScene = async function (name, secs) {
    for (var i = 0; i < (secs || 60); i++) {
      await sleep(1000);
      var v = __evalRaw('(function(){try{return cc.director.getScene()?(cc.director.getScene().name||null):null;}catch(e){return null;}})()');
      if (v === name) return true;
    }
    return false;
  };
  api.findLabels = async function (text, exact) {
    __evalRaw(FIND_SRC);
    var r = __evalRaw('(function(){try{return window.__find(' + JSON.stringify(text) + ',' + (exact ? 'true' : 'false') + ');}catch(e){return {err:String(e)};}})()');
    if (!Array.isArray(r)) return r;
    return r.sort(function (a, b) { return (a.w * a.h) - (b.w * b.h); });
  };
  api.toCss = async function (wx, wy) {
    __evalRaw(FIND_SRC);
    return __evalRaw('(function(){try{return window.__toCss(' + wx + ',' + wy + ');}catch(e){return {err:String(e)};}})()');
  };
  api.mouse = async function (x, y) {
    __fire('mousedown', x, y);
    await sleep(70 + Math.floor(Math.random() * 60));
    __fire('mouseup', x, y);
  };
  api.clickLabel = async function (text, opts) {
    var o = opts || {};
    var cands = await api.findLabels(text, o.exact !== false);
    if (!Array.isArray(cands) || !cands.length) return { ok: false, why: 'no label matching ' + text, cands: cands };
    var pick = cands[o.index || 0];
    var css = await api.toCss(pick.wx, pick.wy);
    if (!css || css.err) return { ok: false, why: 'toCss failed', css: css };
    await api.mouse(css.x, css.y);
    return { ok: true, label: pick.s, node: pick.node, css: css, candidates: cands.length };
  };
  // 原驱动的走位用 Input.dispatchMouseEvent 三连；页内等价 = 合成 touch/mouse
  api.send = function (method, params) {
    if (method === 'Input.dispatchMouseEvent' && params) {
      var name = params.type === 'mouseMoved' ? 'mousemove' : params.type === 'mousePressed' ? 'mousedown' : params.type === 'mouseReleased' ? 'mouseup' : null;
      if (name) __fire(name, params.x, params.y);
    }
    return Promise.resolve();
  };
  api.sleep = sleep;
  api.close = function () { return Promise.resolve(); };
  api.out = null;
  api.sid = null;
  api.logs = [];
  return api;
}
var s = __makeShim();
var snap = async function (s1) {
  var ls = await s1.labels(800);
  if (!Array.isArray(ls)) return [];
  return ls.filter(function (l) { return l.active; }).map(function (l) { return l.s; });
};

// ---- 7) 改档跳转（写 sessionStorage → autosave.html 落档 → 跳回游戏）----
function __requestJump(ch, battleNo, full) {
  try { sessionStorage.setItem('lm_auto_jump', JSON.stringify({ ch: ch, full: !!full, ms: Date.now() })); } catch (e) {}
  ST.pending = ch;
  ST.n = (battleNo || 1) - 1;
  saveState();
  console.log('AUTO jump -> ch=' + ch + ' battle#' + (battleNo || 1) + (full ? ' (full-max)' : ''));
  location.href = 'autosave.html?ms=' + Date.now();
}
async function waitGame(maxSec) {
  var t0w = Date.now();
  while (Date.now() - t0w < (maxSec || 180) * 1000) {
    var v = __evalRaw('(function(){try{return cc.director.getScene()?(cc.director.getScene().name||null):null;}catch(e){return null;}})()');
    if (v === 'Game') return true;
    await sleep(2000);
  }
  return false;
}

(async () => {
const EDGE = 760;
const UPDATE_MS = 300;

// 只读世界探针（同 v3c）
const WORLD_SRC = `(function(){
  var out = { hero: null, hp: null, wood: null, monsters: [], squares: [], weapons: [], trees: [], wpn: -1 };
  var scene = cc.director.getScene();
  (function walk(n){
    var comps = n._components || [];
    for (var i = 0; i < comps.length; i++){
      var c = comps[i], cls = '';
      try { cls = cc.js.getClassName(c) || ''; } catch(e){}
      try {
        if (c.mWoodLab && c.mWoodLab.string !== undefined) out.wood = parseInt(String(c.mWoodLab.string).replace(/[^0-9]/g,''),10) || 0;
      } catch(e){}
      if (cls === 'EnemyBase') {
        try {
          if (n.activeInHierarchy) out.monsters.push({
            x: Math.round(n.position.x), y: Math.round(n.position.y),
            hp: Math.round(c._hp || 0), max: Math.round(c._hpMax || 0),
            live: Math.round(c._liveTimes || 0), frenzy: c._bFrenzy ? 1 : 0,
            mt: c.mMonsterType || 0,
            bspd: (c._enemyInfo && c._enemyInfo.bulletSpeed) || 0,
            id: c.mMonsterId || 0
          });
        } catch(e){}
      }
      if (cls === 'ObstacleBase') {
        try { if (n.activeInHierarchy) out.trees.push([Math.round(n.position.x), Math.round(n.position.y)]); } catch(e){}
      }
      if (cls === 'SquareBase') {
        try {
          out.squares.push({ node: n.name, prog: c._curProgress, max: c._maxProgress,
            cost: c._unlockWood, lock: c._isLock, trees: (c._holdTrees || []).length,
            can: (typeof c.checkCanUpdateProgress === 'function') ? c.checkCanUpdateProgress() : null,
            wx: Math.round(n.position.x), wy: Math.round(n.position.y),
            holdPos: (c._holdTrees || []).map(function(tn){ try { return [Math.round(tn.position.x), Math.round(tn.position.y)]; } catch(e){ return [0,0]; } }) });
        } catch(e){}
      }
      if (cls === 'WeaponItem1') {
        try { out.weapons.push([Math.round(n.position.x), Math.round(n.position.y)]); } catch(e){}
      }
      if (n.name === 'Role2001') {
        try { out.hero = { x: Math.round(n.position.x), y: Math.round(n.position.y) }; } catch(e){}
        try {
          for (var j = 0; j < comps.length; j++){
            if (cc.js.getClassName(comps[j]) === 'Role1') {
              if (comps[j]._hpProgress) {
                var bar = comps[j]._hpProgress.getChildByName('Bar');
                if (bar) out.hp = bar.getComponent(cc.Sprite).fillRange;
              }
              if (comps[j]._weaponArray1) out.wpn = comps[j]._weaponArray1.length;
            }
          }
        } catch(e){}
      }
    }
    (n.children || []).forEach(walk);
  })(scene);
  return out;
})()`;

// 弹窗状态 + gameState（bp 代理缓存到 window.__bp）
const PSTATE_SRC = `(function(){
  var out = { open:false, cards:[], popups:[], state:-1 };
  if (!window.__bp) {
    (function walk(n){
      if (window.__bp) return;
      (n._components||[]).forEach(function(c){
        if (window.__bp) return;
        var ks; try { ks = Object.keys(c); } catch(e){ return; }
        for (var i=0;i<ks.length;i++){
          var v; try { v = c[ks[i]]; } catch(e){ continue; }
          if (v && typeof v === 'object' && typeof v.wood === 'number' && v.battleData) { window.__bp = v; return; }
        }
      });
      (n.children||[]).forEach(walk);
    })(cc.director.getScene());
  }
  if (window.__bp) out.state = window.__bp.gameState;
  (function walk(n){
    if (n.activeInHierarchy) {
      if (n.name === 'CardItem') {
        var c = null;
        (n._components||[]).forEach(function(x){ if (x && typeof x.onClickThis === 'function') c = x; });
        var nl = n.getChildByName('Name'), nm = '';
        if (nl && nl.getComponent(cc.Label)) nm = String(nl.getComponent(cc.Label).string);
        out.cards.push({ nm: nm, can: c ? !!c._canClick : null, sid: c ? c._skillId : null });
      }
      (n._components||[]).forEach(function(x){
        try { if (x && typeof x.removeUI === 'function' && typeof x._popupName === 'string' && x._popupName) out.popups.push(x._popupName); } catch(e){}
      });
      var l = n.getComponent && n.getComponent(cc.Label);
      if (l && String(l.string).indexOf('选择一个奖励') >= 0) out.open = true;
    }
    (n.children||[]).forEach(walk);
  })(cc.director.getScene());
  out.nCards = out.cards.length;
  out.anyPopup = out.popups.length > 0;
  return out;
})()`;

const FALLBACK_ONCLICK = `(function(){
  var done = [];
  (function walk(n){
    if (n.name === 'CardItem' && n.activeInHierarchy) {
      (n._components||[]).forEach(function(c){
        if (c && typeof c.onClickThis === 'function') { try { c.onClickThis(); done.push(c._skillId); } catch(e){ done.push('err:'+e); } }
      });
    }
    (n.children||[]).forEach(walk);
  })(cc.director.getScene());
  return done;
})()`;

const FALLBACK_ONCLICK_FORCE = `(function(){
  var done = [];
  (function walk(n){
    if (n.name === 'CardItem' && n.activeInHierarchy) {
      (n._components||[]).forEach(function(c){
        if (c && typeof c.onClickThis === 'function') { try { c._canClick = true; c.onClickThis(); done.push(c._skillId); } catch(e){ done.push('err:'+e); } }
      });
    }
    (n.children||[]).forEach(walk);
  })(cc.director.getScene());
  return done;
})()`;

const FALLBACK_REMOVEUI = `(function(){
  var out = [];
  (function walk(n){
    if (n.activeInHierarchy) {
      (n._components||[]).forEach(function(c){
        try { if (c && typeof c.removeUI === 'function' && /Rougelike/i.test(String(n.name))) { c.removeUI(); out.push(n.name); } } catch(e){ out.push('err:'+e); } }
      });
    }
    (n.children||[]).forEach(walk);
  })(cc.director.getScene());
  return out;
})()`;

// v14: 解锁炮台弹窗兜底——直调 onBtnSure()（等价于点「确定」）
const UNLOCK_CONFIRM_SRC = `(function(){
  var done = [];
  (function walk(n){
    (n._components||[]).forEach(function(c){
      try {
        if (c && typeof c.onBtnSure === 'function' && typeof c.onBtnCancel === 'function' && c.mDes) {
          c.onBtnSure(); done.push('sure');
        }
      } catch(e){ done.push('err:'+e); }
    });
    (n.children||[]).forEach(walk);
  })(cc.director.getScene());
  return done;
})()`;

const SET_PLAYING = `(function(){
  if (!window.__bp) return 'no-proxy';
  var before = window.__bp.gameState;
  window.__bp.gameState = 2;
  return before + '->' + window.__bp.gameState;
})()`;

// 选卡优先级 v8：按 data_skill.json 真实数值 + 本打法（全场风筝 + 篝火回血环）排序
function cardScore(name) {
  const n = String(name || '');
  const rules = [
    ['奔跑时', 100],      // 1018 奔跑时每秒回2%最大血 —— 风筝流核心
    ['武器数量', 97],     // 1013/1014 近战武器+1
    ['篝火范围内', 95],   // 1029 火圈内攻速最高2倍（回血环里打）
    ['最大血量', 92],     // 1006 +25% 上限
    ['脱离基地', 90],     // 1015 离基地移速+30%
    ['移动速度', 88],     // 1005 +10% 移速=风筝余量
    ['停止时', 84],       // 1016 静止攻速叠至2倍（站火里吃）
    ['篝火恢复', 82],     // 1028 回血+20%
    ['篝火作用范围', 80], // 1027 火圈半径+20%
    ['旋转速度', 76],     // 1003 近战转速+20%
    ['近战武器尺寸', 74], // 1002 尺寸+20%
    ['伐木', 72],         // 1033/1034 木头经济
    ['炮台', 66],         // 1024-1026 炮台强化
    ['击退', 78],         // 1001 击退+5（被围时能推开怪群）
    ['子弹', 58],
  ];
  let sc = 10;
  for (const [k, v] of rules) if (n.indexOf(k) >= 0) sc = Math.max(sc, v);
  if (n.indexOf('牺牲') >= 0) sc = Math.min(sc, 40); // 1020 扣血换伤害：低血可能自杀，不选
  return sc;
}

  // s / ev 由前置 shim 提供（见文件头 shared prelude）。

  // ---- v32: 起手满号（满档 + passChapter=起手关-1，让游戏 nexChapter 每胜一局自动推下一关）----
  // v33: 起手关校验（防 BFCache 恢复旧页面、把旧档写回——实测过：二次运行会从旧章节开局）
  const chapNow = async () => {
    const m = (await snap(s)).map(x => x.trim()).find(x => /^第\d+章$/.test(x));
    return m ? Number(m.replace(/[^0-9]/g, '')) : -1;
  };
  // ===== v35.1(页内) 启动引导 =====
  //  1) 先等游戏把 localStorage 存档建出来（首次启动本地被拦网时游戏会自建默认档，可能伴随登录失败弹窗，不拦路）
  //  2) 首启：立刻改档跳转（autosave.html 写满档+起手关），不等 Game 场景
  //  3) 已满档：等 Game 场景（期间顺手点掉「账号登录异常」弹窗）→ 章节校验 → 开打
  {
    var saveOk = false;
    for (var bi = 0; bi < 80 && !saveOk; bi++) {
      saveOk = !!(await s.eval('(function(){try{return localStorage.getItem("ch_lmbwz_gameSave")?1:0;}catch(e){return 0;}})()'));
      if (!saveOk) await sleep(1500);
    }
    if (!saveOk) { console.log('AUTO: save not created yet, idle'); return; }
    if (!ST.maxed) {
      ST.maxed = true; // 本次 jump 的 autosave.html 会写整份满档
      ST.q = []; ST.round = 0; ST.last = 0; ST.n = 0; ST.pending = null;
      var firstCh = nextShuffleChapter();
      console.log('SHUFFLE pick battle#1: ch=' + firstCh + ' (round#' + shuffleRound + ', left=' + shuffleQ.length + ')');
      __requestJump(firstCh, 1, true);
      return;
    }
    ST.bootTries = (ST.bootTries || 0) + 1;
    saveState();
    if (ST.bootTries > 60) { console.log('AUTO: boot retry guard hit, stop'); return; }
    var gameOk = false;
    for (var wi = 0; wi < 75 && !gameOk; wi++) {
      var lsw = await snap(s);
      if (lsw.some(function (x) { return x.indexOf('账号登录异常') >= 0; })) {
        var rw = await s.clickLabel('确定', { exact: true });
        console.log('AUTO: login-fail popup -> 确定 ok=' + !!(rw && rw.ok));
        await sleep(1500);
      }
      gameOk = (__evalRaw('(function(){try{return cc.director.getScene()?(cc.director.getScene().name||null):null;}catch(e){return null;}})()') === 'Game');
      if (!gameOk) await sleep(2000);
    }
    if (!gameOk) { console.log('AUTO: Game scene not reached -> reload retry'); await sleep(1500); location.reload(); return; }
    await sleep(1500);
    if (has(await snap(s), '同意')) { await s.clickLabel('同意'); await sleep(1200); }
    if (ST.pending != null) {
      var chc = -1;
      for (var ci = 0; ci < 6; ci++) {
        chc = await chapNow();
        if (chc === ST.pending) break;
        if (chc < 1) { await sleep(3000); continue; } // 首页还没渲染出来
        console.log('PROG MISMATCH(verify) ch=' + chc + ' want=' + ST.pending + ' -> re-apply');
        __requestJump(ST.pending, ST.n + 1, !ST.maxed);
        return;
      }
      console.log('VERIFY chapter check: ch=' + chc + ' (want ' + ST.pending + ')');
      ST.pending = null;
      saveState();
    }
  }

  // 从 active 弹窗里读卡（坐标+名字），供点卡使用
  const CARDS_SRC = `(function(){
    var out = [];
    (function walk(n){
      if (n.name === 'CardItem' && n.activeInHierarchy) {
        var wp = n.convertToWorldSpaceAR(cc.v2(0,0));
        var c = null;
        (n._components||[]).forEach(function(x){ if (x && typeof x.onClickThis === 'function') c = x; });
        var nl = n.getChildByName('Name'), nm = '';
        if (nl && nl.getComponent(cc.Label)) nm = String(nl.getComponent(cc.Label).string);
        out.push({ wx: wp.x, wy: wp.y, name: nm, can: c ? !!c._canClick : null, sid: c ? c._skillId : null });
      }
      (n.children||[]).forEach(walk);
    })(cc.director.getScene());
    return out;
  })()`;

  async function popupState() { return s.eval(PSTATE_SRC); }

  // 鲁棒关闭奖励弹窗：真实点击×3 → 直调接口×3 级兜底
  async function closeRewardPopup(t) {
    const log = [];
    for (let round = 0; round < 3; round++) {
      let cards = await s.eval(CARDS_SRC);
      if (!Array.isArray(cards) || !cards.length) { log.push('r' + round + ':no-cards'); break; }
      if (!cards.some(c => c.can === true)) { await sleep(450); cards = await s.eval(CARDS_SRC); log.push('r' + round + ':settle-wait'); }
      const sorted = cards.slice().sort((a, b) => cardScore(b.name) - cardScore(a.name));
      const pick = sorted[0];
      const css = await s.toCss(pick.wx, pick.wy);
      if (!css || css.err) { log.push('r' + round + ':toCss-fail:' + JSON.stringify(css)); break; }
      await s.mouse(css.x, css.y);
      log.push('r' + round + ':click(' + Math.round(css.x) + ',' + Math.round(css.y) + ')="' + String(pick.name).slice(0, 12) + '" can=' + pick.can + ' sid=' + pick.sid);
      await sleep(800);
      const st = await popupState();
      if (!st.open && st.nCards === 0) {
        ev(t, 'popup-closed', { how: 'click', log, state: st.state });
        return 'CLOSED[' + log.join(' | ') + ']';
      }
      log.push('  still-open cards=' + st.nCards + ' state=' + st.state);
    }
    // 兜底1：直调 onClickThis
    const f1 = await s.eval(FALLBACK_ONCLICK);
    log.push('fb1-onClickThis:' + JSON.stringify(f1));
    await sleep(700);
    let st = await popupState();
    if (!st.open && st.nCards === 0) { ev(t, 'popup-closed', { how: 'fb1', log, state: st.state }); return 'FB1[' + log.join(' | ') + ']'; }
    // 兜底2：强制 _canClick 再 onClickThis
    const f2 = await s.eval(FALLBACK_ONCLICK_FORCE);
    log.push('fb2-forceClick:' + JSON.stringify(f2));
    await sleep(700);
    st = await popupState();
    if (!st.open && st.nCards === 0) { ev(t, 'popup-closed', { how: 'fb2', log, state: st.state }); return 'FB2[' + log.join(' | ') + ']'; }
    // 兜底3：直调 removeUI
    const f3 = await s.eval(FALLBACK_REMOVEUI);
    log.push('fb3-removeUI:' + JSON.stringify(f3));
    await sleep(700);
    st = await popupState();
    ev(t, 'popup-closed', { how: 'fb3', log, state: st.state, stillOpen: st.open });
    return (st.open ? 'FORCED-STILL-OPEN' : 'FB3') + '[' + log.join(' | ') + ']';
  }

  // v32: 复活弹窗取消兜底——直调 onBtnCancel（=点「取消/放弃」；「复活」按了要视频广告，永不点）
  const RELIVE_CANCEL_SRC = `(function(){
    var done = [];
    (function walk(n){
      if (n.activeInHierarchy) {
        (n._components||[]).forEach(function(c){
          try { if (c && typeof c.onBtnCancel === 'function' && typeof c.onBtnRelive === 'function') { c.onBtnCancel(); done.push(n.name || 'unnamed'); } } catch(e){ done.push('err:'+e); }
        });
      }
      (n.children||[]).forEach(walk);
    })(cc.director.getScene());
    return done;
  })()`;

  async function handleRelive(t) {
    const labels = await snap(s);
    ev(t, 'relive-labels', labels.filter(l => l.length < 30).slice(0, 60));
    await s.shot('relive-' + Math.round(t) + '.png');
    for (const txt of ['放弃', '取消']) {
      const r = await s.clickLabel(txt, { exact: false });
      if (r && r.ok) { await sleep(900); if (!has(await snap(s), '复活')) return 'click:' + txt; }
    }
    const f = await s.eval(RELIVE_CANCEL_SRC);
    await sleep(700);
    console.log('  relive fallback onBtnCancel:', JSON.stringify(f));
    ev(t, 'relive-fallback', f);
    return 'fb:' + JSON.stringify(f);
  }

  // v32: 结算 → 回主页。只点「普通领取」（「双倍领取」=视频广告，永不点）；顺路处理遗物弹窗/战力提示
  async function toHome(t) {
    for (let i = 0; i < 45; i++) {
      const labels = await snap(s);
      if (battleLive(labels)) return 'battle'; // 战力提示「挑战第2章」直接开战的情况
      if (has(labels, '复活')) { await handleRelive(t); continue; }
      if (labels.some(l => l.replace(/\s+/g, '').indexOf('请点击页面') >= 0)) { await s.clickLabel('请点击页面', { exact: false }); console.log('  relic popup ok'); await sleep(1000); continue; }
      if (labels.some(l => l.replace(/\s+/g, '').indexOf('挑战第2章') >= 0)) { const r = await s.clickLabel('挑战第2章', { exact: false }); console.log('  tips 挑战第2章 ok=' + (r && r.ok)); await sleep(1200); continue; }
      if (labels.some(l => eqLab(l, '普通领取'))) {
        const r = await s.clickLabel('普通领取', { exact: true });
        console.log('  settle 普通领取 ok=' + (r && r.ok));
        ev(t, 'settle-claim', { ok: !!(r && r.ok) });
        await sleep(1500); continue;
      }
      if (labels.some(l => l.indexOf('选择一个奖励') >= 0)) { await closeRewardPopup(t); continue; }
      if (isHome(labels)) return 'home';
      await sleep(700);
    }
    return 'timeout';
  }

  // v32: 读存档进度（localStorage 只读）
  async function readProg() {
    return s.eval(`(function(){try{var sd=JSON.parse(localStorage.getItem('ch_lmbwz_gameSave'));var u=sd.customData.UserData;return {cur:u.curChapter,pass:u.passChapter,stage:u.stageNumber};}catch(e){return {err:String(e)};}})()`);
  }

  // ===== v32: 同档连打主循环——每局 = 回主页 → 点「战斗」→ 打到结算 → 回主页 → 记录 =====
  let popupCount = 0; // v32: 跨局累计
  const battles = [];
  const t0All = Date.now();
  const battle = ST.n + 1; ST.n = battle; saveState();
  for (var __once35 = 0; __once35 < 1; __once35++) { // v35(页内): 单局循环体；break=放弃本局直接收尾
  // 进战斗（含近战武器弹窗处理）：从主页点「战斗」大按钮
  let inBattle = false;
  for (let attempt = 0; attempt < 30 && !inBattle; attempt++) {
    const labels = await snap(s);
    if (battleLive(labels)) { inBattle = true; break; }
    if (has(labels, '复活')) { await handleRelive((Date.now() - t0All) / 1000); await sleep(1000); continue; }
    if (labels.some(l => l.replace(/\s+/g, '').indexOf('请点击页面') >= 0)) { await s.clickLabel('请点击页面', { exact: false }); await sleep(1000); continue; }
    if (labels.some(l => eqLab(l, '普通领取'))) { await s.clickLabel('普通领取', { exact: true }); await sleep(1500); continue; }
    if (labels.some(l => l.replace(/\s+/g, '').indexOf('挑战第2章') >= 0)) { await s.clickLabel('挑战第2章', { exact: false }); await sleep(1500); continue; }
    if (has(labels, '同意')) { await s.clickLabel('同意'); await sleep(1500); continue; }
    if (labels.some(x => x.replace(/\s+/g, '').indexOf('近战武器') >= 0)) {
      const freeNow = labels.some(x => x.replace(/\s+/g, '') === '免费');
      const r = freeNow ? await s.clickLabel('免费', { exact: false }) : await s.clickLabel('放弃', { exact: false });
      console.log('weapon popup:', freeNow ? 'free' : 'skip', (r && r.ok) ? 'ok' : 'FAIL');
      await sleep(2000); continue;
    }
    const cands = await s.findLabels('战斗', false);
    if (cands.length) { const idx = cands.findIndex(c => c.w > 120); await s.clickLabel('战斗', { exact: false, index: idx >= 0 ? idx : 0 }); }
    await sleep(4000);
  }
  if (!inBattle) {
    console.log('inBattle FAIL at battle#' + battle);
    try { console.log('LABELS-DUMP:', JSON.stringify((await snap(s)).slice(0, 120))); } catch (e) {}
    await s.shot('no-battle.png'); console.log('AUTO: no-battle -> reload retry'); await sleep(1500); location.reload(); return;
  }
  const chBefore = await readProg();
  console.log('=== BATTLE#' + battle + ' start | ch=' + JSON.stringify(chBefore) + ' | ' + waveOf(await snap(s)));
  await s.shot('b' + battle + '-start.png');
  ev((Date.now() - t0All) / 1000, 'battle-start', { n: battle, ch: chBefore });

  const mouseDown = async (x, y) => {
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, s.sid);
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, s.sid);
  };
  const mouseMove = (x, y) => s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 }, s.sid);
  const mouseUp = (x, y) => s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, s.sid);

  let ax = 1, ay = -1, pressed = false, curDir = { x: 1, y: 0 }, lastPressAt = 0;

  async function readWorld() { return s.eval(WORLD_SRC); }
  async function hold(dir) {
    curDir = dir;
    if (pressed && Date.now() - lastPressAt > 8000) { await release(); } // v16: 保险重按
    if (!pressed) { await mouseDown(CX, CY); await sleep(80); pressed = true; lastPressAt = Date.now(); }
    await mouseMove(CX + R * dir.x, CY + R * dir.y);
  }
  async function release() {
    if (pressed) { await mouseUp(CX + R * curDir.x, CY + R * curDir.y); pressed = false; await sleep(120); }
  }

  // 方向校准
  {
    const p0 = await readWorld();
    await hold({ x: 1, y: 0 }); await sleep(900); await release();
    const p1 = await readWorld();
    await hold({ x: 0, y: -1 }); await sleep(900); await release();
    const p2 = await readWorld();
    if (p0 && p0.hero && p1 && p1.hero && p2 && p2.hero) {
      const dx = p1.hero.x - p0.hero.x, dyUp = p2.hero.y - p1.hero.y;
      ax = Math.sign(dx) || 1;
      ay = -(Math.sign(dyUp) || 1);
      console.log('calibrate: dx=' + dx + ' dyUp=' + dyUp + ' => ax=' + ax + ' ay=' + ay);
    } else console.log('calibrate failed, assume ax=1 ay=-1');
  }

  const samples = [];
  let died = false, deathT = null, win = false, winT = null;
  let lastIds = '', lastWood = 0, lastWave = '';
  const popup0 = popupCount;
  let cur = { x: 0, y: -1 };
  let lastLog = -99, lastSave = 0;
  let mode = 'FLEE';
  let engageOn = false; // v36.3: ENGAGE state - hero actively charges monsters (enter hp>0.55, exit hp<0.45)
  let fireBuilt = false, turretBuilt = false, turret2Built = false; // v8/v14: 篝火/炮台(0,600)/解锁炮台(0,-600) 建成标记
  let breakUntil = 0, breakDir = null; // v9: 被围脱困（连续贴身→朝净空最大方向硬冲）
  let lastBreakAt = 0; // v25: 主动穿阵节流（每 7s 至多一次）
  const minHist = []; // v9: 最近 minD 历史
  let commitDir = null, commitUntil = 0; // v22: 方向承诺（治密波抖动）
  let hpHist = []; // v22: 1.5s 创伤监测
  let drainSqs = []; // v23: 未完工免费建造圈（站圈会 1 木/0.1s 喂进度，必须绕开）
  let standStart = 0, buildDone = 0, lastProg = -1, lastProgAt = 0, guardMark = null;
  let buildTarget = null, buildCount = 0;
  const builtCnt = new Map(); // v34: 各建造点已建次数（lim 限次；可重复点会归零重建）
  const siteBlocked = new Map(); // v35: 目标点冷却封锁（abort/卡死后先跳过，防「abort→立刻重入」死循环）
  let lastTrees = -1, lastTreesAt = 0; // v34: STAND 清树监测（圈内有树时）
  let holdUntil = 0, holdPt = null; // v34: HOLD 待机（回家站定 / 偶尔小范围挪两步）
  let frozenMark = null;
  let mvMark = null; // v35: 通用卡死看门狗采样（BUILD/UNLOCK：2s 窗口位移太小=推不动）
  let detourUntil = 0, detourDir = null;
  let detourSign = 1;
  let wpAvoid = null, restUntil = 0;
  let wp = null; // v5: current kite waypoint
  let farmIdx = 0; // v7: perimeter farm patrol index
  const FPTS = [[-345,-320],[-345,0],[-345,320],[-320,350],[140,350],[345,320],[345,0],[345,-320],[320,-360],[0,-360],[-320,-360]]; // v11: 外圈伐木航点（模块级，FARM 起步选最近的）
  // v34 建造清单（实测坐标；lim=可重复建次数）：篝火 → 樵夫×2 → 兵丁 → 射士 → 神机 → 砖墙 → 炮台N/S/W/NE/NW/E/SE/SW
  const BUILD_SITES = [
    { wx: 0, wy: 0, lim: 1, name: '篝火' },
    { wx: -300, wy: 0, lim: 2, name: '樵夫' },
    { wx: 300, wy: 0, lim: 1, name: '兵丁' },
    { wx: -200, wy: -200, lim: 1, name: '射士' },
    { wx: 200, wy: -200, lim: 1, name: '神机' },
    { wx: 0, wy: -300, lim: 1, name: '砖墙' },
    { wx: 0, wy: 600, lim: 1, name: '炮台N' },
    { wx: 0, wy: -600, lim: 1, name: '炮台S' },
    { wx: -600, wy: 0, lim: 1, name: '炮台W' },
    { wx: 424, wy: 424, lim: 1, name: '炮台NE' },
    { wx: -424, wy: 424, lim: 1, name: '炮台NW' },
    { wx: 600, wy: 0, lim: 1, name: '炮台E' },
    { wx: 424, wy: -424, lim: 1, name: '炮台SE' },
    { wx: -424, wy: -424, lim: 1, name: '炮台SW' }
  ];
  let chopSpot = null, farmStall = null, unlockStart = 0; // v14: 驻点砍树 / 卡刀检测 / 解锁计时
  let lastNospotLog = 0; // v35: FARM nospot 日志节流
  let farmNoSpotSince = 0; // v35: 连续选不到砍树点的起点（>3s 就转基地待机）
  let farmSpotStart = null; // v15: 换点日志（本点收益/到达距离）
  const farmBanned = []; // v14: 卡刀被拉黑的簇（60s 内不再选）
  const t0 = Date.now();
  const blockSite = (bx, by, ms, why) => { // v35: 目标点冷却封锁
    siteBlocked.set(bx + ',' + by, Date.now() + ms);
    console.log('*** SITE BLOCK (' + bx + ',' + by + ') ' + Math.round(ms / 1000) + 's why=' + why + ' t+' + ((Date.now() - t0) / 1000).toFixed(0) + 's');
  };

  // v17: 实时泛洪——用当前树况从英雄位置在 20u 网格上求可达域（方向探针模型同 plan-route.js）
  function floodReach(trees, sx, sy) {
    const B = 200;
    const buckets = new Map();
    for (const t of trees) {
      const cx = t[0], cy = t[1] - 70;
      const bk = Math.floor((cx + 1600) / B) + ':' + Math.floor((cy + 1600) / B);
      let a = buckets.get(bk); if (!a) { a = []; buckets.set(bk, a); }
      a.push([cx, cy]);
    }
    const inRect = (x, y) => {
      const bi = Math.floor((x + 1600) / B), bj = Math.floor((y + 1600) / B);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const a = buckets.get((bi + di) + ':' + (bj + dj));
        if (!a) continue;
        for (const r of a) if (Math.abs(x - r[0]) < 75 && Math.abs(y - r[1]) < 75) return true;
      }
      return false;
    };
    const STEP = 20, LIM = 1200;
    const nB = (x, y) => inRect(x, y + 90), sB = (x, y) => inRect(x, y + 40), eB = (x, y) => inRect(x + 30, y + 50), wB = (x, y) => inRect(x - 30, y + 50);
    const kk = (i, j) => i + ',' + j;
    const si = Math.round(sx / STEP), sj = Math.round(sy / STEP);
    const seenSet = new Set([kk(si, sj)]);
    const qArr = [[si, sj]];
    const cells = [];
    let qi = 0;
    while (qi < qArr.length) {
      const [i, j] = qArr[qi++];
      const x = i * STEP, y = j * STEP;
      cells.push({ x, y });
      const moves = [[0, 1, nB(x, y)], [0, -1, sB(x, y)], [1, 0, eB(x, y)], [-1, 0, wB(x, y)]];
      for (const [di2, dj2, blk] of moves) {
        if (blk) continue;
        const ni = i + di2, nj = j + dj2;
        if (Math.abs(ni * STEP) > LIM || Math.abs(nj * STEP) > LIM) continue;
        const nk2 = kk(ni, nj);
        if (seenSet.has(nk2)) continue;
        seenSet.add(nk2);
        qArr.push([ni, nj]);
      }
    }
    return cells;
  }
  function pickChopSpot(w2, h2) {
    const now = Date.now();
    const trees = w2.trees || [];
    if (!trees.length) return null;
    let cells = floodReach(trees, h2.x, h2.y);
    if (cells.length < 60) cells = floodReach(trees, 0, -50); // 英雄在死角：退回中心重泛洪
    const grid = {};
    for (const t2 of trees) {
      const k = Math.round(t2[0] / 150) + ',' + Math.round(t2[1] / 150);
      (grid[k] = grid[k] || []).push(t2);
    }
    let best = null;
    // v18: 桶密度分档 [3,2,1] 逐级放宽——修复 v17b「实距 n150≥3」硬过滤把候选全砍光的回归
    for (const minB of [3, 2, 1]) {
      let bestSc = -1e9;
      for (const k in grid) {
        const arr = grid[k];
        if (arr.length < minB) continue;
        if (farmBanned.some(b => b.key === 'g' + k && now < b.until)) continue;
        let sx = 0, sy = 0;
        for (const p of arr) { sx += p[0]; sy += p[1]; }
        sx /= arr.length; sy /= arr.length;
        if (Math.abs(sx) > 1050 || Math.abs(sy) > 1050) continue; // v20: 不选地图边缘带（v19 英雄在 (1034,-985) 边缘死角卡死）
        // 簇心 150 内最近的可达格
        let bc = null, bd = 1e9;
        for (const c of cells) {
          const dd = Math.hypot(c.x - sx, c.y - sy);
          if (dd <= 150 && dd < bd) { bd = dd; bc = c; }
        }
        if (!bc) continue;
        if (drainSqs.some(q => Math.hypot(q.wx - bc.x, q.wy - bc.y) < 160)) continue; // v23: 驻点贴建造圈=站那儿喂木，跳过
        if (farmBanned.some(b => now < b.until && Math.hypot(b.x - bc.x, b.y - bc.y) < 70)) continue; // 同格已拉黑
        let n150 = 0;
        for (const t2 of trees) if (Math.hypot(t2[0] - bc.x, t2[1] - bc.y) < 150) n150++;
        const heroD = Math.hypot(bc.x - h2.x, bc.y - h2.y);
        if (n150 < 3 && heroD > 500) continue; // v28: 又远又空的簇别选（v27 为它们空跑 10+ 秒）
        if (heroD > 950) continue; // v35: 再好的簇也不为空跑 950+ 去砍（旧版跑到 dist=1529/1672 的远簇，离镜头太远还容易卡）
        let sc = n150 * 220 - heroD * 2.6; // v28: 距离惩罚 1.8→2.6
        if (!turret2Built && Math.hypot(bc.x, bc.y + 500) < 380) sc += 200; // v18: 南簇加强（解锁顺路）
        if (sc > bestSc) { bestSc = sc; best = { x: bc.x, y: bc.y, key: 'g' + k, sc, why: 'g' + k + '(' + arr.length + '/n' + n150 + ')stand(' + bc.x + ',' + bc.y + ')' }; }
      }
      if (best) break;
    }
    return best;
  }
  function clusterEmpty(w2, spot) {
    let n = 0;
    for (const t2 of (w2.trees || [])) if (Math.hypot(t2[0] - spot.x, t2[1] - spot.y) < 150) n++;
    return n <= 2;
  }
  function guardN(h2, dx, dy) { // v29: 北带护栏——北侧 y>560 是树林区，v23/v28 被赶进去卡死
    if (h2.y > 440 && dy > 0) {
      const k = Math.min(1, (h2.y - 440) / 120); // 440→0 渐压，560→1 反向
      dy = (k >= 1) ? -Math.abs(dy) * 0.5 : dy * (1 - k) - Math.abs(dy) * k * 0.5;
    }
    const L = Math.hypot(dx, dy) || 1;
    return { x: dx / L, y: dy / L };
  }

  while ((Date.now() - t0) < RUN_SEC * 1000 && !died) {
    const t = (Date.now() - t0) / 1000;

    // ---- 弹窗处理（奖励/武器）----
    const labels = await snap(s);
    { const wl0 = waveOf(labels); if (wl0) lastWave = wl0; } // v32: 记录到达波次
    if (has(labels, '复活')) { // v32: 基地复活弹窗=这局输了——点取消（「复活」=视频广告，绝不点）
      died = true; deathT = t;
      console.log('*** DIED t+' + t.toFixed(0) + 's ' + (waveOf(labels) || ''));
      ev(t, 'died', waveOf(labels));
      await release();
      const rel = await handleRelive(t);
      console.log('  relive ->', rel);
      await s.shot('b' + battle + '-died.png'); break;
    }
    { // v32: 结算弹窗（BattleWinPopup/BattleLosePopup 都带「完成波数」）——胜/败都在此收口
      const sl = labels.filter(l => l.indexOf('完成波数') >= 0);
      if (sl.length) {
        let full = false;
        for (const x of sl) { const m = /(\d+)\s*\/\s*(\d+)/.exec(x); if (m && m[1] === m[2]) full = true; }
        win = full && !died; if (!win) died = true; // v32: 非满波结算=输（含英雄直接阵亡、无复活弹窗的路径）
        winT = t;
        console.log('*** SETTLE t+' + t.toFixed(0) + 's win=' + win + ' [' + sl.join(' ') + ']');
        ev(t, 'settle-popup', { labels: sl, win });
        await release();
        await s.shot('b' + battle + (win ? '-win.png' : '-lose.png')); break;
      }
    }
    // v14: 解锁炮台弹窗（PAUSE 中）——点「确定/确认」，失败兜底直调 onBtnSure
    if (labels.some(l => l.indexOf('解锁') >= 0 && l.indexOf('炮台') >= 0)) {
      await release();
      const pick = ['确定', '确认'].find(txt => labels.some(x => x.replace(/\s+/g, '').indexOf(txt) >= 0));
      let ok = false;
      if (pick) { const r = await s.clickLabel(pick, { exact: false }); ok = !!(r && r.ok); }
      await sleep(500);
      let l2 = await snap(s);
      if (l2.some(x => x.indexOf('解锁') >= 0 && x.indexOf('炮台') >= 0)) {
        const f = await s.eval(UNLOCK_CONFIRM_SRC);
        console.log('  unlock popup fallback onBtnSure:', JSON.stringify(f));
      }
      await sleep(300);
      console.log('  unlock popup handled t+' + t.toFixed(0) + 's btn=' + pick + ' ok=' + ok + ' wood=' + (await readWorld() || {}).wood);
      ev(t, 'unlock-popup', { btn: pick, ok });
    }
    const reward = labels.some(l => l.indexOf('选择一个奖励') >= 0 || l.indexOf('升级奖励') >= 0);
    const weapon = labels.some(l => l.indexOf('近战武器') >= 0);
    if (reward || weapon) {
      await release();
      if (reward) {
        popupCount++;
        const r = await closeRewardPopup(t);
        console.log('  popup#' + popupCount + ':', r);
        await s.shot('popup-' + popupCount + '-after.png');
      } else {
        // 武器弹窗（WeaponAddPopup）：不放暂停游戏 → 处理要快；只点 免费/取消/放弃，绝不点 视频（广告）
        const w0 = await readWorld();
        const order = ['免费', '取消', '放弃', '确定'];
        const btn = order.find(txt => labels.some(x => x.replace(/\s+/g, '').indexOf(txt) >= 0));
        let ok = false;
        if (btn) {
          const r = await s.clickLabel(btn, { exact: false });
          ok = !!(r && r.ok);
          // 放弃/取消后：在脚下划一个 45 秒躲避区（掉落物还在，站着不动会无限重触发）
          if (btn !== '免费' && w0 && w0.hero) wpAvoid = { x: w0.hero.x, y: w0.hero.y, until: Date.now() + 45000 };
        }
        await sleep(600);
        const l2 = await snap(s);
        const stillOpen = l2.some(x => x.indexOf('近战武器') >= 0);
        const w1 = stillOpen ? null : await readWorld();
        console.log('  weapon popup: btn=' + btn + ' ok=' + ok + (stillOpen ? ' STILL-OPEN' : '') +
          ' wpn ' + (w0 && w0.wpn) + '->' + (w1 ? w1.wpn : '?'));
      }
      await sleep(400);
    }

    // v35: 「恭喜获得」奖励弹窗（宝箱/遗物类，会把游戏暂停住）——只点「普通领取」，绝不点「5倍领取」（视频广告）
    if (!has(labels, '完成波数') && !has(labels, '复活') && (has(labels, '恭喜获得') || labels.some(l => l.indexOf('倍领取') >= 0))) {
      await release();
      const rgba = await s.clickLabel('普通领取', { exact: true });
      console.log('  gain popup claim ok=' + (rgba && rgba.ok) + ' t+' + t.toFixed(0) + 's');
      ev(t, 'gain-claim', { ok: !!(rgba && rgba.ok) });
      await sleep(900);
      if (has(await snap(s), '恭喜获得')) {
        const rgba2 = await s.clickLabel('普通领取', { exact: true });
        console.log('  gain popup retry ok=' + (rgba2 && rgba2.ok));
      }
    }

    const w = await readWorld();
    if (!w || !w.hero) { await sleep(UPDATE_MS); continue; }
    const h = w.hero;

    // ---- 冻结看门狗 v15：3 秒窗口位移 <70 → 判定卡住（修 v13 滑动卡死漏检：缓速贴墙滑 10-20u/步永远凑不齐"4次<20"）
    if ((mode === 'FLEE' || mode === 'FARM') && pressed) {
      if (!frozenMark || frozenMark.at === undefined) frozenMark = { x: h.x, y: h.y, at: Date.now(), flip: 0 };
      if (Date.now() - frozenMark.at > 1800) { // v24: 3s→1.8s（v23 死前 2s 内被追死来不及触发）
        const moved = Math.hypot(h.x - frozenMark.x, h.y - frozenMark.y);
        if (moved < 55) { // v24: 70→55
          const ps2 = await popupState();
          const popN = (ps2.popups || []).filter(n => n !== 'BattleBoxPopup'); // v20: BattleBoxPopup 是常驻框体，误判会让英雄卡到死
          if (ps2.open || ps2.nCards > 0) {
            const r = await closeRewardPopup(t);
            console.log('*** STUCK+popup t+' + t.toFixed(0) + 's ->', r);
          } else {
            let uiErr = false;
            if (popN.length) {
              const r = await s.eval(FALLBACK_REMOVEUI);
              console.log('*** STUCK removeUI(' + popN.join(',') + ') ->', JSON.stringify(r));
              ev(t, 'stuck-removeUI', { popups: popN, r });
              uiErr = !!(r && r.err);
            }
            if (!popN.length || uiErr) {
              let nd = 9999, gx = 0, gy = 0;
              for (const m of w.monsters) { const d = Math.hypot(h.x - m.x, h.y - m.y); if (d < nd) nd = d; gx += m.x; gy += m.y; }
              if (w.monsters.length && nd < 260) {
                // 被怪贴住：朝远离怪群质心方向冲
                gx /= w.monsters.length; gy /= w.monsters.length;
                const bx = h.x - gx, by = h.y - gy, bl = Math.hypot(bx, by) || 1;
                detourDir = guardN(h, bx / bl, by / bl); // v29: 北带护栏
                detourUntil = Date.now() + 900;
                wp = null;
              } else {
                // 撞地形：朝目标方向两侧 ±75°/±126° 轮换硬冲
                let bx = cur.x, by = cur.y;
                if (mode === 'FARM' && chopSpot) {
                  const gx2 = chopSpot.x - h.x, gy2 = chopSpot.y - h.y, gl2 = Math.hypot(gx2, gy2) || 1;
                  bx = gx2 / gl2; by = gy2 / gl2;
                  if (gl2 > 60) { // v20: 离目标还远却撞墙 → 点在墙那边，拉黑 60s 换点
                    farmBanned.push({ key: chopSpot.key, x: chopSpot.x, y: chopSpot.y, until: Date.now() + 60000 });
                    console.log('*** STUCK ban FARM spot ' + chopSpot.key + ' at(' + chopSpot.x + ',' + chopSpot.y + ') t+' + t.toFixed(0));
                    ev(t, 'stuck-ban-spot', { key: chopSpot.key, x: chopSpot.x, y: chopSpot.y });
                    chopSpot = null; farmStall = null;
                  }
                }
                const flip = (frozenMark.flip = ((frozenMark.flip || 0) + 1) % 4);
                const ang = [1.3, -1.3, 2.2, -2.2][flip];
                detourDir = guardN(h, bx * Math.cos(ang) - by * Math.sin(ang), bx * Math.sin(ang) + by * Math.cos(ang)); // v29: 北带护栏
                detourUntil = Date.now() + 1400;
                wp = null;
              }
              cur = { x: detourDir.x, y: detourDir.y };
              console.log('*** STUCK(' + mode + ') detour(' + detourDir.x.toFixed(2) + ',' + detourDir.y.toFixed(2) + ') at (' + h.x + ',' + h.y + ') t+' + t.toFixed(0) + 's');
              ev(t, 'stuck-detour', { x: h.x, y: h.y, mode });
              // v35: 同一处反复推不动 → 打一份标签快照（下次遇到未知暂停弹窗一眼就能定位）
              frozenMark.n = (frozenMark.n || 0) + 1;
              if (frozenMark.n >= 3 && Date.now() - (frozenMark.dbgAt || 0) > 10000) {
                frozenMark.dbgAt = Date.now();
                const ldbg = await snap(s);
                console.log('  STUCK-dump(' + frozenMark.n + ' x) labels=' + JSON.stringify(ldbg.filter(l => l.length < 20).slice(0, 16)));
              }
            }
          }
          frozenMark = { x: h.x, y: h.y, at: Date.now(), flip: frozenMark.flip };
        } else {
          frozenMark = { x: h.x, y: h.y, at: Date.now(), flip: frozenMark.flip };
        }
      }
    } else frozenMark = null;

    // v35: 通用卡死看门狗——BUILD/UNLOCK 按着方向却挪不动时：先侧向脱困（±75°/±126° 轮换），连撞 3 次 → 封锁该点 + 强制回 FLEE 导航回家
    if ((mode === 'BUILD' || mode === 'UNLOCK') && pressed) {
      if (!mvMark) mvMark = { x: h.x, y: h.y, at: Date.now(), n: 0 };
      if (Date.now() - mvMark.at >= 2000) {
        const moved = Math.hypot(h.x - mvMark.x, h.y - mvMark.y);
        const md0 = mode;
        if (moved < 26) {
          mvMark.n = (mvMark.n || 0) + 1;
          if (mvMark.n >= 3) {
            if (buildTarget) blockSite(buildTarget.wx, buildTarget.wy, 25000, 'stuck-' + md0);
            const cd = Math.hypot(h.x, h.y) || 1;
            detourDir = { x: -h.x / cd, y: -h.y / cd }; detourUntil = Date.now() + 2500;
            wp = null; buildTarget = null;
            console.log('*** STUCK3(' + md0 + ') force-home at(' + h.x + ',' + h.y + ') t+' + t.toFixed(0) + 's');
            ev(t, 'stuck3-home', { x: h.x, y: h.y, mode: md0 });
            mode = 'FLEE';
          } else {
            const angv = [1.3, -1.3, 2.2, -2.2][(mvMark.n - 1) % 4];
            const bx = cur.x, by = cur.y;
            detourDir = guardN(h, bx * Math.cos(angv) - by * Math.sin(angv), bx * Math.sin(angv) + by * Math.cos(angv));
            detourUntil = Date.now() + 1500; wp = null;
            console.log('*** STUCK-wiggle(' + md0 + ') n=' + mvMark.n + ' at(' + h.x + ',' + h.y + ') t+' + t.toFixed(0) + 's');
          }
          mvMark = { x: h.x, y: h.y, at: Date.now(), n: mvMark.n };
        } else {
          mvMark = { x: h.x, y: h.y, at: Date.now(), n: 0 };
        }
      }
    } else if (mvMark) mvMark = null;

    let mx = 0, my = 0, minD = 9999;
    let rangedN = 0, mt2N = 0, huntX = 0, huntY = 0, huntD = 1e9; // v23: 远程怪统计；v24: mt2N 对照
    for (const m of w.monsters) {
      const dx = h.x - m.x, dy = h.y - m.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < minD) minD = d;
      const wt = 1 / ((d + 40) * (d + 40));
      mx += (dx / d) * wt; my += (dy / d) * wt;
      if (m.bspd > 0) { rangedN++; if (d < huntD) { huntD = d; huntX = m.x - h.x; huntY = m.y - h.y; } }
      if (m.mt === 2) mt2N++; // v24: GameEnum LONG_DIS=2，对照 bspd 判定是否偏多
    }
    let huntDir = null; // v24: 清射手收着改——怪群没贴脸(minD>170)才许贴
    if (rangedN >= 3 && huntD > 150 && minD > 170 && w.hp !== null && w.hp > 0.35) {
      const hl = Math.hypot(huntX, huntY) || 1;
      huntDir = { x: huntX / hl, y: huntY / hl };
    }
    drainSqs = (w.squares || []).filter(s => !s.lock && s.prog < s.max); // v23: 未完免费建造圈

    // v22: 怪群质心 + 创伤急刹（PANIC）——1.5s 掉血 ≥0.15 立即背离质心硬突 1.4s
    let mcx = h.x, mcy = h.y;
    if (w.monsters.length) {
      mcx = 0; mcy = 0;
      for (const m of w.monsters) { mcx += m.x; mcy += m.y; }
      mcx /= w.monsters.length; mcy /= w.monsters.length;
    }
    if (w.hp !== null && w.monsters.length > 0) {
      const nowP = Date.now();
      hpHist = hpHist.filter(r => nowP - r.at < 1500);
      hpHist.push({ at: nowP, v: w.hp });
      const hiP = hpHist.reduce((a, r) => Math.max(a, r.v), w.hp);
      if (hiP - w.hp >= 0.15) {
        let ax2 = h.x - mcx, ay2 = h.y - mcy;
        // v24: 贴边时 PANIC 方向内偏（v23 连续往西北突围顶进北树林卡死）
        const dcE = Math.hypot(h.x, h.y) || 1;
        if (Math.abs(h.x) > 460 || Math.abs(h.y) > 440) {
          ax2 = ax2 * 0.55 + (-h.x / dcE) * 0.85;
          ay2 = ay2 * 0.55 + (-h.y / dcE) * 0.85;
        }
        const L2p = Math.hypot(ax2, ay2) || 1;
        ax2 /= L2p; ay2 /= L2p;
        { const gN1 = guardN(h, ax2, ay2); ax2 = gN1.x; ay2 = gN1.y; } // v29: 北带护栏——panic 不许往北树林带冲
        breakDir = { x: ax2, y: ay2 }; breakUntil = nowP + 1400; commitDir = null;
        hpHist = [{ at: nowP, v: w.hp }];
        console.log('*** PANIC hp=' + w.hp.toFixed(2) + ' mons=' + w.monsters.length + ' minD=' + Math.round(minD) + ' dir(' + ax2.toFixed(2) + ',' + ay2.toFixed(2) + ') t+' + t.toFixed(0) + 's');
        ev(t, 'panic', { hp: Math.round(w.hp * 100) / 100, mons: w.monsters.length });
      }
    }

    // v9 围攻脱困：最近 5 个采样里 3 次 minD<110 → 选 32 方向里 1.8s 远期净空最大的方向硬冲 0.9s
    if (mode === 'FLEE' || mode === 'FARM') {
      minHist.push(minD);
      if (minHist.length > 5) minHist.shift();
    }
    // v36.3: ENGAGE state machine (hysteresis) - hero goes and fights when monsters are around.
    if (mode === 'FLEE') {
      if (w.monsters.length === 0) {
        if (engageOn) { engageOn = false; console.log('ENGAGE off (clear) t+' + t.toFixed(0) + 's'); ev(t, 'engage-off', { why: 'clear' }); }
      } else if (w.hp === null) {
        if (!engageOn) { engageOn = true; console.log('*** ENGAGE on (hp?) mons=' + w.monsters.length + ' t+' + t.toFixed(0) + 's'); ev(t, 'engage-on', { mons: w.monsters.length }); }
      } else if (!engageOn && w.hp > 0.55) {
        engageOn = true;
        console.log('*** ENGAGE on hp=' + w.hp.toFixed(2) + ' mons=' + w.monsters.length + ' minD=' + Math.round(minD) + ' t+' + t.toFixed(0) + 's');
        ev(t, 'engage-on', { hp: Math.round(w.hp * 100) / 100, mons: w.monsters.length });
      } else if (engageOn && w.hp < 0.45) {
        engageOn = false;
        console.log('ENGAGE off hp=' + w.hp.toFixed(2) + ' t+' + t.toFixed(0) + 's');
        ev(t, 'engage-off', { hp: Math.round(w.hp * 100) / 100 });
      }
    }
    const raidReady = (mode === 'FLEE') && w.monsters.length >= 5 && w.monsters.length <= 24 && w.hp !== null && w.hp > 0.58 && minD < 420 && Date.now() > breakUntil && Date.now() - lastBreakAt > 7500; // v30: minD 300→420
    // v30: GRIND 预判——血足+怪 3~16 只贴身时进入贴身绞肉（v24 实证的杀怪主力；v25-29 缺的就是它）
    const grindNow = w.hp !== null && w.hp > 0.45 && w.monsters.length >= 3 && w.monsters.length <= 18 && minD < 220 && Date.now() > breakUntil; // v31: 0.5/16→0.45/18
    // v28: 残局催杀——FLEE 中剩 1~6 只怪且血>0.45 时，复用「迎击最近怪」逻辑贴上收干净
    //   （v27 死因2：残局保持距离不敢贴 → 全清不了 → REST 不触发 → 新批叠加猝死）
    const cleanup = (mode === 'FLEE') && w.monsters.length > 0 && w.monsters.length <= 6 && w.hp !== null && w.hp > 0.32 && Date.now() > breakUntil && Date.now() - lastBreakAt > 2500; // v31: 0.45→0.32
    if (!engageOn && !grindNow && minHist.length >= 4 && (minHist.filter(d => d < 130).length >= 3 || raidReady || cleanup) && Date.now() > breakUntil && w.monsters.length > 0) { // v30: 绞肉中不撤退
      let bd = null, bScore = -1e9, bGap = 0; // v27: bGap 单独记净空（bScore 混入方向权重）
      let nrdx = 0, nrdy = 0; // v27: 最近怪方向（袭击态向它偏）
      if (raidReady || cleanup) { // v28: 残局催杀同样偏向最近怪
        let nd2 = 9999;
        for (const m of w.monsters) { const d2 = Math.hypot(m.x - h.x, m.y - h.y) || 1; if (d2 < nd2) { nd2 = d2; nrdx = (m.x - h.x) / d2; nrdy = (m.y - h.y) / d2; } }
      }
      for (let k = 0; k < 32; k++) {
        const th = (k * Math.PI) / 16;
        const dx = Math.cos(th), dy = Math.sin(th);
        if (h.y > 460 && dy > 0.35) continue; // v29: 北带护栏——贴北树林禁向北穿
        let mGap = 9999;
        for (let s4 = 1; s4 <= 8; s4++) {
          const sT = 0.3 * s4, st = 84 * s4;
          let nx = h.x + dx * st, ny = h.y + dy * st;
          if (nx > 520) nx = 520; else if (nx < -520) nx = -520;
          if (ny > 500) ny = 500; else if (ny < -500) ny = -500;
          for (const m of w.monsters) {
            const rxm = h.x - m.x, rym = h.y - m.y, rmn = Math.hypot(rxm, rym) || 1;
            const mx2 = m.x + (rxm / rmn) * 160 * sT, my2 = m.y + (rym / rmn) * 160 * sT;
            const gg = Math.hypot(nx - mx2, ny - my2);
            if (gg < mGap) mGap = gg;
          }
        }
        const sc2 = mGap + ((raidReady || cleanup) ? (dx * nrdx + dy * nrdy) * 90 : 0); // v27: 袭击态偏向最近怪方向；v28: 催杀同偏
        if (sc2 > bScore) { bScore = sc2; bGap = mGap; bd = { x: dx, y: dy }; }
      }
      const gapNeed = (raidReady || cleanup) ? 100 : 130; // v25: 主动袭击缺口门槛降低；v28: 催杀同门槛
      if (bd && bGap >= gapNeed) {
        breakDir = bd; breakUntil = Date.now() + 900; lastBreakAt = Date.now();
        const tag = cleanup ? '*** CLEAN ' : ((raidReady && minHist.filter(d => d < 130).length < 3) ? '*** RAID ' : '*** BREAKOUT '); // v28
        console.log(tag + 'dir(' + bd.x.toFixed(2) + ',' + bd.y.toFixed(2) + ') gap=' + Math.round(bGap) + ' minD=' + Math.round(minD) + ' t+' + t.toFixed(0) + 's');
        ev(t, 'breakout', { gap: Math.round(bGap), minD: Math.round(minD), raid: raidReady, clean: cleanup });
      }
      minHist.length = 0;
    }

    // v14 建造队列：篝火(30,站圈) → 炮台(0,600)(45,站圈) → 解锁炮台(0,-600)(100,弹窗瞬建)
    if (!fireBuilt && w.squares.some(q => q.max === 30 && q.wx === 0 && q.wy === 0 && q.prog >= q.max)) fireBuilt = true;
    if (!turretBuilt && !w.squares.some(q => q.wx === 0 && q.wy === 600)) turretBuilt = true; // 节点消失=已建成
    if (!turret2Built) { const q2v = w.squares.find(q => q.wx === 0 && q.wy === -600); if (!q2v || !q2v.lock) turret2Built = true; }
    const markBuilt = (bx2, by2) => { // v34: 建成记账（含旧 fire/turret 标记，评分启发式还在用）
      const key = bx2 + ',' + by2;
      builtCnt.set(key, (builtCnt.get(key) || 0) + 1);
      if (bx2 === 0 && by2 === 0) fireBuilt = true;
      if (bx2 === 0 && by2 === 600) turretBuilt = true;
      if (bx2 === 0 && by2 === -600) turret2Built = true;
      const site = BUILD_SITES.find(s2 => s2.wx === bx2 && s2.wy === by2);
      return site ? site.name : '?';
    };
    const nextTarget = () => { // v34: 建造队列 v2——按 BUILD_SITES 顺序找下一个可建的；锁定点 wood 够就走 UNLOCK
      for (const site of BUILD_SITES) {
        const key = site.wx + ',' + site.wy;
        if ((builtCnt.get(key) || 0) >= site.lim) continue;
        if ((siteBlocked.get(key) || 0) > Date.now()) continue; // v35: 封锁中（卡死/中断冷却）先跳过
        const q = w.squares.find(s2 => s2.wx === site.wx && s2.wy === site.wy);
        if (!q) { builtCnt.set(key, site.lim); continue; } // 节点不存在=本关没有/已建完（消失型）
        if (q.lock) {
          const cost = q.cost || 100;
          if (cost > 300) { builtCnt.set(key, site.lim); continue; } // 解锁太贵（关卡间 cost 会变）→ 跳过防卡队列
          return { kind: 'unlock', wx: site.wx, wy: site.wy, need: cost, name: site.name };
        }
        if (q.max > 0 && q.prog < q.max) return { kind: 'build', wx: site.wx, wy: site.wy, need: (q.max - q.prog) + 3, name: site.name };
        builtCnt.set(key, site.lim); // max=0 / 已满且不可重复 → 记满
      }
      return { kind: 'none', wx: 0, wy: 0, need: 30 };
    };
    if (mode === 'FLEE') {
      const tgt = nextTarget();
      const need = tgt.need;
      const fireReady = fireBuilt;
      if (tgt.kind === 'build' && w.wood >= need && minD > 380 && Math.abs(h.x) < 620 && Math.abs(h.y) < 620) { // v35: 人在树环深处先回家再开工
        buildTarget = { wx: tgt.wx, wy: tgt.wy, name: tgt.name }; mode = 'BUILD';
        console.log('BUILD start t+' + t.toFixed(0) + 's node(' + tgt.wx + ',' + tgt.wy + ') ' + tgt.name + ' need=' + need + ' wood=' + w.wood + ' minD=' + Math.round(minD));
      } else if (tgt.kind === 'unlock' && w.wood >= need && minD > 230 && Math.abs(h.x) < 620 && Math.abs(h.y) < 620) { // v25: 280→230 抢窗口；v35: 同上先回家
        buildTarget = { wx: tgt.wx, wy: tgt.wy, name: tgt.name };
        mode = 'UNLOCK'; unlockStart = Date.now();
        console.log('UNLOCK start t+' + t.toFixed(0) + 's node(' + tgt.wx + ',' + tgt.wy + ') ' + tgt.name + ' need=' + need + ' wood=' + w.wood + ' minD=' + Math.round(minD));
      } else if (fireReady && w.monsters.length === 0 && w.hp !== null && w.hp < 0.9) {
        mode = 'REST'; restUntil = t + 40;
        console.log('REST start t+' + t.toFixed(0) + 's hp=' + w.hp.toFixed(2));
      } else if (tgt.kind !== 'none' && w.monsters.length === 0 && w.wood < need + 3) { // v21: 只在全清空窗开农（残局优先催杀）
        wp = null; chopSpot = null;
        if (w.trees.length > 0) {
          mode = 'FARM';
          console.log('FARM start t+' + t.toFixed(0) + 's wood=' + w.wood + ' need=' + need + ' mons=' + w.monsters.length + ' target=' + tgt.kind + '(' + tgt.wx + ',' + tgt.wy + ') ' + tgt.name);
        } else { // v35: 地图上树被清光（木头全靠樵夫产）→ 回基地待机等木，别在空场上乱晃
          mode = 'WAIT'; farmNoSpotSince = 0;
          console.log('WAIT start t+' + t.toFixed(0) + 's wood=' + w.wood + ' need=' + need + ' (no trees left)');
        }
      } else if (tgt.kind === 'none' && w.monsters.length === 0 && (w.hp === null || w.hp >= 0.9)) { // v34: 全建完+无怪+血足 → 待机
        mode = 'HOLD'; holdUntil = 0; holdPt = null;
        console.log('HOLD start t+' + t.toFixed(0) + 's bld=' + buildCount + ' wood=' + w.wood);
      }
    }
    if (mode === 'FLEE') {
      // ===== v5 KITE: straight-line waypoint runs =====
      // measured: monster 160 u/s vs hero 280 u/s -> keep running, never oscillate.
      // campfire at (0,0) heals 15hp/2s inside r=250 (v8: fireBuilt flag, node vanishes after build).
      const centerD = Math.hypot(h.x, h.y) || 1;
      const hpLow = fireBuilt && w.hp !== null && w.hp < 0.75;
      let ringSteer = null;
      if (fireBuilt && !engageOn && w.hp !== null && w.hp < 0.78 && w.monsters.length > 0 && w.monsters.length <= (w.hp < 0.42 ? 26 : 18) && minD > 150) {
        // v8 回血环：在篝火圈（r250）内绕中心 r≈190 环跑——移动中也在回血（15hp/2s）
        const urx = h.x / centerD, ury = h.y / centerD;
        const t1 = { x: -ury, y: urx }, t2 = { x: ury, y: -urx };
        const probe = (tx, ty) => {
          let g = 9999;
          for (let s3 = 1; s3 <= 4; s3++) {
            const sT = 0.35 * s3, st = 98 * s3;
            const nx = h.x + tx * st, ny = h.y + ty * st;
            for (const m of w.monsters) {
              const rxm = h.x - m.x, rym = h.y - m.y, rmn = Math.hypot(rxm, rym) || 1;
              const mx2 = m.x + (rxm / rmn) * 160 * sT, my2 = m.y + (rym / rmn) * 160 * sT;
              const gg = Math.hypot(nx - mx2, ny - my2);
              if (gg < g) g = gg;
            }
          }
          return g;
        };
        const pA = probe(t1.x, t1.y) + (cur.x * t1.x + cur.y * t1.y) * 40;
        const pB = probe(t2.x, t2.y) + (cur.x * t2.x + cur.y * t2.y) * 40;
        if (Math.max(pA, pB) >= 150) {
          const tt = pA >= pB ? t1 : t2;
          const lowHome = w.hp < 0.42 && centerD > 235; // v22: 低血归巢——强拉回圈，不许荡出去
          const pull = lowHome ? 1.55 : Math.max(-0.9, Math.min(1.2, (centerD - 185) / 140));
          const tw = lowHome ? 0.45 : 1.0;
          const dvx = tt.x * tw - urx * pull, dvy = tt.y * tw - ury * pull;
          const dvL = Math.hypot(dvx, dvy) || 1;
          ringSteer = { x: dvx / dvL, y: dvy / dvL };
        }
      }
      // v30: GRIND 贴身绞肉——切向绕怪群骑边 + 微内旋，让武器连续收割（避开喂木建造圈）
      let grindDir = null;
      if (grindNow || engageOn) {
        let gcx = 0, gcy = 0;
        for (const m of w.monsters) { gcx += m.x; gcy += m.y; }
        gcx /= w.monsters.length; gcy /= w.monsters.length;
        let rx = h.x - gcx, ry = h.y - gcy, rl = Math.hypot(rx, ry) || 1;
        if (rl < 50) { // v31: 被围成圈时质心≈自身、切向退化——改用最近怪当外沿参照
          let nm2 = null, nd2 = 1e9;
          for (const m of w.monsters) { const dd = Math.hypot(m.x - h.x, m.y - h.y); if (dd < nd2) { nd2 = dd; nm2 = m; } }
          if (nm2) { rx = h.x - nm2.x; ry = h.y - nm2.y; rl = Math.hypot(rx, ry) || 1; }
        }
        let tx2 = -ry / rl, ty2 = rx / rl;
        if (tx2 * cur.x + ty2 * cur.y < 0) { tx2 = -tx2; ty2 = -ty2; } // 与当前朝向同侧，防原地打转
        let dvx2 = tx2 - (rx / rl) * 0.35, dvy2 = ty2 - (ry / rl) * 0.35;
        for (const q of drainSqs) { // 别贴未完工建造圈骑（站圈=1 木/0.1s）
          const dq = Math.hypot(h.x - q.wx, h.y - q.wy);
          if (dq < 220) { const wgt = ((220 - dq) / 220) * 0.9; dvx2 += ((h.x - q.wx) / (dq || 1)) * wgt; dvy2 += ((h.y - q.wy) / (dq || 1)) * wgt; }
        }
        const gN2 = guardN(h, dvx2, dvy2);
        grindDir = { x: gN2.x, y: gN2.y };
      }
      if (engageOn && !(breakDir && Date.now() < breakUntil)) {
        // v36.3: ENGAGE - charge the nearest monster; once close, circle the pack (grind) so weapons keep killing.
        if (minD <= 150 && grindDir) {
          cur = grindDir; wp = null;
          await hold({ x: cur.x * ax, y: cur.y * ay });
        } else {
          let nmE = null, ndE = 1e9;
          for (const m of w.monsters) { const dd = Math.hypot(m.x - h.x, m.y - h.y); if (dd < ndE) { ndE = dd; nmE = m; } }
          let dxE = nmE ? (nmE.x - h.x) : cur.x, dyE = nmE ? (nmE.y - h.y) : cur.y;
          const lE = Math.hypot(dxE, dyE) || 1;
          const gE = guardN(h, dxE / lE, dyE / lE);
          cur = { x: gE.x, y: gE.y }; wp = null;
          await hold({ x: cur.x * ax, y: cur.y * ay });
        }
      } else if (breakDir && Date.now() < breakUntil) {
        cur = breakDir;
        await hold({ x: cur.x * ax, y: cur.y * ay });
      } else if (w.monsters.length >= 1 && w.monsters.length <= 2 && (w.hp === null || w.hp > 0.25)) { // v31: 0.42→0.25——收干净优先
        // v21 残局催杀：剩 1~2 只直接贴上去让武器收割——拖住残怪=下一批照常刷新（~31s 周期），差一只就是灾难
        let nm = null, ndm = 1e9;
        for (const m of w.monsters) { const dd = Math.hypot(m.x - h.x, m.y - h.y); if (dd < ndm) { ndm = dd; nm = m; } }
        const ddx2 = nm.x - h.x, ddy2 = nm.y - h.y, L2 = Math.hypot(ddx2, ddy2) || 1;
        cur = { x: ddx2 / L2, y: ddy2 / L2 };
        await hold({ x: cur.x * ax, y: cur.y * ay });
      } else if (grindDir) { // v31: GRIND 提前到回血环之前——血<0.78 时回血环不再抢走控制权
        cur = grindDir; wp = null;
        await hold({ x: cur.x * ax, y: cur.y * ay });
      } else if (ringSteer) {
        cur = ringSteer;
        await hold({ x: cur.x * ax, y: cur.y * ay });
      } else if (detourDir && Date.now() < detourUntil) {
        cur = { x: detourDir.x, y: detourDir.y };
        await hold({ x: cur.x * ax, y: cur.y * ay });
      } else {
        const SAFE_X = 520, SAFE_Y = 500; // v21: 外扩到树环——交战扫林顺路捡木
        const RUN = minD < 140 ? 520 : 760;
        if (minD < 160) wp = null;
        if (!wp || Date.now() > wp.until || Math.hypot(wp.x - h.x, wp.y - h.y) < 80) {
          const curA = Math.atan2(cur.y, cur.x) || 0;
          const inSq = drainSqs.find(q => Math.hypot(h.x - q.wx, h.y - q.wy) < 125); // v23: 人在建造圈里 → 逃逸
          let best = null, bestScore = -1e9;
          for (let k = 0; k < 32; k++) {
            const th = (k * Math.PI) / 16;
            const dx = Math.cos(th), dy = Math.sin(th);
            let maxL = RUN;
            if (dx > 1e-6) maxL = Math.min(maxL, (SAFE_X - h.x) / dx);
            if (dx < -1e-6) maxL = Math.min(maxL, (-SAFE_X - h.x) / dx);
            if (dy > 1e-6) maxL = Math.min(maxL, (SAFE_Y - h.y) / dy);
            if (dy < -1e-6) maxL = Math.min(maxL, (-SAFE_Y - h.y) / dy);
            maxL = Math.max(0, Math.min(maxL, RUN));
            const tx = h.x + dx * maxL, ty = h.y + dy * maxL;
            let minGap = 9999, freeLen = 0, sqBad = 0;
            for (let s2 = 1; s2 <= 8; s2++) {
              const sT = 0.3 * s2, st = 84 * s2;
              let nx = h.x + dx * st, ny = h.y + dy * st;
              if (nx > SAFE_X) nx = SAFE_X; else if (nx < -SAFE_X) nx = -SAFE_X;
              if (ny > SAFE_Y) ny = SAFE_Y; else if (ny < -SAFE_Y) ny = -SAFE_Y;
              if (st <= maxL + 1) freeLen = st;
              for (const m of w.monsters) {
                const rxm = h.x - m.x, rym = h.y - m.y;
                const rm = Math.hypot(rxm, rym) || 1;
                const mx2 = m.x + (rxm / rm) * 160 * sT, my2 = m.y + (rym / rm) * 160 * sT;
                const g = Math.hypot(nx - mx2, ny - my2);
                if (g < minGap) minGap = g;
              }
              for (const q of drainSqs) {
                const dq = Math.hypot(nx - q.wx, ny - q.wy);
                if (dq < 130 && 130 - dq > sqBad) sqBad = 130 - dq; // v23: 穿建造圈=喂木，重罚
              }
            }
            let al = Math.abs(th - curA); if (al > Math.PI) al = 2 * Math.PI - al;
            let score = Math.min(minGap, 620) + freeLen * 0.25 - al * (minD < 140 ? 10 : 22);
            if (minGap < 120) score += (minGap - 120) * 3.5; // v22: 接触裕度重罚——不许贴身掠过
            if (commitDir && Date.now() < commitUntil) score += (dx * commitDir.x + dy * commitDir.y) * 85; // v22: 方向承诺
            if (huntDir) score += (dx * huntDir.x + dy * huntDir.y) * 45; // v24: 清射手 80→45（防拽进怪堆）
            if (sqBad > 0) score -= sqBad * 2.5; // v23: 建造圈重罚
            if (h.y > 430 && dy > 0) score -= (h.y - 430) * 2.0 * dy; // v29: 贴北时压北向候选
            if (inSq) { const ex = h.x - inSq.wx, ey = h.y - inSq.wy, el = Math.hypot(ex, ey) || 1; score += ((dx * ex + dy * ey) / el) * 90; } // v23: 圈内逃逸
            if (hpLow && centerD > 220 && w.monsters.length <= 8) {
              score += (dx * (-h.x / centerD) + dy * (-h.y / centerD)) * 70;
            }
            if (turretBuilt && !hpLow && h.y < 150) {
              score += dy * 26; // 炮台(0,600)射程只覆盖上半区：风筝时尽量把怪带进火力圈
            }
            if (turret2Built && !hpLow && h.y > -150) {
              score += -dy * 22; // v14: 解锁炮台(0,-600)覆盖下半区
            }
            if (w.monsters.length >= 12 && centerD < 380) {
              score += (dx * (h.x / centerD) + dy * (h.y / centerD)) * 55; // v12: 大波次反"口袋中心"陷阱——往合围圈外冲，别往空心处钻
            }
            if (score > bestScore) { bestScore = score; best = { x: dx, y: dy, tx: tx, ty: ty }; }
          }
          if (!best) best = { x: 1, y: 0, tx: h.x + 400, ty: h.y };
          if (Math.hypot(best.tx - h.x, best.ty - h.y) < 60) {
            // v29: 兜底延伸也夹进安全框（v28 死因：夹短后无框延伸，人被一路推向北 y=851）
            best = { x: best.x, y: best.y,
              tx: Math.max(-SAFE_X + 50, Math.min(SAFE_X - 50, h.x + best.x * 300)),
              ty: Math.max(-SAFE_Y + 50, Math.min(SAFE_Y - 50, h.y + best.y * 300)) };
          }
          commitDir = { x: best.x, y: best.y }; commitUntil = Date.now() + (minD < 140 ? 800 : 1500); // v22/v34: 承诺 650/1100→800/1500
          const jx = (Math.random() * 2 - 1) * 25, jy = (Math.random() * 2 - 1) * 25; // v34: 航点 ±25 抖动（去网格感）
          wp = { x: Math.round(Math.max(-SAFE_X + 50, Math.min(SAFE_X - 50, best.tx + jx))), y: Math.round(Math.max(-SAFE_Y + 50, Math.min(SAFE_Y - 50, best.ty + jy))), until: Date.now() + (minD < 140 ? 500 : minD < 300 ? 900 : 1800) }; // v34: 腿 260/420/800→500/900/1800
        }
        const ddx = wp.x - h.x, ddy = wp.y - h.y;
        const L = Math.hypot(ddx, ddy) || 1;
        cur = { x: ddx / L, y: ddy / L };
        await hold({ x: cur.x * ax, y: cur.y * ay });
      }
    } else if (mode === 'BUILD') {
      const q = buildTarget && w.squares.find(s => s.wx === buildTarget.wx && s.wy === buildTarget.wy);
      const builtNow = buildTarget && (!q || (q.max > 0 && q.prog >= q.max)); // v35: 走位途中被自动喂满 / 节点消失 = 已建成（旧版当成「目标消失」白跑，建成数也不记）
      if (!buildTarget) { mode = 'FLEE'; }
      else if (builtNow) {
        buildCount++;
        const bname = markBuilt(buildTarget.wx, buildTarget.wy);
        buildDone = Date.now(); mode = 'FLEE';
        console.log('*** BUILD DONE #' + buildCount + ' t+' + t.toFixed(0) + 's node(' + buildTarget.wx + ',' + buildTarget.wy + ') ' + bname + (q ? ' (fed-full)' : ' (node-gone)') + ' wood=' + w.wood + ' hp=' + (w.hp === null ? '?' : w.hp.toFixed(2)));
        ev(t, 'build-done', { n: buildCount, wx: buildTarget.wx, wy: buildTarget.wy, name: bname, wood: w.wood, how: q ? 'fed-full' : 'node-gone' });
        await s.shot('built-' + buildCount + '.png');
      }
      else if (detourDir && Date.now() < detourUntil) { // v35: 卡死脱困优先
        cur = { x: detourDir.x, y: detourDir.y };
        await hold({ x: cur.x * ax, y: cur.y * ay });
      }
      else {
        const dx = q.wx - h.x, dy = q.wy - h.y, L = Math.hypot(dx, dy) || 1;
        await hold({ x: (dx / L) * ax, y: (dy / L) * ay });
        if (L <= 55) { mode = 'STAND'; standStart = Date.now(); lastProg = q.prog; lastProgAt = Date.now(); lastTrees = -1; console.log('STAND start t+' + t.toFixed(0) + ' node(' + buildTarget.wx + ',' + buildTarget.wy + ') ' + (buildTarget.name || '?') + ' prog=' + q.prog + '/' + q.max + ' can=' + q.can + ' trees=' + q.trees); }
      }
    } else if (mode === 'STAND') {
      if (pressed) await release();
      const c2 = buildTarget && w.squares.find(s => s.wx === buildTarget.wx && s.wy === buildTarget.wy);
      const doneStand = !c2 || // 节点消失=建成（一次性点）
        (c2.max > 0 && c2.prog >= c2.max) || // 进度到顶
        (c2.max > 0 && lastProg > c2.prog); // v34: 喂木只会涨——进度出现回跌=完工归零一拍（可重复点；采样错过归零瞬间也能抓到）
      if (doneStand) {
        buildCount++;
        const bname = markBuilt(buildTarget.wx, buildTarget.wy);
        buildDone = Date.now(); mode = 'FLEE';
        console.log('*** BUILD DONE #' + buildCount + ' t+' + t.toFixed(0) + 's node(' + buildTarget.wx + ',' + buildTarget.wy + ') ' + bname + ' wood=' + w.wood + ' hp=' + (w.hp === null ? '?' : w.hp.toFixed(2)) + ' fire=' + (fireBuilt?1:0) + ' turret=' + (turretBuilt?1:0) + ' t2=' + (turret2Built?1:0));
        ev(t, 'build-done', { n: buildCount, wx: buildTarget.wx, wy: buildTarget.wy, name: bname, wood: w.wood });
        await s.shot('built-' + buildCount + '.png');
      } else if (minD < 250) {
        mode = 'FLEE'; console.log('STAND abort (monsters near minD=' + Math.round(minD) + ') prog=' + c2.prog + '/' + c2.max);
      } else if (w.hp !== null && w.hp < 0.35) {
        mode = 'FLEE'; console.log('STAND abort (hp low)');
      } else if (c2.can === false) {
        // v34: 圈内有树喂不进去——小步走位让武器清树（树不清完 can 永远 false）；15s 树数不降 → 放弃该点
        const nT = c2.trees || 0;
        if (lastTrees < 0 || nT < lastTrees) { lastTrees = nT; lastTreesAt = Date.now(); }
        const tps = (c2.holdPos && c2.holdPos.length) ? c2.holdPos : null;
        if (tps) {
          let bt = tps[0], bd = 1e9;
          for (const p2 of tps) { const d3 = Math.hypot(p2[0] - h.x, p2[1] - h.y); if (d3 < bd) { bd = d3; bt = p2; } }
          if (bd > 26) { cur = { x: (bt[0] - h.x) / bd, y: (bt[1] - h.y) / bd }; await hold({ x: cur.x * ax, y: cur.y * ay }); }
          else if (pressed) await release();
        } else if (pressed) await release();
        if (Date.now() - lastTreesAt > 15000) {
          const site2 = BUILD_SITES.find(s3 => s3.wx === buildTarget.wx && s3.wy === buildTarget.wy);
          builtCnt.set(buildTarget.wx + ',' + buildTarget.wy, site2 ? site2.lim : 1);
          mode = 'FLEE';
          console.log('STAND skip (trees stuck 15s) node(' + buildTarget.wx + ',' + buildTarget.wy + ') trees=' + nT);
        }
      } else if (w.wood < 1) {
        mode = 'FLEE'; console.log('STAND abort (wood 0) prog=' + c2.prog + '/' + c2.max);
      } else {
        const dx2 = buildTarget.wx - h.x, dy2 = buildTarget.wy - h.y, L2 = Math.hypot(dx2, dy2) || 1;
        if (L2 > 40) { cur = { x: dx2 / L2, y: dy2 / L2 }; await hold({ x: cur.x * ax, y: cur.y * ay }); }
        else if (pressed) await release();
        if (c2.prog !== lastProg) {
          lastProg = c2.prog; lastProgAt = Date.now();
        } else if (Date.now() - lastProgAt > 12000) {
          const site3 = BUILD_SITES.find(s4 => s4.wx === buildTarget.wx && s4.wy === buildTarget.wy);
          builtCnt.set(buildTarget.wx + ',' + buildTarget.wy, site3 ? site3.lim : 1);
          mode = 'FLEE'; console.log('STAND skip (no progress 12s) node(' + buildTarget.wx + ',' + buildTarget.wy + ') prog=' + c2.prog + '/' + c2.max);
        }
      }
    } else if (mode === 'UNLOCK') {
      // v34: 通用解锁——站到圈内可达点（圈心向基地缩 1/6），wood≥cost 自动弹「解锁炮台」窗；锁翻转=瞬建完成
      const q2u = buildTarget && w.squares.find(s => s.wx === buildTarget.wx && s.wy === buildTarget.wy);
      if (!q2u || !q2u.lock) {
        buildCount++;
        const uname = markBuilt(buildTarget.wx, buildTarget.wy);
        mode = 'FLEE';
        console.log('*** UNLOCK DONE #' + buildCount + ' t+' + t.toFixed(0) + 's node(' + buildTarget.wx + ',' + buildTarget.wy + ') ' + uname + ' wood=' + w.wood + ' hp=' + (w.hp === null ? '?' : w.hp.toFixed(2)));
        ev(t, 'unlock-done', { wx: buildTarget.wx, wy: buildTarget.wy, name: uname, wood: w.wood });
        await s.shot('unlock-' + buildCount + '.png');
      } else {
        const unlockTimeout = Date.now() - unlockStart > 45000;
        const unlockDanger = minD < 150 || (w.hp !== null && w.hp < 0.42);
        if (unlockDanger || unlockTimeout) { // v25: 冲到底；v35: 超时/遇险 → 封锁该点，防 abort→重入 空转
          blockSite(buildTarget.wx, buildTarget.wy, unlockTimeout ? 30000 : 10000, unlockTimeout ? 'unlock-timeout' : 'unlock-danger');
          mode = 'FLEE'; wp = null;
          console.log('UNLOCK abort t+' + t.toFixed(0) + ' minD=' + Math.round(minD) + ' wood=' + w.wood + ' trees=' + q2u.trees + ' timeout=' + unlockTimeout);
        } else if (detourDir && Date.now() < detourUntil) { // v35: 卡死脱困优先
          cur = { x: detourDir.x, y: detourDir.y };
          await hold({ x: cur.x * ax, y: cur.y * ay });
        } else {
          // v35: 站到圈内（圈心向基地方向 46，圈半径 ~103）——旧版停在「5/6 圈边」上，实际常常压根没进圈，弹窗永不触发
          const CL = Math.hypot(buildTarget.wx, buildTarget.wy) || 1;
          const px2 = buildTarget.wx - (buildTarget.wx / CL) * 46;
          const py2 = buildTarget.wy - (buildTarget.wy / CL) * 46;
          const dxu = px2 - h.x, dyu = py2 - h.y, Lu = Math.hypot(dxu, dyu) || 1;
          if (Lu > 22) { cur = { x: dxu / Lu, y: dyu / Lu }; await hold({ x: cur.x * ax, y: cur.y * ay }); }
          else if (pressed) await release();
        }
      }
    } else if (mode === 'FARM') {
      const tgt2 = nextTarget();
      const need2 = tgt2.need;
      const fireReady2 = fireBuilt;
      if (Math.abs(h.x) > 1000 || Math.abs(h.y) > 1000) { // v35: 追树追到地图外圈——直接回 FLEE 导航回家（不在这荒地里兜圈）
        mode = 'FLEE'; wp = null;
        console.log('FARM -> FLEE (out of zone) at(' + h.x + ',' + h.y + ') t+' + t.toFixed(0) + 's');
      } else if (w.monsters.length > 3 || minD < 260) {
        mode = 'FLEE'; wp = null;
        console.log('FARM -> FLEE mons=' + w.monsters.length + ' t+' + t.toFixed(0) + ' wood=' + w.wood);
      } else if (fireReady2 && w.monsters.length === 0 && w.hp !== null && w.hp < 0.9) {
        mode = 'REST'; restUntil = t + 40;
        console.log('FARM -> REST hp=' + w.hp.toFixed(2));
      } else if (tgt2.kind === 'none' || w.wood >= need2) {
        mode = 'FLEE'; wp = null;
        console.log('FARM done t+' + t.toFixed(0) + ' wood=' + w.wood + ' need=' + need2);
      } else if (detourDir && Date.now() < detourUntil) {
        cur = { x: detourDir.x, y: detourDir.y };
        await hold({ x: cur.x * ax, y: cur.y * ay });
      } else {
        if (chopSpot && clusterEmpty(w, chopSpot)) {
          let n150 = 0;
          for (const t2 of (w.trees || [])) if (Math.hypot(t2[0] - chopSpot.x, t2[1] - chopSpot.y) < 150) n150++;
          console.log('FARM spot empty: old=' + chopSpot.key + ' at(' + chopSpot.x + ',' + chopSpot.y + ') n150=' + n150 +
            ' heroDist=' + Math.round(Math.hypot(chopSpot.x - h.x, chopSpot.y - h.y)) +
            ' woodGain=' + (farmSpotStart ? (w.wood - farmSpotStart.wood) : '?') + ' t+' + t.toFixed(0));
          farmBanned.push({ key: chopSpot.key, x: chopSpot.x, y: chopSpot.y, until: Date.now() + 12000 }); // 空点软拉黑 12s，防原地重选
          chopSpot = null; farmStall = null;
        }
        if (!chopSpot) {
          const nxt = pickChopSpot(w, h);
          if (nxt) {
            chopSpot = nxt; farmStall = null; farmNoSpotSince = 0;
            let n150 = 0;
            for (const t2 of (w.trees || [])) if (Math.hypot(t2[0] - nxt.x, t2[1] - nxt.y) < 150) n150++;
            farmSpotStart = { wood: w.wood, n150, at: Date.now() };
            console.log('FARM spot ' + nxt.why + ' at(' + nxt.x + ',' + nxt.y + ') dist=' + Math.round(Math.hypot(nxt.x - h.x, nxt.y - h.y)) + ' n150=' + n150 + ' wood=' + w.wood + ' t+' + t.toFixed(0));
          }
        }
        if (!chopSpot) {
          // v18: 兜底不再用旧 FPTS 航点（纯绕圈不砍树），改为走向最近的树；v35: 只追圈内树，圈外一个不追 → 回家
          let nt = null, nd2 = 1e9;
          for (const t2 of (w.trees || [])) {
            if (Math.abs(t2[0]) > 1050 || Math.abs(t2[1]) > 1050) continue;
            const d2 = Math.hypot(t2[0] - h.x, t2[1] - h.y); if (d2 < nd2) { nd2 = d2; nt = t2; }
          }
          if (Date.now() - lastNospotLog > 3000) { // v35: 同一条日志别刷屏
            lastNospotLog = Date.now();
            console.log('FARM nospot t+' + t.toFixed(0) + ' wood=' + w.wood + ' -> ' + (nt ? ('nearest tree(' + nt[0] + ',' + nt[1] + ') dist=' + Math.round(nd2)) : 'home'));
          }
          if (nt) {
            const ddx = nt[0] - h.x, ddy = nt[1] - h.y, L = Math.hypot(ddx, ddy) || 1;
            cur = { x: ddx / L, y: ddy / L };
            await hold({ x: cur.x * ax, y: cur.y * ay });
          } else {
            const hd2 = Math.hypot(h.x, h.y) || 1; // v35: 圈内无树 → 回基地；站到 90 内就松手（别顶着圈心推出一团抖）
            if (hd2 > 90) { cur = { x: -h.x / hd2, y: -h.y / hd2 }; await hold({ x: cur.x * ax, y: cur.y * ay }); }
            else if (pressed) await release();
            if (!farmNoSpotSince) farmNoSpotSince = Date.now();
            else if (Date.now() - farmNoSpotSince > 3000) { // v35: 3s 还选不出点 → 转基地待机等木（多半是树被清光了）
              mode = 'WAIT'; wp = null; chopSpot = null; farmNoSpotSince = 0;
              console.log('FARM -> WAIT t+' + t.toFixed(0) + 's wood=' + w.wood + ' (nospot 3s)');
            }
          }
        } else {
          // v16: 直达驻点（(64,480) 假航点已删——它把英雄送进北墙树簇卡死）
          const realL = Math.hypot(chopSpot.x - h.x, chopSpot.y - h.y);
          if (realL > 60) {
            let ddx = chopSpot.x - h.x, ddy = chopSpot.y - h.y;
            const L = Math.hypot(ddx, ddy) || 1;
            const ux = ddx / L, uy = ddy / L;
            for (const q of drainSqs) { // v23: 视线穿建造圈 → 侧向弧线绕行（别喂木）
              if (Math.hypot(h.x - q.wx, h.y - q.wy) > 320) continue;
              const fx = h.x - q.wx, fy = h.y - q.wy;
              const proj = -(fx * ux + fy * uy);
              if (proj > 0 && proj < L) {
                const mx0 = h.x + ux * proj - q.wx, my0 = h.y + uy * proj - q.wy;
                if (Math.hypot(mx0, my0) < 145) {
                  const lat = mx0 * (-uy) + my0 * ux;
                  const sgn = lat > 0 ? -1 : 1;
                  ddx += (-uy) * sgn * L * 1.4; ddy += ux * sgn * L * 1.4;
                }
              }
            }
            const L2f = Math.hypot(ddx, ddy) || 1;
            wp = null;
            cur = { x: ddx / L2f, y: ddy / L2f };
            await hold({ x: cur.x * ax, y: cur.y * ay });
          } else {
            if (pressed) await release();
            // 卡刀检测：站定 5s 木头不涨 → 拉黑该簇换点
            if (!farmStall || farmStall.key !== chopSpot.key) farmStall = { key: chopSpot.key, wood: w.wood, at: Date.now() };
            if (w.wood > farmStall.wood) { farmStall.wood = w.wood; farmStall.at = Date.now(); }
            else if (Date.now() - farmStall.at > 5000) {
              let n150s = 0;
              for (const t2 of (w.trees || [])) if (Math.hypot(t2[0] - chopSpot.x, t2[1] - chopSpot.y) < 150) n150s++;
              console.log('FARM stall at ' + chopSpot.why + ' wood=' + w.wood + ' n150=' + n150s +
                ' heroDist=' + Math.round(Math.hypot(chopSpot.x - h.x, chopSpot.y - h.y)) + ' t+' + t.toFixed(0) + ' -> ban+repick');
              farmBanned.push({ key: chopSpot.key, x: chopSpot.x, y: chopSpot.y, until: Date.now() + 60000 });
              chopSpot = null; farmStall = null;
            }
          }
        }
      }
    } else if (mode === 'GUARD') {
      if (pressed) await release();
      if (guardMark === null) guardMark = { rows: [] };
      guardMark.rows.push([Math.round(t), w.hp === null ? -1 : Math.round(w.hp * 100) / 100, w.monsters.length, Math.round(minD)]);
      if (minD < 220 || Date.now() - buildDone > 15000 || (w.hp !== null && w.hp < 0.45)) {
        mode = 'FLEE';
        console.log('GUARD over t+' + t.toFixed(0) + 's rows=' + JSON.stringify(guardMark.rows.filter((_, i) => i % 4 === 0)));
        guardMark = null;
      }
    } else if (mode === 'REST') {
      // 波间回基地/篝火处回血（篝火=恢复区）
      const dx = -h.x, dy = -h.y, L = Math.hypot(dx, dy) || 1;
      if (L > 60) await hold({ x: (dx / L) * ax, y: (dy / L) * ay });
      else if (pressed) await release();
      if ((w.hp !== null && w.hp >= 0.95) || t > restUntil || w.monsters.length > 0) {
        console.log('REST end t+' + t.toFixed(0) + 's hp=' + (w.hp === null ? '?' : w.hp.toFixed(2)));
        mode = 'FLEE';
      }
    } else if (mode === 'WAIT') {
      // v35: 缺木但地图上没树可砍（树被清光）→ 回基地站定等樵夫产木；来怪/木头够了立刻回 FLEE
      const tgtW = nextTarget();
      if (w.monsters.length > 0 || minD < 320) {
        mode = 'FLEE'; holdPt = null;
        console.log('WAIT -> FLEE mons=' + w.monsters.length + ' minD=' + Math.round(minD) + ' t+' + t.toFixed(0) + ' wood=' + w.wood);
      } else if (tgtW.kind === 'none' || w.wood >= tgtW.need) {
        mode = 'FLEE'; holdPt = null;
        console.log('WAIT done t+' + t.toFixed(0) + 's wood=' + w.wood + ' need=' + tgtW.need);
      } else if (holdPt) {
        const dxh = holdPt.x - h.x, dyh = holdPt.y - h.y, Lh = Math.hypot(dxh, dyh) || 1;
        if (Lh > 24) { cur = { x: dxh / Lh, y: dyh / Lh }; await hold({ x: cur.x * ax, y: cur.y * ay }); }
        else { holdPt = null; if (pressed) await release(); }
      } else {
        const dHw = Math.hypot(h.x, h.y);
        if (dHw > 90) {
          cur = { x: -h.x / dHw, y: -h.y / dHw }; await hold({ x: cur.x * ax, y: cur.y * ay });
        } else {
          if (pressed) await release();
          if (Date.now() > holdUntil) { // 偶尔小挪一步（别像木头人）
            holdUntil = Date.now() + 8000 + Math.random() * 7000;
            if (Math.random() < 0.6) holdPt = { x: Math.max(-80, Math.min(80, h.x + (Math.random() * 2 - 1) * 70)), y: Math.max(-80, Math.min(80, h.y + (Math.random() * 2 - 1) * 70)) };
          }
        }
      }
    } else if (mode === 'HOLD') {
      // v34: 待机——全部建完+无怪：回家（篝火旁）站定，偶尔小挪两步；有状况立刻回 FLEE
      const hpExit = (w.hp !== null && w.hp < (fireBuilt ? 0.9 : 0.5));
      if (minD < 420 || w.monsters.length > 0 || hpExit) {
        mode = 'FLEE'; holdPt = null;
        console.log('HOLD end t+' + t.toFixed(0) + 's minD=' + Math.round(minD) + ' mons=' + w.monsters.length + ' hp=' + (w.hp === null ? '?' : w.hp.toFixed(2)));
      } else {
        const dH = Math.hypot(h.x, h.y);
        if (holdPt) {
          const dxh = holdPt.x - h.x, dyh = holdPt.y - h.y, Lh = Math.hypot(dxh, dyh) || 1;
          if (Lh > 22) { cur = { x: dxh / Lh, y: dyh / Lh }; await hold({ x: cur.x * ax, y: cur.y * ay }); }
          else { holdPt = null; if (pressed) await release(); }
        } else if (dH > 80) {
          const dxh = -h.x, dyh = -h.y, Lh = Math.hypot(dxh, dyh) || 1;
          cur = { x: dxh / Lh, y: dyh / Lh }; await hold({ x: cur.x * ax, y: cur.y * ay });
        } else {
          if (pressed) await release();
          if (Date.now() > holdUntil) { // 每 8~15s 小挪一步（别像木头人）
            holdUntil = Date.now() + 8000 + Math.random() * 7000;
            if (Math.random() < 0.6) holdPt = { x: Math.max(-70, Math.min(70, h.x + (Math.random() * 2 - 1) * 60)), y: Math.max(-70, Math.min(70, h.y + (Math.random() * 2 - 1) * 60)) };
          }
        }
      }
    } else {
      // FLEE：怪斥力 + 环绕切向（绕怪群质心）+ 角落斥力 + 边界拉力 + 躲避区
      if (detourDir && Date.now() < detourUntil) {
        await hold({ x: detourDir.x * ax, y: detourDir.y * ay });
        await sleep(UPDATE_MS);
        continue;
      }
      const mL = Math.hypot(mx, my);
      let rx = 0, ry = 0;
      if (mL > 0) { rx += mx / mL; ry += my / mL; }
      if (w.monsters.length >= 8) {
        // 找缺口：16 方向里选怪群密度最低的夹角（被围时斥力和会互相抵消，必须换算法）
        let best = cur, bestScore = -1e9;
        for (let k = 0; k < 16; k++) {
          const th = (k * Math.PI) / 8;
          let dens = 0;
          for (const m of w.monsters) {
            const d = Math.hypot(m.x - h.x, m.y - h.y) || 1;
            // 从英雄指向怪的方向的"反方向"与候选方向的夹角
            const aw = Math.atan2(h.y - m.y, h.x - m.x);
            let da = Math.abs(th - aw);
            if (da > Math.PI) da = 2 * Math.PI - da;
            dens += (Math.max(0, Math.cos(da)) * Math.max(0, Math.cos(da))) / ((d + 40) * (d + 40));
          }
          // 密度越低越好；轻微偏好与当前运动一致（防抖）
          let al = Math.abs(th - Math.atan2(cur.y, cur.x));
          if (al > Math.PI) al = 2 * Math.PI - al;
          const score = -dens - al * 0.06;
          if (score > bestScore) { bestScore = score; best = { x: Math.cos(th), y: Math.sin(th) }; }
        }
        rx += best.x * 2.2; ry += best.y * 2.2;
      } else if (w.monsters.length >= 3) {
        let cx0 = 0, cy0 = 0;
        for (const m of w.monsters) { cx0 += m.x; cy0 += m.y; }
        cx0 /= w.monsters.length; cy0 /= w.monsters.length;
        let ux = h.x - cx0, uy = h.y - cy0;
        const L0 = Math.hypot(ux, uy);
        if (L0 > 40) {
          ux /= L0; uy /= L0;
          const t1 = { x: -uy, y: ux }, t2 = { x: uy, y: -ux };
          const al1 = cur.x * t1.x + cur.y * t1.y, al2 = cur.x * t2.x + cur.y * t2.y;
          const tb = al1 >= al2 ? t1 : t2;
          rx += ux * 0.7 + tb.x * 0.6; ry += uy * 0.7 + tb.y * 0.6;
        } else if (mL > 0) { rx += (-my / mL) * 0.7; ry += (mx / mL) * 0.7; }
      } else if (minD < 140 && mL > 0) {
        rx += (-my / mL) * 0.5; ry += (mx / mL) * 0.5;
      }
      // 被拒掉落物躲避区（防止站着不动无限触发武器弹窗）
      if (wpAvoid && Date.now() < wpAvoid.until) {
        const dx = h.x - wpAvoid.x, dy = h.y - wpAvoid.y, d = Math.hypot(dx, dy) || 1;
        if (d < 150) { rx += (dx / d) * 1.5; ry += (dy / d) * 1.5; }
      }
      let cbx = 0, cby = 0, cornerBest = 0;
      for (const cc of [[849, 849], [849, -849], [-849, 849], [-849, -849]]) {
        const dx = h.x - cc[0], dy = h.y - cc[1];
        const d = Math.hypot(dx, dy);
        const wcn = Math.max(0, (380 - d) / 380);
        if (wcn > cornerBest) { cornerBest = wcn; cbx = dx / (d || 1); cby = dy / (d || 1); }
      }
      rx += cbx * cornerBest * 1.5; ry += cby * cornerBest * 1.5;
      const dc = Math.hypot(h.x, h.y);
      if (dc > 640) {
        const k = Math.min(1, (dc - 640) / 120) * 2.2;
        rx += (-h.x / dc) * k; ry += (-h.y / dc) * k;
      }
      if (!rx && !ry) { rx = Math.cos(t * 0.5); ry = Math.sin(t * 0.5); }
      const L = Math.hypot(rx, ry) || 1;
      const want = { x: rx / L, y: ry / L };
      cur = { x: cur.x * 0.55 + want.x * 0.45, y: cur.y * 0.55 + want.y * 0.45 };
      const L3 = Math.hypot(cur.x, cur.y) || 1;
      cur = { x: cur.x / L3, y: cur.y / L3 };
      await hold({ x: cur.x * ax, y: cur.y * ay });
    }

    const idHist = {}; // v31: 怪物 id 直方图（2003 普通 / 2004 精英 / 2009 拆家 / 2002 远程）
    for (const m of w.monsters) { const k = m.id || 0; idHist[k] = (idHist[k] || 0) + 1; }
    const idsStr = Object.keys(idHist).sort().map(k => k + 'x' + idHist[k]).join('/');
    lastIds = idsStr; lastWood = w.wood; // v32: 供每局记录
    samples.push([Math.round(t), w.hp === null ? -1 : Math.round(w.hp * 100) / 100, w.wood, w.monsters.length,
      Math.round(minD), h.x, h.y, w.squares.length, mode, w.wpn, w.weapons.length, idsStr]);
    if (t - lastLog > 5) {
      lastLog = t;
      console.log('t+' + t.toFixed(0) + 's hp=' + (w.hp === null ? '?' : w.hp.toFixed(2)) + ' wood=' + w.wood +
        ' mons=' + w.monsters.length + ' minD=' + Math.round(minD) + ' hero(' + h.x + ',' + h.y + ') sq=' + w.squares.length + ' bld=' + buildCount + ' ' + mode +
        ' wpn=' + w.wpn + ' rg=' + rangedN + '/mt2=' + mt2N + ' popups=' + popupCount + ' ids=' + idsStr + ' ' + (waveOf(labels) || ''));
    }
    if (t - lastSave > 20) {
      lastSave = t;
      try { (window.__auto.samples = { t: Math.round(t), samples: samples.slice(-600) }); } catch (e) {}
    }

    await sleep(UPDATE_MS);
  }

  // ---- v32: 本局收尾：结算 → 回主页 → 记录 ----
  await release();
  const tEnd = (Date.now() - t0) / 1000;
  let result = died ? 'lose' : (win ? 'win' : 'timeout');
  let settle = null;
  if (result !== 'timeout') {
    settle = await toHome(tEnd);
    if (settle !== 'home' && settle !== 'battle') result = result + '/' + settle;
  } else {
    await s.shot('b' + battle + '-timeout.png');
  }
  const chAfter = await readProg();
  const rec = {
    n: battle, dur: Math.round(tEnd), result,
    chBefore: chBefore && chBefore.cur, chAfter: chAfter && chAfter.cur, passAfter: chAfter && chAfter.pass,
    lastWave, lastIds, lastWood, popups: popupCount - popup0, settle, samples,
  };
  // ---- v35(页内) 收尾：记录本局 → 洗下一关 → 改档跳转（本页逻辑到此结束）----
  battles.push(rec);
  const { samples: _sm2, ...slim2 } = rec;
  console.log('BATTLE#' + battle + ' ' + JSON.stringify(slim2));
  ev(tEnd, 'battle-end', slim2);
  if (result !== 'win' && result !== 'lose') {
    try { console.log('LABELS-DUMP:', JSON.stringify((await snap(s)).slice(0, 140))); } catch (e) {}
  }
  ST.stats = ST.stats || [];
  ST.stats.push({
    n: battle, ch: chBefore && chBefore.cur, result: result, dur: Math.round(tEnd),
    wave: lastWave, wood: lastWood, popups: popupCount - popup0, settle: settle,
  });
  if (ST.stats.length > 100) ST.stats.splice(0, ST.stats.length - 100);
  ST.bootTries = 0;
  saveState();
  const nextCh = nextShuffleChapter();
  console.log('SHUFFLE pick battle#' + (battle + 1) + ': ch=' + nextCh + ' (round#' + shuffleRound + ', left=' + shuffleQ.length + ')');
  __requestJump(nextCh, battle + 1, false);
  return;
}

})().catch(e => { console.error("AUTO FATAL", (e && e.stack) || e); });
})();
