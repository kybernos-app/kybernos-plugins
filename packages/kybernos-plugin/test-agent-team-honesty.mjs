#!/usr/bin/env node
/** The Agent Team pages say only what they do (T2-17, T2-18, T2-19, 2026-10-24). Source-level: the page is checked on the real GUI (docs/dev/live-testing.md).
 *   - the designer's « Mockup · model info as Tooltip / Side panel » toggle is gone from the live Roles tab (it was a dashed box with hard-coded hex colours, and its choice was lost on reopening);
 *   - the marketplace preview (read-only) draws neither the « Model management » bar of pills that do nothing nor the inert « + Add a role » chip;
 *   - the Roles tab says "Declared … Today the model written for each role is the one that runs" for the automatic and per-role modes, whose routing the host does not do.
 *  Usage: node packages/kybernos-plugin/test-agent-team-honesty.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.js'), 'utf8')
const nocomment = src.replace(/^\s*\/\/.*$/gm, '')

assert.ok(!/Mockup · model info as/.test(src), 'the Mockup toggle is gone')
assert.ok(!/kbuiVariant|setKbuiVariant|pickVariant|setVariantFn/.test(src), 'and so is its plumbing (state, props, the setter)')
console.log('  ✓ no « Mockup · model info as » toggle, no dead variant plumbing')

assert.match(nocomment, /\(editable === true \? mmBar : null\)/, 'the model-management bar needs editable')
const addRole = nocomment.indexOf("kbt('kbui.crew.addrole.soon')")
assert.ok(addRole > 0 && /\(editable === true \? h\('span', \{ title: kbt\('kbui\.crew\.addrole\.soon'\)/.test(nocomment), 'the add-role chip needs editable')
console.log('  ✓ the marketplace preview (read-only) draws neither the model-management bar nor the add-role chip')

const m = /const modeSummary = \(prefsMode === 'auto'\)\s*\? '([^']*)'\s*: \(\(prefsMode === 'per-role'\)\s*\? '([^']*)'/.exec(src)
assert.ok(m !== null, 'modeSummary exists')
for (const [mode, text] of [['auto', m[1]], ['per-role', m[2]]]) {
  assert.match(text, /^Declared:/, mode + ': says it is declared')
  assert.match(text, /Today the model written for each role is the one that runs\.$/, mode + ': says what runs today')
}
console.log('  ✓ the automatic and per-role summaries say they are declared and what runs today')

// ── « Delete this Agent Team » deletes nothing (L1-81, AGT-14 is NOT_BUILT, 2026-10-25): the button is off, says so, and nothing above it promises the removal ──
{
  const a = src.indexOf("return h('div', { style: card },\n          h('span', { className: 'kb8-name' }, kbt('kbui.dangerzone'))")
  const b = src.indexOf('\n      })()', a)
  assert.ok(a > 0 && b > a, 'found the danger zone of the Agent Team page')
  const dict = (key, lang) => {
    const e = new RegExp("'" + key.replace(/\./g, '\\.') + "': \\{ kybernos: '((?:[^'\\\\]|\\\\.)*)', en: '((?:[^'\\\\]|\\\\.)*)' \\}").exec(src)
    assert.ok(e !== null, key + ' exists in both languages')
    return e[lang === 'fr' ? 1 : 2].replace(/\\'/g, '\'')
  }
  const { createLite } = await import('./lib-lite-react-test.mjs')
  const lite = createLite()
  let navigated = 0
  const zone = (protectedTeam) => lite.mount(new Function('h', 'card', 'kbt', 'draft', 'protectedTeam', 'set', src.slice(a, b))(
    // (`kbui.frag.removed` is the sentence the page used to show; it is gone from the dictionary, so a page that still asks for it gets the old words and fails below)
    lite.React.createElement, {}, (k) => (k === 'kbui.frag.removed' ? ' will be removed with its chats, memory and creations.' : dict(k, 'en')), { name: 'Research Desk' }, protectedTeam, () => { navigated += 1 }))
  for (const protectedTeam of [false, true]) {
    const root = zone(protectedTeam)
    const buttons = lite.find(root.tree, (n) => n.tag === 'button')
    assert.equal(buttons.length, 1, 'one button in the danger zone')
    const btn = buttons[0]
    assert.equal(lite.textOf(btn), 'Delete this Agent Team', 'it keeps its name')
    assert.equal(btn.props.disabled, true, (protectedTeam ? 'the Digital Clone: ' : 'any team: ') + 'the button is disabled, whatever the team')
    assert.equal(btn.props.title, 'Not available yet', 'with a short reason for the pointer and the screen reader')
    if (typeof btn.props.onClick === 'function') btn.props.onClick({})
    assert.equal(navigated, 0, 'and a click (a script can still click a disabled button) does not take the person anywhere as if it had worked')
    const said = lite.textOf(root.tree)
    assert.ok(!/will be removed|sera supprimé/.test(said), 'nothing above it promises that the team « will be removed with its chats, memory and creations »')
    assert.equal(/Digital Clone/.test(said), protectedTeam, 'the Digital Clone keeps its own sentence (it cannot be deleted, which is true)')
  }
  assert.equal(dict('kbui.delete.soon', 'en'), 'Not available yet')
  assert.equal(dict('kbui.delete.soon', 'fr'), 'Pas encore disponible')
  console.log('  ✓ « Delete this Agent Team » is disabled with « Not available yet » and the page no longer promises the removal')
}

// ── The workflow step names can be read in both themes (L1-80, 2026-10-25): the ink of a step is a fixed light beige, so its background is fixed and dark ──
{
  const rule = (sel) => { const m = new RegExp("'" + sel.replace(/[.]/g, '\\.') + '\\{([^}]*)\\}\'').exec(src); assert.ok(m !== null, sel + ' exists'); return m[1] }
  const prop = (body, name) => { const m = new RegExp('(?:^|;)' + name + ':([^;]+)').exec(body); return m === null ? null : m[1].trim() }
  const lum = (hex) => { const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2] }
  const ratio = (x, y) => { const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05) }
  const node = rule('.kb2-node')
  const bg = prop(node, 'background')
  assert.match(bg, /^#[0-9A-Fa-f]{6}$/, 'the step background is a fixed colour, not a theme token (a light theme turned it white under a beige ink): ' + bg)
  const ink = prop(node, 'color')
  assert.match(ink, /^#[0-9A-Fa-f]{6}$/)
  const sub = prop(rule('.kb2-nsub'), 'color')
  assert.match(sub, /^#[0-9A-Fa-f]{6}$/)
  assert.ok(ratio(ink, bg) >= 4.5, 'the step name reads at ' + ratio(ink, bg).toFixed(2) + ':1 (4.5 needed)')
  assert.ok(ratio(sub, bg) >= 4.5, 'the step subtitle reads at ' + ratio(sub, bg).toFixed(2) + ':1 (4.5 needed)')
  console.log('  ✓ a workflow step is dark under its light ink in every theme (name ' + ratio(ink, bg).toFixed(1) + ':1, subtitle ' + ratio(sub, bg).toFixed(1) + ':1)')
}
console.log('\n5 checks passed')
