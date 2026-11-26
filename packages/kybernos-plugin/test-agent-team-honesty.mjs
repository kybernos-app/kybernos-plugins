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
import { entry, hasEntry } from './lib-i18n-test.mjs'

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

// ── « Delete this Agent Team » (AGT-14, built 2026-11-08): it works for a team of the person's own DSH home and, everywhere else, it is off AND says why in a sentence on the page ──
// (it was a disabled button with a hover title « Not available yet »: invisible on a phone, and a person could not remove an installed team at all)
{
  const a = src.indexOf("return h('div', { style: card },\n          h('span', { className: 'kb8-name' }, kbt('kbui.dangerzone'))")
  const b = src.indexOf('\n      })()', a)
  assert.ok(a > 0 && b > a, 'found the danger zone of the Agent Team page')
  const dict = (key, lang) => {
    assert.ok(hasEntry(key), key + ' exists in both languages')
    return entry(key)[lang === 'fr' ? 'kybernos' : 'en']
  }
  const { createLite } = await import('./lib-lite-react-test.mjs')
  const lite = createLite()
  const asked = []
  const zone = (protectedTeam, canDelete, delErr) => lite.mount(new Function('h', 'card', 'kbt', 'draft', 'protectedTeam', 'canDelete', 'delErr', 'setDelAsk', 'setDelErr', src.slice(a, b))(
    lite.React.createElement, {}, (k) => dict(k, 'en'), { name: 'Research Desk' }, protectedTeam, canDelete, delErr, (v) => { asked.push(v) }, () => {}))
  const cases = [
    { name: 'a team of the DSH home', protectedTeam: false, canDelete: true, sentence: /moved to « agent-teams-trash »[^]*nothing is erased/, can: true },
    { name: 'a team of a project folder', protectedTeam: false, canDelete: false, sentence: /lives in a project folder/, can: false },
    { name: 'the Digital Clone', protectedTeam: true, canDelete: false, sentence: /Digital Clone/, can: false },
  ]
  for (const c of cases) {
    asked.length = 0
    const root = zone(c.protectedTeam, c.canDelete, '')
    const buttons = lite.find(root.tree, (n) => n.tag === 'button')
    assert.equal(buttons.length, 1, c.name + ': one button in the danger zone')
    const btn = buttons[0]
    assert.equal(lite.textOf(btn), 'Delete this AI Agent Team', c.name + ': it keeps its name')
    assert.equal(btn.props.disabled, !c.can, c.name + ': the button is ' + (c.can ? 'enabled' : 'disabled'))
    assert.equal(btn.props.title, undefined, c.name + ': the reason is not a tooltip (a phone has none)')
    const said = lite.textOf(root.tree)
    assert.match(said, c.sentence, c.name + ': a sentence ON THE PAGE says what the button does, or why it is off')
    assert.ok(!/will be removed with its chats|sera supprimé avec/.test(said), c.name + ': nothing promises an erasure that does not happen')
    if (typeof btn.props.onClick === 'function') btn.props.onClick({})
    assert.deepEqual(asked, c.can ? [true] : [], c.name + ': a click ' + (c.can ? 'opens the confirmation' : '(a script can click a disabled button) does nothing'))
  }
  const failed = zone(false, true, 'Delete this AI Agent Team — disk full')
  assert.match(lite.textOf(failed.tree), /disk full/, 'a failure of the host is written on the page')
  assert.ok(lite.find(failed.tree, (n) => n.props !== null && n.props !== undefined && n.props.role === 'alert').length === 1, 'and announced to a screen reader')
  assert.ok(!/kbui\.delete\.soon/.test(src) && entry('kbui.delete.soon') === null, 'the « Not available yet » string is gone, nothing asks for it (nor does the dictionary hold it)')
  for (const k of ['kbui.delete.what', 'kbui.delete.project', 'kbui.delete.confirm.title', 'kbui.delete.confirm.body']) { dict(k, 'en'); dict(k, 'fr') }
  assert.ok(/tu peux le remettre en place à la main/.test(dict('kbui.delete.what', 'fr')) && /put it back by hand/.test(dict('kbui.delete.what', 'en')), 'the sentence says it can be put back, in both languages')
  console.log('  ✓ « Delete this AI Agent Team »: on for an installed team (confirmation first), off with a visible sentence for a project team and the Digital Clone, errors written on the page')
}

// ── The template preview does not claim anything about a model the person never chose, and the marketplace says things once (N3/N4, 2026-11-08) ──
{
  assert.ok(/'role-model-yours'/.test(src) && /kbt\('kbui\.crew\.usesyours'\)/.test(src), 'a role with no model declared reads « Uses the model you choose » (it used to read « ? absent from your settings, no fallback »)')
  const row = src.slice(src.indexOf("'data-kb': 'role-model-yours'") - 400, src.indexOf("'data-kb': 'role-model-yours'") + 900)
  assert.ok(/flexWrap: 'wrap'/.test(row) && /maxWidth: '100%'/.test(row), 'and the chip of a role that has one wraps instead of running off the right edge')
  assert.ok(/'kbui\.market\.cloud\.below'/.test(src) && /marketReason\(marketCloud\) !== '' \? 'kbui\.market\.cloud\.below' : 'kbui\.market\.cloud\.none'/.test(src), 'the second marketplace line never contradicts the first (« catalogue is empty » then « did not answer »)')
  assert.ok(/data-kb': 'market-help-sub'/.test(src) && /data-kb': 'market-sub'/.test(src), 'the long « Two sources… » explainer is in the « ? » panel as well as on the page (the phone layer shows only the « ? »)')
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'kybernos-mobile', 'mobile.css'), 'utf8')
  assert.ok(/\[data-kb="market-sub"\]/.test(css) && /\[data-kb="market-help-sub"\]\[hidden\]/.test(css), 'the phone layer hides the page copy and shows the « ? » copy')
  console.log('  ✓ template preview: no « absent from your settings » claim, chip wraps; marketplace: one honest line, the explainer lives behind the « ? »')
}

// ── What the page says about a team it just wrote, and the button that cannot be undone (recette 2026-11-08 retest) ──
{
  assert.ok(/res\.rootId === 'installed' \? kbe\(' — the copy is in your own folder\.'\) : kbe\(' — the copy lands in the workspace root \(host limitation\)\.'\)/.test(src), 'the clone toast says where the copy went (the route answers `rootId`): a phone does not hear « workspace root »')
  assert.ok(/' — la copie est dans ton propre dossier\.': ' — the copy is in your own folder\.'/.test(src), 'and the new sentence has its French')
  assert.ok(/\.kb-task-confirm \.kb-task-btn\.danger\{border-color:var\(--dsw-alias-state-error-primary\);color:var\(--dsw-alias-state-error-primary\)/.test(src), 'the confirmation button is red at rest, not only on hover (a phone has no hover)')
  console.log('  ✓ clone toast names the real place; the destructive confirmation button is red at rest')
}

// ── The workflow of a team is drawn by the shared canvas, so its steps follow the theme like every other graph (2026-11-04) ──
// It used to be a vendored React Flow with fixed dark hex colours under a fixed light ink (« mixed theme », L1-80): the steps are now KbFlowCanvas cards, whose colours are tokens with a dark twin.
{
  assert.ok(!/\.kb2-node\b|\.kb2-nsub\b|react-flow|xyflow/.test(src), 'the fixed-colour step styles and the vendored React Flow are gone')
  const pane = src.slice(src.indexOf('const wfPickPair = React.useState(null)'))
  assert.ok(/h\(KbFlowCanvas, \{\s+nodes: kbWfCards\(graphe\)/.test(pane), 'the Workflow tab draws its steps with the shared canvas')
  console.log('  ✓ a workflow step is a card of the shared canvas: no fixed colour, no second graph library')
}
console.log('\n7 checks passed')
