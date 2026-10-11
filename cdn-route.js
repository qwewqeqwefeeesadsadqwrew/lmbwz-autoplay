/* cdn-route.js — LMBWZ 公网版「资源路由」补丁（生成文件，勿手改；生成器 work/deploy/split-cdn.js）
 * 为什么需要：公网版页面放在 GitHub Pages（只放小文件），101MB 游戏素材拆成 3 个仓库走 jsDelivr。
 *            游戏里资源地址是相对路径 assets/<bundle>/...，必须改写到对应 CDN 仓库。
 * 挂点（按优先级，互相兜底）：
 *   ① cc.assetManager.downloader.download —— Cocos 2.4 所有资源下载（bundle/图片/音频/JSON）的唯一入口
 *   ② XMLHttpRequest / fetch —— 兜底
 *   ③ HTMLImageElement / HTMLAudioElement / HTMLScriptElement 的 src（含 setAttribute）—— 再兜底
 * 启用条件：*.github.io 域 或 ?cdn=1；本地模拟用 &cdnsim=http://127.0.0.1:8200 换掉 CDN 根。
 * 纪律：只改写「相对 assets/ 开头」的地址，绝对 URL / data: / blob: 一律不动 → 局域网版不受影响。
 */
(function () {
  'use strict';
  var CFG = {"user":"qwewqeqwefeeesadsadqwrew","cdn":"https://gcore.jsdelivr.net","refs":{"lmbwz-cdn-a":"30f58340965ed8e2016ff968b055ba41ca627dc6","lmbwz-cdn-b":"99cb222f4986fbf81b0e1fcc5210e4a3ee95735e","lmbwz-cdn-c":"c9fd0ffe0fce2ff2da053e70c55ad9e4d90d5068"},"map":{"Game":"lmbwz-cdn-a","res_RussianBlock":"lmbwz-cdn-a","res_json":"lmbwz-cdn-a","res_PeopleScareGhosts":"lmbwz-cdn-a","resources":"lmbwz-cdn-a","res_Report":"lmbwz-cdn-a","res_LuckyTD":"lmbwz-cdn-b","Res":"lmbwz-cdn-b","res_GuardingTheBridge":"lmbwz-cdn-b","res_PinballWar":"lmbwz-cdn-b","res_MinesweeperGame":"lmbwz-cdn-b","res_DestroyDevil":"lmbwz-cdn-b","res_HoldGround":"lmbwz-cdn-b","res_WaveZombies":"lmbwz-cdn-b","main":"lmbwz-cdn-b","res_Pvp":"lmbwz-cdn-b","res_TTSidebar":"lmbwz-cdn-b","res_public":"lmbwz-cdn-b","mini_LieFlat":"lmbwz-cdn-c","res_GoldMiner":"lmbwz-cdn-c","res_SmashTheJar":"lmbwz-cdn-c","res_MysteriousBag":"lmbwz-cdn-c","res_Loop":"lmbwz-cdn-c","res_DivideThree":"lmbwz-cdn-c","res_DragonGame":"lmbwz-cdn-c","res_EvilSpiritZuma":"lmbwz-cdn-c","res_ENightmare":"lmbwz-cdn-c","res_WaveZombies2":"lmbwz-cdn-c","res_ShootGame":"lmbwz-cdn-c","res_KnifeGame":"lmbwz-cdn-c","res_WZPublic":"lmbwz-cdn-c","res_SkinActivity51":"lmbwz-cdn-c","internal":"lmbwz-cdn-c","Load":"lmbwz-cdn-c"},"def":"lmbwz-cdn-c"};
  var qs = location.search;
  var simM = /[?&]cdnsim=([^&]+)/.exec(qs);
  var SIM = simM ? decodeURIComponent(simM[1]).replace(/\/+$/, '') : '';
  // 本地模拟：参数只在第一次带，改档跳转（autosave.html → index.html?auto=1&ms=…）会把查询串换掉，
  // 所以存进 sessionStorage 跟着这一整个标签页走；公网版不靠这个（靠 hostname 判据）。
  try {
    if (SIM) sessionStorage.setItem('lm_cdn_sim', SIM);
    else { var savedSim = sessionStorage.getItem('lm_cdn_sim'); if (savedSim) SIM = savedSim; }
  } catch (e) {}
  var ON = /\.github\.io$/i.test(location.hostname) || /[?&]cdn=1(&|$)/.test(qs) || !!SIM;
  var info = { on: ON, sim: SIM, hits: 0, urls: [], log: [] };
  window.__cdnRoute = info;
  if (!ON) return;
  var ROOT = (SIM || CFG.cdn) + '/gh/' + CFG.user + '/';
  // 实测两种写法都会出现：`assets/Game/...`（普通 bundle）与 `/assets/internal/...`（内置 bundle，带前导斜杠）
  var RE = /^(?:\.{0,2}\/)*\/?assets\/([^/?#]+)([^?#]*)(\?[^#]*)?$/;
  var ABS = /^[a-z][a-z0-9+.-]*:/i;
  function route(u) {
    if (typeof u !== 'string' || !u) return u;
    if (ABS.test(u)) return u;
    var m = RE.exec(u);
    if (!m) return u;
    var dir = m[1], rest = m[2] || '', q = m[3] || '';
    if (!rest) return u;
    var repo = CFG.map[dir] || CFG.def;
    var out = ROOT + repo + '@' + (CFG.refs[repo] || 'main') + '/assets/' + dir + rest + q;
    info.hits++;
    if (info.urls.length < 300) info.urls.push(u.slice(0, 90) + ' -> ' + out.slice(-90));
    return out;
  }
  info.route = route;
  window.__cdnRouteInfo = function () {
    return { on: info.on, sim: info.sim, hits: info.hits, root: ROOT, sample: info.urls.slice(0, 5), log: info.log };
  };

  // ---- ① Cocos 资源下载器 ----
  var patched = false;
  function patchDownloader() {
    if (patched) return true;
    var dl = (window.cc && cc.assetManager && cc.assetManager.downloader) || null;
    if (!dl || typeof dl.download !== 'function' || !dl._downloaders) return false;
    var orig = dl.download;
    var w = function (id, url, type, opts, cb) { return orig.call(this, id, route(url), type, opts, cb); };
    w.__cdnOrig = orig;
    dl.download = w;
    var L = dl._downloaders, n = 0;
    for (var k in L) {
      (function (k) {
        var f = L[k];
        if (typeof f !== 'function' || f.__cdnW) return;
        var g = function (url, o, cb) { return f.call(this, route(url), o, cb); };
        g.__cdnW = true; g.__cdnO = f;
        L[k] = g; n++;
      })(k);
    }
    patched = true;
    info.log.push('downloader patched (+' + n + ' handlers)');
    console.log('CDN-ROUTE: downloader patched (+' + n + ' handlers)');
    return true;
  }
  function hookAssetManagerSlot(ccObj) {
    if (!ccObj || typeof ccObj !== 'object' || ccObj.__cdnSlot) return;
    ccObj.__cdnSlot = true;
    var _am = null;
    Object.defineProperty(ccObj, 'assetManager', {
      configurable: true, enumerable: true,
      get: function () { return _am; },
      set: function (v) { _am = v; try { patchDownloader(); } catch (e) {} },
    });
  }
  // 引擎执行到 window.cc= 时立刻挂钩子（比轮询更早，避免开机第一批请求逃逸）
  try {
    if (!('cc' in window)) {
      var _ccv = null;
      Object.defineProperty(window, 'cc', {
        configurable: true, enumerable: true,
        get: function () { return _ccv; },
        set: function (v) { _ccv = v; try { hookAssetManagerSlot(v); } catch (e) {} try { patchDownloader(); } catch (e2) {} },
      });
    }
  } catch (e) { info.log.push('cc setter hook failed: ' + e); }
  if (!patchDownloader()) {
    var tries = 0;
    var timer = setInterval(function () {
      if (patchDownloader() || ++tries > 2400) clearInterval(timer); // 最多盯 2 分钟
    }, 50);
  }

  // ---- ② XHR / fetch 兜底 ----
  try {
    var XO = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (m, u) {
      var a = Array.prototype.slice.call(arguments);
      try { a[1] = route(String(a[1])); } catch (e) {}
      return XO.apply(this, a);
    };
  } catch (e) {}
  try {
    if (window.fetch) {
      var f0 = window.fetch.bind(window);
      window.fetch = function (u, o) {
        try {
          if (typeof u === 'string') {
            var r = route(u);
            if (r !== u) return f0(r, o);
          } else if (u && typeof u.url === 'string') {
            var r2 = route(u.url);
            if (r2 !== u.url) return f0(new Request(r2, u), o);
          }
        } catch (e) {}
        return f0.apply(null, arguments);
      };
    }
  } catch (e) {}

  // ---- ③ DOM 元素 src 再兜底 ----
  function hookProp(proto, name) {
    try {
      if (!proto) return;
      var d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d || !d.set) return;
      Object.defineProperty(proto, name, {
        configurable: true, enumerable: d.enumerable,
        get: d.get,
        set: function (v) { return d.set.call(this, route(v)); },
      });
    } catch (e) {}
  }
  hookProp(window.HTMLImageElement && HTMLImageElement.prototype, 'src');
  hookProp(window.HTMLAudioElement && HTMLAudioElement.prototype, 'src');
  hookProp(window.HTMLScriptElement && HTMLScriptElement.prototype, 'src');
  hookProp(window.HTMLSourceElement && HTMLSourceElement.prototype, 'src');
  try {
    var SA = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (n, v) {
      try { if ((n === 'src' || n === 'href') && typeof v === 'string') v = route(v); } catch (e) {}
      return SA.call(this, n, v);
    };
  } catch (e) {}
  console.log('CDN-ROUTE: on  root=' + ROOT + ' dirs=' + Object.keys(CFG.map).length);
})();
