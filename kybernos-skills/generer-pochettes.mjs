#!/usr/bin/env node
// generer-pochettes.mjs — pochettes illustrées des skills Featured (wan2.7-image, Token Plan).
//
// Lit ~/.dsh/kybernos/skills-featured.json, et pour chaque item SANS pochette dans
// ~/.dsh/kybernos/skills-featured/ génère une illustration 1664x928 et l'écrit <name>.png.
// Le client /kybernos-skills/cover sert ces fichiers ; sans pochette, la carte retombe sur sa
// tuile SVG procédurale — donc ce script est une amélioration, jamais un prérequis.
//
// Usage : node generer-pochettes.mjs [--force] [--only <skill-name>]…
// Clé : première entrée non vide de providers.qwen-token-plan.cles (ou .cle) dans
// ~/.dsh/kybernos-models/providers.json — jamais échoitée, jamais journalisée.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const FEATURED = join(HOME, '.dsh', 'kybernos', 'skills-featured.json')
const COVERS = join(HOME, '.dsh', 'kybernos', 'skills-featured')
const SKILLS_ROOT = join(HOME, '.dsh', 'skills')
const GATE = 'https://token-plan.ap-southeast-1.maas.aliyuncs.com'
const IMAGE_MODEL = 'wan2.7-image'
const SIZE = '1664*928' // taille prouvée par le skill prod-video-alibaba

// Direction artistique commune aux pochettes (cohérence de la rangée) + overrides par skill.
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
    const j = JSON.parse(readFileSync(join(HOME, '.dsh', 'kybernos-models', 'providers.json'), 'utf8'))
    const p = j.providers?.['qwen-token-plan'] ?? {}
    const list = Array.isArray(p.cles) ? p.cles : []
    const k = [p.cle, ...list].find((v) => typeof v === 'string' && v.length > 0)
    return k ?? null
  } catch (e) { return null }
}

const generer = async (cle, prompt) => {
  const r = await fetch(GATE + '/api/v1/services/aigc/multimodal-generation/generation', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + cle, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: IMAGE_MODEL,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: { size: SIZE }
    })
  })
  const j = await r.json().catch(() => null)
  const url = j?.output?.choices?.[0]?.message?.content?.find((c) => typeof c?.image === 'string')?.image
  if (typeof url !== 'string' || url === '') throw new Error('pas d\'image dans la réponse (HTTP ' + r.status + ')')
  const img = await fetch(url)
  if (!img.ok) throw new Error('téléchargement impossible (HTTP ' + img.status + ')')
  return Buffer.from(await img.arrayBuffer())
}

const cle = keyOf()
if (cle === null) { console.error('✗ aucune clé qwen-token-plan dans providers.json'); process.exit(1) }
let items = []
try { items = JSON.parse(readFileSync(FEATURED, 'utf8')).items ?? [] } catch (e) { items = [] }
if (items.length === 0) { console.log('liste featured vide — rien à générer'); process.exit(0) }

let faits = 0
for (const it of items) {
  const name = it.name
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) continue
  if (only.length > 0 && !only.includes(name)) continue
  const out = join(COVERS, name + '.png')
  if (!force && existsSync(out)) { console.log('· ' + name + ' — pochette déjà là'); continue }
  const prompt = (ART[name] ?? descriptionOf(name) ?? '') + ' — ' + STYLE
  try {
    const buf = await generer(cle, prompt)
    writeFileSync(out, buf)
    console.log('✓ ' + name + ' — ' + Math.round(buf.length / 1024) + ' Ko')
    faits++
  } catch (e) {
    console.error('✗ ' + name + ' — ' + (e?.message ?? e))
  }
}
console.log(faits + ' pochette(s) générée(s) dans ' + COVERS)