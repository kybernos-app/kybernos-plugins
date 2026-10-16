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
        'kfl.titre': { fr: 'Free LLMs', en: 'Free LLMs' },
        'kfl.soustitre': { fr: 'Des modèles gratuits, sans compte ni clé API.', en: 'Free models, no account or API key.' },
        'kfl.avertis': { fr: 'Ces modèles sont gratuits : les prompts envoyés peuvent être conservés par OpenCode pour améliorer leurs modèles. N’y envoyez rien de sensible.', en: 'These models are free: prompts you send may be retained by OpenCode to improve their models. Do not send anything sensitive.' },
        'kfl.liste': { fr: 'Modèles gratuits disponibles', en: 'Available free models' },
        'kfl.vide': { fr: 'Aucun modèle gratuit détecté pour l’instant.', en: 'No free model detected right now.' },
        'kfl.catalogue.err': { fr: 'Catalogue injoignable : {err}', en: 'Catalog unreachable: {err}' },
        'kfl.connecter': { fr: 'Brancher sur DSH', en: 'Connect to DSH' },
        'kfl.connecte': { fr: 'Branché', en: 'Connected' },
        'kfl.deconnecter': { fr: 'Retirer', en: 'Remove' },
        'kfl.encours': { fr: 'Connexion…', en: 'Connecting…' },
        'kfl.accuse': { fr: 'J’ai compris que mes prompts peuvent être conservés.', en: 'I understand my prompts may be retained.' },
        'kfl.recheck': { fr: 'Revérifier', en: 'Re-check' },
        'kfl.recheck.encours': { fr: 'Vérification…', en: 'Checking…' },
        'kfl.recheck.titre': { fr: 'Interroge de nouveau le palier gratuit et relit la liste, sans utiliser la mémoire de quelques minutes.', en: 'Asks the free tier again and reads the list again, skipping the few minutes the page remembers.' },
        'kfl.verifie': { fr: 'Dernière vérification {time}', en: 'Last checked {time}' },
        'kfl.sonde.ok': { fr: 'Répond — contrat accepté.', en: 'Answers — contract accepted.' },
        'kfl.sonde.ko': { fr: 'Le test a échoué ({code}).', en: 'The test failed ({code}).' },
        'kfl.tier.locked': { fr: 'Le palier gratuit est indisponible pour le moment : OpenCode l’a verrouillé, ces modèles ne peuvent pas répondre. Réessayez plus tard.', en: 'The free tier is unavailable right now: OpenCode has locked it, so these models cannot answer. Try again later.' },
        'kfl.tier.rate': { fr: 'Le palier gratuit est saturé pour le moment. Réessayez dans un instant.', en: 'The free tier is busy right now. Try again in a moment.' },
        'kfl.tier.network': { fr: 'OpenCode est injoignable. Vérifiez la connexion.', en: 'OpenCode cannot be reached. Check the connection.' },
        'kfl.tier.model': { fr: 'Le modèle testé n’est plus proposé par le palier gratuit.', en: 'The tested model is no longer offered by the free tier.' },
        'kfl.relance': { fr: 'Si un modèle n’apparaît pas dans le sélecteur : relancez DSH.', en: 'If a model does not show in the picker: restart DSH.' },
        'kfl.auto': { fr: 'Activé automatiquement au premier lancement.', en: 'Enabled automatically at first run.' },
        'kfl.erreur': { fr: 'Erreur', en: 'Error' },
        // The page's host half does not answer (DSH not restarted after an update, a failing route): the same sentence as the other settings pages.
        'kfl.hote': { fr: 'L’assistant de cette page ne répond pas. Si DSH vient d’être mis à jour, redémarrez DSH, puis appuyez sur Réessayer.', en: 'This page’s helper is not answering. If DSH was just updated, restart DSH, then press Retry.' },
        'kfl.reessayer': { fr: 'Réessayer', en: 'Retry' },
        'kfl.page.titre': { fr: 'Free LLMs', en: 'Free LLMs' },
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
        "/* The tag inks are the state fills (2.1:1 on their pale tint in the light schemes): there they are pulled toward the text colour (audit A1-11). */\n" +
        "body:not([data-ds-dark-theme]) .kbm-tag[data-tone='success'] { color: color-mix(in srgb, var(--dsw-alias-state-success-primary) 50%, var(--dsw-alias-label-primary)); }\n" +
        "body:not([data-ds-dark-theme]) .kbm-tag[data-tone='warning'] { color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 50%, var(--dsw-alias-label-primary)); }\n" +
        ".kbm-dot { position: relative; display: inline-block; flex: none; width: 10px; height: 10px; }\n" +
        ".kbm-dot::after { content: ''; position: absolute; inset: 20%; border-radius: 50%; background: currentColor; }\n" +
        ".kbm-dot[data-state='done'] { color: var(--dsw-alias-state-success-primary); }\n" +
        ".kbm-dot[data-state='warning'] { color: var(--dsw-alias-state-warn-primary); }\n" +
        ".kbm-dot[data-state='error'] { color: var(--dsw-alias-state-error-primary); }\n" +
        ".kbm-dot[data-state='idle'] { color: var(--dsw-alias-state-idle-primary); }\n"

      const KFL_CSS = "/* kfl-* : the Free LLMs panel layout (this bundle only — DSH tokens) */\n" +
        ".kfl-root { border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-2); padding: 16px; max-width: 720px; margin-bottom: 16px; }\n" +
        "/* Light schemes: label-tertiary is 3.7:1 on white. Inside this page it reads as label-secondary, 5.8:1 (audit A1-05); the dark scheme keeps its hierarchy. */\n" +
        "body:not([data-ds-dark-theme]) .kfl-root{--dsw-alias-label-tertiary:var(--dsw-alias-label-secondary)}\n" +
        ".kfl-titre { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600; letter-spacing: -.01em; color: var(--dsw-alias-label-primary); }\n" +
        ".kfl-soustitre { margin: 6px 0 14px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }\n" +
        ".kfl-avertis { margin: 0 0 14px; padding: 10px 12px; border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); color: var(--dsw-alias-state-warn-label, var(--dsw-alias-state-warn-primary)); font-size: 13px; line-height: 1.5; }\n" +
        "body:not([data-ds-dark-theme]) .kfl-avertis { color: color-mix(in srgb,var(--dsw-alias-state-warn-primary) 50%,var(--dsw-alias-label-primary)); }\n" +
        "body[data-ds-dark-theme] .kfl-avertis { color: var(--dsw-alias-state-warn-primary); }\n" +
        ".kfl-tete { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; margin: 0 0 8px; }\n" +
        ".kfl-tete .kfl-section { margin: 0; flex: 1; min-width: 0; }\n" +
        ".kfl-verifie { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }\n" +
        "@media (pointer: coarse) { .kfl-tete .kbm-btn-sm { height: 40px; } }\n" +
        "@media (max-width: 520px) { .kfl-tete .kfl-section { flex-basis: 100%; } .kfl-verifie { flex: 1; } }\n" +
        ".kfl-section { margin: 0 0 8px; font-size: 12px; line-height: 18px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kfl-liste { display: flex; flex-direction: column; gap: 6px; margin: 0 0 12px; }\n" +
        ".kfl-mod { display: flex; align-items: center; gap: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 10px 12px; }\n" +
        ".kfl-mod-nom { flex: 1; min-width: 0; font-family: var(--ds-font-family-code, monospace); font-size: 13px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n" +
        ".kfl-accuse { display: flex; align-items: flex-start; gap: 8px; margin: 0 0 12px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); cursor: pointer; }\n" +
        ".kfl-accuse input { flex: none; width: 16px; height: 16px; margin: 2px 0 0; accent-color: var(--dsw-alias-brand-primary); cursor: pointer; }\n" +
        ".kfl-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 0 10px; }\n" +
        ".kfl-note { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }\n" +
        ".kfl-erreur { margin: 8px 0 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }\n" +
        ".kfl-bandeau { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 12px; padding: 10px 12px; border: 0.5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 35%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-primary); }\n" +
        ".kfl-bandeau > span { flex: 1; min-width: 220px; }\n" +
        ".kfl-sonde { display: flex; align-items: center; gap: 8px; margin: 0 0 10px; font-size: 13px; color: var(--dsw-alias-label-secondary); }\n" +
        ".kfl-sonde[data-ok='true'] { color: var(--dsw-alias-state-success-primary); }\n" +
        ".kfl-sonde[data-ok='false'] { color: var(--dsw-alias-state-error-primary); }\n" +
        ".kfl-locked { margin: 0 0 10px; font-size: 13px; line-height: 1.5; color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 80%, var(--dsw-alias-label-primary)); }\n"

      // ── host calls ───────────────────────────────────────────────────────
      // A refused connection, a 404 page or any answer that is not JSON is the same thing for the person: the host half does not
      // answer ('hote'), told by one sentence, never the browser's « Failed to fetch ».
      const jsonGet = async (path) => {
        try {
          const r = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' })
          return await r.json()
        } catch (e) { return { ok: false, error: 'hote' } }
      }
      const jsonPost = async (path, body) => {
        try {
          const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body === undefined ? {} : body) })
          return await r.json()
        } catch (e) { return { ok: false, error: 'hote' } }
      }
      // What a failed call says: the sentence for a host that does not answer, « Error: <reason> » otherwise.
      const erreurDe = (r, repli) => (r && r.error === 'hote' ? m('kfl.hote') : m('kfl.erreur') + sep() + String((r && r.error) || repli))

      const skelHelper = () => {
        try {
          const k = window.__KB_SKEL__
          return (k !== null && k !== undefined && typeof k.bone === 'function' && typeof k.wrap === 'function') ? k : null
        } catch (e) { return null }
      }

      // What a failed probe means, in a sentence: the codes of the gateway are for the host, not for a person.
      const KFL_REASONS = { free_tier_locked: 'kfl.tier.locked', rate_limited: 'kfl.tier.rate', network: 'kfl.tier.network', model_unknown: 'kfl.tier.model', model_protocol_unsupported: 'kfl.tier.model', no_model: 'kfl.vide' }
      const reasonOf = (code) => (KFL_REASONS[code] !== undefined ? m(KFL_REASONS[code]) : m('kfl.sonde.ko', { code: String(code || 'error') }))

      // ── the panel ────────────────────────────────────────────────────────
      const Panel = () => {
        const [status, setStatus] = React.useState(null)
        const [busy, setBusy] = React.useState(null) // 'connect' | 'probe' | null
        const [ack, setAck] = React.useState(false)
        const [erreur, setErreur] = React.useState(null)
        const [probe, setProbe] = React.useState(null)
        // Does the free tier answer right now? null until known. Asked on open (the host remembers the verdict for a few minutes),
        // so the page never offers to connect models that cannot answer.
        const [tier, setTier] = React.useState(null)
        // `checkedAt` is the host's own stamp of the probe (ISO): the page never makes up the time of a check it did not get.
        const verdictOf = (r) => {
          const checkedAt = r !== null && r !== undefined && typeof r.checkedAt === 'string' ? r.checkedAt : null
          return r !== null && r !== undefined && r.ok === true ? { ok: true, checkedAt } : { ok: false, code: (r && r.code) || 'error', checkedAt }
        }
        const timeOf = (iso) => {
          try { const d = new Date(iso); return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch (e) { return null }
        }

        const refresh = React.useCallback(async () => {
          const s = await jsonGet('/free-llms/status')
          if (s && s.ok === true) {
            setStatus(s)
            setAck((s.state && s.state.acknowledged === true) || false)
            setErreur(null)
          } else {
            setErreur(erreurDe(s, 'status'))
          }
        }, [])

        React.useEffect(() => { refresh() }, [refresh])
        React.useEffect(() => {
          let dead = false
          jsonGet('/free-llms/health?cached=1').then((r) => { if (dead !== true && r !== null && typeof r === 'object') setTier(verdictOf(r)) })
          return () => { dead = true }
        }, [])

        const connecter = async () => {
          setErreur(null); setBusy('connect')
          const r = await jsonPost('/free-llms/enable', { acknowledged: ack === true })
          setBusy(null)
          if (r && r.ok === true) { await refresh() } else {
            setErreur(erreurDe(r, 'refus'))
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
          setTier(verdictOf(r))
          await refresh()
        }

        const wired = status !== null && status.state && status.state.wired === true
        const models = status !== null && Array.isArray(status.models) ? status.models : []
        const catalogOk = status !== null && status.catalogOk === true
        const locked = tier !== null && tier.ok === false && tier.code === 'free_tier_locked'
        const checkedTime = tier !== null && typeof tier.checkedAt === 'string' ? timeOf(tier.checkedAt) : null

        return h('div', { className: 'kfl-root', 'data-kfl': 'panneau' },
          h('div', { style: { display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: 6 } },
            (typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-free-llms' }) : null)),
          h('h2', { className: 'kfl-titre' }, m('kfl.titre')),
          h('p', { className: 'kfl-soustitre' }, m('kfl.soustitre')),
          h('p', { className: 'kfl-avertis' }, m('kfl.avertis')),

          h('div', { className: 'kfl-tete' },
            h('div', { className: 'kfl-section' }, m('kfl.liste')),
            checkedTime !== null ? h('span', { className: 'kfl-verifie', 'data-kfl': 'verifie' }, m('kfl.verifie', { time: checkedTime })) : null,
            h('button', { className: 'kbm-btn kbm-btn-sm kbm-btn-outline', disabled: busy !== null, title: m('kfl.recheck.titre'), 'data-kfl': 'recheck', onClick: sonder },
              Ic('refresh', 12), busy === 'probe' ? m('kfl.recheck.encours') : m('kfl.recheck'))),
          // A locked tier already has its sentence just below (the line with `data-kfl="tier-locked"`): the check does not say it twice.
          (probe !== null && !(locked && probe.ok !== true && probe.code === 'free_tier_locked'))
            ? h('div', { className: 'kfl-sonde', 'data-ok': probe.ok === true ? 'true' : 'false' },
              h('span', { className: 'kbm-dot', 'data-state': probe.ok === true ? 'done' : 'error' }),
              probe.ok === true ? m('kfl.sonde.ok') : reasonOf(probe.code))
            : null,
          locked ? h('p', { className: 'kfl-locked', role: 'status', 'data-kfl': 'tier-locked' }, m('kfl.tier.locked')) : null,
          // Not read yet: bones in the rows' own box (the shared skeleton helper of the core plugin, window.__KB_SKEL__), instead of
          // the « no free model » line that then got replaced. Without the helper the line shows, as before.
          // The first read failed: the reason and a Retry take the list's place (it used to say « No free model detected » above a bare error).
          (status === null && erreur !== null)
            ? h('div', { className: 'kfl-bandeau', role: 'alert', 'data-kfl': 'injoignable' },
              h('span', null, erreur),
              h('button', { className: 'kbm-btn kbm-btn-sm kbm-btn-outline', 'data-kfl': 'reessayer', onClick: () => { setErreur(null); refresh() } }, m('kfl.reessayer')))
            : (status === null && erreur === null && skelHelper() !== null)
            ? skelHelper().wrap(m('kfl.liste'), 'kfl-liste', [0, 1, 2].map((i) => h('div', { className: 'kfl-mod kb-sk-row', key: 'sk' + i },
              skelHelper().bone(10, 10, 'round'), skelHelper().bone(i % 2 === 0 ? '46%' : '36%', 13), skelHelper().bone(34, 18, 'pill'))))
            : models.length === 0
            ? h('p', { className: 'kfl-note' }, catalogOk === false && status !== null && status.catalogError
              ? m('kfl.catalogue.err', { err: String(status.catalogError) })
              : m('kfl.vide'))
            : h('div', { className: 'kfl-liste' }, models.map((id) => h('div', { className: 'kfl-mod', key: id },
              h('span', { className: 'kbm-dot', 'data-state': locked ? 'error' : 'done' }),
              h('span', { className: 'kfl-mod-nom', title: id }, id),
              h('span', { className: 'kbm-tag', 'data-tone': 'neutral' }, 'free')))),

          h('label', { className: 'kfl-accuse' },
            h('input', { type: 'checkbox', checked: ack, onChange: (e) => setAck(e.target.checked) }),
            h('span', null, m('kfl.accuse'))),

          h('div', { className: 'kfl-actions' },
            wired === true
              ? h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-outline', disabled: busy !== null, onClick: deconnecter },
                Ic('trash', 14), busy === 'connect' ? m('kfl.encours') : m('kfl.deconnecter'))
              : h('button', { className: 'kbm-btn kbm-btn-md kbm-btn-primary', disabled: busy !== null || ack !== true || models.length === 0 || locked, title: locked ? m('kfl.tier.locked') : undefined, 'data-kfl': 'connecter', onClick: connecter },
                Ic('link', 14), busy === 'connect' ? m('kfl.encours') : m('kfl.connecter'))),

          status !== null && status.state && status.state.autoEnabled === true
            ? h('p', { className: 'kfl-note' }, m('kfl.auto')) : null,
          h('p', { className: 'kfl-note' }, m('kfl.relance')),
          erreur !== null && status !== null ? h('p', { className: 'kfl-erreur' }, erreur) : null)
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
