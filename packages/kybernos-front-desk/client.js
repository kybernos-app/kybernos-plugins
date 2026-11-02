// ═══════════════════════════════════════════════════════
// kybernos-front-desk — browser half: the « Front desk » page of the « Business » group.
//
// The public assistant of the person's shop: a chat their visitors reach on a link, a widget on their site or a Telegram bot. This page is where they set it up and run it.
// Three tabs: Setup (start and stop the service, the model it uses, the public address, Telegram, the links to share), Atelier (what the assistant is told and may do: draft,
// checks, publish) and Inbox (the conversations, and the ones the owner takes over). Atelier and Inbox are the service's own pages, framed here through this plugin's guarded
// routes (the owner token never reaches the browser). Kaby does the same work in chat with the `front_desk` tool.
//
// The page reads `/kybernos-front-desk/state` every few seconds (nothing while the tab is hidden). It declares its row in the menu (`window.__KB_MENU__`) and mounts the page on the
// keyed slot `main.kybernos-business`. Every animation stops under `prefers-reduced-motion`. The factory always returns a plugin: on any error it is a disabled one.
// ═══════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-front-desk',
  factory: (require) => {
    try {
      const NAME = 'kybernos-front-desk'
      const BASE = '/kybernos-front-desk'
      const ROW_ID = 'front-desk'
      const SLOT = 'main.kybernos-business'
      const TAB_KEY = 'kybernos.front-desk.tab'
      const TABS = ['setup', 'atelier', 'boite']
      const POLL_MS = 4000 // how often the state is asked; the page asks nothing while the tab is hidden
      const MENU_WAIT_MS = 250
      const MENU_TRIES = 120 // the core's registry is waited for 30 s at most

      const lang = () => {
        try {
          const l = window.__KB_LANG_RESOLVE__ && window.__KB_LANG_RESOLVE__()
          const s = String(l || '')
          // French only when the resolved language IS French (the 'kybernos' default or a fr base); every other language gets English.
          return (s === 'kybernos' || s.split(/[-_]/)[0] === 'fr') ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const pack = kt.pack || (kt.pack = {})
        if (pack[fr] === undefined) pack[fr] = { fr, en }
        return (lang() === 'fr' ? fr : en)
      }

      // ── pure helpers (tested without a browser) ─────────────────────────────────────────────────────────────────────────
      const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

      /** The line the shop pastes into its site. `base` is where visitors reach the service. */
      const embedSnippet = (base, slug) => '<script src="' + String(base).replace(/\/+$/, '') + '/widget.js" data-shop="' + slug + '" async></' + 'script>'

      /** The word and the tone for the service's state. */
      const stateWord = (service) => {
        const s = plain(service) ? service.state : 'stopped'
        if (s === 'running') return { word: kt('En marche', 'Running'), tone: 'ok' }
        if (s === 'starting') return { word: kt('Démarrage…', 'Starting…'), tone: 'busy' }
        if (s === 'stopping') return { word: kt('Arrêt…', 'Stopping…'), tone: 'busy' }
        if (s === 'failed') return { word: kt('En panne', 'Failed'), tone: 'bad' }
        return { word: kt('Arrêté', 'Stopped'), tone: 'off' }
      }

      const MISSING = () => ({ model_url: kt('l’adresse du modèle', 'the model address'), model_name: kt('le nom du modèle', 'the model name'), model_key: kt('la clé du modèle', 'the model key') })
      /** What an answer of the host says, in words (the code is never shown). */
      const errorText = (r) => {
        const j = plain(r) && plain(r.json) ? r.json : {}
        const status = plain(r) ? r.status : 0
        if (status === 401 || status === 403 || (status === 503 && typeof j.error === 'string' && /secret|session/i.test(j.error))) return kt('Ta session DSH a expiré : recharge la page.', 'Your DSH session has expired: reload the page.')
        switch (j.error) {
          case 'not_ready': {
            const names = MISSING()
            const list = (Array.isArray(j.missing) ? j.missing : []).map((m) => names[m]).filter(Boolean)
            return kt('Il manque encore ' + (list.length ? list.join(', ') : 'un réglage') + '.', 'Still missing: ' + (list.length ? list.join(', ') : 'a setting') + '.')
          }
          case 'bad_model_url': return kt('L’adresse du modèle doit commencer par https:// et ne rien contenir d’autre.', 'The model address must start with https:// and hold nothing else.')
          case 'bad_model_name': return kt('Le nom du modèle contient un caractère qui n’est pas permis.', 'The model name has a character that is not allowed.')
          case 'bad_model_key': return kt('La clé est trop courte, ou contient des espaces.', 'The key is too short, or has spaces in it.')
          case 'bad_public_url': return kt('L’adresse publique doit être une adresse web complète, par exemple https://accueil.ma-boutique.fr', 'The public address must be a full web address, for example https://front-desk.my-shop.com')
          case 'bad_telegram_token': return kt('Le jeton Telegram ressemble à 123456:ABC… (BotFather le donne).', 'A Telegram token looks like 123456:ABC… (BotFather gives it).')
          case 'nothing_to_write': return kt('Rien à enregistrer.', 'Nothing to save.')
          case 'start_failed': return kt('Le service ne démarre pas.', 'The service does not start.') + (typeof j.detail === 'string' && j.detail !== '' ? ' ' + j.detail.slice(0, 200) : '')
          case 'too_big': return kt('Ce texte est trop long.', 'That text is too long.')
          case 'service_stopped': return kt('Le service est arrêté.', 'The service is stopped.')
          default: return status === 0 ? kt('DSH ne répond pas.', 'DSH is not answering.') : kt('Ça n’a pas marché. Réessaie dans un instant.', 'That did not work. Try again in a moment.')
        }
      }

      /** Same-origin JSON call to this plugin's routes. Never throws. */
      const call = async (method, path, body) => {
        try {
          const r = await fetch(BASE + path, { method, credentials: 'same-origin', headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
          let json = {}
          try { json = await r.json() } catch (e) { json = {} }
          return { ok: r.ok && json.ok !== false, status: r.status, json }
        } catch (e) { return { ok: false, status: 0, json: { ok: false, error: 'unreachable' } } }
      }

      const readTab = () => { try { const t = localStorage.getItem(TAB_KEY); return TABS.indexOf(t) >= 0 ? t : 'setup' } catch (e) { return 'setup' } }
      const writeTab = (t) => { try { localStorage.setItem(TAB_KEY, t) } catch (e) { /* private mode: the tab lasts until the page closes */ } return t }

      const copyText = async (text) => {
        try { await navigator.clipboard.writeText(text); return true } catch (e) { return false }
      }

      const CSS = `
        .kbfd{display:block;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.45;min-width:0}
        .kbfd *{box-sizing:border-box}
        .kbfd button,.kbfd input{font:inherit}
        .kbfd :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
        .kbfd-main{container:kbfd-page / inline-size;display:flex;flex-direction:column;gap:14px;min-width:0}
        .kbfd-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px 16px}
        .kbfd-titlerow{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
        .kbfd-title{margin:0;font-size:26px;font-weight:800;color:var(--dsw-alias-label-primary);letter-spacing:-.01em;line-height:1.25}
        .kbfd-pill{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
        .kbfd-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none}
        .kbfd-pill.ok .kbfd-dot{background:var(--dsw-alias-state-success-primary,#2f7d4f)}
        .kbfd-pill.bad .kbfd-dot{background:var(--dsw-alias-state-error-primary)}
        .kbfd-pill.busy .kbfd-dot{background:var(--dsw-alias-state-warn-primary);animation:kbfd-pulse 1s ease-in-out infinite}
        @keyframes kbfd-pulse{50%{opacity:.35}}
        .kbfd-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;height:34px;padding:0 14px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-weight:550;font-size:13px;cursor:pointer;transition:background .15s,transform .14s}
        .kbfd-btn:hover{background:var(--dsw-alias-bg-layer-2)}
        .kbfd-btn:active{transform:scale(.97)}
        .kbfd-btn.sm{height:30px;padding:0 11px;font-size:12px}
        .kbfd-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground);font-weight:650}
        .kbfd-btn.primary:hover{filter:brightness(.96)}
        .kbfd-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}
        .kbfd-btn[disabled]{opacity:.5;cursor:not-allowed}
        .kbfd-muted{color:var(--dsw-alias-label-tertiary)}
        .kbfd-banner{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
        .kbfd-banner.warn{border-color:var(--dsw-alias-state-warn-primary)}
        .kbfd-banner.bad{border-color:var(--dsw-alias-state-error-primary)}
        .kbfd-banner .sp{flex:1 1 220px;min-width:0}
        .kbfd-banner b{color:var(--dsw-alias-label-primary)}
        .kbfd-tabs{display:flex;flex-wrap:wrap;gap:6px;min-width:0}
        .kbfd-tab{display:inline-flex;align-items:center;gap:7px;height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer;transition:background .16s,color .16s,transform .14s}
        .kbfd-tab:hover{color:var(--dsw-alias-label-primary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 5%,transparent)}
        .kbfd-tab:active{transform:scale(.96)}
        .kbfd-tab[aria-selected="true"]{background:var(--dsw-alias-label-primary);border-color:transparent;color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600}
        .kbfd-badge{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
        .kbfd-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:14px;align-items:start}
        .kbfd-card{display:flex;flex-direction:column;gap:12px;padding:16px;border-radius:16px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);min-width:0}
        .kbfd-card.wide{grid-column:1 / -1}
        .kbfd-card h2{margin:0;font-size:15px;font-weight:700;color:var(--dsw-alias-label-primary)}
        .kbfd-card p{margin:0;color:var(--dsw-alias-label-secondary)}
        .kbfd-field{display:flex;flex-direction:column;gap:5px;min-width:0}
        .kbfd-field label{font-weight:600;color:var(--dsw-alias-label-primary)}
        .kbfd-field small{color:var(--dsw-alias-label-tertiary)}
        .kbfd-input{width:100%;height:36px;padding:0 11px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);min-width:0}
        .kbfd-input[readonly]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
        .kbfd-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
        .kbfd-row .kbfd-input{flex:1 1 220px;width:auto}
        .kbfd-ok{color:var(--dsw-alias-state-success-primary,#2f7d4f);font-weight:600}
        .kbfd-err{color:var(--dsw-alias-state-error-primary);font-weight:600}
        .kbfd-log{margin:0;max-height:240px;overflow:auto;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word}
        .kbfd-frame{display:block;width:100%;height:max(560px,calc(100vh - 230px));border:1px solid var(--dsw-alias-border-l1);border-radius:16px;background:var(--dsw-alias-bg-layer-1)}
        .kbfd-empty{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:22px;border-radius:16px;border:1px dashed var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
        .kbfd-empty b{color:var(--dsw-alias-label-primary);font-size:15px}
        @container kbfd-page (max-width:520px){.kbfd-title{font-size:22px}.kbfd-head{gap:8px}}
        @media (prefers-reduced-motion:reduce){.kbfd *{animation:none!important;transition:none!important}}
      `

      const build = (React) => {
        const h = React.createElement
        const { useState, useEffect, useRef } = React

        // The Suite's « ? » button; where it is not there the description stays under the title.
        const help = (extra) => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, Object.assign({ id: 'kybernos-front-desk' }, extra || {})) : null)
        const subFallback = (text) => {
          try { if (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help) return null } catch (e) { /* draw it */ }
          return h('p', { className: 'kbfd-muted' }, text)
        }
        let uid = 0
        const nextId = () => 'kbfd-f' + (uid += 1)

        const Field = ({ label, hint, children, id }) => h('div', { className: 'kbfd-field' },
          h('label', { htmlFor: id }, label), children, hint ? h('small', null, hint) : null)

        /** A readonly box and a Copy button: a link or the snippet for a site. */
        const CopyBox = ({ value, label, kb }) => {
          const [done, setDone] = useState(false)
          const id = useRef(nextId()).current
          const copy = async () => { const okc = await copyText(value); setDone(okc); if (okc) setTimeout(() => setDone(false), 1800) }
          return h(Field, { label, id },
            h('div', { className: 'kbfd-row' },
              h('input', { id, className: 'kbfd-input', readOnly: true, value, 'data-kb': kb, onFocus: (e) => { try { e.target.select() } catch (x) { /* nothing to select */ } } }),
              h('button', { type: 'button', className: 'kbfd-btn sm', 'data-kb': kb + '-copy', onClick: copy }, done ? kt('Copié', 'Copied') : kt('Copier', 'Copy'))))
        }

        const Result = ({ r }) => (r === null ? null
          : r.ok ? h('span', { className: 'kbfd-ok', role: 'status', 'data-kb': 'fd-saved' }, kt('Enregistré.', 'Saved.'))
            : h('span', { className: 'kbfd-err', role: 'alert', 'data-kb': 'fd-error' }, errorText(r)))

        // ── the cards of the Setup tab ──────────────────────────────────────────────────────────────────────────────────────
        const ServiceCard = ({ s }) => {
          const { state, busy, actions, logs } = s
          const running = state.service.state === 'running'
          const missing = state.ready && !state.ready.ok ? (state.ready.missing || []) : []
          const names = MISSING()
          return h('section', { className: 'kbfd-card', 'data-kb': 'fd-service' },
            h('h2', null, kt('Le service', 'The service')),
            h('p', null, kt('L’assistant tourne sur cet ordinateur, à part de Kaby, avec sa propre clé de modèle. Tant que DSH reste ouvert, il répond à tes visiteurs.', 'The assistant runs on this computer, apart from Kaby, with its own model key. While DSH stays open, it answers your visitors.')),
            missing.length ? h('p', { className: 'kbfd-err', 'data-kb': 'fd-missing' }, kt('Pour le démarrer, il manque : ', 'To start it, you still need: ') + missing.map((m) => names[m]).filter(Boolean).join(', ') + '.') : null,
            state.service.error ? h('p', { className: 'kbfd-err', role: 'alert', 'data-kb': 'fd-service-error' }, state.service.error) : null,
            h('div', { className: 'kbfd-row' },
              running
                ? h('button', { type: 'button', className: 'kbfd-btn', 'data-kb': 'fd-stop', disabled: busy !== '', onClick: actions.stop }, busy === 'stop' ? kt('Arrêt…', 'Stopping…') : kt('Arrêter', 'Stop'))
                : h('button', { type: 'button', className: 'kbfd-btn primary', 'data-kb': 'fd-start', disabled: busy !== '' || missing.length > 0, onClick: actions.start }, busy === 'start' ? kt('Démarrage…', 'Starting…') : kt('Démarrer', 'Start')),
              h('button', { type: 'button', className: 'kbfd-btn', 'data-kb': 'fd-logs', onClick: actions.loadLogs }, logs === null ? kt('Voir le journal', 'Show the log') : kt('Actualiser le journal', 'Refresh the log'))),
            logs !== null ? h('pre', { className: 'kbfd-log', 'data-kb': 'fd-log-text', tabIndex: 0 }, logs === '' ? kt('Le journal est vide.', 'The log is empty.') : logs) : null)
        }

        const ModelCard = ({ s }) => {
          const { state, actions } = s
          const [url, setUrl] = useState(state.config.model.baseUrl || '')
          const [model, setModel] = useState(state.config.model.name || '')
          const [key, setKey] = useState('')
          const [res, setRes] = useState(null)
          const [saving, setSaving] = useState(false)
          const ids = useRef([nextId(), nextId(), nextId()]).current
          const save = async () => {
            const m = {}
            if (url.trim() !== '') m.baseUrl = url.trim()
            if (model.trim() !== '') m.name = model.trim()
            if (key.trim() !== '') m.apiKey = key.trim()
            setSaving(true)
            const r = await actions.saveConfig({ model: m })
            setSaving(false)
            setRes(r)
            if (r.ok) setKey('')
          }
          return h('section', { className: 'kbfd-card', 'data-kb': 'fd-model' },
            h('h2', null, kt('Le modèle de l’assistant', 'The assistant’s model')),
            h('p', null, kt('Ce que l’assistant utilise pour répondre à tes visiteurs : n’importe quel service compatible OpenAI. Cette clé est la sienne : elle n’est jamais partagée avec Kaby ni avec tes autres clés.', 'What the assistant uses to answer your visitors: any OpenAI-compatible service. This key is its own: it is never shared with Kaby or with your other keys.')),
            h(Field, { label: kt('Adresse du modèle', 'Model address'), id: ids[0], hint: 'https://api.example.com/v1' },
              h('input', { id: ids[0], className: 'kbfd-input', value: url, 'data-kb': 'fd-model-url', spellCheck: false, autoComplete: 'off', onChange: (e) => setUrl(e.target.value) })),
            h(Field, { label: kt('Nom du modèle', 'Model name'), id: ids[1] },
              h('input', { id: ids[1], className: 'kbfd-input', value: model, 'data-kb': 'fd-model-name', spellCheck: false, autoComplete: 'off', onChange: (e) => setModel(e.target.value) })),
            h(Field, { label: kt('Clé', 'Key'), id: ids[2], hint: state.secrets.modelKey ? kt('Une clé est déjà enregistrée : laisse vide pour la garder.', 'A key is already saved: leave it empty to keep it.') : null },
              h('input', { id: ids[2], className: 'kbfd-input', type: 'password', value: key, 'data-kb': 'fd-model-key', spellCheck: false, autoComplete: 'off', placeholder: state.secrets.modelKey ? '••••••••' : '', onChange: (e) => setKey(e.target.value) })),
            h('div', { className: 'kbfd-row' },
              h('button', { type: 'button', className: 'kbfd-btn primary', 'data-kb': 'fd-model-save', disabled: saving, onClick: save }, kt('Enregistrer', 'Save')), h(Result, { r: res })))
        }

        const AddressCard = ({ s }) => {
          const { state, actions } = s
          const [url, setUrl] = useState(state.config.publicUrl || '')
          const [res, setRes] = useState(null)
          const id = useRef(nextId()).current
          const save = async () => { setRes(await actions.saveConfig({ publicUrl: url.trim() === '' ? null : url.trim() })) }
          return h('section', { className: 'kbfd-card', 'data-kb': 'fd-address' },
            h('h2', null, kt('Adresse publique', 'Public address')),
            h('p', null, kt('L’adresse où tes visiteurs joignent le service : ton domaine, ou un tunnel vers cet ordinateur. Sans elle, le lien ne marche que sur cet ordinateur.', 'The address where your visitors reach the service: your domain, or a tunnel to this computer. Without it, the link only works on this computer.')),
            h(Field, { label: kt('Adresse', 'Address'), id, hint: 'https://front-desk.my-shop.com' },
              h('input', { id, className: 'kbfd-input', value: url, 'data-kb': 'fd-public-url', spellCheck: false, autoComplete: 'off', onChange: (e) => setUrl(e.target.value) })),
            h('div', { className: 'kbfd-row' },
              h('button', { type: 'button', className: 'kbfd-btn primary', 'data-kb': 'fd-public-save', onClick: save }, kt('Enregistrer', 'Save')), h(Result, { r: res })))
        }

        const TelegramCard = ({ s }) => {
          const { state, actions } = s
          const [token, setToken] = useState('')
          const [res, setRes] = useState(null)
          const id = useRef(nextId()).current
          const tg = state.channels && state.channels.telegram ? state.channels.telegram : null
          const save = async () => { const r = await actions.saveConfig({ telegram: { token: token.trim() } }); setRes(r); if (r.ok) setToken('') }
          const off = async () => { setRes(await actions.saveConfig({ telegram: { off: true } })) }
          return h('section', { className: 'kbfd-card', 'data-kb': 'fd-telegram' },
            h('h2', null, 'Telegram'),
            h('p', null, kt('Pour que l’assistant réponde aussi sur Telegram : crée un bot avec @BotFather, colle son jeton ici, puis redémarre le service.', 'So the assistant also answers on Telegram: make a bot with @BotFather, paste its token here, then restart the service.')),
            state.secrets.telegram
              ? h('p', { 'data-kb': 'fd-telegram-state' }, tg && tg.connected ? h('span', { className: 'kbfd-ok' }, kt('Connecté', 'Connected') + (tg.username ? ' · @' + tg.username : '')) : kt('Jeton enregistré. Il sera utilisé au prochain démarrage.', 'Token saved. It is used at the next start.'))
              : null,
            h(Field, { label: kt('Jeton du bot', 'Bot token'), id, hint: state.secrets.telegram ? kt('Colle un autre jeton pour le remplacer.', 'Paste another token to replace it.') : null },
              h('input', { id, className: 'kbfd-input', type: 'password', value: token, 'data-kb': 'fd-telegram-token', spellCheck: false, autoComplete: 'off', onChange: (e) => setToken(e.target.value) })),
            h('div', { className: 'kbfd-row' },
              h('button', { type: 'button', className: 'kbfd-btn primary', 'data-kb': 'fd-telegram-save', disabled: token.trim() === '', onClick: save }, kt('Enregistrer', 'Save')),
              state.secrets.telegram ? h('button', { type: 'button', className: 'kbfd-btn danger', 'data-kb': 'fd-telegram-off', onClick: off }, kt('Désactiver', 'Turn off')) : null,
              h(Result, { r: res })))
        }

        const LinksCard = ({ s }) => {
          const { state } = s
          if (state.shop === null || state.localLink === null) return null
          const base = state.config.publicUrl || (state.localLink ? state.localLink.replace(/\/c\/[^/]+$/, '') : '')
          return h('section', { className: 'kbfd-card wide', 'data-kb': 'fd-links' },
            h('h2', null, kt('À partager', 'To share')),
            state.publicLink === null ? h('p', { 'data-kb': 'fd-local-only' }, kt('Pour l’instant, le lien ne marche que sur cet ordinateur. Pour que tes visiteurs l’utilisent, donne une adresse publique ci-dessus.', 'For now the link only works on this computer. For your visitors to use it, give a public address above.')) : null,
            h(CopyBox, { label: state.publicLink !== null ? kt('Lien public', 'Public link') : kt('Lien sur cet ordinateur', 'Link on this computer'), value: state.publicLink !== null ? state.publicLink : state.localLink, kb: 'fd-link' }),
            h(CopyBox, { label: kt('Bulle de chat pour ton site (à coller avant </body>)', 'Chat bubble for your site (paste before </body>)'), value: embedSnippet(base, state.shop.slug), kb: 'fd-snippet' }),
            h('div', { className: 'kbfd-row' }, h('a', { className: 'kbfd-btn', href: state.localLink, target: '_blank', rel: 'noopener', 'data-kb': 'fd-open' }, kt('Ouvrir le chat', 'Open the chat'))))
        }

        const Setup = ({ s }) => h('div', { className: 'kbfd-grid', 'data-kb': 'fd-setup' },
          h(ServiceCard, { s }), h(ModelCard, { s }), h(AddressCard, { s }), h(TelegramCard, { s }), h(LinksCard, { s }))

        // ── the service's own pages, framed ─────────────────────────────────────────────────────────────────────────────────
        const Framed = ({ s, tab }) => {
          const { state, busy, actions } = s
          if (state.service.state !== 'running') {
            const missing = state.ready && !state.ready.ok
            return h('div', { className: 'kbfd-empty', 'data-kb': 'fd-stopped' },
              h('b', null, kt('Le service est arrêté.', 'The service is stopped.')),
              h('span', null, missing ? kt('Choisis d’abord le modèle de l’assistant, dans Réglages.', 'First choose the assistant’s model, in Setup.') : kt('Démarre-le pour ouvrir cette page.', 'Start it to open this page.')),
              h('button', { type: 'button', className: 'kbfd-btn primary', 'data-kb': missing ? 'fd-go-setup' : 'fd-start-here', disabled: busy !== '', onClick: missing ? () => actions.setTab('setup') : actions.start }, missing ? kt('Aller aux réglages', 'Go to Setup') : kt('Démarrer', 'Start')))
          }
          return h('iframe', { key: tab, className: 'kbfd-frame', src: BASE + '/' + tab, title: tab === 'atelier' ? 'Atelier' : kt('Boîte', 'Inbox'), 'data-kb': 'fd-frame-' + tab, referrerPolicy: 'same-origin' })
        }

        // ── the screen: a pure function of what the page holds (rendered in the tests with crafted states) ───────────────────
        const Screen = ({ s }) => {
          const { data, tab, notice, restartNeeded, actions, busy } = s
          const title = kt('Accueil client', 'Front desk')
          const sub = kt('Un assistant public pour ta boutique : tes visiteurs lui parlent sur un lien, sur ton site ou sur Telegram. Il répond avec ce que tu as validé, et te laisse un message quand il ne sait pas. Tu le règles ici, ou en discutant avec Kaby.', 'A public assistant for your shop: your visitors talk to it on a link, on your site or on Telegram. It answers with what you have checked, and leaves you a message when it does not know. You set it up here, or by chatting with Kaby.')
          let body
          let state = data.state
          if (data.status === 'loading') body = h('div', { role: 'status', className: 'kbfd-muted', 'data-kb': 'fd-loading' }, kt('Chargement…', 'Loading…'))
          else if (state === null) {
            body = h('div', { className: 'kbfd-banner bad', role: 'alert', 'data-kb': 'fd-unreadable' },
              h('span', { className: 'sp' }, h('b', null, kt('L’accueil client n’est pas lisible pour l’instant.', 'The front desk cannot be read right now.')), ' ', errorText(data.error)),
              h('button', { type: 'button', className: 'kbfd-btn sm', 'data-kb': 'fd-retry', onClick: actions.refresh }, kt('Réessayer', 'Try again')))
          } else {
            state = Object.assign({ channels: null, secrets: { modelKey: false, telegram: false }, config: { model: {} } }, state)
            const p = { state, busy, actions, logs: s.logs }
            const sw = stateWord(state.service)
            const running = state.service.state === 'running'
            const tabs = [{ id: 'setup', label: kt('Réglages', 'Setup') }, { id: 'atelier', label: 'Atelier' }, { id: 'boite', label: kt('Boîte', 'Inbox'), count: data.waiting }]
            body = h(React.Fragment, null,
              h('div', { className: 'kbfd-head' },
                h('div', { className: 'kbfd-titlerow' }, h('h1', { className: 'kbfd-title' }, title), h('span', { className: 'kbfd-pill ' + sw.tone, 'data-kb': 'fd-pill', role: 'status' }, h('span', { className: 'kbfd-dot', 'aria-hidden': 'true' }), sw.word), help({ lead: sub, title })),
                running ? h('button', { type: 'button', className: 'kbfd-btn', 'data-kb': 'fd-head-stop', disabled: busy !== '', onClick: actions.stop }, kt('Arrêter', 'Stop')) : null),
              subFallback(sub),
              data.stale ? h('div', { className: 'kbfd-banner', role: 'status', 'data-kb': 'fd-stale' }, h('span', { className: 'sp' }, kt('DSH ne répond plus : ce que tu vois peut dater de quelques secondes.', 'DSH is not answering: what you see may be a few seconds old.'))) : null,
              restartNeeded ? h('div', { className: 'kbfd-banner warn', role: 'status', 'data-kb': 'fd-restart' },
                h('span', { className: 'sp' }, h('b', null, kt('Redémarre le service', 'Restart the service')), ' ', kt('pour que ce réglage prenne effet.', 'for this setting to take effect.')),
                h('button', { type: 'button', className: 'kbfd-btn sm', 'data-kb': 'fd-restart-now', disabled: busy !== '', onClick: actions.restart }, busy === 'restart' ? kt('Redémarrage…', 'Restarting…') : kt('Redémarrer', 'Restart'))) : null,
              notice ? h('div', { className: 'kbfd-banner ' + (notice.kind === 'bad' ? 'bad' : 'warn'), role: 'alert', 'data-kb': 'fd-notice' }, h('span', { className: 'sp' }, notice.text)) : null,
              h('div', { className: 'kbfd-tabs', role: 'tablist', 'aria-label': title, 'data-kb': 'fd-tabs' },
                tabs.map((t) => h('button', { key: t.id, type: 'button', role: 'tab', className: 'kbfd-tab', 'aria-selected': tab === t.id ? 'true' : 'false', 'data-kb': 'fd-tab', 'data-tab': t.id, onClick: () => actions.setTab(t.id) },
                  t.label, t.count > 0 ? h('span', { className: 'kbfd-badge', 'data-kb': 'fd-badge', 'aria-label': String(t.count) }, t.count) : null))),
              tab === 'setup' ? h(Setup, { s: p }) : h(Framed, { s: p, tab }))
          }
          return h('div', { className: 'kbfd', 'data-kb': 'front-desk-page', 'data-tab': tab },
            h('style', { 'data-plugin': '@local/kybernos-front-desk' }, CSS),
            h('div', { className: 'kbfd-main' }, data.status === 'loading' || state === null ? h('div', { className: 'kbfd-head' }, h('div', { className: 'kbfd-titlerow' }, h('h1', { className: 'kbfd-title' }, title), help({ lead: sub, title }))) : null, body))
        }

        // ── the page: holds the state, polls it, and does what the buttons ask ───────────────────────────────────────────────
        const Page = () => {
          const [data, setData] = useState({ status: 'loading', state: null, waiting: 0, stale: false, error: null })
          const [tab, setTabState] = useState(readTab)
          const [busy, setBusy] = useState('')
          const [notice, setNotice] = useState(null)
          const [restartNeeded, setRestartNeeded] = useState(false)
          const [logs, setLogs] = useState(null)
          const [reload, setReload] = useState(0)

          useEffect(() => {
            let alive = true
            let timer = null
            const tick = async () => {
              let hidden = false
              try { hidden = document.hidden === true } catch (e) { hidden = false }
              if (!hidden) {
                const r = await call('GET', '/state')
                if (!alive) return
                if (r.ok) {
                  let waiting = 0
                  if (plain(r.json.service) && r.json.service.state === 'running') {
                    const o = await call('GET', '/api/overview')
                    if (!alive) return
                    if (o.ok && typeof o.json.waiting === 'number') waiting = o.json.waiting
                  }
                  setData({ status: 'ok', state: r.json, waiting, stale: false, error: null })
                } else setData((d) => ({ status: d.state !== null ? 'ok' : 'error', state: d.state, waiting: d.waiting, stale: d.state !== null, error: r }))
              }
              if (alive) timer = setTimeout(tick, POLL_MS)
            }
            tick()
            return () => { alive = false; if (timer !== null) clearTimeout(timer) }
          }, [reload])

          const refresh = () => setReload((n) => n + 1)
          const act = async (name, run) => {
            setBusy(name)
            setNotice(null)
            try { await run() } finally { setBusy(''); refresh() }
          }
          const startOnce = async () => {
            const r = await call('POST', '/start', {})
            if (!r.ok) setNotice({ kind: 'bad', text: errorText(r) })
            else setRestartNeeded(false)
            return r
          }
          const actions = {
            refresh,
            setTab: (t) => setTabState(writeTab(t)),
            start: () => act('start', startOnce),
            stop: () => act('stop', async () => { await call('POST', '/stop', {}); setRestartNeeded(false) }),
            restart: () => act('restart', async () => { await call('POST', '/stop', {}); await startOnce() }),
            loadLogs: async () => { const r = await call('GET', '/logs?n=80'); setLogs(r.ok && typeof r.json.text === 'string' ? r.json.text : '') },
            saveConfig: async (patch) => {
              const r = await call('POST', '/config', patch)
              if (r.ok) { if (r.json.restartNeeded === true) setRestartNeeded(true); refresh() }
              return r
            },
          }
          return h(Screen, { s: { data, tab, busy, notice, restartNeeded, logs, actions } })
        }
        Page.parts = { Screen, Setup, Framed, ServiceCard, ModelCard, AddressCard, TelegramCard, LinksCard, CopyBox }
        return Page
      }

      // ── the plugin ──────────────────────────────────────────────────────────────────────────────────────────────────────
      const start = (ctx) => {
        try {
          const React = require('react')
          const slots = ctx.slots
          if (slots === null || slots === undefined || typeof slots.inject !== 'function') return
          const Page = build(React)
          // The row of the menu: declared here, taken back when the plugin is switched off. The core publishes its registry when IT is applied, and the order in
          // which two plugins are applied is DSH's, so the row waits for the registry instead of assuming it is there.
          ctx.effect(() => {
            let off = null
            let timer = null
            let tries = 0
            const declare = () => {
              timer = null
              try {
                if (window.__KB_MENU__ && typeof window.__KB_MENU__.register === 'function') { off = window.__KB_MENU__.register({ id: ROW_ID, group: 'business', icon: 'messageCircle', label: { en: 'Front desk', fr: 'Accueil client' }, order: 50 }); return }
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
          }, 'kybernos-front-desk: menu row')
          ctx.effect(() => slots.inject(SLOT, () => slots.register({ name: SLOT, key: ROW_ID }, Page)), 'kybernos-front-desk: page')
        } catch (e) { console.warn('[kybernos-front-desk] page not mounted:', e) }
      }

      return {
        name: NAME,
        inject: ['slots'],
        apply: start,
        __test: { kt, lang, plain, embedSnippet, stateWord, errorText, call, readTab, writeTab, build, CSS, ROW_ID, SLOT, BASE, TABS },
      }
    } catch (e) {
      console.warn('[kybernos-front-desk] disabled:', e)
      return { apply () {} }
    }
  }
})
