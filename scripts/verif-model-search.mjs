// ── Preuve : la recherche du sélecteur de modèle, dans la GUI réelle ─────────
//
// Rejoue le parcours depuis l'interface et compare ce qui s'AFFICHE à un oracle
// recalculé dans la page à partir de la liste complète :
//   1. une session ouverte (le siège modèle exige une session) ;
//   2. clic sur le siège → clic sur « Modèle » → le champ de recherche apparaît
//      et prend le focus (et il n'existe pas dans le panneau racine) ;
//   3. une requête filtre la liste exactement comme la règle annoncée : un groupe
//      survit en entier si son nom ou son identifiant répond, sinon seuls ses
//      modèles qui répondent (nom ou identifiant) restent, ordre conservé ;
//   4. une requête sans réponse affiche le message et zéro modèle ;
//   5. l'effacement rend la liste complète ;
//   6. clavier : Échap vide la requête sans quitter le panneau, ↓ va au premier
//      modèle, deux Échap de plus remontent puis ferment ;
//   7. Entrée choisit le PREMIER résultat — prouvé par un intercepteur de clic
//      en phase de capture, donc sans changer le modèle de la session.
//
// La session ouverte est celle que la GUI tient déjà pour courante : la preuve
// n'ouvre aucune session nouvelle (si la page n'affiche que la barre latérale,
// on clique la ligne `aria-selected=true`).
//
// Usage :
//   node scripts/verif-model-search.mjs              # choisit une page 3080 prête
//   node scripts/verif-model-search.mjs --page <id>  # une page CDP précise
//   node scripts/verif-model-search.mjs --capture <préfixe>  # + deux captures PNG
//
// Sortie : 0 = toutes les preuves passent ; 1 = au moins un écart.
import { connect } from './cdp-lib.mjs'

const CDP = process.env.KB_CDP || 'http://127.0.0.1:9333'
const args = process.argv.slice(2)
const iP = args.indexOf('--page')
const PAGE = iP >= 0 ? args[iP + 1] : undefined
const iC = args.indexOf('--capture')
const CAPTURE = iC >= 0 ? args[iC + 1].replace(/\.png$/, '') : undefined

const dit = (t) => console.log(t)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const preuves = []
const verifier = (nom, ok, detail) => {
  preuves.push({ nom: nom, ok: ok === true, detail: detail === undefined ? '' : String(detail) })
  dit('  ' + (ok === true ? '✓' : '✗') + ' ' + nom + (detail === undefined || detail === '' ? '' : ' — ' + detail))
  return ok === true
}

// ── Les aides installées dans la page ───────────────────────────────────────
// Le menu du sélecteur est un portail à document.body ; son préfixe de classes
// (`_7KE1Ra_`) est aussi le marqueur du bundle patché. `data-model-id` et
// `data-provider-id` sont posés par le patch : ils donnent à l'oracle la même
// matière que la règle de filtrage.
const AIDES = `
window.__KBMS = (function () {
  var menu = function () { return document.querySelector('[class*="_7KE1Ra_menu"]') }
  var champ = function () { var m = menu(); return m === null ? null : m.querySelector('input[type=search]') }
  var api = {
    menu: menu,
    champ: champ,
    cellules: function () { return menu() === null ? [] : [].slice.call(menu().querySelectorAll('button[role=menuitem]')) },
    modeles: function () { return menu() === null ? [] : [].slice.call(menu().querySelectorAll('[role=menuitemradio]')) },
    vide: function () { var m = menu(); return m === null ? '' : (m.querySelector('[class*="_7KE1Ra_empty"]') || { textContent: '' }).textContent },
    effacer: function () { var m = menu(); return m === null ? false : m.querySelector('[class*="_7KE1Ra_searchClear"]') !== null },
    cliquer: function (el) { el.click(); return true },
    /* Le siège réellement cliquable : visible, dans la fenêtre, et non recouvert
       (une page restée sur Réglages garde le composeur monté sous l’overlay). */
    clique: function () {
      var bs = [].slice.call(document.querySelectorAll('[class*="_7KE1Ra_trigger"]'))
      for (var i = 0; i < bs.length; i++) {
        var b = bs[i]
        var r = b.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) continue
        var el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        if (el !== null && (el === b || b.contains(el) || el.contains(b))) return b
      }
      return null
    },
    ouvrir: function () {
      var b = api.clique()
      if (b === null) return false
      b.click()
      return true
    },
    fore: function () {
      var c = api.cellules()
      if (c.length === 0) return false
      c[0].click()
      return true
    },
    etat: function () {
      return {
        menu: menu() !== null,
        champ: champ() !== null,
        focusChamp: champ() !== null && document.activeElement === champ(),
        cellules: api.cellules().length,
        modeles: api.modeles().length,
        requete: champ() === null ? null : champ().value,
        requeteVide: champ() === null ? null : champ().value.length === 0,
        vide: api.vide(),
        effacer: api.effacer()
      }
    },
    siege: function () {
      var b = api.clique()
      return b === null ? null : (b.textContent || '').trim()
    },
    /* Les sections visibles, telles que le DOM les porte : titre du groupe et,
       pour chaque modèle, libellé + identités (les mêmes que la recherche sonde). */
    sections: function () {
      var m = menu()
      if (m === null) return []
      var out = []
      var secs = [].slice.call(m.querySelectorAll('section[role=group]'))
      for (var i = 0; i < secs.length; i++) {
        var opts = [].slice.call(secs[i].querySelectorAll('[role=menuitemradio]'))
        var modeles = []
        for (var j = 0; j < opts.length; j++) modeles.push({
          nom: (opts[j].textContent || '').trim(),
          modeleId: opts[j].getAttribute('data-model-id') || '',
          fournisseurId: opts[j].getAttribute('data-provider-id') || ''
        })
        out.push({
          titre: (secs[i].querySelector('[class*="_7KE1Ra_groupTitle"]') || { textContent: '' }).textContent,
          modeles: modeles
        })
      }
      return out
    },
    taper: function (texte) {
      var i = champ()
      if (i === null) return false
      var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(i, texte)
      i.dispatchEvent(new Event('input', { bubbles: true }))
      return i.value
    },
    touche: function (cle) {
      var cible = document.activeElement || document.body
      cible.dispatchEvent(new KeyboardEvent('keydown', { key: cle, bubbles: true, cancelable: true }))
      return cible.tagName
    }
  }
  return api
})()
true`

// ── La règle de filtrage, rejouée hors de la page ───────────────────────────
const touche = (needle, texte) => typeof texte === 'string' && texte.toLowerCase().includes(needle)
/** Ordre et contenu attendus pour une requête, d'après la liste complète. */
const oracle = (sections, needle) => sections.map((sec) => {
  const fournisseur = sec.modeles.length > 0 ? sec.modeles[0].fournisseurId : ''
  const tout = touche(needle, sec.titre) || touche(needle, fournisseur)
  const modeles = tout ? sec.modeles : sec.modeles.filter((m) => touche(needle, m.nom) || touche(needle, m.modeleId))
  return { titre: sec.titre, modeles: modeles }
}).filter((sec) => sec.modeles.length > 0)
const noms = (sections) => sections.reduce((acc, sec) => acc.concat(sec.modeles.map((m) => m.nom)), [])

const lire = async (c, expression, ms) => {
  const r = await c.evalJs(expression, ms)
  return r.err !== undefined ? '__ERREUR__:' + r.err : r.val
}
const attendre = async (c, expression, timeoutMs) => {
  const fin = Date.now() + (timeoutMs || 10000)
  for (;;) {
    if ((await lire(c, expression, 8000)) === true) return true
    if (Date.now() > fin) return false
    await sleep(200)
  }
}
const json = async (c, expression, ms) => JSON.parse(await lire(c, expression, ms))

/** Ouvre la session courante dans une page qui n'affiche que la barre latérale. */
const ouvrirSessionCourante = async (c) => {
  const clic = await lire(c, `(function () {
    var libre = function (el) {
      if (el === undefined || el === null) return false
      var r = el.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) return false
      if (r.top < 0 || r.bottom > window.innerHeight) return false
      var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return hit !== null && (el.contains(hit) || hit.contains(el))
    }
    var rangs = [].slice.call(document.querySelectorAll('[class*=sessionRow]')).filter(libre)
    var r = rangs.filter(function (x) { return x.getAttribute('aria-selected') === 'true' })[0] || rangs[0]
    if (r === undefined) return false
    var cible = r.querySelector('[class*=title]') || r
    var seq = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']
    for (var i = 0; i < seq.length; i++) {
      var T = seq[i].indexOf('pointer') === 0 ? PointerEvent : MouseEvent
      cible.dispatchEvent(new T(seq[i], { bubbles: true, cancelable: true, view: window, button: 0, buttons: seq[i].indexOf('down') > 0 ? 1 : 0 }))
    }
    return true
  })()`, 8000)
  if (clic !== true) return false
  return await attendre(c, `window.__KBMS.clique() !== null`, 12000)
}

const liste = await (await fetch(CDP + '/json/list')).json()
const pages = liste.filter((t) => t.type === 'page' && t.url.startsWith('http://127.0.0.1:3080'))
const candidates = PAGE !== undefined ? pages.filter((p) => p.id === PAGE) : pages
if (candidates.length === 0) {
  dit('✗ aucune page 3080' + (PAGE === undefined ? '' : ' d’id ' + PAGE) + ' — ouvrir la GUI sur http://127.0.0.1:3080/')
  process.exit(1)
}
let c = null
let page = null
for (const p of candidates) {
  const essai = await connect(p)
  await lire(essai, AIDES, 8000)
  if ((await lire(essai, `window.__KBMS.clique() !== null`, 6000)) === true) {
    c = essai
    page = p
    break
  }
  if ((await ouvrirSessionCourante(essai)) === true) {
    c = essai
    page = p
    break
  }
  essai.close()
}
if (c === null) {
  dit('✗ aucune page 3080 ne porte de siège modèle, et aucune session n’a pu être ouverte.')
  dit('  ouvrir la GUI sur 127.0.0.1:3080/ avec une conversation affichée, puis relancer.')
  process.exit(1)
}
dit('preuve de la recherche du sélecteur de modèle — page ' + page.id)

try {
  // Marqueur de vie : s'il disparaît, la page a été rechargée (HMR) en pleine
  // preuve et les étapes suivantes ne veulent plus rien dire.
  await lire(c, 'window.__KBMS_RUN = Date.now(); true', 8000)

  // Un éventuel menu resté ouvert d’un run précédent : Échap jusqu'à fermeture.
  for (let i = 0; i < 3; i += 1) {
    if ((await lire(c, 'window.__KBMS.menu() === null', 8000)) === true) break
    await lire(c, `window.__KBMS.touche('Escape')`, 8000)
    await sleep(200)
  }
  await lire(c, AIDES, 8000)

  // ── 1. Le siège porte le bundle patché ────────────────────────────────────
  const siegeAvant = await lire(c, 'window.__KBMS.siege()', 8000)
  verifier('un siège modèle est visible dans le composeur', typeof siegeAvant === 'string' && siegeAvant.length > 0, String(siegeAvant).slice(0, 60))

  const ouvert = await lire(c, 'window.__KBMS.ouvrir()', 8000)
  const menuOuvert = await attendre(c, 'window.__KBMS.menu() !== null', 5000)
  verifier('le clic ouvre le menu du sélecteur', ouvert === true && menuOuvert === true)
  const racine = await lire(c, 'window.__KBMS.etat()', 8000)
  verifier('le panneau racine (Modèle / Effort) n’a pas de champ de recherche', racine.champ === false && racine.cellules >= 1, 'cellules ' + racine.cellules)

  // ── 2. Forer dans « Modèle » : le champ apparaît et prend le focus ────────
  const fore = await lire(c, 'window.__KBMS.fore()', 8000)
  const champ = await attendre(c, 'window.__KBMS.champ() !== null', 8000)
  if (verifier('le panneau « Modèle » offre un champ de recherche', fore === true && champ === true)) {
    const etat = await lire(c, 'window.__KBMS.etat()', 8000)
    verifier('le champ de recherche prend le focus à l’ouverture du panneau', etat.focusChamp === true)
    const aides = await lire(c, `(function () { var i = window.__KBMS.champ(); return JSON.stringify({ placeholder: i.placeholder, aria: i.getAttribute('aria-label'), type: i.type, autocomplete: i.getAttribute('autocomplete') }) })()`, 8000)
    const a = JSON.parse(aides)
    verifier('le champ est un vrai champ de recherche nommé', a.type === 'search' && a.placeholder.length > 0 && a.aria.length > 0, JSON.stringify(a))
  } else {
    dit('  · champ absent — le bundle patché n’est peut-être pas chargé : recharger la page de la GUI')
  }

  verifier('la liste des modèles est chargée', (await attendre(c, 'window.__KBMS.modeles().length > 0', 15000)) === true)
  const complet = await json(c, 'JSON.stringify(window.__KBMS.sections())', 8000)
  const total = noms(complet).length

  // ── 3. Une requête filtre exactement (oracle recalculé) ───────────────────
  // La requête est un fragment d’un libellé réel, choisi pour réduire la liste :
  // le catalogue peut ne contenir ni « glm » ni « kimi » selon l’installation.
  let requete = null
  let vu = null
  let attendu = null
  for (const modele of noms(complet)) {
    const fragment = modele.slice(0, 4).trim().toLowerCase()
    if (fragment.length < 3) continue
    const attenduEssai = oracle(complet, fragment)
    const vuEssai = await json(c, `window.__KBMS.taper(${JSON.stringify(fragment)}); JSON.stringify(window.__KBMS.sections())`, 8000)
    if (attenduEssai.length > 0 && noms(attenduEssai).length < total) {
      requete = fragment
      attendu = attenduEssai
      vu = vuEssai
      break
    }
  }
  if (requete !== null) {
    const meme = JSON.stringify({ g: vu.map((s) => s.titre), n: noms(vu) }) === JSON.stringify({ g: attendu.map((s) => s.titre), n: noms(attendu) })
    verifier('« ' + requete + ' » filtre la liste comme la règle annoncée', meme === true, noms(vu).length + ' modèle(s) sur ' + total + (meme === true ? ' · groupes ' + vu.map((s) => s.titre).join(', ') : ' — attendu ' + JSON.stringify(noms(attendu))))
    verifier('la recherche réduit bien la liste', noms(vu).length > 0 && noms(vu).length < total, noms(vu).length + ' < ' + total)
  } else {
    verifier('une requête réelle réduit la liste', false, 'aucun fragment de libellé ne réduit ce catalogue de ' + total + ' modèles')
  }

  // ── 4. Une requête sans réponse : message, zéro modèle ────────────────────
  await lire(c, `window.__KBMS.taper('zzzzz')`, 8000)
  await sleep(150)
  const vide = await lire(c, 'window.__KBMS.etat()', 8000)
  verifier('une requête sans réponse n’affiche aucun modèle', vide.modeles === 0, String(vide.modeles))
  verifier('une requête sans réponse affiche le message avec la requête', vide.vide.indexOf('zzzzz') >= 0, String(vide.vide).slice(0, 70))
  verifier('le bouton d’effacement apparaît avec une requête', vide.effacer === true)
  if (CAPTURE !== undefined) {
    verifier('capture de l’état sans réponse', (await c.shot(CAPTURE + '-vide.png')) === true, CAPTURE + '-vide.png')
  }

  // ── 5. L’effacement rend la liste complète ────────────────────────────────
  await lire(c, `window.__KBMS.cliquer(window.__KBMS.menu().querySelector('[class*="_7KE1Ra_searchClear"]'))`, 8000)
  await sleep(150)
  const efface = await lire(c, 'window.__KBMS.etat()', 8000)
  verifier('l’effacement vide la requête', efface.requeteVide === true)
  verifier('l’effacement rend la liste complète', efface.modeles === total, efface.modeles + ' = ' + total)
  verifier('l’effacement laisse le focus dans le champ', efface.focusChamp === true)

  // ── 6. Clavier : Échap vide la requête, puis remonte, puis ferme ──────────
  await lire(c, `window.__KBMS.taper('gl')`, 8000)
  await sleep(150)
  const avantEchap = await lire(c, 'window.__KBMS.etat()', 8000)
  await lire(c, `window.__KBMS.touche('Escape')`, 8000)
  await sleep(250)
  const apresEchap = await lire(c, 'window.__KBMS.etat()', 8000)
  verifier('Échap vide d’abord la requête sans quitter le panneau', apresEchap.requeteVide === true && apresEchap.champ === true && apresEchap.menu === true, 'avant ' + JSON.stringify(avantEchap.requete) + ' → après ' + JSON.stringify(apresEchap.requete) + ', panneau ' + (apresEchap.champ === true ? 'modèle' : 'autre'))

  await lire(c, `window.__KBMS.touche('ArrowDown')`, 8000)
  await sleep(200)
  const focusOption = await lire(c, `document.activeElement !== null && document.activeElement.getAttribute('role') === 'menuitemradio'`, 8000)
  const cible = await lire(c, `document.activeElement === null ? '' : (document.activeElement.textContent || '').trim()`, 8000)
  verifier('↓ depuis le champ va au premier modèle', focusOption === true, String(cible).slice(0, 50))

  await lire(c, `window.__KBMS.touche('Escape')`, 8000)
  await sleep(250)
  const retour = await lire(c, 'window.__KBMS.etat()', 8000)
  verifier('Échap remonte au panneau racine (cellules Modèle / Effort)', retour.champ === false && retour.cellules >= 1, JSON.stringify(retour))

  await lire(c, `window.__KBMS.touche('Escape')`, 8000)
  await sleep(250)
  const ferme = await lire(c, 'window.__KBMS.etat()', 8000)
  verifier('Échap ferme le menu', ferme.menu === false)

  // ── 7. Entrée choisit le premier résultat (sans changer le modèle) ───────
  await lire(c, 'window.__KBMS.ouvrir()', 8000)
  await attendre(c, 'window.__KBMS.menu() !== null', 5000)
  await lire(c, 'window.__KBMS.fore()', 8000)
  await attendre(c, 'window.__KBMS.champ() !== null', 8000)
  await attendre(c, 'window.__KBMS.modeles().length > 0', 15000)
  await lire(c, `window.__KBMS.taper(${JSON.stringify(requete === null ? 'gl' : requete)})`, 8000)
  await sleep(200)
  const cibles = noms(await json(c, 'JSON.stringify(window.__KBMS.sections())', 8000))
  await lire(c, `(function () {
    window.__KBMS_CLIC = null
    window.__KBMS_ECOUTE = function (e) {
      var o = e.target && e.target.closest ? e.target.closest('[role=menuitemradio]') : null
      window.__KBMS_CLIC = o === null ? '(hors modèle)' : (o.textContent || '').trim()
      e.preventDefault()
      e.stopPropagation()
    }
    document.addEventListener('click', window.__KBMS_ECOUTE, true)
    return true
  })()`, 8000)
  await lire(c, `window.__KBMS.touche('Enter')`, 8000)
  await sleep(250)
  const intercepte = await lire(c, 'window.__KBMS_CLIC', 8000)
  await lire(c, `(function () { document.removeEventListener('click', window.__KBMS_ECOUTE, true); return true })()`, 8000)
  const siegeApres = await lire(c, 'window.__KBMS.siege()', 8000)
  verifier('Entrée vise le premier résultat de la liste filtrée', cibles.length > 0 && String(intercepte) === cibles[0], String(intercepte).slice(0, 50) + ' / ' + String(cibles[0]).slice(0, 50))
  verifier('rien n’a été choisi : le siège affiche toujours le même modèle', siegeApres === siegeAvant, String(siegeApres).slice(0, 60))
  if (CAPTURE !== undefined) {
    verifier('capture de la liste filtrée', (await c.shot(CAPTURE + '.png')) === true, CAPTURE + '.png')
  }

  // Refermer proprement le menu.
  await lire(c, `window.__KBMS.touche('Escape')`, 8000)
  await sleep(150)
  await lire(c, `window.__KBMS.touche('Escape')`, 8000)

  // ── 8. La page n’a pas été rechargée en pleine preuve ─────────────────────
  const intact = await lire(c, 'typeof window.__KBMS_RUN === "number"', 8000)
  verifier('la page n’a pas été rechargée pendant la preuve', intact === true, intact === true ? '' : 'rechargement détecté (HMR) — relancer la preuve sur une page stable')
} catch (e) {
  verifier('la preuve s’est déroulée sans exception', false, String(e && e.message ? e.message : e))
} finally {
  try {
    await lire(c, `window.__KBMS && window.__KBMS.menu() !== null && window.__KBMS.touche('Escape')`, 4000)
  } catch (e) { /* fermeture best-effort */ }
  c.close()
}

const rouges = preuves.filter((p) => p.ok !== true)
dit('')
dit(preuves.length + ' preuves, ' + rouges.length + ' rouge(s)')
for (const r of rouges) dit('  ✗ ' + r.nom + (r.detail === '' ? '' : ' — ' + r.detail))
process.exit(rouges.length === 0 ? 0 : 1)
