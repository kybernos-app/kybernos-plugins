// ── kybernos-computers — carte de configuration dans la page Plugins ────────
//
// Même mécanisme que dsh-client-ui-settings-web-search : tant que l'hôte sert
// le namespace de réglages « kybernos-computers » (dérivé du Config exporté
// par index.js), on injecte une carte dans le slot `plugins.item` de la page
// Plugins, avec un champ secret natif :
//   « API key — A key is configured. Stored outside the settings file.
//      Leave blank to keep the current key. »
// La clé tapée part vers remote.credentials (store 0600 côté hôte) — jamais
// dans le fichier de réglages, jamais relue : la carte n'apprend que
// « configurée ou non » via credentials.describe.
window.__ModuleLoader__.load({
  id: '@local/kybernos-computers',
  factory(require) {
    const jsx = require('react/jsx-runtime')
    const React = require('react')
    // h() sur createElement (react NU est mappé : kybernos-cloud l'exige aussi).
    const h = React.createElement
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { SettingsForm, SettingsSecretField, SettingsFormModel } = primitives

    const NS = 'settings.kybernosComputers'
    const COMPUTERS_NS = 'kybernos-computers'
    const DEFAULT_API_KEY_REF = 'E2B_API_KEY'
    const API_KEY_FIELD = 'apiKey'

    // styles : même contrat local que kybernos-cloud — insert(css) → disposer.
    const styles = (() => {
      const tags = new Set()
      return {
        insert(css) {
          if (typeof css !== 'string') throw new Error('styles.insert(css) needs a CSS string')
          const tag = document.createElement('style')
          tag.dataset.plugin = '@local/kybernos-computers'
          tag.textContent = css
          document.head.append(tag)
          tags.add(tag)
          return () => { tags.delete(tag); tag.remove() }
        },
        dispose() { for (const tag of tags) tag.remove(); tags.clear() },
      }
    })()

    const locales = {
      en: {
        title: 'Cloud computers',
        description: 'E2B sandboxes for agents — bring your own key.',
        apiKey: 'API key',
        apiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
        apiKeySet: 'A key is configured.',
        apiKeyUnset: 'No key is configured; agents run on this machine only. Get a key at e2b.dev.',
        readOnly: 'This deployment stores settings read-only.',
        unavailable: 'This plugin is not loaded, so it cannot be configured right now.',
        save: 'Save',
        saving: 'Saving…',
        saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
        envTitle: 'Execution environment',
        envDesktop: 'This machine',
        envDesktopSub: 'Code runs on the local machine.',
        envE2bSub: 'Ephemeral cloud microVM — code runs off this machine.',
        envE2bNoKey: 'E2B key required — Settings ▸ Plugins ▸ Cloud computers.',
      },
      fr: {
        title: 'Ordinateurs cloud',
        description: 'Sandboxes E2B pour les agents — avec votre propre clé.',
        apiKey: 'Clé API',
        apiKeyHint: 'Stockée hors du fichier de réglages. Laissez vide pour conserver la clé actuelle.',
        apiKeySet: 'Une clé est configurée.',
        apiKeyUnset: 'Aucune clé configurée ; les agents tournent seulement sur cette machine. Clé sur e2b.dev.',
        readOnly: 'Ce dépôt garde les réglages en lecture seule.',
        unavailable: 'Ce plugin n’est pas chargé, il ne peut pas être configuré maintenant.',
        save: 'Enregistrer',
        saving: 'Enregistrement…',
        saveFailed: 'Ces valeurs n’ont pas été acceptées ; elles restent à corriger.',
        envTitle: 'Environnement d’exécution',
        envDesktop: 'Ce poste',
        envDesktopSub: 'Le code tourne sur la machine locale.',
        envE2bSub: 'MicroVM cloud éphémère — le code tourne hors du poste.',
        envE2bNoKey: 'Clé E2B requise — Réglages ▸ Plugins ▸ Cloud computers.',
      },
    }

    const formLabels = (t) => ({
      unavailable: t('unavailable'),
      readOnly: t('readOnly'),
      saveFailed: t('saveFailed'),
      save: t('save'),
      saving: t('saving'),
    })

    const refOf = (snapshot) => {
      const declared = snapshot?.value?.apiKeyEnv
      return declared !== undefined && declared.length > 0 ? declared : DEFAULT_API_KEY_REF
    }

    const SELECTOR_CSS = `
.kbenv-root{position:relative;display:inline-flex;min-width:0}
.kbenv-btn{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 9px;border:1px solid transparent;border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,#8a8a93);font:inherit;font-size:12px;line-height:1;cursor:pointer}
.kbenv-btn:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.35));background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,#e9e9ee)}
.kbenv-btn[data-on='true']{border-color:var(--dsw-alias-brand-primary,#6a4fd8);color:var(--dsw-alias-label-primary,#e9e9ee)}
.kbenv-dot{flex:none;width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.8}
.kbenv-menu{position:absolute;bottom:calc(100% + 6px);inset-inline-start:0;z-index:62;min-width:210px;padding:6px;border-radius:12px;background:var(--dsw-alias-bg-layer-2,#191920);border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));box-shadow:0 12px 32px rgba(0,0,0,.4);display:flex;flex-direction:column;gap:2px}
.kbenv-opt{display:flex;align-items:center;gap:8px;padding:7px 9px;border:none;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:12.5px;text-align:start;cursor:pointer}
.kbenv-opt:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.14))}
.kbenv-opt[data-on='true']{background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.22))}
.kbenv-opt:disabled{opacity:.45;cursor:default}
.kbenv-name{font-weight:600}
.kbenv-sub{display:block;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a93);font-weight:400}
`

    const ComputersCard = (props) => {
      const { t } = props
      // Le gestionnaire de plugins transforme `hooks.computersCard` en prop
      // `useComputersCard` (même règle que webSearchCard → useWebSearchCard).
      const state = props.useComputersCard((snapshot) => snapshot)
      if (props.view === 'summary') return t('description')
      return jsx.jsxs(SettingsForm, {
        labels: formLabels(t),
        state,
        onSave: props.save,
        onDiscard: props.discard,
        children: [
          jsx.jsx(SettingsSecretField, {
            id: 'plugin-config-computers-key',
            label: t('apiKey'),
            hint: t('apiKeyHint'),
            disabled: state.apiKeyWritable !== true,
            text: state.apiKey.text,
            configured: state.apiKeyConfigured,
            stateLabel: state.apiKeyConfigured === true ? t('apiKeySet') : t('apiKeyUnset'),
            onEdit: (text) => { props.edit(API_KEY_FIELD, text) },
          }),
        ],
      })
    }

    const ComputersCardController = class {
      constructor(scope, ctx) {
        this.scope = scope
        this.ctx = ctx
        // AVANT form.bind : bind appelle projection() immédiatement, et
        // projection lit this.credential.configured (mesuré : sinon TypeError).
        this.credential = { ref: '', configured: false, writable: true }
        this.form = new SettingsFormModel(scope, [], [{
          field: API_KEY_FIELD,
          write: (text) => this.writeKey(text),
        }])
        this.store = this.form.bind(() => this.projection())
        this.unsubscribe = scope.subscribe(() => { void this.readCredential() })
        void this.readCredential()
      }
      projection() {
        return {
          ...this.form.shell(),
          apiKey: this.form.field(API_KEY_FIELD),
          apiKeyConfigured: this.credential.configured,
          apiKeyWritable: this.credential.writable,
        }
      }
      async readCredential() {
        const ref = refOf(this.scope.getSnapshot())
        if (ref !== this.credential.ref) {
          this.credential = { ref, configured: false, writable: true }
          this.store.set(this.projection())
        }
        const response = await this.ctx.remote.credentials.describe([ref])
        if (response?.ok !== true || ref !== refOf(this.scope.getSnapshot())) return
        const view = response.value?.[ref]
        const next = { ref, configured: view?.configured === true, writable: view?.writable !== false }
        if (next.configured === this.credential.configured && next.writable === this.credential.writable) return
        this.credential = next
        this.store.set(this.projection())
      }
      refreshCredential(ref) {
        if (ref !== this.credential.ref) return
        void this.readCredential()
      }
      inject() {
        return { hooks: { computersCard: this.store }, ...this.form.actions() }
      }
      async writeKey(value) {
        await this.ctx.remote.credentials.set(refOf(this.scope.getSnapshot()), value)
        await this.readCredential()
        return this.credential.configured
      }
      dispose() {
        this.unsubscribe()
        this.form.dispose()
      }
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials', 'configForms'],
      apply(ctx) {
        // safe() : chaque effet est monté en défensif — un service ou slot
        // manquant ne doit JAMAIS faire passer CE plugin en « failed » et
        // casser le boot web (mesuré à deux reprises).
        const safe = (label, fn) => {
          try {
            ctx.effect(fn, label)
          } catch (e) {
            console.error('[kybernos-computers] ' + label + ' : ' + String((e && e.message) || e))
          }
        }
        const t = ctx.locale.bind(NS)
        const slots = ctx.get('slots')
        safe('kybernos-computers: dictionnaires', () => ctx.locale.register(NS, locales))
        // Le contrôleur n'est créé que QUAND l'hôte sert le namespace : le
        // créer avant fait lever apply() (fiber « failed » — mesuré 29/09 :
        // configForms.get jette sur un namespace non servi) et casse le boot
        // web entier. whileServed est notre unique déclencheur.
        let card = null
        safe('kybernos-computers: carte Plugins', () => ctx.configForms.whileServed([COMPUTERS_NS], () => {
          try {
            card = new ComputersCardController(ctx.configForms.get(COMPUTERS_NS), ctx)
          } catch (e) {
            console.error('[kybernos-computers] carte Plugins : ' + String((e && e.stack) || e))
            return () => {}
          }
          const off = ctx.slots.inject('plugins.item', () => ctx.slots.register({
            name: 'plugins.item',
            id: 'kybernos-computers',
            order: 45,
            label: () => t('title'),
            locale: NS,
            inject: () => card.inject(),
          }, ComputersCard))
          return () => { off(); if (card !== null) { card.dispose(); card = null } }
        }))
        safe('kybernos-computers: invalidations credential', () => ctx.remote.$on('credentials/reference-updated', (ref) => { if (card !== null) card.refreshCredential(ref) }))

        // Sélecteur d'environnement : monté en DÉFENSIF — un slot ou un
        // service manquant ne doit jamais casser le boot de CE plugin.
        const callEnv = async (path, method, payload) => {
            try {
              const res = await fetch('/kybernos-computers' + path, {
                method: method === undefined ? 'GET' : method,
                headers: { 'content-type': 'application/json' },
                body: method === 'POST' ? JSON.stringify(payload === undefined ? {} : payload) : undefined,
              })
              return await res.json().catch(() => null)
            } catch { return null }
          }
        const EnvSelector = () => {
          const [open, setOpen] = React.useState(false)
          const [env, setEnv] = React.useState(() => {
            try { return window.localStorage.getItem('kybernos.computer.env') === 'e2b' ? 'e2b' : 'desktop' } catch { return 'desktop' }
          })
          const [keyPresent, setKeyPresent] = React.useState(null)
          const boxRef = React.useRef(null)

          React.useEffect(() => {
            let alive = true
            const probe = async () => {
              const s = await callEnv('/status')
              if (alive === true) setKeyPresent(s !== null && s.ok === true && s.keyPresent === true)
              const e = await callEnv('/env')
              if (alive === true && e !== null && e.ok === true) {
                setEnv(e.env)
                try { window.localStorage.setItem('kybernos.computer.env', e.env) } catch { /* privé */ }
              }
            }
            void probe()
            const timer = setInterval(() => { void probe() }, 30_000)
            return () => { alive = false; clearInterval(timer) }
          }, [])
          React.useEffect(() => {
            if (open !== true) return
            const away = (e) => { if (boxRef.current !== null && boxRef.current.contains(e.target) !== true) setOpen(false) }
            const esc = (e) => { if (e.key === 'Escape') setOpen(false) }
            document.addEventListener('mousedown', away)
            document.addEventListener('keydown', esc)
            return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc) }
          }, [open])

          const choose = async (value) => {
            setOpen(false)
            const made = await callEnv('/env/set', 'POST', { env: value })
            if (made !== null && made.ok === true) {
              setEnv(made.env)
              try { window.localStorage.setItem('kybernos.computer.env', made.env) } catch { /* privé */ }
            }
          }

          const isE2b = env === 'e2b'
          const options = [
            { id: 'desktop', name: t('envDesktop'), sub: t('envDesktopSub'), disabled: false },
            { id: 'e2b', name: 'E2B', sub: keyPresent === true ? t('envE2bSub') : t('envE2bNoKey'), disabled: keyPresent === false },
          ]
          return h('div', { ref: boxRef, className: 'kbenv-root', 'data-kb': 'computer-env-selector' },
            h('button', {
              className: 'kbenv-btn', 'data-kb': 'computer-env-button', 'data-on': isE2b ? 'true' : 'false',
              title: t('envTitle'), 'aria-label': t('envTitle'), 'aria-expanded': open === true ? 'true' : 'false',
              onClick: () => setOpen(open !== true),
            },
              h('span', { className: 'kbenv-dot' }),
              isE2b ? 'E2B' : t('envDesktop'),
              ' ▾'),
            open === true
              ? h('div', { className: 'kbenv-menu', role: 'menu' },
                  options.map((opt) => h('button', {
                    key: opt.id, className: 'kbenv-opt', role: 'menuitem', 'data-kb': 'computer-env-' + opt.id,
                    'data-on': (opt.id === 'e2b') === isE2b ? 'true' : 'false',
                    disabled: opt.disabled === true, onClick: () => { void choose(opt.id) },
                  },
                    h('span', {}, h('span', { className: 'kbenv-name' }, opt.name), h('span', { className: 'kbenv-sub' }, opt.sub)))))
              : null)
        }
        safe('kybernos-computers: styles sélecteur', () => styles.insert(SELECTOR_CSS))
        safe('kybernos-computers: sélecteur composer', () => {
          const off = slots.inject('conversation.input.left', () => slots.register(
            { name: 'conversation.input.left', id: 'kybernos-computers-env', order: 60 }, EnvSelector))
          return off
        })
      },
    }
  },
})
