#!/usr/bin/env node
/** The face of the Workspaces and Agent Teams cards: a pale tile whose glyph keeps the project's colour (no solid block, no outline), a still watermark that
 *  only shows on hover, a quiet foot (icon + number, the word on hover; the actions on the right), and no line for an empty description or mission.
 *  Owner, 2026-10-18: « l'affichage des icônes dans les cartes n'est pas moderne » / « éviter l'icône en noir avec contour de la couleur choisie ».
 *
 *  The pure part is the `KB-CARDFACE` block of client.js, run as it is; the rest is pinned at source level (the bundle is a browser module).
 *  The matching measurement on the real GUI is `node scripts/check-cardface-live.mjs`.
 *
 *  Usage: node packages/kybernos-plugin/test-cardface.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(process.env.KB_PLUGIN_CLIENT || join(here, 'client.js'), 'utf8')

const a = src.indexOf('// KB-CARDFACE-BEGIN')
const b = src.indexOf('// KB-CARDFACE-END')
assert.ok(a > 0 && b > a, 'the KB-CARDFACE block exists')
const api = vm.runInNewContext(src.slice(a, b) + '\n;({ KB_CF_TINT, KB_CF_GROUND, kbCfRgb, kbCfContrast, kbCfMix, kbCfGlyph, kbCfVars })')
const J = (v) => JSON.parse(JSON.stringify(v))
const swatches = [...(/const KB_SWATCHES = \[([^\]]+)\]/.exec(src)[1]).matchAll(/'(#[0-9a-f]{6})'/gi)].map((m) => m[1])

// 1. the glyph of a project colour reads 3:1 on its pale tile, in both schemes, for every colour the picker offers
{
  assert.ok(swatches.length >= 16, 'the picker\'s swatches were found (' + swatches.length + ')')
  for (const hex of swatches) {
    for (const scheme of ['light', 'dark']) {
      const g = api.kbCfGlyph(hex, scheme)
      assert.match(g, /^#[0-9a-f]{6}$/, hex + ' ' + scheme + ': a hex glyph colour')
      const ground = api.kbCfMix(J(api.KB_CF_GROUND[scheme].surface), api.kbCfRgb(hex), api.KB_CF_TINT)
      const c = api.kbCfContrast(api.kbCfRgb(g), ground)
      assert.ok(c >= 3 - 1e-9, hex + ' (' + scheme + '): the glyph is ' + c.toFixed(2) + ':1 on its tile, needs 3:1')
    }
  }
  ok('every swatch gives a glyph that reads 3:1 on its tile, in the light and the dark scheme')
}

// 2. the colour is kept: nothing is darkened more than it must be (the old tile was a solid block, the first proposal a near-black glyph)
{
  assert.equal(api.kbCfGlyph('#0ea5e9', 'dark'), '#0ea5e9', 'a colour that already reads is the glyph colour, unchanged')
  assert.equal(api.kbCfGlyph('#c4712c', 'light'), '#c4712c', 'the brown of the screenshot is kept as it is')
  const amber = api.kbCfRgb(api.kbCfGlyph('#f59e0b', 'light'))
  assert.ok(amber[0] > 150 && amber[0] > amber[2] * 3, 'amber in the light scheme is only a little deeper, still amber')
  for (const hex of swatches.filter((h) => !['#111827', '#6b7280'].includes(h))) {
    for (const scheme of ['light', 'dark']) {
      const [r, g, bl] = api.kbCfRgb(api.kbCfGlyph(hex, scheme))
      assert.ok(Math.max(r, g, bl) - Math.min(r, g, bl) > 30, hex + ' (' + scheme + '): the glyph still has a colour')
    }
  }
  ok('the project\'s own colour stays the glyph colour; it is only deepened when 3:1 needs it')
}

// 3. what a card carries: the colour and its glyph for each scheme; anything that is not a hex is not trusted (neutral tile)
{
  assert.deepEqual(J(api.kbCfVars('#abc')), { '--kb8-pc': '#aabbcc', '--kb8-pgl': api.kbCfGlyph('#abc', 'light'), '--kb8-pgd': api.kbCfGlyph('#abc', 'dark') })
  for (const bad of [null, undefined, '', 'red', 'rgb(1,2,3)', '#12', '#12345g', 42]) assert.equal(api.kbCfVars(bad), null, String(bad) + ' is not a colour')
  assert.equal(api.kbCfGlyph('#f00', 'sepia'), null, 'an unknown scheme says nothing')
  ok('a card carries its colour and its two glyph colours; a value that is not a hex gives the neutral tile')
}

// 4. the markup: both cards, hooks kept, no line for nothing
{
  const ws = src.slice(src.indexOf("const projectCard = (w, i) => {"), src.indexOf('// Workspaces list row:'))
  const ky = src.slice(src.indexOf("const cardOf = (entry, ci) => {"), src.indexOf('// Agent Teams list row:'))
  assert.ok(ws.length > 1500 && ky.length > 2500, 'both cards were found')
  for (const [name, card] of [['Workspaces', ws], ['Agent Teams', ky]]) {
    assert.ok(/kbCfWatermark\(/.test(card) && /kbCfIcon\(/.test(card) && /className: 'kb8-cf-top'/.test(card) && /className: 'kb8-cf-foot'/.test(card), name + ': watermark, tile, top row and foot')
    assert.ok(/style: kbCfVars\(/.test(card), name + ': the colour travels as custom properties on the card')
    assert.ok(!/kb8-none|ui\.nodescription|kbui\.no\.mission/.test(card), name + ': no placeholder line')
    assert.ok(!/className: 'kb8-pills'|kb8-pill-/.test(card), name + ': no pill row (the figures and the sub line replaced it)')
    assert.ok(/'data-kb': 'favorite-star'/.test(card) && /'data-kb': 'action-share'/.test(card) && /'data-kb': 'action-export'/.test(card), name + ': the actions keep their hooks')
  }
  assert.ok(/d === '' \? null : h\('p', \{ className: 'kb8-desc' \}, d\)/.test(ws), 'Workspaces: an empty description is no element')
  assert.ok(/mission === '' \? null : h\('p', \{ className: 'kb8-desc' \}, mission\)/.test(ky), 'Agent Teams: an empty mission is no element')
  assert.ok(!src.includes("'ui.nodescription'"), 'the « No description yet » sentence is gone from the dictionary (dead code)')
  assert.ok(/'data-kb': 'project-counts'/.test(ws) && /'data-kb': 'kyber-card-host', 'data-hosted'/.test(ky) && /'data-kb': 'kyber-card-live'/.test(ky) && /'data-kb': 'action-clone'/.test(ky), 'the counters, the hosting badge, the live state and the clone action keep their hooks')
  assert.ok(/\.toLowerCase\(\)/.test(ws), 'the words of the figures are the sentence case of the existing labels')
  assert.ok(/borderRadius: 'inherit'/.test(ky), 'a team picture keeps the tile\'s corners')
  assert.ok(/isActive === true/.test(ky) && /kb8-cf-here/.test(src), '« in this chat » is a dot on the tile, with its sentence as tooltip and name')
  ok('Workspaces and Agent Teams: the new face, no placeholder line, every hook kept')
}

// 5. the same face everywhere a project or a team is shown: list rows, page headers, the avatar preview, the Marketplace and its Preview dialog
{
  const between = (from, to) => { const a = src.indexOf(from); assert.ok(a > 0, from + ' exists'); const b = src.indexOf(to, a); assert.ok(b > a, to + ' follows'); return src.slice(a, b) }
  const wsRow = between('const projectRow = (w, i) => {', '// Fiche « Partager » d\'un projet')
  const kyRow = between('const rowOf = (entry, ri) => {', 'React.useEffect(() => {\n        if (hubTab !== \'marketplace\'')
  for (const [name, row, hook] of [['Workspaces row', wsRow, 'project-row'], ['Agent Teams row', kyRow, 'kyber-row']]) {
    assert.ok(row.includes("'data-kb': '" + hook + "'") && /kb8-row kb8-rf/.test(row), name + ': the row keeps its hook and carries the flat face')
    assert.ok(/kbCfIcon\([^)]*, 34\)/.test(row) && /kb8-rf-figs/.test(row) && /kb8-rf-acts/.test(row) && /style: kbCfVars\(/.test(row), name + ': tile 34, figures, actions, the colour on the row')
    assert.ok(!/kb8-pill|kb8-tile|livePill|No description|kbui\.no\.mission/.test(row), name + ': no pill, no solid tile, no placeholder line')
    assert.ok(/'data-kb': 'favorite-star'/.test(row) && /'data-kb': 'action-share'/.test(row) && /'data-kb': 'action-export'/.test(row), name + ': star, share and export carry their hooks')
  }
  assert.ok(/'data-kb': 'action-clone'/.test(kyRow) && /'data-kb': 'kyber-row-host'/.test(kyRow) && /kb8-rf-ph/.test(kyRow), 'Agent Teams row: clone, the hosting figure, and a hidden placeholder that keeps the live column')
  assert.ok(/kyFavToggle\(rootPath \+ '\/' \+ k\.id\)/.test(kyRow), 'the star of an Agent Teams row toggles by id (it used to be handed the entry)')
  assert.ok(!src.includes('const projectTile =') && !src.includes('const cloudTile =') && !src.includes('tileStyle'), 'the solid-tile helpers are gone (dead code)')
  // headers, avatar preview
  assert.ok(/kbCfIcon\(draft\.color, draft\.icon \|\| KB_DEFAULT_ICON, avatarImg\(\), false, 56\)/.test(src), 'Agent Team page header: tile 56 with the team picture')
  assert.ok(/kbCfIcon\(draft\.color, draft\.icon \|\| KB_DEFAULT_ICON, avatarImg\(\), false, 96\)/.test(src), 'Identity: the avatar preview is the same tile at 96')
  assert.ok(/kbCfIcon\(colorDraft !== '' \? colorDraft : \(typeof wsUi\.color === 'string' \? wsUi\.color : ''\), iconDraft !== '' \? iconDraft/.test(src) && !/kbCfIcon\(colorDraft, iconDraft \|\| 'folder'/.test(src), 'the project page carries the tile at 56 once, in its header, following the draft (the Details tab no longer repeats it)')
  assert.ok(!/kbOnColor\((draft\.color|wsUi\.color|colorDraft|preview\.color|it\.color)/.test(src), 'no solid colour block (colour + readable text on it) is left on a team, project or Marketplace tile')
  assert.ok(/icon: draft\.icon, color: draft\.color,/.test(src) && /icon: iconDraft, color: colorDraft,/.test(src) && /' on' \+ \(kbCfVars\(o\.color\) !== null \? ' col' : ''\)/.test(src), 'the icon pickers of a team and a project show the chosen icon in the chosen colour')
  assert.match(src, /\.kb8-iconbtn\.on\.col\{background:color-mix\(in srgb,var\(--kb8-pc\) 13%,var\(--dsw-alias-bg-layer-1\)\);border-color:var\(--kb8-pgl\);color:var\(--kb8-pgl\)\}/, 'and the CSS gives it the pale ground and the glyph colour')
  // Marketplace
  const tplCard = between("key: tpl.id, 'data-kb': 'market-card'", "kbt('kbui.install')))))")
  const cloudCard = between("key: it.slug, 'data-kb': 'market-card'", "kbt('kbui.market.cloud.install')")
  for (const [name, card] of [['a template card', tplCard], ['a catalogue card', cloudCard]]) {
    assert.ok(/kb8-card kb8-cmp kb8-cf/.test(src.slice(src.indexOf(card) - 120, src.indexOf(card) + 10)), name + ' carries the face')
    assert.ok(/kb8-cf-top/.test(card) && /kb8-cf-foot/.test(card) && /kb8-cf-stats/.test(card) && !/kb8-pill/.test(card) && !/kb8-tile/.test(card), name + ': tile, foot and figures, no pill, no solid tile')
  }
  assert.ok(/kbCfWatermark\(tpl\.icon\)/.test(tplCard) && !/kbCfWatermark/.test(cloudCard), 'a template has the watermark; a catalogue entry has none (its glyph is a text, not an icon name)')
  assert.ok(/kbCfTile\(it\.color, String\(it\.glyph/.test(cloudCard), 'the catalogue glyph is drawn in the same tile')
  assert.ok(/'data-kb': 'market-agents'/.test(tplCard) && /className: 'state', 'data-kb': 'market-installed'/.test(tplCard), 'a template card keeps market-agents and market-installed (the state word stays shown)')
  assert.ok(/kbCfIcon\(preview\.color, preview\.icon, undefined, false, 46\)/.test(src), 'the Preview dialog header carries the tile at 46')
  assert.ok(!/toUpperCase\(\) \+ ' \\u00b7 ' \+ kbt\('kbat\.builtin'\)/.test(src), 'the category line is no longer shouted in capitals')
  ok('rows, page headers, the avatar preview, the Marketplace and its Preview dialog wear the same face; the solid-tile helpers are gone')
}

// 6. the CSS: tokens only, a watermark that is still, a foot that holds the actions
{
  const start = src.indexOf('.kb8-card.kb8-cmp.kb8-cf{')
  const css = src.slice(start, src.indexOf('/* Étoile « favori » partagée', start))
  assert.ok(css.length > 2500, 'the card-face CSS was found')
  assert.deepEqual(css.match(/#[0-9a-f]{3,8}\b/gi) || [], [], 'no colour of its own in the face CSS (tokens, and the colour a project carries)')
  const rule = (sel) => { const m = new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}').exec(css); return m === null ? null : m[1] }
  const wm = rule('.kb8-cf-wm')
  assert.ok(wm !== null && /opacity:0/.test(wm) && /transform:rotate\(-8deg\)/.test(wm), 'the watermark is hidden at rest and tilted once, for good')
  const shown = rule('.kb8-cf:hover .kb8-cf-wm,.kb8-cf:focus-within .kb8-cf-wm')
  assert.ok(shown !== null && /^opacity:1$/.test(shown.trim()), 'on hover or focus it only becomes visible: nothing else changes (no transform, no animation)')
  assert.ok(!/animation|@keyframes/.test(css), 'no animation in the face')
  assert.match(css, /\.kb8-cf-ic\.col\{background:color-mix\(in srgb,var\(--kb8-pc\) 13%,var\(--dsw-alias-bg-layer-1\)\);color:var\(--kb8-pgl\)\}/, 'the pale tile, the glyph in the project\'s colour')
  assert.match(css, /body\[data-ds-dark-theme\] \.kb8-cf-ic\.col\{color:var\(--kb8-pgd\)\}/, 'and its dark-scheme glyph')
  const tile = rule('.kb8-cf-ic')
  assert.ok(!/(?:^|;)\s*(?:border(?:-(?:top|right|bottom|left|width|style|color))?|box-shadow|outline)\s*:/.test(tile), 'the tile has no outline and no border (its corners are round, that is all)')
  assert.match(tile, /background:var\(--dsw-alias-bg-module-platform\)/, 'a neutral tile is the platform grey (the three layers are all white in the light scheme)')
  assert.match(css, /\.kb8-card\.kb8-cmp\.kb8-cf \.kb8-cardacts\{position:static;/, 'the actions sit in the foot, no longer over the card')
  assert.match(css, /@media \(hover:none\)\{\.kb8-cf-lbl\{max-width:90px;opacity:1/, 'without a hover the words of the figures are always shown')
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.kb8-cf-wm,\.kb8-cf-lbl,\.kb8-cf-st svg\{transition:none\}\}/, 'and under reduced motion nothing eases')
  ok('the face CSS: tokens only, still watermark shown on hover, no outline, actions in the foot, words without a hover')
}

console.log('\n' + pass + ' checks passed')
