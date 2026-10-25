// Runs the argv shapes of dsh-tool-fs-search through the real ripgrep and through rg.mjs on one fixture tree and compares the results.
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, symlinkSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { runRg } from './rg.mjs'
const REAL = process.argv[2]
const root = mkdtempSync(join(tmpdir(), 'rgcmp-'))
const w = (p, s, t) => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), s); if (t) utimesSync(join(root, p), t, t) }
w('src/a.ts', 'export const hello = 1\nconst TODO = "fix"\n', 1000)
w('src/deep/b.test.js', 'test("hello", () => {})\n// TODO later\n', 2000)
w('src/deep/c.js', 'module.exports = 42\n', 3000)
w('README.md', '# Hello\nTODO: write docs\n', 4000)
w('.hidden/secret.txt', 'hello hidden\n', 5000)
w('.gitignore', 'ignored/\n*.log\n', 6000)
w('ignored/x.txt', 'hello ignored\n', 7000)
w('debug.log', 'hello log\n', 8000)
w('node_modules/pkg/index.js', 'hello pkg\n', 9000)
w('.git/config', 'hello git\n', 10000)
writeFileSync(join(root, 'bin.dat'), Buffer.from([104, 101, 108, 108, 111, 0, 1, 2]))
w('a b/space name.md', 'hello space\n', 11000)
const VCS = ['.git', '.svn', '.hg', '.bzr', '.jj', '.sl'] // only the names that matter for the fixture
const globCmd = (pattern, path) => ['--files', `--glob=${pattern}`, '--sort=modified', '--no-ignore', '--hidden', ...VCS.flatMap((n) => [`--glob=!**/${n}`, `--glob=!**/${n}/**`]), ...(path !== undefined ? ['--', path] : [])]
const grepCmd = (pattern, path, include) => ['--json', `--regexp=${pattern}`, ...(include !== undefined ? [`--glob=${include}`] : []), ...(path !== undefined ? ['--', path] : [])]
const real = (argv) => { const r = spawnSync(REAL, ['--no-config', ...argv], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); return { code: r.status, out: r.stdout } }
const mine = async (argv) => { let out = ''; let e = ''; const code = await runRg(['rg', '--no-config', ...argv], root, (s) => { out += s }, (s) => { e += s }, undefined); return { code, out, e } }
const matches = (out) => out.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.type === 'match').map((r) => `${r.data.path.text}:${r.data.line_number}:${r.data.lines.text.replace(/\n$/, '')}`)
let n = 0
const same = async (label, argv, mode) => {
  const a = real(argv); const b = await mine(argv)
  if (mode === 'glob') assert.deepEqual(b.out.split('\n').filter(Boolean), a.out.split('\n').filter(Boolean), label + ' (glob order and paths)')
  else assert.deepEqual(matches(b.out).sort(), matches(a.out).sort(), label + ' (grep matches)')
  assert.equal(b.code, a.code, label + ' (exit code)')
  n += 1; console.log('  ok', label)
}
await same('glob **/*.ts', globCmd('**/*.ts'), 'glob')
await same('glob *.js (basename at any depth)', globCmd('*.js'), 'glob')
await same('glob src/**/*.test.js', globCmd('src/**/*.test.js'), 'glob')
await same('glob * (everything, hidden and ignored included)', globCmd('*'), 'glob')
await same('glob with a path', globCmd('*.js', 'src'), 'glob')
await same('glob {md,txt}', globCmd('*.{md,txt}'), 'glob')
await same('glob no match', globCmd('*.nope'), 'glob')
await same('grep hello (ignores .gitignore, hidden, binary)', grepCmd('hello'), 'grep')
await same('grep TODO', grepCmd('TODO'), 'grep')
await same('grep with a path', grepCmd('hello', 'src'), 'grep')
await same('grep with include', grepCmd('hello', undefined, '*.js'), 'grep')
await same('grep regex', grepCmd('^export\\s+const'), 'grep')
await same('grep no match', grepCmd('zzzz-not-there'), 'grep')
await same('grep (?i) flag', grepCmd('(?i)HELLO'), 'grep')
console.log(n + ' comparisons identical to the real ripgrep')
