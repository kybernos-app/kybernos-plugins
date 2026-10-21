// The grep-level scan of a plugin's code (scripts/plugin-scan.mjs) and the ratchet it gives the manifests:
// a module may declare more than the scan sees, never less (docs/dev/plugin-contract.md, section 7).
//   node scripts/test-plugin-scan.mjs
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { draftPermissions, scanPackage, scanText, uncovered, withoutExceptions } from './plugin-scan.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0
let fail = 0
const ok = (name, cond, detail) => { if (cond) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

console.log('what the scan sees')
{
  const host = [{ rel: 'index.js', text: [
    "import { execFile } from 'node:child_process'",
    "const ROUTE = '/kybernos-demo/'",
    'export function apply (ctx) {',
    '  ctx.get(\'webServer\').register({ path: ROUTE + \'state\' })',
    "  await fetch('https://api.demo.example/v1')",
    "  await fetch('https://models.dev/api.json')",
    '  writeFileSync(file, text)',
    '  scope.systemPrompt.context({ name: \'x\' })',
    "  api.tools.register({ name: 'demo' })",
    "  // execFile('rm') in a comment is not a call",
    '}'
  ].join('\n') }]
  const page = [{ rel: 'client.js', text: "ctx.slots.register({ name: 'settings.section', id: 'demo' })\nconst SLOT_PAGE = 'main.demo'\nctx.slots.register({ name: SLOT_PAGE })\nnew MutationObserver(() => {})" }]
  const s = scanText({ host, page })
  ok('a process is seen, a comment is not', s.exec.length === 1 && s.exec[0].line === 1, s.exec)
  ok('outbound requests and their hosts', s.net.length === 2 && [...s.hosts].join() === 'models.dev', [...s.hosts])
  ok('a file write', s.fsWrite.length === 1)
  ok('the route prefix', [...s.routePrefixes].join() === '/kybernos-demo')
  ok('the system prompt and the tools', s.prompt.length === 1 && s.tools.length === 1)
  ok('slots, also through a constant, and the DOM observer', [...s.slots].sort().join() === 'main.demo,settings.section' && s.dom.length === 1)
  const draft = draftPermissions(s)
  ok('a draft with the right words', ['exec', 'fs.write:dsh-home', 'agent.prompt', 'agent.tools', 'ui.dom', 'ui.slot:settings.section', 'net:models.dev'].every((w) => draft.includes(w)), draft)
  ok('the draft covers the scan', uncovered(s, draft).length === 0, uncovered(s, draft))
  ok('nothing declared leaves every category uncovered', uncovered(s, []).length >= 6, uncovered(s, []).length)
  ok('declaring more than the scan sees is fine', uncovered(s, [...draft, 'secrets.own', 'net:other.example']).length === 0)
  ok('a missing slot is reported by name', uncovered(s, draft.filter((p) => p !== 'ui.slot:main.demo')).some((g) => /ui\.slot:main\.demo/.test(g)))
  ok('a route prefix that is served but not declared is reported', uncovered(s, draft.filter((p) => !p.startsWith('host.routes:'))).some((g) => /host\.routes/.test(g)))
}

console.log('the manifests against the code')
{
  const lifecycle = JSON.parse(readFileSync(join(REPO, 'scripts', 'lifecycle-packages.json'), 'utf8')).packages
  const exceptions = JSON.parse(readFileSync(join(REPO, 'scripts', 'plugin-scan-exceptions.json'), 'utf8'))
  const gaps = []
  let read = 0
  for (const p of lifecycle) {
    const file = join(REPO, 'packages', p.dir, 'plugin.json')
    if (!existsSync(file)) continue
    read += 1
    for (const g of uncovered(withoutExceptions(scanPackage(p.dir), exceptions[p.dir]), JSON.parse(readFileSync(file, 'utf8')).permissions ?? [])) gaps.push(p.dir + ' → ' + g)
  }
  const stale = []
  for (const [dir, list] of Object.entries(exceptions)) for (const e of list) {
    const seen = scanPackage(dir)
    if (!e.categories.some((c) => seen[c].some((x) => x.file === e.file))) stale.push(dir + '/' + e.file)
    if (typeof e.why !== 'string' || e.why.length < 10) stale.push(dir + '/' + e.file + ' has no reason')
  }
  ok('every exception still hides something, and says why', stale.length === 0, stale)
  ok('there are manifests to hold to it', read === lifecycle.length, { read, expected: lifecycle.length })
  ok('no module declares less than its code shows', gaps.length === 0, gaps.slice(0, 8))
}

console.log('exceptions')
ok('withoutExceptions removes the evidence of the named file only', (() => {
  const s = { exec: [], net: [], fsWrite: [{ file: 'a.mjs', line: 1, text: '' }, { file: 'b.mjs', line: 1, text: '' }], prompt: [], tools: [], routes: [] }
  return withoutExceptions(s, [{ file: 'a.mjs', categories: ['fsWrite'], why: 'a script' }]).fsWrite.map((x) => x.file).join() === 'b.mjs' && s.fsWrite.length === 2
})())

console.log('\nPLUGIN SCAN — ' + pass + ' ok, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
