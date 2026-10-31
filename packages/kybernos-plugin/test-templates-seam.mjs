#!/usr/bin/env node
// The door the Apps page reads its templates through, `window.__KB_TEMPLATES__` (client.js, `<kb-templates-seam>`): `list()` and `add(id, { sample, kit })`, cut out of client.js and
// run alone over fakes of what the gallery already owns (the themes route, DSH's manager, the plan runner) and the REAL entry reader and label helpers of the file. No browser.
//
//   node packages/kybernos-plugin/test-templates-seam.mjs
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
const cut = (from, to) => {
  const a = SRC.indexOf(from)
  const b = SRC.indexOf(to, a)
  if (a < 0 || b < a) { console.log('  ✗ cannot cut ' + from + ' out of client.js'); process.exit(1) }
  return SRC.slice(a, b)
}
const SEAM = cut('    // <kb-templates-seam>', '    // </kb-templates-seam>')
const HELPERS = [
  cut('    const kbThPlain = ', '    const kbThStr = '),
  cut('    const kbThStr = ', '    const kbThStrings = '),
  cut('    const kbThLabel = (v) => {', '    /** The stored look as stable text'),
  cut('    const kbThEntries = (data) => {', '    /** A line for a card or a page head'),
  cut('    const kbThMissing = ', '    // </kb-themes-gallery>'),
].join('\n')

const SHIPPED = [
  { id: 'kybernos-themes/real-estate', dir: 'real-estate', name: { en: 'Real estate agency', fr: 'Agence immobilière' }, tagline: { en: 'Sell and let', fr: 'Vendre et louer' }, tag: 'Real estate',
    needs: ['kybernos/db', 'kybernos/dashboards'], adds: { skills: 1, teams: 1, automations: 2, connectors: 0 }, db: { objects: [{ en: 'Contacts', fr: 'Contacts' }, { en: 'Properties', fr: 'Biens' }] } },
  { id: 'kybernos-themes/plain', dir: 'plain', name: { en: 'Only a look', fr: 'Juste un style' }, needs: [], adds: { skills: 0, teams: 0, automations: 0, connectors: 0 }, db: null },
  { id: 'kybernos-themes/ecommerce', dir: 'ecommerce', name: { en: 'Online shop', fr: 'Boutique' }, description: { en: 'Orders and stock', fr: 'Commandes et stock' }, field: { en: 'Retail', fr: 'Commerce' },
    needs: ['kybernos/db'], adds: { skills: 0, teams: 0, automations: 0, connectors: 0 }, db: { objects: [{ en: 'Products', fr: 'Produits' }, { en: 'Orders', fr: 'Commandes' }] } },
]

/** A fresh seam over a fake world; `world` says what the host answers, `calls` remembers what was asked of it. */
const fresh = (world) => {
  const calls = []
  const win = {}
  const w = Object.assign({ lang: 'en', data: { ok: true, shipped: SHIPPED, themes: [], plugins: [], installed: [] }, dbs: [], bring: { ok: true }, owners: new Set(['kybernos/db', 'kybernos/dashboards']),
    run: { ok: true, report: { db: 'added' } }, switchOn: { ok: true } }, world || {})
  const fakeFetch = async (url) => { calls.push(['fetch', url]); if (w.dbs === null) throw new Error('down'); return { json: async () => ({ ok: true, dbs: w.dbs }) } }
  const deps = {
    kbThEn: (en, fr) => (w.lang === 'fr' ? fr : en),
    kbThApi: async () => { calls.push(['themes']); if (w.data === null) throw new Error('down'); return w.data },
    kbThBringIn: async (body) => { calls.push(['bring', body]); return w.bring },
    kbThOwners: async () => w.owners,
    kbThSwitchOn: async (ids) => { calls.push(['switch', ids]); return w.switchOn },
    kbThDefaultTicks: () => ({ style: true, goals: ['g'], skills: ['s1'], teams: ['t1'], automations: ['a1', 'a2'] }),
    kbThRunPlan: async (id, ticks) => {
      if (w.runThrows) throw new Error('boom')
      calls.push(['run', id, typeof ticks === 'function' ? ticks({ plan: true }, { seen: true }) : ticks])
      return w.run
    },
    fetch: fakeFetch,
    window: win,
  }
  const names = Object.keys(deps)
  const build = (over) => new Function(...names, HELPERS + '\n' + SEAM + '\nreturn { kbTplList, kbTplAdd, kbTplExtras, kbTplWord }')(...names.map((n) => (over !== undefined && n in over ? over[n] : deps[n])))
  return Object.assign(build(), { win, calls, w, build })
}

console.log('the door')
{
  const m = fresh()
  const seam = m.win.__KB_TEMPLATES__
  check('published on the window, versioned, frozen, with exactly list and add', seam !== undefined && seam.v === 1 && Object.isFrozen(seam) && typeof seam.list === 'function' && typeof seam.add === 'function' && Object.keys(seam).sort().join() === 'add,list,v')
  // the same block run again over a window that already holds a door: it must leave that door alone
  const theirs = Object.freeze({ v: 9 })
  const held = { __KB_TEMPLATES__: theirs }
  m.build({ window: held })
  check('a second activation does not replace a door a caller already holds', held.__KB_TEMPLATES__ === theirs)
  const empty = {}
  m.build({ window: empty })
  check('and publishes one on a window that has none', empty.__KB_TEMPLATES__ !== undefined && empty.__KB_TEMPLATES__.v === 1)
}

console.log('list')
{
  const m = fresh({ dbs: [{ id: 'db1', template: 'real-estate' }, { id: 'db2', template: null }] })
  const got = await m.win.__KB_TEMPLATES__.list()
  check('only the templates that ship a database, with the page\'s words', got.length === 2 && got[0].id === 'kybernos-themes/real-estate' && got[0].name === 'Real estate agency' && got[0].line === 'Sell and let' && got[0].tag === 'Real estate' && got[1].id === 'kybernos-themes/ecommerce', got)
  check('the tables are the labels of the template\'s objects', got[0].tables.join() === 'Contacts,Properties' && got[1].tables.join() === 'Products,Orders', got.map((t) => t.tables))
  check('what comes with it is one short phrase from the kit and the dashboard', got[0].extras === 'a dashboard, automations, skills and an agent team' && got[1].extras === '', got.map((t) => t.extras))
  check('the line falls to the description and the chip to the field when the pack gives none', got[1].line === 'Orders and stock' && got[1].tag === 'Retail', got[1])
  check('an app made from the template is known by the marker of the database', got[0].have === true && got[0].appId === 'db1' && got[1].have === false && got[1].appId === undefined, got)
  m.w.lang = 'fr'
  const fr = await m.win.__KB_TEMPLATES__.list()
  check('in French: the names, the tables and the phrase', fr[0].name === 'Agence immobilière' && fr[0].tables.join() === 'Contacts,Biens' && fr[0].extras === 'un tableau de bord, des automatisations, des compétences et une équipe d’agents', fr[0])
  check('two extras read « a and b », one reads alone', fresh().kbTplExtras({ needs: ['kybernos/dashboards'], adds: { automations: 1 } }) === 'a dashboard and automations' && fresh().kbTplExtras({ needs: [], adds: { skills: 3 } }) === 'skills' && fresh().kbTplExtras({}) === '')
  check('the database bundle not answering does not hide the templates, it only says none is in use', (await fresh({ dbs: null }).win.__KB_TEMPLATES__.list()).every((t) => t.have === false))
  check('the themes route not answering: no template, nothing thrown', (await fresh({ data: null }).win.__KB_TEMPLATES__.list()).length === 0 && (await fresh({ data: { ok: false } }).win.__KB_TEMPLATES__.list()).length === 0)
}

console.log('add')
{
  const add = (world, id, opts) => { const m = fresh(world); return m.win.__KB_TEMPLATES__.add(id, opts).then((r) => ({ r, m })) }
  const RE = 'kybernos-themes/real-estate'
  let { r, m } = await add({ dbs: [{ id: 'db1', template: 'real-estate' }] }, RE, { sample: true, kit: false })
  check('a template that is not installed is brought in through the manager, by its shipped id', m.calls.some((c) => c[0] === 'bring' && c[1].action === 'stage' && c[1].shipped === RE))
  const run = m.calls.find((c) => c[0] === 'run')
  check('the plan runs with the look untouched, no field, the sample as asked and none of the kit', run !== undefined && run[1] === RE && run[2].style === false && run[2].goals.length === 0 && run[2].demo === true && run[2].skills.length === 0 && run[2].teams.length === 0 && run[2].automations.length === 0, run)
  check('the answer names the app the template made', r.ok === true && r.appId === 'db1', r)
  ;({ r, m } = await add({ dbs: [{ id: 'db1', template: 'real-estate' }] }, RE, { sample: false, kit: true }))
  const run2 = m.calls.find((c) => c[0] === 'run')
  check('the whole kit, when asked, and no sample when not', run2[2].demo === false && run2[2].skills.join() === 's1' && run2[2].teams.join() === 't1' && run2[2].automations.join() === 'a1,a2' && run2[2].style === false && run2[2].goals.length === 0, run2)
  ;({ r, m } = await add({ data: { ok: true, shipped: SHIPPED, plugins: [{ id: RE }], themes: [], installed: [] }, dbs: [{ id: 'db1', template: 'real-estate' }] }, RE, { sample: true, kit: false }))
  check('a template already in the profile is not brought in again', !m.calls.some((c) => c[0] === 'bring') && r.ok === true)
  ;({ r, m } = await add({ owners: new Set(['kybernos/db']), dbs: [{ id: 'db1', template: 'real-estate' }] }, RE, { sample: true, kit: true }))
  check('the dashboard the kit needs is switched on, and the app does not wait for it', m.calls.some((c) => c[0] === 'switch' && c[1].join() === 'kybernos/dashboards') && r.ok === true)
  ;({ r, m } = await add({ owners: new Set(['kybernos/db']), dbs: [{ id: 'db1', template: 'real-estate' }] }, RE, { sample: true, kit: false }))
  check('without the kit nothing else is switched on', !m.calls.some((c) => c[0] === 'switch'))
  ;({ r, m } = await add({ run: { ok: true, report: { db: 'already there' } }, dbs: [{ id: 'db1', template: 'real-estate' }] }, RE, { sample: true, kit: false }))
  check('adding it twice finds the same app', r.ok === true && r.appId === 'db1')
  ;({ r } = await add({ run: { ok: true, report: { db: 'added' } }, dbs: [] }, RE, { sample: true, kit: false }))
  check('an app the marker does not show yet: ok, no id (the page just goes back)', r.ok === true && r.appId === undefined, r)

  console.log('refusals: a sentence, and never an exception')
  ;({ r } = await add({}, 'nobody/nothing', { sample: true, kit: true }))
  check('an unknown template', r.ok === false && /not available/.test(r.message), r)
  ;({ r } = await add({}, 'kybernos-themes/plain', {}))
  check('a template with no database is not an app template', r.ok === false)
  for (const bad of [undefined, null, 7, '', {}]) check('an id that is ' + JSON.stringify(bad) + ' is refused', (await add({}, bad, {})).r.ok === false)
  ;({ r } = await add({ bring: { ok: false, error: 'The manager is not available.' } }, RE, {}))
  check('the manager refusing says why, in its own words', r.ok === false && r.message === 'The manager is not available.', r)
  ;({ r, m } = await add({ run: { ok: false, error: 'no-plan' } }, RE, {}))
  check('a plan that cannot run', r.ok === false && /could not be applied/.test(r.message), r)
  ;({ r } = await add({ run: { ok: true, report: { db: 'after restart' } } }, RE, {}))
  check('a database that waits for a restart says so, and is not an app yet', r.ok === false && /Restart/.test(r.message), r)
  ;({ r } = await add({ run: { ok: true, report: { db: 'failed' } } }, RE, {}))
  check('a database that failed: no message, the page says its own sentence', r.ok === false && r.message === '', r)
  ;({ r } = await add({ data: null }, RE, {}))
  check('the themes route down: refused, not thrown', r.ok === false)
  ;({ r } = await add({ runThrows: true }, RE, {}))
  check('a runner that throws is caught', r.ok === false && r.message === '')
  ;({ r } = await add({}, RE, null))
  check('no options at all means no sample and no kit', r.ok === true)
}

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
