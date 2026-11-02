// The Boîte: every conversation of every channel, the discussion, the contact card, and what is left for the shop.
// Three columns: the list | the discussion | the card of the contact. The owner can take a conversation over (the assistant stays quiet
// until it is handed back), answer in it, undo what the assistant did, and erase or export a visitor.
(function () {
  var F = window.FD, T = F.T, el = F.el, $ = F.$, api = F.api, tt = F.tt;
  var S = { o: null, cur: null, tab: 'chats', detail: null, draft: '' };

  function head(o) {
    var b = o.budget, st = $('state');
    $('shop').textContent = o.shop.name;
    $('mb').style.width = Math.min(100, b.capMicro ? 100 * (b.spentMicro + b.reservedMicro) / b.capMicro : 100) + '%';
    $('mt').textContent = F.money(b.spentMicro, b.currency) + ' ' + T.of + ' ' + F.money(b.capMicro, b.currency) + ' · ' + b.inflight + ' ' + T.running;
    F.clear(st);
    if (b.killed || !b.enabled) st.appendChild(F.pill(T.stopped, 'bad'));
    $('kill').textContent = b.killed ? T.resume : T.stop;
    $('kill').dataset.on = b.killed ? '' : '1';
    var ap = $('approvals');
    F.clear(ap);
    ap.hidden = !o.approvals.length;
    o.approvals.forEach(function (a) {
      var row = el('div', 'row');
      row.appendChild(F.pill(T.needsYou, 'warn'));
      row.appendChild(el('span', null, tt('act.' + a.name) + ' ' + summary(a.params)));
      var no = F.btn(T.reject, '', function () { decide(a.id, 'reject'); }, 'reject');
      var yes = F.btn(T.approve, 'primary', function () { decide(a.id, 'approve'); }, 'approve');
      no.className = 'push';
      row.appendChild(no); row.appendChild(yes);
      ap.appendChild(row);
    });
  }
  function summary(p) { return Object.keys(p || {}).map(function (k) { return p[k]; }).join(' · '); }
  function decide(id, d) { api('approvals/' + id, 'POST', { decision: d }).then(function () { load(); if (S.cur) openConv(S.cur, true); }); }

  /** The page redraws itself every few seconds: what the owner scrolled must stay where it is. */
  function keepScroll(node, draw) { var top = node.scrollTop; draw(); node.scrollTop = top; }
  function list(o) { keepScroll($('list'), function () { drawList(o); }); }
  function drawList(o) {
    var box = F.clear($('list'));
    var tabs = el('div', 'tabs');
    [['chats', T.tabChats, o.waiting + o.conversations.filter(function (c) { return c.unread && c.mode !== 'human'; }).length], ['todo', T.tabTodo, o.messages.length + o.callbacks.length + o.unanswered.length]].forEach(function (t) {
      var b = F.btn(t[1], S.tab === t[0] ? 'on' : '', function () { S.tab = t[0]; list(S.o); }, 'tab-' + t[0]);
      if (t[2]) b.appendChild(el('span', 'badge', String(t[2])));
      tabs.appendChild(b);
    });
    box.appendChild(tabs);
    if (S.tab === 'chats') {
      if (!o.conversations.length) box.appendChild(el('p', 'muted', T.noChats));
      o.conversations.forEach(function (c) {
        var b = el('button', 'item');
        b.type = 'button';
        b.setAttribute('data-conv', c.id);
        b.setAttribute('aria-current', S.cur === c.id ? 'true' : 'false');
        var top = el('span', 'itop');
        top.appendChild(el('span', 'ptxt', c.preview || c.id));
        if (c.unread) top.appendChild(el('span', 'badge', String(c.unread)));
        b.appendChild(top);
        var sub = el('small', null, T['ch_' + c.channel] || c.channel);
        if (c.mode === 'human') sub.appendChild(F.pill(T.you, 'warn'));
        sub.appendChild(document.createTextNode(' · ' + F.when(c.lastAt)));
        b.appendChild(sub);
        b.onclick = function () { openConv(c.id); };
        box.appendChild(b);
      });
      return;
    }
    section(box, T.messages, o.messages, function (m) { return [m.message, T['ch_' + m.channel] + ' · ' + F.when(m.ts) + (m.contact ? ' · ' + m.contact : ''), m.convId]; });
    section(box, T.callbacks, o.callbacks, function (m) { return [m.phone + (m.when ? ' · ' + m.when : ''), T['ch_' + m.channel] + ' · ' + F.when(m.ts), m.convId]; });
    section(box, T.bookings, o.bookings, function (m) { return [m.date + ' ' + m.time + ' · ' + m.name, F.when(m.ts), m.convId]; });
    var h = el('h3', null, T.unanswered);
    box.appendChild(h);
    if (!o.unanswered.length) box.appendChild(el('p', 'muted', T.none));
    o.unanswered.forEach(function (u) { box.appendChild(unansweredRow(u)); });
  }
  function section(box, title, rows, shape) {
    box.appendChild(el('h3', null, title));
    if (!rows.length) { box.appendChild(el('p', 'muted', T.none)); return; }
    rows.forEach(function (r) {
      var s = shape(r), d = el('button', 'item');
      d.type = 'button';
      d.appendChild(el('span', 'ptxt', s[0]));
      d.appendChild(el('small', null, s[1]));
      if (s[2]) d.onclick = function () { S.tab = 'chats'; openConv(s[2]); };
      box.appendChild(d);
    });
  }
  function unansweredRow(u) {
    var d = el('div', 'card tight');
    d.setAttribute('data-unanswered', u.id);
    d.appendChild(el('div', null, u.question));
    var inp = el('input');
    inp.placeholder = T.answerHere;
    inp.maxLength = 300;
    inp.setAttribute('aria-label', T.answerHere);
    var row = el('div', 'row');
    var add = F.btn(T.addAnswer, 'primary', function () {
      if (!inp.value.trim()) return;
      add.disabled = true;
      api('unanswered/' + u.id, 'POST', { answer: inp.value.trim() }).then(function (r) { if (r.ok) { d.textContent = ''; d.appendChild(el('p', 'muted', T.answerAdded)); } else add.disabled = false; });
    }, 'answer');
    var skip = F.btn(T.dismiss, '', function () { api('unanswered/' + u.id, 'POST', { dismiss: true }).then(load); }, 'dismiss');
    row.appendChild(inp); row.appendChild(add); row.appendChild(skip);
    d.appendChild(row);
    return d;
  }

  function openConv(id, keep) {
    S.cur = id;
    api('conversations/' + id).then(function (r) {
      if (!r.meta) { S.cur = null; return; }
      S.detail = r;
      if (!keep) { api('conversations/' + id + '/read', 'POST').then(load); }
      discussion(r);
      card(r);
      list(S.o);
    }).catch(authFail);
  }

  function discussion(r) {
    var old = $('chat').querySelector('.log');
    // The same discussion keeps its scroll unless the owner was already at the bottom; another one opens at its last line.
    var stay = old && S.shown === r.meta.id && old.scrollHeight - old.scrollTop - old.clientHeight > 40 ? old.scrollTop : null;
    S.shown = r.meta.id;
    var box = F.clear($('chat'));
    var human = r.meta.mode === 'human';
    var bar = el('div', 'row between');
    bar.appendChild(el('strong', null, r.meta.preview || r.meta.id));
    var right = el('div', 'row');
    right.appendChild(F.pill(human ? T.modeHuman : T.modeAgent, human ? 'warn' : 'ok'));
    right.appendChild(F.btn(human ? T.handBack : T.takeOver, '', function () { api('conversations/' + r.meta.id + '/mode', 'POST', { mode: human ? 'agent' : 'human' }).then(function () { openConv(r.meta.id, true); load(); }); }, 'mode'));
    bar.appendChild(right);
    box.appendChild(bar);
    var log = el('div', 'log');
    log.setAttribute('role', 'log');
    r.log.forEach(function (e) {
      if (e.type === 'event') { log.appendChild(el('div', 'ev', T.did + ' · ' + tt('act.' + e.name) + (e.pending ? ' (' + T.waiting + ')' : e.ok ? '' : ' ✗'))); return; }
      var cls = e.role === 'user' ? 'v' : e.role === 'owner' ? 'o' : 'a';
      var m = el('div', 'm ' + cls);
      if (e.role === 'owner') m.appendChild(el('small', 'who', T.you));
      m.appendChild(document.createTextNode(e.text));
      log.appendChild(m);
    });
    box.appendChild(log);
    log.scrollTop = stay === null ? log.scrollHeight : stay;
    if (S.notice) { box.appendChild(el('p', 'note bad', S.notice)); S.notice = ''; }
    if (!human) box.appendChild(el('p', 'note', T.replyTakes));
    var f = el('form', 'composer');
    var ta = el('textarea');
    ta.rows = 2; ta.maxLength = 2000;
    ta.placeholder = T.replyPlaceholder;
    ta.setAttribute('aria-label', T.replyPlaceholder);
    ta.value = S.draft;
    ta.oninput = function () { S.draft = ta.value; };
    var send = F.btn(T.send, 'primary');
    send.type = 'submit';
    f.appendChild(ta); f.appendChild(send);
    f.onsubmit = function (e) {
      e.preventDefault();
      var text = ta.value.trim();
      if (!text) return;
      send.disabled = true;
      api('conversations/' + r.meta.id + '/reply', 'POST', { text: text }).then(function (x) {
        send.disabled = false;
        if (!x.ok) return;
        S.draft = ''; ta.value = '';
        if (x.delivered === false) S.notice = T.notDelivered;
        openConv(r.meta.id, true); load();
      });
    };
    box.appendChild(f);
  }

  function card(r) { keepScroll($('side'), function () { drawCard(r); }); }
  function drawCard(r) {
    var box = F.clear($('side'));
    box.appendChild(el('h2', null, T.contact));
    var dl = el('dl');
    [[T.channel, T['ch_' + r.card.channel] || r.card.channel], [T.level, T['l' + r.card.level] || String(r.card.level)]].forEach(function (p) {
      dl.appendChild(el('dt', null, p[0])); dl.appendChild(el('dd', null, p[1]));
    });
    box.appendChild(dl);
    box.appendChild(el('h3', null, T.remembered));
    var ks = Object.keys(r.card.fields);
    if (!ks.length) box.appendChild(el('p', 'muted', T.noneKnown));
    ks.forEach(function (k) {
      var d = el('div', 'fact');
      d.appendChild(el('span', null, (T['f_' + k] || k) + ': ' + r.card.fields[k].value));
      d.appendChild(el('small', 'muted', T.consentAt + ' ' + F.when(r.card.fields[k].consentAt)));
      box.appendChild(d);
    });
    box.appendChild(el('h3', null, T.didHeading));
    if (!r.done.length) box.appendChild(el('p', 'muted', T.none));
    r.done.forEach(function (d) {
      var row = el('div', 'fact');
      row.setAttribute('data-done', d.id);
      row.appendChild(el('span', null, tt('act.' + d.name) + (d.detail ? ' · ' + d.detail : '')));
      var sub = el('small', 'muted', F.when(d.ts));
      row.appendChild(sub);
      if (d.status === 'done') row.appendChild(F.btn(T.undo, '', function () { api('done/' + d.id + '/undo', 'POST').then(function () { openConv(r.meta.id, true); load(); }); }, 'undo'));
      else row.appendChild(F.pill(T.undone, ''));
      box.appendChild(row);
    });
    if (r.unanswered.length) {
      box.appendChild(el('h3', null, T.unanswered));
      r.unanswered.forEach(function (u) { box.appendChild(unansweredRow(u)); });
    }
    var tools = el('div', 'row tight');
    tools.appendChild(F.btn(T.export, '', function () {
      api('conversations/' + r.meta.id + '/export').then(function (x) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(x, null, 2)], { type: 'application/json' }));
        a.download = 'conversation-' + r.meta.id + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      });
    }, 'export'));
    tools.appendChild(F.confirmBtn(T.erase, T.eraseConfirm, '', function () {
      api('conversations/' + r.meta.id, 'DELETE').then(function () { S.cur = null; F.clear($('chat')).appendChild(el('p', 'muted', T.pickOne)); F.clear($('side')); load(); });
    }, 'erase'));
    box.appendChild(tools);
  }

  function authFail(e) { if (e && e.auth) { $('main').hidden = true; F.login(load); } }
  function load() {
    return api('overview').then(function (o) {
      $('login').hidden = true; $('main').hidden = false;
      S.o = o; head(o); list(o);
    }).catch(authFail);
  }
  $('kill').onclick = function () { api('kill', 'POST', { on: $('kill').dataset.on === '1' }).then(load); };
  $('refresh').onclick = function () { load(); if (S.cur) openConv(S.cur, true); };
  F.clear($('chat')).appendChild(el('p', 'muted', T.pickOne));
  load();
  // New messages arrive while the page is open: refresh the list often and the open discussion a little less often.
  setInterval(function () { if (!document.hidden && !$('main').hidden) { load(); if (S.cur && !document.activeElement.matches('textarea')) openConv(S.cur, true); } }, 6000);
})();
