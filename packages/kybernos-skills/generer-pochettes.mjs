#!/usr/bin/env node
// generer-pochettes.mjs — illustrated covers for the Featured skills (wan2.7-image, Token Plan).
//
// Reads <DSH home>/kybernos/skills-featured.json and, for each item WITHOUT a cover in
// <DSH home>/kybernos/skills-featured/, generates a 1664x928 illustration and writes it as <name>.png.
// The client route /kybernos-skills/cover serves these files; without a cover the card falls back to
// its procedural SVG tile, so this script is an improvement, never a prerequisite.
// <DSH home> is $DSH_HOME when set, else ~/.dsh (the same rule as DSH itself).
//
// Usage: node generer-pochettes.mjs [--force] [--only <skill-name>]…
// Key: first non-empty entry of providers.qwen-token-plan.cles (or .cle) in
// <DSH home>/kybernos-models/providers.json — never echoed, never logged.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

// The DSH home, the way DSH resolves it (@deepseek-ai/dsh-home-paths): a non-blank $DSH_HOME
// (trimmed, a leading ~ expanded), else <os home>/.dsh.
const dshHome = () => {
  const raw = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  if (raw === '') return join(homedir(), '.dsh')
  if (raw === '~') return homedir()
  return resolve(raw.startsWith('~/') || raw.startsWith('~\\') ? join(homedir(), raw.slice(2)) : raw)
}
const DSH = dshHome()
const FEATURED = join(DSH, 'kybernos', 'skills-featured.json')
const COVERS = join(DSH, 'kybernos', 'skills-featured')
const SKILLS_ROOT = join(DSH, 'skills')
const GATE = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com'
const IMAGE_MODEL = 'wan2.7-image'
const SIZE = '1664*928' // size proven by the prod-video-alibaba skill

// Art direction shared by all covers (a consistent row) + per-skill overrides.
const STYLE = 'flat vintage storybook illustration, warm muted colors, fine ink linework, isometric composition, playful and detailed, soft paper texture, no text, no watermark, no letters'
const ART = {
  'ai-team-creator': 'a team of tiny engineers assembling friendly robot agents on a wooden workbench, gears, blueprints and speech bubbles',
  'analyse-video': 'a film reel and magnifying glass over glowing film frames and video screens, timestamp markers floating',
  'chasse-bugs-ui': 'a magnifying glass hunting small glowing beetles over a large browser window wireframe, flags marking findings',
  'maquette-dsh': 'a drafting table with interface wireframe blueprints, ruler, compass and swatches',
  'artifact-bricks': 'isometric plastic toy bricks assembling themselves into a small arch bridge, tiny builders on scaffolding',
  'prod-video-alibaba': 'a vintage movie camera, clapperboard and reels connected to a friendly cloud with sparkles'
}

const argv = process.argv.slice(2)
const force = argv.includes('--force')
const onlyIdx = argv.indexOf('--only')
const only = onlyIdx >= 0 ? argv.slice(onlyIdx + 1).filter((a) => !a.startsWith('--')) : []

const descriptionOf = (name) => {
  try {
    const md = readFileSync(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8')
    const m = md.match(/^description:\s*(.+)$/m)
    return typeof m?.[1] === 'string' ? m[1].slice(0, 220) : ''
  } catch (e) { return '' }
}

const keyOf = () => {
  try {
    const j = JSON.parse(readFileSync(join(DSH, 'kybernos-models', 'providers.json'), 'utf8'))
    const p = j.providers?.['qwen-token-plan'] ?? {}
    const list = Array.isArray(p.cles) ? p.cles : []
    const k = [p.cle, ...list].find((v) => typeof v === 'string' && v.length > 0)
    return k ?? null
  } catch (e) { return null }
}

const generate = async (key, prompt) => {
  const r = await fetch(GATE + '/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: { size: SIZE }
    })
  })
  const j = await r.json().catch(() => null)
  const url = j?.output?.choices?.[0]?.message?.content?.find((c) => typeof c?.image === 'string')?.image
  if (typeof url !== 'string' || url === '') throw new Error('no image in the response (HTTP ' + r.status + ')')
  const img = await fetch(url)
  if (!img.ok) throw new Error('download failed (HTTP ' + img.status + ')')
  return Buffer.from(await img.arrayBuffer())
}

const key = keyOf()
if (key === null) { console.error('✗ no qwen-token-plan key in providers.json'); process.exit(1) }
let items = []
try { items = JSON.parse(readFileSync(FEATURED, 'utf8')).items ?? [] } catch (e) { items = [] }
if (items.length === 0) { console.log('featured list empty — nothing to generate'); process.exit(0) }

let made = 0
for (const it of items) {
  const name = it.name
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) continue
  if (only.length > 0 && !only.includes(name)) continue
  const out = join(COVERS, name + '.png')
  if (!force && existsSync(out)) { console.log('· ' + name + ' — cover already there'); continue }
  const prompt = (ART[name] ?? descriptionOf(name) ?? '') + ' — ' + STYLE
  try {
    const buf = await generate(key, prompt)
    writeFileSync(out, buf)
    console.log('✓ ' + name + ' — ' + Math.round(buf.length / 1024) + ' KB')
    made++
  } catch (e) {
    console.error('✗ ' + name + ' — ' + (e?.message ?? e))
  }
}
console.log(made + ' cover(s) generated in ' + COVERS)