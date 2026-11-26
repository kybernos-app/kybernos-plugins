// Helpers shared by the owner's pages (Atelier, Boîte). No framework: DOM built with textContent only, never as markup.
window.FD = (function () {
  var cfg = JSON.parse(document.getElementById('cfg').textContent);
  var mem = {};
  function store(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
    } catch (e) { if (v === undefined) return mem[k] || null; mem[k] = v; }
    return null;
  }
  var token = store('fd_tok') || '';
  // Relative on purpose: the page works at /boite (api at /api/) and behind a host that mounts it elsewhere and adds the token.
  var apiBase = new URL('api/', location.href).href;
  function api(path, method, body) {
    var h = { 'content-type': 'application/json' };
    if (token) h.authorization = 'Bearer ' + token;
    return fetch(apiBase + path, { method: method || 'GET', headers: h, body: body === undefined ? undefined : JSON.stringify(body) }).then(function (r) {
      if (r.status === 401) { var e = new Error('auth'); e.auth = true; throw e; }
      return r.json().catch(function () { return {}; });
    });
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function tt(key, vars) {
    var s = cfg.t[key];
    if (s === undefined) return key;
    return s.replace(/\{(\w+)\}/g, function (_, n) { return vars && vars[n] !== undefined ? vars[n] : ''; });
  }
  function money(m, cur) { return (m / 1e6).toFixed(m < 1e5 ? 4 : 2) + ' ' + cur; }
  function when(ts) { return new Date(ts).toLocaleString(); }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
  function btn(label, cls, onClick, act) {
    var b = el('button', cls || '', label);
    b.type = 'button';
    if (act) b.setAttribute('data-act', act);
    if (onClick) b.onclick = onClick;
    return b;
  }
  /** A button that asks to be clicked twice, for what cannot be taken back. */
  function confirmBtn(label, confirmLabel, cls, run, act) {
    var armed = false, t = null;
    var b = btn(label, cls, function () {
      if (!armed) { armed = true; b.textContent = confirmLabel; t = setTimeout(function () { armed = false; b.textContent = label; }, 4000); return; }
      clearTimeout(t); armed = false; b.textContent = label; run();
    }, act);
    return b;
  }
  function pill(text, kind) { return el('span', 'pill' + (kind ? ' ' + kind : ''), text); }
  function login(onToken) {
    var box = $('login');
    box.hidden = false;
    $('lm').textContent = token ? tt('badToken') : '';
    token = ''; store('fd_tok', null);
    $('lf').onsubmit = function (e) { e.preventDefault(); token = $('tok').value.trim(); store('fd_tok', token); $('tok').value = ''; onToken(); };
  }
  function $(id) { return document.getElementById(id); }
  return { cfg: cfg, T: cfg.t, api: api, el: el, tt: tt, money: money, when: when, clear: clear, btn: btn, confirmBtn: confirmBtn, pill: pill, login: login, $: $, hasToken: function () { return !!token; } };
})();
