// The script of a shared chat Journal page (journal-page.mjs inlines it). Browser only: it reads the document in `#kj-doc` and draws it.
// The document is DATA: every word of it reaches the page as a text node, every shape as an SVG element built here, and a link only if it is http(s). Nothing becomes HTML,
// nothing is fetched, nothing is sent. Seals are checked here with the public key the page carries (WebCrypto, Ed25519), so a reader does not have to trust the author's word.
(function () {
  'use strict'
  var NS = 'http://www.w3.org/2000/svg'
  var doc = JSON.parse(document.getElementById('kj-doc').textContent)
  var L = doc.labels || {}
  var inc = doc.include || {}
  var lang = typeof doc.lang === 'string' ? doc.lang : 'en'
  var root = document.getElementById('kj-root')

  function num (v) { return typeof v === 'number' && isFinite(v) ? v : null }
  function add (e, k) {
    if (k === null || k === undefined || k === false) return
    if (Array.isArray(k)) { for (var i = 0; i < k.length; i += 1) add(e, k[i]); return }
    e.appendChild(typeof k === 'string' || typeof k === 'number' ? document.createTextNode(String(k)) : k)
  }
  function h (tag, cls) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    for (var i = 2; i < arguments.length; i += 1) add(e, arguments[i])
    return e
  }
  function s (tag, attrs) {
    var e = document.createElementNS(NS, tag)
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, String(attrs[k]))
    for (var i = 2; i < arguments.length; i += 1) add(e, arguments[i])
    return e
  }
  function word (key, fallback) { return typeof L[key] === 'string' ? L[key] : fallback }

  // ── formatting ──────────────────────────────────────────────────────────────────────
  function dur (ms) {
    var n = num(ms)
    if (n === null || n < 0) return '—'
    if (n < 1000) return Math.round(n) + ' ms'
    var sec = n / 1000
    if (sec < 10) return sec.toFixed(1) + ' s'
    if (sec < 60) return Math.round(sec) + ' s'
    var m = Math.floor(sec / 60)
    if (m < 10) return m + ' min ' + String(Math.round(sec % 60)).padStart(2, '0') + ' s'
    if (m < 60) return m + ' min'
    var hr = Math.floor(m / 60)
    if (hr < 48) return hr + ' h ' + String(m % 60).padStart(2, '0') + ' min'
    return Math.round(hr / 24) + ' d'
  }
  function eur (v) { var n = num(v); if (n === null) return '—'; try { return new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR', maximumFractionDigits: n < 1 ? 3 : 2 }).format(n) } catch (e) { return '€' + n.toFixed(2) } }
  function tok (n) { var v = num(n); if (v === null) return '—'; if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'; if (v >= 1e3) return Math.round(v / 1e3) + 'k'; return String(Math.round(v)) }
  function time (ms) { var n = num(ms); if (n === null) return ''; try { return new Date(n).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' }) } catch (e) { return '' } }
  function dayName (ms) { try { return new Date(ms).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short' }) } catch (e) { return '' } }
  function dayKey (ms) { var n = num(ms); if (n === null) return ''; var d = new Date(n); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate() }
  function clip (t, n) { return typeof t === 'string' && t.length > n ? t.slice(0, n).trimEnd() + '…' : (t || '') }
  function nice (t) { return typeof t === 'string' && t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '' }
  function host (u) { try { return new URL(u).hostname.replace(/^www\./, '') } catch (e) { return u } }
  function safeUrl (u) { try { var x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null } catch (e) { return null } }

  // ── icons (24x24, stroke) ───────────────────────────────────────────────────────────
  var ICONS = {
    message: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    reply: ['M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z'],
    crew: ['M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2', 'M21 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
    skill: ['M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.8 5.8 21.1 7 14.2 2 9.3l6.9-1z'],
    memory: ['M12 2l10 5-10 5L2 7z', 'M2 17l10 5 10-5', 'M2 12l10 5 10-5'],
    handover: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z', 'M16 11l2 2 4-4'],
    output: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
    model: ['M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', 'M9 9h6v6H9z', 'M9 1v3', 'M15 1v3', 'M9 20v3', 'M15 20v3', 'M20 9h3', 'M20 14h3', 'M1 9h3', 'M1 14h3'],
    goal: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'M18 12a6 6 0 1 1-12 0 6 6 0 0 1 12 0z', 'M14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0z'],
    work: ['M4 17l6-6-6-6', 'M12 19h8'],
    automation: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'M12 6v6l4 2'],
    connector: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z'],
    link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
    monitor: ['M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 21h8', 'M12 17v4'],
    check: ['M20 6L9 17l-5-5'],
    alert: ['M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
    shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', 'M9 12l2 2 4-4'],
    file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6']
  }
  function icon (name, size) {
    var paths = ICONS[name] || ICONS.work
    var kids = paths.map(function (d) { return s('path', { d: d }) })
    return s.apply(null, ['svg', { viewBox: '0 0 24 24', width: size || 16, height: size || 16, fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }].concat(kids))
  }

  // ── pieces ──────────────────────────────────────────────────────────────────────────
  function logoOf (id) {
    var u = doc.logos && typeof doc.logos[id] === 'string' ? doc.logos[id] : null
    return u !== null && /^data:image\/svg\+xml;base64,[A-Za-z0-9+\/=]+$/.test(u) ? u : null
  }
  function connTile (conn, big) {
    var u = conn ? logoOf(conn.id) : null
    var tile = h('span', 'kj-tile' + (u !== null ? ' logo' : '') + (big ? ' big' : ''))
    if (u !== null) { var img = h('img'); img.setAttribute('src', u); img.setAttribute('alt', ''); img.setAttribute('width', '20'); img.setAttribute('height', '20'); tile.appendChild(img) } else tile.appendChild(h('b', '', conn && conn.name ? String(conn.name).charAt(0).toUpperCase() : '?'))
    return tile
  }
  function pill (cls, text, title) { var p = h('span', 'kj-pill ' + cls, text); if (title) p.setAttribute('title', title); return p }
  function stat (label, value, sub, cls) { return h('div', 'kj-stat' + (cls ? ' ' + cls : ''), h('div', 'kj-k', label), h('div', 'kj-v', value), sub ? h('div', 'kj-s', sub) : null) }
  function card (title, hint) { return h('section', 'kj-card', h('div', 'kj-ch', h('h2', '', title), hint ? h('span', 'kj-hint', hint) : null)) }
  function crewOf (id) { var c = doc.crews || []; for (var i = 0; i < c.length; i += 1) if (c[i].id === id) return c[i]; return null }

  // ── charts ──────────────────────────────────────────────────────────────────────────
  function areaChart () {
    var pts = Array.isArray(doc.series) ? doc.series : []
    var priced = pts.some(function (p) { return num(p[1]) !== null && p[1] > 0 })
    var vals = pts.map(function (p) { return priced ? num(p[1]) : num(p[0]) })
    var max = Math.max.apply(null, vals.map(function (v) { return v === null ? 0 : v }).concat([0]))
    if (pts.length < 2 || max <= 0) return null
    var w = 300; var hh = 80
    var xy = vals.map(function (v, i) { return [(i / (pts.length - 1)) * w, hh - 4 - ((v === null ? 0 : v) / max) * (hh - 12)] })
    var line = 'M' + xy[0][0].toFixed(1) + ' ' + xy[0][1].toFixed(1)
    for (var i = 1; i < xy.length; i += 1) { var mx = (xy[i - 1][0] + xy[i][0]) / 2; line += ' C' + mx.toFixed(1) + ' ' + xy[i - 1][1].toFixed(1) + ' ' + mx.toFixed(1) + ' ' + xy[i][1].toFixed(1) + ' ' + xy[i][0].toFixed(1) + ' ' + xy[i][1].toFixed(1) }
    var svg = s('svg', { viewBox: '0 0 ' + w + ' ' + hh, preserveAspectRatio: 'none', class: 'kj-area', role: 'img', 'aria-label': priced ? word('costOver', 'Cost') : word('tokensOver', 'Tokens') },
      s('path', { d: line + ' L' + w + ' ' + hh + ' L0 ' + hh + ' Z', class: 'kj-area-f' }), s('path', { d: line, class: 'kj-area-l', 'vector-effect': 'non-scaling-stroke' }))
    var total = doc.stats ? num(doc.stats.costEur) : null
    return h('div', 'kj-chart', svg, h('div', 'kj-chart-n', priced ? eur(total !== null ? total : max) : tok(max) + ' ' + word('tokens', 'tokens')))
  }
  function donut () {
    var st = doc.stats || {}
    var active = num(st.activeMs)
    if (inc.timing !== true || active === null || active <= 0) return null
    var wait = Math.min(active, num(st.waitingMs) || 0)
    var crew = Math.min(active, num(st.crewMs) || 0)
    if (wait + crew > active) { var f = active / (wait + crew); wait *= f; crew *= f }
    var parts = [['crew', crew, word('timeCrews', 'Crews')], ['wait', wait, word('timePeople', 'Waiting for people')], ['chat', Math.max(0, active - wait - crew), word('timeChat', 'The chat itself')]]
    var off = 25
    var rings = parts.map(function (p) { var pct = (p[1] / active) * 100; var c = s('circle', { cx: 18, cy: 18, r: 15.9155, fill: 'none', 'stroke-width': 4, class: 'kj-ring ' + p[0], 'stroke-dasharray': pct.toFixed(2) + ' ' + (100 - pct).toFixed(2), 'stroke-dashoffset': off.toFixed(2) }); off -= pct; return c })
    var legend = parts.map(function (p) { return h('li', '', h('i', 'kj-dot ' + p[0]), h('span', '', p[2]), h('b', '', dur(p[1]))) })
    return h('div', 'kj-donut', s.apply(null, ['svg', { viewBox: '0 0 36 36', class: 'kj-donut-s', role: 'img', 'aria-label': word('timeTitle', 'Where the time went') }].concat(rings)), h('ul', 'kj-legend', legend))
  }
  function crewBars () {
    var crews = (doc.crews || []).filter(function (c) { return num(c.startedAt) !== null })
    if (crews.length === 0) return null
    var t0 = Math.min.apply(null, crews.map(function (c) { return c.startedAt }))
    // A crew still running reaches the last moment of the chat.
    var t1 = Math.max.apply(null, crews.map(function (c) { return num(c.endedAt) !== null ? c.endedAt : c.startedAt }).concat([doc.chat && num(doc.chat.endedAt) !== null ? doc.chat.endedAt : 0]))
    var span = Math.max(1, t1 - t0)
    return h('div', 'kj-bars', crews.map(function (c) {
      var left = ((c.startedAt - t0) / span) * 100
      var width = Math.max(2, (((num(c.endedAt) !== null ? c.endedAt : t1) - c.startedAt) / span) * 100)
      return h('div', 'kj-bar', h('span', 'kj-bn', c.name || word('crew', 'Crew')),
        s('svg', { viewBox: '0 0 100 6', preserveAspectRatio: 'none', class: 'kj-track', 'aria-hidden': 'true' }, s('rect', { x: 0, y: 0, width: 100, height: 6, rx: 3, class: 'kj-track-b' }), s('rect', { x: left.toFixed(2), y: 0, width: Math.min(width, 100 - left).toFixed(2), height: 6, rx: 3, class: 'kj-track-f ' + (c.state || 'done') })))
    }))
  }

  // ── seals ───────────────────────────────────────────────────────────────────────────
  var checks = []
  function b64 (t) { var bin = atob(t); var a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i += 1) a[i] = bin.charCodeAt(i); return a }
  function sealChip (a) {
    if (a.seal === 'broken') return pill('bad', word('sealBroken', 'Seal broken'), word('sealBrokenT', ''))
    if (a.seal === 'foreign') return pill('off', word('sealElsewhere', 'Sealed elsewhere'), word('sealElsewhereT', ''))
    if (a.seal !== 'valid') return null
    if (a.evidence && doc.seal && typeof doc.seal.publicKey === 'string') {
      var chip = pill('off', word('sealChecking', 'Checking…'), '')
      checks.push({ chip: chip, a: a })
      return chip
    }
    return pill('ok', word('sealed', 'Sealed'), word('sealedT', ''))
  }
  function parsePayload (t) { try { var p = JSON.parse(t); return Array.isArray(p) && p.length === 8 && p[0] === 'kybernos-journal-seal/1' ? p : null } catch (e) { return null } }
  function plain (id) { return typeof id === 'string' ? id.replace(/^session-/, '') : id }
  function verifyOne (c) {
    var a = c.a
    var p = parsePayload(a.evidence.payload)
    var chatId = doc.chat ? plain(doc.chat.id) : null
    var same = p !== null && p[1] === chatId && p[5] === (a.who === undefined ? null : a.who) && p[6] === (a.device === undefined ? null : a.device) && p[7] === num(a.at) && String(p[4]).split(':')[0] === a.state
    if (!same) return Promise.resolve('mismatch')
    if (!(window.crypto && window.crypto.subtle)) return Promise.resolve('unsupported')
    var pem = doc.seal.publicKey.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')
    return window.crypto.subtle.importKey('spki', b64(pem), { name: 'Ed25519' }, false, ['verify'])
      .then(function (key) { return window.crypto.subtle.verify({ name: 'Ed25519' }, key, b64(a.evidence.sig), new TextEncoder().encode(a.evidence.payload)) })
      .then(function (good) { return good === true ? 'ok' : 'mismatch' }, function () { return 'unsupported' })
  }
  function paint (c, state) {
    var map = { ok: ['ok', word('sealChecked', 'Checked in this browser'), word('sealCheckedT', '')], mismatch: ['bad', word('sealMismatch', 'Does not match'), word('sealMismatchT', '')], unsupported: ['off', word('sealUnsupported', 'This browser cannot check it'), ''] }
    var m = map[state] || map.unsupported
    c.chip.className = 'kj-pill ' + m[0]
    c.chip.textContent = m[1]
    c.chip.setAttribute('title', m[2])
  }

  // ── rows ────────────────────────────────────────────────────────────────────────────
  var STATE = { waiting: ['wait', 'needsPerson', 'Waiting for a person'], answered: ['ok', 'answered', 'Answered'], allowed: ['ok', 'allowed', 'Allowed'], denied: ['err', 'declined', 'Declined'], error: ['err', 'failedState', 'Failed'] }
  function approverBlock (a) {
    var st = STATE[a.state] || STATE.answered
    return h('li', 'kj-ap',
      h('span', 'kj-av', a.who ? String(a.who).charAt(0).toUpperCase() : icon('handover', 12)),
      h('span', 'kj-an', a.who || word('approver', 'Approver')),
      a.device ? h('span', 'kj-ad', icon('monitor', 12), ' ', a.device) : null,
      sealChip(a),
      h('span', 'kj-as ' + st[0], word(st[1], st[2])),
      num(a.at) !== null ? h('span', 'kj-at', time(a.at)) : null)
  }
  function words (m) {
    if (m.kind === 'message') return { actor: m.automation === true ? word('automation', 'Automation') : word('you', 'A person'), text: m.text, sub: '' }
    if (m.kind === 'reply') return { actor: word('reply', 'Reply'), text: m.text, sub: m.model || '' }
    if (m.kind === 'crew') { var c = crewOf(m.crewId); return { actor: c && c.name ? c.name : word('crew', 'Crew'), text: m.status === 'running' ? word('isRunning', 'is running') : (m.status === 'failed' ? word('failed', 'failed') : word('finished', 'finished')), sub: c ? word('members', 'Members') + ' · ' + c.members.length : '' } }
    if (m.kind === 'connector') { var conn = connOf(m.connectorId); return { actor: nice(conn ? conn.name : m.connectorId), text: m.status === 'error' ? word('callFailed', 'call failed') + ' · ' + (m.action || '') : (m.action || ''), sub: m.status === 'error' && m.recovered === true ? word('recovered', 'Recovered on a later call') : '' } }
    if (m.kind === 'skill') return { actor: word('skill', 'Skill'), text: m.name || '', sub: '' }
    if (m.kind === 'memory') return { actor: word('memory', 'Memory'), text: m.op === 'write' ? word('savedNote', 'saved a note') : word('lookedUp', 'looked something up'), sub: m.text || '' }
    if (m.kind === 'handover') return { actor: m.source === 'permission' ? word('permissionAsked', 'Permission asked') : word('questionAsked', 'Question asked'), text: m.text || '', sub: '' }
    if (m.kind === 'output') return { actor: word('delivered', 'Delivered'), text: (m.files || []).map(function (f) { return f.name }).join(', ') || (m.count + ' ' + word('files', 'files')), sub: '' }
    if (m.kind === 'model') return { actor: word('model', 'Model'), text: (m.initial === true ? word('startsOn', 'starts on') : word('switchedTo', 'switched to')) + ' ' + (m.model || ''), sub: m.provider || '' }
    if (m.kind === 'goal') return { actor: word('objective', 'Objective'), text: m.text || '', sub: m.op || '' }
    if (m.kind === 'work') return { actor: word('actions', 'Actions'), text: String(m.total), sub: '' }
    return { actor: '', text: m.kind, sub: '' }
  }
  function connOf (id) { var c = doc.connectors || []; for (var i = 0; i < c.length; i += 1) if (c[i].id === id) return c[i]; return null }
  function isErr (m) { return (m.kind === 'connector' && m.status === 'error' && m.recovered !== true) || (m.kind === 'crew' && m.status === 'failed') || (m.kind === 'handover' && m.outcome === 'error') }
  function row (m) {
    var W = words(m)
    var hidden = (m.kind === 'message' || m.kind === 'reply' || m.kind === 'goal') && !W.text
    var tile = m.kind === 'connector' ? connTile(connOf(m.connectorId), false) : h('span', 'kj-tile k-' + m.kind, icon(m.kind, 16))
    var extra = []
    if (m.kind === 'work' && m.counts) {
      var names = [['command', 'commands', 'Commands'], ['edit', 'edited', 'Files edited'], ['read', 'read', 'Files read'], ['web', 'web', 'Web lookups'], ['crew', 'mates', 'Teammates and sub-agents'], ['other', 'otherActions', 'Other actions']]
      extra.push(h('div', 'kj-chips', names.filter(function (n) { return m.counts[n[0]] > 0 }).map(function (n) { return h('span', 'kj-chip', word(n[1], n[2]) + ' ' + m.counts[n[0]]) }), m.failed > 0 ? h('span', 'kj-chip warn', icon('alert', 12), ' ', m.failed) : null))
    }
    if (m.kind === 'handover') {
      if (m.options && m.options.length > 0) extra.push(h('div', 'kj-chips', m.options.map(function (o) { return h('span', 'kj-chip', o) })))
      if (Array.isArray(m.approvers) && m.approvers.length > 0) extra.push(h('ul', 'kj-appr', m.approvers.map(approverBlock)))
      else if (inc.approvers !== true) extra.push(h('div', 'kj-sub', word('decisionHidden', 'Who decided is not included.')))
    }
    if (m.kind === 'output' && Array.isArray(m.files) && m.files.length > 0) extra.push(h('div', 'kj-chips', m.files.slice(0, 6).map(function (f) { return h('span', 'kj-chip', icon('file', 12), ' ', f.name) })))
    var right = []
    var bad = isErr(m)
    if (m.kind === 'handover') { var st = STATE[m.outcome] || STATE.answered; right.push(pill(st[0], word(st[1], st[2]))) }
    if (bad) right.push(pill('err', word('failedState', 'Failed')))
    if (m.kind === 'crew' && m.status === 'running') right.push(pill('wait', word('running', 'Running')))
    if (num(m.durMs) !== null && inc.timing === true) right.push(h('span', 'kj-dur', dur(m.durMs)))
    else if (num(m.waitMs) !== null && inc.timing === true) right.push(h('span', 'kj-dur', dur(m.waitMs)))
    return h('li', 'kj-row' + (bad ? ' bad' : ''),
      h('span', 'kj-time', time(m.at)), tile,
      h('div', 'kj-body', h('div', 'kj-head', h('span', 'kj-actor', W.actor), hidden ? h('span', 'kj-text muted', word('textHidden', 'Text not included')) : h('span', 'kj-text', m.kind === 'handover' && W.text ? '“' + clip(W.text, 300) + '”' : clip(W.text, 400))),
        W.sub ? h('div', 'kj-sub', clip(W.sub, 160)) : null, extra),
      h('div', 'kj-right', right))
  }

  // ── sections ────────────────────────────────────────────────────────────────────────
  function hero () {
    var chat = doc.chat || {}
    var title = doc.title || word('pageTitle', 'Chat journal')
    var when = num(chat.startedAt) !== null ? dayName(chat.startedAt) + ' · ' + time(chat.startedAt) + (num(chat.endedAt) !== null && !chat.running ? ' – ' + time(chat.endedAt) : '') : ''
    return h('header', 'kj-hero',
      doc.title ? h('div', 'kj-eyebrow', word('eyebrow', 'Chat journal')) : null,
      h('h1', '', title),
      h('div', 'kj-meta',
        when ? h('span', '', when) : null,
        chat.running ? pill('wait', word('running', 'Running')) : null,
        h('span', 'kj-chip', icon(doc.trigger === 'automation' ? 'automation' : 'message', 12), ' ', doc.trigger === 'automation' ? word('byAutomation', 'Started by an automation') : word('byPerson', 'Started by a person')),
        chat.id ? h('span', 'kj-chip', word('chatId', 'Chat') + ' · ' + String(chat.id).replace(/^session-/, '').slice(0, 8)) : null))
  }
  function kpis () {
    var st = doc.stats || {}
    var cost = num(st.costEur)
    var tokens = st.tokens ? (num(st.tokens.input) || 0) + (num(st.tokens.output) || 0) : null
    var list = []
    if (inc.timing === true) list.push(stat(word('kActive', 'Active time'), dur(st.activeMs), num(st.waitingMs) > 0 ? word('kWaited', 'Waited for people') + ' ' + dur(st.waitingMs) : ''))
    list.push(stat(word('kCrews', 'Crews'), String((doc.crews || []).length), ''))
    list.push(stat(word('kHandovers', 'Handovers'), String(st.handovers || 0), st.handoversWaiting > 0 ? st.handoversWaiting + ' ' + word('kOpen', 'open') : ''))
    if (inc.timing === true) list.push(stat(word('kErrors', 'Errors'), String(st.errors || 0), st.openErrors > 0 ? st.openErrors + ' ' + word('kOpen', 'open') : (st.errors > 0 ? word('kRecovered', 'all recovered') : ''), st.openErrors > 0 ? 'err' : ''))
    list.push(cost !== null && cost > 0 ? stat(word('kCost', 'Cost'), eur(cost), tok(tokens) + ' ' + word('tokens', 'tokens')) : stat(word('kTokens', 'Tokens'), tok(tokens), word('kFree', 'no price known')))
    list.push(stat(word('kDeliverables', 'Deliverables'), String(st.deliverables || 0), ''))
    return h('div', 'kj-kpis', list)
  }
  function insights () {
    var parts = [areaChart(), donut(), crewBars()]
    if (parts.every(function (p) { return p === null })) return null
    var c = h('section', 'kj-card kj-ins')
    var a = parts[0]; var d = parts[1]; var b = parts[2]
    if (a) c.appendChild(h('div', 'kj-in', h('h3', '', word('costTitle', 'Over the chat')), a))
    if (d) c.appendChild(h('div', 'kj-in', h('h3', '', word('timeTitle', 'Where the time went')), d))
    if (b) c.appendChild(h('div', 'kj-in wide', h('h3', '', word('crewsTitle', 'Crews')), b))
    return c
  }
  function crews () {
    var list = doc.crews || []
    if (list.length === 0) return null
    return h('div', 'kj-crews', list.map(function (c) {
      var st = c.state === 'failed' ? ['err', word('failed', 'failed')] : (c.state === 'running' ? ['wait', word('running', 'Running')] : ['ok', word('finished', 'finished')])
      return h('div', 'kj-crew', h('div', 'kj-crew-h', h('b', '', c.name || word('crew', 'Crew')), pill(st[0], st[1])),
        h('div', 'kj-sub', word('members', 'Members') + ' · ' + (c.members || []).length + (inc.timing === true && num(c.durMs) !== null ? ' · ' + dur(c.durMs) : '') + (num(c.costEur) !== null && c.costEur > 0 ? ' · ' + eur(c.costEur) : '')),
        h('ul', 'kj-members', (c.members || []).slice(0, 6).map(function (m) { return h('li', '', h('span', '', m.label || m.phase || ''), m.model ? h('em', '', m.model) : null) })))
    }))
  }
  function connectors () {
    var list = doc.connectors || []
    if (list.length === 0) return null
    var c = card(word('connectorsTitle', 'Connected apps'), list.length + '')
    c.appendChild(h('div', 'kj-conns', list.map(function (x) { return h('div', 'kj-conn', connTile(x, true), h('div', '', h('b', '', nice(x.name)), h('div', 'kj-sub', x.calls + ' ' + word('calls', 'calls') + (inc.timing === true && x.errors > 0 ? ' · ' + x.errors + ' ' + word('errorsN', 'errors') : '')))) })))
    return c
  }
  var LIMIT = 80
  function story () {
    var moments = doc.moments || []
    var c = card(word('storyTitle', 'Story of this chat'), moments.length + ' ' + word('moments', 'moments'))
    var list = h('ul', 'kj-list')
    var day = ''
    var drawn = 0
    function draw (upTo) {
      for (; drawn < upTo && drawn < moments.length; drawn += 1) {
        var m = moments[drawn]
        var k = dayKey(m.at)
        if (k !== '' && k !== day) { list.appendChild(h('li', 'kj-day', dayName(m.at))); day = k }
        list.appendChild(row(m))
      }
    }
    draw(LIMIT)
    c.appendChild(list)
    if (moments.length > LIMIT) {
      var btn = h('button', 'kj-more', word('showAll', 'Show all') + ' · ' + (moments.length - LIMIT))
      btn.setAttribute('type', 'button')
      btn.addEventListener('click', function () { draw(moments.length); btn.remove() })
      c.appendChild(btn)
    }
    return c
  }
  function deliverables () {
    var list = doc.deliverables || []
    var c = card(word('deliverablesTitle', 'Deliverables and links'), list.length + '')
    if (inc.deliverables !== true) { c.appendChild(h('p', 'kj-sub', word('deliverablesHidden', 'Deliverables and links are not included.'))); return c }
    if (list.length === 0) { c.appendChild(h('p', 'kj-sub', word('none', 'Nothing yet.'))); return c }
    c.appendChild(h('ul', 'kj-dl', list.map(function (d) {
      var href = d.kind === 'link' ? safeUrl(d.url) : null
      var inner = [h('span', 'kj-tile k-' + (d.kind === 'link' ? 'connector' : 'output'), icon(d.kind === 'link' ? 'link' : 'output', 14)), h('span', 'kj-dn', h('b', '', d.name || host(d.url || '')), d.description ? h('span', 'kj-sub', clip(d.description, 120)) : null)]
      if (href === null) return h('li', '', inner)
      var a = h('a', '', inner)
      a.setAttribute('href', href); a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer nofollow')
      return h('li', '', a)
    })))
    return c
  }
  function included () {
    var items = [['approvers', 'incApprovers'], ['names', 'incNames'], ['computers', 'incComputers'], ['timing', 'incTiming'], ['deliverables', 'incDeliverables'], ['prompts', 'incPrompts'], ['chatId', 'incChatId']]
    return h('div', 'kj-inc', items.map(function (i) { return h('span', 'kj-chip ' + (inc[i[0]] === true ? 'yes' : 'no'), (inc[i[0]] === true ? '✓ ' : '– ') + word(i[1], i[0])) }))
  }
  function footer () {
    var sealed = 0
    ;(doc.moments || []).forEach(function (m) { (m.approvers || []).forEach(function (a) { if (a.seal === 'valid') sealed += 1 }) })
    var f = h('footer', 'kj-foot')
    f.appendChild(h('div', 'kj-foot-h', icon('shield', 16), h('b', '', word('verifyTitle', 'Seals'))))
    var line = h('p', 'kj-sub')
    f.appendChild(line)
    line.textContent = sealed === 0 ? word('noSeals', 'No decision of this chat carries a seal.') : (doc.seal && doc.seal.publicKey ? word('sealsCheckable', 'Each seal is checked in this browser against the key of the computer that made it.') : sealed + ' ' + word('sealsClaimed', 'decisions were sealed and checked on the author\'s computer when this page was made.'))
    if (doc.seal && doc.seal.keyId) f.appendChild(h('p', 'kj-sub', word('keyLabel', 'Key') + ' · ' + doc.seal.keyId))
    f.appendChild(h('p', 'kj-sub', word('sealNote', 'A simple seal, not a qualified electronic signature.')))
    f.appendChild(h('div', 'kj-foot-h', h('b', '', word('containsTitle', 'What this page contains'))))
    f.appendChild(included())
    f.appendChild(h('p', 'kj-made', word('madeWith', 'Made with Kybernos') + (doc.made ? ' · ' + doc.made : '')))
    return f
  }

  function draw () {
    if (!doc || doc.kind !== 'kybernos-journal') { root.appendChild(h('p', 'kj-sub', 'This page cannot be shown.')); return }
    document.title = (doc.title || word('pageTitle', 'Chat journal'))
    var side = h('aside', 'kj-side', connectors(), deliverables())
    root.appendChild(h('div', 'kj-wrap', hero(), kpis(), insights(), crews(), h('div', 'kj-cols', story(), side), footer()))
    Promise.all(checks.map(function (c) { return verifyOne(c).then(function (state) { paint(c, state) }) })).then(function () {
      var ok = checks.filter(function (c) { return c.chip.className.indexOf('ok') >= 0 }).length
      var line = root.querySelector('.kj-foot .kj-sub')
      if (line && checks.length > 0) line.textContent = ok + ' / ' + checks.length + ' ' + word('sealsOk', 'seals checked in this browser')
    })
  }
  draw()
})()
