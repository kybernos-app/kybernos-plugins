// ═══════════════════════════════════════════════════════════════════════════
// Test du comportement de kybernos-relance/client.js, hors navigateur.
//
// Le bundle client est un fichier écrit dans le format du chargeur DSH
// (`window.__ModuleLoader__.load`) : on fournit un faux chargeur, un faux
// EventSource et un faux location, puis on rejoue les trames de graphe pour
// vérifier les quatre règles qui comptent :
//   1. premier graphe de la page            → aucun rechargement
//   2. rebuild unitaire (1 ligne sur 74)    → aucun rechargement (HMR normale)
//   3. redémarrage (74/74 révisions)        → UN rechargement
//   4. seconde bascule < 20 s               → aucun rechargement (anti-boucle)
//
// Usage : node kybernos-relance/test-client.mjs
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs'

const SOURCE = new URL('./client.js', import.meta.url)

const instances = []
class FakeEventSource {
  constructor(url) { this.url = url; this.handlers = []; instances.push(this) }
  addEventListener(type, handler) { if (type === 'message') this.handlers.push(handler) }
  close() { this.closed = true }
  emit(frame) { for (const handler of this.handlers) handler({ data: JSON.stringify(frame) }) }
}

let reloads = 0
let clock = 1_000_000
const store = new Map()
const logs = []

let definition
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
globalThis.EventSource = FakeEventSource
globalThis.sessionStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) }
globalThis.location = { reload: () => { reloads += 1 } }
const realDateNow = Date.now
Date.now = () => clock
const realInfo = console.info
const realWarn = console.warn
console.info = (line) => logs.push(String(line))
console.warn = () => {}

const graph = (prefixRev) => ({
  type: 'graph',
  graph: { rev: 'graph-rev', entries: Array.from({ length: 74 }, (_, i) => ({ id: `plugin-${String(i)}`, rev: `${prefixRev}-${String(i)}` })) }
})

const fail = (message) => { console.error(`✗ ${message}`); process.exitCode = 1 }
const check = (label, actual, expected) => {
  if (actual === expected) console.log(`✓ ${label} (${String(actual)})`)
  else fail(`${label} : attendu ${String(expected)}, obtenu ${String(actual)}`)
}

await import(SOURCE.href)
check('le bundle client se charge dans le format du ModuleLoader', typeof definition, 'object')
check('identifiant du module', definition.id, '@local/kybernos-relance')

const plugin = definition.factory({})
check('contrat cordis : apply', typeof plugin.apply, 'function')
check('contrat cordis : inject vide (aucun service requis)', JSON.stringify(plugin.inject), '[]')

const effects = []
plugin.apply({ effect: (fn, label) => { effects.push(label); return fn() } })
check('un seul effet déclaré', effects.length, 1)
check('une source d’événements ouverte', instances.length, 1)
check('canal écouté', instances[0].url, '/plugins/events')

const source = instances[0]
source.emit(graph('6cc89818a448a1b4'))
check('1. premier graphe → aucun rechargement', reloads, 0)

source.emit({ type: 'graph', graph: { rev: 'r', entries: graph('6cc89818a448a1b4').graph.entries.map((row, i) => (i === 3 ? { ...row, rev: 'neuve-3' } : row)) } })
check('2. rebuild unitaire → aucun rechargement', reloads, 0)

source.emit(graph('ccef9071360a5eb0'))
check('3. redémarrage (74/74) → un rechargement', reloads, 1)
check('journal explicite', logs.some((line) => line.includes('74/74')), true)

clock += 5_000
source.emit(graph('aaaa111122223333'))
check('4. seconde bascule 5 s plus tard → bloquée (anti-boucle)', reloads, 1)

clock += 30_000
source.emit(graph('bbbb444455556666'))
check('5. bascule 35 s plus tard → rechargement à nouveau', reloads, 2)

source.emit({ type: 'rebuilt', id: 'plugin-3', rev: 'x' })
check('6. trame « rebuilt » ignorée', reloads, 2)

const cleanup = effects.length === 1
check('effet unique installé', cleanup, true)

Date.now = realDateNow
console.info = realInfo
console.warn = realWarn
if (process.exitCode !== 1) console.log('\nTout est vert.')
