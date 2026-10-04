// Suite panel — the user-defined order and the view choice: pure helpers and the storage
// layer, played without DSH, React or a browser.
//   node packages/kybernos-hub/test-suite-order.mjs
// The helpers live in client.js; they are reached through the factory's __test export,
// the same way test-host.mjs reaches lireEchec.
import { readFileSync } from 'node:fs'

const catalogue = JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'))
let echecs = 0
let total = 0
const ok = (nom, cond, detail) => { total++; if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

let def
const fenetre = { __ModuleLoader__: { load: (d) => { def = d } } }
new Function('window', readFileSync(new URL('./client.js', import.meta.url), 'utf8'))(fenetre)
const T = def.factory().__test

// A small catalogue for readable cases, and the real one for realism.
const mods = (...ids) => ids.map((id) => ({ id, nom: '@local/' + id, promesse: { fr: 'x', en: 'x' } }))
const ids = (list) => list.map((m) => m.id)
const ABCDE = mods('a', 'b', 'c', 'd', 'e')

// A Map-backed localStorage, a throwing one, and "no storage at all".
const memoire = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)) }, removeItem: (k) => { m.delete(k) }, _m: m } }
const casse = () => ({ getItem: () => { throw new Error('SecurityError') }, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => { throw new Error('SecurityError') } })

console.log('── keys ──')
ok('the storage keys are the documented ones', T.ORDER_KEY === 'kybernos.suite.order.v1' && T.VIEW_KEY === 'kybernos.suite.view.v1')

console.log('── parseOrder: what storage may hand back ──')
ok('null (no key) → []', eq(T.parseOrder(null), []))
ok('undefined → []', eq(T.parseOrder(undefined), []))
ok('empty string → []', eq(T.parseOrder(''), []))
ok('corrupt JSON → []', eq(T.parseOrder('["a","b"'), []) && eq(T.parseOrder('not json'), []))
ok('valid JSON of the wrong shape → []', eq(T.parseOrder('{"a":1}'), []) && eq(T.parseOrder('"a"'), []) && eq(T.parseOrder('42'), []))
ok('non-string and empty entries are dropped', eq(T.parseOrder('["a",1,null,"",{"x":1},"b"]'), ['a', 'b']))
ok('duplicates are dropped, first one wins', eq(T.parseOrder('["b","a","b","a"]'), ['b', 'a']))

console.log('── effectiveOrder / applyOrder ──')
ok('no saved order → catalogue order', eq(T.effectiveOrder(ABCDE, []), ['a', 'b', 'c', 'd', 'e']) && eq(T.effectiveOrder(ABCDE, undefined), ['a', 'b', 'c', 'd', 'e']) && eq(T.effectiveOrder(ABCDE, null), ['a', 'b', 'c', 'd', 'e']))
ok('a full saved order is followed', eq(T.effectiveOrder(ABCDE, ['e', 'd', 'c', 'b', 'a']), ['e', 'd', 'c', 'b', 'a']))
ok('unknown ids (new modules) go at the end, in catalogue order', eq(T.effectiveOrder(ABCDE, ['c', 'a']), ['c', 'a', 'b', 'd', 'e']))
ok('ids no longer in the catalogue are ignored', eq(T.effectiveOrder(ABCDE, ['zz', 'c', 'gone', 'a']), ['c', 'a', 'b', 'd', 'e']))
ok('both at once: a removed module and a new one', eq(T.effectiveOrder(mods('a', 'b', 'n1', 'n2'), ['x', 'b', 'a', 'old']), ['b', 'a', 'n1', 'n2']))
ok('a duplicated saved id counts once', eq(T.effectiveOrder(ABCDE, ['b', 'b', 'a']), ['b', 'a', 'c', 'd', 'e']))
ok('an empty catalogue gives an empty order', eq(T.effectiveOrder([], ['a']), []))
{
  const avant = JSON.stringify(ABCDE)
  const sortis = T.applyOrder(ABCDE, ['d', 'a'])
  ok('applyOrder returns the module objects in that order', eq(ids(sortis), ['d', 'a', 'b', 'c', 'e']) && sortis[0] === ABCDE[3])
  ok('applyOrder leaves its input alone', JSON.stringify(ABCDE) === avant && ids(ABCDE).join('') === 'abcde')
}

console.log('── custom or not ──')
ok('no saved order is not custom', T.isCustomOrder(ABCDE, []) === false)
ok('a saved order equal to the catalogue order is not custom', T.isCustomOrder(ABCDE, ['a', 'b', 'c', 'd', 'e']) === false)
ok('a saved order that only lists a prefix of the catalogue order is not custom', T.isCustomOrder(ABCDE, ['a', 'b']) === false)
ok('a different order is custom', T.isCustomOrder(ABCDE, ['b', 'a']) === true)
ok('an order of unknown ids only is not custom', T.isCustomOrder(ABCDE, ['x', 'y']) === false)
ok('storableOrder: default → null (the key is removed)', T.storableOrder(ABCDE, ['a', 'b', 'c', 'd', 'e']) === null && T.storableOrder(ABCDE, []) === null)
ok('storableOrder: custom → the FULL list, new modules included', eq(T.storableOrder(ABCDE, ['c', 'a']), ['c', 'a', 'b', 'd', 'e']))

console.log('── moveTo: drag and drop ──')
const ORD = ['a', 'b', 'c', 'd', 'e']
ok('drop on the top half of a row: lands before it', eq(T.moveTo(ORD, 'e', 'b', true), ['a', 'e', 'b', 'c', 'd']))
ok('drop on the bottom half of a row: lands after it', eq(T.moveTo(ORD, 'a', 'c', false), ['b', 'c', 'a', 'd', 'e']))
ok('moving to the very top', eq(T.moveTo(ORD, 'd', 'a', true), ['d', 'a', 'b', 'c', 'e']))
ok('moving to the very bottom', eq(T.moveTo(ORD, 'b', 'e', false), ['a', 'c', 'd', 'e', 'b']))
ok('dropping a row just before its own successor changes nothing', eq(T.moveTo(ORD, 'b', 'c', true), ORD))
ok('dropping a row on itself changes nothing', eq(T.moveTo(ORD, 'c', 'c', true), ORD) && eq(T.moveTo(ORD, 'c', 'c', false), ORD))
ok('an unknown id or target changes nothing', eq(T.moveTo(ORD, 'zz', 'a', true), ORD) && eq(T.moveTo(ORD, 'a', 'zz', true), ORD))
ok('moveTo returns a new array and never mutates its input', (() => { const o = ORD.slice(); const r = T.moveTo(o, 'a', 'e', false); return r !== o && eq(o, ORD) })())
ok('no row is lost or duplicated', (() => { const r = T.moveTo(ORD, 'b', 'e', false); return r.length === 5 && new Set(r).size === 5 })())

console.log('── moveBy: the up / down buttons ──')
ok('up swaps with the row above', eq(T.moveBy(ORD, ORD, 'c', -1), ['a', 'c', 'b', 'd', 'e']))
ok('down swaps with the row below', eq(T.moveBy(ORD, ORD, 'c', 1), ['a', 'b', 'd', 'c', 'e']))
ok('up on the first row changes nothing', eq(T.moveBy(ORD, ORD, 'a', -1), ORD))
ok('down on the last row changes nothing', eq(T.moveBy(ORD, ORD, 'e', 1), ORD))
ok('second row up reaches the top', eq(T.moveBy(ORD, ORD, 'b', -1), ['b', 'a', 'c', 'd', 'e']))
ok('second-to-last row down reaches the bottom', eq(T.moveBy(ORD, ORD, 'd', 1), ['a', 'b', 'c', 'e', 'd']))
ok('an id that is not visible changes nothing', eq(T.moveBy(ORD, ['a', 'c'], 'b', 1), ORD))

console.log('── moveBy under a filter: relative to the VISIBLE neighbour ──')
{
  // full order a h1 b h2 c, only a b c visible (h1 and h2 are hidden by the filter)
  const FULL = ['a', 'h1', 'b', 'h2', 'c']
  const VIS = ['a', 'b', 'c']
  const up = T.moveBy(FULL, VIS, 'c', -1)
  ok('c up jumps over its visible neighbour b: visible order becomes a c b', eq(up.filter((x) => VIS.includes(x)), ['a', 'c', 'b']))
  ok('…and the hidden rows keep their relative order and place around b', eq(up, ['a', 'h1', 'c', 'b', 'h2']))
  const down = T.moveBy(FULL, VIS, 'a', 1)
  ok('a down jumps over its visible neighbour b: visible order becomes b a c', eq(down.filter((x) => VIS.includes(x)), ['b', 'a', 'c']))
  ok('…and the hidden rows keep their relative order', eq(down.filter((x) => !VIS.includes(x)), ['h1', 'h2']) && eq(down, ['h1', 'b', 'a', 'h2', 'c']))
  ok('the first VISIBLE row cannot go up even with hidden rows above it', eq(T.moveBy(['h0', 'a', 'b'], ['a', 'b'], 'a', -1), ['h0', 'a', 'b']))
  ok('the last VISIBLE row cannot go down even with hidden rows below it', eq(T.moveBy(['a', 'b', 'h9'], ['a', 'b'], 'b', 1), ['a', 'b', 'h9']))
  ok('a click on a lone visible row changes nothing', eq(T.moveBy(FULL, ['b'], 'b', -1), FULL) && eq(T.moveBy(FULL, ['b'], 'b', 1), FULL))
  ok('dragging across hidden rows: drop after c puts it after c in the full order', eq(T.moveTo(FULL, 'a', 'c', false), ['h1', 'b', 'h2', 'c', 'a']))
}
{
  // The same with the panel's real filter and the real catalogue.
  const modules = catalogue.modules
  const installes = new Map(modules.filter((m) => m.nom.startsWith('@local/kybernos')).map((m) => [m.nom, { name: m.nom, version: m.version, enabled: true }]))
  const complet = T.effectiveOrder(modules, [])
  const visibles = T.filtrer({ modules: T.applyOrder(modules, []), filtre: 'available', requete: '', installes }).map((m) => m.id)
  ok('the "available" filter shows only a few of the 25 modules', visibles.length > 0 && visibles.length < 25, String(visibles.length))
  const apres = T.moveBy(complet, visibles, visibles[1], -1)
  const vuApres = T.filtrer({ modules: T.applyOrder(modules, apres), filtre: 'available', requete: '', installes }).map((m) => m.id)
  ok('with the real filter, one click up swaps the two visible rows', vuApres[0] === visibles[1] && vuApres[1] === visibles[0], vuApres.join())
  ok('the full order still lists every module exactly once', apres.length === 25 && new Set(apres).size === 25)
  ok('filtrer keeps the order it is given (the custom order shows through a filter)', eq(T.filtrer({ modules: mods('c', 'a', 'b'), filtre: 'all', requete: '', installes: new Map() }).map((m) => m.id), ['c', 'a', 'b']))
}

console.log('── storage: order ──')
{
  const st = memoire()
  ok('empty storage reads as no order', eq(T.readOrder(st), []))
  const next = T.moveTo(T.effectiveOrder(ABCDE, []), 'e', 'a', true)
  ok('writing a custom order succeeds', T.writeOrder(st, T.storableOrder(ABCDE, next)) === true && st._m.has(T.ORDER_KEY))
  ok('what was written is a JSON array of ids', eq(JSON.parse(st._m.get(T.ORDER_KEY)), ['e', 'a', 'b', 'c', 'd']))
  ok('reading it back applies it', eq(ids(T.applyOrder(ABCDE, T.readOrder(st))), ['e', 'a', 'b', 'c', 'd']))
  ok('a module added by a later release lands at the end of the saved order', eq(ids(T.applyOrder(mods('a', 'b', 'c', 'd', 'e', 'f'), T.readOrder(st))), ['e', 'a', 'b', 'c', 'd', 'f']))
  ok('a module removed by a later release disappears from it', eq(ids(T.applyOrder(mods('a', 'b', 'c', 'e'), T.readOrder(st))), ['e', 'a', 'b', 'c']))
  ok('reset: writing null removes the key', T.writeOrder(st, null) === true && !st._m.has(T.ORDER_KEY) && eq(T.readOrder(st), []))
  ok('after a reset the catalogue order is back and the order is not custom', eq(ids(T.applyOrder(ABCDE, T.readOrder(st))), ['a', 'b', 'c', 'd', 'e']) && T.isCustomOrder(ABCDE, T.readOrder(st)) === false)
  const manuel = T.moveTo(['a', 'b', 'c', 'd', 'e'], 'a', 'b', false)
  ok('moving a row away and back leaves no key behind (the order equals the default)', T.storableOrder(ABCDE, T.moveTo(manuel, 'a', 'b', true)) === null)
}
{
  const corrompu = memoire({ [T.ORDER_KEY]: '{"oops": tru' })
  ok('corrupt JSON in storage: the default order, no throw', eq(ids(T.applyOrder(ABCDE, T.readOrder(corrompu))), ['a', 'b', 'c', 'd', 'e']) && T.isCustomOrder(ABCDE, T.readOrder(corrompu)) === false)
  const mauvaiseForme = memoire({ [T.ORDER_KEY]: '{"a":1}' })
  ok('wrong shape in storage: the default order', eq(T.readOrder(mauvaiseForme), []))
  const tout = memoire({ [T.ORDER_KEY]: '["zz","yy"]' })
  ok('a stored order of unknown ids only: the default order', eq(ids(T.applyOrder(ABCDE, T.readOrder(tout))), ['a', 'b', 'c', 'd', 'e']))
  // a "reset" over a corrupt value still clears it
  ok('a reset clears a corrupt value too', T.writeOrder(corrompu, null) === true && !corrompu._m.has(T.ORDER_KEY))
}
{
  const st = casse()
  ok('a storage that throws on read: no order, no throw', eq(T.readOrder(st), []))
  ok('a storage that throws on write: false, no throw', T.writeOrder(st, ['a']) === false)
  ok('a storage that throws on remove: false, no throw', T.writeOrder(st, null) === false)
  ok('no storage at all (null): reads [], writes report false', eq(T.readOrder(null), []) && T.writeOrder(null, ['a']) === false && T.writeOrder(null, null) === false)
}

console.log('── storage: view ──')
{
  const st = memoire()
  ok('nothing stored → grid (today\'s behaviour)', T.readView(st) === 'grid')
  ok('writing list, then reading it back', T.writeView(st, 'list') === true && T.readView(st) === 'list' && st._m.get(T.VIEW_KEY) === 'list')
  ok('writing grid, then reading it back', T.writeView(st, 'grid') === true && T.readView(st) === 'grid')
  ok('an unknown stored value reads as grid', T.readView(memoire({ [T.VIEW_KEY]: 'table' })) === 'grid' && T.readView(memoire({ [T.VIEW_KEY]: '' })) === 'grid')
  ok('an unknown value is never written', (() => { const s = memoire(); T.writeView(s, 'table'); return s._m.get(T.VIEW_KEY) === 'grid' })())
  ok('a throwing storage: grid on read, false on write', T.readView(casse()) === 'grid' && T.writeView(casse(), 'list') === false)
  ok('no storage at all: grid, false', T.readView(null) === 'grid' && T.writeView(null, 'list') === false)
  ok('the view and the order do not share a key', (() => { const s = memoire(); T.writeView(s, 'list'); T.writeOrder(s, ['b', 'a']); T.writeOrder(s, null); return T.readView(s) === 'list' })())
}

console.log('── browserStore: the real localStorage may not exist or may throw ──')
{
  // browserStore() reads the factory's `window`; here we hand the file different windows.
  const avec = (win) => { let d; new Function('window', readFileSync(new URL('./client.js', import.meta.url), 'utf8'))({ ...win, __ModuleLoader__: { load: (x) => { d = x } } }); return d.factory().__test }
  ok('a window without localStorage → null', avec({}).browserStore() === null)
  const st = memoire()
  ok('a window with localStorage → that store', avec({ localStorage: st }).browserStore() === st)
  const piege = { __ModuleLoader__: { load: (x) => { piege.def = x } } }
  Object.defineProperty(piege, 'localStorage', { get () { throw new Error('SecurityError: access denied') } })
  new Function('window', readFileSync(new URL('./client.js', import.meta.url), 'utf8'))(piege)
  const Tpiege = piege.def.factory().__test
  let leve = false
  let valeur
  try { valeur = Tpiege.browserStore() } catch (e) { leve = true }
  ok('a window whose localStorage getter throws (private window) → null, never a throw', leve === false && valeur === null)
  ok('…and the helpers then degrade quietly', eq(Tpiege.readOrder(Tpiege.browserStore()), []) && Tpiege.readView(Tpiege.browserStore()) === 'grid' && Tpiege.writeOrder(Tpiege.browserStore(), ['a']) === false)
}

console.log('── the real catalogue ──')
{
  const modules = catalogue.modules
  const reel = T.effectiveOrder(modules, [])
  ok('default order = catalogue order, 25 modules', reel.length === 25 && eq(reel, modules.map((m) => m.id)))
  const deplace = T.moveTo(reel, modules[24].id, modules[0].id, true)
  ok('moving the last module to the top puts it first and keeps 25 distinct ids', deplace[0] === modules[24].id && deplace.length === 25 && new Set(deplace).size === 25)
  ok('inside a family the saved order shows through (cards are filtered from the ordered list)', (() => {
    const famille = modules[0].famille
    const dedans = T.applyOrder(modules, deplace).filter((m) => m.famille === famille).map((m) => m.id)
    return dedans.length > 0 && eq(dedans, deplace.filter((id) => modules.find((m) => m.id === id).famille === famille))
  })())
}

console.log('\nSUITE ORDER — ' + total + ' assertions, ' + echecs + ' failure(s)')
process.exit(echecs === 0 ? 0 : 1)
