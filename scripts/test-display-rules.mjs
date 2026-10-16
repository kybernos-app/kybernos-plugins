// Display rules of the plugins' own CSS, read from the source (no GUI, no browser).
//
//   node scripts/test-display-rules.mjs
//
// Each rule here comes from a defect measured on the real GUI by scripts/check-display-live.mjs:
//  - a literal white text on a fill that is too light to carry it (the orange #ff7a1a, the success green, an accent
//    variable that may be a pastel): 2.1 to 2.8:1. The ink there is #0f1115;
//  - an error note filled with `state-error-secondary`: that token is a SOLID red, so the error text on it was 1.0:1 (dark)
//    and 1.4:1 (light). The soft fill is a mix of the primary;
//  - a switch knob that is a literal white on a track filled with the brand token, which is near-white in the dark scheme;
//  - (audit WP-16) text that lands on a surface of the other brightness than its ink: a theme-following ink on the fixed light stage of
//    Slides / Bricks / Modeleur, a fixed dark-theme ink on the theme's own panel, an off-state switch knob that merges with its track,
//    a chip whose dark-scheme ink was reused on a pale tint. Those are checked with the real colours: DSH's token values, resolved here.
//
// Generated copies of DSH's own primitives (kybernos-plugin/shared-ui.css and the strings inlined from it) are not ours to
// edit and are skipped.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// KB_DISPLAY_ROOT points the scan at another packages folder (to prove the test fails on the old rules).
const ROOT = process.env.KB_DISPLAY_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..', 'packages')
let count = 0
// KB_DISPLAY_KEEP_GOING=1 lists every failing rule instead of stopping at the first (to see what a test catches on an old tree: KB_DISPLAY_ROOT).
const failed = []
const ok = (label, fn) => {
  try { fn(); count += 1; console.log('ok  ', label) } catch (e) { if (!process.env.KB_DISPLAY_KEEP_GOING) throw e; failed.push(label); console.log('FAIL', label, '-', String(e.message).split('\n')[0].slice(0, 160)) }
}

const files = []
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'vendor' || name === 'skills') continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path)
    else if (/(client\.js|\.css)$/.test(name) && name !== 'shared-ui.css') files.push(path)
  }
}
walk(ROOT)

/** One-line rules `selector{declarations}` of every client and stylesheet, with where they are. Lines are scanned one by one;
 *  a very long line is a generated string of DSH's primitives, not ours. */
const rules = []
const RULE = /([^{}]{1,240})\{([^{}]{1,1200})\}/g
for (const file of files) {
  readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    if (text.length > 3000 || text.indexOf('{') < 0) return
    for (const m of text.matchAll(RULE)) rules.push({ file: relative(ROOT, file), line: i + 1, selector: m[1].trim(), body: m[2] })
  })
}
const decl = (body, prop) => {
  const m = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*((?:var\\([^;]*?\\)|color-mix\\([^;]*?\\)|[^;])+)').exec(body)
  return m === null ? null : m[1].trim()
}
const WHITE = /^(#fff(fff)?|white)$/i
const where = (r) => r.file + ':' + r.line + ' ' + r.selector.slice(-60)

ok('the rule scan reads the plugins', () => assert.ok(rules.length > (process.env.KB_DISPLAY_ROOT ? 10 : 1000), String(rules.length)))

ok('no literal white text on the orange #ff7a1a, the success green or an accent variable', () => {
  const bad = rules.filter((r) => {
    const fg = decl(r.body, 'color')
    const bg = decl(r.body, 'background(?:-color)?')
    if (fg === null || bg === null || !WHITE.test(fg)) return false
    return /^#ff7a1a$/i.test(bg) || /^var\(--dsw-alias-state-(success|warn)-primary/.test(bg) || /^var\(--acc\)$/.test(bg)
  })
  assert.deepEqual(bad.map(where), [])
})

ok('the success fills carry the dark ink, not the label pair of the brand fill', () => {
  const bad = rules.filter((r) => {
    const fg = decl(r.body, 'color')
    const bg = decl(r.body, 'background(?:-color)?')
    return fg !== null && bg !== null && /^var\(--dsw-alias-state-success-primary/.test(bg) && /^var\(--dsw-alias-label-primary-foreground/.test(fg)
  })
  assert.deepEqual(bad.map(where), [])
})

ok('no error note is filled with the solid state-error-secondary token', () => {
  const bad = rules.filter((r) => {
    const bg = decl(r.body, 'background(?:-color)?')
    const fg = decl(r.body, 'color')
    return bg !== null && fg !== null && /^var\(--dsw-alias-state-error-secondary/.test(bg) && /state-error-primary/.test(fg)
  })
  assert.deepEqual(bad.map(where), [])
})

ok('a switch knob is not a literal white on a brand-token track (.kbw-sw)', () => {
  const knob = rules.find((r) => /^\.kbw-sw-kn$/.test(r.selector))
  assert.ok(knob, '.kbw-sw-kn is defined')
  assert.doesNotMatch(decl(knob.body, 'background'), WHITE, 'the off knob follows the theme')
  const on = rules.find((r) => /^\.kbw-sw\.on \.kbw-sw-kn$/.test(r.selector))
  assert.ok(on, 'the on knob has its own pair')
  assert.match(decl(on.body, 'background'), /label-primary-foreground/, 'the on knob is the label pair of the brand fill')
})

ok('the off track of the Theme page toggles is not layer-3 (white in the light scheme)', () => {
  const toggle = rules.find((r) => r.file.startsWith('kybernos-theme/') && /^\.kbth-toggle$/.test(r.selector))
  assert.ok(toggle, '.kbth-toggle is defined')
  assert.doesNotMatch(decl(toggle.body, 'background'), /bg-layer-3/)
})

ok('the "+" tile of the New chat button is a tint of the button\'s own label colour, not bg-overlay', () => {
  const tile = rules.find((r) => r.file.startsWith('kybernos-plugin/') && /^\.kb4-plus$/.test(r.selector))
  assert.ok(tile, '.kb4-plus is defined')
  assert.doesNotMatch(decl(tile.body, 'background'), /bg-overlay/)
  assert.match(decl(tile.body, 'background'), /label-primary-foreground/)
})

ok('kybernos-plugin does not define .kbf-hint: kybernos-cloud owns that class name (its 60%-opacity mono leaked onto the account hints)', () => {
  const clash = rules.filter((r) => r.file.startsWith('kybernos-plugin/') && /(^|[\s,>+~])\.kbf-hint\b/.test(r.selector))
  assert.deepEqual(clash.map(where), [])
})


// ── Colour arithmetic ────────────────────────────────────────────────────────────────────────────────────────────────────────
// The token values DSH ships in its two schemes (dsh-client-ui-theme, the same ones scripts/check-display-live.mjs measures) and a
// resolver for the colour syntax the plugins write: #hex, rgb()/rgba(), var(--dsw-alias-x[, fallback]) and color-mix(in srgb, A p%, B|transparent).
const TOKENS = {
  light: { 'label-primary': '#0f1115', 'label-secondary': '#61666b', 'label-tertiary': '#81858c', 'label-primary-foreground': '#ffffff',
    'bg-base': '#ffffff', 'bg-layer-1': '#ffffff', 'bg-layer-2': '#ffffff', 'bg-layer-3': '#ffffff', 'bg-module-platform': '#f5f6f7',
    'border-l1': '#0000000a', 'border-l2': '#0000001a', 'border-l3': '#0000001f', 'border-l4': '#00000029', 'interactive-bg-hover': '#2631480f',
    'state-success-primary': '#22c55e', 'state-success-tertiary': '#e6faed', 'state-warn-primary': '#f59e0b', 'state-warn-tertiary': '#fef5e7',
    'state-error-primary': '#ec1313', 'state-business-primary': '#4176e6', 'state-business-tertiary': '#e4edfd', 'brand-primary': '#0f1115', link: '#4176e6' },
  dark: { 'label-primary': '#f9fafb', 'label-secondary': '#cfd3d6', 'label-tertiary': '#adb2b8', 'label-primary-foreground': '#0f1115',
    'bg-base': '#161617', 'bg-layer-1': '#232324', 'bg-layer-2': '#2c2c2e', 'bg-layer-3': '#353638', 'bg-module-platform': '#353638',
    'border-l1': '#ffffff0f', 'border-l2': '#ffffff1f', 'border-l3': '#ffffff29', 'border-l4': '#ffffff33', 'interactive-bg-hover': '#ffffff14',
    'state-success-primary': '#22c55e', 'state-success-tertiary': '#233c2c', 'state-warn-primary': '#f59e0b', 'state-warn-tertiary': '#27241f',
    'state-error-primary': '#f25a5a', 'state-business-primary': '#7aaaff', 'state-business-tertiary': '#34415b', 'brand-primary': '#f9fafb', link: '#7aaaff' },
}
const hexRgba = (h) => { h = h.replace('#', ''); if (h.length <= 4) h = h.split('').map((c) => c + c).join(''); const n = (i) => parseInt(h.slice(i, i + 2), 16); return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1] }
/** A colour expression to [r, g, b, a]; `vars` are the custom properties in scope (e.g. { '--kb6-ink': '#fdba74' }). */
const colour = (expr, scheme, vars = {}) => {
  const e = String(expr).trim()
  let m = /^#([0-9a-f]{3,8})$/i.exec(e)
  if (m) return hexRgba(e)
  if (e === 'transparent') return [0, 0, 0, 0]
  if (e === 'white') return [255, 255, 255, 1]
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(e)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])]
  m = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]+))?\)$/.exec(e)
  if (m) {
    if (vars[m[1]] !== undefined) return colour(vars[m[1]], scheme, vars)
    const token = /^--dsw-alias-(.+)$/.exec(m[1])
    if (token !== null && TOKENS[scheme][token[1]] !== undefined) return hexRgba(TOKENS[scheme][token[1]])
    if (m[2] !== undefined) return colour(m[2], scheme, vars)
    throw new Error('unknown custom property ' + m[1] + ' in ' + e)
  }
  m = /^color-mix\(\s*in srgb\s*,\s*([\s\S]+)\)$/.exec(e)
  if (m) { // two operands at the top level, each `colour [p%]`
    const parts = []
    let depth = 0, from = 0
    for (let i = 0; i < m[1].length; i += 1) {
      const c = m[1][i]
      if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      else if (c === ',' && depth === 0) { parts.push(m[1].slice(from, i)); from = i + 1 }
    }
    parts.push(m[1].slice(from))
    if (parts.length !== 2) throw new Error('color-mix with ' + parts.length + ' operands: ' + e)
    const operand = (p) => { const t = /^([\s\S]*?)(?:\s+([\d.]+)%)?\s*$/.exec(p.trim()); return { c: colour(t[1], scheme, vars), pct: t[2] === undefined ? null : Number(t[2]) / 100 } }
    const a = operand(parts[0]), b = operand(parts[1])
    const pa = a.pct !== null ? a.pct : (b.pct !== null ? 1 - b.pct : 0.5)
    const aa = a.c[3] * pa, bb = b.c[3] * (1 - pa), al = aa + bb
    if (al === 0) return [0, 0, 0, 0]
    return [0, 1, 2].map((i) => (a.c[i] * aa + b.c[i] * bb) / al).concat([al])
  }
  throw new Error('cannot resolve the colour ' + e)
}
const over = (top, back) => { const a = top[3] + back[3] * (1 - top[3]); return a === 0 ? [0, 0, 0, 0] : [0, 1, 2].map((i) => (top[i] * top[3] + back[i] * back[3] * (1 - top[3])) / a).concat([a]) }
const luminance = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
/** WCAG contrast of `fg` painted on `bg` (translucent colours are laid over `behind`, white by default). */
const contrast = (fg, bg, behind = [255, 255, 255, 1]) => { const back = over(bg, behind); const top = over(fg, back); const x = luminance(top), y = luminance(back); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
/** The rule of a selector as it is written (leading quote of a JS string and a bundle's own prefix are not part of it). */
const ruleOf = (file, selector) => rules.find((r) => r.file.startsWith(file) && r.selector.replace(/^['"`]+/, '') === selector)
const need = (file, selector) => { const r = ruleOf(file, selector); assert.ok(r, selector + ' is defined in ' + file); return r }

ok('the colour resolver agrees with the numbers the sweep measures (label-tertiary 3.7:1 on white, label-secondary 5.8:1)', () => {
  const r = (fg, bg, scheme) => Math.round(contrast(colour(fg, scheme), colour(bg, scheme)) * 10) / 10
  assert.equal(r('var(--dsw-alias-label-tertiary)', 'var(--dsw-alias-bg-layer-1)', 'light'), 3.7)
  assert.equal(r('var(--dsw-alias-label-secondary)', 'var(--dsw-alias-bg-layer-1)', 'light'), 5.8)
  assert.equal(r('color-mix(in srgb, #000 50%, #fff)', '#fff', 'light'), 4)
  assert.equal(r('rgba(0,0,0,.5)', '#fff', 'light'), 4)
})


// ── WP-16: the rules of the right pane's panels and of the controls the audit measured ──────────────────────────────────────────
/** Every `selector{declarations}` of a file, across lines (the CSS of these panels is written in template strings, a rule may span lines). */
const srcOf = (rel) => readFileSync(join(ROOT, rel), 'utf8')
const ruleCache = new Map()
const multiRules = (rel) => {
  if (!ruleCache.has(rel)) {
    const text = srcOf(rel).replace(/\/\*[\s\S]*?\*\//g, '')
    // The first rule after some code is preceded by up to 240 characters of it: a selector is what follows the last line break or backtick.
    ruleCache.set(rel, [...text.matchAll(RULE)].map((m) => ({ selector: m[1].split(/[\n`]/).pop().trim().replace(/^[\s'",+]+/, ''), body: m[2] })))
  }
  return ruleCache.get(rel)
}
// The cascade, as far as these tests need it: every rule of a selector is merged in order and the LAST declaration of a property wins.
const lastDecl = (body, prop) => { const all = [...body.matchAll(new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*((?:var\\([^;]*?\\)|color-mix\\([^;]*?\\)|[^;])+)', 'g'))]; return all.length === 0 ? null : all[all.length - 1][1].trim() }
const rule = (rel, selector) => { const r = multiRules(rel).filter((x) => x.selector === selector); assert.ok(r.length > 0, selector + ' is defined in ' + rel); return { selector, body: r.map((x) => x.body).join(';') } }
const hasRule = (rel, selector) => multiRules(rel).some((x) => x.selector === selector)
const atLeast = (label, got, min) => assert.ok(got >= min, label + ': ' + (Math.round(got * 100) / 100) + ':1, needs ' + min)

// A panel is drawn in two parts: a STAGE that is a fixed light paper whatever the scheme, and the panel itself (head, transport bar, notes) that follows the theme.
// Inks chosen for one of the two read wrong on the other: the theme's text tokens are near-white in the dark scheme, so on the paper they were 1.2:1 to 2:1 (A4-01, A4-24).
const PANELS = [
  { name: 'Slides', file: 'kybernos-slides/client.js', p: 'kbsd', stage: '.kbsd-scene', empty: '.kbsd-empty', root: '.kbsd-root', note: '.kbsd-note-bas' },
  { name: 'Bricks', file: 'kybernos-bricks/client.js', p: 'kbb', stage: '.kbb-view', empty: '.kbb-empty', root: '.kbb-root', note: '.kbb-note' },
  { name: 'Modeleur', file: 'kybernos-modeleur/client.js', p: 'kbm', stage: '.kbm-view', empty: '.kbm-empty', root: '.kbm-root', note: '.kbm-note' },
]
for (const P of PANELS) {
  ok(P.name + ': the empty state reads 4.5:1 on the fixed light stage, in both schemes (A4-01, A4-24)', () => {
    const stage = colour(lastDecl(rule(P.file, P.stage).body, 'background'), 'light')
    for (const scheme of ['light', 'dark']) {
      atLeast(P.empty + ' text (' + scheme + ')', contrast(colour(lastDecl(rule(P.file, P.empty).body, 'color'), scheme), stage), 4.5)
      atLeast(P.empty + ' b (' + scheme + ')', contrast(colour(lastDecl(rule(P.file, P.empty + ' b').body, 'color'), scheme), stage), 4.5)
      const code = rule(P.file, P.empty + ' code')
      atLeast(P.empty + ' code (' + scheme + ')', contrast(colour(lastDecl(rule(P.file, P.empty).body, 'color'), scheme), colour(lastDecl(code.body, 'background'), scheme), stage), 4.5)
    }
  })
  ok(P.name + ': the speed buttons, the step buttons, the counter and the notes read 4.5:1 on the theme panel, in both schemes (A4-24)', () => {
    const panelBg = lastDecl(rule(P.file, P.root).body, 'background')
    const sels = ['.' + P.p + '-sp', '.' + P.p + '-step', '.' + P.p + '-lab', '.' + P.p + '-lab b', P.note].filter((x) => hasRule(P.file, x))
    assert.ok(sels.length >= 2, 'the transport bar is found')
    for (const scheme of ['light', 'dark']) {
      const bg = colour(panelBg, scheme)
      for (const sel of sels) atLeast(sel + ' (' + scheme + ')', contrast(colour(lastDecl(rule(P.file, sel).body, 'color'), scheme), bg), 4.5)
      const on = rule(P.file, '.' + P.p + '-sp.on')
      atLeast('the selected speed (' + scheme + ')', contrast(colour(lastDecl(on.body, 'color'), scheme), colour(lastDecl(on.body, 'background'), scheme), bg), 4.5)
    }
  })
}

ok('Slides: the tool bar stays 4.5:1 while it fades (idle) over the stage or a dark slide', () => {
  const file = 'kybernos-slides/client.js'
  const fade = Number(/opacity:\s*([\d.]+)/.exec(rule(file, '.kbsd-outils-idle').body)[1])
  const ink = colour(lastDecl(rule(file, '.kbsd-outil').body, 'color'), 'light')
  const bar = colour(lastDecl(rule(file, '.kbsd-outils').body, 'background'), 'light')
  for (const behind of ['#e9e7e2', '#2a1512', '#0f2623']) { // the stage, and two dark slide themes
    const back = colour(behind, 'light')
    const barOver = over(bar, back)
    // a group at opacity `fade`: the bar and its ink are laid over the backdrop together
    const faded = (c) => over([c[0], c[1], c[2], c[3] * fade], back)
    atLeast('idle tool label on ' + behind, contrast(faded(over(ink, barOver)), faded(barOver)), 4.5)
  }
})

ok('Slides: the text editor box and its G / I / S buttons are readable on any slide theme (A4-02, A4-05)', () => {
  const file = 'kybernos-slides/client.js'
  const src = srcOf(file)
  const ebox = rule(file, '.kbsd-ebox')
  assert.equal((ebox.body.match(/background\s*:/g) || []).length, 1, 'one background on .kbsd-ebox (the first, transparent, was always overridden by the second)')
  atLeast('the box text on its fill', contrast(colour(lastDecl(ebox.body, 'color'), 'light'), colour(lastDecl(ebox.body, 'background'), 'light'), colour('#0f2623', 'light')), 4.5)
  const rich = src.slice(src.indexOf("zone.className = 'kbsd-ebox'"), src.indexOf("zone.className = 'kbsd-ebox'") + 400)
  assert.doesNotMatch(rich, /background\s*:\s*transparent/, 'the rich editor box keeps the box fill: near-black text on a transparent box over a dark slide was 1.1:1')
  const btn = src.slice(src.indexOf('const bouton = (label, cmd, style)'), src.indexOf('const bouton = (label, cmd, style)') + 500)
  assert.match(btn, /color:#111/, 'the G / I / S buttons set their own ink: they inherited the slide ink (white) on a white button')
})

ok('the mini-app button (App ⤓) follows the theme: its label, border and hover are tokens, not the dark-scheme colours (A4-13)', () => {
  const css = srcOf('kybernos-miniapps/client.js')
  const at = css.indexOf('.${CLASSE_BOUTON}{')
  const btn = css.slice(at, css.indexOf('.${CLASSE_BOUTON}:disabled'))
  assert.ok(at > 0 && btn.length > 50, 'the button rule is found')
  assert.doesNotMatch(btn, /#c6d0e2|#3a4356|#20263338|#2a3346|#4a5870/, 'no dark-scheme literal left on the button')
  for (const scheme of ['light', 'dark']) {
    const label = btn.match(/color:\s*([^;]+);/)[1]
    atLeast('the label on the panel head (' + scheme + ')', contrast(colour(label, scheme), colour('var(--dsw-alias-bg-layer-2)', scheme)), 4.5)
  }
})


// An off-state switch must show where its knob is without the colour of the ON state: the knob and the track are 3:1 apart in both schemes (WCAG 1.4.11).
// The ink pairs a bundle chose came out as the knob = the track colour in one scheme or the other (1.0:1 on Automations, 1.3:1 on Auto routing and Web search, 1.6:1 on Theme).
const SWITCHES = [
  ['kybernos-plugin/client.js', '.kba-toggle', '.kba-toggle-knob'],
  ['kybernos-auto/client.js', '.kaa-switch-btn', '.kaa-switch-btn span'],
  ['kybernos-websearch/client.js', '.kwse-switch', '.kwse-switch span'],
  ['kybernos-theme/client.js', '.kbth-toggle', '.kbth-toggle-knob'],
  ['kybernos-skills/client.js', '.kbs-root .kb-sw', '.kbs-root .kb-sw i'],
  ['kybernos-kyber/client.js', '.kbky-sw', '.kbky-swk'],
  ['kybernos-plugin/client.js', '.kbw-sw', '.kbw-sw-kn'],
  ['kybernos-plugin/client.js', '.kbu-sw', '.kbu-sw-dot'],
  ['kybernos-hub/client.js', '.kbsu-sw', '.kbsu-sw i'],
  ['kybernos-workers/client.js', '.kbwk-sw', '.kbwk-sw i'],
  ['kybernos-maintenance/client.js', '.kbmz-sw', '.kbmz-sw i'],
  ['kybernos-models/client.js', '.kbpv-sw', '.kbpv-sw-k'],
]
ok('the knob of every off switch is 3:1 from its track, in both schemes (A1-02, A3-44)', () => {
  const backdrop = { light: 'var(--dsw-alias-bg-layer-2)', dark: 'var(--dsw-alias-bg-layer-2)' }
  for (const [file, track, knob] of SWITCHES) {
    // quoted CSS strings of a bundle (['.a{...}', ...]) are scanned as one rule per line by multiRules, whose selectors lose their opening quote
    const t = rule(file, track), k = rule(file, knob)
    for (const scheme of ['light', 'dark']) {
      const back = colour(backdrop[scheme], scheme)
      const trackColour = over(colour(lastDecl(t.body, 'background'), scheme), back)
      const knobColour = colour(lastDecl(k.body, 'background'), scheme)
      atLeast(track + ' knob on track (' + scheme + ')', contrast(knobColour, trackColour), 3)
    }
  }
})
ok('the knob of an ON switch stays visible on the brand fill too: the label pair of the fill, never a literal white (A1-02)', () => {
  for (const [file, onKnob] of [['kybernos-maintenance/client.js', '.kbmz-sw.on i'], ['kybernos-plugin/client.js', '.kba-toggle.on .kba-toggle-knob'], ['kybernos-theme/client.js', '.kbth-toggle.on .kbth-toggle-knob']]) {
    const k = rule(file, onKnob)
    assert.match(lastDecl(k.body, 'background'), /label-primary-foreground/, onKnob)
  }
})

// A1-01: the Suite, Workers and the core's switch typed the brand orange as a literal (#ff7a1a), so a preset (Neutral violet) recoloured the Connectors page and
// left these ones orange. Every accent control draws from the theme's brand token, with its label pair for the ink and for the ON knob (a white knob on the
// near-white brand fill of the dark scheme would vanish). The Composio logo mark keeps its own gradient: it is a logo, not an accent.
ok('A1-01: no literal brand orange #ff7a1a in the Suite, Workers, the core switch or the Composio filter pill: a preset recolours them', () => {
  const ours = (r) => /^(kybernos-hub|kybernos-workers)\//.test(r.file) || (r.file.startsWith('kybernos-plugin/') && /^\.kbu-sw/.test(r.selector)) || (r.file.startsWith('kybernos-composio/') && /kbfpill/.test(r.selector))
  assert.deepEqual(rules.filter((r) => ours(r) && /#ff7a1a/i.test(r.body)).map(where), [])
})
ok('A1-01: the ON knob of the Suite, Workers and core switches is the label pair of the brand fill, 3:1 on it in both schemes', () => {
  for (const [file, track, knob] of [
    ['kybernos-hub/client.js', '.kbsu-sw.on', '.kbsu-sw.on i'],
    ['kybernos-workers/client.js', '.kbwk-sw.on', '.kbwk-sw.on i'],
    ['kybernos-plugin/client.js', '.kbu-sw.on', '.kbu-sw.on .kbu-sw-dot'],
  ]) {
    const t = rule(file, track), k = rule(file, knob)
    assert.match(lastDecl(t.body, 'background'), /^var\(--dsw-alias-brand-primary\)$/, track + ' fill')
    assert.match(lastDecl(k.body, 'background'), /^var\(--dsw-alias-label-primary-foreground\)$/, knob)
    for (const scheme of ['light', 'dark']) {
      atLeast(knob + ' on its track (' + scheme + ')', contrast(colour(lastDecl(k.body, 'background'), scheme), colour(lastDecl(t.body, 'background'), scheme)), 3)
    }
  }
})
ok('A1-01: the accent buttons and the numbered step discs of the Suite and Workers are the brand fill with its label pair, 4.5:1 in both schemes', () => {
  for (const [file, selector] of [
    ['kybernos-hub/client.js', '.kbsu-btn.accent'],
    ['kybernos-workers/client.js', '.kbwk-btn.accent'],
    ['kybernos-workers/client.js', '.kbwk-todo>li.cur .kbwk-n'],
    ['kybernos-workers/client.js', '.kbwk-tabs button[aria-current="step"] .kbwk-n'],
  ]) {
    const r = rule(file, selector)
    assert.match(lastDecl(r.body, 'background'), /^var\(--dsw-alias-brand-primary\)$/, selector + ' fill')
    assert.match(lastDecl(r.body, 'color'), /^var\(--dsw-alias-label-primary-foreground\)$/, selector + ' ink')
    for (const scheme of ['light', 'dark']) {
      atLeast(selector + ' (' + scheme + ')', contrast(colour(lastDecl(r.body, 'color'), scheme), colour(lastDecl(r.body, 'background'), scheme)), 4.5)
    }
  }
})

// The type colours of the Creations page, the artifact menu and the new-chat tiles are pastels made for the dark scheme: pale text on a pale tint is 1.2 to 2.7:1 in the light ones (A4-12, A1-11).
// Each rule keeps the pastel in a custom property and the light schemes mix it toward the text colour, so a type keeps its hue and gains its contrast.
ok('the type badges of Creations read 4.5:1 in both schemes (A4-12)', () => {
  const file = 'kybernos-plugin/client.js'
  const types = [...srcOf(file).matchAll(/\{ id: '([a-z]+)', label: [^\n]*?tint: '(rgba\([^']+\))', color: '(#[0-9a-f]{6})' \}/g)]
  assert.ok(types.length >= 13, 'the type table is found (' + types.length + ')')
  const base = rule(file, '.kb6-type'), light = rule(file, 'body:not([data-ds-dark-theme]) .kb6-type')
  assert.equal(lastDecl(base.body, 'color'), 'var(--kb6-ink)')
  for (const [, id, tint, pastel] of types) {
    for (const [scheme, css] of [['light', light], ['dark', base]]) {
      const ink = colour(lastDecl(css.body, 'color'), scheme, { '--kb6-ink': pastel })
      // the badge sits on a card (layer 1 or 2); in the light scheme also on the pale grey of a platform module
      for (const layer of ['var(--dsw-alias-bg-layer-1)', 'var(--dsw-alias-bg-layer-2)'].concat(scheme === 'light' ? ['var(--dsw-alias-bg-module-platform)'] : [])) {
        atLeast('badge ' + id + ' (' + scheme + ' on ' + layer.slice(18, -1) + ')', contrast(ink, colour(tint, scheme), colour(layer, scheme)), 4.5)
      }
    }
  }
})
ok('the icons of the artifact menu and of the new-chat tiles read 3:1 in both schemes (A1-11)', () => {
  const file = 'kybernos-plugin/client.js'
  const src = srcOf(file)
  const cat = [...src.matchAll(/\{ type: '([a-z]+)', label: [^\n]*?color: '(#[0-9a-f]{6})', tint: '(rgba\([^']+\))'(?:, ink: '(#[0-9a-f]{6})')?/g)]
  assert.ok(cat.length >= 5, 'the artifact catalogue is found (' + cat.length + ')')
  const kasBase = rule(file, '.kas-icon'), kasLight = rule(file, 'body:not([data-ds-dark-theme]) .kas-icon')
  assert.equal(lastDecl(kasBase.body, 'color'), 'var(--kas-ink)')
  for (const [, id, color, tint, ink] of cat) {
    for (const [scheme, css] of [['light', kasLight], ['dark', kasBase]]) {
      atLeast('menu icon ' + id + ' (' + scheme + ')', contrast(colour(lastDecl(css.body, 'color'), scheme, { '--kas-ink': ink || color }), colour(tint, scheme), colour('var(--dsw-alias-bg-layer-2)', scheme)), 3)
    }
  }
  const hues = /const KB_NC_HUES = \{([^}]+)\}/.exec(src)[1].matchAll(/([a-z]+): '(#[0-9a-f]{6})'/g)
  const nc = rule(file, '.kb8-nc-ico')
  assert.match(lastDecl(nc.body, 'color'), /--kb8-ink/, 'the tile icon is drawn from the hue through a mix, not the raw hue')
  for (const [, id, hue] of hues) {
    for (const scheme of ['light', 'dark']) {
      const tint = [parseInt(hue.slice(1, 3), 16), parseInt(hue.slice(3, 5), 16), parseInt(hue.slice(5, 7), 16), 0.16]
      atLeast('new-chat icon ' + id + ' (' + scheme + ')', contrast(colour(lastDecl(nc.body, 'color'), scheme, { '--kb8-ink': hue }), tint, colour('var(--dsw-alias-bg-layer-1)', scheme)), 3)
    }
  }
})


// A1-05: the plugin pages write their sentences in label-tertiary, #81858c, 3.7:1 on white. Inside each page's own root the light schemes read the token as label-secondary
// (the dark scheme keeps its hierarchy). The root list is the page, and its popover where it has one; DSH's own shell is outside every root.
const PAGE_ROOTS = [
  ['kybernos-auto/client.js', ':is(.kaa-page,.kaa-pop)'],
  ['kybernos-usage/client.js', '.kbus-page'],
  ['kybernos-workers/client.js', '.kbwk'],
  ['kybernos-maintenance/client.js', '.kbmz-page'],
  ['kybernos-websearch/client.js', '.kwse-page'],
  ['kybernos-hub/client.js', ':is(.kbsu,.kbhp-pop)'],
  ['kybernos-free-llms/client.js', '.kfl-root'],
  ['kybernos-modeles-locaux/client.js', '.kml-root'],
  ['kybernos-computers/client.js', ':is(.kcc-root,.kbenv-root,.kbenv-menu)'],
  ['kybernos-cloud/client.js', ':is(.kbf-root,.kbfp-menu,.kbfp-sub,.kbf-pop,.kbf-poptitle,.kbl-page)'],
  ['kybernos-models/client.js', '.kbm-root.kbmp'],
  ['kybernos-plugin/client.js', ':is(.kbt2-sec,.kba-onboard,.kbv-pop,.kb4-pick)'],
  ['kybernos-skills/client.js', '.kbs-root'],
  ['kybernos-composio/client.js', '.kb7-root'],
]
ok('every plugin page lifts label-tertiary to label-secondary inside its own root in the light schemes, which is 4.5:1 on every layer (A1-05)', () => {
  for (const [file, roots] of PAGE_ROOTS) {
    const r = rule(file, 'body:not([data-ds-dark-theme]) ' + roots)
    assert.equal(lastDecl(r.body, '--dsw-alias-label-tertiary'), 'var(--dsw-alias-label-secondary)', file)
    const lifted = { '--dsw-alias-label-tertiary': 'var(--dsw-alias-label-secondary)' }
    for (const layer of ['var(--dsw-alias-bg-layer-1)', 'var(--dsw-alias-bg-layer-2)', 'var(--dsw-alias-bg-module-platform)', 'color-mix(in srgb, var(--dsw-alias-label-primary) 6%, var(--dsw-alias-bg-layer-1))']) {
      atLeast(file + ' on ' + layer.slice(0, 40), contrast(colour('var(--dsw-alias-label-tertiary)', 'light', lifted), colour(layer, 'light')), 4.5)
    }
  }
})
ok('the Slash palette (and the pages that read it, Memory among them) has its muted inks at label-secondary in the light schemes (A1-05)', () => {
  const r = rule('kybernos-slash/client.js', 'body:not([data-ds-dark-theme])')
  for (const v of ['--kb-muted', '--kb-caption']) {
    assert.match(lastDecl(r.body, v), /label-secondary/, v)
    atLeast(v + ' on white', contrast(colour(lastDecl(r.body, v), 'light'), colour('var(--dsw-alias-bg-layer-1)', 'light')), 4.5)
  }
})
ok('the Settings nav group headers (ours: the core plugin writes them into DSH\'s nav) are 4.5:1 in the light schemes (A1-05, A1-12)', () => {
  const r = rule('kybernos-plugin/client.js', 'body:not([data-ds-dark-theme]) [class*="navList"] [data-kb="settings-group"]')
  atLeast('group header', contrast(colour(lastDecl(r.body, 'color'), 'light'), colour('var(--dsw-alias-bg-layer-1)', 'light')), 4.5)
})
ok('placeholders are not the label-dimmed token (1.3:1) or the browser default (3:1 on the dark inputs): tertiary, and secondary in the light schemes (A1-05)', () => {
  const none = (file, sel) => assert.ok(!multiRules(file).some((x) => x.selector === sel && /label-dimmed/.test(x.body)), file + ' ' + sel + ' still uses label-dimmed')
  none('kybernos-modeles-locaux/client.js', '.kml-root .kbm-in-input::placeholder')
  for (const [file, sel, lightSel] of [
    ['kybernos-composio/client.js', '.kbcp-input::placeholder', 'body:not([data-ds-dark-theme]) .kbcp-input::placeholder'],
    ['kybernos-computers/client.js', '.kcc-input::placeholder', null],
    ['kybernos-multi-device/client.js', '.kbmd-input::placeholder', 'body:not([data-ds-dark-theme]) .kbmd-input::placeholder'],
    ['kybernos-cloud/client.js', '.kbl-area::placeholder', null],
    ['kybernos-modeles-locaux/client.js', '.kml-root .kbm-in-input::placeholder', null],
    ['kybernos-plugin/client.js', '.kbs-search input::placeholder', 'body:not([data-ds-dark-theme]) .kbs-search input::placeholder'],
  ]) {
    const r = rule(file, sel)
    assert.match(lastDecl(r.body, 'color'), /label-tertiary/, file + ' ' + sel)
    atLeast(sel + ' (dark)', contrast(colour(lastDecl(r.body, 'color'), 'dark'), colour('var(--dsw-alias-bg-layer-2)', 'dark')), 4.5)
    // the light value: its own rule, or the page root's lift of the token (the roots above)
    const light = lightSel === null ? colour('var(--dsw-alias-label-secondary)', 'light') : colour(lastDecl(rule(file, lightSel).body, 'color'), 'light')
    atLeast(sel + ' (light)', contrast(light, colour('var(--dsw-alias-bg-layer-1)', 'light')), 4.5)
  }
})

// A1-11: the tags and pills write their state in a pale ink (2.1:1 on the pale tint in the light schemes); there the ink is the state colour pulled toward the text colour.
ok('the tags and pills are 4.5:1 on their tint in the light schemes, and unchanged in the dark one (A1-11)', () => {
  // [file, rule of the light ink, the tint it sits on, behind]
  const tint = (state, pct) => 'color-mix(in srgb, var(--dsw-alias-state-' + state + '-primary) ' + pct + '%, transparent)'
  const cases = [
    ['kybernos-modeles-locaux/client.js', "body:not([data-ds-dark-theme]) .kbm-tag[data-tone='success']", tint('success', 10)],
    ['kybernos-modeles-locaux/client.js', "body:not([data-ds-dark-theme]) .kbm-tag[data-tone='warning']", tint('warn', 12)],
    ['kybernos-modeles-locaux/client.js', "body:not([data-ds-dark-theme]) .kbm-tag[data-tone='danger']", tint('error', 10)],
    ['kybernos-free-llms/client.js', "body:not([data-ds-dark-theme]) .kbm-tag[data-tone='success']", tint('success', 10)],
    ['kybernos-free-llms/client.js', "body:not([data-ds-dark-theme]) .kbm-tag[data-tone='warning']", tint('warn', 12)],
    ['kybernos-skills/client.js', 'body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.ok', 'var(--dsw-alias-bg-layer-2)'],
    ['kybernos-skills/client.js', 'body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.warn', 'var(--dsw-alias-bg-layer-2)'],
    ['kybernos-skills/client.js', 'body:not([data-ds-dark-theme]) .kbs-root .kbsf-pill.need', 'var(--dsw-alias-bg-layer-2)'],
    ['kybernos-plugin/client.js', 'body:not([data-ds-dark-theme]) .kb7-pill', 'var(--dsw-alias-state-success-tertiary, rgba(34,197,94,.16))'],
    ['kybernos-plugin/client.js', 'body:not([data-ds-dark-theme]) .kb7-pill.pend', 'var(--dsw-alias-state-warn-tertiary, rgba(250,180,60,.16))'],
    ['kybernos-composio/client.js', 'body:not([data-ds-dark-theme]) .kb7-pill', 'rgba(34,197,94,.15)'],
    ['kybernos-composio/client.js', 'body:not([data-ds-dark-theme]) .kb7-pill.pend', 'rgba(250,204,21,.15)'],
  ]
  for (const [file, sel, bg] of cases) {
    const r = rule(file, sel)
    atLeast(file.split('/')[0] + ' ' + sel.replace('body:not([data-ds-dark-theme]) ', ''), contrast(colour(lastDecl(r.body, 'color'), 'light'), colour(bg, 'light'), colour('var(--dsw-alias-bg-layer-1)', 'light')), 4.5)
  }
})
ok('the Skills count badges and author avatars keep 4.5:1 (A1-11)', () => {
  const css = srcOf('kybernos-skills/client.js')
  const opacity = Number(/\.kbs-root \.kbsub \.count\{[^}]*opacity:([\d.]+)/.exec(css)[1])
  const ink = colour('var(--dsw-alias-label-secondary)', 'light')
  for (const layer of ['var(--dsw-alias-bg-layer-1)', 'var(--dsw-alias-bg-module-platform)', '#f5f5f5']) atLeast('count badge on ' + layer, contrast([ink[0], ink[1], ink[2], opacity], colour(layer, 'light')), 4.5)
  // an avatar is white 9px text on hsl(<hue> 45% L%): the worst hue decides
  const L = Number(/'hsl\(' \+ hue\(owner\) \+ ' 45% (\d+)%\)'/.exec(css)[1])
  const hsl = (h) => { const s = 0.45, l = L / 100, a = s * Math.min(l, 1 - l); const k = (n) => (n + h / 30) % 12; const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255, 1] }
  let worst = 99
  for (let h = 0; h < 360; h += 1) worst = Math.min(worst, contrast([255, 255, 255, 1], hsl(h)))
  atLeast('avatar initials (worst hue)', worst, 4.5)
})
ok('the Composio logo mark and the three panels\' play buttons keep their ink 4.5:1 on their fill (A1-11, A4-24)', () => {
  const logo = rule('kybernos-composio/client.js', '.kbcp-logo')
  const stops = [...lastDecl(logo.body, 'background').matchAll(/#[0-9a-f]{6}/gi)].map((m) => m[0])
  assert.ok(stops.length >= 2)
  for (const stop of stops) atLeast('logo on ' + stop, contrast(colour(lastDecl(logo.body, 'color'), 'light'), colour(stop, 'light')), 4.5)
  for (const [file, sel] of [['kybernos-slides/client.js', '.kbsd-play'], ['kybernos-bricks/client.js', '.kbb-play'], ['kybernos-modeleur/client.js', '.kbm-play'], ['kybernos-bricks/client.js', '.kbb-badge.run'], ['kybernos-modeleur/client.js', '.kbm-badge.run']]) {
    const r = rule(file, sel)
    atLeast(sel, contrast(colour(lastDecl(r.body, 'color'), 'light'), colour(lastDecl(r.body, 'background'), 'light')), 4.5)
    if (sel.endsWith('-play')) { const h = rule(file, sel + ':hover'); atLeast(sel + ':hover', contrast(colour(lastDecl(r.body, 'color'), 'light'), colour(lastDecl(h.body, 'background'), 'light')), 4.5) }
  }
  const prim = rule('kybernos-composio/client.js', '.kbcp-btn.primary:hover')
  assert.match(lastDecl(prim.body, 'filter'), /brightness\(\.\d+\)/, 'the primary button darkens on hover: white on the lightened #635bff was 3.65:1')
})


ok('the Slash accent (the link blue) is 4.5:1 where it writes text in the light schemes, and the Suite chips, the Free LLMs lock note and the Composio cards dim nothing as a whole (A1-05, A1-11)', () => {
  const r = rule('kybernos-slash/client.js', 'body:not([data-ds-dark-theme])')
  atLeast('--kb-accent on the menu surface', contrast(colour(lastDecl(r.body, '--kb-accent'), 'light'), colour('var(--dsw-alias-bg-layer-2)', 'light')), 4.5)
  for (const state of ['ok', 'warn']) {
    const chip = rule('kybernos-hub/client.js', 'body:not([data-ds-dark-theme]) .kbsu-chip.' + state)
    const tint = 'color-mix(in srgb, var(--dsw-alias-state-' + (state === 'ok' ? 'success' : 'warn') + '-primary) 16%, transparent)'
    atLeast('Suite chip ' + state, contrast(colour(lastDecl(chip.body, 'color'), 'light'), colour(tint, 'light'), colour('var(--dsw-alias-bg-layer-1)', 'light')), 4.5)
  }
  const locked = rule('kybernos-free-llms/client.js', '.kfl-locked')
  for (const scheme of ['light', 'dark']) atLeast('.kfl-locked (' + scheme + ')', contrast(colour(lastDecl(locked.body, 'color'), scheme), colour('var(--dsw-alias-bg-layer-2)', scheme)), 4.5)
  assert.ok(!multiRules('kybernos-composio/client.js').some((x) => x.selector === '.kbcp-pv.off' && /opacity/.test(x.body)), 'the card of the provider that is not selected is not dimmed (opacity .85 made its button 3.7:1 and its pill 4.4:1)')
})

ok('the Composio help text and its link keep 4.5:1 under the help block\'s opacity (A1-05)', () => {
  const opacity = Number(/opacity:\s*([\d.]+)/.exec(rule('kybernos-composio/client.js', '.kbcp-help').body)[1])
  const ink = colour(lastDecl(rule('kybernos-composio/client.js', '.kbcp-help a').body, 'color'), 'light')
  for (const layer of ['var(--dsw-alias-bg-layer-1)', 'var(--dsw-alias-bg-module-platform)', '#f5f5f5']) atLeast('help link on ' + layer, contrast([ink[0], ink[1], ink[2], opacity], colour(layer, 'light')), 4.5)
})


ok('the empty description of a compact card and the Skills source icon are readable in the light schemes (A1-05)', () => {
  const none = rule('kybernos-plugin/client.js', 'body:not([data-ds-dark-theme]) .kb8-cmp .kb8-desc.kb8-none')
  atLeast('no-description line', contrast(colour(lastDecl(none.body, 'color'), 'light'), colour('var(--dsw-alias-bg-layer-1)', 'light')), 4.5)
  for (const sel of ['.kbs-root .kbs-srcline svg', '.kbss-page .kbss-srcline svg']) {
    const r = rule('kybernos-skills/client.js', sel)
    atLeast(sel + ' (icon, 3:1)', contrast(colour(lastDecl(r.body, 'color'), 'light'), colour('var(--dsw-alias-bg-layer-1)', 'light')), 3)
  }
})

console.log('\n' + count + ' tests passed')
if (failed.length > 0) process.exit(1)
