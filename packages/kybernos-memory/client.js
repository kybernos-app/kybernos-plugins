// kybernos-memory — browser half: the « Memory & Lessons learned » settings page.
//
//   settings section « Memory & Lessons » ... settings.section (order 3, right after Language)
//   Memories tab ............................ the account memory (cloud): list, search, filters,
//                                             pages, add / edit / forget — host routes of
//                                             @local/kybernos-cloud (`/kybernos-cloud/memory/*`)
//   Lessons learned tab ..................... the lessons of every kyber (local files): list,
//                                             filters, pages, edit / delete — host routes of
//                                             this bundle (`/kybernos-memory/*`)
//   Options page ............................ the switches of both, as a classic settings page
//
// Nothing here talks to the cloud directly: the account token never leaves the host half.
// What is not built is not drawn as if it were: the map needs an index
// that does not exist yet (the Map button says so), team lessons are not built (the Team scope
// says so), and the list search is by words.
//
// One file, no bundler, no import: the loader hands `require` to the factory. The factory's
// try/catch is vital — an evaluation error here would break the WHOLE client entry ("Failed to
// load plugins") and leave the GUI unusable. On error the plugin disables itself, the GUI stays.
window.__ModuleLoader__.load({
  id: '@local/kybernos-memory',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement
      const { useState, useEffect, useRef, useCallback } = React

      // ═══════════════════════════════════════════════════════════════
      // 1. PURE PIECES (exposed for test-client.mjs)
      // ═══════════════════════════════════════════════════════════════

      const PAGE_SIZES = [25, 50, 100]
      const KIND_LABEL = { fact: 'Fact', preference: 'Preference', policy: 'Rule', event: 'Event' }
      const ORIGIN_LABEL = { capture: 'Auto', agent: 'Agent', taught: 'You', sync: 'Sync' }
      const RETENTIONS = [[30, '30 days'], [90, '90 days'], [180, '180 days'], [365, '1 year']]
      const ADDED = [['any', 'Any time'], ['1m', 'Last minute'], ['1h', 'Last hour'], ['today', 'Today'], ['7d', 'Last 7 days']]

      /** The plan as the page talks about it: Free, Solo or Team (anything paid that is not a team seat is « Solo »). */
      const planOf = (status) => {
        const raw = status !== null && status !== undefined && status.state !== undefined && status.state !== null && status.state.user !== null && status.state.user !== undefined
          ? String(status.state.user.plan || '').toLowerCase() : ''
        if (raw === '' || raw === 'free') return 'free'
        return raw.indexOf('team') === 0 ? 'team' : 'solo'
      }
      const PLAN_NAME = { free: 'Free', solo: 'Solo', team: 'Team' }

      /** Minutes → « now », « 12m », « 3h », « 2d ». */
      const ageLabel = (minutes) => {
        if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return ''
        if (minutes < 1) return 'now'
        if (minutes < 60) return String(Math.round(minutes)) + 'm'
        if (minutes < 1440) return String(Math.round(minutes / 60)) + 'h'
        return String(Math.round(minutes / 1440)) + 'd'
      }

      /** Page numbers to draw: first, last, current ± 1, and the first three at the edges. */
      const pagerPages = (total, page, size) => {
        const pages = Math.max(1, Math.ceil(total / size))
        const p = Math.min(Math.max(1, page), pages)
        const want = [1, pages, p - 1, p, p + 1]
        if (p <= 2) want.push(3)
        if (p >= pages - 1) want.push(pages - 2)
        const list = Array.from(new Set(want)).filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
        const out = []
        let prev = 0
        for (const n of list) { if (n - prev > 1) out.push('…'); out.push(n); prev = n }
        return { pages, page: p, items: out, from: total === 0 ? 0 : (p - 1) * size + 1, to: Math.min(total, p * size) }
      }

      /** Every non-default filter as `[key, label]`, for the chips under the toolbar. */
      const GROUPS = {
        memories: [
          { key: 'show', label: 'Show', def: 'all', opts: [['all', 'All'], ['pinned', 'Pinned'], ['sent', 'Sent to the model']] },
          { key: 'src', label: 'Source', def: 'any', opts: [['any', 'Any'], ['capture', 'Auto-capture'], ['agent', 'Agent'], ['you', 'You'], ['sync', 'Sync']] },
          { key: 'added', label: 'Added', def: 'any', opts: ADDED },
        ],
        lessons: [
          { key: 'scope', label: 'Scope', def: 'mine', opts: [['mine', 'Mine'], ['team', 'Team']] },
          { key: 'status', label: 'Status', def: 'all', opts: [['all', 'All'], ['used', 'Used at least once']] },
          { key: 'added', label: 'Added', def: 'any', opts: ADDED },
        ],
      }
      const defaultFilters = () => ({ show: 'all', src: 'any', added: 'any', scope: 'mine', status: 'all', kyber: '' })
      const activeFilters = (tab, f) => {
        const out = []
        for (const g of GROUPS[tab]) if (f[g.key] !== g.def) out.push({ key: g.key, def: g.def, text: g.label + ': ' + g.opts.find((o) => o[0] === f[g.key])[1] })
        if (tab === 'lessons' && f.kyber !== '') out.push({ key: 'kyber', def: '', text: 'Kyber: ' + f.kyber })
        return out
      }

      /** The URL of a list request. Defaults are left out: the host treats absence as « any ». */
      const listUrl = (tab, state) => {
        const q = new URLSearchParams()
        q.set('limit', String(state.size))
        q.set('offset', String((Math.max(1, state.page) - 1) * state.size))
        const f = state.f
        if (f.added !== 'any') q.set('added', f.added)
        if (String(state.q || '').trim() !== '') q.set('q', String(state.q).trim())
        if (tab === 'memories') {
          if (f.show !== 'all') q.set('show', f.show)
          if (f.src !== 'any') q.set('src', f.src)
          // Meaning only matters with a query; the host falls back to words, and says why, when it cannot.
          if (state.mode === 'meaning' && String(state.q || '').trim() !== '') q.set('mode', 'meaning')
          return '/kybernos-cloud/memory/list?' + q.toString()
        }
        if (f.kyber !== '') q.set('kyber', f.kyber)
        if (f.status === 'used') q.set('used', '1')
        return '/kybernos-memory/lessons?' + q.toString()
      }

      /** Search mode is a per-viewer preference, kept across tabs, options and visits. Storage can be blocked: never throw. */
      const MODE_KEY = 'kbmem.searchMode'
      const readMode = () => { try { return window.localStorage.getItem(MODE_KEY) === 'meaning' ? 'meaning' : 'relevance' } catch (e) { return 'relevance' } }
      const writeMode = (v) => { try { window.localStorage.setItem(MODE_KEY, v) } catch (e) { /* private window */ } }

      const TIER_NAME = { solo: 'Solo', team: 'Team', free: 'Free' }
      /** Why a meaning search is not being done (host codes of /memory/index and of the list's `search.fallback`), as a sentence. */
      const meaningWhy = (code, tier) => {
        const c = String(code === undefined || code === null ? '' : code)
        if (c === 'sens_desactive') return 'Search by meaning is off. Turn it on in Options.'
        if (c === 'offre_requise') return 'Search by meaning needs the ' + (TIER_NAME[tier] || 'Solo') + ' plan.'
        if (c === 'sens_indisponible' || c === 'serveur_ancien') return 'Your Kybernos server cannot search by meaning yet.'
        if (c === 'credits_epuises') return 'You are out of credits.'
        if (c === 'embedding_invalide') return 'The embedding service sent back something unexpected.'
        return friendlyError(c)
      }
      /** « 2 of 3 words » on a relevance match that did not find every word of the query; nothing when all were found. */
      const wordsLabel = (matched, of) => (Number.isInteger(matched) && Number.isInteger(of) && of > 1 && matched >= 1 && matched < of ? String(matched) + ' of ' + String(of) + ' words' : null)
      /** « 82% match » — only for a number the host really computed. */
      const closenessLabel = (n) => (typeof n === 'number' && Number.isFinite(n) ? String(Math.max(0, Math.min(100, Math.round(n)))) + '% match' : null)

      /** What a host error code means to a person. */
      const friendlyError = (code) => {
        const c = String(code === undefined || code === null ? '' : code)
        if (c === 'non connecte' || c === 'compte_kybernos_non_connecte') return 'Not connected to Kybernos Cloud.'
        if (c === 'reconnexion_requise') return 'Your Kybernos session has expired: reconnect.'
        if (c === 'reseau') return 'The server cannot be reached.'
        if (c === 'indisponible') return 'This part is not available (its plugin may be switched off).'
        if (c === 'contenu_vide' || c === 'texte_vide') return 'Write something first.'
        if (c === 'contenu_trop_long') return 'That is too long (2 000 characters at most).'
        if (c === 'genre_invalide') return 'Pick a type.'
        if (c === 'memoire_desactivee') return 'Memory is switched off.'
        if (c === 'lecon_introuvable') return 'That lesson no longer exists.'
        if (c.indexOf('refus_') === 0) return 'The server refused the request (' + c.slice(6) + ').'
        if (c === 'erreur interne' || c === 'internal error') return 'Something failed inside the plugin.'
        return c === '' ? 'Something went wrong.' : 'Something went wrong (' + c + ').'
      }

      /** The capture's last outcome, in words (the host keeps it in memory only). */
      const captureWords = (capture) => {
        if (capture === null || capture === undefined || capture.status === undefined) return 'unknown'
        const s = String(capture.status)
        if (s === 'jamais') return 'has not run since DSH started'
        const map = {
          hors_connexion: 'not connected', desactivee: 'switched off', sans_session: 'no session', tour_trop_court: 'turn too short',
          llm_indisponible: 'no model available', rien_a_retenir: 'nothing worth keeping', deja_connu: 'already known', erreur: 'failed',
        }
        if (s === 'ecrit') return 'wrote ' + String(capture.facts) + (capture.facts === 1 ? ' memory' : ' memories')
        return map[s] !== undefined ? map[s] : s
      }

      /**
       * Escape closes the page's own menu / side sheet. DSH's Settings dialog also listens for Escape
       * (capture phase on the document), so we listen earlier (window, capture) and stop the event:
       * otherwise one Escape would also close the whole Settings page. Only mounted while something is open,
       * so an Escape with nothing open still reaches DSH. Returns the unsubscribe.
       */
      const onEscape = (close) => {
        const h = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close() } }
        window.addEventListener('keydown', h, true)
        return () => window.removeEventListener('keydown', h, true)
      }

      /** Same-origin JSON call. Never throws: every failure is `{ ok:false, error }`. */
      const api = async (path, body) => {
        try {
          const init = body === undefined ? { method: 'GET' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
          const res = await fetch(path, init)
          let json = null
          try { json = await res.json() } catch (e) { json = null }
          if (json === null || typeof json !== 'object') return { ok: false, error: res.status === 404 ? 'indisponible' : 'refus_' + String(res.status) }
          return json
        } catch (e) {
          return { ok: false, error: 'reseau' }
        }
      }

      // ═══════════════════════════════════════════════════════════════
      // 2. STYLES
      // ═══════════════════════════════════════════════════════════════
      // Tokens come from kybernos-theme (`--kb-*`, always shipped: it is in the base), each with
      // DSH's own alias as a fallback so the page still reads without it. The prefix `kbmem-` is
      // unique to this bundle (class prefixes are shared across bundles: grep before inventing one).
      const css = `
[data-slot="settings.section"]:has(.kbmem-page){width:100%;max-width:none}
.kbmem-page{--m-ink:var(--kb-ink,var(--dsw-alias-label-primary,#f9fafb));--m-ink2:var(--kb-ink2,var(--dsw-alias-label-secondary,#cfd3d6));--m-muted:var(--kb-muted,var(--dsw-alias-label-secondary,#adb2b8));--m-cap:var(--kb-caption,var(--dsw-alias-label-tertiary,#81858c));
  --m-line:var(--kb-line,var(--dsw-alias-border-l1,rgba(255,255,255,.06)));--m-line2:var(--kb-line2,var(--dsw-alias-border-l2,rgba(255,255,255,.12)));--m-line3:var(--kb-line3,var(--dsw-alias-border-l3,rgba(255,255,255,.16)));
  --m-hover:var(--kb-hover,var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08)));--m-fill:var(--kb-fill,var(--dsw-alias-bg-layer-3,#353638));--m-surf:var(--kb-surface,var(--dsw-alias-bg-layer-1,#232324));--m-surf2:var(--kb-surface2,var(--dsw-alias-bg-layer-2,#2c2c2e));
  --m-toast:var(--kb-toast,#43454a);--m-acc:var(--kb-accent,#7aaaff);--m-ok:var(--kb-ok,#22c55e);--m-ok-bg:var(--kb-ok-bg,#233c2c);--m-warn:var(--kb-warn,#f59e0b);--m-warn-bg:var(--kb-warn-bg,#27241f);--m-danger:var(--kb-danger,#f25a5a);
  --m-primary:var(--kb-primary,#f9fafb);--m-primary-ink:var(--kb-primary-ink,#353638);--m-r-md:var(--dsw-radius-md,12px);--m-r-sm:var(--dsw-radius-sm,8px);--m-r-lg:var(--dsw-radius-lg,16px);
  max-width:960px;min-width:0;margin-inline:auto;color:var(--m-ink);font-size:14px;line-height:22px;position:relative}
.kbmem-page *{box-sizing:border-box}
/* :where() keeps these resets at zero specificity, so every component class below wins over them. */
:where(.kbmem-page) button{font:inherit;color:inherit;cursor:pointer;background:none;border:0;padding:0;text-align:start}
:where(.kbmem-page) svg{display:block;flex:none}
.kbmem-ico{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.kbmem-page :focus-visible{outline:2px solid var(--m-acc);outline-offset:1px}
.kbmem-grow{flex:1}.kbmem-muted{color:var(--m-muted)}.kbmem-cap{color:var(--m-cap)}.kbmem-tiny{font-size:12px;color:var(--m-cap)}
.kbmem-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.kbmem-h1{margin:0;font-size:18px;line-height:23.4px;font-weight:600;letter-spacing:-.18px}
.kbmem-lead{margin:4px 0 22px;font-size:13px;color:var(--m-muted)}
.kbmem-st{display:inline-flex;gap:6px;align-items:center;font-size:12px;color:var(--m-muted)}.kbmem-st:hover{color:var(--m-ink)}
.kbmem-st i{display:block;width:7px;height:7px;border-radius:50%;background:var(--m-ok)}.kbmem-st.off i{background:var(--m-warn)}
.kbmem-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:600;background:var(--m-primary);color:var(--m-primary-ink);white-space:nowrap}
.kbmem-btn.ghost{background:transparent;color:var(--m-ink2);border:1px solid var(--m-line2)}.kbmem-btn.ghost:hover{background:var(--m-hover)}
.kbmem-btn.danger{background:transparent;color:var(--m-danger);border:1px solid var(--m-line2)}
.kbmem-btn[disabled]{opacity:.4;pointer-events:none}
.kbmem-seg{display:inline-flex;padding:3px;border:1px solid var(--m-line2);border-radius:999px;height:38px;flex:none}
.kbmem-seg button{height:30px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:600;color:var(--m-ink2);display:inline-flex;gap:6px;align-items:center}
.kbmem-seg button.on{background:var(--m-primary);color:var(--m-primary-ink)}
.kbmem-seg button[disabled]{opacity:.45;pointer-events:none}
.kbmem-seg.sm{height:32px}.kbmem-seg.sm button{height:24px;padding:0 10px;font-size:12px}
.kbmem-cnt{font-size:11px;font-weight:600;opacity:.65;font-variant-numeric:tabular-nums}
.kbmem-row2{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.kbmem-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.kbmem-field{flex-basis:200px}
.kbmem-field{display:flex;gap:8px;align-items:center;flex:1;min-width:0;height:36px;padding:0 12px;border-radius:var(--m-r-md);background:var(--m-fill);color:var(--m-muted)}
.kbmem-field input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--m-ink);font:inherit}
.kbmem-modes{display:inline-flex;gap:2px;padding:2px;border-radius:999px;background:var(--m-surf);flex:none}
.kbmem-modes button{display:inline-flex;gap:4px;align-items:center;height:22px;padding:0 9px;border-radius:999px;font-size:11px;font-weight:600;color:var(--m-ink2);white-space:nowrap}
.kbmem-modes button.on{background:var(--m-primary);color:var(--m-primary-ink)}
.kbmem-modes button.locked{color:var(--m-muted)}
.kbmem-modes .kbmem-ico{width:11px;height:11px}
.kbmem-chip.close{color:var(--m-acc);border-color:var(--m-acc)}
.kbmem-idx{display:flex;flex-wrap:wrap;gap:4px;align-items:center}
.kbmem-mode{display:inline-flex;gap:4px;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;background:var(--m-surf);color:var(--m-ink2);white-space:nowrap}
.kbmem-menuwrap{position:relative}
.kbmem-menu{position:absolute;top:calc(100% + 6px);inset-inline-end:0;min-width:240px;max-height:70vh;overflow:auto;padding:6px;border-radius:var(--m-r-md);background:var(--m-toast);box-shadow:var(--kb-elev,0 8px 24px rgba(0,0,0,.35));z-index:30}
.kbmem-menu button{display:flex;gap:8px;align-items:center;width:100%;height:34px;padding:0 12px;border-radius:var(--m-r-sm);font-size:13px}.kbmem-menu button:hover{background:var(--m-hover)}
.kbmem-mg{padding:8px 12px 2px;font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--m-cap)}
.kbmem-msep{height:1px;margin:6px 0;background:var(--m-line2)}
.kbmem-ck{width:15px}
.kbmem-badge{display:inline-grid;place-items:center;min-width:16px;height:16px;padding:0 4px;border-radius:8px;background:var(--m-acc);color:#151517;font-size:10px;font-weight:700}
.kbmem-chips{display:flex;gap:6px;flex-wrap:wrap;margin:-4px 0 12px}
.kbmem-fc{display:inline-flex;gap:6px;align-items:center;height:26px;padding:0 6px 0 10px;border-radius:999px;background:var(--m-toast);font-size:12px}
.kbmem-fc .kbmem-ico{width:12px;height:12px;color:var(--m-muted)}
.kbmem-chip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--m-line2);font-size:11px;font-weight:500;color:var(--m-ink2);white-space:nowrap}
.kbmem-chip.ok{color:var(--m-ok);background:var(--m-ok-bg);border-color:transparent}
.kbmem-chip.warn{color:var(--m-warn);background:var(--m-warn-bg);border-color:transparent}
.kbmem-plan{display:inline-flex;gap:4px;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;font-weight:600;color:var(--m-acc);border:1px solid var(--m-acc);white-space:nowrap}
.kbmem-plan .kbmem-ico{width:11px;height:11px}
.kbmem-note{display:flex;gap:12px;align-items:flex-start;margin:0 0 14px;padding:12px 16px;border-radius:var(--m-r-md);background:var(--m-surf);font-size:13px;color:var(--m-ink2)}
.kbmem-note.warn{background:var(--m-warn-bg)}.kbmem-note a,.kbmem-link{color:var(--m-acc);font-weight:600;cursor:pointer}
.kbmem-list{border-top:1px solid var(--m-line2)}
.kbmem-r{display:flex;gap:12px;align-items:flex-start;width:100%;padding:12px 8px;border-bottom:1px solid var(--m-line)}.kbmem-r:hover{background:var(--m-hover)}.kbmem-r.sel{background:var(--m-toast)}
.kbmem-kd{flex:none;width:8px;height:8px;margin-top:7px;border-radius:50%;background:var(--m-cap)}
.kbmem-kd.fact{background:var(--m-acc)}.kbmem-kd.preference{background:var(--m-ok)}.kbmem-kd.policy{background:var(--m-warn)}.kbmem-kd.event{background:var(--m-cap)}.kbmem-kd.lesson{border-radius:2px;transform:rotate(45deg);background:var(--m-primary)}
.kbmem-tx{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.kbmem-mt{flex:none;display:flex;gap:8px;align-items:center;margin-top:1px;font-size:12px;color:var(--m-cap)}
.kbmem-pager{display:flex;gap:12px;align-items:center;margin-top:16px;font-size:12px;color:var(--m-muted)}
.kbmem-pgs{display:flex;gap:2px;align-items:center}
.kbmem-pg{min-width:30px;height:30px;padding:0 6px;border-radius:var(--m-r-sm);text-align:center!important;font-size:13px;color:var(--m-ink2)}.kbmem-pg:hover{background:var(--m-hover)}.kbmem-pg.on{background:var(--m-toast);color:var(--m-ink);font-weight:600}.kbmem-pg[disabled]{opacity:.35;pointer-events:none}
.kbmem-gap{padding:0 4px;color:var(--m-cap)}
.kbmem-sel{height:34px;padding:0 12px;border-radius:var(--m-r-md);background:var(--m-fill);border:0;color:var(--m-ink);font:inherit;font-size:13px}
.kbmem-empty{display:grid;justify-items:center;gap:12px;padding:48px 24px;text-align:center;color:var(--m-muted)}
.kbmem-empty h3{margin:0;color:var(--m-ink);font-size:16px}
.kbmem-ill{width:56px;height:56px;border-radius:50%;display:grid;place-items:center;background:var(--m-surf);color:var(--m-acc)}
.kbmem-sheet{position:fixed;inset-block:0;inset-inline-end:0;width:400px;max-width:92vw;padding:24px;background:var(--m-surf2);border-inline-start:1px solid var(--m-line3);box-shadow:var(--kb-elev,0 8px 24px rgba(0,0,0,.35));display:grid;align-content:start;gap:16px;z-index:10000;overflow:auto}
.kbmem-sheet h3{margin:0;display:flex;gap:8px;align-items:center;font-size:16px}
.kbmem-sheet textarea{width:100%;min-height:110px;resize:vertical;padding:12px;border-radius:var(--m-r-md);border:1px solid var(--m-line2);background:var(--m-surf);color:var(--m-ink);font:inherit;outline:0}
.kbmem-f{display:grid;gap:6px}.kbmem-f>span{font-size:12px;color:var(--m-muted)}
.kbmem-acts{display:flex;gap:8px;align-items:center}
.kbmem-ib{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:var(--m-r-sm);color:var(--m-ink2)}.kbmem-ib:hover{background:var(--m-fill)}
.kbmem-toast{position:fixed;inset-inline:0;bottom:24px;margin-inline:auto;width:max-content;max-width:90vw;display:flex;gap:12px;align-items:center;padding:12px 16px;border-radius:999px;background:var(--m-toast);color:var(--m-ink);box-shadow:var(--kb-elev,0 8px 24px rgba(0,0,0,.35));font-size:13px;z-index:10001}
.kbmem-toast button{font-weight:600;color:var(--m-acc)}
.kbmem-crumb{display:inline-flex;gap:6px;align-items:center;margin-bottom:12px;font-size:13px;color:var(--m-muted)}.kbmem-crumb:hover{color:var(--m-ink)}
.kbmem-sec{margin:28px 0 0}.kbmem-sec>h2{margin:0;display:flex;gap:8px;align-items:baseline;font-size:14px;font-weight:600}.kbmem-sec>h2 small{font-size:12px;font-weight:400;color:var(--m-muted)}
.kbmem-srow{display:flex;gap:24px;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid var(--m-line2);max-width:760px}
.kbmem-srow .lab{display:flex;gap:8px;align-items:center}.kbmem-srow .desc{font-size:12px;line-height:18px;color:var(--m-muted);margin-top:2px}.kbmem-srow .why{margin-top:4px;font-size:12px;line-height:18px;color:var(--m-warn)}
.kbmem-srow .ctl{flex:none}.kbmem-srow.locked .ctl{opacity:.4;pointer-events:none}
.kbmem-srow.sum{border-bottom:0;padding-bottom:0}
.kbmem-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--m-fill);border-top-color:var(--m-muted);animation:kbmem-spin .8s linear infinite}
@keyframes kbmem-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.kbmem-spin{animation:none}}
`

      // ═══════════════════════════════════════════════════════════════
      // 3. SMALL COMPONENTS
      // ═══════════════════════════════════════════════════════════════
      const ICONS = {
        brain: '<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5c0 .4.1.8.2 1.1A3.5 3.5 0 0 0 4 10.8c0 1 .5 2 1.2 2.6A3.5 3.5 0 0 0 7 19a3 3 0 0 0 5-1V4.5A1.5 1.5 0 0 0 9.5 3z"/><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5c0 .4-.1.8-.2 1.1A3.5 3.5 0 0 1 20 10.8c0 1-.5 2-1.2 2.6A3.5 3.5 0 0 1 17 19a3 3 0 0 1-5-1V4.5A1.5 1.5 0 0 1 14.5 3z"/>',
        pin: '<path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/>', search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>', plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
        users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.2A6.5 6.5 0 0 1 21.5 20"/>',
        cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
        alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18v.5"/>', shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/>',
        list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.5M4 12h.5M4 18h.5"/>', map: '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="17" r="2"/><path d="M7.7 8.2l3 7M16.5 7.5l-3.5 8"/>',
        filter: '<path d="M4 6h16M7 12h10M10 18h4"/>', left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
        bulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6M10 22h4"/>',
      }
      // The paths are this file's own constants (never user text): setting them as markup is safe.
      const Ico = (name, extra) => h('svg', { className: 'kbmem-ico' + (extra ? ' ' + extra : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: ICONS[name] || '' } })

      const Seg = ({ items, value, onChange, small, label }) => h('div', { className: 'kbmem-seg' + (small ? ' sm' : ''), role: 'group', 'aria-label': label },
        items.map((it) => h('button', { key: it.v, type: 'button', className: value === it.v ? 'on' : '', 'aria-pressed': value === it.v, disabled: it.disabled === true, title: it.title, 'data-v': it.v,
          onClick: () => onChange(it.v) }, ...(Array.isArray(it.l) ? it.l : [it.l]))))

      const YesNo = ({ value, onChange, name }) => h(Seg, { value: value ? 'y' : 'n', label: name, onChange: (v) => onChange(v === 'y'), items: [{ v: 'y', l: 'Yes' }, { v: 'n', l: 'No' }] })

      const PlanChip = (text) => h('span', { className: 'kbmem-plan' }, Ico('lock'), text)

      /** One settings row, in the rhythm of DSH's General page: label + description left, control right. */
      const SettingRow = ({ label, desc, control, chip, why, locked, live, act }) => h('div', { className: 'kbmem-srow' + (locked ? ' locked' : ''), 'data-act': act },
        h('div', null,
          h('div', { className: 'lab' }, label, chip || null),
          h('div', { className: 'desc' }, desc),
          live || null,
          why ? h('div', { className: 'why', style: { pointerEvents: 'auto', opacity: 1 } }, why) : null),
        h('div', { className: 'ctl' }, control))

      const Pager = ({ total, page, size, onPage, onSize }) => {
        const p = pagerPages(total, page, size)
        return h('div', { className: 'kbmem-pager' },
          h('span', null, total === 0 ? '0 results' : p.from + '–' + p.to + ' of ' + total),
          h('span', { className: 'kbmem-grow' }),
          h('div', { className: 'kbmem-pgs' },
            h('button', { type: 'button', className: 'kbmem-pg', disabled: p.page <= 1, 'aria-label': 'Previous page', onClick: () => onPage(p.page - 1) }, Ico('left')),
            p.items.map((n, i) => n === '…' ? h('span', { key: 'g' + i, className: 'kbmem-gap' }, '…')
              : h('button', { key: n, type: 'button', className: 'kbmem-pg' + (n === p.page ? ' on' : ''), 'aria-label': 'Page ' + n, 'aria-current': n === p.page ? 'page' : undefined, 'data-page': n, onClick: () => onPage(n) }, n)),
            h('button', { type: 'button', className: 'kbmem-pg', disabled: p.page >= p.pages, 'aria-label': 'Next page', onClick: () => onPage(p.page + 1) }, Ico('right'))),
          h('select', { className: 'kbmem-sel', style: { height: 30, fontSize: 12 }, 'aria-label': 'Rows per page', value: size, onChange: (e) => onSize(parseInt(e.target.value, 10)) },
            PAGE_SIZES.map((n) => h('option', { key: n, value: n }, n + ' per page'))))
      }

      // ═══════════════════════════════════════════════════════════════
      // 4. DATA HOOKS
      // ═══════════════════════════════════════════════════════════════

      /** Plan and connection, once and on demand. */
      const useStatus = (refreshKey) => {
        const [st, setSt] = useState({ loaded: false, connected: false, plan: 'free', raw: null })
        useEffect(() => {
          let live = true
          api('/kybernos-cloud/status').then((r) => { if (live) setSt({ loaded: true, connected: r.ok === true && r.connected === true, plan: planOf(r), raw: r }) })
          return () => { live = false }
        }, [refreshKey])
        return st
      }

      /** The two switch groups. `memory` is null while the cloud plugin is unreachable. */
      const useSettings = (refreshKey) => {
        const [s, setS] = useState({ loaded: false, memory: null, lessons: null, capture: null })
        useEffect(() => {
          let live = true
          Promise.all([api('/kybernos-cloud/memory/settings'), api('/kybernos-memory/settings')]).then(([m, l]) => {
            if (live) setS({ loaded: true, memory: m.ok === true ? m.settings : null, lessons: l.ok === true ? l.settings : null, capture: m.ok === true && m.capture !== undefined ? m.capture : null })
          })
          return () => { live = false }
        }, [refreshKey])
        return s
      }

      /** One list (memories or lessons), reloaded when its query changes. A stale answer never overwrites a newer one. */
      /** Search by meaning: is it on, can the server, does the plan allow it, how much is indexed. Reads only (a probe is asked for explicitly). */
      const useMeaning = (enabled, refreshKey, probe) => {
        const [m, setM] = useState({ loaded: false })
        const probed = useRef(false)
        useEffect(() => {
          if (!enabled) { probed.current = false; setM({ loaded: true, enabled: false }); return undefined }
          let live = true
          // The probe (one 2-letter embedding) happens once each time the switch comes on, never on a later re-read.
          const withProbe = probe === true && probed.current !== true
          if (withProbe) probed.current = true
          api('/kybernos-cloud/memory/index' + (withProbe ? '?probe=1' : '')).then((r) => { if (live) setM(Object.assign({ loaded: true }, r)) })
          return () => { live = false }
        }, [enabled, refreshKey, probe])
        return m
      }

      const useList = (tab, state, refreshKey) => {
        const [d, setD] = useState({ loading: true, ok: false, error: null, total: 0, items: [], counts: null, extra: null })
        const seq = useRef(0)
        const url = listUrl(tab, state)
        useEffect(() => {
          const mine = ++seq.current
          setD((old) => Object.assign({}, old, { loading: true }))
          api(url).then((r) => {
            if (mine !== seq.current) return
            if (r.ok === true) setD({ loading: false, ok: true, error: null, total: r.total, items: r.items, counts: r.counts, extra: r })
            else setD({ loading: false, ok: false, error: r.error === undefined ? 'indisponible' : r.error, total: 0, items: [], counts: null, extra: r })
          })
        }, [url, refreshKey])
        return d
      }

      // ═══════════════════════════════════════════════════════════════
      // 5. PAGE
      // ═══════════════════════════════════════════════════════════════

      const FilterMenu = ({ tab, f, onSet, onClear, kybers, plan }) => {
        const groups = GROUPS[tab]
        return h('div', { className: 'kbmem-menu', role: 'menu' },
          groups.map((g) => [
            h('div', { key: g.key + '-h', className: 'kbmem-mg' }, g.label),
            g.opts.map(([v, l]) => {
              const soon = tab === 'lessons' && g.key === 'scope' && v === 'team'
              return h('button', { key: g.key + v, type: 'button', role: 'menuitemradio', 'aria-checked': f[g.key] === v, 'data-g': g.key, 'data-v': v, disabled: soon,
                onClick: () => onSet(g.key, v) },
                h('span', { className: 'kbmem-ck' }, f[g.key] === v ? Ico('check') : null), l,
                soon ? h('span', { className: 'kbmem-plan', style: { marginInlineStart: 'auto' } }, Ico('lock'), 'Team · soon') : null)
            }),
          ]),
          tab === 'lessons' && kybers.length > 0 ? [h('div', { key: 'k-h', className: 'kbmem-mg' }, 'Kyber'),
            h('button', { key: 'k-any', type: 'button', role: 'menuitemradio', 'data-g': 'kyber', 'data-v': '', onClick: () => onSet('kyber', '') }, h('span', { className: 'kbmem-ck' }, f.kyber === '' ? Ico('check') : null), 'Any'),
            kybers.map((k) => h('button', { key: 'k-' + k.id, type: 'button', role: 'menuitemradio', 'data-g': 'kyber', 'data-v': k.id, onClick: () => onSet('kyber', k.id) },
              h('span', { className: 'kbmem-ck' }, f.kyber === k.id ? Ico('check') : null), k.id, h('span', { className: 'kbmem-cap', style: { marginInlineStart: 'auto' } }, k.count)))] : null,
          h('div', { className: 'kbmem-msep' }),
          h('button', { type: 'button', 'data-act': 'clear', onClick: onClear }, 'Clear filters'))
      }

      const MemoryRow = ({ m, selected, onOpen, ctxOn }) => h('button', { type: 'button', className: 'kbmem-r' + (selected ? ' sel' : ''), 'data-id': m.id, onClick: () => onOpen(m) },
        h('span', { className: 'kbmem-kd ' + m.kind, title: KIND_LABEL[m.kind] || m.kind }),
        h('span', { className: 'kbmem-tx' }, m.content),
        h('span', { className: 'kbmem-mt' },
          m.sent && ctxOn ? h('span', { className: 'kbmem-chip ok' }, 'Sent') : null,
          closenessLabel(m.closeness) !== null ? h('span', { className: 'kbmem-chip close', title: 'How close this memory is to your search, by meaning' }, closenessLabel(m.closeness)) : null,
          wordsLabel(m.matched, m.of) !== null ? h('span', { className: 'kbmem-chip', 'data-chip': 'words', title: 'How many of the words you typed this memory has' }, wordsLabel(m.matched, m.of)) : null,
          m.pinned ? h('span', { title: 'Pinned' }, Ico('pin')) : null,
          h('span', null, ORIGIN_LABEL[m.origin] || m.origin),
          h('span', { style: { minWidth: 30, textAlign: 'end' } }, ageLabel(m.ageMinutes))))

      const LessonRow = ({ l, selected, onOpen }) => h('button', { type: 'button', className: 'kbmem-r' + (selected ? ' sel' : ''), 'data-id': l.id, onClick: () => onOpen(l) },
        h('span', { className: 'kbmem-kd lesson' }),
        h('span', { className: 'kbmem-tx' }, l.text),
        h('span', { className: 'kbmem-mt' },
          wordsLabel(l.matched, l.of) !== null ? h('span', { className: 'kbmem-chip', 'data-chip': 'words', title: 'How many of the words you typed this lesson has' }, wordsLabel(l.matched, l.of)) : null,
          h('span', null, l.kyber),
          l.uses > 0 ? h('span', null, 'Used ' + l.uses + '×') : null,
          h('span', { style: { minWidth: 30, textAlign: 'end' } }, ageLabel(l.ageMinutes))))

      /** The side sheet: edit or add a memory, edit a lesson. Closes on Cancel; the page reloads after a save. */
      const Sheet = ({ sheet, onClose, onDone, notify }) => {
        const mem = sheet.kind === 'mem'
        const item = sheet.item
        const [text, setText] = useState(mem ? item.content : item.text)
        const [pinned, setPinned] = useState(mem ? item.pinned === true : false)
        const [kind, setKind] = useState(mem ? item.kind : 'fact')
        const [days, setDays] = useState(mem && item.retentionDays !== null && item.retentionDays !== undefined ? item.retentionDays : 180)
        const [tags, setTags] = useState(mem ? '' : (item.tags || []).join(', '))
        const [busy, setBusy] = useState(false)
        const [confirm, setConfirm] = useState(false)
        const isNew = sheet.isNew === true
        const fail = (r) => { setBusy(false); notify(friendlyError(r.error)) }

        const save = async () => {
          setBusy(true)
          if (mem && isNew) {
            const r = await api('/kybernos-cloud/memory/add', { content: text, kind, pinned, source: 'taught' })
            if (r.ok !== true) return fail(r)
            return onDone('Memory added')
          }
          if (mem) {
            const body = { id: item.id }
            if (text.trim() !== item.content) body.content = text
            if (pinned !== (item.pinned === true)) body.pinned = pinned
            if (days !== item.retentionDays) body.retentionDays = days
            if (Object.keys(body).length === 1) { setBusy(false); return onClose() }
            const r = await api('/kybernos-cloud/memory/update', body)
            if (r.ok !== true) return fail(r)
            return onDone('Saved')
          }
          const body = { id: item.id }
          if (text.trim() !== item.text) body.text = text
          const cleanTags = tags.split(',').map((t) => t.trim()).filter((t) => t !== '')
          if (cleanTags.join(',') !== (item.tags || []).join(',')) body.tags = cleanTags
          if (Object.keys(body).length === 1) { setBusy(false); return onClose() }
          const r = await api('/kybernos-memory/lessons/update', body)
          if (r.ok !== true) return fail(r)
          return onDone('Saved')
        }

        const remove = async () => {
          setBusy(true)
          if (mem) {
            const r = await api('/kybernos-cloud/memory/delete', { id: item.id })
            if (r.ok !== true) return fail(r)
            return onDone('Forgot 1 memory', { content: item.content, kind: item.kind, pinned: item.pinned === true, source: 'taught' })
          }
          const r = await api('/kybernos-memory/lessons/delete', { id: item.id })
          if (r.ok !== true) return fail(r)
          return onDone('Lesson archived')
        }

        return h('aside', { className: 'kbmem-sheet', role: 'dialog', 'aria-label': mem ? 'Memory' : 'Lesson' },
          h('h3', null, h('span', { className: 'kbmem-kd ' + (mem ? kind : 'lesson'), style: { margin: 0 } }), isNew ? 'New memory' : (mem ? 'Memory' : 'Lesson'),
            h('span', { className: 'kbmem-grow' }), h('button', { type: 'button', className: 'kbmem-ib', 'aria-label': 'Close', onClick: onClose }, Ico('x'))),
          h('textarea', { 'aria-label': mem ? 'Memory text' : 'Lesson text', value: text, placeholder: mem ? 'What should Kybernos remember about you?' : '', onChange: (e) => setText(e.target.value), disabled: busy }),
          mem && isNew ? h('div', { className: 'kbmem-f' }, h('span', null, 'Type'),
            h('select', { className: 'kbmem-sel', value: kind, onChange: (e) => setKind(e.target.value) }, Object.keys(KIND_LABEL).map((k) => h('option', { key: k, value: k }, KIND_LABEL[k])))) : null,
          mem && !isNew ? h('div', { className: 'kbmem-f' }, h('span', null, 'Type'), h('div', null, h('span', { className: 'kbmem-chip' }, KIND_LABEL[item.kind] || item.kind))) : null,
          mem ? h('div', { className: 'kbmem-f' }, h('span', null, 'Keep for'),
            h('select', { className: 'kbmem-sel', value: days, onChange: (e) => setDays(parseInt(e.target.value, 10)), disabled: busy || pinned },
              RETENTIONS.map(([v, l]) => h('option', { key: v, value: v }, l)).concat(RETENTIONS.some((r) => r[0] === days) ? [] : [h('option', { key: days, value: days }, days + ' days')]))) : null,
          mem ? h('div', { className: 'kbmem-f' }, h('span', null, 'Pinned — never expires, sent first'), h(YesNo, { value: pinned, name: 'Pinned', onChange: setPinned })) : null,
          !mem ? h('div', { className: 'kbmem-f' }, h('span', null, 'Tags (comma separated, 5 at most)'),
            h('input', { className: 'kbmem-sel', style: { width: '100%' }, value: tags, onChange: (e) => setTags(e.target.value), disabled: busy })) : null,
          !isNew && mem ? h('div', { className: 'kbmem-tiny' }, (ORIGIN_LABEL[item.origin] || item.origin) + (item.originKnown === false ? ' (guessed)' : '') + ' · created ' + ageLabel(item.ageMinutes) + ' ago · ' + (item.sent ? 'sent to the model each turn' : 'not sent this turn')) : null,
          !mem ? h('div', { className: 'kbmem-tiny' }, h('span', { className: 'kbmem-chip' }, item.kyber), ' ' + (item.uses > 0 ? 'used ' + item.uses + '× · ' : 'never used · ') + ageLabel(item.ageMinutes) + ' ago') : null,
          h('div', { className: 'kbmem-acts' },
            h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'save', disabled: busy || text.trim() === '', onClick: save }, isNew ? 'Save memory' : 'Save'),
            h('button', { type: 'button', className: 'kbmem-btn ghost', onClick: onClose }, 'Cancel'),
            h('span', { className: 'kbmem-grow' }),
            isNew ? null : (confirm
              ? h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'confirm-remove', disabled: busy, onClick: remove }, mem ? 'Confirm: forget' : 'Confirm: delete')
              : h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'remove', disabled: busy, onClick: () => setConfirm(true) }, Ico('trash'), mem ? 'Forget' : 'Delete'))),
          !mem && !isNew ? h('div', { className: 'kbmem-tiny' }, 'A deleted lesson goes to the kyber\'s lessons.archive.jsonl — it is not destroyed.') : null)
      }

      const MainView = ({ tab, setTab, status, settings, openOptions, notify, bump, refreshKey }) => {
        const [q, setQ] = useState('')
        const [qd, setQd] = useState('')
        const [f, setF] = useState(defaultFilters())
        const [page, setPage] = useState(1)
        const [size, setSize] = useState(PAGE_SIZES[0])
        const [menu, setMenu] = useState(false)
        const [sheet, setSheet] = useState(null)
        const [mode, setModeState] = useState(readMode)
        const setMode = (v) => { setModeState(v); writeMode(v); setPage(1) }
        const wrap = useRef(null)
        useEffect(() => { const t = setTimeout(() => { setQd(q); setPage(1) }, 250); return () => clearTimeout(t) }, [q])
        useEffect(() => {
          if (!menu) return undefined
          const away = (e) => { if (wrap.current !== null && !wrap.current.contains(e.target)) setMenu(false) }
          document.addEventListener('mousedown', away)
          const unesc = onEscape(() => setMenu(false))
          return () => { document.removeEventListener('mousedown', away); unesc() }
        }, [menu])
        // Escape also closes the side sheet.
        const sheetOpen = sheet !== null
        useEffect(() => (sheetOpen ? onEscape(() => setSheet(null)) : undefined), [sheetOpen])
        const meaning = useMeaning(settings.memory !== null && settings.memory.meaning === true, refreshKey, false)
        const list = useList(tab, { f, q: qd, page, size, mode }, refreshKey)
        const [kybers, setKybers] = useState([])
        useEffect(() => { let live = true; api('/kybernos-memory/kybers').then((r) => { if (live && r.ok === true) setKybers(r.kybers) }); return () => { live = false } }, [refreshKey])
        const [otherCount, setOtherCount] = useState(null)
        useEffect(() => {
          let live = true
          const url = tab === 'memories' ? '/kybernos-memory/lessons?limit=1' : '/kybernos-cloud/memory/list?limit=1'
          api(url).then((r) => { if (live) setOtherCount(r.ok === true ? r.total : null) })
          return () => { live = false }
        }, [tab, refreshKey])

        const mems = tab === 'memories'
        const connected = status.connected
        const memSwitches = settings.memory
        // Why « Meaning » is not available right now: the switch, the server, or the plan — in that order.
        const meaningReason = memSwitches === null || memSwitches.meaning !== true ? 'sens_desactive'
          : meaning.loaded !== true ? null : meaning.available === false ? meaning.reason : meaning.allowed === false ? 'offre_requise' : null
        const canMeaning = memSwitches !== null && memSwitches.meaning === true && meaning.loaded === true && meaning.available === true && meaning.allowed !== false
        const memOn = settings.memory === null ? true : settings.memory.memories === true
        const ctxOn = mems ? (settings.memory === null ? true : settings.memory.context === true) : (settings.lessons === null ? true : settings.lessons.context === true)
        const lesOn = settings.lessons === null ? true : settings.lessons.lessons === true
        const on = mems ? memOn && connected : lesOn
        const active = activeFilters(tab, f)
        // A list that failed to load has no count: showing 0 would say « nothing here » when the truth is « unknown ».
        const memCount = mems ? (list.ok ? list.total : null) : otherCount
        const lesCount = mems ? otherCount : (list.ok ? list.total : null)
        const sentText = mems
          ? (list.ok && list.extra !== null && list.extra.budget !== undefined ? list.extra.budget.sent + ' of ' + (list.counts ? list.counts.all : list.total) + ' sent each turn' : '')
          : 'sent to each session: its kyber + default'
        const status1 = on ? (ctxOn ? 'On · ' + sentText : 'On · not sent to the model') : 'Off'

        const setFilter = (key, v) => { setF(Object.assign({}, f, { [key]: v })); setPage(1) }
        const clearFilters = () => { setF(defaultFilters()); setPage(1); setMenu(false) }
        const notFound = list.error === 'indisponible' || list.error === 'non connecte'

        const after = (message, undo) => { setSheet(null); bump(); notify(message, undo) }
        const forgetUndo = (message, copy) => after(message, copy === undefined ? undefined : async () => {
          const r = await api('/kybernos-cloud/memory/add', copy)
          bump(); notify(r.ok === true ? 'Memory restored' : friendlyError(r.error))
        })

        const tabs = h('div', { className: 'kbmem-row2' },
          h(Seg, { value: tab, onChange: (v) => { setTab(v); setF(defaultFilters()); setQ(''); setPage(1); setSheet(null); setMenu(false) }, label: 'Section', items: [
            { v: 'memories', l: [h('span', { key: 'a' }, 'Memories'), h('span', { key: 'b', className: 'kbmem-cnt' }, memCount === null ? '' : memCount)] },
            { v: 'lessons', l: [h('span', { key: 'a' }, 'Lessons learned'), h('span', { key: 'b', className: 'kbmem-cnt' }, lesCount === null ? '' : lesCount)] }] }),
          h('span', { className: 'kbmem-grow' }),
          h(Seg, { small: true, value: 'list', label: 'View', onChange: () => {}, items: [
            { v: 'list', l: [Ico('list'), ' List'] },
            { v: 'map', l: [Ico('map'), ' Map ', Ico('lock')], disabled: true, title: 'The map groups items by meaning and needs a search index that does not exist yet.' }] }))

        const tools = h('div', { className: 'kbmem-tools' },
          h('label', { className: 'kbmem-field' }, Ico('search'),
            h('input', { 'aria-label': 'Search', placeholder: mems ? 'Search memories…' : 'Search lessons…', value: q, onChange: (e) => setQ(e.target.value) }),
            mems
              ? h('span', { className: 'kbmem-modes', role: 'group', 'aria-label': 'Search by' },
                h('button', { type: 'button', className: mode === 'relevance' ? 'on' : '', 'aria-pressed': mode === 'relevance', 'data-mode': 'relevance', title: 'Ranks memories by how well they match your words (accents and plurals ignored). Nothing leaves this machine.', onClick: () => setMode('relevance') }, 'Relevance'),
                h('button', { type: 'button', className: (mode === 'meaning' ? 'on' : '') + (canMeaning ? '' : ' locked'), 'aria-pressed': mode === 'meaning', 'data-mode': 'meaning',
                  title: canMeaning ? 'Finds memories that mean the same, even with other words.' : meaningWhy(meaningReason, meaning.requiredTier) + ' Click to open Options.',
                  onClick: () => (canMeaning || mode === 'meaning' ? setMode('meaning') : openOptions()) }, canMeaning ? null : Ico('lock'), 'Meaning'))
              : h('span', { className: 'kbmem-mode', title: 'Ranks lessons by how well they match your words (accents and plurals ignored). Nothing leaves this machine.' }, 'By relevance')),
          h('div', { className: 'kbmem-menuwrap', ref: wrap },
            h('button', { type: 'button', className: 'kbmem-btn ghost', 'aria-haspopup': 'true', 'aria-expanded': menu, 'data-act': 'filter', onClick: () => setMenu(!menu) }, Ico('filter'), 'Filter',
              active.length > 0 ? h('span', { className: 'kbmem-badge' }, active.length) : null),
            menu ? h(FilterMenu, { tab, f, onSet: setFilter, onClear: clearFilters, kybers, plan: status.plan }) : null),
          mems ? h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'add', disabled: !connected || !memOn, onClick: () => setSheet({ kind: 'mem', isNew: true, item: { content: '', kind: 'fact', pinned: false } }) }, Ico('plus'), 'Add') : null)

        const chips = active.length > 0 ? h('div', { className: 'kbmem-chips' },
          active.map((c) => h('button', { key: c.key, type: 'button', className: 'kbmem-fc', 'aria-label': 'Remove filter ' + c.text, 'data-key': c.key, onClick: () => setFilter(c.key, c.def) }, c.text, Ico('x'))),
          h('button', { type: 'button', className: 'kbmem-link', style: { fontSize: 12, padding: '0 4px' }, onClick: clearFilters }, 'Clear all')) : null

        const notes = []
        if (mems && status.loaded && !connected) notes.push(h('div', { key: 'n1', className: 'kbmem-note warn' }, Ico('cloud'), h('div', null, h('b', null, 'Not connected. '), 'Memories live in your Kybernos Cloud account: connect it to see and edit them. Lessons are stored on this machine and keep working.')))
        else if (mems && !memOn) notes.push(h('div', { key: 'n2', className: 'kbmem-note warn' }, Ico('alert'), h('div', null, h('b', null, 'Memories is off. '), 'Nothing new is saved or used. What you already have stays here. ', h('a', { onClick: openOptions }, 'Open options'))))
        else if (!mems && !lesOn) notes.push(h('div', { key: 'n3', className: 'kbmem-note warn' }, Ico('alert'), h('div', null, h('b', null, 'Lessons learned is off. '), 'Agents are told not to record lessons, and none is injected. ', h('a', { onClick: openOptions }, 'Open options'))))

        // A meaning search that could not be done shows word matches instead — and says why, with the way to fix it.
        const sr = mems && mode === 'meaning' && String(qd).trim() !== '' && list.ok && list.extra !== null && list.extra.search !== undefined ? list.extra.search : null
        if (sr !== null && sr.fallback !== undefined && sr.fallback !== null) {
          notes.push(h('div', { key: 'nf', className: 'kbmem-note', 'data-note': 'fallback' }, Ico('search'), h('div', null, h('b', null, 'Showing relevance matches. '), meaningWhy(sr.fallback, sr.requiredTier), ' ',
            h('a', { className: 'kbmem-link', role: 'button', tabIndex: 0, 'data-act': 'note-options', onClick: openOptions }, 'Open Options'))))
        }
        const byMeaning = sr !== null && sr.mode === 'meaning'

        let body
        if (list.loading && list.items.length === 0 && list.ok === false && list.error === null) body = h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-spin' }))
        else if (!list.ok && list.error !== null) body = h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-ill' }, Ico(mems ? 'cloud' : 'alert')),
          h('h3', null, notFound ? (mems ? 'Memories are not available' : 'Lessons are not available') : 'Could not load'), h('div', null, friendlyError(list.error)))
        else if (list.items.length === 0) body = h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-ill' }, Ico(String(qd).trim() !== '' || active.length > 0 ? 'search' : (mems ? 'brain' : 'bulb'))),
          String(qd).trim() !== '' || active.length > 0
            ? [h('h3', { key: 'h' }, 'No match'), h('div', { key: 'd' }, 'Nothing matches ' + (String(qd).trim() !== '' ? '“' + qd + '”' : 'these filters') + (byMeaning ? '. Nothing is close enough in meaning.' : (mems ? '. No memory has those words.' : '. No lesson has those words.'))), active.length > 0 ? h('button', { key: 'b', type: 'button', className: 'kbmem-btn ghost', onClick: clearFilters }, 'Clear filters') : null]
            : (mems ? [h('h3', { key: 'h' }, 'Nothing remembered yet'), h('div', { key: 'd' }, 'Memories appear as you work: Kybernos can capture them at the end of a turn, an agent can save one, or you can add your own.')]
              : [h('h3', { key: 'h' }, 'No lesson yet'), h('div', { key: 'd' }, 'A lesson is written when an agent finds an expectation was contradicted. They are stored per kyber, on this machine.')]))
        else body = h('div', null,
          h('div', { className: 'kbmem-list', style: list.loading ? { opacity: .6 } : null }, list.items.map((it) => mems
            ? h(MemoryRow, { key: it.id, m: it, ctxOn, selected: sheet !== null && sheet.item.id === it.id, onOpen: (m) => setSheet({ kind: 'mem', item: m }) })
            : h(LessonRow, { key: it.id, l: it, selected: sheet !== null && sheet.item.id === it.id, onOpen: (l) => setSheet({ kind: 'les', item: l }) }))),
          h(Pager, { total: list.total, page, size, onPage: setPage, onSize: (n) => { setSize(n); setPage(1) } }))

        return h('div', null,
          h('div', { className: 'kbmem-top' }, h('h1', { className: 'kbmem-h1' }, 'Memory & Lessons learned'), h('span', { className: 'kbmem-grow' }),
            h('button', { type: 'button', className: 'kbmem-st' + (on ? '' : ' off'), 'data-act': 'status', title: 'Open options', onClick: openOptions }, h('i'), status1),
            h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'options', onClick: openOptions }, Ico('gear'), 'Options')),
          tabs, tools, chips, notes, body,
          sheet !== null ? h(Sheet, { key: (sheet.item.id === undefined ? 'new' : sheet.item.id) + String(sheet.isNew), sheet, onClose: () => setSheet(null), onDone: (m, u) => (sheet.kind === 'mem' ? forgetUndo(m, u) : after(m)), notify }) : null)
      }

      /**
       * « Search by meaning »: the switch (off by default: it sends the text of each memory to the embedding
       * model), what the server and the plan allow, and the indexing. Opening it with the switch on spends ONE
       * 2-letter embedding to learn the plan; indexing is only ever started by the button.
       */
      const MeaningRow = ({ cloud, mem, onToggle, refreshKey, refresh }) => {
        // The page is served live but the host half only loads at the next `dsh web` start: a host that predates
        // this switch does not report it at all. Say so instead of offering a switch that would be refused.
        const stale = mem !== null && typeof mem.meaning !== 'boolean'
        const locked = !cloud || mem === null || mem.memories !== true || stale
        const on = !locked && mem.meaning === true
        const idx = useMeaning(on, refreshKey, true)
        const [run, setRun] = useState({ running: false, done: 0, error: null, tier: null })
        const stop = useRef(false)
        useEffect(() => () => { stop.current = true }, [])
        const index = async () => {
          stop.current = false
          setRun({ running: true, done: 0, error: null, tier: null })
          let done = 0
          for (let guard = 0; guard < 200 && !stop.current; guard++) {
            const r = await api('/kybernos-cloud/memory/index/run', { max: 64 })
            if (r.ok !== true) { setRun({ running: false, done, error: r.error === undefined ? 'indisponible' : r.error, tier: r.requiredTier === undefined ? null : r.requiredTier }); refresh(); return }
            done += r.indexed
            setRun({ running: true, done, error: null, tier: null })
            if (r.remaining === 0 || r.indexed === 0) break
          }
          setRun({ running: false, done, error: null, tier: null })
          refresh()
        }
        let live = null
        if (on) {
          if (idx.loaded !== true || idx.ok === false) live = h('div', { className: 'kbmem-tiny', style: { marginTop: 6 } }, idx.ok === false ? friendlyError(idx.error) : 'Checking what your plan and server allow…')
          else if (idx.available === false) live = h('div', { className: 'kbmem-tiny', style: { marginTop: 6 }, 'data-meaning': 'unavailable' }, meaningWhy(idx.reason))
          else if (idx.allowed === false) live = h('div', { className: 'kbmem-tiny', style: { marginTop: 6 }, 'data-meaning': 'plan' }, meaningWhy('offre_requise', idx.requiredTier) + (idx.plan ? ' You are on ' + (TIER_NAME[idx.plan] || idx.plan) + '.' : ''))
          else {
            const left = idx.remaining === null || idx.remaining === undefined ? null : idx.remaining
            live = h('div', { className: 'kbmem-tiny kbmem-idx', style: { marginTop: 6 }, 'data-meaning': 'ready' },
              h('span', { 'data-idx': 'count' }, idx.indexed === null || idx.total === null ? 'Index status unknown' : 'Indexed ' + idx.indexed + ' of ' + idx.total),
              run.running ? h('span', null, ' · indexing… ' + run.done + ' done') : null,
              run.error ? h('span', { 'data-idx': 'error' }, ' · ' + (run.error === 'offre_requise' ? meaningWhy('offre_requise', run.tier) : meaningWhy(run.error))) : null,
              ' ',
              run.running
                ? h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'index-stop', onClick: () => { stop.current = true } }, 'Stop')
                : h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'index', disabled: left === 0, onClick: index }, left === 0 ? 'All indexed' : 'Index my memories'))
          }
        }
        return h(SettingRow, { label: 'Search by meaning', desc: 'Find a memory with other words than it was written with. The text of each memory is sent to the Kybernos embedding model to place it by meaning, so this is off until you turn it on.',
          chip: on && idx.loaded === true && idx.allowed === false ? PlanChip(TIER_NAME[idx.requiredTier] || 'Solo') : null, locked, live,
          why: !cloud ? 'Connect a Kybernos Cloud account first.' : (stale ? 'The cloud plugin was updated: restart DSH to use this.' : (mem !== null && mem.memories !== true ? 'Turn on Memories first.' : null)),
          control: h(YesNo, { name: 'Search by meaning', value: on, onChange: onToggle }) })
      }

      const OptionsView = ({ status, settings, back, notify, refresh, refreshKey }) => {
        const cloud = status.connected
        const mem = settings.memory
        const les = settings.lessons
        const plan = status.plan
        const setMem = async (patch) => { const r = await api('/kybernos-cloud/memory/settings/set', patch); if (r.ok !== true) notify(friendlyError(r.error)); refresh() }
        const setLes = async (patch) => { const r = await api('/kybernos-memory/settings/set', patch); if (r.ok !== true) notify(friendlyError(r.error)); refresh() }
        const note = !cloud
          ? h('div', { className: 'kbmem-note warn' }, Ico('cloud'), h('div', null, h('b', null, 'Not connected. '), 'Memories live in your Kybernos Cloud account, so they cannot be changed here. Lessons are stored on this machine and keep working.'))
          : h('div', { className: 'kbmem-note' }, Ico('shield'), h('div', null, 'Your plan: ', h('b', null, PLAN_NAME[plan]), '. ', plan === 'team' ? 'Team lessons are not built yet.' : 'The map and team lessons are not built yet.'))
        const memUnavailable = mem === null
        const lesUnavailable = les === null
        const lastCapture = settings.capture === null ? null : h('div', { className: 'kbmem-tiny', style: { marginTop: 6 } }, 'Last capture: ' + captureWords(settings.capture))
        return h('div', null,
          h('a', { className: 'kbmem-crumb', role: 'button', tabIndex: 0, 'data-act': 'back', onClick: back, onKeyDown: (e) => { if (e.key === 'Enter') back() } }, Ico('left'), 'Memory & Lessons learned'),
          h('h1', { className: 'kbmem-h1' }, 'Options'),
          h('p', { className: 'kbmem-lead' }, 'What Kybernos may save, and what it may send to the model.'),
          note,
          h('section', { className: 'kbmem-sec' }, h('h2', null, 'Memories', h('small', null, 'about you')),
            h(SettingRow, { label: 'Memories', desc: 'Allow Kybernos to save memories for more personalized responses.', locked: !cloud || memUnavailable, chip: !cloud ? PlanChip('Cloud account') : null,
              why: !cloud ? 'Connect a Kybernos Cloud account — any plan, including Free.' : (memUnavailable ? 'The cloud plugin is not available.' : null),
              control: h(YesNo, { name: 'Memories', value: mem !== null && mem.memories === true && cloud, onChange: (v) => setMem({ memories: v }) }) }),
            h(SettingRow, { label: 'Memory system context', desc: 'Include saved memories in the system context.', locked: !cloud || memUnavailable || (mem !== null && mem.memories !== true),
              why: mem !== null && mem.memories !== true && cloud ? 'Turn on Memories first.' : null,
              control: h(YesNo, { name: 'Memory system context', value: mem !== null && mem.context === true && mem.memories === true && cloud, onChange: (v) => setMem({ context: v }) }) }),
            h(SettingRow, { label: 'Automatic capture', desc: 'At the end of a turn, let the model note what is worth keeping.', live: lastCapture, locked: !cloud || memUnavailable || (mem !== null && mem.memories !== true),
              why: mem !== null && mem.memories !== true && cloud ? 'Turn on Memories first.' : null,
              control: h(YesNo, { name: 'Automatic capture', value: mem !== null && mem.capture === true && mem.memories === true && cloud, onChange: (v) => setMem({ capture: v }) }) }),
            h(MeaningRow, { cloud, mem, onToggle: (v) => setMem({ meaning: v }), refreshKey, refresh })),
          h('section', { className: 'kbmem-sec' }, h('h2', null, 'Lessons learned', h('small', null, 'about your work')),
            h(SettingRow, { label: 'Lessons learned', desc: 'Allow agents to save a lesson when an expectation was contradicted.', locked: lesUnavailable, why: lesUnavailable ? 'The lessons plugin is not available.' : null,
              control: h(YesNo, { name: 'Lessons learned', value: les !== null && les.lessons === true, onChange: (v) => setLes({ lessons: v }) }) }),
            h(SettingRow, { label: 'Lessons system context', desc: 'Include saved lessons in the system context.', locked: lesUnavailable || (les !== null && les.lessons !== true),
              why: les !== null && les.lessons !== true ? 'Turn on Lessons learned first.' : null,
              control: h(YesNo, { name: 'Lessons system context', value: les !== null && les.context === true && les.lessons === true, onChange: (v) => setLes({ context: v }) }) }),
            h(SettingRow, { label: 'Share lessons with your team', desc: 'Members can propose a lesson; an admin validates it before your team’s agents use it.', locked: true, chip: PlanChip('Team · soon'),
              why: 'Team lessons are not built yet.', control: h(YesNo, { name: 'Share lessons with your team', value: false, onChange: () => {} }) })))
      }

      function Page() {
        const [view, setView] = useState('main')
        const [tab, setTab] = useState('memories')
        const [refreshKey, setRefreshKey] = useState(0)
        const [toast, setToast] = useState(null)
        const timer = useRef(null)
        const bump = useCallback(() => setRefreshKey((k) => k + 1), [])
        const status = useStatus(refreshKey)
        const settings = useSettings(refreshKey)
        const notify = useCallback((message, undo) => {
          setToast({ message, undo })
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => setToast(null), 5000)
        }, [])
        useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
        return h('div', { className: 'kbmem-page', 'data-kbmem': view },
          view === 'options'
            ? h(OptionsView, { status, settings, back: () => setView('main'), notify, refresh: bump, refreshKey })
            : h(MainView, { tab, setTab, status, settings, openOptions: () => setView('options'), notify, bump, refreshKey }),
          toast !== null ? h('div', { className: 'kbmem-toast', role: 'status', 'aria-live': 'polite' }, toast.message,
            toast.undo ? h('button', { type: 'button', 'data-act': 'undo', onClick: () => { const u = toast.undo; setToast(null); u() } }, 'Undo') : null) : null)
      }

      // ═══════════════════════════════════════════════════════════════
      // 6. MOUNTING
      // ═══════════════════════════════════════════════════════════════
      const styles = (() => {
        const insert = (cssText) => {
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/kybernos-memory'
          tag.textContent = cssText
          document.head.append(tag)
          return () => { tag.remove() }
        }
        return { insert }
      })()

      // The export contract of a cordis entry: the services the ctx MUST expose. Without it the
      // entry stays "loading" and never activates.
      return {
        inject: ['slots'],
        // Pure pieces and the page, exposed for test-client.mjs and the live check.
        __test: { onEscape, meaningWhy, closenessLabel, wordsLabel, readMode, writeMode, planOf, ageLabel, pagerPages, listUrl, activeFilters, defaultFilters, friendlyError, captureWords, api, GROUPS, Page, css, PAGE_SIZES },
        apply(ctx) {
          if (ctx === null || ctx === undefined || ctx.slots === null || ctx.slots === undefined) return
          ctx.effect(() => styles.insert(css), 'kybernos-memory: styles')
          ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
            { name: 'settings.section', id: 'kybernos-memory', order: 3, label: 'Memory & Lessons' },
            (props) => h(Page, props))), 'kybernos-memory: memory & lessons settings section')
        },
      }
    } catch (kbMemBootError) {
      try { console.error('[kybernos-memory] load failed — plugin disabled, GUI preserved', kbMemBootError) } catch (e2) { /* console unavailable */ }
      return { apply() { /* plugin disabled after a load error */ } }
    }
  },
})
