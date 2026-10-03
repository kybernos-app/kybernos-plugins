// ── Plugin client « kybernos-slash » ─────────────────────────────────────────
// Rend VISIBLES et UTILISABLES, dans le vrai client DSH, les entrées que le
// skill `slash-msgaction-creator` écrit via la route /kybernos/slash/entries.
//
// Quatre surfaces, une seule source de vérité (le magasin du hôte) :
//   1. la PALETTE « / » — on ne réinvente pas la roue : le composeur DSH a un
//      pipeline de déclencheurs officiel (`ctx.inputTriggers.registerSource`),
//      qui fait la détection du jeton AU CURSEUR, le filtrage, les flèches,
//      Entrée/Tab/Échap, et l'insertion au span exact (`insertText`). Notre
//      source fournit les candidats et dit quoi insérer.
//   2. le FORMULAIRE INLINE — pour une entrée qui déclare des champs, dans
//      `conversation.input.overlay` (l'ancre du composeur), conditions et
//      champs requis vivants.
//   3. la BARRE D'ACTIONS DES MESSAGES — `conversation.chat.assistant-actions`.
//   4. la SECTION DE RÉGLAGES « Commands » — liste, éditeur, JSON.
//
// Le cœur sémantique est `kybernos-slash/model.js`, embarqué ici entre les
// marqueurs KB-MODEL-BEGIN / KB-MODEL-END : un bundle navigateur ne peut pas
// importer un fichier du paquet, et le dupliquer en silence ferait diverger la
// maquette, le hôte et le client. `scripts/test-kybernos-slash-parity.mjs`
// extrait ce bloc et le compare à `model.js` cas par cas — si les deux copies
// s'éloignent, le harnais casse.
//
// Aucune boîte de dialogue : « Create with AI » démarre un chat neuf et écrit
// le prompt dans le champ de saisie, comme « Create AI Team ».
window.__ModuleLoader__.load({
  id: '@local/kybernos-slash',
  factory(require) {
    try {
      const React = require('react')
      // L'editeur et la notification doivent passer DEVANT toute l'application.
      // Le creneau `shell.overlay` vit dans un contexte d'empilement plus bas que
      // la rangee du composeur et que la page Reglages : la notification s'y
      // retrouvait recouverte (le bouton Undo etait incliquable). On les monte
      // donc dans le corps du document, comme le fait DSH pour ses menus.
      const ReactDOM = (() => { try { return require('react-dom') } catch (e) { return null } })()
      const h = React.createElement

      // ══════════════════════════════════════════════════════════════════════
      // KB-MODEL-BEGIN — copie conforme de kybernos-slash/model.js
      // ══════════════════════════════════════════════════════════════════════
      const OPS = ['=', '!=', '>', '<', '>=', '<=', 'in', 'contains', 'empty', 'notEmpty']
      const OP_ALIASES = { eq: '=', neq: '!=', equals: '=', notEquals: '!=', contains: 'contains', in: 'in' }
      const normalizeOp = (op) => OP_ALIASES[op] || op
      function isEmpty(v) {
        if (v === null || v === undefined || v === '' || v === false) return true
        return Array.isArray(v) && v.length === 0
      }
      function compare(left, op, right) {
        const o = normalizeOp(op)
        const num = (x) => (x === '' || x === null || x === undefined ? NaN : Number(x))
        switch (o) {
          case '=':
            if (typeof right === 'boolean') return Boolean(left) === right
            if (typeof left === 'boolean') return left === (right === true || right === 'true')
            return String(left === undefined || left === null ? '' : left) === String(right === undefined || right === null ? '' : right)
          case '!=': return !compare(left, '=', right)
          case '>': return num(left) > num(right)
          case '<': return num(left) < num(right)
          case '>=': return num(left) >= num(right)
          case '<=': return num(left) <= num(right)
          case 'in': {
            const list = Array.isArray(right) ? right : String(right === undefined || right === null ? '' : right).split(',')
            return list.map((x) => String(x).trim()).indexOf(String(left)) >= 0
          }
          case 'contains': {
            if (Array.isArray(left)) return left.map(String).indexOf(String(right)) >= 0
            return String(left === undefined || left === null ? '' : left).indexOf(String(right === undefined || right === null ? '' : right)) >= 0
          }
          case 'empty': return isEmpty(left)
          case 'notEmpty': return !isEmpty(left)
          default: return false
        }
      }
      function toConditions(x) {
        if (Array.isArray(x)) return x
        if (x !== null && typeof x === 'object' && x.field !== undefined) {
          const raw = x.op !== undefined ? x.op : (x.operator !== undefined ? x.operator : (x.equals !== undefined ? '=' : '='))
          return [{ field: x.field, op: normalizeOp(raw) || '=', value: x.value !== undefined ? x.value : x.equals }]
        }
        return []
      }
      const conditionsHold = (conds, values) => toConditions(conds).every((c) => compare((values || {})[c.field], c.op, c.value))
      function isVisible(field, values) {
        const v = values || {}
        if (conditionsHold(field.showIf !== undefined ? field.showIf : field.visibleWhen, v) === false) return false
        if (toConditions(field.hideIf).length > 0 && conditionsHold(field.hideIf, v)) return false
        return true
      }
      function isRequired(field, values) {
        if (isVisible(field, values) === false) return false
        return field.required === true || (toConditions(field.requireIf).length > 0 && conditionsHold(field.requireIf, values))
      }
      const visibleFields = (entry, values) => (entry.fields || []).filter((f) => isVisible(f, values))
      function defaultsOf(entry, values) {
        const out = Object.assign({}, values || {})
        for (let pass = 0; pass < 8; pass += 1) {
          let changed = false
          visibleFields(entry, out).forEach((f) => {
            if (out[f.key] === undefined && f.default !== undefined) { out[f.key] = f.default; changed = true }
          })
          if (changed === false) break
        }
        return out
      }
      function validate(entry, values) {
        const invalid = visibleFields(entry, values)
          .filter((f) => isRequired(f, values) && isEmpty((values || {})[f.key]))
          .map((f) => f.key)
        return { ok: invalid.length === 0, invalid }
      }
      function render(template, values, extra) {
        const all = Object.assign({}, values || {}, extra || {})
        return String(template || '')
          .replace(/\{(\w+)\}/g, (m, k) => {
            const v = all[k]
            if (v === undefined || v === null || v === '') return ''
            if (typeof v === 'boolean') return v ? 'oui' : 'non'
            return String(v)
          })
          .replace(/[^\S\n]+$/gm, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
      }
      const hasForm = (entry) => (entry.fields || []).length > 0
      const runOf = (entry) => (entry.run || (hasForm(entry) ? 'form' : 'text'))
      // ══════════════════════════════════════════════════════════════════════
      // KB-MODEL-END
      // ══════════════════════════════════════════════════════════════════════

      // ── Règle 12 : la valeur d'un champ masqué sort du texte, sans être effacée.
      function effectiveValues(entry, values) {
        const declared = (entry.fields || []).map((f) => f.key)
        const shown = visibleFields(entry, values).map((f) => f.key)
        const out = {}
        Object.keys(values || {}).forEach((k) => {
          if (declared.indexOf(k) >= 0 && shown.indexOf(k) < 0) return
          if (values[k] !== undefined) out[k] = values[k]
        })
        return out
      }

      // ── Libellés : une chaîne, ou {fr,en,ar} (règle 9) ────────────────────
      const LANG = (() => {
        try {
          const l = (typeof navigator !== 'undefined' && navigator.language) ? String(navigator.language).slice(0, 2).toLowerCase() : 'en'
          return l === 'fr' ? 'fr' : 'en'
        } catch (e) { return 'en' }
      })()
      const L = (v) => (v === null || v === undefined ? '' : (typeof v === 'object' ? (v[LANG] || v.en || v.fr || '') : String(v)))

      // ── Accès aux entrées du hôte ─────────────────────────────────────────
      const API = '/kybernos/slash/entries'
      const AI_REF = '/skill-slash-msgaction-creator'
      const AI_VALUE = '__kybernos_slash_ai__'
      const store = { entries: [], loaded: false, loading: false, error: null, version: 0 }
      const subs = new Set()
      const notify = () => { store.version += 1; for (const fn of Array.from(subs)) { try { fn() } catch (e) { /* abonne mort */ } } }
      const onStore = (fn) => { subs.add(fn); return () => { subs.delete(fn) } }

      // Surface de diagnostic. Le plugin vit dans une page où l'on n'a pas de
      // console : `window.__kybernosSlash` dit ce qui est réellement branché et
      // combien d'entrées sont chargées. Sans elle, une palette silencieusement
      // inerte ne se distingue pas d'une palette absente — c'est exactement
      // l'erreur qui a fait cliquer un jeton au lieu d'une ligne de menu.
      const diag = { version: null, slots: false, palette: false, theme: 0, entries: 0, error: null, queries: 0, lastQuery: null, lastOut: 0, picks: 0, lastOutcome: null, portal: false, envoi: null, shellApi: null }
      try { if (typeof window !== 'undefined') window.__kybernosSlash = diag } catch (e) { /* page sans window */ }

      const entryOf = (id) => store.entries.filter((e) => idOf(e) === id)[0]
      const idOf = (e) => {
        if (e === null || e === undefined || typeof e !== 'object') return null
        const raw = e.id !== undefined ? e.id : (e.slug !== undefined ? e.slug : e.name)
        return raw === undefined || raw === null ? null : String(raw).replace(/^\/+/, '')
      }
      const nameOf = (e) => String(e.slug !== undefined ? e.slug : (e.name !== undefined ? e.name : idOf(e) || '')).replace(/^\/+/, '')
      const listOf = (kind) => store.entries
        .filter((e) => (e.kind === 'action' ? 'action' : 'slash') === kind)
        .sort((a, b) => ((Number(a.order) || 0) - (Number(b.order) || 0)) || nameOf(a).localeCompare(nameOf(b)))

      // ── Étape 4 : où va le texte ? ────────────────────────────────────────
      // Le choix vit dans le modèle (`delivery`). L'hôte du profil est chargé au
      // démarrage de `dsh web` : tant qu'il n'a pas été redémarré, il ne connaît
      // pas ce champ et le retire à l'écriture. Une copie locale par `id` garde
      // donc le choix dès aujourd'hui ; `entry.delivery` reprend la main dès que
      // l'hôte sait l'écrire (la valeur est la même, il n'y a pas de conflit).
      const KB_ENVOI_CLE = 'kybernos-slash-delivery'
      const kbEnvoiLocal = () => {
        try {
          const raw = window.localStorage.getItem(KB_ENVOI_CLE)
          const o = raw === null ? null : JSON.parse(raw)
          return o !== null && typeof o === 'object' ? o : {}
        } catch (e) { return {} }
      }
      const kbRetenirEnvoi = (id, mode) => {
        if (typeof id !== 'string' || id === '') return
        try {
          const m = kbEnvoiLocal()
          if (mode === 'send') m[id] = 'send'
          else delete m[id]
          window.localStorage.setItem(KB_ENVOI_CLE, JSON.stringify(m))
        } catch (e) { /* stockage indisponible : le champ du modele reste la source */ }
      }
      // Le magasin chargé est complété depuis la copie locale — une seule fois,
      // en mémoire. Le fichier n'est jamais touché.
      const kbAppliquerEnvoiLocal = () => {
        const m = kbEnvoiLocal()
        store.entries = store.entries.map((e) => {
          if (e === null || typeof e !== 'object' || e.delivery !== undefined) return e
          const id = idOf(e)
          return (typeof id === 'string' && m[id] === 'send') ? Object.assign({}, e, { delivery: 'send' }) : e
        })
      }
      const kbLoad = async () => {
        if (store.loading === true) return
        store.loading = true
        try {
          const r = await fetch(API, { headers: { accept: 'application/json' } })
          const body = await r.json()
          store.entries = (body !== null && Array.isArray(body.entries) === true) ? body.entries : []
          store.error = (body !== null && body.ok === false) ? String(body.error || 'route indisponible') : null
          // La version vient de la ROUTE : le client ne la redefinit pas, donc
          // elle ne peut pas diverger du modele partage.
          diag.version = (body !== null && body !== undefined && body.version !== undefined) ? body.version : null
          kbAppliquerEnvoiLocal()
        } catch (e) {
          store.error = String(e !== null && e.message ? e.message : e)
        }
        store.loading = false
        store.loaded = true
        diag.entries = store.entries.length
        diag.error = store.error
        notify()
      }

      // Toute écriture passe par la ROUTE : c'est elle qui canonicalise et
      // fusionne par `id`. Le client n'écrit jamais le fichier en direct.
      const kbWrite = async (payload) => {
        try {
          const r = await fetch(API, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await r.json()
          if (body !== null && body.ok === true && Array.isArray(body.entries) === true) {
            store.entries = body.entries
            store.error = null
            notify()
            return { ok: true }
          }
          return { ok: false, error: String((body !== null && body.error) ? body.error : 'écriture refusée') }
        } catch (e) {
          return { ok: false, error: String(e !== null && e.message ? e.message : e) }
        }
      }

      // ── Le composeur : la seule surface d'insertion qui tient compte ──────
      // du curseur. `shell(id)` n'est pas exposé par le type public, mais l'est
      // à l'exécution ; `caretSpan()` et `insertText()` en viennent.
      let ctxRef = null
      const kbShell = (sid) => {
        if (typeof sid !== 'string' || sid === '') return null
        try {
          const conv = ctxRef !== null ? ctxRef.get('conversation') : null
          if (conv !== null && conv !== undefined && conv.input !== null && conv.input !== undefined && typeof conv.input.shell === 'function') { const sh = conv.input.shell(sid); kbNoterCoque(sh); return sh }
        } catch (e) { /* pas de binding */ }
        try {
          const sessions = ctxRef !== null ? ctxRef.get('sessions') : null
          const scope = (sessions !== null && sessions !== undefined && typeof sessions.scope === 'function') ? sessions.scope(sid) : null
          const conv2 = (scope !== null && scope !== undefined && typeof scope.get === 'function') ? scope.get('conversation') : null
          if (conv2 !== null && conv2 !== undefined && conv2.input !== null && conv2.input !== undefined && typeof conv2.input.shell === 'function') { const sh2 = conv2.input.shell(sid); kbNoterCoque(sh2); return sh2 }
        } catch (e) { /* portee indisponible */ }
        return null
      }
      // La coque garde la trace de ce qu'elle expose : `submit` est l'envoi natif
      // (la touche Entree), `insertText` l'insertion au curseur. Diagnostic.
      const kbNoterCoque = (shell) => {
        try { diag.shellApi = { submit: typeof shell.submit, insertText: typeof shell.insertText, setDraft: typeof shell.setDraft } } catch (e) { /* diagnostic seulement */ }
      }
      const kbRev = (shell) => {
        try { return shell.snapshot !== undefined && shell.snapshot !== null ? shell.snapshot.draftRev : undefined } catch (e) { return undefined }
      }
      // Envoi natif : `submit()` sur la coque du composeur — exactement la touche
      // Entrée (adjudication, transaction, sink par défaut). Rien de simulé.
      const kbEnvoyer = (sid) => {
        const shell = kbShell(sid)
        if (shell === null) { diag.envoi = 'composeur introuvable'; return { ok: false, error: 'composeur introuvable' } }
        if (typeof shell.submit !== 'function') { diag.envoi = 'submit absent'; return { ok: false, error: 'envoi indisponible' } }
        try {
          shell.submit('queue')
          diag.envoi = 'envoye'
          return { ok: true }
        } catch (e) {
          diag.envoi = 'erreur: ' + String(e !== null && e.message !== undefined ? e.message : e)
          return { ok: false, error: 'envoi refuse' }
        }
      }
      // Envoi APRÈS insertion : le texte doit d'abord être dans le brouillon —
      // sur le chemin du menu natif, c'est le pipeline de déclencheurs qui
      // l'écrit, de façon asynchrone. On attend donc de le voir, puis on envoie.
      // Passé la limite, on garde le texte au curseur et on le dit : jamais un
      // envoi annoncé qui ne part pas.
      const kbEnvoiApresInsertion = (sid, text, essai) => {
        const n = essai === undefined ? 0 : essai
        const shell = kbShell(sid)
        const brouillon = shell === null ? '' : String((shell.snapshot || {}).draft || '')
        const temoin = text.slice(0, 24)
        const pret = text === '' || temoin === '' || brouillon.indexOf(temoin) >= 0
        if (pret === true || n >= 20) {
          if (pret !== true) {
            diag.envoi = 'texte absent'
            kbFlash('Could not send automatically — the text is in the composer.')
            return
          }
          const out = kbEnvoyer(sid)
          if (out.ok !== true) kbFlash('Could not send automatically — the text is in the composer.')
          return
        }
        setTimeout(() => kbEnvoiApresInsertion(sid, text, n + 1), 100)
      }
      // Insère au point exact demandé : un span collapsé à `at`, avec la
      // révision COURANTE (sinon `insertText` refuse — CAS documenté).
      const kbInsertAt = (sid, text, at) => {
        const shell = kbShell(sid)
        if (shell === null) return { ok: false, error: 'composeur introuvable' }
        let pos = at
        if (typeof pos !== 'number' || pos < 0) {
          try { pos = shell.caretSpan().start } catch (e) { pos = 0 }
        }
        try {
          const done = shell.insertText(text, { start: pos, end: pos, draftRev: kbRev(shell) }, false)
          if (done === true) { try { shell.focus() } catch (e) { /* focus */ } ; return { ok: true } }
        } catch (e) { /* on essaie le repli */ }
        // Repli : réécriture totale du brouillon, calculée sur le texte publié.
        try {
          const draft = String(shell.snapshot.draft || '')
          const next = draft.slice(0, pos) + text + draft.slice(pos)
          shell.setDraft(next)
          return { ok: true }
        } catch (e) { return { ok: false, error: 'insertion impossible' } }
      }
      const kbRemoveSpan = (sid, span) => {
        const shell = kbShell(sid)
        if (shell === null || span === null || span === undefined) return { ok: false, at: 0 }
        try {
          const done = shell.insertText('', { start: span.start, end: span.end, draftRev: kbRev(shell) }, false)
          if (done === true) return { ok: true, at: span.start }
        } catch (e) { /* repli ci-dessous */ }
        try {
          const draft = String(shell.snapshot.draft || '')
          shell.setDraft(draft.slice(0, span.start) + draft.slice(span.end))
          return { ok: true, at: span.start }
        } catch (e) { return { ok: false, at: span.start } }
      }

      // ── Le formulaire en attente, par session ─────────────────────────────
      // `at` est la position laissée libre par le retrait du jeton : c'est là
      // que le texte final doit atterrir, même si le curseur a bougé depuis.
      const pending = new Map()
      const pendingOf = (sid) => (pending.has(sid) ? pending.get(sid) : null)
      const setPending = (sid, value) => { if (value === null) pending.delete(sid); else pending.set(sid, value); notify() }

      // ── « Create with AI » : un chat neuf, le prompt dans le champ ────────
      // La session courante, par ordre de fiabilite : la reference principale de
      // l'espace de travail, puis le snapshot des sessions (dont `current`, qui
      // n'est pas toujours renseigne), puis la plus recente connue.
      const kbCurrentSession = () => {
        try {
          const ui = ctxRef !== null ? ctxRef.get('uiWorkspace') : null
          const main = (ui !== null && ui !== undefined && ui.mainReference !== undefined) ? ui.mainReference : null
          if (main !== null && main !== undefined && main.sessionId !== undefined && main.sessionId !== null) return String(main.sessionId)
        } catch (e) { /* pas de reference principale */ }
        try {
          const sessions = ctxRef !== null ? ctxRef.get('sessions') : null
          const snap = (sessions !== null && sessions !== undefined && sessions.list !== undefined) ? sessions.list.getSnapshot() : null
          if (snap !== null && snap !== undefined) {
            if (snap.current !== undefined && snap.current !== null) return String(snap.current)
            if (Array.isArray(snap.ids) === true && snap.ids.length > 0) return String(snap.ids[snap.ids.length - 1])
          }
        } catch (e) { /* pas de liste */ }
        return ''
      }

      const kbReadComposer = () => {
        const el = document.querySelector('[data-composer-input]')
        return el === null || el === undefined ? '' : String(el.textContent || '')
      }

      const kbStartWithAI = (phrase) => {
        const clean = String(phrase === undefined || phrase === null ? '' : phrase).trim()
        const prompt = AI_REF + (clean === '' ? '' : ' ' + clean)
        const avant = kbCurrentSession()
        diag.ai = { phrase: clean, avant: avant, apres: '', tries: 0, wrote: false, why: '' }
        // Le jeton « /zzz » a fait son travail : on l'efface avant de pre-remplir.
        const depart = kbShell(avant)
        if (depart !== null) { try { depart.setDraft('') } catch (e) { /* brouillon deja vide */ } }
        try {
          const uiWorkspace = ctxRef !== null ? ctxRef.get('uiWorkspace') : null
          if (uiWorkspace !== null && uiWorkspace !== undefined && typeof uiWorkspace.startSession === 'function') uiWorkspace.startSession()
        } catch (e) { /* session indisponible */ }
        const timer = ctxRef !== null ? ctxRef.get('timer') : null
        // On ne s'arrete pas sur « j'ai appele setDraft » mais sur « le champ
        // contient le prompt ». Deux cas a couvrir :
        //   1. l'application ouvre un chat neuf — l'ecriture doit suivre le
        //      changement de session, donc on relit l'identifiant a chaque essai ;
        //   2. l'application juge le chat courant deja neuf et le REUTILISE —
        //      il n'y a alors aucun changement d'identifiant a attendre, et
        //      c'est bien dans ce chat qu'il faut pre-remplir.
        const attempt = (n) => {
          diag.ai.tries = n + 1
          const sid = kbCurrentSession()
          diag.ai.apres = sid
          const shell = sid === '' ? null : kbShell(sid)
          if (shell !== null) {
            try { shell.setDraft(prompt); shell.focus() } catch (e) { diag.ai.why = 'setDraft: ' + String(e !== null && e.message ? e.message : e) }
          } else {
            diag.ai.why = 'shell indisponible'
          }
          // Repli DOM : seulement si le champ ne porte pas deja un brouillon que
          // l'on ecraserait (le notre est le seul attendu).
          if (kbReadComposer() === '' || kbReadComposer() === prompt) {
            const el = document.querySelector('[data-composer-input]')
            if (el !== null && el !== undefined && kbReadComposer() === '') {
              try {
                el.focus()
                if (typeof document.execCommand === 'function') document.execCommand('insertText', false, prompt)
              } catch (e) { /* rien d'autre a tenter */ }
            }
          }
          if (kbReadComposer() === prompt) { diag.ai.wrote = true; return }
          if (n < 24 && timer !== null && timer !== undefined && typeof timer.timeout === 'function') {
            try { timer.timeout(() => attempt(n + 1), 250) } catch (e) { /* minuteur */ }
          }
        }
        attempt(0)
      }

      // ── Le texte d'un message reçu (pour `{message}`) ─────────────────────
      const kbMessageText = async (sid, mid) => {
        if (typeof sid !== 'string' || typeof mid !== 'string') return ''
        try {
          const url = '/kybernos/slash/message?sessionId=' + encodeURIComponent(sid) + '&messageId=' + encodeURIComponent(mid)
          const r = await fetch(url, { headers: { accept: 'application/json' } })
          const body = await r.json()
          return (body !== null && body.ok === true && typeof body.text === 'string') ? body.text : ''
        } catch (e) { return '' }
      }

      // ── Exécution d'une entrée d'action de message ────────────────────────
      const kbRunAction = async (entry, sid, mid) => {
        const message = await kbMessageText(sid, mid)
        if (runOf(entry) === 'form') {
          const shell = kbShell(sid)
          let at = 0
          try { at = shell !== null ? shell.caretSpan().start : 0 } catch (e) { at = 0 }
          setPending(sid, { entryId: idOf(entry), at: at, values: defaultsOf(entry, {}), message: message })
          return { ok: true }
        }
        const text = render(entry.template, {}, { message: message })
        if (text === '') return { ok: false, error: 'gabarit vide' }
        const out = kbInsertAt(sid, text, null)
        // L'étape 4 vaut pour les deux familles : une action marquée « Send it
        // right away » part toute seule, comme une commande. Sans cela elle
        // laissait le texte au curseur en annonçant l'inverse.
        if (out.ok === true && entry.delivery === 'send') kbEnvoiApresInsertion(sid, text)
        return out
      }

      // ══════════════════════════════════════════════════════════════════════
      // 1. LA PALETTE « / » — une source du pipeline de déclencheurs DSH
      // ══════════════════════════════════════════════════════════════════════
      const kbSource = {
        trigger: '/',
        // « command » est déjà pris par les commandes natives : un doublon
        // (trigger, name) lève. Le nôtre se fond dans le même menu, sans titre
        // de groupe, juste après les commandes du harnais.
        name: 'kybernos',
        order: 1,
        showGroupTitle: false,
        warm() { if (store.loaded === false) kbLoad() },
        lexicon() { return listOf('slash').filter((e) => e.active !== false).map((e) => nameOf(e)) },
        subscribeLexicon(session, listener) { return onStore(listener) },
        // ATTENTION : le pipeline ecrit `source.candidates(...).then(...)` sans
        // attendre la valeur. Une methode SYNCHRONE rend un tableau, `.then` est
        // alors `undefined`, le TypeError interrompt la boucle du roster — et
        // TOUS les groupes du menu restent en « pending » (squelette infini),
        // celui des skills natifs compris. Cette methode doit rester `async`.
        async candidates(session, req) {
          const q = String((req !== null && req.query !== undefined) ? req.query : '').toLowerCase()
          const rows = listOf('slash').filter((e) => e.active !== false && nameOf(e).toLowerCase().indexOf(q) === 0)
          const out = rows.map((e) => ({
            name: '/' + nameOf(e),
            description: L(e.description),
            value: idOf(e),
            hint: runOf(e) === 'form' ? 'form' : 'text',
          }))
          // La ligne de création n'apparaît QUE si le texte tapé ne désigne
          // aucune commande existante (règle de la maquette) : sinon elle
          // volerait la place d'un vrai résultat.
          if (q.length > 0 && out.length === 0) {
            out.push({
              name: 'Create "/' + q + '" with AI',
              description: 'a dedicated skill asks before writing',
              value: AI_VALUE,
              hint: 'new chat',
            })
          }
          diag.queries += 1
          diag.lastQuery = q
          diag.lastOut = out.length
          return out
        },
        onPick(pick) {
          diag.picks += 1
          const cand = (pick !== null && pick.candidate !== undefined) ? pick.candidate : {}
          const value = String(cand.value === undefined ? '' : cand.value)
          diag.lastOutcome = 'value=' + value
          if (value === AI_VALUE) {
            const q = String(cand.name || '').replace(/^Create "\//, '').replace(/" with AI$/, '')
            kbStartWithAI(q)
            return 'handled'
          }
          const entry = entryOf(value)
          if (entry === undefined || entry === null) return 'handled'
          const sid = (pick !== null && pick.session !== undefined && pick.session !== null) ? pick.session.sessionId : undefined
          if (runOf(entry) !== 'form') {
            const text = render(entry.template, {}, {})
            if (text === '') return 'handled'
            // Le pipeline remplace le jeton `/xxx` par ce texte, au curseur,
            // et laisse le reste du message intact (règle 7).
            if (entry.delivery === 'send') kbEnvoiApresInsertion(sid, text)
            return { text: text }
          }
          // Entrée à formulaire : on retire le jeton et on laisse le curseur
          // exactement là où il était, puis le formulaire prend la main.
          const removed = kbRemoveSpan(sid, pick !== null ? pick.span : null)
          setPending(sid, { entryId: idOf(entry), at: removed.at, values: defaultsOf(entry, {}), message: '' })
          return 'handled'
        },
      }

      // ══════════════════════════════════════════════════════════════════════
      // 2. LE FORMULAIRE INLINE
      // ══════════════════════════════════════════════════════════════════════
      const kbSubmitForm = (sid, pend, entry, values) => {
        const verdict = validate(entry, values)
        if (verdict.ok !== true) return verdict
        const text = render(entry.template, effectiveValues(entry, values), { message: pend.message || '' })
        const out = kbInsertAt(sid, text, pend.at)
        if (out.ok !== true) return out
        // Étape 4 « Send it right away » : le texte part tout seul, par l'envoi
        // natif du composeur. S'il n'est pas disponible, on garde le texte au
        // curseur et on le dit — jamais un envoi annoncé qui ne part pas.
        if (entry.delivery === 'send') {
          setPending(sid, null)
          kbEnvoiApresInsertion(sid, text)
          return out
        }
        setPending(sid, null)
        return out
      }
      // ── Jeu d'icônes (sous-ensemble Lucide, sous-chemins séparés) ─────────────
      // Chaque icône est une LISTE de sous-chemins : un seul <path> par élément.
      // Indispensable : un « m » relatif en tête de sous-chemin vaut un point
      // absolu. Concaténer les sous-chemins dans un seul « d » decalait la
      // moitie des icônes Lucide (constaté a l ecran sur x, terminal, code).
      const KB_ICONS = {"slash":["M22 2 2 22"],"terminal":["M12 19h8","m4 17 6-6-6-6"],"sparkles":["M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z","M20 2v4","M22 4h-4","M2 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"wand-sparkles":["m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72","m14 7 3 3","M5 6v4","M19 14v4","M10 2v2","M7 8H3","M21 16h-4","M11 3H9"],"bot":["M12 8V4H8","M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z","M2 14h2","M20 14h2","M15 13v2","M9 13v2"],"brain":["M12 18V5","M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4","M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5","M17.997 5.125a4 4 0 0 1 2.526 5.77","M18 18a4 4 0 0 0 2-7.464","M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517","M6 18a4 4 0 0 1-2-7.464","M6.003 5.125a4 4 0 0 0-2.526 5.77"],"lightbulb":["M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5","M9 18h6","M10 22h4"],"languages":["m5 8 6 6","m4 14 6-6 2-3","M2 5h12","M7 2h1","m22 22-5-10-5 10","M14 18h6"],"list-checks":["M13 5h8","M13 12h8","M13 19h8","m3 17 2 2 4-4","m3 7 2 2 4-4"],"file-text":["M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z","M14 2v5a1 1 0 0 0 1 1h5","M10 9H8","M16 13H8","M16 17H8"],"pencil-line":["M13 21h8","m15 5 4 4","M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"],"code":["m16 18 6-6-6-6","m8 6-6 6 6 6"],"shield-check":["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z","m9 12 2 2 4-4"],"search":["m21 21-4.34-4.34","M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0"],"message-square":["M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"],"mail":["m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7","M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z"],"bug":["M12 20v-9","M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z","M14.12 3.88 16 2","M21 21a4 4 0 0 0-3.81-4","M21 5a4 4 0 0 1-3.55 3.97","M22 13h-4","M3 21a4 4 0 0 1 3.81-4","M3 5a4 4 0 0 0 3.55 3.97","M6 13H2","m8 2 1.88 1.88","M9 7.13V6a3 3 0 1 1 6 0v1.13"],"rocket":["M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5","M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09","M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z","M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"],"zap":["M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"],"book-open":["M12 5v16","M20.001 19A2 2 0 0022 17V5a2 2 0 00-1.999-2L16 3.002A5 5 0 0012 5a5 5 0 00-4-2H4a2 2 0 00-2 2v12a2 2 0 001.999 2H8a5 5 0 014 2 5 5 0 014-2z"],"globe":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20","M2 12h20"],"scissors":["M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M8.12 8.12 12 12","M20 4 8.12 15.88","M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M14.8 14.8 20 20"],"wrench":["M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"],"table":["M12 3v18","M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M3 9h18","M3 15h18"],"image":["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M7 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"],"mic":["M12 19v3","M19 10v2a7 7 0 0 1-14 0v-2","M12 2h0a3 3 0 0 1 3 3v7a3 3 0 0 1 -3 3h0a3 3 0 0 1 -3 -3v-7a3 3 0 0 1 3 -3z"],"bookmark":["M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"],"star":["M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"],"heart":["M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"],"flag":["M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"],"clock":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M12 6v6l4 2"],"calendar":["M8 2v3","M16 2v3","M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M3 9h18"],"chart-bar":["M3 3v16a2 2 0 0 0 2 2h16","M7 16h8","M7 11h12","M7 6h3"],"database":["M3 5a9 3 0 1 0 18 0a9 3 0 1 0 -18 0","M3 5V19A9 3 0 0 0 21 19V5","M3 12A9 3 0 0 0 21 12"],"git-branch":["M15 6a9 9 0 0 0-9 9V3","M15 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],"lock":["M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-7a2 2 0 0 1 2 -2z","M7 11V7a5 5 0 0 1 10 0v4"],"users":["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M16 3.128a4 4 0 0 1 0 7.744","M22 21v-2a4 4 0 0 0-3-3.87","M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"],"quote":["M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z","M5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z"],"hash":["M4 9L20 9","M4 15L20 15","M10 3L8 21","M16 3L14 21"],"text-quote":["M17 5H3","M21 12H8","M21 19H8","M3 12v7"],"send":["M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z","m21.854 2.147-10.94 10.939"],"settings-2":["M14 17H5","M19 7h-9","M14 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M4 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],"check":["M20 6 9 17l-5-5"],"message-circle":["M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"],"file-code":["M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z","M14 2v5a1 1 0 0 0 1 1h5","M10 12.5 8 15l2 2.5","m14 12.5 2 2.5-2 2.5"],"wand":["M15 4V2","M15 16v-2","M8 9h2","M20 9h2","M17.8 11.8 19 13","M15 9h.01","M17.8 6.2 19 5","m3 21 9-9","M12.2 6.2 11 5"],"play":["M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"],"square-pen":["M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7","M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"],"pencil":["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z","m15 5 4 4"],"copy":["M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z","M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"],"plus":["M5 12h14","M12 5v14"],"x":["M18 6 6 18","m6 6 12 12"],"arrow-right":["M5 12h14","m12 5 7 7-7 7"],"arrow-up-right":["M7 7h10v10","M7 17 17 7"],"download":["M12 15V3","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","m7 10 5 5 5-5"],"upload":["M12 3v12","m17 8-5-5-5 5","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"],"link":["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71","M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],"briefcase":["M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16","M4 6h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z"],"folder":["M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"],"gift":["M12 7v14","M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8","M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5","M4 7h16a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z"],"info":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M12 16v-4","M12 8h.01"],"key":["m2 21 9.6-9.6","m7.5 15.5 2.3 2.3a1 1 0 0 1 0 1.4l-2.1 2.1a1 1 0 0 1-1.4 0L4 19","M10 7.5a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0"],"map-pin":["M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0","M9 10a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],"moon":["M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"],"package":["M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z","M12 22V12","M3.29 7L12 12L20.71 7","m7.5 4.27 9 5.15"],"phone":["M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"],"printer":["M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2","M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6","M7 14h10a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1z"],"refresh-cw":["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","M21 3v5h-5","M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","M8 16H3v5"],"save":["M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z","M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7","M7 3v4a1 1 0 0 0 1 1h7"],"settings":["M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915","M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],"shield":["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"],"share-2":["M15 5a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M3 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M15 19a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M8.59 13.51L15.42 17.49","M15.41 6.51L8.59 10.49"],"sun":["M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M12 2v2","M12 20v2","m4.93 4.93 1.41 1.41","m17.66 17.66 1.41 1.41","M2 12h2","M20 12h2","m6.34 17.66-1.41 1.41","m19.07 4.93-1.41 1.41"],"timer":["M10 2L14 2","M12 14L15 11","M4 14a8 8 0 1 0 16 0a8 8 0 1 0 -16 0"],"thumbs-up":["M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z","M7 10v12"],"video":["m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5","M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z"],"wallet":["M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1","M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"],"bell":["M10.268 21a2 2 0 0 0 3.464 0","M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"],"user":["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2","M8 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"],"tag":["M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z","M7 7.5a0.5 0.5 0 1 0 1 0a0.5 0.5 0 1 0 -1 0"],"git-merge":["M15 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M3 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M6 21V9a9 9 0 0 0 9 9"],"clipboard":["M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z","M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"],"clipboard-list":["M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z","M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2","M12 11h4","M12 16h4","M8 11h.01","M8 16h.01"],"heading-1":["M4 12h8","M4 18V6","M12 18V6","m17 12 3-2v8"],"heading-2":["M4 12h8","M4 18V6","M12 18V6","M21 18h-4c0-4 4-3 4-6 0-1.5-2-2.5-4-1"],"heading-3":["M4 12h8","M4 18V6","M12 18V6","M17.5 10.5c1.7-1 3.5 0 3.5 1.5a2 2 0 0 1-2 2","M17 17.5c2 1.5 4 .3 4-1.5a2 2 0 0 0-2-2"],"bold":["M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"],"italic":["M19 4L10 4","M14 20L5 20","M15 4L9 20"],"underline":["M6 4v6a6 6 0 0 0 12 0V4","M4 20L20 20"],"list":["M3 5h.01","M3 12h.01","M3 19h.01","M8 5h13","M8 12h13","M8 19h13"],"list-ordered":["M11 5h10","M11 12h10","M11 19h10","M4 4h1v5","M4 9h2","M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"],"percent":["M19 5L5 19","M4 6.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0","M15 17.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0"],"dollar-sign":["M12 2L12 22","M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],"euro":["M4 10h12","M4 14h9","M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2"],"at-sign":["M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"],"circle-check":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","m16 9-5.5 5.5L8 12"],"circle-x":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","m15 9-6 6","m9 9 6 6"],"loader":["M12 2v4","m16.2 7.8 2.9-2.9","M18 12h4","m16.2 16.2 2.9 2.9","M12 18v4","m4.9 19.1 2.9-2.9","M2 12h4","m4.9 4.9 2.9 2.9"],"circle-play":["M9 9.003a1 1 0 0 1 1.517-.859l4.997 2.997a1 1 0 0 1 0 1.718l-4.997 2.997A1 1 0 0 1 9 14.996z","M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0"],"circle-pause":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M10 15L10 9","M14 15L14 9"],"repeat":["m17 2 4 4-4 4","M3 11v-1a4 4 0 0 1 4-4h14","m7 22-4-4 4-4","M21 13v1a4 4 0 0 1-4 4H3"],"shuffle":["m18 14 4 4-4 4","m18 2 4 4-4 4","M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22","M2 6h1.972a4 4 0 0 1 3.6 2.2","M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"],"eye":["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0","M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],"eye-off":["M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49","M14.084 14.158a3 3 0 0 1-4.242-4.242","M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143","m2 2 20 20"],"pen-tool":["M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z","m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18","m2.3 2.3 7.286 7.286","M9 11a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"type":["M12 4v16","M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2","M9 20h6"],"text-cursor":["M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1","M7 22h1a4 4 0 0 0 4-4","M7 2h1a4 4 0 0 1 4 4"],"mouse-pointer":["M12.586 12.586 19 19","M3.688 3.037a.497.497 0 0 0-.651.651l6.5 15.999a.501.501 0 0 0 .947-.062l1.569-6.083a2 2 0 0 1 1.448-1.479l6.124-1.579a.5.5 0 0 0 .063-.947z"],"layers":["M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z","M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12","M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"],"layout-grid":["M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z","M15 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z","M15 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z","M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z"],"layout-list":["M4 3h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z","M4 14h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1v-5a1 1 0 0 1 1 -1z","M14 4h7","M14 9h7","M14 15h7","M14 20h7"],"grid-2x2":["M12 3v18","M3 12h18","M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z"],"columns-2":["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M12 3v18"],"rows-2":["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M3 12h18"],"panel-left":["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M9 3v18"],"panel-right":["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M15 3v18"],"maximize":["M8 3H5a2 2 0 0 0-2 2v3","M21 8V5a2 2 0 0 0-2-2h-3","M3 16v3a2 2 0 0 0 2 2h3","M16 21h3a2 2 0 0 0 2-2v-3"],"minimize":["M8 3v3a2 2 0 0 1-2 2H3","M21 8h-3a2 2 0 0 1-2-2V3","M3 16h3a2 2 0 0 1 2 2v3","M16 21v-3a2 2 0 0 1 2-2h3"],"zoom-in":["M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0","M21 21L16.65 16.65","M11 8L11 14","M8 11L14 11"],"zoom-out":["M3 11a8 8 0 1 0 16 0a8 8 0 1 0 -16 0","M21 21L16.65 16.65","M8 11L14 11"],"rotate-cw":["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8","M21 3v5h-5"],"cpu":["M12 20v2","M12 2v2","M17 20v2","M17 2v2","M2 12h2","M2 17h2","M2 7h2","M20 12h2","M20 17h2","M20 7h2","M7 20v2","M7 2v2","M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z","M9 8h6a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1z"],"server":["M4 2h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z","M4 14h16a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-4a2 2 0 0 1 2 -2z","M6 6L6.01 6","M6 18L6.01 18"],"hard-drive":["M10 16h.01","M2.212 11.577a2 2 0 0 0-.212.896V18a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5.527a2 2 0 0 0-.212-.896L18.55 5.11A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z","M21.946 12.013H2.054","M6 16h.01"],"network":["M17 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1z","M3 16h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1z","M10 2h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1z","M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3","M12 12V8"],"wifi":["M12 20h.01","M2 8.82a15 15 0 0 1 20 0","M5 12.859a10 10 0 0 1 14 0","M8.5 16.429a5 5 0 0 1 7 0"],"bluetooth":["m7 7 10 10-5 5V2l5 5L7 17"],"battery":["M 22 14 L 22 10","M4 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-8a2 2 0 0 1 2 -2z"],"power":["M12 2v10","M18.4 6.6a9 9 0 1 1-12.77.04"],"plug":["M12 22v-5","M15 8V2","M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z","M9 8V2"],"usb":["M9 7a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M3 20a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M4.7 19.3 19 5","m21 3-3 1 2 2Z","M9.26 7.68 5 12l2 5","m10 14 5 2 3.5-3.5","m18 12 1-1 1 1-1 1Z"],"camera":["M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z","M9 13a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],"video-off":["M10.66 6H14a2 2 0 0 1 2 2v2.5l5.248-3.062A.5.5 0 0 1 22 7.87v8.196","M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2","m2 2 20 20"],"headphones":["M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"],"volume-2":["M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z","M16 9a5 5 0 0 1 0 6","M19.364 18.364a9 9 0 0 0 0-12.728"],"music":["M9 18V5l12-2v13","M3 18a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M15 16a3 3 0 1 0 6 0a3 3 0 1 0 -6 0"],"film":["M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2z","M7 3v18","M3 7.5h4","M3 12h18","M3 16.5h4","M17 3v18","M17 7.5h4","M17 16.5h4"],"tv":["m17 2-5 5-5-5","M4 7h16a2 2 0 0 1 2 2v11a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2z"],"monitor":["M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z","M8 21L16 21","M12 17L12 21"],"smartphone":["M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2z","M12 18h.01"],"tablet":["M6 2h12a2 2 0 0 1 2 2v16a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2v-16a2 2 0 0 1 2 -2z","M12 18L12.01 18"],"laptop":["M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z","M20.054 15.987H3.946"],"shopping-cart":["m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18","M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25","M16 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","M6 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"shopping-bag":["M16 10a4 4 0 0 1-8 0","M3.103 6.034h17.794","M3.4 5.467a2 2 0 0 0-.4 1.2V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.667a2 2 0 0 0-.4-1.2l-2-2.667A2 2 0 0 0 17 2H7a2 2 0 0 0-1.6.8z"],"credit-card":["M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-16a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2z","M2 10L22 10","M6 14h2"],"receipt":["M12 17V7","M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8","M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"],"truck":["M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2","M15 18H9","M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14","M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"map":["M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z","M15 5.764v15","M9 3.236v15"],"compass":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"],"navigation":["M3 11L22 2L13 21L11 13L3 11Z"],"anchor":["M12 6v16","m19 13 2-1a9 9 0 0 1-18 0l2 1","M9 11h6","M10 4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"plane":["M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"],"car":["M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2","M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0","M9 17h6","M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"bike":["M15 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0","M2 17.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0","M14 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M12 17.5V14l-3-3 4-3 2 3h2"],"utensils":["M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2","M7 2v20","M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Z","m0 0v7"],"coffee":["M10 2v2","M14 2v2","M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1","M6 2v2"],"pizza":["m12 14-1 1","m13.75 18.25-1.25 1.42","M17.775 5.654a15.68 15.68 0 0 0-12.121 12.12","M18.8 9.3a1 1 0 0 0 2.1 7.7","M21.964 20.732a1 1 0 0 1-1.232 1.232l-18-5a1 1 0 0 1-.695-1.232A19.68 19.68 0 0 1 15.732 2.037a1 1 0 0 1 1.232.695z"],"cake":["M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8","M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1","M2 21h20","M7 8v3","M12 8v3","M17 8v3","M7 4h.01","M12 4h.01","M17 4h.01"],"apple":["M12 6.528V3a1 1 0 0 1 1-1h0","M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21"],"egg":["M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"],"leaf":["M11 20a10 10 0 0010-10 25.9 25.9 0 00-1.04-7.281 1 1 0 00-1.755-.325C15.833 5.5 13 5.5 9.8 6.1A7 7 0 0011 20","M2 21a5 5 0 012.911-4.544C7.613 15.212 8.351 15.24 11 13"],"flower":["M9 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0","M12 16.5A4.5 4.5 0 1 1 7.5 12 4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 1 1 4.5 4.5 4.5 4.5 0 1 1-4.5 4.5","M12 7.5V9","M7.5 12H9","M16.5 12H15","M12 16.5V15","m8 8 1.88 1.88","M14.12 9.88 16 8","m8 16 1.88-1.88","M14.12 14.12 16 16"],"sun-moon":["M12 2v2","M14.837 16.385a6 6 0 1 1-7.223-7.222c.624-.147.97.66.715 1.248a4 4 0 0 0 5.26 5.259c.589-.255 1.396.09 1.248.715","M16 12a4 4 0 0 0-4-4","m19 5-1.256 1.256","M20 12h2"],"cloud":["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"],"wind":["M12.8 19.6A2 2 0 1 0 14 16H2","M17.5 8a2.5 2.5 0 1 1 2 4H2","M9.8 4.4A2 2 0 1 1 11 8H2"],"thermometer":["M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"],"droplet":["M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"],"flame":["M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"],"graduation-cap":["M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z","M22 10v6","M6 12.5V16a6 3 0 0 0 12 0v-3.5"],"school":["M14 21v-3a2 2 0 0 0-4 0v3","M18 4.933V21","m4 6 7.106-3.79a2 2 0 0 1 1.788 0L20 6","m6 11-3.52 2.147a1 1 0 0 0-.48.854V19a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a1 1 0 0 0-.48-.853L18 11","M6 4.933V21","M10 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"award":["m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526","M6 8a6 6 0 1 0 12 0a6 6 0 1 0 -12 0"],"trophy":["M10 14.66V17a1 1 0 0 1-1 1 2 2 0 0 0-2 2v2","M14 14.66V17a1 1 0 0 0 1 1 2 2 0 0 1 2 2v2","M17.916 10H19.5A2.5 2.5 0 0 0 22 7.5V5a1 1 0 0 0-1-1h-3","M4 22h16","M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z","M6.084 10H4.5A2.5 2.5 0 0 1 2 7.5V5a1 1 0 0 1 1-1h3"],"medal":["M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15","M11 12 5.12 2.2","m13 12 5.88-9.8","M8 7h8","M7 17a5 5 0 1 0 10 0a5 5 0 1 0 -10 0","M12 18v-2h-.5"],"target":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M6 12a6 6 0 1 0 12 0a6 6 0 1 0 -12 0","M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"crosshair":["M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0","M22 12L18 12","M6 12L2 12","M12 6L12 2","M12 22L12 18"],"ruler":["M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.41 2.41 0 0 1 0-3.4l2.6-2.6a2.41 2.41 0 0 1 3.4 0Z","m14.5 12.5 2-2","m11.5 9.5 2-2","m8.5 6.5 2-2","m17.5 15.5 2-2"],"scale":["M12 3v18","m19 8 3 8a5 5 0 0 1-6 0zV7","M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1","m5 8 3 8a5 5 0 0 1-6 0zV7","M7 21h10"],"dumbbell":["M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z","m2.5 21.5 1.4-1.4","m20.1 3.9 1.4-1.4","M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z","m9.6 14.4 4.8-4.8"],"hand":["M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2","M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2","M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8","M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"],"heart-handshake":["M19.414 14.414C21 12.828 22 11.5 22 9.5a5.5 5.5 0 0 0-9.591-3.676.6.6 0 0 1-.818.001A5.5 5.5 0 0 0 2 9.5c0 2.3 1.5 4 3 5.5l5.535 5.362a2 2 0 0 0 2.879.052 2.12 2.12 0 0 0-.004-3 2.124 2.124 0 1 0 3-3 2.124 2.124 0 0 0 3.004 0 2 2 0 0 0 0-2.828l-1.881-1.882a2.41 2.41 0 0 0-3.409 0l-1.71 1.71a2 2 0 0 1-2.828 0 2 2 0 0 1 0-2.828l2.823-2.762"],"user-plus":["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M19 8L19 14","M22 11L16 11"],"user-minus":["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M22 11L16 11"],"user-check":["m16 11 2 2 4-4","M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"],"user-x":["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M17 8L22 13","M22 8L17 13"],"phone-call":["M13 2a9 9 0 0 1 9 9","M13 6a5 5 0 0 1 5 5","M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"],"phone-incoming":["M16 2v6h6","m22 2-6 6","M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"],"phone-outgoing":["m16 8 6-6","M22 8V2h-6","M13.832 16.568a1 1 0 0 0 1.213-.303l.355-.465A2 2 0 0 1 17 15h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-.8 1.6l-.468.351a1 1 0 0 0-.292 1.233 14 14 0 0 0 6.392 6.384"],"voicemail":["M2 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M14 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0","M6 16L18 16"],"inbox":["M22 12L16 12L14 15L10 15L8 12L2 12","M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"],"archive":["M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1 -1 1h-18a1 1 0 0 1 -1 -1v-3a1 1 0 0 1 1 -1z","M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8","M10 12h4"],"folder-open":["m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"],"folder-plus":["M12 10v6","M9 13h6","M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"],"file-plus":["M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z","M14 2v5a1 1 0 0 0 1 1h5","M9 15h6","M12 18v-6"],"file-minus":["M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z","M14 2v5a1 1 0 0 0 1 1h5","M9 15h6"],"files":["M15 2h-4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8","M16.706 2.706A2.4 2.4 0 0 0 15 2v5a1 1 0 0 0 1 1h5a2.4 2.4 0 0 0-.706-1.706z","M5 7a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h8a2 2 0 0 0 1.732-1"],"trending-up":["M16 7h6v6","m22 7-8.5 8.5-5-5L2 17"],"trending-down":["M16 17h6v-6","m22 17-8.5-8.5-5 5L2 7"],"activity":["M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"],"gauge":["m12 14 4-4","M3.34 19a10 10 0 1 1 17.32 0"],"signal":["M2 20h.01","M7 20v-4","M12 20v-8","M17 20V8","M22 4v16"],"radio":["M16.247 7.761a6 6 0 0 1 0 8.478","M19.075 4.933a10 10 0 0 1 0 14.134","M4.925 19.067a10 10 0 0 1 0-14.134","M7.753 16.239a6 6 0 0 1 0-8.478","M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0"],"rss":["M4 11a9 9 0 0 1 9 9","M4 4a16 16 0 0 1 16 16","M4 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"],"megaphone":["M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z","M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14","M8 6v8"],"newspaper":["M15 18h-5","M18 14h-8","M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2","M11 6h6a1 1 0 0 1 1 1v2a1 1 0 0 1 -1 1h-6a1 1 0 0 1 -1 -1v-2a1 1 0 0 1 1 -1z"],"trash":["M10 11v6","M14 11v6","M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6","M3 6h18","M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],"chevron-down":["m6 9 6 6 6-6"],"grip-vertical":["M8 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M8 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M8 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M14 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M14 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M14 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"],"ellipsis":["M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0","M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"],"arrow-up":["m5 12 7-7 7 7","M12 19V5"],"arrow-down":["M12 5v14","m19 12-7 7-7-7"]}
      const KB_ICON_TAGS = {"slash":"divide division fraction bar","terminal":"code command line prompt shell","sparkles":"stars effect filter night magic","wand-sparkles":"magic wizard magician","bot":"robot ai chat assistant","brain":"medical mind mental intellect cerebral consciousness genius artificial intelligence ai think thought insight intelligent smart","lightbulb":"idea bright lights","languages":"translate","list-checks":"todo done check tick complete tasks items pending","file-text":"data txt pdf document","pencil-line":"pencil change create draw sketch draft writer writing biro ink marker felt tip stationery artist","code":"source programming html xml","shield-check":"cybersecurity secured safety protection protected guardian guarded armored armoured defense defence defended blocked threat prevention prevented antivirus vigilance vigilant active activated enabled detection scanned found strength strong tough invincible invincibility invulnerable undamaged audited admin verification verified certification certified tested passed qualified cleared cleaned disinfected uninfected task completed todo done ticked checked crest bravery","search":"find scan magnifier magnifying glass lens locate explore discover enlarge zoom","message-square":"comment chat conversation dialog feedback speech bubble","mail":"email message letter unread","bug":"issue error defect testing troubleshoot problem report debug code insect beetle","rocket":"release boost launch space version","zap":"flash camera lightning electricity energy power quick","book-open":"reading pages booklet magazine leaflet pamphlet library writing written writer author story script screenplay fiction novel information knowledge education high school university college academy student study learning homework research documentation revealed blank plain","globe":"world browser language translate","scissors":"cut snip chop stationery crafts","wrench":"account settings spanner diy toolbox build construction","table":"spreadsheet grid","image":"picture photo","mic":"record sound listen radio podcast microphone","bookmark":"save favorite mark label attachment file stick pin read clip marker tag","star":"bookmark favorite like review rating","heart":"like love emotion suit playing cards","flag":"report marker notification warning milestone goal notice signal attention banner","clock":"time watch alarm","calendar":"date month year event birthday birthdate","chart-bar":"statistics analytics diagram graph","database":"storage memory container tin pot bytes servers","git-branch":"code version control vcs repository","lock":"security password secure admin","users":"group people","quote":"quotation","hash":"hashtag number pound","text-quote":"blockquote quotation indent reply response","send":"email message mail paper airplane aeroplane submit","settings-2":"cog edit gear preferences slider","check":"done todo tick complete task","message-circle":"comment chat conversation dialog feedback speech bubble","file-code":"script document gist html xml property list plist","wand":"magic selection","play":"music audio video start run","square-pen":"pencil edit change create draw sketch draft writer writing biro ink marker felt tip stationery artist","pencil":"rubber edit create draw sketch draft writer writing stationery artist","copy":"clone duplicate multiple","plus":"add new increase increment positive calculate toolbar crosshair aim target scope sight reticule maximum upgrade extra","x":"cancel close cross delete ex remove times clear math multiply multiplication","arrow-right":"forward next direction east","arrow-up-right":"direction north east diagonal","download":"import export save","upload":"file","link":"chain url","briefcase":"work bag baggage folder","folder":"directory","gift":"present box birthday party","info":"about advice clue details help hint indicator information knowledge notice status support tooltip","key":"password login authentication secure unlock keychain key ring fob","map-pin":"location waypoint marker drop","moon":"dark night","package":"box container storage sealed delivery undelivered unopened packed archive zip module","phone":"call","printer":"fax office device","refresh-cw":"rotate reload rerun synchronise synchronize arrows circular cycle","save":"floppy disk","settings":"cog edit gear preferences","shield":"cybersecurity secure safety protection guardian armored armoured defense defence defender block threat prevention antivirus vigilance vigilant detection scan find strength strong tough invincible invincibility invulnerable undamaged audit admin verification crest bravery knight foot soldier infantry trooper pawn battle war military army cadet scout","share-2":"network connections","sun":"brightness weather light summer","timer":"time timer stopwatch","thumbs-up":"like good emotion","video":"camera movie film recording motion picture camcorder reel","wallet":"money finance pocket","bell":"alarm notification sound reminder","user":"person account contact","tag":"label badge ticket mark","git-merge":"code version control","clipboard":"copy paste","clipboard-list":"copy paste tasks","heading-1":"h1 html markup markdown","heading-2":"h2 html markup markdown","heading-3":"h3 html markup markdown","bold":"text strong format","italic":"oblique text format","underline":"text format","list":"options","list-ordered":"number order queue","percent":"percentage modulo modulus remainder sale discount offer marketing","dollar-sign":"currency money payment","euro":"currency money payment","at-sign":"mention at email message","circle-check":"done todo tick complete task","circle-x":"cancel close delete remove times clear error incorrect wrong mistake failure linter multiply multiplication","loader":"loading wait busy progress spinner spinning throbber","circle-play":"music start run","circle-pause":"music audio stop","repeat":"loop arrows","shuffle":"music random reorder","eye":"view watch see show expose reveal display visible visibility vision preview read","eye-off":"view watch see hide conceal mask hidden visibility vision","pen-tool":"vector drawing path","type":"text font typography","text-cursor":"select caret type typing write writing edit insert input textarea","mouse-pointer":"click select","layers":"stack pile pages sheets paperwork copies copy","layout-grid":"app home start","layout-list":"todo tasks items pending image photo","grid-2x2":"table rows columns blocks plot land geometry measure size width height distance surface area square meter acre window skylight","columns-2":"lines list queue preview panel parallel series split vertical horizontal half center middle even sidebar drawer gutter fold reflow typography pagination pages","rows-2":"lines list queue preview panel paragraphs parallel series split vertical horizontal half center middle even drawer","panel-left":"primary drawer","panel-right":"sidebar secondary drawer","maximize":"fullscreen expand dashed","minimize":"exit fullscreen close shrink","zoom-in":"magnifying glass plus","zoom-out":"magnifying glass plus","rotate-cw":"arrow right clockwise refresh reload rerun redo","cpu":"processor cores technology computer chip circuit memory ram specs gigahertz ghz","server":"cloud storage","hard-drive":"computer server memory data ssd disk hard storage hardware backup media","network":"tree","wifi":"connection signal wireless","bluetooth":"wireless","battery":"power electricity energy accumulator charge","power":"on off device switch toggle binary boolean reboot restart button keyboard troubleshoot","plug":"electricity energy electronics socket outlet power voltage current charger","usb":"universal serial bus controller connector interface","camera":"photography lens focus capture shot visual image device equipment photo webcam video","video-off":"camera movie film","headphones":"music audio sound","volume-2":"music sound speaker","music":"note quaver eighth","film":"movie video reel camera cinema entertainment","tv":"television stream display widescreen high definition hd 1080p 4k 8k smart digital video entertainment showtime channels terrestrial satellite cable broadcast live frequency tune scan aerial receiver transmission signal connection connectivity","monitor":"tv computer desktop screen display external sharing virtual machine vm","smartphone":"phone cellphone device mobile screen display touchscreen portable responsive","tablet":"device mobile screen display touchscreen portable responsive","laptop":"computer screen remote","shopping-cart":"trolley cart basket e commerce store purchase products items ingredients","shopping-bag":"ecommerce cart purchase store","credit-card":"bank purchase payment cc","receipt":"bill voucher slip check counterfoil currency dollar usd","truck":"delivery van shipping haulage lorry","map":"location navigation travel","compass":"direction north east south west browser","navigation":"location travel","anchor":"ship","plane":"plane trip airplane","car":"vehicle drive trip journey","bike":"bicycle transport trip","utensils":"fork knife cutlery flatware tableware silverware food restaurant meal breakfast dinner supper","coffee":"drink cup mug tea cafe hot beverage","pizza":"pie quiche food","cake":"birthday birthdate celebration party surprise gateaux dessert fondant icing sugar sweet baking","apple":"fruit food healthy snack nutrition fresh produce grocery organic harvest vitamin red green juicy sweet tart bite orchard plant core raw diet","egg":"bird chicken nest hatch shell incubate soft boiled hard breakfast brunch morning easter","leaf":"sustainability nature energy plant autumn","flower":"sustainability nature plant spring","sun-moon":"dark light moon sun brightness theme auto system appearance","cloud":"weather","wind":"weather air blow","thermometer":"temperature celsius fahrenheit weather","droplet":"water weather liquid fluid wet moisture damp bead globule","flame":"heat burn light glow ignite passion ember fire lit burning spark embers smoke firefighter fireman department brigade station emergency","graduation-cap":"school university learn study mortarboard education ceremony academic hat diploma bachelor s master doctorate","school":"building education childhood university learning campus scholar student lecture degree course academia study knowledge classroom research diploma graduation professor tutorial homework assignment exam","award":"achievement badge rosette prize winner","trophy":"prize sports winner achievement award champion celebration victory competition tournament leaderboard ranking success reward cup first gold","medal":"prize sports winner trophy award achievement","target":"logo bullseye deadline projects overview work productivity","crosshair":"aim target","ruler":"measurements centimeters cm millimeters mm metre foot feet inches units size length width height dimensions depth breadth extent stationery","scale":"balance legal license right rule law justice weight measure compare judge fair ethics decision","dumbbell":"barbell weight workout gym","hand":"wave move mouse grab","heart-handshake":"agreement charity help deal terms emotion together handshake","user-plus":"new add create follow subscribe","user-minus":"delete remove unfollow unsubscribe","user-check":"followed subscribed done todo tick complete task","user-x":"delete remove unfollow unsubscribe unavailable","phone-call":"ring","phone-incoming":"call","phone-outgoing":"call","voicemail":"phone cassette tape reel recording audio","inbox":"email","archive":"index backup box storage records","folder-open":"directory","folder-plus":"directory add create new","file-plus":"add create new document","file-minus":"delete remove erase document","files":"multiple copy documents","trending-up":"statistics","trending-down":"statistics","activity":"pulse action motion movement exercise fitness healthcare heart rate monitor vital signs vitals emergency room er intensive care hospital defibrillator earthquake seismic magnitude richter scale aftershock tremor shockwave audio waveform synthesizer synthesiser music","gauge":"dashboard dial meter speed pressure measure level","signal":"connection wireless gsm phone 2g 3g 4g 5g","radio":"signal broadcast connectivity live frequency","rss":"feed subscribe news updates notifications content blog articles broadcast syndication reader channels posts publishing digest alert following inbox newsletter weblog podcast","megaphone":"advertisement announcement attention alert loudspeaker megaphone notification","newspaper":"news feed home magazine article headline","trash":"empty deletion cleanup junk clear garbage delete remove bin waste recycle discard binoculars rubbish","chevron-down":"backwards reverse slow dropdown","grip-vertical":"grab dots handle move drag","ellipsis":"et cetera etc loader loading progress pending throbber menu options operator code coding spread rest more further extra overflow dots","arrow-up":"forward direction north up","arrow-down":"backwards direction south down"}
      const KB_ICON_NAMES = Object.keys(KB_ICONS)
      const kbIconPath = (n) => KB_ICONS[n] || KB_ICONS.terminal || []
      const kbIconSearch = (q) => {
        const s = String(q || '').trim().toLowerCase()
        if (s === '') return KB_ICON_NAMES.slice(0, 56)
        const starts = []
        const holds = []
        const words = s.split(/s+/)
        for (let i = 0; i < KB_ICON_NAMES.length; i++) {
          const n = KB_ICON_NAMES[i]
          const hay = n.replace(/-/g, ' ') + ' ' + (KB_ICON_TAGS[n] || '')
          let all = true
          for (let w = 0; w < words.length; w++) { if (words[w] !== '' && hay.indexOf(words[w]) < 0) { all = false; break } }
          if (all !== true) continue
          if (n.indexOf(s) >= 0) starts.push(n); else holds.push(n)
        }
        return starts.concat(holds).slice(0, 56)
      }
      function KbIcon(props) {
        const p = props || {}
        const segs = kbIconPath(p.name)
        return h('svg', { width: p.size || 16, height: p.size || 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
          strokeWidth: p.weight || 1.9, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: p.className || undefined },
          segs.map((d, i) => h('path', { key: i, d: d })))
      }
      // ── Feuille de style : valeurs de la maquette « Commands and actions CRUD » ──
      // Les surfaces et le texte passent par les jetons DSH (thème clair/sombre),
      // les valeurs de marque (accent, alerte) sont celles de la maquette.
      const CSS = `
/* ── jetons ────────────────────────────────────────────────────────────────
   Toutes les couleurs viennent des jetons DSH (--dsw-*), releves dans le theme
   reel, clair comme sombre. Les valeurs de repli ne servent qu'avant la
   synchronisation (voir kbSyncTheme) et n ont aucune valeur de marque. */
:root{--kb-ink:var(--dsw-alias-label-primary,#111827);--kb-ink2:var(--dsw-alias-label-secondary,#333d4d);
  --kb-muted:var(--dsw-alias-label-tertiary,#5b6577);--kb-caption:var(--dsw-alias-label-caption,#6b7587);
  --kb-line:var(--dsw-alias-border-l1,#d3dbe8);--kb-line2:var(--dsw-alias-border-l2,#dbe2ec);--kb-line3:var(--dsw-alias-border-l3,#c7cfdd);
  --kb-surface:var(--dsw-alias-bg-layer-1,#fff);--kb-surface2:var(--dsw-alias-bg-layer-2,#f7f7f5);--kb-surface3:var(--dsw-alias-bg-layer-3,#fff);
  --kb-menu:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3,#fff));--kb-fill:var(--dsw-alias-bg-module-platform,#eff1f4);
  --kb-hover:var(--dsw-alias-interactive-bg-hover,#f0f2f8);--kb-sep:var(--dsw-alias-border-l1,#eef1f6);
  --kb-elev:var(--dsw-elevation-prominent,0 14px 40px rgba(17,24,39,.14));--kb-stroke:var(--dsw-elevation-stroke-color,var(--dsw-alias-border-l1,#dbe2ec));
  --kb-primary:var(--dsw-alias-button-primary-fill,#111827);--kb-primary-h:var(--dsw-alias-button-primary-hover,#2b3445);
  --kb-primary-ink:var(--dsw-alias-label-primary-inverted,#fff);--kb-accent:var(--dsw-alias-link,#3b6fe0);
  --kb-ok:var(--dsw-alias-state-success-primary,#1c9c62);--kb-ok-bg:var(--dsw-alias-state-success-tertiary,#e7f5ee);
  --kb-warn:var(--dsw-alias-state-warn-primary,#f59e0b);--kb-warn-ink:var(--dsw-alias-state-warn-label,#8a4b00);--kb-warn-bg:var(--dsw-alias-state-warn-tertiary,#fdf1e3);
  --kb-danger:var(--dsw-alias-state-error-primary,#b42318);--kb-toast:var(--dsw-alias-toast-bg,#2b3445);--kb-toast-ink:var(--dsw-alias-label-primary,#fff);
  --kb-mask:var(--dsw-alias-bg-mask-1,rgba(17,24,39,.42));--kb-skeleton:var(--dsw-alias-bg-skeleton,#eef1f6);
  /* Typographie : l echelle et les familles de l application, pas les notres. */
  --kb-mono:var(--dsw-font-markdown-code-font-family,ui-monospace,SFMono-Regular,Menlo,monospace);
  --kb-font:var(--dsw-font-family,-apple-system,BlinkMacSystemFont,"Segoe UI","Helvetica Neue",Helvetica,Arial,sans-serif);
  --kb-fs-11:var(--dsw-font-xxxs-11-font-size,11px);--kb-fs-12:var(--dsw-font-xxs-12-font-size,12px);
  --kb-fs-13:var(--dsw-font-xs-13-font-size,13px);--kb-fs-14:var(--dsw-font-s-14-font-size,14px);
  --kb-fs-16:var(--dsw-font-base-16-font-size,16px);--kb-fs-18:var(--dsw-font-m-18-font-size,16px)}
.kbsl-scope,.kbsl-backdrop,.kbsl-toastwrap{color:var(--kb-ink)}
.kbsl-scope *,.kbsl-scope *::before,.kbsl-scope *::after,.kbsl-backdrop *,.kbsl-backdrop *::before,.kbsl-backdrop *::after{box-sizing:border-box}
/* :where() met ces regles generiques a specificite nulle : sans ca, le
   « color:inherit » du bouton generique gagnait contre les couleurs portees par
   une seule classe (.kbsl-primary, .kbsl-ibtn...), qui redevenaient toutes la
   couleur du texte. */
.kbsl-scope :where(button),.kbsl-backdrop :where(button){font:inherit;cursor:pointer;color:inherit}
.kbsl-scope :where(input,textarea),.kbsl-backdrop :where(input,textarea){font:inherit;color:inherit}
.kbsl-mono{font-family:var(--kb-mono)}
.kbsl-help{font-size:var(--kb-fs-12,12px);color:var(--kb-muted);line-height:1.45}
.kbsl-sec{font-size:12px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--kb-caption)}
.kbsl-lbl{font-size:14px;font-weight:500}
.kbsl-lblsm{font-size:var(--kb-fs-12,12px);font-weight:600;color:var(--kb-ink2)}
.kbsl-err{font-size:13px;color:var(--kb-danger)}
.kbsl-clip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kbsl-anim{animation:kbsl-rise .18s ease-out}
@keyframes kbsl-rise{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.kbsl-spin{animation:kbsl-spin .9s linear infinite}
@keyframes kbsl-spin{to{transform:rotate(360deg)}}
.kbsl-caret{display:inline-block;width:2px;height:1.1em;margin-left:1px;background:var(--kb-ink);vertical-align:text-bottom;animation:kbsl-blink 1s steps(1) infinite}
@keyframes kbsl-blink{50%{opacity:0}}
.kbsl-live{gap:6px;background:var(--kb-ok-bg);color:var(--kb-ok)}
.kbsl-live i{width:6px;height:6px;border-radius:50%;background:var(--kb-ok);display:inline-block;animation:kbsl-livedot 1.4s ease-in-out infinite}
@keyframes kbsl-livedot{0%,100%{opacity:1}50%{opacity:.3}}
.kbsl-flash{animation:kbsl-pulse 1.1s ease-out 3;background:color-mix(in srgb,var(--kb-accent) 14%,transparent)!important;border-color:var(--kb-accent)!important;color:var(--kb-ink)!important}
@keyframes kbsl-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--kb-accent) 45%,transparent)}100%{box-shadow:0 0 0 12px transparent}}

/* champs — hauteurs et rayons de la maquette (.inp 34 px / rayon 7) */
.kbsl-field{display:block;height:36px;width:100%;border:1px solid var(--kb-line);border-radius:7px;background:var(--kb-surface);padding:0 10px;font-size:14px;outline:0}
.kbsl-field:focus{border-color:var(--kb-accent);background:var(--kb-surface);box-shadow:0 0 0 3px color-mix(in srgb,var(--kb-accent) 18%,transparent)}
.kbsl-field::placeholder{color:var(--kb-caption)}
.kbsl-field.lg{height:36px;font-size:14px;font-weight:500}
.kbsl-field.sm{height:32px;font-size:var(--kb-fs-13,13px);border-radius:7px;padding:0 10px}
textarea.kbsl-field{height:auto;min-height:110px;padding:10px;line-height:1.55;resize:vertical;font-family:var(--kb-mono);font-size:13px}
textarea.kbsl-field.sm{padding:10px 12px;min-height:64px;font-size:13px}

/* boutons */
.kbsl-btn{display:inline-flex;align-items:center;gap:8px;height:42px;padding:0 18px;border:0;border-radius:12px;font-size:var(--kb-fs-14,14px);font-weight:600;white-space:nowrap}
.kbsl-btn.sm{height:34px;padding:0 12px;border-radius:9px;font-size:var(--kb-fs-13,13px)}
.kbsl-primary{background:var(--kb-primary);color:var(--kb-primary-ink)}
.kbsl-primary:hover{background:var(--kb-primary-h)}
.kbsl-primary:disabled{opacity:.45;cursor:not-allowed}
.kbsl-ghost{background:transparent;color:var(--kb-ink)}
.kbsl-ghost:hover{background:var(--kb-hover)}
.kbsl-danger{background:var(--kb-danger);color:var(--kb-primary-ink)}
.kbsl-danger:hover{background:color-mix(in srgb,var(--kb-danger) 84%,#000)}
.kbsl-danger.sm{height:34px;padding:0 12px;border-radius:9px;font-size:13px}
.kbsl-dashed{border:1px dashed var(--kb-line3);background:transparent;color:var(--kb-ink);font-weight:500}
.kbsl-dashed:hover{background:var(--kb-hover);border-color:var(--kb-accent);color:var(--kb-accent)}
.kbsl-link{border:0;background:transparent;padding:0;font-size:13px;font-weight:600;color:var(--kb-muted);text-align:left}
.kbsl-link:hover{color:var(--kb-ink);text-decoration:underline}
.kbsl-ibtn{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--kb-muted)}
.kbsl-ibtn:hover{background:var(--kb-hover);color:var(--kb-ink)}
.kbsl-ibtn.danger:hover{background:color-mix(in srgb,var(--kb-danger) 16%,transparent);color:var(--kb-danger)}
.kbsl-ibtn.sm{width:30px;height:30px;border-radius:9px}
.kbsl-ibtn:disabled{opacity:.35;cursor:default}
.kbsl-aibtn{display:inline-flex;align-items:center;gap:8px;height:36px;padding:0 14px;border:1px solid var(--kb-line2);border-radius:10px;background:var(--kb-hover);color:var(--kb-ink);font-size:14px;font-weight:600;white-space:nowrap}
.kbsl-aibtn:hover{background:var(--kb-surface3);border-color:var(--kb-line3);color:var(--kb-ink)}

/* pastilles */
.kbsl-pill{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border:1px solid var(--kb-line);border-radius:9px;background:var(--kb-surface);font-size:var(--kb-fs-13,13px);font-weight:500;color:var(--kb-ink2)}
.kbsl-pill:hover{border-color:var(--kb-line3)}
.kbsl-pill.on{background:var(--kb-primary);border-color:var(--kb-primary);color:var(--kb-primary-ink)}
.kbsl-chip{display:inline-flex;align-items:center;gap:6px;height:21px;padding:0 7px;border-radius:7px;background:var(--kb-hover);color:var(--kb-ink2);font-size:var(--kb-fs-11,11px);font-weight:600;white-space:nowrap}
.kbsl-chip.cmd{background:transparent;color:var(--kb-accent);font-family:var(--kb-mono);font-weight:500}
.kbsl-cchip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border:1px solid var(--kb-line2);border-radius:999px;background:var(--kb-fill);color:var(--kb-ink2);font-size:13px;font-weight:500}
.kbsl-cchip:hover{background:var(--kb-hover);border-color:var(--kb-line3);color:var(--kb-ink)}
.kbsl-cchip.on{background:var(--kb-hover);border-color:var(--kb-line3);color:var(--kb-ink)}
.kbsl-cchip.icon{width:28px;height:28px;padding:0;justify-content:center;border:none;border-radius:999px;background:var(--dsw-specific-selector);color:var(--dsw-alias-label-primary);flex:none}
.kbsl-cchip.icon:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-solid);border-color:transparent;color:var(--dsw-alias-label-primary)}
.kbsl-cchip.icon.on{background:var(--dsw-alias-interactive-bg-hover-solid);border-color:transparent;color:var(--dsw-alias-label-primary)}
/* collées au « + » du composeur : mêmes ronds, juste après lui, avant la permission */
[class*="tools"]>.kbsl-scope{order:1;gap:inherit}
[class*="tools"]>[class*="modes"]{order:2}
.kbsl-tile{display:inline-flex;align-items:center;justify-content:center;flex:none;width:44px;height:44px;border:1px solid var(--kb-line2);border-radius:12px;background:var(--kb-surface2);color:var(--kb-ink2);padding:0}
.kbsl-tile.sm{width:30px;height:30px;border-radius:9px}
.kbsl-tile.xs{width:28px;height:28px;border-radius:8px}
.kbsl-tile.lg{width:64px;height:64px;border-radius:16px;background:var(--kb-surface);box-shadow:0 1px 2px color-mix(in srgb,#000 10%,transparent)}
button.kbsl-tile.lg:hover{border-color:var(--kb-accent)}
.kbsl-opt{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:7px;background:var(--kb-hover);color:var(--kb-ink2);font-size:12px;font-weight:600}
.kbsl-kbd{padding:1px 6px;border-radius:6px;background:var(--kb-hover);font-size:13px;color:var(--kb-ink2)}

/* interrupteur */
.kbsl-tgl{position:relative;flex:none;width:44px;height:26px;padding:0;border:0;border-radius:999px;background:var(--kb-line3);transition:background .15s}
.kbsl-tgl::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--kb-surface);box-shadow:0 1px 2px color-mix(in srgb,#000 30%,transparent);transition:transform .15s}
.kbsl-tgl.on{background:var(--kb-primary)}
.kbsl-tgl.on::after{background:var(--kb-primary-ink);transform:translateX(18px)}

/* infobulle (repli si la primitive Tooltip de DSH n est pas disponible) */
.kbsl-tt{position:relative}
.kbsl-tt::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 8px);transform:translateX(-50%);width:max-content;max-width:250px;padding:7px 10px;border-radius:8px;background:var(--kb-toast);color:var(--kb-toast-ink);font-size:13px;font-weight:500;line-height:1.4;text-align:left;white-space:normal;pointer-events:none;opacity:0;transition:opacity .1s;z-index:80;box-shadow:var(--kb-elev)}
.kbsl-tt:hover::after,.kbsl-tt:focus-visible::after{opacity:1;transition:opacity .12s .3s}
.kbsl-tt.b::after{bottom:auto;top:calc(100% + 8px)}
.kbsl-tt.l::after{left:0;transform:none}
.kbsl-tt.r::after{left:auto;right:0;transform:none}
.kbsl-tt.lf::after{left:auto;right:calc(100% + 8px);top:50%;bottom:auto;transform:translateY(-50%)}

/* menus et palette : surface, FLOU et ombre du menu natif du composeur.
   Le jeton du menu natif est translucide (#30313680 en sombre, #f8f9fa94 en
   clair) : DSH ne l emploie jamais seul, il l associe toujours a
   backdrop-filter: var(--dsw-menu-backdrop-filter) — blur(40px) saturate(150%).
   Sans ce flou, la conversation reste nette et lisible a travers la palette —
   le defaut constate. On garde le jeton de l application, pas une constante :
   si DSH change son flou, la palette suit.
   border:0 comme le menu natif : --kb-elev porte deja le filet de 0,5 px
   (--dsw-elevation-prominent) ; un bord transparent ne faisait que decaler le
   fond de 1 px sous le filet. */
.kbsl-pop{background:var(--kb-menu);backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));border:0;border-radius:20px;box-shadow:var(--kb-elev);padding:4px;display:flex;flex-direction:column;min-height:0;max-height:min(60vh,var(--kb-dock-max,520px))}
/* La fiche de saisie : en-tete et pied fixes, seul le corps defile. Sinon un
   formulaire long poussait son titre et son bouton Fermer hors de l ecran. */
/* Specificite .kbsl-pop>* : la regle generique « rien ne cede » passe apres
   celle-ci dans la feuille et gagnait, le corps refusait de se reduire et
   debordait par-dessus le composeur. */
.kbsl-pop>.kbsl-shead{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--kb-sep);flex:none}
.kbsl-pop>.kbsl-sbody{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:10px;padding:10px 12px}
.kbsl-pop>.kbsl-sfoot{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:8px 12px;border-top:1px solid var(--kb-sep);flex:none}
/* En-tete et pied : deux lignes fines, comme les intitules du menu natif. */
.kbsl-phead{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px 4px}
/* Seule la liste cede de la place : sans ca, l en-tete et le pied se font
   ecraser par le repli flex des que la liste est longue. */
.kbsl-pop>*{flex:none}
.kbsl-rows{flex:1 1 auto;display:flex;flex-direction:column;gap:2px;min-height:0;overflow:auto;overscroll-behavior:contain}
.kbsl-pop-h{font-size:var(--kb-fs-11,11px);font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--kb-caption)}
.kbsl-pop-f{margin-top:2px;padding:5px 10px 3px;border-top:1px solid var(--kb-sep);font-size:var(--kb-fs-11,11px);color:var(--kb-caption)}
.kbsl-pwrap{position:relative;display:flex;align-items:center;gap:4px;padding-right:6px;border-radius:10px}
.kbsl-pwrap:hover,.kbsl-pwrap.on{background:var(--kb-hover)}
/* Une ligne = une entree : picto, nom court, titre, puis la description
   poussee a droite (comme le menu natif). Au repos, rien ne reserve de largeur ;
   des que les actions de ligne apparaissent, la ligne leur en reserve 104px
   (regle plus bas). */
.kbsl-pmain{flex:1;min-width:0;display:flex;align-items:center;gap:8px;padding:7px 10px;border:0;border-radius:10px;background:transparent;text-align:left;transition:padding-right .12s ease}
.kbsl-pmain .kbsl-tile{width:24px;height:24px;border-radius:7px}
.kbsl-pmain .pslug{flex:none;font-family:var(--kb-mono);font-size:var(--kb-fs-12,12px);font-weight:500;color:var(--kb-accent)}
.kbsl-pmain .ptitle{flex:0 1 auto;font-size:var(--kb-fs-13,13px);font-weight:600}
.kbsl-pmain .pdesc{flex:0 1 auto;min-width:0;margin-left:auto;text-align:right;font-size:var(--kb-fs-12,12px);color:var(--kb-muted)}
/* Les actions de ligne flottent au-dessus : invisibles, elles ne prennent
   aucune place — c est l espace perdu du a droite qui disparait au repos. Voir
   plus bas la reserve de 104px qui les empeche de recouvrir la description. */
/* Meme surface que la palette (jeton translucide + flou) : ces trois boutons
   flottent AU-DESSUS du titre et de la description de la ligne, ils doivent les
   masquer. Sans le flou, le texte de la ligne restait lisible a travers eux. */
.kbsl-pact{position:absolute;right:6px;top:50%;transform:translateY(-50%);display:flex;gap:2px;padding-left:4px;border-radius:10px;background:var(--kb-menu);backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));-webkit-backdrop-filter:var(--dsw-menu-backdrop-filter,blur(40px) saturate(150%));opacity:0;transition:opacity .1s}
.kbsl-pwrap:hover .kbsl-pact,.kbsl-pwrap.on .kbsl-pact,.kbsl-pwrap:focus-within .kbsl-pact{opacity:1}
.kbsl-phead .kbsl-query{margin-left:auto;display:inline-flex;align-items:center;gap:8px;font-size:var(--kb-fs-12,12px);color:var(--kb-accent)}
.kbsl-pwrap.sel{background:var(--kb-hover);box-shadow:inset 2px 0 0 var(--kb-accent)}
.kbsl-pwrap.sel .kbsl-pact{opacity:1}
/* La bande d actions fait 98px (4px de marge + 3 boutons de 30px + 2 gouttieres
   de 2px) posee a right:6px, soit 104px a reserver. Tant qu elle est visible,
   le contenu de la ligne (titre, description, pastille) doit s arreter avant
   elle : sans ca les icones recouvraient la fin de la description — constate
   « Objectifs, fait, pas fait, su… » coupe sous le crayon, un fragment
   depassait meme entre deux icones. La reserve n existe que pendant que les
   actions existent : au repos la ligne garde toute sa largeur. */
.kbsl-pwrap:hover .kbsl-pmain,.kbsl-pwrap.on .kbsl-pmain,.kbsl-pwrap.sel .kbsl-pmain,.kbsl-pwrap:focus-within .kbsl-pmain{padding-right:104px}
.kbsl-prow{display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:0;border-radius:10px;background:transparent;text-align:left;font-size:var(--kb-fs-13,13px);font-weight:600}
.kbsl-prow:hover{background:var(--kb-hover)}
.kbsl-prow.new{margin-top:2px;color:var(--kb-accent)}
.kbsl-prow.ai{color:var(--kb-ink)}
.kbsl-choice{display:flex;align-items:center;gap:12px;width:100%;padding:10px 12px;border:0;border-radius:12px;background:transparent;text-align:left}
.kbsl-choice:hover{background:var(--kb-hover)}
.kbsl-choice.ai:hover{background:var(--kb-hover)}
.kbsl-quote{padding:6px 10px;border-radius:9px;background:var(--kb-surface2);color:var(--kb-muted);font-size:var(--kb-fs-12,12px);line-height:1.45}
.kbsl-result{padding:8px 10px;border-radius:9px;background:var(--kb-surface2);border:1px dashed var(--kb-line3);color:var(--kb-ink2);font-size:var(--kb-fs-12,12px);line-height:1.5;white-space:pre-wrap;max-height:120px;overflow:auto}
/* Dans l'éditeur seulement, « ce qui sera envoyé » se lit comme un bloc de
   texte de la maquette (pas d'encadré en pointillés dans une carte). */
.kbsl-easide .kbsl-result{padding:0;border:0;border-radius:0;background:transparent;font-size:12px;line-height:1.55;max-height:160px;overflow-wrap:anywhere}

/* Actions sous un message — MEME GABARIT QUE LES ICONES DU SHELL.
   Mesure du 25/09/2026 sur la barre reelle : le shell peint Copier, les pouces
   et la branche en boutons FANTOMES de 28 px (padding 6, rayon 28, sans
   bordure), svg de 16 px, hover interactive-bg-hover. Nos pilules etiquetees
   (30 px, bordure, fond) cassaient ce rythme : on reprend le gabarit du shell,
   et le nom de l'action passe en tooltip (title et aria-label), plus en texte. */
.kbsl-acts{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:0}
.kbsl-awrap{position:relative;display:inline-flex;align-items:center}
.kbsl-abtn{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;border:0;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.kbsl-abtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.kbsl-abtn:focus-visible{outline:2px solid var(--dsw-alias-label-primary);outline-offset:1px}
.kbsl-abtn svg{width:16px;height:16px;color:currentColor}
.kbsl-abtn-add{display:inline-flex;align-items:center;justify-content:center;width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));padding:6px;border:0;border-radius:28px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.kbsl-abtn-add:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.kbsl-abtn-add svg{width:16px;height:16px;color:currentColor}
/* Modifier / supprimer une action : au CLIC DROIT sur son bouton (menu
   contextuel), plus en pastille au survol — la pastille debordait de 3 px sur
   le bouton voisin et cassait l'alignement des icones. */
.kbsl-ctxitem{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:var(--kb-ink);font:inherit;font-size:14px;text-align:left;cursor:pointer}
.kbsl-ctxitem:hover{background:var(--kb-hover)}
.kbsl-ctxitem.danger{color:var(--kb-danger)}
.kbsl-ctxitem.danger:hover{background:color-mix(in srgb,var(--kb-danger) 12%,transparent)}
.kbsl-menu{position:absolute;z-index:12;width:320px;display:flex;flex-direction:column;gap:2px}

/* étapes de l'éditeur */
/* étapes : le chiffre devient une pastille discrète (maquette .block-label) */
.kbsl-step{display:flex;gap:12px}
.kbsl-stepn{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-top:1px;border:1px solid var(--kb-line3);border-radius:7px;background:transparent;color:var(--kb-muted);font-size:12px;font-weight:600}
.kbsl-stepn.done{background:var(--kb-ok-bg);color:var(--kb-ok);border-color:color-mix(in srgb,var(--kb-ok) 30%,transparent)}
.kbsl-stepn.opt{background:transparent;color:var(--kb-caption);border:1px dashed var(--kb-line3)}
.kbsl-steph{margin:0;font-size:14px;font-weight:600;letter-spacing:0}
.kbsl-info{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--kb-caption);cursor:help}
.kbsl-info:hover{background:var(--kb-hover);color:var(--kb-ink)}

/* variables du gabarit */
.kbsl-vchip{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:1px solid transparent;border-radius:8px;font-family:var(--kb-mono);font-size:13px}
.kbsl-vchip.ok{background:var(--kb-ok-bg);color:var(--kb-ok);border-color:color-mix(in srgb,var(--kb-ok) 26%,transparent)}
.kbsl-vchip.ok:hover{background:color-mix(in srgb,var(--kb-ok) 18%,transparent)}
.kbsl-vchip.missing{background:var(--kb-warn-bg);color:var(--kb-warn-ink);border-color:color-mix(in srgb,var(--kb-warn) 34%,transparent)}
.kbsl-vchip.unused{background:var(--kb-surface);color:var(--kb-muted);border:1px dashed var(--kb-line3)}
.kbsl-vchip.unused:hover{border-color:var(--kb-accent);color:var(--kb-accent)}
.kbsl-vistag{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border-radius:7px;background:var(--kb-warn-bg);color:var(--kb-warn-ink);font-size:12px;font-weight:600}

/* fiches de champ */
.kbsl-fcard{background:var(--kb-surface);border:1px solid var(--kb-line2);border-radius:14px;transition:box-shadow .12s,border-color .12s}
.kbsl-fcard.open{border-color:var(--kb-line3);box-shadow:var(--kb-elev)}
.kbsl-fcard.drag{opacity:.4}
.kbsl-fcard.up{box-shadow:0 -3px 0 0 var(--kb-accent)}
.kbsl-fcard.down{box-shadow:0 3px 0 0 var(--kb-accent)}
.kbsl-fhead{display:flex;align-items:center;gap:4px;padding:6px 8px 6px 4px;border-radius:14px;cursor:grab}
.kbsl-grip{display:inline-flex;align-items:center;justify-content:center;width:30px;height:36px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--kb-caption);cursor:grab}
.kbsl-grip:hover{background:var(--kb-hover);color:var(--kb-ink2)}
.kbsl-fmain{flex:1;min-width:0;display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:6px 4px;border:0;background:transparent;text-align:left;font-size:14px;font-weight:600}
.kbsl-chev{display:inline-flex;color:var(--kb-caption);transition:transform .15s}
.kbsl-chev.open{transform:rotate(180deg)}
.kbsl-fbody{display:flex;flex-direction:column;gap:16px;padding:16px 18px 18px;border-top:1px solid var(--kb-sep);animation:kbsl-rise .18s ease-out}

/* éditeur : fenêtre — langage de la maquette kybernos-app.html (en-tête 15 px
   + segment, corps à deux colonnes, blocs étiquetés, aperçu en cartes). */
.kbsl-backdrop{position:fixed;inset:0;z-index:1100;display:flex;align-items:center;justify-content:center;background:var(--kb-mask);padding:16px}
.kbsl-modal{width:min(1040px,100%);height:min(780px,calc(100% - 32px));display:flex;flex-direction:column;background:var(--kb-surface);color:var(--kb-ink);
  border:1px solid var(--kb-stroke);border-radius:16px;box-shadow:var(--kb-elev);overflow:hidden}
.kbsl-ehead{flex:none;display:flex;align-items:center;gap:8px;padding:10px 10px 10px 14px;border-bottom:1px solid var(--kb-line2)}
.kbsl-eh{margin:0 auto 0 4px;font-size:14px;font-weight:600;letter-spacing:0}
.kbsl-ehead .kbsl-ibtn{width:32px;height:32px;border-radius:7px}
.kbsl-ehead .kbsl-aibtn{height:32px;padding:0 10px;font-size:13px;font-weight:500;background:transparent;border-color:var(--kb-line2)}
.kbsl-ehead .kbsl-aibtn:hover{background:var(--kb-hover)}
.kbsl-seg{display:inline-flex;background:var(--kb-surface2);border-radius:8px;padding:2px;gap:2px}
.kbsl-seg .kbsl-pill{height:26px;padding:0 10px;border:0;border-radius:6px;background:transparent;color:var(--kb-muted);font-size:13px;font-weight:500}
.kbsl-seg .kbsl-pill:hover{border:0;background:transparent;color:var(--kb-ink)}
.kbsl-seg .kbsl-pill.on{background:var(--kb-surface);color:var(--kb-ink);box-shadow:0 1px 2px color-mix(in srgb,#000 8%,transparent)}
.kbsl-ebody{flex:1;min-height:0;display:grid;grid-template-columns:1fr 330px}
.kbsl-esteps{min-width:0;overflow:auto;display:flex;flex-direction:column;gap:22px;padding:16px 18px 24px}
.kbsl-easide{min-width:0;display:flex;flex-direction:column;gap:10px;padding:14px;border-left:1px solid var(--kb-line2);background:var(--kb-fill);overflow:auto}
.kbsl-efoot{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid var(--kb-line2)}
.kbsl-efoot .kbsl-btn{height:34px;padding:0 12px;border-radius:7px;font-size:14px;font-weight:500}
.kbsl-pvcard{display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--kb-line2);border-radius:10px;background:var(--kb-surface)}
.kbsl-pvlabel{font-size:12px;font-weight:500;letter-spacing:0;text-transform:none;color:var(--kb-caption)}
.kbsl-slugbox{display:inline-flex;align-items:center;gap:2px;height:36px;padding:0 4px 0 10px;border:1px solid var(--kb-line);border-radius:7px;background:var(--kb-surface)}
.kbsl-slugbox:focus-within{border-color:var(--kb-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--kb-accent) 18%,transparent)}
.kbsl-slugin{width:150px;height:32px;border:0;outline:0;background:transparent;font-size:13px;font-family:var(--kb-mono);color:var(--kb-accent)}
.kbsl-icopick{display:flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--kb-muted)}
.kbsl-icopick:hover{background:var(--kb-hover);color:var(--kb-ink)}
.kbsl-icopick.on{border-color:var(--kb-accent);background:var(--kb-hover);color:var(--kb-ink)}
.kbsl-icoquery{width:340px;max-height:330px;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:10px;background:var(--kb-menu);border:1px solid var(--kb-stroke);border-radius:14px;box-shadow:var(--kb-elev)}
.kbsl-idrow{display:grid;grid-template-columns:40px minmax(0,1fr) 200px;gap:8px;align-items:center}
.kbsl-idrow .kbsl-idname{grid-column:2 / 3}
.kbsl-idrow .kbsl-idslug{grid-column:3 / 4}
.kbsl-idrow .kbsl-iddesc{grid-column:2 / -1}
.kbsl-idrow .kbsl-tile.lg{width:38px;height:38px;border-radius:10px}
@media (max-width:820px){
  .kbsl-ebody{grid-template-columns:1fr;overflow:auto}
  .kbsl-esteps,.kbsl-easide{overflow:visible}
  .kbsl-easide{border-left:0;border-top:1px solid var(--kb-line2)}
  .kbsl-idrow{grid-template-columns:40px minmax(0,1fr)}
  .kbsl-idrow .kbsl-idslug,.kbsl-idrow .kbsl-iddesc{grid-column:1 / -1}
}

/* réglages */
.kbsl-page{display:flex;flex-direction:column;gap:16px;max-width:720px;min-width:0;color:var(--kb-ink)}
.kbsl-head{display:flex;flex-direction:column;gap:5px}
.kbsl-h1{margin:0;font-size:26px;line-height:32px;font-weight:800;letter-spacing:-.01em}
.kbsl-sub{font-size:14px;line-height:1.55;color:var(--kb-muted);max-width:640px}
.kbsl-tabs{display:flex;gap:4px;align-items:center;border-bottom:1px solid var(--kb-line);padding-bottom:6px}
.kbsl-search{height:32px;padding:0 10px;border-radius:8px;border:1px solid var(--kb-line);background:transparent;color:inherit;font:inherit;font-size:13px}
.kbsl-tab{padding:5px 11px;border-radius:8px;font-size:13px;color:var(--kb-muted);background:none;border:0}
.kbsl-tab.on{background:var(--kb-hover);color:var(--kb-ink)}
.kbsl-lrow{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;border:1px solid transparent;flex-wrap:nowrap;min-width:0}
.kbsl-lrow:hover{background:var(--kb-hover)}
.kbsl-lrow>.kbsl-chip,.kbsl-lrow>.kbsl-tile,.kbsl-lrow>.kbsl-ibtn{flex:none}
.kbsl-lmain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;text-align:left;border:0;background:transparent;padding:0;overflow:hidden}
.kbsl-ltitle{display:flex;align-items:baseline;gap:8px;font-size:14px;font-weight:600;min-width:0;white-space:nowrap;overflow:hidden}
.kbsl-ltitle>span{overflow:hidden;text-overflow:ellipsis}
.kbsl-jrow{display:flex;align-items:center;gap:8px}
.kbsl-json summary{cursor:pointer;color:var(--kb-muted);font-size:12px}
.kbsl-json pre{margin:6px 0 0;padding:10px;background:var(--kb-surface2);border-radius:10px;font-size:12px;overflow:auto;max-height:260px}

/* ancrage au-dessus du composeur */
/* Plan volontairement BAS : le menu natif du composeur (declencheur « / ») doit
   rester au-dessus de nos panneaux quand ils se croisent. Le recouvrement par
   la barre de titre, lui, se regle en bornant la hauteur (voir KbComposerDock),
   pas en montant le plan. */
.kbsl-dock{position:absolute;left:8px;right:8px;top:0;transform:translateY(calc(-100% - 8px));z-index:7;display:flex;flex-direction:column;gap:10px}

/* toast */
.kbsl-toastwrap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1150;display:flex;align-items:center;gap:14px;padding:10px 12px 10px 18px;background:var(--kb-toast);color:var(--kb-toast-ink);border-radius:14px;font-size:14px;box-shadow:var(--kb-elev)}
.kbsl-toast-btn{border:0;border-radius:8px;background:color-mix(in srgb,currentColor 16%,transparent);color:inherit;font-size:13px;font-weight:600;height:30px;padding:0 12px}
.kbsl-toast-btn:hover{background:color-mix(in srgb,currentColor 28%,transparent)}

/* editeur et notification : au-dessus de la couche la plus haute de l'application (1000) */
/* démonstration */
.kbsl-demo{display:flex;flex-direction:column;gap:8px;border:0;border-radius:0;background:transparent;overflow:visible}
.kbsl-demo-stage{display:flex;flex-direction:column;justify-content:flex-end;gap:8px;height:auto;padding:0;background:transparent;border:0;border-radius:0;overflow:visible}

/* fiches de champ : flèches visibles au survol */
.kbsl-fcard .kbsl-ibtn.mv{opacity:0;transition:opacity .12s}
.kbsl-fcard:hover .kbsl-ibtn.mv,.kbsl-fcard:focus-within .kbsl-ibtn.mv{opacity:1}

.kbsl-field.bad{border-color:var(--kb-danger);background:color-mix(in srgb,var(--kb-danger) 9%,transparent)}
.kbsl-desc{font-size:13px;color:var(--kb-muted);line-height:1.5}
.kbsl-tipico{display:inline-flex;align-items:center;justify-content:center;flex:none;width:34px;height:34px;border-radius:10px;background:var(--kb-hover);color:var(--kb-ink2)}
.kbsl-pill>svg{flex:none}

/* barres de défilement discrètes, comme le menu natif */
.kbsl-scope *,.kbsl-backdrop *{scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2,var(--kb-line3)) transparent}

`

      // ══════════════════════════════════════════════════════════════════════
      // 2. L'ÉTAT D'INTERFACE — palette, éditeur, confirmation, toast
      // ══════════════════════════════════════════════════════════════════════
      const ui = { palette: false, editor: null, toast: null, confirmId: null, addOpen: false, menu: null, flashId: null, palIdx: 0, palQuery: '', ctxId: null }
      let kbToastTimer = null

      // ── Pont de theme ─────────────────────────────────────────────────────
      // Les jetons --dsw-* ne sont pas poses sur :root : ils vivent sur un
      // element profond du composeur. Les surfaces rendues dans la surcouche
      // globale (editeur, toast) n en heritent donc PAS et retombaient sur les
      // valeurs de repli claires, sur une application sombre. On lit une fois
      // les jetons resolus depuis l interieur de l application et on les repose
      // sur :root, ou toute la fenetre les voit. On resynchronise au changement
      // de theme (attribut de racine, feuille de style) et au changement de
      // preference systeme.
      const KB_THEME_TOKENS = [
        ['--kb-ink', '--dsw-alias-label-primary'], ['--kb-ink2', '--dsw-alias-label-secondary'],
        ['--kb-muted', '--dsw-alias-label-tertiary'], ['--kb-caption', '--dsw-alias-label-caption'],
        ['--kb-line', '--dsw-alias-border-l1'], ['--kb-line2', '--dsw-alias-border-l2'], ['--kb-line3', '--dsw-alias-border-l3'],
        ['--kb-surface', '--dsw-alias-bg-layer-1'], ['--kb-surface2', '--dsw-alias-bg-layer-2'], ['--kb-surface3', '--dsw-alias-bg-layer-3'],
        ['--kb-menu', '--dsw-specific-menu'], ['--kb-hover', '--dsw-alias-interactive-bg-hover'],
        ['--kb-fill', '--dsw-alias-bg-module-platform'],
        ['--kb-elev', '--dsw-elevation-prominent'], ['--kb-stroke', '--dsw-elevation-stroke-color'],
        ['--kb-primary', '--dsw-alias-button-primary-fill'], ['--kb-primary-h', '--dsw-alias-button-primary-hover'],
        ['--kb-primary-ink', '--dsw-alias-label-primary-inverted'], ['--kb-accent', '--dsw-alias-link'],
        ['--kb-ok', '--dsw-alias-state-success-primary'], ['--kb-ok-bg', '--dsw-alias-state-success-tertiary'],
        ['--kb-warn', '--dsw-alias-state-warn-primary'], ['--kb-warn-ink', '--dsw-alias-state-warn-label'], ['--kb-warn-bg', '--dsw-alias-state-warn-tertiary'],
        ['--kb-danger', '--dsw-alias-state-error-primary'], ['--kb-toast', '--dsw-alias-toast-bg'], ['--kb-toast-ink', '--dsw-alias-label-primary'],
        ['--kb-mask', '--dsw-alias-bg-mask-1'], ['--kb-skeleton', '--dsw-alias-bg-skeleton'],
        // Typographie : l echelle et les familles de l application. Indispensable
        // pour l editeur et la notification, montes dans le corps du document :
        // la, les jetons --dsw-* ne sont plus herites.
        ['--kb-font', '--dsw-font-family'], ['--kb-mono', '--dsw-font-markdown-code-font-family'],
        ['--kb-fs-11', '--dsw-font-xxxs-11-font-size'], ['--kb-fs-12', '--dsw-font-xxs-12-font-size'],
        ['--kb-fs-13', '--dsw-font-xs-13-font-size'], ['--kb-fs-14', '--dsw-font-s-14-font-size'],
        ['--kb-fs-16', '--dsw-font-base-16-font-size'], ['--kb-fs-18', '--dsw-font-m-18-font-size'],
      ]
      let kbThemeTag = null
      let kbThemeLast = ''
      const kbThemeSource = () => {
        const champs = ['[data-composer-input]', '[data-kb-chip]', '.kbsl-scope']
        for (let i = 0; i < champs.length; i += 1) {
          const el = document.querySelector(champs[i])
          if (el !== null && getComputedStyle(el).getPropertyValue('--dsw-alias-bg-layer-1').trim() !== '') return el
        }
        const racine = document.querySelector('#root') || document.body
        return racine
      }
      const kbSyncTheme = () => {
        if (typeof document === 'undefined' || document.body === null) return
        const src = kbThemeSource()
        if (src === null || src === undefined) return
        const cs = getComputedStyle(src)
        const decls = []
        for (let i = 0; i < KB_THEME_TOKENS.length; i += 1) {
          const v = cs.getPropertyValue(KB_THEME_TOKENS[i][1]).trim()
          if (v !== '') decls.push(KB_THEME_TOKENS[i][0] + ':' + v)
        }
        if (decls.length === 0) return
        const themeCss = ':root{' + decls.join(';') + '}'
        if (themeCss === kbThemeLast) return
        kbThemeLast = themeCss
        if (kbThemeTag === null) {
          kbThemeTag = document.createElement('style')
          kbThemeTag.setAttribute('data-kb-theme', '1')
          document.head.appendChild(kbThemeTag)
        }
        kbThemeTag.textContent = themeCss
        diag.theme = decls.length
      }
      const kbWatchTheme = () => {
        if (typeof window === 'undefined') return
        kbSyncTheme()
        if (typeof MutationObserver !== 'function') return
        let prevu = false
        const planifier = () => {
          if (prevu) return
          prevu = true
          setTimeout(() => { prevu = false; kbSyncTheme() }, 120)
        }
        const obs = new MutationObserver(planifier)
        obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-color-scheme'] })
        if (document.head !== null) obs.observe(document.head, { childList: true, subtree: true })
        if (typeof window.matchMedia === 'function') {
          const mq = window.matchMedia('(prefers-color-scheme: dark)')
          if (typeof mq.addEventListener === 'function') mq.addEventListener('change', planifier)
        }
        return obs
      }
      const kbFlash = (text, undo) => {
        ui.toast = { text: text, undo: undo || null }
        if (kbToastTimer !== null) clearTimeout(kbToastTimer)
        kbToastTimer = setTimeout(() => { ui.toast = null; kbToastTimer = null; notify() }, 5000)
        notify()
      }
      // Un abonnement au magasin : tout composant qui l'appelle se redessine
      // quand l'état d'interface change (même canal que les données).
      const kbTick = () => {
        const pair = React.useState(0)
        const set = pair[1]
        React.useEffect(() => onStore(() => set((n) => n + 1)), [])
        return pair[0]
      }

      // ── Pont entre la forme de la maquette (brouillon) et celle du modèle ──
      const kbSlugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      const kbCleanSlug = (s) => String(s).toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '')
      const kbCleanName = (s) => String(s).toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
      const kbOptList = (str) => String(str || '').split(',').map((x) => x.trim()).filter((x) => x !== '')
      const kbTitleCase = (n) => { const t = String(n).replace(/[_-]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1) }
      const kbTypeIn = (t) => (t === 'textarea' ? 'long' : (t === 'checkbox' ? 'toggle' : (t === 'date' ? 'date' : (t === 'select' ? 'select' : (t === 'number' ? 'number' : 'text')))))
      const kbTypeOut = (t) => (t === 'long' ? 'textarea' : (t === 'toggle' ? 'checkbox' : (t === 'date' ? 'date' : (t === 'select' ? 'select' : (t === 'number' ? 'number' : 'text')))))
      const kbTypeLabel = (t) => (t === 'long' ? 'Long text' : (t === 'select' ? 'Choice' : (t === 'number' ? 'Number' : (t === 'toggle' ? 'Yes / No' : (t === 'date' ? 'Date' : 'Text')))))
      const KB_TYPE_PILLS = ['text', 'long', 'number', 'select', 'toggle', 'date']
      // Un picto et une infobulle par type : la pastille reste courte, le sens
      // complet vit dans l infobulle.
      const KB_TYPE_ICON = { text: 'type', long: 'file-text', number: 'hash', select: 'list', toggle: 'check', date: 'calendar' }
      const KB_TYPE_SHORT = { text: 'Text', long: 'Long', number: 'Number', select: 'Choice', toggle: 'Yes/No', date: 'Date' }
      const KB_TYPE_TIP = {
        text: 'Text: one line, e.g. a name or a language',
        long: 'Long text: a paragraph, e.g. pasted code',
        number: 'Number: digits only',
        select: 'Choice: pick one of the options you list below',
        toggle: 'Yes / No switch',
        date: 'Date picker',
      }
      const kbOpIn = (op) => ({ '=': 'eq', '!=': 'neq', empty: 'empty', notEmpty: 'filled' }[op] || 'eq')
      const kbOpOut = (op) => ({ eq: '=', neq: '!=', empty: 'empty', filled: 'notEmpty' }[op] || '=')
      const kbVarsOf = (tpl) => {
        const out = []
        const re = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}?\}/g
        const src = String(tpl || '')
        let m = re.exec(src)
        while (m !== null) { if (out.indexOf(m[1]) < 0) out.push(m[1]); m = re.exec(src) }
        return out
      }
      const kbToBraces = (tpl) => String(tpl || '').replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (m, n) => '{' + n + '}')
      const kbOff = () => ({ on: false, field: '', op: 'eq', value: '' })
      // Un libelle lisible a partir d un nom de variable : periode -> Periode,
      // code_snip -> Code snip.
      const kbVarLabel = (nom) => {
        const t = String(nom).replace(/_/g, ' ').trim()
        return t === '' ? 'New question' : t.charAt(0).toUpperCase() + t.slice(1)
      }
      const kbNewField = (n, nom) => ({
        id: 'f' + String(n) + Math.floor(Math.random() * 1000),
        label: nom === undefined ? 'New question' : kbVarLabel(nom),
        name: nom === undefined ? 'field' + String(n) : String(nom),
        type: 'text', def: '', options: '', vis: kbOff(), open: true, more: false,
      })
      const kbBlankDraft = (kind) => ({
        id: '', kind: kind === 'action' ? 'action' : 'slash', title: '', slug: '', desc: '',
        icon: kind === 'action' ? 'sparkles' : 'terminal', template: '', fields: [],
        delivery: 'insert', showOn: 'assistant', placement: 'toolbar',
      })
      function kbToDraft(entry) {
        const fields = (entry.fields || []).map((f, i) => {
          const cond = toConditions(f.showIf)[0] || {}
          return {
            id: 'f' + String(i) + '-' + String(f.key || ''),
            label: L(f.label) || '',
            name: String(f.key || ''),
            type: kbTypeIn(f.type),
            def: f.type === 'checkbox' ? (f.default === true ? 'true' : 'false') : String(f.default === undefined || f.default === null ? '' : f.default),
            options: (f.options || []).map((o) => (o !== null && typeof o === 'object') ? String(o.value !== undefined ? o.value : (o.label || '')) : String(o)).join(', '),
            vis: cond.field ? { on: true, field: String(cond.field), op: kbOpIn(cond.op), value: cond.value === undefined ? '' : String(cond.value) } : kbOff(),
            open: false, more: false,
          }
        })
        return {
          id: idOf(entry), kind: entry.kind === 'action' ? 'action' : 'slash',
          title: L(entry.label) || nameOf(entry), slug: nameOf(entry), desc: L(entry.description) || '',
          icon: entry.icon || (entry.kind === 'action' ? 'sparkles' : 'terminal'),
          template: String(entry.template || ''), fields: fields,
          delivery: (entry.delivery === 'send' || kbEnvoiLocal()[idOf(entry)] === 'send') ? 'send' : 'insert',
          showOn: entry.showOn === 'user' || entry.showOn === 'both' ? entry.showOn : 'assistant',
          placement: entry.hiddenInToolbar === true ? 'menu' : 'toolbar',
        }
      }
      function kbFromDraft(d) {
        const fields = d.fields.filter((f) => String(f.label).trim() !== '' || String(f.name).trim() !== '').map((f) => {
          const showIf = []
          if (f.vis !== undefined && f.vis.on === true && f.vis.field) {
            const noValue = f.vis.op === 'empty' || f.vis.op === 'filled'
            showIf.push({ field: f.vis.field, op: kbOpOut(f.vis.op), value: noValue ? '' : f.vis.value })
          }
          return {
            key: String(f.name).trim(), label: String(f.label).trim(), type: kbTypeOut(f.type), required: false,
            default: f.type === 'toggle' ? (f.def === 'true') : String(f.def === undefined ? '' : f.def),
            options: f.type === 'select' ? kbOptList(f.options).map((v) => ({ value: v, label: v })) : [],
            showIf: showIf,
          }
        })
        const isAction = d.kind === 'action'
        const slug = isAction ? '' : kbCleanSlug(d.slug)
        return {
          id: d.id || undefined,
          kind: isAction ? 'action' : 'slash',
          slug: slug,
          name: isAction ? (kbSlugify(d.title) || 'action') : slug,
          label: String(d.title).trim(),
          description: String(d.desc).trim(),
          icon: d.icon || (isAction ? 'sparkles' : 'terminal'),
          template: kbToBraces(d.template),
          fields: fields,
          delivery: d.delivery === 'send' ? 'send' : 'insert',
          hiddenInToolbar: isAction && d.placement === 'menu',
          order: 10,
          active: true,
        }
      }

      // ── Création, duplication, suppression : tout passe par la route ──────
      const kbNewDraftEntry = (draft, entry) => {
        const next = Object.assign({}, entry)
        next.fields = draft.fields
        return next
      }
      function kbOpenEditor(mode, kind, entry, seed) {
        const s = seed || {}
        const base = entry ? kbToDraft(entry) : Object.assign(kbBlankDraft(kind), s.title !== undefined ? { title: s.title } : {}, s.template !== undefined ? { template: s.template } : {})
        ui.editor = {
          mode: mode, kind: base.kind, draft: base, step: 0, iconOpen: false, iconQuery: '',
          openField: null, confirmDel: false, drag: null, over: null, error: null, saving: false,
        }
        ui.palette = false
        ui.confirmId = null
        notify()
      }
      function kbCloseEditor() { ui.editor = null; notify() }
      function kbPatchEditor(patch) { if (ui.editor === null) return; ui.editor = Object.assign({}, ui.editor, patch); notify() }
      function kbPatchDraft(patch, edPatch) { if (ui.editor === null) return; ui.editor = Object.assign({}, ui.editor, { draft: Object.assign({}, ui.editor.draft, patch) }, edPatch || {}); notify() }

      function kbFieldError(d, f) {
        if (String(f.label).trim() === '') return 'Add a label so people know what to answer.'
        if (String(f.name).trim() === '') return 'Add a variable name (under More options).'
        if (!/^[a-z][a-z0-9_]*$/.test(String(f.name))) return 'The variable name must be snake_case and start with a letter.'
        if (d.kind === 'action' && f.name === 'message') return 'The name message is reserved for the message text.'
        if (d.fields.some((x) => x.id !== f.id && x.name === f.name)) return 'Another field already uses that variable name.'
        if (f.type === 'select' && kbOptList(f.options).length < 2) return 'Add at least two choices.'
        if (f.vis !== undefined && f.vis.on === true) {
          if (!f.vis.field || !d.fields.some((x) => x.id !== f.id && x.name === f.vis.field)) return 'Pick the field this one depends on.'
          if ((f.vis.op === 'eq' || f.vis.op === 'neq') && String(f.vis.value).trim() === '') return 'Add a value to compare with.'
        }
        return ''
      }
      function kbSlugTaken(d) {
        const s = kbCleanSlug(d.slug)
        return store.entries.some((x) => x.kind !== 'action' && nameOf(x) === s && idOf(x) !== d.id && !(d.id === '' && false))
      }
      function kbUniqueSlug(base) {
        let s = base
        let n = 2
        while (store.entries.some((x) => x.kind !== 'action' && nameOf(x) === s)) { s = base + '-' + String(n); n += 1 }
        return s
      }
      function kbProblem(ed) {
        const d = ed.draft
        if (String(d.title).trim() === '') return { msg: 'Give it a name to save', go: 'title' }
        if (d.kind === 'slash') {
          if (kbCleanSlug(d.slug) === '') return { msg: 'Choose what you will type after /', go: 'slug' }
          if (kbSlugTaken(d)) return { msg: '/' + kbCleanSlug(d.slug) + ' is already used', go: 'slug' }
        }
        if (String(d.template).trim() === '') return { msg: 'Write the prompt', go: 'tpl' }
        for (let i = 0; i < d.fields.length; i++) {
          const f = d.fields[i]
          if (String(f.label).trim() === '' && String(f.name).trim() === '') continue
          const err = kbFieldError(d, f)
          if (err !== '') return { msg: 'Finish the field "' + (String(f.label).trim() || String(f.name) || 'Untitled') + '"', go: f.id }
        }
        return { msg: '', go: '' }
      }

      async function kbSaveEditor() {
        const ed = ui.editor
        if (ed === null || ed === undefined) return
        if (kbProblem(ed).msg !== '') return
        const entry = kbFromDraft(ed.draft)
        if (entry.id === undefined || entry.id === '') delete entry.id
        kbPatchEditor({ saving: true, error: null })
        const out = await kbWrite({ entry: entry })
        if (out.ok !== true) { kbPatchEditor({ saving: false, error: String(out.error || 'refusé') }); return }
        const isNew = ed.mode === 'create'
        const isCmd = entry.kind !== 'action'
        ui.editor = null
        ui.palette = false
        const saved = store.entries.filter((x) => (isCmd ? nameOf(x) === entry.name : L(x.label) === entry.label))[0]
        kbRetenirEnvoi(saved !== undefined ? idOf(saved) : (entry.id !== undefined ? entry.id : (entry.slug || entry.name)), entry.delivery)
        ui.flashId = !isCmd && saved !== undefined ? idOf(saved) : null
        kbFlash(isCmd
          ? (isNew ? 'Created /' + entry.name + '. Try it below.' : 'Saved /' + entry.name)
          : (isNew ? entry.label + ' added under your messages' : 'Saved ' + entry.label), null)
        if (ui.flashId !== null) setTimeout(() => { ui.flashId = null; notify() }, 3600)
      }

      async function kbDeleteEntry(entry, quiet) {
        const backup = JSON.parse(JSON.stringify(entry))
        ui.confirmId = null
        ui.editor = null
        const out = await kbWrite({ delete: idOf(entry) })
        if (out.ok !== true) { kbPatchEditor({ error: String(out.error || 'suppression refusée') }); kbFlash('Delete failed: ' + String(out.error || ''), null); return }
        kbRetenirEnvoi(idOf(entry), 'insert')
        if (quiet !== true) kbFlash('Deleted ' + (L(entry.label) || nameOf(entry)), { entry: backup })
      }
      async function kbDuplicate(entry) {
        const copy = JSON.parse(JSON.stringify(entry))
        delete copy.id
        copy.label = (L(entry.label) || nameOf(entry)) + ' copy'
        if (entry.kind !== 'action') { copy.slug = kbUniqueSlug(kbCleanSlug(nameOf(entry)) + '-copy'); copy.name = copy.slug }
        const out = await kbWrite({ entry: copy })
        if (out.ok !== true) { kbFlash('Duplicate failed: ' + String(out.error || ''), null); return }
        const copie = store.entries.filter((x) => L(x.label) === L(copy.label))[0]
        if (entry.delivery === 'send' && copie !== undefined) kbRetenirEnvoi(idOf(copie), 'send')
        kbFlash('Duplicated ' + (L(entry.label) || nameOf(entry)), null)
      }
      async function kbUndoDelete() {
        const t = ui.toast
        if (t === null || t.undo === null) return
        ui.toast = null
        await kbWrite({ entry: t.undo.entry })
        kbFlash('Restored ' + (L(t.undo.entry.label) || nameOf(t.undo.entry)), null)
      }

      // ── Lancer une entrée depuis MA palette (hors menu natif) ─────────────
      // Le jeton `/sig` encore present dans le brouillon : si l'on lance la
      // commande depuis MA palette (l'utilisateur a tape le jeton puis a prefere
      // la palette), il doit disparaitre comme dans le menu natif — sinon le texte
      // part avec « /sig— Ada ». On ne retire qu'un jeton entier (suivi d'une fin
      // de brouillon ou d'un blanc), et l'insertion se fait a sa place.
      const kbRetirerJeton = (sid, entry) => {
        try {
          const shell = kbShell(sid)
          if (shell === null) return null
          const draft = String(shell.snapshot.draft || '')
          const jeton = '/' + nameOf(entry)
          const i = draft.indexOf(jeton)
          if (i < 0) return null
          const apres = draft.charAt(i + jeton.length)
          if (i + jeton.length < draft.length && apres.trim() !== '') return null
          const out = kbRemoveSpan(sid, { start: i, end: i + jeton.length })
          return out.ok === true ? out.at : null
        } catch (e) { return null }
      }
      const kbPickEntry = (sid, entry) => {
        ui.palette = false
        ui.confirmId = null
        const libre = kbRetirerJeton(sid, entry)
        if (runOf(entry) === 'form') {
          let at = libre === null ? 0 : libre
          if (libre === null) {
            try { const sh = kbShell(sid); const span = sh === null ? null : sh.caretSpan(); at = (span !== null && span !== undefined && typeof span.start === 'number') ? span.start : 0 } catch (e) { at = 0 }
          }
          setPending(sid, { entryId: idOf(entry), at: at, values: defaultsOf(entry, {}), message: '' })
          return
        }
        const text = render(entry.template, {}, {})
        if (text !== '') {
          const out = kbInsertAt(sid, text, libre)
          if (out.ok === true && entry.delivery === 'send') kbEnvoiApresInsertion(sid, text)
        }
        notify()
      }

      // ══════════════════════════════════════════════════════════════════════
      // 3. LE BOUTON « Commands » DU COMPOSEUR
      // ══════════════════════════════════════════════════════════════════════
      function KbCommandsChip(props) {
        const p = props !== null && props !== undefined ? props : {}
        const sid = p.sessionId !== undefined ? String(p.sessionId) : kbCurrentSession()
        kbTick()
        const dstate = React.useState('')
        const text = dstate[0]
        const setText = dstate[1]
        React.useEffect(() => {
          const el = document.querySelector('[data-composer-input]')
          if (el === null || el === undefined) return undefined
          const read = () => setText(String(el.textContent || ''))
          read()
          const obs = new MutationObserver(read)
          obs.observe(el, { subtree: true, characterData: true, childList: true })
          return () => obs.disconnect()
        }, [])
        const hasText = String(text).trim() !== ''
        return h('span', { className: 'kbsl-scope', style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
          h('button', {
            'data-kb-chip': '1', type: 'button',
            className: 'kbsl-cchip icon kbsl-tt l' + (ui.palette ? ' on' : ''),
            'data-tip': ui.palette ? 'Close the commands palette' : 'Slash commands & actions — browse, run, edit or create',
            'aria-label': 'Commands: browse, run, edit or create slash commands and actions',
            onClick: (ev) => { ev.preventDefault(); ui.palette = !ui.palette; ui.palIdx = 0; ui.palQuery = ''; ui.confirmId = null; if (ui.editor !== null) ui.editor = null; notify() },
          }, h(KbIcon, { name: 'slash', size: 14, weight: 2.4 })),
          hasText ? h('button', {
            type: 'button', className: 'kbsl-cchip icon kbsl-anim kbsl-tt l',
            'data-tip': 'Save what you typed as a reusable command',
            'aria-label': 'Save as command',
            onClick: () => kbOpenEditor('create', 'slash', null, { template: text }),
          }, h(KbIcon, { name: 'bookmark', size: 14, weight: 2 })) : null)
      }

      // ══════════════════════════════════════════════════════════════════════
      // 4. LA PALETTE ET LA FICHE DE PARAMÈTRES — au-dessus du composeur
      // ══════════════════════════════════════════════════════════════════════
      function KbComposerDock(props) {
        const p = props !== null && props !== undefined ? props : {}
        const sid = p.sessionId !== undefined ? String(p.sessionId) : kbCurrentSession()
        kbTick()
        const pend = pendingOf(sid)
        const entry = pend === null ? undefined : entryOf(pend.entryId)
        const sheet = (pend !== null && entry !== undefined && entry !== null) ? h(KbRunSheet, { key: 'sheet', sid: sid, pend: pend, entry: entry }) : null
        const pal = ui.palette ? h(KbPalette, { key: 'pal', sid: sid }) : null
        // Une seule surface a la fois : superposees, elles montaient plus haut que
        // l ecran et la palette devenait inatteignable. La palette ouverte par
        // l utilisateur passe devant ; le formulaire en attente revient des qu elle
        // se referme (son etat n est jamais perdu).
        //
        // L ancrage est au-dessus du composeur : la hauteur utile est donc la
        // distance entre le haut du composeur et le haut de la fenetre, pas la
        // hauteur de la fenetre. On la mesure et on la pose en variable CSS, sinon
        // une longue liste sort de l ecran par le haut.
        const max = React.useState(0)
        const hauteurUtile = max[0]
        const setHauteurUtile = max[1]
        React.useEffect(() => {
          // etat.valeur : derniere hauteur posee. etat.reduit : une correction a
          // deja ete appliquee pour ce panneau. Sans ce verrou, la mesure
          // suivante relit un panneau deja corrige (plus recouvert), conclut
          // « rien ne recouvre » et le fait regrossir : oscillation.
          const etat = { valeur: 0, reduit: false }
          const mesurer = (neuf) => {
            const el = document.querySelector('[data-composer-input]')
            if (el === null || el === undefined) return
            // La fenetre s arrete au composeur : c est la premiere borne.
            let cible = Math.max(200, Math.round(el.getBoundingClientRect().top - 24))
            // La barre de titre de l application se peint AU-DESSUS de la
            // surcouche du composeur (contexte d empilement impose). On sonde ce
            // qui recouvre le haut de notre panneau et on retire exactement le
            // recouvrement : l en-tete reste visible, la liste defile.
            let reduitIci = false
            const pop = document.querySelector('.kbsl-dock .kbsl-pop')
            if (pop !== null) {
              const r = pop.getBoundingClientRect()
              if (r.height > 1) {
                const x = Math.round(Math.max(0, Math.min(window.innerWidth - 1, r.left + r.width / 2)))
                const haut = Math.round(Math.max(0, r.top + 2))
                const dessus = document.elementFromPoint(x, haut)
                if (dessus !== null && dessus !== undefined && dessus.closest('.kbsl-scope') === null) {
                  const rogne = Math.ceil(dessus.getBoundingClientRect().bottom - r.top)
                  if (rogne > 0) { cible = Math.max(180, Math.round(r.height - rogne)); etat.reduit = true; reduitIci = true }
                }
              }
            }
            // On ne regrossit jamais apres une correction (sauf mesure neuve) ;
            // mais la correction elle-meme doit s appliquer : d ou reduitIci.
            if (etat.reduit && reduitIci !== true && cible > etat.valeur && neuf !== true) return
            etat.valeur = cible
            diag.dockMax = cible
            setHauteurUtile(cible)
          }
          mesurer(false)
          const onResize = () => { etat.reduit = false; etat.valeur = 0; mesurer(true) }
          window.addEventListener('resize', onResize)
          const t = setTimeout(() => mesurer(false), 400)
          return () => { window.removeEventListener('resize', onResize); clearTimeout(t) }
        }, [ui.palette, pend === null])
        const style = hauteurUtile > 0 ? { '--kb-dock-max': String(hauteurUtile) + 'px' } : null
        if (pal !== null) return h('div', { className: 'kbsl-scope kbsl-dock', style: style }, pal)
        if (sheet === null) return null
        return h('div', { className: 'kbsl-scope kbsl-dock', style: style }, sheet)
      }

      // Les lignes que la palette montre. Une seule définition, pour que le
      // clavier (flèches, Entrée, filtre) et l'affichage ne puissent pas diverger.
      // Le filtre saisi s'applique par préfixe, sur le nom court comme sur le
      // libellé — la même règle que le menu natif de l'application.
      const kbPaletteRows = () => {
        const tous = listOf('slash').filter((e) => e.active !== false)
        const q = String(ui.palQuery || '').trim().toLowerCase()
        if (q === '') return tous
        return tous.filter((e) => nameOf(e).toLowerCase().indexOf(q) === 0 || (L(e.label) || '').toLowerCase().indexOf(q) === 0)
      }
      const kbPaletteTotal = () => listOf('slash').filter((e) => e.active !== false).length

      function KbPalette(props) {
        const sid = props.sid
        const rows = kbPaletteRows()
        const choisi = ui.palIdx >= 0 && ui.palIdx < rows.length ? idOf(rows[ui.palIdx]) : null
        // La ligne mise en avant suit le clavier : on la garde dans la vue.
        React.useEffect(() => {
          const el = document.querySelector('[data-kb-palette] [data-kb-sel="1"]')
          if (el !== null && el !== undefined && typeof el.scrollIntoView === 'function') {
            try { el.scrollIntoView({ block: 'nearest' }) } catch (e) { /* navigateur */ }
          }
        }, [choisi])
        const total = kbPaletteTotal()
        const q = String(ui.palQuery || '')
        return h('div', {
          className: 'kbsl-pop kbsl-anim', 'data-kb-palette': '1', 'data-kb-query': q,
          role: 'dialog', 'aria-label': 'Slash commands',
          'aria-activedescendant': choisi === null ? undefined : 'kb-row-' + choisi,
        },
          h('div', { className: 'kbsl-phead' },
            h('span', { className: 'kbsl-pop-h' }, 'Slash commands'),
            q === ''
              ? h('span', { className: 'kbsl-help' }, String(rows.length) + (rows.length === 1 ? ' command' : ' commands'))
              : h('span', { className: 'kbsl-query' },
                h('span', null, 'Filter « ' + q + ' »'),
                h('span', { className: 'kbsl-help' }, String(rows.length) + ' / ' + String(total)))),
          h('div', { className: 'kbsl-rows', id: 'kb-rows', role: 'listbox', 'aria-label': 'Commands' },
            rows.length === 0
              ? h('span', { className: 'kbsl-help', style: { padding: '10px 12px' } }, q === '' ? 'No command yet. Create one below.' : 'No command starts with « ' + q + ' ».')
              : rows.map((e) => h(KbPaletteRow, { key: idOf(e), sid: sid, entry: e, sel: idOf(e) === choisi }))),
          h('button', {
            type: 'button', className: 'kbsl-prow new',
            onClick: () => kbOpenEditor('create', 'slash', null, {}),
          }, h(KbIcon, { name: 'plus', size: 16, weight: 2.2 }), h('span', null, 'New slash command')),
          h('button', {
            type: 'button', className: 'kbsl-prow ai',
            onClick: () => kbStartWithAI(''),
          }, h(KbIcon, { name: 'sparkles', size: 16, weight: 2 }),
            h('span', null, 'Create with AI'),
            h('span', { className: 'kbsl-chip', style: { marginLeft: 'auto' } }, 'opens a new chat')),
          h('div', { className: 'kbsl-pop-f' }, 'Arrow keys to move · Enter to run · Esc to close'))
      }

      function KbPaletteRow(props) {
        const e = props.entry
        const sid = props.sid
        const id = idOf(e)
        const sel = props.sel === true
        const title = L(e.label) || nameOf(e)
        if (ui.confirmId === id) {
          return h('div', { className: 'kbsl-pwrap' + (sel ? ' sel' : ' on'), 'data-kb-palette-row': id, 'data-kb-sel': sel ? '1' : '0' },
            h('span', { style: { flex: '1', minWidth: 0, padding: '8px 8px 8px 10px', fontSize: 'var(--kb-fs-13,13px)' } },
              'Delete ', h('strong', null, title), '? You can undo right after.'),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-ghost sm', onClick: () => { ui.confirmId = null; notify() } }, 'Keep'),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-danger sm', onClick: () => kbDeleteEntry(e) }, 'Delete'))
        }
        return h('div', {
          className: 'kbsl-pwrap' + (sel ? ' sel' : ''), 'data-kb-palette-row': id,
          id: 'kb-row-' + id, role: 'option', 'aria-selected': sel === true, 'data-kb-sel': sel ? '1' : '0',
        },
          h('button', { type: 'button', className: 'kbsl-pmain', onClick: () => kbPickEntry(sid, e) },
            h('span', { className: 'kbsl-tile' }, h(KbIcon, { name: e.icon || 'terminal', size: 15 })),
            h('span', { className: 'pslug' }, '/' + nameOf(e)),
            h('span', { className: 'ptitle kbsl-clip' }, title),
            h('span', { className: 'pdesc kbsl-clip' }, L(e.description)),
            h('span', { className: 'kbsl-chip kbsl-tt lf', 'data-tip': runOf(e) === 'form' ? 'Asks ' + String((e.fields || []).length) + ' question(s) in a form before running' : 'Runs straight away, no form' }, runOf(e) === 'form' ? String((e.fields || []).length) + ' fields' : 'instant')),
          h('div', { className: 'kbsl-pact' },
            h('button', { type: 'button', 'data-kb-edit': id, className: 'kbsl-ibtn sm kbsl-tt lf', 'data-tip': 'Edit', 'aria-label': 'Edit ' + title, onClick: () => kbOpenEditor('edit', 'slash', e) }, h(KbIcon, { name: 'square-pen', size: 15 })),
            h('button', { type: 'button', className: 'kbsl-ibtn sm kbsl-tt lf', 'data-tip': 'Duplicate', 'aria-label': 'Duplicate ' + title, onClick: () => kbDuplicate(e) }, h(KbIcon, { name: 'copy', size: 15 })),
            h('button', { type: 'button', className: 'kbsl-ibtn sm danger kbsl-tt lf', 'data-tip': 'Delete', 'aria-label': 'Delete ' + title, onClick: () => { ui.confirmId = id; notify() } }, h(KbIcon, { name: 'trash', size: 15 }))))
      }

      function KbRunSheet(props) {
        const sid = props.sid
        const entry = props.entry
        const pend = props.pend
        const vstate = React.useState({})
        const values = vstate[0]
        const setValues = vstate[1]
        const est = React.useState(null)
        const error = est[0]
        const setError = est[1]
        const key = sid + '|' + idOf(entry) + '|' + String(pend.at)
        React.useEffect(() => { setValues(defaultsOf(entry, {})); setError(null) }, [key])
        const verdict = validate(entry, values)
        const shown = visibleFields(entry, values)
        const preview = render(entry.template, effectiveValues(entry, values), { message: pend.message || '' })
        const setField = (k, v) => setValues((old) => Object.assign({}, old, { [k]: v }))
        const submit = () => {
          const out = kbSubmitForm(sid, pend, entry, values)
          if (out.ok !== true) setError(out.error ? String(out.error) : 'Required field')
        }
        const title = L(entry.label) || nameOf(entry)
        const fields = shown.map((f) => {
          const bad = verdict.ok === false && verdict.invalid.indexOf(f.key) >= 0
          const value = values[f.key]
          let control
          if (f.type === 'select') {
            const opts = (f.options || []).map((o) => {
              if (o !== null && typeof o === 'object') return { v: (o.value !== undefined ? o.value : o.v), label: L(o.label) || String(o.value !== undefined ? o.value : o.v) }
              return { v: o, label: String(o) }
            })
            control = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
              opts.map((o) => h('button', {
                key: String(o.v), type: 'button', className: 'kbsl-pill' + (String(value) === String(o.v) ? ' on' : ''),
                'aria-pressed': String(value) === String(o.v), onClick: () => setField(f.key, o.v),
              }, o.label)))
          } else if (f.type === 'checkbox') {
            // Le magasin peut porter le défaut en booléen (ce que l'éditeur écrit)
            // ou en chaîne (entrée écrite à la main ou par le skill) : les deux
            // doivent allumer l'interrupteur, sinon la fiche annonce « No » pour
            // un champ dont le défaut est vrai.
            const on = value === true || String(value === undefined || value === null ? '' : value).trim() === 'true'
            control = h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
              h('button', { type: 'button', className: 'kbsl-tgl' + (on ? ' on' : ''), role: 'switch', 'aria-checked': on, 'aria-label': L(f.label) || f.key, onClick: () => setField(f.key, !on) }),
              h('span', { className: 'kbsl-help' }, on ? 'Yes' : 'No'))
          } else if (f.type === 'textarea') {
            control = h('textarea', { className: 'kbsl-field sm' + (bad ? ' bad' : ''), rows: 3, 'aria-label': L(f.label) || f.key, value: value === undefined ? '' : String(value), onChange: (ev) => setField(f.key, ev.target.value) })
          } else {
            control = h('input', {
              className: 'kbsl-field sm' + (bad ? ' bad' : ''), 'aria-label': L(f.label) || f.key,
              type: f.type === 'number' ? 'number' : (f.type === 'date' ? 'date' : 'text'),
              value: value === undefined ? '' : String(value),
              onChange: (ev) => setField(f.key, f.type === 'number' ? (ev.target.value === '' ? '' : Number(ev.target.value)) : ev.target.value),
            })
          }
          return h('div', { key: f.key, className: 'kbsl-anim', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { className: 'kbsl-lblsm' }, L(f.label) || f.key, isRequired(f, values) === true ? h('b', { className: 'kbsl-err' }, ' *') : null),
            control,
            bad ? h('span', { className: 'kbsl-err' }, 'Required field') : null)
        })
        return h('div', { className: 'kbsl-pop kbsl-anim', 'data-kb-sheet': nameOf(entry), role: 'dialog', 'aria-label': title,
          // La hauteur est bornee par ce que la place au-dessus du composeur
          // autorise (--kb-dock-max, mesure) : sinon la fiche depassait en haut
          // de l ecran et perdait son titre.
          style: { display: 'flex', flexDirection: 'column', maxHeight: 'min(380px, var(--kb-dock-max, 380px))' } },
          h('div', { className: 'kbsl-shead' },
            h('span', { className: 'kbsl-tile sm' }, h(KbIcon, { name: entry.icon || 'terminal', size: 15 })),
            h('span', { style: { flex: '1', minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px' } },
              h('span', { style: { fontSize: 'var(--kb-fs-14,14px)', fontWeight: 700 } }, title),
              entry.kind === 'action' ? null : h('span', { className: 'kbsl-chip cmd' }, '/' + nameOf(entry))),
            h('button', { type: 'button', className: 'kbsl-ibtn sm kbsl-tt lf', 'data-kb-edit': idOf(entry), 'data-tip': 'Edit this ' + (entry.kind === 'action' ? 'action' : 'command'), 'aria-label': 'Edit ' + title, onClick: () => kbOpenEditor('edit', entry.kind === 'action' ? 'action' : 'slash', entry) }, h(KbIcon, { name: 'square-pen', size: 15 })),
            h('button', { type: 'button', className: 'kbsl-ibtn sm', 'aria-label': 'Close', onClick: () => setPending(sid, null) }, h(KbIcon, { name: 'x', size: 16, weight: 2 }))),
          h('div', { className: 'kbsl-sbody' },
            pend.message !== '' && pend.message !== undefined ? h('div', { className: 'kbsl-quote' }, h('strong', { style: { color: 'var(--kb-ink2)' } }, 'Message'), ' · ', String(pend.message)) : null,
            fields.length === 0 ? h('span', { className: 'kbsl-help' }, 'This one has no question: it runs as is.') : h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } }, fields),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('span', { className: 'kbsl-lblsm' }, 'Result'),
              h('div', { className: 'kbsl-result kbsl-mono' }, preview || '—'))),
          h('div', { className: 'kbsl-sfoot' },
            error !== null ? h('span', { className: 'kbsl-err', style: { flex: 1 } }, String(error)) : h('span', { style: { flex: 1 } }),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-ghost sm', onClick: () => setPending(sid, null) }, 'Cancel'),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-primary sm', onClick: submit }, entry.delivery === 'send' ? 'Send' : 'Insert')))
      }

      // ══════════════════════════════════════════════════════════════════════
      // 5. L'ÉDITEUR — la fenêtre en quatre étapes, et le toast
      // ══════════════════════════════════════════════════════════════════════
      const kbSampleFor = (f) => {
        if (f.type === 'toggle') return f.def === 'true' ? 'Yes' : 'No'
        if (f.type === 'select') { const l = kbOptList(f.options); return String(f.def || l[0] || '') }
        if (f.type === 'number') return String(f.def === '' || f.def === undefined ? '3' : f.def)
        if (f.type === 'date') return '2026-02-14'
        if (f.type === 'long') return String(f.def || 'const total = items.reduce((a, b) => a + b.price, 0);')
        return String(f.def || 'a sample answer')
      }
      const kbPreviewText = (d) => {
        const values = {}
        d.fields.forEach((f) => { if (f.name) values[f.name] = kbSampleFor(f) })
        values.message = 'the message above'
        return render(kbToBraces(d.template), values, { message: values.message }).replace(/[ \t]+$/gm, '').trim()
      }
      const kbPatchField = (id, patch) => {
        if (ui.editor === null) return
        ui.editor = Object.assign({}, ui.editor, {
          draft: Object.assign({}, ui.editor.draft, {
            fields: ui.editor.draft.fields.map((f) => (f.id === id ? Object.assign({}, f, patch) : f)),
          }),
        })
        notify()
      }
      const kbPatchVis = (id, patch) => {
        if (ui.editor === null) return
        ui.editor = Object.assign({}, ui.editor, {
          draft: Object.assign({}, ui.editor.draft, {
            fields: ui.editor.draft.fields.map((f) => (f.id === id ? Object.assign({}, f, { vis: Object.assign({}, f.vis, patch) }) : f)),
          }),
        })
        notify()
      }
      const kbAddField = (nom) => {
        if (ui.editor === null) return
        const champs = ui.editor.draft.fields
        // Appelee depuis un blanc du prompt ({periode}) : la question doit porter
        // CE nom, sinon elle ne remplit pas le blanc et n a aucune raison d etre.
        const demande = nom === undefined ? '' : String(nom)
        const libre = /^[a-z][a-z0-9_]*$/.test(demande) && champs.filter((x) => x.name === demande).length === 0
        const f = kbNewField(champs.length + 1, libre ? demande : undefined)
        ui.editor = Object.assign({}, ui.editor, {
          draft: Object.assign({}, ui.editor.draft, { fields: ui.editor.draft.fields.concat([f]) }),
          openField: f.id, step: 2,
        })
        notify()
      }
      const kbRemoveField = (id) => {
        if (ui.editor === null) return
        ui.editor = Object.assign({}, ui.editor, {
          draft: Object.assign({}, ui.editor.draft, { fields: ui.editor.draft.fields.filter((f) => f.id !== id) }),
          openField: null,
        })
        notify()
      }
      const kbMoveField = (from, to) => {
        if (ui.editor === null || from === to) return
        const list = ui.editor.draft.fields.slice()
        if (from < 0 || from >= list.length || to < 0 || to >= list.length) return
        const moved = list.splice(from, 1)[0]
        list.splice(to, 0, moved)
        ui.editor = Object.assign({}, ui.editor, { draft: Object.assign({}, ui.editor.draft, { fields: list }), drag: null, over: null })
        notify()
      }
      const kbInsertVar = (name) => {
        if (ui.editor === null) return
        const t = String(ui.editor.draft.template || '')
        if (kbVarsOf(t).indexOf(name) >= 0) return
        const sep = t === '' || /\s$/.test(t) ? '' : ' '
        kbPatchDraft({ template: t + sep + '{' + name + '}' })
      }

      function KbEditor() {
        kbTick()
        const ed = ui.editor
        if (ed === null || ed === undefined) return null
        const d = ed.draft
        const isAction = d.kind === 'action'
        const vars = kbVarsOf(d.template)
        const names = d.fields.map((f) => f.name).filter((n) => n !== '')
        const missing = vars.filter((v) => v !== 'message' && names.indexOf(v) < 0)
        const unused = names.filter((n) => vars.indexOf(n) < 0)
        const problem = kbProblem(ed)
        const finalText = kbPreviewText(d)
        const heading = ed.mode === 'create'
          ? (isAction ? 'New message action' : 'New slash command')
          : (isAction ? 'Edit message action' : 'Edit slash command')
        const s1Done = String(d.title).trim() !== ''
        const s2Done = String(d.template).trim() !== ''
        const s3Done = d.fields.length > 0

        const stepN = (n, done, optional) => h('span', { className: 'kbsl-stepn' + (done ? ' done' : (optional ? ' opt' : '')) },
          done ? h(KbIcon, { name: 'check', size: 15, weight: 3 }) : String(n))

        // ── étape 1 : nommer ────────────────────────────────────────────────
        const iconPicker = ed.iconOpen ? h('div', { className: 'kbsl-icoquery kbsl-anim', style: { position: 'absolute', top: '72px', left: 0, zIndex: 8 } },
          h('div', { style: { position: 'relative' } },
            h('span', { style: { position: 'absolute', left: '12px', top: '11px', display: 'inline-flex', color: 'var(--kb-muted)' } }, h(KbIcon, { name: 'search', size: 18, weight: 2 })),
            h('input', {
              className: 'kbsl-field sm', style: { paddingLeft: '38px' }, 'aria-label': 'Search icons',
              placeholder: 'Search icons, e.g. mail, translate, code', value: ed.iconQuery,
              onChange: (ev) => kbPatchEditor({ iconQuery: ev.target.value }),
            })),
          h('span', { className: 'kbsl-help', style: { padding: '0 2px' } }, 'Pick the picture that will show up next to your command.'),
          h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '4px' } },
            kbIconSearch(ed.iconQuery).map((n) => h('button', {
              key: n, type: 'button', className: 'kbsl-icopick' + (n === d.icon ? ' on' : ''), 'aria-label': n,
              // L'icone appartient au BROUILLON : kbPatchEditor ne touche que
              // l'etat de l'editeur, la passer la ne changeait rien a l'entree.
              onClick: () => kbPatchDraft({ icon: n }, { iconOpen: false }),
            }, h(KbIcon, { name: n, size: 18 }))))) : null

        const nameInput = h('input', {
          className: 'kbsl-field lg kbsl-idname',
          'aria-label': 'Name', placeholder: isAction ? 'e.g. Explain simply' : 'e.g. Code Refactor', value: d.title,
          onChange: (ev) => {
            const t = ev.target.value
            const patch = { title: t }
            if (ed.mode === 'create' && !isAction && String(d.slug).trim() === '') patch.slug = kbSlugify(t)
            kbPatchDraft(patch)
          },
        })

        const slugBox = isAction ? null : h('label', { className: 'kbsl-slugbox kbsl-idslug', title: 'What you type to run it' },
          h('span', { className: 'kbsl-mono', style: { fontSize: '13px', color: 'var(--kb-accent)' } }, '/'),
          h('input', { className: 'kbsl-slugin', 'aria-label': 'Slash name', placeholder: 'shortcut', value: d.slug, onChange: (ev) => kbPatchDraft({ slug: kbCleanSlug(ev.target.value) }) }))

        const descInput = h('input', {
          className: 'kbsl-field kbsl-iddesc', 'aria-label': 'Description', placeholder: 'One line shown in the palette (optional)',
          value: d.desc, onChange: (ev) => kbPatchDraft({ desc: ev.target.value }),
        })

        const placementPicker = isAction ? h('div', { className: 'kbsl-iddesc', style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('span', { className: 'kbsl-lblsm' }, 'Where should the button appear?'),
          h('span', { className: 'kbsl-help' }, 'Under your assistant messages.'),
          h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
            ['toolbar', 'menu'].map((pl) => h('button', {
              key: pl, type: 'button', className: 'kbsl-pill' + (d.placement === pl ? ' on' : ''),
              'aria-pressed': d.placement === pl, onClick: () => kbPatchDraft({ placement: pl }),
            }, pl === 'toolbar' ? 'In the action bar' : 'In the ⋯ menu')))) : null

        const step1 = h('section', { className: 'kbsl-step' }, stepN(1, s1Done, false),
          h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('h3', { className: 'kbsl-steph' }, 'Name it'),
              h('span', { className: 'kbsl-help' }, isAction
                ? 'Pick an icon and the label of the button that will appear under messages.'
                : 'Pick an icon and a name people will recognise. The word after / is what you type to run it.')),
            h('div', { className: 'kbsl-idrow' },
              h('div', { style: { position: 'relative', flex: 'none' } },
                h('button', {
                  type: 'button', className: 'kbsl-tile lg kbsl-tt b l', 'data-tip': 'Change the icon', 'aria-label': 'Change icon',
                  'aria-expanded': ed.iconOpen, onClick: () => kbPatchEditor({ iconOpen: !ed.iconOpen }),
                }, h(KbIcon, { name: d.icon, size: 22, weight: 1.8 })),
                iconPicker),
              h('div', { style: { display: 'contents' } },
                nameInput, slugBox, descInput, placementPicker))))

        // ── étape 2 : le prompt ─────────────────────────────────────────────
        const step2 = h('section', { className: 'kbsl-step' }, stepN(2, s2Done, false),
          h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
                h('h3', { className: 'kbsl-steph' }, 'Write the prompt'),
                h('span', { className: 'kbsl-info kbsl-tt b l', tabIndex: 0, 'aria-label': 'About the prompt',
                  'data-tip': 'This is the text sent to the AI when you run it. Anything in curly braces is a blank that gets filled in first.' }, h(KbIcon, { name: 'info', size: 14 }))),
              h('span', { className: 'kbsl-help' }, isAction
                ? 'This is what gets sent to the AI. Use {message} to include the text of the message you click on.'
                : 'This is what gets sent to the AI. Leave blanks for the form to fill, like the language to translate into.')),
            h('textarea', {
              className: 'kbsl-field', rows: 6, 'data-kb-template': '1', 'aria-label': 'Prompt',
              placeholder: isAction ? 'Explain this more simply:\n\n{message}' : 'Refactor the following code, focus on {focus}:\n\n{code}',
              value: d.template, onChange: (ev) => kbPatchDraft({ template: ev.target.value }),
            }),
            (vars.length > 0 || unused.length > 0) ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
              h('span', { className: 'kbsl-lblsm' }, 'Click to drop into the prompt:'),
              h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                vars.map((v) => {
                  const field = d.fields.filter((f) => f.name === v)[0]
                  const isMessage = v === 'message'
                  const cls = isMessage || field !== undefined ? ' ok' : ' missing'
                  return h('button', {
                    key: 'v' + v, type: 'button', className: 'kbsl-vchip' + cls,
                    onClick: () => { if (!isMessage && field === undefined) kbAddField(v); if (field !== undefined) kbPatchEditor({ openField: field.id, step: 2 }) },
                    title: isMessage ? 'Filled with the message you clicked' : (field !== undefined ? 'Answered by "' + field.label + '"' : 'No question asks for this yet — click to add one'),
                  }, '{' + v + '}', isMessage ? null : h(KbIcon, { name: field !== undefined ? 'check' : 'plus', size: 13, weight: 2.4 }))
                }),
                unused.map((n) => {
                  const field = d.fields.filter((f) => f.name === n)[0]
                  return h('button', {
                    key: 'u' + n, type: 'button', className: 'kbsl-vchip unused',
                    onClick: () => kbInsertVar(n), title: 'Click to drop it in.',
                  }, '{' + n + '}', h(KbIcon, { name: 'plus', size: 13, weight: 2.4 }))
                }))) : h('span', { className: 'kbsl-help' }, 'Fields you add in step 3 will show up here.')))

        // ── étape 3 : les questions ────────────────────────────────────────
        const step3 = h('section', { className: 'kbsl-step' }, stepN(3, s3Done, true),
          h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
                h('h3', { className: 'kbsl-steph' }, 'Ask something first'),
                h('span', { className: 'kbsl-opt kbsl-tt b', 'data-tip': 'You can save without adding any question' }, 'Optional'),
                h('span', { className: 'kbsl-info kbsl-tt b l', tabIndex: 0, 'aria-label': 'About the questions',
                  'data-tip': 'A small form shown before it runs, for example a language or a tone. Skip it and the prompt runs instantly.' }, h(KbIcon, { name: 'info', size: 14 }))),
              h('span', { className: 'kbsl-help' }, isAction
                ? 'Each field becomes a question in the form.'
                : 'Each field becomes a question in the form. Drag the grip on the left to reorder them.')),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
              d.fields.map((f, i) => h(KbFieldCard, { key: f.id, d: d, f: f, index: i, count: d.fields.length, ed: ed }))),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-dashed sm', style: { alignSelf: 'flex-start' }, onClick: kbAddField },
              h(KbIcon, { name: 'plus', size: 16, weight: 2.2 }), 'Add a question')))

        // ── étape 4 : la suite ─────────────────────────────────────────────
        const step4 = h('section', { className: 'kbsl-step' }, stepN(4, false, false),
          h('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '14px' } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('h3', { className: 'kbsl-steph' }, 'Then what?'),
              h('span', { className: 'kbsl-help' }, 'What happens once the answers are in.')),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
              ['insert', 'send'].map((m) => h('button', {
                key: m, type: 'button', className: 'kbsl-pill' + (d.delivery === m ? ' on' : ''), 'aria-pressed': d.delivery === m,
                onClick: () => kbPatchDraft({ delivery: m }),
              }, m === 'insert' ? 'Insert it in my message' : 'Send it right away'))),
            h('span', { className: 'kbsl-help' }, d.delivery === 'send'
              ? 'The message is sent for you — nothing to click.'
              : 'The text lands in the composer, at your cursor, so you can edit it first.')))

        // ── colonne de droite : l'aperçu ───────────────────────────────────
        const demoFields = d.fields.slice(0, 3).map((f, i) => h('div', { key: f.id, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('span', { style: { fontSize: '11.5px', fontWeight: 600, color: 'var(--kb-ink2)' } }, f.label || 'Untitled'),
          f.type === 'select'
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px' } },
                kbOptList(f.options).slice(0, 3).map((o, k) => h('span', { key: o + String(k), className: 'kbsl-pill', style: { height: '26px', fontSize: '12px' } }, o)))
            : f.type === 'toggle'
              ? h('span', { className: 'kbsl-tgl' + (f.def === 'true' ? ' on' : ''), style: { display: 'block', transform: 'scale(.8)', transformOrigin: 'left center' } })
              : h('div', { style: { minHeight: '34px', padding: '7px 10px', border: '1px solid var(--kb-line)', borderRadius: '9px', background: 'var(--kb-surface2)', fontSize: '12.5px' } }, kbSampleFor(f))))
        const aside = h('aside', { className: 'kbsl-easide' },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' } },
            h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '10px' } },
              h('span', { className: 'kbsl-sec' }, 'See it in action'),
              h('span', { className: 'kbsl-chip kbsl-live' }, h('i', null), 'Live'))),
          h('span', { className: 'kbsl-help' }, 'Exactly what people will see. It follows your edits as you make them.'),
          h('div', { className: 'kbsl-demo' },
            h('div', { className: 'kbsl-demo-stage' },
              h('div', { className: 'kbsl-pop', style: { padding: '4px', display: 'flex', flexDirection: 'column', gap: '2px' } },
                h('div', { className: 'kbsl-pwrap on' },
                  h('span', { className: 'kbsl-tile xs' }, h(KbIcon, { name: d.icon, size: 15 })),
                  h('span', { style: { flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: '8px' } },
                    h('span', { className: 'kbsl-mono', style: { fontSize: '12px', color: 'var(--kb-accent)' } }, isAction ? '' : '/' + (kbCleanSlug(d.slug) || '…')),
                    h('span', { className: 'kbsl-clip', style: { fontSize: '12.5px', fontWeight: 600 } }, d.title || 'Untitled')))),
              d.fields.length > 0 ? h('div', { className: 'kbsl-pop', style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, h(KbIcon, { name: d.icon, size: 16 }), h('span', { style: { fontSize: '13px', fontWeight: 700 } }, d.title || 'Untitled')),
                demoFields) : null,
              h('div', { style: { minHeight: '50px', padding: '10px 12px', border: '1px solid var(--kb-line)', borderRadius: '14px', background: 'var(--kb-surface)', fontSize: '12.5px', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } },
                finalText === '' ? h('span', { style: { color: 'var(--kb-muted)' } }, 'Message or run a task, / commands') : finalText)),
          h('div', { className: 'kbsl-pvcard' },
            h('span', { className: 'kbsl-pvlabel' }, 'What gets sent'),
            h('div', { className: 'kbsl-result kbsl-mono' }, finalText || '—'),
            h('span', { className: 'kbsl-help' }, 'Filled with sample values, so you can check the wording.'))))

        return h('div', { className: 'kbsl-scope kbsl-backdrop', 'data-kb-editor': '1', onMouseDown: (ev) => { if (ev.target === ev.currentTarget) kbCloseEditor() } },
          h('div', { className: 'kbsl-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': heading },
            h('div', { className: 'kbsl-ehead' },
              h('span', { style: { display: 'inline-flex', flex: 'none', color: 'var(--kb-accent)' } }, h(KbIcon, { name: isAction ? 'sparkles' : 'terminal', size: 18, weight: 2 })),
              h('h2', { className: 'kbsl-eh' }, heading),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                ed.mode === 'create' ? h('div', { className: 'kbsl-seg', role: 'group', 'aria-label': 'Type' },
                  [['slash', 'Slash command'], ['action', 'Message action']].map((k) => h('button', {
                    key: k[0], type: 'button', className: 'kbsl-pill' + (d.kind === k[0] ? ' on' : ''),
                    // Changer de genre ne doit rien oublier du travail deja fait :
                    // on repart d un brouillon vierge du nouveau genre, on le
                    // recouvre de TOUT ce qui est saisi, puis on force le genre.
                    'aria-pressed': d.kind === k[0], onClick: () => kbPatchDraft(Object.assign({}, kbBlankDraft(k[0]), d, { kind: k[0] })),
                  }, k[1]))) : null,
                h('button', { type: 'button', className: 'kbsl-aibtn kbsl-tt b r', 'data-tip': 'Opens a new chat where a skill helps you build it.', onClick: () => { kbCloseEditor(); kbStartWithAI('') } },
                  h(KbIcon, { name: 'sparkles', size: 16, weight: 2 }), 'Create with AI'),
                h('button', { type: 'button', className: 'kbsl-ibtn kbsl-tt b r', 'data-tip': 'Close (Esc)', 'aria-label': 'Close', onClick: kbCloseEditor }, h(KbIcon, { name: 'x', size: 20, weight: 2 })))),
            h('div', { className: 'kbsl-ebody' },
              h('div', { className: 'kbsl-esteps' }, step1, step2, step3, step4),
              aside),
            h('div', { className: 'kbsl-efoot' },
              ed.mode === 'edit' ? h('button', { type: 'button', className: 'kbsl-btn kbsl-ghost', style: { color: 'var(--kb-danger)' }, onClick: () => kbPatchEditor({ confirmDel: true }) }, h(KbIcon, { name: 'trash', size: 16 }), 'Delete') : null,
              ed.confirmDel ? h('span', { style: { flex: 1, fontSize: '14px' } }, 'Delete ', h('strong', null, d.title || 'this'), ' for good?') : (problem.msg !== '' ? h('button', { type: 'button', className: 'kbsl-link', style: { flex: 1 }, onClick: () => kbPatchEditor({ step: problem.go === 'tpl' ? 1 : (problem.go === 'title' || problem.go === 'slug' ? 0 : 2), openField: problem.go.indexOf('f') === 0 ? problem.go : null }) }, problem.msg, ' →') : h('span', { style: { flex: 1 } })),
              ed.confirmDel ? h('button', { type: 'button', className: 'kbsl-btn kbsl-ghost', onClick: () => kbPatchEditor({ confirmDel: false }) }, 'Keep it') : null,
              ed.confirmDel ? h('button', { type: 'button', className: 'kbsl-btn kbsl-danger', onClick: () => kbDeleteEntry(entryOf(d.id) || { id: d.id, label: d.title, kind: d.kind, template: d.template, fields: [] }) }, 'Delete') : null,
              ed.confirmDel ? null : h('button', { type: 'button', className: 'kbsl-btn kbsl-ghost kbsl-tt b', 'data-tip': 'Discard your changes (Esc)', onClick: kbCloseEditor }, 'Cancel'),
              ed.confirmDel ? null : h('button', { type: 'button', className: 'kbsl-btn kbsl-primary', disabled: problem.msg !== '' || ed.saving === true, onClick: kbSaveEditor },
                ed.saving === true ? 'Saving…' : h(React.Fragment, null, h(KbIcon, { name: 'check', size: 16 }), ed.mode === 'create' ? (isAction ? 'Create action' : 'Create command') : 'Save Changes')),
              ed.error !== null && ed.error !== undefined ? h('span', { className: 'kbsl-err' }, String(ed.error)) : null)))
      }

      function KbFieldCard(props) {
        const d = props.d
        const f = props.f
        const ed = props.ed
        const open = ed.openField === f.id
        const err = kbFieldError(d, f)
        const inPrompt = kbVarsOf(d.template).indexOf(f.name) >= 0 || f.name === ''
        const others = d.fields.filter((x) => x.id !== f.id && x.name !== '')
        return h('div', {
          className: 'kbsl-fcard' + (open ? ' open' : '') + (ed.drag === props.index ? ' drag' : '') + (ed.over === props.index && ed.drag !== null && ed.drag !== props.index ? (ed.drag > props.index ? ' up' : ' down') : ''),
          'data-kb-field': f.id,
          draggable: true,
          onDragStart: () => kbPatchEditor({ drag: props.index }),
          onDragOver: (ev) => { ev.preventDefault(); if (ed.over !== props.index) kbPatchEditor({ over: props.index }) },
          onDrop: (ev) => { ev.preventDefault(); kbMoveField(ed.drag === null ? props.index : ed.drag, props.index) },
          onDragEnd: () => kbPatchEditor({ drag: null, over: null }),
        },
        h('div', { className: 'kbsl-fhead' },
          h('span', { className: 'kbsl-grip kbsl-tt r', 'data-tip': 'Drag to reorder', 'aria-hidden': 'true' }, h(KbIcon, { name: 'grip-vertical', size: 16 })),
          h('button', { type: 'button', className: 'kbsl-fmain', 'aria-expanded': open, onClick: () => kbPatchEditor({ openField: open ? null : f.id }) },
            h('span', { className: 'kbsl-chip cmd' }, '{' + (f.name || '…') + '}'),
            h('span', { className: 'kbsl-clip' }, f.label || 'Untitled'),
            h('span', { className: 'kbsl-chip' }, kbTypeLabel(f.type)),
            f.name !== '' && inPrompt ? h('span', { className: 'kbsl-chip kbsl-live kbsl-tt b', 'data-tip': 'The prompt uses {' + f.name + '}, so this answer is sent to the AI' }, h('i', null), 'in the prompt') : null,
            f.name !== '' && !inPrompt ? h('span', { className: 'kbsl-vistag kbsl-tt b', 'data-tip': 'Nothing in the prompt uses {' + f.name + '} yet: this question is asked but its answer is ignored' }, 'not in the prompt yet') : null,
            f.vis !== undefined && f.vis.on === true ? h('span', { className: 'kbsl-vistag kbsl-tt b', 'data-tip': 'This question only appears when the condition above is met' }, 'Visible in some cases') : null,
            h('span', { className: 'kbsl-chev' + (open ? ' open' : '') }, h(KbIcon, { name: 'chevron-down', size: 16, weight: 2 }))),
          h('button', { type: 'button', className: 'kbsl-ibtn sm mv kbsl-tt lf', 'data-tip': 'Move up', disabled: props.index === 0, onClick: () => kbMoveField(props.index, props.index - 1) }, h(KbIcon, { name: 'arrow-up', size: 15 })),
          h('button', { type: 'button', className: 'kbsl-ibtn sm mv kbsl-tt lf', 'data-tip': 'Move down', disabled: props.index === props.count - 1, onClick: () => kbMoveField(props.index, props.index + 1) }, h(KbIcon, { name: 'arrow-down', size: 15 })),
          h('button', { type: 'button', className: 'kbsl-ibtn sm danger kbsl-tt lf', 'data-tip': 'Remove', 'aria-label': 'Remove ' + (f.label || 'field'), onClick: () => kbRemoveField(f.id) }, h(KbIcon, { name: 'trash', size: 15 }))),
        open ? h('div', { className: 'kbsl-fbody' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('label', { className: 'kbsl-lblsm' }, 'What should we ask?'),
            h('input', { className: 'kbsl-field sm', 'aria-label': 'Question', placeholder: 'e.g. Language', value: f.label, onChange: (ev) => kbPatchField(f.id, { label: ev.target.value }) })),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            h('span', { className: 'kbsl-lblsm' }, 'How do they answer?'),
            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
              KB_TYPE_PILLS.map((t) => h('button', {
                key: t, type: 'button', className: 'kbsl-pill kbsl-tt b' + (f.type === t ? ' on' : ''),
                'aria-pressed': f.type === t, 'aria-label': kbTypeLabel(t), 'data-tip': KB_TYPE_TIP[t],
                onClick: () => kbPatchField(f.id, { type: t, def: t === 'toggle' ? (f.def === 'true' ? 'true' : 'false') : f.def }),
              }, h(KbIcon, { name: KB_TYPE_ICON[t], size: 15 }), KB_TYPE_SHORT[t])))),
          f.type === 'select' ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
            h('label', { className: 'kbsl-lblsm' }, 'The choices'),
            h('input', { className: 'kbsl-field sm', 'aria-label': 'Choices', placeholder: 'Option 1, Option 2', value: f.options, onChange: (ev) => kbPatchField(f.id, { options: ev.target.value }) }),
            h('span', { className: 'kbsl-help' }, 'Separate them with commas. They appear as buttons.')) : null,
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            h('span', { className: 'kbsl-lblsm' }, 'Pre-filled with ', h('span', { className: 'kbsl-opt kbsl-tt b', style: { marginLeft: '6px' }, 'data-tip': 'Use a sample value when running' }, 'Optional')),
            f.type === 'toggle'
              ? h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
                  h('button', { type: 'button', className: 'kbsl-tgl' + (f.def === 'true' ? ' on' : ''), role: 'switch', 'aria-checked': f.def === 'true', 'aria-label': 'Default value', onClick: () => kbPatchField(f.id, { def: f.def === 'true' ? 'false' : 'true' }) }),
                  h('span', { className: 'kbsl-help', style: { fontSize: '14px' } }, f.def === 'true' ? 'Yes by default' : 'No by default'))
              : (f.type === 'select'
                  ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                      kbOptList(f.options).map((o) => h('button', { key: o, type: 'button', className: 'kbsl-pill' + (f.def === o ? ' on' : ''), 'aria-pressed': f.def === o, onClick: () => kbPatchField(f.id, { def: o }) }, o)))
                  : h('input', { className: 'kbsl-field sm', type: f.type === 'number' ? 'number' : 'text', 'aria-label': 'Default value', placeholder: 'Leave empty for no default', value: f.def, onChange: (ev) => kbPatchField(f.id, { def: ev.target.value }) }))),
          (!inPrompt && f.name !== '') ? h('div', { className: 'kbsl-anim', style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', borderRadius: '10px', background: 'var(--kb-warn-bg)', color: 'var(--kb-warn-ink)', fontSize: '13.5px' } },
            h('span', { style: { flex: 1, minWidth: 0 } }, 'This answer is not used in your prompt yet, so it would do nothing.'),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-ghost sm', style: { color: 'var(--kb-warn-ink)' }, onClick: () => kbInsertVar(f.name) }, 'Put it in the prompt')) : null,
          h('button', { type: 'button', className: 'kbsl-link kbsl-tt l', 'data-tip': 'Change the variable name, or show this field only in some cases.', 'aria-expanded': f.more === true, style: { display: 'inline-flex', alignItems: 'center', gap: '6px' }, onClick: () => kbPatchField(f.id, { more: f.more !== true }) },
            f.more === true ? 'Fewer options' : 'More options',
            h('span', { className: 'kbsl-chev' + (f.more === true ? ' open' : '') }, h(KbIcon, { name: 'chevron-down', size: 16, weight: 2 }))),
          f.more === true ? h('div', { className: 'kbsl-anim', style: { display: 'flex', flexDirection: 'column', gap: '16px', padding: '14px 16px', border: '1px solid var(--kb-sep)', borderRadius: '12px' } },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
              h('label', { className: 'kbsl-lblsm' }, 'Variable name'),
              h('input', { className: 'kbsl-field sm kbsl-mono' + (err !== '' ? ' bad' : ''), 'aria-label': 'Variable name', value: f.name, onChange: (ev) => kbPatchField(f.id, { name: kbCleanName(ev.target.value) }) }),
              err !== '' ? h('span', { className: 'kbsl-err' }, err) : h('span', { className: 'kbsl-help' }, 'Used as {' + (f.name || 'name') + '} in the prompt.')),
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
              h('span', { className: 'kbsl-lblsm' }, 'Only ask this one when…'),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
                h('button', { type: 'button', className: 'kbsl-tgl' + (f.vis !== undefined && f.vis.on === true ? ' on' : ''), role: 'switch', 'aria-checked': f.vis !== undefined && f.vis.on === true, 'aria-label': 'Conditional field', onClick: () => kbPatchVis(f.id, { on: !(f.vis !== undefined && f.vis.on === true) }) }),
                h('span', { className: 'kbsl-help', style: { fontSize: '14px' } }, f.vis !== undefined && f.vis.on === true ? 'Yes, only in some cases' : 'No, always ask it')),
              f.vis !== undefined && f.vis.on === true ? h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 120px 1fr', gap: '8px' } },
                h('select', { className: 'kbsl-field sm', 'aria-label': 'Visibility logic', value: f.vis.field, onChange: (ev) => kbPatchVis(f.id, { field: ev.target.value }) },
                  h('option', { value: '' }, '— pick a field —'),
                  others.map((o) => h('option', { key: o.id, value: o.name }, o.label || o.name))),
                h('select', { className: 'kbsl-field sm', 'aria-label': 'How to compare', value: f.vis.op, onChange: (ev) => kbPatchVis(f.id, { op: ev.target.value }) },
                  h('option', { value: 'eq' }, 'is'),
                  h('option', { value: 'neq' }, 'is not'),
                  h('option', { value: 'filled' }, 'is filled'),
                  h('option', { value: 'empty' }, 'is empty')),
                f.vis.op === 'eq' || f.vis.op === 'neq'
                  ? h('input', { className: 'kbsl-field sm', 'aria-label': 'Value to compare', placeholder: 'value', value: f.vis.value, onChange: (ev) => kbPatchVis(f.id, { value: ev.target.value }) })
                  : h('span', null)) : null),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-ghost sm', style: { alignSelf: 'flex-start', color: 'var(--kb-danger)' }, onClick: () => kbRemoveField(f.id) }, 'Remove this question')) : null) : null)
      }

      // ══════════════════════════════════════════════════════════════════════
      // 6. LES ACTIONS SOUS UN MESSAGE
      // ══════════════════════════════════════════════════════════════════════
      function KbMessageActions(props) {
        const p = props !== null && props !== undefined ? props : {}
        const sid = p.sessionId !== undefined ? String(p.sessionId) : ''
        const mid = p.messageId !== undefined ? String(p.messageId) : ''
        kbTick()
        const note = React.useState(null)
        React.useEffect(() => { if (store.loaded === false) kbLoad() }, [])
        // Menu contextuel (clic droit) : il se referme au premier appui ailleurs,
        // sinon il resterait ouvert sous le curseur jusqu'a Echap. Les clics
        // DANS le menu ne le ferment pas : c'est l'item qui decide.
        React.useEffect(() => {
          if (ui.ctxId === null) return undefined
          const fermer = (ev) => {
            const cible = (ev !== null && ev !== undefined) ? ev.target : null
            if (cible !== null && cible !== undefined && typeof cible.closest === 'function' && cible.closest('.kbsl-menu') !== null) return
            ui.ctxId = null
            notify()
          }
          document.addEventListener('pointerdown', fermer, true)
          return () => document.removeEventListener('pointerdown', fermer, true)
        }, [ui.ctxId])
        const rows = listOf('action').filter((e) => e.active !== false && e.hiddenInToolbar !== true)
        const menuRows = listOf('action').filter((e) => e.active !== false && e.hiddenInToolbar === true)
        if (rows.length === 0 && menuRows.length === 0) return null
        const run = async (e) => {
          const out = await kbRunAction(e, sid, mid)
          if (out !== null && out.ok === false) note[1](String(out.error || 'action impossible'))
          else note[1](null)
        }
        return h('div', { className: 'kbsl-scope kbsl-acts' },
          rows.map((e) => h('span', { key: idOf(e), className: 'kbsl-awrap' + (ui.flashId === idOf(e) ? ' kbsl-flash' : '') },
            h('button', {
              type: 'button',
              className: 'kbsl-abtn',
              // Icone seule + le NOM en tooltip : la barre d'actions n'ecrit plus
              // de texte (harmonie avec Copier / pouces / branche du shell). Le
              // nom reste lu par les lecteurs d'ecran via aria-label.
              title: L(e.label) || nameOf(e),
              'aria-label': L(e.label) || nameOf(e),
              // `data-kb-edit` reste sur le BOUTON (hook public documente dans
              // docs/handoff/slash-actions/REFERENCE.md) : il menait au crayon,
              // il mene desormais au menu contextuel.
              'data-kb-edit': idOf(e),
              onClick: () => run(e),
              onContextMenu: (ev) => { ev.preventDefault(); ui.ctxId = ui.ctxId === idOf(e) ? null : idOf(e); notify() },
            },
              h(KbIcon, { name: e.icon || 'sparkles', size: 16 })),
            ui.ctxId === idOf(e) ? h('div', { className: 'kbsl-pop kbsl-menu kbsl-anim', style: { bottom: '36px', left: 0, width: '210px', padding: '4px' } },
              h('button', { type: 'button', className: 'kbsl-ctxitem', onClick: () => { ui.ctxId = null; kbOpenEditor('edit', 'action', e) } },
                h(KbIcon, { name: 'square-pen', size: 15 }), h('span', null, 'Edit this action')),
              h('button', { type: 'button', className: 'kbsl-ctxitem danger', onClick: () => { ui.ctxId = null; kbDeleteEntry(e) } },
                h(KbIcon, { name: 'trash', size: 15 }), h('span', null, 'Delete'))) : null)),
          menuRows.length > 0 ? h('span', { key: 'menu', className: 'kbsl-awrap' },
            h('button', {
              type: 'button',
              className: 'kbsl-abtn',
              // Icone seule elle aussi : le nom des actions du menu tient dans
              // la bulle, la barre reste au rythme des icones du shell.
              title: 'More actions',
              'aria-label': 'More actions',
              onClick: () => { ui.menu = ui.menu === 'actions' ? null : 'actions'; notify() },
            },
              h(KbIcon, { name: 'ellipsis', size: 16 })),
            ui.menu === 'actions' ? h('div', { className: 'kbsl-pop kbsl-menu kbsl-anim', style: { bottom: '36px', left: 0 } },
              menuRows.map((e) => h('div', { key: idOf(e), className: 'kbsl-pwrap' },
                h('button', { type: 'button', className: 'kbsl-pmain', onClick: () => { ui.menu = null; run(e) } },
                  h('span', { className: 'kbsl-tile sm' }, h(KbIcon, { name: e.icon || 'sparkles', size: 16 })),
                  h('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
                    h('span', { style: { fontSize: '14px', fontWeight: 600 } }, L(e.label) || nameOf(e)),
                    h('span', { className: 'kbsl-clip', style: { fontSize: '13px', color: 'var(--kb-muted)' } }, L(e.description)))),
                h('div', { className: 'kbsl-pact' },
                  h('button', { type: 'button', className: 'kbsl-ibtn sm kbsl-tt lf', 'data-tip': 'Edit', onClick: () => { ui.menu = null; kbOpenEditor('edit', 'action', e) } }, h(KbIcon, { name: 'square-pen', size: 15 })),
                  h('button', { type: 'button', className: 'kbsl-ibtn sm danger kbsl-tt lf', 'data-tip': 'Delete', onClick: () => { ui.menu = null; kbDeleteEntry(e) } }, h(KbIcon, { name: 'trash', size: 15 })))))) : null) : null,
          h('span', { key: 'add', className: 'kbsl-awrap' },
            h('button', {
              type: 'button',
              className: 'kbsl-abtn-add',
              'data-kb-add': '1',
              // Le « + » seul : le mot « Action » part en tooltip, comme le nom
              // des actions de la barre.
              title: 'Action',
              'aria-label': 'Action',
              onClick: () => { ui.addOpen = ui.addOpen !== true; notify() },
            },
              h(KbIcon, { name: 'plus', size: 16, weight: 2.4 })),
            ui.addOpen === true ? h('div', { className: 'kbsl-pop kbsl-menu kbsl-anim', style: { bottom: '36px', left: 0, padding: '4px' } },
              h('div', { className: 'kbsl-choice' }, h('span', { className: 'kbsl-tipico' }, h(KbIcon, { name: 'square-pen', size: 15 })),
                h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                  h('span', { style: { fontSize: '14px', fontWeight: 600 } }, 'Build it myself'),
                  h('span', { className: 'kbsl-help' }, 'Name it, write the prompt, save.')),
                h('button', { type: 'button', className: 'kbsl-btn kbsl-primary sm', style: { marginLeft: 'auto' }, onClick: () => { ui.addOpen = false; kbOpenEditor('create', 'action', null, {}) } }, 'Start')),
              h('div', { className: 'kbsl-choice ai' }, h('span', { className: 'kbsl-tipico' }, h(KbIcon, { name: 'sparkles', size: 15 })),
                h('span', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                  h('span', { style: { fontSize: '14px', fontWeight: 600 } }, 'Create with AI'),
                  h('span', { className: 'kbsl-help' }, 'A skill asks you questions first.')),
                h('button', { type: 'button', className: 'kbsl-btn kbsl-primary sm', style: { marginLeft: 'auto' }, onClick: () => { ui.addOpen = false; kbStartWithAI('') } }, 'Open'))) : null),
          note[0] !== null ? h('span', { className: 'kbsl-err' }, String(note[0])) : null)
      }

      // ══════════════════════════════════════════════════════════════════════
      // 7. LA SECTION DE RÉGLAGES « Commands »
      // ══════════════════════════════════════════════════════════════════════
      function KbSettings(props) {
        kbTick()
        const tabState = React.useState('slash')
        const tab = tabState[0]
        const setTab = tabState[1]
        // Gabarit Réglages 29/09 : recherche dans la liste + titres au
        // standard des autres sections (26px, sous-titre, libellés fr).
        const qState = React.useState('')
        const q = qState[0]
        const setQ = qState[1]
        React.useEffect(() => { if (store.loaded === false) kbLoad() }, [])
        const plat = (s2) => String(s2 === null || s2 === undefined ? '' : s2).toLowerCase()
        const rowsAll = listOf(tab === 'action' ? 'action' : 'slash')
        const needle = plat(q).trim()
        const rows = needle === '' ? rowsAll : rowsAll.filter((e) =>
          plat(nameOf(e)).indexOf(needle) >= 0 || plat(L(e.label)).indexOf(needle) >= 0 || plat(L(e.description)).indexOf(needle) >= 0)
        return h('div', { className: 'kbsl-scope kbsl-page' },
          h('div', { className: 'kbsl-head' },
            h('span', { className: 'kbsl-h1' }, 'Commandes & actions'),
            h('span', { className: 'kbsl-sub' }, 'Un même modèle : du texte inséré, ou un formulaire en ligne. Tape / pour lancer une commande, ou utilise le bouton sous un message.')),
          h('div', { className: 'kbsl-tabs' },
            h('button', { type: 'button', className: 'kbsl-tab' + (tab === 'slash' ? ' on' : ''), onClick: () => { setTab('slash'); setQ('') } }, 'Commandes slash' + (listOf('slash').length > 0 ? ' · ' + String(listOf('slash').length) : '')),
            h('button', { type: 'button', className: 'kbsl-tab' + (tab === 'action' ? ' on' : ''), onClick: () => { setTab('action'); setQ('') } }, 'Actions de message' + (listOf('action').length > 0 ? ' · ' + String(listOf('action').length) : '')),
            h('input', { className: 'kbsl-search', type: 'search', value: q, placeholder: 'Rechercher une commande…', 'aria-label': 'Rechercher une commande', style: { marginInlineStart: 'auto', width: '220px' }, onChange: (e) => setQ(e.target.value) })),
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
            rows.length === 0 ? h('span', { className: 'kbsl-help' }, needle !== '' ? 'Aucune commande ne correspond à « ' + q + ' ».' : (tab === 'slash' ? 'Aucune commande slash pour l’instant.' : 'Aucune action de message pour l’instant.')) : null,
            rows.map((e) => h(KbSettingsRow, { key: idOf(e), entry: e }))),
          h('div', { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
            h('button', { type: 'button', className: 'kbsl-btn kbsl-dashed sm', onClick: () => kbOpenEditor('create', tab === 'action' ? 'action' : 'slash', null, {}) },
              h(KbIcon, { name: 'plus', size: 16, weight: 2.2 }), tab === 'action' ? 'Nouvelle action' : 'Nouvelle commande'),
            h('button', { type: 'button', className: 'kbsl-aibtn', onClick: () => kbStartWithAI('') },
              h(KbIcon, { name: 'sparkles', size: 16, weight: 2 }), 'Créer avec l’IA')),
          h('details', { className: 'kbsl-json' },
            h('summary', null, 'JSON stocké — ce que l’hôte garde vraiment'),
            h('pre', { className: 'kbsl-mono' }, JSON.stringify(store.entries, null, 2))),
          store.error !== null ? h('span', { className: 'kbsl-err' }, String(store.error)) : null)
      }

      function KbSettingsRow(props) {
        const e = props.entry
        const id = idOf(e)
        const title = L(e.label) || nameOf(e)
        if (ui.confirmId === id) {
          return h('div', { className: 'kbsl-lrow', style: { background: 'color-mix(in srgb,var(--kb-danger) 14%,transparent)' } },
            h('span', { style: { flex: 1, fontSize: '13.5px' } }, 'Supprimer ', h('strong', null, title), ' ? Annulable juste après.'),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-ghost sm', onClick: () => { ui.confirmId = null; notify() } }, 'Garder'),
            h('button', { type: 'button', className: 'kbsl-btn kbsl-danger sm', onClick: () => kbDeleteEntry(e) }, 'Supprimer'))
        }
        return h('div', { className: 'kbsl-lrow' + (ui.flashId === id ? ' kbsl-flash' : '') },
          h('span', { className: 'kbsl-tile sm' }, h(KbIcon, { name: e.icon || 'terminal', size: 16 })),
          h('button', { type: 'button', className: 'kbsl-lmain', onClick: () => kbOpenEditor('edit', e.kind === 'action' ? 'action' : 'slash', e) },
            h('span', { className: 'kbsl-ltitle' },
              e.kind === 'action' ? null : h('span', { className: 'kbsl-mono', style: { color: 'var(--kb-accent)', fontWeight: 500, fontSize: '13.5px' } }, '/' + nameOf(e)),
              h('span', null, title)),
            h('span', { className: 'kbsl-desc kbsl-clip', style: { fontSize: '12.5px', color: 'var(--kb-muted)' } }, L(e.description))),
          h('span', { className: 'kbsl-chip kbsl-tt b', 'data-tip': runOf(e) === 'form' ? 'Demande ' + String((e.fields || []).length) + ' réponse(s) via un formulaire avant de lancer' : 'Se lance directement, sans formulaire' }, runOf(e) === 'form' ? String((e.fields || []).length) + ' champs' : 'direct'),
          h('button', { type: 'button', 'data-kb-edit': id, className: 'kbsl-ibtn sm kbsl-tt lf', 'data-tip': 'Modifier', 'aria-label': 'Modifier ' + title, onClick: () => kbOpenEditor('edit', e.kind === 'action' ? 'action' : 'slash', e) }, h(KbIcon, { name: 'square-pen', size: 15 })),
          h('button', { type: 'button', className: 'kbsl-ibtn sm kbsl-tt lf', 'data-tip': 'Dupliquer', 'aria-label': 'Dupliquer ' + title, onClick: () => kbDuplicate(e) }, h(KbIcon, { name: 'copy', size: 15 })),
          h('button', { type: 'button', className: 'kbsl-ibtn sm danger kbsl-tt lf', 'data-tip': 'Supprimer', 'aria-label': 'Supprimer ' + title, onClick: () => { ui.confirmId = id; notify() } }, h(KbIcon, { name: 'trash', size: 15 })))
      }

      // ══════════════════════════════════════════════════════════════════════
      // 8. LA COUCHE GLOBALE — l'éditeur et le toast
      // ══════════════════════════════════════════════════════════════════════
      // Monte hors du creneau quand c'est possible ; sinon on garde le rendu en
      // place (le plugin doit rester utilisable meme si react-dom manque).
      const kbPortal = (node, cle) => {
        const dispo = ReactDOM !== null && ReactDOM !== undefined && typeof ReactDOM.createPortal === 'function' &&
          typeof document !== 'undefined' && document !== null && document.body !== null && document.body !== undefined
        diag.portal = dispo === true
        if (dispo !== true) return node
        try { return ReactDOM.createPortal(node, document.body, cle) } catch (e) { diag.portal = false; return node }
      }

      function KbShellOverlay() {
        kbTick()
        const parts = []
        if (ui.editor !== null) parts.push(h(KbEditor, { key: 'editor' }))
        if (ui.toast !== null) {
          parts.push(h('div', { key: 'toast', className: 'kbsl-scope kbsl-toastwrap kbsl-anim', role: 'status' },
            h('span', null, ui.toast.text),
            ui.toast.undo !== null ? h('button', { type: 'button', className: 'kbsl-toast-btn', onClick: kbUndoDelete }, 'Undo') : null))
        }
        return parts.length === 0 ? null : kbPortal(h('div', null, parts), 'kybernos-slash-overlay')
      }

      // ══════════════════════════════════════════════════════════════════════
      // 9. APPLICATION
      // ══════════════════════════════════════════════════════════════════════
      function apply(ctx) {
        ctxRef = ctx
        const slots = ctx.get('slots')
        if (slots === undefined || slots === null) {
          console.error('[kybernos-slash] service slots indisponible: pas d interface')
          diag.error = 'slots indisponible'
          return
        }
        diag.slots = true
        diag.ui = () => ({ palette: ui.palette, confirmId: ui.confirmId, toast: ui.toast === null ? null : ui.toast.text,
          editor: ui.editor === null ? null : { mode: ui.editor.mode, kind: ui.editor.kind, title: ui.editor.draft.title, step: ui.editor.step, fields: ui.editor.draft.fields.length } })
        ctx.effect(() => {
          const tag = document.createElement('style')
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => tag.remove()
        }, 'kybernos-slash: styles')

        // Les jetons du theme, relus depuis l interieur de l application : sans
        // ca, l editeur et le toast (surcouche globale) restent en clair.
        ctx.effect(() => {
          const obs = kbWatchTheme()
          return () => { if (obs !== null && obs !== undefined && typeof obs.disconnect === 'function') obs.disconnect() }
        }, 'kybernos-slash: theme')

        // Échap ferme la palette, la fiche ou l'éditeur : c'est la règle de la
        // maquette, et rien d'autre dans DSH n'utilise cette touche quand un de
        // nos panneaux est ouvert.
        ctx.effect(() => {
          const onKey = (ev) => {
            // Le pied de la palette annonce « Arrow keys to move · Enter to run ·
            // Esc to close » : ces touches doivent marcher. On les capture avant
            // le composeur (phase de capture + stopPropagation), sinon les flèches
            // déplacent le curseur et Entrée envoie le message en cours.
            if (ui.palette === true && ui.editor === null && (ev.key === 'ArrowDown' || ev.key === 'ArrowUp' || ev.key === 'Home' || ev.key === 'End' || ev.key === 'Enter')) {
              const lignes = kbPaletteRows()
              if (lignes.length > 0) {
                ev.preventDefault()
                ev.stopPropagation()
                const base = ui.palIdx >= 0 && ui.palIdx < lignes.length ? ui.palIdx : 0
                if (ev.key === 'Enter') {
                  if (ui.confirmId === null) kbPickEntry(kbCurrentSession(), lignes[base])
                  return
                }
                const pas = ev.key === 'ArrowDown' ? 1 : (ev.key === 'ArrowUp' ? -1 : 0)
                const suivant = ev.key === 'Home' ? 0 : (ev.key === 'End' ? lignes.length - 1 : (base + pas + lignes.length) % lignes.length)
                if (suivant !== ui.palIdx) { ui.palIdx = suivant; notify() }
                return
              }
            }
            // Taper filtre la palette (comme le menu natif). Sans cela les lettres
            // partaient dans le composeur, derriere la palette, sans que rien ne
            // le montre. Retour arriere efface le filtre caractere par caractere.
            if (ui.palette === true && ui.editor === null) {
              const k = ev.key
              const frappe = typeof k === 'string' && k.length === 1 && ev.ctrlKey !== true && ev.metaKey !== true && ev.altKey !== true
              if (frappe === true) {
                ev.preventDefault()
                ev.stopPropagation()
                ui.palQuery = String(ui.palQuery || '') + k
                ui.palIdx = 0
                notify()
                return
              }
              if (k === 'Backspace' && String(ui.palQuery || '') !== '') {
                ev.preventDefault()
                ev.stopPropagation()
                ui.palQuery = String(ui.palQuery).slice(0, -1)
                ui.palIdx = 0
                notify()
                return
              }
            }
            if (ev.key !== 'Escape') return
            if (ui.editor !== null || ui.palette === true || ui.addOpen === true || ui.menu !== null || ui.ctxId !== null) {
              ui.editor = null
              ui.palette = false
              ui.addOpen = false
              ui.menu = null
              ui.ctxId = null
              ui.confirmId = null
              notify()
            }
          }
          document.addEventListener('keydown', onKey, true)
          return () => document.removeEventListener('keydown', onKey, true)
        }, 'kybernos-slash: touche Echap')

        // La palette : on attend le pipeline de déclencheurs pour s'y brancher.
        // Si l'hôte ne l'a pas, le reste du plugin (palette, réglages, actions)
        // vit quand même.
        ctx.inject(['inputTriggers'], (scope) => {
          try {
            const it = scope.get('inputTriggers')
            if (it === undefined || it === null || typeof it.registerSource !== 'function') {
              console.error('[kybernos-slash] inputTriggers sans registerSource : menu natif non branche')
              diag.error = 'inputTriggers sans registerSource'
              kbLoad()
              return
            }
            scope.effect(() => it.registerSource(kbSource), 'kybernos-slash: source de la palette')
            diag.palette = true
            kbLoad()
          } catch (e) {
            console.error('[kybernos-slash] branchement du menu natif impossible', e)
            diag.error = 'branchement impossible: ' + String(e !== null && e.message ? e.message : e)
          }
        })

        // Le bouton « Commands » et « Save as command », dans la barre du composeur.
        ctx.effect(() => slots.inject('conversation.input.left', () => slots.register(
          { name: 'conversation.input.left', id: 'kybernos-slash-chip', order: 20 }, KbCommandsChip)), 'kybernos-slash: bouton Commands')

        // La palette et la fiche de paramètres, ancrées au-dessus du composeur.
        ctx.effect(() => slots.inject('conversation.input.overlay', () => slots.register(
          { name: 'conversation.input.overlay', id: 'kybernos-slash-dock', order: 20 }, KbComposerDock)), 'kybernos-slash: palette et fiche')

        // Les actions sous un message.
        ctx.effect(() => slots.inject('conversation.chat.assistant-actions', () => slots.register(
          { name: 'conversation.chat.assistant-actions', id: 'kybernos-slash-actions', order: 12 }, KbMessageActions)), 'kybernos-slash: actions de message')

        // L'éditeur et le toast, au-dessus de toute la coque.
        ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
          { name: 'shell.overlay', id: 'kybernos-slash-overlay', order: 20 }, KbShellOverlay)), 'kybernos-slash: editeur et toast')

        // Les réglages.
        // (01/10) Libellé bilingue, lu sur __KB_I18N_ACTIVE__ (état de langue
        // posé par le bundle thème avant les autres) : un shell en anglais
        // lit « Commands ».
        const kbslLabel = (fr, en) => {
          try {
            const a = (typeof window !== 'undefined') ? window.__KB_I18N_ACTIVE__ : null
            const loc = (a !== null && a !== undefined && a.lang !== null && a.lang !== undefined) ? String(a.lang).toLowerCase() : ''
            return loc.indexOf('en') === 0 ? en : fr
          } catch (e) { return fr }
        }
        ctx.effect(() => slots.inject('settings.section', () => slots.register(
          { name: 'settings.section', id: 'kybernos-slash', order: 27, label: kbslLabel('Commandes', 'Commands') }, KbSettings)), 'kybernos-slash: section reglages')
      }

      return {
        inject: ['slots'],
        apply(ctx) { apply(ctx) },
      }
    } catch (kbBootError) {
      try {
        console.error('[kybernos-slash] chargement impossible — plugin desactive, GUI preservee', kbBootError)
      } catch (e2) { /* console indisponible */ }
      return { apply() { /* plugin desactive apres erreur de chargement */ } }
    }
  },
})

