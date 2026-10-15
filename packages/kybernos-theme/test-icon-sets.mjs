// Menu icon sets: the drawing code in client.js (between the icon-sets markers), the registry the menu reads.
// No DSH, no browser: the block is pure, so it is cut out of client.js and run as it ships.
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
let fail = 0
const ok = (name, cond, detail) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (cond ? '' : ' — ' + JSON.stringify(detail)))
  if (!cond) fail += 1
}
const section = (t) => console.log('\n' + t)

const begin = SRC.indexOf('// <icon-sets:begin>')
const end = SRC.indexOf('// <icon-sets:end>')
if (begin < 0 || end < begin) { console.log('✗ the icon-sets block markers are missing from client.js'); process.exit(1) }
const BLOCK = SRC.slice(begin, end)

// A window just big enough for the registry.
const events = []
const win = {
  dispatchEvent: (e) => { events.push(e); return true },
}
const doc = { documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v } } }
class Ev { constructor(type, init) { this.type = type; this.detail = init && init.detail } }
const api = new Function('window', 'document', 'CustomEvent', BLOCK + '\nreturn { ICON_ENTRIES, ICON_HUES, ICON_SETS, ICON_SET_IDS, iconInner, iconSvg, iconRegistry, appliquerIcones }')(win, doc, Ev)

section('the sets')
{
  const ids = api.ICON_SET_IDS
  ok('twelve sets: classic, the five sober ones and the six new languages', ids.length === 12 && ids[0] === 'classic' && new Set(ids).size === 12, ids)
  ok('the six new ones are there', ['matrice', 'mondrian', 'anneaux', 'iso', 'creatures', 'barres'].every((i) => ids.indexOf(i) >= 0), ids)
  ok('nine menu entries, each with a hue', api.ICON_ENTRIES.length === 9 && api.ICON_ENTRIES.every((e) => /^#[0-9a-f]{6}$/.test(api.ICON_HUES[e])), api.ICON_HUES)
  ok('every set has a French and an English name and a hint', api.ICON_SETS.every((s) => s.fr && s.en && s.hint && s.hint.fr && s.hint.en), api.ICON_SETS.map((s) => s.id))
  ok('classic has no drawing: the menu keeps the application\'s own line icons', api.ICON_SETS[0].draw === undefined && api.iconSvg('classic', 'cloud', false, 16) === null)
  ok('an unknown set or entry draws nothing (never throws)', api.iconSvg('nope', 'cloud', false) === null && api.iconSvg('bauhaus', 'nope', false) === null && api.iconSvg(undefined, undefined, true) === null)
}

section('every drawing')
{
  const drawn = api.ICON_SETS.filter((s) => typeof s.draw === 'function')
  const bad = { missing: [], unbalanced: [], outline: [], bounds: [], restHue: [], onNoHue: [] }
  for (const s of drawn) {
    for (const e of api.ICON_ENTRIES) {
      for (const on of [false, true]) {
        const svg = api.iconSvg(s.id, e, on, 18)
        const key = s.id + '/' + e + '/' + (on ? 'on' : 'rest')
        if (typeof svg !== 'string' || svg.length < 60) { bad.missing.push(key); continue }
        // balanced tags
        const stack = []
        let balanced = true
        for (const m of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
          if (m[4] === '/') continue
          if (m[1] === '/') { if (stack.pop() !== m[2]) balanced = false } else stack.push(m[2])
        }
        if (!balanced || stack.length > 0) bad.unbalanced.push(key)
        // flat fills only: not a single stroke
        if (/stroke(?!-opacity)/.test(svg.replace(/stop-color/g, ''))) bad.outline.push(key)
        // inside the 24 × 24 box (a little slack for the rounded ends)
        const nums = [...svg.matchAll(/\b(?:cx|cy|x|y)="(-?[\d.]+)"/g)].map((m) => Number(m[1]))
        const pts = [...svg.matchAll(/points="([^"]+)"/g)].flatMap((m) => m[1].split(/[ ,]/).map(Number))
        if ([...nums, ...pts].some((n) => !(n >= -0.5 && n <= 24.5))) bad.bounds.push(key)
        // at rest nothing is coloured (it follows the row's text colour), open: the entry's own hue
        const hex = [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase())
        if (!on && hex.length > 0) bad.restHue.push(key)
        if (on && !hex.includes(api.ICON_HUES[e])) bad.onNoHue.push(key)
      }
    }
  }
  ok('every set draws every entry, at rest and open (' + drawn.length + ' × 9 × 2)', bad.missing.length === 0, bad.missing)
  ok('every drawing is well-formed (tags balanced)', bad.unbalanced.length === 0, bad.unbalanced)
  ok('no outline anywhere: flat fills only', bad.outline.length === 0, bad.outline)
  ok('everything stays inside the 24 × 24 box', bad.bounds.length === 0, bad.bounds)
  ok('at rest no colour is written: the icon follows the row\'s text colour in light and dark', bad.restHue.length === 0, bad.restHue)
  ok('open, the entry\'s hue is used', bad.onNoHue.length === 0, bad.onNoHue)
}

section('the sets do not look alike')
{
  const drawn = api.ICON_SETS.filter((s) => typeof s.draw === 'function')
  const clash = []
  for (const e of api.ICON_ENTRIES) {
    const seen = new Map()
    for (const s of drawn) {
      const m = api.iconInner(s.id, e, false)
      if (seen.has(m)) clash.push(e + ': ' + seen.get(m) + ' = ' + s.id)
      seen.set(m, s.id)
    }
  }
  ok('for every entry, no two sets draw the same thing', clash.length === 0, clash)
  // The six new languages must not share their shapes with the five sober ones: no common shape string longer than a bare circle/rect.
  const sober = drawn.filter((s) => ['aplat', 'duotone', 'bauhaus', 'doux', 'pastille'].indexOf(s.id) >= 0)
  const fresh = drawn.filter((s) => sober.indexOf(s) < 0)
  const shapes = (id, e) => new Set([...api.iconInner(id, e, true).matchAll(/<(?:path d|polygon points|rect [^>]*?)="?[^>]*?>/g)].map((m) => m[0].replace(/fill="[^"]*"/g, '').replace(/opacity="[^"]*"/g, '')))
  const shared = []
  for (const e of api.ICON_ENTRIES) {
    const soberShapes = new Set(sober.flatMap((s) => [...shapes(s.id, e)]))
    for (const f of fresh) for (const sh of shapes(f.id, e)) if (soberShapes.has(sh)) shared.push(f.id + '/' + e + ': ' + sh.slice(0, 50))
  }
  ok('no new drawing reuses a shape of the sober sets', shared.length === 0, shared.slice(0, 5))
}

section('the registry the menu reads')
{
  const reg = api.iconRegistry()
  ok('it publishes itself on window and starts on classic', win.__KB_ICONSETS__ === reg && reg.current() === 'classic' && reg.v === 1)
  ok('it lists the sets and the entries', reg.sets.length === 12 && reg.entries.length === 9 && reg.hue('cloud') === '#14b8a6' && reg.hue('x') === null)
  ok('it draws with the current set, or with the one asked for', reg.svg('cloud', false, 16) === null && typeof reg.svg('cloud', false, 16, 'matrice') === 'string')
  api.appliquerIcones({ iconSet: 'pastille' })
  ok('applying a set makes it current, writes the attribute and announces it once', reg.current() === 'pastille' && doc.documentElement.attrs['data-kb-icons'] === 'pastille' && events.length === 1 && events[0].type === 'kb-icons-change' && events[0].detail.set === 'pastille', events)
  ok('the menu then gets a real svg at the size it asks', /^<svg width="16" height="16" viewBox="0 0 24 24"/.test(reg.svg('skills', true, 16)))
  api.appliquerIcones({ iconSet: 'pastille' })
  ok('the same set again announces nothing', events.length === 1)
  api.appliquerIcones({ iconSet: 'not-a-set' })
  ok('an unknown id falls back to classic (a theme file cannot break the menu)', reg.current() === 'classic' && events.length === 2)
  api.appliquerIcones(undefined)
  ok('a missing state never throws', reg.current() === 'classic')
  const again = api.iconRegistry()
  ok('a second registry (hot reload) keeps the current set', again.cur === reg.cur)
}

section('the theme plumbing')
{
  ok('iconSet is a stored setting with a valid list', /iconSet: 'classic'/.test(SRC) && /iconSet: ICON_SET_IDS/.test(SRC))
  ok('a theme can retain it: its own group, with a label', /icons: \['iconSet'\]/.test(SRC) && /icons: 'Icônes du menu'/.test(SRC))
  ok('a shipped theme may carry one', /if \(sk\.iconSet !== undefined\) patch\.iconSet = sk\.iconSet/.test(SRC))
  const body = (name) => { const i = SRC.indexOf('const ' + name + ' = (themeSvc, S) => {'); return i < 0 ? '' : SRC.slice(i, SRC.indexOf('\n      }\n', i)) }
  ok('both appliers put it in force (activation and live)', /appliquerIcones\(S\)/.test(body('appliquerTout')) && /appliquerIcones\(S\)/.test(body('appliquerBoot')))
  ok('the settings page has the picker', /data-kb': 'theme-icons'/.test(SRC) && /'data-kb': 'theme-icset'/.test(SRC))
}

console.log(fail === 0 ? '\n✓ icon sets OK' : '\n✗ ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
