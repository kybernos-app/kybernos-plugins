#!/usr/bin/env node
// The facts the Changes plugin reads from the sessions client (`faitsChangements`) and the code that turns a
// `git status --porcelain` line into a kind of change. No browser, no dependency.
//
//   node packages/kybernos-sessions/test-changes-facts.mjs
//
// What this pins: the Changes chip must never say something the four pills would not. It reads the same views
// (vueLocal / vueSync / vuePr), so these tests build a session the way the host's state route would and check
// the facts and the actions (by ROLE) that come out.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fichiersSales } from './index.js'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const SOURCE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
// An element is { type, props }: what `descripteur` reads, as React's own elements carry `props` too.
const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: (v) => [v, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (f) => f, useMemo: (f) => f(), Fragment: 'fragment' }
let definition = null
globalThis.window = { __ModuleLoader__: { load: (def) => { definition = def } } }
globalThis.document = { createElement: () => ({ style: {} }), head: { append() {} }, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }
new Function('window', SOURCE)(globalThis.window)
const mod = definition.factory((spec) => { if (spec === 'react') return React; throw new Error('unexpected require ' + spec) })
const { faitsChangements, genreDeCode, descripteur } = mod.__test

// ── a session as the state route gives it ──────────────────────────────────────────────────────────────────────
const sess = (git, extra) => Object.assign({
  session: 'sid', chemin: '/work/proj', slug: 'proj', sessionsActives: 1, sessionsTotal: 1, worktrees: 0,
  git: Object.assign({ git: true, branche: 'main', modifications: 0, sale: [], fichiers: [], commitsNonPousses: 0, commitsRecus: 0, nonFusionnes: 0, base: 'main', distant: 'git@github.com:acme/proj.git', worktree: null, dernierFetch: null }, git),
  sync: { distant: 'git@github.com:acme/proj.git', branche: 'main', commitsNonPousses: 0, commitsRecus: 0, dernierFetch: null },
  pr: null
}, extra)
const travail = (chemins, extra) => Object.assign({ fait: false, quoi: 'écriture', ecritures: chemins.length, chemins }, extra)

console.log('not a project')
check('no folder: not git, and why', JSON.stringify(faitsChangements(null, 'sid', null)) === JSON.stringify({ git: false, pourquoi: 'dossier' }))
check('a folder outside git: not git, and why', faitsChangements({ git: { git: false }, chemin: '/x' }, 'sid', null).pourquoi === 'git')

console.log('a clean main folder')
{
  const f = faitsChangements(sess({}), 'sid', null)
  check('git, nothing unsaved, nothing to send, no action', f.git === true && f.unsaved === 0 && f.ahead === 0 && f.behind === 0 && Object.keys(f.actions).length === 0, f)
  check('the branch, the base and the folder are carried for the developer view', f.branch === 'main' && f.base === 'main' && f.folder === '/work/proj' && f.onBase === true)
  check('it is not an isolated copy', f.isolated === false && f.isolatedName === '')
}

console.log('this chat has unsaved work')
{
  const s = sess({ modifications: 3, sale: ['src/a.js', 'src/b.js', 'logo.png'], fichiers: [{ code: 'M', chemin: 'src/a.js' }, { code: 'M', chemin: 'src/b.js' }, { code: '??', chemin: 'logo.png' }] })
  const f = faitsChangements(s, 'sid', travail(['/work/proj/src/a.js', '/work/proj/src/b.js']))
  check('the unsaved count is THIS chat’s, read from the disk (2 of the 3 dirty files)', f.unsaved === 2 && f.unsavedKnown === true && f.folderDirty === 3, f)
  check('each file carries its kind, and whether it is this chat’s', JSON.stringify(f.files) === JSON.stringify([{ path: 'src/a.js', kind: 'modified', mine: true }, { path: 'src/b.js', kind: 'modified', mine: true }, { path: 'logo.png', kind: 'new', mine: false }]), f.files)
  check('the actions: save (this chat’s files only) and the local-only save', f.actions.save !== undefined && f.actions.save.url === '/kybernos-sessions/commit' && f.actions.save.corps.chemins.length === 2 && f.actions.saveLocal !== undefined && f.actions.saveLocal.corps.local === true, Object.keys(f.actions))
  const g = faitsChangements(s, 'sid', null)
  check('without a readable journal the folder count stands in, and the files are not attributed', g.unsaved === 3 && g.unsavedKnown === false && g.files.every((x) => x.mine === null), g)
  const h = faitsChangements(sess({ modifications: 1, sale: ['a.js'] }, { sessionsActives: 3 }), 'sid', travail(['/work/proj/a.js']))
  check('chats sharing the folder are counted (the others, not this one)', h.sharedWith === 2, h.sharedWith)
}

console.log('kinds of change from `git status --porcelain`')
{
  const kinds = { '??': 'new', M: 'modified', MM: 'modified', A: 'new', D: 'deleted', R: 'renamed', UU: 'conflict', AA: 'conflict', DD: 'conflict', AU: 'conflict', '': 'modified' }
  for (const code of Object.keys(kinds)) check('« ' + code + ' » is ' + kinds[code], genreDeCode(code) === kinds[code], genreDeCode(code))
  const parsed = fichiersSales(' M src/a.js\n?? new dir/\nR  old.js -> new.js\nUU both.js\n D gone.js\n')
  check('the host parser keeps the code and, for a rename, the NEW path', JSON.stringify(parsed.map((x) => [x.code, x.chemin])) === JSON.stringify([['M', 'src/a.js'], ['??', 'new dir/'], ['R', 'new.js'], ['UU', 'both.js'], ['D', 'gone.js']]), parsed)
  check('a quoted path loses its quotes', fichiersSales('?? "with space.js"\n')[0].chemin === 'with space.js')
  check('a conflict is counted', faitsChangements(sess({ modifications: 1, sale: ['x.js'], fichiers: [{ code: 'UU', chemin: 'x.js' }] }), 'sid', null).conflicts === 1)
  check('a host that gives no `fichiers` (not restarted yet) leaves the kind unknown, nothing else breaks', faitsChangements(sess({ modifications: 1, sale: ['x.js'], fichiers: undefined }), 'sid', null).files[0].kind === null)
}

console.log('GitHub: send, fetch, sync')
{
  const push = faitsChangements(sess({}, { sync: { distant: 'git@github.com:a/b.git', commitsNonPousses: 2, commitsRecus: 0, dernierFetch: '2026-10-06T10:00:00Z' } }), 'sid', null)
  check('ahead of GitHub: 2 to send, and the push action', push.ahead === 2 && push.behind === 0 && push.actions.push !== undefined && push.actions.push.url === '/kybernos-sessions/push', push)
  const fetchF = faitsChangements(sess({}, { sync: { distant: 'git@github.com:a/b.git', commitsNonPousses: 0, commitsRecus: 4 } }), 'sid', null)
  check('behind GitHub: 4 to fetch, and the fetch action', fetchF.behind === 4 && fetchF.actions.fetch !== undefined && fetchF.actions.fetch.url === '/kybernos-sessions/fetch')
  const both = faitsChangements(sess({}, { sync: { distant: 'git@github.com:a/b.git', commitsNonPousses: 1, commitsRecus: 1 } }), 'sid', null)
  check('both: the sync action (fetch, then send)', both.actions.sync !== undefined && both.actions.sync.url === '/kybernos-sessions/sync' && both.actions.push === undefined)
  check('the last check is carried', push.lastFetch === '2026-10-06T10:00:00Z')
  const noGithub = faitsChangements(sess({ distant: 'git@gitlab.com:a/b.git' }, { sync: { distant: 'git@gitlab.com:a/b.git', commitsNonPousses: 3, commitsRecus: 0 } }), 'sid', null)
  check('a remote that is not GitHub: no push, fetch, sync or review action (the pills show none either)', noGithub.github === false && noGithub.actions.push === undefined && noGithub.actions.askReview === undefined)
  const noRemote = faitsChangements(sess({ distant: null }, { sync: { distant: null } }), 'sid', null)
  check('no remote: nothing to send, nothing to fetch', noRemote.remote === null && noRemote.ahead === 0 && noRemote.github === false)
}

console.log('an isolated copy and the review')
{
  const copy = { branche: 'feat/x', base: 'main', worktree: '/work/proj/.worktrees/x', nonFusionnes: 2 }
  const f = faitsChangements(sess(copy), 'sid', null)
  check('a copy with commits not in the project: isolated, 2 not merged, add-to-project offered, and the review can be asked', f.isolated === true && f.isolatedName === 'x' && f.notMerged === 2 && f.actions.addToProject !== undefined && f.actions.addToProject.corps.chemins === undefined && f.actions.askReview !== undefined && f.actions.askReview.corps.action === 'create', f)
  const open = faitsChangements(sess(copy, { pr: { numero: 12, titre: 'Do x', etat: 'open', checks: 'pass', revue: 'approved', url: 'https://github.com/a/b/pull/12', cible: 'main', branche: 'feat/x' } }), 'sid', null)
  check('an approved review request: merge offered, the request is carried', open.pr.number === 12 && open.pr.review === 'approved' && open.pr.url.indexOf('github.com') > 0 && open.actions.merge !== undefined && open.actions.merge.corps.action === 'merge' && open.actions.askReview === undefined, open)
  const running = faitsChangements(sess(copy, { pr: { numero: 12, titre: '', etat: 'open', checks: 'running', revue: 'review_required', url: '', cible: 'main', branche: 'feat/x' } }), 'sid', null)
  check('checks still running: no action to offer', running.actions.merge === undefined && running.actions.askReview === undefined && running.pr.checks === 'running')
  const clean = faitsChangements(sess({ branche: 'feat/x', base: 'main', worktree: '/work/proj/.worktrees/x', nonFusionnes: 0 }), 'sid', null)
  check('a clean copy can be closed', clean.actions.closeCopy !== undefined && clean.actions.closeCopy.url === '/kybernos-sessions/close')
  const shared = faitsChangements(sess({ modifications: 2, sale: ['a', 'b'] }, { sessionsActives: 2 }), 'sid', travail(['/work/proj/zzz.js']))
  check('dirty files that are other chats’: this chat is clean, and giving it its own copy is offered', shared.unsaved === 0 && shared.folderDirty === 2 && shared.sharedWith === 1 && shared.actions.isolate !== undefined && shared.actions.isolate.url === '/kybernos-sessions/isolate', shared)
}

console.log('the descriptor')
{
  check('an element that is not a plan action gives no descriptor', descripteur(null) === null && descripteur({ props: {} }) === null && descripteur({ props: { url: 5 } }) === null)
  const d = descripteur({ props: { url: '/u', corps: { a: 1 }, label: 'L', hint: 'H', extra: 'ignored' } })
  check('a plan action keeps only url, body, label and hint', JSON.stringify(d) === JSON.stringify({ url: '/u', corps: { a: 1 }, label: 'L', hint: 'H' }))
}

console.log('the seam and the pills')
check('the seam is published for the Changes plugin, with a version', /window\.__KB_SESSIONS_VIEW__ = \{ version: 1, read: lireChangements \}/.test(SOURCE))
check('the four git pills step aside while the Changes plugin is active; Memory & Lessons stays', /changesOn \? null : pill\('local'/.test(SOURCE) && /changesOn \? null : pill\('recap'/.test(SOURCE) && /!changesOn && v \? pill\('sync'/.test(SOURCE) && /!changesOn && r \? pill\('pr'/.test(SOURCE) && /\n        pill\('notes'/.test(SOURCE))
check('the hooks come before the early return of Pills (React’s rule of hooks)', SOURCE.indexOf('const [changesOn, setChangesOn]') > 0 && SOURCE.indexOf('const [changesOn, setChangesOn]') < SOURCE.indexOf('if (etat === null) return null'))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
