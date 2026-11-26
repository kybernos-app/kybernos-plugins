// The plugin-creator skill: the examples it shows the AI must be what the registry accepts, the lists it tells the AI to pick from must be real, and the bundle
// must put it where DSH looks for skills without ever overwriting the person's own copy.
//
//   node packages/kybernos-registry/test-skill.mjs
//
// A test may reach across bundles (the pack check, the connector catalogue, the shipped packs); the code never does.
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CATALOG } from '../kybernos-composio/catalog.js'
import { DOMAIN_POINT, DOMAIN_POINT_REF, loadPacks, mergePackSets, validatePack } from '../kybernos-plugin/domain-pack.mjs'
import { createRegistry, scanDrafts } from './registry.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const skillFile = join(here, 'skills', 'plugin-creator', 'SKILL.md')
const text = readFileSync(skillFile, 'utf8')
let count = 0
const ok = async (label, fn) => { await fn(); count++; console.log('ok  ', label) }

const body = text.replace(/^---\n[\s\S]*?\n---\n/, '')
const blocks = [...body.matchAll(/```(json|yaml)\n([\s\S]*?)```/g)].map((m) => ({ lang: m[1], text: m[2] }))
const json = blocks.filter((b) => b.lang === 'json').map((b) => JSON.parse(b.text))
const yaml = blocks.filter((b) => b.lang === 'yaml').map((b) => b.text)

await ok('the skill has the frontmatter DSH reads: a name equal to its folder, a description and when to use it', () => {
  const front = text.match(/^---\n([\s\S]*?)\n---\n/)[1]
  assert.match(front, /^name: plugin-creator$/m)
  assert.match(front, /^description: .{80,}/m)
  assert.match(front, /^whenToUse: .{40,}/m)
  assert.equal(json.length, 3, 'package.json, plugin.json and one pack')
  assert.equal(yaml.length, 1, 'the empty patch')
})

const draft = (dir, name = 'vet-clinic') => {
  const put = (rel, data) => { mkdirSync(join(dir, name, rel, '..'), { recursive: true }); writeFileSync(join(dir, name, rel), typeof data === 'string' ? data : JSON.stringify(data, null, 2)) }
  put('package.json', json[0])
  put('cordis.patch.yml', yaml[0])
  put('plugin.json', json[1])
  put('domains/' + json[2].id + '.json', json[2])
  return join(dir, name)
}

await ok('the four files the skill shows make a draft the registry accepts, as a data plugin of the local namespace', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'kb-plugin-creator-'))
  try {
    draft(join(tmp, 'drafts'))
    const found = scanDrafts(join(tmp, 'drafts'))
    assert.equal(found.length, 1)
    assert.deepEqual({ ok: found[0].ok, errors: found[0].errors, id: found[0].id, kind: found[0].kind }, { ok: true, errors: [], id: 'local/vet-clinic', kind: 'data' })
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

await ok('the example pack passes the pack check, and once installed and accepted the wizard is offered it after the shipped ones', () => {
  assert.deepEqual(validatePack(json[2], json[2].id).errors ?? [], [])
  const tmp = mkdtempSync(join(tmpdir(), 'kb-plugin-creator-'))
  try {
    const folder = draft(join(tmp, 'profile', 'node_modules'), json[0].name)
    writeFileSync(join(tmp, 'profile', 'package.json'), JSON.stringify({ dependencies: { [json[0].name]: 'file:' + folder }, dsh: { profile: { bundles: [json[0].name] } } }))
    const registry = createRegistry({ profileDir: join(tmp, 'profile'), stateFile: join(tmp, 'state.json'), kybernosVersion: '0.1.1', ttlMs: 0 })
    registry.definePoint(DOMAIN_POINT)
    assert.equal(registry.plugins().find((p) => p.id === 'local/vet-clinic').status, 'needs-consent')
    registry.setConsent('local/vet-clinic', true)
    const shipped = loadPacks(join(here, '..', 'kybernos-plugin', 'domains'))
    const merged = mergePackSets(shipped, registry.contributions(DOMAIN_POINT_REF))
    const mine = merged.packs.find((p) => p.id === json[2].id)
    assert.equal(mine.from, 'local/vet-clinic')
    assert.ok(mine.order >= 50 && mine.order <= 98)
    assert.equal(merged.rejected.length, shipped.rejected.length)
  } finally { rmSync(tmp, { recursive: true, force: true }) }
})

// What section 3 tells the AI to pick from, read back out of the skill.
const list = text.slice(text.indexOf('## 3. What exists'), text.indexOf('## 4.'))
// A bullet is "- `source`: a, b, c" and may wrap onto indented lines; a paragraph is "Label: a, b, c" and may wrap too.
const unwrap = (section) => section.replace(/\n {2}(?=\S)/g, ' ')
const flat = unwrap(list)
const split = (t) => t.split(',').map((x) => x.trim().replace(/\.$/, '')).filter(Boolean)
const bullet = (source) => split(flat.match(new RegExp('- `' + source.replace(/[/]/g, '\\/') + '`: (.*)'))?.[1] ?? '')
const skills = { 'anthropics/skills': bullet('anthropics/skills'), 'anthropics/knowledge-work-plugins': bullet('anthropics/knowledge-work-plugins'), 'anthropics/claude-for-legal': bullet('anthropics/claude-for-legal'), kybernos: bullet('kybernos') }
const paragraph = (label) => (flat.match(new RegExp(label + ': ([\\s\\S]*?)(?:\\n\\n|$)'))?.[1] ?? '').replace(/\s+/g, ' ')
const slugs = split(paragraph('Connector slugs'))
const shipped = loadPacks(join(here, '..', 'kybernos-plugin', 'domains'))
const used = shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.skills))

await ok('the skills the AI may name are exactly the ones the shipped packs name, and every Kybernos one is a folder that exists', () => {
  const have = (src) => [...new Set(used.filter((s) => s.source === src).map((s) => s.name))].sort()
  for (const src of Object.keys(skills)) assert.deepEqual([...skills[src]].sort(), have(src), src)
  const dirs = readdirSync(join(here, '..', 'kybernos-plugin', 'domains', 'skills')).sort()
  assert.deepEqual([...skills.kybernos].sort(), dirs)
})

await ok('the teams it may name are the marketplace ones, the connector slugs are in the catalogue and are the ones the shipped packs use', () => {
  const client = readFileSync(join(here, '..', 'kybernos-plugin', 'client.js'), 'utf8')
  const marketIds = [...client.slice(client.indexOf('const KB_MARKET_TEAMS = ['), client.indexOf('// Manifest read-only')).matchAll(/^        id: '([a-z0-9-]+)', name:/gm)].map((m) => m[1])
  const teams = paragraph('Agent teams').match(/`([a-z0-9-]+)`/g).map((t) => t.replace(/`/g, ''))
  assert.ok(teams.length >= 3)
  for (const t of teams) assert.ok(marketIds.indexOf(t) >= 0, t + ' is a marketplace team')
  const catalog = new Set(CATALOG.map((a) => a.s))
  for (const s of slugs) assert.ok(catalog.has(s), s + ' is in the connector catalogue')
  const usedSlugs = [...new Set(shipped.packs.flatMap((p) => p.goals.flatMap((g) => g.connectors)))]
  for (const s of usedSlugs) assert.ok(slugs.indexOf(s) >= 0, s + ' is used by a shipped pack but missing from the skill')
})

await ok('the limits the skill states are the pack check\'s', async () => {
  const { LIMITS, ICONS } = await import('../kybernos-plugin/domain-pack.mjs')
  assert.ok(text.includes('`icon` is one of `' + ICONS.join(' ') + '`'), 'the icons')
  assert.match(text, new RegExp('up to ' + LIMITS.keywords + ' lower-case words'))
  assert.match(text, new RegExp('`keywords`: up to ' + LIMITS.keywords + ' lower-case words without accents, each at most ' + LIMITS.keyword))
  assert.match(text, new RegExp(LIMITS.text + ' characters at most'))
  assert.match(text, new RegExp('`goals`: 1 to ' + LIMITS.goals))
  assert.match(text, new RegExp('`skills`: up to ' + LIMITS.skills + ' per goal'))
  assert.match(text, new RegExp('`teams`: up to ' + LIMITS.teams + ' per goal'))
  assert.match(text, new RegExp('up to ' + LIMITS.connectors + ' app slugs'))
  assert.match(text, new RegExp('`soon`: up to ' + LIMITS.soon + ' texts'))
})

await ok('the bundle puts the skill under DSH_HOME, byte for byte, keeps one the person edited, and leaves a switched-off one off', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'kb-plugin-creator-home-'))
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = join(tmp, 'dsh')
  const seam = Symbol.for('kybernos.registry')
  const heldSeam = globalThis[seam]
  try {
    const mod = await import('./index.js')
    assert.deepEqual(mod.SEEDED_SKILLS, ['plugin-creator'])
    const target = join(tmp, 'dsh', 'skills', 'plugin-creator', 'SKILL.md')
    const boot = () => mod.apply({ get: () => undefined, inject: () => {}, effect: (fn) => fn(), scope: {} })
    boot()
    assert.equal(readFileSync(target, 'utf8'), text)
    globalThis[seam] = undefined
    boot()
    assert.equal(readFileSync(target, 'utf8'), text, 'a second start changes nothing')
    writeFileSync(target, '---\nname: plugin-creator\ndescription: mine\n---\nmy own words\n')
    globalThis[seam] = undefined
    boot()
    assert.match(readFileSync(target, 'utf8'), /my own words/)
    rmSync(target)
    writeFileSync(join(tmp, 'dsh', 'skills', 'plugin-creator', 'SKILL.md.disabled'), '')
    globalThis[seam] = undefined
    boot()
    assert.equal(existsSync(target), false)
  } finally {
    globalThis[seam] = heldSeam
    if (before === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = before
    rmSync(tmp, { recursive: true, force: true })
  }
})

console.log('\n' + count + ' checks passed')
