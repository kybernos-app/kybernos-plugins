#!/usr/bin/env node
// Makes the invented photographs of a template's sample rows: ONE FLUX 2 image on DeepInfra, a palette (a grid of separate photos), cut into pictures.
// One call gives nine photographs of the same hand and light for the price of one big image; the cut is a fixed grid with a small inset that drops the gutters.
//
//   node scripts/theme-photos.mjs <plan.json> [--out <dir>] [--model black-forest-labs/FLUX-2-dev] [--size 1920] [--seed 7] [--dry-run] [--reuse]
//
// plan.json:  { "name": "real-estate-1", "cols": 3, "rows": 3, "style": "professional real-estate photography, natural light",
//               "cells": [ { "name": "willow-lane", "prompt": "a two-storey family house with a garden, sunny afternoon" }, … ],
//               "cut": { "width": 640, "height": 400, "quality": 70, "maxKb": 70 } }
// A cell may carry "box": [x, y, width, height], the photograph's own rectangle in the palette's pixels. FLUX does not always draw the grid it is asked for (a 3 by 3
// grid of landscape photographs came back as 3 columns by 4 rows, with uneven gutters), so a palette that is not an even grid is cut by the rectangles measured on it.
// Out: <out>/<plan name>-palette.png (the whole palette, kept so the cut can be redone with --reuse), then <out>/<cell name>.jpg (the cut pictures).
//
// The key: DEEPINFRA_API_KEY in the environment, else the one DSH keeps in <DSH home>/.credentials.yaml. It is read here and sent as a bearer header, and never
// printed or written anywhere. The pictures are written outside git; what a template ships is decided by scripts/garde-depot.mjs (AGENTS rule 4).
// macOS only for the cut (it uses `sips`, which ships with the system). A call costs about 1 to 2 cents per megapixel (read from DeepInfra's own list).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const planFile = args.find((a) => !a.startsWith('--') && a !== flag('--out') && a !== flag('--model') && a !== flag('--size') && a !== flag('--seed'))
if (planFile === undefined) { console.error('usage: node scripts/theme-photos.mjs <plan.json> [--out dir] [--model id] [--size 1920] [--seed n] [--dry-run] [--reuse]'); process.exit(2) }
const plan = JSON.parse(readFileSync(planFile, 'utf8'))
const out = resolve(flag('--out', '.'))
const model = flag('--model', 'black-forest-labs/FLUX-2-dev')
const size = Number(flag('--size', '1920'))
const seed = flag('--seed', undefined)
const cols = plan.cols || 3
const rows = plan.rows || 3
const cut = Object.assign({ width: 600, height: 375, quality: 72, maxKb: 70, inset: 0.07, boxInset: 0.015 }, plan.cut || {})
if (!Array.isArray(plan.cells) || plan.cells.length < 1 || plan.cells.length > cols * rows) { console.error('the plan needs 1 to ' + cols * rows + ' cells'); process.exit(2) }
mkdirSync(out, { recursive: true })

const prompt = () => {
  const ordinal = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth']
  const lines = plan.cells.map((c, i) => 'Photograph ' + (i + 1) + ' (row ' + (Math.floor(i / cols) + 1) + ', column ' + (i % cols + 1) + '): ' + c.prompt + '.')
  return 'A single image made of a perfect ' + cols + ' by ' + rows + ' grid of ' + plan.cells.length + ' separate photographs, each one filling its own cell, '
    + 'with thick pure white gutters between the cells and around the image, no text, no captions, no numbers, no watermark. All photographs share the same look: '
    + plan.style + '. ' + lines.join(' ') + ' Every cell is a different, complete photograph with its own subject; nothing crosses a gutter.'
}

if (args.includes('--dry-run')) { console.log(prompt()); console.log('\nmodel ' + model + ', ' + size + 'x' + size + ', ' + cols + 'x' + rows + ' cells, out ' + out); process.exit(0) }

const keyOf = () => {
  if (process.env.DEEPINFRA_API_KEY) return process.env.DEEPINFRA_API_KEY
  const file = join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml')
  for (const line of readFileSync(file, 'utf8').split('\n')) { const m = /^\s*DEEPINFRA_API_KEY:\s*(\S+)/.exec(line); if (m !== null) return m[1].replace(/^['"]|['"]$/g, '') }
  throw new Error('no DEEPINFRA_API_KEY in the environment or in ' + file)
}

const paletteFile = join(out, plan.name + '-palette.png')
if (!args.includes('--reuse') || !existsSync(paletteFile)) {
  const body = { prompt: prompt(), width: size, height: size }
  if (seed !== undefined) body.seed = Number(seed)
  console.log('asking ' + model + ' for one ' + size + 'x' + size + ' palette of ' + plan.cells.length + ' photographs…')
  const res = await fetch('https://api.deepinfra.com/v1/inference/' + model, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + keyOf() }, body: JSON.stringify(body) })
  const text = await res.text()
  if (!res.ok) { console.error('DeepInfra answered ' + res.status + ': ' + text.slice(0, 300)); process.exit(1) }
  const json = JSON.parse(text)
  const first = Array.isArray(json.images) ? json.images[0] : (json.image_url || json.url || (Array.isArray(json.output) ? json.output[0] : undefined))
  if (typeof first !== 'string') { console.error('no image in the answer; keys: ' + Object.keys(json).join(', ')); process.exit(1) }
  let bytes
  if (first.startsWith('data:')) bytes = Buffer.from(first.slice(first.indexOf(',') + 1), 'base64')
  else if (/^https?:\/\//.test(first)) bytes = Buffer.from(await (await fetch(first)).arrayBuffer())
  else bytes = Buffer.from(first, 'base64')
  writeFileSync(paletteFile, bytes)
  console.log('palette saved: ' + paletteFile + ' (' + Math.round(bytes.length / 1024) + ' KB)' + (json.inference_status ? ', ' + JSON.stringify({ cost: json.inference_status.cost, runtime_ms: json.inference_status.runtime_ms }) : ''))
}

// the cut: a fixed grid, each cell inset a little to drop the gutters, then the cell's centre is cropped to the wanted ratio and resized
const sips = (...a) => execFileSync('sips', a, { encoding: 'utf8' })
const dims = sips('-g', 'pixelWidth', '-g', 'pixelHeight', paletteFile)
const W = Number(/pixelWidth: (\d+)/.exec(dims)[1])
const H = Number(/pixelHeight: (\d+)/.exec(dims)[1])
const cw = W / cols
const ch = H / rows
const wantRatio = cut.width / cut.height
plan.cells.forEach((c, i) => {
  const col = i % cols
  const row = Math.floor(i / cols)
  const box = Array.isArray(c.box) && c.box.length === 4 && c.box.every((n) => Number.isFinite(n) && n >= 0) ? c.box : null
  // the grid cell, or the measured rectangle; either way a small inset drops the gutter's anti-aliased edge
  const ix = Math.round((box === null ? cw : box[2]) * (box === null ? cut.inset : cut.boxInset))
  const iy = Math.round((box === null ? ch : box[3]) * (box === null ? cut.inset : cut.boxInset))
  let w = Math.round((box === null ? cw : box[2]) - 2 * ix)
  let h = Math.round((box === null ? ch : box[3]) - 2 * iy)
  let x = Math.round((box === null ? col * cw : box[0]) + ix)
  let y = Math.round((box === null ? row * ch : box[1]) + iy)
  if (w / h > wantRatio) { const nw = Math.round(h * wantRatio); x += Math.round((w - nw) / 2); w = nw } else { const nh = Math.round(w / wantRatio); y += Math.round((h - nh) / 2); h = nh }
  const tmp = join(out, c.name + '.cut.png')
  const dest = join(out, c.name + '.jpg')
  sips('-c', String(h), String(w), '--cropOffset', String(y), String(x), paletteFile, '--out', tmp)
  let quality = cut.quality
  for (;;) {
    sips('--resampleWidth', String(cut.width), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), tmp, '--out', dest)
    const kb = statSync(dest).size / 1024
    if (kb <= cut.maxKb || quality <= 40) { console.log('  ' + c.name + '.jpg  ' + Math.round(kb) + ' KB  (quality ' + quality + ')'); break }
    quality -= 8
  }
  execFileSync('rm', ['-f', tmp])
})
console.log('done: ' + plan.cells.length + ' pictures in ' + out)
