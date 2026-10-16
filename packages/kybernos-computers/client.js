// ── kybernos-computers — where the E2B key is set, and where the agent runs ──
//
// Two doors to the same key (the credential `E2B_API_KEY`, stored by the host, never in the settings file):
//   1. The Settings page « Cloud computers »: the page people are told to open (help, README, the composer menu).
//      It speaks to the host routes /kybernos-computers/status, /key/set and /key/clear; the key typed is never read back,
//      the page only learns « configured or not ».
//   2. A card in the `plugins.item` slot of the engine's Plugins page, with a native secret field. Same mechanism as
//      dsh-client-ui-settings-web-search: as long as the host serves the settings namespace « kybernos-computers » (derived from
//      the Config exported by index.js), the card is injected. Builds of DSH that no longer draw that slot never show it,
//      which is why door 1 exists.
// The composer's « This machine ▾ » menu chooses where the agent runs.
window.__ModuleLoader__.load({
  id: '@local/kybernos-computers',
  factory(require) {
    const jsx = require('react/jsx-runtime')
    const React = require('react')
    // h() on createElement (bare react is mapped: kybernos-cloud needs it too).
    const h = React.createElement
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const { SettingsForm, SettingsSecretField, SettingsFormModel } = primitives

    const NS = 'settings.kybernosComputers'
    const COMPUTERS_NS = 'kybernos-computers'
    const DEFAULT_API_KEY_REF = 'E2B_API_KEY'
    const API_KEY_FIELD = 'apiKey'

    // styles: same local contract as kybernos-cloud — insert(css) → disposer.
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
        envE2bNoKey: 'E2B key required — Settings › Cloud computers.',
        envCloud: 'Cloud Computer',
        envCloudSub: 'Not available from a chat yet — write to your assistant on Telegram.',
        pageIntro: 'Run the code of your agents in a throwaway cloud computer (E2B) instead of on this machine. You bring your own E2B key: the usage is billed to your E2B account.',
        pageKeyPlaceholder: 'Paste your E2B key',
        pageKeyHint: 'Stored on this machine, never shown again. Code and files the agent sends to a cloud computer go to E2B.',
        pageRemove: 'Remove the key',
        pageRemoving: 'Removing…',
        pageSaved: 'Key saved. The “E2B” choice of the “This machine ▾” menu in the chat is now open.',
        pageRemoved: 'Key removed. The agents run on this machine again.',
        pageErrInvalid: 'That does not look like an E2B key. Copy it again from e2b.dev.',
        pageErrStore: 'The key could not be stored on this machine.',
        pageErrNoAnswer: 'DSH did not answer. Reload the page and try again.',
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
        envE2bNoKey: 'Clé E2B requise — Réglages › Ordinateurs cloud.',
        envCloud: 'Cloud Computer',
        envCloudSub: 'Pas encore disponible depuis un chat — écrivez à votre assistant sur Telegram.',
        pageIntro: 'Exécutez le code de vos agents dans un ordinateur cloud jetable (E2B) plutôt que sur cette machine. Vous apportez votre propre clé E2B : l’usage est facturé sur votre compte E2B.',
        pageKeyPlaceholder: 'Collez votre clé E2B',
        pageKeyHint: 'Stockée sur cette machine, jamais affichée de nouveau. Le code et les fichiers que l’agent envoie à un ordinateur cloud partent chez E2B.',
        pageRemove: 'Retirer la clé',
        pageRemoving: 'Retrait…',
        pageSaved: 'Clé enregistrée. Le choix « E2B » du menu « Ce poste ▾ » du chat est maintenant ouvert.',
        pageRemoved: 'Clé retirée. Les agents tournent de nouveau sur cette machine.',
        pageErrInvalid: 'Cela ne ressemble pas à une clé E2B. Copiez-la de nouveau depuis e2b.dev.',
        pageErrStore: 'La clé n’a pas pu être stockée sur cette machine.',
        pageErrNoAnswer: 'DSH n’a pas répondu. Rechargez la page et réessayez.',
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

    // The Settings page (DSH tokens, the same family as the other Kybernos pages).
    const PAGE_CSS = `
.kcc-root{max-width:720px;padding:0 0 24px}
/* Light schemes: label-tertiary is 3.7:1 on white. Inside this page it reads as label-secondary, 5.8:1 (audit A1-05); the dark scheme keeps its hierarchy. */
body:not([data-ds-dark-theme]) :is(.kcc-root,.kbenv-root,.kbenv-menu){--dsw-alias-label-tertiary:var(--dsw-alias-label-secondary)}
.kcc-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 6px}
.kcc-title{margin:0;font-size:18px;line-height:1.3;font-weight:600;letter-spacing:-.01em;color:var(--dsw-alias-label-primary)}
.kcc-sub{margin:0 0 16px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kcc-state{margin:0 0 14px;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-secondary)}
.kcc-state[data-on='true']{color:var(--dsw-alias-state-success-primary)}
.kcc-label{display:block;margin:0 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}
.kcc-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.kcc-input{flex:1 1 260px;min-width:0;height:36px;padding:0 12px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px}
.kcc-input:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.kcc-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.kcc-btn{height:36px;padding:0 16px;border:.5px solid var(--dsw-alias-border-l3);border-radius:18px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer}
.kcc-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.kcc-btn:disabled{cursor:not-allowed;opacity:.4}
.kcc-pri{border:none;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
.kcc-pri:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.kcc-hint{margin:8px 0 0;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary)}
.kcc-note{margin:12px 0 0;font-size:13px;line-height:1.5}
.kcc-note[data-ok='true']{color:var(--dsw-alias-state-success-primary)}
.kcc-note[data-ok='false']{color:var(--dsw-alias-state-error-primary)}
`

    const ComputersCard = (props) => {
      const { t } = props
      // The plugin manager turns `hooks.computersCard` into the prop
      // `useComputersCard` (same rule as webSearchCard → useWebSearchCard).
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
        // BEFORE form.bind: bind calls projection() at once, and
        // projection reads this.credential.configured (measured: a TypeError otherwise).
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
        // safe(): every effect is mounted defensively — a missing service or
        // slot must NEVER turn THIS plugin « failed » and break the web boot
        // (measured twice).
        const safe = (label, fn) => {
          try {
            ctx.effect(fn, label)
          } catch (e) {
            console.error('[kybernos-computers] ' + label + ' : ' + String((e && e.message) || e))
          }
        }
        const t = ctx.locale.bind(NS)
        const slots = ctx.get('slots')
        safe('kybernos-computers: dictionaries', () => ctx.locale.register(NS, locales))
        // The controller is created only WHEN the host serves the namespace:
        // creating it earlier makes apply() throw (fiber « failed » — measured
        // 29/09: configForms.get throws on a namespace that is not served) and
        // breaks the whole web boot. whileServed is our only trigger.
        let card = null
        safe('kybernos-computers: Plugins card', () => ctx.configForms.whileServed([COMPUTERS_NS], () => {
          try {
            card = new ComputersCardController(ctx.configForms.get(COMPUTERS_NS), ctx)
          } catch (e) {
            console.error('[kybernos-computers] Plugins card: ' + String((e && e.stack) || e))
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
        safe('kybernos-computers: credential invalidations', () => ctx.remote.$on('credentials/reference-updated', (ref) => { if (card !== null) card.refreshCredential(ref) }))

        // Environment selector: mounted DEFENSIVELY — a missing slot or
        // service must never break the boot of THIS plugin.
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
          // The person's Cloud Computer (read from the cloud bundle): null when signed out or when it cannot be read.
          const [cloud, setCloud] = React.useState(null)
          const boxRef = React.useRef(null)

          React.useEffect(() => {
            let alive = true
            const probe = async () => {
              const s = await callEnv('/status')
              if (alive === true) setKeyPresent(s !== null && s.ok === true && s.keyPresent === true)
              // Shown, never chosen: no route runs a chat turn on that computer yet (docs/dev/cloud-computer-run-on.md).
              try {
                const r = await fetch('/kybernos-cloud/kyber', { cache: 'no-store', credentials: 'same-origin' })
                const k = r.ok === true ? await r.json().catch(() => null) : null
                if (alive === true) setCloud(k !== null && k.ok === true && k.connected === true ? { state: k.home !== null && typeof k.home === 'object' ? String(k.home.state || '') : '' } : null)
              } catch { if (alive === true) setCloud(null) }
              const e = await callEnv('/env')
              if (alive === true && e !== null && e.ok === true) {
                setEnv(e.env)
                try { window.localStorage.setItem('kybernos.computer.env', e.env) } catch { /* private mode */ }
              }
            }
            void probe()
            const timer = setInterval(() => { void probe() }, 30_000)
            // The Settings page tells the menu when it stores or removes the key: no wait for the next probe.
            const again = () => { void probe() }
            window.addEventListener('kybernos-computers:key', again)
            return () => { alive = false; clearInterval(timer); window.removeEventListener('kybernos-computers:key', again) }
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
              try { window.localStorage.setItem('kybernos.computer.env', made.env) } catch { /* private mode */ }
            }
          }

          const isE2b = env === 'e2b'
          const options = [
            { id: 'desktop', name: t('envDesktop'), sub: t('envDesktopSub'), disabled: false },
            { id: 'e2b', name: 'E2B', sub: keyPresent === true ? t('envE2bSub') : t('envE2bNoKey'), disabled: keyPresent === false },
          ]
          if (cloud !== null) options.push({ id: 'cloud', name: t('envCloud'), sub: t('envCloudSub'), disabled: true })
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
                    'data-on': opt.id === (isE2b ? 'e2b' : 'desktop') ? 'true' : 'false',
                    disabled: opt.disabled === true, onClick: () => { void choose(opt.id) },
                  },
                    h('span', {}, h('span', { className: 'kbenv-name' }, opt.name), h('span', { className: 'kbenv-sub' }, opt.sub)))))
              : null)
        }
        safe('kybernos-computers: selector styles', () => styles.insert(SELECTOR_CSS))
        safe('kybernos-computers: composer selector', () => {
          const off = slots.inject('conversation.input.left', () => slots.register(
            { name: 'conversation.input.left', id: 'kybernos-computers-env', order: 60 }, EnvSelector))
          return off
        })

        // The Settings page « Cloud computers »: the E2B key, in a place a person can find (the card above is drawn only by
        // builds of DSH that still draw the `plugins.item` slot). It talks to the same host routes as the composer menu.
        const KeyPage = () => {
          const [present, setPresent] = React.useState(null) // null: not read yet (or the host did not answer)
          const [text, setText] = React.useState('')
          const [busy, setBusy] = React.useState(null) // 'save' | 'remove' | null
          const [note, setNote] = React.useState(null) // { ok: boolean, text: string }
          const refresh = React.useCallback(async () => {
            const s = await callEnv('/status')
            setPresent(s !== null && s.ok === true ? s.keyPresent === true : null)
            try { window.dispatchEvent(new Event('kybernos-computers:key')) } catch (e) { /* no window */ }
          }, [])
          React.useEffect(() => { void refresh() }, [refresh])
          const failure = (out) => (out === null ? t('pageErrNoAnswer') : out.error === 'cle_invalide' ? t('pageErrInvalid') : t('pageErrStore'))
          const save = async () => {
            setNote(null); setBusy('save')
            const out = await callEnv('/key/set', 'POST', { key: text.trim() })
            setBusy(null)
            if (out !== null && out.ok === true) { setText(''); setNote({ ok: true, text: t('pageSaved') }) } else setNote({ ok: false, text: failure(out) })
            await refresh()
          }
          const remove = async () => {
            setNote(null); setBusy('remove')
            const out = await callEnv('/key/clear', 'POST')
            setBusy(null)
            if (out !== null && out.ok === true) setNote({ ok: true, text: t('pageRemoved') }); else setNote({ ok: false, text: failure(out) })
            await refresh()
          }
          return h('div', { className: 'kcc-root', 'data-kb': 'computers-page' },
            h('div', { className: 'kcc-head' },
              h('h2', { className: 'kcc-title' }, t('title')),
              (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-computers' }) : null)),
            h('p', { className: 'kcc-sub' }, t('pageIntro')),
            present === null ? null : h('p', { className: 'kcc-state', 'data-on': present === true ? 'true' : 'false' }, present === true ? t('apiKeySet') : t('apiKeyUnset')),
            h('label', { className: 'kcc-label', htmlFor: 'kcc-key' }, t('apiKey')),
            h('div', { className: 'kcc-row' },
              h('input', { id: 'kcc-key', className: 'kcc-input', type: 'password', autoComplete: 'off', spellCheck: false, value: text, placeholder: t('pageKeyPlaceholder'), disabled: busy !== null, onChange: (e) => setText(e.target.value) }),
              h('button', { type: 'button', className: 'kcc-btn kcc-pri', 'data-act': 'save-key', disabled: busy !== null || text.trim() === '', onClick: () => { void save() } }, busy === 'save' ? t('saving') : t('save')),
              present === true ? h('button', { type: 'button', className: 'kcc-btn', 'data-act': 'remove-key', disabled: busy !== null, onClick: () => { void remove() } }, busy === 'remove' ? t('pageRemoving') : t('pageRemove')) : null),
            h('p', { className: 'kcc-hint' }, t('pageKeyHint')),
            note === null ? null : h('p', { className: 'kcc-note', role: 'status', 'data-ok': note.ok === true ? 'true' : 'false' }, note.text))
        }
        safe('kybernos-computers: page styles', () => styles.insert(PAGE_CSS))
        safe('kybernos-computers: Settings page', () => {
          const off = slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'kybernos-computers', order: 33, label: () => t('title') }, KeyPage))
          return off
        })
      },
    }
  },
})
