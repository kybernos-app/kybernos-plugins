// The Atelier: the fiche of the assistant as a draft, the guard-rails, "what the assistant can really do", the gate to publish, the
// site script, versions, and a live preview of the draft. Kaby edits the same draft in chat; this page is the owner's own hand on it
// (and the only place that may raise money, open a door or switch an action to automatic).
(function () {
  var F = window.FD, T = F.T, el = F.el, $ = F.$, api = F.api, tt = F.tt;
  var S = null, busy = false, reloadTimer = null;
  var MODES = ['off', 'approve', 'auto'];
  var DAYS = [1, 2, 3, 4, 5, 6, 0];

  function changedPaths() {
    var set = {};
    S.diff.forEach(function (d) { set[d.path] = true; if (d.after && d.after.text) set['fact:' + d.after.text] = true; if (d.path === 'instruction' && d.after) set['instruction:' + d.after] = true; });
    return set;
  }
  function ops(list) {
    return api('studio/ops', 'POST', { ops: list, scope: 'owner' }).then(function (r) {
      if (!r.ok) { flash(r.error === 'above_ceiling' ? T.aboveCeiling : (r.message || r.error || '?')); return r; }
      return load().then(function () { refreshPreview(); return r; });
    });
  }
  function flash(msg) { var e = $('flash'); e.textContent = msg; e.hidden = !msg; if (msg) setTimeout(function () { e.hidden = true; }, 5000); }

  // ---------------------------------------------------------------- header + gate
  function head() {
    $('shop').textContent = S.draft.name;
    var st = F.clear($('state'));
    st.appendChild(F.pill(tt('live', { n: S.published.n }), 'ok'));
    st.appendChild(S.dirty ? F.pill(tt('draftN', { n: S.diff.length }), 'warn') : F.pill(T.noDraft, ''));
    $('discard').disabled = !S.dirty;
  }
  var BLOCK_TEXT = { no_changes: 'bNoChanges', unvalidated_facts: 'bFacts', not_reviewed: 'bReview', checks_missing: 'bChecks', checks_failed: 'bChecksFailed' };
  function gate() {
    var box = F.clear($('gate'));
    var has = function (c) { return S.blockers.some(function (b) { return b.code === c; }); };
    var open = S.blockers.filter(function (b) { return b.code === 'unvalidated_facts'; })[0];
    var rows = [
      [!has('no_changes'), T.cChanges, null],
      [!open, open ? tt('cFactsOpen', { n: open.count }) : T.cFacts, null],
      [S.reviewed, T.cReview, S.reviewed ? null : F.btn(T.readSheet, '', function () { $('sheet').scrollIntoView({ block: 'start' }); }, 'go-sheet')],
      [!!S.checks && S.checks.ok, S.checks ? (S.checks.ok ? tt('cChecksOk', { n: S.checks.results.length }) : T.cChecksBad) : T.cChecks, F.btn(S.checks ? T.runAgain : T.runChecks, '', runChecks, 'checks')],
    ];
    rows.forEach(function (r) {
      var d = el('div', 'check');
      d.appendChild(el('span', 'dot ' + (r[0] ? 'ok' : (r[2] && !r[0] ? '' : 'no'))));
      d.appendChild(el('span', null, r[1]));
      if (r[2]) { r[2].className = 'push'; d.appendChild(r[2]); }
      box.appendChild(d);
    });
    if (S.checks && !S.checks.ok) S.checks.results.filter(function (x) { return !x.ok; }).forEach(function (x) { box.appendChild(el('p', 'err', x.name + ': ' + x.failures.join(' · '))); });
    var pub = F.btn(T.publish, 'primary', function () {
      pub.disabled = true;
      api('studio/publish', 'POST', {}).then(function (r) { if (!r.ok) flash(T.cannotPublish); load().then(refreshPreview); });
    }, 'publish');
    pub.disabled = S.blockers.length > 0;
    var row = el('div', 'row tight');
    row.appendChild(pub);
    if (S.blockers.length) row.appendChild(el('span', 'note', S.blockers.map(function (b) { return b.code === 'unvalidated_facts' ? tt('bFacts', { n: b.count }) : T[BLOCK_TEXT[b.code]]; }).join(' · ')));
    box.appendChild(row);
  }
  function runChecks() {
    var b = $('gate').querySelector('[data-act="checks"]');
    if (b) { b.disabled = true; b.textContent = '…'; }
    api('studio/checks', 'POST').then(load);
  }

  // ---------------------------------------------------------------- the fiche
  function field(label, path, value, o) {
    o = o || {};
    var ch = changedPaths();
    var d = el('div', 'field' + (ch[path] ? ' changed' : ''));
    var lab = el('label', null, label);
    var inp = o.multi ? el('textarea') : el('input');
    if (o.multi) inp.rows = 3;
    inp.value = value || '';
    inp.maxLength = o.max || 300;
    inp.id = 'f-' + path.replace(/\W/g, '-');
    lab.htmlFor = inp.id;
    inp.setAttribute('data-path', path);
    inp.onchange = function () { ops([{ op: 'set', path: path, value: inp.value }]); };
    d.appendChild(lab);
    var row = el('div', 'row');
    if (o.swatch) { var sw = el('span', 'sw'); sw.style.background = value; row.appendChild(sw); }
    row.appendChild(inp);
    d.appendChild(row);
    return d;
  }
  function fiche() {
    var box = F.clear($('fiche')), f = S.draft;
    box.appendChild(el('h2', null, T.ficheTitle));
    box.appendChild(el('p', 'note', T.ficheNote));
    box.appendChild(field(T.fName, 'name', f.name, { max: 80 }));
    var lang = el('div', 'field' + (changedPaths().language ? ' changed' : ''));
    lang.appendChild(el('label', null, T.fLang));
    var sel = el('select');
    sel.setAttribute('data-path', 'language');
    [['en', 'English'], ['fr', 'Français']].forEach(function (o) { var op = el('option', null, o[1]); op.value = o[0]; if ((f.language || 'en').slice(0, 2) === o[0]) op.selected = true; sel.appendChild(op); });
    sel.onchange = function () { ops([{ op: 'set', path: 'language', value: sel.value }]); };
    lang.appendChild(sel);
    box.appendChild(lang);
    box.appendChild(field(T.fIdentity, 'identity', f.identity, { multi: true, max: 600 }));
    box.appendChild(field(T.fTone, 'tone', f.tone, { max: 300 }));
    box.appendChild(field(T.fGreeting, 'brand.greeting', (f.brand || {}).greeting, { max: 160 }));
    box.appendChild(field(T.fColor, 'brand.color', (f.brand || {}).color || '#2F6B54', { swatch: true, max: 7 }));
    box.appendChild(field(T.fUnknown, 'unknown', f.unknown, { multi: true, max: 300 }));

    // Instructions
    var ch = changedPaths();
    box.appendChild(el('h3', null, T.fInstructions));
    (f.instructions || []).forEach(function (text, i) {
      var r = el('div', 'row' + (ch['instruction:' + text] ? ' changed' : ''));
      r.setAttribute('data-instruction', String(i));
      r.appendChild(el('span', null, text));
      var rm = F.btn(T.remove, '', function () { ops([{ op: 'remove_instruction', index: i }]); }, 'rm-instruction');
      rm.className = 'push';
      r.appendChild(rm);
      box.appendChild(r);
    });
    box.appendChild(addRow(T.addInstruction, 'instruction-new', function (v) { return ops([{ op: 'add_instruction', text: v }]); }));

    // Facts
    box.appendChild(el('h3', null, T.fFacts));
    (f.knowledge || []).forEach(function (k, i) {
      var r = el('div', 'fact' + (ch['fact:' + k.text] ? ' changed' : ''));
      r.setAttribute('data-fact', String(i));
      var top = el('div', 'row');
      top.appendChild(F.pill(k.validated ? T.validated : T.toValidate, k.validated ? 'ok' : 'warn'));
      top.appendChild(el('span', null, k.text));
      r.appendChild(top);
      var sub = el('div', 'row');
      if (k.source) sub.appendChild(el('small', 'muted', T.source + ': ' + k.source));
      if (!k.validated) sub.appendChild(F.btn(T.validate, 'primary', function () { ops([{ op: 'set_fact', index: i, validated: true }]); }, 'validate'));
      sub.appendChild(F.btn(T.remove, '', function () { ops([{ op: 'remove_fact', index: i }]); }, 'rm-fact'));
      r.appendChild(sub);
      box.appendChild(r);
    });
    box.appendChild(addRow(T.addFact, 'fact-new', function (v) { return ops([{ op: 'add_fact', text: v, source: 'owner', validated: true }]); }));
  }
  function addRow(placeholder, id, run) {
    var r = el('div', 'row tight');
    var inp = el('input');
    inp.placeholder = placeholder; inp.id = id; inp.maxLength = 300;
    inp.setAttribute('aria-label', placeholder);
    var add = F.btn(T.add, '', function () { var v = inp.value.trim(); if (!v) return; add.disabled = true; run(v).then(function () { add.disabled = false; }); }, 'add-' + id);
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); add.click(); } };
    r.appendChild(inp); r.appendChild(add);
    return r;
  }

  // ---------------------------------------------------------------- guard-rails (read by code, never by the assistant)
  function numberField(label, path, value, step) {
    var d = el('div', 'field');
    d.appendChild(el('label', null, label));
    var inp = el('input');
    inp.type = 'number'; inp.min = '0'; inp.step = String(step || 1); inp.value = String(value);
    inp.setAttribute('data-path', path);
    inp.onchange = function () { var n = Number(inp.value); if (isFinite(n)) ops([{ op: 'set', path: path, value: n }]); };
    d.appendChild(inp);
    return d;
  }
  function guard() {
    var box = F.clear($('guard')), s = S.sheet;
    box.appendChild(el('h2', null, T.guardTitle));
    box.appendChild(el('p', 'note', T.guardNote));
    box.appendChild(el('h3', null, T.gActions));
    s.actions.forEach(function (a) {
      var r = el('div', 'row between');
      r.setAttribute('data-action', a.name);
      var lab = el('span', null, tt('act.' + a.name));
      r.appendChild(lab);
      var right = el('div', 'row');
      if (a.needs && !a.ready) right.appendChild(F.pill(tt('needs_' + a.needs), 'warn'));
      if (a.minLevel > 1) right.appendChild(F.pill(T.level2, ''));
      var sel = el('select');
      sel.setAttribute('aria-label', tt('act.' + a.name));
      MODES.forEach(function (m) { var o = el('option', null, T['m_' + m]); o.value = m; if (a.mode === m) o.selected = true; sel.appendChild(o); });
      sel.onchange = function () { ops([{ op: 'set', path: 'guardrails.actions.' + a.name, value: sel.value }]); };
      right.appendChild(sel);
      r.appendChild(right);
      box.appendChild(r);
    });
    box.appendChild(el('h3', null, T.gBudget));
    var g2 = el('div', 'grid2');
    g2.appendChild(numberField(tt('gDay', { c: s.budget.currency }), 'guardrails.budget.dailyCap', s.budget.dailyCapMicro / 1e6, 0.1));
    g2.appendChild(numberField(tt('gVisitor', { c: s.budget.currency }), 'guardrails.budget.visitorDailyCap', s.budget.visitorDailyCapMicro / 1e6, 0.05));
    g2.appendChild(numberField(T.gRetention, 'guardrails.retentionMonths', s.retentionMonths, 1));
    box.appendChild(g2);

    box.appendChild(el('h3', null, T.gOrigins));
    box.appendChild(el('p', 'note', T.gOriginsNote));
    s.origins.forEach(function (o) {
      var r = el('div', 'row');
      r.appendChild(el('span', null, o));
      var rm = F.btn(T.remove, '', function () { ops([{ op: 'set', path: 'guardrails.allowedOrigins', value: s.origins.filter(function (x) { return x !== o; }) }]); }, 'rm-origin');
      rm.className = 'push'; r.appendChild(rm); box.appendChild(r);
    });
    box.appendChild(addRow('https://www.my-shop.example', 'origin-new', function (v) {
      var o; try { var u = new URL(v); o = u.origin; } catch (e) { flash(T.badOrigin); return Promise.resolve(); }
      if (!/^https?:\/\//.test(o)) { flash(T.badOrigin); return Promise.resolve(); }
      return ops([{ op: 'set', path: 'guardrails.allowedOrigins', value: s.origins.concat([o]) }]);
    }));

    box.appendChild(el('h3', null, T.gAgenda));
    var a = s.agenda;
    var on = el('label', 'row');
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!a.enabled; cb.style.flex = 'none';
    cb.setAttribute('data-path', 'agenda.enabled');
    cb.onchange = function () { ops([{ op: 'set', path: 'agenda.enabled', value: cb.checked }]); };
    on.appendChild(cb); on.appendChild(el('span', null, T.agendaOn));
    box.appendChild(on);
    if (a.enabled) {
      var days = el('div', 'row tight');
      DAYS.forEach(function (d) {
        var l = el('label', 'row'); var c = el('input'); c.type = 'checkbox'; c.style.flex = 'none'; c.checked = a.days.indexOf(d) >= 0;
        c.onchange = function () { var next = DAYS.filter(function (x) { return x === d ? c.checked : a.days.indexOf(x) >= 0; }); ops([{ op: 'set', path: 'agenda.days', value: next }]); };
        l.appendChild(c); l.appendChild(el('span', null, T['d' + d])); days.appendChild(l);
      });
      box.appendChild(days);
      var g3 = el('div', 'grid2');
      [['agenda.from', T.aFrom, a.from], ['agenda.to', T.aTo, a.to]].forEach(function (x) {
        var d = el('div', 'field'); d.appendChild(el('label', null, x[1])); var i = el('input'); i.type = 'time'; i.value = x[2]; i.setAttribute('data-path', x[0]);
        i.onchange = function () { ops([{ op: 'set', path: x[0], value: i.value }]); }; d.appendChild(i); g3.appendChild(d);
      });
      g3.appendChild(numberField(T.aSlot, 'agenda.slotMinutes', a.slotMinutes, 5));
      g3.appendChild(numberField(T.aHorizon, 'agenda.horizonDays', a.horizonDays, 1));
      box.appendChild(g3);
    }
  }

  // ---------------------------------------------------------------- what the assistant can really do
  function sheet() {
    var box = F.clear($('sheet')), s = S.sheet;
    box.appendChild(el('h2', null, T.sheetTitle));
    var ul = el('ul');
    s.actions.filter(function (a) { return a.mode !== 'off'; }).forEach(function (a) {
      var li = el('li', null, tt('act.' + a.name) + ' — ' + (a.mode === 'auto' ? T.sAuto : T.sApprove) + (a.needs && !a.ready ? ' (' + tt('needs_' + a.needs) + ')' : ''));
      ul.appendChild(li);
    });
    if (!ul.children.length) ul.appendChild(el('li', null, T.sNothing));
    box.appendChild(ul);
    var more = el('ul');
    more.appendChild(el('li', null, tt('sBudget', { day: F.money(s.budget.dailyCapMicro, s.budget.currency), visitor: F.money(s.budget.visitorDailyCapMicro, s.budget.currency) })));
    more.appendChild(el('li', null, tt('sMemory', { fields: s.memoryFields.map(function (f) { return T['f_' + f] || f; }).join(', ') })));
    more.appendChild(el('li', null, s.origins.length ? tt('sOrigins', { list: s.origins.join(', ') }) : T.sNoOrigins));
    more.appendChild(el('li', null, tt('sRetention', { n: s.retentionMonths })));
    more.appendChild(el('li', null, T.sCannot));
    box.appendChild(more);
    var row = el('div', 'row tight');
    row.appendChild(S.reviewed ? F.pill(T.iReadDone, 'ok') : F.btn(T.iRead, 'primary', function () { api('studio/review', 'POST').then(load); }, 'review-2'));
    box.appendChild(row);
  }

  // ---------------------------------------------------------------- changes, site script, versions
  function changes() {
    var box = F.clear($('changes'));
    box.appendChild(el('h2', null, T.changesTitle));
    if (!S.diff.length) { box.appendChild(el('p', 'muted', T.noChanges)); return; }
    S.diff.forEach(function (d) {
      var r = el('div', 'row');
      r.setAttribute('data-change', d.path);
      r.appendChild(F.pill(T['risk_' + d.risk], d.risk === 'high' ? 'bad' : d.risk === 'medium' ? 'warn' : ''));
      r.appendChild(el('span', null, label(d)));
      box.appendChild(r);
    });
    box.appendChild(F.confirmBtn(T.discard, T.discardConfirm, '', function () { api('studio/discard', 'POST').then(function () { load().then(refreshPreview); }); }, 'discard-2'));
  }
  function show(v) { if (v && typeof v === 'object') return v.text || JSON.stringify(v); return v === undefined || v === '' ? '∅' : String(v); }
  function label(d) {
    var base = d.path.indexOf('action.') === 0 ? tt('act.' + d.path.slice(7)) : (T['d_' + d.path] || d.path);
    if (d.kind === 'add') return base + ' + ' + show(d.after);
    if (d.kind === 'remove') return base + ' − ' + show(d.before);
    if (/Micro$/.test(d.path)) return base + ': ' + (d.before / 1e6) + ' → ' + (d.after / 1e6);
    return base + ': ' + show(d.before) + ' → ' + show(d.after);
  }
  function site() {
    var box = F.clear($('site'));
    box.appendChild(el('h2', null, T.siteTitle));
    box.appendChild(el('p', 'note', T.siteNote));
    var url = S.publicUrl;
    box.appendChild(el('p', null, T.sitePublic));
    var link = url ? url.replace(/\/+$/, '') + '/c/' + S.draft.slug : location.origin + '/c/' + S.draft.slug;
    box.appendChild(el('pre', 'snip', link));
    box.appendChild(el('p', null, T.siteScript));
    var snip = S.embed || '<script src="' + (url || location.origin) + '/widget.js" data-shop="' + S.draft.slug + '" async></' + 'script>';
    var pre = el('pre', 'snip', snip);
    pre.setAttribute('data-snippet', '1');
    box.appendChild(pre);
    var copy = F.btn(T.copy, '', function () { try { navigator.clipboard.writeText(snip).then(function () { copy.textContent = T.copied; setTimeout(function () { copy.textContent = T.copy; }, 1500); }); } catch (e) { /* the text is selectable anyway */ } }, 'copy');
    box.appendChild(copy);
    if (!url) box.appendChild(el('p', 'note', T.sitePublicMissing));
    if (!S.sheet.origins.length) box.appendChild(el('p', 'note', T.siteNoOrigins));
    var ch = S.channels || {};
    box.appendChild(el('h3', null, T.channels));
    var tg = ch.telegram;
    box.appendChild(el('p', null, T.chSite + ' · ' + (tg && tg.connected ? tt('chTg', { u: tg.username }) : T.chTgOff)));
  }
  function versions() {
    var box = F.clear($('versions'));
    box.appendChild(el('h2', null, T.versionsTitle));
    S.versions.forEach(function (v) {
      var r = el('div', 'row');
      r.setAttribute('data-version', String(v.n));
      r.appendChild(F.pill('v' + v.n, v.n === S.published.n ? 'ok' : ''));
      r.appendChild(el('span', null, F.when(v.ts) + ' · ' + v.by + (v.summary ? ' · ' + v.summary : '')));
      if (v.n !== S.published.n) { var b = F.confirmBtn(T.restore, T.restoreConfirm, '', function () { api('studio/rollback', 'POST', { version: v.n }).then(function () { load().then(refreshPreview); }); }, 'restore'); b.classList.add('push'); r.appendChild(b); }
      box.appendChild(r);
    });
    box.appendChild(el('h3', null, T.journal));
    S.journal.slice(0, 12).forEach(function (j) { box.appendChild(el('div', 'note', F.when(j.ts) + ' · ' + (T['j_' + j.kind] || j.kind) + ' · ' + j.by + (j.summary ? ' · ' + j.summary : ''))); });
  }

  // ---------------------------------------------------------------- preview
  function refreshPreview() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(function () { var f = $('preview'); if (f) f.src = 'preview'; }, 400);
  }

  function render() { head(); gate(); fiche(); guard(); sheet(); changes(); site(); versions(); }
  function authFail(e) { if (e && e.auth) { $('main').hidden = true; F.login(load); } else throw e; }
  function load() {
    return Promise.all([api('studio'), api('status')]).then(function (rs) {
      S = rs[0]; S.channels = rs[1].channels;
      $('login').hidden = true; $('main').hidden = false;
      var active = document.activeElement;
      var keep = active && active.getAttribute && active.getAttribute('data-path');
      var left = document.querySelector('.left'), top = left.scrollTop;
      render();
      left.scrollTop = top;
      if (keep) { var n = document.querySelector('[data-path="' + keep + '"]'); if (n && n !== active) n.focus(); }
    }).catch(authFail);
  }
  $('discard').onclick = function () { api('studio/discard', 'POST').then(function () { load().then(refreshPreview); }); };
  $('prevReset').onclick = function () { api('preview/reset', 'POST').then(function () { $('preview').src = 'preview'; }); };
  load().then(function () { if (S) $('preview').src = 'preview'; });
})();
