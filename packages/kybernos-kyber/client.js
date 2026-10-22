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
        customise: ['Personnaliser {name}', 'Customise {name}'],
        tabHint: ['Ton assistant : la conversation, Telegram et l’ordinateur sur lequel il travaille.', 'Your assistant: the conversation, Telegram and the computer it works on.'],
        // header and intro
       
        heroH: ['Ton assistant, dans ta poche.', 'Your assistant, in your pocket.'],
        // What {NAME} is, in one picture (the owner's): a phone with a remote control, working on the desktop. Said on the page, above the tiles of the strip, and by the help card.
        intro: ['{NAME}, c’est comme un téléphone avec télécommande : tu lui parles d’ici ou depuis Telegram, et il travaille sur ton ordinateur. Un ordinateur dans le cloud peut prendre le relais quand le tien est éteint. Avant de modifier quoi que ce soit, il te demande.', '{NAME} is like a phone with a remote control: you talk to it from here or from Telegram, and it works on your desktop. A cloud computer can take over when yours is off. Before it changes anything, it asks you.'],
        b1h: ['Demande de n’importe où', 'Ask from anywhere'], b1p: ['Ici, ou depuis ton téléphone sur Telegram. C’est la même conversation.', 'Here, or from your phone on Telegram. It is the same conversation.'],
        b2h: ['Il travaille pendant ton absence', 'It keeps working while you are away'], b2p: ['Il a son propre ordinateur, qui se réveille quand il a du travail.', 'It has its own computer, which wakes up when it has work to do.'],
        b3h: ['Tu gardes la main', 'You stay in control'], b3p: ['Avant d’agir, il demande : Autoriser, Refuser ou Autoriser pour cette tâche.', 'Before it acts, it asks: Allow, Refuse, or Allow for this task.'],
        stOn: ['Telegram connecté', 'Telegram connected'], stOff: ['Telegram non connecté', 'Telegram not connected'], stWait: ['Telegram en attente', 'Telegram waiting'], stNone: ['Telegram indisponible', 'Telegram unavailable'],
        // the strip: ONE line, three states (the remote control, Telegram, the computer) and the way to the screen that sets them up
        setUp: ['Régler…', 'Set up…'], soon: ['Bientôt', 'Soon'], notYet: ['Pas encore disponible', 'Not available yet'],
        remote: ['Contrôle à distance', 'Remote control'],
        rmChipReady: ['Contrôle à distance · prêt', 'Remote control · ready'], rmChip1: ['Contrôle à distance · 1 téléphone', 'Remote control · 1 phone'], rmChipN: ['Contrôle à distance · {n} téléphones', 'Remote control · {n} phones'],
        rmChipOff: ['Contrôle à distance · désactivé', 'Remote control · off'], rmChipNone: ['Contrôle à distance · pas encore proposé', 'Remote control · not offered yet'],
        rmSubReady: ['Actif, prêt à relier un téléphone · aucun téléphone relié', 'On, ready to pair · no phone linked'], rmSub1: ['Actif · 1 téléphone relié', 'On · 1 phone linked'], rmSubN: ['Actif · {n} téléphones reliés', 'On · {n} phones linked'],
        rmSubOff: ['Désactivé', 'Off'], rmSubNone: ['Pas encore proposé par ce serveur', 'Not offered by this server yet'],
        connect: ['Connecter', 'Connect'], manageRow: ['Gérer', 'Manage'],
        // Telegram's chip on the strip: short, like the other two (the page's own chip keeps the long words, `st*`)
        tgcOn: ['Telegram · actif', 'Telegram · on'], tgcOff: ['Telegram · inactif', 'Telegram · off'], tgcWait: ['Telegram · en attente', 'Telegram · waiting'], tgcNone: ['Telegram · indisponible', 'Telegram · unavailable'],
        // telegram
        telegram: ['Telegram', 'Telegram'],
        cH: ['Connecter Telegram', 'Connect Telegram'],
        s1: ['Scanne ce code avec l’appareil photo de ton téléphone. Sur le téléphone, touche « Ouvrir Telegram ».', 'Scan this code with your phone’s camera. On a phone, tap “Open Telegram”.'],
        s2: ['Dans Telegram, touche Démarrer (ou Redémarrer si tu as déjà utilisé ce bot).', 'In Telegram, tap Start (or Restart if you have used this bot before).'],
        s3: ['Touche « Oui, c’est moi ».', 'Tap “Yes, it’s me”.'],
        openTg: ['Ouvrir Telegram', 'Open Telegram'],
        // Nothing arrived after a while (measured on dev: on a bot the person already used, the link only opens the chat and the Start must be pressed): what to do, and the
        // message to send by hand, already shown. The app link opens Telegram itself on this computer, without the t.me page in between.
        openApp: ['Dans l’appli Telegram de cet ordinateur', 'In the Telegram app on this computer'],
        stuckH: ['Rien n’est arrivé ?', 'Nothing arrived?'],
        stuckP: ['Telegram a peut-être seulement ouvert la conversation avec {bot} : touche Démarrer (ou Redémarrer) en bas de l’écran. Sinon, envoie-lui ce message :', 'Telegram may only have opened the chat with {bot}: tap Start (or Restart) at the bottom of the screen. Otherwise send it this message:'],
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
        // The Telegram row says WHY it cannot be turned on, and what to do about it (a bot there, no bot on this server, a server too old for the pairing routes).
        offWhy: ['Ce serveur n’a pas de bot Telegram. Passe sur un serveur qui en a un, comme Kybernos Cloud.', 'This server has no Telegram bot. Switch to a server that has one, such as Kybernos Cloud.'],
        oldWhy: ['Ce serveur ne sait pas encore relier Telegram.', 'This server does not support linking Telegram yet.'],
        oldH: ['Ce serveur ne relie pas encore Telegram', 'This server cannot link Telegram yet'],
        switchServer: ['Changer de serveur', 'Switch server'],
        ofH: ['Telegram n’est pas activé sur ce serveur', 'Telegram is not turned on on this server'],
        ofP: ['Ce serveur n’a pas de bot Telegram : il en faut un pour connecter Telegram.', 'This server has no Telegram bot: one is needed to connect Telegram.'],
       
        pe: ['Impossible de préparer le code pour l’instant.', 'The code cannot be prepared right now.'],
        peRate: ['Trop d’essais : réessaie dans une minute.', 'Too many tries: try again in a minute.'],
        retry: ['Réessayer', 'Try again'],
        // The right-hand block of the « Phone and channels » screen (kybernos-mobile draws the screen, this bundle draws the block): {NAME}, with the messaging apps it answers from and
        // the computer it works on, each saying what it does and what it never does.
        kabyTag: ['Demande toujours d’abord', 'Always asks first'],
        kabyLead: ['Ton assistant. Il te répond sur les messageries et travaille sur un ordinateur.', 'Your assistant. It answers you on messaging apps and works on a computer.'],
        msgH: ['Messageries', 'Messaging apps'],
        doesK: ['Ce que ça fait', 'It does'], neverK: ['Jamais', 'Never'],
        msgDoes: ['{NAME} te répond là, même quand cet ordinateur est éteint. Les messageries reliées partagent une seule conversation et une seule mémoire.', '{NAME} answers you there, even when this computer is off. Linked apps share one conversation and one memory.'],
        msgNever: ['Une messagerie ne contrôle jamais cet ordinateur : {NAME} demande ton accord avant d’agir.', 'A messaging app never controls this computer: {NAME} asks for your OK before it acts.'],
        beta: ['Bêta', 'Beta'],
        // WhatsApp (ADR 0053 § 13.8, a beta bridge: one number that Kybernos owns). The row is « not available » until a server says it has the door (`whatsapp` in the host's answer,
        // like `telegram`), « unreachable » while the server has the door but no bridge is open, then the same pairing as Telegram's: a code to scan, the message already typed, a « 1 » to answer.
        waOff: ['Pas encore disponible sur ce serveur', 'Not available on this server yet'],
        waClosed: ['Le numéro WhatsApp de {NAME} n’est pas joignable pour l’instant.', '{NAME}’s WhatsApp number is not reachable right now.'],
        waS1: ['Scanne ce code avec l’appareil photo de ton téléphone. Sur le téléphone, touche « Ouvrir WhatsApp ».', 'Scan this code with your phone’s camera. On a phone, tap “Open WhatsApp”.'],
        waS2: ['Dans WhatsApp, envoie le message déjà écrit.', 'In WhatsApp, send the message that is already typed.'],
        waS3: ['Réponds 1 à la question de {NAME}.', 'Answer 1 to {NAME}’s question.'],
        openWa: ['Ouvrir WhatsApp', 'Open WhatsApp'],
        waWait2: ['En attente de ta réponse', 'Waiting for your answer'], waDec: ['Refusé dans WhatsApp', 'Refused in WhatsApp'],
        waScH: ['Presque fini : réponds dans WhatsApp', 'Almost done: answer in WhatsApp'],
        waScP: ['WhatsApp indique : {who}. Réponds 1 dans la conversation avec {NAME}.', 'WhatsApp says: {who}. Answer 1 in the chat with {NAME}.'],
        waScWait: ['En attente de ta réponse…', 'Waiting for your answer…'],
        waLinked: ['Connecté : {name}. {NAME} répond dans les 24 h qui suivent ton message.', 'Connected: {name}. {NAME} answers within 24 hours of your message.'],
        waPaused: ['En pause : écris resume à {NAME} dans WhatsApp pour reprendre.', 'Paused: write resume to {NAME} in WhatsApp to resume.'],
        waCH: ['Connecter WhatsApp', 'Connect WhatsApp'],
        waDiscQ: ['Déconnecter WhatsApp ?', 'Disconnect WhatsApp?'],
        waDeP: ['Tu as répondu 2 dans WhatsApp.', 'You answered 2 in WhatsApp.'],
        waTaH: ['Ce WhatsApp est déjà connecté à un autre compte', 'This WhatsApp is already connected to another account'],
        waTaP: ['Déconnecte-le d’abord dans l’autre compte (écris unlink à {NAME} dans WhatsApp), puis reviens ici.', 'Disconnect it from the other account first (write unlink to {NAME} in WhatsApp), then come back here.'],
        waOfH: ['WhatsApp n’est pas disponible ici', 'WhatsApp is not available here'],
        waDown: ['Le numéro WhatsApp n’est pas joignable pour l’instant : réessaie dans quelques minutes.', 'The WhatsApp number is not reachable right now: try again in a few minutes.'],
        waCodeIntro: ['Dans WhatsApp, écris au +{number} :', 'In WhatsApp, write to +{number}:'],
        imMac: ['Réservé aux Mac', 'Mac only'],
        // computer
        compH: ['Ordinateur de {NAME}', '{NAME}’s computer'], compLead: ['La machine sur laquelle {NAME} travaille.', 'The machine {NAME} works on.'],
        // « This computer » is the machine that runs Kybernos: a choice that needs no server and no account.
        thisComputer: ['Cet ordinateur', 'This computer'], ready: ['Prêt', 'Ready'], cloudName: ['{name} (cloud)', '{name} (cloud)'],
        txt_local: ['{NAME} travaille sur cet ordinateur quand tu lui écris ici. Garde Kybernos ouvert.', '{NAME} works on this computer when you write to it here. Keep Kybernos open.'],
        noHome: ['Créé à ta première demande qui en a besoin.', 'Made at your first request that needs one.'],
        onRequest: ['À la demande', 'On request'],
        pickLead: ['Ordinateur lié à {NAME}', 'Computer linked to {NAME}'],
        err_computer: ['Le choix n’a pas pu être enregistré.', 'The choice could not be saved.'],
        err_computer_old: ['Ce serveur ne sait pas encore enregistrer ce choix.', 'This server cannot save this choice yet.'],
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
        // Three states of the door: a bot there (offered), no bot on this server (« off »), or a server too old for the pairing routes (« old »: the host saw a 404 on
        // them). No bot is the answer that tells where to go, so it wins when both are true. A host that does not say claims nothing (the door is read as before).
        const noBot = t !== null && !(t.configured === true && t.enabled === true)
        const tooOld = k.pairing === 'unsupported'
        let telegram = { state: noBot || !tooOld ? 'off' : 'old' }
        if (!noBot && !tooOld && t !== null && t.configured === true && t.enabled === true) {
          const linked = asObj(t.linked)
          const bot = typeof t.bot === 'string' && /^[A-Za-z0-9_]{3,64}$/.test(t.bot) ? t.bot : ''
          telegram = linked === null
            ? { state: 'unlinked', botUrl: bot === '' ? '' : 'https://t.me/' + bot }
            : { state: 'linked', name: String(linked.display || ''), since: String(linked.linked_at || ''), paused: linked.paused === true, blocked: linked.blocked === true, botUrl: bot === '' ? '' : 'https://t.me/' + bot }
        }
        // WhatsApp: `off` unless the host forwards a `whatsapp` object the way it forwards `telegram` (a server without the door says nothing of it); with the door, `closed` while
        // no bridge is open (nothing can be paired or answered), `unlinked` when a code can be asked for, `linked` once the person's number is connected.
        const wa = asObj(k.whatsapp)
        let whatsapp = { state: 'off' }
        if (wa !== null && wa.configured === true && wa.enabled === true) {
          const wl = asObj(wa.linked)
          whatsapp = wl !== null
            ? { state: 'linked', name: String(wl.display || ''), since: String(wl.linked_at || ''), paused: wl.paused === true }
            : { state: wa.available === true ? 'unlinked' : 'closed' }
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
        // Which server this is, as the host names it (the footer's helper): for the words under the Telegram row, and whether there is another to switch to.
        const sv = asObj(k.server)
        const named = { name: sv !== null && typeof sv.name === 'string' ? sv.name.slice(0, 60) : '', host: sv !== null && typeof sv.host === 'string' ? sv.host.slice(0, 80) : '', canSwitch: sv !== null && sv.can_switch === true }
        return { kind: 'ok', telegram, whatsapp, home, computers, server: named, accountUrl: api === '' ? '' : api + '/account' }
      }
      /** Which computer {NAME} works on, as the tile shows it: the person's choice (`pref`), else the cloud computer when one is already there (made at an
       *  earlier request), else this one. A view with no account or no readable server can only say « this computer »: that choice needs neither. */
      const whereOf = (pref, view) => {
        if (view === null || view === undefined || view.kind !== 'ok') return 'local'
        if (pref === 'local' || pref === 'cloud') return pref
        return view.home !== null ? 'cloud' : 'local'
      }
      /** After this long with a code on screen and no Start, the page offers help. A code is good for 5 minutes (the server's), and renews by itself `PAIR_RENEWALS` times. */
      const STUCK_AFTER_MS = 20000
      const PAIR_RENEWALS = 3
      /** What the connection card shows for a pairing (null = none yet), at `nowMs`. */
      const pairingFace = (p, nowMs, canRenew) => {
        if (p === null || p === undefined) return { kind: 'none' }
        if (typeof p.error === 'string' && p.error !== '') return { kind: 'error', code: p.error }
        if (p.state === 'done') return { kind: 'done' }
        if (p.state === 'declined') return { kind: 'declined', reason: ['user', 'taken', 'botmade'].indexOf(p.reason) >= 0 ? p.reason : 'user' }
        if (p.state === 'expired') return { kind: 'expired' }
        const end = Date.parse(String(p.expiresAt || ''))
        const left = Number.isFinite(end) ? Math.max(0, Math.floor((end - nowMs) / 1000)) : 300
        // A waiting code that ran out and that the page is about to replace (`canRenew`) keeps reading as waiting at 0:00 for the instant in between, instead of flashing « expired ».
        if (left <= 0) return canRenew === true && p.state === 'waiting' ? { kind: 'waiting', left: 0, sender: '', stuck: false } : { kind: 'expired' }
        // A code that has waited this long with no Start is « stuck »: the page says what to do instead of only counting down. Age unknown (no start time): not stuck.
        const stuck = p.state === 'waiting' && Number.isFinite(p.startedAt) && nowMs - p.startedAt >= STUCK_AFTER_MS
        return { kind: p.state === 'scanned' ? 'scanned' : 'waiting', left, sender: String(p.sender || ''), stuck }
      }
      // ═══ the store and its calls ═════════════════════════════════════════════════════════════════════════════════
      const state = {
        loading: true, view: null, at: 0, remote: null,
        pairing: null, starting: false, confirmDisc: false, showCode: false, copied: false, renewals: 0, busy: '',
        // WhatsApp's own pairing, the same fields as Telegram's above (`slotOf` picks the one a call is about).
        wa: { pairing: null, starting: false, confirmDisc: false, showCode: false, copied: false, renewals: 0 },
        kybySid: null, kybyCwd: null, opening: false, openFailed: false, openError: '', computerError: '', where: null,
      }
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
        const [kyber, server, remote] = await Promise.all([readJson('/kybernos-cloud/kyber'), readJson('/kybernos-cloud/server'), readJson('/kybernos-mobile/remote/status')])
        state.view = derive(kyber, server)
        // The phone link's own answer (kybernos-mobile); null when this DSH has none or it is not running: the strip then says nothing of it.
        state.remote = remote !== null && typeof remote === 'object' && remote.ok === true ? remote : null
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
      // One machine for the two doors: `ch` is 'telegram' (the default) or 'whatsapp'. Telegram's fields are the store's own, WhatsApp's are `state.wa`; the routes differ by one word.
      const slotOf = (ch) => (ch === 'whatsapp' ? state.wa : state)
      const routeOf = (ch) => '/kybernos-cloud/' + (ch === 'whatsapp' ? 'whatsapp' : 'telegram')
      const pairTimers = { telegram: null, whatsapp: null }
      const pairLive = (ch = 'telegram') => { const p = slotOf(ch).pairing; return p !== null && typeof p.id === 'string' && ['waiting', 'scanned'].indexOf(p.state) >= 0 }
      const schedulePairPoll = (ms, ch = 'telegram') => {
        if (pairTimers[ch] !== null) clearTimeout(pairTimers[ch])
        pairTimers[ch] = setTimeout(() => { void pairPoll(ch) }, ms)
      }
      const pairPoll = async (ch = 'telegram') => {
        pairTimers[ch] = null
        const s = slotOf(ch)
        if (!pairLive(ch) || !live()) return
        const id = s.pairing.id
        const r = await readJson(routeOf(ch) + '/pairing/state?id=' + encodeURIComponent(id))
        if (s.pairing === null || s.pairing.id !== id) return
        if (r !== null && r.ok === true) {
          s.pairing = Object.assign({}, s.pairing, { state: r.state, reason: r.reason, sender: r.sender })
          if (r.state === 'done') {
            s.pairing = null
            emit()
            await load()
            return
          }
        } else if (r !== null && r.ok === false && (r.error === 'not_found' || r.error === 'not_connected')) {
          s.pairing = { error: r.error }
        }
        // A code that ran out while the page is open and in view is cancelled and replaced by a new one, `PAIR_RENEWALS` times at most (a code lives 5 minutes, scan-then-Start on a
        // phone can take longer; measured on dev). One that was scanned is never replaced under the person's hand, and a page nobody looks at makes no code.
        if (s.pairing !== null && s.pairing.id === id && s.pairing.state !== 'scanned' && ['waiting', 'expired'].indexOf(s.pairing.state) >= 0) {
          const end = Date.parse(String(s.pairing.expiresAt || ''))
          const lapsed = s.pairing.state === 'expired' || (Number.isFinite(end) && end <= Date.now())
          if (lapsed && document.visibilityState !== 'hidden') {
            if ((s.renewals || 0) < PAIR_RENEWALS) {
              s.renewals = (s.renewals || 0) + 1
              await postJson(routeOf(ch) + '/pairing/cancel', { id })
              await pairStart(ch, true)
              return
            }
            s.pairing = Object.assign({}, s.pairing, { state: 'expired' })
          }
        }
        emit()
        if (pairLive(ch)) schedulePairPoll(document.visibilityState === 'hidden' ? 6000 : 2000, ch)
      }
      /** Whether the page will replace a code that runs out by itself: renewals left, in view, shown. */
      const mayRenew = (ch) => (slotOf(ch).renewals || 0) < PAIR_RENEWALS && document.visibilityState !== 'hidden' && live()
      /** `renew`: a new code made by the page itself (the count of renewals goes on); a person's own press starts the count over. */
      const pairStart = async (ch = 'telegram', renew = false) => {
        const s = slotOf(ch)
        if (s.starting) return
        s.starting = true
        s.pairing = null
        s.showCode = false
        if (renew !== true) s.renewals = 0
        emit()
        const r = await postJson(routeOf(ch) + '/pairing', {})
        s.starting = false
        if (r !== null && r.ok === true && typeof r.id === 'string') {
          s.pairing = { id: r.id, link: r.link, bot: r.bot, number: r.number, qr: r.qr, expiresAt: r.expires_at, startedAt: Date.now(), state: 'waiting', reason: null, sender: '', error: '' }
          schedulePairPoll(2000, ch)
        } else {
          const code = r !== null && typeof r.error === 'string' ? r.error : 'unreachable'
          // The account already has this door linked (another window did it): the state is read again, the card becomes the connected one.
          s.pairing = code === 'already_linked' ? null : { error: code }
          if (code === 'already_linked' || (ch === 'whatsapp' && code === 'not_found')) void load()
        }
        emit()
      }
      const pairCancel = async (ch = 'telegram') => {
        const s = slotOf(ch)
        const id = s.pairing !== null ? s.pairing.id : null
        s.pairing = null
        s.showCode = false
        emit()
        if (typeof id === 'string') await postJson(routeOf(ch) + '/pairing/cancel', { id })
      }

      // — settings, disconnect, computer —
      /** The cloud computer linked to {NAME}: asked of the host, which asks the server; the answer is read again from the server. */
      const setComputer = async (id) => {
        state.computerError = ''
        emit()
        const r = await postJson('/kybernos-cloud/kyby/computer', { computer_id: id === '' ? null : id })
        if (r === null || r.ok !== true) state.computerError = r !== null && (r.error === 'not_found' || r.error === 'unsupported') ? 'err_computer_old' : 'err_computer'
        await load()
      }
      /** « This computer » or the cloud one: remembered by this browser, with no call to any server (the cloud computer itself is chosen with `setComputer`). */
      const setWhere = (w) => {
        state.where = w
        try { window.localStorage.setItem('kybernos-kyber.where', w) } catch (e) { /* no storage: the choice holds until the page is closed */ }
        emit()
      }
      const unlink = async (ch = 'telegram') => {
        const s = slotOf(ch)
        s.confirmDisc = false
        const r = await postJson(routeOf(ch) + '/unlink', { confirm: true })
        s.pairing = null
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
      const telegramStateOf = () => (state.view !== null && state.view.kind === 'ok' ? state.view.telegram.state : null)
      /** Opens the « Phone and channels » screen's window, or null when the bundle that draws it (kybernos-mobile, `window.__KB_MOBILE__.open`) is not there. Read when used. */
      const phoneOpener = () => {
        try {
          const m = window.__KB_MOBILE__
          return m !== undefined && m !== null && typeof m.open === 'function' ? () => { try { m.open() } catch (e) { /* no window */ } } : null
        } catch (e) { return null }
      }
      /** Settings › Servers, the way the footer and the phone link ask for it: a window event the Kybernos Cloud bundle answers. */
      const openServers = () => { try { window.dispatchEvent(new Event('kybernos-cloud:servers')) } catch (e) { /* no window events: nothing opens */ } }
      const whatsappStateOf = () => (state.view !== null && state.view.kind === 'ok' ? state.view.whatsapp.state : null)
      /** A door's switch. On asks for a code, now and not when the strip opens; off cancels a code in flight or, for a connected chat, asks to disconnect. */
      const channelSwitch = (ch) => {
        const st = ch === 'whatsapp' ? whatsappStateOf() : telegramStateOf()
        const s = slotOf(ch)
        if (st === 'linked') { s.confirmDisc = true; emit(); return }
        if (st !== 'unlinked') return
        if (s.starting) return
        if (pairLive(ch)) { void pairCancel(ch); return }
        void pairStart(ch)
      }
      const telegramSwitch = () => channelSwitch('telegram')
      const whatsappSwitch = () => channelSwitch('whatsapp')

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
        imessage: (n) => h('svg', { width: n, height: n, viewBox: '0 0 24 24', 'aria-hidden': 'true', style: { flex: 'none' } },
          h('circle', { cx: 12, cy: 12, r: 12, fill: '#34C759' }),
          h('path', { d: 'M12 6.2c-3.5 0-6.3 2.2-6.3 5 0 1.5.8 2.8 2.1 3.7-.1.7-.4 1.4-.9 2 1-.1 1.9-.5 2.6-1 .8.2 1.6.3 2.5.3 3.5 0 6.3-2.2 6.3-5s-2.8-5-6.3-5z', fill: '#FFFFFF' })),
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
        h(Mark, null, props.mark), h('div', { className: 'kbky-ta' }, h('b', null, props.name, props.badge === undefined ? null : h('span', { className: 'kbky-chip kbky-badge' + (props.badgeWarn === true ? ' warn' : '') }, props.badge)), h('span', { className: props.warn ? 'warn' : '' }, props.sub), props.extra === undefined ? null : props.extra), h('div', { className: 'kbky-ra' }, props.right))

      /** What Telegram's row says of itself: the connection, or the pairing in flight. */
      const telegramRow = (v) => {
        const tg = v.telegram
        if (tg.state === 'off') return { sub: L('offWhy'), key: 'off' }
        if (tg.state === 'old') return { sub: L('oldWhy'), key: 'old' }
        if (tg.state === 'linked') return { sub: tg.paused ? L('paused') : tg.blocked ? L('blocked') : L('linked', { name: tg.name }), warn: tg.paused || tg.blocked, key: 'linked' }
        if (state.starting) return { sub: L('preparing'), key: 'starting' }
        const face = pairingFace(state.pairing, Date.now(), mayRenew('telegram'))
        if (face.kind === 'waiting') return { sub: L('tgCode'), key: 'waiting' }
        if (face.kind === 'scanned') return { sub: L('tgWait2'), key: 'scanned' }
        if (face.kind === 'expired') return { sub: L('tgExp'), key: 'expired' }
        if (face.kind === 'declined') return { sub: L(face.reason === 'taken' ? 'tgTak' : face.reason === 'botmade' ? 'tgBot' : 'tgDec'), key: 'declined' }
        if (face.kind === 'error') return face.code === 'not_found' ? { sub: L('offWhy'), key: 'off' } : (face.code === 'unsupported' ? { sub: L('oldWhy'), key: 'old' } : { sub: L('pe'), key: 'error' })
        return { sub: L('tgNone'), key: 'idle' }
      }

      /** Telegram as a state: its mark, its name and where it stands. The strip shows this; the « Phone and channels » screen adds the switch to it (`telegramChanRow`). */
      const telegramStateRow = (v) => {
        const row = telegramRow(v)
        return h(ChanRow, { kb: 'kybernos-kyber-tg-row', stateKey: row.key, mark: BRAND.telegram(20), name: L('telegram'), sub: row.sub, warn: row.warn === true })
      }
      /** Telegram's row on the « Phone and channels » screen: the state, the one switch, the way out of a server that has no bot, the link to the bot. */
      const telegramChanRow = (v) => {
        const tg = v.telegram
        const row = telegramRow(v)
        const on = tg.state === 'linked' || state.starting || pairLive()
        const bot = tg.state === 'linked' && typeof tg.botUrl === 'string' && tg.botUrl !== ''
          ? h('a', { className: 'kbky-iconlink', href: tg.botUrl, target: '_blank', rel: 'noopener noreferrer', 'data-kb': 'kybernos-kyber-bot', 'aria-label': L('openBot') }, Ic('ext', 15)) : null
        return h(ChanRow, { kb: 'kybernos-kyber-tg-row', stateKey: row.key, mark: BRAND.telegram(20), name: L('telegram'), sub: row.sub, warn: row.warn === true,
          // No bot here, or a server too old: the way out is on the row, when the registry names another server.
          extra: (row.key === 'off' || row.key === 'old') && v.server.canSwitch === true ? h(Btn, { kb: 'kybernos-kyber-tg-switch-server', onClick: openServers }, L('switchServer')) : undefined,
          right: h(React.Fragment, null, bot, h(Switch, { on, disabled: tg.state === 'off' || tg.state === 'old', label: L('telegram'), kb: 'kybernos-kyber-tg-switch', onClick: telegramSwitch })) })
      }

      /** What WhatsApp's row says of itself: not offered, no bridge open, the connection, or the pairing in flight (the same sentences as Telegram's where they are not about the app). */
      const whatsappRow = (v) => {
        const w = v.whatsapp
        if (w.state === 'off') return { sub: L('waOff'), key: 'off' }
        if (w.state === 'closed') return { sub: L('waClosed'), key: 'closed' }
        if (w.state === 'linked') return { sub: w.paused ? L('waPaused') : L('waLinked', { name: w.name }), warn: w.paused, key: 'linked' }
        if (state.wa.starting) return { sub: L('preparing'), key: 'starting' }
        const face = pairingFace(state.wa.pairing, Date.now(), mayRenew('whatsapp'))
        if (face.kind === 'waiting') return { sub: L('tgCode'), key: 'waiting' }
        if (face.kind === 'scanned') return { sub: L('waWait2'), key: 'scanned' }
        if (face.kind === 'expired') return { sub: L('tgExp'), key: 'expired' }
        if (face.kind === 'declined') return { sub: L(face.reason === 'taken' ? 'tgTak' : 'waDec'), key: 'declined' }
        if (face.kind === 'error') return face.code === 'not_found' ? { sub: L('waClosed'), key: 'closed' } : { sub: L('pe'), key: 'error' }
        return { sub: L('tgNone'), key: 'idle' }
      }
      /** WhatsApp's row on the « Phone and channels » screen: the beta badge, the state, the one switch (greyed while it cannot be turned on). */
      const whatsappChanRow = (v) => {
        const w = v.whatsapp
        const row = whatsappRow(v)
        const on = w.state === 'linked' || state.wa.starting || pairLive('whatsapp')
        return h(ChanRow, { key: 'whatsapp', kb: 'kybernos-kyber-chan-whatsapp', stateKey: row.key, mark: BRAND.whatsapp(20), name: 'WhatsApp', badge: L('beta'), badgeWarn: true, sub: row.sub, warn: row.warn === true,
          right: h(Switch, { on, disabled: w.state === 'off' || w.state === 'closed', label: 'WhatsApp', kb: 'kybernos-kyber-whatsapp-switch', onClick: whatsappSwitch }) })
      }

      /** The computer's state as a chip: awake, asleep, being set up, on request. */
      const computerChip = (hm, kb) => {
        if (hm === null) return h('span', { className: 'kbky-chip', 'data-kb': kb }, L('onRequest'))
        const st = hm.state
        const cls = st === 'running' ? ' ok' : TRANSIENT.indexOf(st) >= 0 ? ' warn' : st === 'failed' ? ' err' : ''
        return h('span', { className: 'kbky-chip' + cls, 'data-kb': kb }, S['st_' + st] !== undefined ? L('st_' + st) : L('st_other', { state: st }))
      }

      /** The sub-block « {NAME}'s computer » of the « Phone and channels » screen: the computer {NAME} works on, as a select. « This computer » is always there (it needs no account and no
       *  server); next to it the cloud computers of the account, with the state of the chosen one and the one thing the plan lets the person do. The choice is remembered. */
      const ComputerBlock = (props) => {
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
          h('div', { className: 'kbky-th' }, h(Mark, null, Ic('monitor', 18)), h('b', null, L('compH'))),
          h('p', { className: 'kbky-help', 'data-kb': 'kybernos-kyber-computer-help' }, L('compLead')),
          h('div', { className: 'kbky-tb' },
            field, line,
            !local && hm !== null && hm.paused !== '' ? h('p', { className: 'kbky-warn' }, L(hm.paused === 'hours' ? 'pr_hours' : 'pr_other')) : null,
            state.computerError !== '' ? h('p', { className: 'kbky-err', role: 'alert', 'data-kb': 'kybernos-kyber-computer-error' }, L(state.computerError)) : null,
            free ? h('p', { className: 'kbky-cap', 'data-kb': 'kybernos-kyber-upsell' }, L('upsell')) : null),
          acts !== null || free
            ? h('div', { className: 'kbky-tf' }, acts, free ? h(Btn, { kb: 'kybernos-kyber-upgrade', onClick: upgrade }, Ic('star', 14), L('upgrade')) : null)
            : null)
      }

      /** Under a door's row on the « Phone and channels » screen, only while there is something to do about it: the code to scan, what happened to it, or the question before disconnecting.
       *  One panel for the two doors (`props.channel`, Telegram by default); WhatsApp's controls carry the same names with `wa-` after `kybernos-kyber-`, so the two can be told apart. */
      const ChannelPanel = (props) => {
        useTick(1000)
        const v = props.view
        const ch = props.channel === 'whatsapp' ? 'whatsapp' : 'telegram'
        const wa = ch === 'whatsapp'
        const tg = wa ? v.whatsapp : v.telegram
        const s = slotOf(ch)
        const kb = (name) => (wa ? name.replace('kybernos-kyber-', 'kybernos-kyber-wa-') : name)
        const W = (tgKey, waKey) => L(wa ? waKey : tgKey)
        const panel = (kind, ...kids) => h('section', { className: 'kbky-panel', 'data-kb': wa ? 'kybernos-kyber-whatsapp' : 'kybernos-kyber-telegram', 'data-state': kind }, ...kids)
        const again = () => { void pairStart(ch) }
        const note = (kind, hKey, pText, retry) => panel(kind,
          h('div', { className: 'kbky-pcol' }, h('h3', null, L(hKey)), h('p', { className: 'kbky-sub left' }, pText),
            retry ? h('div', { className: 'kbky-actions' }, h(Btn, { primary: true, kb: kb('kybernos-kyber-retry'), onClick: again }, L('newCode'))) : null))
        if (tg.state === 'off' || tg.state === 'old' || tg.state === 'closed') return null
        if (tg.state === 'linked') {
          if (!s.confirmDisc) return null
          return panel('disconnect', h('div', { className: 'kbky-pcol' }, h('h3', null, W('discQ', 'waDiscQ')),
            h('div', { className: 'kbky-actions' },
              h(Btn, { danger: true, kb: kb('kybernos-kyber-unlink-yes'), onClick: () => { void unlink(ch) } }, L('confirm')),
              h(Btn, { kb: kb('kybernos-kyber-unlink-no'), onClick: () => { s.confirmDisc = false; emit() } }, L('cancel')))))
        }
        if (s.starting) return panel('starting', h('div', { className: 'kbky-row' }, h('span', { className: 'kbky-spin', 'aria-hidden': 'true' }), h('span', { className: 'kbky-sub left' }, L('preparing'))))
        const face = pairingFace(s.pairing, Date.now(), mayRenew(ch))
        if (face.kind === 'none' || face.kind === 'done') return null
        if (face.kind === 'expired') return note('expired', 'exH', L('exP'), true)
        if (face.kind === 'declined') {
          if (face.reason === 'taken') return note('taken', W('taH', 'waTaH'), W('taP', 'waTaP'), true)
          if (face.reason === 'botmade' && !wa) return note('botmade', 'bmH', L('bmP'), false)
          return note('declined', 'deH', W('deP', 'waDeP'), true)
        }
        if (face.kind === 'error') {
          if (face.code === 'not_found') return wa ? note('closed', 'waOfH', L('waDown'), true) : note('off', 'ofH', L('ofP'), false)
          if (face.code === 'unsupported') return note('old', 'oldH', L('oldWhy'), false)
          return panel('error', h('div', { className: 'kbky-pcol' }, h('h3', null, W('cH', 'waCH')), h('p', { className: 'kbky-sub left' }, L(face.code === 'rate_limited' ? 'peRate' : 'pe')),
            h('div', { className: 'kbky-actions' }, h(Btn, { primary: true, kb: kb('kybernos-kyber-retry'), onClick: again }, L('retry')))))
        }
        const p = s.pairing
        const scanned = face.kind === 'scanned'
        const cancel = () => { void pairCancel(ch) }
        const tokenOf = /pair_([A-Za-z0-9_-]+)$/u.exec(typeof p.link === 'string' ? p.link : '')
        // The same single-use token, written by hand: the person opens the bot in Telegram (any device, any app) and writes « /start pair_… », or writes « pair_… » to the number in
        // WhatsApp. Nothing leaves DSH.
        const typed = tokenOf === null ? '' : wa ? (typeof p.number === 'string' && p.number !== '' ? 'pair_' + tokenOf[1] : '') : (typeof p.bot !== 'string' || p.bot === '' ? '' : '/start pair_' + tokenOf[1])
        // Telegram's own app on this computer, without the t.me page in between (the token and the bot name were checked by the host).
        const appLink = wa || tokenOf === null || typeof p.bot !== 'string' || !/^[A-Za-z0-9_]{3,64}$/u.test(p.bot) ? '' : 'tg://resolve?domain=' + p.bot + '&start=pair_' + tokenOf[1]
        // Nothing arrived after a while (Telegram: the person may have only opened the chat of a bot already used, and must press Start / Restart): say so, and show the message to send.
        const stuck = !wa && face.stuck === true
        const copyCode = () => {
          try { void navigator.clipboard.writeText(typed).then(() => { s.copied = true; emit(); setTimeout(() => { s.copied = false; emit() }, 1800) }).catch(() => { /* refused: it is on the screen */ }) } catch (e) { /* no clipboard */ }
        }
        return panel(scanned ? 'scanned' : 'waiting',
          h('div', { className: 'kbky-pbody' },
            scanned ? null : h('div', { className: 'kbky-pqr' }, h(Qr, { qr: p.qr })),
            h('div', { className: 'kbky-pcol' },
              h('h3', null, L(scanned ? W('scH', 'waScH') : W('cH', 'waCH'))),
              scanned
                ? h(React.Fragment, null, h('p', { className: 'kbky-sub left' }, L(wa ? 'waScP' : 'scP', { who: face.sender === '' ? '…' : face.sender })),
                  h('div', { className: 'kbky-row' }, h('span', { className: 'kbky-spin', 'aria-hidden': 'true' }), h('span', { className: 'kbky-sub left' }, W('scWait', 'waScWait'))))
                : h('ol', { className: 'kbky-steps' }, h('li', null, W('s1', 'waS1')), h('li', null, W('s2', 'waS2')), h('li', null, W('s3', 'waS3'))),
              h('div', { className: 'kbky-actions' },
                h(Btn, { primary: !scanned, href: p.link, kb: kb('kybernos-kyber-open') }, wa ? BRAND.whatsapp(18) : BRAND.telegram(18), W('openTg', 'openWa')),
                h('span', { className: 'kbky-sub left', 'data-kb': kb('kybernos-kyber-left') }, L('expiresIn', { t: clock(face.left) })),
                h('button', { type: 'button', className: 'kbky-link', 'data-kb': kb('kybernos-kyber-cancel'), onClick: cancel }, L(scanned ? 'notMe' : 'cancel'))),
              !scanned && appLink !== '' ? h('a', { className: 'kbky-link', href: appLink, 'data-kb': kb('kybernos-kyber-open-app') }, L('openApp')) : null,
              stuck && typed !== '' ? h('p', { className: 'kbky-stuck', 'data-kb': kb('kybernos-kyber-stuck') }, h('strong', null, L('stuckH')), ' ', L('stuckP', { bot: '@' + p.bot })) : null,
              // While the help is shown the message is open under it: the fold button would only come between the two.
              !scanned && typed !== '' && !stuck ? h('button', { type: 'button', className: 'kbky-link', 'data-kb': kb('kybernos-kyber-code'), 'aria-expanded': String(s.showCode), onClick: () => { s.showCode = !s.showCode; emit() } }, L('noCam')) : null,
              !scanned && typed !== '' && (s.showCode || stuck)
                ? h('div', { className: 'kbky-codebox', 'data-kb': kb('kybernos-kyber-code-box') },
                  h('span', { className: 'kbky-sub left' }, wa ? L('waCodeIntro', { number: p.number }) : L('codeIntro', { bot: '@' + p.bot })),
                  h('div', { className: 'kbky-row' },
                    h('code', { className: 'kbky-cmd', 'data-kb': kb('kybernos-kyber-code-text') }, typed),
                    h(Btn, { kb: kb('kybernos-kyber-code-copy'), onClick: copyCode }, L(s.copied ? 'codeCopied' : 'codeCopy'))))
                : null)))
      }
      const TelegramPanel = ChannelPanel

      // ═══ Where things stand, in one place: the remote control, Telegram and the computer (the strip's chips, its popover and the tab say the same words) ═══
      /** The phone link as the strip and the tab say it, from kybernos-mobile's own status; null while this DSH has no phone link (no such bundle, or it is not running). */
      const remoteFace = () => {
        const r = state.remote
        if (r === null || typeof r !== 'object' || r.ok !== true || r.available === false) return null
        const n = Array.isArray(r.devices) ? r.devices.length : 0
        if (r.enabled === false) return { key: 'off', cls: '', chip: L('rmChipOff'), sub: L('rmSubOff') }
        if (r.configured === false) return { key: 'none', cls: '', chip: L('rmChipNone'), sub: L('rmSubNone') }
        if (n > 0) return { key: 'linked', cls: 'ok', chip: L(n === 1 ? 'rmChip1' : 'rmChipN', { n }), sub: L(n === 1 ? 'rmSub1' : 'rmSubN', { n }) }
        return { key: 'ready', cls: 'ok', chip: L('rmChipReady'), sub: L('rmSubReady') }
      }
      /** The computer {NAME} works on, as a chip and as a sentence. */
      const computerFace = () => {
        const v = state.view
        const ok = v !== null && v.kind === 'ok'
        if (!ok || whereOf(state.where, v) === 'local') return { key: 'local', cls: 'ok', icon: 'monitor', chip: L('thisComputer') + ' · ' + L('ready'), sub: L('thisComputer') + ' · ' + L('ready') }
        const hm = v.home
        const name = hm !== null && hm.name !== '' ? hm.name : HOME_NAME
        const st = hm === null ? L('onRequest') : (S['st_' + hm.state] !== undefined ? L('st_' + hm.state) : hm.state)
        return { key: 'cloud', cls: hm !== null && hm.state === 'running' ? 'ok' : '', icon: 'cloud', chip: name + ' · ' + st, sub: L('cloudName', { name }) + ' · ' + st }
      }
      /** The three lines of the strip's popover and of the tab: what each of the three is, where it stands, and the one button that opens the screen that sets it up (offered only while
       *  the bundle that draws that screen is there). */
      const StatusList = () => {
        const v = state.view
        const ok = v !== null && v.kind === 'ok'
        const rm = remoteFace()
        const open = phoneOpener()
        const go = (kb, label) => (open === null ? undefined : h(Btn, { kb, onClick: open }, label))
        return h('div', { className: 'kbky-chlist kbky-statuslist', 'data-kb': 'kybernos-kyber-status-list' },
          rm === null ? null : h(ChanRow, { key: 'remote', kb: 'kybernos-kyber-row-remote', stateKey: rm.key, mark: Ic('phone', 18), name: L('remote'), sub: rm.sub, right: go('kybernos-kyber-set-remote', L('setUp')) }),
          ok ? h(ChanRow, { key: 'telegram', kb: 'kybernos-kyber-tg-row', stateKey: telegramRow(v).key, mark: BRAND.telegram(20), name: L('telegram'), sub: telegramRow(v).sub, warn: telegramRow(v).warn === true,
            right: go('kybernos-kyber-set-telegram', v.telegram.state === 'unlinked' ? L('connect') : L('manageRow')) }) : null,
          h(ChanRow, { key: 'computer', kb: 'kybernos-kyber-row-computer', stateKey: computerFace().key, mark: Ic(computerFace().icon, 18), name: L('compH'), sub: computerFace().sub, right: go('kybernos-kyber-set-computer', L('setUp')) }))
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
      /**
       * A chat made for Kaby starts in DSH's own « workspace-write, ask » mode instead of the profile's full access: DSH asks before a command that leaves its folder or a tool that changes
       * something, in its own approval card, and no plugin seam is needed. Applied ONCE, when the chat is made: whatever the person picks later in the composer stays theirs, and a Kaby chat
       * that already exists is not touched. DSH switches a chat's mode with its own slash command, on a chat that is materialized, which takes a moment after it is opened. Never throws.
       */
      const ASK_PRESET = 'workspace-write'
      const askFirst = async (sessionsSvc, sid, tries = 20, waitMs = 250) => {
        for (let i = 0; i < tries; i += 1) {
          try {
            const bound = sessionsSvc.binding(sid)
            const live = bound !== null && bound !== undefined ? bound.session : null
            if (live !== null && live !== undefined && typeof live.command === 'function') {
              const r = await live.command('/permission ' + ASK_PRESET)
              return r !== null && typeof r === 'object' && r.ok === true && r.value !== null && typeof r.value === 'object' && r.value.matched === true
            }
          } catch (e) { /* not materialized yet: try again */ }
          await new Promise((resolve) => setTimeout(resolve, waitMs))
        }
        return false
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
          let made = false
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
            const born = await sessionsSvc.create(workspaceId !== null ? { workspaceId } : (state.kybyCwd === null ? {} : { cwd: state.kybyCwd }))
            const v = born !== null && typeof born === 'object' && born.value !== null && born.value !== undefined ? born.value : born
            sid = typeof v === 'string' ? v : (v !== null && typeof v === 'object' && typeof v.sessionId === 'string' ? v.sessionId : null)
            if (typeof sid !== 'string' || sid === '') throw new Error('no session made')
            const w = await postJson('/kybernos-cloud/kyby/native/set', { sessionId: sid })
            if (w === null || w.ok !== true) throw new Error('the session could not be remembered')
            state.kybySid = sid
            made = true
            announceSession()
          }
          uiSvc.openSession(sid)
          if (made) void askFirst(sessionsSvc, sid)
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

      // ═══ The phone's « Kaby » app: DSH has no address for a conversation, so this page opens Kaby's by the shell's own call ═══
      // kybernos-mobile's phone page serves the same DSH twice: at /__kb/ (the whole computer) and at /__kb/kaby/ (the Kaby app). DSH runs in a frame of that page, on
      // the same origin, so it can read which one it is in. Once DSH lists its sessions and workspaces its own startup restoration has run, so the call below is the
      // later navigation and wins: Kaby's conversation opens, by the same openChat() as the sidebar row (which makes the chat the first time). Never throws.
      const KABY_APP_PATH = '/__kb/kaby/'
      const inKabyApp = () => { try { return window.parent !== window && window.parent.location.pathname === KABY_APP_PATH } catch (e) { return false } }
      const shellReady = () => {
        try {
          const snap = svc('sessions').list.getSnapshot()
          const ws = svc('uiWorkspace').workspaces.list.getSnapshot()
          return snap !== null && snap !== undefined && typeof snap.byId === 'object' && ws !== null && ws !== undefined && Array.isArray(ws.items)
        } catch (e) { return false }
      }
      let kabyAppOpened = false
      const openKabyApp = () => {
        if (kabyAppOpened || !inKabyApp()) return undefined
        let timer = null
        let tries = 0
        let stopped = false
        const pause = (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms) })
        const tick = async () => {
          if (stopped || kabyAppOpened) return
          tries += 1
          if (shellReady()) {
            kabyAppOpened = true
            await pause(600)
            if (stopped) { kabyAppOpened = false; return }
            // one more try when the first fails: a chat made while DSH is still loading its workspaces
            if (!(await openChat())) { await pause(3000); if (!stopped) await openChat() }
            return
          }
          if (tries < 120) timer = setTimeout(tick, 500)
        }
        void tick()
        return () => { stopped = true; clearTimeout(timer) }
      }

      // The person's own name, portrait and voice for Kaby (the bundle kybernos-kaby-customisation, when it is there): read from its seam, re-read when it says it changed.
      const kabySeam = () => { try { const k = window.__KB_KABY__; return k !== undefined && k !== null && typeof k.profile === 'function' ? k : null } catch (e) { return null } }
      const useKaby = () => {
        const [, setTick] = React.useState(0)
        React.useEffect(() => {
          const again = () => setTick((n) => n + 1)
          try { window.addEventListener('kb-kaby-profile', again) } catch (e) { return undefined }
          return () => { try { window.removeEventListener('kb-kaby-profile', again) } catch (e) { /* gone */ } }
        }, [])
        const k = kabySeam()
        try { return k === null ? null : k.profile() } catch (e) { return null }
      }
      const openKabySettings = () => { try { const k = kabySeam(); if (k !== null && typeof k.open === 'function') k.open() } catch (e) { /* the page is optional */ } }
      /** The round picture of Kaby: the portrait, or the first letter of its name. */
      const KabyAv = (props) => (props.me.portrait !== null
        ? h('img', { className: 'kbky-av', src: props.me.portrait.url, alt: '', 'data-kb': 'kybernos-kyber-portrait' })
        : h('svg', { className: 'kbky-av', viewBox: '0 0 100 100', 'aria-hidden': 'true' }, h('circle', { cx: 50, cy: 50, r: 50 }), h('text', { x: 50, y: 67, textAnchor: 'middle', fontSize: 52, fontWeight: 700 }, (props.me.name.trim().charAt(0) || 'K').toUpperCase())))

      const useStore = () => {
        const [, setTick] = React.useState(0)
        React.useEffect(() => {
          const fn = () => setTick((n) => n + 1)
          listeners.add(fn)
          // The phone link (kybernos-mobile) says when the person switched it, linked a phone or removed one: the strip must not wait for the next poll to say so.
          const again = () => { void load() }
          try { window.addEventListener('kybernos-mobile:changed', again) } catch (e) { /* no window events */ }
          if (state.view === null) void load()
          if (state.kybySid === null) void readSessionPointer()
          const poll = setInterval(() => { if (document.visibilityState !== 'hidden') void load() }, 30000)
          return () => { listeners.delete(fn); clearInterval(poll); try { window.removeEventListener('kybernos-mobile:changed', again) } catch (e) { /* no window events */ } }
        }, [])
      }

      /** What the status chip says, from the view and the pairing. */
      const statusOf = (v) => {
        const tg = v !== null && v.kind === 'ok' ? v.telegram.state : null
        if (tg === 'linked') return ['ok', 'stOn']
        if (tg === null || tg === 'off' || tg === 'old') return ['', 'stNone']
        return pairingFace(state.pairing, Date.now()).kind === 'scanned' ? ['warn', 'stWait'] : ['', 'stOff']
      }

      /** The strip: ONE line above the composer of {NAME}'s chat (2026-10-22). {NAME}'s name, three chips that say how things stand (the remote control, Telegram, the computer) and the button
       *  « Set up… » that opens the screen where they are set up. A chip opens a small list of the same three, in words. Nothing here asks for attention by opening itself. */
      const Strip = () => {
        const me = useKaby()
        const [pop, setPop] = React.useState(false)
        const root = React.useRef(null)
        React.useEffect(() => {
          if (pop !== true) return undefined
          // Closed by a click elsewhere (capture phase: before it reaches another button) and by Escape; both listeners live only while the list is open.
          const away = (e) => { const r = root.current; if (r !== null && r !== undefined && typeof r.contains === 'function' && e !== null && e !== undefined && r.contains(e.target) === true) return; setPop(false) }
          const key = (e) => { if (e !== null && e !== undefined && e.key === 'Escape') setPop(false) }
          document.addEventListener('pointerdown', away, true)
          document.addEventListener('keydown', key)
          return () => { document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', key) }
        }, [pop])
        const v = state.view
        const ok = v !== null && v.kind === 'ok'
        const rm = remoteFace()
        const tg = ok ? statusOf(v) : null
        const cp = computerFace()
        const open = phoneOpener()
        const chip = (id, cls, icon, text, kb) => h('button', { key: id, type: 'button', className: 'kbky-chip kbky-chipb' + (cls === '' ? '' : ' ' + cls), 'data-kb': kb, 'aria-haspopup': 'true', 'aria-expanded': String(pop), onClick: () => setPop(!pop) }, icon, text)
        // Telegram that can be connected and is not yet is the one thing worth a colour; a server with no bot, or a signed-out account, is just said.
        const tgCls = tg === null ? '' : (tg[1] === 'stOff' ? 'warn' : tg[0])
        return h('div', { className: 'kbky-strip', 'data-kb': 'kybernos-kyber-strip', ref: root },
          me === null
            ? h('span', { className: 'kbky-who' }, Ic('kyby', 16), h('b', null, L('title')))
            // With the customisation bundle: the portrait and the name the person gave, and a click that opens Settings › Kaby.
            : h('button', { type: 'button', className: 'kbky-who kbky-whob', 'data-kb': 'kybernos-kyber-customise', title: L('customise', { name: me.name }), 'aria-label': L('customise', { name: me.name }), onClick: openKabySettings }, h(KabyAv, { me: me }), h('b', null, me.name)),
          rm === null ? null : chip('remote', rm.cls, Ic('phone', 13), rm.chip, 'kybernos-kyber-remote-chip'),
          tg === null ? null : chip('telegram', tgCls, BRAND.telegram(14), L({ stOn: 'tgcOn', stOff: 'tgcOff', stWait: 'tgcWait', stNone: 'tgcNone' }[tg[1]]), 'kybernos-kyber-status'),
          chip('computer', cp.cls, Ic(cp.icon, 13), cp.chip, 'kybernos-kyber-computer-chip'),
          h('span', { className: 'kbky-spacer' }),
          open === null ? null : h(Btn, { kb: 'kybernos-kyber-open-phone', onClick: open }, L('setUp')),
          helpPill(),
          pop === true ? h('div', { className: 'kbky-pop', role: 'group', 'aria-label': L('title'), 'data-kb': 'kybernos-kyber-pop' }, h(StatusList)) : null)
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

      /** The tab of the right-hand panel: the same three lines as the strip's list, with room only for them. */
      const Pane = () => {
        useStore()
        const v = state.view
        const head = h('div', { className: 'kbky-head' },
          h('h2', { className: 'kbky-h' }, L('title')),
          h('button', { type: 'button', className: 'kbky-btn', onClick: () => { void load() }, disabled: state.loading, 'data-kb': 'kybernos-kyber-refresh' }, state.loading ? L('loading') : L('refresh')))
        if (v === null) return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, h('p', { className: 'kbky-note' }, L('loading')))
        if (v.kind !== 'ok') return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head, h('p', { className: 'kbky-note' }, L(v.kind)), h(StatusList))
        return h('div', { className: 'kbky', 'data-kb': 'kybernos-kyber-pane' }, head,
          h(StatusList),
          v.accountUrl !== '' ? h('div', { className: 'kbky-actions' }, h('button', { type: 'button', className: 'kbky-link', 'data-kb': 'kybernos-kyber-account', onClick: () => { void openAccount('account') } }, L('manage'))) : null)
      }

      /**
       * The right-hand block of the « Phone and channels » screen (kybernos-mobile draws the screen and asks for this through `window.__KB_KYBER__.ChannelsColumn`): {NAME}, the assistant, in two
       * sub-blocks. « Messaging apps »: the doors {NAME} answers from, one row each, with what each one honestly is today (Telegram works, the same row and the same code panel as ever, so one
       * pairing is one pairing wherever it is looked at; WhatsApp is a beta that only a server with the door offers (otherwise « not available on this server yet »); WeChat and iMessage are « soon »), and in two lines what they do and what they never do.
       * « {NAME}'s computer »: where it works. The block says it always asks first, since the other half of the screen is the one that gives control of the computer.
       */
      const ChannelsColumn = () => {
        useStore()
        const v = state.view
        const head = h('div', { className: 'kbky-colhead' },
          h('h2', { className: 'kbky-colh', 'data-kb': 'kybernos-kyber-column-title' }, Ic('shield', 18), h('span', null, L('title')), h('span', { className: 'kbky-tag ok', 'data-kb': 'kybernos-kyber-column-tag' }, L('kabyTag'))),
          h('p', { className: 'kbky-lead2', 'data-kb': 'kybernos-kyber-column-lead' }, L('kabyLead')))
        // A row with nothing to switch yet: its switch is there, off and greyed, so the column reads as the list it will be.
        const later = (id, name, badge, sub, warn) => h(ChanRow, { key: id, kb: 'kybernos-kyber-chan-' + id, stateKey: 'soon', mark: BRAND[id](20), name, badge, badgeWarn: warn === true, sub,
          right: h(Switch, { on: false, disabled: true, label: name, kb: 'kybernos-kyber-' + id + '-switch' }) })
        const doesNever = h('div', { className: 'kbky-does', 'data-kb': 'kybernos-kyber-column-rights' },
          h('b', null, L('doesK')), h('span', null, L('msgDoes')),
          h('b', null, L('neverK')), h('span', null, L('msgNever')))
        if (v === null) return h('div', { className: 'kbky-col', 'data-kb': 'kybernos-kyber-column' }, head, h('p', { className: 'kbky-note' }, L('loading')))
        // No account or no readable server: the doors cannot be shown, and « this computer » still can (it needs neither).
        if (v.kind !== 'ok') return h('div', { className: 'kbky-col', 'data-kb': 'kybernos-kyber-column' }, head, h('p', { className: 'kbky-note', 'data-kb': 'kybernos-kyber-column-note' }, L(v.kind)), h(ComputerBlock, { view: v }))
        return h('div', { className: 'kbky-col', 'data-kb': 'kybernos-kyber-column' },
          head,
          h('div', { className: 'kbky-tile', 'data-kb': 'kybernos-kyber-messaging' },
            h('div', { className: 'kbky-th' }, h(Mark, null, Ic('link', 18)), h('b', null, L('msgH'))),
            h('div', { className: 'kbky-chlist kbky-collist' },
              telegramChanRow(v),
              h(TelegramPanel, { view: v }),
              whatsappChanRow(v),
              h(ChannelPanel, { view: v, channel: 'whatsapp' }),
              later('wechat', 'WeChat', L('soon'), L('notYet')),
              later('imessage', 'iMessage', L('soon'), L('imMac'))),
            doesNever),
          h(ComputerBlock, { view: v }))
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
        '.kbky-chip.ok{border-color:transparent;background:var(--dsw-alias-state-success-bg,rgba(34,197,94,.16));color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#15803d) 55%,var(--dsw-alias-label-primary,#222))}',
        '.kbky-chip.warn{border-color:transparent;background:var(--dsw-alias-state-warn-bg,rgba(245,158,11,.18));color:color-mix(in srgb,var(--dsw-alias-state-warn-label,#a8530a) 55%,var(--dsw-alias-label-primary,#222))}',
        // the strip also sits in the chat's dock, which has no `.kbky` ancestor: it sets its own size and colour, like the page and the pane do
        // the strip: ONE line (2026-10-22): the name, three chips, « Set up… », and a small list that opens above it
        '.kbky-strip{box-sizing:border-box;width:100%;max-width:var(--dsh-composer-card-max-width,none);margin-inline:auto;position:relative;display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:5px 10px 5px 12px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.25));border-radius:28px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.06));color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13.5px);line-height:1.5}',
        '.kbky-who{display:inline-flex;align-items:center;gap:8px;margin-inline-end:4px}',
        '.kbky-whob{border:0;background:none;padding:0;color:inherit;font:inherit;cursor:pointer;border-radius:99px}',
        '.kbky-whob:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4a7bd0);outline-offset:2px}',
        '.kbky-av{width:28px;height:28px;border-radius:50%;object-fit:cover;flex:none;display:block}',
        '.kbky-av circle{fill:var(--dsw-alias-button-primary-fill,#0f1115)}',
        '.kbky-av text{fill:var(--dsw-alias-label-primary-foreground,#fff)}',
        '.kbky-spacer{flex:1;min-width:0}',
        '.kbky-chipb{cursor:pointer;background:transparent;font:inherit;font-size:12px;padding-inline:8px}',
        '.kbky-chipb:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.22))}',
        '.kbky-chipb:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:2px}',
        '.kbky-pop{position:absolute;z-index:30;inset-inline-start:8px;bottom:calc(100% + 8px);width:min(460px,calc(100% - 16px));padding:8px 12px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3));background:var(--dsw-alias-bg-layer-1,#fff);box-shadow:var(--dsw-elevation-prominent,0 12px 32px rgba(0,0,0,.25))}',
        '.kbky-statuslist .kbky-crow{padding-block:6px}',
        // the help card opens upwards by default (the strip is above the composer, at the foot of a chat), downwards when there is no room above (placeHelp)
        '.kbky-strip .kbky-pillwrap [data-kb="help-panel"]{top:auto;bottom:calc(100% + 8px);max-height:min(70vh,560px,var(--kbky-pop-h,70vh))}',
        '.kbky-strip .kbky-pillwrap[data-dir="down"] [data-kb="help-panel"]{top:calc(100% + 8px);bottom:auto}',
        // a phone: the pill is mid-row, so no side of it holds the card; it becomes a sheet at the foot of the screen
        '@media (max-width:520px){.kbky-strip .kbky-pillwrap [data-kb="help-panel"],.kbky-strip .kbky-pillwrap[data-dir] [data-kb="help-panel"]{position:fixed;inset-inline:16px;width:auto;top:auto;bottom:16px;max-height:min(70vh,560px)}}',
        '.kbky-intro{margin:0 0 12px;max-width:68ch;color:var(--dsw-alias-label-secondary,#666);line-height:1.5}',
        '.kbky-help{margin:-4px 0 0;font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary,#666)}',
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
        '.kbky-btn:focus-visible,.kbky-link:focus-visible,.kbky-sw:focus-visible,.kbky-fsel:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4c6ef5);outline-offset:2px}',
        '.kbky-link{border:0;background:none;padding:0;font:inherit;font-size:13px;color:var(--dsw-alias-label-secondary,#666);text-decoration:underline;cursor:pointer;text-align:left}',
        // In the chat's dock the strip is as wide as the composer's card and centred like it, with its radius (28 px). The card's own rule is `width:100%;max-width:var(--dsh-composer-card-max-width)`
        // inside a root padded by `--dsh-composer-side-clearance` (measured on a chat 1213 px wide: the card is 813 px, and the strip used to run the full 1181 px). Both are the engine's own
        // variables, inherited here; without them (an engine that has none) the strip keeps the full width, as before.
        '.kbky-dock{margin:0 0 8px;padding:0 var(--dsh-composer-side-clearance,16px)}',
        '.kbky-chip.err{border-color:transparent;background:var(--dsw-alias-state-error-bg,rgba(236,19,19,.12));color:color-mix(in srgb,var(--dsw-alias-state-error-primary,#b91c1c) 55%,var(--dsw-alias-label-primary,#222))}',
        // the two tiles: one grid, one padding, one radius, one anatomy (mark and name on top, the body, one action at the bottom)
        '.kbky-tile{display:flex;flex-direction:column;gap:10px;min-width:0;padding:14px;border-radius:16px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
        '.kbky-th{display:flex;align-items:center;gap:10px;min-height:32px}.kbky-th b{font-size:14px;font-weight:600}',
        '.kbky-mark{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;flex:none;background:var(--dsw-alias-bg-base,rgba(127,127,127,.08));border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
        '.kbky-chlist{display:flex;flex-direction:column}',
        '.kbky-crow{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:12px;align-items:center;min-height:50px}',
        '.kbky-crow+.kbky-crow{border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
        '.kbky-ta{display:flex;flex-direction:column;min-width:0}.kbky-ta b{font-size:14px;font-weight:600}',
        '.kbky-ta .kbky-btn{align-self:flex-start;margin-top:8px}',
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
        // the code panel (on the « Phone and channels » screen, under Telegram's row): the code to scan, what happened to it, or the question before disconnecting
        '.kbky-panel{padding:14px;border-radius:16px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.1));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.3))}',
        '.kbky-pbody{display:flex;gap:16px;align-items:flex-start}',
        '.kbky-pqr .kbky-qr{width:132px;height:132px}',
        '.kbky-pcol{display:flex;flex-direction:column;gap:10px;min-width:0;flex:1}.kbky-pcol h3{margin:0;font-size:14px;font-weight:650}',
        '.kbky-codebox{display:flex;flex-direction:column;gap:6px}',
        '.kbky-stuck{margin:0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-stuck strong{color:var(--dsw-alias-label-primary,inherit);font-weight:650}',
        '.kbky-cmd{flex:1;min-width:0;padding:6px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2));background:var(--dsw-alias-bg-base,rgba(127,127,127,.08));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;overflow-wrap:anywhere;user-select:all}',
        // the « Phone and channels » column: a heading, the sentence that says what a messaging app can and cannot do, the rows, the foot line
        '.kbky-col{display:flex;flex-direction:column;gap:14px;min-width:0;color:var(--dsw-alias-label-primary,#222);font-size:var(--dsh-content-font-size-secondary,13.5px)}',
        '.kbky-colhead{display:flex;flex-direction:column;gap:4px}',
        '.kbky-colh{display:flex;align-items:center;gap:8px;margin:0;font-size:15.5px;font-weight:650;line-height:1.3}',
        '.kbky-tag{margin-inline-start:auto;flex:none;padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:600;white-space:nowrap}',
        '.kbky-tag.ok{background:var(--dsw-alias-state-success-bg,rgba(34,197,94,.16));color:color-mix(in srgb,var(--dsw-alias-state-success-primary,#15803d) 60%,var(--dsw-alias-label-primary,#222))}',
        '.kbky-lead2{margin:0;font-size:13px;line-height:1.45;color:var(--dsw-alias-label-secondary,#666)}',
        // « It does / Never »: two short lines under the messaging apps, the same look as the remote control's three lines on the other side of the screen
        '.kbky-does{display:grid;grid-template-columns:auto minmax(0,1fr);gap:4px 12px;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#222) 5%,transparent);font-size:12.5px;line-height:1.45;color:var(--dsw-alias-label-secondary,#666)}',
        '.kbky-does>b{color:var(--dsw-alias-label-primary,#222);font-weight:600;white-space:nowrap}',
        '.kbky-collist .kbky-crow{padding-block:8px}',
        '.kbky-collist .kbky-crow:not(:first-child){border-top:1px solid var(--dsw-alias-border-l1,rgba(127,127,127,.2))}',
        '.kbky-collist .kbky-panel{margin:4px 0 10px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#222) 5%,transparent);border-color:transparent}',
        '.kbky-badge{height:20px;padding:0 8px;margin-inline-start:8px;font-weight:400;vertical-align:1px}',
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
        __test: { inKabyApp, KABY_APP_PATH, askFirst, ASK_PRESET, S, L, kt, derive, pairingFace, clock, whereOf, remoteFace, computerFace, CSS, TYPE_ID, KIND, state, BRAND, NAME, views: { Strip, StatusList, Pane, ChannelsColumn, ComputerBlock, TelegramPanel, ChannelPanel, KybyDock, Page }, actions: { load, pairStart, pairPoll, pairCancel, unlink, setComputer, setWhere, computerAction, telegramSwitch, whatsappSwitch, channelSwitch, telegramRow, whatsappRow, settle, readSessionPointer }, listeners },
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

          // The phone's Kaby app (a frame of kybernos-mobile's /__kb/kaby/ page) opens on Kaby's conversation.
          ctx.effect(() => openKabyApp(), 'kybernos-kyber: Kaby app on the phone')

          // the tab type: it shows in the sidebar's « + » guide, and opens like any other tab
          // The icon of this tab in the « Start » picker of the right sidebar: the engine draws a grey cube for a type that gives none, and nine tabs of the suite looked the same (V-25).
          // A line icon in the ink of the picker, one per plugin; the engine calls it as a component with { size, className }.
          // KB-TABICON-BEGIN
          const KB_TAB_ICON = (props) => { const px = (props !== null && props !== undefined && typeof props.size === 'number') ? props.size : 22; return React.createElement('svg', { width: px, height: px, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', className: (props !== null && props !== undefined) ? props.className : undefined }, ['M12 8V4H8', 'M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z', 'M2 14h2', 'M20 14h2', 'M15 13v2', 'M9 13v2'].map((d, i) => React.createElement('path', { key: i, d }))) }
          // KB-TABICON-END
          let registre = null
          try { registre = ctx.get('sidebarRightTabs') } catch (e) { registre = null }
          if (registre && typeof registre.register === 'function') {
            ctx.effect(() => registre.register({
              id: TYPE_ID,
              kind: KIND,
              title: () => L('title'),
              guide: [{ title: () => L('title'), description: () => L('tabHint'), icon: KB_TAB_ICON }],
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
              /** The right-hand column of the « Phone and channels » screen (a component): kybernos-mobile draws the screen around it. */
              ChannelsColumn,
              /** The assistant's name, for the words of the screen around that column. */
              name: NAME,
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
