#!/usr/bin/env node
// The plugin checker's own test (docs/dev/sector-bundles.md, "Build a theme"): the tool teaches the validator,
// and it never repairs. Hermetic: no network, no DSH, and the only files written are copies under a temporary
// folder that the run removes.
//
//   node scripts/test-plugin-check.mjs
//
// The three promises of the batch, each a case below: the page's promises are executable (U10, U11, U12, U13,
// U14), the template teaches the validator (U1-U5), the tool reports and never repairs (U6, U7, U15, U18).
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { manifestErrors } from './plugin-manifest.mjs'
import { scanText } from './plugin-scan.mjs'
import { checkFolder, contextOf, declaredPoints, render } from './plugin-check.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOOL = join(REPO, 'scripts', 'plugin-check.mjs')
const STARTER = join(REPO, 'docs', 'dev', 'templates', 'acme-vet-clinic')
const PAGE = join(REPO, 'docs', 'dev', 'sector-bundles.md')
const SPECS = [join(REPO, 'docs', 'dev', 'domain-packs.md'), join(REPO, 'docs', 'dev', 'plugin-contract.md')]
const FIVE = ['kybernos/core#domain-pack', 'kybernos/theme#theme', 'kybernos/skills#skill', 'kybernos/core#team-template', 'kybernos/core#automation-template']
/** The 13 check ids that pass on the starter, in the frozen order, then the 4 that do not apply and the folder line. */
const PASS_IDS = ['manifest.present', 'manifest.json', 'manifest.schema', 'manifest.rules', 'manifest.points', 'package.data', 'point.domain-pack', 'point.theme', 'point.skill', 'point.team-template', 'point.automation-template', 'code.scan', 'hygiene']
const SKIP_IDS = ['claims.unique', 'help.card', 'compat.zone', 'archive']
/** The broken-variant table: the page and this test share it, so a variant cannot be added without its expected id. */
const BROKEN = {
  '01-not-json': 'manifest.json',
  '02-no-description': 'manifest.schema',
  '03-extends-without-requires': 'manifest.rules',
  '04-unknown-point': 'manifest.points',
  '05-domain-pack-unknown-key': 'point.domain-pack',
  '06-theme-bad-accent': 'point.theme',
  '07-package-loads-code': 'package.data',
}

let pass = 0
let fail = 0
const ok = (name, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + name); return }
  fail += 1
  console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail)))
}
const run = (...args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { cwd: REPO, encoding: 'utf8' })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const statuses = (result, status) => result.lines.filter((l) => l.status === status)
const idsOf = (result, status) => statuses(result, status).map((l) => l.id)
/** Every file of a tree, as `<rel> <sha256>` lines: the report never changes one byte of it. */
const hashTree = (dir) => {
  const out = []
  const walk = (base, prefix) => {
    for (const entry of readdirSync(base).sort()) {
      const path = join(base, entry)
      const rel = prefix === '' ? entry : prefix + '/' + entry
      const st = lstatSync(path)
      if (st.isDirectory()) { walk(path, rel); continue }
      if (!st.isFile()) { out.push(rel + ' (not a file)'); continue }
      out.push(rel + ' ' + createHash('sha256').update(readFileSync(path)).digest('hex'))
    }
  }
  walk(dir, '')
  return out
}
const jsonBlocks = (text, fenced) => [...text.matchAll(new RegExp('```' + (fenced === undefined ? 'json' : fenced) + '\\n([\\s\\S]*?)\\n```', 'g'))].map((m) => m[1])

console.log('U1-U2 the starter template')
{
  const result = checkFolder('docs/dev/templates/acme-vet-clinic')
  ok('the starter passes: exit 0, 0 FAIL', result.exitCode === 0 && result.fail === 0, idsOf(result, 'FAIL'))
  ok('the 13 PASS ids come in the frozen order', JSON.stringify(idsOf(result, 'PASS')) === JSON.stringify(PASS_IDS), idsOf(result, 'PASS'))
  ok('then the 4 SKIP ids, then the broken/ folder', JSON.stringify(idsOf(result, 'SKIP')) === JSON.stringify(SKIP_IDS.concat(['broken/'])), idsOf(result, 'SKIP'))
  ok('every SKIP says why', statuses(result, 'SKIP').every((l) => typeof l.message === 'string' && l.message.length > 10))
  ok('the header names the id, the version, data and the five points', /acme\/vet-clinic 1\.0\.0 \(data, 5 points, free\)/.test(render(result)) && FIVE.every((ref) => render(result).includes(ref.slice(ref.indexOf('#') + 1))), render(result).split('\n')[1])
  const cli = run('docs/dev/templates/acme-vet-clinic')
  ok('the CLI prints the same report and exits 0', cli.code === 0 && cli.out === render(result), cli.code)
}

console.log('U3 the same checks for us')
{
  const result = checkFolder('packages/kybernos-theme')
  ok('one of our own modules passes: exit 0', result.exitCode === 0 && result.fail === 0, idsOf(result, 'FAIL'))
  const ctx = contextOf(join(REPO, 'packages', 'kybernos-theme'))
  const zone = JSON.parse(readFileSync(join(REPO, 'dsh-compat.json'), 'utf8')).dsh
  const pj = JSON.parse(readFileSync(join(REPO, 'packages', 'kybernos-theme', 'package.json'), 'utf8'))
  ok('the first-party ctx is the one of scripts/test-layout.mjs:112', ctx.firstParty === true && ctx.dir === 'kybernos-theme' && JSON.stringify(ctx.suiteZone) === JSON.stringify(zone) && JSON.stringify(ctx.packageJson) === JSON.stringify(pj) && ctx.fileExists('plugin.json') === true && ctx.fileExists('nope.json') === false, Object.keys(ctx))
  ok('the context of an outsider folder stays empty', JSON.stringify(Object.keys(contextOf(join(REPO, 'docs', 'dev', 'templates', 'acme-vet-clinic')))) === '[]')
}

console.log('U4-U5 the broken variants')
{
  const brokenDir = join(STARTER, 'broken')
  const actual = readdirSync(brokenDir).filter((d) => statSync(join(brokenDir, d)).isDirectory()).sort()
  ok('every committed variant is in the expectation table, and every expectation has a variant', JSON.stringify(actual) === JSON.stringify(Object.keys(BROKEN).sort()), actual)
  for (const name of Object.keys(BROKEN)) {
    if (actual.indexOf(name) < 0) continue
    const dir = join(brokenDir, name)
    const result = checkFolder(dir)
    const fails = statuses(result, 'FAIL')
    const cli = run(join('docs', 'dev', 'templates', 'acme-vet-clinic', 'broken', name))
    ok(name + ' fails exactly ' + BROKEN[name] + ', and only that', result.exitCode === 1 && fails.length === 1 && fails[0].id === BROKEN[name] && cli.code === 1, fails.map((l) => l.id + ': ' + l.message))
  }
}

console.log('U6 the checked folder is byte-identical after a run')
{
  const before = hashTree(STARTER)
  checkFolder(STARTER)
  run('docs/dev/templates/acme-vet-clinic')
  const after = hashTree(STARTER)
  ok('every file of the starter hashes to the same sha256', JSON.stringify(before) === JSON.stringify(after) && before.length === 24, before.length)
}

console.log('U7 the tool reads, and never runs or fetches')
{
  const text = readFileSync(TOOL, 'utf8')
  const scan = scanText({ host: [{ rel: 'scripts/plugin-check.mjs', text }], page: [] })
  ok('no exec evidence in its own source', scan.exec.length === 0, scan.exec.slice(0, 2))
  ok('no net evidence in its own source', scan.net.length === 0, scan.net.slice(0, 2))
  ok('no filesystem-write evidence in its own source', scan.fsWrite.length === 0, scan.fsWrite.slice(0, 2))
}

console.log('U8 the usage, and U9 a folder that is not a plugin')
{
  const tmp = mkdtempSync(join(tmpdir(), 'plugin-check-'))
  try {
    for (const args of [[], ['a', 'b'], [join(tmp, 'nowhere')], [join(REPO, 'README.md')]]) {
      const r = run(...args)
      ok('exit 2 and no report for ' + (args.length === 0 ? 'no argument' : args.length === 2 ? 'two arguments' : args[0].endsWith('nowhere') ? 'a missing path' : 'a file'), r.code === 2 && r.out === '' && /^usage: /.test(r.err), { code: r.code, out: r.out.slice(0, 60) })
    }
    const empty = join(tmp, 'empty')
    mkdirSync(empty)
    cpSync(join(STARTER, 'package.json'), join(empty, 'package.json'))
    const r = run(empty)
    const result = checkFolder(empty)
    ok('a folder without plugin.json: exit 1, manifest.present, no stack trace', r.code === 1 && idsOf(result, 'FAIL').length === 1 && idsOf(result, 'FAIL')[0] === 'manifest.present' && !/\n\s+at /.test(r.out + r.err) && r.err === '', { code: r.code, out: r.out })
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

console.log('U10-U14 the page, as a contract')
{
  ok('the page exists', existsSync(PAGE))
  const page = existsSync(PAGE) ? readFileSync(PAGE, 'utf8') : ''
  const blocks = jsonBlocks(page).map((b) => JSON.parse(b)).filter((j) => j.contract === 1)
  ok('the page shows at least one manifest', blocks.length >= 1, blocks.length)
  for (const b of blocks) {
    const errors = manifestErrors(b, { firstParty: b.author !== undefined && b.author.id === 'kybernos' })
    ok('the page\'s ' + b.id + ' is accepted by manifestErrors', errors.length === 0, errors)
  }
  const commands = [...page.matchAll(/node (scripts\/[A-Za-z0-9._-]+\.mjs)/g)].map((m) => m[1])
  ok('the page quotes at least one command', commands.length > 0)
  const missing = [...new Set(commands)].filter((rel) => !existsSync(join(REPO, rel)))
  ok('every node scripts/… command of the page names a file that exists', missing.length === 0, missing)
  const rows = page.split('\n').filter((l) => /^\| `?kybernos\//.test(l))
  const keyed = rows.map((l) => l.split('|')[1].trim().replace(/`/g, '')).filter((x) => FIVE.indexOf(x) >= 0)
  const points = declaredPoints()
  ok('the frozen-interface table has exactly 5 rows, keyed by the five point ids', rows.length === 5 && keyed.length === 5 && JSON.stringify(keyed) === JSON.stringify(FIVE), { rows: rows.length, keyed })
  ok('every row names a point some plugin.json declares', FIVE.every((ref) => points.has(ref) && points.get(ref).validate !== null), FIVE.filter((ref) => !points.has(ref)))
  const headings = page.split('\n').filter((l) => /^#{2,3} /.test(l)).map((l) => l.toLowerCase())
  const four = ['primitives first', 'custom ui lives in settings', 'the style layer is a token overlay', 'cited or labelled']
  ok('the four build-contract sections are headings of the page', four.every((h) => headings.some((x) => x.indexOf(h) >= 0)), four.filter((h) => !headings.some((x) => x.indexOf(h) >= 0)))
  for (const spec of SPECS) {
    const text = existsSync(spec) ? readFileSync(spec, 'utf8') : ''
    const links = [...text.matchAll(/\]\((sector-bundles\.md)\)/g)]
    ok(spec.slice(REPO.length + 1) + ' links the page at its head, relative and resolvable', links.length >= 1 && existsSync(join(dirname(spec), 'sector-bundles.md')), links.length)
  }
}

console.log('U15 two runs print the same bytes')
{
  const one = render(checkFolder(STARTER))
  const two = render(checkFolder(STARTER))
  ok('the report is deterministic', one === two)
  const a = run('docs/dev/templates/acme-vet-clinic')
  const b = run('docs/dev/templates/acme-vet-clinic')
  ok('so is the CLI', a.out === b.out && a.out !== '')
  ok('and it carries no timestamp', !/\d{2}:\d{2}:\d{2}|\b20\d\d-\d\d-\d\dT/.test(a.out))
}

console.log('U16 a folder the manifest never names')
{
  const tmp = mkdtempSync(join(tmpdir(), 'plugin-check-'))
  try {
    const copy = join(tmp, 'acme-vet-clinic')
    cpSync(STARTER, copy, { recursive: true })
    mkdirSync(join(copy, 'engine'))
    cpSync(join(STARTER, 'package.json'), join(copy, 'engine', 'stray.json'))
    const result = checkFolder(copy)
    const line = result.lines.find((l) => l.id === 'engine/')
    ok('the extra folder is named in a SKIP line, with its reason', line !== undefined && line.status === 'SKIP' && /not declared by extends/.test(line.message), line)
    ok('and the exit does not move', result.exitCode === 0 && result.fail === 0)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
}

console.log('U17 the point validators are imported, never copied')
{
  const text = readFileSync(TOOL, 'utf8')
  ok('no hex-colour test of its own', !/#[0-9a-fA-F]{6}/.test(text) && !/HEX6|COLOR_RE/.test(text))
  ok('no theme key list of its own', !/fontText|sidebarOpacity|glassEffect|iconSet|bubbleUser/.test(text))
  ok('no cron parser of its own', !/CRON|cron field/.test(text))
  ok('it imports the five owners\' validators', /DOMAIN_POINT/.test(text) && /THEME_POINT/.test(text) && /TEAM_POINT/.test(text) && /AUTOMATION_POINT/.test(text) && /validateTeamSkill/.test(text))
  ok('it imports the repository\'s own scan and guard rules', /from '\.\/plugin-scan\.mjs'/.test(text) && /from '\.\/garde-depot\.mjs'/.test(text) && /from '\.\/plugin-manifest\.mjs'/.test(text))
}

console.log('U18 a point whose validator is not importable')
{
  const points = declaredPoints()
  const theme = points.get('kybernos/theme#theme')
  points.set('kybernos/theme#theme', { ...theme, validate: null })
  const result = checkFolder(STARTER, { points })
  const line = result.lines.find((l) => l.id === 'point.theme')
  ok('the point says SKIP, with the reason, never a PASS', line !== undefined && line.status === 'SKIP' && /not importable/.test(line.message) && !statuses(result, 'PASS').some((l) => l.id === 'point.theme'), line)
  ok('the other points still pass, and the folder is not failed for it', result.exitCode === 0 && result.fail === 0)
}

console.log('E1 the authoring loop')
{
  const before = hashTree(STARTER)
  const tmp = mkdtempSync(join(tmpdir(), 'plugin-check-'))
  try {
    const copy = join(tmp, 'my-clinic')
    cpSync(STARTER, copy, { recursive: true })
    const first = checkFolder(copy)
    ok('a copy of the starter passes with the same ids as in the repository', first.exitCode === 0 && JSON.stringify(idsOf(first, 'PASS')) === JSON.stringify(PASS_IDS), idsOf(first, 'PASS'))
    const manifest = JSON.parse(readFileSync(join(copy, 'plugin.json'), 'utf8'))
    delete manifest.description
    writeFileSync(join(copy, 'plugin.json'), JSON.stringify(manifest, null, 2) + '\n')
    const second = checkFolder(copy)
    ok('deleting the description fails with manifest.schema, and only it', second.exitCode === 1 && second.fail === 1 && statuses(second, 'FAIL')[0].id === 'manifest.schema', idsOf(second, 'FAIL'))
    cpSync(join(STARTER, 'plugin.json'), join(copy, 'plugin.json'))
    const third = checkFolder(copy)
    ok('restoring the manifest brings the copy back to exit 0', third.exitCode === 0 && third.fail === 0)
    unlinkSync(join(copy, 'broken', '01-not-json', 'plugin.json'))
  } finally { rmSync(tmp, { recursive: true, force: true }) }
  ok('the repository fixture was not touched', JSON.stringify(before) === JSON.stringify(hashTree(STARTER)))
}

console.log(`\nPLUGIN CHECK — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
