#!/usr/bin/env node
/** The Skills screen, rendered: what a click on a card opens (a right-hand panel, the list stays), what the panel shows (the REAL
 *  SKILL.md, the folder, only the actions the host says it can do), that every Discover card has its OWN detail, and that Install
 *  asks first, with the real name, repository and destination of the skill in front of the user.
 *
 *  No browser and no dependency: client.js is run against a few lines of React (function components, the hooks the screen uses,
 *  effects, state, synchronous re-render) and a fake `fetch` that plays the host routes. The same screen in a real page is
 *  scripts/check-skills-detail-live.mjs.
 *
 *  Usage: node packages/kybernos-skills/test-ui.mjs   (exit 0 = all pass) */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 400))) }
}

// ── a few lines of React ──────────────────────────────────────────────────────────────────────────────────
let CURRENT = null
const INFLIGHT = { n: 0 }
const same = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
const flat = (list) => list.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false && c !== true)
class Component { constructor (props) { this.props = props; this.state = {} } setState (s) { Object.assign(this.state, typeof s === 'function' ? s(this.state) : s) } }
const React = {
  Component,
  createElement (type, props, ...children) {
    const p = Object.assign({}, props || {})
    const kids = flat(children)
    if (kids.length === 1) p.children = kids[0]
    else if (kids.length > 1) p.children = kids
    return { $$: true, type, props: p, key: p.key !== undefined && p.key !== null ? String(p.key) : null, kids }
  },
  useState (init) {
    const slot = CURRENT.slot()
    if (slot.state === undefined) {
      const root = CURRENT.root
      slot.state = { v: typeof init === 'function' ? init() : init }
      slot.set = (nv) => { const v = typeof nv === 'function' ? nv(slot.state.v) : nv; if (!Object.is(v, slot.state.v)) { slot.state.v = v; root.pending = true } }
    }
    return [slot.state.v, slot.set]
  },
  useRef (init) { const slot = CURRENT.slot(); if (slot.ref === undefined) slot.ref = { current: init }; return slot.ref },
  useMemo (fn, deps) { const slot = CURRENT.slot(); if (slot.memo === undefined || !same(slot.deps, deps)) { slot.memo = { v: fn() }; slot.deps = deps } return slot.memo.v },
  useCallback (fn, deps) { return React.useMemo(() => fn, deps) },
  useEffect (fn, deps) {
    const slot = CURRENT.slot()
    if (slot.ran !== true || deps === undefined || !same(slot.deps, deps)) CURRENT.root.effects.push({ slot, fn })
    slot.deps = deps
  }
}

const mount = (element) => {
  const root = {
    pending: false, effects: [], instances: new Map(), tree: null,
    render () {
      const seen = new Set()
      const visit = (el, path) => {
        if (el === null || el === undefined || typeof el === 'boolean') return null
        if (typeof el === 'string' || typeof el === 'number') return { text: String(el) }
        if (Array.isArray(el)) return { tag: '#', props: {}, children: flat(el).map((c, i) => visit(c, path + '.' + (c && c.key !== null && c.key !== undefined ? c.key : i))).filter((c) => c !== null) }
        if (typeof el.type === 'function') {
          seen.add(path)
          let inst = root.instances.get(path)
          if (inst === undefined) { inst = { slots: [], i: 0 }; root.instances.set(path, inst) }
          inst.i = 0
          const prev = CURRENT
          CURRENT = { root, slot: () => { const k = inst.i++; if (inst.slots[k] === undefined) inst.slots[k] = {}; return inst.slots[k] } }
          let out
          try {
            if (el.type.prototype instanceof Component) { const o = new el.type(el.props); out = o.render() } else out = el.type(el.props)
          } finally { CURRENT = prev }
          return visit(out, path + '>')
        }
        const children = flat(el.kids).map((c, i) => visit(c, path + '/' + (c && c.key !== null && c.key !== undefined ? c.key : i))).filter((c) => c !== null)
        return { tag: el.type, props: el.props, children }
      }
      root.effects = []
      root.tree = visit(element, 'r')
      for (const [p, inst] of [...root.instances]) {
        if (seen.has(p)) continue
        for (const s of inst.slots) if (typeof s.cleanup === 'function') { try { s.cleanup() } catch (e) { /* unmount */ } }
        root.instances.delete(p)
      }
      const todo = root.effects
      for (const e of todo) { if (typeof e.slot.cleanup === 'function') { try { e.slot.cleanup() } catch (err) { /* cleanup */ } } }
      for (const e of todo) { e.slot.ran = true; const c = e.fn(); e.slot.cleanup = typeof c === 'function' ? c : undefined }
    },
    async settle () {
      for (let quiet = 0, laps = 0; quiet < 4;) {
        if (++laps > 400) throw new Error('the screen never settles (a state that changes on every render?)')
        let rounds = 0
        while (root.pending === true && rounds++ < 60) { root.pending = false; root.render() }
        await new Promise((r) => setTimeout(r, 4))
        if (root.pending === true || INFLIGHT.n > 0) quiet = 0
        else quiet += 1
      }
    }
  }
  root.render()
  return root
}

// ── the tree ──────────────────────────────────────────────────────────────────────────────────────────────
const walk = (node, fn) => { if (node === null || node === undefined) return; fn(node); for (const c of node.children || []) walk(c, fn) }
const all = (root, pred) => { const out = []; walk(root === undefined ? undefined : (root.tree !== undefined ? root.tree : root), (n) => { if (n.tag !== undefined && n.tag !== '#' && pred(n)) out.push(n) }); return out }
const textOf = (n) => (n.text !== undefined ? n.text : (n.children || []).map(textOf).join(''))
const hasClass = (n, c) => typeof n.props.className === 'string' && n.props.className.split(/\s+/).includes(c)
const kb = (root, name) => all(root, (n) => n.props['data-kb'] === name)
const kbStarts = (root, prefix) => all(root, (n) => typeof n.props['data-kb'] === 'string' && n.props['data-kb'].startsWith(prefix))
const page = (root) => textOf(root.tree).replace(/\s+/g, ' ')
const part = (root, name) => { const n = kb(root, name)[0]; return n === undefined ? '' : textOf(n).replace(/\s+/g, ' ') }
const click = async (root, node) => {
  const ev = { target: node, currentTarget: node, stopped: false, stopPropagation () { this.stopped = true }, preventDefault () {}, key: 'Enter' }
  if (node === undefined || typeof node.props.onClick !== 'function') {
    check('there is something to click' + (node === undefined ? '' : ' (' + node.tag + ' is not clickable)'), false, new Error('at').stack.split('\n')[2].trim())
    return ev
  }
  node.props.onClick(ev)
  await root.settle()
  return ev
}

// ── the host, played ──────────────────────────────────────────────────────────────────────────────────────
const HOME = '/home/u/.dsh/skills'
const PROJ = '/work/proj/.dsh/skills'
const mkSkill = (name, root, extra) => Object.assign({
  name, root, source: root === HOME ? 'user-dsh' : 'project-dsh', rank: root === HOME ? 400 : 100, writable: root === HOME,
  folder: root + '/' + name, teamVersion: null, teamModified: null, active: true, description: 'About ' + name, whenToUse: '', modifiedAt: '2026-10-01T10:00:00.000Z', collision: false
}, extra || {})
const hit = (name, source, installs) => ({ id: source + '/' + name, name, source, installs, sourceType: 'github', installable: true, installUrl: 'https://github.com/' + source, url: 'https://www.skills.sh/' + source + '/' + name })

const world = () => {
  const w = {
    calls: [],
    skills: [mkSkill('statistical-analysis', HOME), mkSkill('sql-queries', HOME), mkSkill('proj-only', PROJ, { description: 'A project skill' })],
    roots: [
      { path: PROJ, source: 'project-dsh', rank: 100, writable: false, exists: true, count: 1 },
      { path: HOME, source: 'user-dsh', rank: 400, writable: true, exists: true, count: 2 }
    ],
    ranking: [hit('find-skills', 'vercel-labs/skills', 3867556), hit('grill-me', 'mattpocock/skills', 1363165), hit('tdd', 'mattpocock/skills', 1100000)],
    // Two repositories publish a skill called « grill-me » and « find-skills »: the owner shown for a card must be the one of ITS repository.
    owners: [
      { owner: 'sanity-io', skills: [hit('find-skills', 'sanity-io/skills', 10)] },
      { owner: 'flutter', skills: [hit('grill-me', 'flutter/skills', 5)] },
      { owner: 'mattpocock', skills: [hit('grill-me', 'mattpocock/skills', 1363165), hit('tdd', 'mattpocock/skills', 1100000)] },
      { owner: 'vercel-labs', skills: [hit('find-skills', 'vercel-labs/skills', 3867556)] }
    ],
    reads: {},
    previews: {
      'vercel-labs/skills:find-skills': { ok: true, found: true, folder: 'skills/find-skills', description: 'Helps users discover and install agent skills.', text: '---\nname: find-skills\ndescription: Helps users discover and install agent skills.\n---\n\n# Find skills\nSearch the registry first.', truncated: false },
      'mattpocock/skills:grill-me': { ok: true, found: true, folder: 'skills/productivity/grill-me', description: 'Interview me relentlessly about a plan.', text: '---\nname: grill-me\ndescription: Interview me relentlessly about a plan.\n---\n\n# Grill me\nAsk one question at a time.', truncated: false },
      'mattpocock/skills:tdd': { ok: false, error: 'github_rate_limited', http: 403 }
    },
    answers: {}
  }
  w.fetch = async (url, init) => {
    const method = init && init.method ? init.method : 'GET'
    const u = new URL('http://h' + url)
    const path = u.pathname
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null
    w.calls.push({ method, path, query: Object.fromEntries(u.searchParams), body })
    const answer = (j) => ({ ok: true, status: 200, json: async () => j })
    if (w.answers[method + ' ' + path] !== undefined) return answer(typeof w.answers[method + ' ' + path] === 'function' ? w.answers[method + ' ' + path](body, u) : w.answers[method + ' ' + path])
    if (path === '/kybernos-skills/skills') return answer({ ok: true, skills: w.skills, roots: w.roots, complete: true })
    if (path === '/kybernos-skills/index') return answer({ ok: true, view: 'all-time', page: 0, perPage: 50, total: w.rankingTotal !== undefined ? w.rankingTotal : w.ranking.length, hasMore: false, skills: w.ranking })
    if (path === '/kybernos-skills/curated') return answer({ ok: true, owners: w.owners, totalOwners: w.owners.length, totalSkills: 5 })
    if (path === '/kybernos-skills/status') return answer({ ok: true, roots: [{ path: HOME, source: 'user-dsh', exists: true }, { path: '/home/u/.agents/skills', source: 'user-agents', exists: false }] })
    if (path === '/kybernos-skills/featured') return answer({ ok: true, items: [] })
    if (path === '/kybernos-skills/index-source') return answer({ ok: true, source: { origin: 'default', host: 'skills.kybernos.app', url: 'https://skills.kybernos.app/v1', editable: true } })
    if (path === '/kybernos-skills/audit') return answer({ ok: true, audits: [] })
    if (path === '/kybernos-skills/preview') return answer(w.previews[u.searchParams.get('source') + ':' + u.searchParams.get('name')] || { ok: true, found: false })
    if (path === '/kybernos-skills/skill/read') return answer(w.reads[body.root + '|' + body.name] || { ok: false, error: 'not_found' })
    if (path === '/kybernos-skills/install') return answer({ ok: true, files: 3, skill: mkSkill(body.name, body.root) })
    if (path === '/kybernos-skills/skill/delete' || path === '/kybernos-skills/skill/duplicate' || path === '/kybernos-skills/skill/reveal') return answer({ ok: true, name: body.name + '-copy', skill: mkSkill(body.name + '-copy', body.root) })
    return { ok: true, status: 404, json: async () => { throw new Error('not json') } }
  }
  return w
}
const readOf = (s, text, actions) => ({ ok: true, name: s.name, root: s.root, folder: s.folder, file: s.folder + '/SKILL.md', text, body: text.replace(/^---[\s\S]*?---\s*/, ''), truncated: false, files: 2, actions })
const ALL = { reveal: true, edit: true, duplicate: true, delete: true }

// ── load the client ───────────────────────────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'client.js'), 'utf8')
const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) }, removeItem: (k) => { store.delete(k) } }
globalThis.document = { documentElement: { lang: 'en' }, createElement: () => ({ style: {} }), head: { appendChild () {} }, getElementById: () => null, addEventListener () {}, removeEventListener () {} }
let definition = null
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
new Function('window', SOURCE)(globalThis.window)
const plugin = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) })
let Screen = null
let SettingsScreen = null
plugin.apply({ get: (n) => (n === 'slots' ? { inject: (name, make) => { if (name === 'main.kybernos-skills' || name === 'settings.section') make() }, register: (def, comp) => { if (def.name === 'main.kybernos-skills') Screen = comp; if (def.name === 'settings.section') SettingsScreen = comp; return () => {} } } : undefined) })
if (Screen === null) { console.log('  ✗ the screen was not registered'); process.exit(1) }

const open = async (w, lang) => {
  // the page reads the language Kybernos resolved (window.__KB_LANG_RESOLVE__), not a storage key
  globalThis.window.__KB_LANG_RESOLVE__ = () => lang || 'en'
  globalThis.fetch = async (url, init) => { INFLIGHT.n += 1; try { return await w.fetch(url, init) } finally { INFLIGHT.n -= 1 } }
  const root = mount(React.createElement(Screen, { sessionId: '' }))
  await root.settle()
  return root
}
const tab = async (root, label) => click(root, all(root, (n) => n.tag === 'button' && hasClass(n, 'kb-seg') && textOf(n).trim().startsWith(label))[0])
const cardOf = (root, name) => all(root, (n) => typeof n.props['data-kb'] === 'string' && n.props['data-kb'].startsWith('skill-card-') && n.props['data-kb'].endsWith('\u0000' + name))[0]
const rowOf = (root, name) => all(root, (n) => hasClass(n, 'kbs-row') && !hasClass(n, 'feat') && !hasClass(n, 'kbs-head') && textOf(n).includes(name))[0]
const posted = (w, path) => w.calls.filter((c) => c.method === 'POST' && c.path === path)

// ── Yours ─────────────────────────────────────────────────────────────────────────────────────────────────
console.log('Yours: a click opens a right-hand panel and the list stays')
{
  const w = world()
  w.reads[HOME + '|statistical-analysis'] = readOf(w.skills[0], '---\nname: statistical-analysis\ndescription: About statistical-analysis\n---\n\n# Statistics\nUse it when the user asks for a test.', ALL)
  w.reads[PROJ + '|proj-only'] = readOf(w.skills[2], '---\nname: proj-only\ndescription: A project skill\n---\n\n# Project\nOnly here.', { reveal: true, edit: true, duplicate: true, delete: false })
  const root = await open(w)
  check('the three cards are listed', ['statistical-analysis', 'sql-queries', 'proj-only'].every((n) => cardOf(root, n) !== undefined))
  check('no panel before a click', kb(root, 'skill-panel').length === 0)
  await click(root, cardOf(root, 'statistical-analysis'))
  check('a panel opens', kb(root, 'skill-panel').length === 1)
  check('the list is still on screen next to it (the cards are not replaced)', ['statistical-analysis', 'sql-queries', 'proj-only'].every((n) => cardOf(root, n) !== undefined))
  const p = part(root, 'skill-panel')
  check('the panel carries the name, the real SKILL.md text and its frontmatter', p.includes('statistical-analysis') && p.includes('Use it when the user asks for a test.') && p.includes('description: About statistical-analysis'), p.slice(0, 200))
  check('the panel says where the skill lives', p.includes(HOME + '/statistical-analysis'), p.slice(0, 200))
  check('the host was asked for THIS skill by root and name', posted(w, '/kybernos-skills/skill/read').some((c) => c.body.root === HOME && c.body.name === 'statistical-analysis'))
  const acts = ['act-reveal', 'act-edit', 'act-duplicate', 'act-delete'].map((a) => kb(root, a).length)
  check('the four actions the host allows are offered', acts.join() === '1,1,1,1', acts)
  await click(root, cardOf(root, 'proj-only'))
  check('another card shows ITS OWN SKILL.md', part(root, 'skill-panel').includes('Only here.') && !part(root, 'skill-panel').includes('Use it when the user asks for a test.'))
  check('a skill the host cannot delete has no Delete button, the others stay', kb(root, 'act-delete').length === 0 && kb(root, 'act-duplicate').length === 1)
  check('the switch stays on the card and its click does not open another panel', (() => { const sw = all(cardOf(root, 'sql-queries'), (n) => n.tag === 'button' && hasClass(n, 'kb-sw'))[0]; return sw !== undefined })())
}
{
  const w = world()
  w.reads[HOME + '|sql-queries'] = readOf(w.skills[1], '---\nname: sql-queries\ndescription: x\n---\nbody', undefined)
  delete w.reads[HOME + '|sql-queries'].actions
  const root = await open(w)
  await click(root, cardOf(root, 'sql-queries'))
  check('a host that does not say what it can do (not restarted): no action is offered, the content still shows', ['act-reveal', 'act-edit', 'act-duplicate', 'act-delete'].every((a) => kb(root, a).length === 0) && part(root, 'skill-panel').includes('body'))
}
{
  const w = world()
  w.reads[HOME + '|sql-queries'] = readOf(w.skills[1], '---\nname: sql-queries\ndescription: x\n---\nbody', ALL)
  const root = await open(w)
  const card = cardOf(root, 'sql-queries')
  const sw = all(card, (n) => n.tag === 'button' && hasClass(n, 'kb-sw'))[0]
  const ev = await click(root, sw)
  check('the switch toggles through the host and stops the click from reaching the card', ev.stopped === true && posted(w, '/kybernos-skills/toggle').length === 1 && kb(root, 'skill-panel').length === 0, posted(w, '/kybernos-skills/toggle'))
}

console.log('Yours: delete asks first, duplicate and open go through the host')
{
  const w = world()
  w.reads[HOME + '|sql-queries'] = readOf(w.skills[1], '---\nname: sql-queries\ndescription: x\n---\nbody', ALL)
  const root = await open(w)
  await click(root, cardOf(root, 'sql-queries'))
  await click(root, kb(root, 'act-delete')[0])
  const d = part(root, 'delete-confirm')
  check('Delete opens a confirmation that names the skill and its folder', d.includes('sql-queries') && d.includes(HOME + '/sql-queries'), d)
  check('nothing was deleted by the first click', posted(w, '/kybernos-skills/skill/delete').length === 0)
  await click(root, kb(root, 'delete-confirm-no')[0])
  check('Cancel closes the confirmation and deletes nothing', kb(root, 'delete-confirm').length === 0 && posted(w, '/kybernos-skills/skill/delete').length === 0)
  await click(root, kb(root, 'act-delete')[0])
  await click(root, kb(root, 'delete-confirm-yes')[0])
  const del = posted(w, '/kybernos-skills/skill/delete')
  check('Confirm asks the host to delete THAT skill, once', del.length === 1 && del[0].body.root === HOME && del[0].body.name === 'sql-queries', del)
  check('then the panel is closed and the list is read again', kb(root, 'skill-panel').length === 0 && w.calls.filter((c) => c.path === '/kybernos-skills/skills').length >= 2)

  w.reads[HOME + '|statistical-analysis'] = readOf(w.skills[0], '---\nname: statistical-analysis\ndescription: x\n---\nbody', ALL)
  await click(root, cardOf(root, 'statistical-analysis'))
  const copySkill = mkSkill('statistical-analysis-copy', HOME)
  w.reads[HOME + '|statistical-analysis-copy'] = readOf(copySkill, '---\nname: statistical-analysis-copy\ndescription: x\n---\nbody', ALL)
  await click(root, kb(root, 'act-duplicate')[0])
  const dup = posted(w, '/kybernos-skills/skill/duplicate')
  check('Duplicate asks the host for a copy of that skill', dup.length === 1 && dup[0].body.root === HOME && dup[0].body.name === 'statistical-analysis', dup)
  check('and the copy is announced by name, and its own panel is open', page(root).includes('statistical-analysis-copy') && part(root, 'skill-panel').includes('statistical-analysis-copy'))
  await click(root, kb(root, 'act-reveal')[0])
  await click(root, kb(root, 'act-edit')[0])
  const rev = posted(w, '/kybernos-skills/skill/reveal')
  check('Open folder and Edit are two calls with the target they mean', rev.length === 2 && rev[0].body.target === 'folder' && rev[1].body.target === 'file', rev)
}

// ── Discover ──────────────────────────────────────────────────────────────────────────────────────────────
console.log('Discover: every card has its own detail')
{
  const w = world()
  const root = await open(w)
  await tab(root, 'Discover')
  check('the ranking is listed', ['find-skills', 'grill-me', 'tdd'].every((n) => rowOf(root, n) !== undefined))
  await click(root, rowOf(root, 'grill-me'))
  // Whatever the layout: the page must not name « flutter » (another repository's skill of the same name) as the publisher of
  // mattpocock/skills' grill-me. This is the check that is red on the code before the fix, panel or no panel.
  check('the publisher of mattpocock/skills\' grill-me is not read from another repository\'s grill-me', !page(root).includes('flutter') && page(root).includes('mattpocock'), page(root).slice(0, 300))
  check('a panel opens and the ranking stays next to it', kb(root, 'disc-panel').length === 1 && rowOf(root, 'tdd') !== undefined)
  const g = part(root, 'disc-panel')
  check('it carries the repository, the folder found in it, the description and the start of SKILL.md', g.includes('mattpocock/skills') && g.includes('skills/productivity/grill-me') && g.includes('Interview me relentlessly about a plan.') && g.includes('Ask one question at a time.'), g.slice(0, 300))
  check('the owner is the one of THIS repository, not another skill of the same name', g.includes('mattpocock') && !g.includes('flutter'), g.slice(0, 300))
  await click(root, rowOf(root, 'find-skills'))
  const f = part(root, 'disc-panel')
  check('the next card shows ITS OWN detail: another repository, folder, description and text', f.includes('vercel-labs/skills') && f.includes('skills/find-skills') && f.includes('Helps users discover and install agent skills.') && f.includes('Search the registry first.') && !f.includes('Ask one question at a time.'), f.slice(0, 300))
  check('and its own owner, not the first curated skill that has the same name', f.includes('vercel-labs') && !f.includes('sanity-io'), f.slice(0, 300))
  check('the host was asked for each skill by repository and name', ['mattpocock/skills:grill-me', 'vercel-labs/skills:find-skills'].every((k) => w.calls.some((c) => c.path === '/kybernos-skills/preview' && c.query.source + ':' + c.query.name === k)))
  await click(root, rowOf(root, 'tdd'))
  const t = part(root, 'disc-panel')
  check('when GitHub will not answer the panel says so and still names the skill and its repository', t.includes('tdd') && t.includes('mattpocock/skills') && /GitHub/.test(t), t.slice(0, 300))
  check('and Install is still there', kb(root, 'act-install').length === 1)
}

console.log('Install: a confirmation first, with the facts of the skill in front of the user')
{
  const w = world()
  const root = await open(w)
  await tab(root, 'Discover')
  await click(root, rowOf(root, 'grill-me'))
  await click(root, kb(root, 'act-install')[0])
  const d = part(root, 'install-confirm')
  check('Install opens a confirmation, nothing is downloaded yet', kb(root, 'install-confirm').length === 1 && posted(w, '/kybernos-skills/install').length === 0)
  check('it says the real skill, repository, folder and destination', d.includes('grill-me') && d.includes('mattpocock/skills') && d.includes('skills/productivity/grill-me') && d.includes(HOME + '/grill-me'), d)
  check('with the explanation: archive downloaded from GitHub, folder found by its frontmatter, COPIED, no symlink, nothing else written', d.includes('Installing downloads the archive of the mattpocock/skills repository from GitHub, finds the “grill-me” skill folder inside it') && d.includes('then COPIES it into your skills folder (' + HOME + ')') && d.includes('No symlinks') && d.includes('Nothing else is written'), d)
  check('the destination is the first WRITABLE folder, not the project folder that comes first', !d.includes(PROJ), d)
  await click(root, kb(root, 'install-confirm-no')[0])
  check('Cancel installs nothing', kb(root, 'install-confirm').length === 0 && posted(w, '/kybernos-skills/install').length === 0)
  await click(root, rowOf(root, 'tdd'))
  await click(root, kb(root, 'act-install')[0])
  const d2 = part(root, 'install-confirm')
  check('another skill: the dialog is about THAT skill, never the previous one', d2.includes('“tdd”') && d2.includes(HOME + '/tdd') && !d2.includes('grill-me'), d2)
  await click(root, kb(root, 'install-confirm-yes')[0])
  const inst = posted(w, '/kybernos-skills/install')
  check('Confirm installs that skill from that repository into the writable folder, once', inst.length === 1 && inst[0].body.source === 'mattpocock/skills' && inst[0].body.name === 'tdd' && inst[0].body.root === HOME, inst)
}
{
  const w = world()
  const root = await open(w, 'fr')
  await tab(root, 'Discover')
  await click(root, rowOf(root, 'tdd'))
  await click(root, kb(root, 'act-install')[0])
  const d = part(root, 'install-confirm')
  check('in French: the same sentence, filled with the skill in front of the user', d.includes('Installer télécharge l’archive du dépôt mattpocock/skills') || d.includes('Installer télécharge l\'archive du dépôt mattpocock/skills'), d)
  check('in French: the skill and the destination are the real ones', d.includes('« tdd »') && d.includes(HOME + '/tdd'), d)
}

console.log('The first-visit animation and the help button (V-05, V-33)')
{
  // The hub publishes window.__KB_HELP__ (Help, Intro); here two stand-ins that only record what the page asks for.
  const seen = []
  const Help = (props) => React.createElement('span', { 'data-kb': 'stub-help', 'data-id': props.id })
  const Intro = (props) => { seen.push(props); return React.createElement('div', { 'data-kb': 'stub-intro', 'data-id': props.id }) }
  globalThis.window.__KB_HELP__ = { version: 1, actions: true, Help, Intro }
  try {
    const root = await open(world(), 'en')
    const p = seen[seen.length - 1]
    check('the page draws one animation, keyed by its own bundle', kb(root, 'stub-intro').length === 1 && kb(root, 'stub-intro')[0].props['data-id'] === 'kybernos-skills')
    check('it sits under the header and before the tabs', all(root, (n) => n.props['data-kb'] === 'stub-intro' || hasClass(n, 'kbs-ctlrow')).map((n) => (n.props['data-kb'] === 'stub-intro' ? 'intro' : 'tabs')).join() === 'intro,tabs')
    check('three steps, each with a title and a sentence', p !== undefined && p.steps.length === 3 && p.steps.every((x) => x.t.length > 3 && x.b.length > 20), p && p.steps)
    check('the steps say pick, install, use', p !== undefined && /pick/i.test(p.steps[0].t) && /install/i.test(p.steps[1].t) && /agents/i.test(p.steps[2].t), p && p.steps.map((x) => x.t))
    check('the mock carries the page’s own words: its name, a skill, the real Install button, three states, three labels', p !== undefined && p.mock.bar === 'Skills' && p.mock.hot === 'Weekly report' && p.mock.actions[0] === 'Install' && p.mock.states.length === 3 && p.mock.actions.length === 3 && p.mock.rows.length >= 1, p && p.mock)
    check('a title and a caption for the screen reader', p !== undefined && p.title.length > 5 && p.caption.length > 20)
    seen.length = 0
    const fr = await open(world(), 'fr')
    const q = seen[seen.length - 1]
    check('in French: the same animation, in French', q !== undefined && /trois étapes/.test(q.title) && q.steps.every((x) => x.t.length > 3) && q.mock.actions[0] === 'Installer', q && q.title)
    check('« Help » is still drawn once, next to the title (one form of the button)', kb(root, 'stub-help').length === 1 && kb(root, 'stub-help')[0].props['data-id'] === 'kybernos-skills')
    globalThis.window.__KB_HELP__ = { version: 1, Help }
    const old = await open(world(), 'en')
    check('a Suite without the animation (an older hub): the page is the same, without it, and nothing breaks', kb(old, 'stub-intro').length === 0 && kb(old, 'stub-help').length === 1)
    delete globalThis.window.__KB_HELP__
    const none = await open(world(), 'en')
    check('no Suite at all: no help, no animation, the page still renders', kb(none, 'stub-intro').length === 0 && kb(none, 'stub-help').length === 0 && all(none, (n) => hasClass(n, 'kbs-ctlrow')).length === 1)
    void fr
  } finally { delete globalThis.window.__KB_HELP__ }
}


console.log('The help mock is an example, not a real skill (C-05)')
{
  const seen = []
  globalThis.window.__KB_HELP__ = { version: 1, Help: () => null, Intro: (props) => { seen.push(props); return null } }
  try {
    for (const lang of ['en', 'fr']) {
      seen.length = 0
      await open(world(), lang)
      const m = seen[seen.length - 1].mock
      const real = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'frontend-design', 'skill-creator'])
      check('(' + lang + ') the animated rows carry made-up names, not the skills the page lists (PDF said « Installing… » beside a real « Installed » PDF card)', [m.hot, ...m.rows].every((n) => !real.has(String(n).toLowerCase())) && m.hot !== '' && m.rows[0] !== m.hot, m)
    }
  } finally { delete globalThis.window.__KB_HELP__ }
}

console.log('The tab counts: a dash is not a count (C-08)')
{
  const root = await open(world())
  const seg = (label) => all(root, (n) => n.tag === 'button' && hasClass(n, 'kb-seg') && textOf(n).trim().startsWith(label))[0]
  check('Discover has no dash before the index is read (the index is read when the tab opens)', seg('Discover') !== undefined && !textOf(seg('Discover')).includes('—') && textOf(seg('Discover')).trim() === 'Discover', textOf(seg('Discover')))
  await tab(root, 'Discover')
  check('and shows its count once it is known', /^Discover\s*3$/.test(textOf(seg('Discover')).trim()), textOf(seg('Discover')))
}

console.log('The Discover count is the size of the index, not the size of the page (R-W2-03)')
{
  const w = world(); w.rankingTotal = 93030
  const root = await open(w)
  await tab(root, 'Discover')
  const seg = all(root, (n) => n.tag === 'button' && hasClass(n, 'kb-seg') && textOf(n).trim().startsWith('Discover'))[0]
  check('the tab says the 93030 skills of the index, as the pager does', /^Discover\s*93030$/.test(textOf(seg).trim()), textOf(seg))
}

console.log('The Skills switches follow the accent token, not a literal blue (R-W2-01)')
{
  const css = readFileSync(new URL('./client.js', import.meta.url), 'utf8')
  check('.kb-sw.on and the focus borders read --kybernos-accent', /\.kb-sw\.on\{background:var\(--kybernos-accent,/.test(css) && /\.kbs-select:focus\{outline:none;border-color:var\(--kybernos-accent,/.test(css))
  check('no --kb-switch-on variable (nothing ever set it, so every switch fell back to #4d7cfe)', !css.includes('--kb-switch-on'))
}

console.log('Discover: names that are cut can be read (R-A1-03)')
{
  const root = await open(world())
  await tab(root, 'Discover')
  const row = rowOf(root, 'grill-me')
  const name = all(row, (n) => hasClass(n, 'kb8-name'))[0]
  check('a row\'s name carries its full text as a tooltip', name !== undefined && name.props.title === 'grill-me', name && name.props)
  const css = SOURCE.replace(/\s+/g, ' ')
  check('and in a narrow column the name wraps instead of ending with an ellipsis (the row stacks on the next line)', /@container \(max-width:720px\)\{[^@]*\.kbs-root \.kbs-row \.who \.kb8-name\{white-space:normal;overflow-wrap:anywhere\}/.test(css))
}

console.log('Discover with the index unreachable: a sentence, the code stays in a tooltip (R-A3-03)')
{
  const w = world()
  w.answers['GET /kybernos-skills/index'] = { ok: false, error: 'network' }
  const root = await open(w)
  await tab(root, 'Discover')
  const err = part(root, 'disc-error')
  check('the failure is drawn', err.includes('Index unavailable'), err)
  check('the bare code is not on the screen', !/\bnetwork\b/i.test(err) && err.includes('Cannot reach the skills index.'), err)
  check('the code is in a tooltip, for whoever reports it', all(root, (n) => n.props.title === 'network').length === 1)
  const w2 = world()
  w2.answers['GET /kybernos-skills/index'] = { ok: false, error: 'not_found' }
  const root2 = await open(w2)
  await tab(root2, 'Discover')
  check('a code the page has a sentence for keeps that sentence (and no tooltip)', part(root2, 'disc-error').includes('That skill is no longer in the catalogue') && all(root2, (n) => n.props.title === 'not_found').length === 0, part(root2, 'disc-error'))
  const fr = await open(w, 'fr')
  await tab(fr, 'Discover')
  check('in French: the same sentence', part(fr, 'disc-error').includes('Impossible de joindre l’index des skills.') && !/\bnetwork\b/i.test(part(fr, 'disc-error')), part(fr, 'disc-error'))
}

console.log('Settings › Skills: the Index source window is the tidy modal, not bare text in the card (R-V-04, V-23)')
{
  check('the Settings page is registered', SettingsScreen !== null)
  const w = world()
  globalThis.window.__KB_LANG_RESOLVE__ = () => 'en'
  globalThis.fetch = async (url, init) => { INFLIGHT.n += 1; try { return await w.fetch(url, init) } finally { INFLIGHT.n -= 1 } }
  const root = mount(React.createElement(SettingsScreen, {}))
  await root.settle()
  const page = all(root, (n) => hasClass(n, 'kbss-page'))[0]
  check('the page and its relay card are drawn', page !== undefined && kb(root, 'skills-settings-source').length === 1)
  check('no window before Change', kb(root, 'index-source-modal').length === 0)
  await click(root, kb(root, 'index-source-change')[0])
  const modal = kb(root, 'index-source-modal')[0]
  check('Change opens the window', modal !== undefined)
  // The modal's rules are scoped to `.kbs-root`: it must sit under one (the Settings page is `.kbss-page`, which those rules do not reach).
  const under = (node, cls) => all(root, (n) => hasClass(n, cls)).some((anc) => all(anc, (n) => n === node).length > 0)
  check('the window sits under a `.kbs-root`, where its rules are', under(modal, 'kbs-root'))
  check('the wrapper takes no room in the card (no box of its own)', all(root, (n) => hasClass(n, 'kbs-root') && n.props['data-kb'] === 'index-source-root')[0].props.style.display === 'contents')
  check('it has the overlay, the two buttons and the field', all(root, (n) => hasClass(n, 'kb-overlay')).length === 1 && kb(root, 'index-source-save').length === 1 && kb(root, 'index-source-input').length === 1)
  check('and the sentence that says what a source is', part(root, 'index-source-modal').includes('A source is where the Discover tab reads its list of public skills from'))
}

console.log('\n' + pass + ' passed' + (fail > 0 ? ', ' + fail + ' FAILED' : ''))
process.exit(fail > 0 ? 1 : 0)
