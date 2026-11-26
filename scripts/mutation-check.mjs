#!/usr/bin/env node
// Can this test fail? Breaks one product line in a temporary copy of the working tree and runs the test there (.claude/skills/plugin-bug-hunter,
// "Tests that cannot fail"): a test that stays green on a broken product line proves nothing about that line.
//
//   node scripts/mutation-check.mjs --file <repo-relative> --from <text> --to <text> --test <repo-relative test> [--timeout 120]
//   exit 0 = killed (the test went red on the mutant), 1 = survived (it stayed green), 2 = not run (usage, --from not found exactly once, a test red
//   before the mutation, a temp folder inside the repo)
//
// The repo is the git work tree of the current folder. The copy holds the files `git ls-files` names (tracked, plus the untracked ones not ignored, so a test
// written before its commit is there), as they are on disk; never .git nor node_modules. `--from` must occur exactly once in the file. The test runs as CI
// runs it: a scripts/ test from the root, a packages/<p>/ test from its package folder (with `node --test` for a *.test.mjs). It runs once unmutated first:
// a test already red cannot kill anything. A test killed by the timeout counts as killed (the mutant hangs). The copy is removed at the end, and nothing is
// ever written inside the real repo.
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const inside = (root, p) => { const r = relative(root, p); return r !== '' && !r.startsWith('..') && !isAbsolute(r) }

/** A repo-relative path that stays in the repo, or null. */
export function cleanRel (p) {
  if (typeof p !== 'string' || p === '' || isAbsolute(p)) return null
  const parts = p.split(/[\\/]+/)
  if (parts.some((x) => x === '..' || x === '.git' || x === 'node_modules')) return null
  return parts.filter((x) => x !== '' && x !== '.').join('/')
}

/** How many times `needle` occurs in `text` (not overlapping). */
export function occurrences (text, needle) {
  if (needle === '') return 0
  return text.split(needle).length - 1
}

/** How CI runs a test: { cwd (relative to the copy), args }. */
export function howToRun (test) {
  const m = /^packages\/([^/]+)\/(.+)$/.exec(test)
  const nodeTest = /\.test\.mjs$/.test(test)
  if (m !== null) return { cwd: 'packages/' + m[1], args: nodeTest ? ['--test', m[2]] : [m[2]] }
  return { cwd: '', args: nodeTest ? ['--test', test] : [test] }
}

/** The files to copy: tracked plus untracked-not-ignored, never .git nor node_modules. */
export function filesOf (repo) {
  const r = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('git ls-files failed: ' + (r.stderr || '').trim())
  return [...new Set(r.stdout.split('\0').filter((f) => f !== '').map(cleanRel).filter((f) => f !== null))]
}

/** Copies `files` from `repo` into `dest` (links as links); refuses any target outside `dest`. */
export function copyTree (repo, dest, files) {
  for (const f of files) {
    const from = join(repo, f)
    const to = resolve(dest, f)
    if (!inside(dest, to)) throw new Error('refused: ' + f + ' would land outside the copy')
    let st
    try { st = lstatSync(from) } catch (e) { continue } // deleted on disk, still in the index
    if (!st.isFile() && !st.isSymbolicLink()) continue // a submodule folder
    mkdirSync(dirname(to), { recursive: true })
    if (st.isSymbolicLink()) symlinkSync(readlinkSync(from), to)
    else copyFileSync(from, to)
  }
}

/** Runs one test: { code: number|'timeout', tail: [last lines] }. */
export function runTest (cwd, args, timeoutSec) {
  return new Promise((done) => {
    let out = ''
    let timedOut = false
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const lines = out.split(/\r?\n/).filter((l) => l.trim() !== '')
      done({ code: timedOut ? 'timeout' : code, tail: lines.slice(-20) })
    }
    const child = spawn(process.execPath, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, FORCE_COLOR: '0' } })
    const keep = (b) => { out += b.toString('utf8'); if (out.length > 400000) out = out.slice(-200000) }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGKILL') } catch (e) { /* gone */ }
      setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(null) }, 1000).unref()
    }, timeoutSec * 1000)
    child.on('error', (e) => { out += '\n' + e.message; finish('spawn error') })
    child.on('close', (code, signal) => finish(code === null ? signal : code))
  })
}

/** The whole check: { exit, verdict?, message, tail? }. Never throws for a usage problem. */
export async function mutationCheck ({ cwd = process.cwd(), file, from, to, test, timeout = 120 }) {
  const stop = (message) => ({ exit: 2, message })
  if (typeof from !== 'string' || typeof to !== 'string' || from === '') return stop('--from and --to are needed (--from not empty)')
  if (from === to) return stop('--from and --to are the same text: nothing would change')
  const relFile = cleanRel(file)
  const relTest = cleanRel(test)
  if (relFile === null || relTest === null) return stop('--file and --test are repo-relative paths inside the repo')
  if (!(Number(timeout) > 0)) return stop('--timeout is a number of seconds')
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' })
  if (top.status !== 0) return stop('not inside a git work tree: ' + cwd)
  const repo = realpathSync(top.stdout.trim())
  const files = filesOf(repo)
  if (!files.includes(relFile)) return stop(relFile + ' is not a file git lists in ' + repo)
  if (!files.includes(relTest)) return stop(relTest + ' is not a file git lists in ' + repo)
  const source = readFileSync(join(repo, relFile), 'utf8')
  const n = occurrences(source, from)
  if (n !== 1) return stop('--from occurs ' + n + ' times in ' + relFile + ' (it must occur exactly once)')
  const base = realpathSync(tmpdir())
  if (base === repo || inside(repo, base)) return stop('refused: the temp folder ' + base + ' is inside the repo')
  const copy = realpathSync(mkdtempSync(join(base, 'kb-mutant-')))
  try {
    if (inside(repo, copy)) return stop('refused: the copy ' + copy + ' is inside the repo')
    copyTree(repo, copy, files)
    const how = howToRun(relTest)
    const runCwd = how.cwd === '' ? copy : join(copy, how.cwd)
    const before = await runTest(runCwd, how.args, Number(timeout))
    if (before.code !== 0) return { exit: 2, message: 'the test is red before the mutation (' + (before.code === 'timeout' ? 'timeout' : 'exit ' + before.code) + '): it cannot kill anything', tail: before.tail }
    const target = join(copy, relFile)
    if (!inside(copy, realpathSync(target))) return stop('refused: ' + relFile + ' is a link that leaves the copy')
    writeFileSync(target, source.replace(from, () => to))
    const after = await runTest(runCwd, how.args, Number(timeout))
    if (after.code === 0) return { exit: 1, verdict: 'survived', message: 'survived: ' + relTest + ' stays green with the mutation in ' + relFile, tail: after.tail }
    return { exit: 0, verdict: 'killed', message: 'killed: ' + relTest + ' goes red with the mutation in ' + relFile + ' (' + (after.code === 'timeout' ? 'timeout' : 'exit ' + after.code) + ')', tail: after.tail }
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}

export function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i += 1) {
    const m = /^--(file|from|to|test|timeout)$/.exec(argv[i])
    if (m === null || argv[i + 1] === undefined) return null
    out[m[1]] = argv[i + 1]
    i += 1
  }
  return out
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) {
  const opts = parseArgs(process.argv.slice(2))
  if (opts === null || opts.file === undefined || opts.test === undefined) {
    console.error('usage: node scripts/mutation-check.mjs --file <repo-relative> --from <text> --to <text> --test <repo-relative test> [--timeout 120]')
    process.exit(2)
  }
  const r = await mutationCheck({ ...opts, timeout: opts.timeout === undefined ? 120 : Number(opts.timeout) })
  console.log(r.message)
  if (Array.isArray(r.tail) && r.tail.length > 0) console.log(r.tail.map((l) => '  | ' + l).join('\n'))
  process.exit(r.exit)
}
