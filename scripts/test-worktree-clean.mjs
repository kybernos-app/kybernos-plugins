// scripts/worktree-clean.sh: the one promise is « no code lost ». Tried on real repositories (a bare origin, a clone, worktrees) in a temporary folder: what is in the base goes, what is not
// stays, nothing changes without --apply, and a verified bundle of every ref is made first. Usage: node scripts/test-worktree-clean.mjs   (0 = all green)
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'worktree-clean.sh')
const root = mkdtempSync(join(tmpdir(), 'wtclean-'))
const home = join(root, 'home')
mkdirSync(home)
const failures = []
let ok = 0
const check = (title, condition) => (condition ? (ok += 1) : failures.push(title))
const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()
const commit = (cwd, file, text) => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', file)
  git(cwd, 'commit', '-q', '-m', `change ${file}`)
}
const clone = join(root, 'clone')
const run = (...args) => execFileSync('bash', [SCRIPT, ...args], { cwd: clone, encoding: 'utf8', env: { ...process.env, HOME: home } })

try {
  const origin = join(root, 'origin.git')
  git(root, 'init', '-q', '--bare', '-b', 'dev', origin)
  git(root, 'clone', '-q', origin, clone)
  commit(clone, 'base.txt', 'base\n')
  git(clone, 'push', '-q', 'origin', 'dev')
  git(clone, 'remote', 'set-head', 'origin', 'dev')
  const wt = (name, branch) => git(clone, 'worktree', 'add', '-q', join(root, name), '-b', branch)
  wt('wt-merged', 'feat/merged')
  commit(join(root, 'wt-merged'), 'merged.txt', 'merged\n')
  git(clone, 'merge', '-q', '--no-ff', '-m', 'merge feat/merged', 'feat/merged')
  wt('wt-unmerged', 'feat/unmerged')
  commit(join(root, 'wt-unmerged'), 'only-here.txt', 'precious\n')
  wt('wt-dirty', 'feat/dirty')
  commit(join(root, 'wt-dirty'), 'dirty.txt', 'v1\n')
  git(clone, 'merge', '-q', '--no-ff', '-m', 'merge feat/dirty', 'feat/dirty')
  writeFileSync(join(root, 'wt-dirty', 'dirty.txt'), 'v2 not committed\n')
  wt('wt-notes', 'feat/notes')
  commit(join(root, 'wt-notes'), 'notes.txt', 'n\n')
  git(clone, 'merge', '-q', '--no-ff', '-m', 'merge feat/notes', 'feat/notes')
  writeFileSync(join(root, 'wt-notes', 'scratch-ideas.md'), 'do not lose me\n')
  git(clone, 'push', '-q', 'origin', 'dev')

  const dry = run()
  check('the merged worktree would go', /REMOVE wt-merged/.test(dry))
  check('the unmerged one stays, with its commit count', /keep\s+wt-unmerged\s+1 commit\(s\) not in/.test(dry))
  check('the one with a modified tracked file stays', /keep\s+wt-dirty\s+tracked files are modified/.test(dry))
  check('the one with an untracked file that is not a cache stays', /keep\s+wt-notes\s+untracked files: scratch-ideas\.md/.test(dry))
  check('a dry run says it changed nothing', /Dry run: nothing was changed/.test(dry))
  check('a dry run removed nothing and made no bundle', ['wt-merged', 'wt-unmerged', 'wt-dirty', 'wt-notes'].every((d) => existsSync(join(root, d))) && readdirSync(home).length === 0)

  run('--apply')
  check('--apply removed the merged worktree', !existsSync(join(root, 'wt-merged')))
  check('what holds work that is not in dev is where it was, with its content', existsSync(join(root, 'wt-unmerged', 'only-here.txt')) && existsSync(join(root, 'wt-dirty', 'dirty.txt')) && existsSync(join(root, 'wt-notes', 'scratch-ideas.md')))
  const branches = git(clone, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n')
  check('the merged branch was deleted, the others kept', !branches.includes('feat/merged') && ['dev', 'feat/unmerged', 'feat/dirty', 'feat/notes'].every((b) => branches.includes(b)))
  const bundle = readdirSync(join(home, 'kybernos-archive')).find((f) => f.endsWith('.bundle'))
  check('a bundle of every ref was made first and it verifies', bundle !== undefined && (() => { try { git(clone, 'bundle', 'verify', join(home, 'kybernos-archive', bundle)); return true } catch { return false } })())
  check('a second run has nothing left to do', /0 worktree\(s\) and 0 branch\(es\) can go/.test(run()))
} finally {
  rmSync(root, { recursive: true, force: true })
}
if (failures.length > 0) {
  console.error(`FAILED: ${failures.length}\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exit(1)
}
console.log(`worktree-clean: ${ok} checks passed`)
