// kybernos-memory — browser half: the « Memory & Lessons » settings page (Settings → Memory & Lessons).
//
//   Settings .............................. one screen of plain rows: the instructions, three switches (use memory, learn,
//                                           sensitive topics), look for repeats, then Manage, Import and Export
//   Manage ................................ the notes about the person (the account memory, cloud host routes
//                                           `/kybernos-cloud/memory/*`), the lessons grouped by agent team (local files,
//                                           host routes of this bundle `/kybernos-memory/*`), a box to tell Kybernos something
//                                           to remember, Recently removed, Delete all; on a Team workspace a Team tab
//   A note ................................ its own page: when, who wrote it, how long it is kept; Edit, Delete, Make a skill
//   Import ................................ a prompt for another assistant, the answer back as notes, and the Claude Code wait-list
//
// Nothing here talks to the cloud directly: the account token never leaves the host half.
// What is not offered is not drawn as if it were: the list search is by words, never by meaning.
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
      /** The page's head: its title and its « ? » through the Suite's Title (one style for every page title, the button right after the text); the bare title where the Suite is not there. */
      const pageHead = (props) => { try { if (window.__KB_HELP__ && window.__KB_HELP__.Title) return h(window.__KB_HELP__.Title, props) } catch (e) { /* the bare title below */ } return h(props.as || 'h2', { className: 'kbhp-title' + (props.className ? ' ' + props.className : '') }, props.title, props.after) }

      // ── Language ─────────────────────────────────────────────────────────────────────────────────────
      // English is the base and the default. French is for the French of the product (« kybernos » or fr*); every other language
      // reads English, and so does a page where nothing resolves. kt(fr, en) is the pair helper: a French literal is only ever its
      // first argument. Labels kept in tables are functions (or getters), evaluated when drawn, because the language is not known at load.
      const lang = () => {
        try {
          const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
          const s = String(l || '')
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const kt = (fr, en) => (lang() === 'fr' ? fr : en)
      /** The plural « s » of a French count: none for one. */
      const sfx = (n) => (n === 1 ? '' : 's')

      // ═══════════════════════════════════════════════════════════════
      // 1. PURE PIECES (exposed for test-client.mjs)
      // ═══════════════════════════════════════════════════════════════

      const retentions = () => [[30, kt('30 jours', '30 days')], [90, kt('90 jours', '90 days')], [180, kt('180 jours', '180 days')], [365, kt('1 an', '1 year')]]

      /** The plan as the page talks about it: Free, Solo or Team (anything paid that is not a team seat is « Solo »). */
      const planOf = (status) => {
        const raw = status !== null && status !== undefined && status.state !== undefined && status.state !== null && status.state.user !== null && status.state.user !== undefined
          ? String(status.state.user.plan || '').toLowerCase() : ''
        if (raw === '' || raw === 'free') return 'free'
        return raw.indexOf('team') === 0 ? 'team' : 'solo'
      }

      /** Minutes → « now », « 12m », « 3h », « 2d ». */
      const ageLabel = (minutes) => {
        if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return ''
        if (minutes < 1) return kt('à l’instant', 'now')
        if (minutes < 60) return String(Math.round(minutes)) + kt(' min', 'm')
        if (minutes < 1440) return String(Math.round(minutes / 60)) + kt(' h', 'h')
        return String(Math.round(minutes / 1440)) + kt(' j', 'd')
      }

      const defaultFilters = () => ({ show: 'all', src: 'any', added: 'any', scope: 'mine', status: 'all', kyber: '' })

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
          return '/kybernos-cloud/memory/list?' + q.toString()
        }
        if (f.kyber !== '') q.set('kyber', f.kyber)
        if (f.status === 'used') q.set('used', '1')
        return '/kybernos-memory/lessons?' + q.toString()
      }

      const plain = (t) => String(t === undefined || t === null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

      /** What a host error code means to a person. */
      const friendlyError = (code) => {
        const c = String(code === undefined || code === null ? '' : code)
        if (c === 'non connecte' || c === 'compte_kybernos_non_connecte') return kt('Non connecté à Kybernos Cloud.', 'Not connected to Kybernos Cloud.')
        if (c === 'reconnexion_requise') return kt('Ta session Kybernos a expiré : reconnecte-toi.', 'Your Kybernos session has expired: reconnect.')
        if (c === 'reseau') return kt('Le serveur est injoignable.', 'The server cannot be reached.')
        if (c === 'indisponible') return kt('Cette partie n’est pas disponible (son plugin est peut-être désactivé).', 'This part is not available (its plugin may be switched off).')
        if (c === 'contenu_vide' || c === 'texte_vide') return kt('Écris d’abord quelque chose.', 'Write something first.')
        if (c === 'contenu_trop_long') return kt('C’est trop long (2 000 caractères au maximum).', 'That is too long (2 000 characters at most).')
        if (c === 'genre_invalide') return kt('Choisis un type.', 'Pick a type.')
        if (c === 'memoire_desactivee') return kt('La mémoire est désactivée.', 'Memory is switched off.')
        if (c === 'lecon_introuvable') return kt('Cette leçon n’existe plus.', 'That lesson no longer exists.')
        if (c === 'doublon') return kt('Ton équipe a déjà cette leçon, en attente ou approuvée.', 'Your team already has that lesson, waiting or approved.')
        if (c === 'equipe_pleine') return kt('Ton équipe a déjà le maximum de leçons approuvées qu’elle peut garder (200).', 'Your team already has the most approved lessons it can hold (200).')
        if (c === 'trop_de_propositions') return kt('Tu as déjà 20 propositions en attente : attends d’abord un examen.', 'You already have 20 proposals waiting: wait for a review first.')
        if (c === 'admin_requis') return kt('Seul un propriétaire ou un admin de l’équipe peut faire ça.', 'Only an owner or an admin of the team can do that.')
        if (c === 'deja_decidee') return kt('Quelqu’un a déjà tranché pour celle-ci.', 'Someone already decided on this one.')
        if (c === 'non_approuvee') return kt('Seule une leçon approuvée peut être retirée.', 'Only an approved lesson can be retired.')
        if (c === 'espace_introuvable') return kt('Tu n’es plus membre de cet espace d’équipe.', 'You are not a member of that team workspace any more.')
        if (c === 'offre_requise') return kt('Les leçons d’équipe demandent une offre Team.', 'Team lessons need a Team plan.')
        if (c === 'aucun_espace') return kt('Aucun espace d’équipe n’est sélectionné.', 'No team workspace is selected.')
        if (c === 'partage_desactive') return kt('Le partage des leçons avec ton équipe est désactivé.', 'Sharing lessons with your team is switched off.')
        if (c === 'texte_invalide') return kt('Écris d’abord la leçon (500 caractères au maximum).', 'Write the lesson first (500 characters at most).')
        // the answers of the Skills page when a lesson is turned into a skill suggestion (kybernos-skills/learned.mjs)
        if (c === 'already_proposed') return kt('Ces leçons ont déjà donné une suggestion de skill.', 'These lessons already made a skill suggestion.')
        if (c === 'too_many_pending') return kt('5 suggestions de skills attendent déjà : réponds à l’une d’elles dans Skills d’abord.', '5 skill suggestions are already waiting: answer one in Skills first.')
        if (c === 'no_free_name') return kt('Aucun nom libre pour ce skill.', 'No free name for this skill.')
        if (c === 'no_lessons') return kt('Aucune leçon à transformer en skill.', 'No lesson to turn into a skill.')
        if (c === 'requete_invalide') return kt('Cette requête a été refusée comme invalide.', 'That request was refused as invalid.')
        if (c === 'a_change') return kt('Ça a changé depuis l’analyse : analyse à nouveau.', 'It changed since the scan: look again.')
        if (c === 'groupe_inconnu') return kt('Cette suggestion est périmée : analyse à nouveau.', 'That suggestion is out of date: look again.')
        if (c === 'garde_invalide') return kt('Cet élément ne fait pas partie de la suggestion : analyse à nouveau.', 'That item is not part of the suggestion: look again.')
        if (c === 'epingle_protege') return kt('Un souvenir épinglé n’est jamais supprimé : garde celui-là.', 'A pinned memory is never removed: keep that one.')
        if (c === 'trop_de_suppressions') return kt('Ça en supprime trop d’un coup (50 au maximum).', 'That removes too many at once (50 at most).')
        if (c === 'kyber_plein') return kt('Cette équipe d’agents IA garde déjà 50 leçons : supprime-en, puis défais.', 'That AI agent team already holds 50 lessons: delete some, then undo.')
        if (c === 'archive_perimee') return kt('Trop ancien pour être défait (30 jours).', 'Too old to undo (30 days).')
        if (c === 'deja_annule') return kt('Déjà défait.', 'Already undone.')
        if (c === 'aucun_scan') return kt('Analyse d’abord : rien n’a encore été analysé.', 'Look first: nothing has been scanned yet.')
        if (c === 'deja_en_cours') return kt('Un rangement est déjà en cours.', 'A tidy-up is already running.')
        if (c === 'pas_de_modele_detude') return kt('Aucun modèle d’étude n’est disponible : il est réglé sur Aucun dans les Réglages Kybernos, ou aucun modèle connecté ne convient encore.', 'No Study model is available: it is set to None in Kybernos Settings, or no connected model fits yet.')
        if (c === 'llm_indisponible') return kt('Le service de modèles n’est pas disponible pour l’instant.', 'The model service is not available right now.')
        if (c === 'delai_depasse') return kt('Le modèle d’étude n’a pas répondu à temps.', 'The Study model did not answer in time.')
        if (c === 'modele_en_erreur') return kt('Le modèle d’étude est injoignable.', 'The Study model could not be reached.')
        if (c === 'valeur_invalide' || c === 'cle_inconnue') return kt('Ce réglage a été refusé.', 'That setting was refused.')
        if (c.indexOf('refus_') === 0) return kt('Le serveur a refusé la requête (' + c.slice(6) + ').', 'The server refused the request (' + c.slice(6) + ').')
        if (/^(?:erreur interne|internal error)$/.test(c)) return kt('Quelque chose a échoué dans le plugin.', 'Something failed inside the plugin.')
        return c === '' ? kt('Une erreur est survenue.', 'Something went wrong.') : kt('Une erreur est survenue (' + c + ').', 'Something went wrong (' + c + ').')
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
        const h24 = Math.round(m / 60)
        const d = Math.round(m / 1440)
        if (m < 1) return kt('à l’instant', 'just now')
        if (m < 60) return kt('il y a ' + m + ' minute' + sfx(m), plural(m, 'minute') + ' ago')
        if (m < 1440) return kt('il y a ' + h24 + ' heure' + sfx(h24), plural(h24, 'hour') + ' ago')
        return kt('il y a ' + d + ' jour' + sfx(d), plural(d, 'day') + ' ago')
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

      const tidyModes = () => [['auto', kt('Fusionner seul les doublons proches', 'Merge close matches by itself')], ['ask', kt('Me demander d’abord', 'Ask me first')]]
      const TIDY_DEFAULT_SETTINGS = { mode: 'auto', schedule: 'weekly', brain: false }

      /** The settings the page shows: the lessons host's (it never needs the cloud), else the memories'. Both are written together. */
      const tidySettingsOf = (t) => (t.les !== null && t.les.settings !== undefined ? t.les.settings : (t.mem !== null && t.mem.settings !== undefined ? t.mem.settings : TIDY_DEFAULT_SETTINGS))

      // ── Team lessons: the pure pieces ───────────────────────────────────────────────────────────────────
      // ── « Memory looks after itself »: the line under the title, the one step it may need, the cap note ──────
      const PAGE_TITLE = 'Memory & Lessons'
      const pageTitle = () => kt('Mémoire & Leçons', PAGE_TITLE)

      /** Hand lessons to the Skills page as a SUGGESTION: nothing is active before the person accepts it there. Fixed rules, no model, no cost. */
      const suggestSkill = async (lessons) => {
        const r = await api('/kybernos-skills/learned/from-lessons', { lessons: lessons.map((l) => ({ text: l.text, tags: Array.isArray(l.tags) ? l.tags : [], kyber: l.kyber })) })
        try { if (r.ok === true && window.__KB_LEARNED__ !== undefined && typeof window.__KB_LEARNED__.refresh === 'function') window.__KB_LEARNED__.refresh() } catch (e) { /* the menu dot catches up at its next look */ }
        return r
      }

      /** The one step: connect the account. The cloud plugin's card listens for this window event (the Models page sends it too). */
      const connectAccount = () => { try { window.dispatchEvent(new CustomEvent('kybernos-cloud:open')) } catch (e) { /* the card is not mounted: nothing to open */ } }

      const isTeamAdmin = (role) => role === 'owner' || role === 'admin'
      const minutesSince = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, Math.round(((now === undefined ? Date.now() : now) - t) / 60000)) : null }
      /** « Waiting for review », « Approved »… with the chip tone the page uses. */
      const teamStatusChip = (l) => ({ proposed: [kt('En attente d’examen', 'Waiting for review'), 'warn'], approved: [kt('Approuvée', 'Approved'), 'ok'], rejected: [kt('Refusée', 'Rejected'), ''], retired: [kt('Retirée', 'Retired'), ''] }[l.status] || [String(l.status), ''])
      /** The search of the team list: every word typed is somewhere in the text, the tags, the kyber or a name (the list is at most 200 long). */
      const teamMatches = (l, q) => {
        const words = String(q === undefined || q === null ? '' : q).toLowerCase().split(/\s+/).filter((w) => w !== '')
        if (words.length === 0) return true
        const hay = (l.text + ' ' + l.tags.join(' ') + ' ' + (l.kyber || kt('général', 'general')) + ' ' + (l.proposedName || '') + ' ' + (l.reviewedName || '')).toLowerCase()
        return words.every((w) => hay.indexOf(w) >= 0)
      }
      /** The line under a team lesson: who proposed it, who approved it, and when. */
      const teamMeta = (l, now) => {
        const out = []
        if (l.proposedName !== null) out.push(kt('Proposée par ' + l.proposedName, 'Proposed by ' + l.proposedName))
        if (l.status === 'approved' && l.reviewedName !== null) out.push(kt('approuvée par ' + l.reviewedName, 'approved by ' + l.reviewedName))
        if (l.status === 'rejected' && l.reviewedName !== null) out.push(kt('refusée par ' + l.reviewedName, 'rejected by ' + l.reviewedName))
        const mins = minutesSince(l.updatedAt === null ? l.createdAt : l.updatedAt, now)
        const age = ageLabel(mins)
        if (age !== '') out.push(kt(mins < 1 ? 'à l’instant' : 'il y a ' + age, age === 'now' ? 'just now' : age + ' ago'))
        return out
      }

      /** The Study model, as the page needs it: its name (the same file for both hosts), whether it was picked automatically (the
       *  setting is empty) or the person chose none, whether a model service exists, and how many unclear pairs wait. A host that
       *  says nothing of `auto` and `none` (an older build) gives neither. */
      const tidyBrain = (t) => {
        const views = [t.mem, t.les].filter((x) => x !== null && x.brain !== undefined)
        const model = views.map((x) => x.brain.model).find((m) => typeof m === 'string' && m !== '') || ''
        return {
          model, llm: views.some((x) => x.brain.llm === true),
          auto: model !== '' && views.some((x) => x.brain.model === model && x.brain.auto === true),
          none: model === '' && views.some((x) => x.brain.none === true),
          unclear: views.reduce((n, x) => n + (Number.isFinite(x.unclear) ? x.unclear : 0), 0)
        }
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

      // ── The Memory page (2026-11-20): its pure pieces ───────────────────────────────────────────────────
      /** A note's name and the rest, for a row and a heading (the account keeps only the text): the first sentence, capitalised, with no final full stop; a first sentence over 60 characters is cut, and the rest is then the whole text. */
      const noteParts = (text) => {
        const t = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim()
        if (t === '') return { name: '', rest: '' }
        const m = /^(.{6,}?[.!?])(?:\s+(?=\S)|$)/.exec(t)
        let name = m !== null ? m[1] : t
        let rest = m !== null ? t.slice(m[0].length).trim() : ''
        if (name.length > 60) {
          const cut = name.slice(0, 57)
          const sp = cut.lastIndexOf(' ')
          name = (sp > 20 ? cut.slice(0, sp) : cut).replace(/[\s,;:.!?-]+$/, '') + '\u2026'
          rest = t
        } else name = name.replace(/[.!?]+$/, '')
        return { name: name.charAt(0).toUpperCase() + name.slice(1), rest }
      }
      const noteName = (text) => noteParts(text).name

      const NOTE_MAX_CHARS = 2000
      const IMPORT_MAX_LINES = 300
      /** What another assistant answered, as one note per line: bullets, numbers and headings go, short lines go, a repeat inside the paste goes. */
      const parseImport = (text) => {
        const seen = new Set()
        const out = []
        for (const raw of String(text === undefined || text === null ? '' : text).split(/\r?\n/)) {
          const line = raw.replace(/^[\s\-*•#>]+/, '').replace(/^\d+[.)]\s+/, '').trim().slice(0, NOTE_MAX_CHARS)
          if (line.length <= 3) continue
          const key = line.toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          out.push(line)
          if (out.length >= IMPORT_MAX_LINES) break
        }
        return out
      }

      /** The import's outcome in one sentence. */
      const importResult = ({ added, same, failed }) => {
        const n = (c) => kt(c + ' note' + sfx(c), plural(c, 'note'))
        const there = same === 1 ? kt('Déjà dans ta mémoire : rien n’a été ajouté.', 'Nothing added: it is already in your memory.') : kt('Rien n’a été ajouté : les ' + same + ' sont déjà dans ta mémoire.', 'Nothing added: all ' + same + ' are already in your memory.')
        const bad = kt(failed + ' n’' + (failed === 1 ? 'a' : 'ont') + ' pas pu être ajoutée' + sfx(failed) + '.', failed + ' could not be added.')
        if (added > 0) return kt('Ajouté : ' + n(added) + '.', 'Added ' + n(added) + '.') + (same > 0 ? kt(' ' + same + ' déjà dans ta mémoire.', ' ' + same + ' already in your memory.') : '') + (failed > 0 ? ' ' + bad : '')
        if (failed > 0) return (same > 0 ? kt('Rien n’a été ajouté : ' + same + ' déjà dans ta mémoire. ', 'Nothing added: ' + same + ' already in your memory. ') : '') + bad
        return same > 0 ? there : kt('Rien à ajouter.', 'Nothing to add.')
      }

      /**
       * The three switches of the page, over the two settings groups (`mem` = the account's, `les` = this machine's lessons; either can be `null`).
       * « Use memory » = what is sent in chats (lessons are only sent while their recording is on, as the host does), « Learn from chats » = the
       * automatic capture of notes and the recording of lessons, « Include sensitive topics » = the capture prompt of the account's notes.
       */
      const switchState = (mem, les) => {
        const m = mem !== null && mem !== undefined ? mem : {}
        const l = les !== null && les !== undefined ? les : {}
        return {
          use: (m.memories === true && m.context === true) || (l.lessons === true && l.context === true),
          learn: (m.memories === true && m.capture === true) || l.lessons === true,
          sensitive: m.memories === true && m.sensitive === true,
        }
      }
      const switchPatches = (key, value, mem, les) => {
        const on = value === true
        const patch = { cloud: null, lessons: null }
        if (key === 'use') { patch.cloud = on ? { memories: true, context: true } : { context: false }; patch.lessons = { context: on } }
        else if (key === 'learn') { patch.cloud = on ? { memories: true, capture: true } : { capture: false }; patch.lessons = { lessons: on } }
        else if (key === 'sensitive') patch.cloud = { sensitive: on }
        if (mem === null || mem === undefined) patch.cloud = null
        if (les === null || les === undefined) patch.lessons = null
        return patch
      }

      /** What can still be brought back (the tidy archive keeps it 30 days): merges and deletes, newest first, from both hosts. A shortened or retitled lesson is not a removal. */
      const recentlyRemoved = (t, now) => {
        const rows = []
        for (const src of ['mem', 'les']) {
          const view = t !== null && t !== undefined ? t[src] : null
          for (const l of view !== null && view !== undefined && Array.isArray(view.log) ? view.log : []) {
            if (l.canUndo !== true || l.undone === true || l.kind === 'compact' || l.kind === 'title' || !(l.removed > 0)) continue
            const del = l.kind === 'delete'
            const n = l.removed + 1
            const count = src === 'mem' ? kt(n + ' notes', n + ' notes') : kt(n + ' leçons', n + ' lessons')
            const why = del ? kt('Tu l’as supprimée.', 'You deleted it.')
              : l.by === 'you' ? kt('Tu as fusionné ' + count + ' en une seule.', 'You combined ' + count + ' into one.')
                : kt(count + ' fusionnées en une seule (doublons exacts).', count + ' combined into one (exact repeats).')
            const label = typeof l.label === 'string' && l.label.trim() !== '' ? l.label.trim() : (src === 'mem' ? kt('Notes fusionnées', 'Combined notes') : kt('Leçons fusionnées', 'Combined lessons'))
            rows.push({ id: l.id, src, at: l.at, name: label, why, when: whenLabel(l.at, now), button: del ? 'Restore' : 'Undo', kyber: l.kyber })
          }
        }
        return rows.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
      }

      /** A date in the page's words: « Nov 17 » (the year only when it is not this one). */
      const noteDate = (ageMinutes, now) => {
        if (typeof ageMinutes !== 'number' || !Number.isFinite(ageMinutes)) return ''
        const at = now === undefined ? Date.now() : now
        try {
          const t = new Date(at - ageMinutes * 60000)
          const opts = t.getFullYear() === new Date(at).getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
          return t.toLocaleDateString(lang() === 'fr' ? 'fr-FR' : 'en-US', opts)
        } catch (e) { return ageLabel(ageMinutes) }
      }

      /** Lessons grouped by team, in the order the teams first appear. */
      const groupLessons = (items) => {
        const by = new Map()
        for (const it of Array.isArray(items) ? items : []) { if (!by.has(it.kyber)) by.set(it.kyber, []); by.get(it.kyber).push(it) }
        return Array.from(by, ([kyber, list]) => ({ kyber, items: list }))
      }

      // The export: plain text files in a zip, made in the page (nothing leaves this computer, nothing is sent anywhere).
      const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0 } return t })()
      const crc32 = (bytes) => { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
      /** A zip of stored (uncompressed) files, names in UTF-8. `files` = [{ name, text }]. */
      const zipFiles = (files) => {
        const enc = new TextEncoder()
        const now = new Date()
        const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
        const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
        const parts = []
        const central = []
        let offset = 0
        const put = (len, fill) => { const b = new Uint8Array(len); fill(new DataView(b.buffer)); return b }
        for (const f of files) {
          const name = enc.encode(f.name)
          const data = enc.encode(f.text)
          const crc = crc32(data)
          const head = put(30 + name.length, (v) => { v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true); v.setUint16(10, dosTime, true); v.setUint16(12, dosDate, true); v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true); v.setUint16(28, 0, true) })
          head.set(name, 30)
          const entry = put(46 + name.length, (v) => { v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true); v.setUint16(12, dosTime, true); v.setUint16(14, dosDate, true); v.setUint32(16, crc, true); v.setUint32(20, data.length, true); v.setUint32(24, data.length, true); v.setUint16(28, name.length, true); v.setUint32(42, offset, true) })
          entry.set(name, 46)
          parts.push(head, data)
          central.push(entry)
          offset += head.length + data.length
        }
        const dirSize = central.reduce((n, e) => n + e.length, 0)
        const end = put(22, (v) => { v.setUint32(0, 0x06054b50, true); v.setUint16(8, files.length, true); v.setUint16(10, files.length, true); v.setUint32(12, dirSize, true); v.setUint32(16, offset, true) })
        const all = parts.concat(central, [end])
        const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
        let at = 0
        for (const p of all) { out.set(p, at); at += p.length }
        return out
      }
      /** The files of an export: one about you, one per team, a note or a lesson per line. */
      const exportFiles = ({ about, teams }) => {
        const oneLine = (s) => String(s === undefined || s === null ? '' : s).replace(/\s*[\r\n]+\s*/g, ' ').trim()
        const lines = (list, key) => (Array.isArray(list) ? list : []).map((x) => oneLine(x === null || x === undefined ? '' : x[key])).filter((x) => x !== '')
        const out = []
        const mine = lines(about, 'content')
        if (mine.length > 0) out.push({ name: 'about-you.txt', text: mine.join('\n') + '\n' })
        const used = new Set()
        for (const t of Array.isArray(teams) ? teams : []) {
          const l = lines(t.lessons, 'text')
          if (l.length === 0) continue
          const base = String(t.kyber === undefined || t.kyber === null ? '' : t.kyber).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'team'
          let slug = base
          let n = 2
          while (used.has(slug)) { slug = base + '-' + n; n += 1 }
          used.add(slug)
          out.push({ name: 'teams/' + slug + '.txt', text: l.join('\n') + '\n' })
        }
        return out
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
.kbmem-grow{flex:1}.kbmem-muted{color:var(--m-muted)}.kbmem-tiny{font-size:12px;color:var(--m-cap)}
.kbmem-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.kbmem-lead{margin:4px 0 22px;font-size:13px;color:var(--m-muted)}
.kbmem-top{margin-bottom:8px}
.kbmem-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:600;background:var(--m-primary);color:var(--m-primary-ink);white-space:nowrap}
.kbmem-btn.ghost{background:transparent;color:var(--m-ink2);border:1px solid var(--m-line2)}.kbmem-btn.ghost:hover{background:var(--m-hover)}
.kbmem-btn.danger{background:transparent;color:var(--m-danger);border:1px solid var(--m-line2)}
.kbmem-btn[disabled]{opacity:.4;pointer-events:none}
.kbmem-seg{display:inline-flex;align-items:center;padding:3px;border:1px solid var(--m-line2);border-radius:999px;min-height:38px;max-width:100%;flex:none}
.kbmem-seg button{height:30px;padding:0 14px;border-radius:999px;font-size:13px;font-weight:600;color:var(--m-ink2);display:inline-flex;gap:6px;align-items:center}
.kbmem-seg button.on{background:var(--m-primary);color:var(--m-primary-ink)}
.kbmem-seg button[disabled]{opacity:.45;pointer-events:none}
.kbmem-seg.sm{min-height:32px}.kbmem-seg.sm button{height:24px;padding:0 10px;font-size:12px}
.kbmem-cnt{font-size:11px;font-weight:600;color:var(--m-ink2);font-variant-numeric:tabular-nums}
.kbmem-row2{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.kbmem-tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.kbmem-field{display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center;flex:1 1 280px;min-width:0;min-height:36px;padding:2px 12px;border-radius:var(--m-r-md);background:var(--m-fill);color:var(--m-muted)}
.kbmem-field input{flex:1 1 120px;min-width:0;background:none;border:0;outline:0;color:var(--m-ink);font:inherit}
/* the browser's default placeholder is a mid grey: 2.6:1 on the dark field */
.kbmem-field input::placeholder{color:var(--m-ink2)}
.kbmem-chip.close{color:var(--m-acc);border-color:var(--m-acc)}
.kbmem-chip{display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;border:1px solid var(--m-line2);font-size:11px;font-weight:500;color:var(--m-ink2);white-space:nowrap}
.kbmem-chip.ok{color:var(--m-ok);background:var(--m-ok-bg);border-color:transparent}
.kbmem-chip.warn{color:var(--m-warn);background:var(--m-warn-bg);border-color:transparent}
.kbmem-sug{margin:0 0 14px;padding:12px 16px;border-radius:var(--m-r-md);border:1px dashed var(--m-line3);background:var(--m-surf)}
.kbmem-sug-h{display:flex;align-items:center;gap:4px;font-size:13px;margin-bottom:6px}.kbmem-sug-why{font-size:12px;color:var(--m-cap)}
.kbmem-sug-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--m-line)}.kbmem-sug-row:first-of-type{border-top:0}
.kbmem-sug-main{flex:1 1 280px;min-width:0}.kbmem-sug-text{font-size:13.5px;color:var(--m-ink);overflow-wrap:anywhere}.kbmem-sug-proof{font-size:12px;color:var(--m-cap);margin-top:2px}
.kbmem-sug-act{display:flex;gap:6px;flex:none}
.kbmem-note{display:flex;gap:12px;align-items:flex-start;margin:0 0 14px;padding:12px 16px;border-radius:var(--m-r-md);background:var(--m-surf);font-size:13px;color:var(--m-ink2)}
.kbmem-note.warn{background:var(--m-warn-bg)}.kbmem-note a,.kbmem-link{color:var(--m-acc);font-weight:600;cursor:pointer}
.kbmem-list{border-top:1px solid var(--m-line2)}
.kbmem-r{display:flex;gap:12px;align-items:flex-start;width:100%;padding:12px 8px;border-bottom:1px solid var(--m-line)}.kbmem-r:hover{background:var(--m-hover)}
.kbmem-kd{flex:none;width:8px;height:8px;margin-top:7px;border-radius:50%;background:var(--m-cap)}
.kbmem-kd.fact{background:var(--m-acc)}.kbmem-kd.preference{background:var(--m-ok)}.kbmem-kd.policy{background:var(--m-warn)}.kbmem-kd.event{background:var(--m-cap)}.kbmem-kd.lesson{border-radius:2px;transform:rotate(45deg);background:var(--m-primary)}
.kbmem-tx{flex:1;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}
.kbmem-mt{flex:none;display:flex;gap:8px;align-items:center;margin-top:1px;font-size:12px;color:var(--m-cap)}
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
/* The « Noted » line under the last answer of a chat: quiet, one line each, the page's own token chain so both themes follow */
.kbmem-noted-wrap{display:flex;flex-direction:column;gap:4px;margin:8px 0 2px;max-width:640px}
.kbmem-noted{--m-cap:var(--kb-caption,var(--dsw-alias-label-tertiary,#81858c));--m-acc:var(--kb-accent,#7aaaff);--m-danger:var(--kb-danger,#f25a5a);display:flex;flex-wrap:wrap;align-items:center;gap:2px 10px;font-size:12.5px;line-height:1.5;color:var(--m-cap)}
.kbmem-noted-text{min-width:0;overflow-wrap:anywhere}
.kbmem-noted-err{color:var(--m-danger)}
.kbmem-noted button{background:none;border:0;padding:0;font:inherit;font-weight:600;color:var(--m-acc);cursor:pointer}
.kbmem-noted button:hover{text-decoration:underline}
.kbmem-noted button:disabled{opacity:.5;cursor:default;text-decoration:none}
.kbmem-noted button:focus-visible{outline:2px solid var(--m-acc);outline-offset:2px;border-radius:3px}
/* Everything drawn on the toast fill (--m-toast) takes the toast's own ink, the label that pairs with it: the fill is dark in both schemes, the page ink is dark in the light one (1.56:1, recette L1-21). The accent is lifted
   toward white on that fill, so « Undo » reads in both schemes too. */
.kbmem-toast{--m-ink:var(--dsw-alias-toast-label,#fff);--m-ink2:color-mix(in srgb,var(--m-ink) 78%,transparent);--m-muted:color-mix(in srgb,var(--m-ink) 70%,transparent);--m-cap:color-mix(in srgb,var(--m-ink) 66%,transparent);--m-acc:color-mix(in srgb,var(--kb-accent,#7aaaff) 55%,#fff);color:var(--m-ink)}
.kbmem-sec{margin:28px 0 0}.kbmem-sec>h2{margin:0;display:flex;gap:8px;align-items:baseline;font-size:14px;font-weight:600}.kbmem-sec>h2 small{font-size:12px;font-weight:400;color:var(--m-muted)}
.kbmem-srow{display:flex;gap:24px;align-items:center;justify-content:space-between;padding:16px 0;border-bottom:1px solid var(--m-line2);max-width:760px}
.kbmem-srow .lab{display:flex;gap:8px;align-items:center}.kbmem-srow .desc{font-size:12px;line-height:18px;color:var(--m-muted);margin-top:2px}.kbmem-srow .why{margin-top:4px;font-size:12px;line-height:18px;color:var(--m-warn)}
.kbmem-srow .ctl{flex:none}.kbmem-srow.locked .ctl{opacity:.4;pointer-events:none}
.kbmem-spin{width:18px;height:18px;border-radius:50%;border:2px solid var(--m-fill);border-top-color:var(--m-muted);animation:kbmem-spin .8s linear infinite}
@keyframes kbmem-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.kbmem-spin{animation:none}}
/* The Memory page (2026-11-20): settings rows with switches, « Your memory », one note, and its dialogs. Same tokens as the rest of the page. */
.kbmem-m{display:flex;flex-direction:column;min-width:0}
.kbmem-m.has-say{min-height:calc(100vh - 160px)}
.kbmem-sec.first{margin-top:8px}
.kbmem-nsub{margin:2px 0 8px;font-size:13px;color:var(--m-muted)}
.kbmem-sw{position:relative;flex:none;width:34px;height:20px;border-radius:999px;background:var(--m-fill);border:1px solid var(--m-line3);transition:background .15s,border-color .15s}
.kbmem-sw::after{content:"";position:absolute;top:2px;inset-inline-start:2px;width:14px;height:14px;border-radius:999px;background:var(--m-cap);transition:transform .15s,background .15s}
.kbmem-sw[aria-checked=true]{background:var(--m-primary);border-color:var(--m-primary)}
.kbmem-sw[aria-checked=true]::after{transform:translateX(14px);background:var(--m-primary-ink)}
[dir=rtl] .kbmem-sw[aria-checked=true]::after{transform:translateX(-14px)}
.kbmem-sw[disabled]{opacity:.4;pointer-events:none}
@media (prefers-reduced-motion:reduce){.kbmem-sw,.kbmem-sw::after{transition:none}}
.kbmem-instr,.kbmem-ta{width:100%;min-height:76px;padding:12px 14px;border-radius:var(--m-r-md);border:1px solid transparent;background:var(--m-fill);color:var(--m-ink);font:inherit;font-size:14px;line-height:22px;resize:vertical;outline:0}
.kbmem-instr::placeholder,.kbmem-ta::placeholder{color:var(--m-ink2)}
.kbmem-ta{min-height:96px;border-color:var(--m-line3);background:var(--m-surf)}
.kbmem-ta.in{height:130px;border-color:transparent;background:var(--m-fill)}
.kbmem-nhint{display:flex;gap:12px;align-items:center;margin-top:8px;font-size:12.5px;color:var(--m-cap);min-height:30px}
.kbmem-nhint .err{color:var(--m-danger)}
.kbmem-nfoot{padding:16px 8px 8px;font-size:13px;color:var(--m-cap)}
.kbmem-link{color:var(--m-acc);font-weight:600;cursor:pointer}.kbmem-link.danger{color:var(--m-danger);font-weight:500}.kbmem-link.rlink{font-size:13px;font-weight:500}
.kbmem-back{display:inline-flex;gap:8px;align-items:center;align-self:flex-start;height:30px;margin:-4px 0 14px -6px;padding:0 8px;border-radius:var(--m-r-sm);font-size:14px;color:var(--m-ink)}.kbmem-back:hover{background:var(--m-hover)}
.kbmem-back .kbmem-ico{width:16px;height:16px}
.kbmem-ntop{display:flex;gap:12px;align-items:center;margin-bottom:4px}
.kbmem-nh1{font-size:20px;line-height:26px;font-weight:600;margin:0}
.kbmem-nsearch{display:flex;gap:8px;align-items:center;max-width:340px;min-height:36px;margin-top:12px;padding:2px 12px;border-radius:var(--m-r-md);background:var(--m-fill);color:var(--m-muted)}
.kbmem-nsearch input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--m-ink);font:inherit}
.kbmem-nsearch input::placeholder{color:var(--m-ink2)}
.kbmem-nsec{margin:22px 0 0;padding:0 8px 10px;font-size:14px;font-weight:600;border-bottom:1px solid var(--m-line2);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.kbmem-nsec .cp{font-weight:400;font-size:12.5px;color:var(--m-cap)}
.kbmem-nrow{position:relative;display:grid;grid-template-columns:minmax(110px,210px) minmax(0,1fr) auto;gap:16px;align-items:center;width:100%;padding:12px 8px;border-bottom:1px solid var(--m-line);cursor:pointer}
.kbmem-nrow:hover{background:var(--m-hover)}
.kbmem-nrow .nm{min-width:0;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbmem-nrow .sm{color:var(--m-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.kbmem-nrow .dt{color:var(--m-cap);font-size:13px;white-space:nowrap}
.kbmem-nrow.solo{grid-template-columns:minmax(0,1fr) auto}.kbmem-nrow.sub{padding-inline-start:28px}.kbmem-nrow.dimtext{color:var(--m-cap);cursor:default;display:block}.kbmem-nrow.dimtext:hover{background:none}
.kbmem-ngrp{display:flex;gap:10px;align-items:center;width:100%;margin-top:6px;padding:11px 12px;border-radius:var(--m-r-md);font-size:14px}
.kbmem-ngrp:hover{background:var(--m-hover)}.kbmem-ngrp.open{background:var(--m-fill)}.kbmem-ngrp .ct{font-size:12px;color:var(--m-cap)}
.kbmem-nmore{display:block;width:100%;padding:11px 8px;font-size:13px;color:var(--m-acc);font-weight:600;border-bottom:1px solid var(--m-line)}.kbmem-nmore.sub{padding-inline-start:28px}
.kbmem-ninfo{display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;padding:13px 8px;border-bottom:1px solid var(--m-line);font-size:13.5px;color:var(--m-muted)}
.kbmem-nsay{position:sticky;bottom:0;margin-top:auto;padding:18px 0 20px;background:linear-gradient(to bottom,transparent,var(--dsw-alias-bg-layer-2,#2c2c2e) 28%)}
.kbmem-nsay .box{display:flex;gap:10px;align-items:center;min-height:50px;padding:5px 6px 5px 20px;border-radius:999px;background:var(--m-fill);border:1px solid var(--m-line)}
.kbmem-nsay input{flex:1;min-width:0;background:none;border:0;outline:0;color:var(--m-ink);font:inherit;font-size:14px}.kbmem-nsay input::placeholder{color:var(--m-ink2)}
.kbmem-nsend{width:38px;height:38px;border-radius:999px;display:grid;place-items:center;background:var(--m-primary);color:var(--m-primary-ink)}.kbmem-nsend[disabled]{opacity:.35;pointer-events:none}
.kbmem-nempty{display:grid;justify-items:center;gap:10px;padding:56px 24px 24px;text-align:center;color:var(--m-muted)}.kbmem-nempty h3{margin:0;color:var(--m-ink);font-size:16px}.kbmem-nempty p{margin:0;max-width:46ch}
.kbmem-m .dim{opacity:.4;pointer-events:none}
.kbmem-dh{display:flex;gap:10px;align-items:flex-start;margin-bottom:22px;flex-wrap:wrap}.kbmem-dh h2{margin:0;font-size:20px;line-height:30px;font-weight:600;flex:1 1 220px;min-width:0;overflow-wrap:anywhere}
.kbmem-blk{margin-top:22px}.kbmem-blk .lb{font-size:13px;color:var(--m-cap);margin-bottom:4px}.kbmem-blk .vl{font-size:15px;line-height:24px;color:var(--m-ink);max-width:62ch;overflow-wrap:anywhere;white-space:pre-wrap}
.kbmem-blk .kbmem-sel.wide{width:100%}
.kbmem-prow{display:flex;gap:16px;align-items:center;justify-content:space-between;font-size:14px}
.kbmem-nacts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:22px}
.kbmem-btn.danger.solid{background:var(--m-danger);color:#fff;border-color:transparent}
.kbmem-scrim{position:fixed;inset:0;display:grid;place-items:center;padding:16px;background:rgba(0,0,0,.5);z-index:10000}
.kbmem-dlg{width:min(480px,100%);max-height:100%;overflow:auto;padding:22px 24px;border-radius:var(--m-r-lg);background:var(--m-surf2);color:var(--m-ink);box-shadow:var(--kb-elev,0 16px 48px rgba(0,0,0,.4));display:grid;gap:14px;font-size:14px;line-height:22px}
.kbmem-dlg.wide{width:min(580px,100%)}
.kbmem-dlg h3{margin:0;font-size:17px;line-height:26px;display:flex;align-items:center}
.kbmem-hint{margin:0;font-size:13px;color:var(--m-cap)}.kbmem-hint.big{font-size:13.5px;color:var(--m-ink2)}
.kbmem-dacts{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px}
.kbmem-step{display:grid;grid-template-columns:28px minmax(0,1fr);gap:4px 12px;align-items:start}
.kbmem-step .no{width:26px;height:26px;border-radius:999px;background:var(--m-surf);border:1px solid var(--m-line2);display:grid;place-items:center;font-size:12.5px;color:var(--m-ink2)}
.kbmem-step .st{font-size:14.5px;color:var(--m-ink2);padding-top:2px}.kbmem-step .bd{grid-column:2;min-width:0}
.kbmem-promptbox{position:relative;height:120px;overflow:auto;padding:12px 14px;border-radius:var(--m-r-md);background:var(--m-surf);border:1px solid var(--m-line2);font:12.5px/20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--m-muted);white-space:pre-wrap;overflow-wrap:anywhere}
.kbmem-promptbox .copyb{position:sticky;float:right;top:0;margin:-4px -6px 0 8px}
.kbmem-tl{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 0;border-top:1px solid var(--m-line)}
.kbmem-tl .t{flex:1 1 240px;min-width:0;font-size:14px;overflow-wrap:anywhere}.kbmem-tl .d{font-size:12.5px;color:var(--m-cap)}
.kbmem-btn.sm{height:30px;padding:0 12px;font-size:12.5px}
@media (max-width:640px){.kbmem-nrow{grid-template-columns:minmax(0,1fr) auto}.kbmem-nrow .sm{display:none}.kbmem-srow{flex-wrap:wrap}.kbmem-srow .ctl{width:100%}}
.kbmem-chip.acc{color:var(--m-acc);background:var(--m-acc-bg);border-color:transparent}
.kbmem-banner{display:flex;gap:12px;align-items:center;margin-bottom:14px;padding:12px 14px;border-radius:var(--m-r-md);background:var(--m-acc-bg)}
.kbmem-banner>.kbmem-ico{width:18px;height:18px;color:var(--m-acc)}
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
.kbmem-empty .kbmem-acts{flex-wrap:wrap;justify-content:center}
@media (max-width:720px){.kbmem-foot .kbmem-grow{flex-basis:100%}.kbmem-it{flex-wrap:wrap}}
/* « Import Claude memories »: a fold above the lessons list — the counts, the two host calls, then one compact row per entry
   (a title line, a text line, and its status + buttons: never more than three). */
.kbmem-imp{margin:0 0 14px;border:1px solid var(--m-line2);border-radius:14px;background:var(--m-surf);overflow:hidden}
.kbmem-imp-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 14px;min-height:44px}
.kbmem-imp-toggle{display:inline-flex;gap:6px;align-items:center;font-size:13px;font-weight:600;color:var(--m-ink)}
.kbmem-imp-toggle .kbmem-ico{color:var(--m-ink2)}
.kbmem-imp-sum{font-size:12px;color:var(--m-cap);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;font-variant-numeric:tabular-nums}
.kbmem-imp-b{padding:0 14px 12px;border-top:1px solid var(--m-line)}
.kbmem-imp-row{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--m-line)}
.kbmem-imp-row:first-of-type{border-top:0}
.kbmem-imp-main{flex:1 1 240px;min-width:0}
.kbmem-imp-ttl{font-weight:600;color:var(--m-ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbmem-imp-tx{font-size:12.5px;line-height:18px;color:var(--m-ink2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kbmem-imp-side{flex:none;display:flex;gap:6px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.kbmem-imp-note{display:flex;gap:8px;align-items:flex-start;padding:6px 0 0;font-size:12.5px;line-height:18px;color:var(--m-muted)}
.kbmem-imp-note.err{color:var(--m-danger)}
.kbmem-imp-note .kbmem-ico{margin-top:3px}
.kbmem-imp-more{padding:8px 0 0;font-size:12px;color:var(--m-cap)}
@media (max-width:720px){.kbmem-imp-side{justify-content:flex-start}.kbmem-imp-h{gap:6px}}
`

      // ═══════════════════════════════════════════════════════════════
      // 3. SMALL COMPONENTS
      // ═══════════════════════════════════════════════════════════════
      const ICONS = {
        brain: '<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5c0 .4.1.8.2 1.1A3.5 3.5 0 0 0 4 10.8c0 1 .5 2 1.2 2.6A3.5 3.5 0 0 0 7 19a3 3 0 0 0 5-1V4.5A1.5 1.5 0 0 0 9.5 3z"/><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5c0 .4-.1.8-.2 1.1A3.5 3.5 0 0 1 20 10.8c0 1-.5 2-1.2 2.6A3.5 3.5 0 0 1 17 19a3 3 0 0 1-5-1V4.5A1.5 1.5 0 0 1 14.5 3z"/>',
        wand: '<path d="M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8 19 13M17.8 6.2 19 5M3 21l9-9M12.2 6.2 11 5"/>',
        pin: '<path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z"/>',
        search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4-4"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        check: '<path d="m5 12 5 5 9-10"/>',
        x: '<path d="M6 6l12 12M18 6 6 18"/>',
        trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
        cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z"/>',
        lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
        alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v5M12 18v.5"/>',
        left: '<path d="m15 6-6 6 6 6"/>',
        right: '<path d="m9 6 6 6-6 6"/>',
        broom: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z"/>',
        inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
        share: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M5 14v5h14v-5"/>',
        undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
        copy: '<path d="M9 9h10v10H9zM5 15V5h10"/>',
        down: '<path d="m6 9 6 6 6-6"/>',
        up: '<path d="m6 15 6-6 6 6"/>',
      }
      // The paths are this file's own constants (never user text): setting them as markup is safe.
      const Ico = (name, extra) => h('svg', { className: 'kbmem-ico' + (extra ? ' ' + extra : ''), viewBox: '0 0 24 24', 'aria-hidden': 'true', dangerouslySetInnerHTML: { __html: ICONS[name] || '' } })

      // label names the group; ariaLabel is what a screen reader says when it must differ from label (the English name stays pinned by test-client).
      const Seg = ({ items, value, onChange, small, label, ariaLabel }) => h('div', { className: 'kbmem-seg' + (small ? ' sm' : ''), role: 'group', 'aria-label': ariaLabel === undefined ? label : ariaLabel },
        items.map((it) => h('button', { key: it.v, type: 'button', className: value === it.v ? 'on' : '', 'aria-pressed': value === it.v, disabled: it.disabled === true, title: it.title, 'data-v': it.v,
          onClick: () => onChange(it.v) }, ...(Array.isArray(it.l) ? it.l : [it.l]))))

      /** One settings row, in the rhythm of DSH's General page: label + description left, control right. */
      const SettingRow = ({ label, desc, control, chip, why, locked, live, act, fold }) => h('div', { className: 'kbmem-srow' + (locked ? ' locked' : ''), 'data-act': act },
        h('div', null,
          h('div', { className: 'lab' }, label, chip || null),
          // `fold`: the description only explains; the Theme may put it behind an « i » (Simple on a phone). A description that warns or changes what the setting means never carries the mark: nothing folds without it.
          h('div', { className: 'desc', 'data-kb-desc': fold === true ? 'fold' : undefined }, desc),
          live || null,
          why ? h('div', { className: 'why', style: { pointerEvents: 'auto', opacity: 1 } }, why) : null),
        h('div', { className: 'ctl' }, control))

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

      // Skeleton rows while a list is read for the first time. The core plugin publishes ONE helper for every list
      // (window.__KB_SKEL__: same box as the real rows, a soft shimmer, a short fade-in, nothing under reduced motion);
      // without it the old spinner shows, as before.
      const kbSkel = () => {
        try {
          const k = window.__KB_SKEL__
          return (k !== null && k !== undefined && typeof k.bone === 'function' && typeof k.wrap === 'function') ? k : null
        } catch (e) { return null }
      }
      const appear = (i) => { const k = kbSkel(); return k !== null && typeof k.appear === 'function' ? k.appear(i) : '' }
      const SkelRows = (n) => {
        const k = kbSkel()
        if (k === null) return h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-spin' }))
        return k.wrap(kt('Chargement…', 'Loading…'), 'kbmem-list', Array.from({ length: n }, (_, i) => h('div', { key: 'sk' + i, className: 'kbmem-r kb-sk-row' },
          h('span', { style: { marginTop: 7, display: 'flex' } }, k.bone(8, 8, 'round')),
          h('span', { className: 'kbmem-tx', style: { display: 'flex', flexDirection: 'column', gap: 6 } }, k.bone(i % 3 === 0 ? '92%' : (i % 3 === 1 ? '74%' : '58%'), 12), i % 2 === 0 ? k.bone('46%', 12) : null),
          h('span', { className: 'kbmem-mt' }, k.bone(96, 12)))))
      }

      /**
       * What Kaby saw several times and suggests keeping (the ledger of the core plugin, kind « memory »): dashed rows above the list, Add / Edit / Discard on each. Nothing is
       * kept before Add; Add goes through the ordinary add route (a memory lives in the account, so without one the button waits and says why). Edit opens the usual sheet.
       */
      const MemSuggest = ({ connected, refreshKey, onChanged, notify, onEdit }) => {
        const [items, setItems] = useState([])
        const [busy, setBusy] = useState('')
        useEffect(() => {
          let live = true
          api('/kybernos/suggestions?kind=memory').then((r) => { if (live) setItems(r.ok === true && Array.isArray(r.items) ? r.items : []) })
          return () => { live = false }
        }, [refreshKey])
        if (items.length === 0) return null
        const resolve = (id) => api('/kybernos/suggestions', { action: 'resolve', id })
        const drop = (id) => setItems((cur) => cur.filter((x) => x.id !== id))
        const add = async (it) => {
          if (busy !== '' || connected !== true) return
          setBusy(it.id)
          const r = await api('/kybernos-cloud/memory/add', { content: it.text, kind: 'fact', pinned: false, source: 'taught' })
          setBusy('')
          if (r.ok !== true) { notify(friendlyError(r.error)); return }
          await resolve(it.id); drop(it.id); onChanged(); notify(kt('Souvenir ajouté', 'Memory added'))
        }
        const discard = async (it) => { drop(it.id); await resolve(it.id) }
        const proofOf = (f) => (f !== undefined && f !== null && typeof f === 'object' ? [f.n !== null && f.n !== undefined ? String(f.n) + '×' : '', f.span, f.where].filter((x) => x !== undefined && x !== '').join(' · ') : '')
        return h('div', { className: 'kbmem-sug', 'data-sug': 'block' },
          h('div', { className: 'kbmem-sug-h' }, h('i', { className: 'kb-ping', 'aria-hidden': 'true' }), h('b', null, kt('Kaby suggère de retenir', 'Kaby suggests remembering')), h('span', { className: 'kbmem-grow' }),
            connected === true ? null : h('span', { className: 'kbmem-sug-why', 'data-sug': 'account' }, kt('Connecte ton compte pour les garder', 'Connect your account to keep them'))),
          items.map((it) => h('div', { key: it.id, className: 'kbmem-sug-row', 'data-sug': 'row' },
            h('div', { className: 'kbmem-sug-main' }, h('div', { className: 'kbmem-sug-text' }, it.text), proofOf(it.from) === '' ? null : h('div', { className: 'kbmem-sug-proof' }, kt('Vu : ', 'Seen: ') + proofOf(it.from))),
            h('div', { className: 'kbmem-sug-act' },
              h('button', { type: 'button', className: 'kbmem-btn sm', 'data-sug': 'add', disabled: busy !== '' || connected !== true, onClick: () => { void add(it) } }, kt('Ajouter', 'Add')),
              h('button', { type: 'button', className: 'kbmem-btn sm ghost', 'data-sug': 'edit', disabled: connected !== true, onClick: () => onEdit(it, () => { void resolve(it.id).then(() => drop(it.id)) }) }, kt('Modifier', 'Edit')),
              h('button', { type: 'button', className: 'kbmem-btn sm ghost', 'data-sug': 'discard', onClick: () => { void discard(it) } }, kt('Écarter', 'Discard'))))))
      }

      // ── Import Claude memories: the pure words (exposed for test-client) ───────────────────────────
      /** How many staged entries the preview lists: the rest is one « … and N more » line. */
      const IMPORT_SHOWN = 12
      /** Status counts of a staging list, in the four statuses the host knows (anything else is ignored). */
      const importCounts = (entries) => {
        const c = { staging: 0, active: 0, pinned: 0, locked: 0 }
        for (const e of Array.isArray(entries) ? entries : []) if (e !== null && e !== undefined && c[e.status] !== undefined) c[e.status] += 1
        return c
      }
      /** One status in the page's words (French first). */
      const importWords = (status) => {
        if (status === 'staging') return kt('en attente', 'staging')
        if (status === 'active') return kt('actif', 'active')
        if (status === 'pinned') return kt('épinglé', 'pinned')
        if (status === 'locked') return kt('verrouillé', 'locked')
        return status === undefined || status === null ? '' : String(status)
      }
      /** « N staging · N active · N pinned · N locked », in the reader's language. */
      const importCountWords = (c) => kt(
        c.staging + ' en attente · ' + c.active + ' actif' + sfx(c.active) + ' · ' + c.pinned + ' épinglé' + sfx(c.pinned) + ' · ' + c.locked + ' verrouillé' + sfx(c.locked),
        c.staging + ' staging · ' + c.active + ' active · ' + c.pinned + ' pinned · ' + c.locked + ' locked')
      /** The host's own refusals of this module (claude-import.mjs), in sentences; anything else falls back. */
      const importError = (code) => {
        const c = String(code === undefined || code === null ? '' : code)
        if (c === 'entry not found') return kt('Cette entrée n’existe plus : analyse à nouveau.', 'That entry is gone: scan again.')
        if (c === 'locked entries cannot be changed') return kt('Une entrée verrouillée ne change plus.', 'A locked entry does not change.')
        if (c.indexOf('unknown status') === 0) return kt('Le serveur n’accepte pas ce statut.', 'The server does not accept that status.')
        if (/required$/.test(c)) return kt('La requête était incomplète.', 'The request was incomplete.')
        return friendlyError(c)
      }

      /**
       * « Import Claude memories »: the Claude Code memory files of this machine, brought into Kybernos
       * memory through a staging list the person promotes one entry at a time, or in bulk. The Claude files
       * are only ever READ (claude-import.mjs never writes them back). The fold sits on the Lessons tab,
       * above the list, and only appears when such files exist — or when an earlier import left entries to
       * decide on. A scan runs once when the page opens: its route only walks the Claude tree and writes
       * nothing, and it is the only way to know whether there is anything to offer.
       */
      const ClaudeImport = ({ refreshKey }) => {
        const [seen, setSeen] = useState(false)
        const [show, setShow] = useState(false)
        const [entries, setEntries] = useState([])
        const [open, setOpen] = useState(false)
        const [busy, setBusy] = useState('')
        const [note, setNote] = useState(null)
        const [scan, setScan] = useState(null)
        const [ran, setRan] = useState(null)
        useEffect(() => {
          let live = true
          Promise.all([api('/kybernos-memory/claude-import'), api('/kybernos-memory/claude-import/scan', {})]).then(([list, sc]) => {
            if (!live) return
            const items = list.ok === true && Array.isArray(list.entries) ? list.entries : []
            const files = sc.ok === true && typeof sc.total === 'number' ? sc.total : null
            const here = list.ok === true || sc.ok === true
            setEntries(items)
            setSeen(true)
            // Files found, or entries already staged: this machine has some. A scan that could not run leaves no
            // answer, and staying visible beats a dead end; a host that knows neither route offers nothing.
            setShow(here && ((files !== null && files > 0) || items.length > 0 || files === null))
            if (files !== null) setScan({ total: files })
          })
          return () => { live = false }
        }, [refreshKey])

        if (seen !== true || show !== true) return null

        const counts = importCounts(entries)
        const movable = entries.filter((e) => e.status !== 'locked').map((e) => e.id)
        const wait = busy === 'scan' ? kt('Analyse…', 'Scanning…') : busy === 'import' ? kt('Importation…', 'Importing…') : null

        const runScan = async () => {
          if (busy !== '') return
          setBusy('scan')
          const r = await api('/kybernos-memory/claude-import/scan', {})
          setBusy('')
          // A refusal is read too: the fold opens so the message is not hidden behind a closed header.
          if (r.ok !== true) { setOpen(true); return setNote({ tone: 'err', text: importError(r.error) }) }
          setScan({ total: typeof r.total === 'number' ? r.total : 0 })
          setShow(true)
          setOpen(true)
          setNote(null)
        }

        const runApply = async () => {
          if (busy !== '') return
          setBusy('import')
          const r = await api('/kybernos-memory/claude-import/apply', {})
          if (r.ok !== true) { setBusy(''); setOpen(true); return setNote({ tone: 'err', text: importError(r.error) }) }
          setRan({ imported: typeof r.imported === 'number' ? r.imported : 0, duplicates: typeof r.duplicates === 'number' ? r.duplicates : 0, skipped: typeof r.skipped === 'number' ? r.skipped : 0 })
          const l = await api('/kybernos-memory/claude-import')
          setBusy('')
          setOpen(true)
          if (l.ok === true && Array.isArray(l.entries)) setEntries(l.entries)
          setNote(null)
        }

        const setStatus = async (id, status) => {
          if (busy !== '') return
          setBusy('status')
          const r = await api('/kybernos-memory/claude-import/status', { id, status })
          setBusy('')
          if (r.ok !== true) return setNote({ tone: 'err', text: importError(r.error) })
          const next = r.entry !== null && r.entry !== undefined && typeof r.entry === 'object' ? r.entry : null
          setEntries((cur) => cur.map((x) => (x.id !== id ? x : (next !== null ? Object.assign({}, x, next) : Object.assign({}, x, { status })))))
          setNote(null)
        }

        const bulk = async (status) => {
          if (busy !== '' || movable.length === 0) return
          setBusy('bulk')
          const r = await api('/kybernos-memory/claude-import/status-bulk', { ids: movable, status })
          const l = await api('/kybernos-memory/claude-import')
          setBusy('')
          if (r.ok !== true) return setNote({ tone: 'err', text: importError(r.error) })
          if (l.ok === true && Array.isArray(l.entries)) setEntries(l.entries)
          const n = typeof r.changed === 'number' ? r.changed : 0
          setNote({ tone: 'ok', text: kt(n + ' entrée' + sfx(n) + (n === 1 ? ' mise à jour' : ' mises à jour'), n + (n === 1 ? ' entry' : ' entries') + ' updated') })
        }

        const scanWords = scan === null ? null : kt(scan.total + ' fichier' + sfx(scan.total) + ' de mémoire Claude trouvé' + sfx(scan.total), scan.total + ' Claude memory file' + sfx(scan.total) + ' found')
        const ranWords = ran === null ? null : kt(ran.imported + ' importé' + sfx(ran.imported) + ' · ' + ran.duplicates + ' doublon' + sfx(ran.duplicates) + ' · ' + ran.skipped + ' ignoré' + sfx(ran.skipped),
          ran.imported + ' imported · ' + ran.duplicates + ' duplicate' + sfx(ran.duplicates) + ' · ' + ran.skipped + ' skipped')

        // One entry, three lines at most: its title, its text, then the status and the buttons on one line.
        const rowOf = (e) => {
          const st = typeof e.status === 'string' ? e.status : 'staging'
          const chip = st === 'active' ? ' ok' : st === 'staging' ? ' warn' : st === 'pinned' ? ' acc' : ''
          const ttl = String(e.title === undefined || e.title === null || e.title === '' ? e.id : e.title)
          const tx = String(e.content === undefined || e.content === null ? '' : e.content)
          const act = (status, label) => h('button', { key: status, type: 'button', className: 'kbmem-btn sm ghost', 'data-act': 'imp-' + status, disabled: busy !== '', onClick: () => { void setStatus(e.id, status) } }, label)
          return h('div', { key: e.id, className: 'kbmem-imp-row', 'data-imp-row': st },
            // The two lines are cut, so the whole text stays reachable as the tooltip.
            h('div', { className: 'kbmem-imp-main' },
              h('div', { className: 'kbmem-imp-ttl', title: ttl }, ttl),
              h('div', { className: 'kbmem-imp-tx', title: tx }, tx)),
            h('div', { className: 'kbmem-imp-side' },
              h('span', { className: 'kbmem-chip' + chip }, importWords(st)),
              e.project === undefined || e.project === null || e.project === '' ? null : h('span', { className: 'kbmem-tiny' }, String(e.project)),
              st === 'locked' ? h('span', { className: 'kbmem-tiny', title: kt('Verrouillée : son statut ne change plus', 'Locked: its status no longer changes') }, Ico('lock'))
                : [st === 'active' ? null : act('active', kt('Activer', 'Activate')), st === 'pinned' ? null : act('pinned', kt('Épingler', 'Pin')), act('locked', kt('Verrouiller', 'Lock'))]))
        }

        const shown = entries.slice(0, IMPORT_SHOWN)
        return h('div', { className: 'kbmem-imp', 'data-imp': 'block' },
          h('div', { className: 'kbmem-imp-h' },
            h('button', { type: 'button', className: 'kbmem-imp-toggle', 'aria-expanded': open, 'aria-controls': 'kbmem-imp-body', 'data-act': 'imp-toggle', onClick: () => setOpen(!open) },
              Ico(open ? 'up' : 'down'), h('b', null, kt('Importer des souvenirs Claude', 'Import Claude memories'))),
            h('span', { className: 'kbmem-imp-sum', 'data-imp': 'counts' }, importCountWords(counts)),
            h('span', { className: 'kbmem-grow' }),
            wait === null ? null : h('span', { className: 'kbmem-tiny', 'aria-live': 'polite', 'data-imp': 'wait' }, wait),
            h('button', { type: 'button', className: 'kbmem-btn sm ghost', 'data-act': 'imp-scan', disabled: busy !== '', onClick: () => { void runScan() } }, kt('Analyser', 'Scan')),
            h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'imp-apply', disabled: busy !== '', onClick: () => { void runApply() } }, kt('Importer', 'Import'))),
          open !== true ? null : h('div', { className: 'kbmem-imp-b', id: 'kbmem-imp-body', 'data-imp': 'body' },
            h('div', { className: 'kbmem-tiny', style: { padding: '10px 0 2px' } },
              scanWords === null ? kt('Rien d’analysé pour l’instant.', 'Nothing scanned yet.') : scanWords,
              ranWords === null ? null : ' · ' + ranWords),
            note === null ? null : h('div', { className: 'kbmem-imp-note' + (note.tone === 'err' ? ' err' : ''), 'data-imp': 'note', role: note.tone === 'err' ? 'alert' : undefined },
              Ico(note.tone === 'err' ? 'alert' : 'check'), h('span', null, note.text)),
            entries.length === 0 ? h('div', { className: 'kbmem-tiny', style: { padding: '10px 0' } },
              kt('Rien d’importé pour l’instant : « Importer » lit les fichiers mémoire de Claude Code et les place en attente ici, sans jamais les modifier.', 'Nothing imported yet: “Import” reads Claude Code’s memory files and stages them here, never changing them.')) : null,
            entries.length === 0 ? null : h('div', { className: 'kbmem-row2', style: { marginTop: 10, marginBottom: 2 } },
              h('span', { className: 'kbmem-tiny' }, kt('Tout : ', 'All: ')),
              h('button', { type: 'button', className: 'kbmem-btn sm ghost', 'data-act': 'imp-all-active', disabled: busy !== '' || movable.length === 0, onClick: () => { void bulk('active') } }, kt('Tout activer', 'Activate all')),
              h('button', { type: 'button', className: 'kbmem-btn sm ghost', 'data-act': 'imp-all-pinned', disabled: busy !== '' || movable.length === 0, onClick: () => { void bulk('pinned') } }, kt('Tout épingler', 'Pin all'))),
            entries.length === 0 ? null : h('div', null, shown.map(rowOf)),
            entries.length <= shown.length ? null : h('div', { className: 'kbmem-imp-more' }, kt('… et ' + (entries.length - shown.length) + ' autre' + sfx(entries.length - shown.length), '… and ' + (entries.length - shown.length) + ' more'))))
      }

      // ── Team lessons: the Team tab, proposing, reviewing ─────────────────────────────────────────────────
      const TeamRow = ({ l, mineView, onOpen, i }) => {
        const [label, tone] = teamStatusChip(l)
        return h('button', { type: 'button', className: 'kbmem-r' + appear(i), 'data-id': l.id, 'data-status': l.status, onClick: () => onOpen(l) },
          h('span', { className: 'kbmem-kd lesson' }),
          h('span', { className: 'kbmem-tx' }, l.text,
            h('span', { className: 'kbmem-tmeta' }, teamMeta(l).join(' · '),
              mineView && l.status === 'rejected' && l.reviewNote ? h('span', { className: 'kbmem-why-r', 'data-why': '1' }, ' · “' + l.reviewNote + '”') : null)),
          h('span', { className: 'kbmem-mt' },
            mineView || l.status !== 'approved' ? h('span', { className: 'kbmem-chip' + (tone === '' ? '' : ' ' + tone), 'data-chip': 'status' }, label) : null,
            h('span', { className: 'kbmem-chip' }, l.kyber === null ? kt('général', 'general') : l.kyber)))
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
          onDone(admin ? kt('Ajoutée : ton équipe la lit dès le prochain message', 'Added: your team reads it from the next message') : kt('Proposée : un propriétaire ou un admin va l’examiner', 'Proposed: an owner or admin will review it'))
        }
        const options = [{ id: '', label: kt('Générale (chaque équipe d’agents IA)', 'General (every AI agent team)') }].concat(kybers.map((k) => ({ id: k.id, label: k.id })))
        if (kyber !== '' && !options.some((o) => o.id === kyber)) options.push({ id: kyber, label: kyber })
        return h('aside', { className: 'kbmem-sheet', role: 'dialog', 'aria-label': admin ? kt('Ajouter une leçon d’équipe', 'Add a team lesson') : kt('Proposer à ton équipe', 'Propose to your team') },
          h('h3', null, Ico('share'), admin ? kt('Ajouter une leçon d’équipe', 'Add a team lesson') : kt('Proposer à ton équipe', 'Propose to your team'), h('span', { className: 'kbmem-grow' }), h('button', { type: 'button', className: 'kbmem-ib', 'aria-label': kt('Fermer', 'Close'), onClick: onClose }, Ico('x'))),
          h('textarea', { 'aria-label': kt('Texte de la leçon', 'Lesson text'), value: text, maxLength: 500, placeholder: kt('Une phrase vérifiable que toute l’équipe devrait connaître.', 'One falsifiable sentence the whole team should know.'), onChange: (e) => setText(e.target.value), disabled: busy }),
          h('div', { className: 'kbmem-f' }, h('span', null, kt('S’applique à', 'Applies to')),
            h('select', { className: 'kbmem-sel', 'aria-label': 'AI Agent Team', value: kyber, onChange: (e) => setKyber(e.target.value), disabled: busy }, options.map((o) => h('option', { key: o.id, value: o.id }, o.label)))),
          h('div', { className: 'kbmem-f' }, h('span', null, kt('Étiquettes (séparées par des virgules, 5 au maximum)', 'Tags (comma separated, 5 at most)')), h('input', { className: 'kbmem-sel', style: { width: '100%' }, 'aria-label': kt('Étiquettes', 'Tags'), value: tags, onChange: (e) => setTags(e.target.value), disabled: busy })),
          admin ? null : h('div', { className: 'kbmem-f' }, h('span', null, kt('En quoi ça aide l’équipe (facultatif)', 'Why it helps the team (optional)')), h('input', { className: 'kbmem-sel', style: { width: '100%' }, 'aria-label': 'Note', value: note, maxLength: 280, onChange: (e) => setNote(e.target.value), disabled: busy })),
          h('div', { className: 'kbmem-tiny' }, admin ? kt('En tant que propriétaire ou admin, ta leçon est approuvée tout de suite et lue par chaque membre dès son prochain message.', 'As an owner or admin your lesson is approved at once and read by every member from their next message.') : kt('Un propriétaire ou un admin la lit d’abord. D’ici là, elle reste à toi et personne d’autre ne la voit.', 'An owner or admin reads it first. Until then it stays yours and nobody else sees it.')),
          h('div', { className: 'kbmem-acts' },
            h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'team-send', disabled: busy || text.trim() === '', onClick: send }, admin ? kt('Ajouter à l’équipe', 'Add to the team') : kt('Proposer', 'Propose')),
            h('button', { type: 'button', className: 'kbmem-btn ghost', onClick: onClose }, kt('Annuler', 'Cancel'))))
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
        return h('aside', { className: 'kbmem-sheet', role: 'dialog', 'aria-label': kt('Leçon d’équipe', 'Team lesson') },
          h('h3', null, h('span', { className: 'kbmem-kd lesson', style: { margin: 0 } }), kt('Leçon d’équipe', 'Team lesson'), h('span', { className: 'kbmem-grow' }), h('button', { type: 'button', className: 'kbmem-ib', 'aria-label': kt('Fermer', 'Close'), onClick: onClose }, Ico('x'))),
          h('div', { className: 'kbmem-tsheet-text', 'data-team': 'text' }, lesson.text),
          h('div', { className: 'kbmem-tiny' }, h('span', { className: 'kbmem-chip' + (tone === '' ? '' : ' ' + tone) }, label), ' ', h('span', { className: 'kbmem-chip' }, lesson.kyber === null ? kt('général', 'general') : lesson.kyber), ' ', lesson.tags.map((t) => '#' + t).join(' ')),
          h('div', { className: 'kbmem-tiny' }, teamMeta(lesson).join(' · ')),
          lesson.note ? h('div', { className: 'kbmem-tiny' }, h('b', null, kt('Note : ', 'Note: ')), lesson.note) : null,
          lesson.reviewNote ? h('div', { className: 'kbmem-tiny', 'data-team': 'reason' }, h('b', null, kt('Raison : ', 'Reason: ')), lesson.reviewNote) : null,
          canWithdraw || admin ? h('div', { className: 'kbmem-acts' },
            canWithdraw && !admin ? (confirm === 'delete'
              ? h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-confirm-delete', disabled: busy, onClick: () => act('delete', kt('Proposition retirée', 'Proposal withdrawn')) }, kt('Confirmer : retirer', 'Confirm: withdraw'))
              : h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-delete', onClick: () => setConfirm('delete') }, kt('Retirer ma proposition', 'Withdraw my proposal'))) : null,
            admin && lesson.status === 'approved' ? (confirm === 'retire'
              ? h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-confirm-retire', disabled: busy, onClick: () => act('retire', kt('Retirée : les agents arrêtent de la lire', 'Retired: agents stop reading it')) }, kt('Confirmer : retirer', 'Confirm: retire'))
              : h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'team-retire', onClick: () => setConfirm('retire') }, kt('Retirer', 'Retire'))) : null,
            admin ? (confirm === 'delete'
              ? h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-confirm-delete', disabled: busy, onClick: () => act('delete', kt('Supprimée', 'Deleted')) }, kt('Confirmer : supprimer', 'Confirm: delete'))
              : h('button', { type: 'button', className: 'kbmem-btn danger', 'data-act': 'team-delete', onClick: () => setConfirm('delete') }, kt('Supprimer', 'Delete'))) : null) : null,
          admin && lesson.status === 'approved' ? h('div', { className: 'kbmem-tiny' }, kt('Retirer la garde dans l’historique ; les agents arrêtent de la lire. Supprimer l’efface pour de bon.', 'Retiring keeps it in the history; agents stop reading it. Deleting removes it for good.')) : null)
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
        if (d.loading && d.lessons.length === 0 && d.error === null) body = SkelRows(5)
        else if (!d.ok) body = h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-ill' }, Ico('users')), h('h3', null, kt('Les leçons d’équipe ne sont pas disponibles', 'Team lessons are not available')), h('div', null, friendlyError(d.error)))
        else if (shown.length === 0) body = h('div', { className: 'kbmem-empty', 'data-team': 'empty' }, h('div', { className: 'kbmem-ill' }, Ico('users')),
          q.trim() !== '' ? [h('h3', { key: 'h' }, kt('Aucun résultat', 'No match')), h('div', { key: 'd' }, kt('Aucune leçon d’équipe ne contient ces mots.', 'No team lesson has those words.'))]
            : view === 'mine' ? [h('h3', { key: 'h' }, kt('Tu n’as encore rien proposé', 'You have not proposed anything yet')), h('div', { key: 'd' }, kt('Propose une leçon que ton équipe devrait connaître : un propriétaire ou un admin la lit, puis chaque agent de l’équipe aussi.', 'Propose a lesson your team should know: an owner or admin reads it, then every agent of the team does.'))]
              : [h('h3', { key: 'h' }, kt('Aucune leçon approuvée pour l’instant', 'No approved lesson yet')), h('div', { key: 'd' }, admin ? kt('Ajoute la première, ou examine ce que les membres proposent.', 'Add the first one, or review what members propose.') : kt('Propose-en une : quand un propriétaire ou un admin l’approuve, chaque agent de l’équipe la lit.', 'Propose one: when an owner or admin approves it, every agent of the team reads it.'))])
        else body = h('div', { className: 'kbmem-list', style: d.loading ? { opacity: 0.6 } : null }, shown.map((l, i) => h(TeamRow, { key: l.id, i, l, mineView: view === 'mine', onOpen: (x) => setSheet({ kind: 'open', lesson: x }) })))
        return h('div', { 'data-team': 'pane' },
          h('div', { className: 'kbmem-tools' },
            h('label', { className: 'kbmem-field' }, Ico('search'), h('input', { 'aria-label': kt('Rechercher', 'Search'), placeholder: kt('Rechercher dans les leçons d’équipe…', 'Search team lessons…'), value: q, onChange: (e) => setQ(e.target.value) })),
            h(Seg, { small: true, value: view, label: kt('Vue de l’équipe', 'Team view'), onChange: setView, items: [{ v: 'approved', l: [h('span', { key: 'a' }, kt('Approuvées', 'Approved')), h('span', { key: 'b', className: 'kbmem-cnt' }, team.counts ? team.counts.approved : '')] }, { v: 'mine', l: kt('Mes propositions', 'My proposals') }] }),
            canShare ? h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'team-add', onClick: () => setSheet({ kind: 'propose', initial: { text: '', kyber: null, tags: [] } }) }, Ico('plus'), admin ? kt('Ajouter une leçon d’équipe', 'Add a team lesson') : kt('Proposer une leçon', 'Propose a lesson')) : null),
          h('div', { className: 'kbmem-tiny', style: { marginBottom: 8 } }, (team.workspaceName || kt('Ton équipe', 'Your team')) + kt(' · leçons lues par les agents de ton équipe, approuvées par un propriétaire ou un admin', ' · lessons your team’s agents read, approved by an owner or admin')),
          admin && pending > 0 ? h('div', { className: 'kbmem-banner', 'data-team': 'banner', role: 'status' }, Ico('inbox'),
            h('div', { className: 'kbmem-grow' }, h('b', null, kt(pending + ' proposition' + sfx(pending), plural(pending, 'proposal'))), kt(pending === 1 ? ' attend ton examen. ' : ' attendent ton examen. ', pending === 1 ? ' waits for your review. ' : ' wait for your review. '), h('span', { className: 'kbmem-muted' }, kt('Rien n’arrive aux agents de ton équipe tant que tu n’as pas approuvé.', 'Nothing reaches your team’s agents until you approve it.'))),
            h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'team-review', onClick: openReview }, kt('Examiner', 'Review'))) : null,
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
          notify(decision === 'approve' ? kt('Approuvée : les membres la lisent dès leur prochain message', 'Approved: members read it from their next message') : kt('Refusée : l’auteur de la proposition voit ta raison', 'Rejected: the proposer sees your reason'))
        }
        const options = [{ id: '', label: kt('Générale (chaque équipe d’agents IA)', 'General (every AI agent team)') }].concat(kybers.map((k) => ({ id: k.id, label: k.id })))
        return h('div', null,
          h('button', { type: 'button', className: 'kbmem-back', 'data-act': 'back', onClick: back }, Ico('left'), h('span', null, pageTitle())),
          h('div', { className: 'kbmem-top' }, pageHead({ title: kt('Propositions de leçons d’équipe', 'Team lesson proposals'), as: 'h1', className: 'kbmem-h1' }), h('span', { className: 'kbmem-grow' }), h('span', { className: 'kbmem-tiny' }, (team.workspaceName || kt('Ton équipe', 'Your team')) + kt(' · ' + String(waiting) + ' à examiner', ' · ' + String(waiting) + ' to review'))),
          h('p', { className: 'kbmem-lead' }, kt('Une leçon que tu approuves est lue par les agents de chaque membre dès son prochain message. Les membres ne voient jamais une proposition en attente, sauf la leur.', 'A lesson you approve is read by every member’s agents from their next message. Members never see a proposal that is still waiting, except their own.')),
          d.loading ? h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-spin' }))
            : !d.ok ? h('div', { className: 'kbmem-empty' }, h('h3', null, kt('Impossible de charger les propositions', 'Could not load the proposals')), h('div', null, friendlyError(d.error)))
              : d.lessons.length === 0 ? h('div', { className: 'kbmem-empty', 'data-team': 'nothing' }, h('div', { className: 'kbmem-ill' }, Ico('check')), h('h3', null, kt('Rien à examiner', 'Nothing to review')), h('div', null, kt('Quand un membre propose une leçon, elle apparaît ici.', 'When a member proposes a lesson it shows up here.')))
                : d.lessons.map((l) => {
                  const st = state[l.id]
                  const done = st === 'approved' || st === 'rejected'
                  const e = edit[l.id]
                  const rj = rejecting[l.id]
                  const head = h('header', null, h('span', { className: 'kbmem-chip' }, l.proposedName || kt('membre', 'member')), h('span', { className: 'kbmem-chip' }, l.kyber === null ? kt('général', 'general') : l.kyber), h('span', { className: 'kbmem-tiny' }, teamMeta(l).slice(-1)[0] || ''), h('span', { className: 'kbmem-grow' }),
                    done ? h('span', { className: 'kbmem-stat' + (st === 'approved' ? ' ok' : ''), 'data-stat': st }, Ico(st === 'approved' ? 'check' : 'x'), st === 'approved' ? kt('Approuvée', 'Approved') : kt('Refusée', 'Rejected'))
                      : st !== undefined ? h('span', { className: 'kbmem-stat err', 'data-stat': 'err' }, Ico('alert'), friendlyError(st.error)) : null)
                  if (done) return h('div', { key: l.id, className: 'kbmem-grp done', 'data-group': String(l.id) }, head, h('div', { className: 'kbmem-tiny', style: { padding: '0 14px 12px' } }, e !== undefined && st === 'approved' ? e.text : l.text))
                  return h('div', { key: l.id, className: 'kbmem-grp', 'data-group': String(l.id) }, head,
                    h('div', { className: 'items' },
                      h('div', { className: 'kbmem-it new' }, e !== undefined
                        ? h('div', { style: { width: '100%' } }, h('textarea', { 'aria-label': kt('Texte à approuver', 'Text to approve'), value: e.text, maxLength: 500, onChange: (ev) => setEdit((old) => Object.assign({}, old, { [l.id]: Object.assign({}, old[l.id], { text: ev.target.value }) })) }),
                          h('select', { className: 'kbmem-sel', 'aria-label': 'AI Agent Team', style: { marginTop: 8 }, value: e.kyber, onChange: (ev) => setEdit((old) => Object.assign({}, old, { [l.id]: Object.assign({}, old[l.id], { kyber: ev.target.value }) })) }, options.map((o) => h('option', { key: o.id, value: o.id }, o.label))))
                        : h('span', { className: 'kbmem-itx' }, l.text)),
                      l.note ? h('div', { className: 'kbmem-gnote', style: { padding: '0 0 8px' } }, h('b', null, kt(l.proposedName ? l.proposedName + ' dit : ' : 'L’auteur dit : ', (l.proposedName || 'The proposer') + ' says: ')), l.note) : null,
                      rj !== undefined ? h('textarea', { 'aria-label': kt('Raison', 'Reason'), placeholder: kt(l.proposedName ? 'Dis à ' + l.proposedName + ' pourquoi (la personne le verra)' : 'Dis pourquoi (la personne le verra)', 'Tell ' + (l.proposedName || 'them') + ' why (they will see it)'), value: rj, maxLength: 280, onChange: (ev) => setRejecting((old) => Object.assign({}, old, { [l.id]: ev.target.value })) }) : null),
                    h('div', { className: 'kbmem-gacts' }, rj !== undefined
                      ? [h('button', { key: 'r', type: 'button', className: 'kbmem-btn danger sm', 'data-act': 'team-reject', disabled: busy, onClick: () => decide(l, 'reject') }, kt('Refuser', 'Reject')), h('button', { key: 'c', type: 'button', className: 'kbmem-btn ghost sm', onClick: () => setRejecting((old) => { const n = Object.assign({}, old); delete n[l.id]; return n }) }, kt('Annuler', 'Cancel'))]
                      : [h('button', { key: 'a', type: 'button', className: 'kbmem-btn sm', 'data-act': 'team-approve', disabled: busy, onClick: () => decide(l, 'approve') }, Ico('check'), kt('Approuver', 'Approve')),
                        h('button', { key: 'e', type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'team-edit', disabled: busy, onClick: () => setEdit((old) => { const n = Object.assign({}, old); if (n[l.id] === undefined) n[l.id] = { text: l.text, kyber: l.kyber === null ? '' : l.kyber }; else delete n[l.id]; return n }) }, e !== undefined ? kt('Terminer la modification', 'Done editing') : kt('Modifier, puis approuver', 'Edit, then approve')),
                        h('button', { key: 'j', type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'team-rejecting', disabled: busy, onClick: () => setRejecting((old) => Object.assign({}, old, { [l.id]: '' })) }, kt('Refuser…', 'Reject…'))]))
                }))
      }

      /** One suggestion: the items (the kept one in green, the others struck), who stays, and what to do. */
      const GroupCard = ({ g, st, keepId, editing, edit, busy, expanded, onExpand, onPick, onMerge, onToggleEdit, onEdit, onKeepBoth, onUndo, onRestore }) => {
        const src = TIDY_SOURCES[g.src]
        const pinned = g.items.some((i) => i.pinned === true)
        const tooBig = groupRemovals(g) > TIDY_MAX_REMOVALS
        const done = st !== undefined && st.s !== 'err'
        const outdated = g.type === 'outdated'
        const title = outdated ? kt('Supprimer l’obsolète', 'Remove the outdated one') : kt('Fusionner ' + String(g.items.length) + ' en 1', 'Merge ' + String(g.items.length) + ' into 1')
        let status = null
        if (st !== undefined) {
          if (st.s === 'ok') status = [h('span', { key: 's', className: 'kbmem-stat ok', 'data-stat': 'ok' }, Ico('check'), kt('Fusionné', 'Merged')), h('button', { key: 'u', type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-undo', disabled: busy, onClick: onUndo }, Ico('undo'), kt('Défaire', 'Undo'))]
          else if (st.s === 'keep') status = [h('span', { key: 's', className: 'kbmem-stat', 'data-stat': 'keep' }, Ico('x'), kt('Gardé tel quel', 'Kept as is')), h('button', { key: 'u', type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-restore', disabled: busy, onClick: onRestore }, Ico('undo'), kt('Défaire', 'Undo'))]
          else if (st.s === 'undone') status = h('span', { className: 'kbmem-stat', 'data-stat': 'undone' }, Ico('undo'), g.src === 'mem' ? kt('Défait : les originaux sont revenus comme nouveaux souvenirs', 'Undone: the originals are back as new memories') : kt('Défait : tout est revenu comme avant', 'Undone: everything is back as it was'))
          else status = h('span', { className: 'kbmem-stat err', 'data-stat': 'err' }, Ico('alert'), friendlyError(st.error))
        }
        return h('div', { className: 'kbmem-grp' + (done ? ' done' : ''), 'data-group': g.id, 'data-src': g.src },
          h('header', null, h('span', { className: 't' }, title), g.by === 'brain' ? h('span', { className: 'kbmem-chip acc', 'data-chip': 'brain' }, Ico('brain'), kt('Modèle d’étude', 'Study model')) : h('span', { className: 'kbmem-chip' }, kt('Proche à ' + String(g.score) + ' %', 'Close match ' + String(g.score) + '%')),
            g.kyber ? h('span', { className: 'kbmem-chip' }, g.kyber) : null, h('span', { className: 'kbmem-grow' }), status),
          h('div', { className: 'items' }, visibleItems(g, keepId, expanded).map((i) => {
            const kept = i.id === keepId
            return h('div', { key: i.id, className: 'kbmem-it ' + (kept ? 'new' : 'del'), 'data-item': i.id, 'data-kept': kept ? '1' : '0' },
              h('button', { type: 'button', className: 'kbmem-pick' + (kept ? ' on' : ''), role: 'radio', 'aria-checked': kept, 'aria-label': kt('Garder celui-ci', 'Keep this one'), disabled: done || (pinned && i.pinned !== true), onClick: () => onPick(i.id) }),
              kept && editing
                ? h('textarea', { 'aria-label': kt('Texte à garder', 'Text to keep'), value: edit, maxLength: src.max, onChange: (e) => onEdit(e.target.value) })
                : h('span', { className: 'kbmem-itx', title: kept ? undefined : i.content }, kept && edit !== undefined && edit.trim() !== '' ? edit : i.content,
                  kept && edit !== undefined && edit.trim() !== '' && edit.trim() !== i.content.trim() ? h('span', { className: 'kbmem-was', 'data-was': '1' }, kt('avant : ' + i.content, 'was: ' + i.content)) : null),
              h('span', { className: 'kbmem-im' }, kept && g.merged && edit === g.merged ? h('span', { className: 'kbmem-chip acc', 'data-chip': 'suggested' }, kt('texte suggéré', 'suggested text')) : null, i.pinned ? Ico('pin') : null, i.uses > 0 ? h('span', null, kt('Utilisée ' + String(i.uses) + ' fois', 'Used ' + String(i.uses) + '×')) : null, h('span', null, ageLabel(i.ageMinutes))))
          }), visibleItems(g, keepId, expanded).length < g.items.length ? h('div', { className: 'kbmem-more' }, kt('+ ' + String(g.items.length - visibleItems(g, keepId, false).length) + ' autre' + sfx(g.items.length - visibleItems(g, keepId, false).length) + ' avec le même sens ', '+ ' + String(g.items.length - visibleItems(g, keepId, false).length) + ' more with the same meaning '), h('button', { type: 'button', 'data-act': 'tidy-more', onClick: onExpand }, kt('Afficher', 'Show'))) : null),
          g.verdict ? h('div', { className: 'kbmem-why', 'data-why': '1' }, Ico('brain'), g.verdict) : null,
          h('div', { className: 'kbmem-gnote' }, outdated ? (g.src === 'mem' ? kt('Le plus récent le remplace ; Défaire ramène l’ancien comme nouveau souvenir.', 'The newer one replaces it; Undo brings the older one back as a new memory.') : kt('Le plus récent le remplace ; Défaire ramène l’ancien.', 'The newer one replaces it; Undo brings the older one back.')) : g.src === 'les' ? kt('La leçon gardée reçoit aussi les étiquettes et les utilisations des autres.', 'The kept lesson also gets the tags and the uses of the others.') : (pinned ? kt('Un souvenir épinglé n’est jamais supprimé : c’est celui qui reste.', 'A pinned memory is never removed: it is the one that stays.') : (g.items.length === 2 ? kt('L’autre est supprimé ; Défaire le ramène comme nouveau souvenir.', 'The other one is deleted; Undo brings them back as new memories.') : kt('Les autres sont supprimés ; Défaire les ramène comme nouveaux souvenirs.', 'The other ones are deleted; Undo brings them back as new memories.')))),
          done ? null : h('div', { className: 'kbmem-gacts' },
            h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'tidy-merge', disabled: busy || tooBig || (st !== undefined), onClick: onMerge }, Ico('check'), outdated ? kt('Supprimer l’ancien', 'Remove the older') : kt('Fusionner', 'Merge')),
            h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-edit', disabled: busy, onClick: onToggleEdit }, editing ? kt('Terminer la modification', 'Done editing') : kt('Modifier celui qu’on garde', 'Edit the kept one')),
            h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-keepboth', disabled: busy, onClick: onKeepBoth }, kt('Garder les deux', 'Keep both')),
            tooBig ? h('span', { className: 'kbmem-tiny' }, kt('Trop d’un coup (' + String(groupRemovals(g)) + ') : la limite est ' + String(TIDY_MAX_REMOVALS) + '.', 'Too many at once (' + String(groupRemovals(g)) + '): the limit is ' + String(TIDY_MAX_REMOVALS) + '.')) : null))
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
          if (merged === 0) { notify(failed === 1 ? friendlyError(next[Object.keys(next)[0]].error) : kt('Rien n’a été fusionné.', 'Nothing was merged.')); return }
          notify(kt(merged + ' groupe' + sfx(merged) + ' fusionné' + sfx(merged) + ' · ' + removed + ' élément' + sfx(removed) + ' supprimé' + sfx(removed), 'Merged ' + plural(merged, 'group') + ' · ' + plural(removed, 'item') + ' removed') + (failed > 0 ? kt(' · ' + String(failed) + ' non fait' + sfx(failed), ' · ' + String(failed) + ' not done') : ''), async () => {
            let back = 0
            for (const x of runs) {
              const u = await api(TIDY_SOURCES[x.src].base + '/undo', { run: x.run })
              if (u.ok === true) { back += 1; setStatus((old) => Object.assign({}, old, { [x.id]: { s: 'undone' } })) }
            }
            bump()
            notify(back === runs.length ? kt('Défait : tout est revenu', 'Undone: everything is back') : kt('Défait : ' + String(back) + ' sur ' + String(runs.length) + ' ; retrouve le reste dans « Récemment supprimées »', 'Undone ' + String(back) + ' of ' + String(runs.length) + ': the rest is in Recently removed'))
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
        if (auto !== null && auto !== undefined && auto.brainError) notes.push(h('div', { key: 'nb', className: 'kbmem-note warn', 'data-note': 'brain' }, Ico('brain'), h('div', null, h('b', null, kt('Le modèle d’étude n’a pas été sollicité. ', 'The Study model was not asked. ')), friendlyError(auto.brainError), auto.brainDetail ? ' (' + auto.brainDetail + ')' : '', kt(' Les suggestions ci-dessous viennent de l’analyse locale seulement.', ' The suggestions below come from the local look only.'))))
        if (tidy.memError !== null && tidy.mem === null) notes.push(h('div', { key: 'nm', className: 'kbmem-note warn', 'data-note': 'mem-skipped' }, Ico('cloud'), h('div', null, h('b', null, kt('Les souvenirs n’ont pas été analysés. ', 'Memories were not looked at. ')), friendlyError(tidy.memError))))
        if (tidy.lesError !== null && tidy.les === null) notes.push(h('div', { key: 'nl', className: 'kbmem-note warn', 'data-note': 'les-skipped' }, Ico('alert'), h('div', null, h('b', null, kt('Les leçons n’ont pas été analysées. ', 'Lessons were not looked at. ')), friendlyError(tidy.lesError))))

        const autoCount = auto === null || auto === undefined ? 0 : (auto.mem === null || auto.mem === undefined ? 0 : auto.mem.groups) + (auto.les === null || auto.les === undefined ? 0 : auto.les.groups)
        const autoRemoved = auto === null || auto === undefined ? 0 : (auto.mem === null || auto.mem === undefined ? 0 : auto.mem.removed) + (auto.les === null || auto.les === undefined ? 0 : auto.les.removed)
        const autoBrain = auto === null || auto === undefined ? 0 : (auto.mem === null || auto.mem === undefined ? 0 : auto.mem.brain || 0) + (auto.les === null || auto.les === undefined ? 0 : auto.les.brain || 0)
        const autoBar = autoCount > 0 ? h('div', { className: 'kbmem-autobar', 'data-tidy': 'auto' }, Ico('check'),
          h('div', { className: 'kbmem-grow' }, autoState === 'undone' ? kt('Défait : ce qui avait été fusionné automatiquement est revenu. Appuie sur « Analyser à nouveau » pour le revoir sous forme de suggestions.', 'Undone: what was merged by itself is back. Press “Look again” to see it as suggestions.') : [h('b', { key: 'b' }, kt(autoCount + ' groupe' + sfx(autoCount) + ' fusionné' + sfx(autoCount) + ' automatiquement', 'Merged ' + plural(autoCount, 'group') + ' by itself')), kt((autoBrain > 0 ? ' (80 % de ressemblance ou plus, ou jugés identiques par le modèle d’étude)' : ' (80 % de ressemblance ou plus)') + ' : ' + autoRemoved + ' élément' + sfx(autoRemoved) + ' supprimé' + sfx(autoRemoved) + '. Chaque changement peut être défait pendant 30 jours.', (autoBrain > 0 ? ' (80 % alike or more, or judged the same by the Study model)' : ' (80 % alike or more)') + ': ' + plural(autoRemoved, 'item') + ' removed. Every change can be undone for 30 days.')]),
          autoState === 'undone' ? null : h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-auto-undo', disabled: busy, onClick: async () => { setBusy(true); const r = await onUndoAuto(auto); setBusy(false); if (r.back === r.total) setAutoState('undone'); else notify(kt('Défait : ' + String(r.back) + ' sur ' + String(r.total) + ' ; retrouve le reste dans « Récemment supprimées »', 'Undid ' + String(r.back) + ' of ' + String(r.total) + ': the rest is in Recently removed')) } }, Ico('undo'), kt('Défaire', 'Undo'))) : null
        const head = h('div', null,
          h('button', { type: 'button', className: 'kbmem-back', 'data-act': 'back', onClick: back }, Ico('left'), h('span', null, pageTitle())),
          h('div', { className: 'kbmem-top' }, pageHead({ title: kt('Suggestions de rangement', 'Tidy-up suggestions'), as: 'h1', className: 'kbmem-h1' }), h('span', { className: 'kbmem-grow' }),
            at ? h('span', { className: 'kbmem-tiny' }, kt('Détecté ' + whenLabel(at), 'Found ' + whenLabel(at)) + (tidyBrain(tidy).model !== '' && tidySettingsOf(tidy).brain === true ? kt(' · analyse locale + modèle d’étude', ' · local scan + Study model') : kt(' · analyse locale', ' · local scan'))) : null,
            h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': 'tidy-rescan', disabled: scanning || busy, onClick: scan }, Ico('broom'), scanning ? kt('Analyse…', 'Looking…') : kt('Analyser à nouveau', 'Look again'))),
          autoBar, notes)

        if (nothing) return h('div', null, head,
          h('div', { className: 'kbmem-empty', 'data-tidy': 'empty' }, h('div', { className: 'kbmem-ill' }, Ico('check')),
            at ? [h('h3', { key: 'h' }, autoCount > 0 ? kt('Plus rien à examiner', 'Nothing left to review') : kt('Rien à ranger', 'Nothing to tidy up')), h('div', { key: 'd' }, autoCount > 0 ? kt('Tout ce qui était assez proche a été fusionné.', 'Everything that was close enough has been merged.') : kt('Analyse de ' + total + ' élément' + sfx(total) + ' sur cet ordinateur : aucun quasi-doublon.', 'Looked at ' + plural(total, 'item') + ' on this machine: no near-duplicates.'))]
              : [h('h3', { key: 'h' }, kt('Rien n’a encore été analysé', 'Nothing has been looked at yet')), h('div', { key: 'd' }, kt('Appuie sur « Analyser à nouveau » pour chercher des quasi-doublons dans tes souvenirs et tes leçons. Analyser ne change rien.', 'Press “Look again” to search your memories and lessons for near-duplicates. Nothing is changed by looking.'))]))

        return h('div', null, head,
          h('div', { className: 'kbmem-row2' }, h(Seg, { value: tab, onChange: (v) => { setTab(v); setEditing(null) }, label: 'Section', items: [
            { v: 'mem', l: [h('span', { key: 'a' }, kt('Souvenirs', 'Memories')), h('span', { key: 'b', className: 'kbmem-cnt' }, openOf('mem'))] },
            { v: 'les', l: [h('span', { key: 'a' }, kt('Leçons apprises', 'Lessons learned')), h('span', { key: 'b', className: 'kbmem-cnt' }, openOf('les'))] }] })),
          h('div', { className: 'kbmem-sum' }, h('span', null, h('b', null, String(open.length)), kt(' à examiner', ' to review')), tab === 'mem' ? h('span', null, kt('Les souvenirs épinglés ne sont jamais supprimés', 'Pinned memories are never removed')) : h('span', null, kt('Les leçons ne se croisent qu’au sein de leur équipe d’agents IA', 'Lessons only meet inside their own AI agent team'))),
          list.length === 0 ? h('div', { className: 'kbmem-empty' }, h('h3', null, tab === 'mem' ? kt('Aucune suggestion pour les souvenirs', 'No suggestion for ' + TIDY_SOURCES[tab].noun) : kt('Aucune suggestion pour les leçons', 'No suggestion for ' + TIDY_SOURCES[tab].noun)), h('div', null, kt('Rien ne ressemble à un doublon ici.', 'Nothing looks duplicated here.'))) : null,
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
          h('div', { className: 'kbmem-foot' }, h('span', { className: 'kbmem-grow kbmem-muted', style: { fontSize: 13 } }, kt('Rien n’est supprimé tant que tu n’as pas accepté. Défaire fonctionne pendant 30 jours.', 'Nothing is deleted until you accept. Undo works for 30 days.')),
            h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'tidy-later', onClick: back }, kt('Pas maintenant', 'Not now')),
            h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'tidy-all', disabled: open.length === 0 || busy, onClick: () => apply(open) }, Ico('check'), kt('Tout accepter (' + String(open.length) + ')', 'Accept all (' + String(open.length) + ')'))))
      }

      /** Waits for the first read of both views, so the snapshot of suggestions is never taken from an empty page. */
      const ReviewView = (props) => (props.tidy.loaded === true
        ? h(ReviewBody, props)
        : h('div', { className: 'kbmem-empty' }, h('div', { className: 'kbmem-spin' })))

      // ═══════════════════════════════════════════════════════════════
      // 5b. THE MEMORY PAGE (2026-11-20): settings, your memory, one note, import, recently removed
      // ═══════════════════════════════════════════════════════════════
      const MEM_STEP = 8
      /** A lesson's name and rest for a row or a heading: the title the person (or the host) gave it, else the first sentence of its text. */
      const lessonLine = (l) => (l.titled === true ? { name: String(l.title || ''), rest: String(l.summary || l.text || '') } : noteParts(l.text))
      const kyberName = (id) => (id === 'default' ? kt('Général', 'General') : String(id))
      const keepOptions = () => [[0, kt('Jusqu’à ce que tu la supprimes', 'Until you delete it')]].concat(retentions())
      const originWords = (m) => ({ capture: kt('Kybernos, après une conversation', 'Kybernos, after a chat'), agent: kt('Un agent', 'An agent'), taught: kt('Toi', 'You'), sync: kt('Un autre appareil (synchro)', 'Another device (sync)') }[m.origin] || 'Kybernos')

      const Switch = ({ on, onChange, label, disabled }) => h('button', { type: 'button', role: 'switch', 'aria-checked': on === true, 'aria-label': label, className: 'kbmem-sw', disabled: disabled === true, onClick: () => onChange(on !== true) })

      /** A value that follows `value` after `ms` of quiet (the search box asks the host once the typing stops). */
      const useDebounced = (value, ms) => {
        const [v, setV] = useState(value)
        useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
        return v
      }

      /** A page of lessons for a URL; nothing is asked while `enabled` is false. */
      const useLessonsPage = (url, enabled, refreshKey) => {
        const [d, setD] = useState({ loading: enabled, ok: false, items: [], total: 0 })
        const seq = useRef(0)
        useEffect(() => {
          if (!enabled) { setD({ loading: false, ok: false, items: [], total: 0 }); return undefined }
          const mine = ++seq.current
          setD((o) => Object.assign({}, o, { loading: true }))
          api(url).then((r) => {
            if (mine !== seq.current) return
            setD(r.ok === true ? { loading: false, ok: true, items: r.items, total: r.total } : { loading: false, ok: false, items: [], total: 0, error: r.error })
          })
          return undefined
        }, [url, enabled, refreshKey])
        return d
      }

      const Dialog = ({ title, onClose, wide, children }) => {
        const ref = useRef(null)
        useEffect(() => {
          const opener = document.activeElement
          const off = onEscape(onClose)
          try { const f = ref.current !== null ? ref.current.querySelector('textarea,input,button:not([data-close])') : null; (f !== null ? f : ref.current).focus() } catch (e) { /* no focus to move */ }
          // Closed, the focus goes back to what opened it, so a keyboard user does not start over at the top of the page.
          return () => { off(); try { if (opener !== null && opener !== document.body && document.contains(opener)) opener.focus() } catch (e) { /* the opener is gone */ } }
        }, [])
        return h('div', { className: 'kbmem-scrim', 'data-scrim': 'true', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
          h('div', { className: 'kbmem-dlg' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabIndex: -1, ref },
            h('h3', null, title, h('span', { className: 'kbmem-grow' }), h('button', { type: 'button', className: 'kbmem-ib', 'data-close': 'true', 'aria-label': kt('Fermer', 'Close'), onClick: onClose }, Ico('x'))),
            children))
      }

      /** The standing instructions (a marked section of the DSH home's AGENTS.md): the same text as the Kybernos Cloud page, read and saved through the same routes. Hidden when the file cannot be read. */
      const InstructionsBox = ({ notify }) => {
        const [st, setSt] = useState({ s: 'loading', text: '', saved: '' })
        const [busy, setBusy] = useState(false)
        const [err, setErr] = useState('')
        useEffect(() => {
          let live = true
          api('/kybernos-cloud/instructions').then((r) => { if (live) setSt(r.ok === true && typeof r.text === 'string' ? { s: 'ready', text: r.text, saved: r.text } : { s: 'none', text: '', saved: '' }) })
          return () => { live = false }
        }, [])
        if (st.s !== 'ready') return null
        const dirty = st.text !== st.saved
        const why = (c) => (c === 'too-long' ? kt('C’est trop long (2 000 caractères au maximum).', 'That is too long (2,000 characters at most).') : c === 'markers-damaged' ? kt('La section des instructions a été modifiée à la main : elle ne peut pas être enregistrée ici.', 'The instructions section was edited by hand: it cannot be saved here.') : friendlyError(c))
        const save = async () => {
          if (!dirty || busy) return
          setBusy(true)
          setErr('')
          const r = await api('/kybernos-cloud/instructions/save', { text: st.text })
          setBusy(false)
          if (r.ok !== true) { setErr(why(r.error)); return }
          const kept = st.text.replace(/\r\n/g, '\n').trim()
          setSt({ s: 'ready', text: kept, saved: kept })
          notify(kt('Instructions enregistrées', 'Instructions saved'))
        }
        return h('section', { className: 'kbmem-sec first', 'data-sec': 'instructions' },
          h('h2', null, kt('Instructions', 'Instructions')),
          h('p', { className: 'kbmem-nsub' }, kt('Kybernos les garde en tête dans chaque chat.', 'Kybernos keeps these in mind in every chat.')),
          h('textarea', { className: 'kbmem-instr', 'aria-label': kt('Instructions', 'Instructions'), maxLength: 2000, value: st.text, placeholder: kt('Par ex. Réponds court, le résultat d’abord. Utilise des mots simples.', 'e.g. Answer short, with the result first. Use plain words, not jargon.'), onChange: (e) => setSt(Object.assign({}, st, { text: e.target.value })) }),
          h('div', { className: 'kbmem-nhint' },
            h('span', { role: err === '' ? undefined : 'alert', className: err === '' ? '' : 'err' }, err !== '' ? err : dirty ? kt('Pas encore enregistré', 'Not saved yet') : st.text === '' ? kt('2 000 caractères au maximum.', 'Up to 2,000 characters.') : kt('Enregistré', 'Saved')),
            h('span', { className: 'kbmem-grow' }),
            h('span', null, st.text.length + ' / 2000'),
            dirty ? h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'instr-save', disabled: busy, onClick: () => { void save() } }, busy ? kt('Enregistrement…', 'Saving…') : kt('Enregistrer', 'Save')) : null))
      }

      // ── Settings ─────────────────────────────────────────────────────────────────────────────────────
      const SettingsView = ({ status, settings, tidy, notify, setSwitch, openManage, openImport, exportNow, exporting, scan, scanning, openReview, bump }) => {
        const mem = settings.memory
        const les = settings.lessons
        const sw = switchState(mem, les)
        const wait = settings.loaded !== true || (mem === null && les === null)
        const noAccount = status.loaded === true && status.connected !== true
        const cfg = tidySettingsOf(tidy)
        const saves = tidySaves(tidy)
        const tidyNone = tidy.loaded !== true || (tidy.mem === null && tidy.les === null)
        const setTidy = async (patch) => {
          const rs = await Promise.all([tidy.mem !== null ? api(TIDY_SOURCES.mem.base + '/settings', patch) : Promise.resolve({ ok: false }), tidy.les !== null ? api(TIDY_SOURCES.les.base + '/settings', patch) : Promise.resolve({ ok: false })])
          if (!rs.some((r) => r.ok === true)) notify(friendlyError(rs[1].error || rs[0].error))
          bump()
        }
        return h('div', { className: 'kbmem-m', 'data-nv': 'settings' },
          pageHead({ id: 'kybernos-memory', title: pageTitle(), as: 'h1', className: 'kbmem-h1' }),
          noAccount ? h('div', { className: 'kbmem-note warn', 'data-note': 'no-account' }, Ico('cloud'), h('div', { className: 'kbmem-grow' }, h('b', null, kt('Non connecté. ', 'Not connected. ')), kt('Les notes à ton sujet vivent dans ton compte Kybernos : connecte-le pour les voir et en ajouter. Les leçons restent sur cet ordinateur et continuent de fonctionner.', 'Notes about you live in your Kybernos account: connect it to see and add them. Lessons stay on this computer and keep working.')),
            h('button', { type: 'button', className: 'kbmem-btn sm', 'data-act': 'connect', onClick: connectAccount }, kt('Connecte ton compte', 'Connect your account'))) : null,
          h(InstructionsBox, { notify }),
          h('section', { className: 'kbmem-sec', 'data-sec': 'memory' },
            h('h2', null, kt('Mémoire', 'Memory')),
            wait && settings.loaded === true ? h('div', { className: 'kbmem-note warn' }, Ico('alert'), h('div', null, kt('Les plugins de mémoire ne sont pas disponibles pour l’instant.', 'The memory plugins are not available right now.'))) : null,
            h(SettingRow, { act: 'use', fold: true, label: kt('Utiliser la mémoire dans les chats', 'Use memory in chats'), desc: kt('Laisse Kybernos s’appuyer sur ce qu’il retient de toi et de ton travail, dans chaque chat.', 'Let Kybernos use what it remembers about you and your work in every chat.'), locked: wait,
              control: h(Switch, { on: sw.use, label: kt('Utiliser la mémoire dans les chats', 'Use memory in chats'), disabled: wait, onChange: (v) => { void setSwitch('use', v) } }) }),
            h(SettingRow, { act: 'learn', label: kt('Apprendre des chats', 'Learn from chats'), desc: kt('Laisse Kybernos noter ce qui mérite d’être gardé, dans tes chats et dans le travail de tes équipes.', 'Allow Kybernos to note what is worth keeping, from your chats and from your teams’ work.'), locked: wait,
              control: h(Switch, { on: sw.learn, label: kt('Apprendre des chats', 'Learn from chats'), disabled: wait, onChange: (v) => { void setSwitch('learn', v) } }) }),
            mem === null ? null : h(SettingRow, { act: 'sensitive', label: kt('Inclure les sujets sensibles', 'Include sensitive topics'), desc: kt('Autorise Kybernos à garder des détails sur des sujets sensibles comme la santé ou les convictions. Désactivé, il essaie de les laisser de côté.', 'Allow Kybernos to keep details about sensitive topics like health or beliefs. When off, it tries to leave them out.'),
              control: h(Switch, { on: sw.sensitive, label: kt('Inclure les sujets sensibles', 'Include sensitive topics'), onChange: (v) => { void setSwitch('sensitive', v) } }) }),
            h(SettingRow, { act: 'tidy-look', label: kt('Chercher les doublons', 'Look for repeats'), locked: tidyNone,
              desc: kt('Kybernos cherche les notes écrites deux fois et celles qui se ressemblent. Rien ne change sans ton accord, sauf si tu choisis « tout seul » juste en dessous. Tout ce qu’il fusionne revient depuis « Récemment supprimées » pendant 30 jours.', 'Kybernos looks for notes written twice and notes that look alike. Nothing changes without your yes, unless you pick “by itself” just below. Whatever it merges comes back from Recently removed for 30 days.'),
              live: saves > 0 ? h('div', { className: 'kbmem-tiny', style: { marginTop: 6 } }, kt(saves + ' groupe' + sfx(saves) + ' en attente de ton examen.', plural(saves, 'group') + ' waiting for your review.')) : null,
              control: h('div', { className: 'kbmem-acts' },
                saves > 0 ? h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'tidy-open', onClick: openReview }, kt('Examiner ' + String(saves), 'Review ' + String(saves))) : null,
                h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'tidy-scan', disabled: scanning || tidyNone, onClick: scan }, Ico('broom'), scanning ? kt('Analyse…', 'Looking…') : kt('Chercher', 'Look now'))) }),
            h(SettingRow, { act: 'tidy-mode', label: kt('Quand il en trouve', 'When it finds some'), locked: tidyNone,
              desc: cfg.mode === 'auto' ? kt('Ceux qui se ressemblent à 80 % ou plus sont fusionnés tout seuls ; le reste t’est montré. Chaque fusion est archivée et peut être défaite.', 'The ones that are 80 % alike or more are merged by itself; the rest is shown to you. Every merge is archived and can be undone.') : kt('Tout t’est montré d’abord : rien n’est fusionné sans ton accord.', 'Everything is shown to you first: nothing is merged without your yes.'),
              control: h(Seg, { value: cfg.mode, label: kt('Quand il en trouve', 'When it finds some'), onChange: (v) => { void setTidy({ mode: v }) }, items: tidyModes().map(([v, l]) => ({ v, l })) }) }),
            h(SettingRow, { act: 'manage', fold: true, label: kt('Ta mémoire', 'Your memory'), desc: kt('Voir, ajouter, modifier ou supprimer ce que Kybernos retient.', 'See, add to, edit or delete what Kybernos remembers.'),
              control: h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'manage', onClick: openManage }, kt('Gérer', 'Manage')) }),
            h(SettingRow, { act: 'import', fold: true, label: kt('Importer la mémoire d’autres assistants', 'Import memory from other assistants'), desc: kt('Reprends ce qu’un autre assistant sait de toi. On te donne un texte à copier.', 'Bring what another assistant knows about you. We give you a prompt to copy.'),
              control: h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'import', onClick: openImport }, kt('Lancer l’import', 'Start import')) }),
            h(SettingRow, { act: 'export', fold: true, label: kt('Exporter la mémoire', 'Export memory'), desc: kt('Télécharge une copie de ta mémoire en fichiers texte (un .zip).', 'Download a copy of your memory as plain text files (a .zip).'),
              control: h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'export', disabled: exporting, onClick: exportNow }, exporting ? kt('Préparation…', 'Preparing…') : kt('Exporter', 'Export')) })))
      }

      // ── Your memory ──────────────────────────────────────────────────────────────────────────────────
      const NoteRow = ({ id, name, summary, date, sub, onOpen, title }) => h('div', { className: 'kbmem-nrow' + (sub ? ' sub' : '') + (summary === '' ? ' solo' : ''), role: 'button', tabIndex: 0, 'data-id': id, title, onClick: onOpen,
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() } } },
        h('div', { className: 'nm' }, name), summary === '' ? null : h('div', { className: 'sm' }, summary), h('div', { className: 'dt' }, date))

      /** One team's lessons: closed it shows its name and count, open it loads the first few (all of them while a search is running). */
      const TeamGroup = ({ g, searching, openNote, refreshKey }) => {
        const [open, setOpen] = useState(false)
        const [lim, setLim] = useState(MEM_STEP)
        const show = searching || open
        const d = useLessonsPage(listUrl('lessons', { size: Math.min(200, Math.max(lim, MEM_STEP)), page: 1, q: '', f: Object.assign(defaultFilters(), { kyber: g.kyber }) }), show && g.items === null, refreshKey)
        const items = g.items !== null ? g.items : d.items
        return [
          h('button', { key: 'h', type: 'button', className: 'kbmem-ngrp' + (show ? ' open' : ''), 'aria-expanded': show, 'data-kyber': g.kyber, onClick: () => { if (!searching) setOpen(!open) } },
            Ico(show ? 'down' : 'right'), h('span', null, kyberName(g.kyber)), h('span', { className: 'ct' }, g.total)),
          show && g.items === null && d.loading && items.length === 0 ? h('div', { key: 'l', className: 'kbmem-nrow sub dimtext' }, kt('Chargement…', 'Loading…')) : null,
          show && !d.loading && g.items === null && !d.ok ? h('div', { key: 'e', className: 'kbmem-nrow sub dimtext' }, friendlyError(d.error)) : null,
          show ? items.slice(0, lim).map((l) => { const p = lessonLine(l); return h(NoteRow, { key: 'l' + l.id, id: l.id, sub: true, name: p.name, summary: p.rest, title: l.text, date: kt('Ajoutée ', 'Added ') + noteDate(l.ageMinutes), onOpen: () => openNote({ src: 'les', item: l }) }) }) : null,
          show && g.total > lim && lim < 200 ? h('button', { key: 'm', type: 'button', className: 'kbmem-nmore sub', 'data-act': 'more-team', onClick: () => setLim(Math.min(200, lim + 50)) }, kt('Afficher ' + Math.min(50, g.total - lim) + ' de plus', 'Show ' + Math.min(50, g.total - lim) + ' more')) : null,
        ]
      }

      const ManageView = ({ status, settings, tidy, team, kybers, notify, bump, refreshKey, back, openNote, openRemoved, openImport, openWipe, openReview, openTeamReview, removedCount, tab, setTab, setSwitch }) => {
        const connected = status.connected === true
        const [q, setQ] = useState('')
        const dq = useDebounced(q, 200)
        const [limit, setLimit] = useState(MEM_STEP)
        const [say, setSay] = useState('')
        const [saying, setSaying] = useState(false)
        const pending = useRef(null)
        const sayRef = useRef(null)
        const sw = switchState(settings.memory, settings.lessons)
        const searching = dq.trim() !== ''
        const list = useList('memories', { size: searching ? 50 : limit, page: 1, q: dq, f: defaultFilters() }, refreshKey)
        const found = useLessonsPage(listUrl('lessons', { size: 200, page: 1, q: dq, f: defaultFilters() }), searching, refreshKey)
        const groups = searching ? groupLessons(found.items).map((g) => ({ kyber: g.kyber, total: g.items.length, items: g.items })) : kybers.filter((k) => k.count > 0).map((k) => ({ kyber: k.id, total: k.count, items: null }))
        const teamInfo = team !== undefined && team.ok === true && team.team !== null ? team.team : null
        const teamAvail = teamInfo !== null && teamInfo.available === true
        const teamFull = teamAvail ? Object.assign({}, teamInfo, { shareOn: team.settings.share === true }) : null
        const noAccount = status.loaded === true && !connected
        const rows = list.ok === true ? list.items : []
        const total = list.ok === true ? list.total : 0
        const saves = tidySaves(tidy)
        const fresh = !searching && list.ok === true && !list.loading && total === 0 && groups.length === 0
        const noMatch = searching && !list.loading && !found.loading && rows.length === 0 && groups.length === 0
        const send = async () => {
          const text = say.trim()
          if (text === '' || saying || !sw.use || !connected) return
          setSaying(true)
          const r = await api('/kybernos-cloud/memory/add', { content: text, kind: 'fact', pinned: false, source: 'taught' })
          setSaying(false)
          if (r.ok !== true) { notify(friendlyError(r.error)); return }
          setSay('')
          if (pending.current !== null) { pending.current(); pending.current = null }
          if (r.same === true) { notify(kt('Déjà dans ta mémoire : rien n’a été ajouté.', 'Already in your memory: nothing was added.')); return }
          bump()
          const id = r.memory !== undefined && r.memory !== null ? r.memory.id : null
          notify(kt('C’est noté.', 'Noted.'), id === null ? undefined : async () => { const u = await api('/kybernos-cloud/memory/delete', { id }); bump(); notify(u.ok === true ? kt('Retiré.', 'Removed.') : friendlyError(u.error)) })
        }
        const sayBox = h('div', { className: 'kbmem-nsay' }, h('div', { className: 'box' },
          h('input', { ref: sayRef, type: 'text', 'aria-label': kt('Dis quelque chose à retenir', 'Tell Kybernos something to remember'), value: say, disabled: !sw.use || !connected, maxLength: NOTE_MAX_CHARS,
            placeholder: !connected ? kt('Connecte ton compte pour ajouter une note', 'Connect your account to add a note') : sw.use ? kt('Dis à Kybernos quelque chose à retenir…', 'Tell Kybernos something to remember…') : kt('La mémoire est désactivée', 'Memory is off'),
            onChange: (e) => setSay(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); void send() } } }),
          h('button', { type: 'button', className: 'kbmem-nsend', 'data-act': 'say', 'aria-label': kt('Envoyer', 'Send'), disabled: say.trim() === '' || saying || !sw.use || !connected, onClick: () => { void send() } }, Ico('up'))))
        const cards = [
          !sw.use && settings.loaded === true ? h('div', { key: 'off', className: 'kbmem-ninfo', 'data-card': 'off' }, h('span', null, kt('La mémoire est désactivée : Kybernos n’utilise aucune de ces notes dans les chats.', 'Memory is off: Kybernos uses none of these notes in chats.')), h('button', { type: 'button', className: 'kbmem-link', 'data-act': 'turn-on', onClick: () => { void setSwitch('use', true) } }, kt('Activer', 'Turn on'))) : null,
          noAccount ? h('div', { key: 'acc', className: 'kbmem-ninfo', 'data-card': 'no-account' }, h('span', null, kt('Non connecté : les notes à ton sujet vivent dans ton compte Kybernos. Les leçons ci-dessous restent sur cet ordinateur.', 'Not connected: notes about you live in your Kybernos account. The lessons below stay on this computer.')), h('button', { type: 'button', className: 'kbmem-link', 'data-act': 'connect', onClick: connectAccount }, kt('Connecte ton compte', 'Connect your account'))) : null,
          !noAccount && connected && list.ok !== true && !list.loading ? h('div', { key: 'err', className: 'kbmem-ninfo', 'data-card': 'error', role: 'alert' }, h('span', null, kt('Impossible de lire tes notes. ', 'Your notes could not be read. ') + friendlyError(list.error)), h('button', { type: 'button', className: 'kbmem-link', 'data-act': 'retry', onClick: bump }, kt('Réessayer', 'Try again'))) : null,
          saves > 0 ? h('div', { key: 'tidy', className: 'kbmem-ninfo', 'data-card': 'tidy' }, h('span', null, kt('Kybernos a trouvé ' + saves + ' groupe' + sfx(saves) + ' de notes qui se répètent ou se ressemblent. Rien n’a encore été changé.', 'Kybernos found ' + plural(saves, 'group') + ' of notes that repeat or look alike. Nothing has been changed yet.')), h('button', { type: 'button', className: 'kbmem-link', 'data-act': 'tidy-open', onClick: openReview }, kt('Examiner', 'Review'))) : null,
        ]
        const mine = [
          cards,
          h(MemSuggest, { key: 'sug', connected: !noAccount && connected, refreshKey, onChanged: bump, notify, onEdit: (it, done) => { setSay(it.text); pending.current = done; try { sayRef.current.focus() } catch (e) { /* the box is not mounted */ } } }),
          h(ClaudeImport, { key: 'cc', refreshKey }),
          h('div', { key: 'sr', className: 'kbmem-nsearch' }, Ico('search'), h('input', { type: 'search', 'aria-label': kt('Rechercher dans la mémoire', 'Search memory'), placeholder: kt('Rechercher dans la mémoire', 'Search memory'), value: q, onChange: (e) => setQ(e.target.value) })),
          h('div', { key: 'body', className: sw.use ? '' : 'dim' },
            list.loading && rows.length === 0 && groups.length === 0 ? SkelRows(4) : null,
            rows.length > 0 ? h('div', { className: 'kbmem-nsec', 'data-sec': 'about' }, kt('À ton sujet', 'About you')) : null,
            rows.map((m) => { const p = noteParts(m.content); return h(NoteRow, { key: 'm' + m.id, id: m.id, name: p.name, summary: p.rest, title: m.content, date: kt('Ajoutée ', 'Added ') + noteDate(m.ageMinutes), onOpen: () => openNote({ src: 'mem', item: m }) }) }),
            !searching && total > rows.length ? (rows.length < 200 ? h('button', { type: 'button', className: 'kbmem-nmore', 'data-act': 'more-about', onClick: () => setLimit(Math.min(200, limit + 50)) }, kt('Afficher ' + Math.min(50, total - rows.length) + ' de plus', 'Show ' + Math.min(50, total - rows.length) + ' more'))
              : h('div', { className: 'kbmem-nfoot' }, kt('Les 200 premières sont affichées sur ' + total + ' : utilise la recherche pour trouver les autres.', 'The first 200 of ' + total + ' are shown: use the search to find the others.'))) : null,
            groups.length > 0 ? h('div', { className: 'kbmem-nsec', 'data-sec': 'teams' }, kt('Apprises par tes équipes', 'Learned by your teams'), h('span', { className: 'cp' }, kt('notes écrites par tes agents au travail', 'notes your agents wrote at work'))) : null,
            groups.map((g) => h(TeamGroup, { key: 'g' + g.kyber, g, searching, openNote, refreshKey })),
            noMatch ? h('div', { className: 'kbmem-nempty', style: { padding: '36px 0' } }, h('h3', null, kt('Aucune note ne correspond', 'No note matches'))) : null,
            fresh ? h('div', { className: 'kbmem-nempty', 'data-empty': 'fresh' }, h('h3', null, kt('Rien n’est encore retenu', 'Nothing remembered yet')),
              h('p', null, kt('Travaille comme d’habitude : Kybernos note ce qui dure. Tu peux aussi lui dire quelque chose ci-dessous, ou ', 'Just work as usual: Kybernos notes what lasts. You can also tell it something below, or '), h('button', { type: 'button', className: 'kbmem-link', 'data-act': 'import', onClick: openImport }, kt('importer ce qu’un autre assistant sait', 'import what another assistant knows')), '.')) : null,
            !fresh && total > 0 ? h('div', { className: 'kbmem-nfoot' }, h('button', { type: 'button', className: 'kbmem-link danger', 'data-act': 'wipe', onClick: () => openWipe(total) }, kt('Tout supprimer…', 'Delete all memory…'))) : null),
        ]
        return h('div', { className: 'kbmem-m has-say', 'data-nv': 'manage' },
          h('button', { type: 'button', className: 'kbmem-back', 'data-act': 'back', onClick: back }, Ico('left'), h('span', null, pageTitle())),
          h('div', { className: 'kbmem-ntop' }, h('h2', { className: 'kbmem-nh1' }, kt('Ta mémoire', 'Your memory')), h('span', { className: 'kbmem-grow' }),
            fresh ? null : h('button', { type: 'button', className: 'kbmem-link rlink', 'data-act': 'removed', onClick: openRemoved }, kt('Récemment supprimées · ', 'Recently removed · ') + removedCount)),
          teamAvail ? h('div', { className: 'kbmem-row2', style: { marginTop: 8 } }, h(Seg, { value: tab, onChange: setTab, label: 'Section', items: [{ v: 'mine', l: kt('Ta mémoire', 'Your memory') }, { v: 'team', l: 'Team' }] })) : null,
          tab === 'team' && teamAvail ? h(TeamPane, { team: teamFull, kybers, notify, bump, refreshKey, openReview: openTeamReview }) : mine,
          tab === 'team' && teamAvail ? null : sayBox)
      }

      // ── One note ─────────────────────────────────────────────────────────────────────────────────────
      const NoteView = ({ noteRef, team, kybers, notify, bump, back }) => {
        const mem = noteRef.src === 'mem'
        const item = noteRef.item
        const [editing, setEditing] = useState(false)
        const [busy, setBusy] = useState(false)
        const [text, setText] = useState(mem ? item.content : item.text)
        const [pinned, setPinned] = useState(mem ? item.pinned === true : false)
        const [days, setDays] = useState(mem && typeof item.retentionDays === 'number' ? item.retentionDays : 0)
        const [tags, setTags] = useState(mem ? '' : (item.tags || []).join(', '))
        const ownTitle = !mem && item.titled === true ? String(item.title || '') : ''
        const ownSummary = !mem && item.summarized === true ? String(item.summary || '') : ''
        const [title, setTitle] = useState(ownTitle)
        const [summary, setSummary] = useState(ownSummary)
        const [propose, setPropose] = useState(null)
        const teamInfo = team !== undefined && team.ok === true && team.team !== null ? team.team : null
        const canPropose = !mem && teamInfo !== null && teamInfo.available === true && team.settings.share === true
        const name = mem ? noteName(item.content) : lessonLine(item).name
        const fail = (r) => { setBusy(false); notify(friendlyError(r.error)) }
        const save = async () => {
          setBusy(true)
          if (mem) {
            const body = { id: item.id }
            if (text.trim() !== item.content) body.content = text
            if (pinned !== (item.pinned === true)) body.pinned = pinned
            if (typeof item.retentionDays === 'number' ? days !== item.retentionDays : days !== 0) body.retentionDays = days
            if (Object.keys(body).length === 1) { setBusy(false); setEditing(false); return undefined }
            const r = await api('/kybernos-cloud/memory/update', body)
            if (r.ok !== true) return fail(r)
          } else {
            const body = { id: item.id }
            if (text.trim() !== item.text) body.text = text
            const clean = tags.split(',').map((t) => t.trim()).filter((t) => t !== '')
            if (clean.join(',') !== (item.tags || []).join(',')) body.tags = clean
            if (title.trim() !== ownTitle) body.title = title.trim()
            if (summary.trim() !== ownSummary) body.summary = summary.trim()
            if (Object.keys(body).length === 1) { setBusy(false); setEditing(false); return undefined }
            const r = await api('/kybernos-memory/lessons/update', body)
            if (r.ok !== true) return fail(r)
          }
          bump()
          notify(kt('Enregistré', 'Saved'))
          back()
          return undefined
        }
        const remove = async () => {
          setBusy(true)
          const r = await api(mem ? '/kybernos-cloud/memory/delete' : '/kybernos-memory/lessons/delete', { id: item.id })
          if (r.ok !== true) return fail(r)
          bump()
          back()
          notify(kt('Supprimée.', 'Deleted.'), typeof r.run === 'string' ? async () => { const u = await api((mem ? TIDY_SOURCES.mem.base : TIDY_SOURCES.les.base) + '/undo', { run: r.run }); bump(); notify(u.ok === true ? kt('Restaurée.', 'Restored.') : friendlyError(u.error)) } : undefined)
          return undefined
        }
        const makeSkill = async () => {
          setBusy(true)
          const r = await suggestSkill([item])
          if (r.ok !== true) return fail(r)
          setBusy(false)
          notify(kt('Skill suggéré : « ' + r.proposal.name + ' ». Il attend ton accord dans Skills.', 'Skill suggested: “' + r.proposal.name + '”. It waits for your yes in Skills.'))
          return undefined
        }
        const blk = (label, value, key) => h('div', { key, className: 'kbmem-blk' }, h('div', { className: 'lb' }, label), h('div', { className: 'vl' }, value))
        const field = (label, id, control) => h('div', { key: id, className: 'kbmem-blk' }, h('label', { className: 'lb', htmlFor: id, style: { display: 'block' } }, label), control)
        let body
        if (editing) {
          body = [
            field(mem ? kt('Note', 'Note') : kt('Leçon', 'Lesson'), 'kbmem-e-text', h('textarea', { id: 'kbmem-e-text', className: 'kbmem-ta', value: text, disabled: busy, maxLength: mem ? NOTE_MAX_CHARS : 500, onChange: (e) => setText(e.target.value) })),
            mem ? h('div', { key: 'keep', className: 'kbmem-blk' }, h('label', { className: 'lb', htmlFor: 'kbmem-e-days', style: { display: 'block' } }, kt('Garder', 'Keep for')),
              h('select', { id: 'kbmem-e-days', className: 'kbmem-sel', value: days, disabled: busy || pinned, onChange: (e) => setDays(parseInt(e.target.value, 10)) },
                keepOptions().map(([v, l]) => h('option', { key: v, value: v }, l)).concat(keepOptions().some((o) => o[0] === days) ? [] : [h('option', { key: days, value: days }, kt(days + ' jours', days + ' days'))]))) : null,
            mem ? h('div', { key: 'pin', className: 'kbmem-blk kbmem-prow' }, h('span', null, kt('Épinglée : jamais supprimée par un rangement, envoyée en premier', 'Pinned: never removed by a tidy-up, sent first')), h(Switch, { on: pinned, label: kt('Épinglée', 'Pinned'), disabled: busy, onChange: setPinned })) : null,
            !mem ? field(kt('Titre (60 caractères au maximum)', 'Title (60 characters at most)'), 'kbmem-e-title', h('input', { id: 'kbmem-e-title', className: 'kbmem-sel wide', maxLength: 60, value: title, placeholder: String(item.title || ''), disabled: busy, onChange: (e) => setTitle(e.target.value) })) : null,
            !mem ? field(kt('Résumé (140 caractères au maximum)', 'Summary (140 characters at most)'), 'kbmem-e-sum', h('input', { id: 'kbmem-e-sum', className: 'kbmem-sel wide', maxLength: 140, value: summary, placeholder: String(item.summary || ''), disabled: busy, onChange: (e) => setSummary(e.target.value) })) : null,
            !mem ? field(kt('Étiquettes (séparées par des virgules, 5 au maximum)', 'Tags (comma separated, 5 at most)'), 'kbmem-e-tags', h('input', { id: 'kbmem-e-tags', className: 'kbmem-sel wide', value: tags, disabled: busy, onChange: (e) => setTags(e.target.value) })) : null,
            h('div', { key: 'acts', className: 'kbmem-nacts' }, h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'cancel', disabled: busy, onClick: () => { setEditing(false); setText(mem ? item.content : item.text) } }, kt('Annuler', 'Cancel')),
              h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'save', disabled: busy || text.trim() === '', onClick: () => { void save() } }, kt('Enregistrer', 'Save'))),
          ]
        } else if (mem) {
          body = [
            blk(kt('Ajoutée le', 'Added on'), noteDate(item.ageMinutes) + (item.pinned ? kt(' · épinglée', ' · pinned') : ''), 'when'),
            blk(kt('S’applique à', 'Applies to'), kt('Tous tes chats', 'All your chats'), 'scope'),
            blk(kt('Écrite par', 'Written by'), originWords(item) + (item.originKnown === false ? kt(' (déduit)', ' (inferred)') : ''), 'by'),
            typeof item.retentionDays === 'number' ? blk(kt('Conservée', 'Kept'), keepOptions().filter((o) => o[0] === item.retentionDays).map((o) => o[1])[0] || kt(item.retentionDays + ' jours', item.retentionDays + ' days'), 'keep') : null,
            blk(kt('Note', 'Note'), item.content, 'text'),
          ]
        } else {
          body = [
            blk(kt('Ajoutée le', 'Added on'), noteDate(item.ageMinutes), 'when'),
            blk(kt('Équipe', 'Team'), kyberName(item.kyber), 'team'),
            blk(kt('Écrite par', 'Written by'), item.from === 'page' ? kt('Toi', 'You') : kt('Un agent de l’équipe ' + kyberName(item.kyber), 'An agent of the ' + kyberName(item.kyber) + ' team'), 'by'),
            blk(kt('Utilisée', 'Used'), item.uses > 0 ? kt(item.uses + ' fois', item.uses + (item.uses === 1 ? ' time' : ' times')) : kt('Jamais', 'Never'), 'uses'),
            blk(kt('Leçon', 'Lesson'), item.text, 'text'),
            Array.isArray(item.tags) && item.tags.length > 0 ? blk(kt('Étiquettes', 'Tags'), item.tags.join(', '), 'tags') : null,
          ]
        }
        return h('div', { className: 'kbmem-m', 'data-nv': 'note' },
          h('button', { type: 'button', className: 'kbmem-back', 'data-act': 'back', onClick: back }, Ico('left'), h('span', null, kt('Ta mémoire', 'Your memory'))),
          h('div', { className: 'kbmem-dh' }, h('h2', null, name),
            editing ? null : [
              h('button', { key: 'e', type: 'button', className: 'kbmem-btn ghost', 'data-act': 'edit', disabled: busy, onClick: () => setEditing(true) }, kt('Modifier', 'Edit')),
              h('button', { key: 'd', type: 'button', className: 'kbmem-btn ghost danger', 'data-act': 'delete', disabled: busy, onClick: () => { void remove() } }, Ico('trash'), kt('Supprimer', 'Delete'))]),
          body,
          !mem && !editing ? h('div', { className: 'kbmem-nacts' },
            canPropose ? h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'propose-team', disabled: busy, onClick: () => setPropose({ text: item.text, kyber: item.kyber === 'default' ? null : item.kyber, tags: item.tags || [] }) }, Ico('share'), kt('Proposer à l’équipe', 'Propose to team')) : null,
            h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'make-skill', disabled: busy, title: kt('Une liste de pièges avec les mots de cette leçon, qui attend ton accord dans Skills. Aucun modèle, aucun coût.', 'A checklist of pitfalls in this lesson’s own words, waiting for your yes in Skills. No model, no cost.'), onClick: () => { void makeSkill() } }, Ico('wand'), kt('Faire un skill', 'Make a skill'))) : null,
          !mem && !editing ? h('div', { className: 'kbmem-tiny', style: { marginTop: 14 } }, kt('Une leçon supprimée va dans les archives de l’équipe d’agents IA : elle revient depuis « Récemment supprimées » pendant 30 jours.', 'A deleted lesson goes to the AI agent team’s archive: it comes back from Recently removed for 30 days.')) : null,
          propose !== null ? h(ProposeSheet, { initial: propose, kybers, admin: isTeamAdmin(teamInfo === null ? null : teamInfo.role), onClose: () => setPropose(null), onDone: (m) => { setPropose(null); bump(); notify(m) }, notify }) : null)
      }

      // ── Dialogs: import, recently removed, delete everything ─────────────────────────────────────────
      const importPrompt = () => kt(
        'Liste tout ce que tu as appris sur moi, pour que je puisse le transférer vers un autre assistant.\n\nÉcris une note par ligne, en phrases simples, sans numérotation. Garde cet ordre :\n\n1. Sur moi (nom, métier, langue, fuseau horaire, façon de travailler)\n2. Mon activité et mes projets (ce que je vends, les outils que j’utilise, les clients que je cite)\n3. Ce qui a changé avec le temps : garde seulement la version la plus récente\n\nDes faits, pas des instructions à suivre. Garde seulement ce qui est encore vrai. Ne devine pas. Laisse de côté les mots de passe, les numéros de carte et les détails de santé.',
        'List everything you have learned about me, so I can move it to another assistant.\n\nWrite one note per line, in plain sentences, with no numbering. Keep this order:\n\n1. About me (name, job, language, time zone, how I like to work)\n2. My business and my projects (what I sell, tools I use, customers I mention)\n3. Things that changed over time: keep only the newest version\n\nFacts only, not instructions to follow. Keep only what is still true. Do not guess. Leave out passwords, card numbers and health details.')

      const ImportDialog = ({ onClose, notify, bump, connected }) => {
        const [paste, setPaste] = useState('')
        const [copied, setCopied] = useState(false)
        const [progress, setProgress] = useState(null)
        const lines = parseImport(paste)
        const copy = async () => { try { await navigator.clipboard.writeText(importPrompt()); setCopied(true) } catch (e) { notify(kt('Copie impossible : sélectionne le texte et copie-le à la main.', 'Copy failed: select the text and copy it by hand.')) } }
        const run = async () => {
          if (lines.length === 0 || progress !== null) return
          const tally = { added: 0, same: 0, failed: 0 }
          let stop = ''
          for (let i = 0; i < lines.length; i += 1) {
            setProgress({ at: i + 1, of: lines.length })
            const r = await api('/kybernos-cloud/memory/add', { content: lines[i], kind: 'fact', pinned: false, source: 'taught' })
            if (r.ok === true) { if (r.same === true) tally.same += 1; else tally.added += 1 } else {
              tally.failed += 1
              if (r.error === 'non connecte' || r.error === 'compte_kybernos_non_connecte' || r.error === 'memoire_desactivee' || r.error === 'reseau') { stop = r.error; tally.failed += lines.length - i - 1; break }
            }
          }
          bump()
          onClose()
          notify(importResult(tally) + (stop !== '' ? ' ' + friendlyError(stop) : ''))
        }
        return h(Dialog, { title: kt('Importer la mémoire dans Kybernos', 'Import memory to Kybernos'), onClose: progress === null ? onClose : () => {}, wide: true },
          !connected ? h('div', { className: 'kbmem-note warn' }, Ico('cloud'), h('div', { className: 'kbmem-grow' }, kt('Non connecté : les notes sont ajoutées à ton compte Kybernos, connecte-le d’abord.', 'Not connected: notes are added to your Kybernos account, connect it first.')), h('button', { type: 'button', className: 'kbmem-btn sm', onClick: connectAccount }, kt('Connecte ton compte', 'Connect your account'))) : null,
          h('div', { className: 'kbmem-step' }, h('div', { className: 'no' }, '1'), h('div', { className: 'st' }, kt('Copie ce texte dans un chat avec ton autre assistant', 'Copy this prompt into a chat with your other assistant')),
            h('div', { className: 'bd' }, h('div', { className: 'kbmem-promptbox', 'data-box': 'prompt' }, h('button', { type: 'button', className: 'kbmem-btn ghost sm copyb', 'data-act': 'copy', onClick: () => { void copy() } }, Ico('copy'), copied ? kt('Copié', 'Copied') : kt('Copier', 'Copy')), importPrompt()))),
          h('div', { className: 'kbmem-step' }, h('div', { className: 'no' }, '2'), h('div', { className: 'st' }, kt('Colle le résultat ici pour l’ajouter à la mémoire de Kybernos', 'Paste the result below to add it to Kybernos’s memory')),
            h('div', { className: 'bd' }, h('textarea', { className: 'kbmem-ta in', 'aria-label': kt('Résultat à importer', 'Result to import'), placeholder: kt('Colle ici les détails de ta mémoire', 'Paste your memory details here'), value: paste, disabled: progress !== null, onChange: (e) => setPaste(e.target.value) }))),
          h('div', { className: 'kbmem-dacts' },
            h('span', { className: 'kbmem-hint', 'aria-live': 'polite' }, progress !== null ? kt('Ajout de ' + progress.at + ' sur ' + progress.of + '…', 'Adding ' + progress.at + ' of ' + progress.of + '…') : lines.length > 0 ? kt(lines.length + ' note' + sfx(lines.length) + ' à ajouter. Chaque ligne est comparée à ce que tu as déjà. Les règles durables, comme le ton ou le format, vont dans Instructions.', plural(lines.length, 'note') + ' to add. Each line is checked against what you already have. Standing rules, like tone or format, belong in Instructions.') : kt('Chaque ligne est comparée à ce que tu as déjà. Les règles durables, comme le ton ou le format, vont dans Instructions.', 'Each line is checked against what you already have. Standing rules, like tone or format, belong in Instructions.')),
            h('span', { className: 'kbmem-grow' }),
            h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'cancel', disabled: progress !== null, onClick: onClose }, kt('Annuler', 'Cancel')),
            h('button', { type: 'button', className: 'kbmem-btn', 'data-act': 'do-import', disabled: lines.length === 0 || progress !== null || !connected, onClick: () => { void run() } }, kt('Ajouter à la mémoire', 'Add to memory'))))
      }

      const RemovedDialog = ({ tidy, onClose, notify, bump }) => {
        const [busy, setBusy] = useState('')
        const rows = recentlyRemoved(tidy)
        const back = async (r) => {
          if (busy !== '') return
          setBusy(r.id)
          const u = await api(TIDY_SOURCES[r.src].base + '/undo', { run: r.id })
          setBusy('')
          bump()
          notify(u.ok === true ? (r.src === 'mem' ? kt('Restaurée : les originales sont revenues comme nouvelles notes.', 'Restored: the originals are back as new notes.') : kt('Restaurée : tout est revenu comme avant.', 'Restored: everything is back as it was.')) : friendlyError(u.error))
        }
        return h(Dialog, { title: kt('Récemment supprimées', 'Recently removed'), onClose, wide: true },
          h('p', { className: 'kbmem-hint' }, kt('Kybernos ne fusionne seul que ce que tu l’as laissé faire, et chaque fusion est archivée. Rien d’autre n’est supprimé sans toi. Tout ce qui est ici revient pendant 30 jours.', 'Kybernos only merges by itself what you let it, and every merge is archived. Nothing else is removed unless you delete it. Everything here comes back for 30 days.')),
          rows.length === 0 ? h('p', { className: 'kbmem-hint', style: { padding: '12px 0' }, 'data-empty': 'removed' }, kt('Rien n’a été supprimé récemment.', 'Nothing removed lately.'))
            : rows.map((r) => h('div', { key: r.src + r.id, className: 'kbmem-tl', 'data-run': r.id }, h('div', { className: 't' }, r.name, h('div', { className: 'd' }, r.why + ' · ' + r.when)),
              h('button', { type: 'button', className: 'kbmem-btn ghost sm', 'data-act': r.button === 'Restore' ? 'restore' : 'undo', disabled: busy !== '', onClick: () => { void back(r) } }, r.button === 'Restore' ? kt('Restaurer', 'Restore') : kt('Défaire', 'Undo')))),
          rows.length > 0 ? h('div', { className: 'kbmem-dacts' }, h('span', { className: 'kbmem-hint' }, kt('Elles disparaissent d’elles-mêmes au bout de 30 jours.', 'They also disappear on their own after 30 days.'))) : null)
      }

      const WipeDialog = ({ count, onClose, notify, bump }) => {
        const [busy, setBusy] = useState(false)
        const go = async () => {
          setBusy(true)
          const r = await api('/kybernos-cloud/memory/wipe', { confirm: true })
          bump()
          onClose()
          notify(r.ok !== true ? friendlyError(r.error) : (r.failed > 0 ? kt(r.deleted + ' notes supprimées, ' + r.failed + ' n’ont pas pu l’être.', r.deleted + ' notes deleted, ' + r.failed + ' could not be.') : kt(r.deleted + ' note' + sfx(r.deleted) + ' supprimée' + sfx(r.deleted) + '.', plural(r.deleted, 'note') + ' deleted.')))
        }
        return h(Dialog, { title: kt('Tout supprimer définitivement ?', 'Delete all memory for good?'), onClose },
          h('p', { className: 'kbmem-hint big' }, kt('Kybernos supprime les ' + count + ' notes à ton sujet. Les leçons de tes équipes ne sont pas touchées. C’est définitif : « Récemment supprimées » est vidée aussi.', 'Kybernos deletes all ' + count + ' notes about you. Your teams’ lessons are not touched. This cannot be undone: Recently removed is emptied too.')),
          h('div', { className: 'kbmem-dacts' }, h('span', { className: 'kbmem-grow' }),
            h('button', { type: 'button', className: 'kbmem-btn ghost', 'data-act': 'cancel', disabled: busy, onClick: onClose }, kt('Annuler', 'Cancel')),
            h('button', { type: 'button', className: 'kbmem-btn danger solid', 'data-act': 'wipe-yes', disabled: busy, onClick: () => { void go() } }, busy ? kt('Suppression…', 'Deleting…') : kt('Tout supprimer', 'Delete everything'))))
      }

      function Page() {
        const [nview, setNview] = useState('settings')      // settings | manage | note | review | teamreview
        const [ntab, setNtab] = useState('mine')            // « Your memory » or, on a Team offer, « Team »
        const [noteRef, setNoteRef] = useState(null)
        const [dialog, setDialog] = useState(null)          // null | { kind: 'import' | 'removed' | 'wipe', count }
        const [exporting, setExporting] = useState(false)
        const [refreshKey, setRefreshKey] = useState(0)
        const [toast, setToast] = useState(null)
        const timer = useRef(null)
        const bump = useCallback(() => setRefreshKey((k) => k + 1), [])
        // « Open » on the line in the chat lands here: the note it points at opens at once (the hand-over is taken once, and only while fresh).
        useEffect(() => {
          const take = () => { const item = notedOpen.take(); if (item !== null) { setNoteRef({ src: 'mem', item }); setNview('note') } }
          take()
          notedOpen.subs.add(take)
          return () => { notedOpen.subs.delete(take) }
        }, [])
        const status = useStatus(refreshKey)
        const settings = useSettings(refreshKey)
        const [tidy, adopt] = useTidy(refreshKey)
        const team = useTeam(refreshKey)
        const [kybersForTeam, setKybersForTeam] = useState([])
        useEffect(() => { let live = true; api('/kybernos-memory/kybers').then((r) => { if (live && r.ok === true) setKybersForTeam(r.kybers) }); return () => { live = false } }, [refreshKey])
        const [scanning, setScanning] = useState(false)
        const [autoRun, setAutoRun] = useState(null)
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
          const pick = (r) => (r.auto !== undefined && r.auto !== null ? { groups: r.auto.groups, removed: r.auto.removed, runs: r.auto.runs, brain: Number.isFinite(r.auto.brain) ? r.auto.brain : 0 } : null)
          const a = { mem: pick(m), les: pick(l), brainError: [m, l].map((r) => (r.brain !== undefined && r.brain !== null && r.brain.error ? r.brain.error : null)).find((e) => e !== null) || null, brainDetail: [m, l].map((r) => (r.brain !== undefined && r.brain !== null && r.brain.detail ? r.brain.detail : null)).find((e) => e !== null) || null }
          setAutoRun(a)
          adopt(m, l)
          setNview('review')
          const groups = (a.mem === null ? 0 : a.mem.groups) + (a.les === null ? 0 : a.les.groups)
          const gone = (a.mem === null ? 0 : a.mem.removed) + (a.les === null ? 0 : a.les.removed)
          if (groups > 0) notify(kt(groups + ' groupe' + sfx(groups) + ' fusionné' + sfx(groups) + ' automatiquement · ' + gone + ' élément' + sfx(gone) + ' supprimé' + sfx(gone), 'Merged ' + plural(groups, 'group') + ' by itself · ' + plural(gone, 'item') + ' removed'), async () => { const r = await undoAuto(a); notify(r.back === r.total ? kt('Défait : tout est revenu', 'Undone: everything is back') : kt('Défait : ' + String(r.back) + ' sur ' + String(r.total) + ' ; retrouve le reste dans « Récemment supprimées »', 'Undid ' + String(r.back) + ' of ' + String(r.total) + ': the rest is in Recently removed')) })
        }
        const toReview = () => { setAutoRun(null); setNview('review') }
        // One setter for the three switches: it writes both hosts, tolerates one being away, and reads the settings again.
        const setSwitch = async (key, v) => {
          const p = switchPatches(key, v, settings.memory, settings.lessons)
          const rs = await Promise.all([p.cloud !== null ? api('/kybernos-cloud/memory/settings/set', p.cloud) : Promise.resolve(null), p.lessons !== null ? api('/kybernos-memory/settings/set', p.lessons) : Promise.resolve(null)])
          const done = rs.filter((r) => r !== null)
          if (done.length > 0 && !done.some((r) => r.ok === true)) notify(friendlyError(done[0].error))
          bump()
        }
        // The export: plain text files in a zip, built here from what the two hosts list (nothing is sent anywhere).
        const exportNow = async () => {
          if (exporting) return
          setExporting(true)
          try {
            const about = []
            for (let off = 0; off < 2000; off += 200) {
              const r = await api('/kybernos-cloud/memory/list?limit=200&offset=' + off)
              if (r.ok !== true) break
              about.push(...r.items)
              if (about.length >= r.total || r.items.length === 0) break
            }
            const teams = []
            const ks = await api('/kybernos-memory/kybers')
            for (const k of ks.ok === true ? ks.kybers : []) {
              const lessons = []
              for (let off = 0; off < 2000; off += 200) {
                const r = await api('/kybernos-memory/lessons?limit=200&offset=' + off + '&kyber=' + encodeURIComponent(k.id))
                if (r.ok !== true) break
                lessons.push(...r.items)
                if (lessons.length >= r.total || r.items.length === 0) break
              }
              teams.push({ kyber: k.id === 'default' ? 'general' : k.id, lessons })
            }
            const files = exportFiles({ about, teams })
            if (files.length === 0) { notify(kt('Rien à exporter pour l’instant.', 'Nothing to export yet.')); return }
            const blob = new Blob([zipFiles(files)], { type: 'application/zip' })
            const url = URL.createObjectURL(blob)
            const a = document.createElement('a')
            a.href = url
            a.download = 'kybernos-memory-' + new Date().toISOString().slice(0, 10) + '.zip'
            document.body.appendChild(a)
            a.click()
            a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 10000)
            notify(kt('Export prêt : ' + files.length + ' fichier' + sfx(files.length) + ' dans le .zip.', 'Export ready: ' + plural(files.length, 'file') + ' in the .zip.'))
          } catch (e) { notify(kt('L’export a échoué.', 'The export failed.')) } finally { setExporting(false) }
        }
        const removedCount = tidy.loaded === true ? recentlyRemoved(tidy).length : 0
        const goManage = () => { setNoteRef(null); setNview('manage') }
        const memoryPage = nview === 'review'
          ? h(ReviewView, { key: scanKey(tidy), tidy, back: goManage, notify, bump, scan, scanning, auto: autoRun, onUndoAuto: undoAuto })
          : nview === 'teamreview'
            ? h(TeamReviewView, { team: team.team === null ? {} : team.team, kybers: kybersForTeam, back: () => { setNtab('team'); setNview('manage') }, notify, bump, refreshKey })
            : nview === 'note' && noteRef !== null
              ? h(NoteView, { key: noteRef.src + String(noteRef.item.id), noteRef, team, kybers: kybersForTeam, notify, bump, back: goManage })
              : nview === 'manage'
                ? h(ManageView, { status, settings, tidy, team, kybers: kybersForTeam, notify, bump, refreshKey, back: () => setNview('settings'), openNote: (ref) => { setNoteRef(ref); setNview('note') }, openRemoved: () => setDialog({ kind: 'removed' }), openImport: () => setDialog({ kind: 'import' }), openWipe: (count) => setDialog({ kind: 'wipe', count }), openReview: toReview, openTeamReview: () => setNview('teamreview'), removedCount, tab: ntab, setTab: setNtab, setSwitch })
                : h(SettingsView, { status, settings, tidy, notify, setSwitch, openManage: () => { bump(); goManage() }, openImport: () => setDialog({ kind: 'import' }), exportNow, exporting, scan, scanning, openReview: toReview, bump })
        const dialogs = dialog === null ? null
          : dialog.kind === 'import' ? h(ImportDialog, { onClose: () => setDialog(null), notify, bump, connected: status.connected === true })
            : dialog.kind === 'removed' ? h(RemovedDialog, { tidy, onClose: () => setDialog(null), notify, bump })
              : h(WipeDialog, { count: dialog.count, onClose: () => setDialog(null), notify, bump })
        return h('div', { className: 'kbmem-page', 'data-kbmem': 'memory', 'data-nv-view': nview },
          memoryPage, dialogs,
          toast !== null ? h('div', { className: 'kbmem-toast', role: 'status', 'aria-live': 'polite' }, toast.message,
            toast.undo ? h('button', { type: 'button', 'data-act': 'undo', onClick: () => { const u = toast.undo; setToast(null); u() } }, kt('Défaire', 'Undo')) : null) : null)
      }

      // ═══════════════════════════════════════════════════════════════
      // 5b. THE « NOTED » LINE IN THE CHAT (2026-11-20)
      // ═══════════════════════════════════════════════════════════════
      // When Kaby saves something to memory during a conversation, one quiet line sits under the last answer: « Noted: … », with a way to open the note and one tap to take
      // it back. The host holds the pointer (which chat wrote which note, ids and times only) and the line reads the note from the account, so a note the person removed is
      // simply not there. Undo is the page's own delete: the note goes to « Recently removed » for 30 days, nothing is lost for good by a tap.
      const NOTED_SHOWN = 3
      const NOTED_POLLS = [0, 3000, 10000, 25000]   // the capture writes AFTER the answer: the line looks again a few times, then stops
      const NOTED_CLAIMS_MAX = 400
      /** The words of a note on one line: folded, and a long one cut on a word. */
      const notedLine = (text) => {
        const t = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim()
        if (t.length <= 110) return t
        const cut = t.slice(0, 110)
        const sp = cut.lastIndexOf(' ')
        return (sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s.,;:]+$/, '') + '…'
      }
      /** The turn's number in the chat (the slot gives the closing sequence; an older shell gave `turn`): absent when it is neither. */
      const notedSeq = (props) => (props !== null && props !== undefined ? (typeof props.seq === 'number' ? props.seq : (typeof props.turn === 'number' ? props.turn : undefined)) : undefined)
      /** A note belongs to the first turn that sees it and is shown under that turn only (the slot runs for every answer). With no turn number nothing is claimed away: it fails open. */
      const notedClaim = (store, sid, seq, ids) => {
        if (typeof seq !== 'number') return ids.slice()
        const mine = []
        for (const id of ids) {
          const key = sid + ':' + String(id)
          const owner = store.claims.get(key)
          if (owner === undefined) { store.claims.set(key, seq); mine.push(id) } else if (owner === seq) mine.push(id)
        }
        while (store.claims.size > NOTED_CLAIMS_MAX) store.claims.delete(store.claims.keys().next().value)
        return mine
      }
      /** What the host said to the delete: undone, the note was already gone (the server's 404), or a refusal the person can retry. */
      const notedUndoState = (r) => (r !== null && r !== undefined && r.ok === true ? 'undone' : (r !== null && r !== undefined && r.error === 'refus_404' ? 'gone' : 'failed'))
      const undoNoted = async (id) => notedUndoState(await api('/kybernos-cloud/memory/delete', { id }))
      const notedStore = { max: new Map(), claims: new Map(), subs: new Set() }
      /** The label the Settings nav shows for this page: the one registered at mount (the shell draws that string, whatever the language is later). */
      let navLabel = null
      /** Open: the note travels to the page in a hand-over, taken once and only while fresh (a click that never reached the page must not open a note later). */
      const notedOpen = {
        pending: null,
        subs: new Set(),
        give(item) { this.pending = { item, at: Date.now() }; this.subs.forEach((f) => { try { f() } catch (e) { /* one listener must not stop the others */ } }) },
        take() { const p = this.pending; this.pending = null; return p !== null && Date.now() - p.at < 15000 ? p.item : null },
      }
      /** Settings on the Memory page: the Settings button, then the page's cell BY ITS LABEL (the hashed class names change at every build; the same two anchors as the Memory card of the sessions plugin). */
      const openMemorySettings = async () => {
        try {
          const labels = [navLabel, pageTitle(), PAGE_TITLE].filter((x) => typeof x === 'string' && x !== '')
          const navVisible = () => { const nav = document.querySelector('[class*="navList"]'); return nav !== null && nav.offsetParent !== null }
          const find = () => Array.prototype.slice.call(document.querySelectorAll('[class*="navCell"]')).filter((x) => labels.indexOf(String(x.textContent || '').trim()) >= 0)[0]
          if (!navVisible()) {
            const trigger = document.querySelector('[class*="settingsArea"] button[class*="trigger"]') || document.querySelector('button[aria-label="Settings"]')
            if (trigger === null) return false
            trigger.click()
          }
          for (let i = 0; i < 40; i += 1) {
            const cell = find()
            if (cell !== undefined) { (cell.querySelector('button,[role="button"]') || cell).click(); return true }
            await new Promise((r) => setTimeout(r, 100))
          }
          return false
        } catch (e) { return false }
      }

      /** The lines themselves (no state of their own: the tail below holds it). `status[id]`: busy | undone | gone | failed. */
      function NotedLines({ notes, status, onOpen, onUndo }) {
        const shown = notes.slice(0, NOTED_SHOWN)
        if (shown.length === 0) return null
        return h('div', { className: 'kbmem-noted-wrap', 'data-kbmem': 'noted' }, shown.map((n) => {
          const st = status[n.id]
          const name = notedLine(noteParts(n.item.content).name)
          const lead = st === 'undone' ? kt('Défait : ', 'Undone: ') : st === 'gone' ? kt('Déjà retiré : ', 'Already removed: ') : kt('Noté : ', 'Noted: ')
          const closed = st === 'undone' || st === 'gone'
          return h('div', { key: 'n' + String(n.id), className: 'kbmem-noted', 'data-kbmem': 'noted-line', 'data-state': st === undefined ? 'ready' : st },
            h('span', { className: 'kbmem-noted-text' }, lead + name),
            st === 'failed' ? h('span', { className: 'kbmem-noted-err' }, kt('Impossible de défaire pour l’instant.', 'Could not undo just now.')) : null,
            closed ? null : h('button', { type: 'button', 'data-act': 'noted-open', disabled: st === 'busy', onClick: () => onOpen(n) }, kt('Ouvrir', 'Open')),
            closed ? null : h('button', { type: 'button', 'data-act': 'noted-undo', disabled: st === 'busy', onClick: () => onUndo(n) }, kt('Défaire', 'Undo')))
        }))
      }

      /** At the end of the last answer of a chat: what was noted from THIS chat (a light read of the host for this chat only; an absent route or a signed-out account draws nothing). */
      function NotedTail(props) {
        const sid = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''
        const seq = notedSeq(props)
        const [last, setLast] = useState(typeof seq !== 'number' ? true : (notedStore.max.get(sid) === undefined ? true : notedStore.max.get(sid) === seq))
        const [notes, setNotes] = useState([])
        const [status, setStatus] = useState({})
        const alive = useRef(true)
        useEffect(() => () => { alive.current = false }, [])
        useEffect(() => {
          if (typeof seq !== 'number' || sid === '') return undefined
          const refresh = () => setLast(notedStore.max.get(sid) === seq)
          notedStore.subs.add(refresh)
          if (seq > (notedStore.max.get(sid) === undefined ? -1 : notedStore.max.get(sid))) { notedStore.max.set(sid, seq); notedStore.subs.forEach((f) => { try { f() } catch (e) { /* one listener must not stop the others */ } }) }
          setLast(notedStore.max.get(sid) === seq)
          return () => { notedStore.subs.delete(refresh) }
        }, [sid, seq])
        useEffect(() => {
          if (sid === '' || last !== true) return undefined
          let stopped = false
          const read = async () => {
            const r = await api('/kybernos-cloud/memory/noted?sessionId=' + encodeURIComponent(sid))
            if (stopped || alive.current !== true || r === null || r.ok !== true || !Array.isArray(r.notes)) return
            const mine = notedClaim(notedStore, sid, seq, r.notes.map((n) => n.id))
            // What the person undid here stays on the line (« Undone: … ») though the account no longer holds it; a note that vanished any other way is not shown.
            setNotes((prev) => r.notes.filter((n) => mine.indexOf(n.id) >= 0).concat(prev.filter((n) => !r.notes.some((m) => m.id === n.id) && n.kept === true)))
          }
          const timers = NOTED_POLLS.map((ms) => setTimeout(read, ms))
          return () => { stopped = true; timers.forEach(clearTimeout) }
        }, [sid, last, seq])
        if (last !== true || notes.length === 0) return null
        const mark = (n, v, keep) => {
          setStatus((m) => ({ ...m, [n.id]: v }))
          if (keep === true) setNotes((prev) => prev.map((x) => (x.id === n.id ? { ...x, kept: true } : x)))
        }
        const onUndo = async (n) => {
          mark(n, 'busy')
          const v = await undoNoted(n.id)
          if (alive.current === true) mark(n, v, v !== 'failed')
        }
        const onOpen = async (n) => {
          notedOpen.give(n.item)
          const opened = await openMemorySettings()
          if (opened !== true) { notedOpen.pending = null; if (alive.current === true) mark(n, 'failed') }
        }
        return h(NotedLines, { notes, status, onOpen, onUndo })
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
        __test: { noteDate, noteParts, noteName, parseImport, importResult, switchState, switchPatches, recentlyRemoved, groupLessons, crc32, zipFiles, exportFiles, NOTE_MAX_CHARS, suggestSkill, importCounts, importWords, importCountWords, importError, IMPORT_SHOWN, connectAccount, PAGE_TITLE, isTeamAdmin, minutesSince, teamStatusChip, teamMatches, teamMeta, TIDY_MODES: tidyModes(), tidySettingsOf, tidyBrain, TIDY_SHOWN, visibleItems, TIDY_MAX_REMOVALS, TIDY_SOURCES, plural, whenLabel, groupRemovals, tidyChunks, keeperOf, tidyBody, asTidyView, tidySaves, scanKey, onEscape, planOf, ageLabel, listUrl, defaultFilters, friendlyError, api, Page, css, notedLine, notedSeq, notedClaim, notedUndoState, undoNoted, notedOpen, NotedLines, NotedTail, NOTED_SHOWN },
        apply(ctx) {
          if (ctx === null || ctx === undefined || ctx.slots === null || ctx.slots === undefined) return
          ctx.effect(() => styles.insert(css), 'kybernos-memory: styles')
          navLabel = pageTitle()
          ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register(
            { name: 'settings.section', id: 'kybernos-memory', order: 3, label: pageTitle() },
            (props) => h(Page, props))), 'kybernos-memory: memory & lessons settings section')
          // At the end of the last answer of a chat: what Kaby just noted from THIS chat. A failure here never touches the settings section above.
          try {
            ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
              { name: 'conversation.chat.turnTail', id: 'kybernos-memory-noted', order: 58 }, NotedTail)), 'kybernos-memory: « Noted » line under the last answer')
          } catch (notedMountError) {
            try { console.warn('[kybernos-memory] the Noted line is not mounted', notedMountError) } catch (e2) { /* console unavailable */ }
          }
        },
      }
    } catch (kbMemBootError) {
      try { console.error('[kybernos-memory] load failed — plugin disabled, GUI preserved', kbMemBootError) } catch (e2) { /* console unavailable */ }
      return { apply() { /* plugin disabled after a load error */ } }
    }
  },
})
