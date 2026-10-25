// `/commit` takes only the files THIS chat wrote (`chemins`), and promises to leave the work of the other chats alone (« laisses »). Recette 2026-10-25, L3-18: a path that begins with `:` is
// pathspec magic to git, so `chemins: ['mine.txt', ':/']` made `git add` take the whole repository: the commit then held `other-chat-wip.txt` while the dry run announced it was left out.
//
// The real `commiter` runs real git on a throw-away repository (no fake `run`): the entries are literal file names, and an entry that is not a file refuses the add as a whole.
//
//   node packages/kybernos-sessions/test-commit-pathspec.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { commiter } from './index.js'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

const base = realpathSync(mkdtempSync(join(tmpdir(), 'ksgpath')))
const env = { ...process.env, HOME: base, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Guard Test', GIT_AUTHOR_EMAIL: 'guard@example.invalid', GIT_COMMITTER_NAME: 'Guard Test', GIT_COMMITTER_EMAIL: 'guard@example.invalid' }
Object.assign(process.env, env)
const git = (...args) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' })
const repo = join(base, 'proj')
mkdirSync(repo)
const fresh = () => {
  rmSync(repo, { recursive: true, force: true })
  mkdirSync(repo)
  git('init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'README.md'), 'start\n')
  git('add', '-A')
  git('commit', '-q', '-m', 'start')
  writeFileSync(join(repo, 'mine.txt'), 'written by this chat\n')
  writeFileSync(join(repo, 'other-chat-wip.txt'), 'the work of another chat\n')
}
const committed = () => git('ls-tree', '-r', '--name-only', 'HEAD').split('\n').filter((l) => l !== '')

try {
  fresh()
  const ok = await commiter({ chemin: repo, message: 'only mine', exec: true, chemins: ['mine.txt'], pousser: false })
  check('an ordinary commit takes the chat\'s file and leaves the other chat\'s alone', ok.ok === true && committed().includes('mine.txt') && !committed().includes('other-chat-wip.txt'), JSON.stringify(ok).slice(0, 160))

  for (const magic of [':/', ':(top)other-chat-wip.txt', ':!mine.txt', ':/*']) {
    fresh()
    const before = git('rev-parse', 'HEAD').trim()
    const dry = await commiter({ chemin: repo, message: 'x', exec: false, chemins: ['mine.txt', magic], pousser: false })
    const done = await commiter({ chemin: repo, message: 'x', exec: true, chemins: ['mine.txt', magic], pousser: false })
    check('chemins [mine.txt, ' + magic + ']: the other chat\'s file is not committed (' + (done.ok === true ? 'committed' : 'refused: ' + done.code) + ')', !committed().includes('other-chat-wip.txt'), JSON.stringify(committed()))
    check('...and the dry run is not a promise the commit breaks: if it said the file is left out, it is', dry.ok !== true || !Array.isArray(dry.laisses) || !dry.laisses.includes('other-chat-wip.txt') || !committed().includes('other-chat-wip.txt'))
    check('...and the refused add left the repository where it was', done.ok === true || git('rev-parse', 'HEAD').trim() === before)
  }
} finally {
  rmSync(base, { recursive: true, force: true })
}

console.log(failed === 0 ? '\nall green' : '\n' + failed + ' failure(s)')
process.exit(failed === 0 ? 0 : 1)
