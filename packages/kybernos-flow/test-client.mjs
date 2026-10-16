#!/usr/bin/env node
/**
 * Harness of the CLIENT half of `kybernos-flow` (the queue handle).
 *
 *   1. always: the pure functions (drop seam, comparison with the host's queue,
 *      previews), with no browser and no dependency;
 *   2. if `jsdom` can be resolved (or KYBERNOS_JSDOM=<path of its entry>): the
 *      gesture replayed on a DOM that reproduces the native `QueueDock` (attribute
 *      `data-queue-dock`, `ul > li`, hashed classes with a suffix), with a fake
 *      `fetch` that records the requests. Otherwise the pass says SKIPPED.
 *
 * Usage: node kybernos-flow/test-client.mjs
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

console.log('\n── client: the loader ──')
check('id = @local/kybernos-flow', definition.id === '@local/kybernos-flow')
check('declares the uiWorkspace service', Array.isArray(modele.inject) && modele.inject.includes('uiWorkspace'))
{
  let leve = false
  try { modele.apply({ effect () { throw new Error('must not be called') }, get () {} }) } catch { leve = true }
  check('apply outside a browser (no document): no effect, does not throw', leve === false)
}

console.log('\n── client: pure functions ──')
check('same preview', T.memeApercu('Bonjour  le monde', 'bonjour le monde') === true)
check('preview: 12-character prefix', T.memeApercu('message numéro 1 — suite tronquée…', 'message numéro 1') === true)
check('different preview → false', T.memeApercu('autre chose', 'message numéro 1') === false)
check('preview empty on one side (attachment only): no verdict', T.memeApercu('', 'texte') === true && T.memeApercu('texte', '') === true)
const rects = [{ top: 100, height: 36 }, { top: 136, height: 36 }]
check('drop: above the list → before the 1st', T.cibleDeDepot(rects, 90) === 0)
check('drop: upper half of the 1st → before it', T.cibleDeDepot(rects, 110) === 0)
check('drop: lower half of the 1st → before the 2nd (no dead band)', T.cibleDeDepot(rects, 120) === 1)
check('drop: upper half of the 2nd → before it', T.cibleDeDepot(rects, 150) === 1)
check('drop: lower half of the last → end of queue', T.cibleDeDepot(rects, 160) === 2)
check('drop: very low → end of queue', T.cibleDeDepot(rects, 900) === 2)
{
  let toutesDefinies = true
  for (let y = 0; y < 300; y += 1) if (typeof T.cibleDeDepot(rects, y) !== 'number') toutesDefinies = false
  check('drop: EVERY ordinate carries a target (the 23/09 defect cannot come back)', toutesDefinies)
}
check('useless move: onto itself (from=0,target=0)', T.deplacementUtile(0, 0) === false)
check('useless move: right after itself (from=0,target=1)', T.deplacementUtile(0, 1) === false)
check('useful move: 0 → 2', T.deplacementUtile(0, 2) === true)
check('useful move: 2 → 0', T.deplacementUtile(2, 0) === true)
check('useless move: last → end', T.deplacementUtile(2, 3) === false)

const hote = [
  { id: 'a', lane: 'next-turn', index: 0, preview: 'premier' },
  { id: 'b', lane: 'next-turn', index: 1, preview: 'deuxième' },
  { id: 'c', lane: 'next-turn', index: 2, preview: 'troisième' },
  { id: 'z', lane: 'next-step', index: 0, preview: 'ailleurs' },
]
let v = T.resoudre(hote, ['premier', 'deuxième', 'troisième'], 2, 0)
check('resolve: 3rd before the 1st → ids (c, a)', v.ok === true && v.messageId === 'c' && v.beforeId === 'a', v)
v = T.resoudre(hote, ['premier', 'deuxième', 'troisième'], 0, 3)
check('resolve: 1st to the end of the queue → null beforeId', v.ok === true && v.messageId === 'a' && v.beforeId === null, v)
v = T.resoudre(hote, ['premier', 'deuxième'], 0, 2)
check('resolve: stale queue (3 on the host, 2 on screen) → refusal', v.ok === false && v.raison.startsWith('file-perimee'), v)
v = T.resoudre(hote, ['premier', 'autre', 'troisième'], 1, 0)
check('resolve: preview of the held row differs → refusal', v.ok === false && v.raison === 'apercu-different', v)
v = T.resoudre(hote, ['premier', 'deuxième', 'troisième'], 5, 0)
check('resolve: index outside the queue → refusal', v.ok === false && v.raison === 'indices-hors-file', v)
v = T.resoudre(undefined, [], 0, 0)
check('resolve: unreadable host answer → refusal, no throw', v.ok === false)

// ═══ DOM pass (jsdom, optional) ═════════════════════════════════════════════
console.log('\n── client: the gesture on a QueueDock DOM ──')
let JSDOM
try { ({ JSDOM } = await import(process.env.KYBERNOS_JSDOM ?? 'jsdom')) } catch { JSDOM = undefined }
if (JSDOM === undefined) {
  console.log('SKIPPED: the DOM pass of the queue gesture — jsdom not found (KYBERNOS_JSDOM=<path of its entry> plays it)')
} else {
  const attendre = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1:3080/' })
  const w = dom.window
  let def2
  w.__ModuleLoader__ = { load: (d) => { def2 = d } }
  new Function('window', SOURCE)(w)
  globalThis.document = w.document
  globalThis.MutationObserver = w.MutationObserver

  // Fake network: the queue « seen by the host » is driven by the test.
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
  check('host without the capability: NO handle (the UI does not promise a useless gesture)', poignees().length === 0)
  check('…and the probe did ask the route', requetes.some((r) => r.methode === 'GET' && r.url.includes('/kybernos/queue-move?sessionId=' + sessionId)))

  // Le verdict est mis en cache 10 s : on repart d'une instance neuve pour la suite.
  effets.forEach((off) => { if (typeof off === 'function') off() })
  hote = file(3)
  const inst2 = def2.factory()
  inst2.apply({ effect: (fn) => { effets.push(fn()) }, get: (cle) => (cle === 'uiWorkspace' ? { mainReference: { sessionId: 's-dom-2' } } : undefined) })
  w.document.body.appendChild(w.document.createElement('i')) // provoque un balayage
  await attendre(250)
  check('capable host: one handle per admitted message (3), none on the « being sent » band', poignees().length === 3, poignees().length)
  check('handle: accessible (role=button, tabindex=0, aria-label)', poignees().every((p) => p.getAttribute('role') === 'button' && p.getAttribute('tabindex') === '0' && p.getAttribute('aria-label').length > 10))
  check('handle at the head of the row', dock.querySelectorAll('li')[0].firstChild === poignees()[0])
  const avant = poignees().length
  w.document.body.appendChild(w.document.createElement('i'))
  await attendre(200)
  check('idempotent : un second balayage ne duplique rien', poignees().length === avant)

  // Keyboard: Alt+↓ on the 1st → before the 3rd (from+2).
  requetes.length = 0
  poignees()[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', altKey: true, bubbles: true, cancelable: true }))
  await attendre(120)
  let post = requetes.find((r) => r.methode === 'POST')
  check('Alt+↓: reads the queue then POSTs (a before c)', requetes[0]?.methode === 'GET' && post?.corps.messageId === 'ida' && post?.corps.beforeId === 'idc' && post?.corps.sessionId === 's-dom-2', requetes)
  requetes.length = 0
  poignees()[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true, cancelable: true }))
  await attendre(80)
  check('Alt+↑ on the 1st: nothing to do, no request', requetes.length === 0)
  poignees()[0].dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  await attendre(80)
  check('↓ without Alt: ignored', requetes.length === 0)

  // Glisser : la 3e jusqu'au-dessus de la 1re.
  requetes.length = 0
  const lignes = () => Array.from(dock.querySelectorAll('li')).slice(0, 3)
  poignees()[2].dispatchEvent(evt('pointerdown', { clientY: 190 }))
  check('pointerdown: held row dimmed + dock in « dragging »', lignes()[2].hasAttribute('data-kb-held') && dock.hasAttribute('data-kb-dragging'))
  poignees()[2].dispatchEvent(evt('pointermove', { clientY: 105 }))
  check('pointermove: indicator set on the seam of the 1st row', lignes()[0].getAttribute('data-kb-drop') === 'before' && lignes()[0].style.boxShadow.includes('inset 0 2px 0'), lignes()[0].style.boxShadow)
  check('…no request before the drop', requetes.length === 0)
  poignees()[2].dispatchEvent(evt('pointerup', { clientY: 105 }))
  await attendre(120)
  post = requetes.find((r) => r.methode === 'POST')
  check('pointerup : POST (c avant a)', post?.corps.messageId === 'idc' && post?.corps.beforeId === 'ida', requetes)
  check('…indicators and states cleaned up', lignes().every((li) => !li.hasAttribute('data-kb-drop') && !li.hasAttribute('data-kb-held') && li.style.boxShadow === '') && !dock.hasAttribute('data-kb-dragging'))

  // Glisser en fin de file.
  requetes.length = 0
  poignees()[0].dispatchEvent(evt('pointerdown', { clientY: 118 }))
  poignees()[0].dispatchEvent(evt('pointermove', { clientY: 900 }))
  check('end of queue: indicator under the last row', lignes()[2].getAttribute('data-kb-drop') === 'end' && lignes()[2].style.boxShadow.includes('inset 0 -2px 0'))
  poignees()[0].dispatchEvent(evt('pointerup', { clientY: 900 }))
  await attendre(120)
  post = requetes.find((r) => r.methode === 'POST')
  check('…POST (a, null beforeId)', post?.corps.messageId === 'ida' && post?.corps.beforeId === null, requetes)

  // Annulation : pointercancel n'envoie rien.
  requetes.length = 0
  poignees()[1].dispatchEvent(evt('pointerdown', { clientY: 150 }))
  poignees()[1].dispatchEvent(evt('pointermove', { clientY: 5 }))
  poignees()[1].dispatchEvent(evt('pointercancel', {}))
  await attendre(80)
  check('pointercancel: nothing sent, everything cleaned up', requetes.length === 0 && lignes().every((li) => !li.hasAttribute('data-kb-drop')))
  // Drop on its own place: no request.
  poignees()[1].dispatchEvent(evt('pointerdown', { clientY: 150 }))
  poignees()[1].dispatchEvent(evt('pointermove', { clientY: 140 }))
  poignees()[1].dispatchEvent(evt('pointerup', {}))
  await attendre(80)
  check('drop on its own place: no request', requetes.length === 0)

  // Stale queue: the host sees 4 messages, the screen 3 → nothing is sent.
  hote = file(4)
  poignees()[2].dispatchEvent(evt('pointerdown', { clientY: 190 }))
  poignees()[2].dispatchEvent(evt('pointermove', { clientY: 105 }))
  poignees()[2].dispatchEvent(evt('pointerup', {}))
  await attendre(120)
  check('stale queue (4 on the host, 3 on screen): NO POST', !requetes.some((r) => r.methode === 'POST'))

  // A single row: no handle any more.
  monter(1)
  w.document.body.appendChild(w.document.createElement('i'))
  await attendre(250)
  check('a single row: the handles disappear', poignees().length === 0)

  effets.forEach((off) => { if (typeof off === 'function') off() })
}

console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-flow client — ' + pass + ' checks, ' + fail + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
