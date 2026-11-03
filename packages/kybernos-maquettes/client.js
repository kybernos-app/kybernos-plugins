// ═══════════════════════════════════════════════════════
// kybernos-maquettes — browser half: the « Maquettes » page, where the person edits the HTML screens they (or Kaby) drew.
//
// A maquette is a folder of .html pages on the person's computer. The page lists the folders the person registered (they type the folder's full path),
// opens a page of one in a sandboxed iframe and the editor (editor/ky-edit.js, served by the host into that page) works inside it: click a text to write
// over it, a block to move, duplicate, restyle or delete it, « Insert » to add a block or a picture. A save patches the file in place; what the editor did not
// touch stays byte for byte.
//
// The page of a maquette runs with NO access to this app (iframe sandbox without allow-same-origin: no cookie, no storage, no DOM of ours). The editor in it
// reaches the host only through postMessage to THIS page, which forwards a short allowlist of calls with the session cookie (`handleBridge`). Only a message from
// the iframe this page opened is answered.
//
// It declares its row in the menu (`window.__KB_MENU__`), is a source of Creations (`window.__KB_CREATIONS__`, the row steps aside while it is declared) and
// mounts the page on the keyed slot `main.kybernos-business`. The factory always returns a plugin: on any error it is a disabled one.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-maquettes',
  factory: (require) => {
    try {
      const NAME = 'kybernos-maquettes'
      const BASE = '/kybernos-maquettes'
      const ROW_ID = 'maquettes'
      const SLOT = 'main.kybernos-business'
      const SANDBOX = 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox'
      const API_OPS = ['hash', 'find', 'apply', 'undo', 'reset', 'unupload', 'blocks']
      const MENU_WAIT_MS = 250
      const MENU_TRIES = 120 // the core's registry is waited for 30 s at most
      const MAX_IMAGE = 8 * 1024 * 1024
      const KV_MAX = 1024 * 1024
      const ASK_MAX = 40

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
      const getJson = (path) => send(path, { method: 'GET' })
      const postJson = (path, body) => send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const postBytes = (path, bytes) => send(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes })

      /** One sentence for an answer the host (or the network) gave. The host's own `why` is English; the codes a person can reach have their own words. */
      const errorText = (r) => {
        const code = r && r.error
        const known = {
          network: kt('Le serveur local ne répond pas. Réessaie dans un instant.', 'The local server does not answer. Try again in a moment.'),
          'sign-in required': kt('Ta session a expiré : recharge la page pour te reconnecter.', 'Your session has expired: reload the page to sign in again.'),
          'origin refused': kt('Cette page n’est pas ouverte depuis l’adresse de ton ordinateur.', 'This page is not open from your computer’s own address.'),
          'bad-path': kt('Écris le chemin complet du dossier.', 'Type the full path of the folder.'),
          'not-absolute': kt('Écris le chemin complet du dossier : il commence par / ou par ~/.', 'Type the full path of the folder: it starts with / or ~/.'),
          'not-a-folder': kt('Ce chemin n’est pas un dossier.', 'This path is not a folder.'),
          'not-found': kt('Ce dossier est introuvable.', 'This folder cannot be found.'),
          'too-wide': kt('Choisis le dossier d’une seule maquette, pas ton dossier personnel ni tout le disque.', 'Pick the folder of one maquette, not your home folder or the whole disk.'),
          'no-page': kt('Ce dossier ne contient aucune page .html à sa racine.', 'This folder holds no .html page at its top level.'),
          'too-many': kt('Trop de dossiers : retires-en un d’abord.', 'Too many folders: remove one first.'),
          unknown: kt('Ce dossier n’est plus dans la liste.', 'This folder is no longer in the list.'),
          'unknown-token': kt('Ce lien a expiré : rouvre la maquette.', 'This link has expired: open the maquette again.'),
        }
        if (typeof code === 'string' && known[code] !== undefined) return known[code]
        return typeof (r && r.why) === 'string' && r.why !== '' ? r.why : kt('Ça n’a pas marché.', 'That did not work.')
      }

      // ── what the editor in the page may ask ─────────────────────────────────────────────────────────────────────────────
      // The pending changes of an open maquette and the line to show after a reload live here, not in the sandboxed page (it has no storage): one object per
      // maquette page, kept for as long as this window is open.
      const KV = new Map()
      const kvKey = (folderId, file) => String(folderId) + '\n' + String(file)
      const kvOf = (folderId, file) => {
        const k = kvKey(folderId, file)
        if (!KV.has(k)) KV.set(k, {})
        return KV.get(k)
      }

      /** The first message of the chat Kaby is asked in: what the person asked for on text the editor cannot change by hand. Written for them to read and send. */
      const askSentence = (items, ctx) => {
        const F = (ctx && ctx.lang) === 'fr'
        const name = ctx && ctx.name ? ctx.name : ''
        const dir = ctx && ctx.dir ? ctx.dir : ''
        const file = ctx && ctx.file ? ctx.file : ''
        const lines = items.map((it) => '- ' + (it.tag ? '[' + it.tag + '] ' : '') + '« ' + it.text + ' »' + (it.locked ? (F ? ' (texte construit par un script de la page)' : ' (text built by a script of the page)') : ''))
        const where = (F ? 'Dans la maquette « ' + name + ' »' : 'In the maquette “' + name + '”') + (file ? (F ? ', page ' : ', page ') + file : '') + (dir ? (F ? ' (dossier ' : ' (folder ') + dir + ')' : '')
        return where + (F ? ', peux-tu faire ces changements à ma place ?' : ', can you make these changes for me?') + '\n' + lines.join('\n')
      }

      /**
       * One message from the editor, answered. `ctx` is what the DSH page knows about the open maquette: `{ token, folderId, name, dir, lang, call, upload, ask }`.
       * Nothing the page says picks a path or a route: the operation is on a short list, the token is ours, the page name is checked by the host.
       */
      const handleBridge = async (msg, ctx) => {
        const bad = { ok: false, error: 'bad-message', why: kt('Demande non reconnue.', 'Request not recognised.') }
        if (!plain(msg) || msg.kyEdit !== 1 || typeof msg.type !== 'string') return bad
        const file = typeof msg.file === 'string' && msg.file.length > 0 && msg.file.length <= 300 ? msg.file : 'index.html'
        if (msg.type === 'api') {
          if (typeof msg.op !== 'string' || API_OPS.indexOf(msg.op) < 0) return bad
          const body = { op: msg.op, token: ctx.token, file }
          if (msg.op === 'find') body.text = msg.text
          else if (msg.op === 'apply') body.body = msg.body
          else if (msg.op === 'reset') body.force = msg.force === true
          else if (msg.op === 'unupload') body.srcs = msg.srcs
          else if (msg.op === 'blocks') body.lang = ctx.lang
          return await ctx.call(body)
        }
        if (msg.type === 'upload') {
          if (!(msg.bytes instanceof ArrayBuffer) || msg.bytes.byteLength === 0 || msg.bytes.byteLength > MAX_IMAGE) return { ok: false, error: 'too-big', why: kt('L’image est vide ou dépasse 8 Mo.', 'The picture is empty or larger than 8 MB.') }
          const name = typeof msg.filename === 'string' && msg.filename !== '' ? msg.filename.slice(0, 120) : 'image'
          return await ctx.upload(name, msg.bytes)
        }
        if (msg.type === 'kv-get') return { ok: true, value: kvOf(ctx.folderId, file) }
        if (msg.type === 'kv-set') {
          if (typeof msg.key !== 'string' || msg.key === '' || msg.key.length > 40) return bad
          const store = kvOf(ctx.folderId, file)
          if (msg.value === null || msg.value === undefined) delete store[msg.key]
          else {
            let size = 0
            try { size = JSON.stringify(msg.value).length } catch (e) { size = KV_MAX + 1 }
            if (size > KV_MAX) return { ok: false, error: 'too-big', why: kt('Trop de changements en attente.', 'Too many pending changes.') }
            store[msg.key] = msg.value
          }
          return { ok: true }
        }
        if (msg.type === 'ask') {
          const items = Array.isArray(msg.items) ? msg.items.slice(0, ASK_MAX).filter((it) => plain(it) && typeof it.text === 'string' && it.text.trim() !== '').map((it) => ({ tag: typeof it.tag === 'string' ? it.tag.slice(0, 40) : '', text: it.text.slice(0, 2000), locked: it.locked === true })) : []
          if (items.length === 0) return bad
          const sentence = askSentence(items, { lang: ctx.lang, name: ctx.name, dir: ctx.dir, file })
          return { ok: true, opened: ctx.ask(sentence) === true }
        }
        return bad
      }

      // ── the page ─────────────────────────────────────────────────────────────────────────────────
      const build = (React) => {
        const h = React.createElement
        const { useState, useEffect, useRef, useCallback } = React
        const ask = (text) => { try { if (typeof window.__KB_ASK__ === 'function') return window.__KB_ASK__(text) !== false } catch (e) { /* the chat could not open */ } return false }
        const help = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-maquettes' }) : null)

        const Icon = ({ d, size }) => h('svg', { width: size || 16, height: size || 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d }))
        const ICON = {
          back: 'M15 18l-6-6 6-6',
          trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
          plus: 'M12 5v14M5 12h14',
          pen: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z',
          folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
        }

        const Page = () => {
          const [folders, setFolders] = useState(null)
          const [error, setError] = useState('')
          const [path, setPath] = useState('')
          const [busy, setBusy] = useState(false)
          const [session, setSession] = useState(null) // { id, name, dir, token, page, pages, url }
          const [confirm, setConfirm] = useState('')
          const alive = useRef(true)
          const frame = useRef(null)
          const live = useRef(null)
          live.current = session

          const refresh = useCallback(async () => {
            const r = await getJson('/folders')
            if (!alive.current) return
            if (r.ok && Array.isArray(r.folders)) { setFolders(r.folders); setError('') } else { setFolders((f) => f || []); setError(errorText(r)) }
          }, [])
          useEffect(() => { alive.current = true; refresh(); return () => { alive.current = false } }, [refresh])

          // The editor's calls: only the iframe this page opened is answered, and only with the token this page minted for it.
          useEffect(() => {
            const onMessage = (e) => {
              const s = live.current
              if (s === null || frame.current === null || e.source !== frame.current.contentWindow) return
              const m = e.data
              if (!plain(m) || m.kyEdit !== 1 || typeof m.id !== 'number') return
              const ctx = {
                token: s.token, folderId: s.id, name: s.name, dir: s.dir, lang: lang(),
                call: (body) => postJson('/api', body),
                upload: (filename, bytes) => postBytes('/upload?token=' + encodeURIComponent(s.token) + '&filename=' + encodeURIComponent(filename), bytes),
                ask,
              }
              handleBridge(m, ctx).then((reply) => { try { e.source.postMessage({ kyEdit: 1, id: m.id, reply }, '*') } catch (x) { /* the page is gone */ } })
            }
            window.addEventListener('message', onMessage)
            return () => window.removeEventListener('message', onMessage)
          }, [])

          const add = async () => {
            if (busy || path.trim() === '') return
            setBusy(true)
            const r = await postJson('/folders/add', { path: path.trim() })
            if (!alive.current) return
            setBusy(false)
            if (!r.ok) { setError(errorText(r)); return }
            setPath(''); setError('')
            await refresh()
          }
          const remove = async (f) => {
            setConfirm('')
            const r = await postJson('/folders/remove', { id: f.id })
            if (!alive.current) return
            if (!r.ok) setError(errorText(r))
            await refresh()
          }
          const open = async (f, file) => {
            setBusy(true)
            const r = await postJson('/open', { id: f.id, file: file || undefined, lang: lang() })
            if (!alive.current) return
            setBusy(false)
            if (!r.ok) { setError(errorText(r)); return }
            setError('')
            setSession({ id: f.id, name: r.name || f.name, dir: f.dir, token: r.token, page: r.page, pages: Array.isArray(r.pages) ? r.pages : [r.page], url: r.url })
          }

          const title = h('header', { className: 'kb6-headrow' }, h('div', { className: 'kb6-titlerow kbmq-titlerow' },
            session !== null ? h('button', { type: 'button', className: 'kbmq-ib', 'data-kb': 'maquettes-back', title: kt('Retour à la liste', 'Back to the list'), 'aria-label': kt('Retour à la liste', 'Back to the list'), onClick: () => { setSession(null); refresh() } }, h(Icon, { d: ICON.back, size: 18 })) : null,
            h('h1', { className: 'kb6-title' }, session !== null ? session.name : kt('Maquettes', 'Mockups')),
            session === null ? help() : null))

          if (session !== null) {
            return h('div', { className: 'kbmq kbmq-edit', 'data-kb': 'maquettes-page', 'data-screen': 'edit' },
              h('style', { 'data-plugin': '@local/kybernos-maquettes' }, CSS),
              title,
              session.pages.length > 1 ? h('div', { className: 'kbmq-pages', role: 'tablist', 'data-kb': 'maquettes-pages' }, session.pages.map((p) => h('button', { key: p, type: 'button', role: 'tab', 'aria-selected': p === session.page, className: 'kbmq-tab', 'data-page': p, onClick: () => { if (p !== session.page) open({ id: session.id, name: session.name, dir: session.dir }, p) } }, p))) : null,
              error !== '' ? h('div', { className: 'kbmq-banner', role: 'alert', 'data-kb': 'maquettes-error' }, error) : null,
              h('iframe', { key: session.token, ref: frame, className: 'kbmq-frame', 'data-kb': 'maquettes-frame', src: session.url, sandbox: SANDBOX, title: kt('Maquette : ', 'Maquette: ') + session.name + ' — ' + session.page }))
          }

          const body = folders === null
            ? h('p', { className: 'kbmq-muted', 'data-kb': 'maquettes-loading' }, kt('Chargement…', 'Loading…'))
            : folders.length === 0
              ? h('div', { className: 'kbmq-empty', 'data-kb': 'maquettes-empty' },
                h('h2', null, kt('Aucune maquette pour l’instant', 'No mockup yet')),
                h('p', null, kt('Une maquette est un dossier de pages .html : un écran dessiné par toi ou par Kaby. Ajoute son dossier ci-dessus, puis clique sur un texte ou sur un bloc pour le changer.', 'A mockup is a folder of .html pages: a screen drawn by you or by Kaby. Add its folder above, then click a text or a block to change it.')))
              : h('div', { className: 'kbmq-grid', 'data-kb': 'maquettes-list' }, folders.map((f) => h('div', { key: f.id, className: 'kbmq-card', 'data-kb': 'maquettes-folder', 'data-id': f.id },
                h('div', { className: 'kbmq-cardhead' }, h('span', { className: 'kbmq-tile' }, h(Icon, { d: ICON.folder, size: 18 })), h('div', { className: 'kbmq-name' }, h('b', null, f.name), h('span', { className: 'kbmq-muted kbmq-path', title: f.dir }, f.dir))),
                f.missing
                  ? h('p', { className: 'kbmq-muted' }, kt('Ce dossier ne contient plus de page .html (déplacé ou supprimé ?).', 'This folder no longer holds a .html page (moved or deleted?).'))
                  : h('p', { className: 'kbmq-muted' }, f.pages.length + ' ' + (f.pages.length === 1 ? kt('page', 'page') : kt('pages', 'pages')) + ' · ' + f.pages.slice(0, 3).join(', ') + (f.pages.length > 3 ? '…' : '')),
                h('div', { className: 'kbmq-actions' },
                  h('button', { type: 'button', className: 'kbmq-btn primary', 'data-act': 'open', disabled: busy || f.missing, onClick: () => open(f) }, h(Icon, { d: ICON.pen, size: 15 }), kt('Ouvrir', 'Open')),
                  confirm === f.id
                    ? h('span', { className: 'kbmq-confirm', role: 'group' }, h('span', null, kt('Retirer de la liste ? Les fichiers restent.', 'Remove from the list? The files stay.')), h('button', { type: 'button', className: 'kbmq-btn danger sm', 'data-act': 'remove-yes', onClick: () => remove(f) }, kt('Retirer', 'Remove')), h('button', { type: 'button', className: 'kbmq-btn sm', 'data-act': 'remove-no', onClick: () => setConfirm('') }, kt('Garder', 'Keep')))
                    : h('button', { type: 'button', className: 'kbmq-ib', 'data-act': 'remove', title: kt('Retirer de la liste', 'Remove from the list'), 'aria-label': kt('Retirer de la liste', 'Remove from the list'), onClick: () => setConfirm(f.id) }, h(Icon, { d: ICON.trash, size: 16 }))))))

          return h('div', { className: 'kbmq', 'data-kb': 'maquettes-page', 'data-screen': 'list' },
            h('style', { 'data-plugin': '@local/kybernos-maquettes' }, CSS),
            title,
            h('form', { className: 'kbmq-add', 'data-kb': 'maquettes-add', onSubmit: (e) => { e.preventDefault(); add() } },
              h('input', { className: 'kbmq-input', 'data-kb': 'maquettes-path', value: path, spellCheck: false, autoComplete: 'off', placeholder: kt('Chemin complet du dossier, ex. ~/Documents/ma-maquette', 'Full path of the folder, e.g. ~/Documents/my-mockup'), 'aria-label': kt('Chemin du dossier de la maquette', 'Path of the mockup’s folder'), onChange: (e) => setPath(e.target.value) }),
              h('button', { type: 'submit', className: 'kbmq-btn primary', 'data-act': 'add', disabled: busy || path.trim() === '' }, h(Icon, { d: ICON.plus, size: 15 }), kt('Ajouter', 'Add'))),
            error !== '' ? h('div', { className: 'kbmq-banner', role: 'alert', 'data-kb': 'maquettes-error' }, error) : null,
            body)
        }
        return Page
      }

      // ── styles: DSH's tokens only ─────────────────────────────────────────────────────────────────────
      const CSS = `
        .kbmq{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45}
        .kbmq *{box-sizing:border-box}
        .kbmq button,.kbmq input{font:inherit}
        .kbmq :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        .kbmq-edit{height:calc(100vh - 120px);min-height:420px}
        .kbmq-titlerow{display:flex;align-items:center;gap:8px}
        .kbmq-muted{color:var(--dsw-alias-label-tertiary)}
        .kbmq-path{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .kbmq-add{display:flex;gap:8px;flex-wrap:wrap}
        .kbmq-input{flex:1 1 280px;min-width:0;height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary)}
        .kbmq-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-weight:550;cursor:pointer;transition:background .15s,transform .14s}
        .kbmq-btn:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbmq-btn:active{transform:scale(.97)}
        .kbmq-btn.sm{height:30px;padding:0 11px;font-size:12px}
        .kbmq-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:650}
        .kbmq-btn.primary:hover{filter:brightness(.96)}
        .kbmq-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
        .kbmq-btn[disabled]{opacity:.5;cursor:not-allowed}
        .kbmq-ib{display:inline-grid;place-items:center;width:32px;height:32px;flex:none;border-radius:50%;border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .15s,color .15s}
        .kbmq-ib:hover{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary)}
        .kbmq-banner{padding:10px 14px;border-radius:10px;border:1px solid var(--dsw-alias-state-warn-primary);background:var(--dsw-alias-bg-layer-1,transparent)}
        .kbmq-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
        .kbmq-card{display:flex;flex-direction:column;gap:8px;padding:14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1,transparent);min-width:0}
        .kbmq-cardhead{display:flex;align-items:center;gap:10px;min-width:0}
        .kbmq-name{display:flex;flex-direction:column;min-width:0}
        .kbmq-tile{display:inline-grid;place-items:center;width:34px;height:34px;flex:none;border-radius:10px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
        .kbmq-card p{margin:0}
        .kbmq-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:2px}
        .kbmq-confirm{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
        .kbmq-empty{padding:28px 8px;max-width:560px}
        .kbmq-empty h2{margin:0 0 6px;font-size:16px}
        .kbmq-empty p{margin:0;color:var(--dsw-alias-label-secondary)}
        .kbmq-pages{display:flex;gap:6px;flex-wrap:wrap}
        .kbmq-tab{height:30px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
        .kbmq-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
        .kbmq-tab[aria-selected="true"]{background:var(--dsw-alias-label-primary);border-color:transparent;color:var(--dsw-alias-bg-layer-1,#fff)}
        .kbmq-frame{flex:1 1 auto;min-height:0;width:100%;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:#fff}
        @media (prefers-reduced-motion:reduce){.kbmq-btn,.kbmq-ib{transition:none}}
      `

      // ── the plugin ──────────────────────────────────────────────────────────────────────────────────────────────────────
      // A source of Creations: one item per registered folder, opened on the page. While it is declared the core takes the menu row out (`foldsRow`); `home` is the way
      // into the page when there is no folder yet.
      const creationSource = () => {
        const openPage = () => { try { if (typeof window.__KB_OPEN__ === 'function') window.__KB_OPEN__({ view: ROW_ID }) } catch (e) { /* the page cannot be reached */ } }
        return {
          id: 'maquettes',
          label: { en: 'Mockups', fr: 'Maquettes' },
          desc: { en: 'Screens drawn in HTML that you edit by clicking on them: text, colours, blocks, pictures.', fr: 'Des écrans dessinés en HTML que tu modifies en cliquant dessus : textes, couleurs, blocs, images.' },
          art: 'website',
          order: 30,
          foldsRow: ROW_ID,
          load: async () => {
            const r = await getJson('/folders')
            const list = r.ok && Array.isArray(r.folders) ? r.folders : []
            return list.filter((f) => plain(f) && typeof f.id === 'string' && Array.isArray(f.pages)).map((f) => ({
              id: f.id,
              title: String(f.name || f.id),
              sub: f.pages.length + ' ' + (f.pages.length === 1 ? 'page' : 'pages'),
              mtimeMs: null,
            }))
          },
          open: openPage,
          home: openPage,
        }
      }

      // Declared once the core's registry is there: the order in which two plugins are applied is DSH's, so a registry is waited for, not assumed.
      const declareWhenReady = (ctx, label, registry, entry) => ctx.effect(() => {
        let off = null
        let timer = null
        let tries = 0
        const declare = () => {
          timer = null
          try {
            const reg = window[registry]
            if (reg && typeof reg.register === 'function') { off = reg.register(entry()); return }
          } catch (e) { return }
          tries += 1
          if (tries < MENU_TRIES) timer = setTimeout(declare, MENU_WAIT_MS)
        }
        declare()
        return () => {
          try { if (timer !== null) clearTimeout(timer) } catch (e) { /* no timers */ }
          timer = null
          tries = MENU_TRIES
          try { if (typeof off === 'function') off() } catch (e) { /* already taken back */ }
          off = null
        }
      }, label)

      const start = (ctx) => {
        try {
          const React = require('react')
          const slots = ctx.slots
          if (slots === null || slots === undefined || typeof slots.inject !== 'function') return
          const Page = build(React)
          declareWhenReady(ctx, 'kybernos-maquettes: menu row', '__KB_MENU__', () => ({ id: ROW_ID, group: 'business', icon: 'folder', label: { en: 'Mockups', fr: 'Maquettes' }, order: 50 }))
          ctx.effect(() => slots.inject(SLOT, () => slots.register({ name: SLOT, key: ROW_ID }, Page)), 'kybernos-maquettes: page')
          declareWhenReady(ctx, 'kybernos-maquettes: Creations source', '__KB_CREATIONS__', creationSource)
        } catch (e) { console.warn('[kybernos-maquettes] page not mounted:', e) }
      }

      return {
        name: NAME,
        inject: ['slots'],
        apply: start,
        __test: { handleBridge, askSentence, errorText, creationSource, kvOf, kvKey, KV, lang, kt, build, CSS, ROW_ID, SLOT, SANDBOX, API_OPS, MAX_IMAGE },
      }
    } catch (e) {
      console.warn('[kybernos-maquettes] disabled:', e)
      return { apply () {} }
    }
  }
})
