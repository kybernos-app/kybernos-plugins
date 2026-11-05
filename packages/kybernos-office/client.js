// ═══════════════════════════════════════════════════════
// kybernos-office — browser half: the window where the person edits the Office files of Creations (a .docx, an .xlsx), its Markdown and PDF files and its slide decks (.deck.html).
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

      /** Whether the editors take this file name: a .docx, .xlsx, .pdf, Markdown or .deck.html (a slide deck) file that is not the lock file Word and Excel leave beside an open file. */
      const canEdit = (name) => typeof name === 'string' && !name.startsWith('~$') && /\.(docx|xlsx|pdf|md|markdown|deck\.html)$/i.test(name)
      /** The viewer of Creations draws what the editors draw, except Markdown: its own rendered preview stays, the pencil opens the editor. */
      const isMarkdown = (name) => typeof name === 'string' && /\.(md|markdown)$/i.test(name)
      const viewerDraws = (name) => canEdit(name) && !isMarkdown(name)

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
          'unsupported-format': kt('Seuls les fichiers .docx, .xlsx, .pdf, .md et .deck.html s’ouvrent ici.', 'Only .docx, .xlsx, .pdf, .md and .deck.html files open here.'),
          'too-big': kt('Ce fichier dépasse 64 Mo.', 'This file is larger than 64 MB.'),
          'not-a-zip': kt('Ce fichier n’est pas un vrai document Office : il est peut-être abîmé.', 'This is not a real Office file: it may be damaged.'),
          'not-a-docx': kt('Ce fichier n’est pas un vrai document Word.', 'This is not a real Word document.'),
          'not-a-xlsx': kt('Ce fichier n’est pas un vrai classeur Excel.', 'This is not a real Excel workbook.'),
          'not-a-pdf': kt('Ce fichier n’est pas un vrai PDF.', 'This is not a real PDF.'),
          'not-a-deck': kt('Ce fichier n’est pas une présentation faite ici : il ne s’ouvre pas comme des slides.', 'This is not a slide deck made here: it does not open as slides.'),
          'not-text': kt('Ce fichier n’est pas du texte (UTF-8) : il ne s’ouvre pas comme du Markdown.', 'This file is not text (UTF-8): it does not open as Markdown.'),
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
        'html-comment': ['commentaire HTML', 'commentaires HTML', 'HTML comment', 'HTML comments'],
        html: ['balise HTML', 'balises HTML', 'HTML tag', 'HTML tags'],
        footnote: ['note de bas de page', 'notes de bas de page', 'footnote', 'footnotes'],
        'reference-link': ['lien par référence', 'liens par référence', 'reference link', 'reference links'],
        math: ['formule', 'formules', 'formula', 'formulas'],
        'wiki-link': ['lien [[wiki]]', 'liens [[wiki]]', '[[wiki]] link', '[[wiki]] links'],
        encrypted: ['protection par mot de passe', 'protections par mot de passe', 'password protection', 'password protections'],
        signature: ['signature numérique', 'signatures numériques', 'digital signature', 'digital signatures'],
        form: ['formulaire', 'formulaires', 'form', 'forms'],
        attachment: ['pièce jointe', 'pièces jointes', 'attachment', 'attachments'],
        'active-content': ['contenu actif (script, cadre, action)', 'contenus actifs (script, cadre, action)', 'piece of active content (script, frame, event)', 'pieces of active content (script, frame, event)'],
      }
      const thing = (l) => {
        const w = THINGS[l.code]
        const n = typeof l.count === 'number' && l.count > 0 ? l.count : 1
        if (w === undefined) return n + ' ' + String(l.code)
        return n + ' ' + (lang() === 'fr' ? (n > 1 ? w[1] : w[0]) : (n > 1 ? w[3] : w[2]))
      }
      const list = (losses, level) => losses.filter((l) => l.level === level).map(thing).join(', ')
      /** The notices to show above the editor: `{ loss, review, untested, rewrite }`, each a sentence or ''. `editor` is the host's name for the frame ('md' has two views). */
      const notices = (losses, editor) => {
        const ls = Array.isArray(losses) ? losses.filter((l) => plain(l) && typeof l.code === 'string') : []
        const loss = list(ls, 'loss')
        const review = list(ls, 'review')
        const untested = list(ls, 'untested')
        const md = editor === 'md'
        return {
          loss: loss === '' ? '' : (md
            ? kt('La vue « Éditeur » ne sait pas garder : ' + loss + '. Si tu enregistres depuis cette vue, ça disparaît du fichier. La vue « Texte » ne réécrit rien.', 'The “Editor” view cannot keep: ' + loss + '. If you save from that view, they are gone from the file. The “Text” view rewrites nothing.')
            : kt('Cet éditeur ne sait pas garder : ' + loss + '. Si tu enregistres, ça disparaît du fichier.', 'This editor cannot keep: ' + loss + '. If you save, they are gone from the file.')),
          rewrite: md ? kt('La vue « Éditeur » réécrit tout le fichier avec sa propre mise en forme (puces, espaces…). La vue « Texte » ne change que ce que tu tapes.', 'The “Editor” view rewrites the whole file in its own style (bullets, spacing…). The “Text” view changes only what you type.') : '',
          review: review === '' ? '' : kt('Gardé tel quel, mais cet éditeur ne sait pas l’accepter ni le refuser : ' + review + '.', 'Kept as they are, but this editor cannot accept or reject them: ' + review + '.'),
          untested: untested === '' ? '' : kt('Pas encore vérifié avec : ' + untested + '. Regarde le résultat : « Annuler l’enregistrement » remet le fichier comme avant.', 'Not checked yet with: ' + untested + '. Look at the result: “Undo last save” puts the file back.'),
        }
      }

      // ── the window ───────────────────────────────────────────────────────────────────────────────────────────────────────
      const CSS = `
.kyo-wrap{position:fixed;inset:0;z-index:90;display:flex;flex-direction:column;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#111);font:14px/20px system-ui,sans-serif}
.kyo-bar{container-type:inline-size;display:flex;align-items:center;gap:6px;padding:0 10px 0 14px;min-height:46px;border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);flex:none}
.kyo-name{font-weight:600;font-size:14px;max-width:34%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kyo-ext{flex:none;margin-right:6px;padding:1px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-3,#eee);color:var(--dsw-alias-label-secondary,#666);font-size:11px;font-weight:600;letter-spacing:.04em}
.kyo-status{flex:1;min-width:0;color:var(--dsw-alias-label-secondary,#666);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kyo-status::before{content:'';display:inline-block;width:7px;height:7px;margin-right:7px;border-radius:50%;vertical-align:1px;background:var(--dsw-alias-label-tertiary,#999)}
.kyo-status:empty::before{display:none}
.kyo-status[data-tone=dirty]{color:var(--dsw-alias-label-primary,#111)}
.kyo-status[data-tone=dirty]::before{background:var(--dsw-alias-state-warn-primary,#b26a00)}
.kyo-status[data-tone=ok]::before{background:var(--dsw-alias-state-success-primary,#2e7d32)}
.kyo-status[data-tone=busy]::before{animation:kyo-pulse 1s ease-in-out infinite}
.kyo-status.kyo-bad{color:var(--dsw-alias-label-error,#b3261e)}
.kyo-status.kyo-bad::before{background:var(--dsw-alias-label-error,#b3261e)}
@keyframes kyo-pulse{50%{opacity:.3}}
.kyo-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 14px;border:1px solid var(--dsw-alias-border-l3,#bbb);border-radius:16px;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:500;cursor:pointer;white-space:nowrap;transition:background-color .15s ease,border-color .15s ease,opacity .15s ease,transform .1s ease}
.kyo-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#eee)}
.kyo-btn:active:not(:disabled){transform:scale(.97)}
.kyo-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5b5bd6);outline-offset:2px}
.kyo-btn:disabled{opacity:.4;cursor:not-allowed}
.kyo-btn.kyo-primary{background:var(--dsw-alias-button-primary-fill,#111);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.kyo-btn.kyo-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill,#111);opacity:.88}
.kyo-btn.kyo-primary:disabled{background:transparent;border-color:var(--dsw-alias-border-l3,#bbb);color:inherit}
.kyo-btn.kyo-sec{border-color:transparent}
.kyo-ico{flex:none}
@container (max-width:560px){.kyo-btn.kyo-sec{width:32px;padding:0}.kyo-btn.kyo-sec .kyo-lbl{display:none}}
@media (prefers-reduced-motion:reduce){.kyo-btn{transition:none}.kyo-status::before{animation:none!important}}
.kyo-note{flex:none;padding:6px 12px;font-size:12px;background:var(--dsw-alias-bg-layer-2,#f5f5f5);border-bottom:1px solid var(--dsw-alias-border-l2,#ddd);color:var(--dsw-alias-label-secondary,#555)}
.kyo-stage{flex:1;min-height:0;position:relative}
.kyo-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff}
.kyo-layer{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff)}
.kyo-layer[hidden]{display:none}
.kyo-card{margin:64px 16px;max-width:520px;padding:20px;border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#f8f8f8)}
.kyo-card p{margin:0 0 8px}
.kyo-card .kyo-row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.kyo-sub{color:var(--dsw-alias-label-secondary,#666);font-size:12px}
.kyo-wrap.kyo-embed{position:relative;inset:auto;z-index:auto;width:100%;height:100%;min-height:420px}
.kyo-pane{display:flex;flex-direction:column;height:100%;min-height:0}
.kyo-pane-box{flex:1;min-height:0;display:flex;flex-direction:column}
.kyo-pane-box>.kyo-wrap.kyo-embed{flex:1;height:auto;min-height:240px}
.kyo-pane-wait{padding:16px;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.kyo-q{width:32px;padding:0;font-weight:600}
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

      // 16px line icons for the bar. A host that cannot draw one (no createElementNS) gets the label alone: a missing icon never breaks the window.
      const SVG_NS = 'http://www.w3.org/2000/svg'
      const ICONS = {
        save: 'M3 2.5h7.8L13.5 5.2V13a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5ZM5.5 2.5v3h4v-3M5 13.5v-4h6v4',
        copy: 'M5.5 5.5h7a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1ZM3.5 10.5v-7a1 1 0 0 1 1-1h6',
        undo: 'M5.5 3 2.5 6l3 3M2.5 6h6a4 4 0 0 1 0 8H6',
        close: 'M4 4l8 8M12 4l-8 8',
        edit: 'M10.5 2.5l3 3-7.5 7.5H3v-3ZM9 4l3 3',
      }
      const icon = (name) => {
        try {
          if (typeof name !== 'string' || ICONS[name] === undefined || typeof document.createElementNS !== 'function') return null
          const svg = document.createElementNS(SVG_NS, 'svg')
          const attrs = { viewBox: '0 0 16 16', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.5', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: 'kyo-ico' }
          for (const k of Object.keys(attrs)) svg.setAttribute(k, attrs[k])
          const path = document.createElementNS(SVG_NS, 'path')
          path.setAttribute('d', ICONS[name])
          svg.appendChild(path)
          return svg
        } catch (e) { return null }
      }
      /** « XLSX » for « budget.xlsx »: the kind of file, in capitals, beside its name. Empty for a name with no extension. */
      const kindOf = (n) => { const m = /\.([a-z0-9]{1,5})$/i.exec(String(n || '')); return m === null ? '' : m[1].toUpperCase() }

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

      let current = null // the one open full-screen window: { close() }
      const embeds = new Set() // the windows shown inside the viewer of Creations: { close() }

      /**
       * Builds an editor window on a file. In the full-screen form (`into` is null) one at a time: asking again while one is open does nothing. In the embedded form
       * (`into` is the box the viewer of Creations gives) it opens READ-ONLY, so a file can be looked at with nothing to decide, and « Edit » turns the same box into the
       * editor (the guard speaks first when the file has things the light editor would lose). Returns `{ close, dirty }`, or null when nothing was opened.
       */
      const openWindow = (path, name, into) => {
        const embedded = into !== null && into !== undefined
        if (!embedded && current !== null) return null
        if (typeof path !== 'string' || path === '' || !canEdit(typeof name === 'string' ? name : path)) return null
        ensureStyle()
        let state = { token: null, hash: null, dirty: false, saved: false, undo: false, readOnly: false, busy: false, editor: null, url: null, losses: null, block: false, text: false }
        let frame = null
        let alive = true
        let seq = 0
        const pending = new Map()

        const nameEl = el('div', { class: 'kyo-name', 'data-kb': 'office-title', text: String(name || path), title: path })
        const extEl = el('span', { class: 'kyo-ext', 'data-kb': 'office-kind', text: kindOf(name || path), hidden: kindOf(name || path) === '' })
        const statusEl = el('div', { class: 'kyo-status', 'data-kb': 'office-status', role: 'status', 'aria-live': 'polite' })
        const noteEl = el('div', { class: 'kyo-note', 'data-kb': 'office-notice', hidden: true })
        // The frame is never taken out of the page once it is there (an iframe that is moved loads again and loses what was typed): the cards sit in a layer above it.
        const layer = el('div', { class: 'kyo-layer', 'data-kb': 'office-layer', hidden: true })
        const stage = el('div', { class: 'kyo-stage' }, layer)
        const btn = (label, key, run, primary, ico) => el('button', { type: 'button', class: 'kyo-btn' + (primary ? ' kyo-primary' : ico ? ' kyo-sec' : ''), 'data-kb': key, title: label, 'aria-label': label, onclick: run, disabled: true }, icon(ico), el('span', { class: 'kyo-lbl', text: label }))
        const saveBtn = btn(kt('Enregistrer', 'Save'), 'office-save', () => save('overwrite'), true, 'save')
        const copyBtn = btn(kt('Enregistrer une copie', 'Save a copy'), 'office-copy', () => save('copy'), false, 'copy')
        const undoBtn = btn(kt('Annuler l’enregistrement', 'Undo last save'), 'office-undo', () => undo(false), false, 'undo')
        const closeBtn = el('button', { type: 'button', class: 'kyo-btn', 'data-kb': 'office-close', onclick: () => requestClose() }, icon('close'), el('span', { class: 'kyo-lbl', text: kt('Fermer', 'Close') }))
        const editBtn = el('button', { type: 'button', class: 'kyo-btn kyo-primary', 'data-kb': 'office-edit', onclick: () => startEditing(), disabled: true }, icon('edit'), el('span', { class: 'kyo-lbl', text: kt('Modifier', 'Edit') }))
        // Embedded: the viewer already says the file's name and closes itself, so the bar has the status, « Edit » and the save buttons only.
        const bar = embedded
          ? el('div', { class: 'kyo-bar' }, statusEl, editBtn, saveBtn, copyBtn, undoBtn, helpButton(stage))
          : el('div', { class: 'kyo-bar' }, nameEl, extEl, statusEl, saveBtn, copyBtn, undoBtn, helpButton(stage), closeBtn)
        const wrap = embedded
          ? el('div', { class: 'kyo-wrap kyo-embed', 'data-kb': 'office-embed', 'aria-label': String(name || path) }, bar, noteEl, stage)
          : el('div', { class: 'kyo-wrap', 'data-kb': 'office-window', role: 'dialog', 'aria-modal': 'true', 'aria-label': String(name || path) }, bar, noteEl, stage)

        // The dot before the status says it at a glance: grey = nothing to save, amber = unsaved changes, green = saved, pulsing = working, red = a problem.
        const paintTone = () => statusEl.setAttribute('data-tone', statusEl.className.indexOf('kyo-bad') >= 0 ? 'bad' : state.busy ? 'busy' : state.dirty ? 'dirty' : state.saved ? 'ok' : 'idle')
        // What the frame reports when it fails. The spreadsheet engine's own words (a WebAssembly trap says « unreachable ») mean nothing to a person: they read « the file could not be opened ».
        const frameProblem = (raw) => {
          const word = String(raw || '').trim().slice(0, 200)
          if (/^(?:unreachable|runtimeerror|memory access out of bounds|call stack|wasm)|\bwasm\b|\bunreachable\b|out of bounds/i.test(word)) {
            return kt('Ce fichier n’a pas pu être ouvert dans l’éditeur léger : il est peut-être abîmé ou écrit par un programme qu’il ne connaît pas. Il n’a pas été modifié.', 'The light editor could not open this file: it may be damaged or written by a program it does not know. The file was not changed.')
          }
          return kt('L’éditeur a un problème : ', 'The editor has a problem: ') + word
        }
        const status = (text, bad) => { statusEl.textContent = text; statusEl.className = 'kyo-status' + (bad ? ' kyo-bad' : ''); paintTone() }
        const refresh = () => {
          paintTone()
          const editing = state.token !== null && frame !== null && !state.busy
          saveBtn.disabled = !(editing && !state.readOnly && state.dirty)
          copyBtn.disabled = !(editing && !state.readOnly && state.dirty)
          undoBtn.disabled = !(editing && state.undo)
          editBtn.hidden = !(embedded && state.readOnly)
          editBtn.disabled = !(editing && state.readOnly)
        }
        const note = (text) => { noteEl.textContent = text; noteEl.hidden = text === '' }
        const card = (key, lines, buttons) => {
          layer.replaceChildren(el('div', { class: 'kyo-card', 'data-kb': key }, ...lines.map((l) => el('p', { class: l.sub ? 'kyo-sub' : '', text: l.text })), el('div', { class: 'kyo-row' }, ...buttons)))
          layer.hidden = false
        }
        // The full-screen window can be closed from a card; the embedded box is closed by the viewer that holds it.
        const closer = () => (embedded ? [] : [cardBtn(kt('Fermer', 'Close'), () => finish(), true)])
        const cardBtn = (label, run, primary) => el('button', { type: 'button', class: 'kyo-btn' + (primary ? ' kyo-primary' : ''), text: label, onclick: run })
        const toFrame = (msg) => { try { frame.contentWindow.postMessage(Object.assign({ ky: 'office' }, msg), '*') } catch (e) { /* the frame is gone */ } }

        // ── the frame ──────────────────────────────────────────────────────────────
        const mountFrame = (readOnly) => {
          state.readOnly = readOnly
          frame = el('iframe', { class: 'kyo-frame', 'data-kb': 'office-frame', title: String(name || path), sandbox: 'allow-scripts', referrerpolicy: 'no-referrer', allow: 'clipboard-read; clipboard-write', src: state.url + '?lang=' + lang() + '&name=' + encodeURIComponent(baseName(name || path)) + (readOnly ? '&ro=1' : '') + (state.text ? '&mode=text' : '') })
          stage.insertBefore(frame, layer)
          layer.hidden = true
          status(kt('Ouverture…', 'Opening…'))
          refresh()
        }
        // Embedded: « Edit » replaces the read-only frame by the editor (nothing was typed in a read-only frame, so nothing is lost by the swap).
        const swapFrame = (readOnly) => {
          try { if (frame !== null) frame.remove() } catch (e) { /* already gone */ }
          frame = null
          mountFrame(readOnly)
        }
        // What the person is told above the editor once it is editable: a Markdown file is rewritten by its Editor view, and what the host could not promise is said.
        const editNotes = (n) => [state.editor === 'md' && !state.text ? n.rewrite : '', n.review, n.untested].filter((x) => x !== '').join(' ')
        const startEditing = () => {
          if (!embedded || state.token === null || state.busy || !state.readOnly) return
          const n = notices(state.losses, state.editor)
          if (state.block) {
            const md = state.editor === 'md'
            card('office-gate', [{ text: n.loss }, { text: md ? kt('Tu peux modifier le texte lui-même, ou continuer à regarder : rien n’est écrit.', 'You can edit the text itself, or keep looking: nothing is written.') : kt('Tu peux continuer à regarder le fichier : rien n’est écrit.', 'You can keep looking at the file: nothing is written.'), sub: true }], [
              md ? cardBtn(kt('Modifier le texte', 'Edit the text'), () => { state.text = true; note(''); swapFrame(false) }, true) : null,
              cardBtn(md ? kt('Modifier dans l’éditeur quand même', 'Edit in the editor anyway') : kt('Modifier quand même', 'Edit anyway'), () => { state.text = false; note(n.loss); swapFrame(false) }, !md),
              cardBtn(kt('Annuler', 'Cancel'), () => mountBack()),
            ].filter((b) => b !== null))
            return
          }
          note(editNotes(n))
          swapFrame(false)
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
          } else if (m.op === 'error') status(frameProblem(m.message), true)
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
          if (embedded) embeds.delete(handle)
          else current = null
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
        const handle = { close: finish, dirty: () => state.dirty === true, state: () => state, wrap }
        window.addEventListener('message', onMessage)
        if (embedded) {
          into.appendChild(wrap)
          embeds.add(handle)
        } else {
          document.body.appendChild(wrap)
          window.addEventListener('keydown', onKey, true)
          current = handle
        }
        status(kt('Ouverture…', 'Opening…'))
        if (!embedded) closeBtn.focus()
        ;(async () => {
          const r = await postJson('/open', { path })
          if (!alive) return
          if (!r.ok) { status(errorText(r), true); card('office-error', [{ text: errorText(r) }], closer()); return }
          // A Markdown file the Editor view would rewrite is shown as its text, so nothing looks missing; the person chooses how to edit it.
          state = Object.assign(state, { token: r.token, hash: HASH.test(String(r.hash)) ? r.hash : null, undo: r.undo === true, editor: r.editor, url: typeof r.url === 'string' && r.url.startsWith(BASE + '/v/') ? r.url : null, losses: r.losses, block: r.block === true, text: r.editor === 'md' && r.block === true })
          const n = notices(r.losses, r.editor)
          if (!embedded) note(editNotes(n))
          if (r.installed !== true || state.url === null) {
            status(errorText({ error: 'not-installed' }), true)
            card('office-not-installed', [
              { text: errorText({ error: 'not-installed' }) },
              { text: kt('Demande à Kaby de les installer, ou construis-les avec « node packages/kybernos-office/build-editors.mjs ».', 'Ask Kaby to install them, or build them with “node packages/kybernos-office/build-editors.mjs”.'), sub: true },
            ], closer())
            return
          }
          if (embedded) { mountFrame(true); return }
          if (r.block === true) {
            status(kt('À toi de choisir', 'Your choice'))
            const md = r.editor === 'md'
            card('office-gate', [{ text: n.loss }, { text: kt('Tu peux l’ouvrir en lecture seule : rien n’est écrit.', 'You can open it read-only: nothing is written.'), sub: true }], [
              cardBtn(kt('Ouvrir en lecture seule', 'Open read-only'), () => mountFrame(true), !md),
              md ? cardBtn(kt('Modifier le texte', 'Edit the text'), () => { note(''); mountFrame(false) }, true) : null,
              cardBtn(md ? kt('Modifier dans l’éditeur quand même', 'Edit in the editor anyway') : kt('Modifier quand même', 'Edit anyway'), () => { state.text = false; note(n.loss); mountFrame(false) }),
              cardBtn(kt('Annuler', 'Cancel'), () => finish()),
            ].filter((b) => b !== null))
            return
          }
          mountFrame(false)
        })().catch((e) => { try { status(String(e && e.message ? e.message : e), true) } catch (e2) { /* window gone */ } })
        return handle
      }
      const openFile = (path, name) => { openWindow(path, name, null) }
      /** The viewer of Creations shows the file in this box, read-only, with « Edit » in its bar. Returns `{ close, dirty }`, or null. */
      const embedFile = (box, path, name) => openWindow(path, name, box)

      // ── the right-hand tab of a chat ───────────────────────────────────────────────────────────────────────────────
      // A tab type of its own for .docx, .xlsx, .pdf, Markdown and .deck.html (slide deck) files (`ctx.sidebarRightTabs`), ranked above DSH's file previews, with its body in the slot `sidebar.right.pane.tab`.
      // DSH keeps such a body mounted while the tab lives (`keepMounted`): the document preview's own bodies are thrown away on every change of tab, and an editor
      // lost what had been typed. The file is drawn by the same editor as in Creations, read-only first, with « Edit » in its bar, so what a chat wrote is looked
      // at and changed where it appeared. Closing the tab with unsaved changes cannot be intercepted (the engine has no veto): the editor's own bar says « Unsaved changes ».
      const PANE_ID = 'kybernos-office'
      const PANE_KIND = 'kybernos-office'
      const PANE_SLOT = 'sidebar.right.pane.tab'
      const SESSION_FILE = 'dsh-resource://file/session/'
      const baseName = (p) => String(p || '').split(/[\\/]/).pop()
      const paneTitle = (address) => { const n = baseName(String(address || '').replace(/[?#].*$/, '')); try { return decodeURIComponent(n) } catch (e) { return n } }

      /** The tab body, built with the host's React the first time it is needed. Props are the slot's: `useTabInfo` (the tab's address and navigation) and `useResource` (the file's absolute path and version). */
      const makePaneBody = (React) => {
        const h = React.createElement
        return function KbOfficePane (props) {
          const info = typeof props.useTabInfo === 'function' ? props.useTabInfo() : null
          const tab = plain(info) && plain(info.tab) ? info.tab : null
          const address = tab !== null && typeof tab.contentId === 'string' ? tab.contentId : ''
          const meta = typeof props.useResource === 'function' && address !== '' ? props.useResource(address) : null
          const value = plain(meta) && plain(meta.value) ? meta.value : null
          const path = value !== null && typeof value.absolutePath === 'string' && value.absolutePath !== '' ? value.absolutePath : null
          const version = value !== null && typeof value.version === 'string' ? value.version : ''
          const revision = tab !== null && plain(tab.navigation) && typeof tab.navigation.revision === 'number' ? tab.navigation.revision : 0
          const boxRef = React.useRef(null)
          const live = React.useRef({ handle: null, open: null, revision, version })

          React.useEffect(() => {
            const box = boxRef.current
            if (path === null || box === null || box === undefined) return undefined
            const l = live.current
            l.open = () => embedFile(box, path, baseName(path))
            l.handle = l.open()
            return () => { const hd = l.handle; l.handle = null; l.open = null; if (hd !== null) { try { hd.close() } catch (e) { /* already gone */ } } }
          }, [path])

          // Opened again from the file list, or the file changed on disk: show it again, but only while it is shown read-only. Once the person is editing, the
          // host refuses a save over a newer file and says so; a reload here would also throw them out of edit mode after their own save.
          React.useEffect(() => {
            const l = live.current
            if (l.revision === revision && l.version === version) return
            l.revision = revision
            l.version = version
            if (l.handle === null || l.open === null) return
            let again = false
            try { again = l.handle.dirty() !== true && plain(l.handle.state()) && l.handle.state().readOnly === true } catch (e) { again = false }
            if (!again) return
            try { l.handle.close() } catch (e) { /* already gone */ }
            l.handle = l.open()
          }, [revision, version])

          return h('div', { className: 'kyo-pane', 'data-kb': 'office-pane' },
            path === null ? h('div', { className: 'kyo-pane-wait' }, kt('Ouverture…', 'Opening…')) : null,
            h('div', { className: 'kyo-pane-box', ref: boxRef }))
        }
      }

      /**
       * Declares the tab type and its body, for the suffixes whose editor is installed (without editors DSH keeps its own previews).
       * `ctx.inject` waits for the services, and nothing is asked of an engine that does not have them.
       */
      const startPane = (ctx) => {
        if (typeof ctx.inject !== 'function') return
        ctx.inject(['slots', 'sidebarRightTabs'], (scope) => {
          const slots = scope !== undefined && scope !== null ? scope.slots : null
          const tabs = scope !== undefined && scope !== null ? scope.sidebarRightTabs : null
          if (slots === null || slots === undefined || tabs === null || tabs === undefined || typeof tabs.register !== 'function') return
          let Body = null
          try { Body = makePaneBody(require('react')) } catch (e) { Body = null }
          if (Body === null) return
          scope.effect(() => slots.inject(PANE_SLOT, () => slots.register({ name: PANE_SLOT, key: PANE_ID }, Body)), 'kybernos-office: the body of the right-hand tab')
          scope.effect(() => {
            let off = null
            let dead = false
            send('/status', { method: 'GET' }).then((st) => {
              if (dead || !plain(st) || !st.ok || !plain(st.installed)) return
              const patterns = [st.installed.doc === true ? '*.docx' : null, st.installed.sheet === true ? '*.xlsx' : null, st.installed.md === true ? '*.md' : null, st.installed.md === true ? '*.markdown' : null, st.installed.pdf === true ? '*.pdf' : null, st.installed.deck === true ? '*.deck.html' : null].filter((x) => x !== null)
              if (patterns.length === 0) return
              off = tabs.register({ id: PANE_ID, kind: PANE_KIND, patterns, priority: 'extension', keepMounted: true, canOpen: (address) => typeof address === 'string' && address.startsWith(SESSION_FILE), title: paneTitle })
            }).catch(() => { /* no status: DSH keeps its own previews */ })
            return () => { dead = true; try { if (typeof off === 'function') off() } catch (e) { /* already taken back */ } off = null }
          }, 'kybernos-office: the type of the right-hand tab')
        })
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
          for (const w of [...embeds]) w.close()
          dropStyle()
        }
      }, label)

      const start = (ctx) => {
        try {
          declareWhenReady(ctx, 'kybernos-office: file editor', () => ({ id: 'office', canEdit, embeds: viewerDraws, open: openFile, embed: embedFile }))
        } catch (e) { console.warn('[kybernos-office] editor not declared:', e) }
        try { startPane(ctx) } catch (e) { console.warn('[kybernos-office] right-hand tab not declared:', e) }
      }

      return {
        name: NAME,
        apply: start,
        __test: { canEdit, viewerDraws, isMarkdown, errorText, notices, thing, openFile, embedFile, makePaneBody, startPane, PANE_ID, PANE_KIND, paneTitle, baseName, CSS, lang, kt, BASE, REGISTRY, HASH, current: () => current },
      }
    } catch (e) {
      console.warn('[kybernos-office] disabled:', e)
      return { apply () {} }
    }
  }
})
