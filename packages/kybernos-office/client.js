// ═══════════════════════════════════════════════════════
// kybernos-office — browser half: the window where the person edits the Office files of Creations (a .docx, an .xlsx).
//
// The core viewer of a file shows « Edit » when a plugin declared an editor that takes the file's name (`window.__KB_EDITORS__`, docs/dev/office-editors-open-save-contract-2026-11-03.md).
// This plugin declares one. Its window is a full-screen layer with a bar (Save, Save a copy, Undo, Close) and, under it, the editor in a sandboxed iframe.
//
// The editor frame runs with NO access to this app (iframe sandbox without allow-same-origin: no cookie, no storage, no DOM of ours; the host also sends it a
// Content-Security-Policy that lets it talk to nobody but the local listener). It shows the bytes of the file, tells this page when something changed and hands back
// the bytes of what it made when this page asks. THIS page saves, with the session cookie, after the person pressed Save; the host refuses a save when the file
// changed on disk since it was opened (Kaby, or the person elsewhere), and keeps the bytes before every save so Undo can put them back.
//
// Before the editor opens, the host's guard says what a light editor would drop from this particular file (a chart, a comment, a macro…): the person chooses to
// open it read-only, edit anyway, or cancel. The factory always returns a plugin: on any error it is a disabled one.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-office',
  factory: (require) => {
    try {
      const NAME = 'kybernos-office'
      const BASE = '/kybernos-office'
      const REGISTRY = '__KB_EDITORS__'
      const EXPORT_WAIT_MS = 60000
      const REGISTER_WAIT_MS = 250
      const REGISTER_TRIES = 120 // the core's registry is waited for 30 s at most
      const HASH = /^[0-9a-f]{64}$/

      const lang = () => {
        try {
          const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
          const s = String(l || '')
          // French only when the resolved language IS French (the 'kybernos' default or a fr base); every other language gets English.
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const kt = (fr, en) => (lang() === 'fr' ? fr : en)
      const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

      /** Whether the editors take this file name: a .docx or an .xlsx that is not the lock file Word and Excel leave beside an open file. */
      const canEdit = (name) => typeof name === 'string' && !name.startsWith('~$') && /\.(docx|xlsx)$/i.test(name)

      // ── the host ─────────────────────────────────────────────────────────────────
      /** `{ ok, … }` always: a network failure, an unreadable answer or a refusal is an answer too. The session cookie travels with the request. */
      const send = async (path, init) => {
        try {
          const res = await fetch(BASE + path, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init))
          let data = null
          try { data = await res.json() } catch (e) { data = null }
          if (plain(data) && typeof data.ok === 'boolean') return data
          return { ok: false, error: res.status === 401 ? 'sign-in required' : (res.status === 403 ? 'origin refused' : 'network') }
        } catch (e) { return { ok: false, error: 'network' } }
      }
      const postJson = (path, body) => send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const postBytes = (path, bytes) => send(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes })

      /** One sentence for an answer the host (or the network) gave. The host's own `why` is English; the codes a person can reach have their own words. */
      const errorText = (r) => {
        const code = r && r.error
        const known = {
          network: kt('Le serveur local ne répond pas. Réessaie dans un instant.', 'The local server does not answer. Try again in a moment.'),
          'sign-in required': kt('Ta session a expiré : recharge la page pour te reconnecter.', 'Your session has expired: reload the page to sign in again.'),
          'origin refused': kt('Cette page n’est pas ouverte depuis l’adresse de ton ordinateur.', 'This page is not open from your computer’s own address.'),
          'not-found': kt('Ce fichier est introuvable.', 'This file cannot be found.'),
          'not-a-file': kt('Ce chemin n’est pas un fichier.', 'This path is not a file.'),
          'not-allowed': kt('Les éditeurs n’ouvrent pas ce dossier.', 'The editors do not open this folder.'),
          'unsupported-format': kt('Seuls les fichiers .docx et .xlsx s’ouvrent ici.', 'Only .docx and .xlsx files open here.'),
          'too-big': kt('Ce fichier dépasse 64 Mo.', 'This file is larger than 64 MB.'),
          'not-a-zip': kt('Ce fichier n’est pas un vrai document Office : il est peut-être abîmé.', 'This is not a real Office file: it may be damaged.'),
          'not-a-docx': kt('Ce fichier n’est pas un vrai document Word.', 'This is not a real Word document.'),
          'not-a-xlsx': kt('Ce fichier n’est pas un vrai classeur Excel.', 'This is not a real Excel workbook.'),
          'invalid-output': kt('L’éditeur a rendu un fichier invalide : rien n’a été écrit.', 'The editor returned an invalid file: nothing was written.'),
          'unknown-token': kt('Ce lien a expiré : rouvre le fichier.', 'This link has expired: open the file again.'),
          'nothing-to-undo': kt('Il n’y a aucun enregistrement à annuler.', 'There is no save to undo.'),
          'not-installed': kt('Les éditeurs ne sont pas installés sur cet ordinateur.', 'The editors are not installed on this computer.'),
        }
        if (typeof code === 'string' && known[code] !== undefined) return known[code]
        return typeof (r && r.why) === 'string' && r.why !== '' ? r.why : kt('Ça n’a pas marché.', 'That did not work.')
      }

      // ── what the guard of the host said about this file ─────────────────────────────────────────────────────────────────
      // [fr one, fr many, en one, en many]
      const THINGS = {
        chart: ['graphique', 'graphiques', 'chart', 'charts'],
        comment: ['commentaire', 'commentaires', 'comment', 'comments'],
        validation: ['règle de saisie', 'règles de saisie', 'input rule', 'input rules'],
        macro: ['macro', 'macros', 'macro', 'macros'],
        image: ['image', 'images', 'picture', 'pictures'],
        pivot: ['tableau croisé dynamique', 'tableaux croisés dynamiques', 'pivot table', 'pivot tables'],
        table: ['tableau', 'tableaux', 'table', 'tables'],
        filter: ['filtre', 'filtres', 'filter', 'filters'],
        'external-link': ['lien externe', 'liens externes', 'external link', 'external links'],
        'tracked-changes': ['modification suivie', 'modifications suivies', 'tracked change', 'tracked changes'],
        'content-control': ['champ de formulaire', 'champs de formulaire', 'form field', 'form fields'],
        field: ['champ', 'champs', 'field', 'fields'],
        equation: ['équation', 'équations', 'equation', 'equations'],
      }
      const thing = (l) => {
        const w = THINGS[l.code]
        const n = typeof l.count === 'number' && l.count > 0 ? l.count : 1
        if (w === undefined) return n + ' ' + String(l.code)
        return n + ' ' + (lang() === 'fr' ? (n > 1 ? w[1] : w[0]) : (n > 1 ? w[3] : w[2]))
      }
      const list = (losses, level) => losses.filter((l) => l.level === level).map(thing).join(', ')
      /** The notices to show above the editor: `{ loss, review, untested }`, each a sentence or ''. */
      const notices = (losses) => {
        const ls = Array.isArray(losses) ? losses.filter((l) => plain(l) && typeof l.code === 'string') : []
        const loss = list(ls, 'loss')
        const review = list(ls, 'review')
        const untested = list(ls, 'untested')
        return {
          loss: loss === '' ? '' : kt('Cet éditeur ne sait pas garder : ' + loss + '. Si tu enregistres, ça disparaît du fichier.', 'This editor cannot keep: ' + loss + '. If you save, they are gone from the file.'),
          review: review === '' ? '' : kt('Gardé tel quel, mais cet éditeur ne sait pas l’accepter ni le refuser : ' + review + '.', 'Kept as they are, but this editor cannot accept or reject them: ' + review + '.'),
          untested: untested === '' ? '' : kt('Pas encore vérifié avec : ' + untested + '. Regarde le résultat : « Annuler l’enregistrement » remet le fichier comme avant.', 'Not checked yet with: ' + untested + '. Look at the result: “Undo last save” puts the file back.'),
        }
      }

      // ── the window ───────────────────────────────────────────────────────────────────────────────────────────────────────
      const CSS = `
.kyo-wrap{position:fixed;inset:0;z-index:90;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);font:14px/20px system-ui,sans-serif}
.kyo-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);flex:none}
.kyo-name{font-weight:600;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kyo-status{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#666);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kyo-status.kyo-bad{color:var(--dsw-alias-label-error,#b3261e)}
.kyo-btn{height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l3,#bbb);border-radius:15px;background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.kyo-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#eee)}
.kyo-btn:disabled{opacity:.4;cursor:not-allowed}
.kyo-btn.kyo-primary{background:var(--dsw-alias-button-primary-fill,#111);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.kyo-note{flex:none;padding:6px 12px;font-size:12px;background:var(--dsw-alias-bg-layer-2,#f5f5f5);border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);color:var(--dsw-alias-label-secondary,#555)}
.kyo-stage{flex:1;min-height:0;position:relative}
.kyo-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
.kyo-layer{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff)}
.kyo-layer[hidden]{display:none}
.kyo-card{margin:64px 16px;max-width:520px;padding:20px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#f8f8f8)}
.kyo-card p{margin:0 0 8px}
.kyo-card .kyo-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.kyo-sub{color:var(--dsw-alias-label-secondary,#666);font-size:12px}
.kyo-q{width:30px;padding:0;text-align:center;font-weight:600}
.kyo-help{position:absolute;z-index:2;top:12px;right:12px;max-width:420px;max-height:calc(100% - 24px);overflow:auto;padding:16px 18px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#f8f8f8);box-shadow:0 8px 24px var(--dsw-alias-shadow-l3,rgba(0,0,0,.18))}
.kyo-help[hidden]{display:none}
.kyo-help h4{margin:0 0 6px;font-size:14px}
.kyo-help h5{margin:10px 0 4px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.kyo-help p,.kyo-help ol{margin:0 0 8px}
.kyo-help ol{padding-left:18px}
`
      let styleEl = null
      const ensureStyle = () => {
        if (styleEl !== null) return
        styleEl = document.createElement('style')
        styleEl.setAttribute('data-plugin', '@local/kybernos-office')
        styleEl.textContent = CSS
        document.head.appendChild(styleEl)
      }
      const dropStyle = () => { try { if (styleEl !== null) styleEl.remove() } catch (e) { /* already gone */ } styleEl = null }

      const el = (tag, attrs, ...kids) => {
        const n = document.createElement(tag)
        for (const k of Object.keys(attrs || {})) {
          if (k === 'class') n.className = attrs[k]
          else if (k === 'text') n.textContent = attrs[k]
          else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k])
          else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k] === true ? '' : String(attrs[k]))
        }
        for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid)
        return n
      }

      // ── « ? How it works » ───────────────────────────────────────────────────────────────────────────────────
      // The window is plain DOM, so the SAME card the Suite shows is drawn here from the same data: GET /kybernos-hub/suite publishes every module's help
      // (what / steps / where / good). A host without the help draws no button; a failed fetch draws no card, never a broken one, and is tried again next time.
      const KB_HELP_ID = 'kybernos-office'
      let helpPending = null
      const helpFetch = () => {
        if (helpPending === null) {
          helpPending = fetch('/kybernos-hub/suite', { credentials: 'same-origin' }).then((r) => r.json()).then((j) => {
            const mods = plain(j) && Array.isArray(j.modules) ? j.modules : []
            const m = mods.find((x) => plain(x) && x.id === KB_HELP_ID)
            return m !== undefined && plain(m.aide) ? m : null
          }).catch(() => null).then((m) => { if (m === null) helpPending = null; return m })
        }
        return helpPending
      }
      /** The « ? » button of the bar; the card it opens is added to the stage. Null when the host has no help. */
      const helpButton = (stage) => {
        if (typeof window !== 'undefined' && window.__KB_HELP__) {
          const txt = (pair) => (plain(pair) ? String((lang() === 'fr' ? pair.fr : pair.en) || '') : '')
          const label = kt('Comment ça marche', 'How it works')
          const box = el('div', { class: 'kyo-help', 'data-kb': 'office-help-card', role: 'dialog', hidden: true })
          const q = el('button', { type: 'button', class: 'kyo-btn kyo-q', 'data-kb': 'office-help', 'aria-expanded': 'false', title: label, 'aria-label': label, text: '?' })
          const shut = () => { box.hidden = true; q.setAttribute('aria-expanded', 'false') }
          q.addEventListener('click', () => {
            if (!box.hidden) { shut(); return }
            helpFetch().then((m) => {
              if (m === null) return
              const a = m.aide
              box.setAttribute('aria-label', String(m.titre || KB_HELP_ID))
              box.replaceChildren(
                el('h4', { text: String(m.titre || KB_HELP_ID) }),
                el('p', { text: txt(a.what) }),
                el('h5', { text: kt('Comment l’utiliser', 'How to use it') }),
                el('ol', {}, ...(Array.isArray(a.steps) ? a.steps : []).map((st) => el('li', { text: txt(st) }))),
                plain(a.where) ? el('p', { text: kt('Où le trouver : ', 'Where to find it: ') + txt(a.where) }) : null,
                plain(a.good) ? el('p', { class: 'kyo-sub', text: txt(a.good) }) : null)
              box.hidden = false
              q.setAttribute('aria-expanded', 'true')
            })
          })
          stage.appendChild(box)
          return q
        }
        return null
      }

      let current = null // the one open window: { close() }

      /** Opens the editor window on a file. One at a time: asking again while one is open does nothing. */
      const openFile = (path, name) => {
        if (current !== null) return
        if (typeof path !== 'string' || path === '' || !canEdit(typeof name === 'string' ? name : path)) return
        ensureStyle()
        let state = { token: null, hash: null, dirty: false, saved: false, undo: false, readOnly: false, busy: false, editor: null, url: null }
        let frame = null
        let alive = true
        let seq = 0
        const pending = new Map()

        const nameEl = el('div', { class: 'kyo-name', 'data-kb': 'office-title', text: String(name || path), title: path })
        const statusEl = el('div', { class: 'kyo-status', 'data-kb': 'office-status', role: 'status', 'aria-live': 'polite' })
        const noteEl = el('div', { class: 'kyo-note', 'data-kb': 'office-notice', hidden: true })
        // The frame is never taken out of the page once it is there (an iframe that is moved loads again and loses what was typed): the cards sit in a layer above it.
        const layer = el('div', { class: 'kyo-layer', 'data-kb': 'office-layer', hidden: true })
        const stage = el('div', { class: 'kyo-stage' }, layer)
        const btn = (label, key, run, primary) => el('button', { type: 'button', class: 'kyo-btn' + (primary ? ' kyo-primary' : ''), 'data-kb': key, text: label, onclick: run, disabled: true })
        const saveBtn = btn(kt('Enregistrer', 'Save'), 'office-save', () => save('overwrite'), true)
        const copyBtn = btn(kt('Enregistrer une copie', 'Save a copy'), 'office-copy', () => save('copy'))
        const undoBtn = btn(kt('Annuler l’enregistrement', 'Undo last save'), 'office-undo', () => undo(false))
        const closeBtn = el('button', { type: 'button', class: 'kyo-btn', 'data-kb': 'office-close', text: kt('Fermer', 'Close'), onclick: () => requestClose() })
        const bar = el('div', { class: 'kyo-bar' }, nameEl, statusEl, saveBtn, copyBtn, undoBtn, helpButton(stage), closeBtn)
        const wrap = el('div', { class: 'kyo-wrap', 'data-kb': 'office-window', role: 'dialog', 'aria-modal': 'true', 'aria-label': String(name || path) }, bar, noteEl, stage)

        const status = (text, bad) => { statusEl.textContent = text; statusEl.className = 'kyo-status' + (bad ? ' kyo-bad' : '') }
        const refresh = () => {
          const editing = state.token !== null && frame !== null && !state.busy
          saveBtn.disabled = !(editing && !state.readOnly && state.dirty)
          copyBtn.disabled = !(editing && !state.readOnly && state.dirty)
          undoBtn.disabled = !(editing && state.undo)
        }
        const note = (text) => { noteEl.textContent = text; noteEl.hidden = text === '' }
        const card = (key, lines, buttons) => {
          layer.replaceChildren(el('div', { class: 'kyo-card', 'data-kb': key }, ...lines.map((l) => el('p', { class: l.sub ? 'kyo-sub' : '', text: l.text })), el('div', { class: 'kyo-row' }, ...buttons)))
          layer.hidden = false
        }
        const cardBtn = (label, run, primary) => el('button', { type: 'button', class: 'kyo-btn' + (primary ? ' kyo-primary' : ''), text: label, onclick: run })
        const toFrame = (msg) => { try { frame.contentWindow.postMessage(Object.assign({ ky: 'office' }, msg), '*') } catch (e) { /* the frame is gone */ } }

        // ── the frame ──────────────────────────────────────────────────────────────
        const mountFrame = (readOnly) => {
          state.readOnly = readOnly
          frame = el('iframe', { class: 'kyo-frame', 'data-kb': 'office-frame', title: String(name || path), sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', allow: 'clipboard-read; clipboard-write', src: state.url + '?lang=' + lang() + (readOnly ? '&ro=1' : '') })
          stage.insertBefore(frame, layer)
          layer.hidden = true
          status(kt('Ouverture…', 'Opening…'))
          refresh()
        }
        const exportBytes = () => new Promise((resolve, reject) => {
          const id = ++seq
          const timer = setTimeout(() => { pending.delete(id); reject(new Error('timeout')) }, EXPORT_WAIT_MS)
          pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
          toFrame({ op: 'export', id })
        })
        const onMessage = (ev) => {
          if (!alive || frame === null || ev.source !== frame.contentWindow) return
          const m = ev.data
          if (!plain(m) || m.ky !== 'office' || typeof m.op !== 'string') return
          if (m.op === 'loaded') {
            if (typeof m.hash === 'string' && HASH.test(m.hash)) state.hash = m.hash
            state.dirty = false
            status(state.readOnly ? kt('Lecture seule', 'Read only') : kt('Aucun changement', 'No changes'))
          } else if (m.op === 'dirty') {
            state.dirty = m.value === true && !state.readOnly
            if (state.dirty) state.saved = false
            // « Saved » stays on screen until the next change: the frame says « clean » right after a save too.
            if (!state.busy && !state.readOnly && !(state.saved && !state.dirty)) status(state.dirty ? kt('Changements non enregistrés', 'Unsaved changes') : kt('Aucun changement', 'No changes'))
          } else if (m.op === 'error') status(kt('L’éditeur a un problème : ', 'The editor has a problem: ') + String(m.message || '').slice(0, 200), true)
          else if (m.op === 'exported' && typeof m.id === 'number' && pending.has(m.id)) {
            const p = pending.get(m.id)
            pending.delete(m.id)
            if (m.bytes instanceof ArrayBuffer && m.bytes.byteLength > 0) p.resolve(m.bytes)
            else p.reject(new Error(typeof m.error === 'string' ? m.error : 'empty'))
          }
          refresh()
        }

        // ── save, undo, close ──────────────────────────────────────────────────────
        const conflict = () => {
          card('office-conflict', [
            { text: kt('Le fichier a changé sur ton ordinateur depuis que tu l’as ouvert (Kaby, ou toi ailleurs).', 'The file changed on your computer since you opened it (Kaby, or you elsewhere).') },
            { text: kt('Si tu enregistres par-dessus, ce changement est perdu.', 'If you save over it, that change is lost.'), sub: true },
          ], [
            cardBtn(kt('Enregistrer une copie', 'Save a copy'), () => { mountBack(); save('copy') }, true),
            cardBtn(kt('Recharger (je perds mes changements)', 'Reload (lose my changes)'), () => { mountBack(); state.dirty = false; toFrame({ op: 'reload' }); status(kt('Rechargé', 'Reloaded')); refresh() }),
            cardBtn(kt('Continuer à modifier', 'Keep editing'), () => { mountBack() }),
          ])
        }
        const mountBack = () => { layer.hidden = true; refresh() }
        const save = async (mode) => {
          if (state.busy || state.token === null || state.hash === null) return
          state.busy = true
          refresh()
          status(kt('Enregistrement…', 'Saving…'))
          try {
            const bytes = await exportBytes()
            const r = await postBytes('/save?token=' + encodeURIComponent(state.token) + '&base=' + encodeURIComponent(state.hash) + (mode === 'copy' ? '&mode=copy' : ''), bytes)
            if (r.ok && mode === 'copy') status(kt('Copie enregistrée : ', 'Copy saved: ') + String(r.name || ''))
            else if (r.ok) { state.hash = r.hash; state.dirty = false; state.saved = true; state.undo = true; toFrame({ op: 'saved' }); status(kt('Enregistré', 'Saved')) }
            else if (r.error === 'changed-on-disk') { status(kt('Le fichier a changé', 'The file changed'), true); conflict() }
            else status(errorText(r), true)
          } catch (e) {
            status(kt('L’éditeur n’a pas répondu : rien n’a été écrit.', 'The editor did not answer: nothing was written.'), true)
          } finally { state.busy = false; refresh() }
        }
        const undo = async (force) => {
          if (state.busy || state.token === null) return
          state.busy = true
          refresh()
          try {
            const r = await postJson('/undo', { token: state.token, force: force === true })
            if (r.ok) { state.undo = false; state.dirty = false; state.saved = false; toFrame({ op: 'reload' }); status(kt('Fichier remis comme avant', 'File put back as it was')) }
            else if (r.error === 'changed-since') {
              card('office-undo-confirm', [{ text: kt('Le fichier a changé depuis ton dernier enregistrement. Revenir en arrière effacerait ce changement.', 'The file changed since your last save. Going back would erase that change.') }], [
                cardBtn(kt('Revenir en arrière quand même', 'Go back anyway'), () => { mountBack(); undo(true) }, true),
                cardBtn(kt('Annuler', 'Cancel'), () => mountBack()),
              ])
            } else status(errorText(r), true)
          } finally { state.busy = false; refresh() }
        }
        const finish = () => {
          if (!alive) return
          alive = false
          try { window.removeEventListener('message', onMessage); window.removeEventListener('keydown', onKey, true) } catch (e) { /* listeners gone */ }
          for (const p of pending.values()) p.reject(new Error('closed'))
          pending.clear()
          try { wrap.remove() } catch (e) { /* already gone */ }
          current = null
        }
        const requestClose = () => {
          if (!state.dirty) { finish(); return }
          card('office-discard', [{ text: kt('Tu as des changements non enregistrés.', 'You have unsaved changes.') }], [
            cardBtn(kt('Continuer à modifier', 'Keep editing'), () => mountBack(), true),
            cardBtn(kt('Fermer sans enregistrer', 'Close without saving'), () => finish()),
          ])
        }
        const onKey = (ev) => {
          if (ev.key !== 'Escape' || !alive) return
          ev.stopPropagation()
          ev.stopImmediatePropagation()
          requestClose()
        }

        // ── open ───────────────────────────────────────────────────────────────────
        document.body.appendChild(wrap)
        window.addEventListener('message', onMessage)
        window.addEventListener('keydown', onKey, true)
        current = { close: finish, state: () => state, wrap }
        status(kt('Ouverture…', 'Opening…'))
        closeBtn.focus()
        ;(async () => {
          const r = await postJson('/open', { path })
          if (!alive) return
          if (!r.ok) { status(errorText(r), true); card('office-error', [{ text: errorText(r) }], [cardBtn(kt('Fermer', 'Close'), () => finish(), true)]); return }
          state = Object.assign(state, { token: r.token, hash: HASH.test(String(r.hash)) ? r.hash : null, undo: r.undo === true, editor: r.editor, url: typeof r.url === 'string' && r.url.startsWith(BASE + '/v/') ? r.url : null })
          const n = notices(r.losses)
          note([n.review, n.untested].filter((s) => s !== '').join(' '))
          if (r.installed !== true || state.url === null) {
            status(errorText({ error: 'not-installed' }), true)
            card('office-not-installed', [
              { text: errorText({ error: 'not-installed' }) },
              { text: kt('Demande à Kaby de les installer, ou construis-les avec « node packages/kybernos-office/build-editors.mjs ».', 'Ask Kaby to install them, or build them with “node packages/kybernos-office/build-editors.mjs”.'), sub: true },
            ], [cardBtn(kt('Fermer', 'Close'), () => finish(), true)])
            return
          }
          if (r.block === true) {
            status(kt('À toi de choisir', 'Your choice'))
            card('office-gate', [{ text: n.loss }, { text: kt('Tu peux l’ouvrir en lecture seule : rien n’est écrit.', 'You can open it read-only: nothing is written.'), sub: true }], [
              cardBtn(kt('Ouvrir en lecture seule', 'Open read-only'), () => mountFrame(true), true),
              cardBtn(kt('Modifier quand même', 'Edit anyway'), () => { note(n.loss); mountFrame(false) }),
              cardBtn(kt('Annuler', 'Cancel'), () => finish()),
            ])
            return
          }
          mountFrame(false)
        })().catch((e) => { try { status(String(e && e.message ? e.message : e), true) } catch (e2) { /* window gone */ } })
      }

      // ── declared to the core ─────────────────────────────────────────────────────
      // The order in which two plugins are applied is DSH's, so the core's registry is waited for, not assumed.
      const declareWhenReady = (ctx, label, entry) => ctx.effect(() => {
        let off = null
        let timer = null
        let tries = 0
        const declare = () => {
          timer = null
          try {
            const reg = window[REGISTRY]
            if (reg && typeof reg.register === 'function') { off = reg.register(entry()); return }
          } catch (e) { return }
          tries += 1
          if (tries < REGISTER_TRIES) timer = setTimeout(declare, REGISTER_WAIT_MS)
        }
        declare()
        return () => {
          try { if (timer !== null) clearTimeout(timer) } catch (e) { /* no timers */ }
          timer = null
          tries = REGISTER_TRIES
          try { if (typeof off === 'function') off() } catch (e) { /* already taken back */ }
          off = null
          if (current !== null) current.close()
          dropStyle()
        }
      }, label)

      const start = (ctx) => {
        try {
          declareWhenReady(ctx, 'kybernos-office: file editor', () => ({ id: 'office', canEdit, open: openFile }))
        } catch (e) { console.warn('[kybernos-office] editor not declared:', e) }
      }

      return {
        name: NAME,
        apply: start,
        __test: { canEdit, errorText, notices, thing, openFile, CSS, lang, kt, BASE, REGISTRY, HASH, current: () => current },
      }
    } catch (e) {
      console.warn('[kybernos-office] disabled:', e)
      return { apply () {} }
    }
  }
})
