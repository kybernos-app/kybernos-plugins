#!/usr/bin/env node
// Browser half of kybernos-changes: what the facts mean (the pure part), the words in both languages, the
// contract with DSH and the rules of the bundle. No browser, no dependency; the chip itself, in a real page,
// is covered by scripts/check-changes-live.mjs.
//
//   node packages/kybernos-changes/test-client.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const HERE = dirname(fileURLToPath(import.meta.url))
const SOURCE = readFileSync(join(HERE, 'client.js'), 'utf8')
const store = new Map()
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)) }, removeItem: (k) => { store.delete(k) } }
globalThis.document = { documentElement: { lang: 'en' }, createElement: () => ({ style: {} }), head: { appendChild() {} }, getElementById: () => null }
let definition = null
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
new Function('window', SOURCE)(globalThis.window)
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f, Fragment: 'fragment' }
const mod = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) })
const T = mod.__test
const setLang = (l) => { globalThis.window.__KB_LANG_RESOLVE__ = () => l }

// ── the contract with DSH ────────────────────────────────────────────────────────────────────────────────────────
console.log('the contract')
check('the factory returns a plugin object (an undefined breaks the whole entry)', mod !== undefined && mod !== null && typeof mod.apply === 'function')
check('it declares the slots service and nothing else', JSON.stringify(mod.inject) === JSON.stringify(['slots']))
{
  const registered = []
  const ctx = { effect: (fn) => { fn() }, slots: { inject: (name, make) => { make() }, register: (def, comp) => { registered.push({ def, comp }); return () => {} } } }
  mod.apply(ctx)
  check('it puts its chip in the composer dock, before the sessions pills (order 5)', registered.length === 1 && registered[0].def.name === 'conversation.composer.dock' && registered[0].def.id === 'kybernos-changes' && registered[0].def.order < 5, registered.map((r) => r.def))
  check('the dock component receives the session id and never throws', (() => { try { registered[0].comp({ sessionId: 's1' }); registered[0].comp({}); registered[0].comp(); return true } catch (e) { return false } })() === true)
}
{
  let d2 = null
  const w = { __ModuleLoader__: { load: (def) => { d2 = def } } }
  new Function('window', SOURCE)(w)
  const broken = d2.factory(() => { throw new Error('react missing') })
  check('a load error gives a disabled plugin, not an exception (the GUI is preserved)', broken !== undefined && typeof broken.apply === 'function' && broken.inject === undefined)
}

// ── what the facts mean ──────────────────────────────────────────────────────────────────────────────────────────
console.log('the states, in priority order')
const base = (o) => Object.assign({ git: true, unsaved: 0, files: [], folderDirty: 0, sharedWith: 0, ahead: 0, behind: 0, notMerged: 0, conflicts: 0, isolated: false, pr: null, actions: {} }, o)
const A = (...roles) => Object.fromEntries(roles.map((r) => [r, { url: '/kybernos-sessions/x', corps: {}, label: '', hint: '' }]))
const key = (f) => { const m = T.classify(f); return m === null ? null : m.key }
check('not a project: nothing to say', T.classify({ git: false }) === null && T.classify(null) === null && T.classify(undefined) === null)
check('clean: everything is saved, all four steps done, nothing to do', (() => { const m = T.classify(base({})); return m.key === 'ok' && m.tone === 'ok' && m.primary === null && T.stepStates(m).every((s) => s === 'done') })())
check('a clean isolated copy offers to close the copy', T.classify(base({ isolated: true, actions: A('closeCopy') })).primary === 'closeCopy')
check('a conflict beats everything: red, blocked at "saved"', (() => { const m = T.classify(base({ conflicts: 1, unsaved: 3, ahead: 2 })); return m.key === 'conflict' && m.tone === 'err' && T.stepStates(m)[1] === 'bad' })())
check('unsaved work comes next: amber, the first step is the current one, save is the primary and the local save the other way', (() => { const m = T.classify(base({ unsaved: 2, actions: A('save', 'saveLocal') })); return m.key === 'unsaved' && m.tone === 'warn' && m.primary === 'save' && JSON.stringify(m.secondary) === '["saveLocal"]' && T.stepStates(m)[0] === 'now' && T.stepStates(m)[1] === 'todo' })())
check('… with only the local save available, that one is the primary', (() => { const m = T.classify(base({ unsaved: 1, actions: A('saveLocal') })); return m.primary === 'saveLocal' && m.secondary.length === 0 })())
check('… with no action at all (a host that refuses), there is no primary and nothing breaks', T.classify(base({ unsaved: 1 })).primary === null)
check('ahead of GitHub: info, saved here, push is the primary, 2 steps done', (() => { const m = T.classify(base({ ahead: 3, actions: A('push') })); return m.key === 'toSend' && m.tone === 'info' && m.primary === 'push' && T.stepStates(m).filter((s) => s === 'done').length === 1 && T.stepStates(m)[1] === 'now' })())
check('ahead and behind: amber, sync', (() => { const m = T.classify(base({ ahead: 1, behind: 2, actions: A('sync') })); return m.key === 'sync' && m.tone === 'warn' && m.primary === 'sync' })())
check('an isolated copy not in the project: add it, or ask for a review', (() => { const m = T.classify(base({ isolated: true, notMerged: 2, actions: A('addToProject', 'askReview') })); return m.key === 'notInProject' && m.primary === 'addToProject' && JSON.stringify(m.secondary) === '["askReview"]' })())
check('a copy ready for a review request', (() => { const m = T.classify(base({ isolated: true, actions: A('askReview') })); return m.key === 'readyReview' && m.primary === 'askReview' })())
check('behind GitHub only: the news is fetched, and the work is done', (() => { const m = T.classify(base({ behind: 2, actions: A('fetch') })); return m.key === 'toFetch' && m.primary === 'fetch' && m.done === true })())
check('dirty files that belong to other chats: nothing to save here, and a copy of its own is offered', (() => { const m = T.classify(base({ folderDirty: 4, sharedWith: 2, actions: A('isolate') })); return m.key === 'elsewhere' && m.tone === 'info' && JSON.stringify(m.secondary) === '["isolate"]' && m.primary === null })())
console.log('the review')
{
  const pr = (o) => base({ isolated: true, pr: Object.assign({ number: 7, title: 't', state: 'open', checks: 'pass', review: 'approved', url: '' }, o), actions: A('merge') })
  check('a failed check: red, blocked at "on GitHub"', (() => { const m = T.classify(pr({ checks: 'fail' })); return m.key === 'prFail' && m.tone === 'err' && T.stepStates(m)[2] === 'bad' })())
  check('changes asked: amber, blocked', (() => { const m = T.classify(pr({ review: 'changes_requested' })); return m.key === 'prChanges' && m.tone === 'warn' && T.stepStates(m)[2] === 'bad' })())
  check('checks running: waiting (the step shows it waits, nothing to press)', (() => { const m = T.classify(pr({ checks: 'running', review: 'review_required' })); return m.key === 'prChecks' && T.stepStates(m)[2] === 'wait' && m.primary === null })())
  check('checks passed, review pending: waiting for a teammate', (() => { const m = T.classify(pr({ review: 'review_required' })); return m.key === 'prWaiting' && T.stepStates(m)[2] === 'wait' })())
  check('approved and passing: ready to merge, merge is the primary', (() => { const m = T.classify(pr({})); return m.key === 'prReady' && m.tone === 'ok' && m.primary === 'merge' })())
  check('merged: in the project, fetch the update', (() => { const m = T.classify(base({ pr: { state: 'merged', checks: 'pass', review: 'approved' }, actions: A('fetch') })); return m.key === 'prMerged' && m.done === true && m.primary === 'fetch' && T.stepStates(m).every((s) => s === 'done') })())
  check('a review that is open comes before "send to GitHub" (the request IS on GitHub)', key(base({ isolated: true, ahead: 2, actions: A('push'), pr: { state: 'open', checks: 'running', review: 'review_required' } })) === 'prChecks')
}
check('every state key has a wording (chip, title, sentence), none empty and none a raw key', (() => {
  const keys = ['unsaved', 'toSend', 'sync', 'notInProject', 'readyReview', 'prChecks', 'prWaiting', 'prChanges', 'prFail', 'prReady', 'prMerged', 'toFetch', 'conflict', 'elsewhere', 'ok']
  for (const lg of ['kybernos', 'en']) {
    setLang(lg)
    for (const k of keys) {
      const w = T.wording({ key: k }, { unsaved: 2, ahead: 2, behind: 1, folderDirty: 3, sharedWith: 1, isolated: false, actions: {} })
      if (w.length !== 3 || w.some((x) => typeof x !== 'string' || x === '' || /\{\w+\}/.test(x) || /^(chip|t|x)[A-Z]/.test(x))) return false
    }
  }
  return true
})())

// ── the words ──────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('the words, in two languages')
{
  const pairs = Object.entries(T.S)
  check('every string has a French and an English side, neither empty', pairs.every(([k, p]) => Array.isArray(p) && p.length === 2 && p[0].length > 0 && p[1].length > 0))
  const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',')
  check('both sides of a pair carry the same placeholders', pairs.every(([k, p]) => ph(p[0]) === ph(p[1])), pairs.filter(([k, p]) => ph(p[0]) !== ph(p[1])).map((x) => x[0]))
  const used = new Set([...SOURCE.matchAll(/\bL\('([A-Za-z0-9]+)'/g)].map((m) => m[1]))
  const roleKeys = Object.values(T.ROLES).flatMap((r) => [r[0], r[1]])
  const missing = [...used, ...roleKeys].filter((k) => T.S[k] === undefined)
  check('every key the code asks for exists', missing.length === 0, missing)
  const unused = Object.keys(T.S).filter((k) => !used.has(k) && !roleKeys.includes(k) && !SOURCE.includes("'" + k + "'") && !/^(chip|t|x)[A-Z]/.test(k) && !/^(step|k[A-Z])/.test(k))
  check('no string is dead (every key is asked for somewhere)', unused.length === 0, unused)
  setLang('kybernos'); check('French shows the French side', T.L('aSave') === 'Sauvegarder mon travail')
  setLang('en'); check('English shows the English side', T.L('aSave') === 'Save my work')
  globalThis.window.__KB_I18N_ACTIVE__ = { dict: { 'Sauvegarder mon travail': 'Guardar mi trabajo' } }
  setLang('es'); check('a translated language is looked up by the French text, and falls back to English', T.L('aSave') === 'Guardar mi trabajo' && T.L('aPush') === 'Send to GitHub')
  delete globalThis.window.__KB_I18N_ACTIVE__
  setLang('en'); check('placeholders are filled', T.L('chipUnsavedN', { n: 4 }) === '4 files to save')
  check('a typo shows itself instead of blanking the chip', T.L('noSuchKey') === 'noSuchKey')
  check('the Simple view says no git word in the main labels', Object.values(T.ROLES).every((r) => !/\b(commit|push|fetch|merge|pull request|worktree)\b/i.test(T.S[r[0]][0] + ' ' + T.S[r[0]][1])), Object.values(T.ROLES).map((r) => T.S[r[0]][1]))
  check('every role also carries the git word a developer knows it by', Object.values(T.ROLES).every((r) => typeof r[2] === 'string' && r[2].length > 2))
}

// ── the preference ──────────────────────────────────────────────────────────────────────────────────────────────────
console.log('the view preference')
{
  store.clear()
  check('Simple until the user chooses otherwise', T.readMode() === 'simple')
  T.writeMode('dev'); check('Developer is remembered', T.readMode() === 'dev' && localStorage.getItem('kybernos.changes.mode') === 'dev')
  T.writeMode('simple'); check('and so is going back', T.readMode() === 'simple')
  localStorage.setItem('kybernos.changes.mode', 'whatever'); check('an unknown value reads as Simple', T.readMode() === 'simple')
}

// ── the rules of the bundle ───────────────────────────────────────────────────────────────────────────────────────────
console.log('the rules of the bundle')
{
  check('no hard-coded colour outside a token fallback (the user switches themes)', !/(?<![,(\s]var\([^)]*)(color|background|border-color)\s*:\s*#[0-9a-fA-F]{3,8}/.test(T.CSS.replace(/var\([^)]*\)/g, 'var(X)')), T.CSS.match(/(color|background)\s*:\s*#[0-9a-fA-F]{3,8}/g))
  check('no provider or network host in the source (it only talks to its own origin)', !/https?:\/\/(?!github\.com)[a-z0-9.-]+/i.test(SOURCE.replace(/\/\/.*$/gm, '')))
  check('it never posts anywhere but the sessions routes (the descriptors come from them)', !/fetch\('\//.test(SOURCE) && /fetch\(url,/.test(SOURCE))
  check('the dry run comes first: the plan is asked with exec:false, the action only after a confirm', /exec: false/.test(SOURCE) && /exec: true/.test(SOURCE) && SOURCE.indexOf('exec: false') < SOURCE.indexOf('exec: true'))
  check('hooks come before the early return (React’s rule of hooks)', SOURCE.indexOf('const m = usable ? classify(facts) : null') > SOURCE.lastIndexOf('React.useEffect('))
  check('Escape closes the card and a click elsewhere does too', /e\.key === 'Escape'/.test(SOURCE) && /mousedown/.test(SOURCE))
  check('stable hooks for the live check: data-kb and data-act on the chip, card and buttons', ['changes-chip', 'changes-card', 'changes-files', 'changes-confirm', 'changes-dev'].every((k) => SOURCE.includes("'data-kb': '" + k + "'")) && ['primary', 'confirm', 'back', 'mode-simple', 'mode-dev'].every((k) => SOURCE.includes("'data-act': '" + k + "'")))
  check('the pills are told only once something is on screen (and never when the seam is missing)', /if \(usable\) announce\(\)/.test(SOURCE) && /__KB_SESSIONS_VIEW__/.test(SOURCE))
  // The class prefix is shared by every bundle: a class defined twice is styled twice.
  const mine = new Set((T.CSS.match(/\.(kbch-[A-Za-z0-9_-]+)/g) || []).map((c) => c.slice(1)))
  const PACKAGES = join(HERE, '..')
  const clash = []
  for (const dir of readdirSync(PACKAGES)) {
    if (dir === 'kybernos-changes') continue
    const f = join(PACKAGES, dir, 'client.js')
    if (!existsSync(f)) continue
    const other = readFileSync(f, 'utf8')
    for (const c of mine) if (other.includes('.' + c)) clash.push(dir + ':' + c)
  }
  check('no class this bundle defines is defined by another one', mine.size > 20 && clash.length === 0, clash.slice(0, 5))
  check('the package declares a client and a patch, and the host entry never throws', existsSync(join(HERE, 'package.json')) && existsSync(join(HERE, 'cordis.patch.yml')) && existsSync(join(HERE, 'index.js')))
}

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
