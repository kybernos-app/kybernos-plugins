// The visitor's chat page. DOM built with textContent only. The visitor's id lives in this browser (localStorage, memory when it is
// blocked); the conversation is kept on the server, the last 60 lines are cached here so a reload does not look like amnesia.
// While the owner has taken the conversation over, the page asks the server every few seconds for the owner's words.
(function () {
  var C = JSON.parse(document.getElementById('cfg').textContent), T = C.t;
  function $(i) { return document.getElementById(i); }
  var mem = {};
  function store(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) { if (v === undefined) return mem[k] || null; if (v === null) delete mem[k]; else mem[k] = v; }
    return null;
  }
  function rid() {
    var a = new Uint8Array(16), s = '';
    (window.crypto || { getRandomValues: function (x) { for (var i = 0; i < x.length; i++) x[i] = Math.random() * 256; } }).getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }
  var preview = !!C.preview;
  if (/[?&]embed=1(&|$)/.test(location.search)) document.documentElement.classList.add('embed');
  // The preview is the owner's own page: its API sits next to it and takes the owner's token, and it never touches this browser's storage.
  var ownerTok = '';
  if (preview) { try { ownerTok = sessionStorage.getItem('fd_tok') || ''; } catch (e) { ownerTok = ''; } }
  var base = preview ? new URL('api/preview/', location.href).href : '/c/' + C.slug + '/';
  var vid = preview ? rid() : store('fd_vid');
  if (!/^[a-z0-9]{16,64}$/.test(vid || '')) { vid = rid(); store('fd_vid', vid); }
  var hkey = 'fd_h_' + C.slug, akey = 'fd_after_' + C.slug;
  var log = $('log'), input = $('in'), busy = false;
  var hist = [];
  if (!preview) { try { hist = JSON.parse(store(hkey) || '[]'); } catch (e) { hist = []; } }
  var after = null, humanShown = false, lastActive = Date.now(), pollTimer = null;
  if (!preview) { var sa = store(akey); if (sa !== null && !isNaN(Number(sa))) after = Number(sa); }

  $('name').textContent = C.name;
  $('hello').textContent = C.hello || T.ai;
  $('logo').textContent = (C.name || '?').charAt(0).toUpperCase();
  $('mydata').textContent = T.mydata;
  $('send').textContent = T.send;
  input.placeholder = T.placeholder;
  $('ainote').textContent = preview ? T.preview : T.aiNote;
  $('ph').textContent = T.remembered;
  $('erase').textContent = T.erase;
  $('close').textContent = T.close;
  if (preview) $('mydata').hidden = true;

  function save() { if (!preview) store(hkey, JSON.stringify(hist.slice(-60))); }
  function advance(ts) { if (preview) return; if (ts > (after || 0) || after === null) { after = ts; store(akey, String(ts)); } }
  function bubble(cls, text, keep) {
    var d = document.createElement('div');
    d.className = 'm ' + cls;
    if (cls === 'o') { var w = document.createElement('span'); w.className = 'who'; w.textContent = T.owner; d.appendChild(w); d.appendChild(document.createTextNode(text)); } else d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    if (keep) { hist.push([cls, text]); save(); }
    return d;
  }
  hist.forEach(function (h) { bubble(h[0], h[1], false); });

  function api(path, body, method, headers) {
    var h = Object.assign({ 'content-type': 'application/json' }, headers || {});
    if (ownerTok) h.authorization = 'Bearer ' + ownerTok;
    return fetch(base + path, { method: method || 'POST', headers: h, body: body ? JSON.stringify(body) : undefined }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function consentCard(c) {
    var d = document.createElement('div'), p = document.createElement('div'), row = document.createElement('div');
    d.className = 'card'; row.className = 'row'; p.textContent = c.text;
    function mk(label, accept, primary) {
      var b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      if (primary) b.className = 'primary';
      b.onclick = function () {
        row.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
        api('consent', { visitorId: vid, noteId: c.noteId, accept: accept }).then(function (r) { d.remove(); if (r.reply) bubble('sys', r.reply, false); });
      };
      return b;
    }
    row.appendChild(mk(T.yes, true, true));
    row.appendChild(mk(T.no, false, false));
    d.appendChild(p); d.appendChild(row);
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  $('f').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true; lastActive = Date.now();
    $('send').disabled = true;
    input.value = ''; input.style.height = '';
    bubble('v', text, true);
    var wait = bubble('sys', T.typing, false);
    api('messages', { visitorId: vid, text: text, lang: C.lang }).then(function (r) {
      wait.remove();
      if (r.human) { humanShown = true; if (r.reply) bubble('sys', r.reply, false); } else if (r.reply) bubble(r.ok ? 'a' : 'err', r.reply, !!r.ok);
      (r.pendingConsents || []).forEach(function (c) { consentCard(c); });
    }).catch(function () { wait.remove(); bubble('err', T.neterr, false); }).then(function () { busy = false; $('send').disabled = false; input.focus(); schedule(); });
  });
  input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('f').requestSubmit(); } });
  input.addEventListener('input', function () { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });

  // The owner's words. The first answer of a page that knows nothing yet only sets the starting point: it is history, not news.
  function poll() {
    pollTimer = null;
    if (preview || document.hidden) { schedule(); return; }
    var baseline = after === null;
    fetch(base + 'messages?visitorId=' + vid + '&after=' + (baseline ? 0 : after), { headers: {} }).then(function (r) {
      if (r.status === 429) { schedule(30000); return null; }
      return r.ok ? r.json() : null;
    }).then(function (r) {
      if (!r) return;
      var top = after || 0, fresh = false;
      (r.messages || []).forEach(function (m) {
        if (m.role !== 'owner') return;
        if (m.ts > top) top = m.ts;
        if (baseline) return;
        if (!humanShown) { humanShown = true; bubble('sys', T.joined, true); }
        bubble('o', m.text, true);
        fresh = true;
      });
      if (r.mode !== 'human') humanShown = false;
      advance(top);
      if (fresh) lastActive = Date.now();
    }).catch(function () {}).then(function () { schedule(); });
  }
  function schedule(ms) {
    if (preview) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, ms || (Date.now() - lastActive < 120000 ? 5000 : 20000));
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { lastActive = Date.now(); schedule(500); } });
  if (!preview) schedule(300);

  var armed = false;
  $('mydata').onclick = function () {
    $('panel').classList.add('on'); $('pmsg').textContent = ''; armed = false; $('erase').textContent = T.erase;
    $('close').focus();
    fetch(base + 'me', { headers: { 'x-visitor-id': vid } }).then(function (r) { return r.json(); }).then(function (r) {
      var dl = $('fields'); dl.textContent = '';
      var k = Object.keys(r.fields || {});
      $('none').textContent = k.length ? '' : T.nothing;
      $('erase').hidden = !k.length;
      k.forEach(function (x) {
        var dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = T[x] || x; dd.textContent = r.fields[x];
        dl.appendChild(dt); dl.appendChild(dd);
      });
    });
  };
  function closePanel() { $('panel').classList.remove('on'); $('mydata').focus(); }
  $('close').onclick = closePanel;
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('panel').classList.contains('on')) closePanel(); });
  $('erase').onclick = function () {
    if (!armed) { armed = true; $('erase').textContent = T.eraseConfirm; return; }
    armed = false; $('erase').textContent = T.erase;
    fetch(base + 'me', { method: 'DELETE', headers: { 'x-visitor-id': vid } }).then(function (r) { return r.json(); }).then(function (r) {
      hist = []; save(); after = null; store(akey, null); humanShown = false;
      log.textContent = ''; $('fields').textContent = ''; $('none').textContent = T.nothing; $('erase').hidden = true; $('pmsg').textContent = r.reply || '';
    });
  };
})();
