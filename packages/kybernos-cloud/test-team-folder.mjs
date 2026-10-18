// One working folder per team: the name and the creation of <Documents>/Kybernos/<Team> (plan « Équipes », step 6, host half).
//   node packages/kybernos-cloud/test-team-folder.mjs
//
// The team's name is written by other people (a team lead, an invited colleague), so it is a hostile input: whatever it holds, the folder is ONE segment, a direct child of the root
// the host computes. The disk is a fake (a set of folders), so what is proven is the shipped code: the sanitizer on hostile names, the order of the candidate names, a collision
// (another team's folder, a folder of the person's, a file system that ignores case), the folder recorded earlier (kept, made again when removed, ignored when it is not a child of
// the root), a refused disk (never a throw), and the rule of the host routes that call it (test-team-folder-host.mjs).
import { join, sep } from 'node:path'
import { FOLDER_NAME_MAX, documentsDir, ensureTeamFolder, folderCandidates, isChildOf, rootOf, shortId, teamFolderName } from './team-folder.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

const ID = '3b9f2c1a-5d7e-4b8a-9c0d-1e2f3a4b5c6d'
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)
const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)

console.log('The name of the folder, from a hostile team name')
const clean = (s) => teamFolderName(s, ID)
check('a plain name is kept as it is', clean('Acme') === 'Acme' && clean('Studio B') === 'Studio B' && clean('Nova Labs 2026') === 'Nova Labs 2026')
check('accents and other scripts are kept (NFC)', clean('Équipe Été') === 'Équipe Été' && clean('فريق') === 'فريق' && clean('e' + String.fromCharCode(0x301)) === String.fromCharCode(0xe9))
const HOSTILE = [
  '../../etc/passwd', '..', '.', '...', '../', '/', '\\', '..\\..\\Windows', 'C:\\Windows\\System32', 'Acme/../Beta', '/etc/passwd', '~/.ssh', '.hidden', 'name.', 'a\u0000b', 'a\nb', 'a\tb',
  'x' + RLO + 'txt.exe', 'a' + ZWSP + 'b', 'a' + LS + 'b' + PS + 'c', '<script>', 'a|b', 'a*b', 'a?b', '"quoted"', 'CON', 'con.txt', 'NUL', 'com1', 'LPT9.log', '   ', '', ' . . ', '%2e%2e%2f', '$(rm -rf)',
]
const bad = HOSTILE.filter((name) => {
  const out = clean(name)
  return out === '' || out.includes('/') || out.includes('\\') || out.includes('..') || out.startsWith('.') || out.endsWith('.') || out !== out.trim() || /[\u0000-\u001f]/.test(out) || out.includes(LS) || out.includes(PS) || out.includes(RLO) || out.includes(ZWSP) || /[:*?"<>|]/.test(out) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(out)
})
check('hostile names never leave a separator, « .. », a leading or trailing dot, a control or invisible character, a Windows-reserved name or nothing (' + HOSTILE.length + ' names)', bad.length === 0, bad.map((b) => [b, clean(b)]))
check('a name that leaves nothing, or that Windows reserves, becomes « Team <id> »', ['..', '', '   ', 'CON', 'nul', 'com1', 'LPT9.log'].every((n) => clean(n) === 'Team 3b9f2c1a'))
check('a path in a name is read as words, never followed', clean('../../etc/passwd') === 'etc passwd' && clean('C:\\Windows\\System32') === 'C Windows System32' && clean('Acme/../Beta') === 'Acme . Beta')
check('anything that is not a string is the fallback, and never throws', [null, undefined, 42, {}, [], true].every((v) => clean(v) === 'Team 3b9f2c1a') && teamFolderName('..', undefined) === 'Team' && teamFolderName('..', null) === 'Team')
const long = clean('a'.repeat(500))
check('a long name is cut to ' + FOLDER_NAME_MAX + ' characters', long.length === FOLDER_NAME_MAX)
const emoji = String.fromCodePoint(0x1f680)
const cut = clean(emoji.repeat(100))
check('a cut never splits a character in two (surrogate pairs)', Array.from(cut).length === FOLDER_NAME_MAX && Array.from(cut).every((c) => c === emoji) && cut.length === FOLDER_NAME_MAX * 2)
check('a cut that lands on a space or a dot leaves no trailing one', !/[.\s]$/.test(clean('a'.repeat(59) + '. b')) && !/[.\s]$/.test(clean('a'.repeat(59) + ' b')))
check('shortId is the first eight letters and digits of the id, lower case', shortId(ID) === '3b9f2c1a' && shortId('AB-cd') === 'abcd' && shortId('') === '' && shortId(null) === '' && shortId(42) === '')

console.log('The names to try')
check('the plain name, then the one that carries the id', JSON.stringify(folderCandidates('Acme', ID)) === JSON.stringify(['Acme', 'Acme (3b9f2c1a)']))
check('a name that already carries the id (the fallback) is tried once', JSON.stringify(folderCandidates('..', ID)) === JSON.stringify(['Team 3b9f2c1a']))
check('with no usable id, only the plain name', JSON.stringify(folderCandidates('Acme', '')) === JSON.stringify(['Acme']) && JSON.stringify(folderCandidates('Acme', undefined)) === JSON.stringify(['Acme']))

console.log('Where Documents is')
const dd = (over) => documentsDir({ platform: 'darwin', home: '/h', env: {}, ...over })
check('~/Documents by default, and the root is Documents/Kybernos', dd({}) === join('/h', 'Documents') && rootOf(dd({})) === join('/h', 'Documents', 'Kybernos'))
check('KYBERNOS_DOCUMENTS_DIR when it is absolute, never when it is relative', dd({ env: { KYBERNOS_DOCUMENTS_DIR: '/data/docs' } }) === '/data/docs' && dd({ env: { KYBERNOS_DOCUMENTS_DIR: 'docs' } }) === join('/h', 'Documents'))
check('on Linux the XDG folder, unless it answers the home folder or fails', dd({ platform: 'linux', xdgDocuments: () => '/h/Docs' }) === '/h/Docs' && dd({ platform: 'linux', xdgDocuments: () => '/h/' }) === join('/h', 'Documents') && dd({ platform: 'linux', xdgDocuments: () => { throw new Error('no xdg') } }) === join('/h', 'Documents'))

console.log('Making the folder')
const DOCS = '/home/u/Documents'
const ROOT = rootOf(DOCS)
/** A fake disk: a set of folders; `mkdir` without `recursive` says EEXIST for a folder that is there (and, with `ignoreCase`, for one that differs by case only). */
const disk = (opts = {}) => {
  const dirs = new Set(opts.dirs || [])
  const files = new Set(opts.files || [])
  const key = (p) => (opts.ignoreCase === true ? p.toLowerCase() : p)
  const has = (set, p) => Array.from(set).some((q) => key(q) === key(p))
  const made = []
  const err = (code) => Object.assign(new Error(code), { code })
  return {
    dirs, made,
    io: {
      mkdir: (p, o) => {
        if (typeof opts.fail === 'string') throw err(opts.fail)
        if (o !== undefined && o.recursive === true) { dirs.add(p); return }
        if (has(dirs, p) || has(files, p)) throw err('EEXIST')
        dirs.add(p); made.push(p)
      },
      isDir: (p) => has(dirs, p),
    },
  }
}
const ensure = (d, over = {}) => ensureTeamFolder({ id: ID, name: 'Acme', recorded: undefined, documents: DOCS, io: d.io, ...over })

let d = disk()
let r = ensure(d)
check('a new team: <Documents>/Kybernos/<Team> is made, the root with it', r.ok === true && r.created === true && r.path === join(ROOT, 'Acme') && d.dirs.has(ROOT) && d.dirs.has(join(ROOT, 'Acme')), r)
d = disk({ dirs: [ROOT, join(ROOT, 'Acme')] })
r = ensure(d)
check('a folder of that name already there (another team\'s, or the person\'s own) is NOT taken over: the team gets the one that carries its id', r.ok === true && r.created === true && r.path === join(ROOT, 'Acme (3b9f2c1a)') && d.made.length === 1, r)
d = disk({ dirs: [ROOT, join(ROOT, 'Acme'), join(ROOT, 'Acme (3b9f2c1a)')] })
r = ensure(d)
check('the one that carries the id, when it is already there, is this team\'s by its id: reused, nothing made', r.ok === true && r.created === false && r.path === join(ROOT, 'Acme (3b9f2c1a)') && d.made.length === 0, r)
d = disk({ dirs: [ROOT], files: [join(ROOT, 'Acme')] })
r = ensure(d)
check('a FILE of that name is no folder: the id\'s name is used', r.ok === true && r.path === join(ROOT, 'Acme (3b9f2c1a)'), r)
d = disk({ dirs: [ROOT, join(ROOT, 'Acme')], files: [join(ROOT, 'Acme (3b9f2c1a)')] })
r = ensure(d)
check('both names taken by files and folders that are not this team\'s: no folder, said, never a throw', r.ok === false && r.error === 'exists', r)
d = disk({ ignoreCase: true, dirs: [ROOT, join(ROOT, 'acme')] })
r = ensure(d)
check('a file system that ignores case (macOS) sees « acme » as « Acme »: the id\'s name is used', r.ok === true && r.path === join(ROOT, 'Acme (3b9f2c1a)'), r)
const a = disk()
const first = ensure(a, { id: 'aaaaaaaa-1111', name: 'Acme' })
const second = ensure(a, { id: 'bbbbbbbb-2222', name: 'Acme' })
check('two teams called « Acme » get two folders', first.path === join(ROOT, 'Acme') && second.path === join(ROOT, 'Acme (bbbbbbbb)') && first.path !== second.path, [first, second])
const same = disk()
const hostile = HOSTILE.map((name, i) => ensure(same, { id: 'id' + String(i).padStart(6, '0') + '-x', name }))
check('every hostile name yields a folder that is a direct child of the root (' + hostile.length + ' teams, all different)', hostile.every((h) => h.ok === true && isChildOf(ROOT, h.path) && h.path.startsWith(ROOT + sep)) && new Set(hostile.map((h) => h.path)).size === hostile.length, hostile.filter((h) => !(h.ok === true && isChildOf(ROOT, h.path))))
check('nothing outside the root was made: every folder made is the root or a child of it', Array.from(same.dirs).every((p) => p === ROOT || isChildOf(ROOT, p)) && !Array.from(same.dirs).some((p) => p.includes('etc') && !p.startsWith(ROOT)), Array.from(same.dirs).slice(0, 5))

console.log('The folder recorded earlier')
d = disk({ dirs: [ROOT, join(ROOT, 'Acme')] })
r = ensure(d, { recorded: join(ROOT, 'Acme') })
check('a recorded folder that is still there is kept, whatever the team is called now', r.ok === true && r.created === false && r.path === join(ROOT, 'Acme') && d.made.length === 0 && ensure(d, { recorded: join(ROOT, 'Acme'), name: 'Renamed' }).path === join(ROOT, 'Acme'), r)
d = disk({ dirs: [ROOT] })
r = ensure(d, { recorded: join(ROOT, 'Acme') })
check('a recorded folder the person removed is made again at the same place', r.ok === true && r.created === true && r.path === join(ROOT, 'Acme') && d.dirs.has(join(ROOT, 'Acme')), r)
for (const forged of ['/etc', '/etc/passwd', join(ROOT, '..', 'x'), join(ROOT, 'a', 'b'), ROOT, 'relative/path', '', null, 42, join(DOCS, 'Other')]) {
  d = disk({ dirs: [ROOT] })
  r = ensure(d, { recorded: forged })
  check('a recorded path that is not a direct child of the root is ignored (' + JSON.stringify(forged) + '): a new folder under the root', r.ok === true && r.path === join(ROOT, 'Acme') && (forged === ROOT || !d.dirs.has(String(forged))), r)
}
d = disk({ dirs: [ROOT], files: [join(ROOT, 'Acme')] })
r = ensure(d, { recorded: join(ROOT, 'Acme') })
check('a recorded name that a file holds now: the team gets a folder of its own', r.ok === true && r.path === join(ROOT, 'Acme (3b9f2c1a)'), r)

console.log('A refused disk')
for (const code of ['EACCES', 'EPERM', 'EROFS']) {
  d = disk({ fail: code })
  r = ensure(d)
  check(code + ': { ok: false, error: not_allowed }, nothing thrown', r.ok === false && r.error === 'not_allowed', r)
}
d = disk({ fail: 'EIO' })
r = ensure(d)
check('any other failure is mkdir_failed', r.ok === false && r.error === 'mkdir_failed', r)
r = ensureTeamFolder({ id: ID, name: 'Acme', documents: DOCS, io: { mkdir: () => { throw 'a string, not an error' }, isDir: () => { throw new Error('boom') } } })
check('a disk that throws strings or objects is still an answer', r.ok === false && r.error === 'mkdir_failed', r)

console.log('\n' + (failed === 0 ? 'ALL GOOD' : failed + ' failed'))
process.exit(failed === 0 ? 0 : 1)
