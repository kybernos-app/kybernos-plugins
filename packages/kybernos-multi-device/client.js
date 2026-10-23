// ═══════════════════════════════════════════════════════
// kybernos-multi-device — browser half.
//
// A workspace may have a folder of the computer, or not. DSH's workspace IS a directory, so "no folder" means a private folder the
// host creates for the person under <Documents>/Kybernos. Three things live here:
//
//   1. ONE dialog, "Sans dossier / Un dossier de mon ordinateur", with two entrances:
//        · the "Create" button of the Projects page (the core bundle calls `choose()` through the seam below);
//        · DSH's own "add a workspace" flow (the sidebar "+" and the empty-chat picker), by sitting in front of
//          its two `directoryFlow` slots at priority -1. If this bundle fails, the native picker takes over.
//   2. The seam `globalThis[Symbol.for('kybernos.multiDevice')]` the core bundle reads: `choose()` and
//      `detailsExtras()` (the "Dossier de travail" row of the Details tab, and the body of the "Appareils" tab).
//   3. A preview, greyed on purpose, of what the next versions will let a person choose: where commands run, and
//      which devices see a project. Nothing in the preview changes anything.
//
// Everything is wrapped in try/catch: this bundle is optional, never the reason a page fails to load.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-multi-device',
  factory: (require) => {
    const NAME = 'kybernos-multi-device'
    try {
      const React = require('react')
      const ReactDOM = (() => { try { return require('react-dom') } catch (e) { return null } })()
      const h = React.createElement
      const SEAM = Symbol.for('kybernos.multiDevice')
      const ROUTE = '/kybernos-multi-device'

      // French only when the resolved language IS French (the 'kybernos' default or a fr base); everything else, and a language
      // not known yet, gets English.
      const lang = () => {
        try {
          const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
          const s = String(l || '')
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }

      // ── strings: [French, English], same placeholders on both sides ──────────────────────────────────────
      const S = {
        newTitle: ['Nouveau workspace', 'New workspace'],
        nameLabel: ['Nom du workspace', 'Workspace name'],
        namePlaceholder: ['Par exemple : Notes TVA', 'For example: VAT notes'],
        folderLabel: ['Dossier de travail', 'Working folder'],
        noneTitle: ['Sans dossier', 'No folder'],
        noneSub: ['Un dossier privé est créé pour toi : {path}', 'A private folder is created for you: {path}'],
        folderTitle: ['Un dossier de mon ordinateur', 'A folder on my computer'],
        folderSub: ["L'IA travaille sur les vrais fichiers du dossier.", 'The AI works on the real files in the folder.'],
        folderOther: ['Choisir un autre dossier…', 'Choose another folder…'],
        folderNameNote: ['Le workspace porte le nom du dossier.', "The workspace takes the folder's name."],
        fixedNote: ['Le dossier est choisi maintenant. Pour travailler dans un autre dossier, crée un autre workspace.', 'The folder is chosen now. To work in another folder, create another workspace.'],
        cancel: ['Annuler', 'Cancel'],
        create: ['Créer le workspace', 'Create workspace'],
        creating: ['Création…', 'Creating…'],
        errExists: ['Un dossier porte déjà ce nom dans {root}. Choisis un autre nom.', 'A folder with this name already exists in {root}. Pick another name.'],
        errForbidden: ['Ce nom contient un caractère interdit ( / \\ : * ? " < > | ).', 'This name contains a forbidden character ( / \\ : * ? " < > | ).'],
        errDots: ['Le nom ne peut pas commencer ni finir par un point.', 'The name cannot start or end with a dot.'],
        errReserved: ['Ce nom est réservé par le système.', 'This name is reserved by the system.'],
        errTooLong: ['Le nom est trop long (80 caractères au plus).', 'The name is too long (80 characters at most).'],
        errNotAllowed: ["Kybernos n'a pas le droit de créer ce dossier.", 'Kybernos is not allowed to create this folder.'],
        errGeneric: ["Le dossier n'a pas pu être créé.", 'The folder could not be created.'],
        errNoPicker: ['Le sélecteur de dossier est indisponible ici.', 'The folder picker is not available here.'],
        // details: the folder card
        dossierCap: ['Dossier de travail', 'Working folder'],
        dossierPrivate: ['Dossier privé', 'Private folder'],
        dossierReal: ["Dossier de l'ordinateur", 'Folder on the computer'],
        dossierHintReal: ["L'IA lit et modifie les fichiers de ce dossier.", 'The AI reads and edits the files in this folder.'],
        dossierHintPrivate: ["Aucun dossier de ton ordinateur : l'IA travaille dans un dossier privé, créé dans {root}. Tu peux y déposer tes fichiers.", 'No folder of your computer: the AI works in a private folder, created in {root}. You can drop your own files there.'],
        dossierFixed: ['Le dossier est choisi à la création. Pour travailler dans un autre dossier, crée un autre workspace.', 'The folder is chosen at creation. To work in another folder, create another workspace.'],
        // the Devices tab
        todayCap: ["Aujourd'hui : le téléphone", 'Today: the phone'],
        todayFlag: ['Existe déjà', 'Exists today'],
        todayTitle: ["Accès direct à l'ordinateur", 'Direct access to the computer'],
        todayBody: ["Le lien téléphone (plans payants) n'est pas une copie : il ouvre la page de ton ordinateur en direct, chiffrée de bout en bout.", 'The phone link (paid plans) is not a copy: it opens your computer’s own page live, end-to-end encrypted.'],
        todayNote: ["Il voit tous les workspaces de l'ordinateur, pas un seul. L'ordinateur doit être allumé : il n'y a pas de file d'attente. Certaines actions lui sont refusées : clés, réglages, plugins, terminal.", 'It sees every workspace of the computer, not just one. The computer must be on: there is no queue. Some actions are refused to it: keys, settings, plugins, terminal.'],
        soon: ['Bientôt · aperçu', 'Soon · preview'],
        execCap: ['Exécution', 'Execution'],
        execIntro: ['Où les commandes de ce workspace tournent par défaut. Une discussion pourra en choisir un autre depuis son composer.', "Where this workspace's commands run by default. A chat will be able to pick another one from its composer."],
        execMac: ['Cet ordinateur', 'This computer'],
        execMacSub: ['Les commandes tournent dans le dossier du workspace.', "Commands run in the workspace's folder."],
        execE2b: ['Sandbox E2B', 'E2B sandbox'],
        execE2bSub: ["MicroVM cloud éphémère avec ta clé E2B : 15 min par défaut, 2 h au plus. Ce qui n'est pas récupéré avant l'arrêt est perdu.", 'Ephemeral cloud microVM with your own E2B key: 15 min by default, 2 h at most. Whatever is not retrieved before it stops is lost.'],
        execHosted: ['Kybernos hébergé', 'Kybernos hosted'],
        execHostedSub: ["L'agent tourne sur un DSH hébergé par Kybernos. Il ne voit pas le dossier du workspace.", 'The agent runs on a DSH hosted by Kybernos. It cannot see the workspace folder.'],
        execNow: ["Aujourd'hui ce choix est global : le menu « Cet ordinateur / E2B » de l'application et la pastille du composer web.", 'Today this choice is global: the “This machine / E2B” menu of the app and the pill of the web composer.'],
        devCap: ['Appareils', 'Devices'],
        devSwitch: ['Synchroniser avec mes autres appareils', 'Sync with my other devices'],
        devSwitchSub: ["Tu choisiras, appareil par appareil, ce qu'il voit et ce qu'il peut envoyer.", 'You will choose, device by device, what it sees and what it may send.'],
        devNone: ['Aucun', 'None'],
        devView: ['Voir', 'View'],
        devSend: ['Voir et envoyer', 'View and send'],
        devThis: ['Cet ordinateur', 'This computer'],
        devThisSub: ['Source des fichiers', 'Holds the files'],
        devPhone: ['Téléphone', 'Phone'],
        devWeb: ['kybernos.app', 'kybernos.app'],
        devShows: ['Ce que « voir » montre', 'What “view” shows'],
        devTitles: ['Titres', 'Titles'],
        devMessages: ['Titres et messages', 'Titles and messages'],
        devGuard: ["Un appareil qui envoie ne pourra pas relever la permission : « Accès complet » se règle sur l'ordinateur. Ce qui a attendu pendant que l'ordinateur dormait ne s'exécutera pas sans confirmation au réveil.", 'A device that sends will not be able to raise the permission: “Full access” is set on the computer. Whatever waited while the computer slept will not run without confirmation on wake-up.'],
        devFiles: ['Les fichiers du dossier ne suivent jamais : ils restent sur l\'ordinateur qui les porte. Un nouvel appareil n\'a aucun accès tant que tu ne le choisis pas.', 'The folder’s files never travel: they stay on the computer that holds them. A new device has no access until you choose it.'],
      }
      const L = (k, vars) => {
        const pair = S[k]
        let t = Array.isArray(pair) ? pair[lang() === 'en' ? 1 : 0] : String(k)
        if (vars) for (const key of Object.keys(vars)) t = t.split('{' + key + '}').join(String(vars[key]))
        return t
      }

      // ── the name rule: the SAME as the host's validName (test-client.mjs compares them) ─────────────────────
      const NAME_MAX = 80
      const FORBIDDEN = /[\u0000-\u001f\u007f/\\:*?"<>|]/
      const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
      const validName = (raw) => {
        if (typeof raw !== 'string') return { ok: false, reason: 'empty' }
        const nfc = raw.normalize('NFC')
        if (FORBIDDEN.test(nfc)) return { ok: false, reason: 'forbidden-char' }
        const name = nfc.replace(/ +/g, ' ').trim()
        if (name === '') return { ok: false, reason: 'empty' }
        if (name.length > NAME_MAX) return { ok: false, reason: 'too-long' }
        if (name.startsWith('.') || name.endsWith('.')) return { ok: false, reason: 'dots' }
        if (RESERVED.test(name)) return { ok: false, reason: 'reserved' }
        return { ok: true, name }
      }
      const reasonText = (reason) => ({
        'forbidden-char': L('errForbidden'), dots: L('errDots'), reserved: L('errReserved'), 'too-long': L('errTooLong'),
      }[reason] || null)

      // ── paths: what the host said about the root ─────────────────────────────────────────────────────────
      const under = (path, root) => typeof path === 'string' && typeof root === 'string' && root !== '' &&
        (path === root || path.startsWith(root + '/') || path.startsWith(root + '\\'))
      const homeOf = (st) => {
        if (st === null || st === undefined || typeof st.root !== 'string' || typeof st.rootDisplay !== 'string' || !st.rootDisplay.startsWith('~')) return null
        const tail = st.rootDisplay.slice(1)
        return st.root.endsWith(tail) ? st.root.slice(0, st.root.length - tail.length) : null
      }
      const showPath = (path, st) => {
        const home = homeOf(st)
        if (typeof path !== 'string') return ''
        if (home !== null && home !== '' && under(path, home)) return '~' + path.slice(home.length).split('\\').join('/')
        return path
      }
      const isPrivate = (path, st) => st !== null && st !== undefined && under(path, st.root)

      // ── talking to the host ──────────────────────────────────────────────────────────────────────────────
      let statusCache = null
      let statusPending = null
      const loadStatus = () => {
        if (statusCache !== null) return Promise.resolve(statusCache)
        if (statusPending !== null) return statusPending
        statusPending = fetch(ROUTE + '/status', { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((j) => { statusPending = null; if (j && j.ok === true && typeof j.root === 'string') { statusCache = j; return j } return null })
          .catch(() => { statusPending = null; return null })
        return statusPending
      }
      const createPrivate = (name) => fetch(ROUTE + '/private-folder', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
      }).then((r) => r.json().then((j) => ({ status: r.status, json: j }), () => ({ status: r.status, json: null })))

      // The native directory chooser, exactly as DSH's own occupant reaches it.
      let ctxRef = null
      const pickNative = () => {
        const desktop = globalThis.__DSH_DIRECTORY_PICKER__
        if (desktop !== undefined && desktop !== null && typeof desktop.pick === 'function') return desktop.pick()
        const ui = ctxRef !== null && typeof ctxRef.get === 'function' ? ctxRef.get('uiWorkspace') : null
        if (ui !== null && ui !== undefined && typeof ui.pickDirectory === 'function') return ui.pickDirectory()
        return Promise.reject(new Error(L('errNoPicker')))
      }

      // ── the dialog's store: one dialog, whichever entrance asked ─────────────────────────────────────────
      const store = { open: false, resolve: null, subs: new Set(), hosts: [] }
      const emit = () => { store.subs.forEach((f) => { try { f() } catch (e) { /* a dead subscriber */ } }) }
      let pending = null
      const settle = (value) => {
        const r = store.resolve
        store.open = false
        store.resolve = null
        pending = null
        emit()
        if (typeof r === 'function') r(value)
      }
      /** Resolves a folder path, or null when the person cancels. Rejects only when no component can show the dialog. */
      const choose = () => {
        if (pending !== null) return pending
        if (store.hosts.length === 0) return Promise.reject(new Error('no-host'))
        pending = new Promise((resolve) => { store.resolve = resolve; store.open = true; emit() })
        return pending
      }

      const baseName = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || ''

      // ── the dialog ───────────────────────────────────────────────────────────────────────────────────────
      const Dialog = () => {
        const [name, setName] = React.useState('')
        const [mode, setMode] = React.useState('none')
        const [folder, setFolder] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [err, setErr] = React.useState(null)
        const [st, setSt] = React.useState(statusCache)
        const inputRef = React.useRef(null)
        React.useEffect(() => { let alive = true; loadStatus().then((s) => { if (alive) setSt(s) }); return () => { alive = false } }, [])
        React.useEffect(() => { try { if (inputRef.current) inputRef.current.focus() } catch (e) { /* no focus */ } }, [])
        React.useEffect(() => {
          const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); settle(null) } }
          document.addEventListener('keydown', onKey, true)
          return () => document.removeEventListener('keydown', onKey, true)
        }, [])

        const rootShown = st !== null && st !== undefined ? st.rootDisplay : '~/Documents/Kybernos'
        const checked = validName(name)
        const nameErr = name.trim() !== '' && !checked.ok ? reasonText(checked.reason) : null
        const canCreate = !busy && (mode === 'none' ? checked.ok : folder !== null)

        const pick = async () => {
          setErr(null)
          try {
            const p = await pickNative()
            if (typeof p === 'string' && p.length > 0) { setFolder(p); setMode('folder') }
          } catch (e) { setErr(String((e && e.message) || e)) }
        }
        const submit = async () => {
          if (!canCreate) return
          setErr(null)
          if (mode === 'folder') { settle(folder); return }
          setBusy(true)
          try {
            const r = await createPrivate(checked.name)
            const j = r.json || {}
            if (r.status === 200 && j.ok === true && typeof j.path === 'string') { settle(j.path); return }
            if (r.status === 409) setErr(L('errExists', { root: rootShown }))
            else if (r.status === 400 && reasonText(j.reason) !== null) setErr(reasonText(j.reason))
            else if (r.status === 403) setErr(L('errNotAllowed'))
            else setErr(L('errGeneric'))
          } catch (e) { setErr(L('errGeneric')) }
          setBusy(false)
        }

        const radio = (id, title, sub) => h('button', {
          type: 'button', className: 'kbmd-opt', 'data-kb': 'kybernos-multi-device-opt-' + id, 'aria-pressed': mode === id ? 'true' : 'false',
          onClick: () => { if (id === 'folder') { if (folder === null) pick(); else setMode('folder') } else setMode('none') },
        },
          h('span', { className: 'kbmd-radio', 'aria-hidden': 'true' }),
          h('span', { className: 'kbmd-ot' }, h('b', null, title), h('span', { className: 'kbmd-sub' }, sub)))

        const body = h('div', { className: 'kbmd-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': L('newTitle'), 'data-kb': 'kybernos-multi-device-dialog' },
          h('h3', { className: 'kbmd-h' }, L('newTitle')),
          h('label', { className: 'kbmd-lb', htmlFor: 'kbmd-name' }, L('nameLabel')),
          h('input', {
            id: 'kbmd-name', ref: inputRef, className: 'kbmd-input', type: 'text', autoComplete: 'off', 'data-kb': 'kybernos-multi-device-name',
            value: mode === 'folder' && folder !== null ? baseName(folder) : name, disabled: mode === 'folder',
            placeholder: L('namePlaceholder'),
            onChange: (e) => { setName(e.target.value); setErr(null) },
            onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } },
          }),
          (nameErr !== null ? h('div', { className: 'kbmd-err', role: 'alert' }, nameErr) : null),
          h('span', { className: 'kbmd-lb' }, L('folderLabel')),
          radio('none', L('noneTitle'), L('noneSub', { path: rootShown + '/' + (checked.ok ? checked.name : '…') })),
          radio('folder', L('folderTitle'), mode === 'folder' && folder !== null ? showPath(folder, st) : L('folderSub')),
          (mode === 'folder' && folder !== null
            ? h('div', { className: 'kbmd-row' }, h('span', { className: 'kbmd-sub' }, L('folderNameNote')),
              h('button', { type: 'button', className: 'kbmd-link', 'data-act': 'other-folder', onClick: pick }, L('folderOther')))
            : null),
          h('div', { className: 'kbmd-info' }, L('fixedNote')),
          (err !== null ? h('div', { className: 'kbmd-err', role: 'alert', 'data-kb': 'kybernos-multi-device-error' }, err) : null),
          h('div', { className: 'kbmd-actions' },
            h('button', { type: 'button', className: 'kbmd-btn', 'data-act': 'cancel', onClick: () => settle(null) }, L('cancel')),
            h('button', { type: 'button', className: 'kbmd-btn kbmd-primary', 'data-act': 'confirm', disabled: !canCreate, onClick: submit }, busy ? L('creating') : L('create'))))
        const layer = h('div', { className: 'kbmd-scrim', 'data-kb': 'kybernos-multi-device-scrim', onMouseDown: (e) => { if (e.target === e.currentTarget && !busy) settle(null) } }, body)
        const canPortal = ReactDOM !== null && typeof ReactDOM.createPortal === 'function' && typeof document !== 'undefined' && document.body
        return canPortal ? ReactDOM.createPortal(layer, document.body) : layer
      }

      // ── the occupant of DSH's directoryFlow slots ────────────────────────────────────────────────────────
      let seq = 0
      const Flow = (props) => {
        const idRef = React.useRef(null)
        if (idRef.current === null) { seq += 1; idRef.current = 'flow-' + seq }
        const id = idRef.current
        const [, tick] = React.useState(0)
        const armed = React.useRef(false)
        const live = React.useRef(true)
        const cb = React.useRef(props)
        cb.current = props
        React.useEffect(() => {
          live.current = true
          store.hosts.push(id)
          const sub = () => tick((n) => n + 1)
          store.subs.add(sub)
          tick((n) => n + 1)
          return () => {
            live.current = false
            store.hosts = store.hosts.filter((x) => x !== id)
            store.subs.delete(sub)
            if (store.hosts.length === 0 && store.open) settle(null)
            else emit()
          }
        }, [])
        const open = props !== null && props !== undefined && props.open === true
        React.useEffect(() => {
          if (!open) { armed.current = false; return }
          if (armed.current) return
          armed.current = true
          choose().then((p) => {
            if (!live.current) return
            if (p === null || p === undefined) cb.current.onCancel()
            else cb.current.onPicked(p)
          }, (e) => {
            if (!live.current) return
            cb.current.onError(String((e && e.message) || e))
          })
        }, [open])
        return store.hosts[0] === id && store.open ? h(Dialog, null) : null
      }

      // ── the extras of the project page: the folder row of the Details tab, and the body of the Devices tab ──
      const Extras = (props) => {
        const [st, setSt] = React.useState(statusCache)
        React.useEffect(() => { let alive = true; loadStatus().then((s) => { if (alive) setSt(s) }); return () => { alive = false } }, [])
        const part = props && typeof props.part === 'string' ? props.part : null
        const path = props && typeof props.path === 'string' ? props.path : null
        const priv = path !== null && isPrivate(path, st)
        const rootShown = st !== null && st !== undefined ? st.rootDisplay : '~/Documents/Kybernos'
        const icon = (d) => h('svg', { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d }))
        const FOLDER = 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z'

        // One row, no card of its own: the core wraps it in the Details card, next to the name and the look.
        const folderCard = path === null ? null : h('div', { className: 'kbmd-folder', 'data-kb': 'kybernos-multi-device-folder' },
          h('span', { className: 'kbmd-cap' }, L('dossierCap'),
            (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-multi-device' }) : null)),
          h('div', { className: 'kbmd-where kbmd-row1' },
            h('span', { className: 'kbmd-ico' + (priv ? ' kbmd-priv' : '') }, icon(FOLDER)),
            h('span', { className: 'kbmd-txt' }, h('b', null, priv ? L('dossierPrivate') : L('dossierReal')), h('span', { className: 'kbmd-path' }, showPath(path, st))),
            h('span', { className: 'kbmd-hint' }, (priv ? L('dossierHintPrivate', { root: rootShown }) : L('dossierHintReal')) + ' ' + L('dossierFixed'))))

        const lvl = (items, on) => h('span', { className: 'kbmd-lvl' }, items.map((it, i) => h('span', { key: i, className: i === on ? 'kbmd-on' : null }, it)))
        const opt = (title, sub, on) => h('div', { className: 'kbmd-ropt' + (on ? ' kbmd-ron' : '') },
          h('span', { className: 'kbmd-radio', 'aria-hidden': 'true' }), h('span', { className: 'kbmd-ot' }, h('b', null, title), h('span', { className: 'kbmd-sub' }, sub)))
        const dev = (title, sub, right) => h('div', { className: 'kbmd-dev' },
          h('span', { className: 'kbmd-ot' }, h('b', null, title), h('span', { className: 'kbmd-sub' }, sub)), right)

        const today = h('div', { className: 'kbmd-card kbmd-today', 'data-kb': 'kybernos-multi-device-today' },
          h('div', { className: 'kbmd-todaytxt' },
            h('span', { className: 'kbmd-cap' }, L('todayCap'), ' ', h('span', { className: 'kbmd-flag kbmd-okflag' }, L('todayFlag'))),
            h('b', null, L('todayTitle')),
            h('span', { className: 'kbmd-sub' }, L('todayBody'))),
          h('div', { className: 'kbmd-info' }, L('todayNote')))
        const exec = h('div', { className: 'kbmd-card kbmd-locked', 'aria-disabled': 'true', 'data-kb': 'kybernos-multi-device-exec' },
          h('span', { className: 'kbmd-cap' }, L('execCap'), ' ', h('span', { className: 'kbmd-flag' }, L('soon'))),
          h('div', { className: 'kbmd-body' },
            h('span', { className: 'kbmd-sub' }, L('execIntro')),
            opt(L('execMac'), L('execMacSub'), true),
            opt(L('execE2b'), L('execE2bSub'), false),
            opt(L('execHosted'), L('execHostedSub'), false),
            h('div', { className: 'kbmd-info' }, L('execNow'))))
        const devices = h('div', { className: 'kbmd-card kbmd-locked', 'aria-disabled': 'true', 'data-kb': 'kybernos-multi-device-devices' },
          h('span', { className: 'kbmd-cap' }, L('devCap'), ' ', h('span', { className: 'kbmd-flag' }, L('soon'))),
          h('div', { className: 'kbmd-body' },
            h('div', { className: 'kbmd-sw' }, h('span', { className: 'kbmd-switch', 'aria-hidden': 'true' }),
              h('span', { className: 'kbmd-ot' }, h('b', null, L('devSwitch')), h('span', { className: 'kbmd-sub' }, L('devSwitchSub')))),
            h('div', { className: 'kbmd-devs' },
              dev(L('devThis'), L('devThisSub'), null),
              dev(L('devPhone'), '', lvl([L('devNone'), L('devView'), L('devSend')], 2)),
              dev(L('devWeb'), '', lvl([L('devNone'), L('devView'), L('devSend')], 1))),
            h('div', { className: 'kbmd-shows' }, h('span', { className: 'kbmd-sub' }, L('devShows')), lvl([L('devTitles'), L('devMessages')], 0)),
            h('div', { className: 'kbmd-info' }, L('devGuard')),
            h('div', { className: 'kbmd-info' }, L('devFiles'))))

        // `part`: 'folder' is the row of the Details tab, 'devices' the body of the Devices tab (today's phone card, then the two previews side by side).
        const devicesBody = h('div', { className: 'kbmd-root', 'data-kb': 'kybernos-multi-device-extras' }, today, h('div', { className: 'kbmd-pair' }, exec, devices))
        if (part === 'folder') return folderCard
        if (part === 'devices') return devicesBody
        return h('div', { className: 'kbmd-root', 'data-kb': 'kybernos-multi-device-extras' }, folderCard, devicesBody)
      }

      const CSS = `
.kbmd-root{display:flex;flex-direction:column;gap:14px;min-width:0}
.kbmd-card{background:var(--dsw-alias-bg-layer-1,transparent);border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:11px;min-width:0}
.kbmd-cap{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#8a8a93);display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kbmd-flag{letter-spacing:0;text-transform:none;font-size:11px;font-weight:600;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:999px;padding:1px 8px;color:var(--dsw-alias-label-secondary,#a0a0aa)}
.kbmd-okflag{border-color:var(--dsw-alias-state-success-primary,#22c55e);color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbmd-sub{font-size:13px;color:var(--dsw-alias-label-secondary,#a0a0aa);overflow-wrap:anywhere}
.kbmd-info{font-size:13px;color:var(--dsw-alias-label-secondary,#a0a0aa);background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));border-radius:10px;padding:9px 11px}
.kbmd-where{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.kbmd-ico{width:40px;height:40px;flex:0 0 40px;border-radius:12px;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.15));color:var(--dsw-alias-brand-primary,currentColor)}
.kbmd-priv{color:var(--dsw-alias-label-secondary,#a0a0aa)}
.kbmd-txt{display:flex;flex-direction:column;min-width:0;flex:1}
.kbmd-txt b{color:var(--dsw-alias-label-primary,inherit);font-weight:600}
.kbmd-path{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary,inherit)}
.kbmd-folder{display:flex;flex-direction:column;gap:6px;min-width:0}
.kbmd-folder>.kbmd-cap{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary,#a0a0aa)}
.kbmd-row1{padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25))}
.kbmd-row1 .kbmd-ico{width:36px;height:36px;flex-basis:36px;border-radius:10px}
.kbmd-row1 .kbmd-txt{flex:1 1 180px}
.kbmd-hint{font-size:12px;line-height:1.45;color:var(--dsw-alias-label-tertiary,#8a8a93);flex:1 1 240px;max-width:380px;min-width:0;margin-inline-start:auto}
.kbmd-today{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;align-items:start}
.kbmd-todaytxt{display:flex;flex-direction:column;gap:8px;min-width:0}
.kbmd-pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px;align-items:start}
.kbmd-locked{border-style:dashed}
.kbmd-locked .kbmd-body{opacity:.55;pointer-events:none;user-select:none;display:flex;flex-direction:column;gap:11px}
.kbmd-ropt{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:12px;padding:12px}
.kbmd-ron{border-color:var(--dsw-alias-brand-primary,currentColor)}
.kbmd-radio{flex:0 0 18px;height:18px;border-radius:50%;border:2px solid var(--dsw-alias-border-l2,rgba(127,127,127,.5));margin-top:2px;box-sizing:border-box}
.kbmd-ron .kbmd-radio,.kbmd-opt[aria-pressed='true'] .kbmd-radio{border-color:var(--dsw-alias-brand-primary,currentColor);background:radial-gradient(circle,var(--dsw-alias-brand-primary,currentColor) 0 40%,transparent 45%)}
.kbmd-ot{display:flex;flex-direction:column;min-width:0;gap:2px}
.kbmd-ot b{font-weight:600;color:var(--dsw-alias-label-primary,inherit)}
.kbmd-sw{display:flex;gap:12px;align-items:flex-start}
.kbmd-switch{flex:0 0 44px;width:44px;height:26px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-brand-primary,#6a4fd8);position:relative}
.kbmd-switch::after{content:'';position:absolute;top:2px;left:20px;width:20px;height:20px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground,#fff)}
.kbmd-devs{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:12px;overflow:hidden}
.kbmd-dev{display:flex;gap:12px;align-items:center;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));flex-wrap:wrap;justify-content:space-between}
.kbmd-dev:first-child{border-top:0}
.kbmd-lvl{display:inline-flex;flex-wrap:wrap;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.25));border-radius:9px;padding:2px;gap:2px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.12))}
.kbmd-lvl span{padding:3px 9px;border-radius:7px;font-size:12px;font-weight:500;color:var(--dsw-alias-label-secondary,#a0a0aa)}
.kbmd-lvl .kbmd-on{background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,inherit);box-shadow:0 0 0 1px var(--dsw-alias-border-l2,rgba(127,127,127,.35))}
.kbmd-shows{display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.kbmd-scrim{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);display:grid;place-items:center;padding:16px}
.kbmd-dialog{width:min(480px,100%);max-height:100%;overflow:auto;background:var(--dsw-alias-bg-layer-1,#1b1b1c);color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:18px;padding:20px;display:flex;flex-direction:column;gap:12px;box-sizing:border-box}
.kbmd-h{margin:0;font-size:17px;font-weight:600}
.kbmd-lb{font-size:12.5px;font-weight:500;color:var(--dsw-alias-label-secondary,#a0a0aa)}
.kbmd-input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-2,transparent);color:var(--dsw-alias-label-primary,inherit);border-radius:10px;padding:10px 12px;font:inherit}
.kbmd-input:disabled{opacity:.7}
.kbmd-input::placeholder{color:var(--dsw-alias-label-tertiary)}
body:not([data-ds-dark-theme]) .kbmd-input::placeholder{color:var(--dsw-alias-label-secondary)}
.kbmd-opt{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:start;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));border-radius:12px;padding:12px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.kbmd-opt[aria-pressed='true']{border-color:var(--dsw-alias-brand-primary,currentColor)}
.kbmd-link{border:0;background:transparent;padding:0;font:inherit;color:var(--dsw-alias-brand-primary,currentColor);text-decoration:underline;cursor:pointer;font-size:13px}
.kbmd-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.kbmd-err{color:var(--dsw-alias-state-error-primary,#f25a5a);font-size:12.5px}
.kbmd-actions{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}
.kbmd-btn{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:transparent;color:inherit;border-radius:10px;padding:8px 14px;font:inherit;font-weight:500;cursor:pointer}
.kbmd-primary{background:var(--dsw-alias-brand-primary,#6a4fd8);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.kbmd-btn:disabled{opacity:.45;cursor:not-allowed}
.kbmd-btn:focus-visible,.kbmd-opt:focus-visible,.kbmd-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,currentColor);outline-offset:2px}
`

      // ── the seam the core bundle reads ───────────────────────────────────────────────────────────────────
      const api = {
        version: 1,
        choose,
        detailsExtras: (opts) => h(Extras, {
          part: opts && typeof opts.part === 'string' ? opts.part : null,
          path: opts && typeof opts.path === 'string' ? opts.path : null,
        }),
      }

      return {
        name: NAME,
        inject: ['slots'],
        apply (ctx) {
          ctxRef = ctx
          const safe = (label, fn) => { try { ctx.effect(fn, label) } catch (e) { console.warn('[' + NAME + '] ' + label + ': ' + String((e && e.message) || e)) } }
          safe(NAME + ': styles', () => {
            const tag = document.createElement('style')
            tag.setAttribute('data-plugin', '@local/' + NAME)
            tag.textContent = CSS
            document.head.appendChild(tag)
            return () => { try { tag.remove() } catch (e) { /* gone */ } }
          })
          safe(NAME + ': seam for the core bundle', () => {
            globalThis[SEAM] = api
            return () => { try { if (globalThis[SEAM] === api) delete globalThis[SEAM] } catch (e) { /* gone */ } }
          })
          // In front of DSH's native occupant (priority 0): the lowest priority renders. If this component throws, the slot
          // retires it and the native picker takes over.
          for (const slot of ['conversation.hero.workspace.directoryFlow', 'sidebar.workspaces.directoryFlow']) {
            safe(NAME + ': directory flow ' + slot, () => ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, priority: -1 }, Flow)))
          }
        },
        __test: { S, L, CSS, validName, homeOf, showPath, isPrivate, under, NAME_MAX, store, choose, settle, api, reasonText },
      }
    } catch (e) {
      console.warn('[' + NAME + '] disabled:', e)
      return { apply () {} }
    }
  },
})
