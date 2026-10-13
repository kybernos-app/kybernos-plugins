// ═══════════════════════════════════════════════════════════════════════════
// @local/kybernos-free-llms — client: the "Free LLMs" panel, one door only: a
// dedicated Settings section.
//
// The panel:
//   1. LISTS OpenCode Zen's free models, read live from the host (`/free-llms/status`).
//   2. CONNECTS them into DSH via the host (`/free-llms/enable`), which writes the
//      `opencode-free` route into the `llm-pi-ai` namespace — the same channel the
//      native Models page uses.
//   3. PROBES one model through the full free-tier contract (`/free-llms/health`), so
//      if OpenCode hardens the tier the panel says so instead of silently failing.
//
// Honesty: nothing is simulated. A model that upstream refuses reports its real code.
// The prompt-retention notice (free tier may keep prompts for training) is shown and
// must be acknowledged before Connect — never wired silently.
// ═══════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: '@local/kybernos-free-llms',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement

      const KB_NS = 'llm-pi-ai'
      const ROUTE_ID = 'opencode-free'

      // ── i18n minimal (fr first, en fallback) ─────────────────────────────
      const KB_M_T = {
        'kfl.titre': { fr: 'Free LLMs (OpenCode)', en: 'Free LLMs (OpenCode)' },
        'kfl.soustitre': { fr: 'Des modèles gratuits, sans compte ni clé API, via la couche gratuite d’OpenCode Zen.', en: 'Free models, no account or API key, through OpenCode Zen’s free tier.' },
        'kfl.avertis': { fr: 'Ces modèles sont gratuits : les prompts envoyés peuvent être conservés par OpenCode pour améliorer leurs modèles. N’y envoyez rien de sensible.', en: 'These models are free: prompts you send may be retained by OpenCode to improve their models. Do not send anything sensitive.' },
        'kfl.liste': { fr: 'Modèles gratuits disponibles', en: 'Available free models' },
        'kfl.vide': { fr: 'Aucun modèle gratuit détecté pour l’instant.', en: 'No free model detected right now.' },
        'kfl.catalogue.err': { fr: 'Catalogue injoignable : {err}', en: 'Catalog unreachable: {err}' },
        'kfl.connecter': { fr: 'Brancher sur DSH', en: 'Connect to DSH' },
        'kfl.connecte': { fr: 'Branché', en: 'Connected' },
        'kfl.deconnecter': { fr: 'Retirer', en: 'Remove' },
        'kfl.encours': { fr: 'Connexion…', en: 'Connecting…' },
        'kfl.accuse': { fr: 'J’ai compris que mes prompts peuvent être conservés.', en: 'I understand my prompts may be retained.' },
        'kfl.sonde': { fr: 'Tester un modèle', en: 'Probe a model' },
        'kfl.sonde.encours': { fr: 'Test…', en: 'Probing…' },
        'kfl.sonde.ok': { fr: 'Répond — contrat accepté.', en: 'Answers — contract accepted.' },
        'kfl.sonde.ko': { fr: 'Verrou refusé : {code}', en: 'Gate refused: {code}' },
        'kfl.relance': { fr: 'Si un modèle n’apparaît pas dans le sélecteur : relancez DSH.', en: 'If a model does not show in the picker: restart DSH.' },
        'kfl.auto': { fr: 'Activé automatiquement au premier lancement.', en: 'Enabled automatically at first run.' },
        'kfl.erreur': { fr: 'Erreur', en: 'Error' },
        'kfl.page.titre': { fr: 'Free LLMs (OpenCode)', en: 'Free LLMs (OpenCode)' },
      }
      let kbLocaleRead = () => 'en'
      // Text separator, locale-aware: French ' : ', English ': '.
      const sep = () => (String(kbLocaleRead()).toLowerCase().indexOf('fr') === 0 ? ' : ' : ': ')
      const m = (key, vars) => {
        let lang = 'en'
        try { lang = String(kbLocaleRead()) } catch (e) { lang = 'en' }
        const entry = KB_M_T[key]
        let text = entry === null || entry === undefined ? key : (entry[lang] !== undefined ? entry[lang] : entry.en)
        if (vars !== null && vars !== undefined) {
          for (const k of Object.keys(vars)) text = text.split('{' + k + '}').join(String(vars[k]))
        }
        return text
      }

      // ── icons (Lucide traces, same as the other plugins) ─────────────────
      const ICONS = {
        check: ['M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z', 'M8 12l3 3 5-6'],
        link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71 1.71'],
        refresh: ['M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8', 'M21 3v5h-5', 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16', 'M8 16H3v5'],
        trash: ['M3 6h18', 'M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2', 'M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14', 'M10 11v6', 'M14 11v6'],
      }
      const Ic = (name, size) => {
        const d = ICONS[name]
        if (d === undefined) return null
        const w = size === undefined ? 16 : size
        return h('svg', { width: w, height: w, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', focusable: 'false', style: { flex: 'none' } },
          d.map((p, i) => h('path', { d: p, key: i })))
      }

      // ── styles: shared kbm-* contract + this panel's kfl-* layout ───────
      const styles = (() => {
        const tags = new Set()
        return {
          insert(css, mark) {
            const tag = document.createElement('style')
            tag.dataset.plugin = mark
            tag.textContent = css
            document.head.append(tag)
            tags.add(tag)
            return () => { tags.delete(tag); tag.remove() }
          },
        }
      })()

      const KBM_CSS = "/* kbm-* : the shared Kybernos plugin contract (extract from dsh.css) */\n" +
        ".kbm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; border-radius: 18px; cursor: pointer; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); background: transparent; padding: 0 14px; }\n" +
        ".kbm-btn:disabled { cursor: not-allowed; opacity: 0.4; }\n" +
        ".kbm-btn-md { height: 36px; }\n" +
        ".kbm-btn-sm { height: 28px; font-size: 12px; line-height: 18px; padding: 0 10px; border-radius: 14px; }\n" +
        ".kbm-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }\n" +
        ".kbm-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n" +
        ".kbm-btn-ghost:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n" +
        ".kbm-btn-outline { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; }\n" +
        ".kbm-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n" +
        ".kbm-tag { display: inline-flex; align-items: center; border-radius: 999px; padding: 1px 8px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }\n" +
        ".kbm-tag[data-tone='neutral'] { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }\n" +
        ".kbm-tag[data-tone='success'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }\n" +
        ".kbm-tag[data-tone='warning'] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color: var(--dsw-alias-state-warn-primary); }\n" +
        ".kbm-dot { position: relative; display: inline-block; flex: none; width: 10px; height: 10px; }\n" +
        ".kbm-dot::after { content: ''; position: absolute; inset: 20%; border-radius: 50%; background: currentColor; }\n" +
        ".kbm-dot[data-state='done'] { color: var(--dsw-alias-state-success-primary); }\n" +
        ".kbm-dot[data-state='warning'] { color: var(--dsw-alias-state-warn-primary); }\n" +
        ".kbm-dot[data-state='error'] { color: var(--dsw-alias-state-error-primary); }\n" +
        ".kbm-dot[data-state='idle'] { color: var(--dsw-alias-state-idle-primary); }\n"

      const KFL_CSS = "/* kfl-* : the Free LLMs panel layout (this bundle only — DSH tokens) */\n" +
        ".kfl-root { border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-2); padding: 16px; max-width: 720px; margin-bottom: 16px; }\n" +
        ".kfl-titre { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600; letter-spacing: -.01em; color: var(--dsw-alias-label-primary); }\n" +
        ".kfl-soustitre { margin: 6px 0 14px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }\n" +
        ".kfl-avertis { margin: 0 0 14px; padding: 10px 12px; border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary)); font-size: 13px; line-height: 1.5; }\n" +
        "body:not([data-ds-dark-theme]) .kfl-avertis { color: color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,var(--dsw-alias-label-primary)); }\n" +
        "body[data-ds-dark-theme] .kfl-avertis { color: var(--dsw-alias-state-warn-primary); }\n" +
        ".kfl-section { margin: 0 0 8px; font-size: 12px; line-height: 18px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kfl-liste { display: flex; flex-direction: column; gap: 6px; margin: 0 0 12px; }\n" +
        ".kfl-mod { display: flex; align-items: center; gap: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 10px 12px; }\n" +
        ".kfl-mod-nom { flex: 1; min-width: 0; font-family: var(--ds-font-family-code, monospace); font-size: 13px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n" +
        ".kfl-accuse { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); cursor: pointer; }\n" +
        ".kfl-accuse input { flex: none; width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }\n" +
        ".kfl-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; }\n" +
        ".kfl-note { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kfl-erreur { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }\n" +
        ".kfl-sonde { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n" +
        ".kfl-sonde[data-ok='true'] { color: var(--dsw-alias-state-success-primary); }\n" +
        ".kfl-sonde[data-ok='false'] { color: var(--dsw-alias-state-error-primary); }\n"

      // ── host calls ───────────────────────────────────────────────────────
      const jsonGet = async (path) => {
        try {
          const r = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' })
          return await r.json()
        } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) } }
      }
      const jsonPost = async (path, body) => {
        try {
          const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body === undefined ? {} : body) })
          return await r.json()
        } catch (e) { return { ok: false, error: String(e && e.message ? e.message : e) } }
      }

      const skelHelper = () => {
        try {
          const k = window.__KB_SKEL__
          return (k !== null && k !== undefined && typeof k.bone === 'function' && typeof k.wrap === 'function') ? k : null
        } catch (e) { return null }
      }

      // ── the panel ────────────────────────────────────────────────────────
      const Panel = () => {
        const [status, setStatus] = React.useState(null)
        const [busy, setBusy] = React.useState(null) // 'connect' | 'probe' | null
        const [ack, setAck] = React.useState(false)
        const [erreur, setErreur] = React.useState(null)
        const [probe, setProbe] = React.useState(null)

        const refresh = React.useCallback(async () => {
          const s = await jsonGet('/free-llms/status')
          if (s && s.ok === true) {
            setStatus(s)
            setAck((s.state && s.state.acknowledged === true) || false)
            setErreur(null)
          } else {
            setErreur(m('kfl.erreur') + sep() + String((s && s.error) || 'status'))
          }
        }, [])

        React.useEffect(() => { refresh() }, [refresh])

        const connecter = async () => {
          setErreur(null); setBusy('connect')
          const r = await jsonPost('/free-llms/enable', { acknowledged: ack === true })
          setBusy(null)
          if (r && r.ok === true) { await refresh() } else {
            setErreur(m('kfl.erreur') + sep() + String((r && r.error) || 'refus'))
          }
        }
        const deconnecter = async () => {
          setErreur(null); setBusy('connect')
          await jsonPost('/free-llms/disable', {})
          setBusy(null)
          await refresh()
        }
        const sonder = async () => {
          setErreur(null); setProbe(null); setBusy('probe')
          const r = await jsonGet('/free-llms/health')
          setBusy(null)
          setProbe(r && r.ok === true ? { ok: true, model: r.model } : { ok: false, code: (r && r.code) || 'error' })
          await refresh()
        }

        const wired = status !== null && status.state && status.state.wired === true
        const models = status !== null && Array.isArray(status.models) ? status.models : []
        const catalogOk = status !== null && status.catalogOk === true

        return h('div', { className: 'kfl-root', 'data-kfl': 'panneau' },
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: 6 } },
            (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-free-llms' }) : null)),
          h('h2', { className: 'kfl-titre' }, m('kfl.titre')),
          h('p', { className: 'kfl-soustitre' }, m('kfl.soustitre')),
          h('p', { className: 'kfl-avertis' }, m('kfl.avertis')),

          h('div', { className: 'kfl-section' }, m('kfl.liste')),
          // Not read yet: bones in the rows' own box (the shared skeleton helper of the core plugin, window.__KB_SKEL__), instead of
          // the « no free model » line that then got replaced. Without the helper the line shows, as before.
          (status === null && erreur === null && skelHelper() !== null)
            ? skelHelper().wrap(m('kfl.liste'), 'kfl-liste', [0, 1, 2].map((i) => h('div', { className: 'kfl-mod kb-sk-row', key: 'sk' + i },
              skelHelper().bone(10, 10, 'round'), skelHelper().bone(i % 2 === 0 ? '46%' : '36%', 13), skelHelper().bone(34, 18, 'pill'))))
            : models.length === 0
            ? h('p', { className: 'kfl-note' }, catalogOk === false && status !== null && status.catalogError
              ? m('kfl.catalogue.err', { err: String(status.catalogError) })
              : m('kfl.vide'))
            : h('div', { className: 'kfl-liste' }, models.map((id) => h('div', { className: 'kfl-mod', key: id },
              h('span', { className: 'kbm-dot', 'data-state': 'done' }),
              h('span', { className: 'kfl-mod-nom', title: id }, id),
              h('span', { className: 'kbm-tag', 'data-tone': 'neutral' }, 'free')))),

          h('label', { className: 'kfl-accuse' },
            h('input', { type: 'checkbox', checked: ack, onChange: (e) => setAck(e.target.checked) }),
            h('span', null, m('kfl.accuse'))),

          h('div', { className: 'kfl-actions' },
            wired === true
              ? h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-outline', disabled: busy !== null, onClick: deconnecter },
                Ic('trash', 14), busy === 'connect' ? m('kfl.encours') : m('kfl.deconnecter'))
              : h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-primary', disabled: busy !== null || ack !== true || models.length === 0, onClick: connecter },
                Ic('link', 14), busy === 'connect' ? m('kfl.encours') : m('kfl.connecter')),
            h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-outline', disabled: busy !== null, onClick: sonder },
              Ic('refresh', 14), busy === 'probe' ? m('kfl.sonde.encours') : m('kfl.sonde'))),

          probe !== null
            ? h('div', { className: 'kfl-sonde', 'data-ok': probe.ok === true ? 'true' : 'false' },
              h('span', { className: 'kbm-dot', 'data-state': probe.ok === true ? 'done' : 'error' }),
              probe.ok === true ? m('kfl.sonde.ok') : m('kfl.sonde.ko', { code: String(probe.code || 'error') }))
            : null,

          status !== null && status.state && status.state.autoEnabled === true
            ? h('p', { className: 'kfl-note' }, m('kfl.auto')) : null,
          h('p', { className: 'kfl-note' }, m('kfl.relance')),
          erreur !== null ? h('p', { className: 'kfl-erreur' }, erreur) : null)
      }

      return {
        inject: ['slots', 'remote', 'locale'],
        apply(ctx) {
          try {
            const svc = ctx.get('locale')
            const lu = typeof svc === 'string' ? svc : (svc !== null && svc !== undefined ? (svc.locale || svc.current || svc.lang) : null)
            kbLocaleRead = () => (lu !== null && lu !== undefined && String(lu).toLowerCase().indexOf('fr') === 0) || String(document.documentElement.lang || '').toLowerCase().indexOf('fr') === 0 ? 'fr' : 'en'
          } catch (e) { kbLocaleRead = () => 'en' }
          styles.insert(KBM_CSS, '@local/kybernos-free-llms')
          styles.insert(KFL_CSS, '@local/kybernos-free-llms')
          // One door: the dedicated Settings section.
          ctx.effect(() => {
            const slots = ctx.get('slots')
            if (slots === undefined || slots === null) return undefined
            return slots.inject('settings.section', () => slots.register(
              { name: 'settings.section', id: 'kybernos-free-llms', order: 29, label: m('kfl.page.titre') },
              Panel))
          }, 'free-llms: settings section')
        },
      }
    } catch (bootError) {
      try { console.error('[kybernos-free-llms] load failed — plugin disabled, GUI preserved', bootError) } catch (e2) { /* no console */ }
      return { apply() { /* plugin disabled after load error */ } }
    }
  },
})
