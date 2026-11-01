#!/usr/bin/env node
// Builds the release of one lot of REAL shelf examples (the pictures a model made, with the prompt and the model that made them) from its plan.
//
//   node scripts/templates-lot.mjs <plan.json> [--from <dir>] [--base <catalogue.json>] [--fallback] [--install]
//
// The plan (docs/dev/templates-lots/<lot>.json) is the recipe: it is the plan `scripts/theme-photos.mjs` runs (name, style, ask, cells with a prompt and a seed), plus what the
// catalogue needs to know about each cell (`entry`: name, tag, line, meta, alt), the type it fills (`type`) and the model (`model` id, `modelLabel` shown to the person).
// The pictures are the product and stay outside git (AGENTS rule 4): `--from` is the folder `theme-photos.mjs` wrote them to, default ~/kybernos-archive/templates-catalogue/<plan name>.
//
// A plan's cells REPLACE every example of its type in the base catalogue (`--base`, default the text shipped with the plugin), at the place the old ones held; the other types stay.
// Each example's `prompt` is exactly what the model was given (the cell's prompt and the plan's style, as `theme-photos.mjs` joins them), and `made` keeps the model, its seed and its size,
// so the dialog can offer « Use this prompt » and « Remix ».
//
// Out: <from>/release/{catalogue.json, shelf/<id>.webp (720x450, at most 300 KB), shelf/large/<id>.webp (1280x800, at most 900 KB)}: the folder the server publishes, byte for byte.
//   --fallback  also rewrites the text shipped with the plugin (the same examples, no picture and no `made`), so a machine that has never reached the server shows them too.
//   --install   copies the release into this machine's disk copy (<DSH home>/kybernos/templates-catalogue), so the shelf shows it after the next DSH start without a server.
// Needs `cwebp` (brew install webp).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const planFile = args.find((a, i) => !a.startsWith('--') && !['--from', '--base'].includes(args[i - 1]))
if (planFile === undefined) { console.error('usage: node scripts/templates-lot.mjs <plan.json> [--from dir] [--base catalogue.json] [--fallback] [--install]'); process.exit(2) }
const plan = JSON.parse(readFileSync(resolve(planFile), 'utf8'))
const from = resolve(flag('--from', join(homedir(), 'kybernos-archive', 'templates-catalogue', plan.name)))
const fallbackFile = join(here, '..', 'packages', 'kybernos-plugin', 'templates-fallback.json')
const base = JSON.parse(readFileSync(resolve(flag('--base', fallbackFile)), 'utf8'))
const { shelfValidate } = await import(pathToFileURL(join(here, '..', 'packages', 'kybernos-plugin', 'templates-shelf.mjs')).href)

const CARD = { width: 720, height: 450, maxKb: 300 }
const LARGE = { width: 1280, height: 800, maxKb: 900 }
const fail = (m) => { console.error(m); process.exit(1) }

if (typeof plan.type !== 'string' || typeof plan.model !== 'string' || !Array.isArray(plan.cells) || plan.cells.length < 1) fail('the plan needs a type, a model and cells')
const ask = Object.assign({ width: 1280, height: 800, steps: 28 }, plan.ask || {})
/** What the model was given, written the way `theme-photos.mjs` joins it. */
const promptOf = (c) => c.prompt.trim().replace(/[.\s]+$/, '') + '. ' + plan.style.trim().replace(/[.\s]+$/, '') + '.'

const release = join(from, 'release')
rmSync(release, { recursive: true, force: true })
mkdirSync(join(release, 'shelf', 'large'), { recursive: true })

/** A WebP of the picture at the size and the weight of the shelf: the quality goes down from `q` until it fits. */
const webp = (jpg, dest, size, q) => {
  for (let quality = q; quality >= 50; quality -= 6) {
    execFileSync('cwebp', ['-quiet', '-q', String(quality), '-resize', String(size.width), String(size.height), jpg, '-o', dest])
    if (statSync(dest).size <= size.maxKb * 1024) return Math.round(statSync(dest).size / 1024)
  }
  return fail(dest + ' is above ' + size.maxKb + ' KB even at quality 50: simplify its prompt or change its seed')
}

const entries = []
for (const c of plan.cells) {
  const jpg = join(from, c.name + '.jpg')
  if (!existsSync(jpg)) fail('no picture for ' + c.name + ' in ' + from + ': run scripts/theme-photos.mjs on the plan first')
  const id = c.name.replace(/-/g, '_')
  const card = webp(jpg, join(release, 'shelf', id + '.webp'), CARD, 80)
  const large = webp(jpg, join(release, 'shelf', 'large', id + '.webp'), LARGE, 84)
  const a = Object.assign({}, ask, c.ask || {})
  const e = c.entry || {}
  entries.push({
    id, type: plan.type, name: e.name, tag: e.tag, line: e.line, meta: e.meta, prompt: promptOf(c),
    image: { src: id + '.webp', width: CARD.width, height: CARD.height, alt: e.alt, large: 'large/' + id + '.webp', largeWidth: LARGE.width, largeHeight: LARGE.height },
    made: { model: plan.model, label: plan.modelLabel, seed: c.seed, width: a.width, height: a.height, steps: a.steps },
  })
  console.log('  ' + id + '  card ' + card + ' KB, large ' + large + ' KB')
}

/** The base catalogue with this plan's examples in place of every example of its type (at the place the first old one held, else at the end). */
const merge = (catalogue, list) => {
  const at = catalogue.templates.findIndex((t) => t.type === plan.type)
  const rest = catalogue.templates.filter((t) => t.type !== plan.type)
  const templates = rest.slice()
  templates.splice(at < 0 ? rest.length : Math.min(at, rest.length), 0, ...list)
  return Object.assign({}, catalogue, { templates })
}

const out = merge(base, entries)
out.version = base.version + 1
out.updatedAt = new Date().toISOString().replace(/\.\d+Z$/, 'Z')
const checked = shelfValidate(JSON.parse(JSON.stringify(out)))
if (checked === null || checked.templates.length !== out.templates.length) fail('the host would refuse or clip an example of this catalogue (it kept ' + (checked === null ? 0 : checked.templates.length) + ' of ' + out.templates.length + ')')
if (checked.templates.filter((t) => t.type === plan.type).some((t) => t.made === undefined)) fail('an example lost its « made » on the way: the host would not show its model')
const json = JSON.stringify(out, null, 1) + '\n'
if (json.length > 512 * 1024) fail('the catalogue is above 512 KB')
writeFileSync(join(release, 'catalogue.json'), json)
console.log('release: ' + release + ' (version ' + out.version + ', ' + out.templates.length + ' examples, ' + entries.length + ' of them made by ' + plan.model + ')')

if (args.includes('--fallback')) {
  const text = merge(base, entries.map((e) => { const t = Object.assign({}, e); delete t.made; return t }))
  writeFileSync(fallbackFile, JSON.stringify(text, null, 1) + '\n')
  console.log('rewrote ' + fallbackFile + ' (text only: no picture, no « made »)')
}

if (args.includes('--install')) {
  const dest = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'kybernos', 'templates-catalogue')
  for (const sub of ['shelf', join('shelf', 'large')]) {
    mkdirSync(join(dest, sub), { recursive: true })
    for (const f of readdirSync(join(release, sub))) {
      if (!f.endsWith('.webp')) continue
      copyFileSync(join(release, sub, f), join(dest, sub, f + '.tmp'))
      renameSync(join(dest, sub, f + '.tmp'), join(dest, sub, f))
    }
  }
  copyFileSync(join(release, 'catalogue.json'), join(dest, 'catalogue.json.tmp'))
  renameSync(join(dest, 'catalogue.json.tmp'), join(dest, 'catalogue.json'))
  console.log('installed into ' + dest + ': restart DSH so the shelf sees the pictures')
}
