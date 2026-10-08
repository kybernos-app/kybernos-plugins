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
// What is not offered is not drawn as if it were: the map is for memories only and needs Search by
// meaning (the Map view says what is missing), and the list search is by words.
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

      // ── The map (memories placed by meaning; the host works the positions out, the page draws and lets you look around) ──
      const MAP_W = 1000, MAP_H = 540, MAP_MIN_W = 150
      const MAP_FIT = [0, 0, MAP_W, MAP_H]
      const LAYOUT_KEY = 'kbmem.layout'
      const readLayout = () => { try { return window.localStorage.getItem(LAYOUT_KEY) === 'map' ? 'map' : 'list' } catch (e) { return 'list' } }
      const writeLayout = (v) => { try { window.localStorage.setItem(LAYOUT_KEY, v) } catch (e) { /* private window */ } }
      const plain = (t) => String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      /** « Light up what matches »: the memory has every word typed (accents and case ignored). Nothing typed matches everything. */
      const mapMatches = (node, q) => {
        const words = plain(q).split(/\s+/).filter((w) => w !== '')
        if (words.length === 0) return true
        const hay = plain(node.content)
        return words.every((w) => hay.indexOf(w) >= 0)
      }
      /** A view box [x, y, w, h] kept inside the drawing. */
      const mapClamp = (vb) => [Math.min(MAP_W - vb[2], Math.max(0, vb[0])), Math.min(MAP_H - vb[3], Math.max(0, vb[1])), vb[2], vb[3]]
      /** The view after zooming by `factor` (above 1 zooms in) around the point (px, py), given as fractions of the view; never wider than the drawing nor narrower than MAP_MIN_W. */
      const mapZoom = (vb, factor, px, py) => {
        const w = Math.min(MAP_W, Math.max(MAP_MIN_W, vb[2] / factor))
        const h = w * MAP_H / MAP_W
        const fx = px === undefined ? 0.5 : px, fy = py === undefined ? 0.5 : py
        return mapClamp([vb[0] + (vb[2] - w) * fx, vb[1] + (vb[3] - h) * fy, w, h])
      }
      const mapPan = (vb, dx, dy) => mapClamp([vb[0] + dx, vb[1] + dy, vb[2], vb[3]])
      /**
       * Where the names of the clusters are written (in the drawing's units): above the highest dot of the cluster, else below the lowest one, else
       * the nearest free spot within reach; never over another name, over a dot, the search field, the legend or the zoom buttons. A name that finds no
       * room is left out. Returns { clusterId: { x, y } }.
       */
      const mapLabelSpots = (nodes, clusters) => {
        const boxes = [[0, 0, 290, 58], [0, MAP_H - 50, 400, MAP_H], [MAP_W - 70, MAP_H - 150, MAP_W, MAP_H]]
        const dots = nodes.map((n) => [n.x * MAP_W - 9, n.y * MAP_H - 9, n.x * MAP_W + 9, n.y * MAP_H + 9])
        const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3]
        const free = (box) => box[0] >= 6 && box[2] <= MAP_W - 6 && box[1] >= 4 && box[3] <= MAP_H - 4 && !boxes.some((o) => hit(box, o)) && !dots.some((o) => hit(box, o))
        const out = {}
        clusters.slice().sort((a, b) => b.size - a.size || a.id - b.id).forEach((c) => {
          const own = nodes.filter((n) => n.cl === c.id)
          if (own.length === 0 || c.label === '') return
          const cx = own.reduce((a, n) => a + n.x, 0) / own.length * MAP_W, cy = own.reduce((a, n) => a + n.y, 0) / own.length * MAP_H
          const top = Math.min.apply(null, own.map((n) => n.y)) * MAP_H, bottom = Math.max.apply(null, own.map((n) => n.y)) * MAP_H
          const w = c.label.length * 8.4 + 10
          const boxAt = (x, y) => [x - w / 2, y - 12, x + w / 2, y + 4]
          const tries = [[cx, top - 16], [cx, bottom + 24], [cx - w * 0.6, top - 16], [cx + w * 0.6, top - 16], [cx - w * 0.6, bottom + 24], [cx + w * 0.6, bottom + 24], [cx, top - 34], [cx, bottom + 42]]
          let spot = tries.find(([x, y]) => free(boxAt(x, y)))
          if (spot === undefined) {
            // the nearest free place to the middle of the cluster, within reach
            let best = null
            for (let y = 14; y <= MAP_H - 8; y += 8) for (let x = w / 2 + 6; x <= MAP_W - w / 2 - 6; x += 12) {
              const dist = Math.hypot(x - cx, y - cy)
              if (dist <= 150 && (best === null || dist < best[2]) && free(boxAt(x, y))) best = [x, y, dist]
            }
            if (best !== null) spot = [best[0], best[1]]
          }
          if (spot === undefined) return
          boxes.push(boxAt(spot[0], spot[1]))
          out[c.id] = { x: spot[0], y: spot[1] }
        })
        return out
      }
      /** What the map says when it cannot be drawn: [title, what it means and what to do]. */
      const mapWords = (code, tier) => {
        const c = String(code === undefined || code === null ? '' : code)
        if (c === 'sens_desactive') return ['The map needs Search by meaning', 'The map places each memory by what it means, with the same embeddings as Search by meaning, which is off. Turned on, it sends the text of the memories drawn (150 at most) to the Kybernos embedding model, and nothing else.']
        if (c === 'offre_requise') return ['The map needs the ' + (TIER_NAME[tier] || 'Solo') + ' plan', 'It uses the embeddings model, which your plan does not include. The list and the search by words keep working.']
        if (c === 'credits_epuises') return ['You are out of credits', 'Placing the memories uses the embeddings model, billed to your account like chat.']
        if (c === 'non connecte') return ['Not connected', 'Memories live in your Kybernos Cloud account: connect it to see the map.']
        if (c === 'indisponible') return ['The map needs a restart', 'The Kybernos Cloud plugin was updated: restart DSH to see the map.']
        if (c === 'embedding_invalide') return ['The map could not be drawn', 'The embeddings service sent back something unexpected. Try again in a moment.']
        return ['The map could not be drawn', friendlyError(c)]
      }

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
        if (c === 'doublon') return 'Your team already has that lesson, waiting or approved.'
        if (c === 'equipe_pleine') return 'Your team already has the most approved lessons it can hold (200).'
        if (c === 'trop_de_propositions') return 'You already have 20 proposals waiting: wait for a review first.'
        if (c === 'admin_requis') return 'Only an owner or an admin of the team can do that.'
        if (c === 'deja_decidee') return 'Someone already decided on this one.'
        if (c === 'non_approuvee') return 'Only an approved lesson can be retired.'
        if (c === 'espace_introuvable') return 'You are not a member of that team workspace any more.'
        if (c === 'offre_requise') return 'Team lessons need a Team plan.'
        if (c === 'aucun_espace') return 'No team workspace is selected.'
        if (c === 'partage_desactive') return 'Sharing lessons with your team is switched off in Options.'
        if (c === 'texte_invalide') return 'Write the lesson first (500 characters at most).'
        if (c === 'requete_invalide') return 'That request was refused as invalid.'
        if (c === 'a_change') return 'It changed since the scan: look again.'
        if (c === 'groupe_inconnu') return 'That suggestion is out of date: look again.'
        if (c === 'garde_invalide') return 'That item is not part of the suggestion: look again.'
        if (c === 'epingle_protege') return 'A pinned memory is never removed: keep that one.'
        if (c === 'trop_de_suppressions') return 'That removes too many at once (50 at most).'
        if (c === 'kyber_plein') return 'That kyber already holds 50 lessons: delete some, then undo.'
        if (c === 'archive_perimee') return 'Too old to undo (30 days).'
        if (c === 'deja_annule') return 'Already undone.'
        if (c === 'aucun_scan') return 'Look first: nothing has been scanned yet.'
        if (c === 'deja_en_cours') return 'A tidy-up is already running.'
        if (c === 'pas_de_modele_detude') return 'No Study model is set: pick one in Kybernos Settings.'
        if (c === 'llm_indisponible') return 'The model service is not available right now.'
        if (c === 'delai_depasse') return 'The Study model did not answer in time.'
        if (c === 'modele_en_erreur') return 'The Study model could not be reached.'
        if (c === 'valeur_invalide' || c === 'cle_inconnue') return 'That setting was refused.'
        if (c.indexOf('refus_') === 0) return 'The server refused the request (' + c.slice(6) + ').'
        if (c === 'erreur interne' || c === 'internal error') return 'Something failed inside the plugin.'
        return c === '' ? 'Something went wrong.' : 'Something went wrong (' + c + ').'
      }

      // ── Tidy up: the pure pieces ─────────────────────────────────────────────
      // Near-duplicates are found on this machine (kybernos-cloud and kybernos-memory each scan their own side) and applied
      // by the hosts; this file only chooses and asks. `mem` = memories (account), `les` = lessons (local files).
      const TIDY_MAX_REMOVALS = 50
      const TIDY_SOURCES = {
        mem: { noun: 'memories', one: 'memory', many: 'memories', max: 2000, base: '/kybernos-cloud/memory/tidy' },
        les: { noun: 'lessons', one: 'lesson', many: 'lessons', max: 500, base: '/kybernos-memory/tidy' },
      }
      const plural = (n, word, many) => String(n) + ' ' + (n === 1 ? word : (many === undefined ? word + 's' : many))

      /** « just now », « 5 minutes ago », « 2 hours ago », « 3 days ago ». */
      const whenLabel = (iso, now) => {
        const t = Date.parse(iso)
        if (!Number.isFinite(t)) return ''
        const m = Math.max(0, Math.round(((now === undefined ? Date.now() : now) - t) / 60000))
        if (m < 1) return 'just now'
        if (m < 60) return plural(m, 'minute') + ' ago'
        if (m < 1440) return plural(Math.round(m / 60), 'hour') + ' ago'
        return plural(Math.round(m / 1440), 'day') + ' ago'
      }

      /** How many items a group removes: all but the kept one. */
      const groupRemovals = (g) => Math.max(0, g.items.length - 1)

      /** Requests of at most `max` removals each (the host refuses more in one go). A group that is alone over the limit goes alone, and the host says no. */
      const tidyChunks = (groups, max) => {
        const out = []
        let cur = []
        let n = 0
        for (const g of groups) {
          const r = groupRemovals(g)
          if (cur.length > 0 && n + r > max) { out.push(cur); cur = []; n = 0 }
          cur.push(g)
          n += r
        }
        if (cur.length > 0) out.push(cur)
        return out
      }

      const TIDY_SHOWN = 4

      /** The items a card draws: the first few, plus the kept one if it is further down; all of them once expanded. */
      const visibleItems = (g, keepId, expanded) => (expanded || g.items.length <= TIDY_SHOWN + 1 ? g.items : g.items.filter((i, n) => n < TIDY_SHOWN || i.id === keepId))

      /** The kept item of a group: the user's pick, else the one the scan proposed. */
      const keeperOf = (g, choices) => {
        const c = choices[g.id]
        return c !== undefined && c.keep !== undefined && g.items.some((i) => i.id === c.keep) ? c.keep : g.keeperId
      }

      /** The request body for some groups: only what differs from the proposal is sent (`keep`, `edit`). */
      const tidyBody = (groups, choices) => ({
        confirm: true,
        groups: groups.map((g) => {
          const c = choices[g.id] || {}
          const out = { id: g.id }
          const keep = keeperOf(g, choices)
          if (keep !== g.keeperId) out.keep = keep
          if (typeof c.edit === 'string' && c.edit.trim() !== '') out.edit = c.edit
          return out
        }),
      })

      /** A scan response (or a stored view) → what the page keeps; anything that is not a view is `null`. */
      const asTidyView = (r) => (r !== null && typeof r === 'object' && r.ok === true && Array.isArray(r.groups) ? r : null)
      const tidySaves = (t) => (t.mem === null ? 0 : t.mem.saves) + (t.les === null ? 0 : t.les.saves)
      /** The banner is hidden for one scan only: a new scan shows it again. */
      const scanKey = (t) => (t.mem === null ? '' : String(t.mem.scannedAt)) + '|' + (t.les === null ? '' : String(t.les.scannedAt))
      const TIDY_HIDDEN_KEY = 'kbmem.tidyHidden'
      const readHidden = () => { try { return window.localStorage.getItem(TIDY_HIDDEN_KEY) || '' } catch (e) { return '' } }
      const writeHidden = (v) => { try { window.localStorage.setItem(TIDY_HIDDEN_KEY, v) } catch (e) { /* private window */ } }

      /** One log line, in words: « Merged 3 memories into 1 ». */
      const logWho = (l) => (l.by === 'auto' ? 'Automatic · 80 %+' : 'You')
      const logWords = (src, l) => 'Merged ' + plural(l.removed + 1, TIDY_SOURCES[src].one, TIDY_SOURCES[src].many) + ' into 1' + (l.kyber ? ' · ' + l.kyber : '') + (l.partial ? ' (partly)' : '')

      const TIDY_MODES = [['auto', 'Merge close matches by itself'], ['ask', 'Ask me first']]
      const TIDY_SCHEDULES = [['off', 'Off'], ['start', 'When DSH starts'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['n50', 'Every 50 new']]
      const TIDY_DEFAULT_SETTINGS = { mode: 'auto', schedule: 'weekly', brain: false }

      /** « in 3 hours », « in 2 days » (a date ahead). */
      const whenAhead = (iso, now) => {
        const t = Date.parse(iso)
        if (!Number.isFinite(t)) return ''
        const m = Math.round((t - (now === undefined ? Date.now() : now)) / 60000)
        if (m < 1) return 'now'
        if (m < 60) return 'in ' + plural(m, 'minute')
        if (m < 1440) return 'in ' + plural(Math.round(m / 60), 'hour')
        return 'in ' + plural(Math.round(m / 1440), 'day')
      }

      /** The settings the page shows: the lessons host's (it never needs the cloud), else the memories'. Both are written together. */
      const tidySettingsOf = (t) => (t.les !== null && t.les.settings !== undefined ? t.les.settings : (t.mem !== null && t.mem.settings !== undefined ? t.mem.settings : TIDY_DEFAULT_SETTINGS))

      /** What the page says about the next automatic run, from the host's `next`. */
      const nextWords = (n, now) => {
        if (n === null || n === undefined || n.kind === 'off') return 'Not scheduled.'
        if (n.kind === 'start') return 'At the next start of DSH, if the last run is over 3 days old.'
        if (n.kind === 'at') return 'Next: ' + whenAhead(n.at, now) + ', if DSH is running.'
        if (n.kind === 'now') return 'Next: at the next check, if DSH is running.'
        if (n.kind === 'count') return n.remaining === null ? 'Next: after 50 new items.' : (n.remaining === 0 ? 'Next: at the next check (50 new items are in).' : 'Next: after ' + plural(n.remaining, 'more new item') + '.')
        return ''
      }
      const tidyNextOf = (t) => (t.les !== null && t.les.next !== undefined ? t.les.next : (t.mem !== null && t.mem.next !== undefined ? t.mem.next : null))

      /** The latest run of the two hosts, summed when both ran together (a manual run or the same schedule tick). */
      const tidyLast = (t) => {
        const lasts = [t.mem, t.les].filter((x) => x !== null && x.last !== null && x.last !== undefined).map((x) => x.last)
        if (lasts.length === 0) return null
        const newest = lasts.map((l) => Date.parse(l.at)).filter(Number.isFinite).sort((a, b) => b - a)[0]
        const near = lasts.filter((l) => newest - Date.parse(l.at) < 3600000)
        return { at: new Date(newest).toISOString(), trigger: near[0].trigger, autoGroups: near.reduce((n, l) => n + (l.autoGroups || 0), 0), autoRemoved: near.reduce((n, l) => n + (l.autoRemoved || 0), 0), found: near.reduce((n, l) => n + (l.found || 0), 0), brainAsked: near.reduce((n, l) => n + (l.brainAsked || 0), 0) }
      }
      const lastWords = (l, now) => (l === null ? 'Not run yet.' : 'Last run ' + whenLabel(l.at, now) + (l.trigger === 'schedule' ? ' (scheduled)' : '') + ': ' + (l.autoGroups > 0 ? 'merged ' + plural(l.autoGroups, 'group') + ' by itself' : 'nothing merged by itself') + (l.found - l.autoGroups > 0 ? ', ' + String(l.found - l.autoGroups) + ' left for you' : '') + '.')

      /**
       * A scheduled run that merged something while nobody was looking: the notice the page shows once, with the runs it can undo.
       * `null` when there is nothing to tell (no run, nothing merged, or the user pressed the button and saw the result).
       */
      const TIDY_RAN_KEY = 'kbmem.tidyRanSeen'
      const readRanSeen = () => { try { return window.localStorage.getItem(TIDY_RAN_KEY) || '' } catch (e) { return '' } }
      const writeRanSeen = (v) => { try { window.localStorage.setItem(TIDY_RAN_KEY, v) } catch (e) { /* private window */ } }
      const tidyRanNotice = (t, seen) => {
        const last = tidyLast(t)
        if (last === null || last.trigger !== 'schedule' || !(last.autoGroups > 0) || seen === last.at) return null
        const from = Date.parse(last.at) - 120000
        const entries = tidyLog(t).filter((l) => l.by === 'auto' && l.canUndo === true && Date.parse(l.at) >= from)
        return { at: last.at, groups: last.autoGroups, removed: last.autoRemoved, entries }
      }

      // ── Team lessons: the pure pieces ───────────────────────────────────────────────────────────────────
      const TEAM_LOCKED = { offre_requise: ['Team plan', 'Team lessons need a Team workspace: members propose what they learned, an owner or admin approves it, and every agent of the team reads it.'],
        aucun_espace: ['No team workspace', 'Select a team workspace in the sidebar to read and propose its lessons.'], non_connecte: ['Sign in', 'Connect your Kybernos account to use team lessons.'],
        hote_ancien: ['Restart DSH', 'The Kybernos Cloud plugin was updated: restart DSH to use team lessons.'], chargement: ['Checking…', 'Looking for your team workspace…'] }
      const teamLockedWords = (reason) => TEAM_LOCKED[reason] || ['Unavailable', 'Team lessons are not available right now.']
      /** Why Team is not offered, from what `useTeam` knows: the host's own answer when there is one, else what its silence means (a host that predates the routes answers 404). */
      const teamReasonOf = (team) => {
        if (team === undefined || team === null) return 'indisponible'
        if (team.ok === true && team.team !== null && team.team !== undefined) return team.team.reason === null || team.team.reason === undefined ? 'indisponible' : team.team.reason
        if (team.loaded !== true) return 'chargement'
        if (team.error === 'non connecte') return 'non_connecte'
        return team.error === 'indisponible' ? 'hote_ancien' : 'indisponible'
      }
      const isTeamAdmin = (role) => role === 'owner' || role === 'admin'
      const minutesSince = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.round(((now === undefined ? Date.now() : now) - t) / 60000)) : null }
      /** « Waiting for review », « Approved »… with the chip tone the page uses. */
      const teamStatusChip = (l) => ({ proposed: ['Waiting for review', 'warn'], approved: ['Approved', 'ok'], rejected: ['Rejected', ''], retired: ['Retired', ''] }[l.status] || [String(l.status), ''])
      /** The search of the team list: every word typed is somewhere in the text, the tags, the kyber or a name (the list is at most 200 long). */
      const teamMatches = (l, q) => {
        const words = String(q === undefined || q === null ? '' : q).toLowerCase().split(/\s+/).filter((w) => w !== '')
        if (words.length === 0) return true
        const hay = (l.text + ' ' + l.tags.join(' ') + ' ' + (l.kyber || 'general') + ' ' + (l.proposedName || '') + ' ' + (l.reviewedName || '')).toLowerCase()
        return words.every((w) => hay.indexOf(w) >= 0)
      }
      /** The line under a team lesson: who proposed it, who approved it, and when. */
      const teamMeta = (l, now) => {
        const out = []
        if (l.proposedName !== null) out.push('Proposed by ' + l.proposedName)
        if (l.status === 'approved' && l.reviewedName !== null) out.push('approved by ' + l.reviewedName)
        if (l.status === 'rejected' && l.reviewedName !== null) out.push('rejected by ' + l.reviewedName)
        const age = ageLabel(minutesSince(l.updatedAt === null ? l.createdAt : l.updatedAt, now))
        if (age !== '') out.push(age === 'now' ? 'just now' : age + ' ago')
        return out
      }

      /** The Study model, as the page needs it: its name (the same file for both hosts), whether a model service exists, and how many unclear pairs wait. */
      const tidyBrain = (t) => {
        const views = [t.mem, t.les].filter((x) => x !== null && x.brain !== undefined)
        return { model: views.map((x) => x.brain.model).find((m) => typeof m === 'string' && m !== '') || '', llm: views.some((x) => x.brain.llm === true), unclear: views.reduce((n, x) => n + (Number.isFinite(x.unclear) ? x.unclear : 0), 0) }
      }

      /** Both logs, newest first, each line tagged with its side. */
      const tidyLog = (t) => []
        .concat(t.mem === null ? [] : t.mem.log.map((l) => Object.assign({ src: 'mem' }, l)))
        .concat(t.les === null ? [] : t.les.log.map((l) => Object.assign({ src: 'les' }, l)))
        .sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))

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
  --m-acc-bg:var(--kb-accent-bg,rgba(122,170,255,.14));--m-del-bg:var(--kb-del-bg,rgba(242,90,90,.12));--m-primary:var(--kb-primary,#f9fafb);--m-primary-ink:var(--kb-primary-ink,#353638);--m-r-md:var(--dsw-radius-md,12px);--m-r-sm:var(--dsw-radius-sm,8px);--m-r-lg:var(--dsw-radius-lg,16px);
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
.kbmem-chip.acc{color:var(--m-acc);background:var(--m-acc-bg);border-color:transparent}
.kbmem-banner{display:flex;gap:12px;align-items:center;margin-bottom:14px;padding:12px 14px;border-radius:var(--m-r-md);background:var(--m-acc-bg)}
.kbmem-banner>.kbmem-ico{width:18px;height:18px;color:var(--m-acc)}
.kbmem-x{width:26px;height:26px;border-radius:999px;display:inline-grid;place-items:center;color:var(--m-muted)}.kbmem-x:hover{background:var(--m-hover)}
.kbmem-btn.sm{height:26px;padding:0 11px;font-size:12px}
.kbmem-sum{display:flex;gap:16px;flex-wrap:wrap;align-items:center;margin:4px 0 14px;font-size:13px;color:var(--m-ink2)}.kbmem-sum b{color:var(--m-ink)}
.kbmem-grp{border:1px solid var(--m-line2);border-radius:14px;margin-bottom:12px;overflow:hidden;background:var(--m-surf)}
.kbmem-grp>header{display:flex;gap:10px;align-items:center;padding:12px 14px;flex-wrap:wrap}.kbmem-grp>header .t{font-weight:600}
.kbmem-grp .items{padding:0 14px 2px}
.kbmem-it{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:10px;margin-bottom:6px;font-size:13px}
.kbmem-it.del{background:var(--m-del-bg);color:var(--m-ink2)}.kbmem-it.del .kbmem-itx{text-decoration:line-through;text-decoration-color:var(--m-danger);text-decoration-thickness:1px}
.kbmem-it.new{background:var(--m-ok-bg)}
.kbmem-itx{flex:1;min-width:0;overflow-wrap:anywhere}
.kbmem-it.del .kbmem-itx{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.kbmem-was{display:block;margin-top:2px;font-size:11.5px;color:var(--m-cap);overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.kbmem-why{display:flex;gap:8px;align-items:flex-start;padding:0 14px 8px;font-size:12.5px;color:var(--m-muted)}.kbmem-why .kbmem-ico{margin-top:3px;color:var(--m-acc)}
.kbmem-chip .kbmem-ico{width:11px;height:11px}
.kbmem-autobar{display:flex;gap:12px;align-items:center;margin:0 0 14px;padding:12px 14px;border-radius:var(--m-r-md);background:var(--m-ok-bg);font-size:13px;flex-wrap:wrap}.kbmem-autobar .kbmem-ico{color:var(--m-ok);width:18px;height:18px}
.kbmem-tmeta{display:block;margin-top:2px;font-size:12px;color:var(--m-cap)}.kbmem-why-r{color:var(--m-muted)}
.kbmem-tsheet-text{padding:10px 12px;border-radius:var(--m-r-md);background:var(--m-surf);overflow-wrap:anywhere}
.kbmem-more{padding:2px 12px 8px;font-size:12px;color:var(--m-muted)}.kbmem-more button{color:var(--m-acc);font-weight:600}
.kbmem-it textarea{width:100%;min-height:72px;border-radius:8px;border:1px solid var(--m-line2);background:var(--m-surf2);color:var(--m-ink);padding:8px;resize:vertical;font:inherit}
.kbmem-im{display:flex;gap:8px;align-items:center;font-size:11px;color:var(--m-cap);white-space:nowrap;padding-inline-start:6px}.kbmem-im .kbmem-ico{width:12px;height:12px}
.kbmem-pick{flex:none;width:16px;height:16px;margin-top:3px;border-radius:50%;border:1.5px solid var(--m-line3)}.kbmem-pick.on{border-color:var(--m-acc);background:radial-gradient(var(--m-acc) 0 4px,transparent 5px)}.kbmem-pick[disabled]{opacity:.4;pointer-events:none}
.kbmem-gnote{padding:0 14px 10px;font-size:12px;color:var(--m-cap)}
.kbmem-gacts{display:flex;gap:8px;align-items:center;padding:10px 14px;border-top:1px solid var(--m-line);flex-wrap:wrap}
.kbmem-grp.done .items,.kbmem-grp.done .kbmem-gnote{display:none}.kbmem-grp.done{opacity:.8}
.kbmem-stat{display:flex;gap:6px;align-items:center;font-size:12.5px;color:var(--m-muted)}.kbmem-stat.ok{color:var(--m-ok)}.kbmem-stat.err{color:var(--m-danger)}
.kbmem-foot{position:sticky;bottom:0;margin-top:18px;display:flex;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--m-line2);border-radius:14px;background:var(--m-surf2);flex-wrap:wrap}
.kbmem-run{padding:14px 0;border-bottom:1px solid var(--m-line);display:flex;gap:14px;align-items:center;max-width:760px}
.kbmem-run .when{width:120px;color:var(--m-cap);font-size:12.5px;flex:none}
.kbmem-mapwrap{display:block}
.kbmem-map{position:relative;width:100%;aspect-ratio:1000/540;border:1px solid var(--m-line2);border-radius:14px;overflow:hidden;background:var(--m-surf)}
.kbmem-map>svg{display:block;width:100%;height:100%;touch-action:none;user-select:none}
.kbmem-bg{fill:transparent;cursor:grab}.kbmem-map.drag .kbmem-bg{cursor:grabbing}
.kbmem-ed{stroke:var(--m-line3);stroke-width:1;vector-effect:non-scaling-stroke;pointer-events:none}
.kbmem-nd{cursor:pointer;outline:none}.kbmem-nd .kbmem-dot{fill:var(--m-cap)}.kbmem-nd.fact .kbmem-dot{fill:var(--m-acc)}.kbmem-nd.preference .kbmem-dot{fill:var(--m-ok)}.kbmem-nd.policy .kbmem-dot{fill:var(--m-warn)}
.kbmem-ring{fill:none;stroke:var(--m-ok);stroke-width:1.5;vector-effect:non-scaling-stroke;opacity:.85}
.kbmem-nd.dim{opacity:.2}.kbmem-nd.sel .kbmem-dot,.kbmem-nd:focus-visible .kbmem-dot{stroke:var(--m-ink);stroke-width:2;vector-effect:non-scaling-stroke}
.kbmem-cl{fill:var(--m-cap);font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;pointer-events:none}
.kbmem-maphud{position:absolute;inset-inline-start:12px;top:12px;display:flex;gap:10px;align-items:center;max-width:calc(100% - 24px)}
.kbmem-maphud .kbmem-field{width:230px;max-width:100%;height:32px;background:var(--m-surf2)}
.kbmem-legend{position:absolute;inset-inline-start:12px;bottom:12px;display:flex;gap:12px;flex-wrap:wrap;max-width:calc(100% - 70px);padding:6px 10px;border-radius:10px;background:var(--m-surf2);font-size:11.5px;color:var(--m-muted)}
.kbmem-legend span{display:inline-flex;gap:6px;align-items:center}.kbmem-legend .kbmem-kd{margin:0}
.kbmem-lring{width:10px;height:10px;border-radius:50%;border:1.5px solid var(--m-ok);display:inline-block}
.kbmem-zoom{position:absolute;inset-inline-end:12px;bottom:12px;display:grid;gap:6px}
.kbmem-zoom button{width:32px;height:32px;border-radius:50%;border:1px solid var(--m-line2);background:var(--m-surf2);color:var(--m-ink2);display:grid;place-items:center;cursor:pointer;padding:0}.kbmem-zoom button:hover{background:var(--m-hover)}
.kbmem-tip{position:absolute;max-width:280px;padding:8px 10px;border-radius:10px;background:var(--m-toast);color:var(--m-ink);font-size:12px;line-height:1.4;pointer-events:none;transform:translate(-50%,calc(-100% - 12px));z-index:3}
.kbmem-mcard{position:absolute;inset-inline-end:12px;top:12px;width:min(320px,calc(100% - 24px));display:grid;gap:8px;padding:12px 14px;border:1px solid var(--m-line2);border-radius:14px;background:var(--m-surf2);box-shadow:0 8px 24px rgba(0,0,0,.28);z-index:4}
.kbmem-mhd{display:flex;gap:8px;align-items:center}.kbmem-mtx{font-size:13px;line-height:1.5;color:var(--m-ink);max-height:180px;overflow:auto;word-break:break-word}
.kbmem-mmt{display:flex;gap:10px;align-items:center;font-size:11.5px;color:var(--m-cap)}.kbmem-mmt .kbmem-ico{width:12px;height:12px}
.kbmem-empty .kbmem-acts{flex-wrap:wrap;justify-content:center}
@media (max-width:720px){.kbmem-foot .kbmem-grow{flex-basis:100%}.kbmem-run{flex-wrap:wrap}.kbmem-run .when{width:auto}.kbmem-it{flex-wrap:wrap}}
`

      // ═══════════════════════════════════════════════════════════════
      // 3. SMALL COMPONENTS
      // ═══════════════════════════════════════════════════════════════
      const ICONS = {
        brain: '<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5c0 .4.1.8.2 1.1A3.5 3.5 0 0 0 4 10.8c0 1 .5 2 1.2 2.6A3.5 3.5 0 0 0 7 19a3 3 0 0 0 5-1V4.5A1.5 1.5 0 0 0 9.5 3z"/><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5c0 .4-.1.8-.2 1.1A3.5 3.5 0 0 1 20 10.8c0 1-.5 2-1.2 2.6A3.5 3.5 0 0 1 17 19a3 3 0 0 1-5-1V4.5A1.5 1.5 0 0 1 14.5 3z"/>',
        pin: '<path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/>', search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>', plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="m5 12 5 5 9-10"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
        cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/>', lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
        alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18v.5"/>', shield: '<path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/>',
        list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.5M4 12h.5M4 18h.5"/>', map: '<circle cx="6" cy="7" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="17" r="2"/><path d="M7.7 8.2l3 7M16.5 7.5l-3.5 8"/>',
        filter: '<path d="M4 6h16M7 12h10M10 18h4"/>', left: '<path d="m15 6-6 6 6 6"/>', right: '<path d="m9 6 6 6-6 6"/>',
        gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
        broom: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
        inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>', share: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v5h14v-5"/>',
        zin: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4M11 8v6M8 11h6"/>', zout: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4M8 11h6"/>', fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
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
        const looked = useRef(null)
        useEffect(() => {
          const mine = ++seq.current
          setD((old) => Object.assign({}, old, { loading: true }))
          // The page opening, or a refresh / a write (the key changes), reads the server again; paging and filters keep the host's short cache.
          const again = looked.current !== refreshKey
          looked.current = refreshKey
          api(tab === 'memories' && again ? url + '&fresh=1' : url).then((r) => {
            if (mine !== seq.current) return
            if (r.ok === true) setD({ loading: false, ok: true, error: null, total: r.total, items: r.items, counts: r.counts, extra: r })
            else setD({ loading: false, ok: false, error: r.error === undefined ? 'indisponible' : r.error, total: 0, items: [], counts: null, extra: r })
          })
        }, [url, refreshKey])
        return d
      }

      /**
       * The two tidy-up views (memories: the account, lessons: this machine). Each is `null` when its host cannot be reached
       * (a host that predates the feature answers 404 until DSH restarts). `adopt` puts a fresh scan in place without a round trip.
       */
      const useTidy = (refreshKey) => {
        const [t, setT] = useState({ loaded: false, mem: null, les: null, memError: null, lesError: null })
        const seq = useRef(0)
        useEffect(() => {
          const mine = ++seq.current
          Promise.all([api(TIDY_SOURCES.mem.base), api(TIDY_SOURCES.les.base)]).then(([m, l]) => {
            if (mine !== seq.current) return
            setT({ loaded: true, mem: asTidyView(m), les: asTidyView(l), memError: asTidyView(m) === null ? (m.error || 'indisponible') : null, lesError: asTidyView(l) === null ? (l.error || 'indisponible') : null })
          })
        }, [refreshKey])
        const adopt = useCallback((m, l) => {
          seq.current += 1
          setT({ loaded: true, mem: asTidyView(m), les: asTidyView(l), memError: asTidyView(m) === null ? (m.error || 'indisponible') : null, lesError: asTidyView(l) === null ? (l.error || 'indisponible') : null })
        }, [])
        return [t, adopt]
      }

      /** Team lessons: is the feature there for this account, which workspace, which role, how many wait. `ok` false when the plugin predates it. */
      const useTeam = (refreshKey) => {
        const [t, setT] = useState({ loaded: false, ok: false, connected: false, team: null, settings: { use: true, share: true } })
        useEffect(() => {
          let live = true
          api('/kybernos-cloud/team/status').then((r) => {
            if (!live) return
            setT(r.ok === true && r.team !== undefined ? { loaded: true, ok: true, connected: true, team: r.team, settings: r.settings === undefined ? { use: true, share: true } : r.settings }
              : { loaded: true, ok: false, connected: r.connected === true, team: null, settings: { use: true, share: true }, error: r.error === undefined ? 'indisponible' : r.error })
          })
          return () => { live = false }
        }, [refreshKey])
        return t
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
              return h('button', { key: g.key + v, type: 'button', role: 'menuitemradio', 'aria-checked': f[g.key] === v, 'data-g': g.key, 'data-v': v,
                onClick: () => onSet(g.key, v) },
                h('span', { className: 'kbmem-ck' }, f[g.key] === v ? Ico('check') : null), l)
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
      const Sheet = ({ sheet, onClose, onDone, notify, onPropose }) => {
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
            !mem && !isNew && typeof onPropose === 'function' ? h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'propose-team', disabled: busy, onClick: () => onPropose(item) }, Ico('share'), 'Propose to team') : null,
            h('span', { className: 'kbmem-grow' }),
            isNew ? null : (confirm
              ? h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'confirm-remove', disabled: busy, onClick: remove }, mem ? 'Confirm: forget' : 'Confirm: delete')
              : h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'remove', disabled: busy, onClick: () => setConfirm(true) }, Ico('trash'), mem ? 'Forget' : 'Delete'))),
          !mem && !isNew ? h('div', { className: 'kbmem-tiny' }, 'A deleted lesson goes to the kyber\'s lessons.archive.jsonl — it is not destroyed.') : null)
      }

      // ── Team lessons: the Team tab, proposing, reviewing ─────────────────────────────────────────────────
      const TeamRow = ({ l, mineView, onOpen }) => {
        const [label, tone] = teamStatusChip(l)
        return h('button', { type: 'button', className: 'kbmem-r', 'data-id': l.id, 'data-status': l.status, onClick: () => onOpen(l) },
          h('span', { className: 'kbmem-kd lesson' }),
          h('span', { className: 'kbmem-tx' }, l.text,
            h('span', { className: 'kbmem-tmeta' }, teamMeta(l).join(' · '),
              mineView && l.status === 'rejected' && l.reviewNote ? h('span', { className: 'kbmem-why-r', 'data-why': '1' }, ' · “' + l.reviewNote + '”') : null)),
          h('span', { className: 'kbmem-mt' },
            mineView || l.status !== 'approved' ? h('span', { className: 'kbmem-chip' + (tone === '' ? '' : ' ' + tone), 'data-chip': 'status' }, label) : null,
            h('span', { className: 'kbmem-chip' }, l.kyber === null ? 'general' : l.kyber)))
      }

      /** Propose a lesson to the team (a member), or add one (an owner or admin: approved at once). Prefilled from a personal lesson. */
      const ProposeSheet = ({ initial, kybers, admin, onClose, onDone, notify }) => {
        const [text, setText] = useState(initial.text)
        const [kyber, setKyber] = useState(initial.kyber === null || initial.kyber === undefined ? '' : initial.kyber)
        const [tags, setTags] = useState((initial.tags || []).join(', '))
        const [note, setNote] = useState('')
        const [busy, setBusy] = useState(false)
        const send = async () => {
          setBusy(true)
          const r = await api('/kybernos-cloud/team/lessons/add', { text, kyber, tags: tags.split(',').map((t) => t.trim()).filter((t) => t !== ''), note })
          if (r.ok !== true) { setBusy(false); notify(friendlyError(r.error)); return }
          onDone(admin ? 'Added: your team reads it from the next message' : 'Proposed: an owner or admin will review it')
        }
        const options = [{ id: '', label: 'General (every kyber)' }].concat(kybers.map((k) => ({ id: k.id, label: k.id })))
        if (kyber !== '' && !options.some((o) => o.id === kyber)) options.push({ id: kyber, label: kyber })
        return h('aside', { className: 'kbmem-sheet', role: 'dialog', 'aria-label': admin ? 'Add a team lesson' : 'Propose to your team' },
          h('h3', null, Ico('share'), admin ? 'Add a team lesson' : 'Propose to your team', h('span', { className: 'kbmem-grow' }), h('button', { type: 'button', className: 'kbmem-ib', 'aria-label': 'Close', onClick: onClose }, Ico('x'))),
          h('textarea', { 'aria-label': 'Lesson text', value: text, maxLength: 500, placeholder: 'One falsifiable sentence the whole team should know.', onChange: (e) => setText(e.target.value), disabled: busy }),
          h('div', { className: 'kbmem-f' }, h('span', null, 'Applies to'),
            h('select', { className: 'kbmem-sel', 'aria-label': 'Kyber', value: kyber, onChange: (e) => setKyber(e.target.value), disabled: busy }, options.map((o) => h('option', { key: o.id, value: o.id }, o.label)))),
          h('div', { className: 'kbmem-f' }, h('span', null, 'Tags (comma separated, 5 at most)'), h('input', { className: 'kbmem-sel', style: { width: '100%' }, 'aria-label': 'Tags', value: tags, onChange: (e) => setTags(e.target.value), disabled: busy })),
          admin ? null : h('div', { className: 'kbmem-f' }, h('span', null, 'Why it helps the team (optional)'), h('input', { className: 'kbmem-sel', style: { width: '100%' }, 'aria-label': 'Note', value: note, maxLength: 280, onChange: (e) => setNote(e.target.value), disabled: busy })),
          h('div', { className: 'kbmem-tiny' }, admin ? 'As an owner or admin your lesson is approved at once and read by every member from their next message.' : 'An owner or admin reads it first. Until then it stays yours and nobody else sees it.'),
          h('div', { className: 'kbmem-acts' },
            h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'team-send', disabled: busy || text.trim() === '', onClick: send }, admin ? 'Add to the team' : 'Propose'),
            h('button', { type: 'button', className: 'kbmem-btn ghost', onClick: onClose }, 'Cancel')))
      }

      /** One team lesson, opened: what it says, who stands behind it, and what the caller may do with it. */
      const TeamOpenSheet = ({ lesson, role, onClose, onDone, notify }) => {
        const [busy, setBusy] = useState(false)
        const [confirm, setConfirm] = useState(null)   // 'delete' | 'retire' | null
        const admin = isTeamAdmin(role)
        const [label, tone] = teamStatusChip(lesson)
        const canWithdraw = lesson.mine && lesson.status === 'proposed'
        const act = async (path, message) => {
          setBusy(true)
          const r = await api('/kybernos-cloud/team/lessons/' + path, { id: lesson.id })
          if (r.ok !== true) { setBusy(false); notify(friendlyError(r.error)); return }
          onDone(message)
        }
        return h('aside', { className: 'kbmem-sheet', role: 'dialog', 'aria-label': 'Team lesson' },
          h('h3', null, h('span', { className: 'kbmem-kd lesson', style: { margin: 0 } }), 'Team lesson', h('span', { className: 'kbmem-grow' }), h('button', { type: 'button', className: 'kbmem-ib', 'aria-label': 'Close', onClick: onClose }, Ico('x'))),
          h('div', { className: 'kbmem-tsheet-text', 'data-team': 'text' }, lesson.text),
          h('div', { className: 'kbmem-tiny' }, h('span', { className: 'kbmem-chip' + (tone === '' ? '' : ' ' + tone) }, label), ' ', h('span', { className: 'kbmem-chip' }, lesson.kyber === null ? 'general' : lesson.kyber), ' ', lesson.tags.map((t) => '#' + t).join(' ')),
          h('div', { className: 'kbmem-tiny' }, teamMeta(lesson).join(' · ')),
          lesson.note ? h('div', { className: 'kbmem-tiny' }, h('b', null, 'Note: '), lesson.note) : null,
          lesson.reviewNote ? h('div', { className: 'kbmem-tiny', 'data-team': 'reason' }, h('b', null, 'Reason: '), lesson.reviewNote) : null,
          canWithdraw || admin ? h('div', { className: 'kbmem-acts' },
            canWithdraw && !admin ? (confirm === 'delete'
              ? h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-confirm-delete', disabled: busy, onClick: () => act('delete', 'Proposal withdrawn') }, 'Confirm: withdraw')
              : h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-delete', onClick: () => setConfirm('delete') }, 'Withdraw my proposal')) : null,
            admin && lesson.status === 'approved' ? (confirm === 'retire'
              ? h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-confirm-retire', disabled: busy, onClick: () => act('retire', 'Retired: agents stop reading it') }, 'Confirm: retire')
              : h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'team-retire', onClick: () => setConfirm('retire') }, 'Retire')) : null,
            admin ? (confirm === 'delete'
              ? h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-confirm-delete', disabled: busy, onClick: () => act('delete', 'Deleted') }, 'Confirm: delete')
              : h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-delete', onClick: () => setConfirm('delete') }, 'Delete')) : null) : null,
          admin && lesson.status === 'approved' ? h('div', { className: 'kbmem-tiny' }, 'Retiring keeps it in the history; agents stop reading it. Deleting removes it for good.') : null)
      }

      /** The Team scope of the Lessons tab. */
      const TeamPane = ({ team, kybers, notify, bump, refreshKey, openReview }) => {
        const [view, setView] = useState('approved')
        const [q, setQ] = useState('')
        const [sheet, setSheet] = useState(null)
        const [d, setD] = useState({ loading: true, ok: false, error: null, lessons: [], role: null })
        const seq = useRef(0)
        const role = d.role !== null ? d.role : team.role
        const admin = isTeamAdmin(role)
        const canShare = team.shareOn !== false
        useEffect(() => {
          const mine = ++seq.current
          setD((old) => Object.assign({}, old, { loading: true }))
          api('/kybernos-cloud/team/lessons?view=' + view + '&limit=200').then((r) => {
            if (mine !== seq.current) return
            setD(r.ok === true ? { loading: false, ok: true, error: null, lessons: r.lessons, role: r.role, counts: r.counts } : { loading: false, ok: false, error: r.error === undefined ? 'indisponible' : r.error, lessons: [], role: null })
          })
        }, [view, refreshKey])
        useEffect(() => (sheet !== null ? onEscape(() => setSheet(null)) : undefined), [sheet !== null])
        const shown = d.lessons.filter((l) => teamMatches(l, q))
        const after = (message) => { setSheet(null); bump(); notify(message) }
        const pending = team.counts === undefined || team.counts === null ? 0 : team.counts.pending
        let body
        if (d.loading && d.lessons.length === 0 && d.error === null) body = h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-spin' }))
        else if (!d.ok) body = h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-ill' }, Ico('users')), h('h3', null, 'Team lessons are not available'), h('div', null, friendlyError(d.error)))
        else if (shown.length === 0) body = h('div', { className: 'kbmem-empty', 'data-team': 'empty' }, h('div', { className: 'kbmem-ill' }, Ico('users')),
          q.trim() !== '' ? [h('h3', { key: 'h' }, 'No match'), h('div', { key: 'd' }, 'No team lesson has those words.')]
            : view === 'mine' ? [h('h3', { key: 'h' }, 'You have not proposed anything yet'), h('div', { key: 'd' }, 'Propose a lesson your team should know: an owner or admin reads it, then every agent of the team does.')]
              : [h('h3', { key: 'h' }, 'No approved lesson yet'), h('div', { key: 'd' }, admin ? 'Add the first one, or review what members propose.' : 'Propose one: when an owner or admin approves it, every agent of the team reads it.')])
        else body = h('div', { className: 'kbmem-list', style: d.loading ? { opacity: 0.6 } : null }, shown.map((l) => h(TeamRow, { key: l.id, l, mineView: view === 'mine', onOpen: (x) => setSheet({ kind: 'open', lesson: x }) })))
        return h('div', { 'data-team': 'pane' },
          h('div', { className: 'kbmem-tools' },
            h('label', { className: 'kbmem-field' }, Ico('search'), h('input', { 'aria-label': 'Search', placeholder: 'Search team lessons…', value: q, onChange: (e) => setQ(e.target.value) })),
            h(Seg, { small: true, value: view, label: 'Team view', onChange: setView, items: [{ v: 'approved', l: [h('span', { key: 'a' }, 'Approved'), h('span', { key: 'b', className: 'kbmem-cnt' }, team.counts ? team.counts.approved : '')] }, { v: 'mine', l: 'My proposals' }] }),
            canShare ? h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'team-add', onClick: () => setSheet({ kind: 'propose', initial: { text: '', kyber: null, tags: [] } }) }, Ico('plus'), admin ? 'Add a team lesson' : 'Propose a lesson') : null),
          h('div', { className: 'kbmem-tiny', style: { marginBottom: 8 } }, (team.workspaceName || 'Your team') + ' · lessons your team’s agents read, approved by an owner or admin'),
          admin && pending > 0 ? h('div', { className: 'kbmem-banner', 'data-team': 'banner', role: 'status' }, Ico('inbox'),
            h('div', { className: 'kbmem-grow' }, h('b', null, plural(pending, 'proposal')), ' wait for your review. ', h('span', { className: 'kbmem-muted' }, 'Nothing reaches your team’s agents until you approve it.')),
            h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'team-review', onClick: openReview }, 'Review')) : null,
          body,
          sheet !== null && sheet.kind === 'open' ? h(TeamOpenSheet, { key: 'o' + String(sheet.lesson.id), lesson: sheet.lesson, role, onClose: () => setSheet(null), onDone: after, notify }) : null,
          sheet !== null && sheet.kind === 'propose' ? h(ProposeSheet, { key: 'p', initial: sheet.initial, kybers, admin, onClose: () => setSheet(null), onDone: after, notify }) : null)
      }

      /** The owner's or admin's queue: approve (maybe after editing it), reject with a reason. Decisions are the server's and final. */
      const TeamReviewView = ({ team, kybers, back, notify, bump, refreshKey }) => {
        const [d, setD] = useState({ loading: true, ok: false, error: null, lessons: [] })
        const [state, setState] = useState({})     // id -> 'approved' | 'rejected' | { error }
        const [edit, setEdit] = useState({})       // id -> { text, kyber } while editing
        const [rejecting, setRejecting] = useState({})   // id -> reason text while rejecting
        const [busy, setBusy] = useState(false)
        const stateRef = useRef(state)
        stateRef.current = state
        useEffect(() => {
          let live = true
          api('/kybernos-cloud/team/lessons?view=proposed&limit=200').then((r) => {
            if (!live) return
            // A decision bumps the page, so the queue is read again: the ones decided here no longer wait on the server, but they stay on screen with their verdict, in place.
            if (r.ok === true) setD((old) => {
              const fresh = new Set(r.lessons.map((l) => l.id))
              const kept = old.lessons.filter((l) => fresh.has(l.id) || stateRef.current[l.id] === 'approved' || stateRef.current[l.id] === 'rejected')
              const known = new Set(kept.map((l) => l.id))
              return { loading: false, ok: true, error: null, lessons: kept.map((l) => (fresh.has(l.id) ? r.lessons.find((x) => x.id === l.id) : l)).concat(r.lessons.filter((l) => !known.has(l.id))) }
            })
            else setD({ loading: false, ok: false, error: r.error === undefined ? 'indisponible' : r.error, lessons: [] })
          })
          return () => { live = false }
        }, [refreshKey])
        const waiting = d.lessons.filter((l) => state[l.id] === undefined).length
        const decide = async (l, decision) => {
          setBusy(true)
          const e = edit[l.id]
          const body = { id: l.id, decision }
          if (decision === 'approve' && e !== undefined) { if (e.text.trim() !== l.text) body.text = e.text; body.kyber = e.kyber }
          if (decision === 'reject' && typeof rejecting[l.id] === 'string' && rejecting[l.id].trim() !== '') body.note = rejecting[l.id]
          const r = await api('/kybernos-cloud/team/lessons/review', body)
          setBusy(false)
          if (r.ok !== true) { setState((old) => Object.assign({}, old, { [l.id]: { error: r.error } })); return }
          setState((old) => Object.assign({}, old, { [l.id]: decision === 'approve' ? 'approved' : 'rejected' }))
          bump()
          notify(decision === 'approve' ? 'Approved: members read it from their next message' : 'Rejected: the proposer sees your reason')
        }
        const options = [{ id: '', label: 'General (every kyber)' }].concat(kybers.map((k) => ({ id: k.id, label: k.id })))
        return h('div', null,
          h('a', { className: 'kbmem-crumb', role: 'button', tabIndex: 0, 'data-act': 'back', onClick: back, onKeyDown: (e) => { if (e.key === 'Enter') back() } }, Ico('left'), 'Memory & Lessons learned'),
          h('div', { className: 'kbmem-top' }, h('h1', { className: 'kbmem-h1' }, 'Team lesson proposals'), h('span', { className: 'kbmem-grow' }), h('span', { className: 'kbmem-tiny' }, (team.workspaceName || 'Your team') + ' · ' + String(waiting) + ' to review')),
          h('p', { className: 'kbmem-lead' }, 'A lesson you approve is read by every member’s agents from their next message. Members never see a proposal that is still waiting, except their own.'),
          d.loading ? h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-spin' }))
            : !d.ok ? h('div', { className: 'kbmem-empty' }, h('h3', null, 'Could not load the proposals'), h('div', null, friendlyError(d.error)))
              : d.lessons.length === 0 ? h('div', { className: 'kbmem-empty', 'data-team': 'nothing' }, h('div', { className: 'kbmem-ill' }, Ico('check')), h('h3', null, 'Nothing to review'), h('div', null, 'When a member proposes a lesson it shows up here.'))
                : d.lessons.map((l) => {
                  const st = state[l.id]
                  const done = st === 'approved' || st === 'rejected'
                  const e = edit[l.id]
                  const rj = rejecting[l.id]
                  const head = h('header', null, h('span', { className: 'kbmem-chip' }, l.proposedName || 'member'), h('span', { className: 'kbmem-chip' }, l.kyber === null ? 'general' : l.kyber), h('span', { className: 'kbmem-tiny' }, teamMeta(l).slice(-1)[0] || ''), h('span', { className: 'kbmem-grow' }),
                    done ? h('span', { className: 'kbmem-stat' + (st === 'approved' ? ' ok' : ''), 'data-stat': st }, Ico(st === 'approved' ? 'check' : 'x'), st === 'approved' ? 'Approved' : 'Rejected')
                      : st !== undefined ? h('span', { className: 'kbmem-stat err', 'data-stat': 'err' }, Ico('alert'), friendlyError(st.error)) : null)
                  if (done) return h('div', { key: l.id, className: 'kbmem-grp done', 'data-group': String(l.id) }, head, h('div', { className: 'kbmem-tiny', style: { padding: '0 14px 12px' } }, e !== undefined && st === 'approved' ? e.text : l.text))
                  return h('div', { key: l.id, className: 'kbmem-grp', 'data-group': String(l.id) }, head,
                    h('div', { className: 'items' },
                      h('div', { className: 'kbmem-it new' }, e !== undefined
                        ? h('div', { style: { width: '100%' } }, h('textarea', { 'aria-label': 'Text to approve', value: e.text, maxLength: 500, onChange: (ev) => setEdit((old) => Object.assign({}, old, { [l.id]: Object.assign({}, old[l.id], { text: ev.target.value }) })) }),
                          h('select', { className: 'kbmem-sel', 'aria-label': 'Kyber', style: { marginTop: 8 }, value: e.kyber, onChange: (ev) => setEdit((old) => Object.assign({}, old, { [l.id]: Object.assign({}, old[l.id], { kyber: ev.target.value }) })) }, options.map((o) => h('option', { key: o.id, value: o.id }, o.label))))
                        : h('span', { className: 'kbmem-itx' }, l.text)),
                      l.note ? h('div', { className: 'kbmem-gnote', style: { padding: '0 0 8px' } }, h('b', null, (l.proposedName || 'The proposer') + ' says: '), l.note) : null,
                      rj !== undefined ? h('textarea', { 'aria-label': 'Reason', placeholder: 'Tell ' + (l.proposedName || 'them') + ' why (they will see it)', value: rj, maxLength: 280, onChange: (ev) => setRejecting((old) => Object.assign({}, old, { [l.id]: ev.target.value })) }) : null),
                    h('div', { className: 'kbmem-gacts' }, rj !== undefined
                      ? [h('button', { key: 'r', type: 'button', className: 'kbmem-btn danger sm', 'data-act': 'team-reject', disabled: busy, onClick: () => decide(l, 'reject') }, 'Reject'), h('button', { key: 'c', type: 'button', className: 'kbmem-btn ghost sm', onClick: () => setRejecting((old) => { const n = Object.assign({}, old); delete n[l.id]; return n }) }, 'Cancel')]
                      : [h('button', { key: 'a', type: 'button', className: 'kbmem-btn sm', 'data-act': 'team-approve', disabled: busy, onClick: () => decide(l, 'approve') }, Ico('check'), 'Approve'),
                        h('button', { key: 'e', type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'team-edit', disabled: busy, onClick: () => setEdit((old) => { const n = Object.assign({}, old); if (n[l.id] === undefined) n[l.id] = { text: l.text, kyber: l.kyber === null ? '' : l.kyber }; else delete n[l.id]; return n }) }, e !== undefined ? 'Done editing' : 'Edit, then approve'),
                        h('button', { key: 'j', type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'team-rejecting', disabled: busy, onClick: () => setRejecting((old) => Object.assign({}, old, { [l.id]: '' })) }, 'Reject…')]))
                }))
      }

      /**
       * The map of the memories: each dot is a memory, close dots mean close meaning. The host sends the positions (`/kybernos-cloud/memory/meaning-map`:
       * it embeds a sample on first use, then reads its own private cache); here a dot is drawn, looked at, searched and opened.
       * When the map cannot be drawn the page says why, in words, and offers the way out.
       */
      const MapPane = ({ ctxOn, refreshKey, openOptions, onOpen, onReady, onList }) => {
        const [d, setD] = useState({ loading: true, ok: false, error: null, tier: null, nodes: [], clusters: [], links: [], total: 0, shown: 0 })
        const [q, setQ] = useState('')
        const [sel, setSel] = useState(null)
        const [tip, setTip] = useState(null)
        const [vb, setVb] = useState(MAP_FIT)
        const [drag, setDrag] = useState(false)
        const [tick, setTick] = useState(0)
        const frame = useRef(null)
        useEffect(() => {
          let live = true
          setD((old) => Object.assign({}, old, { loading: true }))
          api('/kybernos-cloud/memory/meaning-map').then((r) => {
            if (!live) return
            if (r.ok === true && Array.isArray(r.nodes)) { setD({ loading: false, ok: true, error: null, tier: null, nodes: r.nodes, clusters: r.clusters || [], links: r.links || [], total: r.total, shown: r.shown }); onReady() }
            else setD({ loading: false, ok: false, error: r.error === undefined ? 'indisponible' : r.error, tier: r.requiredTier === undefined ? null : r.requiredTier, nodes: [], clusters: [], links: [], total: 0, shown: 0 })
          })
          return () => { live = false }
        }, [refreshKey, tick])
        useEffect(() => (sel !== null ? onEscape(() => setSel(null)) : undefined), [sel])
        const drawn = d.ok
        // the wheel zooms around the pointer: a native listener, because React's is passive and could not keep the page from scrolling
        useEffect(() => {
          const el = frame.current
          if (el === null || !drawn) return undefined
          const wheel = (e) => {
            e.preventDefault()
            const r = el.getBoundingClientRect()
            setVb((v) => mapZoom(v, e.deltaY < 0 ? 1.2 : 1 / 1.2, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height))
          }
          el.addEventListener('wheel', wheel, { passive: false })
          return () => el.removeEventListener('wheel', wheel)
        }, [drawn])
        const startDrag = (e) => {
          if (e.button !== 0 || frame.current === null) return
          const r = frame.current.getBoundingClientRect()
          const from = { x: e.clientX, y: e.clientY, vb }
          setDrag(true)
          const move = (m) => setVb(mapPan(from.vb, -(m.clientX - from.x) / r.width * from.vb[2], -(m.clientY - from.y) / r.height * from.vb[3]))
          const up = () => { setDrag(false); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up) }
          document.addEventListener('mousemove', move)
          document.addEventListener('mouseup', up)
        }
        const showTip = (n) => {
          if (frame.current === null) return
          const r = frame.current.getBoundingClientRect()
          setTip({ id: n.id, left: (n.x * MAP_W - vb[0]) / vb[2] * r.width, top: (n.y * MAP_H - vb[1]) / vb[3] * r.height })
        }

        if (!d.ok) {
          if (d.loading) return h('div', { className: 'kbmem-empty', 'data-map': 'loading' }, h('div', { className: 'kbmem-spin' }), h('div', null, 'Placing your memories by meaning… the first time takes a few seconds.'))
          const [title, text] = mapWords(d.error, d.tier)
          return h('div', { className: 'kbmem-empty', 'data-map': 'unavailable', 'data-why': d.error }, h('div', { className: 'kbmem-ill' }, Ico('lock')), h('h3', null, title), h('div', null, text),
            h('div', { className: 'kbmem-acts' },
              d.error === 'sens_desactive' || d.error === 'offre_requise' ? h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'map-options', onClick: openOptions }, 'Open Options') : null,
              d.error !== 'sens_desactive' && d.error !== 'offre_requise' && d.error !== 'non connecte' ? h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'map-retry', onClick: () => setTick((t) => t + 1) }, 'Try again') : null,
              h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'map-list', onClick: onList }, 'Back to the list')))
        }
        if (d.nodes.length === 0) return h('div', { className: 'kbmem-empty', 'data-map': 'empty' }, h('div', { className: 'kbmem-ill' }, Ico('brain')), h('h3', null, 'Nothing to place yet'), h('div', null, 'Memories appear on the map as soon as there are some.'))

        const typed = q.trim() !== ''
        const hits = typed ? d.nodes.filter((n) => mapMatches(n, q)).length : d.nodes.length
        const picked = sel === null ? null : d.nodes.find((n) => n.id === sel) || null
        const tipped = tip === null ? null : d.nodes.find((n) => n.id === tip.id) || null
        const pos = (n) => [n.x * MAP_W, n.y * MAP_H]
        const byIndex = d.nodes
        const spots = mapLabelSpots(d.nodes, d.clusters)
        return h('div', { className: 'kbmem-mapwrap' },
          h('div', { className: 'kbmem-map' + (drag ? ' drag' : ''), ref: frame, 'data-map': 'ready', style: d.loading ? { opacity: 0.6 } : null },
            h('svg', { viewBox: vb.map((x) => Math.round(x * 100) / 100).join(' '), role: 'img', 'aria-label': 'Map of your memories: close dots mean close meaning', 'data-view': vb.join(',') },
              h('rect', { className: 'kbmem-bg', x: 0, y: 0, width: MAP_W, height: MAP_H, onMouseDown: startDrag, onClick: () => { setSel(null) } }),
              d.clusters.map((c) => { const at = spots[c.id]; return at === undefined ? null : h('text', { key: 'c' + c.id, className: 'kbmem-cl', x: at.x, y: at.y, textAnchor: 'middle', 'data-cluster': c.id }, c.label) }),
              d.links.map(([a, b]) => { const A = pos(byIndex[a]), B = pos(byIndex[b]); return h('line', { key: a + ':' + b, className: 'kbmem-ed', x1: A[0], y1: A[1], x2: B[0], y2: B[1] }) }),
              d.nodes.map((n) => {
                const hit = typed && mapMatches(n, q)
                const [x, y] = pos(n)
                return h('g', { key: n.id, className: 'kbmem-nd ' + n.kind + (typed && !hit ? ' dim' : '') + (hit ? ' hit' : '') + (sel === n.id ? ' sel' : ''), 'data-id': n.id, transform: 'translate(' + x + ' ' + y + ')', tabIndex: 0, role: 'button', 'aria-label': n.content,
                  onClick: (e) => { e.stopPropagation(); setSel(n.id) }, onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(n.id) } },
                  onMouseEnter: () => showTip(n), onMouseLeave: () => setTip(null), onFocus: () => showTip(n), onBlur: () => setTip(null) },
                  n.sent && ctxOn ? h('circle', { className: 'kbmem-ring', r: 8 }) : null,
                  h('circle', { className: 'kbmem-dot', r: (n.pinned ? 6 : 4) + (hit ? 3 : 0) }),
                  h('circle', { r: 12, fill: 'transparent' }))
              })),
            h('div', { className: 'kbmem-maphud' },
              h('label', { className: 'kbmem-field' }, Ico('search'), h('input', { 'aria-label': 'Light up what matches', placeholder: 'Light up what matches…', value: q, onChange: (e) => setQ(e.target.value) })),
              typed ? h('span', { className: 'kbmem-tiny', 'data-map': 'hits' }, hits + (hits === 1 ? ' match' : ' matches')) : null),
            h('div', { className: 'kbmem-legend' },
              ['fact', 'preference', 'policy', 'event'].map((k) => h('span', { key: k }, h('i', { className: 'kbmem-kd ' + k }), KIND_LABEL[k])),
              ctxOn ? h('span', { key: 'sent' }, h('i', { className: 'kbmem-lring' }), 'Sent each turn') : null),
            h('div', { className: 'kbmem-zoom' },
              h('button', { type: 'button', 'aria-label': 'Zoom in', 'data-act': 'zin', onClick: () => setVb((v) => mapZoom(v, 1.4)) }, Ico('zin')),
              h('button', { type: 'button', 'aria-label': 'Zoom out', 'data-act': 'zout', onClick: () => setVb((v) => mapZoom(v, 1 / 1.4)) }, Ico('zout')),
              h('button', { type: 'button', 'aria-label': 'Fit the whole map', 'data-act': 'zfit', onClick: () => setVb(MAP_FIT) }, Ico('fit'))),
            tipped !== null && picked === null ? h('div', { className: 'kbmem-tip', role: 'tooltip', 'data-map': 'tip', style: { left: tip.left, top: tip.top } }, tipped.content.length > 160 ? tipped.content.slice(0, 160) + '…' : tipped.content) : null,
            picked !== null ? h('div', { className: 'kbmem-mcard', 'data-map': 'card' },
              h('div', { className: 'kbmem-mhd' }, h('span', { className: 'kbmem-kd ' + picked.kind, style: { margin: 0 } }), h('b', null, KIND_LABEL[picked.kind] || picked.kind), h('span', { className: 'kbmem-grow' }),
                h('button', { type: 'button', className: 'kbmem-ib', 'aria-label': 'Close', 'data-act': 'map-close', onClick: () => setSel(null) }, Ico('x'))),
              h('div', { className: 'kbmem-mtx' }, picked.content),
              h('div', { className: 'kbmem-mmt' },
                picked.sent && ctxOn ? h('span', { className: 'kbmem-chip ok' }, 'Sent') : null,
                picked.pinned ? h('span', { title: 'Pinned' }, Ico('pin')) : null,
                h('span', null, ORIGIN_LABEL[picked.origin] || picked.origin), h('span', null, ageLabel(picked.ageMinutes))),
              h('div', { className: 'kbmem-acts' }, h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'map-open', onClick: () => onOpen(picked) }, 'Open'))) : null),
          h('div', { className: 'kbmem-tiny', 'data-map': 'foot', style: { marginTop: 10 } }, 'Each dot is a memory; close dots mean close meaning · ' + (d.shown < d.total ? 'sample of ' + d.shown + ' of ' + d.total + ' (pinned, then sent, then newest)' : d.shown + ' memories') + (ctxOn ? ' · rings = sent to the model each turn' : '') + ' · drag to move, scroll to zoom'))
      }

      const MainView = ({ tab, setTab, status, settings, openOptions, notify, bump, refreshKey, tidy, hiddenKey, hideBanner, openReview, ran, onRanUndo, onRanHide, team, openTeamReview, startScope, usedStartScope }) => {
        const [q, setQ] = useState('')
        const [qd, setQd] = useState('')
        const [f, setF] = useState(() => Object.assign(defaultFilters(), tab === 'lessons' && startScope === 'team' ? { scope: 'team' } : {}))
        useEffect(() => { if (typeof usedStartScope === 'function') usedStartScope() }, [])
        const [page, setPage] = useState(1)
        const [size, setSize] = useState(PAGE_SIZES[0])
        const [menu, setMenu] = useState(false)
        const [sheet, setSheet] = useState(null)
        const [mode, setModeState] = useState(readMode)
        const [layout, setLayoutState] = useState(readLayout)
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
        // Team lessons: the Team scope of the Lessons tab, available on a Team workspace only.
        const teamInfo = team !== undefined && team.ok === true && team.team !== null ? team.team : null
        const teamAvail = teamInfo !== null && teamInfo.available === true
        const teamFull = teamAvail ? Object.assign({}, teamInfo, { shareOn: team.settings.share === true }) : null
        const teamMode = !mems && f.scope === 'team' && teamAvail
        // The map is for the memories (the lessons stay on this machine: drawing them would send them to the embeddings model). The choice is kept
        // once a map has really been drawn, so a plan or a switch that is missing never leaves the page stuck on a map it cannot show.
        const mapOn = mems && layout === 'map'
        const setLayout = (v) => { setLayoutState(v); setSheet(null); if (v === 'list') writeLayout('list') }
        const [lockLabel, lockWhy] = teamLockedWords(teamInfo === null ? teamReasonOf(team) : teamInfo.reason)

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
          !mems ? h(Seg, { value: teamMode ? 'team' : 'mine', label: 'Scope', onChange: (v) => { setFilter('scope', v); setSheet(null) }, items: [
            { v: 'mine', l: [h('span', { key: 'a' }, 'Mine'), h('span', { key: 'b', className: 'kbmem-cnt' }, lesCount === null ? '' : lesCount)] },
            { v: 'team', disabled: !teamAvail, title: teamAvail ? undefined : lockWhy, l: teamAvail ? [h('span', { key: 'a' }, 'Team'), h('span', { key: 'b', className: 'kbmem-cnt' }, teamInfo.counts ? teamInfo.counts.approved : '')] : [h('span', { key: 'a' }, 'Team'), h('span', { key: 'b', className: 'kbmem-plan', 'data-lock': 'team' }, Ico('lock'), lockLabel)] }] }) : null,
          h(Seg, { small: true, value: mapOn ? 'map' : 'list', label: 'View', onChange: setLayout, items: [
            { v: 'list', l: [Ico('list'), ' List'] },
            { v: 'map', l: [Ico('map'), ' Map ', canMeaning ? null : Ico('lock')], disabled: !mems, title: !mems ? 'Lessons stay on this machine: the map would send them to the embeddings model, so it is only offered for memories.' : (canMeaning ? 'Memories placed by meaning: close dots mean close meaning.' : meaningWhy(meaningReason, meaning.requiredTier) + ' Click to see why.') }] }))

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
            ? h(MemoryRow, { key: it.id, m: it, ctxOn, selected: sheet !== null && sheet.item !== undefined && sheet.item.id === it.id, onOpen: (m) => setSheet({ kind: 'mem', item: m }) })
            : h(LessonRow, { key: it.id, l: it, selected: sheet !== null && sheet.item !== undefined && sheet.item.id === it.id, onOpen: (l) => setSheet({ kind: 'les', item: l }) }))),
          h(Pager, { total: list.total, page, size, onPage: setPage, onSize: (n) => { setSize(n); setPage(1) } }))

        return h('div', null,
          h('div', { className: 'kbmem-top' }, h('h1', { className: 'kbmem-h1' }, 'Memory & Lessons learned'), h('span', { className: 'kbmem-grow' }), (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-memory' }) : null),
            h('button', { type: 'button', className: 'kbmem-st' + (on ? '' : ' off'), 'data-act': 'status', title: 'Open options', onClick: openOptions }, h('i'), status1),
            h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'options', onClick: openOptions }, Ico('gear'), 'Options')),
          tabs, teamMode || mapOn ? null : tools, teamMode || mapOn ? null : chips, teamMode ? h(TeamPane, { team: teamFull, kybers, notify, bump, refreshKey, openReview: openTeamReview }) : null, teamMode ? null : (ran !== null && ran !== undefined ? h(TidyRanNotice, { notice: ran, onUndo: onRanUndo, onHide: onRanHide }) : null), teamMode ? null : (tidy.loaded === true && tidySaves(tidy) > 0 && hiddenKey !== scanKey(tidy) ? h(TidyBanner, { tidy, onReview: openReview, onHide: hideBanner }) : null), teamMode ? null : notes, teamMode ? null : (mapOn ? h(MapPane, { ctxOn, refreshKey, openOptions, onOpen: (m) => setSheet({ kind: 'mem', item: m }), onReady: () => writeLayout('map'), onList: () => setLayout('list') }) : body),
          sheet !== null && sheet.kind !== 'propose' ? h(Sheet, { key: (sheet.item.id === undefined ? 'new' : sheet.item.id) + String(sheet.isNew), sheet, onClose: () => setSheet(null), onDone: (m, u) => (sheet.kind === 'mem' ? forgetUndo(m, u) : after(m)), notify,
            onPropose: teamAvail && team.settings.share === true ? (lesson) => setSheet({ kind: 'propose', initial: { text: lesson.text, kyber: lesson.kyber === 'default' ? null : lesson.kyber, tags: lesson.tags } }) : undefined }) : null,
          sheet !== null && sheet.kind === 'propose' ? h(ProposeSheet, { key: 'propose', initial: sheet.initial, kybers, admin: isTeamAdmin(teamInfo === null ? null : teamInfo.role), onClose: () => setSheet(null), onDone: (m) => { setSheet(null); bump(); notify(m) }, notify }) : null)
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

      /** « Pick by relevance »: besides the pinned and the newest, the memories that clearly match what the user just asked. Local. */
      const RelevantRow = ({ cloud, mem, onToggle }) => {
        const stale = mem !== null && typeof mem.relevant !== 'boolean'   // a host that predates the switch
        const off = !cloud || mem === null || mem.memories !== true || mem.context !== true || stale
        return h(SettingRow, { label: 'Pick by relevance',
          desc: 'Besides the pinned and the newest memories, also send the ones that clearly match what you just asked, even old ones. Worked out on this machine: nothing extra is sent anywhere.',
          locked: off,
          why: !cloud ? 'Connect a Kybernos Cloud account first.' : (stale ? 'The cloud plugin was updated: restart DSH to use this.' : (mem !== null && (mem.memories !== true || mem.context !== true) ? 'Turn on Memories and Memory system context first.' : null)),
          control: h(YesNo, { name: 'Pick by relevance', value: !off && mem.relevant === true, onChange: onToggle }) })
      }

      // ── Tidy up: banner, review, options rows ────────────────────────────────
      const TidyBanner = ({ tidy, onReview, onHide }) => {
        const nm = tidy.mem === null ? 0 : tidy.mem.saves
        const nl = tidy.les === null ? 0 : tidy.les.saves
        const parts = [nm > 0 ? plural(nm, 'memory', 'memories') : null, nl > 0 ? plural(nl, 'lesson') : null].filter((x) => x !== null)
        const at = [tidy.mem === null ? null : tidy.mem.scannedAt, tidy.les === null ? null : tidy.les.scannedAt].filter((x) => x !== null).sort().pop()
        return h('div', { className: 'kbmem-banner', 'data-tidy': 'banner', role: 'status' }, Ico('broom'),
          h('div', { className: 'kbmem-grow' }, h('b', null, plural(nm + nl, 'near-duplicate')), ' found: ' + parts.join(', ') + '. ',
            h('span', { className: 'kbmem-muted' }, 'Found ' + whenLabel(at) + ', nothing changed yet.')),
          h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'tidy-review', onClick: onReview }, 'Review'),
          h('button', { type: 'button', className: 'kbmem-x', 'data-act': 'tidy-hide', 'aria-label': 'Dismiss', onClick: onHide }, Ico('x')))
      }

      const TidyRanNotice = ({ notice, onUndo, onHide }) => h('div', { className: 'kbmem-autobar', 'data-tidy': 'ran', role: 'status' }, Ico('check'),
        h('div', { className: 'kbmem-grow' }, h('b', null, 'Tidied up by itself ' + whenLabel(notice.at)), ': merged ' + plural(notice.groups, 'group') + ' (' + plural(notice.removed, 'item') + ' removed). Every change can be undone for 30 days.'),
        notice.entries.length > 0 ? h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-ran-undo', onClick: onUndo }, Ico('undo'), 'Undo') : null,
        h('button', { type: 'button', className: 'kbmem-x', 'data-act': 'tidy-ran-hide', 'aria-label': 'Dismiss', onClick: onHide }, Ico('x')))

      /** One suggestion: the items (the kept one in green, the others struck), who stays, and what to do. */
      const GroupCard = ({ g, st, keepId, editing, edit, busy, expanded, onExpand, onPick, onMerge, onToggleEdit, onEdit, onKeepBoth, onUndo, onRestore }) => {
        const src = TIDY_SOURCES[g.src]
        const pinned = g.items.some((i) => i.pinned === true)
        const tooBig = groupRemovals(g) > TIDY_MAX_REMOVALS
        const done = st !== undefined && st.s !== 'err'
        const outdated = g.type === 'outdated'
        const title = outdated ? 'Remove the outdated one' : 'Merge ' + String(g.items.length) + ' into 1'
        let status = null
        if (st !== undefined) {
          if (st.s === 'ok') status = [h('span', { key: 's', className: 'kbmem-stat ok', 'data-stat': 'ok' }, Ico('check'), 'Merged'), h('button', { key: 'u', type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-undo', disabled: busy, onClick: onUndo }, Ico('undo'), 'Undo')]
          else if (st.s === 'keep') status = [h('span', { key: 's', className: 'kbmem-stat', 'data-stat': 'keep' }, Ico('x'), 'Kept as is'), h('button', { key: 'u', type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-restore', disabled: busy, onClick: onRestore }, Ico('undo'), 'Undo')]
          else if (st.s === 'undone') status = h('span', { className: 'kbmem-stat', 'data-stat': 'undone' }, Ico('undo'), 'Undone: ' + (g.src === 'mem' ? 'the originals are back as new memories' : 'everything is back as it was'))
          else status = h('span', { className: 'kbmem-stat err', 'data-stat': 'err' }, Ico('alert'), friendlyError(st.error))
        }
        return h('div', { className: 'kbmem-grp' + (done ? ' done' : ''), 'data-group': g.id, 'data-src': g.src },
          h('header', null, h('span', { className: 't' }, title), g.by === 'brain' ? h('span', { className: 'kbmem-chip acc', 'data-chip': 'brain' }, Ico('brain'), 'Study model') : h('span', { className: 'kbmem-chip' }, 'Close match ' + String(g.score) + '%'),
            g.kyber ? h('span', { className: 'kbmem-chip' }, g.kyber) : null, h('span', { className: 'kbmem-grow' }), status),
          h('div', { className: 'items' }, visibleItems(g, keepId, expanded).map((i) => {
            const kept = i.id === keepId
            return h('div', { key: i.id, className: 'kbmem-it ' + (kept ? 'new' : 'del'), 'data-item': i.id, 'data-kept': kept ? '1' : '0' },
              h('button', { type: 'button', className: 'kbmem-pick' + (kept ? ' on' : ''), role: 'radio', 'aria-checked': kept, 'aria-label': 'Keep this one', disabled: done || (pinned && i.pinned !== true), onClick: () => onPick(i.id) }),
              kept && editing
                ? h('textarea', { 'aria-label': 'Text to keep', value: edit, maxLength: src.max, onChange: (e) => onEdit(e.target.value) })
                : h('span', { className: 'kbmem-itx', title: kept ? undefined : i.content }, kept && edit !== undefined && edit.trim() !== '' ? edit : i.content,
                  kept && edit !== undefined && edit.trim() !== '' && edit.trim() !== i.content.trim() ? h('span', { className: 'kbmem-was', 'data-was': '1' }, 'was: ' + i.content) : null),
              h('span', { className: 'kbmem-im' }, kept && g.merged && edit === g.merged ? h('span', { className: 'kbmem-chip acc', 'data-chip': 'suggested' }, 'suggested text') : null, i.pinned ? Ico('pin') : null, i.uses > 0 ? h('span', null, 'Used ' + String(i.uses) + '×') : null, h('span', null, ageLabel(i.ageMinutes))))
          }), visibleItems(g, keepId, expanded).length < g.items.length ? h('div', { className: 'kbmem-more' }, '+ ' + String(g.items.length - visibleItems(g, keepId, false).length) + ' more with the same meaning ', h('button', { type: 'button', 'data-act': 'tidy-more', onClick: onExpand }, 'Show')) : null),
          g.verdict ? h('div', { className: 'kbmem-why', 'data-why': '1' }, Ico('brain'), g.verdict) : null,
          h('div', { className: 'kbmem-gnote' }, outdated ? 'The newer one replaces it; Undo brings the older one back' + (g.src === 'mem' ? ' as a new memory.' : '.') : g.src === 'les' ? 'The kept lesson also gets the tags and the uses of the others.' : (pinned ? 'A pinned memory is never removed: it is the one that stays.' : 'The other ' + (g.items.length === 2 ? 'one is' : 'ones are') + ' deleted; Undo brings them back as new memories.')),
          done ? null : h('div', { className: 'kbmem-gacts' },
            h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'tidy-merge', disabled: busy || tooBig || (st !== undefined), onClick: onMerge }, Ico('check'), outdated ? 'Remove the older' : 'Merge'),
            h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-edit', disabled: busy, onClick: onToggleEdit }, editing ? 'Done editing' : 'Edit the kept one'),
            h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-keepboth', disabled: busy, onClick: onKeepBoth }, 'Keep both'),
            tooBig ? h('span', { className: 'kbmem-tiny' }, 'Too many at once (' + String(groupRemovals(g)) + '): the limit is ' + String(TIDY_MAX_REMOVALS) + '.') : null))
      }

      const ReviewBody = ({ tidy, back, notify, bump, scan, scanning, auto, onUndoAuto }) => {
        const first = useRef(null)
        if (first.current === null) {
          // the suggestions as they were when the page was opened: applying one must not make its card vanish (it becomes « Merged » + Undo)
          const tag = (src) => (tidy[src] === null ? [] : tidy[src].groups.map((g) => Object.assign({ src }, g)))
          first.current = { mem: tag('mem'), les: tag('les') }
        }
        const snap = first.current
        const [tab, setTab] = useState(snap.mem.length === 0 && snap.les.length > 0 ? 'les' : 'mem')
        const [status, setStatus] = useState({})
        // a Study-model suggestion that comes with a merged wording starts with it as the text to keep
        const [choices, setChoices] = useState(() => { const c = {}; for (const g of [...snap.mem, ...snap.les]) if (typeof g.merged === 'string' && g.merged !== '') c[g.id] = { edit: g.merged }; return c })
        const [autoState, setAutoState] = useState('done')
        const [editing, setEditing] = useState(null)
        const [expanded, setExpanded] = useState({})
        const [busy, setBusy] = useState(false)
        const list = snap[tab]
        const open = list.filter((g) => status[g.id] === undefined)
        const openOf = (src) => snap[src].filter((g) => status[g.id] === undefined).length
        const setChoice = (id, patch) => setChoices((old) => Object.assign({}, old, { [id]: Object.assign({}, old[id], patch) }))
        const textOf = (g, id) => g.items.find((i) => i.id === id).content

        const apply = async (groups) => {
          setBusy(true)
          const next = {}
          const runs = []
          let removed = 0
          for (const src of ['mem', 'les']) {
            for (const chunk of tidyChunks(groups.filter((g) => g.src === src), TIDY_MAX_REMOVALS)) {
              const r = await api(TIDY_SOURCES[src].base + '/apply', tidyBody(chunk, choices))
              if (!Array.isArray(r.results)) { for (const g of chunk) next[g.id] = { s: 'err', error: r.error === undefined ? 'indisponible' : r.error }; continue }
              for (const res of r.results) {
                if (res.ok === true) { next[res.id] = { s: 'ok', run: res.run, src }; if (res.run) runs.push({ src, run: res.run, id: res.id }); removed += res.removed || 0 }
                else next[res.id] = { s: 'err', error: res.error }
              }
            }
          }
          setStatus((old) => Object.assign({}, old, next))
          setBusy(false)
          bump()
          const failed = Object.keys(next).filter((k) => next[k].s === 'err').length
          const merged = Object.keys(next).length - failed
          if (merged === 0) { notify(failed === 1 ? friendlyError(next[Object.keys(next)[0]].error) : 'Nothing was merged.'); return }
          notify('Merged ' + plural(merged, 'group') + ' · ' + plural(removed, 'item') + ' removed' + (failed > 0 ? ' · ' + String(failed) + ' not done' : ''), async () => {
            let back = 0
            for (const x of runs) {
              const u = await api(TIDY_SOURCES[x.src].base + '/undo', { run: x.run })
              if (u.ok === true) { back += 1; setStatus((old) => Object.assign({}, old, { [x.id]: { s: 'undone' } })) }
            }
            bump()
            notify(back === runs.length ? 'Undone: everything is back' : 'Undone ' + String(back) + ' of ' + String(runs.length) + ': open Options to retry the rest')
          })
        }

        const undoOne = async (g) => {
          const st = status[g.id]
          setBusy(true)
          const r = await api(TIDY_SOURCES[g.src].base + '/undo', { run: st.run })
          setBusy(false)
          if (r.ok !== true) { notify(friendlyError(r.error)); return }
          setStatus((old) => Object.assign({}, old, { [g.id]: { s: 'undone' } }))
          bump()
        }
        const keepBoth = async (g) => {
          setBusy(true)
          const r = await api(TIDY_SOURCES[g.src].base + '/dismiss', { groups: [g.id] })
          setBusy(false)
          if (r.ok !== true) { notify(friendlyError(r.error)); return }
          setStatus((old) => Object.assign({}, old, { [g.id]: { s: 'keep' } }))
          bump()
        }
        const restoreOne = async (g) => {
          setBusy(true)
          const r = await api(TIDY_SOURCES[g.src].base + '/dismiss', { groups: [g.id], restore: true })
          setBusy(false)
          if (r.ok !== true) { notify(friendlyError(r.error)); return }
          setStatus((old) => { const n = Object.assign({}, old); delete n[g.id]; return n })
          bump()
        }

        const scanned = [tidy.mem, tidy.les].filter((x) => x !== null)
        const at = scanned.map((x) => x.scannedAt).filter((x) => x !== null).sort().pop()
        const total = (tidy.mem === null || tidy.mem.total === null ? 0 : tidy.mem.total) + (tidy.les === null || tidy.les.total === null ? 0 : tidy.les.total)
        const nothing = snap.mem.length + snap.les.length === 0
        const notes = []
        if (auto !== null && auto !== undefined && auto.brainError) notes.push(h('div', { key: 'nb', className: 'kbmem-note warn', 'data-note': 'brain' }, Ico('brain'), h('div', null, h('b', null, 'The Study model was not asked. '), friendlyError(auto.brainError), auto.brainDetail ? ' (' + auto.brainDetail + ')' : '', ' The suggestions below come from the local look only.')))
        if (tidy.memError !== null && tidy.mem === null) notes.push(h('div', { key: 'nm', className: 'kbmem-note warn', 'data-note': 'mem-skipped' }, Ico('cloud'), h('div', null, h('b', null, 'Memories were not looked at. '), friendlyError(tidy.memError))))
        if (tidy.lesError !== null && tidy.les === null) notes.push(h('div', { key: 'nl', className: 'kbmem-note warn', 'data-note': 'les-skipped' }, Ico('alert'), h('div', null, h('b', null, 'Lessons were not looked at. '), friendlyError(tidy.lesError))))

        const autoCount = auto === null || auto === undefined ? 0 : (auto.mem === null || auto.mem === undefined ? 0 : auto.mem.groups) + (auto.les === null || auto.les === undefined ? 0 : auto.les.groups)
        const autoRemoved = auto === null || auto === undefined ? 0 : (auto.mem === null || auto.mem === undefined ? 0 : auto.mem.removed) + (auto.les === null || auto.les === undefined ? 0 : auto.les.removed)
        const autoBar = autoCount > 0 ? h('div', { className: 'kbmem-autobar', 'data-tidy': 'auto' }, Ico('check'),
          h('div', { className: 'kbmem-grow' }, autoState === 'undone' ? 'Undone: what was merged by itself is back. Press “Look again” to see it as suggestions.' : [h('b', { key: 'b' }, 'Merged ' + plural(autoCount, 'group') + ' by itself'), ' (80 % alike or more): ' + plural(autoRemoved, 'item') + ' removed. Every change can be undone for 30 days.']),
          autoState === 'undone' ? null : h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-auto-undo', disabled: busy, onClick: async () => { setBusy(true); const r = await onUndoAuto(auto); setBusy(false); if (r.back === r.total) setAutoState('undone'); else notify('Undid ' + String(r.back) + ' of ' + String(r.total) + ': open Options to retry the rest') } }, Ico('undo'), 'Undo')) : null
        const head = h('div', null,
          h('a', { className: 'kbmem-crumb', role: 'button', tabIndex: 0, 'data-act': 'back', onClick: back, onKeyDown: (e) => { if (e.key === 'Enter') back() } }, Ico('left'), 'Memory & Lessons learned'),
          h('div', { className: 'kbmem-top' }, h('h1', { className: 'kbmem-h1' }, 'Tidy-up suggestions'), h('span', { className: 'kbmem-grow' }),
            at ? h('span', { className: 'kbmem-tiny' }, 'Found ' + whenLabel(at) + (tidyBrain(tidy).model !== '' && tidySettingsOf(tidy).brain === true ? ' · local scan + Study model' : ' · local scan')) : null,
            h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-rescan', disabled: scanning || busy, onClick: scan }, Ico('broom'), scanning ? 'Looking…' : 'Look again')),
          autoBar, notes)

        if (nothing) return h('div', null, head,
          h('div', { className: 'kbmem-empty', 'data-tidy': 'empty' }, h('div', { className: 'kbmem-ill' }, Ico('check')),
            at ? [h('h3', { key: 'h' }, autoCount > 0 ? 'Nothing left to review' : 'Nothing to tidy up'), h('div', { key: 'd' }, autoCount > 0 ? 'Everything that was close enough has been merged.' : 'Looked at ' + plural(total, 'item') + ' on this machine: no near-duplicates.')]
              : [h('h3', { key: 'h' }, 'Nothing has been looked at yet'), h('div', { key: 'd' }, 'Press “Look again” to search your memories and lessons for near-duplicates. Nothing is changed by looking.')]))

        return h('div', null, head,
          h('div', { className: 'kbmem-row2' }, h(Seg, { value: tab, onChange: (v) => { setTab(v); setEditing(null) }, label: 'Section', items: [
            { v: 'mem', l: [h('span', { key: 'a' }, 'Memories'), h('span', { key: 'b', className: 'kbmem-cnt' }, openOf('mem'))] },
            { v: 'les', l: [h('span', { key: 'a' }, 'Lessons learned'), h('span', { key: 'b', className: 'kbmem-cnt' }, openOf('les'))] }] })),
          h('div', { className: 'kbmem-sum' }, h('span', null, h('b', null, String(open.length)), ' to review'), tab === 'mem' ? h('span', null, 'Pinned memories are never removed') : h('span', null, 'Lessons only meet inside their own kyber')),
          list.length === 0 ? h('div', { className: 'kbmem-empty' }, h('h3', null, 'No suggestion for ' + TIDY_SOURCES[tab].noun), h('div', null, 'Nothing looks duplicated here.')) : null,
          list.map((g) => {
            const keepId = keeperOf(g, choices)
            const c = choices[g.id] || {}
            return h(GroupCard, { key: g.id, g, st: status[g.id], keepId, editing: editing === g.id, edit: c.edit, busy, expanded: expanded[g.id] === true, onExpand: () => setExpanded((old) => Object.assign({}, old, { [g.id]: true })),
              onPick: (id) => { setChoice(g.id, { keep: id, edit: editing === g.id ? textOf(g, id) : undefined }) },
              onMerge: () => apply([g]),
              onToggleEdit: () => {
                if (editing === g.id) { setEditing(null); if (c.edit !== undefined && c.edit.trim() === textOf(g, keepId).trim()) setChoice(g.id, { edit: undefined }); return }
                setEditing(g.id); setChoice(g.id, { edit: c.edit !== undefined ? c.edit : textOf(g, keepId) })
              },
              onEdit: (text) => setChoice(g.id, { edit: text }),
              onKeepBoth: () => keepBoth(g), onUndo: () => undoOne(g), onRestore: () => restoreOne(g) })
          }),
          h('div', { className: 'kbmem-foot' }, h('span', { className: 'kbmem-grow kbmem-muted', style: { fontSize: 13 } }, 'Nothing is deleted until you accept. Undo works for 30 days.'),
            h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'tidy-later', onClick: back }, 'Not now'),
            h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'tidy-all', disabled: open.length === 0 || busy, onClick: () => apply(open) }, Ico('check'), 'Accept all (' + String(open.length) + ')')))
      }

      /** Waits for the first read of both views, so the snapshot of suggestions is never taken from an empty page. */
      const ReviewView = (props) => (props.tidy.loaded === true
        ? h(ReviewBody, props)
        : h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-spin' })))

      /** Options: « Tidy up now », the three settings (what to merge by itself, when to run, the Study model) and the recent tidy-ups with their Undo. */
      const TidyOptions = ({ tidy, scan, scanning, openReview, notify, bump }) => {
        const none = tidy.loaded === true && tidy.mem === null && tidy.les === null
        const stale = tidy.loaded === true && !none && ((tidy.mem !== null && tidy.mem.settings === undefined) || (tidy.les !== null && tidy.les.settings === undefined))
        const cfg = tidySettingsOf(tidy)
        const brain = tidyBrain(tidy)
        const saves = tidySaves(tidy)
        const last = tidyLast(tidy)
        const log = tidyLog(tidy)
        const set = async (patch) => {
          // the two hosts keep a copy each (lessons work without the cloud): write both, tolerate one being away
          const rs = await Promise.all([tidy.mem !== null ? api(TIDY_SOURCES.mem.base + '/settings', patch) : Promise.resolve({ ok: false }), tidy.les !== null ? api(TIDY_SOURCES.les.base + '/settings', patch) : Promise.resolve({ ok: false })])
          if (!rs.some((r) => r.ok === true)) notify(friendlyError(rs[1].error || rs[0].error))
          bump()
        }
        const undo = async (l) => {
          const r = await api(TIDY_SOURCES[l.src].base + '/undo', { run: l.id })
          if (r.ok !== true) notify(friendlyError(r.error))
          else notify('Undone: ' + (l.src === 'mem' ? 'the originals are back as new memories' : 'everything is back as it was'))
          bump()
        }
        const unavailable = none ? 'The plugins were updated: restart DSH to use this.' : (stale ? 'The plugins were updated: restart DSH to change this.' : null)
        const brainWhy = unavailable !== null ? unavailable : (brain.model === '' ? 'No Study model is set: pick one in Kybernos Settings (AI Provider & Models).' : (!brain.llm ? 'The model service is not available right now.' : null))
        return [
          h('section', { key: 'tidy', className: 'kbmem-sec', 'data-sec': 'tidy' }, h('h2', null, 'Tidy up', h('small', null, 'near-duplicates, memories and lessons')),
            h(SettingRow, { label: 'Tidy up now', act: 'tidy-now',
              desc: (cfg.mode === 'auto' && !stale && !none ? 'Looks for near-duplicates on this machine and merges by itself the ones that are 80 % alike or more; the rest is shown for you to review. ' : 'Looks for near-duplicates on this machine; nothing changes until you accept. ') + 'Every change can be undone for 30 days. ' + lastWords(last),
              why: unavailable,
              live: saves > 0 ? h('div', { className: 'kbmem-tiny', style: { marginTop: 6 } }, plural(saves, 'near-duplicate') + ' waiting for your review.') : null,
              control: h('div', { className: 'kbmem-acts' },
                saves > 0 ? h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'tidy-open', onClick: openReview }, 'Review ' + String(saves)) : null,
                h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'tidy-scan', disabled: scanning || none || tidy.loaded !== true, onClick: scan }, Ico('broom'), scanning ? 'Looking…' : 'Clean up now')) }),
            h(SettingRow, { label: 'When it finds near-duplicates', act: 'tidy-mode', locked: unavailable !== null,
              desc: cfg.mode === 'auto' ? 'The ones that are 80 % alike or more are merged by itself (the longest wording stays, nothing is lost: every merge is archived). Weaker matches and the Study model\'s suggestions always wait for you.' : 'Nothing is merged until you press Merge or Accept all.',
              control: h(Seg, { value: cfg.mode, label: 'When it finds near-duplicates', onChange: (v) => set({ mode: v }), items: TIDY_MODES.map(([v, l]) => ({ v, l })) }) }),
            h(SettingRow, { label: 'Run automatically', act: 'tidy-schedule', locked: unavailable !== null,
              desc: 'A run is a look, then what the setting above allows. It only happens while DSH is running. ' + nextWords(tidyNextOf(tidy)),
              control: h(Seg, { value: cfg.schedule, label: 'Run automatically', onChange: (v) => set({ schedule: v }), items: TIDY_SCHEDULES.map(([v, l]) => ({ v, l })) }) }),
            h(SettingRow, { label: 'Study model judges the unclear cases', act: 'tidy-brain', locked: brainWhy !== null && !(cfg.brain === true), why: brainWhy,
              desc: 'Pairs that look alike but are not duplicates (« port 3000 » then « port 3080 », « do » then « do not »): the Study model says whether one replaces the other, they are the same or they differ. Only the text of those pairs is sent to it, never your whole list, and it only suggests: you decide.',
              live: brain.unclear > 0 ? h('div', { className: 'kbmem-tiny', style: { marginTop: 6 }, 'data-live': 'unclear' }, plural(brain.unclear, 'look-alike pair') + (cfg.brain === true ? ' found at the last run.' : ' found: turn this on to have them judged.')) : null,
              control: h(YesNo, { name: 'Study model judges the unclear cases', value: cfg.brain === true, onChange: (v) => set({ brain: v }) }) }),
            h(SettingRow, { label: 'Pinned memories', desc: 'Never removed by a tidy-up.', control: h('span', { className: 'kbmem-chip' }, 'Always protected') })),
          h('section', { key: 'log', className: 'kbmem-sec', 'data-sec': 'tidy-log' }, h('h2', null, 'Recent tidy-ups'),
            log.length === 0 ? h('div', { className: 'kbmem-srow' }, h('div', { className: 'desc' }, 'Nothing yet.')) : log.slice(0, 10).map((l) => h('div', { key: l.id, className: 'kbmem-run', 'data-run': l.id },
              h('div', { className: 'when' }, whenLabel(l.at)), h('div', { className: 'kbmem-grow' }, logWords(l.src, l), h('div', { className: 'kbmem-tiny' }, logWho(l))),
              l.canUndo ? h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-log-undo', onClick: () => undo(l) }, Ico('undo'), 'Undo')
                : h('span', { className: 'kbmem-tiny' }, l.undone ? 'Undone' : 'Too old to undo'))))
        ]
      }

      /** « Pick by relevance » for the lessons: besides the most used and the newest, the ones that clearly match what the user just asked. Local. */
      const LessonsRelevantRow = ({ les, onToggle }) => {
        const stale = les !== null && typeof les.relevant !== 'boolean'   // a host that predates the switch
        const off = les === null || les.lessons !== true || les.context !== true || stale
        return h(SettingRow, { label: 'Pick by relevance', act: 'lessons-relevant',
          desc: 'Besides the most used and the newest lessons, also send the ones that clearly match what you just asked, even old ones — from the kyber of the chat and the general lessons only. Worked out on this machine: nothing extra is sent anywhere.',
          locked: off,
          why: stale ? 'The lessons plugin was updated: restart DSH to use this.' : (les !== null && (les.lessons !== true || les.context !== true) ? 'Turn on Lessons learned and Lessons system context first.' : null),
          control: h(YesNo, { name: 'Pick lessons by relevance', value: !off && les.relevant === true, onChange: onToggle }) })
      }

      /** Options of the team lessons: read them, share yours, and who decides. Locked with the reason outside a Team workspace. */
      const TeamRows = ({ team, mem, onToggle }) => {
        const info = team !== undefined && team.ok === true && team.team !== null ? team.team : null
        const avail = info !== null && info.available === true
        const [label, why] = teamLockedWords(info === null ? teamReasonOf(team) : info.reason)
        const stale = mem !== null && (typeof mem.team_use !== 'boolean' || typeof mem.team_share !== 'boolean')   // a host that predates the switches
        const off = !avail || mem === null || stale
        const reason = off ? (stale ? 'The cloud plugin was updated: restart DSH to use this.' : why) : null
        const chip = off ? PlanChip(stale ? 'Restart DSH' : label) : h('span', { className: 'kbmem-plan' }, 'Team')
        return [
          h(SettingRow, { key: 'use', label: 'Use your team’s lessons', act: 'team-use', locked: off, chip, why: reason,
            desc: 'Your agents also read the lessons your team approved: the ones for the kyber of the chat and the general ones, up to a quarter of the lessons block. The ones that match what you just asked come first.',
            control: h(YesNo, { name: 'Use your team’s lessons', value: !off && mem.team_use === true, onChange: (v) => onToggle({ team_use: v }) }) }),
          h(SettingRow, { key: 'share', label: 'Share lessons with your team', act: 'team-share', locked: off, chip, why: reason,
            desc: 'Show « Propose to team » on your lessons and the Propose button of the Team tab. A proposal is only read by owners and admins until one approves it.',
            control: h(YesNo, { name: 'Share lessons with your team', value: !off && mem.team_share === true, onChange: (v) => onToggle({ team_share: v }) }) }),
          h(SettingRow, { key: 'who', label: 'Who approves', desc: 'Set by the workspace roles, not here.', control: h('span', { className: 'kbmem-chip' }, 'Owners and admins') }),
        ]
      }

      const OptionsView = ({ status, settings, back, notify, refresh, refreshKey, tidy, scan, scanning, openReview, team }) => {
        const cloud = status.connected
        const mem = settings.memory
        const les = settings.lessons
        const plan = status.plan
        const setMem = async (patch) => { const r = await api('/kybernos-cloud/memory/settings/set', patch); if (r.ok !== true) notify(friendlyError(r.error)); refresh() }
        const setLes = async (patch) => { const r = await api('/kybernos-memory/settings/set', patch); if (r.ok !== true) notify(friendlyError(r.error)); refresh() }
        const note = !cloud
          ? h('div', { className: 'kbmem-note warn' }, Ico('cloud'), h('div', null, h('b', null, 'Not connected. '), 'Memories live in your Kybernos Cloud account, so they cannot be changed here. Lessons are stored on this machine and keep working.'))
          : h('div', { className: 'kbmem-note' }, Ico('shield'), h('div', null, 'Your plan: ', h('b', null, PLAN_NAME[plan]), '. The map is not built yet.'))
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
            h(RelevantRow, { cloud, mem, onToggle: (v) => setMem({ relevant: v }) }),
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
            h(LessonsRelevantRow, { les, onToggle: (v) => setLes({ relevant: v }) }),
            h(TeamRows, { team, mem, onToggle: setMem })),
          h(TidyOptions, { tidy, scan, scanning, openReview, notify, bump: refresh }))
      }

      function Page() {
        const [view, setView] = useState('main')
        const [startScope, setStartScope] = useState('mine')   // the scope the list opens on: back from the team review lands on Team, not on Mine
        const [tab, setTab] = useState('memories')
        const [refreshKey, setRefreshKey] = useState(0)
        const [toast, setToast] = useState(null)
        const timer = useRef(null)
        const bump = useCallback(() => setRefreshKey((k) => k + 1), [])
        const status = useStatus(refreshKey)
        const settings = useSettings(refreshKey)
        const [tidy, adopt] = useTidy(refreshKey)
        const team = useTeam(refreshKey)
        const [kybersForTeam, setKybersForTeam] = useState([])
        useEffect(() => { let live = true; api('/kybernos-memory/kybers').then((r) => { if (live && r.ok === true) setKybersForTeam(r.kybers) }); return () => { live = false } }, [refreshKey])
        const [scanning, setScanning] = useState(false)
        const [autoRun, setAutoRun] = useState(null)
        const [hiddenKey, setHiddenKey] = useState(readHidden)
        const [ranSeen, setRanSeen] = useState(readRanSeen)
        const hideBanner = () => { const k = scanKey(tidy); writeHidden(k); setHiddenKey(k) }
        const notify = useCallback((message, undo) => {
          setToast({ message, undo })
          if (timer.current !== null) clearTimeout(timer.current)
          timer.current = setTimeout(() => setToast(null), 5000)
        }, [])
        useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current) }, [])
        // Both hosts run on this machine and each can fail alone (memories need the cloud account). In « auto » mode a run also
        // merges the close matches by itself: the answer says what it did, and every merge can be undone.
        const undoAuto = async (a) => {
          let back = 0
          let total = 0
          for (const src of ['mem', 'les']) for (const run of (a !== null && a[src] !== null && a[src] !== undefined ? a[src].runs : [])) { total += 1; const u = await api(TIDY_SOURCES[src].base + '/undo', { run }); if (u.ok === true) back += 1 }
          bump()
          return { back, total }
        }
        const scan = async () => {
          setScanning(true)
          const [m, l] = await Promise.all([api(TIDY_SOURCES.mem.base + '/scan', {}), api(TIDY_SOURCES.les.base + '/scan', {})])
          setScanning(false)
          if (asTidyView(m) === null && asTidyView(l) === null) { notify(friendlyError(m.error === undefined || m.error === 'indisponible' ? l.error : m.error)); return }
          const pick = (r) => (r.auto !== undefined && r.auto !== null ? { groups: r.auto.groups, removed: r.auto.removed, runs: r.auto.runs } : null)
          const a = { mem: pick(m), les: pick(l), brainError: [m, l].map((r) => (r.brain !== undefined && r.brain !== null && r.brain.error ? r.brain.error : null)).find((e) => e !== null) || null, brainDetail: [m, l].map((r) => (r.brain !== undefined && r.brain !== null && r.brain.detail ? r.brain.detail : null)).find((e) => e !== null) || null }
          setAutoRun(a)
          adopt(m, l)
          setView('review')
          const groups = (a.mem === null ? 0 : a.mem.groups) + (a.les === null ? 0 : a.les.groups)
          if (groups > 0) notify('Merged ' + plural(groups, 'group') + ' by itself · ' + plural((a.mem === null ? 0 : a.mem.removed) + (a.les === null ? 0 : a.les.removed), 'item') + ' removed', async () => { const r = await undoAuto(a); notify(r.back === r.total ? 'Undone: everything is back' : 'Undid ' + String(r.back) + ' of ' + String(r.total) + ': open Options to retry the rest') })
        }
        const ran = tidy.loaded === true ? tidyRanNotice(tidy, ranSeen) : null
        const hideRan = () => { if (ran !== null) { writeRanSeen(ran.at); setRanSeen(ran.at) } }
        const undoRan = async () => {
          if (ran === null) return
          let back = 0
          for (const l of ran.entries) { const u = await api(TIDY_SOURCES[l.src].base + '/undo', { run: l.id }); if (u.ok === true) back += 1 }
          hideRan()
          bump()
          notify(back === ran.entries.length ? 'Undone: everything is back' : 'Undid ' + String(back) + ' of ' + String(ran.entries.length) + ': open Options to retry the rest')
        }
        const toReview = () => { setAutoRun(null); setView('review') }
        return h('div', { className: 'kbmem-page', 'data-kbmem': view },
          view === 'options'
            ? h(OptionsView, { status, settings, back: () => setView('main'), notify, refresh: bump, refreshKey, tidy, scan, scanning, openReview: toReview, team })
            : view === 'teamreview'
              ? h(TeamReviewView, { team: team.team === null ? {} : team.team, kybers: kybersForTeam, back: () => { setStartScope('team'); setView('main') }, notify, bump, refreshKey })
              : view === 'review'
              ? h(ReviewView, { key: scanKey(tidy), tidy, back: () => setView('main'), notify, bump, scan, scanning, auto: autoRun, onUndoAuto: undoAuto })
              : h(MainView, { tab, setTab, status, settings, openOptions: () => setView('options'), notify, bump, refreshKey, tidy, hiddenKey, hideBanner, openReview: toReview, ran, onRanUndo: undoRan, onRanHide: hideRan, team, openTeamReview: () => setView('teamreview'), startScope, usedStartScope: () => setStartScope('mine') }),
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
        __test: { mapMatches, mapZoom, mapPan, mapClamp, mapLabelSpots, mapWords, MAP_FIT, teamLockedWords, teamReasonOf, isTeamAdmin, minutesSince, teamStatusChip, teamMatches, teamMeta, tidyRanNotice, TIDY_MODES, TIDY_SCHEDULES, whenAhead, tidySettingsOf, nextWords, tidyNextOf, tidyLast, lastWords, tidyBrain, logWho, TIDY_SHOWN, visibleItems, TIDY_MAX_REMOVALS, TIDY_SOURCES, plural, whenLabel, groupRemovals, tidyChunks, keeperOf, tidyBody, asTidyView, tidySaves, scanKey, logWords, tidyLog, onEscape, meaningWhy, closenessLabel, wordsLabel, readMode, writeMode, planOf, ageLabel, pagerPages, listUrl, activeFilters, defaultFilters, friendlyError, captureWords, api, GROUPS, Page, css, PAGE_SIZES },
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
