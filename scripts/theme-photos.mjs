#!/usr/bin/env node
// Makes the invented pictures of a template's sample rows: its photographs (a property, a product, a job) and the portraits of its sample people.
// ONE FLUX 2 image per picture on DeepInfra, asked at least as big as the picture that is kept (a picture is only ever shrunk, never enlarged), then
// written as a JPEG with `sips` and weighed against the limit of AGENTS rule 4 (1280 px wide, 220 KB, 24 pictures a template).
//
//   node scripts/theme-photos.mjs <plan.json> [--out <dir>] [--only name,name] [--force] [--jobs 3] [--model black-forest-labs/FLUX-2-dev] [--dry-run]
//
// plan.json (docs/dev/theme-photos/<theme>-<kind>.json; the plan is the recipe, the pictures are the product):
//   { "name": "real-estate-photos", "style": "professional real-estate listing photography, …",
//     "ask":  { "width": 1280, "height": 800, "steps": 28 },            what the model is asked for (each side 128 to 1920, a multiple of 16)
//     "keep": { "width": 1280, "quality": 82, "maxKb": 220 },           what is kept: the width of the JPEG (never above `ask.width`), its first quality, its weight
//     "cells": [ { "name": "willow-lane", "prompt": "…", "seed": 11 }, … ] }
// A cell may carry its own "ask" ({ width, height }) and a "seed" (bumped by hand to redo a picture that came out wrong). The prompt sent is
// `<cell prompt>. <plan style>.`
//
// Out: <out>/<name>.raw.<jpg|png|webp> (what the model answered, kept so a cut can be redone without paying again; `--force` asks again), <out>/<name>.jpg (the picture),
// <out>/cost.json (what DeepInfra reported for each call). `--out` defaults to ~/kybernos-archive/theme-photos/<plan name>: nothing is written inside the
// repository (a template ships only what scripts/garde-depot.mjs accepts, copied there by hand), and the key never leaves this process.
//
// The key: DEEPINFRA_API_KEY in the environment, else the one DSH keeps in <DSH home>/.credentials.yaml. It is read here and sent as a bearer header, and never
// printed or written anywhere. A cell whose call fails three times stops the run (the others in flight finish); a picture too busy to fit its weight is listed
// at the end to be redone (the others are kept). Either way the exit code is 1.
// macOS only for the JPEG (it uses `sips`, which ships with the system).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const planFile = args.find((a, i) => !a.startsWith('--') && !['--out', '--model', '--only', '--jobs'].includes(args[i - 1]))
if (planFile === undefined) { console.error('usage: node scripts/theme-photos.mjs <plan.json> [--out dir] [--only a,b] [--force] [--jobs 3] [--model id] [--dry-run]'); process.exit(2) }
const plan = JSON.parse(readFileSync(planFile, 'utf8'))
const out = resolve(flag('--out', join(homedir(), 'kybernos-archive', 'theme-photos', String(plan.name || 'plan').replace(/[^a-z0-9-]/gi, '-'))))
const model = flag('--model', 'black-forest-labs/FLUX-2-dev')
const jobs = Math.max(1, Math.min(6, Number(flag('--jobs', '3')) || 3))
const only = flag('--only', undefined)
const wanted = only === undefined ? null : new Set(only.split(',').map((s) => s.trim()).filter(Boolean))

const ask = Object.assign({ width: 1280, height: 960, steps: 28 }, plan.ask || {})
const keep = Object.assign({ width: 1280, quality: 82, maxKb: 220 }, plan.keep || {})
const side = (n) => Number.isInteger(n) && n >= 128 && n <= 1920 && n % 16 === 0
const NAME = /^[a-z0-9][a-z0-9-]{1,59}$/
if (!Array.isArray(plan.cells) || plan.cells.length < 1) { console.error('the plan needs cells'); process.exit(2) }
if (typeof plan.style !== 'string' || plan.style.trim() === '') { console.error('the plan needs a style'); process.exit(2) }
if (keep.width > ask.width) { console.error('keep.width (' + keep.width + ') is above ask.width (' + ask.width + '): a picture is never enlarged'); process.exit(2) }
const askOf = (c) => Object.assign({}, ask, c.ask || {})
for (const c of plan.cells) {
  const a = askOf(c)
  if (typeof c.name !== 'string' || !NAME.test(c.name) || typeof c.prompt !== 'string' || c.prompt.trim() === '') { console.error('a cell needs a name (lower-case, digits, dashes) and a prompt: ' + JSON.stringify(c.name)); process.exit(2) }
  if (!side(a.width) || !side(a.height)) { console.error(c.name + ': each side is a multiple of 16 from 128 to 1920 (' + a.width + 'x' + a.height + ')'); process.exit(2) }
  if (keep.width > a.width) { console.error(c.name + ': keep.width is above what is asked'); process.exit(2) }
}
if (new Set(plan.cells.map((c) => c.name)).size !== plan.cells.length) { console.error('two cells share a name'); process.exit(2) }
const cells = plan.cells.filter((c) => wanted === null || wanted.has(c.name))
const promptOf = (c) => c.prompt.trim().replace(/[.\s]+$/, '') + '. ' + plan.style.trim().replace(/[.\s]+$/, '') + '.'

if (args.includes('--dry-run')) {
  for (const c of cells) { const a = askOf(c); console.log(c.name + '  ' + a.width + 'x' + a.height + '  seed ' + (c.seed ?? 'random') + '\n  ' + promptOf(c)) }
  console.log('\nmodel ' + model + ', ' + cells.length + ' picture(s), kept at ' + keep.width + ' px wide, at most ' + keep.maxKb + ' KB, out ' + out)
  process.exit(0)
}
mkdirSync(out, { recursive: true })

const keyOf = () => {
  if (process.env.DEEPINFRA_API_KEY) return process.env.DEEPINFRA_API_KEY
  const file = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
  for (const line of readFileSync(file, 'utf8').split('\n')) { const m = /^\s*DEEPINFRA_API_KEY:\s*(\S+)/.exec(line); if (m !== null) return m[1].replace(/^['"]|['"]$/g, '') }
  throw new Error('no DEEPINFRA_API_KEY in the environment or in ' + file)
}
const key = keyOf()

const costFile = join(out, 'cost.json')
const costs = existsSync(costFile) ? JSON.parse(readFileSync(costFile, 'utf8')) : {}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** One call: the raw bytes of the picture, and what DeepInfra says it cost. */
async function generate (c) {
  const a = askOf(c)
  const body = { prompt: promptOf(c), width: a.width, height: a.height, num_inference_steps: a.steps }
  if (c.seed !== undefined) body.seed = Number(c.seed)
  const res = await fetch('https://api.deepinfra.com/v1/inference/' + model, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key }, body: JSON.stringify(body), signal: AbortSignal.timeout(240000) })
  const text = await res.text()
  if (!res.ok) throw new Error('DeepInfra answered ' + res.status + ': ' + text.slice(0, 200).replace(key, '***'))
  const json = JSON.parse(text)
  const first = Array.isArray(json.images) ? json.images[0] : (json.image_url || json.url || (Array.isArray(json.output) ? json.output[0] : undefined))
  if (typeof first !== 'string') throw new Error('no image in the answer; keys: ' + Object.keys(json).join(', '))
  let bytes
  if (first.startsWith('data:')) bytes = Buffer.from(first.slice(first.indexOf(',') + 1), 'base64')
  else if (/^https?:\/\//.test(first)) bytes = Buffer.from(await (await fetch(first, { signal: AbortSignal.timeout(120000) })).arrayBuffer())
  else bytes = Buffer.from(first, 'base64')
  const st = json.inference_status || {}
  return { bytes, cost: Number.isFinite(st.cost) ? st.cost : null, runtimeMs: Number.isFinite(st.runtime_ms) ? st.runtime_ms : null }
}

/** The format of the bytes the model answered (it answers a JPEG, whatever the name): `jpg`, `png`, `webp`, or null. */
const formatOf = (b) => (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'jpg' : (b.length > 12 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG' ? 'png' : (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' ? 'webp' : null)))
const rawFileOf = (c) => ['jpg', 'png', 'webp'].map((ext) => join(out, c.name + '.raw.' + ext)).find((f) => existsSync(f)) ?? null

const sips = (...a) => execFileSync('sips', a, { encoding: 'utf8' })
const widthOf = (file) => Number(/pixelWidth: (\d+)/.exec(sips('-g', 'pixelWidth', file))[1])
const heightOf = (file) => Number(/pixelHeight: (\d+)/.exec(sips('-g', 'pixelHeight', file))[1])

/**
 * The JPEG of a raw picture. A raw JPEG that is already at `keep.width` or narrower and light enough is kept as it is (the model's own bytes: no second
 * compression). Otherwise it is shrunk to `keep.width` (never enlarged) and the quality is lowered until it weighs at most `keep.maxKb`; below quality 60 the
 * picture is too busy to keep and the run says so, the cell is redone with a simpler prompt or another seed.
 */
function jpegOf (c, raw) {
  const dest = join(out, c.name + '.jpg')
  const rawWidth = widthOf(raw)
  const width = Math.min(rawWidth, keep.width)
  const bytes = readFileSync(raw)
  if (formatOf(bytes) === 'jpg' && rawWidth <= keep.width && bytes.length <= keep.maxKb * 1024) { writeFileSync(dest, bytes); return { kb: bytes.length / 1024, quality: 'as made', width, height: heightOf(dest) } }
  let quality = keep.quality
  for (;;) {
    sips('--resampleWidth', String(width), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), raw, '--out', dest)
    const kb = statSync(dest).size / 1024
    if (kb <= keep.maxKb) return { kb, quality, width, height: heightOf(dest) }
    if (quality <= 60) throw Object.assign(new Error(c.name + ': ' + Math.round(kb) + ' KB at quality ' + quality + ' is above ' + keep.maxKb + ' KB, too busy a picture: simplify its prompt or change its seed'), { heavy: true })
    quality -= 4
  }
}

let spent = 0
let failed = null
const heavy = []
const queue = cells.slice()
async function worker () {
  for (;;) {
    const c = queue.shift()
    if (c === undefined || failed !== null) return
    try {
      let raw = rawFileOf(c)
      if (args.includes('--force') || raw === null) {
        let got = null
        for (let attempt = 1; got === null; attempt += 1) {
          try { got = await generate(c) } catch (e) {
            if (attempt >= 3) throw new Error(c.name + ' failed three times: ' + e.message)
            console.log('  ' + c.name + ' attempt ' + attempt + ' failed (' + e.message.slice(0, 80) + '), again in ' + attempt * 4 + ' s')
            await sleep(attempt * 4000)
          }
        }
        const ext = formatOf(got.bytes)
        if (ext === null) throw new Error(c.name + ': the answer is not a JPEG, a PNG or a WebP')
        raw = join(out, c.name + '.raw.' + ext)
        writeFileSync(raw, got.bytes)
        costs[c.name] = { cost: got.cost, runtime_ms: got.runtimeMs, at: new Date().toISOString().slice(0, 16), seed: c.seed ?? null }
        if (got.cost !== null) spent += got.cost
      }
      const r = jpegOf(c, raw)
      console.log('  ' + c.name + '.jpg  ' + r.width + 'x' + r.height + '  ' + Math.round(r.kb) + ' KB  (quality ' + r.quality + ')' + (costs[c.name] && costs[c.name].cost !== null ? '  cost ' + costs[c.name].cost : ''))
    } catch (e) { if (e.heavy === true) { heavy.push(c.name); console.error('to redo: ' + e.message) } else { failed = e; console.error('stopped: ' + e.message) } }
  }
}
await Promise.all(Array.from({ length: Math.min(jobs, cells.length) }, worker))
writeFileSync(costFile, JSON.stringify(costs, null, 1) + '\n')
console.log((failed === null ? 'done: ' : 'incomplete: ') + cells.length + ' picture(s) in ' + out + ', reported cost this run ' + spent.toFixed(4) + (heavy.length > 0 ? ', to redo: ' + heavy.join(', ') : ''))
process.exit(failed === null && heavy.length === 0 ? 0 : 1)
