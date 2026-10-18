// kybernos-servers, client: the Settings page « Servers ».
//
// A server is an address and your account on it. The page lists the servers DSH knows, adds one from its address (paste, « Add and sign in », confirm
// the code in the browser), switches, renames and removes. It invents nothing: the list comes from the cloud plugin through GET
// /kybernos-servers/status, every change goes through this plugin's host routes, the sign-in is the cloud plugin's own device pairing.
//
// Rules the page follows:
//   - nothing here asks for anything but an address and, later, your account; the server decides who may have one;
//   - the addresses a server publishes are shown before it is added (the account's token will go there): one line « only to <host> », the full list
//     one click away, and open by default when one of them is on another host than the one typed;
//   - the way back to Kybernos Cloud is always offered;
//   - what a switch changes and what stays is said before it happens.

window.__ModuleLoader__.load({
  id: '@local/kybernos-servers/client',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement

      // French is the source, English the pair; French only for a French UI, a translated language is looked up by its French text,
      // and every other language (and a language not known yet) reads English (scripts/test-no-french-literals.mjs).
      const lang = () => {
        try { return String(typeof window.__KB_LANG_RESOLVE__ === 'function' ? window.__KB_LANG_RESOLVE__() : (document.documentElement.lang || 'en')) } catch (e) { return 'en' }
      }
      const kt = (fr, en) => {
        const l = lang()
        if (l === 'kybernos' || l.slice(0, 2) === 'fr') return fr
        if (l === 'en') return en
        try {
          const a = window.__KB_I18N_ACTIVE__
          if (a !== null && a !== undefined && a.dict !== null && typeof a.dict === 'object' && typeof a.dict[fr] === 'string') return a.dict[fr]
        } catch (e) { /* no dictionary: English */ }
        return en
      }

      const BUILTIN_ID = 'kybernos-cloud'
      /** The address behind « Talk to us ». Empty = the button is not drawn (never a dead button). Set by the owner with the final copy. */
      const ENTERPRISE_CONTACT = ''

      const CSS = `
.kbsv-page,.kbsv-page *,.kbsv-veil,.kbsv-veil *{box-sizing:border-box}
.kbsv-page{max-width:720px;font-size:14px;line-height:1.5;display:flex;flex-direction:column;gap:18px;color:var(--dsw-alias-label-primary,inherit)}
[data-slot="settings.section"]:has(.kbsv-page){width:100%;max-width:none}
.kbsv-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.kbsv-title{margin:0;font-size:20px;line-height:1.3;font-weight:600;letter-spacing:-.01em}
.kbsv-sub{margin:2px 0 0;font-size:13px;color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-acts{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.kbsv-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 16px;border-radius:18px;border:.5px solid var(--dsw-alias-border-l3,rgba(0,0,0,.12));background:transparent;color:inherit;font:inherit;font-size:14px;cursor:pointer;white-space:nowrap;text-decoration:none}
.kbsv-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.kbsv-btn:disabled{cursor:not-allowed;opacity:.4}
.kbsv-btn[data-primary="true"]{border-color:transparent;background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary,currentColor));color:var(--dsw-alias-label-primary-foreground,#fff)}
.kbsv-btn[data-small="true"]{height:28px;padding:0 12px;font-size:12px;border-radius:14px}
.kbsv-btn[data-quiet="true"]{border-color:transparent}
.kbsv-link{border:0;background:none;padding:0;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);font:inherit;font-size:12px;cursor:pointer}
.kbsv-link:hover{text-decoration:underline}
.kbsv-btn:focus-visible,.kbsv-input:focus-visible,.kbsv-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6);outline-offset:2px}
.kbsv-help{display:inline-flex;align-items:center}
.kbsv-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 14px;border-radius:12px;background:var(--dsw-alias-state-warn-tertiary,rgba(245,158,11,.12));color:var(--dsw-alias-state-warn-label,inherit);font-size:13px}
.kbsv-banner .kbsv-btn{margin-inline-start:auto;color:var(--dsw-alias-label-primary,inherit);background:var(--dsw-alias-bg-layer-1,transparent)}
.kbsv-list{display:flex;flex-direction:column;gap:10px}
.kbsv-row{border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));border-radius:14px;background:var(--dsw-alias-bg-layer-1,transparent)}
.kbsv-row[data-active="true"]{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#22c55e) 55%,transparent)}
.kbsv-top{display:flex;align-items:center;gap:14px;padding:12px 16px;flex-wrap:wrap}
.kbsv-tile{flex:none;width:38px;height:38px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08));color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-tile[data-k="production"]{background:var(--dsw-alias-brand-primary,currentColor);color:var(--dsw-alias-label-primary-inverted,#fff)}
.kbsv-who{flex:1;min-width:190px;display:flex;flex-direction:column;gap:2px}
.kbsv-name{font-weight:600;font-size:15px;overflow-wrap:anywhere}
.kbsv-role{font-size:12px;color:var(--dsw-alias-label-secondary,inherit);overflow-wrap:anywhere}
.kbsv-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:3px}
.kbsv-tag{display:inline-flex;align-items:center;padding:1px 9px;border-radius:999px;font-size:11px;font-weight:600;background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.08));color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-tag[data-tone="ok"]{background:var(--dsw-alias-state-success-tertiary,rgba(34,197,94,.14));color:var(--dsw-alias-state-success-primary,#22c55e)}
.kbsv-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.kbsv-det{border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.06));padding:12px 16px 14px;display:grid;gap:10px;font-size:12px}
.kbsv-addresses{margin:0;display:grid;grid-template-columns:84px 1fr;gap:4px 12px;font-size:12px}
.kbsv-addresses dt{color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-addresses dd{margin:0;font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);overflow-wrap:anywhere}
.kbsv-addr-box{padding:10px 12px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.kbsv-renamer{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.kbsv-chev{display:inline-block;transition:transform .15s}
[aria-expanded="true"]>.kbsv-chev{transform:rotate(180deg)}
.kbsv-note{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-ent{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:16px;padding:20px 22px;background:var(--dsw-alias-bg-layer-1,transparent);display:grid;gap:16px}
.kbsv-ent-kick{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--dsw-alias-brand-primary-new-colorprimary-new-color,#4176e6)}
.kbsv-ent h3{margin:2px 0 0;font-size:19px;line-height:1.3;letter-spacing:-.01em}
.kbsv-ent-lead{margin:6px 0 0;max-width:56ch;color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-feat{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 22px}
.kbsv-feat>div{display:grid;grid-template-columns:24px 1fr;gap:10px}
.kbsv-feat svg{width:22px;height:22px}
.kbsv-feat b{display:block;font-size:13px}
.kbsv-feat span{font-size:13px;color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-cta{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.kbsv-veil{position:fixed;inset:0;z-index:2147483000;background:var(--dsw-alias-bg-mask-1,rgba(0,0,0,.4));display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto}
.kbsv-dlg{margin-block:auto;width:100%;max-width:560px;display:grid;gap:16px;padding:22px;border-radius:18px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,inherit);box-shadow:0 16px 48px rgba(0,0,0,.28)}
.kbsv-dlg h3{margin:0;font-size:17px}
.kbsv-foot{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;align-items:center}
.kbsv-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.kbsv-field>label{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-input{width:100%;height:36px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4,rgba(0,0,0,.2));border-radius:10px;background:var(--dsw-alias-bg-layer-1,transparent);color:inherit;font:inherit}
.kbsv-input:focus{border-color:var(--dsw-alias-brand-primary,currentColor);outline:none}
.kbsv-found{display:grid;grid-template-columns:38px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.1));border-radius:14px;background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.kbsv-steps{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.kbsv-steps li{display:flex;gap:8px;font-size:13px}
.kbsv-steps li[data-ok="false"]{color:var(--dsw-alias-state-error-primary,#ec1313)}
.kbsv-error{margin:0;font-size:13px;color:var(--dsw-alias-state-error-primary,#ec1313)}
.kbsv-two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.kbsv-two ul{margin:6px 0 0;padding-inline-start:18px;font-size:13px;display:grid;gap:2px}
.kbsv-kick{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--dsw-alias-label-secondary,inherit)}
.kbsv-code{font-family:var(--ds-font-family-code,ui-monospace,Menlo,monospace);font-size:22px;font-weight:700;letter-spacing:.1em}
.kbsv-toast{position:fixed;inset-inline:0;bottom:20px;display:flex;justify-content:center;z-index:2147483001;pointer-events:none;padding:0 16px}
.kbsv-toast>div{background:var(--dsw-alias-label-primary,#111);color:var(--dsw-alias-label-primary-inverted,#fff);border-radius:14px;padding:9px 16px;font-size:13px;max-width:520px;box-shadow:0 8px 24px rgba(0,0,0,.25)}
.kbsv-wait{display:inline-block;width:12px;height:12px;border:2px solid currentColor;border-top-color:transparent;border-radius:50%;animation:kbsv-spin .8s linear infinite;vertical-align:-2px;margin-inline-end:6px;opacity:.6}
@keyframes kbsv-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.kbsv-wait{animation:none}.kbsv-chev{transition:none}}
@media (max-width:640px){.kbsv-feat,.kbsv-two{grid-template-columns:1fr}}
`

      // ── Words: French and English pairs; host error codes are mapped, never shown raw ──
      const ERR = {
        bad_address: ['Adresse invalide.', 'Invalid address.'],
        insecure_address: ['Utilisez une adresse https.', 'Use an https address.'],
        unreachable: ['Le serveur ne répond pas.', 'The server does not answer.'],
        redirect: ['Le serveur redirige ailleurs : saisissez son adresse finale.', 'The server redirects elsewhere: type its final address.'],
        no_profile: ['Ce serveur ne publie pas de profil Kybernos.', 'This server does not publish a Kybernos profile.'],
        incompatible: ['Ce serveur demande une version plus récente de DSH.', 'This server needs a newer version of DSH.'],
        already_listed: ['Ce serveur est déjà dans ta liste.', 'This server is already in your list.'],
        profile_refused: ['Le profil publié par ce serveur est refusé (adresse invalide).', 'The profile this server publishes is refused (invalid address).'],
        registry_unreadable: ['Le fichier des serveurs est illisible : corrige-le à la main, rien n’a été modifié.', 'The servers file is unreadable: fix it by hand, nothing was changed.'],
        cloud_plugin_missing: ['Le module Cloud ne répond pas : redémarre DSH.', 'The Cloud module does not answer: restart DSH.'],
        apply_failed: ['Le changement a échoué et a été annulé.', 'The change failed and was undone.'],
        unknown_server: ['Serveur inconnu.', 'Unknown server.'],
        bad_name: ['Ce nom n’est pas utilisable.', 'This name cannot be used.'],
        bad_id: ['Serveur inconnu.', 'Unknown server.'],
        pairing_failed: ['Impossible de joindre ce serveur pour la connexion.', 'Cannot reach this server to sign in.'],
        code_expired: ['Le code a expiré. Si tu ne peux pas créer de compte sur ce serveur, demande à son administrateur.', 'The code expired. If you cannot create an account on this server, ask its administrator.'],
      }
      const say = (code) => { const e = ERR[code]; return e === undefined ? kt('Une erreur est survenue.', 'Something went wrong.') : kt(e[0], e[1]) }
      const STEP = {
        reach: ['Le serveur répond', 'The server answers'],
        wellknown: ['Il publie un profil Kybernos', 'It publishes a Kybernos profile'],
        compat: ['Il est compatible avec cette version de DSH', 'It is compatible with this version of DSH'],
      }

      const hostOf = (u) => { try { return new URL(u).host } catch (e) { return String(u || '') } }
      const initial = (name) => String(name || '?').trim().charAt(0).toUpperCase() || '?'

      /** The four things the Enterprise card says. Each stays true only while the server does it (docs/dev/servers-page-spec.md § 4.7). */
      const ENTERPRISE = [
        ['server', ['Ton propre serveur', 'Your own server'], ['Installe le serveur Kybernos chez toi ou chez ton hébergeur. Comptes, équipes et mémoire restent sur ton serveur.', 'Install the Kybernos server on your infrastructure or your host. Accounts, teams and memory stay on your server.']],
        ['book', ['Tes compétences', 'Your skills'], ['Partage les skills et les leçons de ton équipe depuis ton propre catalogue.', 'Share your team’s skills and lessons from your own catalogue.']],
        ['key', ['Tes propres clés d’API', 'Your own API keys'], ['Apporte tes clés de fournisseurs (BYOK) : tes modèles, tes contrats, ta facture.', 'Bring your own provider keys (BYOK): your models, your contracts, your bill.']],
        ['shield', ['Le contrôle', 'Control'], ['Rôles, double authentification exigée, limites d’usage et journal d’audit.', 'Roles, required two-factor sign-in, usage limits and an audit trail.']],
      ]
      const ICON = {
        server: [['rect', { x: 3, y: 3, width: 18, height: 7, rx: 2 }], ['rect', { x: 3, y: 14, width: 18, height: 7, rx: 2 }], ['path', { d: 'M7 6.5h.01M7 17.5h.01' }]],
        book: [['path', { d: 'M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z' }], ['path', { d: 'M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3' }]],
        key: [['circle', { cx: 8, cy: 15, r: 4 }], ['path', { d: 'M11 12l9-9M16 7l3 3M14 9l2 2' }]],
        shield: [['path', { d: 'M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6z' }], ['path', { d: 'M9 12l2 2 4-4' }]],
        chev: [['path', { d: 'M6 9l6 6 6-6' }]],
      }
      const Icon = (name, size) => h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' },
        ICON[name].map((p, i) => h(p[0], Object.assign({ key: i }, p[1]))))

      // ── The view: everything on screen is a function of (data, ui). No state, no effect: testable as static markup. ──
      const HelpButton = () => (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h('span', { className: 'kbsv-help' }, h(window.__KB_HELP__.Help, { id: 'kybernos-servers' })) : null)

      const Steps = ({ steps }) => h('ul', { className: 'kbsv-steps' }, steps.map((s) => h('li', { key: s.id, 'data-ok': String(s.ok) },
        h('span', { 'aria-hidden': 'true' }, s.ok ? '✓' : '✗'), kt(STEP[s.id][0], STEP[s.id][1]))))

      /** The addresses a discovered profile sends the account to. `differs` = one of them is on another host than the one typed. */
      const addressesOf = (found) => {
        const p = found.profile
        const base = p.api
        const llm = p.services !== undefined && p.services.llm !== undefined ? p.services.llm : null
        const conn = p.services !== undefined && p.services.connections !== undefined ? p.services.connections : null
        const rows = [
          ['API', p.api],
          ['Web', typeof p.web === 'string' ? p.web : base],
          ['Console', typeof p.console === 'string' ? p.console : base + '/workspace-console'],
          ['LLM', llm === false ? kt('aucun', 'none') : (typeof llm === 'string' ? llm : kt('même hôte que l’API', 'same host as the API'))],
          [kt('Apps connectées', 'Connected apps'), typeof conn === 'string' ? conn : kt('non proposées', 'not offered')],
        ]
        const hosts = [p.api, p.web, p.console, llm, conn].filter((x) => typeof x === 'string').map(hostOf)
        return { rows, differs: hosts.some((x) => x !== found.host) }
      }
      const Adresses = ({ rows }) => h('dl', { className: 'kbsv-addresses kbsv-addr-box', 'data-kb': 'servers-addresses' }, rows.map((r, i) => h(React.Fragment, { key: i }, h('dt', null, r[0]), h('dd', null, r[1]))))

      const Enterprise = ({ onAdd }) => h('section', { className: 'kbsv-ent', 'data-kb': 'servers-enterprise', 'aria-label': kt('Offre Entreprise', 'Enterprise offer') },
        h('div', null, h('div', { className: 'kbsv-ent-kick' }, kt('Entreprise', 'Enterprise')),
          h('h3', null, kt('Fais tourner Kybernos sur ton propre serveur', 'Run Kybernos on your own server')),
          h('p', { className: 'kbsv-ent-lead' }, kt('Tes équipes gardent la même application. Tu gardes les clés, les compétences et les données.', 'Your people keep the same app. You keep the keys, the skills and the data.'))),
        h('div', { className: 'kbsv-feat' }, ENTERPRISE.map((f) => h('div', { key: f[0] }, Icon(f[0], 22), h('div', null, h('b', null, kt(f[1][0], f[1][1])), h('span', null, kt(f[2][0], f[2][1])))))),
        h('div', { className: 'kbsv-cta' },
          ENTERPRISE_CONTACT !== '' ? h('a', { className: 'kbsv-btn', 'data-primary': 'true', 'data-kb': 'servers-contact', href: ENTERPRISE_CONTACT, target: '_blank', rel: 'noopener noreferrer' }, kt('Parler à l’équipe', 'Talk to us')) : null,
          h('button', { type: 'button', className: 'kbsv-btn', 'data-kb': 'servers-enterprise-add', onClick: onAdd }, kt('Mon entreprise a déjà un serveur', 'My company already has a server'))))

      const Row = ({ s, ui, act }) => {
        const cloud = s.id === BUILTIN_ID
        const open = ui.details[s.id] === true
        const draft = ui.names[s.id] !== undefined ? ui.names[s.id] : s.name
        const base = typeof s.api === 'string' ? s.api : ''
        return h('div', { className: 'kbsv-row', 'data-active': String(s.active === true), 'data-kb': 'servers-row', 'data-server': s.id },
          h('div', { className: 'kbsv-top' },
            h('span', { className: 'kbsv-tile', 'data-k': cloud ? 'production' : 'server', 'aria-hidden': 'true' }, initial(s.name)),
            h('div', { className: 'kbsv-who' }, h('span', { className: 'kbsv-name' }, s.name),
              h('span', { className: 'kbsv-role' }, cloud ? kt('Hébergé par Kybernos', 'Managed by Kybernos') : hostOf(s.api)),
              h('div', { className: 'kbsv-tags' },
                s.active ? h('span', { className: 'kbsv-tag', 'data-tone': 'ok' }, kt('Actif', 'Active')) : null,
                h('span', { className: 'kbsv-tag' }, s.connected ? kt('Connecté', 'Signed in') : kt('Non connecté', 'Not signed in')),
                s.llm === 'none' ? h('span', { className: 'kbsv-tag' }, kt('Sans modèles Kybernos', 'No Kybernos models')) : null)),
            h('div', { className: 'kbsv-actions' },
              !s.active ? h('button', { type: 'button', className: 'kbsv-btn', 'data-small': 'true', 'data-kb': 'servers-switch', onClick: () => act.askSwitch(s) }, kt('Passer à ce serveur', 'Switch to this server')) : null,
              s.active && !s.connected ? h('button', { type: 'button', className: 'kbsv-btn', 'data-small': 'true', 'data-primary': 'true', 'data-kb': 'servers-signin', onClick: () => act.signIn(s) }, kt('Se connecter', 'Sign in')) : null,
              h('button', { type: 'button', className: 'kbsv-btn', 'data-small': 'true', 'data-quiet': 'true', 'data-kb': 'servers-details', 'aria-expanded': String(open), onClick: () => act.toggleDetails(s.id) }, kt('Détails', 'Details') + ' ', h('span', { className: 'kbsv-chev' }, Icon('chev', 12))),
              !cloud ? h('button', { type: 'button', className: 'kbsv-btn', 'data-small': 'true', 'data-quiet': 'true', 'data-kb': 'servers-remove', onClick: () => act.askRemove(s) }, kt('Retirer', 'Remove')) : null)),
          open ? h('div', { className: 'kbsv-det', 'data-kb': 'servers-det' },
            h('dl', { className: 'kbsv-addresses' },
              h('dt', null, 'API'), h('dd', null, base),
              h('dt', null, 'Web'), h('dd', null, typeof s.web === 'string' ? s.web : base),
              h('dt', null, 'Console'), h('dd', null, typeof s.console === 'string' ? s.console : base + '/workspace-console'),
              h('dt', null, 'LLM'), h('dd', null, s.llm === 'none' ? kt('aucun', 'none') : (typeof s.llm === 'string' && s.llm !== 'api' ? s.llm : kt('même hôte que l’API', 'same host as the API'))),
              h('dt', null, kt('Apps connectées', 'Connected apps')), h('dd', null, s.connections === true ? kt('proposées', 'offered') : kt('non proposées', 'not offered'))),
            h('div', { className: 'kbsv-note' }, kt('Ta connexion et son jeton ne vont qu’à ces adresses.', 'Your sign-in and its token only go to these addresses.')),
            !cloud ? h('div', { className: 'kbsv-renamer' },
              h('label', { className: 'kbsv-note', htmlFor: 'kbsv-rename-' + s.id }, kt('Nom', 'Name')),
              h('input', { className: 'kbsv-input', id: 'kbsv-rename-' + s.id, style: { maxWidth: '260px' }, value: draft, maxLength: 60, 'data-kb': 'servers-rename', onChange: (e) => act.setName(s.id, e.target.value) }),
              h('button', { type: 'button', className: 'kbsv-btn', 'data-small': 'true', 'data-kb': 'servers-rename-go', disabled: draft.trim() === '' || draft.trim() === s.name, onClick: () => act.rename(s.id) }, kt('Enregistrer', 'Save'))) : null) : null)
      }

      const AddDialog = ({ add, act }) => {
        const r = add.result
        const ok = r !== null && r.ok === true
        const shownName = add.name !== '' ? add.name : (ok ? r.suggested : '')
        const addr = ok ? addressesOf(r) : null
        return h('div', { className: 'kbsv-veil', role: 'presentation', onMouseDown: (e) => { if (e.target === e.currentTarget) act.closeAdd() } },
          h('div', { className: 'kbsv-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbsv-add-t', 'data-kb': 'servers-add-dialog' },
            h('div', null, h('h3', { id: 'kbsv-add-t' }, kt('Ajouter un serveur', 'Add a server')),
              h('p', { className: 'kbsv-note', style: { marginTop: '4px', fontSize: '13px' } }, kt('Ton entreprise ou ton équipe a son propre serveur Kybernos ? Colle son adresse.', 'Does your company or team run its own Kybernos server? Paste its address.'))),
            h('div', { className: 'kbsv-field' },
              h('label', { htmlFor: 'kbsv-address' }, kt('Adresse du serveur', 'Server address')),
              h('input', { className: 'kbsv-input', id: 'kbsv-address', 'data-kb': 'servers-address', value: add.address, placeholder: 'kb.acme.corp', autoComplete: 'off', spellCheck: false, autoFocus: true,
                onChange: (e) => act.setAddress(e.target.value), onPaste: act.pasted, onBlur: () => act.check(), onKeyDown: (e) => { if (e.key === 'Enter') { e.preventDefault(); act.check() } } }),
              h('span', { className: 'kbsv-note' }, kt('Donnée par ton administrateur.', 'Given by your administrator.'))),
            add.busy ? h('p', { className: 'kbsv-note', role: 'status' }, h('span', { className: 'kbsv-wait' }), kt('Vérification…', 'Checking…')) : null,
            r !== null && !ok ? h(React.Fragment, null,
              r.steps.length > 0 ? h(Steps, { steps: r.steps }) : null,
              h('p', { className: 'kbsv-error', role: 'alert', 'data-kb': 'servers-add-error' }, say(r.error))) : null,
            ok ? h(React.Fragment, null,
              h('div', { className: 'kbsv-found', 'data-kb': 'servers-found' },
                h('span', { className: 'kbsv-tile', 'data-k': 'server', 'aria-hidden': 'true' }, initial(shownName)),
                h('div', { style: { minWidth: 0 } },
                  add.editName ? h('input', { className: 'kbsv-input', id: 'kbsv-name', 'aria-label': kt('Nom', 'Name'), 'data-kb': 'servers-name', value: shownName, maxLength: 60, onChange: (e) => act.setAddName(e.target.value) }) : h('div', { style: { fontWeight: 600, overflowWrap: 'anywhere' } }, shownName),
                  h('div', { className: 'kbsv-note' }, r.host + ' · ' + kt('serveur vérifié', 'server checked') + ' ✓')),
                h('button', { type: 'button', className: 'kbsv-link', 'data-kb': 'servers-rename-toggle', onClick: act.toggleEditName }, add.editName ? 'OK' : kt('Modifier le nom', 'Rename'))),
              h('p', { className: 'kbsv-note' }, kt('Ta connexion et son jeton iront uniquement à ', 'Your sign-in and its token will only go to '), h('b', null, r.host), '. ',
                h('button', { type: 'button', className: 'kbsv-link', 'data-kb': 'servers-see-addresses', 'aria-expanded': String(add.showAddr || addr.differs), onClick: act.toggleAddr }, kt('Voir les adresses', 'See the addresses'))),
              add.showAddr || addr.differs ? h(Adresses, { rows: addr.rows }) : null,
              h('p', { style: { margin: 0, fontSize: '13px' } }, kt('Tu te connecteras avec ', 'You will sign in with '), h('b', null, kt('ton compte sur ce serveur', 'your account on this server')), kt(' : un code s’affiche, tu le confirmes dans le navigateur.', ': a code appears, you confirm it in your browser.')),
              h('p', { className: 'kbsv-note' }, kt('DSH passera sur ce serveur : le compte, les modèles et l’équipe viendront d’ici. Tes conversations, fichiers et mémoire restent.', 'DSH will switch to this server: the account, models and team will come from it. Your chats, files and memory stay.'))) : null,
            add.error !== null ? h('p', { className: 'kbsv-error', role: 'alert', 'data-kb': 'servers-add-failed' }, add.error) : null,
            h('div', { className: 'kbsv-foot' },
              h('button', { type: 'button', className: 'kbsv-btn', 'data-kb': 'servers-add-cancel', onClick: act.closeAdd }, kt('Annuler', 'Cancel')),
              h('button', { type: 'button', className: 'kbsv-btn', 'data-primary': 'true', 'data-kb': 'servers-add-go', disabled: !ok || add.adding, onClick: act.add }, add.adding ? '…' : kt('Ajouter et se connecter', 'Add and sign in')))))
      }

      const SigninDialog = ({ signin, server, act }) => h('div', { className: 'kbsv-veil', role: 'presentation' },
        h('div', { className: 'kbsv-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbsv-signin-t', 'data-kb': 'servers-signin-dialog' },
          h('h3', { id: 'kbsv-signin-t' }, kt('Connexion à ', 'Signing in to ') + (server !== undefined ? server.name : '')),
          signin.error !== undefined ? h('p', { className: 'kbsv-error', role: 'alert', 'data-kb': 'servers-signin-error' }, signin.error) : h(React.Fragment, null,
            h('p', { className: 'kbsv-note', style: { fontSize: '13px' } }, kt('Ouvre la page d’activation de ce serveur, connecte-toi avec ton compte et confirme ce code.', 'Open this server’s activation page, sign in with your account and confirm this code.')),
            h('div', { style: { display: 'flex', gap: '14px', alignItems: 'center', flexWrap: 'wrap' } },
              h('span', { className: 'kbsv-code', 'data-kb': 'servers-code' }, signin.code),
              signin.url ? h('a', { className: 'kbsv-btn', 'data-primary': 'true', 'data-kb': 'servers-activation', href: signin.url, target: '_blank', rel: 'noopener noreferrer' }, kt('Ouvrir la page d’activation', 'Open the activation page')) : null),
            h('p', { className: 'kbsv-note', role: 'status' }, h('span', { className: 'kbsv-wait' }), kt('En attente de ta validation…', 'Waiting for your approval…'))),
          h('div', { className: 'kbsv-foot' },
            h('span', { className: 'kbsv-note', style: { marginInlineEnd: 'auto' } }, kt('Plus tard : le serveur reste ajouté, non connecté.', 'Later: the server stays added, not signed in.')),
            signin.expired === true ? h('button', { type: 'button', className: 'kbsv-btn', 'data-primary': 'true', 'data-kb': 'servers-newcode', onClick: act.newCode }, kt('Obtenir un nouveau code', 'Get a new code')) : null,
            h('button', { type: 'button', className: 'kbsv-btn', 'data-kb': 'servers-signin-later', onClick: act.closeSignin }, kt('Plus tard', 'Later')))))

      const Confirm = ({ confirm, act }) => {
        const s = confirm.server
        const leaving = confirm.kind === 'remove'
        return h('div', { className: 'kbsv-veil', role: 'presentation' },
          h('div', { className: 'kbsv-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'kbsv-confirm-t', 'data-kb': 'servers-dialog' },
            h('h3', { id: 'kbsv-confirm-t' }, (leaving ? kt('Retirer ', 'Remove ') : kt('Passer à ', 'Switch to ')) + s.name + kt(' ?', '?')),
            leaving
              ? h('p', { className: 'kbsv-note', style: { fontSize: '13px' } }, kt('Ta connexion à ce serveur est oubliée sur cet appareil. Rien n’est supprimé sur le serveur. ', 'Your sign-in to this server is forgotten on this device. Nothing is deleted on the server. ') + (s.active ? kt('Tu reviendras à Kybernos Cloud.', 'You will go back to Kybernos Cloud.') : ''))
              : h('div', { className: 'kbsv-two' },
                h('div', null, h('div', { className: 'kbsv-kick' }, kt('Change', 'Changes')), h('ul', null, h('li', null, kt('Compte et connexion', 'Account and sign-in')), h('li', null, kt('Liste des modèles', 'Model list')), h('li', null, kt('Équipe et leçons partagées', 'Team and shared lessons')), h('li', null, kt('Pages d’équipe et facturation', 'Team settings and billing pages')))),
                h('div', null, h('div', { className: 'kbsv-kick' }, kt('Reste', 'Stays')), h('ul', null, h('li', null, kt('Conversations et fichiers locaux', 'Local chats and files')), h('li', null, kt('Mémoire personnelle', 'Personal memory')), h('li', null, kt('Thème, langue, réglages', 'Theme, language, settings'))))),
            !leaving && s.connected !== true ? h('p', { className: 'kbsv-note' }, kt('Tu n’es pas connecté à ce serveur : il faudra te connecter ensuite.', 'You are not signed in to this server: you will sign in next.')) : null,
            confirm.error !== undefined ? h('p', { className: 'kbsv-error', role: 'alert' }, confirm.error) : null,
            h('div', { className: 'kbsv-foot' },
              h('button', { type: 'button', className: 'kbsv-btn', 'data-kb': 'servers-cancel', onClick: act.cancel }, kt('Annuler', 'Cancel')),
              h('button', { type: 'button', className: 'kbsv-btn', 'data-primary': 'true', 'data-kb': 'servers-confirm', disabled: confirm.busy, onClick: act.confirm }, confirm.busy ? '…' : (leaving ? kt('Retirer', 'Remove') : kt('Passer', 'Switch'))))))
      }

      const View = ({ data, ui, act }) => {
        const cloud = data.cloud
        const servers = cloud === null ? [] : cloud.servers
        const current = servers.find((s) => s.active === true)
        const away = current !== undefined && current.id !== BUILTIN_ID
        return h('div', { className: 'kbsv-page', 'data-kb': 'servers-page' },
          h('div', { className: 'kbsv-head' },
            h('div', null, h('h2', { className: 'kbsv-title' }, kt('Serveurs', 'Servers')), h('p', { className: 'kbsv-sub' }, kt('Là où vivent ton compte, ton équipe et tes modèles', 'Where your account, team and models live'))),
            h('div', { className: 'kbsv-acts' }, h(HelpButton), h('button', { type: 'button', className: 'kbsv-btn', 'data-primary': 'true', 'data-kb': 'servers-add-open', onClick: act.openAdd }, '+ ' + kt('Ajouter un serveur', 'Add a server')))),
          cloud === null ? h('div', { className: 'kbsv-banner', role: 'alert', 'data-kb': 'servers-missing' }, say('cloud_plugin_missing')) : null,
          away ? h('div', { className: 'kbsv-banner', role: 'status', 'data-kb': 'servers-banner' },
            h('span', null, h('b', null, kt('Tu es sur ', 'You are on ') + current.name), ' · ' + kt('pas sur Kybernos Cloud : ton compte, tes modèles et ton équipe viennent de ce serveur.', 'not on Kybernos Cloud: your account, models and team come from this server.')),
            h('button', { type: 'button', className: 'kbsv-btn', 'data-small': 'true', 'data-kb': 'servers-back', onClick: () => act.askSwitch(servers.find((s) => s.id === BUILTIN_ID)) }, kt('Revenir à Kybernos Cloud', 'Back to Kybernos Cloud'))) : null,
          h('div', { className: 'kbsv-list', 'data-kb': 'servers-list' }, servers.map((s) => h(Row, { key: s.id, s, ui, act }))),
          h(Enterprise, { onAdd: act.openAdd }),
          h('p', { className: 'kbsv-note' }, kt('Changer de serveur conserve tes conversations locales, tes fichiers, ta mémoire personnelle et tes réglages. Le compte, la liste des modèles, l’équipe et les pages d’équipe changent.', 'Switching keeps your local chats, files, personal memory and settings. The account, the model list, the team and the Team pages change.')),
          ui.add !== null ? h(AddDialog, { add: ui.add, act }) : null,
          ui.signin !== null ? h(SigninDialog, { signin: ui.signin, server: servers.find((s) => s.id === ui.signin.id), act }) : null,
          ui.confirm !== null ? h(Confirm, { confirm: ui.confirm, act }) : null,
          ui.message !== null ? h('div', { className: 'kbsv-toast', role: 'status', 'data-kb': 'servers-message' }, h('div', null, ui.message)) : null)
      }

      // ── The page: state, and the calls to the host routes. ──
      const api = async (method, path, body) => {
        try {
          const r = await fetch(path, { method, credentials: 'same-origin', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
          return await r.json()
        } catch (e) { return { ok: false, error: 'unreachable' } }
      }
      const EMPTY = { cloud: null }
      const NEW_ADD = () => ({ address: '', name: '', editName: false, showAddr: false, busy: false, adding: false, result: null, error: null })

      const Page = () => {
        const [data, setData] = React.useState(null)
        const [details, setDetails] = React.useState({})
        const [names, setNames] = React.useState({})
        const [add, setAdd] = React.useState(null)
        const [signin, setSignin] = React.useState(null)
        const [confirm, setConfirm] = React.useState(null)
        const [message, setMessage] = React.useState(null)
        const alive = React.useRef(true)
        const checking = React.useRef(null)
        React.useEffect(() => () => { alive.current = false }, [])

        const notify = (text) => { setMessage(text); setTimeout(() => { if (alive.current) setMessage((m) => (m === text ? null : m)) }, 4500) }
        const load = React.useCallback(async () => {
          const s = await api('GET', '/kybernos-servers/status')
          if (alive.current) setData(s !== null && s.ok === true ? s : EMPTY)
          return s
        }, [])
        React.useEffect(() => { void load() }, [])

        // Poll the pairing started on the ACTIVE server until it is claimed (the cloud plugin answers for the active server).
        React.useEffect(() => {
          if (signin === null || signin.error !== undefined || signin.expired === true) return undefined
          const timer = setInterval(async () => {
            const r = await api('POST', '/kybernos-cloud/poll')
            if (!alive.current) return
            if (r !== null && r.connected === true) { setSignin(null); notify(kt('Connecté.', 'Signed in.')); void load() } else if ((r !== null && (r.status === 'expired' || r.status === 'denied')) || (typeof signin.expires_at === 'string' && Date.now() > Date.parse(signin.expires_at))) {
              setSignin((s) => (s === null ? s : Object.assign({}, s, { expired: true, error: say('code_expired') })))
            }
          }, 3000)
          return () => clearInterval(timer)
        }, [signin])

        // Escape closes the dialog that is open (the sign-in one stays: « Later » is its way out, a code in progress is not lost by a stray key).
        // It is taken in the capture phase and stopped, or DSH's own Escape would close the whole Settings page behind the dialog (found live).
        React.useEffect(() => {
          const onKey = (e) => {
            if (e.key !== 'Escape' || (add === null && confirm === null)) return
            e.stopPropagation(); e.preventDefault()
            if (add !== null) setAdd(null)
            else setConfirm(null)
          }
          window.addEventListener('keydown', onKey, true)
          return () => window.removeEventListener('keydown', onKey, true)
        }, [add, confirm])

        const startPairing = async (id) => {
          const r = await api('POST', '/kybernos-cloud/start')
          if (!alive.current) return
          if (r !== null && r.pairing !== undefined && r.pairing !== null) setSignin({ id, code: r.pairing.user_code, url: r.pairing.activation_url, expires_at: r.pairing.expires_at })
          else if (r !== null && r.connected === true) { setSignin(null); notify(kt('Connecté.', 'Signed in.')); void load() } else setSignin({ id, code: '', error: say('pairing_failed') })
        }

        const act = {
          openAdd: () => setAdd(NEW_ADD()),
          closeAdd: () => setAdd(null),
          setAddress: (v) => setAdd((a) => Object.assign({}, a, { address: v, result: null, error: null, name: '', editName: false })),
          pasted: (e) => { const el = e.target; setTimeout(() => { if (alive.current && el !== null) act.check(el.value) }, 0) },
          check: async (typed) => {
            const address = typeof typed === 'string' ? typed : (add !== null ? add.address : '')
            if (address.trim() === '' || checking.current === address) return
            // Leaving the field (a click on « Add and sign in » blurs it first) must not check again an address that is already checked:
            // the answer would disappear between the press and the release of the button, and the click would be lost.
            if (add !== null && add.result !== null && add.checkedFor === address) return
            checking.current = address
            setAdd((a) => (a === null ? a : Object.assign({}, a, { busy: true, result: null, error: null })))
            const r = await api('POST', '/kybernos-servers/check', { address })
            checking.current = null
            if (alive.current) setAdd((a) => (a === null || a.address.trim() !== address.trim() ? a : Object.assign({}, a, { busy: false, name: '', checkedFor: address, result: { ok: r.ok === true, steps: Array.isArray(r.steps) ? r.steps : [], profile: r.profile, host: r.host, published: r.published, suggested: r.suggested, error: r.error, id: r.id } })))
          },
          setAddName: (value) => setAdd((a) => Object.assign({}, a, { name: value })),
          setName: (id, value) => setNames((n) => Object.assign({}, n, { [id]: value })),
          toggleEditName: () => setAdd((a) => Object.assign({}, a, { editName: !a.editName, name: a.editName ? a.name.trim() : (a.name !== '' ? a.name : a.result.suggested) })),
          toggleAddr: () => setAdd((a) => Object.assign({}, a, { showAddr: !a.showAddr })),
          add: async () => {
            if (add === null || add.result === null || add.result.ok !== true) return
            setAdd((a) => Object.assign({}, a, { adding: true, error: null }))
            const r = await api('POST', '/kybernos-servers/add', { address: add.address, name: add.name.trim(), activate: true })
            if (!alive.current) return
            if (r.ok === true) { setAdd(null); await load(); await startPairing(r.id) } else {
              setAdd((a) => (a === null ? a : Object.assign({}, a, { adding: false, error: say(r.error) })))
              if (r.added === true) void load()
            }
          },
          toggleDetails: (id) => setDetails((d) => Object.assign({}, d, { [id]: d[id] !== true })),
          rename: async (id) => {
            const r = await api('POST', '/kybernos-servers/rename', { id, name: names[id] })
            if (!alive.current) return
            if (r.ok === true) { setNames((n) => { const x = Object.assign({}, n); delete x[id]; return x }); notify(kt('Nom enregistré.', 'Name saved.')); void load() } else notify(say(r.error))
          },
          signIn: (s) => startPairing(s.id),
          closeSignin: () => setSignin(null),
          newCode: () => { const id = signin !== null ? signin.id : null; setSignin(null); if (id !== null) void startPairing(id) },
          askSwitch: (server) => setConfirm({ kind: 'switch', server, busy: false }),
          askRemove: (server) => setConfirm({ kind: 'remove', server, busy: false }),
          cancel: () => setConfirm(null),
          confirm: async () => {
            const c = confirm
            setConfirm(Object.assign({}, c, { busy: true, error: undefined }))
            const r = c.kind === 'switch' ? await api('POST', '/kybernos-servers/switch', { id: c.server.id }) : await api('POST', '/kybernos-servers/remove', { id: c.server.id })
            if (!alive.current) return
            if (r.ok === true) {
              setConfirm(null)
              notify(c.kind === 'switch' ? kt('Tu es sur ', 'You are on ') + c.server.name + '. ' + kt('Recharge DSH pour rafraîchir la liste des modèles.', 'Reload DSH to refresh the model list.') : c.server.name + kt(' a été retiré.', ' was removed.'))
              void load()
            } else setConfirm(Object.assign({}, c, { busy: false, error: say(r.error) }))
          },
        }
        if (data === null) return h('div', { className: 'kbsv-page', 'data-kb': 'servers-page' }, h('p', { className: 'kbsv-note', 'aria-busy': 'true' }, '…'))
        return h(View, { data, ui: { details, names, add, signin, confirm, message }, act })
      }

      const installCss = () => {
        try {
          if (document.getElementById('kbsv-css') !== null) return
          const st = document.createElement('style'); st.id = 'kbsv-css'; st.setAttribute('data-plugin', '@local/kybernos-servers'); st.textContent = CSS; document.head.appendChild(st)
        } catch (e) { /* no document: nothing to style */ }
      }
      const Conteneur = () => { installCss(); return h(Page) }

      return {
        name: 'kybernos-servers',
        inject: ['slots'],
        apply (ctx) {
          try {
            const slots = ctx.slots
            if (slots === undefined || slots === null) { console.error('[kybernos-servers] slots service unavailable: no interface'); return }
            slots.inject('settings.section', () => slots.register(
              { name: 'settings.section', id: 'kybernos-servers', order: 14, label: kt('Serveurs', 'Servers') },
              () => h(Conteneur)))
          } catch (e) { try { console.error('[kybernos-servers] page not registered: ' + String((e && e.message) || e)) } catch (e2) { /* console */ } }
        },
        __test: { View, AddDialog, SigninDialog, Confirm, Enterprise, Row, Steps, addressesOf, say, hostOf, ERR, ENTERPRISE, BUILTIN_ID, EMPTY, NEW_ADD, CSS }
      }
    } catch (e) {
      try { console.warn('[kybernos-servers] disabled:', e) } catch (e2) { /* console */ }
      return { apply () {} }
    }
  }
})
