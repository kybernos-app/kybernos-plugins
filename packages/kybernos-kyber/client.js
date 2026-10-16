// kybernos-kyber — browser half.
//
// Kaby, the person's own assistant: one conversation (the thread every door shares), the doors it answers from (Telegram now, WhatsApp
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
      // `{NAME}` is the assistant's name (the one constant below): every sentence says it through the token.
      const fill = (text, p) => text.replace(/\{(\w+)\}/g, (m, k) => (p !== undefined && p[k] !== undefined ? String(p[k]) : (k === 'NAME' ? NAME : m)))
      // What the person calls their own assistant: the one place to change it here (the sidebar row's label is `kbui.kyber` in kybernos-plugin).
      const NAME = 'Kaby'
      // [fr, en] pairs, by key, in ONE table so that a test can check both sides of every pair.
      const S = {
        title: ['{NAME}', '{NAME}'],
        tabHint: ['Ton assistant : la conversation, Telegram et l’ordinateur sur lequel il travaille.', 'Your assistant: the conversation, Telegram and the computer it works on.'],
        // header and intro
       
        heroH: ['Ton assistant, dans ta poche.', 'Your assistant, in your pocket.'],
        // What {NAME} is, in one picture (the owner's): a phone with a remote control, working on the desktop. Said on the page, above the tiles of the strip, and by the help card.
        intro: ['{NAME}, c’est comme un téléphone avec télécommande : tu lui parles d’ici ou depuis Telegram, et il travaille sur ton ordinateur. Un ordinateur dans le cloud peut prendre le relais quand le tien est éteint. Avant de modifier quoi que ce soit, il te demande.', '{NAME} is like a phone with a remote control: you talk to it from here or from Telegram, and it works on your desktop. A cloud computer can take over when yours is off. Before it changes anything, it asks you.'],
        // One help line under each tile's title.
        channelsHelp: ['Relie Telegram, WhatsApp et WeChat pour que {NAME} puisse te joindre là. « Bientôt » : pas encore disponible.', 'Link Telegram, WhatsApp and WeChat so {NAME} can reach you there. “Soon” means it is not available yet.'],
        computerHelp: ['La machine sur laquelle {NAME} travaille : cet ordinateur, ou un ordinateur dans le cloud qui continue quand le tien est éteint. « À la demande » : il est créé la première fois que tu demandes quelque chose qui en a besoin.', 'The machine {NAME} works on: this computer (your desktop), or a cloud computer that keeps going when yours is off. “On request” means it is made the first time you ask for something that needs it.'],
        b1h: ['Demande de n’importe où', 'Ask from anywhere'], b1p: ['Ici, ou depuis ton téléphone sur Telegram. C’est la même conversation.', 'Here, or from your phone on Telegram. It is the same conversation.'],
        b2h: ['Il travaille pendant ton absence', 'It keeps working while you are away'], b2p: ['Il a son propre ordinateur, qui se réveille quand il a du travail.', 'It has its own computer, which wakes up when it has work to do.'],
        b3h: ['Tu gardes la main', 'You stay in control'], b3p: ['Avant d’agir, il demande : Autoriser, Refuser ou Autoriser pour cette tâche.', 'Before it acts, it asks: Allow, Refuse, or Allow for this task.'],
        stOn: ['Telegram connecté', 'Telegram connected'], stOff: ['Telegram non connecté', 'Telegram not connected'], stWait: ['Telegram en attente', 'Telegram waiting'], stNone: ['Telegram indisponible', 'Telegram unavailable'],
        // the strip
        channels: ['Canaux', 'Channels'], soon: ['Bientôt', 'Soon'],
        // telegram
        telegram: ['Telegram', 'Telegram'],
        cH: ['Connecter Telegram', 'Connect Telegram'],
        s1: ['Scanne ce code avec l’appareil photo de ton téléphone. Sur le téléphone, touche « Ouvrir Telegram ».', 'Scan this code with your phone’s camera. On a phone, tap “Open Telegram”.'],
        s2: ['Dans Telegram, touche Démarrer.', 'In Telegram, tap Start.'],
        s3: ['Touche « Oui, c’est moi ».', 'Tap “Yes, it’s me”.'],
        openTg: ['Ouvrir Telegram', 'Open Telegram'],
        tgNone: ['Pas connecté', 'Not connected'], tgCode: ['Code à scanner', 'Code to scan'], tgWait2: ['En attente de ton accord', 'Waiting for your OK'],
        tgExp: ['Code expiré', 'Code expired'], tgDec: ['Refusé dans Telegram', 'Refused in Telegram'], tgTak: ['Déjà utilisé par un autre compte', 'Already used by another account'],
        tgBot: ['Compte déjà créé par le bot', 'Account already made by the bot'],
        noCam: ['Pas de caméra ni d’application ? Écrire un code à la place', 'No camera or no app? Write a code instead'],
        codeIntro: ['Dans Telegram, ouvre {bot} et écris :', 'In Telegram, open {bot} and write:'], codeCopy: ['Copier', 'Copy'], codeCopied: ['Copié', 'Copied'],
        expiresIn: ['Expire dans {t}', 'Expires in {t}'], newCode: ['Nouveau code', 'New code'],
        preparing: ['Préparation du code…', 'Preparing the code…'],
        scH: ['Presque fini : confirme dans Telegram', 'Almost done: confirm in Telegram'],
        scP: ['Telegram indique : {who}. Touche « Oui, c’est moi » dans la conversation avec {NAME}.', 'Telegram says: {who}. Tap “Yes, it’s me” in the chat with {NAME}.'],
        scWait: ['En attente de ton tap…', 'Waiting for your tap…'], notMe: ['Ce n’est pas moi : annuler', 'Not me: cancel'],
        linked: ['Connecté : {name}', 'Connected: {name}'],
        paused: ['En pause : écris /resume au bot pour reprendre.', 'Paused: write /resume to the bot to resume.'],
        blocked: ['Le bot est bloqué dans Telegram : débloque-le pour recevoir les réponses.', 'The bot is blocked in Telegram: unblock it to receive answers.'],
        openBot: ['Ouvrir', 'Open'], discQ: ['Déconnecter Telegram ?', 'Disconnect Telegram?'], confirm: ['Confirmer', 'Confirm'], cancel: ['Annuler', 'Cancel'],
        exH: ['Ce code a expiré', 'This code has expired'], exP: ['Un code est valable 5 minutes et ne sert qu’une fois.', 'A code is good for 5 minutes and works once.'],
        deH: ['Rien n’a été connecté', 'Nothing was connected'], deP: ['Tu as touché « Non » dans Telegram.', 'You tapped “No” in Telegram.'],
        taH: ['Ce Telegram est déjà connecté à un autre compte', 'This Telegram is already connected to another account'],
        taP: ['Déconnecte-le d’abord dans l’autre compte (écris /unlink à {NAME} dans Telegram), puis reviens ici.', 'Disconnect it from the other account first (write /unlink to {NAME} in Telegram), then come back here.'],
        bmH: ['Ce Telegram a déjà un compte créé par le bot', 'This Telegram already has an account made by the bot'],
        bmP: ['Rattacher ce Telegram à ton compte n’est pas encore possible. En attendant, continue à utiliser le bot tel quel.', 'Attaching this Telegram to your account is not possible yet. Meanwhile, keep using the bot as it is.'],
        ofH: ['Telegram n’est pas activé sur ce serveur', 'Telegram is not turned on on this server'],
        ofP: ['Ce serveur n’a pas de bot Telegram : il en faut un pour connecter Telegram.', 'This server has no Telegram bot: one is needed to connect Telegram.'],
       
        pe: ['Impossible de préparer le code pour l’instant.', 'The code cannot be prepared right now.'],
        peRate: ['Trop d’essais : réessaie dans une minute.', 'Too many tries: try again in a minute.'],
        retry: ['Réessayer', 'Try again'],
        // computer
        computer: ['Ordinateur', 'Computer'],
        // « This computer » is the machine that runs Kybernos: a choice that needs no server and no account.
        thisComputer: ['Cet ordinateur', 'This computer'], ready: ['Prêt', 'Ready'], cloudName: ['{name} (cloud)', '{name} (cloud)'],
        txt_local: ['{NAME} travaille sur cet ordinateur quand tu lui écris ici. Garde Kybernos ouvert.', '{NAME} works on this computer when you write to it here. Keep Kybernos open.'],
        noHome: ['Créé à ta première demande qui en a besoin.', 'Made at your first request that needs one.'],
        onRequest: ['À la demande', 'On request'],
        pickLead: ['Ordinateur lié à {NAME}', 'Computer linked to {NAME}'],
        err_computer: ['Le choix n’a pas pu être enregistré.', 'The choice could not be saved.'],
        err_computer_old: ['Ce serveur ne sait pas encore enregistrer ce choix.', 'This server cannot save this choice yet.'],
        ofSub: ['Pas de bot sur ce serveur', 'No bot on this server'], ofSubS: ['Pas de bot sur ce serveur ({server})', 'No bot on this server ({server})'],
        st_running: ['Éveillé', 'Awake'], st_suspended: ['En veille', 'Asleep'], st_creating: ['Initialisation', 'Setting up'], st_resuming: ['Se réveille', 'Waking up'],
        st_suspending: ['S’endort', 'Going to sleep'], st_failed: ['En échec', 'Failed'], st_other: ['{state}', '{state}'],
        txt_running: ['Éveillé : {NAME} travaille dessus.', 'Awake: {NAME} is working on it.'],
        txt_suspended: ['En veille. Il se réveille tout seul quand {NAME} a du travail, puis se rendort.', 'Asleep. It wakes by itself when {NAME} has work, then goes back to sleep.'],
        txt_creating: ['Initialisation d’une machine dédiée pour toi. Environ une minute.', 'Setting up a machine dedicated to you. About a minute.'], txt_resuming: ['Il se réveille.', 'It is waking up.'], txt_suspending: ['Il s’endort.', 'It is going to sleep.'],
        txt_failed: ['Il n’a pas démarré. {NAME} réessaiera au prochain message.', 'It did not start. {NAME} will try again at the next message.'],
        pr_hours: ['Les heures d’exécution du mois sont utilisées.', 'This month’s run hours are used up.'], pr_other: ['Il est en pause.', 'It is paused.'],
        wake: ['Réveiller', 'Wake up'], sleep: ['Mettre en veille', 'Put to sleep'], openPc: ['Ouvrir', 'Open'],
        upsell: ['Offre Free : réveil automatique seulement.', 'Free plan: automatic wake only.'],
        upgrade: ['Passer à une offre payante', 'Upgrade to a paid plan'],
        manage: ['Gérer dans mon compte', 'Manage in my account'],
        // the native conversation
        openChat: ['Ouvrir la conversation avec {NAME}', 'Open the conversation with {NAME}'],
        openChatHint: ['Une vraie conversation DSH : même composeur, même rendu, avec la mémoire de ton compte. Ce qui s’y dit va aussi sur le fil que {NAME} partage avec Telegram.', 'A real DSH chat: same composer, same rendering, with your account’s memory. What is said there also goes on the thread {NAME} shares with Telegram.'],
        openChatFail: ['La conversation n’a pas pu s’ouvrir.', 'The conversation could not be opened.'],
        // states of the whole
        refresh: ['Actualiser', 'Refresh'],
        signedOut: ['Connecte-toi à Kybernos pour voir ton {NAME}.', 'Sign in to Kybernos to see your {NAME}.'],
        failed: ['Impossible de lire l’état pour l’instant.', 'The state cannot be read right now.'],
        loading: ['Lecture…', 'Reading…'],
      }
      const L = (key, p) => { const pair = S[key]; return pair === undefined ? key : fill(kt(pair[0], pair[1]), p) }

      // ═══ the model: pure, no DOM, tested without a browser ═══════════════════════════════════════════════════════
      const asObj = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : null)
      const clock = (secs) => { const n = Math.max(0, Math.floor(secs)); return Math.floor(n / 60) + ':' + String(n % 60).padStart(2, '0') }
      /** What the page shows, from what the two routes said. `kyber` is the answer of /kybernos-cloud/kyber (or null), `server` the one of /kybernos-cloud/server. */
      const derive = (kyber, server) => {
        const k = asObj(kyber)
        if (k === null || k.ok !== true) return { kind: 'failed' }
        if (k.connected !== true) return { kind: 'signedOut' }
        const s = asObj(server) !== null ? asObj(asObj(server).server) : null
        const api = s !== null && typeof s.api === 'string' && /^https?:\/\//.test(s.api) ? s.api.replace(/\/+$/, '') : ''
        const t = asObj(k.telegram)
        let telegram = { state: 'off' }
        if (t !== null && t.configured === true && t.enabled === true) {
          const linked = asObj(t.linked)
          const bot = typeof t.bot === 'string' && /^[A-Za-z0-9_]{3,64}$/.test(t.bot) ? t.bot : ''
          telegram = linked === null
            ? { state: 'unlinked', botUrl: bot === '' ? '' : 'https://t.me/' + bot }
            : { state: 'linked', name: String(linked.display || ''), since: String(linked.linked_at || ''), paused: linked.paused === true, blocked: linked.blocked === true, botUrl: bot === '' ? '' : 'https://t.me/' + bot }
        }
        const hm = asObj(k.home)
        // The person's cloud computers (the one linked to {NAME} is `home`): a few names, to choose among when there are several.
        const computers = (Array.isArray(k.computers) ? k.computers : [])
          .filter((c) => asObj(c) !== null && typeof c.id === 'string' && /^[0-9a-fA-F-]{8,40}$/.test(c.id) && typeof c.name === 'string')
          .slice(0, 20).map((c) => ({ id: c.id, name: c.name.slice(0, 60), state: String(c.state || '').slice(0, 20) }))
        const home = hm === null ? null : {
          id: typeof hm.id === 'string' && /^[0-9a-fA-F-]{8,40}$/.test(hm.id) ? hm.id : '',
          name: typeof hm.name === 'string' ? hm.name.slice(0, 60) : '',
          state: String(hm.state || ''),
          version: typeof hm.version === 'string' && hm.version !== '' ? hm.version : '',
          lastActive: typeof hm.last_active_at === 'string' ? hm.last_active_at : '',
          network: ['public', 'closed', 'list'].indexOf(String(hm.network)) >= 0 ? String(hm.network) : '',
          // `false` only when the server says so: a server that does not know the field keeps the buttons.
          manualControl: hm.manual_control !== false,
          paused: typeof hm.paused_reason === 'string' && hm.paused_reason !== '' ? (hm.paused_reason === 'hours' ? 'hours' : 'other') : '',
        }
        const serverId = s !== null && typeof s.id === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(s.id) ? s.id : ''
        return { kind: 'ok', telegram, home, computers, serverId, accountUrl: api === '' ? '' : api + '/account' }
      }
      /** Which computer {NAME} works on, as the tile shows it: the person's choice (`pref`), else the cloud computer when one is already there (made at an
       *  earlier request), else this one. A view with no account or no readable server can only say « this computer »: that choice needs neither. */
      const whereOf = (pref, view) => {
        if (view === null || view === undefined || view.kind !== 'ok') return 'local'
        if (pref === 'local' || pref === 'cloud') return pref
        return view.home !== null ? 'cloud' : 'local'
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
        pairing: null, starting: false, confirmDisc: false, showCode: false, copied: false, busy: '',
        kybySid: null, kybyCwd: null, opening: false, openFailed: false, openError: '', computerError: '', where: null,
      }
      try { const v = window.localStorage.getItem('kybernos-kyber.strip'); if (v === '0') state.stripPref = false; else if (v === '1') state.stripPref = true } catch (e) { /* no storage */ }
      try { const w = window.localStorage.getItem('kybernos-kyber.where'); if (w === 'local' || w === 'cloud') state.where = w } catch (e) { /* no storage */ }
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
        settle()
      }
      // A computer that is being made, woken or put to sleep is read again every few seconds (for about three minutes) until it has settled:
      // « Setting up… » must turn into « Asleep » or « Awake » by itself.
      const TRANSIENT = ['creating', 'resuming', 'suspending']
      let settleTimer = null
      let settleN = 0
      const settle = () => {
        if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null }
        const st = state.view !== null && state.view.kind === 'ok' && state.view.home !== null ? state.view.home.state : ''
        if (TRANSIENT.indexOf(st) >= 0 && live() && settleN < 60) {
          settleN += 1
          settleTimer = setTimeout(() => { settleTimer = null; void load() }, 3000)
        } else settleN = 0
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
        state.pairing = null
        state.showCode = false
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
        state.showCode = false
        emit()
        if (typeof id === 'string') await postJson('/kybernos-cloud/telegram/pairing/cancel', { id })
      }

      // — settings, disconnect, computer —
      /** The cloud computer linked to {NAME}: asked of the host, which asks the server; the answer is read again from the server. */
      const setComputer = async (id) => {
        state.computerError = ''
        emit()
        const r = await postJson('/kybernos-cloud/kyby/computer', { computer_id: id === '' ? null : id })
        if (r === null || r.ok !== true) state.computerError = r !== null && r.error === 'not_found' ? 'err_computer_old' : 'err_computer'
        await load()
      }
      /** « This computer » or the cloud one: remembered by this browser, with no call to any server (the cloud computer itself is chosen with `setComputer`). */
      const setWhere = (w) => {
        state.where = w
        try { window.localStorage.setItem('kybernos-kyber.where', w) } catch (e) { /* no storage: the choice holds until the page is closed */ }
        emit()
      }
      const unlink = async () => {
        state.confirmDisc = false
        const r = await postJson('/kybernos-cloud/telegram/unlink', { confirm: true })
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
        // A wake or a sleep takes a moment to show: one more read, and `settle` follows it from there.
        setTimeout(() => { if (live()) void load() }, 2500)
      }
      const openAccount = async (section) => {
        const r = await postJson('/kybernos-cloud/console/link', { section, open: true })
        if (r !== null && r.ok === true && r.opened !== true && typeof r.url === 'string') { try { window.open(r.url, '_blank', 'noopener,noreferrer') } catch (e) { /* popup refused */ } }
      }
      const upgrade = () => {
        try { if (window.__KB_UPGRADE__ && typeof window.__KB_UPGRADE__.open === 'function') { window.__KB_UPGRADE__.open(); return } } catch (e) { /* the dialog is not there */ }
        void openAccount('plan')
      }
      /** The strip is open only while there is something to DO in it (a code to scan); folded when connected or when this server has no bot. The person's choice wins. */
      const stripIsOpen = (pref, telegramState) => (pref === true || pref === false ? pref : telegramState === 'unlinked')
      const telegramStateOf = () => (state.view !== null && state.view.kind === 'ok' ? state.view.telegram.state : null)
      const toggleStrip = () => {
        state.stripPref = !stripIsOpen(state.stripPref, telegramStateOf())
        try { window.localStorage.setItem('kybernos-kyber.strip', state.stripPref ? '1' : '0') } catch (e) { /* no storage */ }
        emit()
      }

      /** Telegram's switch. On asks for a code, now and not when the strip opens; off cancels a code in flight or, for a connected chat, asks to disconnect. */
      const telegramSwitch = () => {
        const tg = telegramStateOf()
        if (tg === 'linked') { state.confirmDisc = true; emit(); return }
        if (tg !== 'unlinked') return
        if (state.starting) return
        if (pairLive()) { void pairCancel(); return }
        void pairStart()
      }

      // ═══ the views ═══════════════════════════════════════════════════════════════════════════════════════════════
      const PATHS = {
        kyby: ['m10.586 5.414-5.172 5.172', 'm18.586 13.414-5.172 5.172', 'M6 12h12', 'M10 20a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z', 'M10 4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z', 'M18 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z', 'M2 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0z'],
        cloud: ['M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z'],
        monitor: ['M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M8 21h8', 'M12 17v4'],
        phone: ['M5 4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z', 'M12 18h.01'],
        shield: ['M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z', 'm9 12 2 2 4-4'],
        chev: ['m6 9 6 6 6-6'],
        link: ['M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71', 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'],
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

      const HOME_NAME = 'Home'
      /** The « ? How it works » pill every page of the Suite carries (the card is this bundle's help.json); nothing where the Suite does not offer it. */
      const helpPill = () => {
        try {
          const pill = typeof window !== 'undefined' && window.__KB_HELP__ && window.__KB_HELP__.Help ? h(window.__KB_HELP__.Help, { id: 'kybernos-kyber' }) : null
          return pill === null ? null : h('span', { className: 'kbky-pillwrap', onClickCapture: placeHelp }, pill)
        } catch (e) { return null }
      }
      /** The strip sits at the foot of a chat or in the middle of an empty one: the card hangs on the side that has the room, and is no taller than it. */
      const placeHelp = (e) => {
        try {
          const box = e.currentTarget
          const r = box.getBoundingClientRect()
          const above = r.top
          const below = window.innerHeight - r.bottom
          const down = above < 380 && below > above
          box.setAttribute('data-dir', down ? 'down' : 'up')
          box.style.setProperty('--kbky-pop-h', Math.max(160, Math.floor((down ? below : above) - 24)) + 'px')
        } catch (err) { /* the card keeps its default place */ }
      }
      /** A switch: a button with a role, a state and a name, so that a keyboard and a screen reader reach it like a checkbox. */
      const Switch = (props) => h('button', { type: 'button', role: 'switch', 'aria-checked': String(props.on === true), 'aria-label': props.label, className: 'kbky-sw' + (props.on ? ' on' : ''), disabled: props.disabled === true, 'data-kb': props.kb, onClick: props.onClick }, h('span', { className: 'kbky-swk' }))
      const Mark = (props) => h('span', { className: 'kbky-mark' }, props.children)
      /** One channel, one row: its mark, its name and where it stands, and what the person can do. */
      const ChanRow = (props) => h('div', { className: 'kbky-crow', 'data-kb': props.kb, 'data-state': props.stateKey },
        h(Mark, null, props.mark), h('div', { className: 'kbky-ta' }, h('b', null, props.name), h('span', { className: props.warn ? 'warn' : '' }, props.sub)), h('div', { className: 'kbky-ra' }, props.right))

      /** What Telegram's row says of itself: the connection, or the pairing in flight. */
      const telegramRow = (v) => {
        const tg = v.telegram
        if (tg.state === 'off') return { sub: v.serverId === '' ? L('ofSub') : L('ofSubS', { server: v.serverId }), key: 'off' }
        if (tg.state === 'linked') return { sub: tg.paused ? L('paused') : tg.blocked ? L('blocked') : tg.name, warn: tg.paused || tg.blocked, key: 'linked' }
        if (state.starting) return { sub: L('preparing'), key: 'starting' }
        const face = pairingFace(state.pairing, Date.now())
        if (face.kind === 'waiting') return { sub: L('tgCode'), key: 'waiting' }
        if (face.kind === 'scanned') return { sub: L('tgWait2'), key: 'scanned' }
        if (face.kind === 'expired') return { sub: L('tgExp'), key: 'expired' }
        if (face.kind === 'declined') return { sub: L(face.reason === 'taken' ? 'tgTak' : face.reason === 'botmade' ? 'tgBot' : 'tgDec'), key: 'declined' }
        if (face.kind === 'error') return face.code === 'not_found' ? { sub: L('ofSub'), key: 'off' } : { sub: L('pe'), key: 'error' }
        return { sub: L('tgNone'), key: 'idle' }
      }

      /** The first tile: the channels {NAME} answers from. Telegram can be turned on; WhatsApp and WeChat are marked « soon » and offer nothing. */
      const ChannelsTile = (props) => {
        const v = props.view
        const tg = v.telegram
        const row = telegramRow(v)
        const on = tg.state === 'linked' || state.starting || pairLive()
        const bot = tg.state === 'linked' && typeof tg.botUrl === 'string' && tg.botUrl !== ''
          ? h('a', { className: 'kbky-iconlink', href: tg.botUrl, target: '_blank', rel: 'noopener noreferrer', 'data-kb': 'kybernos-kyber-bot', 'aria-label': L('openBot') }, Ic('ext', 15)) : null
        const soon = (id, name) => h(ChanRow, { key: id, kb: 'kybernos-kyber-chan-' + id, stateKey: 'soon', mark: BRAND[id](20), name, sub: L('soon'), right: h('span', { className: 'kbky-chip' }, L('soon')) })
        return h('div', { className: 'kbky-tile', 'data-kb': 'kybernos-kyber-tile-channels' },
          h('div', { className: 'kbky-th' }, h(Mark, null, Ic('link', 18)), h('b', null, L('channels'))),
          h('p', { className: 'kbky-help', 'data-kb': 'kybernos-kyber-channels-help' }, L('channelsHelp')),
          h('div', { className: 'kbky-chlist' },
            h(ChanRow, { kb: 'kybernos-kyber-tg-row', stateKey: row.key, mark: BRAND.telegram(20), name: L('telegram'), sub: row.sub, warn: row.warn === true,
              right: h(React.Fragment, null, bot, h(Switch, { on, disabled: tg.state === 'off', label: L('telegram'), kb: 'kybernos-kyber-tg-switch', onClick: telegramSwitch })) }),
            soon('whatsapp', 'WhatsApp'), soon('wechat', 'WeChat')))
      }

      /** The computer's state as a chip: awake, asleep, being set up, on request. */
      const computerChip = (hm, kb) => {
        if (hm === null) return h('span', { className: 'kbky-chip', 'data-kb': kb }, L('onRequest'))
        const st = hm.state
        const cls = st === 'running' ? ' ok' : TRANSIENT.indexOf(st) >= 0 ? ' warn' : st === 'failed' ? ' err' : ''
        return h('span', { className: 'kbky-chip' + cls, 'data-kb': kb }, S['st_' + st] !== undefined ? L('st_' + st) : L('st_other', { state: st }))
      }

      /** The second tile: the computer {NAME} works on, as a select. « This computer » is always there (it needs no account and no server); next to it the
       *  cloud computers of the account, with the state of the chosen one and the one thing the plan lets the person do. The choice is remembered. */
      const ComputerTile = (props) => {
        const v = props.view
        const signed = v.kind === 'ok'
        const hm = signed ? v.home : null
        const local = whereOf(state.where, v) === 'local'
        const free = !local && hm !== null && hm.manualControl === false
        const st = hm === null ? '' : hm.state
        const busy = state.busy !== ''
        const name = hm !== null && hm.name !== '' ? hm.name : HOME_NAME
        // The cloud computers of the account (the one linked to {NAME} is `home`); with none yet, one entry stands for the Home made at the first request.
        const cloud = signed ? v.computers.slice() : []
        if (hm !== null && hm.id !== '' && !cloud.some((c) => c.id === hm.id)) cloud.push({ id: hm.id, name })
        const clouds = !signed ? [] : (cloud.length > 0 ? cloud : [{ id: 'cloud', name }])
        const options = [h('option', { key: 'local', value: 'local' }, L('thisComputer'))].concat(clouds.map((c) => h('option', { key: c.id, value: c.id }, L('cloudName', { name: c.name }))))
        const picked = local ? 'local' : (hm !== null && clouds.some((c) => c.id === hm.id) ? hm.id : clouds[0].id)
        const onPick = (e) => {
          const val = e.target.value
          if (val === 'local') { setWhere('local'); return }
          setWhere('cloud')
          if (val !== 'cloud') void setComputer(val)
        }
        const field = h('label', { className: 'kbky-field', 'data-kb': 'kybernos-kyber-field' }, h(Mark, null, Ic(local ? 'monitor' : 'cloud', 18)),
          h('select', { className: 'kbky-fsel', 'aria-label': L('pickLead'), 'data-kb': 'kybernos-kyber-pick', value: picked, disabled: options.length < 2, onChange: onPick }, options),
          local ? h('span', { className: 'kbky-chip ok', 'data-kb': 'kybernos-kyber-computer-state' }, L('ready')) : computerChip(hm, 'kybernos-kyber-computer-state'))
        const line = local ? h('p', { className: 'kbky-line', 'data-kb': 'kybernos-kyber-local-line' }, L('txt_local'))
          : hm === null ? h('p', { className: 'kbky-line' }, L('noHome'))
            : st === 'creating' ? h('div', { className: 'kbky-row' }, h('span', { className: 'kbky-spin', 'aria-hidden': 'true' }), h('span', { className: 'kbky-line' }, L('txt_creating')))
              : h('p', { className: 'kbky-line' }, S['txt_' + st] !== undefined ? L('txt_' + st) : L('st_other', { state: st }))
        const acts = local || hm === null || free ? null : h('div', { className: 'kbky-actions' },
          st === 'suspended' ? h(Btn, { kb: 'kybernos-kyber-wake', disabled: busy, onClick: () => { void computerAction('resume') } }, L('wake')) : null,
          st === 'running' ? h(Btn, { kb: 'kybernos-kyber-sleep', disabled: busy, onClick: () => { void computerAction('suspend') } }, L('sleep')) : null,
          st === 'running' ? h(Btn, { kb: 'kybernos-kyber-pcopen', disabled: busy, onClick: () => { void computerAction('open') } }, Ic('ext', 14), L('openPc')) : null)
        return h('div', { className: 'kbky-tile', 'data-kb': 'kybernos-kyber-computer' },
          h('div', { className: 'kbky-th' }, h(Mark, null, Ic('monitor', 18)), h('b', null, L('computer'))),
          h('p', { className: 'kbky-help', 'data-kb': 'kybernos-kyber-computer-help' }, L('computerHelp')),
          h('div', { className: 'kbky-tb' },
            field, line,
            !local && hm !== null && hm.paused !== '' ? h('p', { className: 'kbky-warn' }, L(hm.paused === 'hours' ? 'pr_hours' : 'pr_other')) : null,
            state.computerError !== '' ? h('p', { className: 'kbky-err', role: 'alert', 'data-kb': 'kybernos-kyber-computer-error' }, L(state.computerError)) : null,
            free ? h('p', { className: 'kbky-cap', 'data-kb': 'kybernos-kyber-upsell' }, L('upsell')) : null),
          acts !== null || free
            ? h('div', { className: 'kbky-tf' }, acts, free ? h(Btn, { kb: 'kybernos-kyber-upgrade', onClick: upgrade }, Ic('star', 14), L('upgrade')) : null)
            : null)
      }

      /** Under the two tiles, only while there is something to do about Telegram: the code to scan, what happened to it, or the question before disconnecting. */
      const TelegramPanel = (props) => {
        useTick(1000)
        const v = props.view
        const tg = v.telegram
        const panel = (kind, ...kids) => h('section', { className: 'kbky-panel', 'data-kb': 'kybernos-kyber-telegram', 'data-state': kind }, ...kids)
        const note = (kind, hKey, pText, retry) => panel(kind,
          h('div', { className: 'kbky-pcol' }, h('h3', null, L(hKey)), h('p', { className: 'kbky-sub left' }, pText),
            retry ? h('div', { className: 'kbky-actions' }, h(Btn, { primary: true, kb: 'kybernos-kyber-retry', onClick: () => { void pairStart() } }, L('newCode'))) : null))
        if (tg.state === 'off') return null
        if (tg.state === 'linked') {
          if (!state.confirmDisc) return null
          return panel('disconnect', h('div', { className: 'kbky-pcol' }, h('h3', null, L('discQ')),
            h('div', { className: 'kbky-actions' },
              h(Btn, { danger: true, kb: 'kybernos-kyber-unlink-yes', onClick: () => { void unlink() } }, L('confirm')),
              h(Btn, { kb: 'kybernos-kyber-unlink-no', onClick: () => { state.confirmDisc = false; emit() } }, L('cancel')))))
        }
        if (state.starting) return panel('starting', h('div', { className: 'kbky-row' }, h('span', { className: 'kbky-spin', 'aria-hidden': 'true' }), h('span', { className: 'kbky-sub left' }, L('preparing'))))
        const face = pairingFace(state.pairing, Date.now())
        if (face.kind === 'none' || face.kind === 'done') return null
        if (face.kind === 'expired') return note('expired', 'exH', L('exP'), true)
        if (face.kind === 'declined') {
          if (face.reason === 'taken') return note('taken', 'taH', L('taP'), true)
          if (face.reason === 'botmade') return note('botmade', 'bmH', L('bmP'), false)
          return note('declined', 'deH', L('deP'), true)
        }
        if (face.kind === 'error') {
          if (face.code === 'not_found') return note('off', 'ofH', L('ofP'), false)
          return panel('error', h('div', { className: 'kbky-pcol' }, h('h3', null, L('cH')), h('p', { className: 'kbky-sub left' }, L(face.code === 'rate_limited' ? 'peRate' : 'pe')),
            h('div', { className: 'kbky-actions' }, h(Btn, { primary: true, kb: 'kybernos-kyber-retry', onClick: () => { void pairStart() } }, L('retry')))))
        }
        const p = state.pairing
        const scanned = face.kind === 'scanned'
        const cancel = () => { void pairCancel() }
        const tokenOf = /pair_([A-Za-z0-9]+)$/u.exec(typeof p.link === 'string' ? p.link : '')
        const typed = tokenOf === null || typeof p.bot !== 'string' || p.bot === '' ? '' : '/start pair_' + tokenOf[1]
        const copyCode = () => {
          try { void navigator.clipboard.writeText(typed).then(() => { state.copied = true; emit(); setTimeout(() => { state.copied = false; emit() }, 1800) }).catch(() => { /* refused: it is on the screen */ }) } catch (e) { /* no clipboard */ }
        }
        return panel(scanned ? 'scanned' : 'waiting',
          h('div', { className: 'kbky-pbody' },
            scanned ? null : h('div', { className: 'kbky-pqr' }, h(Qr, { qr: p.qr })),
            h('div', { className: 'kbky-pcol' },
              h('h3', null, L(scanned ? 'scH' : 'cH')),
              scanned
                ? h(React.Fragment, null, h('p', { className: 'kbky-sub left' }, L('scP', { who: face.sender === '' ? '…' : face.sender })),
                  h('div', { className: 'kbky-row' }, h('span', { className: 'kbky-spin', 'aria-hidden': 'true' }), h('span', { className: 'kbky-sub left' }, L('scWait'))))
                : h('ol', { className: 'kbky-steps' }, h('li', null, L('s1')), h('li', null, L('s2')), h('li', null, L('s3'))),
              h('div', { className: 'kbky-actions' },
                h(Btn, { primary: !scanned, href: p.link, kb: 'kybernos-kyber-open' }, BRAND.telegram(18), L('openTg')),
                h('span', { className: 'kbky-sub left', 'data-kb': 'kybernos-kyber-left' }, L('expiresIn', { t: clock(face.left) })),
                h('button', { type: 'button', className: 'kbky-link', 'data-kb': 'kybernos-kyber-cancel', onClick: cancel }, L(scanned ? 'notMe' : 'cancel'))),
              !scanned && typed !== '' ? h('button', { type: 'button', className: 'kbky-link', 'data-kb': 'kybernos-kyber-code', 'aria-expanded': String(state.showCode), onClick: () => { state.showCode = !state.showCode; emit() } }, L('noCam')) : null,
              // The same single-use token, written by hand: the person opens the bot in Telegram (any device, any app) and writes it. Nothing leaves DSH.
              !scanned && typed !== '' && state.showCode
                ? h('div', { className: 'kbky-codebox', 'data-kb': 'kybernos-kyber-code-box' },
                  h('span', { className: 'kbky-sub left' }, L('codeIntro', { bot: '@' + p.bot })),
                  h('div', { className: 'kbky-row' },
                    h('code', { className: 'kbky-cmd', 'data-kb': 'kybernos-kyber-code-text' }, typed),
                    h(Btn, { kb: 'kybernos-kyber-code-copy', onClick: copyCode }, L(state.copied ? 'codeCopied' : 'codeCopy'))))
                : null)))
      }

      /** Two equal tiles, the channels and the computer, and under them the one thing Telegram may need. With no account or no readable server only the computer
       *  is offered, and only « this computer »: that choice needs neither. */
      const Channels = (props) => {
        const v = state.view
        if (v === null) return h('p', { className: 'kbky-note' }, L('loading'))
        const intro = props.intro === true ? h('p', { className: 'kbky-intro', 'data-kb': 'kybernos-kyber-intro' }, L('intro')) : null
        if (v.kind !== 'ok') return h('div', { className: 'kbky-calm', 'data-kb': 'kybernos-kyber-channels' }, intro, h('p', { className: 'kbky-note' }, L(v.kind)), h('div', { className: 'kbky-tiles' }, h(ComputerTile, { view: v })))
        return h('div', { className: 'kbky-calm', 'data-kb': 'kybernos-kyber-channels' },
          intro,
          h('div', { className: 'kbky-tiles' }, h(ChannelsTile, { view: v }), h(ComputerTile, { view: v })),
          h(TelegramPanel, { view: v }),
          props.manage === true && v.accountUrl !== '' ? h('div', { className: 'kbky-actions' }, h('button', { type: 'button', className: 'kbky-link', 'data-kb': 'kybernos-kyber-account', onClick: () => { void openAccount('account') } }, L('manage'))) : null)
      }

      // ═══ Kaby's own chat is a native DSH conversation: its session, and how to reach it ═══════════════════════════
      // `sessions` makes a chat (it answers the new session's id); `uiWorkspace` is DSH's own shell: it opens a chat and pins it.
      // Asked for at the moment of use: a re-applied plugin keeps working with whatever the shell offers then.
      const svc = (name) => { try { return CTX !== null ? CTX.get(name) : null } catch (e) { return null } }
      // Another bundle draws things in the same chat (the new-chat cards): it cannot subscribe to this store, and it renders before the pointer
      // is read on a page load, so it is told, by a window event, the moment the chat that is Kaby's becomes known.
      const announceSession = () => { try { window.dispatchEvent(new CustomEvent('kb-kyby-session', { detail: { sessionId: state.kybySid } })) } catch (e) { /* no window */ } }
      const readSessionPointer = async () => {
        const r = await readJson('/kybernos-cloud/kyby/native')
        const was = state.kybySid
        state.kybySid = r !== null && r.ok === true && typeof r.sessionId === 'string' ? r.sessionId : null
        state.kybyCwd = r !== null && r.ok === true && typeof r.cwd === 'string' && r.cwd !== '' ? r.cwd : null
        emit()
        if (state.kybySid !== was) announceSession()
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
      /** Opens Kaby's conversation, making it the first time (a blank DSH chat, remembered by the host, which gives it Kaby's identity). */
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
            // In Kaby's own folder, as a workspace of its own and already chosen: DSH's « New chat » reuses a blank chat of the workspace it is
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
            announceSession()
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

      /** The collapsible strip: {NAME}'s name, and under it the two tiles. Open only when there is something to turn on; folded, two chips say how things stand. */
      const Strip = () => {
        const v = state.view
        const open = stripIsOpen(state.stripPref, telegramStateOf())
        const chip = statusOf(v)
        const hm = v !== null && v.kind === 'ok' ? v.home : null
        const local = whereOf(state.where, v) === 'local'
        const chips = !open && v !== null && v.kind === 'ok'
          ? h('span', { className: 'kbky-stripc' },
            h('span', { className: 'kbky-chip ' + chip[0], 'data-kb': 'kybernos-kyber-status' }, BRAND.telegram(14), L(chip[1])),
            local
              ? h('span', { className: 'kbky-chip ok', 'data-kb': 'kybernos-kyber-computer-chip' }, Ic('monitor', 13), L('thisComputer') + ' · ' + L('ready'))
              : h('span', { className: 'kbky-chip' + (hm !== null && hm.state === 'running' ? ' ok' : ''), 'data-kb': 'kybernos-kyber-computer-chip' }, Ic('cloud', 13),
                (hm !== null && hm.name !== '' ? hm.name : HOME_NAME) + ' · ' + (hm === null ? L('onRequest') : (S['st_' + hm.state] !== undefined ? L('st_' + hm.state) : hm.state))))
          : null
        // The « ? How it works » pill sits beside the fold button, not in it (a button cannot hold a button).
        return h('div', { className: 'kbky-strip' + (open ? ' open' : ''), 'data-kb': 'kybernos-kyber-strip' },
          h('div', { className: 'kbky-striphr' },
            h('button', { type: 'button', className: 'kbky-striph', 'aria-expanded': String(open), 'data-kb': 'kybernos-kyber-strip-toggle', onClick: toggleStrip },
              h('span', { className: 'kbky-car' }, Ic('chev', 14)), h('b', null, L('title')), chips),
            helpPill()),
          open ? h('div', { className: 'kbky-stripb' }, h(Channels, { visible: true, intro: true })) : null)
      }

      /** The strip, above the composer of Kaby's own conversation and of no other. */
      const KybyDock = (props) => {
        useStore()
        const sid = props !== null && props !== undefined && typeof props.sessionId === 'string' ? props.sessionId : ''
        if (sid === '' || state.kybySid !== sid) return null
        return h('div', { className: 'kbky-dock', 'data-kb': 'kybernos-kyber-dock' }, h(Strip))
      }

      /** The page the menu row used to open, and the new-chat card still opens: what Kaby is, the way into its conversation, the strip. */
      const Page = () => {
        useStore()
        const v = state.view
        const three = h('div', { className: 'kbky-three' },
          [['phone', 'b1h', 'b1p'], ['cloud', 'b2h', 'b2p'], ['shield', 'b3h', 'b3p']].map((b) => h('div', { key: b[0] }, Ic(b[0], 20), h('b', null, L(b[1])), h('span', null, L(b[2])))))
        const chip = statusOf(v)
        return h('div', { className: 'kbky-page', 'data-kb': 'kybernos-kyber-page' },
          h('div', { className: 'kbky-hero' },
            h('div', { className: 'kbky-herot' }, h('span', { className: 'kbky-glyph' }, Ic('kyby', 22)), h('div', { className: 'kbky-row wrap' }, h('b', { className: 'kbky-name' }, L('title')), h('span', { className: 'kbky-chip ' + chip[0] }, L(chip[1])))),
            h('h1', null, L('heroH')), h('p', { className: 'kbky-lead' }, L('intro')),
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
        return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, h(Channels, { visible: true, manage: true }))
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
        '.kbky-three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:10px}',
        '.kbky-three>div{padding:12px 14px;border-radius:12px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08));display:flex;flex-direction:column;gap:6px}',
        '.kbky-three span{color:var(--dsw-alias-label-secondary,#666);font-size:13px}',
        '.kbky-chip{display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:99px;font-size:12px;white-space:nowrap;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-chip.ok{border-color:transparent;background:var(--dsw-alias-state-success-bg,rgba(34,197,94,.16));color:var(--dsw-alias-state-success-primary,#15803d)}',
        '.kbky-chip.warn{border-color:transparent;background:var(--dsw-alias-state-warn-bg,rgba(245,158,11,.18));color:var(--dsw-alias-state-warn-label,#a8530a)}',
        // the strip also sits in the chat's dock, which has no `.kbky` ancestor: it sets its own size and colour, like the page and the pane do
        '.kbky-strip{border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:28px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13.5px);line-height:1.5}',
        '.kbky-striphr{display:flex;align-items:center;gap:8px;padding-block:3px;padding-inline-end:10px}',
        '.kbky-striph{flex:1;min-width:0;display:flex;gap:10px;align-items:center;padding:9px 14px;border:0;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left;flex-wrap:wrap}',
        // the help card opens upwards by default (the strip is above the composer, at the foot of a chat), downwards when there is no room above (placeHelp)
        '.kbky-strip .kbky-pillwrap [data-kb="help-panel"]{top:auto;bottom:calc(100% + 8px);max-height:min(70vh,560px,var(--kbky-pop-h,70vh))}',
        '.kbky-strip .kbky-pillwrap[data-dir="down"] [data-kb="help-panel"]{top:calc(100% + 8px);bottom:auto}',
        // a phone: the pill is mid-row, so no side of it holds the card; it becomes a sheet at the foot of the screen
        '@media (max-width:520px){.kbky-strip .kbky-pillwrap [data-kb="help-panel"],.kbky-strip .kbky-pillwrap[data-dir] [data-kb="help-panel"]{position:fixed;inset-inline:16px;width:auto;top:auto;bottom:16px;max-height:min(70vh,560px)}}',
        '.kbky-intro{margin:0 0 12px;max-width:68ch;color:var(--dsw-alias-label-secondary,#666);line-height:1.5}',
        '.kbky-help{margin:-4px 0 0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-car{display:inline-flex;transform:rotate(-90deg);transition:transform .15s;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-strip.open .kbky-car{transform:rotate(0)}',
        '.kbky-stripc{display:flex;gap:6px;flex-wrap:wrap}',
        '.kbky-stripb{padding:4px 14px 14px}',
        '.kbky-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px;counter-reset:s}',
        '.kbky-steps li{display:flex;gap:10px;counter-increment:s}',
        '.kbky-steps li::before{content:counter(s);flex:none;width:22px;height:22px;border-radius:99px;display:grid;place-items:center;font-size:12px;font-weight:650;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3))}',
        '.kbky-qr{width:196px;height:196px;border-radius:12px;overflow:hidden;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3))}',
        '.kbky-qr svg{display:block;width:100%;height:100%}.kbky-qr.dim svg{opacity:.18}',
        '.kbky-spin{width:22px;height:22px;border-radius:99px;border:3px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));border-top-color:var(--dsw-alias-label-primary,#222);animation:kbky-sp 1s linear infinite}',
        '@keyframes kbky-sp{to{transform:rotate(360deg)}}',
        '@media (prefers-reduced-motion: reduce){.kbky-spin{animation:none}}',
        '.kbky-line{margin:0;color:var(--dsw-alias-label-secondary,#666)}',
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
        '.kbky-btn:focus-visible,.kbky-link:focus-visible,.kbky-striph:focus-visible,.kbky-sw:focus-visible,.kbky-fsel:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:2px}',
        '.kbky-link{border:0;background:none;padding:0;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary,#666);text-decoration:underline;cursor:pointer;text-align:left}',
        // In the chat's dock the strip lines up with the composer's card (the dock is 16 px wider on each side, measured) and takes its radius (28 px):
        // the tiles inside have the radius that nests in it (28 minus the 12 px of padding).
        '.kbky-dock{margin:0 0 8px;padding:0 16px}',
        '.kbky-calm{display:flex;flex-direction:column;gap:12px}',
        '.kbky-chip.err{border-color:transparent;background:var(--dsw-alias-state-error-bg,rgba(236,19,19,.12));color:var(--dsw-alias-state-error-primary,#b91c1c)}',
        // the two tiles: one grid, one padding, one radius, one anatomy (mark and name on top, the body, one action at the bottom)
        '.kbky-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}',
        '.kbky-tile{display:flex;flex-direction:column;gap:10px;min-width:0;padding:14px;border-radius:16px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
        '.kbky-th{display:flex;align-items:center;gap:10px;min-height:32px}.kbky-th b{font-size:14px;font-weight:600}',
        '.kbky-mark{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;flex:none;background:var(--dsw-alias-bg-base,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
        '.kbky-chlist{display:flex;flex-direction:column}',
        '.kbky-crow{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:12px;align-items:center;min-height:50px}',
        '.kbky-crow+.kbky-crow{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
        '.kbky-ta{display:flex;flex-direction:column;min-width:0}.kbky-ta b{font-size:14px;font-weight:600}',
        '.kbky-ta span{font-size:12.5px;color:var(--dsw-alias-label-secondary,#666)}.kbky-ta span.warn{color:var(--dsw-alias-state-warn-label,#a8530a)}',
        '.kbky-ra{display:flex;gap:8px;align-items:center}',
        '.kbky-iconlink{display:inline-flex;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-sw{position:relative;width:40px;height:24px;flex:none;padding:0;border:0;border-radius:99px;cursor:pointer;background:var(--dsw-alias-border-l2,rgba(127,127,127,.45))}',
        '.kbky-sw.on{background:var(--dsw-alias-state-success-primary,#22a559)}',
        '.kbky-swk{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:99px;background:var(--dsw-alias-label-secondary,#61666b);transition:transform .15s}',
        '.kbky-sw.on .kbky-swk{transform:translateX(16px);background:var(--dsw-alias-label-primary-foreground,#fff)}',
        '.kbky-sw[disabled]{opacity:.45;cursor:default}',
        '@media (prefers-reduced-motion: reduce){.kbky-swk{transition:none}}',
        '.kbky-tb{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}',
        '.kbky-tf{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:auto}',
        '.kbky-field{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:10px;align-items:center;min-height:56px;padding:8px 12px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:var(--dsw-alias-bg-base,transparent)}',
        '.kbky-fsel{font:inherit;font-size:14px;font-weight:600;color:inherit;background:transparent;border:0;min-width:0;width:100%;padding:0;cursor:pointer;text-overflow:ellipsis}',
        '.kbky-cap{margin:0;font-size:12.5px;color:var(--dsw-alias-label-secondary,#666)}',
        // the panel under the tiles: the code to scan, what happened to it, or the question before disconnecting
        '.kbky-panel{padding:14px;border-radius:16px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3))}',
        '.kbky-pbody{display:flex;gap:16px;align-items:flex-start}',
        '.kbky-pqr .kbky-qr{width:132px;height:132px}',
        '.kbky-pcol{display:flex;flex-direction:column;gap:10px;min-width:0;flex:1}.kbky-pcol h3{margin:0;font-size:14px;font-weight:650}',
        '.kbky-codebox{display:flex;flex-direction:column;gap:6px}',
        '.kbky-cmd{flex:1;min-width:0;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));background:var(--dsw-alias-bg-base,rgba(127,127,127,.08));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;overflow-wrap:anywhere;user-select:all}',
        // narrow: one column, and no QR (nobody scans their own screen: the button is the way)
        '@media (max-width:760px){.kbky-three{grid-template-columns:minmax(0,1fr)}.kbky-pqr{display:none}.kbky-page{padding:14px 12px}}',
        '.kbky .kbky-pbody{flex-direction:column}',
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
        __test: { S, L, kt, derive, pairingFace, clock, stripIsOpen, whereOf, CSS, TYPE_ID, KIND, state, BRAND, NAME, views: { Strip, Channels, ChannelsTile, ComputerTile, TelegramPanel, KybyDock, Page }, actions: { load, pairStart, pairCancel, unlink, setComputer, setWhere, computerAction, telegramSwitch, toggleStrip, telegramRow, settle, readSessionPointer }, listeners },
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
          // Kaby's own conversation is a native DSH chat: the strip sits in the dock above its composer, and above no other's.
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
              /** Opens Kaby's native conversation (the sidebar row calls this). False when it could not be opened. */
              openChat () { return openChat() },
              /** Whether `sid` is Kaby's own chat (the new-chat cards stay out of it). */
              isKybySession (sid) { return typeof sid === 'string' && sid !== '' && sid === state.kybySid },
              /** Reads the state again (live checks drive the page's answers; a person has the refresh button of the tab). */
              refresh () { return load() },
              /** Forgets the person's choice about the strip, in memory and on disk (the live check starts each part from the rule). */
              resetStrip () { state.stripPref = null; try { window.localStorage.removeItem('kybernos-kyber.strip') } catch (e) { /* no storage */ } emit() },
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
