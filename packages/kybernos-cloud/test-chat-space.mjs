// The active team follows the chat: which space owns a folder, and which replies are in flight (teams plan, option 2).
//   node packages/kybernos-cloud/test-chat-space.mjs
//
// chat-space.mjs is pure (the disk and the clock are injected). What is proven: a chat in a team's folder, or anywhere below it, belongs to the team; a sibling with the same prefix
// (`Acme-2`), the folder's parent and the root of all the team folders do not; a folder reached through a symbolic link (the chat's, or the team's) is the folder it points to; a
// folder that is gone is still placed by its deepest existing ancestor; macOS and Windows ignore case and Linux does not; a path that is no absolute path names no space; the
// longest team folder wins; the in-flight counter is fed by events and corrected by the engine's registry (a missed end, a missed start), stops blocking after its age bound and
// forgets everything on a restart; the sightings of the chats the person looks at expire.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TURN_MAX_AGE_MS, canonicalPath, createSightings, createTurnWatch, isInside, spaceOfFolder } from './chat-space.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail)))
  if (!ok) failed += 1
}

// ── the resolver, on a fake disk (every path "exists" unless listed in `gone`) ────────────────────────────────────────────────────────────────────
const ROOT = '/home/u/Documents/Kybernos'
const TEAMS = [{ id: 'acme', folder: ROOT + '/Acme' }, { id: 'studio', folder: ROOT + '/Studio B' }]
const fake = (opts = {}) => {
  const links = opts.links || {}
  const gone = opts.gone || []
  return (p) => {
    if (gone.some((g) => p === g || p.startsWith(g + '/'))) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    // The first link that is a prefix of the path is followed (one level is enough for the cases below).
    for (const from of Object.keys(links)) if (p === from || p.startsWith(from + '/')) return links[from] + p.slice(from.length)
    return p
  }
}
const owner = (cwd, o = {}) => spaceOfFolder({ cwd, teams: o.teams || TEAMS, personalId: o.personalId === undefined ? 'me' : o.personalId, platform: o.platform || 'linux', realpath: o.realpath || fake() })

check('the team folder itself belongs to the team', JSON.stringify(owner(ROOT + '/Acme')) === JSON.stringify({ kind: 'team', id: 'acme' }), owner(ROOT + '/Acme'))
check('a name with a space and another team', owner(ROOT + '/Studio B').id === 'studio')
check('a subfolder belongs to the team', owner(ROOT + '/Acme/docs').id === 'acme')
check('a deep subfolder belongs to the team', owner(ROOT + '/Acme/a/b/c/d').id === 'acme')
check('a trailing slash changes nothing', owner(ROOT + '/Acme/').id === 'acme')
check('`..` is resolved before it is compared: out of the team', owner(ROOT + '/Acme/../Other').kind === 'personal')
check('`..` is resolved before it is compared: into the team', owner('/home/u/work/../Documents/Kybernos/Acme/x').id === 'acme')
for (const sibling of ['Acme-2', 'Acme2', 'AcmeCorp', 'Acme.old', 'Acme 2']) check('a sibling folder named ' + sibling + ' is not the team\'s', owner(ROOT + '/' + sibling).kind === 'personal', owner(ROOT + '/' + sibling))
check('a sibling with the same prefix, with a subfolder, is not the team\'s', owner(ROOT + '/Acme-2/docs').kind === 'personal')
check('the parent of a team folder is Personal', owner(ROOT).kind === 'personal')
check('the home folder is Personal', owner('/home/u').kind === 'personal')
check('another folder is Personal', JSON.stringify(owner('/home/u/work/app')) === JSON.stringify({ kind: 'personal', id: 'me' }))
check('Kaby\'s own folder is Personal', owner('/home/u/.dsh/kybernos/kyby').id === 'me')
check('no personal space known: Personal names none', JSON.stringify(owner('/home/u/work', { personalId: null })) === JSON.stringify({ kind: 'personal', id: null }))
check('no team at all: Personal', owner(ROOT + '/Acme', { teams: [] }).kind === 'personal')

// A path that is no absolute path names no space: nothing follows it.
for (const [label, cwd] of [['undefined', undefined], ['null', null], ['empty', ''], ['a number', 12], ['relative', 'work/app'], ['dot', '.'], ['a NUL', ROOT + '/Acme\0x']]) {
  check('a ' + label + ' cwd is unknown', owner(cwd).kind === 'unknown' && owner(cwd).id === null, owner(cwd))
}

// Records that cannot be trusted are skipped, never claim every chat.
check('a record that is the root of the disk claims nothing', owner('/home/u/work', { teams: [{ id: 'evil', folder: '/' }] }).kind === 'personal')
check('a record with no id is skipped', owner(ROOT + '/Acme', { teams: [{ folder: ROOT + '/Acme' }, null, 'x', { id: '', folder: ROOT + '/Acme' }] }).kind === 'personal')
check('a record with a relative folder is skipped', owner(ROOT + '/Acme', { teams: [{ id: 'acme', folder: 'Acme' }] }).kind === 'personal')
check('the longest team folder wins', owner(ROOT + '/Acme/Sub/x', { teams: [{ id: 'acme', folder: ROOT + '/Acme' }, { id: 'sub', folder: ROOT + '/Acme/Sub' }] }).id === 'sub')

// ── symbolic links, on a FAKE disk ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const linked = fake({ links: { '/home/u/shortcut': ROOT + '/Acme' } })
check('a chat reached through a link into the team folder belongs to the team', owner('/home/u/shortcut/docs', { realpath: linked }).id === 'acme')
const teamLink = fake({ links: { [ROOT + '/Acme']: '/mnt/disk/acme' } })
check('a team folder that is itself a link: the chat in its target belongs to the team', owner('/mnt/disk/acme/docs', { realpath: teamLink }).id === 'acme')
check('a team folder that is itself a link: the chat under the link too', owner(ROOT + '/Acme/docs', { realpath: teamLink }).id === 'acme')
check('a link OUT of a team folder is the place it points to: Personal', owner(ROOT + '/Acme/out/x', { realpath: fake({ links: { [ROOT + '/Acme/out']: '/home/u/work' } }) }).kind === 'personal')

// ── a folder that is gone ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
check('a chat folder that was deleted is placed by its deepest existing ancestor', owner(ROOT + '/Acme/deleted/x/y', { realpath: fake({ gone: [ROOT + '/Acme/deleted'] }) }).id === 'acme')
check('the team folder itself gone: the chat still belongs to it (lexically)', owner(ROOT + '/Acme/x', { realpath: fake({ gone: [ROOT + '/Acme'] }) }).id === 'acme')
check('a folder that is gone, outside every team: Personal', owner('/home/u/removed/x', { realpath: fake({ gone: ['/home/u/removed'] }) }).kind === 'personal')
check('a link above a missing folder is still followed', owner('/home/u/shortcut/not-yet/x', { realpath: (p) => { if (p.includes('not-yet')) throw new Error('ENOENT'); return fake({ links: { '/home/u/shortcut': ROOT + '/Acme' } })(p) } }).id === 'acme')
check('a disk that refuses everything falls back to the lexical path', owner(ROOT + '/Acme/x', { realpath: () => { throw new Error('EACCES') } }).id === 'acme')
check('a realpath that answers nothing useful falls back too', owner(ROOT + '/Acme/x', { realpath: () => '' }).id === 'acme')

// ── case ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
check('macOS: a path in another case is the same folder', owner('/home/u/documents/KYBERNOS/acme/Sub', { platform: 'darwin' }).id === 'acme')
check('Windows: a path in another case is the same folder', owner('/home/u/documents/kybernos/ACME', { platform: 'win32' }).id === 'acme')
check('Linux: case matters', owner('/home/u/documents/kybernos/ACME', { platform: 'linux' }).kind === 'personal')
check('macOS: a sibling that only differs by case-folded prefix is still a sibling', owner(ROOT.toLowerCase() + '/ACME-2', { platform: 'darwin' }).kind === 'personal')
check('canonicalPath folds on macOS only', canonicalPath('/A/B', { platform: 'darwin', realpath: (p) => p }) === '/a/b' && canonicalPath('/A/B', { platform: 'linux', realpath: (p) => p }) === '/A/B')

check('isInside is by whole segments', isInside('/a/b', '/a/b') && isInside('/a/b', '/a/b/c') && !isInside('/a/b', '/a/bc') && !isInside('/a/b', '/a') && !isInside('/a/b', '/x/b'))

// ── real symbolic links on the real disk (the temp folder is itself behind a link on macOS: /var → /private/var) ───────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'kybernos-chat-space-'))
  try {
    const root = join(dir, 'Documents', 'Kybernos')
    const acme = join(root, 'Acme')
    mkdirSync(join(acme, 'docs'), { recursive: true })
    mkdirSync(join(root, 'Acme-2'), { recursive: true })
    mkdirSync(join(dir, 'work'), { recursive: true })
    symlinkSync(acme, join(dir, 'shortcut'))
    symlinkSync(join(dir, 'work'), join(acme, 'out'))
    const real = (p) => realpathSync.native(p)
    const opts = { teams: [{ id: 'acme', folder: acme }], realpath: real, platform: process.platform }
    check('real disk: the team folder', owner(acme, opts).id === 'acme')
    check('real disk: a subfolder', owner(join(acme, 'docs'), opts).id === 'acme')
    check('real disk: a sibling with the same prefix', owner(join(root, 'Acme-2'), opts).kind === 'personal')
    check('real disk: a link to the team folder', owner(join(dir, 'shortcut'), opts).id === 'acme')
    check('real disk: a link out of the team folder leads to Personal', owner(join(acme, 'out'), opts).kind === 'personal')
    check('real disk: a folder that does not exist, under the team', owner(join(acme, 'gone', 'x'), opts).id === 'acme')
    check('real disk: a folder that does not exist, outside', owner(join(dir, 'gone', 'x'), opts).kind === 'personal')
    check('real disk: the team recorded through a link, the chat through the real path', owner(join(acme, 'docs'), { ...opts, teams: [{ id: 'acme', folder: join(dir, 'shortcut') }] }).id === 'acme')
    if (process.platform === 'darwin') check('real disk, macOS: the same folder written in another case', owner(join(dir, 'DOCUMENTS', 'kybernos', 'ACME', 'docs').replace(dir, realpathSync.native(dir)), opts).id === 'acme')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const clock = (start = 1000) => { const c = { t: start, now: () => c.t, tick: (ms) => { c.t += ms } }; return c }

// ── the in-flight counter ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const c = clock()
  const w = createTurnWatch({ now: c.now })
  check('nothing runs at first', w.running().length === 0)
  w.start('s1', 'acme')
  check('a started turn is running, with its team and its time', JSON.stringify(w.running()) === JSON.stringify([{ id: 's1', since: 1000, space: 'acme' }]), w.running())
  c.tick(500)
  w.start('s1', 'studio')
  check('a repeated start does not restart the clock or change the team', JSON.stringify(w.running()) === JSON.stringify([{ id: 's1', since: 1000, space: 'acme' }]), w.running())
  w.start('s2', null)
  check('two turns, oldest first', w.running().map((x) => x.id).join() === 's1,s2')
  check('the turn that waits on the switch itself is left out', w.running({ except: 's1' }).map((x) => x.id).join() === 's2')
  w.setSpace('s2', 'studio')
  w.setSpace('nobody', 'studio'); w.setSpace('s2', ''); w.setSpace('s2', 7)
  check('the team a reply is billed to can be corrected (its chat was switched at claim time)', w.running().find((x) => x.id === 's2').space === 'studio')
  w.end('s1')
  check('an end removes it', w.running().map((x) => x.id).join() === 's2')
  w.end('nobody')
  w.end(undefined)
  check('an end for a turn nobody started is harmless', w.running().length === 1)
  w.start('', 'x'); w.start(undefined, 'x'); w.start(7, 'x')
  check('a start with no usable id is ignored', w.running().length === 1)
}
{
  // The engine's registry is the truth: a MISSED end event cannot leave a turn stuck as running, a missed start is picked up.
  const c = clock()
  let alive = ['s1']
  const w = createTurnWatch({ now: c.now, live: () => alive })
  w.start('s1', 'acme')
  check('the registry agrees: running', w.running().length === 1)
  alive = []
  check('the engine says idle but the end event never came: not running', w.running().length === 0)
  alive = ['s9']
  const found = w.running()
  check('a turn whose start event was missed is found in the registry (team unknown)', found.length === 1 && found[0].id === 's9' && found[0].space === null, found)
  alive = null
  check('a registry that cannot answer leaves the events in charge', w.running().length === 1)
  const broken = createTurnWatch({ now: c.now, live: () => { throw new Error('registry gone') } })
  broken.start('s1', 'acme')
  check('a registry that throws is treated as absent, never thrown', broken.running().length === 1)
}
{
  // The bound: past it a turn stops blocking (fail open, on purpose).
  const c = clock()
  const noRegistry = createTurnWatch({ now: c.now })
  noRegistry.start('s1', 'acme')
  c.tick(TURN_MAX_AGE_MS - 1)
  check('just inside the bound: still blocks', noRegistry.running().length === 1)
  c.tick(2)
  check('past the bound: stops blocking', noRegistry.running().length === 0)
  check('without a registry, a turn past the bound is forgotten', noRegistry.running().length === 0)
  noRegistry.start('s1', 'acme')
  check('and a NEW turn of the same chat counts again', noRegistry.running().length === 1)

  const c2 = clock()
  const alive = ['s1']
  const withRegistry = createTurnWatch({ now: c2.now, live: () => alive })
  withRegistry.start('s1', 'acme')
  c2.tick(TURN_MAX_AGE_MS + 1)
  check('with a registry that still says running: past the bound it does not block', withRegistry.running().length === 0)
  c2.tick(60 * 1000)
  check('and it does not start blocking again at the next look (its age keeps counting from the first sighting)', withRegistry.running().length === 0)
  alive.length = 0
  withRegistry.running()
  alive.push('s1')
  check('once the registry says idle then running again it is a new turn: blocks', withRegistry.running().length === 1)
  const custom = createTurnWatch({ now: c.now, maxAgeMs: 10 })
  custom.start('a', null)
  c.tick(11)
  check('the bound is a parameter', custom.running().length === 0)
}
{
  // A restart: a new watch knows nothing, and the registry brings back what is really running.
  const c = clock()
  const first = createTurnWatch({ now: c.now })
  first.start('s1', 'acme')
  const second = createTurnWatch({ now: c.now })
  check('a restarted plugin has no stuck turn', second.running().length === 0)
  const third = createTurnWatch({ now: c.now, live: () => ['s1'] })
  check('a restarted plugin finds a turn that is really running', third.running().length === 1)
  const many = createTurnWatch({ now: c.now })
  for (let i = 0; i < 400; i += 1) many.start('s' + i, null)
  check('the table is bounded', many.running().length <= 256, many.running().length)
}

// ── the sightings ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
{
  const c = clock()
  const s = createSightings({ now: c.now, ttlMs: 1000, max: 3 })
  check('a chat never reported is not fresh', s.isFresh('a') === false)
  s.see('a')
  check('a chat just reported is fresh', s.isFresh('a') === true)
  c.tick(1000)
  check('still fresh at the limit', s.isFresh('a') === true)
  c.tick(1)
  check('stale past the ttl', s.isFresh('a') === false)
  s.see('a')
  check('a new report makes it fresh again', s.isFresh('a') === true)
  s.see(''); s.see(undefined); s.see(3)
  check('a report with no usable id is ignored', s.isFresh('') === false && s.isFresh(undefined) === false)
  s.see('b'); s.see('c'); s.see('d')
  check('the table is bounded: the oldest sighting goes first', s.isFresh('a') === false && s.isFresh('b') === true && s.isFresh('d') === true)
}

console.log(failed === 0 ? '\nall checks passed' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
