// ═══════════════════════════════════════════════════════
// kybernos-pulse — client half: the Settings section "Widget", the floating window, the banners and the badge.
//
// It follows what the host half files (finished, failed, waiting for an approval) and brings the person back to Kybernos:
//   · a floating window, always on top of the other windows, drawn by this file through the browser's Document Picture-in-Picture
//     (Chrome, Edge, Brave, Vivaldi, Opera). Safari and Firefox do not have it: banners and the badge still work there.
//   · system banners through the browser's Notification API, once per event, never for what is older than ten minutes.
//   · a count on the tab title and, when Kybernos is installed as an app, on its Dock icon (Badging API).
//   · a link on every card: it opens Kybernos on the Automations page (window.__KB_OPEN__) and brings its tab to the front.
//
// The browser's rules decide what is possible: the window opens from a click, never by itself; its place is the person's; Kybernos
// must stay open in a tab. The Settings page says so.
//
// Everything is wrapped in try/catch: this module is optional, never the reason a page fails to load.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-pulse',
  factory: (require) => {
    try {
      const NAME = 'kybernos-pulse'

      const lang = () => {
        try {
          const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
          const s = String(l || '')
          // French only when the resolved language IS French (the 'kybernos' default or a fr base); every other language gets English.
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      // The pair helper is self-contained (a test runs it on its own): the pack of pairs it meets, fr → { fr, en }, collected at run time
      // for the i18n pack, lives on the helper itself.
      const kt = (fr, en) => {
        const pack = kt.pack || (kt.pack = {})
        if (pack[fr] === undefined) pack[fr] = { fr, en }
        return (lang() === 'fr' ? fr : en)
      }
      const PACK_STRINGS = (() => { kt.pack = kt.pack || {}; return kt.pack })()
      // A sentence with holes: the pair stays one fixed key of the pack ('{task} a échoué'), the values are poured in afterwards.
      const kn = (fr, en, vars) => String(kt(fr, en)).replace(/\{(\w+)\}/g, (m, k) => (vars !== undefined && vars[k] !== undefined ? String(vars[k]) : m))

      // ── pure helpers (tested without a browser) ──────────────────────────────────────────────────────────
      const POLL_MS = 10000
      const POLL_HIDDEN_MS = 30000
      /** A banner is shown only for what just happened; older events are marked as shown without a word (nobody wants a flood on opening a tab). */
      const FRESH_MS = 10 * 60 * 1000
      const TOKENS = ['--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-label-primary-foreground', '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3', '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-interactive-bg-hover', '--dsw-alias-button-primary-fill', '--dsw-alias-state-success-primary', '--dsw-alias-state-error-primary', '--dsw-alias-state-warn-primary']

      const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

      const fmtDur = (ms) => {
        if (typeof ms !== 'number' || !isFinite(ms) || ms < 0) return ''
        const s = Math.round(ms / 1000)
        if (s < 60) return s + ' s'
        const m = Math.floor(s / 60)
        if (m < 60) return m + ' m ' + String(s % 60).padStart(2, '0') + ' s'
        return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0')
      }
      const ago = (at, now) => {
        const d = now - at
        if (!(d >= 0) || d < 45000) return kt('à l’instant', 'just now')
        const m = Math.round(d / 60000)
        if (m < 60) return kn('il y a {n} min', '{n} min ago', { n: m })
        const hh = Math.round(m / 60)
        if (hh < 48) return kn('il y a {n} h', '{n} h ago', { n: hh })
        return kn('il y a {n} j', '{n} d ago', { n: Math.round(hh / 24) })
      }
      const callsText = (n) => (n === 1 ? kn('{n} appel', '{n} call', { n }) : kn('{n} appels', '{n} calls', { n }))

      /** The two lines of a card, and the title and body of its banner. */
      const itemText = (it) => {
        if (it.kind === 'waiting') return { title: kn('{task} a besoin de toi', '{task} needs you', { task: it.task }), sub: it.tool ? kn('Demande à utiliser {tool}', 'Asks to use {tool}', { tool: it.tool }) : kt('Attend ton accord', 'Waits for your approval') }
        if (it.kind === 'failed') return { title: kn('{task} a échoué', '{task} failed', { task: it.task }), sub: it.message || it.code || kt('Sans détail', 'No detail') }
        const bits = []
        if (typeof it.calls === 'number') bits.push(callsText(it.calls))
        if (typeof it.durMs === 'number') bits.push(fmtDur(it.durMs))
        return { title: kn('{task} est terminée', '{task} finished', { task: it.task }), sub: bits.length > 0 ? bits.join(' · ') : kt('Terminée', 'Finished') }
      }

      /** The big sentence of the panel: what needs the person, what runs, what is new, or nothing. */
      const hero = (snap) => {
        const todo = snap.inbox.filter((x) => x.todo === true && x.quiet !== true)
        const fresh = snap.inbox.filter((x) => x.todo !== true && x.unread === true && x.quiet !== true)
        const names = (list) => list.slice(0, 2).map((x) => x.task).join(' · ') + (list.length > 2 ? ' · +' + (list.length - 2) : '')
        const bad = todo.some((x) => x.kind === 'failed')
        if (todo.length > 0) return { tone: bad ? 'bad' : 'ask', title: todo.length === 1 ? kt('1 chose t’attend', '1 thing needs you') : kn('{n} choses t’attendent', '{n} things need you', { n: todo.length }), sub: names(todo) }
        if (snap.running.length > 0) return { tone: 'run', title: snap.running.length === 1 ? kt('1 run en cours', '1 run is going') : kn('{n} runs en cours', '{n} runs are going', { n: snap.running.length }), sub: names(snap.running) }
        if (fresh.length > 0) return { tone: 'ok', title: fresh.length === 1 ? kt('1 nouveau résultat', '1 new result') : kn('{n} nouveaux résultats', '{n} new results', { n: fresh.length }), sub: names(fresh) }
        return { tone: 'idle', title: kt('Tout est calme', 'All quiet'), sub: kt('Rien ne t’attend.', 'Nothing waits for you.') }
      }

      /** The tab title with the count in front; the count is taken off first, so it never stacks. */
      const badgeTitle = (title, n) => {
        const base = String(title).replace(/^\(\d+\+?\)\s+/, '')
        return n > 0 ? '(' + (n > 99 ? '99+' : n) + ') ' + base : base
      }

      /** The Mac menu-bar app is reading the state right now. */
      const helperSeen = (snap) => snap !== null && snap !== undefined && snap.helper !== null && typeof snap.helper === 'object' && snap.helper.seen === true
      /** ... and its notifications are allowed: it puts the banners up itself, so the browser keeps quiet (no event shown twice, and none taken from it). */
      const helperBanners = (snap) => helperSeen(snap) && snap.helper.banners === true

      /** The banners to show now: due ones, fresh enough, and only when the person allowed them. `skipped` are marked as shown without a word. */
      const bannersToShow = (snap, now, canShow) => {
        // The helper puts them up and remembers which: marking them shown from here would take them away from it before its next read.
        if (helperBanners(snap)) return { show: [], skipped: [] }
        const byId = new Map(snap.inbox.map((x) => [x.id, x]))
        const show = []
        const skipped = []
        for (const id of snap.banners) {
          const it = byId.get(id)
          if (it === undefined) continue
          if (canShow === true && now - it.at <= FRESH_MS) show.push(it)
          else skipped.push(it.id)
        }
        return { show: show.slice(0, 3), skipped: skipped.concat(show.slice(3).map((x) => x.id)) }
      }

      const ICON = {
        done: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
        failed: '<path d="M7 7l10 10M17 7L7 17"/>',
        waiting: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><circle cx="12" cy="16.2" r=".7" fill="currentColor"/>',
        run: '<path d="M21 12a9 9 0 1 1-6.2-8.55"/>',
        up: '<path d="M7 17L17 7M9 7h8v8"/>',
        x: '<path d="M7 7l10 10M17 7L7 17"/>',
        bell: '<path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
        checks: '<path d="M2 13l4 4 7-8M10 15l1 1 8-8"/>'
      }
      const svg = (name, cls) => '<svg class="kbpu-i ' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>'

      // The panel of the floating window, as one HTML string: no framework in a window of its own, one delegated click handler.
      // `m` = { snap, tab, filter, now, mark } where `mark` is the brand mark's data address ('' when the brand bundle is absent).
      const panelHTML = (m) => {
        const snap = m.snap
        const h = hero(snap)
        const todo = snap.inbox.filter((x) => x.todo === true)
        const results = snap.inbox.filter((x) => x.todo !== true)
        const list = m.filter === 'results' ? results : todo
        const card = (it) => {
          const t = itemText(it)
          return '<article class="kbpu-card ' + esc(it.tone) + (it.unread ? ' un' : '') + (it.quiet ? ' q' : '') + '" data-kb="pulse-card" data-id="' + esc(it.id) + '">' +
            '<span class="kbpu-ci">' + svg(it.kind) + '</span>' +
            '<div class="kbpu-ct"><b>' + esc(t.title) + '</b><span>' + esc(t.sub) + ' · ' + esc(ago(it.at, m.now)) + '</span></div>' +
            '<div class="kbpu-cx">' +
              (it.kind === 'done' && !it.quiet ? '<button type="button" class="kbpu-xs" data-act="mute" data-id="' + esc(it.id) + '" title="' + esc(kt('Ne plus prévenir pour cette automation', 'Stop telling me about this automation')) + '" aria-label="' + esc(kt('Ne plus prévenir pour cette automation', 'Stop telling me about this automation')) + '">' + svg('bell') + '</button>' : '') +
              '<button type="button" class="kbpu-xs" data-act="dismiss" data-id="' + esc(it.id) + '" title="' + esc(kt('Écarter', 'Dismiss')) + '" aria-label="' + esc(kt('Écarter', 'Dismiss')) + '">' + svg('x') + '</button>' +
              '<button type="button" class="kbpu-go" data-act="open" data-id="' + esc(it.id) + '" title="' + esc(kt('Ouvrir dans Kybernos', 'Open in Kybernos')) + '" aria-label="' + esc(kt('Ouvrir dans Kybernos', 'Open in Kybernos')) + '">' + svg('up') + '</button>' +
            '</div></article>'
        }
        const inboxBody = '<div class="kbpu-seg">' +
          '<button type="button" class="kbpu-f" data-act="filter" data-v="todo" aria-pressed="' + (m.filter !== 'results') + '">' + esc(kt('À faire', 'To do')) + ' ' + todo.length + '</button>' +
          '<button type="button" class="kbpu-f" data-act="filter" data-v="results" aria-pressed="' + (m.filter === 'results') + '">' + esc(kt('Résultats', 'Results')) + '</button>' +
          '<button type="button" class="kbpu-xs" data-act="readall" title="' + esc(kt('Tout marquer comme lu', 'Mark all read')) + '" aria-label="' + esc(kt('Tout marquer comme lu', 'Mark all read')) + '">' + svg('checks') + '</button></div>' +
          (list.length > 0 ? list.map(card).join('') : '<div class="kbpu-empty"><b>' + esc(m.filter === 'results' ? kt('Pas encore de résultat', 'No results yet') : kt('Rien ne t’attend', 'Nothing waits for you')) + '</b></div>')
        const nowBody = snap.running.length > 0
          ? '<div class="kbpu-others">' + snap.running.map((r) => '<div class="kbpu-row"><span class="kbpu-ri ' + (r.phase === 'waiting' ? 'ask' : 'run') + '">' + svg(r.phase === 'waiting' ? 'waiting' : 'run') + '</span><div class="kbpu-ct"><b>' + esc(r.task) + '</b><span>' + esc(r.phase === 'waiting' ? (r.tool ? kn('Attend ton accord pour {tool}', 'Waits for your approval to use {tool}', { tool: r.tool }) : kt('Attend ton accord', 'Waits for your approval')) : (typeof r.calls === 'number' ? callsText(r.calls) : '') + (r.startedAt ? ' · ' + fmtDur(m.now - r.startedAt) : '')) + '</span></div></div>').join('') + '</div>'
          : '<div class="kbpu-empty"><b>' + esc(kt('Aucun run en cours', 'No run going')) + '</b></div>'
        const tab = (id, label, n) => '<button type="button" role="tab" class="kbpu-tab" data-act="tab" data-v="' + id + '" aria-selected="' + (m.tab === id) + '">' + esc(label) + (n > 0 ? '<span class="kbpu-n' + (id === 'now' ? ' q' : '') + '">' + n + '</span>' : '') + '</button>'
        return '<div class="kbpu-win" data-kb="pulse-window">' +
          '<header class="kbpu-head">' + (m.mark !== '' ? '<img class="kbpu-mark" src="' + esc(m.mark) + '" alt="">' : '') + '<b>Kybernos</b>' +
            '<button type="button" class="kbpu-xs lg" data-act="gear" title="' + esc(kt('Réglages du widget dans Kybernos', 'Widget settings in Kybernos')) + '" aria-label="' + esc(kt('Réglages du widget dans Kybernos', 'Widget settings in Kybernos')) + '">' + svg('gear') + svg('up', 'lk') + '</button></header>' +
          '<div class="kbpu-hero"><span class="kbpu-hi ' + h.tone + '">' + svg(h.tone === 'bad' ? 'failed' : h.tone === 'ask' ? 'waiting' : h.tone === 'run' ? 'run' : 'done') + '</span><div><h2>' + esc(h.title) + '</h2><p>' + esc(h.sub) + '</p></div></div>' +
          '<div class="kbpu-tabs" role="tablist">' + tab('inbox', kt('Boîte', 'Inbox'), todo.length > 0 ? todo.length : results.filter((x) => x.unread).length) + tab('now', kt('En cours', 'Now'), snap.running.length) + '</div>' +
          '<div class="kbpu-body" id="kbpu-body">' + (m.tab === 'now' ? nowBody : inboxBody) + '</div>' +
          '<button type="button" class="kbpu-cta" data-act="kyb">' + esc(kt('Ouvrir Kybernos', 'Open Kybernos')) + svg('up') + '</button></div>'
      }

      // ── styles: one sheet, for the Settings page and for the floating window ─────────────────────────────
      const CSS = [
        '.kbpu-page{display:flex;flex-direction:column;gap:16px;max-width:720px;padding:4px 2px 24px;color:var(--dsw-alias-label-primary,#e8eaec)}',
        '.kbpu-page h2{margin:0;font-size:16px;font-weight:600}',
        '.kbpu-lead{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:13px;line-height:1.5}',
        '.kbpu-block{border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));border-radius:14px;background:var(--dsw-alias-bg-layer-2,transparent);overflow:hidden}',
        '.kbpu-block>h3{margin:0;padding:12px 16px 6px;font-size:13px;font-weight:600}',
        '.kbpu-line{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}',
        '.kbpu-line:first-of-type{border-top:0}',
        '.kbpu-line b{display:block;font-size:13px;font-weight:600}',
        '.kbpu-line small{display:block;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096);margin-top:1px;line-height:1.4}',
        '.kbpu-ctl{display:flex;align-items:center;gap:8px;flex:none}',
        '.kbpu-btn{border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-3,transparent);color:var(--dsw-alias-label-primary,#e8eaec);border-radius:9px;padding:6px 12px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}',
        '.kbpu-btn.pri{background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#0f1115);border-color:transparent}',
        '.kbpu-btn:disabled{opacity:.5;cursor:default}',
        '.kbpu-opt{display:grid;grid-template-columns:20px minmax(0,1fr);gap:12px;align-items:center;padding:11px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));cursor:pointer;background:none;border-left:0;border-right:0;border-bottom:0;width:100%;text-align:start;color:inherit;font:inherit}',
        '.kbpu-opt:first-of-type{border-top:0}',
        '.kbpu-rad{width:18px;height:18px;border-radius:50%;border:1.5px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));display:grid;place-items:center}',
        '.kbpu-opt[aria-checked="true"] .kbpu-rad{border-color:var(--dsw-alias-label-primary,#e8eaec)}',
        '.kbpu-opt[aria-checked="true"] .kbpu-rad::after{content:"";width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-primary,#e8eaec)}',
        '.kbpu-opt b{font-size:13px;font-weight:600}',
        '.kbpu-opt small{display:block;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096);margin-top:1px}',
        '.kbpu-sw{position:relative;width:38px;height:22px;border-radius:999px;border:0;background:var(--dsw-alias-border-l3,rgba(255,255,255,.2));padding:0;cursor:pointer;flex:none}',
        '.kbpu-sw::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-bg-base,#151517);transition:transform .15s}',
        '.kbpu-sw[aria-checked="true"]{background:var(--dsw-alias-state-success-primary,#22c55e)}',
        '.kbpu-sw[aria-checked="true"]::after{transform:translateX(16px)}',
        '.kbpu-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.1));background:var(--dsw-alias-bg-layer-3,transparent);color:var(--dsw-alias-label-secondary,#cfd3d6);border-radius:999px;padding:3px 9px;font:inherit;font-size:12px;cursor:pointer}',
        '.kbpu-chip.st{cursor:default;font-weight:600}',
        '.kbpu-chip.ok{color:var(--dsw-alias-state-success-primary,#22c55e)}',
        '.kbpu-chip.bad{color:var(--dsw-alias-state-error-primary,#f87171)}',
        '.kbpu-note{margin:0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#8a9096)}',
        '.kbpu-i{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round;flex:none}',
        // the floating window
        '.kbpu-pip{margin:0;background:var(--dsw-alias-bg-base,#151517);color:var(--dsw-alias-label-primary,#e8eaec);font-family:var(--kbpu-font,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:13px;-webkit-font-smoothing:antialiased}',
        '.kbpu-pip *{box-sizing:border-box}',
        '.kbpu-win{display:flex;flex-direction:column;height:100vh;padding:12px}',
        '.kbpu-head{display:flex;align-items:center;gap:8px}',
        '.kbpu-head b{flex:1;font-size:15px;font-weight:700;letter-spacing:-.01em}',
        '.kbpu-mark{width:20px;height:20px}',
        '.kbpu-xs{width:26px;height:26px;border:0;border-radius:8px;background:none;color:var(--dsw-alias-label-tertiary,#8a9096);display:grid;place-items:center;cursor:pointer;position:relative;padding:0}',
        '.kbpu-xs:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary,#e8eaec)}',
        '.kbpu-xs.lg{width:30px;height:30px}',
        '.kbpu-xs .lk{position:absolute;right:2px;top:2px;width:9px;height:9px;stroke-width:2.8}',
        '.kbpu-hero{display:flex;align-items:center;gap:12px;margin:10px 2px 12px}',
        '.kbpu-hi{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;flex:none;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#cfd3d6)}',
        '.kbpu-hi .kbpu-i{width:21px;height:21px}',
        '.kbpu-hi.ask{color:var(--dsw-alias-state-warn-primary,#f59e0b)}',
        '.kbpu-hi.bad{color:var(--dsw-alias-state-error-primary,#f87171)}',
        '.kbpu-hi.ok{color:var(--dsw-alias-state-success-primary,#22c55e)}',
        '.kbpu-hi.run .kbpu-i{animation:kbpu-spin 1.1s linear infinite}',
        '@keyframes kbpu-spin{to{transform:rotate(360deg)}}',
        '.kbpu-hero h2{margin:0;font-size:17px;line-height:1.2;font-weight:600;letter-spacing:-.015em}',
        '.kbpu-hero p{margin:2px 0 0;font-size:12px;color:var(--dsw-alias-label-tertiary,#8a9096);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:270px}',
        '.kbpu-tabs{display:flex;gap:3px;padding:3px;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.06));border-radius:11px}',
        '.kbpu-tab{flex:1;border:0;background:none;border-radius:8px;padding:6px 8px;font:inherit;font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a9096);display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer}',
        '.kbpu-tab[aria-selected="true"]{background:var(--dsw-alias-bg-layer-2,#1e1f21);color:var(--dsw-alias-label-primary,#e8eaec);box-shadow:0 0 0 1px var(--dsw-alias-border-l2,rgba(255,255,255,.1))}',
        '.kbpu-n{min-width:17px;height:17px;border-radius:999px;background:var(--dsw-alias-state-error-primary,#f87171);color:var(--dsw-alias-label-primary-foreground,#0f1115);font-size:10.5px;font-weight:700;display:inline-grid;place-items:center;padding:0 4px}',
        '.kbpu-n.q{background:var(--dsw-alias-label-primary,#e8eaec)}',
        '.kbpu-body{flex:1;min-height:0;overflow:auto;padding:10px 1px 4px;display:flex;flex-direction:column;gap:8px}',
        '.kbpu-seg{display:flex;gap:6px;align-items:center}',
        '.kbpu-f{border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));background:none;color:var(--dsw-alias-label-secondary,#cfd3d6);border-radius:999px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}',
        '.kbpu-f[aria-pressed="true"]{background:var(--dsw-alias-label-primary,#e8eaec);color:var(--dsw-alias-label-primary-foreground,#0f1115);border-color:transparent}',
        '.kbpu-seg .kbpu-xs{margin-inline-start:auto}',
        '.kbpu-card{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:10px;align-items:center;border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));background:var(--dsw-alias-bg-layer-2,#1e1f21);border-radius:14px;padding:9px 9px 9px 10px}',
        '.kbpu-card.q{opacity:.6}',
        '.kbpu-ci,.kbpu-ri{position:relative;width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-3,rgba(255,255,255,.06));color:var(--dsw-alias-label-secondary,#cfd3d6)}',
        '.kbpu-card.ask .kbpu-ci,.kbpu-ri.ask{color:var(--dsw-alias-state-warn-primary,#f59e0b)}',
        '.kbpu-card.bad .kbpu-ci{color:var(--dsw-alias-state-error-primary,#f87171)}',
        '.kbpu-card.ok .kbpu-ci{color:var(--dsw-alias-state-success-primary,#22c55e)}',
        '.kbpu-ri.run .kbpu-i{animation:kbpu-spin 1.1s linear infinite}',
        '.kbpu-card.un:not(.ask):not(.bad) .kbpu-ci::after{content:"";position:absolute;top:-1px;right:-1px;width:9px;height:9px;border-radius:50%;background:var(--dsw-alias-state-error-primary,#f87171);border:2px solid var(--dsw-alias-bg-layer-2,#1e1f21)}',
        '.kbpu-ct{min-width:0}',
        '.kbpu-ct b{display:block;font-size:13px;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbpu-ct span{display:block;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8a9096);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.kbpu-cx{display:flex;align-items:center;gap:2px}',
        '.kbpu-cx .kbpu-xs{max-width:0;opacity:0;overflow:hidden}',
        '.kbpu-card:hover .kbpu-xs,.kbpu-card:focus-within .kbpu-xs{max-width:26px;opacity:1}',
        '.kbpu-go{width:32px;height:32px;border-radius:50%;border:0;background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#0f1115);display:grid;place-items:center;cursor:pointer;flex:none;padding:0}',
        '.kbpu-go .kbpu-i{width:15px;height:15px;stroke-width:2.3}',
        '.kbpu-others{border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06));background:var(--dsw-alias-bg-layer-2,#1e1f21);border-radius:14px;padding:3px 10px}',
        '.kbpu-row{display:grid;grid-template-columns:34px minmax(0,1fr);gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.06))}',
        '.kbpu-row:first-child{border-top:0}',
        '.kbpu-empty{margin:auto;text-align:center;padding:24px 12px;color:var(--dsw-alias-label-tertiary,#8a9096)}',
        '.kbpu-empty b{display:block;font-size:13.5px;color:var(--dsw-alias-label-primary,#e8eaec);font-weight:600}',
        '.kbpu-cta{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:8px;border:0;border-radius:14px;background:var(--dsw-alias-button-primary-fill,#f9fafb);color:var(--dsw-alias-label-primary-foreground,#0f1115);padding:11px 14px;font:inherit;font-size:14px;font-weight:600;cursor:pointer}',
        '@media (prefers-reduced-motion:reduce){.kbpu-hi.run .kbpu-i,.kbpu-ri.run .kbpu-i{animation:none}}'
      ].join('\n')

      // ── the live state: one poll, shared by the page, the badge, the banners and the floating window ───
      const store = {
        snap: null,
        subs: [],
        error: false,
        get () { return this.snap },
        subscribe (fn) { this.subs.push(fn); return () => { const i = this.subs.indexOf(fn); if (i >= 0) this.subs.splice(i, 1) } },
        emit () { for (const fn of this.subs.slice()) { try { fn(this.snap) } catch (e) { /* a gone subscriber */ } } }
      }
      const validSnap = (j) => j !== null && typeof j === 'object' && j.ok === true && Array.isArray(j.inbox) && Array.isArray(j.running) && Array.isArray(j.banners) && j.settings !== null && typeof j.settings === 'object'
      const refresh = async () => {
        try {
          const r = await fetch('/kybernos-pulse/state', { cache: 'no-store', credentials: 'same-origin' })
          const j = r.ok ? await r.json() : null
          if (validSnap(j)) { store.snap = j; store.error = false } else store.error = true
        } catch (e) { store.error = true }
        store.emit()
        return store.snap
      }
      const post = async (path, body) => {
        try {
          const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
          const j = await r.json().catch(() => null)
          await refresh()
          return r.ok && j !== null && j.ok === true
        } catch (e) { return false }
      }
      const patchSettings = (patch) => post('/kybernos-pulse/settings', patch)
      const inboxAct = (body) => post('/kybernos-pulse/inbox', body)

      // ── going back to Kybernos ────────────────────────────────────────────────────────────────────────────
      const focusKybernos = () => { try { window.focus() } catch (e) { /* the browser decides */ } }
      /** Brings the Kybernos tab forward and opens the Automations page when the page offers it. Never throws. */
      const openKybernos = (item) => {
        focusKybernos()
        try { if (typeof window.__KB_OPEN__ === 'function' && Array.isArray(window.__KB_OPEN__.views) && window.__KB_OPEN__.views.indexOf('tasks') >= 0) window.__KB_OPEN__({ view: 'tasks' }) } catch (e) { /* no page to open */ }
        if (item !== undefined && item !== null && item.unread === true) void inboxAct({ action: 'read', id: item.id })
      }
      // The React key of a Settings nav cell is the id of its section, the same in every language (the Suite finds its pages the same way).
      const navKey = (el) => {
        try {
          const n = Object.keys(el).find((x) => x.indexOf('__reactFiber$') === 0)
          const k = n === undefined ? null : el[n].key
          return typeof k === 'string' ? k : null
        } catch (e) { return null }
      }
      /** Opens Settings › Widget: the dialog first (kybernos-plugin offers `window.__kbOpenDshSettings`), then the cell of this page. */
      const openMySettings = () => {
        focusKybernos()
        try {
          if (typeof window.__kbOpenDshSettings !== 'function' || window.__kbOpenDshSettings() !== true) return false
          let tries = 0
          const tick = () => {
            tries += 1
            const hit = Array.prototype.slice.call(document.querySelectorAll('nav button')).find((c) => navKey(c) === 'kybernos-pulse')
            if (hit !== undefined) { hit.click(); return }
            if (tries < 25) window.setTimeout(tick, 120)
          }
          window.setTimeout(tick, 150)
          return true
        } catch (e) { return false }
      }

      // ── the floating window ───────────────────────────────────────────────────────────────────────────────
      const floating = { win: null, tab: 'inbox', filter: 'todo', last: '', subs: [] }
      const pipSupported = () => { try { return typeof window.documentPictureInPicture === 'object' && window.documentPictureInPicture !== null && typeof window.documentPictureInPicture.requestWindow === 'function' } catch (e) { return false } }
      const isFloating = () => { try { return floating.win !== null && floating.win.closed !== true } catch (e) { return false } }
      const onFloating = (fn) => { floating.subs.push(fn); return () => { const i = floating.subs.indexOf(fn); if (i >= 0) floating.subs.splice(i, 1) } }
      const emitFloating = () => { for (const fn of floating.subs.slice()) { try { fn(isFloating()) } catch (e) { /* a gone subscriber */ } } }
      const brandMark = () => { try { return typeof window.__KB_BRAND__.faviconHref === 'function' ? String(window.__KB_BRAND__.faviconHref() || '') : '' } catch (e) { return '' } }
      const syncTokens = (doc) => {
        try {
          const cs = getComputedStyle(document.documentElement)
          const root = doc.documentElement
          for (const t of TOKENS) { const v = cs.getPropertyValue(t); if (v !== '') root.style.setProperty(t, v) }
          root.style.setProperty('--kbpu-font', cs.fontFamily || '')
          root.style.colorScheme = cs.colorScheme || ''
        } catch (e) { /* the window keeps its fallbacks */ }
      }
      const renderFloating = (force) => {
        if (!isFloating() || store.snap === null) return
        const doc = floating.win.document
        const html = panelHTML({ snap: store.snap, tab: floating.tab, filter: floating.filter, now: Date.now(), mark: brandMark() })
        if (force !== true && html === floating.last) return
        floating.last = html
        syncTokens(doc)
        const body = doc.getElementById('kbpu-body')
        const scroll = body !== null ? body.scrollTop : 0
        doc.body.innerHTML = html
        const again = doc.getElementById('kbpu-body')
        if (again !== null) again.scrollTop = scroll
      }
      const closeFloating = () => { try { if (isFloating()) floating.win.close() } catch (e) { /* already closed */ } floating.win = null; floating.last = ''; emitFloating() }
      const findItem = (id) => (store.snap === null ? undefined : store.snap.inbox.find((x) => x.id === id))
      const onFloatingClick = (ev) => {
        const el = ev.target !== null && typeof ev.target.closest === 'function' ? ev.target.closest('[data-act]') : null
        if (el === null) return
        const act = el.getAttribute('data-act')
        const id = el.getAttribute('data-id')
        const it = id !== null ? findItem(id) : undefined
        if (act === 'tab') { floating.tab = el.getAttribute('data-v') === 'now' ? 'now' : 'inbox'; renderFloating(true) }
        else if (act === 'filter') { floating.filter = el.getAttribute('data-v') === 'results' ? 'results' : 'todo'; renderFloating(true) }
        else if (act === 'open') openKybernos(it)
        else if (act === 'dismiss' && id !== null) void inboxAct({ action: 'dismiss', id })
        else if (act === 'mute' && it !== undefined) void patchSettings({ mute: it.task })
        else if (act === 'readall') void inboxAct({ action: 'read-all' })
        else if (act === 'kyb') openKybernos(null)
        else if (act === 'gear') openMySettings()
      }
      const openFloating = async () => {
        if (isFloating()) { try { floating.win.focus() } catch (e) { /* ignore */ } return true }
        if (!pipSupported()) return false
        try {
          const win = await window.documentPictureInPicture.requestWindow({ width: 380, height: 580 })
          floating.win = win
          floating.last = ''
          const doc = win.document
          const style = doc.createElement('style')
          style.textContent = CSS
          doc.head.appendChild(style)
          doc.title = 'Kybernos'
          doc.body.className = 'kbpu-pip'
          doc.addEventListener('click', onFloatingClick)
          win.addEventListener('pagehide', () => { if (floating.win === win) { floating.win = null; floating.last = ''; emitFloating() } })
          if (store.snap === null) await refresh()
          renderFloating(true)
          emitFloating()
          return true
        } catch (e) { floating.win = null; emitFloating(); return false }
      }

      // ── banners and badge ─────────────────────────────────────────────────────────────────────────────────
      const canNotify = () => { try { return typeof Notification === 'function' && Notification.permission === 'granted' } catch (e) { return false } }
      const permission = () => { try { return typeof Notification === 'function' ? Notification.permission : 'unsupported' } catch (e) { return 'unsupported' } }
      const bannerNow = (it) => {
        const t = itemText(it)
        const n = new Notification(t.title, { body: t.sub, tag: 'kybernos-pulse:' + it.id })
        n.onclick = () => { try { n.close() } catch (e) { /* closed */ } openKybernos(it) }
      }
      let handling = false
      const handleBanners = async (snap) => {
        if (handling || snap === null || snap.banners.length === 0) return
        handling = true
        try {
          const plan = bannersToShow(snap, Date.now(), canNotify() && snap.settings.banners === true)
          for (const it of plan.show) { try { bannerNow(it) } catch (e) { /* the browser refused this one */ } }
          const ids = plan.show.map((x) => x.id).concat(plan.skipped)
          if (ids.length > 0) await inboxAct({ action: 'banner-shown', ids })
        } finally { handling = false }
      }
      const applyBadge = (snap) => {
        try {
          const n = snap !== null && snap.settings.badge === true ? snap.unread : 0
          const want = badgeTitle(document.title, n)
          if (document.title !== want) document.title = want
          if (typeof navigator.setAppBadge === 'function') { if (n > 0) void navigator.setAppBadge(n).catch(() => {}); else if (typeof navigator.clearAppBadge === 'function') void navigator.clearAppBadge().catch(() => {}) }
        } catch (e) { /* the badge is a courtesy */ }
      }
      const clearBadge = () => {
        try { document.title = badgeTitle(document.title, 0); if (typeof navigator.clearAppBadge === 'function') void navigator.clearAppBadge().catch(() => {}) } catch (e) { /* ignore */ }
      }

      // ── the Settings page ─────────────────────────────────────────────────────────────────────────────────
      const buildPage = (React) => {
        const h = React.createElement
        const LEVELS = [
          ['need', () => kt('Quand quelque chose m’attend', 'Something needs me'), () => kt('Un échec, ou un accord attendu.', 'A failure, or an approval waiting.')],
          ['every', () => kt('À chaque run', 'Every run'), () => kt('Aussi chaque run terminé.', 'Also each finished run.')],
          ['never', () => kt('Jamais', 'Never'), () => kt('Pas de bannière. Le widget liste tout quand même.', 'No banner. The widget still lists everything.')]
        ]
        return function Page () {
          const pair = React.useState(store.get())
          const live = React.useState(isFloating())
          const perm = React.useState(permission())
          const busy = React.useState(false)
          const note = React.useState('')
          React.useEffect(() => store.subscribe((s) => pair[1](s)), [])
          React.useEffect(() => onFloating((v) => live[1](v)), [])
          React.useEffect(() => { if (store.get() === null) void refresh(); return undefined }, [])
          const snap = pair[0]
          const s = snap !== null ? snap.settings : null
          const supported = pipSupported()
          const set = (patch) => { void patchSettings(patch) }
          const toggleFloating = async () => {
            busy[1](true); note[1]('')
            try {
              if (isFloating()) closeFloating()
              else if (!(await openFloating())) note[1](kt('Le navigateur n’a pas ouvert la fenêtre.', 'The browser did not open the window.'))
            } finally { busy[1](false) }
          }
          const allow = async () => { try { await Notification.requestPermission() } catch (e) { /* refused */ } perm[1](permission()) }
          const test = () => { try { new Notification('Kybernos', { body: kt('Voilà à quoi ressemble une bannière.', 'This is what a banner looks like.'), tag: 'kybernos-pulse:test' }) } catch (e) { note[1](kt('La bannière de test n’a pas pu s’afficher.', 'The test banner could not be shown.')) } }
          const sw = (key, label, desc) => h('div', { className: 'kbpu-line' },
            h('div', null, h('b', null, label), desc ? h('small', null, desc) : null),
            h('span', { className: 'kbpu-ctl' }, h('button', { type: 'button', className: 'kbpu-sw', role: 'switch', 'aria-checked': s !== null && s[key] === true ? 'true' : 'false', 'aria-label': label, disabled: s === null, 'data-kb': 'pulse-sw-' + key, onClick: () => set({ [key]: !(s !== null && s[key] === true) }) })))
          return h('div', { className: 'kbpu-page', 'data-kb': 'pulse-page' },
            h('div', null, h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' } }, h('h2', null, kt('Widget', 'Widget')), (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-pulse' }) : null)), h('p', { className: 'kbpu-lead' }, kt('Dis-moi ce que tes automations ont fait et ramène-moi au bon endroit de Kybernos, sans garder Kybernos au premier plan.', 'Tells you what your automations did and brings you back to the right place in Kybernos, without keeping Kybernos in front.'))),
            store.error && snap === null ? h('p', { className: 'kbpu-note', role: 'alert', 'data-kb': 'pulse-error' }, kt('Cette page n’a pas de réponse de son assistant. Si DSH vient d’être mis à jour, redémarre DSH.', 'This page\'s helper is not answering. If DSH was just updated, restart DSH.')) : null,
            h('div', { className: 'kbpu-block', 'data-kb': 'pulse-where' },
              h('h3', null, kt('Où il vit', 'Where it lives')),
              h('div', { className: 'kbpu-line' },
                h('div', null, h('b', null, kt('Fenêtre flottante', 'Floating window')), h('small', null, supported ? kt('Toujours au-dessus des autres fenêtres. Kybernos doit rester ouvert dans un onglet.', 'Always on top of the other windows. Kybernos must stay open in a tab.') : kt('Ce navigateur ne sait pas l’ouvrir (Chrome, Edge ou Brave le savent). Les bannières et le badge marchent quand même.', 'This browser cannot open it (Chrome, Edge or Brave can). Banners and the badge still work.'))),
                h('span', { className: 'kbpu-ctl' }, h('button', { type: 'button', className: 'kbpu-btn pri', 'data-kb': 'pulse-floating', disabled: !supported || busy[0], onClick: toggleFloating }, live[0] ? kt('La fermer', 'Close it') : kt('L’afficher', 'Show it')))),
              note[0] !== '' ? h('p', { className: 'kbpu-note', style: { padding: '0 16px 10px' } }, note[0]) : null,
              h('div', { className: 'kbpu-line', 'data-kb': 'pulse-menubar' },
                h('div', null, h('b', null, kt('Icône de la barre de menus (Mac)', 'Menu-bar icon (Mac)')),
                  h('small', null, helperSeen(snap)
                    ? kt('Elle tourne : le K est à côté du Wi-Fi, avec le nombre de choses qui t’attendent. Un clic liste tes automations.', 'It is running: the K sits next to Wi-Fi, with the number of things waiting for you. One click lists your automations.')
                    : kt('Une petite appli Mac met le K à côté du Wi-Fi, avec un nombre et la liste de tes automations, même quand le navigateur est fermé. Pour la fabriquer : bash packages/kybernos-pulse/helper/build.sh --run (macOS 13 ou plus).', 'A small Mac app puts the K next to Wi-Fi, with a count and the list of your automations, even when the browser is closed. To build it: bash packages/kybernos-pulse/helper/build.sh --run (macOS 13 or later).'))),
                h('span', { className: 'kbpu-ctl' }, helperSeen(snap)
                  ? h('span', { className: 'kbpu-chip st ok', 'data-kb': 'pulse-menubar-on' }, kt('En marche', 'Running'))
                  : h('span', { className: 'kbpu-chip st', 'data-kb': 'pulse-menubar-off' }, kt('Pas lancée', 'Not running'))))),
            h('div', { className: 'kbpu-block', 'data-kb': 'pulse-level' },
              h('h3', null, kt('Prévenir', 'Tell me when')),
              LEVELS.map(([id, label, desc]) => h('button', { key: id, type: 'button', role: 'radio', className: 'kbpu-opt', 'aria-checked': s !== null && s.level === id ? 'true' : 'false', 'data-kb': 'pulse-level-' + id, disabled: s === null, onClick: () => set({ level: id }) },
                h('span', { className: 'kbpu-rad' }), h('span', null, h('b', null, label()), h('small', null, desc()))))),
            h('div', { className: 'kbpu-block', 'data-kb': 'pulse-banners' },
              h('h3', null, kt('Bannières et badge', 'Banners and badge')),
              sw('banners', kt('Bannières du système', 'System banners'), kt('Une bannière par événement, jamais pour ce qui date de plus de dix minutes.', 'One banner per event, never for what is older than ten minutes.')),
              h('div', { className: 'kbpu-line' },
                h('div', null, h('b', null, kt('Autorisation du navigateur', 'Browser permission')), h('small', null, perm[0] === 'unsupported' ? kt('Ce navigateur n’affiche pas de bannière.', 'This browser shows no banners.') : perm[0] === 'denied' ? kt('Refusée : à changer dans les réglages du site, dans le navigateur.', 'Blocked: change it in the site settings of the browser.') : kt('Le navigateur demande ton accord une seule fois.', 'The browser asks once.'))),
                h('span', { className: 'kbpu-ctl' },
                  perm[0] === 'granted' ? h('span', { className: 'kbpu-chip st ok' }, kt('Autorisée', 'Allowed')) : perm[0] === 'denied' ? h('span', { className: 'kbpu-chip st bad' }, kt('Bloquée', 'Blocked')) : perm[0] === 'default' ? h('button', { type: 'button', className: 'kbpu-btn', 'data-kb': 'pulse-allow', onClick: allow }, kt('Autoriser', 'Allow')) : null,
                  perm[0] === 'granted' ? h('button', { type: 'button', className: 'kbpu-btn', 'data-kb': 'pulse-test', onClick: test }, kt('Tester', 'Test')) : null)),
              sw('badge', kt('Nombre sur l’onglet et sur le Dock', 'Count on the tab and the Dock'), kt('Le Dock demande Kybernos installé comme appli (Chrome ou Edge).', 'The Dock needs Kybernos installed as an app (Chrome or Edge).'))),
            h('div', { className: 'kbpu-block', 'data-kb': 'pulse-quiet' },
              h('h3', null, kt('Automations silencieuses', 'Quiet automations')),
              h('div', { className: 'kbpu-line' },
                h('div', null, h('b', null, kt('Sans bannière quand elles finissent', 'No banner when they finish')), h('small', null, kt('Elles restent dans la boîte. Un échec ou un accord attendu prévient toujours.', 'They stay in the inbox. A failure or an approval always tells you.'))),
                h('span', { className: 'kbpu-ctl', style: { flexWrap: 'wrap', justifyContent: 'flex-end' } },
                  s !== null && s.muted.length > 0 ? s.muted.map((n) => h('button', { key: n, type: 'button', className: 'kbpu-chip', title: kt('La faire reparler', 'Make it speak again'), 'data-kb': 'pulse-unmute', onClick: () => set({ unmute: n }) }, n + ' ✕')) : h('span', { className: 'kbpu-note' }, kt('Aucune', 'None'))))))
        }
      }

      // ── mounting ──────────────────────────────────────────────────────────────────────────────────────────
      const mountPage = (ctx, scope) => {
        try {
          const slots = scope.slots
          if (slots === undefined || slots === null || typeof slots.inject !== 'function') return
          const React = typeof require === 'function' ? require('react') : null
          if (React === null) return
          const Page = buildPage(React)
          ctx.effect(() => slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'kybernos-pulse', order: 31, label: 'Widget' },
            () => React.createElement(Page))), 'kybernos-pulse: section')
        } catch (e) { /* the section is optional */ }
      }

      const start = (ctx) => {
        try {
          ctx.effect(() => { const s = document.createElement('style'); s.dataset.plugin = '@local/kybernos-pulse'; s.textContent = CSS; document.head.appendChild(s); return () => s.remove() }, 'kybernos-pulse: styles')
          ctx.effect(() => {
            let stopped = false
            let timer = null
            const unsub = store.subscribe((snap) => { applyBadge(snap); void handleBanners(snap); renderFloating(false) })
            const loop = async () => {
              if (stopped) return
              await refresh()
              if (!stopped) timer = window.setTimeout(loop, document.hidden ? POLL_HIDDEN_MS : POLL_MS)
            }
            const onWake = () => { if (!document.hidden) void refresh() }
            document.addEventListener('visibilitychange', onWake)
            window.addEventListener('focus', onWake)
            void loop()
            return () => { stopped = true; if (timer !== null) window.clearTimeout(timer); unsub(); document.removeEventListener('visibilitychange', onWake); window.removeEventListener('focus', onWake); clearBadge(); closeFloating() }
          }, 'kybernos-pulse: follow the runs')
          ctx.inject(['slots'], (scope) => { mountPage(ctx, scope || {}) })
        } catch (e) { /* optional */ }
      }

      return { name: NAME, inject: [], apply: start, __test: { esc, fmtDur, ago, itemText, hero, badgeTitle, bannersToShow, panelHTML, validSnap, kt, kn, PACK_STRINGS, CSS, TOKENS, FRESH_MS, POLL_MS, openFloating, closeFloating, isFloating, openKybernos, openMySettings, refresh, buildPage } }
    } catch (e) {
      console.warn('[kybernos-pulse] disabled:', e)
      return { apply () {} }
    }
  }
})
