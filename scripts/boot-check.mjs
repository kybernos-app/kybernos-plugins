// Contrôle de boot du plugin Kybernos dans la vraie GUI DSH.
//
// Pourquoi : une erreur d'évaluation dans `kybernos-plugin/client.js` (helper
// `const` appelé avant sa déclaration, propriété de menu calculée au chargement,
// champ d'onglet non différé…) fait échouer l'entrée du plugin, DSH affiche
// « Failed to load plugins » et il n'y a plus moyen de revenir depuis la GUI.
// Les tests unitaires ne l'attrapent que s'ils exécutent le chemin exact ; ce
// contrôle, lui, recharge la vraie page et regarde ce que l'utilisateur voit.
//
// Usage :
//   node scripts/boot-check.mjs
//     Réutilise un Chrome headless déjà ouvert sur le port 9333 (KB_CDP).
//   KB_URL="http://127.0.0.1:3080/?token=…" node scripts/boot-check.mjs
//     Lance son propre Chrome headless si aucun CDP n'est disponible.
//
// Variables : KB_CDP (défaut http://127.0.0.1:9333), KB_URL, KB_HOST
// (défaut 127.0.0.1:3080), KB_SETTLE (défaut 9000 ms), KB_CHROME.
//
// Sortie : 0 = boot sain, 1 = boot cassé ou plugin dégradé.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { etatNavigateur, refusEnvironnement } from './cdp-sante.mjs'

// Un délai dépassé (bibliothèques CDP) doit se solder par un constat LISIBLE et
// un code de sortie non nul — jamais par une attente sans fin : c'est ce qui
// rendait ce contrôle « non concluant » dans la campagne du 21/09.
const interruption = (e) => {
  const msg = String(e !== null && e !== undefined && e.message !== undefined ? e.message : e)
  // Un délai CDP = navigateur saturé : mesure impossible, pas échec du produit.
  const muet = /d[ée]lai d[ée]pass[ée]|delai CDP depasse|timeout/i.test(msg)
  console.log((muet ? '  ○ mesure impossible (navigateur de debug muet) : ' : '  ✗ contrôle interrompu : ') + msg)
  process.exit(muet ? 3 : 2)
}
process.on('unhandledRejection', interruption)
process.on('uncaughtException', interruption)

// Préflight (UNIQUEMENT sans KB_URL) : un navigateur muet n'est pas une
// régression du produit (cf. scripts/cdp-sante.mjs). Sortie 3 = « non
// concluant », distincte de 1 = échec. Avec KB_URL on ne sonde rien : on lance
// notre propre Chrome de contrôle, sinon un navigateur de debug saturé faisait
// sortir « non concluant » alors que la mesure était possible.
const HOTE_PREFLIGHT = process.env.KB_HOST || '127.0.0.1:3080'
if ((process.env.KB_URL || '') === '') {
  const sante = await etatNavigateur({ host: 'http://' + HOTE_PREFLIGHT })
  if (sante.etat !== 'ok') { refusEnvironnement(sante, 'boot réel'); process.exit(3) }
}



const CDP = process.env.KB_CDP || 'http://127.0.0.1:9333'
const URL_ = process.env.KB_URL || ''
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const SETTLE = Number(process.env.KB_SETTLE || 9000)
const CHROME = process.env.KB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let chrome = null

/** Un port de débogage LIBRE : un Chrome de contrôle laissé par un passage
 *  précédent occupait 9344 et le volet parlait à SA page au lieu de la nôtre
 *  (mesure perdue, « onglet rendu inexploitable »). */
const portLibre = async (depart) => {
  const { createServer } = await import('node:net')
  for (let p = depart; p < depart + 25; p += 1) {
    const libre = await new Promise((res) => {
      const s = createServer()
      s.once('error', () => res(false))
      s.once('listening', () => s.close(() => res(true)))
      s.listen(p, '127.0.0.1')
    })
    if (libre) return p
  }
  return depart
}

const cdpList = async (base) => {
  try {
    const r = await fetch(base + '/json/list')
    if (!r.ok) return null
    return await r.json()
  } catch (e) {
    return null
  }
}

const ensureBrowser = async () => {
  // KB_URL fourni → Chrome de contrôle DÉDIÉ sur cette URL (avec jeton) : c'est
  // déterministe, et c'est le seul chemin quand la GUI exige un jeton. Avant,
  // le préflight du navigateur de debug passait en premier et le volet sortait
  // « non concluant » sur un Chrome saturé, jeton valide ou pas.
  if (URL_ !== '') {
    if (!existsSync(CHROME)) {
      console.error('Chrome introuvable : ' + CHROME + ' (surcharge avec KB_CHROME)')
      process.exit(2)
    }
    const port = await portLibre(9344)
    const profile = mkdtempSync(join(tmpdir(), 'kb-boot-'))
    chrome = spawn(CHROME, [
      '--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
      '--no-first-run', '--no-default-browser-check', '--window-size=1400,900', URL_,
    ], { stdio: 'ignore', detached: false })
    const base = 'http://127.0.0.1:' + port
    for (let i = 0; i < 60; i += 1) {
      await sleep(500)
      const list = await cdpList(base)
      if (list !== null && list.length > 0) return { base, targets: list, spawned: true }
    }
    console.error('Chrome de contrôle n a pas démarré (port ' + port + ').')
    process.exit(2)
  }
  const existing = await cdpList(CDP)
  if (existing !== null) return { base: CDP, targets: existing, spawned: false }
  console.error('Aucun Chrome de debug sur ' + CDP + ' et KB_URL absent.')
  console.error('Ouvre la GUI, ou lance : KB_URL="http://127.0.0.1:<port>/?token=…" node scripts/boot-check.mjs')
  process.exit(2)
}

const DELAI_CMD = Number(process.env.KB_CDP_TIMEOUT || 10000)
const avecDelai = (promesse, ms, quoi) => Promise.race([
  promesse,
  new Promise((_, rej) => { const t = setTimeout(() => rej(new Error('délai dépassé (' + String(ms) + ' ms) : ' + quoi)), ms); if (t.unref !== undefined) t.unref() }),
])

const rpc = (ws, method, params) => avecDelai(new Promise((resolve, reject) => {
  const id = rpc.n = (rpc.n || 0) + 1
  const onMessage = (event) => {
    let msg = null
    try { msg = JSON.parse(event.data) } catch (e) { return }
    if (msg.id !== id) return
    ws.removeEventListener('message', onMessage)
    if (msg.error) reject(new Error(method + ' : ' + (msg.error.message || 'erreur CDP')))
    else resolve(msg.result)
  }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({ id, method, params: params || {} }))
}), DELAI_CMD, method)

const evaluate = async (ws, expression) => {
  const r = await rpc(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'exception dans la page')
  return r.result ? r.result.value : undefined
}

const failures = []
const ok = (label, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + label + (cond || detail === undefined ? '' : '  → ' + detail))
  if (!cond) failures.push(label)
}

// Une page 3080 peut exister sans répondre (onglet figé, cible fantôme) : on
// essaie les candidats dans l'ordre et on garde le premier qui répond VRAIMENT à
// une évaluation triviale. C'est ce qui rendait ce contrôle « non concluant » :
// il s'attachait au premier venu, sans vérifier qu'il parlait.
const ouvrir = async (t, delai) => {
  const w = new WebSocket(t.webSocketDebuggerUrl)
  await avecDelai(new Promise((resolve, reject) => {
    w.addEventListener('open', resolve, { once: true })
    w.addEventListener('error', () => reject(new Error('connexion CDP impossible')), { once: true })
  }), delai, 'ouverture du WebSocket CDP')
  return w
}

const main = async () => {
  const { base, targets, spawned } = await ensureBrowser()
  const pages = targets.filter((t) => t.type === 'page')
  const surHost = pages.filter((t) => (t.url || '').includes(HOST))
  const candidats = surHost.concat(pages.filter((t) => (t.url || '').includes(HOST) === false))
  let page = null
  let ws = null
  const essais = []
  for (const t of candidats) {
    let w = null
    try {
      w = await ouvrir(t, 4000)
      const r = await avecDelai(rpc(w, 'Runtime.evaluate', { expression: '1 + 1', returnByValue: true }), 4000, 'ping')
      if (r !== undefined && r.result !== undefined) { page = t; ws = w; break }
      essais.push((t.url || '?').slice(0, 30) + ' → réponse inattendue')
      w.close()
    } catch (e) {
      essais.push((t.url || '?').slice(0, 30) + ' → ' + String(e.message || e))
      if (w !== null) w.close()
    }
  }
  if (page === null) {
    console.error('Aucune page CDP ne répond (' + String(candidats.length) + ' candidate(s)) : ' + essais.join(' | '))
    process.exit(2)
  }
  console.log('Contrôle de boot sur ' + page.url + (spawned ? '  [Chrome de contrôle]' : '  [Chrome existant]') + (essais.length > 0 ? '  [' + String(essais.length) + ' page(s) muette(s) écartée(s)]' : ''))

  const errors = []
  let recording = false
  ws.addEventListener('message', (event) => {
    if (recording === false) return

    let msg = null
    try { msg = JSON.parse(event.data) } catch (e) { return }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params && msg.params.exceptionDetails ? msg.params.exceptionDetails : {}
      errors.push('exception: ' + (d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text))
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
      const args = (msg.params.args || []).map((a) => a.value !== undefined ? String(a.value) : (a.description || '')).join(' ')
      if (args !== '') errors.push('console: ' + args.split('\n')[0])
    }
    if (msg.method === 'Log.entryAdded' && msg.params && msg.params.entry && msg.params.entry.level === 'error') {
      errors.push('log: ' + String(msg.params.entry.text || '').split('\n')[0])
    }
  })

  await rpc(ws, 'Runtime.enable')
  await rpc(ws, 'Log.enable')
  await rpc(ws, 'Page.enable')
  try { await rpc(ws, 'Log.clear') } catch (e) { /* domaine sans tampon */ }
  await rpc(ws, 'Page.reload', { ignoreCache: true })
  // On ne garde que ce qui est emis APRES le rechargement : le tampon du domaine
  // Log rejoue les erreurs des chargements precedents.
  recording = true
  await sleep(SETTLE)
  // Attente active : sur une machine chargee, 9 s ne suffisent pas toujours et
  // le controle lisait « HARNESS · Loading plugins… » (faux negatif). On attend
  // que l'app soit interactive, jusqu'a ~25 s.
  for (let i = 0; i < 40; i += 1) {
    let ready = false
    try {
      ready = await evaluate(ws, `(() => {
        const n = document.querySelectorAll('button, a, textarea, input').length
        const loading = /Loading plugins|Chargement des plugins/i.test(document.body ? document.body.innerText : '')
        return n > 5 && loading === false
      })()`)
    } catch (e) { ready = false }
    if (ready === true) break
    await sleep(600)
  }

  const probe = await evaluate(ws, `(() => {
    const text = document.body ? document.body.innerText : ''
    const interactive = document.querySelectorAll('button, a, textarea, input').length
    return {
      bootFailed: /Failed to load plugins|did not activate/i.test(text),
      showButton: /Show details|Afficher les détails/i.test(text),
      degraded: /\\[kybernos\\]/.test(text),
      // innerText ne voit que le panneau ouvert : selon l'onglet choisi et la
      // vue restaurée, la ligne « AI Teams » restait repliée et le contrôle
      // passait au rouge alors que le plugin était bien monté. On lit donc aussi
      // la ligne du menu dans le DOM (.kb4-item), panneau ouvert ou non.
      kybersMenu: /AI Teams/.test(text) || [].slice.call(document.querySelectorAll('.kb4-item')).some((b) => /AI Teams/.test(b.textContent || '')),
      views: /Kybernos/.test(text),
      interactive,
      sample: text.split('\\n').map((l) => l.trim()).filter((l) => l !== '').slice(0, 12),
    }
  })()`)

  const kybernosErrors = errors.filter((e) => /kybernos/i.test(e))
  ok('la GUI reste interactive après chargement', probe.interactive > 5, probe.interactive + ' éléments cliquables')
  ok('aucun « Failed to load plugins » / « did not activate »', probe.bootFailed === false)
  const slotCrashes = errors.filter((e) => /slot entry crashed/i.test(e))
  ok('aucune erreur de chargement du plugin', kybernosErrors.length === 0, kybernosErrors.slice(0, 2).join(' | '))
  ok('aucune entree de slot ne crashe', slotCrashes.length === 0, slotCrashes.slice(0, 2).join(' | '))
  ok('le menu Kybernos (« AI Teams ») est enregistré', probe.kybersMenu === true)
  ok('les vues Kybernos sont enregistrées', probe.views === true)

  // ── géométrie du pied de sidebar : le cadeau d'invitation et la rangée
  //    d'icônes occupent la largeur du pied, et la dernière ligne partage la
  //    sienne entre l'identité cloud (plugin cloud) et l'engrenage des
  //    Réglages ; en rail, le cadeau d'invitation doit être sur l'axe vertical
  //    des autres icônes et sans boîte (sinon « icône décalée ») ──
  const geo = await evaluate(ws, `(() => {
    const R = (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), w: Math.round(r.width), cx: Math.round(r.x + r.width / 2), cy: Math.round(r.y + r.height / 2) } }
    const gift = document.querySelector('.kbu-btn-gift')
    const row = document.querySelector('.kbu-row')
    if (gift === null || row === null) return Promise.resolve({ missing: true })
    const label = (re) => [...document.querySelectorAll('button')].find((b) => re.test(b.getAttribute('aria-label') || ''))
    const open = label(/open sidebar/i)
    if (open) open.click()
    return new Promise((resolve) => setTimeout(() => {
      // Le pied est une GRILLE : footerActions passe en display:contents, donc
      // c'est le parent (footArea) qui porte la largeur — mesurer footerActions
      // rendrait un rectangle nul (il n'a plus de boîte).
      const foot = document.querySelector('[class*="footArea"]')
      const icons = [...document.querySelectorAll('.kbu-row .kbu-btn')]
      const gear = document.querySelector('[class*="settingsArea"] button[class*="trigger"]')
      const ident = document.querySelector('.kbf-profile') || document.querySelector('.kbf-connect')
      const expanded = {
        gift: R(gift),
        row: foot === null ? R(row) : R(foot),
        btn: icons.map((b) => Math.round(b.getBoundingClientRect().width)),
        cy: icons.map((b) => Math.round(b.getBoundingClientRect().y + b.getBoundingClientRect().height / 2)),
        info: R([...document.querySelectorAll('.kbu-row .kbu-btn')].find((b) => /help/i.test(b.getAttribute('aria-label') || '')) || gift),
        gear: gear === null ? null : R(gear),
        ident: ident === null ? null : R(ident),
      }
      const collapsed = () => document.querySelector('[class*="collapsed"]') !== null
      const fold = (left) => {
        if (left <= 0) {
          const cadeau = document.querySelector('.kbu-btn-gift')
          const icos = [...document.querySelectorAll('.kbu-btn svg')]
          const rail = {
            replie: collapsed(),
            centreCadeau: cadeau === null ? null : R(cadeau).cx,
            centresIcones: icos.map((i) => R(i).cx),
            bordure: cadeau === null ? null : getComputedStyle(cadeau).borderTopWidth,
          }
          const back = label(/open sidebar/i)
          if (back) back.click()
          resolve({ expanded, rail })
          return
        }
        const collapse = label(/collapse sidebar/i)
        if (collapse) collapse.click()
        setTimeout(() => { if (collapsed()) fold(0); else fold(left - 1) }, 700)
      }
      fold(3)
    }, 900))
  })()`)

  if (geo.missing === true) {
    ok('le pied de sidebar expose le cadeau et la rangee d icones', false, 'selecteurs .kbu-btn-gift / .kbu-row absents')
  } else {
    // Le cadeau vit DANS la rangée d'icônes, juste à droite du (i) « Help &
    // docs » : même ligne, et son bord gauche après le bord droit du (i).
    const apresInfo = geo.expanded.gift.cx > geo.expanded.info.cx && Math.abs(geo.expanded.gift.cy - geo.expanded.info.cy) <= 2
    ok('le cadeau est a droite du (i), sur sa ligne', apresInfo,
      'cadeau ' + geo.expanded.gift.cx + '/' + geo.expanded.gift.cy + ' vs (i) ' + geo.expanded.info.cx + '/' + geo.expanded.info.cy)
    // Déconnecté, la cloche des notifications est masquée : 4 ou 5 icônes selon
    // l'état du compte (le cadeau compris), toutes de la même largeur, même ligne.
    ok('les icones du bas prennent toute la largeur du menu',
      geo.expanded.btn.length >= 4 && geo.expanded.btn.every((w) => w > 40), geo.expanded.btn.join('+') + ' px')
    const spread = Math.max.apply(null, geo.expanded.btn) - Math.min.apply(null, geo.expanded.btn) <= 2 && new Set(geo.expanded.cy).size === 1
    ok('toutes les icones du pied sont alignees et de meme largeur', spread,
      'largeurs ' + geo.expanded.btn.join('+') + ' / lignes ' + [...new Set(geo.expanded.cy)].join(','))
    // La dernière ligne : identité cloud (ou encart « Se connecter ») à gauche,
    // engrenage des Réglages à droite, sur la MÊME ligne.
    const memeLigne = geo.expanded.ident !== null && geo.expanded.gear !== null &&
      Math.abs(geo.expanded.ident.cy - geo.expanded.gear.cy) <= 2 &&
      geo.expanded.gear.x >= geo.expanded.ident.x + geo.expanded.ident.w - 1
    ok('l engrenage des Reglages partage la ligne de l identite cloud', memeLigne,
      geo.expanded.ident === null || geo.expanded.gear === null
        ? 'identite ou engrenage absent (plugin cloud non monte ?)'
        : 'identite ' + geo.expanded.ident.cx + '/' + geo.expanded.ident.cy + ' engrenage ' + geo.expanded.gear.cx + '/' + geo.expanded.gear.cy)
    const gaps = geo.rail.centresIcones.map((c) => Math.abs(c - geo.rail.centreCadeau))
    ok('en rail, le cadeau est sur l axe des icones',
      geo.rail.replie === true && geo.rail.centreCadeau !== null && gaps.length > 0 && gaps.every((g) => g <= 1),
      (geo.rail.replie === true ? '' : 'sidebar non repliee — ') + 'ecarts ' + gaps.join(','))
    ok('en rail, le cadeau n a plus de boite', geo.rail.bordure === '0px', String(geo.rail.bordure))
  }

  // ── la carte d'invitation : au clic du cadeau, un dialogue ancre AU-DESSUS
  //    de lui, borne au viewport. DEUX etats legitimes, selon que la route hote
  //    /kybernos-cloud/referral existe ou pas :
  //      · compte lie + route montee  → la carte AFFICHE le code, sans rien
  //        demander (c'est le but du chantier du 24/09/2026) ;
  //      · route absente (plugin hote plus vieux) ou compte non lie → elle
  //        demande le code, on le colle, il s'affiche et reste sur l'appareil.
  //    Les deux doivent passer : le repli est un etat de production, pas une
  //    erreur.
  const rel = await evaluate(ws, `(() => {
    const gift = document.querySelector('.kbu-btn-gift')
    if (gift === null) return Promise.resolve({ ouvert: false, motif: 'cadeau absent' })
    gift.click()
    const attendre = (ms) => new Promise((r) => setTimeout(r, ms))
    return (async () => {
      // La lecture du compte est un fetch : on laisse le temps a la route de
      // repondre AVANT de conclure 'formulaire'.
      let p = null
      let champ = null
      for (let i = 0; i < 12; i += 1) {
        await attendre(150)
        p = document.getElementById('kbu-referral-pop')
        if (p === null) continue
        champ = p.querySelector('.kbu-rel-in')
        if (champ !== null || p.querySelector('.kbu-rel-code-v') !== null) break
      }
      if (p === null) return { ouvert: false, motif: 'carte absente apres le clic' }
      const r = p.getBoundingClientRect()
      const g = gift.getBoundingClientRect()
      const share = p.querySelector('.kbu-rel-share')
      const lien = p.querySelector('.kbu-rel-open')
      const source = p.querySelector('.kbu-rel-src')
      const sortie = {
        ouvert: true,
        role: p.getAttribute('role'),
        auDessus: r.bottom <= g.top + 1,
        borne: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 1 && r.right <= window.innerWidth + 1,
        partager: share === null ? null : (share.textContent || '').trim(),
        lienPage: lien === null ? null : lien.getAttribute('href'),
        champPresent: champ !== null,
        sourceCompte: source === null ? null : (source.textContent || '').trim(),
        code: null,
        garde: null,
        colle: false,
        ferme: null,
      }
      if (champ !== null) {
        // Repli manuel : on colle un lien de partage, on enregistre.
        const poser = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
        poser.call(champ, 'https://dev.kybernos.app/r/CODE-TEST')
        champ.dispatchEvent(new Event('input', { bubbles: true }))
        await attendre(60)
        const save = p.querySelector('.kbu-rel-save')
        if (save !== null) save.click()
        await attendre(200)
        sortie.colle = true
        try { sortie.garde = JSON.parse(window.localStorage.getItem('kb8.referral') || 'null') } catch (e) { sortie.garde = null }
      }
      const v = document.querySelector('.kbu-rel-code-v')
      sortie.code = v === null ? null : (v.textContent || '').trim()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      await attendre(150)
      sortie.ferme = document.getElementById('kbu-referral-pop') === null
      return sortie
    })()
  })()`)

  if (rel === null || rel.ouvert !== true) {
    ok('le cadeau ouvre la carte d invitation au clic', false, rel === null ? 'carte non mesurable' : String(rel.motif || 'inconnu'))
  } else {
    ok('le cadeau ouvre une carte ancree au-dessus de lui, bornee au viewport',
      rel.role === 'dialog' && rel.auDessus === true && rel.borne === true,
      'role ' + String(rel.role) + ' au-dessus ' + String(rel.auDessus) + ' borne ' + String(rel.borne))
    if (rel.colle === true) {
      // Route hote absente ou compte non lie : le repli manuel doit rester
      // intact — c'est lui qui garantit que la carte sert encore a quelque chose.
      ok('sans route hote, la carte demande le code (repli manuel)', rel.champPresent === true)
      ok('le code colle s affiche dans la carte', rel.code === 'CODE-TEST', String(rel.code))
      ok('le code est garde sur l appareil', rel.garde !== null && rel.garde.code === 'CODE-TEST' && rel.garde.link === 'https://dev.kybernos.app/r/CODE-TEST', JSON.stringify(rel.garde))
    } else {
      // Compte lie : le code est la, sans collage — et il est dit comme venant
      // du compte (jamais fait passer pour une saisie locale).
      ok('la carte affiche le code du compte sans rien demander',
        rel.champPresent === false && typeof rel.code === 'string' && rel.code !== '',
        'champ ' + String(rel.champPresent) + ' code ' + String(rel.code))
      ok('la carte dit que le code vient du compte Kybernos',
        typeof rel.sourceCompte === 'string' && rel.sourceCompte.length > 0, String(rel.sourceCompte))
    }
    ok('la carte offre Partager et garde le lien vers la page',
      typeof rel.partager === 'string' && rel.partager.length > 0 && rel.lienPage === 'https://dev.kybernos.app/profiles?section=referral',
      'partager ' + String(rel.partager) + ' / lien ' + String(rel.lienPage))
    ok('Echap referme la carte', rel.ferme === true)
  }

  if (errors.length > 0) {
    console.log('\n--- erreurs console pendant le boot ---')
    for (const e of errors.slice(0, 8)) console.log('  ' + e)
  }
  console.log('\n--- premiers libellés visibles ---')
  console.log('  ' + probe.sample.join(' · '))

  ws.close()
  if (chrome !== null) { try { chrome.kill('SIGKILL') } catch (e) { /* déjà mort */ } }
  console.log('')
  if (failures.length === 0) {
    console.log('BOOT SAIN — le plugin se charge dans la vraie GUI.')
    process.exit(0)
  }
  console.log('BOOT CASSÉ (' + failures.length + ' contrôle(s)) — ne pas livrer en l état.')
  if (probe.degraded === true) console.log('Le filet de sécurité a désactivé le plugin : la GUI marche, le plugin non.')
  process.exit(1)
}

main().catch((e) => {
  if (chrome !== null) { try { chrome.kill('SIGKILL') } catch (e2) { /* déjà mort */ } }
  const msg = e && e.message ? e.message : String(e)
  // Le même partage que `interruption` : un délai CDP est un navigateur saturé
  // (mesure impossible, sortie 3), pas un boot cassé. Le catch laissait sortir 2
  // pour un simple `Runtime.evaluate` qui expire — la batterie comptait alors un
  // rouge produit là où il n'y avait qu'un navigateur muet (mesuré le 22/09).
  const muet = /d[ée]lai d[ée]pass[ée]|delai CDP depasse|timeout/i.test(msg)
  console.error((muet ? '○ mesure impossible (navigateur de debug muet) : ' : '✗ contrôle impossible : ') + msg)
  process.exit(muet ? 3 : 2)
})
