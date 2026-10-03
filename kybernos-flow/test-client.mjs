#!/usr/bin/env node
/**
 * Harnais de la moitié CLIENTE de `kybernos-flow` (la poignée de la file).
 *
 *   1. toujours : les fonctions pures (couture de dépôt, confrontation avec la
 *      file de l'hôte, aperçus) — aucun navigateur, aucune dépendance ;
 *   2. si `jsdom` est résolvable (ou KYBERNOS_JSDOM=<chemin de l'entrée>) : le
 *      geste rejoué sur un DOM qui reproduit le `QueueDock` natif (attribut
 *      `data-queue-dock`, `ul > li`, classes hachées à suffixe), avec un `fetch`
 *      factice qui note les requêtes. Sinon la passe est annoncée « non jouée ».
 *
 * Usage : node kybernos-flow/test-client.mjs
 */
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (nom, condition, detail) => {
  if (condition === true) { pass += 1; console.log('  ✓ ' + nom) } else { fail += 1; console.log('  ✗ ' + nom + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SOURCE = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let definition
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
new Function('window', SOURCE)(globalThis.window)
const modele = definition.factory()
const T = modele.__test

console.log('\n── client : le chargeur ──')
check('id = @local/kybernos-flow', definition.id === '@local/kybernos-flow')
check('déclare le service uiWorkspace', Array.isArray(modele.inject) && modele.inject.includes('uiWorkspace'))
{
  let leve = false
  try { modele.apply({ effect () { throw new Error('ne doit pas être appelé') }, get () {} }) } catch { leve = true }
  check('apply hors navigateur (pas de document) : sans effet, sans lever', leve === false)
}

console.log('\n── client : fonctions pures ──')
check('aperçu identique', T.memeApercu('Bonjour  le monde', 'bonjour le monde') === true)
check('aperçu : préfixe de 12 caractères', T.memeApercu('message numéro 1 — suite tronquée…', 'message numéro 1') === true)
check('aperçu différent → faux', T.memeApercu('autre chose', 'message numéro 1') === false)
check('aperçu vide d’un côté (pièce jointe seule) : on ne tranche pas', T.memeApercu('', 'texte') === true && T.memeApercu('texte', '') === true)
const rects = [{ top: 100, height: 36 }, { top: 136, height: 36 }]
check('dépôt : au-dessus de la liste → avant la 1re', T.cibleDeDepot(rects, 90) === 0)
check('dépôt : moitié haute de la 1re → avant elle', T.cibleDeDepot(rects, 110) === 0)
check('dépôt : moitié basse de la 1re → avant la 2e (pas de bande morte)', T.cibleDeDepot(rects, 120) === 1)
check('dépôt : moitié haute de la 2e → avant elle', T.cibleDeDepot(rects, 150) === 1)
check('dépôt : moitié basse de la dernière → fin de file', T.cibleDeDepot(rects, 160) === 2)
check('dépôt : très bas → fin de file', T.cibleDeDepot(rects, 900) === 2)
{
  let toutesDefinies = true
  for (let y = 0; y < 300; y += 1) if (typeof T.cibleDeDepot(rects, y) !== 'number') toutesDefinies = false
  check('dépôt : TOUTE ordonnée porte une cible (le défaut du 23/09 ne peut pas revenir)', toutesDefinies)
}
check('déplacement inutile : sur soi (de=0,cible=0)', T.deplacementUtile(0, 0) === false)
check('déplacement inutile : juste après soi (de=0,cible=1)', T.deplacementUtile(0, 1) === false)
check('déplacement utile : 0 → 2', T.deplacementUtile(0, 2) === true)
check('déplacement utile : 2 → 0', T.deplacementUtile(2, 0) === true)
check('déplacement inutile : dernière → fin', T.deplacementUtile(2, 3) === false)

const hote = [
  { id: 'a', lane: 'next-turn', index: 0, preview: 'premier' },
  { id: 'b', lane: 'next-turn', index: 1, preview: 'deuxième' },
  { id: 'c', lane: 'next-turn', index: 2, preview: 'troisième' },
  { id: 'z', lane: 'next-step', index: 0, preview: 'ailleurs' },
]
let v = T.resoudre(hote, ['premier', 'deuxième', 'troisième'], 2, 0)
check('résoudre : 3e avant la 1re → ids (c, a)', v.ok === true && v.messageId === 'c' && v.beforeId === 'a', v)
v = T.resoudre(hote, ['premier', 'deuxième', 'troisième'], 0, 3)
check('résoudre : 1re en fin de file → beforeId null', v.ok === true && v.messageId === 'a' && v.beforeId === null, v)
v = T.resoudre(hote, ['premier', 'deuxième'], 0, 2)
check('résoudre : file périmée (3 côté hôte, 2 à l’écran) → refus', v.ok === false && v.raison.startsWith('file-perimee'), v)
v = T.resoudre(hote, ['premier', 'autre', 'troisième'], 1, 0)
check('résoudre : aperçu de la ligne tenue différent → refus', v.ok === false && v.raison === 'apercu-different', v)
v = T.resoudre(hote, ['premier', 'deuxième', 'troisième'], 5, 0)
check('résoudre : indice hors file → refus', v.ok === false && v.raison === 'indices-hors-file', v)
v = T.resoudre(undefined, [], 0, 0)
check('résoudre : réponse de l’hôte illisible → refus sans lever', v.ok === false)

// ═══ Passe DOM (jsdom, facultative) ═════════════════════════════════════════
console.log('\n── client : le geste sur un DOM de QueueDock ──')
let JSDOM
try { ({ JSDOM } = await import(process.env.KYBERNOS_JSDOM ?? 'jsdom')) } catch { JSDOM = undefined }
if (JSDOM === undefined) {
  console.log('  · non jouée — jsdom introuvable (KYBERNOS_JSDOM=<chemin de l’entrée jsdom> pour la jouer)')
} else {
  const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:3080/' })
  const w = dom.window
  let def2
  w.__ModuleLoader__ = { load: (d) => { def2 = d } }
  new Function('window', SOURCE)(w)
  globalThis.document = w.document
  globalThis.MutationObserver = w.MutationObserver

  // Réseau factice : la file « vue par l'hôte » est pilotée par le test.
  const requetes = []
  let hote = { supported: true, items: [] }
  globalThis.fetch = async (url, opts = {}) => {
    const methode = opts.method ?? 'GET'
    requetes.push({ url: String(url), methode, corps: opts.body === undefined ? undefined : JSON.parse(opts.body) })
    const corps = methode === 'GET' ? hote : { ok: true, deplace: true }
    return { ok: true, json: async () => corps }
  }
  const file = (n) => ({ supported: true, items: Array.from({ length: n }, (_, i) => ({ id: 'id' + String.fromCharCode(97 + i), lane: 'next-turn', index: i, preview: 'message ' + (i + 1) })) })

  const dock = w.document.createElement('div')
  dock.setAttribute('data-queue-dock', '')
  const monter = (n, { pending = 0 } = {}) => {
    const ligne = (i, cls) => '<li class="' + cls + '"><span class="_7yHdaG_preview">message ' + (i + 1) + '</span><div class="_7yHdaG_actions"><button type="button">edit</button></div></li>'
    let html = '<div class="_7yHdaG_panel"><button class="_7yHdaG_header">' + n + ' queued</button><ul class="_7yHdaG_list">'
    for (let i = 0; i < n; i += 1) html += ligne(i, '_7yHdaG_row')
    for (let i = 0; i < pending; i += 1) html += '<li class="_7yHdaG_pendingRow"><span class="_7yHdaG_preview">envoi…</span></li>'
    dock.innerHTML = html + '</ul></div>'
    Array.from(dock.querySelectorAll('li')).forEach((li, i) => { li.getBoundingClientRect = () => ({ top: 100 + 36 * i, height: 36 }) })
  }
  const poignees = () => Array.from(dock.querySelectorAll('[data-kb="queue-drag-handle"]'))
  const evt = (type, init = {}) => new w.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...init })

  monter(3, { pending: 1 })
  w.document.body.appendChild(dock)
  const sessionId = 's-dom'
  const instance = def2.factory()
  const effets = []
  instance.apply({
    effect: (fn) => { effets.push(fn()) },
    get: (cle) => (cle === 'uiWorkspace' ? { mainReference: { sessionId } } : undefined),
  })

  hote = { supported: false, items: [], reason: 'mutate-absente' }
  await attendre(200)
  check('hôte sans la capacité : AUCUNE poignée (l’UI ne promet pas un geste vain)', poignees().length === 0)
  check('…et la sonde a bien interrogé la route', requetes.some((r) => r.methode === 'GET' && r.url.includes('/kybernos/queue-move?sessionId=' + sessionId)))

  // Le verdict est mis en cache 10 s : on repart d'une instance neuve pour la suite.
  effets.forEach((off) => { if (typeof off === 'function') off() })
  hote = file(3)
  const inst2 = def2.factory()
  inst2.apply({ effect: (fn) => { effets.push(fn()) }, get: (cle) => (cle === 'uiWorkspace' ? { mainReference: { sessionId: 's-dom-2' } } : undefined) })
  w.document.body.appendChild(w.document.createElement('i')) // provoque un balayage
  await attendre(250)
  check('hôte capable : une poignée par message admis (3), aucune sur la bande « en cours d’envoi »', poignees().length === 3, poignees().length)
  check('poignée : accessible (role=button, tabindex=0, aria-label)', poignees().every((p) => p.getAttribute('role') === 'button' && p.getAttribute('tabindex') === '0' && p.getAttribute('aria-label').length > 10))
  check('poignée en tête de ligne', dock.querySelectorAll('li')[0].firstChild === poignees()[0])
  const avant = poignees().length
  w.document.body.appendChild(w.document.createElement('i'))
  await attendre(200)
  check('idempotent : un second balayage ne duplique rien', poignees().length === avant)

  // Clavier : Alt+↓ sur la 1re → avant la 3e (de+2).
  requetes.length = 0
  poignees()[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
  await attendre(120)
  let post = requetes.find((r) => r.methode === 'POST')
  check('Alt+↓ : lit la file puis POSTe (a avant c)', requetes[0]?.methode === 'GET' && post?.corps.messageId === 'ida' && post?.corps.beforeId === 'idc' && post?.corps.sessionId === 's-dom-2', requetes)
  requetes.length = 0
  poignees()[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }))
  await attendre(80)
  check('Alt+↑ sur la 1re : rien à faire, aucune requête', requetes.length === 0)
  poignees()[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  await attendre(80)
  check('↓ sans Alt : ignoré', requetes.length === 0)

  // Glisser : la 3e jusqu'au-dessus de la 1re.
  requetes.length = 0
  const lignes = () => Array.from(dock.querySelectorAll('li')).slice(0, 3)
  poignees()[2].dispatchEvent(evt('pointerdown', { clientY: 190 }))
  check('pointerdown : ligne tenue estompée + dock en « dragging »', lignes()[2].hasAttribute('data-kb-held') && dock.hasAttribute('data-kb-dragging'))
  poignees()[2].dispatchEvent(evt('pointermove', { clientY: 105 }))
  check('pointermove : indicateur posé sur la couture de la 1re ligne', lignes()[0].getAttribute('data-kb-drop') === 'before' && lignes()[0].style.boxShadow.includes('inset 0 2px 0'), lignes()[0].style.boxShadow)
  check('…aucune requête avant le dépôt', requetes.length === 0)
  poignees()[2].dispatchEvent(evt('pointerup', { clientY: 105 }))
  await attendre(120)
  post = requetes.find((r) => r.methode === 'POST')
  check('pointerup : POST (c avant a)', post?.corps.messageId === 'idc' && post?.corps.beforeId === 'ida', requetes)
  check('…indicateurs et états nettoyés', lignes().every((li) => !li.hasAttribute('data-kb-drop') && !li.hasAttribute('data-kb-held') && li.style.boxShadow === '') && !dock.hasAttribute('data-kb-dragging'))

  // Glisser en fin de file.
  requetes.length = 0
  poignees()[0].dispatchEvent(evt('pointerdown', { clientY: 118 }))
  poignees()[0].dispatchEvent(evt('pointermove', { clientY: 900 }))
  check('fin de file : indicateur sous la dernière ligne', lignes()[2].getAttribute('data-kb-drop') === 'end' && lignes()[2].style.boxShadow.includes('inset 0 -2px 0'))
  poignees()[0].dispatchEvent(evt('pointerup', { clientY: 900 }))
  await attendre(120)
  post = requetes.find((r) => r.methode === 'POST')
  check('…POST (a, beforeId null)', post?.corps.messageId === 'ida' && post?.corps.beforeId === null, requetes)

  // Annulation : pointercancel n'envoie rien.
  requetes.length = 0
  poignees()[1].dispatchEvent(evt('pointerdown', { clientY: 150 }))
  poignees()[1].dispatchEvent(evt('pointermove', { clientY: 5 }))
  poignees()[1].dispatchEvent(evt('pointercancel', {}))
  await attendre(80)
  check('pointercancel : rien envoyé, tout nettoyé', requetes.length === 0 && lignes().every((li) => !li.hasAttribute('data-kb-drop')))
  // Dépôt à sa propre place : aucune requête.
  poignees()[1].dispatchEvent(evt('pointerdown', { clientY: 150 }))
  poignees()[1].dispatchEvent(evt('pointermove', { clientY: 140 }))
  poignees()[1].dispatchEvent(evt('pointerup', {}))
  await attendre(80)
  check('dépôt sur sa propre place : aucune requête', requetes.length === 0)

  // File périmée : l'hôte voit 4 messages, l'écran 3 → on n'envoie rien.
  hote = file(4)
  poignees()[2].dispatchEvent(evt('pointerdown', { clientY: 190 }))
  poignees()[2].dispatchEvent(evt('pointermove', { clientY: 105 }))
  poignees()[2].dispatchEvent(evt('pointerup', {}))
  await attendre(120)
  check('file périmée (4 côté hôte, 3 à l’écran) : AUCUN POST', !requetes.some((r) => r.methode === 'POST'))

  // Une seule ligne : plus de poignée.
  monter(1)
  w.document.body.appendChild(w.document.createElement('i'))
  await attendre(250)
  check('une seule ligne : les poignées disparaissent', poignees().length === 0)

  effets.forEach((off) => { if (typeof off === 'function') off() })
}

console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-flow client — ' + pass + ' vérifications, ' + fail + ' échec(s)')
process.exit(fail === 0 ? 0 : 1)
