// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
// @local/kybernos-door — client: the « Kaby MCP » Settings page.
//
// One job: connect an assistant that runs on THIS computer (Claude Code, Codex, another) to the person's Kaby. The page gives a message to copy and paste into that assistant, which adds the MCP
// server with its own tools (so nothing here is specific to one assistant), says whether an assistant has connected yet, and keeps the manual way (the address, the token, a snippet per assistant)
// in a fold. The token is never drawn: the copy button asks the host for it and puts it on the clipboard.
//
// Assistants that run in the cloud (Claude Cowork, claude.ai) cannot reach this computer: the page says so once, and points to Kaby MCP with a cloud computer.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
window.__ModuleLoader__.load({
  id: '@local/kybernos-door',
  factory(require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── i18n minimal (fr first, en fallback) ─────────────────────────────
      const KB_M_T = {
        'kdm.titre': { fr: 'Kaby MCP', en: 'Kaby MCP' },
        'kdm.lead': { fr: 'Branche l’assistant de ton choix (Claude Code, Codex, un autre) à ton Kaby : tu lui demandes quelque chose, il le confie à Kaby.', en: 'Connect the assistant of your choice (Claude Code, Codex, another) to your Kaby: you ask it for something, it hands the task to Kaby.' },
        'kdm.aucun': { fr: 'Aucun assistant ne s’est branché pour l’instant.', en: 'No assistant has connected yet.' },
        'kdm.dernier': { fr: 'Un assistant s’est branché. Dernier appel {when}.', en: 'An assistant has connected. Last call {when}.' },
        'kdm.maintenant': { fr: 'à l’instant', en: 'just now' },
        'kdm.min': { fr: 'il y a {n} min', en: '{n} min ago' },
        'kdm.heure': { fr: 'il y a {n} h', en: '{n} h ago' },
        'kdm.jour': { fr: 'il y a {n} j', en: '{n} d ago' },
        'kdm.local': { fr: 'Ça marche avec un assistant installé sur cet ordinateur. Claude Cowork et claude.ai travaillent depuis le cloud et ne peuvent pas joindre cet ordinateur : pour eux, utilise Kaby MCP avec un ordinateur cloud.', en: 'This works with an assistant installed on this computer. Claude Cowork and claude.ai work from the cloud and cannot reach this computer: for them, use Kaby MCP with a cloud computer.' },
        'kdm.carte.titre': { fr: 'Branche ton assistant en collant un message', en: 'Connect your assistant by pasting a message' },
        'kdm.carte.texte': { fr: 'Copie ce message et colle-le dans ton assistant. Il fait le branchement lui-même, avec ses propres outils.', en: 'Copy this message and paste it into your assistant. It connects itself, with its own tools.' },
        'kdm.copier': { fr: 'Copier le message', en: 'Copy the message' },
        'kdm.copie': { fr: 'Message copié. Colle-le dans ton assistant.', en: 'Message copied. Paste it into your assistant.' },
        'kdm.copie.ko': { fr: 'La copie a échoué : sélectionne le message et copie-le.', en: 'Copying failed: select the message and copy it.' },
        'kdm.jeton.note': { fr: 'Le jeton secret n’est pas dans le message : l’assistant le lit dans un fichier de ton ordinateur. Il ne marche que depuis cet ordinateur.', en: 'The secret token is not in the message: the assistant reads it from a file on your computer. It only works from this computer.' },
        'kdm.main': { fr: 'Tu gardes la main. Pour envoyer, supprimer ou payer, Kaby t’attend dans Kybernos : l’assistant ne peut jamais dire oui à ta place. Les tâches qu’il donne apparaissent comme des conversations dans ta liste.', en: 'You stay in control. To send, delete or pay, Kaby waits for you in Kybernos: the assistant can never say yes for you. The tasks it gives show up as conversations in your list.' },
        'kdm.pli': { fr: 'Je préfère le faire moi-même', en: 'I would rather do it myself' },
        'kdm.pli.texte': { fr: 'Une commande ou un réglage par assistant. Remplace <token> par le jeton (bouton « Copier le jeton »).', en: 'One command or setting per assistant. Replace <token> with the token (the “Copy the token” button).' },
        'kdm.adresse': { fr: 'Copier l’adresse', en: 'Copy the address' },
        'kdm.adresse.ok': { fr: 'Adresse copiée', en: 'Address copied' },
        'kdm.jeton': { fr: 'Copier le jeton', en: 'Copy the token' },
        'kdm.jeton.ok': { fr: 'Jeton copié', en: 'Token copied' },
        'kdm.jeton.jamais': { fr: 'Le jeton ne s’affiche jamais.', en: 'The token is never shown.' },
        'kdm.snippet': { fr: 'Copier', en: 'Copy' },
        'kdm.snippet.ok': { fr: 'Copié', en: 'Copied' },
        'kdm.changer': { fr: 'Changer le jeton', en: 'Change the token' },
        'kdm.changer.note': { fr: 'Si tu crois l’avoir perdu : l’ancien s’arrête tout de suite, il faudra rebrancher.', en: 'If you think you lost it: the old one stops at once, you will have to connect again.' },
        'kdm.changer.confirme': { fr: 'Confirmer : l’ancien jeton s’arrête', en: 'Confirm: the old token stops' },
        'kdm.changer.fait': { fr: 'Nouveau jeton fait. Rebranche tes assistants.', en: 'New token made. Connect your assistants again.' },
        'kdm.sans.jeton': { fr: 'Il n’y a pas de jeton : la porte est fermée. Appuie sur « Changer le jeton » pour en faire un.', en: 'There is no token: the door is closed. Press “Change the token” to make one.' },
        'kdm.annuler': { fr: 'Annuler', en: 'Cancel' },
        'kdm.erreur': { fr: 'Erreur', en: 'Error' },
        'kdm.heberge': { fr: 'Cette page ne marche que sur l’ordinateur où tourne Kybernos, ouvert par son adresse locale. Ici, Kybernos est ouvert depuis une autre adresse (par exemple s’il est hébergé) : un assistant de ton ordinateur ne peut pas l’atteindre par cette porte. Pour un Kybernos hébergé, branche ton assistant par la porte de ton compte Kybernos (le connecteur « Kaby »).', en: 'This page only works on the computer where Kybernos runs, opened by its local address. Here Kybernos is opened from another address (for example when it is hosted): an assistant on your computer cannot reach it through this door. For a hosted Kybernos, connect your assistant through the door of your Kybernos account (the “Kaby” connector).' },
        'kdm.hote': { fr: 'L’assistant de cette page ne répond pas. Si l’appli vient d’être mise à jour, redémarre-la, puis appuie sur Réessayer.', en: 'This page’s helper is not answering. If the app was just updated, restart it, then press Retry.' },
        'kdm.reessayer': { fr: 'Réessayer', en: 'Retry' },
        'kdm.page.titre': { fr: 'Kaby MCP', en: 'Kaby MCP' },
      }
      // « fr » for the French of the product (the locale id « kybernos », or any fr*), « en » for every other language: what Kybernos resolved.
      const kbLocaleRead = () => {
        try {
          const l = String(window.__KB_LANG_RESOLVE__())
          return l === 'kybernos' || l.split(/[-_]/)[0] === 'fr' ? 'fr' : 'en'
        } catch (e) { return 'en' }
      }
      const m = (key, vars) => {
        const lang = kbLocaleRead()
        const entry = KB_M_T[key]
        let text = entry === null || entry === undefined ? key : (entry[lang] !== undefined ? entry[lang] : entry.en)
        if (vars !== null && vars !== undefined) {
          for (const k of Object.keys(vars)) text = text.split('{' + k + '}').join(String(vars[k]))
        }
        return text
      }

      // ── styles: the buttons and dots (the look of the shared ones, under this bundle's own prefix) + this page's layout ───────
      const styles = (() => ({
        insert (css, mark) {
          const tag = document.createElement('style')
          tag.dataset.plugin = mark
          tag.textContent = css
          document.head.append(tag)
          return () => { tag.remove() }
        },
      }))()

      const KDM_BASE_CSS = "/* kdm-btn, kdm-dot : the look of the shared Kybernos buttons and dots (the shared .kbm- prefix belongs to the bundles that already had it, scripts/test-consistency-guards.mjs) */\n" +
        ".kdm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; border: none; border-radius: 18px; cursor: pointer; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); background: transparent; padding: 0 14px; }\n" +
        ".kdm-btn:disabled { cursor: not-allowed; opacity: 0.4; }\n" +
        ".kdm-btn-md { height: 36px; }\n" +
        ".kdm-btn-sm { height: 28px; font-size: 12px; line-height: 18px; padding: 0 10px; border-radius: 14px; }\n" +
        ".kdm-btn-primary { background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); }\n" +
        ".kdm-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); }\n" +
        ".kdm-btn-outline { border: 0.5px solid var(--dsw-alias-border-l3); background: transparent; }\n" +
        ".kdm-btn-outline:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }\n" +
        ".kdm-dot { position: relative; display: inline-block; flex: none; width: 10px; height: 10px; }\n" +
        ".kdm-dot::after { content: ''; position: absolute; inset: 20%; border-radius: 50%; background: currentColor; }\n" +
        ".kdm-dot[data-state='done'] { color: var(--dsw-alias-state-success-primary); }\n" +
        ".kdm-dot[data-state='idle'] { color: var(--dsw-alias-state-idle-primary); }\n"

      const KDM_CSS = "/* kdm-* : the Kaby MCP page layout (this bundle only — DSH tokens) */\n" +
        ".kdm-root { max-width: 720px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 14px; }\n" +
        "/* Light schemes: label-tertiary is 3.7:1 on white. Inside this page it reads as label-secondary (audit A1-05). */\n" +
        "body:not([data-ds-dark-theme]) .kdm-root{--dsw-alias-label-tertiary:var(--dsw-alias-label-secondary)}\n" +
        ".kdm-head { margin: 0; }\n" +
        ".kdm-soustitre { margin: 6px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }\n" +
        ".kdm-statut { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }\n" +
        ".kdm-statut[data-on='true'] { color: var(--dsw-alias-label-primary); }\n" +
        ".kdm-note { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); max-width: 62ch; }\n" +
        ".kdm-carte { display: flex; flex-direction: column; gap: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 16px; }\n" +
        ".kdm-carte h3 { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; color: var(--dsw-alias-label-primary); }\n" +
        ".kdm-carte p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }\n" +
        ".kdm-msg { margin: 0; padding: 12px 14px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }\n" +
        ".kdm-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }\n" +
        ".kdm-retour { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }\n" +
        ".kdm-pli { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); padding: 10px 16px; }\n" +
        ".kdm-pli > summary { cursor: pointer; font-size: 14px; line-height: 22px; font-weight: 500; color: var(--dsw-alias-label-primary); }\n" +
        ".kdm-pli-corps { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }\n" +
        ".kdm-ligne { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 12px; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); }\n" +
        ".kdm-ligne > span { flex: 1; min-width: 200px; }\n" +
        ".kdm-code { margin: 0; padding: 8px 10px; border: 0.5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-primary); font-family: var(--ds-font-family-code, monospace); font-size: 12px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }\n" +
        ".kdm-snip { display: flex; flex-direction: column; gap: 6px; }\n" +
        ".kdm-snip-tete { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }\n" +
        ".kdm-erreur { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-state-error-primary); }\n" +
        ".kdm-bandeau { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 12px; border: 0.5px solid var(--dsw-alias-border-l3); border-radius: 10px; font-size: 13px; line-height: 1.5; }\n" +
        ".kdm-bandeau > span { flex: 1; min-width: 220px; }\n" +
        "@media (pointer: coarse) { .kdm-root .kdm-btn-sm { height: 40px; } }\n"

      // ── host calls ───────────────────────────────────────────────────────
      // A refused connection, a 404 page or any answer that is not JSON is the same thing for the person: the host half does not answer, told by one sentence.
      const jsonGet = async (path) => {
        try {
          const r = await fetch(path, { headers: { accept: 'application/json' }, cache: 'no-store' })
          return await r.json()
        } catch (e) { return { ok: false, error: 'hote' } }
      }
      const jsonPost = async (path) => {
        try {
          const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
          return await r.json()
        } catch (e) { return { ok: false, error: 'hote' } }
      }
      // `host refused` is the host half saying this page was reached under a name that is not this computer's own (a hosted Kybernos, a LAN address): not a fault, a different door to use.
      const estHeberge = (r) => r !== null && r !== undefined && r.error === 'host refused'
      const erreurDe = (r) => (estHeberge(r) ? m('kdm.heberge') : r && r.error === 'hote' ? m('kdm.hote') : m('kdm.erreur') + (kbLocaleRead() === 'fr' ? ' : ' : ': ') + String((r && r.error) || 'refused'))

      /** Puts a text on the clipboard; true when it worked. The fallback is the old way, for a browser that refuses the new one. */
      const copyText = async (text) => {
        try { await navigator.clipboard.writeText(text); return true } catch (e) { /* the old way */ }
        try {
          const ta = document.createElement('textarea')
          ta.value = text
          ta.setAttribute('readonly', '')
          ta.style.position = 'fixed'
          ta.style.opacity = '0'
          document.body.append(ta)
          ta.select()
          const done = document.execCommand('copy')
          ta.remove()
          return done === true
        } catch (e) { return false }
      }

      /** « just now » / « 5 min ago » / « 3 h ago » / « 2 d ago » from a time in ms. */
      const sinceText = (at, now) => {
        const s = Math.max(0, Math.round((now - at) / 1000))
        if (s < 60) return m('kdm.maintenant')
        if (s < 3600) return m('kdm.min', { n: Math.round(s / 60) })
        if (s < 86400) return m('kdm.heure', { n: Math.round(s / 3600) })
        return m('kdm.jour', { n: Math.round(s / 86400) })
      }

      const helpAbsent = () => { try { return !(typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help) } catch (e) { return true } }
      const pageHead = (props) => { try { if (window.__KB_HELP__ && window.__KB_HELP__.Title) return h(window.__KB_HELP__.Title, props) } catch (e) { /* the bare title below */ } return h(props.as || 'h2', { className: 'kbhp-title' + (props.className ? ' ' + props.className : '') }, props.title, props.after) }

      // ── the page ─────────────────────────────────────────────────────────
      const Panel = () => {
        const [state, setState] = React.useState(null)
        const [erreur, setErreur] = React.useState(null)
        const [heberge, setHeberge] = React.useState(false) // the page is open under a name that is not this computer's own: not a fault, nothing to retry
        const [retour, setRetour] = React.useState({}) // which button just did its job: { message: 'copie', adresse: …, jeton: …, rotate: … }
        const [sure, setSure] = React.useState(false) // the second press of « Change the token »
        const [now, setNow] = React.useState(() => Date.now())
        const lang = kbLocaleRead()

        const refresh = React.useCallback(async () => {
          const s = await jsonGet('/kybernos-door/setup?lang=' + lang)
          if (s && s.ok === true) { setState(s); setErreur(null); setHeberge(false) } else { setErreur(erreurDe(s)); setHeberge(estHeberge(s)) }
          setNow(Date.now())
        }, [lang])
        React.useEffect(() => { refresh() }, [refresh])
        // The status line is the proof that a pasted message worked: it is read again while the page is open.
        React.useEffect(() => {
          const id = setInterval(refresh, 8000)
          return () => clearInterval(id)
        }, [refresh])

        const say = (key, text) => {
          setRetour((r) => ({ ...r, [key]: text }))
          setTimeout(() => setRetour((r) => (r[key] === text ? { ...r, [key]: '' } : r)), 2600)
        }
        const copierTexte = async (key, text, okText) => { say(key, (await copyText(text)) === true ? okText : m('kdm.copie.ko')) }
        const copierJeton = async () => {
          const r = await jsonPost('/kybernos-door/setup/token')
          if (r && r.ok === true && typeof r.token === 'string') { await copierTexte('jeton', r.token, m('kdm.jeton.ok')) } else say('jeton', erreurDe(r))
        }
        const changerJeton = async () => {
          if (sure !== true) { setSure(true); return }
          setSure(false)
          const r = await jsonPost('/kybernos-door/setup/rotate')
          if (r && r.ok === true) { say('rotate', m('kdm.changer.fait')); await refresh() } else say('rotate', erreurDe(r))
        }

        const hasCalled = state !== null && Number.isFinite(state.lastCallAt)
        const noToken = state !== null && state.hasToken === false

        if (state === null && erreur !== null) {
          return h('div', { className: 'kdm-root', 'data-kdm': 'panneau' },
            h('div', { className: 'kdm-head' }, pageHead({ id: 'kybernos-door', lead: m('kdm.lead'), title: m('kdm.titre'), className: 'kdm-titre' })),
            heberge === true
              ? h('div', { className: 'kdm-bandeau', role: 'status', 'data-kdm': 'heberge' }, h('span', null, erreur))
              : h('div', { className: 'kdm-bandeau', role: 'alert', 'data-kdm': 'injoignable' },
                h('span', null, erreur),
                h('button', { className: 'kdm-btn kdm-btn-sm kdm-btn-outline', 'data-kdm': 'reessayer', onClick: () => { setErreur(null); refresh() } }, m('kdm.reessayer'))))
        }

        return h('div', { className: 'kdm-root', 'data-kdm': 'panneau' },
          h('div', { className: 'kdm-head' },
            pageHead({ id: 'kybernos-door', lead: m('kdm.lead'), title: m('kdm.titre'), className: 'kdm-titre' }),
            helpAbsent() ? h('p', { className: 'kdm-soustitre' }, m('kdm.lead')) : null),

          state === null ? null : h('p', { className: 'kdm-statut', 'data-kdm': 'statut', 'data-on': hasCalled ? 'true' : 'false', role: 'status' },
            h('span', { className: 'kdm-dot', 'data-state': hasCalled ? 'done' : 'idle' }),
            hasCalled ? m('kdm.dernier', { when: sinceText(state.lastCallAt, now) }) : m('kdm.aucun')),
          h('p', { className: 'kdm-note', 'data-kdm': 'local' }, m('kdm.local')),
          noToken ? h('p', { className: 'kdm-erreur', 'data-kdm': 'sans-jeton' }, m('kdm.sans.jeton')) : null,

          h('section', { className: 'kdm-carte', 'data-kdm': 'carte' },
            h('h3', null, m('kdm.carte.titre')),
            h('p', null, m('kdm.carte.texte')),
            h('pre', { className: 'kdm-msg', 'data-kdm': 'message' }, state === null ? '' : state.message),
            h('div', { className: 'kdm-actions' },
              h('button', { className: 'kdm-btn kdm-btn-md kdm-btn-primary', 'data-kdm': 'copier', disabled: state === null, onClick: () => copierTexte('message', state.message, m('kdm.copie')) }, m('kdm.copier')),
              h('span', { className: 'kdm-retour', role: 'status', 'data-kdm': 'retour-message' }, retour.message || '')),
            h('p', null, m('kdm.jeton.note'))),

          h('p', { className: 'kdm-note' }, m('kdm.main')),

          h('details', { className: 'kdm-pli', 'data-kdm': 'pli' },
            h('summary', null, m('kdm.pli')),
            state === null ? null : h('div', { className: 'kdm-pli-corps' },
              h('p', { className: 'kdm-note' }, m('kdm.pli.texte')),
              (Array.isArray(state.snippets) ? state.snippets : []).map((s) => h('div', { className: 'kdm-snip', key: s.id, 'data-kdm': 'snippet-' + s.id },
                h('div', { className: 'kdm-snip-tete' }, h('span', null, s.title),
                  h('button', { className: 'kdm-btn kdm-btn-sm kdm-btn-outline', onClick: () => copierTexte('snip-' + s.id, s.code, m('kdm.snippet.ok')) }, retour['snip-' + s.id] || m('kdm.snippet'))),
                h('pre', { className: 'kdm-code' }, s.code))),
              h('div', { className: 'kdm-ligne' },
                h('span', { className: 'kdm-code', style: { margin: 0 } }, state.url),
                h('button', { className: 'kdm-btn kdm-btn-sm kdm-btn-outline', 'data-kdm': 'adresse', onClick: () => copierTexte('adresse', state.url, m('kdm.adresse.ok')) }, retour.adresse || m('kdm.adresse'))),
              h('div', { className: 'kdm-ligne' },
                h('span', null, m('kdm.jeton.jamais')),
                h('button', { className: 'kdm-btn kdm-btn-sm kdm-btn-outline', 'data-kdm': 'jeton', disabled: noToken, onClick: copierJeton }, retour.jeton || m('kdm.jeton'))),
              h('div', { className: 'kdm-ligne' },
                h('span', null, retour.rotate || m('kdm.changer.note')),
                h('span', { style: { display: 'inline-flex', gap: 8, flex: 'none', minWidth: 0 } },
                  sure === true ? h('button', { className: 'kdm-btn kdm-btn-sm kdm-btn-outline', 'data-kdm': 'annuler', onClick: () => setSure(false) }, m('kdm.annuler')) : null,
                  h('button', { className: 'kdm-btn kdm-btn-sm kdm-btn-outline', 'data-kdm': 'changer', onClick: changerJeton }, sure === true ? m('kdm.changer.confirme') : m('kdm.changer')))))),
          erreur !== null && state !== null ? h('p', { className: 'kdm-erreur' }, erreur) : null)
      }

      return {
        inject: ['slots'],
        apply (ctx) {
          styles.insert(KDM_BASE_CSS, '@local/kybernos-door')
          styles.insert(KDM_CSS, '@local/kybernos-door')
          ctx.effect(() => {
            const slots = ctx.get('slots')
            if (slots === undefined || slots === null) return undefined
            return slots.inject('settings.section', () => slots.register(
              { name: 'settings.section', id: 'kybernos-door', order: 30, label: m('kdm.page.titre') },
              Panel))
          }, 'kybernos-door: settings section')
        },
      }
    } catch (bootError) {
      try { console.error('[kybernos-door] load failed — plugin disabled, GUI preserved', bootError) } catch (e2) { /* no console */ }
      return { apply () { /* plugin disabled after load error */ } }
    }
  },
})
