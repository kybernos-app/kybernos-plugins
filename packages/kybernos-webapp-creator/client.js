// ═══════════════════════════════════════════════════════════════════════════
// kybernos-webapp-creator — CLIENT half.
//
// The plugin's own page (main.kybernos-webapp-creator): two tabs, Projects and
// Settings, plus the compact Webapps tab of the right sidebar. The page only
// talks to the host routes; settings are written through the host, which filters
// the keys — the client never touches a file.
//
// Registered by `window.__ModuleLoader__.load` (a bare IIFE does not activate).
// ═══════════════════════════════════════════════════════════════════════════

window.__ModuleLoader__.load({
  id: '@local/kybernos-webapp-creator/client',
  factory (require) {
    const React = require('react')
    const h = React.createElement

    const TYPE_ID = 'kybernos-webapp-creator'
    const KIND = 'kybernos-webapp-creator'
    const SLOT_PAGE = 'main.kybernos-webapp-creator'
    const SLOT_PANE = 'sidebar.right.pane.tab'
    const STYLE_ID = 'kbwc-styles'

    const lang = () => {
      try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
    }
    const kt = (fr, en) => (String(lang()).toLowerCase().indexOf('fr') === 0 ? fr : en)

    const CSS = `
.kbwc { display: grid; gap: 16px; font-size: 13px; color: var(--dsw-alias-label-primary, inherit); }
.kbwc-tabs { display: flex; gap: 8px; }
.kbwc-tab { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); background: none; color: inherit; font: inherit; cursor: pointer; }
.kbwc-tab[data-on="true"] { background: var(--dsw-alias-state-primary, #2563eb); border-color: transparent; color: var(--dsw-alias-label-on-primary, #fff); }
.kbwc-card { border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.25)); border-radius: 12px; padding: 12px 14px; display: grid; gap: 8px; background: var(--dsw-alias-bg-module, transparent); }
.kbwc-row { display: flex; align-items: center; gap: 10px; }
.kbwc-row .kbwc-name { font-weight: 600; }
.kbwc-row .kbwc-sub { opacity: .7; font-size: 12px; }
.kbwc-dot { width: 10px; height: 10px; border-radius: 50%; background: #9ca3af; flex: none; }
.kbwc-dot[data-on="running"] { background: var(--dsw-alias-state-success-primary); }
.kbwc-dot[data-on="error"] { background: var(--dsw-alias-state-error-primary); }
.kbwc-spacer { flex: 1 1 auto; }
.kbwc-btn { padding: 5px 12px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); background: none; color: inherit; font: inherit; cursor: pointer; }
.kbwc-btn:hover { border-color: var(--dsw-alias-state-primary, #2563eb); }
.kbwc-btn[data-kind="primary"] { background: var(--dsw-alias-state-primary, #2563eb); border-color: transparent; color: var(--dsw-alias-label-on-primary, #fff); }
.kbwc-btn:disabled { opacity: .45; cursor: not-allowed; }
.kbwc-pills { display: flex; flex-wrap: wrap; gap: 6px; }
.kbwc-pill { padding: 4px 12px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); background: none; color: inherit; font: inherit; cursor: pointer; }
.kbwc-pill[data-on="true"] { background: var(--dsw-alias-label-primary, #222); border-color: transparent; color: var(--dsw-alias-bg-base, #fff); }
.kbwc-label { font-weight: 600; margin-top: 4px; }
.kbwc-note { opacity: .7; font-size: 12px; }
.kbwc-num { width: 90px; padding: 5px 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l3, rgba(127,127,127,.35)); background: none; color: inherit; font: inherit; }
.kbwc-ok { color: var(--dsw-alias-state-success-primary); }
.kbwc-err { color: var(--dsw-alias-state-error-primary); }
.kbwc-empty { opacity: .6; padding: 18px 4px; }
`

    const api = (path, body) => fetch('/kybernos-webapp-creator' + path, body === undefined
      ? undefined
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => ({ ok: false, error: 'host unreachable' }))

    // ── shared bits ─────────────────────────────────────────────────────────
    const Dot = ({ statut }) => h('span', {
      className: 'kbwc-dot',
      'data-on': statut && statut.running === true ? 'running' : 'idle',
      title: statut && statut.running === true ? kt('en marche', 'running') : kt('arrêtée', 'stopped'),
    })

    const AppsList = ({ apps, onAction, compact }) => {
      if (!apps || apps.length === 0) {
        return h('div', { className: 'kbwc-empty' }, kt('Aucune app — créez-en une depuis le chat.', 'No webapp yet — create one from the chat.'))
      }
      return h('div', { className: 'kbwc', style: { gap: compact ? 8 : 10 } }, apps.map((a) => {
        const running = a.statut && a.statut.running === true
        return h('div', { className: 'kbwc-card', key: a.slug },
          h('div', { className: 'kbwc-row' },
            h(Dot, { statut: a.statut }),
            h('span', { className: 'kbwc-name' }, a.nom),
            h('span', { className: 'kbwc-sub' }, a.slug + ' · ' + a.stack),
            h('span', { className: 'kbwc-spacer' }),
            running && a.statut && a.statut.port
              ? h('a', { className: 'kbwc-btn', href: 'http://127.0.0.1:' + a.statut.port, target: '_blank', rel: 'noreferrer' }, kt('Ouvrir', 'Open'))
              : null,
            h('button', {
              className: 'kbwc-btn', 'data-kind': running ? undefined : 'primary', disabled: true === a.busy,
              onClick: () => onAction(running ? 'stop' : 'start', a),
            }, running ? kt('Arrêter', 'Stop') : kt('Démarrer', 'Start')),
          ),
          compact ? null : h('div', { className: 'kbwc-note' }, kt('données dans la mini base', 'mini base data') + ' · ' + (a.donnees === 'personnel' ? kt('données personnelles — clé requise', 'personal data — key required') : 'public')),
        )
      }))
    }

    // ── the Projects tab ────────────────────────────────────────────────────
    const SECTEURS = ['mode', 'alimentation', 'artisanat', 'beaute', 'sante', 'tech', 'maison', 'sport', 'services', 'papeterie']

    const ProjectsView = () => {
      const [etat, setEtat] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [erreur, setErreur] = React.useState(null)
      const charger = React.useCallback(() => { api('/state').then((r) => { setEtat(r); setErreur(r.ok === true ? null : r.error) }) }, [])
      React.useEffect(() => { charger() }, [charger])
      const onAction = (action, app) => {
        setBusy(app.slug)
        api('/' + action, { slug: app.slug }).then((r) => {
          setBusy(null)
          if (r.ok !== true) setErreur(r.error || action + ' failed')
          charger()
        })
      }
      return h('div', { className: 'kbwc' },
        h('div', { className: 'kbwc-row' },
          h('span', { className: 'kbwc-label' }, kt('Mes apps web', 'My webapps')),
          h('span', { className: 'kbwc-spacer' }),
          h('button', { className: 'kbwc-btn', onClick: charger }, kt('Rafraîchir', 'Refresh')),
        ),
        erreur ? h('div', { className: 'kbwc-err' }, erreur) : null,
        h(AppsList, { apps: etat && etat.apps, onAction }),
      )
    }

    // ── the Settings tab ────────────────────────────────────────────────────
    const pills = (value, options, onPick) => h('div', { className: 'kbwc-pills' },
      options.map((o) => h('button', {
        key: o.v, className: 'kbwc-pill', 'data-on': value === o.v ? 'true' : 'false',
        onClick: () => onPick(o.v),
      }, o.label)))

    const SettingsView = () => {
      const [reglages, setReglages] = React.useState(null)
      const [sauve, setSauve] = React.useState(null)
      React.useEffect(() => { api('/settings').then((r) => { if (r.ok === true) setReglages(r.reglages) }) }, [])
      const maj = (patch) => { setReglages(Object.assign({}, reglages, patch)); setSauve(null) }
      const sauver = () => {
        setSauve(null)
        api('/settings', { webappCreator: reglages }).then((r) => {
          if (r.ok === true) { setReglages(r.reglages); setSauve(kt('Enregistré ✓', 'Saved ✓')) } else setSauve('✗ ' + (r.error || 'refused'))
        })
      }
      if (reglages === null) return h('div', { className: 'kbwc-note' }, kt('Chargement…', 'Loading…'))
      return h('div', { className: 'kbwc' },
        h('div', { className: 'kbwc-label' }, kt('Cible de déploiement', 'Deploy target')),
        pills(reglages.deployTarget, [
          { v: 'computer', label: kt('Mon ordinateur', 'My computer') },
          { v: 'fly', label: 'Fly.io' },
          { v: 'cloud-computer', label: kt('Cloud Computer', 'Cloud Computer') },
        ], (v) => maj({ deployTarget: v })),
        h('div', { className: 'kbwc-note' }, kt('Son ordi : gratuit, mais le site dort avec lui. Fly : toujours en ligne.', 'Your computer: free, but the site sleeps with it. Fly: always up.')),

        h('div', { className: 'kbwc-label' }, kt('Accès par défaut des nouvelles boutiques', 'Default access for new shops')),
        pills(reglages.linkPolicy, [
          { v: 'cle', label: kt('Clé de lien', 'Link key') },
          { v: 'public', label: kt('Public', 'Public') },
        ], (v) => maj({ linkPolicy: v })),

        h('div', { className: 'kbwc-label' }, kt('Palette de secteur par défaut', 'Default sector palette')),
        pills(reglages.sector, SECTEURS.map((s) => ({ v: s, label: s })), (v) => maj({ sector: v })),

        h('div', { className: 'kbwc-label' }, kt('Quotas', 'Quotas')),
        h('div', { className: 'kbwc-row' },
          h('span', { className: 'kbwc-note' }, kt('Images (Ko)', 'Media (KB)')),
          h('input', { className: 'kbwc-num', type: 'number', value: reglages.quotaMediaKo, onChange: (e) => maj({ quotaMediaKo: Number(e.target.value) }) }),
          h('span', { className: 'kbwc-note' }, kt('Produits', 'Products')),
          h('input', { className: 'kbwc-num', type: 'number', value: reglages.quotaProduits, onChange: (e) => maj({ quotaProduits: Number(e.target.value) }) }),
        ),

        h('div', { className: 'kbwc-card' },
          h('div', { className: 'kbwc-label' }, kt('Paiements et emails', 'Payments and emails')),
          h('div', { className: 'kbwc-note' }, kt('Les clés Stripe et Resend vivent côté hôte (secrets) — jamais dans les fichiers.', 'Stripe and Resend keys live on the host side (secrets) — never in files.')),
          pills(reglages.stripeMode, [{ v: 'test', label: 'Stripe test' }, { v: 'live', label: 'Stripe live' }], (v) => maj({ stripeMode: v })),
          h('div', { className: 'kbwc-note' }, kt('Domaine', 'Domain') + ' : kaby.app'),
        ),

        h('div', { className: 'kbwc-row' },
          h('button', { className: 'kbwc-btn', 'data-kind': 'primary', onClick: sauver }, kt('Enregistrer', 'Save')),
          sauve ? h('span', { className: sauve.indexOf('✓') > 0 ? 'kbwc-ok' : 'kbwc-err' }, sauve) : null,
        ),
      )
    }

    // ── the page (two tabs) ─────────────────────────────────────────────────
    const WebappPage = () => {
      const [onglet, setOnglet] = React.useState('projects')
      return h('div', { className: 'kbwc' },
        h('div', { className: 'kbwc-row' },
          h('div', { className: 'kbwc-tabs' },
            h('button', { className: 'kbwc-tab', 'data-on': onglet === 'projects' ? 'true' : 'false', onClick: () => setOnglet('projects') }, kt('Projets', 'Projects')),
            h('button', { className: 'kbwc-tab', 'data-on': onglet === 'settings' ? 'true' : 'false', onClick: () => setOnglet('settings') }, kt('Réglages', 'Settings')),
          ),
          h('span', { className: 'kbwc-spacer' }),
          (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-webapp-creator' }) : null),
        ),
        onglet === 'projects' ? h(ProjectsView) : h(SettingsView),
      )
    }

    // ── the compact right-pane tab ──────────────────────────────────────────
    const WebappsPane = () => {
      const [etat, setEtat] = React.useState(null)
      const charger = React.useCallback(() => { api('/state').then(setEtat) }, [])
      React.useEffect(() => { charger() }, [charger])
      const onAction = (action, app) => api('/' + action, { slug: app.slug }).then(charger)
      return h('div', { className: 'kbwc', 'data-kb': 'webapps-pane' },
        h(AppsList, { apps: etat && etat.apps, onAction, compact: true }))
    }

    const TAB_ICON = (props) => {
      const px = props && typeof props.size === 'number' ? props.size : 22
      return h('svg', { width: px, height: px, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: props ? props.className : undefined },
        h('rect', { x: 3, y: 4, width: 18, height: 14, rx: 2 }),
        h('path', { d: 'M3 9h18M8 18v2h8v-2' }))
    }

    function apply (ctx) {
      ctx.effect(() => {
        if (document.getElementById(STYLE_ID)) return undefined
        const el = document.createElement('style')
        el.id = STYLE_ID
        el.setAttribute('data-plugin', '@local/kybernos-webapp-creator')
        el.textContent = CSS
        document.head.appendChild(el)
        return () => el.remove()
      }, 'kybernos-webapp-creator: styles')

      // the plugin's own page
      ctx.effect(() => ctx.slots.inject(SLOT_PAGE, () => ctx.slots.register({ name: SLOT_PAGE }, WebappPage)), 'kybernos-webapp-creator: page')

      // the right-pane tab
      let registre = null
      try { registre = ctx.get('sidebarRightTabs') } catch (e) { registre = null }
      if (registre && typeof registre.register === 'function') {
        ctx.effect(() => registre.register({
          id: TYPE_ID,
          kind: KIND,
          title: () => 'Webapps',
          guide: [{ title: () => 'Webapps', description: () => kt('Vos apps web : état, démarrage, arrêt.', 'Your webapps: state, start, stop.'), icon: TAB_ICON }],
        }), 'kybernos-webapp-creator: sidebar tab type')
      }
      ctx.effect(() => ctx.slots.inject(SLOT_PANE, () => ctx.slots.register({ name: SLOT_PANE, key: TYPE_ID }, WebappsPane)), 'kybernos-webapp-creator: pane body')
    }

    return {
      inject: ['slots', 'sidebarRightTabs'],
      apply,
      __test: { AppsList, ProjectsView, SettingsView, WebappPage, WebappsPane, pills, kt, CSS },
    }
  },
})
