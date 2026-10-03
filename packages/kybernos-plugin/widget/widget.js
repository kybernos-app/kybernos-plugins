/* Kybernos widget public — la porte d'un kyber sur n'importe quel site.
 *
 * Embed (généré par l'onglet Widget de la fiche) :
 *   <script src="https://app.kybernos.ai/widget.js" data-team="<slug>"
 *           data-color="#2F6B54" data-position="right" data-format="bubble"></script>
 *
 * Attributs reconnus :
 *   data-team         slug du widget (obligatoire)
 *   data-color        couleur de la bulle et de l'entête (défaut #2F6B54)
 *   data-position     right | left (défaut right)
 *   data-format       bubble (seul format en v1)
 *   data-api          base de l'API publique (défaut : origine du script + /kybernos/widget/api)
 *   data-terms-url / data-privacy-url / data-footer   replis si l'API de config est absente
 *   data-bypass-auth   "1" : saute l'étape de connexion (démo et tests seulement)
 *
 * La configuration détaillée (titre, accueil, CGU, footer, enabled) vient de
 * GET <api>/config?team=<slug> — publiée quand le créateur enregistre son widget.
 * Sans API joignable, le chargeur retombe sur les attributs et reste utilisable.
 *
 * Cycle visiteur : bulle → panneau → acceptation des CGU du créateur →
 * connexion au compte Kybernos → discussion. Les messages partent sur
 * POST <api>/message ; tant que le pont cloud n'est pas branché, le panneau
 * l'annonce honnêtement au lieu de simuler.
 */
(function () {
  'use strict'
  var script = document.currentScript
  if (!script) {
    var candidats = document.getElementsByTagName('script')
    for (var i = candidats.length - 1; i >= 0; i--) {
      if ((candidats[i].src || '').indexOf('widget.js') >= 0) { script = candidats[i]; break }
    }
  }
  if (!script) return
  var attr = function (n, d) { var v = script.getAttribute('data-' + n); return (v === null || v === '') ? d : v }
  var team = attr('team', '')
  if (team === '') return
  var couleur = attr('color', '#2F6B54')
  var position = attr('position', 'right') === 'left' ? 'left' : 'right'
  var apiBase = attr('api', '')
  if (apiBase === '') {
    try { apiBase = new URL(script.src, location.href).origin + '/kybernos/widget/api' } catch (e) { apiBase = '/kybernos/widget/api' }
  }
  var bypass = attr('bypass-auth', '') === '1'
  var repli = {
    termsUrl: attr('terms-url', ''),
    privacyUrl: attr('privacy-url', ''),
    footer: attr('footer', '')
  }
  var K_TERMS = 'kbw:' + team + ':terms'
  var K_AUTH = 'kbw:' + team + ':auth'
  var K_VID = 'kbw:' + team + ':vid'
  var K_EMAIL = 'kbw:' + team + ':email'
  var K_CONVS = 'kbw:' + team + ':convs'
  var lisVal = function (k) { try { return localStorage.getItem(k) } catch (e) { return null } }
  var ecritVal = function (k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k) } catch (e) { /* navigation privée */ } }
  var alea = function () {
    var a = new Uint8Array(6)
    try { (window.crypto || window.msCrypto).getRandomValues(a) } catch (e) { for (var i = 0; i < 6; i++) a[i] = Math.floor(Math.random() * 256) }
    var h = ''
    for (var j = 0; j < a.length; j++) h += ('0' + a[j].toString(16)).slice(-2)
    return h
  }
  var vid = function () { return lisVal(K_VID) || 'v-' + alea() }
  var courriel = function () { return lisVal(K_EMAIL) || '' }
  var lu = function (k) { try { return localStorage.getItem(k) === '1' } catch (e) { return false } }
  var ecrit = function (k, v) { try { if (v) localStorage.setItem(k, '1'); else localStorage.removeItem(k) } catch (e) { /* navigation privée : l'état ne persiste pas */ } }

  var cfg = {
    enabled: true,
    title: team,
    greeting: 'Hi — ask anything, a human can take over.',
    color: couleur,
    position: position,
    termsUrl: repli.termsUrl,
    privacyUrl: repli.privacyUrl,
    termsVersion: 1,
    footer: repli.footer,
    authUrl: 'https://app.kybernos.ai/signin?widget=' + encodeURIComponent(team)
  }

  var racine = document.createElement('div')
  racine.setAttribute('data-kbwidget', team)
  racine.style.cssText = 'all:initial;position:fixed;bottom:0;' + position + ':0;z-index:2147483000'
  var monter = function () { (document.body || document.documentElement).appendChild(racine) }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter)
  else monter()

  var ombre = racine.attachShadow({ mode: 'open' })
  var styleEl = document.createElement('style')
  varStyle()
  var boite = document.createElement('div')
  ombre.appendChild(styleEl)
  ombre.appendChild(boite)

  function varStyle() {
    // Reprise à chaque appel : la config publiée peut changer la couleur après
    // le montage, les variables CSS doivent suivre cfg.color et non l'attribut.
    couleur = /^#[0-9a-fA-F]{6}$/.test(cfg.color) ? cfg.color : couleur
    styleEl.textContent =
      '.kbwgt-bulle{width:54px;height:54px;border-radius:999px;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;margin:20px;box-shadow:0 6px 18px rgba(0,0,0,.25)}' +
      '.kbwgt-panneau{width:min(340px,calc(100vw - 32px));height:min(480px,calc(100vh - 120px));background:#fff;color:#1c1e22;border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.28);margin:0 20px 12px;display:flex;flex-direction:column;overflow:hidden;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
      '.kbwgt-tete{padding:12px 14px;color:#fff;font-weight:600;display:flex;align-items:center;gap:8px}' +
      '.kbwgt-fermer{margin-left:auto;background:transparent;border:0;color:#fff;font-size:17px;cursor:pointer;line-height:1;padding:2px 4px}' +
      '.kbwgt-corps{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:10px}' +
      '.kbwgt-lien{color:inherit;text-decoration:underline;word-break:break-all}' +
      '.kbwgt-ligne{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;color:#4a4e57}' +
      '.kbwgt-bouton{border:0;border-radius:9px;padding:10px 12px;font:inherit;font-weight:600;cursor:pointer;background:' + couleur + ';color:#fff}' +
      '.kbwgt-bouton:disabled{opacity:.45;cursor:default}' +
      '.kbwgt-pied{padding:8px 14px;border-top:1px solid #e7e8ec;font-size:11px;color:#7a7f8a}' +
      '.kbwgt-msgs{flex:1;overflow:auto;display:flex;flex-direction:column;gap:8px}' +
      '.kbwgt-msg{max-width:86%;padding:8px 10px;border-radius:10px;background:#f1f2f5;font-size:13px}' +
      '.kbwgt-msg.moi{align-self:flex-end;background:' + couleur + ';color:#fff}' +
      '.kbwgt-sys{font-size:11.5px;color:#7a7f8a;text-align:center}' +
      '.kbwgt-barre{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #e7e8ec}' +
      '.kbwgt-champ{flex:1;border:1px solid #d6d8de;border-radius:9px;padding:9px 10px;font:inherit;outline:none}' +
      '.kbwgt-champ:focus{border-color:' + couleur + '}'
  }

  var etat = { ouvert: false, vue: 'terms' }

  function termsOk() {
    var v = lisVal(K_TERMS)
    if (v === null) return false
    if (v === '1') return (cfg.termsVersion || 1) <= 1 // ancien accord booléen
    return (Number(v) || 0) >= (cfg.termsVersion || 1)
  }

  function suivante() {
    if (termsOk() === false) return 'terms'
    if (lu(K_AUTH) === false && bypass === false) return 'signin'
    return 'chat'
  }

  function dessiner() {
    boite.textContent = ''
    if (cfg.enabled === false) return
    // La config publiée peut arriver après le montage : le côté est recalculé
    // à chaque dessin, sinon le conteneur garde le côté des attributs.
    racine.style.bottom = '0'
    racine.style.left = cfg.position === 'left' ? '0' : ''
    racine.style.right = cfg.position === 'left' ? '' : '0'
    if (etat.ouvert === true) boite.appendChild(panneau())
    boite.appendChild(bulle())
  }

  function bulle() {
    var b = document.createElement('button')
    b.className = 'kbwgt-bulle'
    b.style.background = cfg.color
    b.setAttribute('aria-label', 'Ouvrir le chat Kybernos')
    b.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 1 1 16.1-3.8z"/></svg>'
    b.addEventListener('click', function () { etat.ouvert = etat.ouvert !== true; etat.vue = suivante(); dessiner() })
    return b
  }

  function tete() {
    var t = document.createElement('div')
    t.className = 'kbwgt-tete'
    t.style.background = cfg.color
    var n = document.createElement('span')
    n.textContent = cfg.title
    var f = document.createElement('button')
    f.className = 'kbwgt-fermer'
    f.textContent = '×'
    f.setAttribute('aria-label', 'Fermer')
    f.addEventListener('click', function () { etat.ouvert = false; dessiner() })
    t.appendChild(n); t.appendChild(f)
    return t
  }

  function panneau() {
    var p = document.createElement('div')
    p.className = 'kbwgt-panneau'
    p.appendChild(tete())
    var c = document.createElement('div')
    c.className = 'kbwgt-corps'
    if (etat.vue === 'terms') vueTerms(c)
    else if (etat.vue === 'signin') vueSignin(c)
    else vueChat(c)
    p.appendChild(c)
    if (cfg.footer !== '') {
      var f = document.createElement('div')
      f.className = 'kbwgt-pied'
      f.textContent = cfg.footer
      p.appendChild(f)
    }
    return p
  }

  function vueTerms(c) {
    var g = document.createElement('div')
    g.textContent = cfg.greeting
    c.appendChild(g)
    var intro = document.createElement('div')
    intro.className = 'kbwgt-ligne'
    intro.textContent = 'Before chatting you accept the terms of this kyber, and you sign in with your Kybernos account.'
    c.appendChild(intro)
    var ls = document.createElement('div')
    ls.className = 'kbwgt-ligne'
    if (cfg.termsUrl !== '') ls.appendChild(lien('Terms of service (v' + (cfg.termsVersion || 1) + ')', cfg.termsUrl))
    if (cfg.privacyUrl !== '') ls.appendChild(lien('Privacy policy', cfg.privacyUrl))
    if (cfg.termsUrl === '' && cfg.privacyUrl === '') ls.textContent = 'The operator of this widget has not published legal terms yet.'
    c.appendChild(ls)
    var ligne = document.createElement('label')
    ligne.className = 'kbwgt-ligne'
    var case_ = document.createElement('input')
    case_.type = 'checkbox'
    var texte = document.createElement('span')
    texte.textContent = 'I accept the terms above and the Kybernos terms.'
    ligne.appendChild(case_); ligne.appendChild(texte)
    var go = document.createElement('button')
    go.className = 'kbwgt-bouton'
    go.textContent = 'Continue'
    go.disabled = true
    case_.addEventListener('change', function () { go.disabled = case_.checked !== true })
    go.addEventListener('click', function () { ecritVal(K_TERMS, String(cfg.termsVersion || 1)); etat.vue = suivante(); dessiner() })
    c.appendChild(ligne); c.appendChild(go)
  }

  function lien(t, u) {
    var a = document.createElement('a')
    a.className = 'kbwgt-lien'
    a.href = u
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    a.textContent = t
    return a
  }

  function vueSignin(c) {
    var t = document.createElement('div')
    t.textContent = 'One last step — a free Kybernos account, so the team knows who it talks to. Your email stays private.'
    c.appendChild(t)
    var champ = document.createElement('input')
    champ.className = 'kbwgt-champ'
    champ.type = 'email'
    champ.placeholder = 'you@example.com'
    var b = document.createElement('button')
    b.className = 'kbwgt-bouton'
    b.textContent = 'Create my account'
    var fin = function (v) {
      ecritVal(K_VID, v)
      ecritVal(K_EMAIL, champ.value.replace(/^\s+|\s+$/g, ''))
      ecrit(K_AUTH, true)
      try { if (window.parent && window.parent !== window) window.parent.postMessage({ type: 'kbw-auth', ok: true, vid: v }, '*') } catch (e) { /* page hôte absente */ }
      etat.vue = 'chat'; dessiner()
    }
    b.addEventListener('click', function () {
      var mail = champ.value.replace(/^\s+|\s+$/g, '')
      if (mail.indexOf('@') < 1 || mail.indexOf('.') < 0) {
        var mauvais = document.createElement('div')
        mauvais.className = 'kbwgt-sys'
        mauvais.textContent = 'Enter a valid email address.'
        c.appendChild(mauvais)
        return
      }
      b.disabled = true
      fetch(apiBase + '/account', {
        method: 'POST',
        // Corps sans content-type JSON : pas de preflight CORS.
        body: JSON.stringify({ team: team, email: mail })
      }).then(function (r) { return r.json().catch(function () { return {} }) }).then(function (rep) {
        fin(rep && rep.ok === true && rep.vid ? rep.vid : 'v-' + alea())
      }).catch(function () { fin('v-' + alea()) })
    })
    var empil = document.createElement('div')
    empil.style.cssText = 'display:flex;flex-direction:column;gap:8px'
    empil.appendChild(champ); empil.appendChild(b)
    c.appendChild(empil)
    var n = document.createElement('div')
    n.className = 'kbwgt-sys'
    n.textContent = 'A Kybernos account is free — your email stays private.'
    c.appendChild(n)
  }

  function vueChat(c) {
    var msgs = document.createElement('div')
    msgs.className = 'kbwgt-msgs'
    var accueil = document.createElement('div')
    accueil.className = 'kbwgt-msg'
    accueil.textContent = cfg.greeting
    msgs.appendChild(accueil)
    c.appendChild(msgs)
    var barre = document.createElement('div')
    barre.className = 'kbwgt-barre'
    var champ = document.createElement('input')
    champ.className = 'kbwgt-champ'
    champ.placeholder = 'Write a message…'
    var envoi = document.createElement('button')
    envoi.className = 'kbwgt-bouton'
    envoi.textContent = 'Send'
    var convKey = 'kbw:' + team + ':conv'
    var convId = null
    try { convId = localStorage.getItem(convKey) } catch (e) { convId = null }
    var vus = 0
    // Le fil connu est rejoué à l'ouverture (le visiteur retrouve son échange),
    // puis le panneau sonde les réponses tant qu'il reste ouvert.
    var rendre = function (msg) {
      var m = document.createElement('div')
      m.className = msg.role === 'visitor' ? 'kbwgt-msg moi' : 'kbwgt-msg'
      m.textContent = msg.text
      msgs.appendChild(m)
      msgs.scrollTop = msgs.scrollHeight
    }
    var rafraichir = function () {
      if (convId === null) return
      fetch(apiBase + '/message?team=' + encodeURIComponent(team) + '&conversation=' + encodeURIComponent(convId) + '&after=' + vus).then(function (r) { return r.ok ? r.json() : null }).then(function (rep) {
        if (!rep || rep.ok !== true || !Array.isArray(rep.messages)) return
        for (var i = 0; i < rep.messages.length; i++) rendre(rep.messages[i])
        if (rep.messages.length > 0) vus += rep.messages.length
      }).catch(function () { /* le fil attendra le prochain tour */ })
    }
    if (convId !== null) rafraichir()
    setInterval(rafraichir, 2500)
    var envoyer = function () {
      var txt = champ.value.replace(/^\s+|\s+$/g, '')
      if (txt === '') return
      champ.value = ''
      rendre({ role: 'visitor', text: txt })
      fetch(apiBase + '/message', {
        method: 'POST',
        // Pas d'en-tête content-type JSON : un type non simple déclencherait
        // un preflight OPTIONS CORS chez le navigateur du visiteur. Le corps
        // part en texte brut, l'API le parse pareil.
        body: JSON.stringify({ team: team, text: txt, conversationId: convId, vid: bypass === true ? '' : vid(), email: bypass === true ? '' : courriel() })
      }).then(function (r) { return r.json().catch(function () { return {} }) }).then(function (rep) {
        if (rep && rep.ok === true && rep.conversationId) {
          convId = rep.conversationId
          try {
            localStorage.setItem(convKey, convId)
            var liste = []
            try { liste = JSON.parse(localStorage.getItem(K_CONVS) || '[]') } catch (e2) { liste = [] }
            if (liste.indexOf(convId) < 0) { liste.push(convId); localStorage.setItem(K_CONVS, JSON.stringify(liste.slice(-20))) }
          } catch (e) { /* le fil repartira de zéro */ }
          vus = 1
          var att = document.createElement('div')
          att.className = 'kbwgt-sys'
          att.textContent = 'Sent — this kyber answers here.'
          msgs.appendChild(att)
          msgs.scrollTop = msgs.scrollHeight
          rafraichir()
        } else {
          var rep2 = document.createElement('div')
          rep2.className = 'kbwgt-sys'
          rep2.textContent = 'This door is closed or unknown — the message was not delivered.'
          msgs.appendChild(rep2)
          msgs.scrollTop = msgs.scrollHeight
        }
      }).catch(function () {
        var e2 = document.createElement('div')
        e2.className = 'kbwgt-sys'
        e2.textContent = 'Network error — try again.'
        msgs.appendChild(e2)
      })
    }
    envoi.addEventListener('click', envoyer)
    champ.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') envoyer() })
    barre.appendChild(champ); barre.appendChild(envoi)
    c.appendChild(barre)
    // Historique du visiteur : ses conversations, supprimables une à une.
    var hist = document.createElement('div')
    hist.className = 'kbwgt-ligne'
    var bascule = document.createElement('button')
    bascule.className = 'kbwgt-lien'
    bascule.style.cssText = 'background:none;border:0;padding:0;cursor:pointer;font:inherit;text-decoration:underline;color:inherit'
    bascule.textContent = 'My history'
    hist.appendChild(bascule)
    c.appendChild(hist)
    var listeConvs = function () {
      try { return JSON.parse(localStorage.getItem(K_CONVS) || '[]') } catch (e) { return [] }
    }
    bascule.addEventListener('click', function () {
      var vieux = hist.querySelector('.kbwgt-hist')
      if (vieux !== null) { vieux.remove(); return }
      var boite = document.createElement('div')
      boite.className = 'kbwgt-hist'
      boite.style.cssText = 'display:flex;flex-direction:column;gap:6px;font-size:12px'
      var ids = listeConvs()
      if (ids.length === 0) boite.textContent = 'No conversation yet.'
      for (var i = 0; i < ids.length; i++) (function (idc) {
        var ligneH = document.createElement('div')
        ligneH.style.cssText = 'display:flex;align-items:center;gap:6px'
        var nom = document.createElement('span')
        nom.textContent = idc.slice(0, 18) + (idc === convId ? ' — current' : '')
        nom.style.flex = '1'
        var eff = document.createElement('button')
        eff.className = 'kbwgt-lien'
        eff.style.cssText = 'background:none;border:0;padding:0;cursor:pointer;font:inherit;text-decoration:underline;color:#b3261e'
        eff.textContent = 'Delete'
        eff.addEventListener('click', function () {
          fetch(apiBase + '/history-delete', { method: 'POST', body: JSON.stringify({ team: team, conversation: idc }) }).catch(function () { /* le serveur rattrapera */ })
          var reste = listeConvs().filter(function (x) { return x !== idc })
          try { localStorage.setItem(K_CONVS, JSON.stringify(reste)) } catch (e2) { /* rien */ }
          if (idc === convId) {
            convId = null
            vus = 0
            try { localStorage.removeItem(convKey) } catch (e3) { /* rien */ }
            msgs.textContent = ''
            rendre({ role: 'visitor', text: 'History deleted — this thread is gone.' })
          }
          ligneH.remove()
          if (reste.length === 0) boite.textContent = 'No conversation yet.'
        })
        ligneH.appendChild(nom); ligneH.appendChild(eff)
        boite.appendChild(ligneH)
      })(ids[i])
      hist.appendChild(boite)
    })
  }

  // Configuration publiée par le créateur : écrase les replis quand elle répond.
  try {
    fetch(apiBase + '/config?team=' + encodeURIComponent(team)).then(function (r) { return r.ok ? r.json() : null }).then(function (rep) {
      if (!rep || rep.ok !== true) return
      if (rep.enabled === false) { cfg.enabled = false; dessiner(); return }
      if (typeof rep.title === 'string' && rep.title !== '') cfg.title = rep.title
      if (typeof rep.greeting === 'string' && rep.greeting !== '') cfg.greeting = rep.greeting
      if (typeof rep.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(rep.color)) cfg.color = rep.color
      if (rep.position === 'left' || rep.position === 'right') cfg.position = rep.position
      if (typeof rep.termsUrl === 'string' && rep.termsUrl !== '') cfg.termsUrl = rep.termsUrl
      if (typeof rep.privacyUrl === 'string' && rep.privacyUrl !== '') cfg.privacyUrl = rep.privacyUrl
      if (typeof rep.footer === 'string' && rep.footer !== '') cfg.footer = rep.footer
      if (typeof rep.termsVersion === 'number' && rep.termsVersion > 0) cfg.termsVersion = rep.termsVersion
      if (typeof rep.authUrl === 'string' && rep.authUrl !== '') cfg.authUrl = rep.authUrl
      varStyle()
      dessiner()
    }).catch(function () { /* replis déjà en place */ })
  } catch (e) { /* fetch indisponible : replis */ }

  dessiner()
})()
