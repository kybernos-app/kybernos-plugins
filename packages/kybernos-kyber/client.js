// kybernos-kyber — browser half.
//
// Kyby, the person's own assistant: one conversation (the thread every door shares), the doors it answers from (Telegram now, WhatsApp
// and WeChat later) and the computer it works on. Two places show it: a page (the menu row opens it) with the chat and a collapsible
// « Channels » strip, and a tab of the right-hand panel with the same panel. The server's routes are reached through the
// kybernos-cloud bundle (`/kybernos-cloud/kyber`, `/telegram/pairing`, `/kyby`, ...), which adds the account's token.
//
// A device cannot connect a chat by itself: the person scans a QR code (or taps a link), presses Start in Telegram and confirms
// there. The page only asks for the pairing and polls where it stands.
//
// Loaded through window.__ModuleLoader__.load; the factory RETURNS a plugin object and, on any error, a disabled one, so the GUI is preserved.
window.__ModuleLoader__.load({
  id: '@local/kybernos-kyber',
  factory (require) {
    try {
      const React = require('react')
      const h = React.createElement

      // ── language: French is the source, English the pair; a translated language is looked up by its French text ──
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
      const fill = (text, p) => (p === undefined ? text : text.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m)))
      // What the person calls their own assistant: the one place to change it here (the sidebar row's label is `kbui.kyber` in kybernos-plugin).
      const NAME = 'Kyby'
      // [fr, en] pairs, by key, in ONE table so that a test can check both sides of every pair.
      const S = {
        title: [NAME, NAME],
        tabHint: ['Votre assistant : la conversation, Telegram et l’ordinateur sur lequel il travaille.', 'Your assistant: the conversation, Telegram and the computer it works on.'],
        // header and intro
        subline: ['Votre assistant : il répond ici et sur Telegram, et travaille sur son propre ordinateur.', 'Your assistant: it answers here and on Telegram, and works on its own computer.'],
        what: ['Qu’est-ce que Kyby ?', 'What is Kyby?'],
        heroH: ['Votre assistant, dans votre poche.', 'Your assistant, in your pocket.'],
        heroP: ['Écrivez à Kyby ici ou sur Telegram, comme à un ami. Il fait le travail sur son propre ordinateur dans le cloud, même quand le vôtre est éteint, et vous demande votre accord avant de modifier quoi que ce soit.', 'Write to Kyby here or on Telegram, the way you would to a friend. It does the work on its own computer in the cloud, even when yours is off, and asks you before it changes anything.'],
        b1h: ['Demandez de n’importe où', 'Ask from anywhere'], b1p: ['Ici, ou depuis votre téléphone sur Telegram. C’est la même conversation.', 'Here, or from your phone on Telegram. It is the same conversation.'],
        b2h: ['Il travaille pendant votre absence', 'It keeps working while you are away'], b2p: ['Il a son propre ordinateur, qui se réveille quand il a du travail.', 'It has its own computer, which wakes up when it has work to do.'],
        b3h: ['Vous gardez la main', 'You stay in control'], b3p: ['Avant d’agir, il demande : Autoriser, Refuser ou Autoriser pour cette tâche.', 'Before it acts, it asks: Allow, Refuse, or Allow for this task.'],
        stOn: ['Telegram connecté', 'Telegram connected'], stOff: ['Telegram non connecté', 'Telegram not connected'], stWait: ['Telegram en attente', 'Telegram waiting'], stNone: ['Telegram indisponible', 'Telegram unavailable'],
        // the strip
        channels: ['Canaux', 'Channels'], collapse: ['Replier', 'Fold'], expand: ['Déplier', 'Unfold'],
        soon: ['Bientôt', 'Soon'], otherChannels: ['Autres canaux', 'Other channels'],
        wChip: ['Ordinateur de Kyby', 'Kyby’s computer'], wChipAsk: ['Me demander', 'Ask me'],
        // telegram
        telegram: ['Telegram', 'Telegram'],
        cH: ['Connecter Telegram', 'Connect Telegram'], cSub: ['Environ une minute, sans mot de passe.', 'About a minute, no password.'],
        s1: ['Scannez ce code avec l’appareil photo de votre téléphone. Sur le téléphone, touchez « Ouvrir Telegram ».', 'Scan this code with your phone’s camera. On a phone, tap “Open Telegram”.'],
        s2: ['Dans Telegram, touchez Démarrer.', 'In Telegram, tap Start.'],
        s3: ['Touchez « Oui, c’est moi ».', 'Tap “Yes, it’s me”.'],
        openTg: ['Ouvrir Telegram', 'Open Telegram'], copyLink: ['Copier le lien', 'Copy the link'], copied: ['Lien copié', 'Link copied'],
        noCam: ['Pas de caméra ni d’application ? Utiliser un code', 'No camera or no app? Use a code instead'],
        once: ['À usage unique · expire dans {t}', 'Single use · expires in {t}'], newCode: ['Nouveau code', 'New code'],
        lockNote: ['Rien n’est connecté sans votre accord dans Telegram, qui nomme le compte concerné.', 'Nothing is connected until you agree in Telegram, which names the account.'],
        preparing: ['Préparation du code…', 'Preparing the code…'],
        scH: ['Presque fini : confirmez dans Telegram', 'Almost done: confirm in Telegram'],
        scP: ['Telegram indique : {who}. Touchez « Oui, c’est moi » dans la conversation avec Kyby.', 'Telegram says: {who}. Tap “Yes, it’s me” in the chat with Kyby.'],
        scWait: ['En attente de votre tap…', 'Waiting for your tap…'], notMe: ['Ce n’est pas moi : annuler', 'Not me: cancel'],
        linked: ['Connecté : {name}', 'Connected: {name}'], since: ['depuis le {date}', 'since {date}'],
        paused: ['En pause : écrivez /resume au bot pour reprendre.', 'Paused: write /resume to the bot to resume.'],
        blocked: ['Le bot est bloqué dans Telegram : débloquez-le pour recevoir les réponses.', 'The bot is blocked in Telegram: unblock it to receive answers.'],
        openBot: ['Ouvrir', 'Open'], disc: ['Déconnecter', 'Disconnect'], discQ: ['Déconnecter ?', 'Disconnect?'], confirm: ['Confirmer', 'Confirm'], cancel: ['Annuler', 'Cancel'],
        exH: ['Ce code a expiré', 'This code has expired'], exP: ['Un code est valable 5 minutes et ne sert qu’une fois.', 'A code is good for 5 minutes and works once.'],
        deH: ['Rien n’a été connecté', 'Nothing was connected'], deP: ['Vous avez touché « Non » dans Telegram.', 'You tapped “No” in Telegram.'],
        taH: ['Ce Telegram est déjà connecté à un autre compte', 'This Telegram is already connected to another account'],
        taP: ['Déconnectez-le d’abord dans l’autre compte (écrivez /unlink à Kyby dans Telegram), puis revenez ici.', 'Disconnect it from the other account first (write /unlink to Kyby in Telegram), then come back here.'],
        bmH: ['Ce Telegram a déjà un compte créé par le bot', 'This Telegram already has an account made by the bot'],
        bmP: ['Rattacher ce Telegram à votre compte n’est pas encore possible. En attendant, continuez à utiliser le bot tel quel.', 'Attaching this Telegram to your account is not possible yet. Meanwhile, keep using the bot as it is.'],
        ofH: ['Telegram n’est pas activé sur ce serveur', 'Telegram is not turned on on this server'],
        ofP: ['Ce serveur n’a pas de bot Telegram : il en faut un pour connecter Telegram.', 'This server has no Telegram bot: one is needed to connect Telegram.'],
        ofPS: ['Le serveur de ce DSH ({server}) n’a pas de bot Telegram : il en faut un pour connecter Telegram.', 'The server this DSH talks to ({server}) has no Telegram bot: one is needed to connect Telegram.'],
        settings: ['Réglages', 'Settings'],
        pe: ['Impossible de préparer le code pour l’instant.', 'The code cannot be prepared right now.'],
        peRate: ['Trop d’essais : réessayez dans une minute.', 'Too many tries: try again in a minute.'],
        retry: ['Réessayer', 'Try again'],
        // where Kyby works
        whereH: ['Où Kyby travaille', 'Where Kyby works'],
        whereP: ['L’ordinateur que Kyby utilise quand un message Telegram lui demande d’agir.', 'The computer Kyby uses when a Telegram message asks it to act.'],
        wCloud: ['Ordinateur de Kyby (cloud)', 'Kyby’s computer (cloud)'], wCloudSub: ['Il se réveille quand Kyby a du travail.', 'It wakes when Kyby has work.'],
        wMac: ['Mon Mac', 'My Mac'], wMacSub: ['Seulement quand DSH est ouvert dessus. Pas encore disponible.', 'Only while DSH is open on it. Not available yet.'],
        wAsk: ['Me demander à chaque fois', 'Ask me each time'], wAskSub: ['Kyby pose la question avec des boutons avant d’utiliser l’ordinateur.', 'Kyby asks with buttons before it uses the computer.'],
        whereNeed: ['Disponible quand Telegram est connecté.', 'Available once Telegram is connected.'],
        whereHint: ['Pour un seul message, écrivez « sur mon Mac » ou « sur l’ordinateur de Kyby ». Une automatisation s’exécute là où elle vit.', 'For a single message, write “on my Mac” or “on Kyby’s computer”. An automation runs where it lives.'],
        // computer
        computer: ['Ordinateur de Kyby', 'Kyby’s computer'],
        noHome: ['Pas encore d’ordinateur : il est créé au premier message qui demande à Kyby d’agir.', 'No computer yet: it is made at the first message that asks Kyby to act.'],
        st_running: ['Éveillé', 'Awake'], st_suspended: ['En veille', 'Asleep'], st_creating: ['En création', 'Being made'], st_resuming: ['Se réveille', 'Waking up'],
        st_suspending: ['S’endort', 'Going to sleep'], st_failed: ['En échec', 'Failed'], st_other: ['{state}', '{state}'],
        txt_running: ['Éveillé : Kyby travaille dessus.', 'Awake: Kyby is working on it.'],
        txt_suspended: ['En veille. Il se réveille tout seul quand Kyby a du travail, puis se rendort.', 'Asleep. It wakes by itself when Kyby has work, then goes back to sleep.'],
        txt_creating: ['Il est en cours de création.', 'It is being made.'], txt_resuming: ['Il se réveille.', 'It is waking up.'], txt_suspending: ['Il s’endort.', 'It is going to sleep.'],
        txt_failed: ['Il n’a pas démarré. Kyby réessaiera au prochain message.', 'It did not start. Kyby will try again at the next message.'],
        lastActive: ['Dernière activité : {when}', 'Last active: {when}'], image: ['Image {v}', 'Image {v}'],
        net_public: ['Réseau : toutes les adresses publiques', 'Network: any public address'], net_closed: ['Réseau : seulement les serveurs Kybernos', 'Network: Kybernos servers only'], net_list: ['Réseau : une liste d’adresses', 'Network: a list of addresses'],
        pr_hours: ['Les heures d’exécution du mois sont utilisées.', 'This month’s run hours are used up.'], pr_other: ['Il est en pause.', 'It is paused.'],
        wake: ['Réveiller', 'Wake up'], sleep: ['Mettre en veille', 'Put to sleep'], openPc: ['Ouvrir', 'Open'],
        upsell: ['Avec l’offre Free, vous ne pouvez pas le réveiller ni le garder allumé. Une offre payante vous en donne la main.', 'On the Free plan you cannot wake it or keep it on. A paid plan puts you in charge of it.'],
        upgrade: ['Passer à une offre payante', 'Upgrade to a paid plan'],
        approvals: ['Avant d’agir, il vous demande l’accord dans Telegram : Autoriser, Refuser, ou Autoriser pour cette tâche.', 'Before it acts, it asks you in Telegram: Allow, Refuse, or Allow for this task.'],
        manage: ['Gérer dans mon compte', 'Manage in my account'],
        // the native conversation
        openChat: ['Ouvrir la conversation avec Kyby', 'Open the conversation with Kyby'],
        openChatHint: ['Une vraie conversation DSH : même composeur, même rendu, avec la mémoire de votre compte. Ce qui s’y dit va aussi sur le fil que Kyby partage avec Telegram.', 'A real DSH chat: same composer, same rendering, with your account’s memory. What is said there also goes on the thread Kyby shares with Telegram.'],
        openChatFail: ['La conversation n’a pas pu s’ouvrir.', 'The conversation could not be opened.'],
        // states of the whole
        refresh: ['Actualiser', 'Refresh'],
        signedOut: ['Connectez-vous à Kybernos pour voir votre ' + NAME + '.', 'Sign in to Kybernos to see your ' + NAME + '.'],
        failed: ['Impossible de lire l’état pour l’instant.', 'The state cannot be read right now.'],
        loading: ['Lecture…', 'Reading…'],
      }
      const L = (key, p) => { const pair = S[key]; return pair === undefined ? key : fill(kt(pair[0], pair[1]), p) }

      // ═══ the model: pure, no DOM, tested without a browser ═══════════════════════════════════════════════════════
      const asObj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)
      const when = (iso) => {
        const t = Date.parse(String(iso || ''))
        if (!Number.isFinite(t)) return ''
        try { return new Date(t).toLocaleString(lang() === 'en' ? 'en' : lang().slice(0, 2), { dateStyle: 'medium', timeStyle: 'short' }) } catch (e) { return new Date(t).toISOString().slice(0, 16).replace('T', ' ') }
      }
      const day = (iso) => {
        const t = Date.parse(String(iso || ''))
        if (!Number.isFinite(t)) return ''
        try { return new Date(t).toLocaleDateString(lang() === 'en' ? 'en' : lang().slice(0, 2), { dateStyle: 'medium' }) } catch (e) { return new Date(t).toISOString().slice(0, 10) }
      }
      const clock = (secs) => { const n = Math.max(0, Math.floor(secs)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0') }
      /** What the page shows, from what the two routes said. `kyber` is the answer of /kybernos-cloud/kyber (or null), `server` the one of /kybernos-cloud/server. */
      const derive = (kyber, server) => {
        const k = asObj(kyber)
        if (k === null || k.ok !== true) return { kind: 'failed' }
        if (k.connected !== true) return { kind: 'signedOut' }
        const s = asObj(server) !== null ? asObj(asObj(server).server) : null
        const api = s !== null && typeof s.api === 'string' && /^https?:\/\//.test(s.api) ? s.api.replace(/\/+$/, '') : ''
        const t = asObj(k.telegram)
        let telegram = { state: 'off', homeTarget: 'cloud' }
        if (t !== null && t.configured === true && t.enabled === true) {
          const linked = asObj(t.linked)
          const bot = typeof t.bot === 'string' && /^[A-Za-z0-9_]{3,64}$/.test(t.bot) ? t.bot : ''
          const homeTarget = t.home_target === 'ask' ? 'ask' : 'cloud'
          telegram = linked === null
            ? { state: 'unlinked', homeTarget, botUrl: bot === '' ? '' : 'https://t.me/' + bot }
            : { state: 'linked', homeTarget, name: String(linked.display || ''), since: String(linked.linked_at || ''), paused: linked.paused === true, blocked: linked.blocked === true, botUrl: bot === '' ? '' : 'https://t.me/' + bot }
        }
        const hm = asObj(k.home)
        const home = hm === null ? null : {
          state: String(hm.state || ''),
          version: typeof hm.version === 'string' && hm.version !== '' ? hm.version : '',
          lastActive: typeof hm.last_active_at === 'string' ? hm.last_active_at : '',
          network: ['public', 'closed', 'list'].indexOf(String(hm.network)) >= 0 ? String(hm.network) : '',
          // `false` only when the server says so: a server that does not know the field keeps the buttons.
          manualControl: hm.manual_control !== false,
          paused: typeof hm.paused_reason === 'string' && hm.paused_reason !== '' ? (hm.paused_reason === 'hours' ? 'hours' : 'other') : '',
        }
        const serverId = s !== null && typeof s.id === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(s.id) ? s.id : ''
        return { kind: 'ok', telegram, home, serverId, accountUrl: api === '' ? '' : api + '/account' }
      }
      /** What the connection card shows for a pairing (null = none yet), at `nowMs`. */
      const pairingFace = (p, nowMs) => {
        if (p === null || p === undefined) return { kind: 'none' }
        if (typeof p.error === 'string' && p.error !== '') return { kind: 'error', code: p.error }
        if (p.state === 'done') return { kind: 'done' }
        if (p.state === 'declined') return { kind: 'declined', reason: ['user', 'taken', 'botmade'].indexOf(p.reason) >= 0 ? p.reason : 'user' }
        if (p.state === 'expired') return { kind: 'expired' }
        const end = Date.parse(String(p.expiresAt || ''))
        const left = Number.isFinite(end) ? Math.max(0, Math.floor((end - nowMs) / 1000)) : 300
        if (left <= 0) return { kind: 'expired' }
        return { kind: p.state === 'scanned' ? 'scanned' : 'waiting', left, sender: String(p.sender || '') }
      }
      // ═══ the store and its calls ═════════════════════════════════════════════════════════════════════════════════
      const state = {
        loading: true, view: null, at: 0, stripPref: null,
        pairing: null, starting: false, autoDone: false, copied: false, confirmDisc: false, busy: '',
        kybySid: null, kybyCwd: null, opening: false, openFailed: false, openError: '',
      }
      try { const v = window.localStorage.getItem('kybernos-kyber.strip'); if (v === '0') state.stripPref = false; else if (v === '1') state.stripPref = true } catch (e) { /* no storage */ }
      const listeners = new Set()
      const emit = () => { listeners.forEach((fn) => { try { fn() } catch (e) { /* a view that went away */ } }) }
      const live = () => listeners.size > 0
      const readJson = async (path) => {
        try {
          const r = await fetch(path, { credentials: 'same-origin', cache: 'no-store' })
          if (!r.ok) return null
          return await r.json()
        } catch (e) { return null }
      }
      const postJson = async (path, body) => {
        try {
          const r = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body === undefined ? {} : body) })
          if (!r.ok) return { ok: false, error: 'unreachable' }
          return await r.json()
        } catch (e) { return { ok: false, error: 'unreachable' } }
      }
      const load = async () => {
        state.loading = true
        emit()
        const [kyber, server] = await Promise.all([readJson('/kybernos-cloud/kyber'), readJson('/kybernos-cloud/server')])
        state.view = derive(kyber, server)
        state.loading = false
        state.at = Date.now()
        emit()
      }

      // — pairing —
      let pairTimer = null
      const pairLive = () => state.pairing !== null && typeof state.pairing.id === 'string' && ['waiting', 'scanned'].indexOf(state.pairing.state) >= 0
      const schedulePairPoll = (ms) => {
        if (pairTimer !== null) clearTimeout(pairTimer)
        pairTimer = setTimeout(pairPoll, ms)
      }
      const pairPoll = async () => {
        pairTimer = null
        if (!pairLive() || !live()) return
        const id = state.pairing.id
        const r = await readJson('/kybernos-cloud/telegram/pairing/state?id=' + encodeURIComponent(id))
        if (state.pairing === null || state.pairing.id !== id) return
        if (r !== null && r.ok === true) {
          state.pairing = Object.assign({}, state.pairing, { state: r.state, reason: r.reason, sender: r.sender })
          if (r.state === 'done') {
            state.pairing = null
            emit()
            await load()
            return
          }
        } else if (r !== null && r.ok === false && (r.error === 'not_found' || r.error === 'not_connected')) {
          state.pairing = { error: r.error }
        }
        emit()
        if (pairLive()) schedulePairPoll(document.visibilityState === 'hidden' ? 6000 : 2000)
      }
      const pairStart = async () => {
        if (state.starting) return
        state.starting = true
        state.autoDone = true
        state.pairing = null
        state.copied = false
        emit()
        const r = await postJson('/kybernos-cloud/telegram/pairing', {})
        state.starting = false
        if (r !== null && r.ok === true && typeof r.id === 'string') {
          state.pairing = { id: r.id, link: r.link, bot: r.bot, qr: r.qr, expiresAt: r.expires_at, state: 'waiting', reason: null, sender: '', error: '' }
          schedulePairPoll(2000)
        } else {
          const code = r !== null && typeof r.error === 'string' ? r.error : 'unreachable'
          // The account already has a Telegram (another window did it): the state is read again, the card becomes the connected one.
          state.pairing = code === 'already_linked' ? null : { error: code }
          if (code === 'already_linked') void load()
        }
        emit()
      }
      const pairCancel = async () => {
        const id = state.pairing !== null ? state.pairing.id : null
        state.pairing = null
        state.autoDone = true
        emit()
        if (typeof id === 'string') await postJson('/kybernos-cloud/telegram/pairing/cancel', { id })
      }

      // — settings, disconnect, computer —
      const setWhere = async (target) => {
        if (state.view === null || state.view.kind !== 'ok' || state.view.telegram.state !== 'linked') return
        const before = state.view.telegram.homeTarget
        state.view.telegram.homeTarget = target
        emit()
        const r = await postJson('/kybernos-cloud/telegram/settings', { home_target: target })
        if (r === null || r.ok !== true) { state.view.telegram.homeTarget = before; emit() }
      }
      const unlink = async () => {
        state.confirmDisc = false
        const r = await postJson('/kybernos-cloud/telegram/unlink', { confirm: true })
        state.autoDone = false
        state.pairing = null
        if (r !== null && r.ok === true) await load()
        else emit()
      }
      const computerAction = async (verb) => {
        state.busy = verb
        emit()
        const r = await postJson('/kybernos-cloud/computer/' + verb, {})
        state.busy = ''
        if (verb === 'open' && r !== null && r.ok === true && typeof r.url === 'string') { try { window.open(r.url, '_blank', 'noopener,noreferrer') } catch (e) { /* popup refused */ } }
        await load()
        // A wake or a sleep moves for a few seconds: read it again until it settles.
        let n = 0
        const again = async () => {
          n += 1
          const s = state.view !== null && state.view.kind === 'ok' && state.view.home !== null ? state.view.home.state : ''
          if (n > 8 || !live() || ['creating', 'resuming', 'suspending'].indexOf(s) < 0) return
          await load()
          setTimeout(again, 3000)
        }
        setTimeout(again, 2500)
      }
      const openAccount = async (section) => {
        const r = await postJson('/kybernos-cloud/console/link', { section, open: true })
        if (r !== null && r.ok === true && r.opened !== true && typeof r.url === 'string') { try { window.open(r.url, '_blank', 'noopener,noreferrer') } catch (e) { /* popup refused */ } }
      }
      const upgrade = () => {
        try { if (window.__KB_UPGRADE__ && typeof window.__KB_UPGRADE__.open === 'function') { window.__KB_UPGRADE__.open(); return } } catch (e) { /* the dialog is not there */ }
        void openAccount('plan')
      }
      /** The strip is open while there is something to do in it (no Telegram yet), folded once connected, unless the person chose. */
      const stripIsOpen = (pref, linked) => (pref === true || pref === false ? pref : linked !== true)
      const isLinked = () => state.view !== null && state.view.kind === 'ok' && state.view.telegram.state === 'linked'
      const toggleStrip = () => {
        state.stripPref = !stripIsOpen(state.stripPref, isLinked())
        try { window.localStorage.setItem('kybernos-kyber.strip', state.stripPref ? '1' : '0') } catch (e) { /* no storage */ }
        emit()
      }

      // ═══ the views ═══════════════════════════════════════════════════════════════════════════════════════════════
      const PATHS = {
        send: ['m22 2-7 20-4-9-9-4Z', 'M22 2 11 13'],
        up: ['m5 12 7-7 7 7', 'M12 19V5'],
        kyby: ['m10.586 5.414-5.172 5.172', 'm18.586 13.414-5.172 5.172', 'M6 12h12', 'M10 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z', 'M10 4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z', 'M18 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z', 'M2 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z'],
        cloud: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'],
        phone: ['M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M12 18h.01'],
        shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
        lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
        check: ['M20 6 9 17l-5-5'],
        x: ['M18 6 6 18', 'm6 6 12 12'],
        clock: ['M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z', 'M12 6v6l4 2'],
        alert: ['M12 8v4', 'M12 16h.01', 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0z'],
        chev: ['m6 9 6 6 6-6'],
        ext: ['M15 3h6v6', 'M10 14 21 3', 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'],
        star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
      }
      const Ic = (name, size, w) => h('svg', { width: size || 16, height: size || 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: w || 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { flex: 'none' } }, PATHS[name].map((d, i) => h('path', { key: i, d })))
      // The channels' marks: simplified drawings in each service's own colour, so a person recognises them at 18 px. Not the official artwork.
      const BRAND = {
        telegram: (n) => h('svg', { width: n, height: n, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { flex: 'none' } },
          h('circle', { cx: 12, cy: 12, r: 12, fill: '#229ED9' }),
          h('path', { d: 'm5.6 11.7 11.1-4.3c.5-.2 1 .1.8.9l-1.9 8.9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.4c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.4-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.1-.9z', fill: '#FFFFFF' })),
        whatsapp: (n) => h('svg', { width: n, height: n, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { flex: 'none' } },
          h('path', { d: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2z', fill: '#25D366' }),
          h('path', { d: 'M8.4 7.4c.2-.4.5-.4.7-.4h.5c.2 0 .4 0 .5.4l.7 1.7c.1.2.1.4 0 .5l-.4.6c-.1.1-.2.3 0 .5.4.8 1.5 1.9 2.5 2.4.2.1.4.1.5-.1l.6-.7c.1-.2.3-.2.5-.1l1.6.8c.2.1.4.2.4.4 0 .5-.2 1.1-.7 1.5-.6.5-1.4.6-2.4.3-1.6-.6-3-1.6-4-3.1-.8-1.1-1.4-2.2-1.2-3.5.1-.5.3-.9.7-1.3z', fill: '#FFFFFF' })),
        wechat: (n) => h('svg', { width: n, height: n, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { flex: 'none' } },
          h('path', { d: 'M9.5 3C5.4 3 2 5.8 2 9.3c0 2 1.1 3.7 2.9 4.9l-.7 2.1 2.5-1.3c.9.3 1.8.4 2.8.4h.5c-.1-.4-.2-.8-.2-1.2 0-3.3 3.1-6 7-6h.4C16.6 5.1 13.4 3 9.5 3z', fill: '#07C160' }),
          h('path', { d: 'M21.9 14.5c0-2.7-2.5-4.9-5.6-4.9s-5.6 2.2-5.6 4.9 2.5 4.9 5.6 4.9c.7 0 1.3-.1 1.9-.3l1.9 1-.5-1.6c1.4-.9 2.3-2.4 2.3-4z', fill: '#07C160' }),
          h('circle', { cx: 7, cy: 8.2, r: 0.9, fill: '#FFFFFF' }), h('circle', { cx: 12, cy: 8.2, r: 0.9, fill: '#FFFFFF' }),
          h('circle', { cx: 14.6, cy: 13.6, r: 0.8, fill: '#FFFFFF' }), h('circle', { cx: 18.1, cy: 13.6, r: 0.8, fill: '#FFFFFF' })),
      }

      const useTick = (ms) => {
        const [n, set] = React.useState(0)
        React.useEffect(() => { const id = setInterval(() => set((x) => x + 1), ms); return () => clearInterval(id) }, [])
        return n
      }
      const Btn = (props) => h(props.href !== undefined ? 'a' : 'button', Object.assign({ className: 'kbky-btn' + (props.primary ? ' pri' : '') + (props.danger ? ' danger' : ''), 'data-kb': props.kb }, props.href !== undefined ? { href: props.href, target: '_blank', rel: 'noopener noreferrer' } : { type: 'button', disabled: props.disabled === true, onClick: props.onClick }), props.children)
      const Qr = (props) => {
        const q = props.qr
        if (q === null || q === undefined || !Array.isArray(q.modules)) return null
        const n = q.size
        let d = ''
        for (let y = 0; y < n; y += 1) { const row = q.modules[y]; for (let x = 0; x < n; x += 1) { if (row.charCodeAt(x) === 49) d += 'M' + (x + 4) + ' ' + (y + 4) + 'h1v1h-1z' } }
        // A QR code is black on white whatever the theme: a reader needs the contrast, so these two colours are not tokens.
        return h('div', { className: 'kbky-qr' + (props.dim ? ' dim' : ''), 'data-kb': 'kybernos-kyber-qr' },
          h('svg', { viewBox: '0 0 ' + (n + 8) + ' ' + (n + 8), shapeRendering: 'crispEdges', role: 'img', 'aria-label': L('s1') },
            h('rect', { width: n + 8, height: n + 8, fill: '#FFFFFF' }), h('path', { d, fill: '#000000' })))
      }

      /** The Telegram card: the pairing in all its states, or the one line of a connected chat. */
      const TelegramCard = (props) => {
        useTick(1000)
        const v = props.view
        const tg = v.telegram
        // The card asks for its code once, when it is on screen and there is no Telegram: expiry or a cancel does not start a loop.
        React.useEffect(() => { if (props.visible && tg.state === 'unlinked' && state.pairing === null && !state.starting && !state.autoDone) void pairStart() })
        if (tg.state === 'off') return h('section', { className: 'kbky-card', 'data-kb': 'kybernos-kyber-telegram', 'data-state': 'off' }, h('div', { className: 'kbky-big' }, h('span', { className: 'kbky-badge info' }, BRAND.telegram(22)), h('div', null, h('h3', null, L('ofH')), h('p', null, v.serverId === '' ? L('ofP') : L('ofPS', { server: v.serverId })))))
        if (tg.state === 'linked') {
          return h('section', { className: 'kbky-card slim', 'data-kb': 'kybernos-kyber-telegram' },
            h('div', { className: 'kbky-kv' }, h('div', { className: 'kbky-row' }, BRAND.telegram(20), h('b', null, L('telegram'))), h('span', { className: 'kbky-badge ok sm' }, Ic('check', 14, 2.6))),
            h('p', { className: 'kbky-line' }, L('linked', { name: tg.name }), tg.since !== '' ? ' · ' + L('since', { date: day(tg.since) }) : ''),
            tg.paused ? h('p', { className: 'kbky-warn' }, L('paused')) : null,
            tg.blocked ? h('p', { className: 'kbky-warn' }, L('blocked')) : null,
            h('div', { className: 'kbky-actions' },
              typeof tg.botUrl === 'string' && tg.botUrl !== '' ? h(Btn, { href: tg.botUrl, kb: 'kybernos-kyber-bot' }, Ic('ext', 14), L('openBot')) : null,
              state.confirmDisc
                ? [h('span', { key: 'q', className: 'kbky-sub' }, L('discQ')), h(Btn, { key: 'y', danger: true, kb: 'kybernos-kyber-unlink-yes', onClick: () => { void unlink() } }, L('confirm')), h(Btn, { key: 'n', onClick: () => { state.confirmDisc = false; emit() } }, L('cancel'))]
                : h(Btn, { kb: 'kybernos-kyber-unlink', onClick: () => { state.confirmDisc = true; emit() } }, L('disc'))))
        }
        const face = pairingFace(state.pairing, Date.now())
        const err = (kind, icon, hKey, pKey, retry) => h('section', { className: 'kbky-card', 'data-kb': 'kybernos-kyber-telegram', 'data-state': kind },
          h('div', { className: 'kbky-big' }, h('span', { className: 'kbky-badge ' + (kind === 'taken' || kind === 'botmade' ? 'err' : kind === 'expired' ? 'warn' : 'info') }, Ic(icon, 20)), h('div', null, h('h3', null, L(hKey)), h('p', null, L(pKey)))),
          retry ? h('div', { className: 'kbky-actions' }, h(Btn, { primary: true, kb: 'kybernos-kyber-retry', onClick: () => { void pairStart() } }, L('newCode'))) : null)
        if (face.kind === 'expired') return err('expired', 'clock', 'exH', 'exP', true)
        if (face.kind === 'declined') {
          if (face.reason === 'taken') return err('taken', 'alert', 'taH', 'taP', true)
          if (face.reason === 'botmade') return err('botmade', 'alert', 'bmH', 'bmP', false)
          return err('declined', 'x', 'deH', 'deP', true)
        }
        if (face.kind === 'error') {
          if (face.code === 'not_found') return err('off', 'alert', 'ofH', 'ofP', false)
          return h('section', { className: 'kbky-card', 'data-kb': 'kybernos-kyber-telegram', 'data-state': 'error' },
            h('div', { className: 'kbky-big' }, h('span', { className: 'kbky-badge info' }, Ic('alert', 20)), h('div', null, h('h3', null, L('cH')), h('p', null, L(face.code === 'rate_limited' ? 'peRate' : 'pe')))),
            h('div', { className: 'kbky-actions' }, h(Btn, { primary: true, kb: 'kybernos-kyber-retry', onClick: () => { void pairStart() } }, L('retry'))))
        }
        if (face.kind === 'none') {
          return h('section', { className: 'kbky-card', 'data-kb': 'kybernos-kyber-telegram', 'data-state': 'starting' }, h('div', { className: 'kbky-big' }, h('span', { className: 'kbky-badge info' }, BRAND.telegram(22)), h('div', null, h('h3', null, L('cH')), h('p', null, L('preparing')))))
        }
        const p = state.pairing
        const scanned = face.kind === 'scanned'
        const copy = () => {
          try { void navigator.clipboard.writeText(p.link).then(() => { state.copied = true; emit(); setTimeout(() => { state.copied = false; emit() }, 1800) }).catch(() => { /* refused: the link is on the button */ }) } catch (e) { /* no clipboard */ }
        }
        return h('section', { className: 'kbky-card kbky-conn', 'data-kb': 'kybernos-kyber-telegram', 'data-state': scanned ? 'scanned' : 'waiting' },
          h('div', { className: 'kbky-cardh' }, h('h3', null, L(scanned ? 'scH' : 'cH')), h('p', null, scanned ? L('scP', { who: face.sender === '' ? '…' : face.sender }) : L('cSub'))),
          h('div', { className: 'kbky-connbody' },
            h('div', { className: 'kbky-connl' },
              scanned
                ? h('div', { className: 'kbky-row' }, h('span', { className: 'kbky-spin', 'aria-hidden': 'true' }), h('span', { className: 'kbky-sub' }, L('scWait')))
                : h('ol', { className: 'kbky-steps' }, h('li', null, L('s1')), h('li', null, L('s2')), h('li', null, L('s3'))),
              h('div', { className: 'kbky-actions' },
                h(Btn, { primary: true, href: p.link, kb: 'kybernos-kyber-open' }, BRAND.telegram(18), L('openTg')),
                scanned ? h(Btn, { kb: 'kybernos-kyber-cancel', onClick: () => { void pairCancel() } }, L('notMe')) : h(Btn, { kb: 'kybernos-kyber-copy', onClick: copy }, Ic('check', 14), L(state.copied ? 'copied' : 'copyLink'))),
              !scanned && v.accountUrl !== '' ? h('button', { type: 'button', className: 'kbky-link', 'data-kb': 'kybernos-kyber-code', onClick: () => { void openAccount('account') } }, L('noCam')) : null,
              h('div', { className: 'kbky-lock' }, Ic('lock', 14), h('span', null, L('lockNote')))),
            h('div', { className: 'kbky-qrcol' },
              h(Qr, { qr: p.qr, dim: scanned }),
              h('div', { className: 'kbky-sub' }, L('once', { t: clock(face.left) })),
              h('button', { type: 'button', className: 'kbky-link', 'data-kb': 'kybernos-kyber-new', onClick: () => { void pairStart() } }, L('newCode')))))
      }

      const OtherChannels = () => h('section', { className: 'kbky-card slim', 'data-kb': 'kybernos-kyber-others' },
        h('div', { className: 'kbky-kv' }, h('b', null, L('otherChannels'))),
        [['whatsapp', 'WhatsApp'], ['wechat', 'WeChat']].map((c) => h('div', { key: c[0], className: 'kbky-chan', 'data-kb': 'kybernos-kyber-chan-' + c[0] }, BRAND[c[0]](22), h('b', null, c[1]), h('span', { className: 'kbky-chip' }, L('soon')))))

      const WhereCard = (props) => {
        const linked = props.view.telegram.state === 'linked'
        const target = props.view.telegram.homeTarget
        const opt = (id, title, sub, disabled, chip) => h('label', { key: id, className: 'kbky-opt' + (target === id && !disabled ? ' on' : '') + (disabled ? ' dis' : ''), 'data-kb': 'kybernos-kyber-where-' + id },
          h('input', { type: 'radio', name: 'kybernos-kyber-where', value: id, checked: target === id && !disabled, disabled, onChange: () => { void setWhere(id) } }),
          h('span', { className: 'kbky-optt' }, h('b', null, title), h('span', null, sub)), chip ? h('span', { className: 'kbky-chip' }, L('soon')) : null)
        return h('section', { className: 'kbky-card slim', 'data-kb': 'kybernos-kyber-where' },
          h('div', { className: 'kbky-kv' }, h('b', null, L('whereH'))),
          h('p', { className: 'kbky-sub left' }, linked ? L('whereP') : L('whereNeed')),
          h('div', { className: 'kbky-opts' },
            opt('cloud', L('wCloud'), L('wCloudSub'), !linked, false),
            opt('mac', L('wMac'), L('wMacSub'), true, true),
            opt('ask', L('wAsk'), L('wAskSub'), !linked, false)),
          h('p', { className: 'kbky-sub left' }, L('whereHint')))
      }

      const ComputerCard = (props) => {
        const hm = props.view.home
        const free = hm !== null && hm.manualControl === false
        const st = hm === null ? '' : hm.state
        const head = h('div', { className: 'kbky-kv' }, h('b', null, L('computer')),
          hm === null ? null : h('span', { className: 'kbky-chip' + (st === 'running' ? ' ok' : '') }, S['st_' + st] !== undefined ? L('st_' + st) : L('st_other', { state: st })))
        if (hm === null) return h('section', { className: 'kbky-card slim', 'data-kb': 'kybernos-kyber-computer' }, head, h('p', { className: 'kbky-line' }, L('noHome')), h('p', { className: 'kbky-sub left' }, L('approvals')))
        const busy = state.busy !== ''
        const acts = free ? null : h('div', { className: 'kbky-actions' },
          st === 'suspended' ? h(Btn, { kb: 'kybernos-kyber-wake', disabled: busy, onClick: () => { void computerAction('resume') } }, L('wake')) : null,
          st === 'running' ? h(Btn, { kb: 'kybernos-kyber-sleep', disabled: busy, onClick: () => { void computerAction('suspend') } }, L('sleep')) : null,
          st === 'running' ? h(Btn, { kb: 'kybernos-kyber-pcopen', disabled: busy, onClick: () => { void computerAction('open') } }, Ic('ext', 14), L('openPc')) : null)
        return h('section', { className: 'kbky-card slim', 'data-kb': 'kybernos-kyber-computer' }, head,
          h('p', { className: 'kbky-line' }, S['txt_' + st] !== undefined ? L('txt_' + st) : L('st_other', { state: st })),
          hm.paused !== '' ? h('p', { className: 'kbky-warn' }, L(hm.paused === 'hours' ? 'pr_hours' : 'pr_other')) : null,
          hm.lastActive !== '' ? h('p', { className: 'kbky-sub left' }, L('lastActive', { when: when(hm.lastActive) })) : null,
          acts,
          free ? h('div', { className: 'kbky-upsell', 'data-kb': 'kybernos-kyber-upsell' }, Ic('star', 16), h('div', null, h('div', null, L('upsell')), h('div', { className: 'kbky-actions' }, h(Btn, { primary: true, kb: 'kybernos-kyber-upgrade', onClick: upgrade }, L('upgrade'))))) : null,
          h('p', { className: 'kbky-sub left' }, L('approvals')))
      }

      /**
       * The doors and the body. `lite` (the strip above the chat) shows what there is to DO: the Telegram card, and, once connected, the
       * settings behind a disclosure. The tab and the page show everything.
       */
      const Channels = (props) => {
        const v = state.view
        if (v === null) return h('p', { className: 'kbky-note' }, L('loading'))
        if (v.kind !== 'ok') return h('p', { className: 'kbky-note' }, L(v.kind))
        const linked = v.telegram.state === 'linked'
        const manage = v.accountUrl !== '' ? h('div', { className: 'kbky-actions' }, h('button', { type: 'button', className: 'kbky-link', 'data-kb': 'kybernos-kyber-account', onClick: () => { void openAccount('account') } }, L('manage'))) : null
        if (props.lite === true) {
          return h('div', { className: 'kbky-col', 'data-kb': 'kybernos-kyber-channels' },
            h(TelegramCard, { view: v, visible: props.visible !== false }),
            linked ? h('details', { className: 'kbky-more', 'data-kb': 'kybernos-kyber-settings' }, h('summary', null, L('settings')),
              h('div', { className: 'kbky-chan-grid' }, h(WhereCard, { view: v }), h(ComputerCard, { view: v })), manage) : null)
        }
        return h('div', { className: 'kbky-chan-grid', 'data-kb': 'kybernos-kyber-channels' },
          h('div', { className: 'kbky-col' }, h(TelegramCard, { view: v, visible: props.visible !== false }), h(OtherChannels)),
          h('div', { className: 'kbky-col' }, h(WhereCard, { view: v }), h(ComputerCard, { view: v }), manage))
      }

      // ═══ Kyby's own chat is a native DSH conversation: its session, and how to reach it ═══════════════════════════
      // `sessions` makes a chat (it answers the new session's id); `uiWorkspace` is DSH's own shell: it opens a chat and pins it.
      // Asked for at the moment of use: a re-applied plugin keeps working with whatever the shell offers then.
      const svc = (name) => { try { return CTX !== null ? CTX.get(name) : null } catch (e) { return null } }
      const readSessionPointer = async () => {
        const r = await readJson('/kybernos-cloud/kyby/native')
        state.kybySid = r !== null && r.ok === true && typeof r.sessionId === 'string' ? r.sessionId : null
        state.kybyCwd = r !== null && r.ok === true && typeof r.cwd === 'string' && r.cwd !== '' ? r.cwd : null
        emit()
        return state.kybySid
      }
      /** The chat exists AND belongs to a workspace: one made without a folder (the first build did that) asks the person to choose one. */
      const sessionExists = (sid) => {
        try {
          const snap = svc('sessions').list.getSnapshot()
          if (snap === null || snap === undefined || snap.byId === null || typeof snap.byId !== 'object' || snap.byId[sid] === undefined) return false
          const ws = svc('uiWorkspace').workspaces.list.getSnapshot()
          return ws !== null && ws !== undefined && Array.isArray(ws.items) && ws.items.some((i) => i !== null && Array.isArray(i.sessionIds) && i.sessionIds.includes(sid))
        } catch (e) { return false }
      }
      /** Opens Kyby's conversation, making it the first time (a blank DSH chat, remembered by the host, which gives it Kyby's identity). */
      const openChat = async () => {
        if (state.opening) return false
        state.opening = true
        state.openFailed = false
        emit()
        try {
          const sessionsSvc = svc('sessions')
          const uiSvc = svc('uiWorkspace')
          if (sessionsSvc === null || sessionsSvc === undefined || typeof sessionsSvc.create !== 'function' || uiSvc === null || uiSvc === undefined || typeof uiSvc.openSession !== 'function') throw new Error('no sessions service')
          let sid = await readSessionPointer()
          if (sid === null || !sessionExists(sid)) {
            // `sessions.create` answers the new session's id itself (and throws when it cannot); older shapes answer an object.
            // In Kyby's own folder, as a workspace of its own and already chosen: DSH's « New chat » reuses a blank chat of the workspace it is
            // in, never this one, and the person is not asked for a folder.
            let workspaceId = null
            const wsSvc = svc('workspaces')
            if (state.kybyCwd !== null && wsSvc !== null && wsSvc !== undefined && typeof wsSvc.create === 'function') {
              const ws = await wsSvc.create({ path: state.kybyCwd })
              workspaceId = ws !== null && typeof ws === 'object' && typeof ws.workspaceId === 'string' ? ws.workspaceId : null
              try { if (workspaceId !== null && typeof wsSvc.rename === 'function') await wsSvc.rename(workspaceId, NAME) } catch (e) { /* the folder's own name stays */ }
            }
            const made = await sessionsSvc.create(workspaceId !== null ? { workspaceId } : (state.kybyCwd === null ? {} : { cwd: state.kybyCwd }))
            const v = made !== null && typeof made === 'object' && made.value !== null && made.value !== undefined ? made.value : made
            sid = typeof v === 'string' ? v : (v !== null && typeof v === 'object' && typeof v.sessionId === 'string' ? v.sessionId : null)
            if (typeof sid !== 'string' || sid === '') throw new Error('no session made')
            const w = await postJson('/kybernos-cloud/kyby/native/set', { sessionId: sid })
            if (w === null || w.ok !== true) throw new Error('the session could not be remembered')
            state.kybySid = sid
          }
          uiSvc.openSession(sid)
          return true
        } catch (e) {
          state.openFailed = true
          state.openError = String(e && e.message ? e.message : e).slice(0, 200)
          return false
        } finally {
          state.opening = false
          emit()
        }
      }

      const useStore = () => {
        const [, setTick] = React.useState(0)
        React.useEffect(() => {
          const fn = () => setTick((n) => n + 1)
          listeners.add(fn)
          if (state.view === null) void load()
          if (state.kybySid === null) void readSessionPointer()
          const poll = setInterval(() => { if (document.visibilityState !== 'hidden') void load() }, 30000)
          return () => { listeners.delete(fn); clearInterval(poll) }
        }, [])
      }

      /** What the status chip says, from the view and the pairing. */
      const statusOf = (v) => {
        const tg = v !== null && v.kind === 'ok' ? v.telegram.state : null
        if (tg === 'linked') return ['ok', 'stOn']
        if (tg === null || tg === 'off') return ['', 'stNone']
        return pairingFace(state.pairing, Date.now()).kind === 'scanned' ? ['warn', 'stWait'] : ['', 'stOff']
      }

      /** The collapsible « Channels » strip: Telegram, the other channels, where Kyby works, its computer. Open until Telegram is connected. */
      const Strip = () => {
        const v = state.view
        const open = stripIsOpen(state.stripPref, v !== null && v.kind === 'ok' && v.telegram.state === 'linked')
        const chip = statusOf(v)
        return h('div', { className: 'kbky-strip' + (open ? ' open' : ''), 'data-kb': 'kybernos-kyber-strip' },
          h('button', { type: 'button', className: 'kbky-striph', 'aria-expanded': String(open), 'data-kb': 'kybernos-kyber-strip-toggle', onClick: toggleStrip },
            h('span', { className: 'kbky-car' }, Ic('chev', 14)), h('b', null, L('channels')),
            h('span', { className: 'kbky-stripc' },
              h('span', { className: 'kbky-chip ' + chip[0], 'data-kb': 'kybernos-kyber-status' }, BRAND.telegram(14), L(chip[1])),
              h('span', { className: 'kbky-chip' }, BRAND.whatsapp(14), 'WhatsApp · ' + L('soon')),
              h('span', { className: 'kbky-chip' }, BRAND.wechat(14), 'WeChat · ' + L('soon')),
              v !== null && v.kind === 'ok' ? h('span', { className: 'kbky-chip' }, Ic('cloud', 13), L(v.telegram.homeTarget === 'ask' ? 'wChipAsk' : 'wChip')) : null)),
          open ? h('div', { className: 'kbky-stripb' }, h(Channels, { visible: true, lite: true })) : null)
      }

      /** The strip, above the composer of Kyby's own conversation and of no other. */
      const KybyDock = (props) => {
        useStore()
        const sid = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''
        if (sid === '' || state.kybySid !== sid) return null
        return h('div', { className: 'kbky-dock', 'data-kb': 'kybernos-kyber-dock' }, h(Strip))
      }

      /** The page the menu row used to open, and the new-chat card still opens: what Kyby is, the way into its conversation, the strip. */
      const Page = () => {
        useStore()
        const v = state.view
        const three = h('div', { className: 'kbky-three' },
          [['phone', 'b1h', 'b1p'], ['cloud', 'b2h', 'b2p'], ['shield', 'b3h', 'b3p']].map((b) => h('div', { key: b[0] }, Ic(b[0], 20), h('b', null, L(b[1])), h('span', null, L(b[2])))))
        const chip = statusOf(v)
        return h('div', { className: 'kbky-page', 'data-kb': 'kybernos-kyber-page' },
          h('div', { className: 'kbky-hero' },
            h('div', { className: 'kbky-herot' }, h('span', { className: 'kbky-glyph' }, Ic('kyby', 22)), h('div', { className: 'kbky-row wrap' }, h('b', { className: 'kbky-name' }, L('title')), h('span', { className: 'kbky-chip ' + chip[0] }, L(chip[1])))),
            h('h1', null, L('heroH')), h('p', { className: 'kbky-lead' }, L('heroP')),
            h('div', { className: 'kbky-actions' }, h(Btn, { primary: true, kb: 'kybernos-kyber-openchat', disabled: state.opening, onClick: () => { void openChat() } }, L('openChat'))),
            h('p', { className: 'kbky-sub left' }, L('openChatHint')),
            state.openFailed ? h('p', { className: 'kbky-err', role: 'alert' }, L('openChatFail')) : null,
            three),
          h(Strip))
      }

      /** The tab of the right-hand panel: the same panel, with room only for the panel. */
      const Pane = () => {
        useStore()
        const v = state.view
        const head = h('div', { className: 'kbky-head' },
          h('h2', { className: 'kbky-h' }, L('title')),
          h('button', { type: 'button', className: 'kbky-btn', onClick: () => { void load() }, disabled: state.loading, 'data-kb': 'kybernos-kyber-refresh' }, state.loading ? L('loading') : L('refresh')))
        if (v === null) return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, h('p', { className: 'kbky-note' }, L('loading')))
        if (v.kind !== 'ok') return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, h('p', { className: 'kbky-note' }, L(v.kind)))
        return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, h(Channels, { visible: true }))
      }

      // ═══ style: DSH tokens with a fallback, never a hard-coded theme colour ══════════════════════════════════════
      const CSS = [
        '.kbky{box-sizing:border-box;height:100%;overflow:auto;padding:10px 12px 20px;color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13.5px)}',
        '.kbky-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:2px 2px 10px}',
        '.kbky-h{margin:0;font-size:16px;font-weight:600}',
        '.kbky-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;min-height:100%;max-width:880px;margin:0 auto;padding:18px 20px 20px;color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13.5px)}',
        '.kbky-hero{display:flex;flex-direction:column;gap:10px}',
        '.kbky-herot{display:flex;align-items:center;gap:12px}',
        '.kbky-glyph{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;flex:none;background:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff)}',
        '.kbky-name{font-size:16px}',
        '.kbky-row{display:flex;align-items:center;gap:8px}.kbky-row.wrap{flex-wrap:wrap}',
        '.kbky-page h1{margin:0;font-size:23px;line-height:1.2;font-weight:700;letter-spacing:-.01em;text-wrap:balance}',
        '.kbky-lead{margin:0;font-size:15px;line-height:1.55;color:var(--dsw-alias-label-secondary,#666);max-width:62ch}',
        '.kbky-subline{margin:0;font-size:14px;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-what summary{cursor:pointer;color:var(--dsw-alias-label-secondary,#666);width:max-content;font-size:13px}',
        '.kbky-what .kbky-lead{margin-top:10px}',
        '.kbky-three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}',
        '.kbky-three>div{padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));display:flex;flex-direction:column;gap:6px}',
        '.kbky-three span{color:var(--dsw-alias-label-secondary,#666);font-size:13px}',
        '.kbky-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:99px;font-size:12px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-chip.ok{border-color:transparent;background:var(--dsw-alias-state-success-bg,rgba(34,197,94,.16));color:var(--dsw-alias-state-success-primary,#15803d)}',
        '.kbky-chip.warn{border-color:transparent;background:var(--dsw-alias-state-warn-bg,rgba(245,158,11,.18));color:var(--dsw-alias-state-warn-label,#a8530a)}',
        '.kbky-strip{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:14px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06))}',
        '.kbky-striph{width:100%;display:flex;gap:10px;align-items:center;padding:9px 14px;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left;flex-wrap:wrap}',
        '.kbky-car{display:inline-flex;transform:rotate(-90deg);transition:transform .15s;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-strip.open .kbky-car{transform:rotate(0)}',
        '.kbky-stripc{display:flex;gap:6px;flex-wrap:wrap}',
        '.kbky-stripb{padding:4px 14px 14px}',
        '.kbky-chan-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:12px;align-items:start}',
        '.kbky-col{display:flex;flex-direction:column;gap:12px;min-width:0}',
        '.kbky-card{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:12px;min-width:0}',
        '.kbky-card.slim{padding:14px;gap:8px}',
        '.kbky-cardh h3{margin:0;font-size:16px;font-weight:650}.kbky-cardh p{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-kv{display:flex;gap:8px;align-items:center;justify-content:space-between}',
        '.kbky-connbody{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:start}',
        '.kbky-connl{display:flex;flex-direction:column;gap:12px;min-width:0}',
        '.kbky-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px;counter-reset:s}',
        '.kbky-steps li{display:flex;gap:10px;counter-increment:s}',
        '.kbky-steps li::before{content:counter(s);flex:none;width:22px;height:22px;border-radius:99px;display:grid;place-items:center;font-size:12px;font-weight:650;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3))}',
        '.kbky-qrcol{display:flex;flex-direction:column;align-items:center;gap:8px;width:204px}',
        '.kbky-qr{width:196px;height:196px;border-radius:12px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3))}',
        '.kbky-qr svg{display:block;width:100%;height:100%}.kbky-qr.dim svg{opacity:.18}',
        '.kbky-lock{display:flex;gap:8px;color:var(--dsw-alias-label-secondary,#666);font-size:12.5px;align-items:flex-start}',
        '.kbky-spin{width:26px;height:26px;border-radius:99px;border:3px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-top-color:var(--dsw-alias-label-primary,#222);animation:kbky-sp 1s linear infinite}',
        '@keyframes kbky-sp{to{transform:rotate(360deg)}}',
        '@media (prefers-reduced-motion: reduce){.kbky-spin{animation:none}}',
        '.kbky-big{display:flex;gap:12px;align-items:flex-start}',
        '.kbky-big h3{margin:0;font-size:15px;font-weight:650}.kbky-big p{margin:2px 0 0;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-badge{width:40px;height:40px;border-radius:99px;display:grid;place-items:center;flex:none;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.12))}',
        '.kbky-badge.sm{width:28px;height:28px}',
        '.kbky-badge.ok{background:var(--dsw-alias-state-success-bg,rgba(34,197,94,.16));color:var(--dsw-alias-state-success-primary,#15803d)}',
        '.kbky-badge.warn{background:var(--dsw-alias-state-warn-bg,rgba(245,158,11,.18));color:var(--dsw-alias-state-warn-label,#a8530a)}',
        '.kbky-badge.err{background:var(--dsw-alias-state-error-bg,rgba(236,19,19,.12));color:var(--dsw-alias-state-error-primary,#b91c1c)}',
        '.kbky-chan{display:flex;gap:10px;align-items:center;padding:4px 0}.kbky-chan b{flex:1;font-weight:600}',
        '.kbky-opts{display:flex;flex-direction:column;gap:6px}',
        '.kbky-opt{display:flex;gap:10px;align-items:flex-start;padding:8px 10px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));cursor:pointer}',
        '.kbky-opt.on{border-color:var(--dsw-alias-label-primary,#222);background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.1))}',
        '.kbky-opt.dis{opacity:.6;cursor:default}',
        '.kbky-opt input{margin-top:3px}',
        '.kbky-optt{display:flex;flex-direction:column;gap:1px;flex:1;min-width:0}.kbky-optt span{color:var(--dsw-alias-label-secondary,#666);font-size:12.5px}',
        '.kbky-upsell{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.1));color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-line{margin:0;font-weight:500}',
        '.kbky-sub{margin:0;color:var(--dsw-alias-label-secondary,#666);font-size:12.5px;text-align:center}.kbky-sub.left{text-align:left}',
        '.kbky-note{margin:8px 0;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-warn{margin:0;color:var(--dsw-alias-state-warn-label,#a8530a)}',
        '.kbky-err{margin:0;color:var(--dsw-alias-state-error-primary,#b91c1c)}',
        '.kbky-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}',
        '.kbky-btn{display:inline-flex;align-items:center;gap:8px;min-height:34px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-radius:9px;padding:6px 12px;cursor:pointer;font:inherit;color:inherit;text-decoration:none;background:var(--dsw-alias-bg-base,rgba(127,127,127,.1))}',
        '.kbky-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22))}',
        '.kbky-btn.pri{background:var(--dsw-alias-button-primary-fill,#0f1115);border-color:var(--dsw-alias-button-primary-fill,#0f1115);color:var(--dsw-alias-label-primary-foreground,#fff);font-weight:600}',
        '.kbky-btn.danger{color:var(--dsw-alias-state-error-primary,#b91c1c);border-color:var(--dsw-alias-state-error-primary,#b91c1c)}',
        '.kbky-btn[disabled]{opacity:.6;cursor:default}',
        '.kbky-btn:focus-visible,.kbky-link:focus-visible,.kbky-striph:focus-visible,.kbky-chipb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:2px}',
        '.kbky-link{border:0;background:none;padding:0;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary,#666);text-decoration:underline;cursor:pointer;text-align:left}',
        '.kbky-dock{margin:0 0 8px}',
        '.kbky-more{margin-top:2px}',
        '.kbky-more summary{cursor:pointer;width:max-content;color:var(--dsw-alias-label-secondary,#666);font-size:13px;padding:2px 0}',
        '.kbky-more[open] summary{margin-bottom:8px}',
        // narrow: one column, and no QR (nobody scans their own screen: the button is the way)
        '@container (max-width:760px){.kbky-chan-grid{grid-template-columns:minmax(0,1fr)}}',
        '@media (max-width:760px){.kbky-chan-grid{grid-template-columns:minmax(0,1fr)}.kbky-three{grid-template-columns:minmax(0,1fr)}.kbky-qrcol{display:none}.kbky-connbody{grid-template-columns:minmax(0,1fr)}.kbky-page{padding:14px 12px}}',
        '.kbky .kbky-chan-grid{grid-template-columns:minmax(0,1fr)}.kbky .kbky-connbody{grid-template-columns:minmax(0,1fr)}.kbky .kbky-qrcol{width:auto}',
      ].join('\n')

      const TYPE_ID = 'kybernos-kyber'
      const SLOT_PAGE = 'main.kybernos-kyber'
      const KIND = 'kybernos-kyber'
      const SLOT_PANE = 'sidebar.right.pane.tab'
      const SLOT_DOCK = 'conversation.input.dock'
      const STYLE_ID = 'kybernos-kyber-styles'
      let CTX = null

      return {
        name: 'kybernos-kyber',
        // `sidebarRightTabs` must be declared: ui-sidebar-right provides it, and without this `apply` could run before.
        inject: ['slots', 'sidebarRightTabs', 'sessions', 'workspaces', 'uiWorkspace'],
        __test: { S, L, kt, derive, pairingFace, clock, stripIsOpen, CSS, TYPE_ID, KIND, state, BRAND, NAME },
        apply (ctx) {
          CTX = ctx
          // The plugin is applied again when a service it asks for comes back: the new scope replaces the sheet, and the old scope's
          // cleanup then removes only the element IT made.
          ctx.effect(() => {
            const old = document.getElementById(STYLE_ID)
            if (old) old.remove()
            const el = document.createElement('style')
            el.id = STYLE_ID
            el.setAttribute('data-plugin', '@local/kybernos-kyber')
            el.textContent = CSS
            document.head.appendChild(el)
            return () => { el.remove() }
          }, 'kybernos-kyber: styles')

          // the tab type: it shows in the sidebar's « + » guide, and opens like any other tab
          let registre = null
          try { registre = ctx.get('sidebarRightTabs') } catch (e) { registre = null }
          if (registre && typeof registre.register === 'function') {
            ctx.effect(() => registre.register({
              id: TYPE_ID,
              kind: KIND,
              title: () => L('title'),
              guide: [{ title: () => L('title'), description: () => L('tabHint') }],
            }), 'kybernos-kyber: sidebar tab type')
          }
          // the page: the child slot the core's menu row opens
          ctx.effect(() => ctx.slots.inject(SLOT_PAGE, () => ctx.slots.register({ name: SLOT_PAGE }, () => { try { return h(Page) } catch (e) { return null } })), 'kybernos-kyber: page')
          // Kyby's own conversation is a native DSH chat: the strip sits in the dock above its composer, and above no other's.
          ctx.effect(() => ctx.slots.inject(SLOT_DOCK, () => ctx.slots.register(
            { name: SLOT_DOCK, id: 'kybernos-kyby-strip', order: 5 },
            (props) => { try { return h(KybyDock, props) } catch (e) { return null } }
          )), 'kybernos-kyber: strip above the composer')
          ctx.effect(() => ctx.slots.inject(SLOT_PANE, () => ctx.slots.register(
            { name: SLOT_PANE, key: TYPE_ID },
            () => { try { return h(Pane) } catch (e) { return null } }
          )), 'kybernos-kyber: tab body')

          try {
            window.__KB_KYBER__ = {
              /** What the page shows now (diagnostics, live checks). */
              state () { return { loading: state.loading, view: state.view, at: state.at, pairing: state.pairing === null ? null : { state: state.pairing.state, error: state.pairing.error || '' }, kybySid: state.kybySid, openFailed: state.openFailed, openError: state.openError } },
              /** Opens Kyby's native conversation (the sidebar row calls this). False when it could not be opened. */
              openChat () { return openChat() },
              /** Whether `sid` is Kyby's own chat (the new-chat cards stay out of it). */
              isKybySession (sid) { return typeof sid === 'string' && sid !== '' && sid === state.kybySid },
              /** Reads the state again (live checks drive the page's answers; a person has the refresh button of the tab). */
              refresh () { return load() },
              /** Opens the tab, the same call the sidebar's « + » guide makes. False when no chat is on screen. */
              open () {
                try {
                  const sb = CTX && CTX.get('sidebarRight')
                  if (sb && typeof sb.openTab === 'function') { sb.openTab(KIND, {}); return true }
                } catch (e) { /* no chat on screen */ }
                return false
              },
            }
          } catch (e) { /* no window */ }
        },
      }
    } catch (error) {
      try { console.error('[kybernos-kyber] load failed — plugin disabled, GUI preserved', error) } catch (e) { /* no console */ }
      return { apply () { /* disabled after a load error */ } }
    }
  },
})
