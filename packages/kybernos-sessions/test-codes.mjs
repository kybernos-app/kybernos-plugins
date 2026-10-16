#!/usr/bin/env node
/** The replies of the git routes and of the settings and categories routes (A2-21).
 *
 *  Every reply keeps its JSON shape (`ok`, `erreur`, `message`, `note`…) and carries a stable `code`; its sentences are
 *  ENGLISH (the base of every message, decision D1); what git or gh said itself rides apart in `detail`, untranslated. A
 *  client words the reply from the code in its own language (kybernos-changes does: its test reads GIT_TEXTS from here
 *  and fails when the two lists drift). Here the host side is driven with a fake git and a fake gh, in a temporary
 *  directory: no git, no network, nothing outside the directory.
 *
 *  Usage: node packages/kybernos-sessions/test-codes.mjs   (exit 0 = all pass) */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GIT_TEXTS, commiter, cloturer, ecrireCategorie, ecrireReglages, encoderSlugChemin, isoler, monterRoutes, prCreer, prFusionner,
  pousser, ramasser, rapatrier, sondeCloture, sondeIsolation, synchroniser
} from './index.js'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 300) : '')) }
}
const FRANCAIS = /[àâçéèêëîïôùûœ]|\b(le|la|les|des|du|pas|dans|avec|sans|pour|est|sont|rien|dossier|fichier|fichiers|arbre|refus[eé]|introuvable|attendu|aucun|aucune)\b/i

const racine = mkdtempSync(join(tmpdir(), 'ksess-codes-'))
const mk = (nom) => { const d = join(racine, nom); mkdirSync(d, { recursive: true }); return d }

// A fake git: answers by the command line, from a state. `cwd` overrides the state for one working directory, `fail` lists command
// prefixes that exit non-zero (with git-looking words), `ignored` the ignored entries `status --ignored` reports.
const fakeGit = (o = {}) => {
  const base = { git: true, branch: 'feature/x', base: 'main', dirty: [], ahead: 0, behind: 0, remote: 'git@github.com:o/r.git', worktree: false, nonMerged: 0, upstream: true, unpushed: 0, ignored: [], fail: [], listing: '', cwd: {}, toplevel: '/proj' }
  return async (args, cwd) => {
    const s = { ...base, ...o, ...((o.cwd || {})[cwd] || {}) }
    const k = args.join(' ')
    const bad = s.fail.find((f) => k.startsWith(f))
    if (bad !== undefined) return { ok: false, out: '', err: ' fatal: ' + bad + ' said no \n' }
    if (!s.git) return { ok: false, out: '', err: 'fatal: not a git repository' }
    const fin = (out) => ({ ok: true, out, err: '' })
    if (k === 'rev-parse --abbrev-ref HEAD') return fin(s.branch + '\n')
    if (k === 'status --porcelain') return fin(s.dirty.join('\n') + (s.dirty.length ? '\n' : ''))
    if (k === 'status --porcelain --ignored=matching') return fin(s.ignored.map((p) => '!! ' + p).concat(s.dirty).join('\n') + '\n')
    if (k === 'log --oneline @{upstream}..HEAD') return fin(Array.from({ length: s.ahead }, (_, i) => 'c' + i + ' msg').join('\n'))
    if (k === 'rev-parse --git-dir') return fin(s.worktree ? '/proj/.git/worktrees/x\n' : '.git\n')
    if (k === 'rev-list --count HEAD..@{upstream}') return fin(String(s.behind))
    if (k === 'remote get-url origin') return s.remote ? fin(s.remote + '\n') : { ok: false, out: '', err: 'error: No such remote' }
    if (k === 'symbolic-ref refs/remotes/origin/HEAD --short') return fin('origin/' + s.base + '\n')
    if (k === 'symbolic-ref --quiet refs/remotes/origin/HEAD') return fin('refs/remotes/origin/' + s.base + '\n')
    if (k === 'rev-list --count ' + s.base + '..HEAD') return fin(String(s.nonMerged))
    if (k.startsWith('rev-list --count ' + s.base + '..')) return fin('0')
    if (k === 'rev-parse --show-toplevel') return fin(s.toplevel + '\n')
    if (k.startsWith('rev-list --count @{upstream}..')) return s.upstream ? fin(String(s.unpushed)) : { ok: false, out: '', err: 'fatal: no upstream configured' }
    if (k === 'worktree list --porcelain') return fin(s.listing)
    if (k.startsWith('show-ref ') || k.startsWith('rev-parse --path-format')) return { ok: false, out: '', err: '' }
    return fin('')
  }
}
const ghOk = (out) => async () => ({ ok: true, out, err: '' })
const ghFail = async () => ({ ok: false, out: '', err: ' gh: no auth \n' })
const SALE = [' M a.js']

// Every scenario answers once; the codes seen are collected to prove that the table has no dead entry and no code is missing.
const vus = new Set()
const textes = []
const S = async (nom, promesse, code, plus) => {
  const r = await promesse
  vus.add(r.code)
  for (const k of ['erreur', 'message', 'note', 'raison']) if (typeof r[k] === 'string') textes.push([nom, k, r[k]])
  for (const e of Array.isArray(r.erreurs) ? r.erreurs : []) textes.push([nom, 'erreurs', e])
  ok(nom + ' → ' + code, r.code === code && (typeof plus !== 'function' || plus(r) === true), r)
  return r
}

console.log('\n── every reply carries a code, an English sentence, and keeps its shape ──')
const dir = mk('proj')
const absent = join(racine, 'absent')
await S('a folder that is gone', pousser({ chemin: absent }), 'folder-not-found', (r) => r.ok === false && r.erreur === 'folder not found')
await S('not a repository', pousser({ chemin: dir, run: fakeGit({ git: false }) }), 'not-a-repo', (r) => r.ok === false && r.erreur === 'not a git repository')
await S('close-check outside git', sondeCloture({ chemin: dir, run: fakeGit({ git: false }) }), 'not-in-git', (r) => r.ok === true && r.cloturable === true && r.raison === GIT_TEXTS['not-in-git'])
await S('push with no remote', pousser({ chemin: dir, run: fakeGit({ remote: null }) }), 'no-remote')
await S('a pull request with no GitHub remote', prCreer({ chemin: dir, run: fakeGit({ remote: 'git@gitlab.com:o/r.git', nonMerged: 1, worktree: true }) }), 'no-github-remote')
await S('closing a folder that is not a copy', cloturer({ chemin: dir, run: fakeGit({}) }), 'not-a-copy')
await S('reclaiming from a copy', ramasser({ chemin: dir, run: fakeGit({ worktree: true }) }), 'is-a-copy')

console.log('\n── saving ──')
await S('nothing to save', commiter({ chemin: dir, run: fakeGit({ dirty: [] }) }), 'nothing-to-save', (r) => r.ok === false && r.erreur === 'nothing to save — the folder is clean')
await S('no file of this chat', commiter({ chemin: dir, run: fakeGit({ dirty: SALE }), chemins: [] }), 'no-chat-files')
const deja = await S('already saved', commiter({ chemin: dir, run: fakeGit({ dirty: [' M b.js'] }), chemins: ['a.js'] }), 'already-saved', (r) => r.ok === true && r.deja === true)
ok('…and it keeps its fields', Array.isArray(deja.chemins) && Array.isArray(deja.laisses))
const sec = await S('dry run keeps the commit message and the plan', commiter({ chemin: dir, run: fakeGit({ dirty: SALE }) }), undefined, (r) => r.ok === true && r.dry === true && /^delivery \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.message) && r.commandes.length === 3)
ok('a dry run has no code (nothing happened yet)', sec.code === undefined)
const local = await S('saved on this computer only', commiter({ chemin: dir, exec: true, pousser: false, message: 'Fix the menu', run: fakeGit({ dirty: SALE }) }), 'saved-local', (r) => r.ok === true && r.local === true && r.note === 'saved on this computer (nothing sent)')
ok('…`message` stays the commit message, the sentence is `note`', local.message === 'Fix the menu')
await S('saved on this computer, in a copy', commiter({ chemin: dir, exec: true, pousser: false, run: fakeGit({ dirty: SALE, worktree: true }) }), 'saved-merged-local')
await S('saved, the send failed', commiter({ chemin: dir, exec: true, run: fakeGit({ dirty: SALE, fail: ['push'] }) }), 'saved-push-failed', (r) => r.ok === true && r.pousse === false && r.erreurPush === 'fatal: push said no')
await S('saved and sent', commiter({ chemin: dir, exec: true, run: fakeGit({ dirty: SALE }) }), 'saved-sent', (r) => r.ok === true && r.pousse === true)
await S('saved, sent and merged from a copy', commiter({ chemin: dir, exec: true, run: fakeGit({ dirty: SALE, worktree: true }) }), 'saved-sent-merged')
await S('a clean copy with commits to bring back', commiter({ chemin: dir, exec: true, pousser: false, run: fakeGit({ worktree: true, nonMerged: 2 }) }), 'merged-local', (r) => r.ok === true && r.mergeSeul === true)
await S('git add refused', commiter({ chemin: dir, exec: true, run: fakeGit({ dirty: SALE, fail: ['add'] }) }), 'git-refused', (r) => r.ok === false && r.detail === 'fatal: add said no' && r.erreur === 'git add refused: fatal: add said no')
await S('merge refused while saving', commiter({ chemin: dir, exec: true, run: fakeGit({ dirty: SALE, worktree: true, fail: ['merge'] }) }), 'merge-refused')

console.log('\n── GitHub ──')
await S('nothing to send', pousser({ chemin: dir, run: fakeGit({ ahead: 0 }) }), 'nothing-to-send')
const dry = await pousser({ chemin: dir, run: fakeGit({ ahead: 2 }) })
ok('a dry run lists its commands and has no code', dry.ok === true && dry.dry === true && dry.commandes[0] === 'git push' && dry.code === undefined)
await S('sent', pousser({ chemin: dir, exec: true, run: fakeGit({ ahead: 2 }) }), 'sent', (r) => r.ok === true && r.message === 'sent to GitHub')
const refus = await S('push refused: git’s words ride in `detail`', pousser({ chemin: dir, exec: true, run: fakeGit({ ahead: 2, fail: ['push'] }) }), 'push-refused', (r) => r.ok === false && r.detail === 'fatal: push said no' && r.erreur === 'push refused: fatal: push said no')
ok('…and the sentence is not the words', refus.erreur !== refus.detail)
await S('fetched', rapatrier({ chemin: dir, exec: true, run: fakeGit({}) }), 'fetched')
await S('fetch refused', rapatrier({ chemin: dir, exec: true, run: fakeGit({ fail: ['fetch'] }) }), 'fetch-refused', (r) => r.detail === 'fatal: fetch said no')
await S('synced', synchroniser({ chemin: dir, exec: true, run: fakeGit({}) }), 'synced')
await S('sync: the fetch is refused', synchroniser({ chemin: dir, exec: true, run: fakeGit({ fail: ['fetch'] }) }), 'fetch-refused')
await S('sync: the push is refused', synchroniser({ chemin: dir, exec: true, run: fakeGit({ fail: ['push'] }) }), 'push-refused')
await S('a request from the base branch', prCreer({ chemin: dir, run: fakeGit({ branch: 'main', base: 'main' }) }), 'current-is-base')
await S('a request with nothing to review', prCreer({ chemin: dir, run: fakeGit({ nonMerged: 0 }) }), 'nothing-to-review', (r) => r.base === 'main' && r.erreur === 'nothing to review — no commit beyond main')
const pr = await S('a request opened', prCreer({ chemin: dir, exec: true, run: fakeGit({ worktree: true, nonMerged: 1 }), gh: ghOk('Creating pull request\nhttps://github.com/o/r/pull/7\n') }), 'pr-opened', (r) => r.ok === true && r.message === 'https://github.com/o/r/pull/7' && r.url === r.message)
ok('…gh’s address is the message (as before) and the `url`', pr.url === 'https://github.com/o/r/pull/7')
await S('a request opened, gh prints nothing', prCreer({ chemin: dir, exec: true, run: fakeGit({ worktree: true, nonMerged: 1 }), gh: ghOk('') }), 'pr-opened', (r) => r.message === 'pull request opened' && r.url === undefined)
await S('a request: the push is refused', prCreer({ chemin: dir, exec: true, run: fakeGit({ worktree: true, nonMerged: 1, fail: ['push'] }), gh: ghOk('') }), 'push-refused')
await S('a request: gh refuses', prCreer({ chemin: dir, exec: true, run: fakeGit({ worktree: true, nonMerged: 1 }), gh: ghFail }), 'gh-pr-create-refused', (r) => r.detail === 'gh: no auth')
await S('a request merged', prFusionner({ chemin: dir, exec: true, gh: ghOk('') }), 'pr-merged')
await S('a merge: gh refuses', prFusionner({ chemin: dir, exec: true, gh: ghFail }), 'gh-pr-merge-refused')

console.log('\n── the separate copy ──')
await S('already isolated', isoler({ chemin: dir, run: fakeGit({ worktree: true }) }), 'already-isolated', (r) => r.ok === true && r.dejaIsole === true && typeof r.cible === 'string')
const P1 = mk('p-create')
await S('a copy created', isoler({ chemin: P1, nom: 'sA', exec: true, run: fakeGit({}) }), 'copy-created', (r) => r.ok === true && r.branche === 'feature/sA' && r.cible === join(P1, '.worktrees', 'sA'))
await S('a copy refused by git', isoler({ chemin: mk('p-refused'), nom: 'sR', exec: true, run: fakeGit({ fail: ['worktree add'] }) }), 'git-refused', (r) => r.erreur === 'git worktree add refused: fatal: worktree add said no')
const dirty = await S('creating a copy from a dirty trunk (2 files)', isoler({ chemin: mk('p-dirty'), nom: 'sD', run: fakeGit({ dirty: [' M a.js', ' M b.js'] }) }), 'tree-dirty', (r) => r.ok === false && r.count === 2 && r.erreur === 'unsaved changes (2 files) — save them first')
ok('…and for one file', (await sondeIsolation({ chemin: mk('p-dirty1'), nom: 'sE', run: fakeGit({ dirty: SALE }) })).erreur === 'unsaved changes (1 file) — save them first')
const P2 = mk('p-reuse')
mkdirSync(join(P2, '.worktrees', 'sB'), { recursive: true })
const copie = (over) => fakeGit({ cwd: { [join(P2, '.worktrees', 'sB')]: { worktree: true, branch: 'feature/sB', ...over } } })
await S('a free copy is reused', isoler({ chemin: P2, nom: 'sB', exec: true, run: copie({}) }), 'copy-reused', (r) => r.ok === true && r.reutilise === true)
await S('a copy with work of its own', isoler({ chemin: P2, nom: 'sB', exec: true, run: copie({ dirty: SALE }) }), 'copy-has-work')
const sessionsHome = mk('sessions')
const tenue = join(P2, '.worktrees', 'sB')
mkdirSync(join(sessionsHome, encoderSlugChemin(tenue), 'session-abc'), { recursive: true })
writeFileSync(join(sessionsHome, encoderSlugChemin(tenue), 'session-abc', 'session.v3.jsonl.zstd'), 'x')
await S('a copy held by an open session', isoler({ chemin: P2, nom: 'sB', exec: true, run: copie({}), sessionsHome }), 'copy-held')

console.log('\n── closing ──')
const copieProp = { worktree: true }
await S('close-check: a clean copy', sondeCloture({ chemin: dir, run: fakeGit(copieProp) }), 'clean-copy', (r) => r.cloturable === true && r.erreurs.length === 0 && r.raison === GIT_TEXTS['clean-copy'])
await S('close-check: the main folder', sondeCloture({ chemin: dir, run: fakeGit({}) }), 'main-folder', (r) => r.cloturable === true && r.raison === GIT_TEXTS['main-folder'])
await S('close-check: a folder that is gone', sondeCloture({ chemin: absent }), 'folder-not-found', (r) => r.ok === false && r.cloturable === false && r.erreurs[0] === 'folder not found')
const cc = await S('close-check: every problem, the first one is the code', sondeCloture({ chemin: dir, run: fakeGit({ ...copieProp, dirty: [' M a.js', ' M b.js', ' M c.js'], ignored: ['.env'], unpushed: 1 }) }), 'tree-dirty', (r) => r.cloturable === false && r.erreurs.length === 3 && r.raison === r.erreurs[0])
ok('…each in plain English, with its plural', cc.erreurs[0] === 'unsaved changes (3 files) — save them first' && cc.erreurs[1] === 'closing would destroy 1 ignored entry that cannot be regenerated (.env)' && cc.erreurs[2] === 'send first — 1 commit not sent to GitHub yet', cc.erreurs)
await S('closing with unsaved changes', cloturer({ chemin: dir, run: fakeGit({ ...copieProp, dirty: SALE }) }), 'tree-dirty', (r) => r.count === 1 && r.erreur === 'unsaved changes (1 file) — save them first')
await S('closing with ignored work', cloturer({ chemin: dir, run: fakeGit({ ...copieProp, ignored: ['.env', 'notes.db'] }) }), 'ignored-entries', (r) => r.count === 2 && r.erreur === 'closing would destroy 2 ignored entries that cannot be regenerated (.env, notes.db)' && r.entries === '.env, notes.db')
await S('closing a branch never sent', cloturer({ chemin: dir, run: fakeGit({ ...copieProp, upstream: false }) }), 'no-upstream')
await S('closing with commits not sent', cloturer({ chemin: dir, run: fakeGit({ ...copieProp, unpushed: 3 }) }), 'unpushed-commits', (r) => r.count === 3 && r.erreur === 'send first — 3 commits not sent to GitHub yet')
await S('closing, the merge is refused', cloturer({ chemin: dir, exec: true, run: fakeGit({ ...copieProp, fail: ['merge'] }) }), 'merge-refused')
await S('closing, the copy cannot be removed', cloturer({ chemin: dir, exec: true, run: fakeGit({ ...copieProp, fail: ['worktree remove'] }) }), 'copy-not-removed', (r) => r.detail === 'fatal: worktree remove said no')
await S('closed', cloturer({ chemin: dir, exec: true, run: fakeGit(copieProp) }), 'merged-removed', (r) => r.ok === true && r.message === 'merged and the separate copy removed')

console.log('\n── reclaiming ──')
const P3 = mk('p-reclaim')
const arbres = ['sD', 'sF', 'sG'].map((n) => { const d = join(P3, '.worktrees', n); mkdirSync(d, { recursive: true }); return d })
const listing = ['worktree ' + P3 + '\nHEAD a\nbranch refs/heads/main'].concat(arbres.map((d, i) => 'worktree ' + d + '\nHEAD b\nbranch refs/heads/feature/' + d.split('/').pop())).join('\n\n') + '\n'
const ramasse = await S('one copy without work is reclaimed', ramasser({ chemin: P3, exec: true, run: fakeGit({ listing: listing.split('\n\n').slice(0, 2).join('\n\n') + '\n' }) }), 'reclaimed', (r) => r.ok === true && r.count === 1 && r.message === '1 copy without work removed' && r.retires.length === 1)
ok('…the fields it always had are still there', Array.isArray(ramasse.retires) && Array.isArray(ramasse.gardes) && ramasse.prune === true && ramasse.base === 'main' && Array.isArray(ramasse.branchesRetirees))
await S('three copies without work', ramasser({ chemin: P3, exec: true, run: fakeGit({ listing }) }), 'reclaimed', (r) => r.message === '3 copies without work removed')
const garde = await ramasser({ chemin: P3, run: fakeGit({ listing, cwd: { [arbres[0]]: { dirty: SALE }, [arbres[1]]: { nonMerged: 1 }, [arbres[2]]: { nonMerged: 4 } } }) })
ok('the copies kept say why in English, with the plural', garde.gardes.map((g) => g.raison).join(' | ') === 'dirty tree | 1 commit beyond main | 4 commits beyond main', garde.gardes)
for (const g of garde.gardes) textes.push(['reclaim guard', 'raison', g.raison])

console.log('\n── the table and the sentences ──')
const codes = Object.keys(GIT_TEXTS)
ok('every code in the table was produced by a reply above (no dead entry)', codes.every((c) => vus.has(c)), codes.filter((c) => !vus.has(c)))
ok('every code a reply carried is in the table (none is made up on the spot)', [...vus].every((c) => c === undefined || codes.includes(c)), [...vus].filter((c) => c !== undefined && !codes.includes(c)))
ok('the codes are stable kebab-case words', codes.every((c) => /^[a-z]+(?:-[a-z]+)*$/.test(c)), codes)
ok('the table is English: no accent, no French word', codes.every((c) => !FRANCAIS.test(GIT_TEXTS[c])), codes.filter((c) => FRANCAIS.test(GIT_TEXTS[c])))
ok('every sentence a reply carried is English', textes.every(([, , t]) => !FRANCAIS.test(t)), textes.filter(([, , t]) => FRANCAIS.test(t)))
ok('and none has a placeholder left over', textes.every(([, , t]) => !/\{\w+\}/.test(t)), textes.filter(([, , t]) => /\{\w+\}/.test(t)))
ok('a placeholder of the table is something the reply can fill', codes.every((c) => (GIT_TEXTS[c].match(/\{(\w+)\}/g) || []).every((m) => ['base', 'detail', 'step', 'files', 'things', 'entries', 'commits', 'copies'].includes(m.slice(1, -1)))), codes)

console.log('\n── settings and categories ──')
{
  const f = join(mk('reglages'), 'settings.json')
  const r1 = ecrireReglages(f, { brain: 42 })
  ok('a refused Study model: 400-class, a code, an English sentence that starts with the field', r1.ok === false && r1.invalide === true && r1.code === 'invalid-brain' && r1.erreur.startsWith('brain:') && !FRANCAIS.test(r1.erreur), r1)
  const r2 = ecrireReglages(f, { voiceInput: 'x' })
  const r3 = ecrireReglages(f, { autoWhitelist: ['a/b', 'a/b'] })
  ok('…the microphone source and the Auto list too', r2.code === 'invalid-voice-input' && r3.code === 'invalid-auto-whitelist' && !FRANCAIS.test(r2.erreur + r3.erreur), [r2, r3])
  writeFileSync(f, '{ not json')
  const r4 = ecrireReglages(f, { brain: 'a/b' })
  ok('a corrupt file: a code (the 500 class), nothing written', r4.ok === false && r4.invalide === undefined && r4.code === 'settings-corrupt' && /nothing was saved/.test(r4.erreur), r4)
  const dossierReglages = join(mk('reglages-dir'), 'settings.json')
  mkdirSync(dossierReglages)
  const r5 = ecrireReglages(dossierReglages, { brain: 'a/b' })
  ok('an unreadable file: its own code', r5.ok === false && r5.code === 'settings-unreadable', r5)
  const g = join(mk('categories'), 'categories.json')
  const c1 = ecrireCategorie(g, '', 'doc', 't', false)
  const c2 = ecrireCategorie(g, 's1', 'nope', 't', false)
  ok('categories: an empty session and an unknown category have a code and an English sentence', c1.code === 'empty-session' && c1.erreur === 'empty session' && c2.code === 'unknown-category' && /^unknown category: nope \(expected: /.test(c2.erreur) && !FRANCAIS.test(c1.erreur + c2.erreur), [c1, c2])
  ok('a good write keeps its shape', ecrireCategorie(g, 's1', 'doc', 't', false).ok === true)
}

console.log('\n── through the routes: the code travels, the plain-text bodies are English ──')
{
  const PORT = 3080
  const routes = {}
  const base = mk('routes')
  monterRoutes({ register: (r) => { routes[r.path] = r.handler } }, { reglagesPath: join(base, 'settings.json'), categoriesPath: join(base, 'categories.json'), sessionsHome: join(base, 'sessions'), kybersHome: join(base, 'kybers') })
  const requete = (method, path, headers, corps) => ({ method, url: path, headers: headers || {}, socket: { localPort: PORT }, on (ev, cb) { if (ev === 'data' && corps !== undefined) cb(JSON.stringify(corps)); if (ev === 'end') cb() } })
  const reponse = () => { const r = { code: null, corps: null, writeHead (c) { r.code = c }, end (s) { try { r.corps = JSON.parse(s) } catch (e) { r.corps = s } } }; return r }
  const bon = { origin: 'http://127.0.0.1:' + PORT }
  const a = reponse()
  await routes['/kybernos-sessions/settings'](requete('POST', '/kybernos-sessions/settings', bon, { brain: 7 }), a)
  ok('POST /settings with a bad Study model answers 400 with its code', a.code === 400 && a.corps.ok === false && a.corps.code === 'invalid-brain' && a.corps.erreur.startsWith('brain:'), a)
  const b = reponse()
  await routes['/kybernos-sessions/categories'](requete('POST', '/kybernos-sessions/categories', bon, { session: 's', cat: 'nope' }), b)
  ok('POST /categories with an unknown category answers 400 with its code', b.code === 400 && b.corps.code === 'unknown-category', b)
  const c = reponse()
  await routes['/kybernos-sessions/push'](requete('GET', '/kybernos-sessions/push', bon), c)
  const d = reponse()
  await routes['/kybernos-sessions/push'](requete('POST', '/kybernos-sessions/push', {}), d)
  const e = reponse()
  await routes['/kybernos-sessions/state'](requete('POST', '/kybernos-sessions/state', bon), e)
  ok('a wrong method and a foreign origin are answered in plain English', c.code === 405 && c.corps === 'POST only' && d.code === 403 && d.corps === 'origin refused' && e.code === 405 && e.corps === 'GET only', [c.corps, d.corps, e.corps])
  const f = reponse()
  await routes['/kybernos-sessions/push'](requete('POST', '/kybernos-sessions/push', bon, { chemin: absent }), f)
  ok('a git route answers 200 with the folder refusal and its code (the chemin is not one of the sessions’)', f.code === 200 && f.corps.ok === false && f.corps.code === 'folder-not-found' && f.corps.erreur === 'folder not found', f)
}

rmSync(racine, { recursive: true, force: true })
console.log('\nSESSIONS CODES — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)
