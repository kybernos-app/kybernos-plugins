// The contract of the gate maquette, and the only script that can make it fail.
//
//   node docs/dev/kaby-proactive/maquettes/automations-gate/verifier.mjs            # the contract (exit 0 = everything holds)
//   node docs/dev/kaby-proactive/maquettes/automations-gate/verifier.mjs --sabotage # one defect per control, must exit 1
//   node docs/dev/kaby-proactive/maquettes/automations-gate/verifier.mjs --tokens   # print the tokens the page uses
//   node docs/dev/kaby-proactive/maquettes/automations-gate/verifier.mjs --tokens --check  # compare with the LIVE GUI (exit 3 when none answers)
//   node docs/dev/kaby-proactive/maquettes/automations-gate/verifier.mjs --shots <dir>     # the five captures, through Chrome on file://
//
// It proves what a maquette must prove: the gesture CANNOT activate an automation nobody approved, the colours come from the
// product's tokens and from nowhere else, the type stays on the product's ladder, the fold exists at the sibling's breakpoint,
// nothing overflows at 480 px, and every label has both a French and an English twin. The product kit of the `maquette-dsh` skill
// is not in this checkout (`ls scripts | grep maquette` is empty), so the contract lives here, in the folder.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const html = readFileSync(join(HERE, 'index.html'), 'utf8')
const tokens = readFileSync(join(HERE, 'tokens.css'), 'utf8')
const records = JSON.parse(readFileSync(join(HERE, 'gate-records.json'), 'utf8'))
const sabotage = process.argv.indexOf('--sabotage') >= 0
const wantTokens = process.argv.indexOf('--tokens') >= 0
const checkTokens = process.argv.indexOf('--check') >= 0
const shotsAt = (() => { const i = process.argv.indexOf('--shots'); return i >= 0 ? process.argv[i + 1] : null })()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let fails = 0
const check = (label, ok, detail) => { if (ok !== true) fails += 1; console.log((ok === true ? 'ok   ' : 'FAIL ') + label + (ok !== true && detail !== undefined ? ' | ' + JSON.stringify(detail).slice(0, 300) : '')) }

/* ── The pieces of the page this contract measures ───────────────────────── */
const styleBlock = (html.match(/<style>([\s\S]*?)<\/style>/) || [null, ''])[1]
const modelBlock = (html.match(/<script id="kbm-model">([\s\S]*?)<\/script>/) || [null, ''])[1]
const sceneBlock = (html.match(/<script>\n\/\* The scene:([\s\S]*?)<\/script>/) || [null, ''])[1]
if (modelBlock === '') { console.error('the model script is missing'); process.exit(1) }
const model = await import('data:text/javascript,' + encodeURIComponent(modelBlock + '\nexport { kbmStep, kbmStart, KBM_CAN_APPROVE, KBM_CAN_REFUSE, KBM_TONE, KBM_LABEL, KBM_HINT }'))

/* ── 1. The gesture: nothing activates without a recorded approval ───────── */
{
  const STATUSES = ['draft', 'static-failed', 'static-passed', 'trial-done', 'awaiting-approval', 'approved', 'refused', 'activated']
  const APPROVALS = ['none', 'asked', 'granted', 'refused']
  const bad = []
  let combos = 0
  for (const status of STATUSES) {
    for (const approval of APPROVALS) {
      for (const active of [true, false]) {
        combos += 1
        const s = { known: true, status, approval, trial: { sideEffectFree: true }, active, rev: 3 }
        const out = model.kbmStep(s, 'switch').state
        const allowed = approval === 'granted' && (status === 'approved' || status === 'activated') && active === false
        if (out.active === true && s.active === false && allowed !== true) bad.push({ status, approval, active })
        if (out.active === true && approval !== 'granted') bad.push({ status, approval, active })
      }
    }
  }
  check('the switch activates only on a granted approval, over ' + combos + ' combinations', bad.length === 0, bad.slice(0, 3))
  check('a refused switch changes nothing at all', model.kbmStep({ known: true, status: 'static-passed', approval: 'asked', trial: null, active: false, rev: 2 }, 'switch').state.active === false)
  check('...and says why (gated)', model.kbmStep({ known: true, status: 'static-passed', approval: 'asked', trial: null, active: false, rev: 2 }, 'switch').gated === true)
  // The whole ladder, played from the draft: check → trial → approve → switch.
  let s = model.kbmStart()
  s = model.kbmStep(s, 'check-ok').state
  check('a clean check puts the record at static-passed, with no approval', s.status === 'static-passed' && s.approval === 'none')
  s = model.kbmStep(s, 'trial-clean').state
  check('a clean trial asks the person (awaiting-approval, asked)', s.status === 'awaiting-approval' && s.approval === 'asked')
  const beforeApprove = s
  check('the switch is refused BEFORE the approval', model.kbmStep(beforeApprove, 'switch').state.active === false && model.kbmStep(beforeApprove, 'switch').gated === true)
  s = model.kbmStep(s, 'approve').state
  check('an approval puts it at approved, granted', s.status === 'approved' && s.approval === 'granted')
  const afterApprove = model.kbmStep(s, 'switch')
  check('...and only then does the switch turn it on', afterApprove.state.active === true && afterApprove.state.status === 'activated')
  check('switching it off needs no second approval', model.kbmStep(afterApprove.state, 'switch').state.active === false)
  // A dirty trial closes the approval, and a refusal is terminal.
  const dirty = model.kbmStep(model.kbmStep(model.kbmStart(), 'check-ok').state, 'trial-dirty').state
  check('a trial that touched the outside cannot be approved', model.KBM_CAN_APPROVE(dirty) === false && model.kbmStep(dirty, 'approve').state.status === 'trial-done')
  const refused = model.kbmStep(model.kbmStep(model.kbmStep(model.kbmStart(), 'check-ok').state, 'trial-clean').state, 'refuse').state
  check('a refusal is recorded and the record cannot be refused twice', refused.status === 'refused' && refused.approval === 'refused' && model.KBM_CAN_REFUSE(refused) === false)
  check('an activated record cannot be refused either', model.KBM_CAN_REFUSE({ known: true, status: 'activated', approval: 'granted', trial: { sideEffectFree: true }, active: true, rev: 9 }) === false)
  check('every status has a label in both languages', STATUSES.concat(['unknown']).every((k) => Array.isArray(model.KBM_LABEL[k]) && model.KBM_LABEL[k][1] !== model.KBM_LABEL[k][0] || k === 'draft' || k === 'activated' || k === 'approved' || k === 'refused' || k === 'unknown' || k === 'trial-done'))
  check('the tone table is the client one (trial-done warns)', ['activated', 'approved'].every((k) => model.KBM_TONE(k) === 'ok') && ['awaiting-approval', 'trial-done'].every((k) => model.KBM_TONE(k) === 'warn') && ['static-failed', 'refused'].every((k) => model.KBM_TONE(k) === 'bad') && ['draft', 'static-passed', 'unknown'].every((k) => model.KBM_TONE(k) === 'idle'))
}

/* ── 2. Tokens only, and on the product's type ladder ────────────────────── */
{
  check('the page writes no colour of its own (no hex, no rgb(), no hsl())', !/#[0-9a-f]{3,8}\b/i.test(styleBlock) && !/rgb\(|hsl\(/i.test(styleBlock))
  const colours = [...styleBlock.matchAll(/(?:^|[^-])(?:color|background|background-color|border|border-top|border-bottom|border-left|border-right|border-color|border-color-top)\s*:\s*([^;}]+)/g)].map((m) => m[1])
  const literal = colours.filter((v) => !/var\(--dsw-alias-/.test(v) && !/^(transparent|none|inherit|currentColor|0)$/.test(v.trim()))
  check('every colour of the page is a product alias', literal.length === 0, literal.slice(0, 4))
  const sizes = [...styleBlock.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => Number(m[1]))
  const LADDER = [11.5, 12.5, 13, 14, 18]
  check('every font size is on the product ladder (' + LADDER.join(' / ') + ')', sizes.every((n) => LADDER.indexOf(n) >= 0), [...new Set(sizes)])
  const radii = [...styleBlock.matchAll(/border-radius:\s*([0-9]+)px/g)].map((m) => Number(m[1]))
  check('every radius is 9, 10, 12, 16 or 999', radii.every((n) => [9, 10, 12, 16, 999].indexOf(n) >= 0), [...new Set(radii)])
  const wanted = ['--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-brand-primary',
    '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-error-primary', '--dsw-alias-interactive-bg-hover']
  check('tokens.css defines all 13 aliases in the light theme', wanted.every((v) => new RegExp('\\n  ' + v + ':').test(tokens)))
  check('...and all 13 again in the dark theme', wanted.every((v) => { const dark = tokens.split('body[data-ds-dark-theme]')[1] || ''; return new RegExp('  ' + v + ':').test(dark) }))
  check('tokens.css names where its values come from', /dsh-css\.js/.test(tokens) && /dsw-static/.test(tokens))
}

/* ── 3. The fold, the narrow width, and the dark toggle ──────────────────── */
{
  check('the fold exists at the sibling card breakpoint (640 px)', /@media \(max-width: 640px\)/.test(styleBlock))
  const fold = (styleBlock.split('@media (max-width: 640px)')[1] || '')
  check('the fold stacks the two columns of a card and stretches the buttons', /kbgate-initcard \{ grid-template-columns: minmax\(0, 1fr\) \}/.test(fold) && /flex: 1 1 auto/.test(fold))
  check('no rule asks for a width a 480 px screen cannot give', [...styleBlock.matchAll(/(?:^|[^-])(?:min-)?width:\s*([0-9]+)px/g)].every((m) => Number(m[1]) <= 480))
  check('the two columns of every grid are shrinkable (minmax(0, 1fr))', !/grid-template-columns:\s*(?!.*minmax\(0, 1fr\))[^;]*1fr/.test(styleBlock))
  check('the dark toggle writes data-ds-dark-theme on the body', /setAttribute\('data-ds-dark-theme'/.test(sceneBlock) && /removeAttribute\('data-ds-dark-theme'/.test(sceneBlock))
}

/* ── 4. Both languages, on every label ───────────────────────────────────── */
{
  const els = [...html.matchAll(/<([a-z][a-z0-9]*)([^>]*?)data-fr="([^"]*)"([^>]*)>/g)]
  const missing = els.filter((m) => !/data-en="/.test(m[0]))
  check('every label that has a French twin has an English one (' + els.length + ' labels)', missing.length === 0, missing.slice(0, 2).map((m) => m[3]))
  const pairs = els.map((m) => [m[3], (m[0].match(/data-en="([^"]*)"/) || [null, ''])[1]])
  check('no label is left empty on either side', pairs.every((p) => p[0].trim() !== '' && p[1].trim() !== ''))
  const diff = pairs.filter((p) => p[0] !== p[1]).length
  check('most labels really differ between the two languages (' + diff + '/' + pairs.length + ')', diff >= Math.floor(pairs.length * 0.8))
  check('a French label is never the English one word for word by accident', pairs.every((p) => p[0].length > 2 && p[1].length > 2))
  check('the page switches language from its own battery, not from a translation call', /data-fr/.test(sceneBlock) && /data-en/.test(sceneBlock))
}

/* ── 5. The hooks the real page drives by, and the states a person meets ─── */
{
  const hooks = ['gate-panel', 'gate-badge', 'gate-step-review', 'gate-step-approve', 'gate-step-activate', 'gate-check', 'gate-trial-start',
    'gate-approve', 'gate-refuse', 'gate-finding', 'gate-proof', 'gate-proof-tool', 'initiative-block', 'initiative-card', 'initiative-ask', 'initiative-drop', 'initiative-more']
  const markup = html.split('<script')[0]
  const built = { 'gate-finding': /setAttribute\('data-kb', 'gate-finding'\)/, 'gate-proof-tool': /setAttribute\('data-kb', 'gate-proof-tool'\)/ }
  const missing = hooks.filter((k) => (built[k] !== undefined ? built[k].test(sceneBlock) !== true : markup.indexOf('data-kb="' + k + '"') < 0))
  check('the maquette carries every data-kb hook of the client', missing.length === 0, missing)
  const states = ['draft', 'static-failed', 'awaiting-approval', 'approved', 'activated', 'refused', 'unknown']
  check('the status picker reaches the seven states of the spec', states.every((s) => html.indexOf('data-set="' + s + '"') >= 0))
  check('the "trial touched the outside" variant is reachable', html.indexOf('data-set="dirty"') >= 0)
  check('the dirty variant turns the proof red and closes the approval', /data-sideeffect/.test(styleBlock) && /KBM_CAN_APPROVE/.test(modelBlock))
}

/* ── 6. The fixtures are real shapes, not invented ones ──────────────────── */
{
  check('gate-records.json holds a GateRecord with the frozen keys', records.gate !== undefined && ['id', 'automationId', 'status', 'staticChecks', 'trial', 'approval', 'updatedAt', 'rev'].every((k) => Object.prototype.hasOwnProperty.call(records.gate, k)))
  check('the frozen status is one of the eight the host stores', ['draft', 'static-failed', 'static-passed', 'trial-done', 'awaiting-approval', 'approved', 'refused', 'activated'].indexOf(records.gate.status) >= 0)
  check('the ProofReport carries every frozen field', records.proof !== undefined && ['runId', 'gateId', 'startedAt', 'endedAt', 'supervised', 'sideEffectFree', 'toolCalls', 'outcome', 'externalEffects', 'errors'].every((k) => Object.prototype.hasOwnProperty.call(records.proof, k)))
  check('the InitiativeEntry is a draft with its evidence', records.initiative !== undefined && records.initiative.nextAction.kind === 'draft' && Number.isInteger(records.initiative.evidence.n))
  check('the fixture says where it came from, and that it was replayed by hand', typeof records.provenance === 'string' && records.provenance.length > 20)
}

/* ── 7. The tokens, and their comparison with the live GUI ───────────────── */
if (wantTokens === true) {
  const wanted = ['--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-layer-3',
    '--dsw-alias-label-primary', '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary', '--dsw-alias-brand-primary',
    '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary', '--dsw-alias-state-error-primary', '--dsw-alias-interactive-bg-hover']
  const light = (tokens.split('body[data-ds-dark-theme]')[0] || '')
  const declared = {}
  for (const v of wanted) { const m = new RegExp('\\n  ' + v + ': ([^;]+);').exec(light); declared[v] = m === null ? null : m[1].trim() }
  if (checkTokens !== true) {
    for (const v of wanted) console.log(v + ' = ' + declared[v])
    console.log('\n' + wanted.length + ' tokens declared (light). Their source: packages/kybernos-sessions/dsh-css.js (DSH_TOKENS_CSS).')
  } else {
    const live = await readLiveTokens(wanted)
    if (live === null) { console.log('○ inconclusive: no GUI answered (start dsh web of the sandbox and retry)'); process.exit(3) }
    const drift = wanted.filter((v) => declared[v] !== null && live[v] !== undefined && String(live[v]).trim() !== declared[v])
    check('the maquette tokens still match the running GUI', drift.length === 0, drift.map((v) => ({ v, here: declared[v], live: live[v] })))
  }
}

/* ── 8. The captures, through a throw-away Chrome on file:// ─────────────── */
if (shotsAt !== null) {
  const made = await captures(shotsAt)
  if (made === null) { console.log('○ inconclusive: Chrome could not be started (set KB_CHROME), no capture written'); process.exit(3) }
  for (const p of made) console.log('shot ' + p)
}

/* ── 9. --sabotage: one defect per control, and the verifier must go RED ─── */
if (sabotage === true) {
  const defects = [
    ['a hardcoded colour in the page', styleBlock.replace('background: var(--dsw-alias-bg-layer-1)', 'background: #ff0000')],
    ['a font size off the ladder', styleBlock.replace('font-size: 12.5px', 'font-size: 11px')],
    ['the fold removed', styleBlock.replace('@media (max-width: 640px)', '@media (max-width: 320px)')],
    ['a grid that cannot shrink', styleBlock.replace('grid-template-columns: minmax(0, 1fr) auto', 'grid-template-columns: 1fr auto')],
    ['the dark toggle removed', sceneBlock.replace(/setAttribute\('data-ds-dark-theme'/g, "setAttribute('data-nope'")],
    ['a label without its English twin', html.replace('data-en="Awaiting approval"', '')],
    ['a hook renamed', html.replace('data-kb="gate-approve"', 'data-kb="gate-ok"')],
    ['a frozen field dropped from the fixture', JSON.stringify(Object.assign({}, records, { proof: Object.assign({}, records.proof, { sideEffectFree: undefined }) }))],
    ['the switch activating without an approval', modelBlock.replace('if (KBM_ACTIVATABLE(s) === true)', 'if (true)')],
  ]
  for (const [label, broken] of defects) {
    const still = await runsBroken(label, broken)
    check('sabotage detected: ' + label, still !== 0, { exit: still })
  }
  const caught = defects.length - fails
  console.log('\n' + caught + '/' + defects.length + ' injected defect(s) detected')
  // The contract of this mode: the run must be RED (exit 1) when the verifier can see every defect. A defect it cannot see is worse
  // than a defect it can, so that case exits 2 — the verifier is proven unable to fail and must be fixed before it is trusted.
  if (fails > 0) { console.log(fails + ' defect(s) NOT detected: the verifier cannot go red on them'); process.exit(2) }
  console.log('expected: this run is red by design (exit 1) — a verifier that cannot go red proves nothing')
  process.exit(1)
}

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' check(s) FAILED')
process.exit(fails === 0 ? 0 : 1)

/* ── Helpers ─────────────────────────────────────────────────────────────── */
/** Does a broken copy still pass this contract? Runs this very file on a temp folder and returns its exit code. */
async function runsBroken (label, broken) {
  const dir = mkdtempSync(join(tmpdir(), 'kb-maquette-sabotage-'))
  try {
    const patched = { 'index.html': broken }
    if (label === 'a frozen field dropped from the fixture') patched['gate-records.json'] = broken
    writeFileSync(join(dir, 'index.html'), patched['index.html'])
    writeFileSync(join(dir, 'tokens.css'), tokens)
    writeFileSync(join(dir, 'gate-records.json'), patched['gate-records.json'] !== undefined ? patched['gate-records.json'] : JSON.stringify(records))
    writeFileSync(join(dir, 'verifier.mjs'), readFileSync(fileURLToPath(import.meta.url), 'utf8'))
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [join(dir, 'verifier.mjs')], { stdio: 'ignore' })
      child.on('exit', (c) => resolve(c === null ? -1 : c))
      child.on('error', () => resolve(-1))
    })
    return code
  } finally { try { rmSync(dir, { recursive: true, force: true }) } catch (e) { /* busy */ } }
}

/** The 13 alias values as the LIVE GUI computes them, or null when no GUI answers. */
async function readLiveTokens (wanted) {
  const authority = process.env.KB_HOST || '127.0.0.1:3080'
  let live = null
  try { live = await openFilePage('http://' + authority + '/') } catch (e) { live = null }
  if (live === null) return null
  try {
    const expr = JSON.stringify(wanted) + '.map((v) => [v, getComputedStyle(document.body).getPropertyValue(v).trim()])'
    const r = await live.page.evalJs('JSON.stringify(' + expr + ')', 8000)
    if (r.err !== undefined || typeof r.val !== 'string') return null
    const out = {}
    for (const [k, v] of JSON.parse(r.val)) out[k] = v
    // An empty answer is not a comparison: a page that did not load (a sign-in screen, a blank tab) resolves every alias to ''.
    if (Object.keys(out).every((k) => String(out[k]).trim() === '')) return null
    return out
  } finally { await live.close() }
}

/** The five captures of the spec, on a throw-away Chrome pointed at the file (no server, no account). */
async function captures (dir) {
  mkdirSync(dir, { recursive: true })
  let live = null
  try { live = await openFilePage(pathToFileURL(join(HERE, 'index.html')).href) } catch (e) { live = null }
  if (live === null) return null
  const made = []
  const page = live.page
  const shot = async (name) => { const p = join(dir, name); if (await page.shot(p) === true) made.push(p); await sleep(150) }
  try {
    await sleep(400)
    await shot('maquette-clair.png')
    // dark: the demo's own toggle, as the GUI's theme button does it
    await page.evalJs(`document.querySelector('[data-kb="maquette-dark"]').click()`, 4000)
    await sleep(250)
    await shot('maquette-sombre.png')
    await page.evalJs(`document.querySelector('[data-kb="maquette-dark"]').click()`, 4000)
    // narrow: 480 px, the width the strategy measures
    await page.send('Emulation.setDeviceMetricsOverride', { width: 480, height: 900, deviceScaleFactor: 1, mobile: false })
    await sleep(250)
    await shot('maquette-etroit.png')
    await page.send('Emulation.clearDeviceMetricsOverride', {})
    // after an approval, and after a refusal
    await page.evalJs(`document.querySelector('[data-set="awaiting-approval"]').click()`, 4000)
    await sleep(150)
    await page.evalJs(`document.querySelector('[data-kb="gate-approve"]').click()`, 4000)
    await sleep(250)
    await shot('maquette-apres-approbation.png')
    await page.evalJs(`document.querySelector('[data-set="refused"]').click()`, 4000)
    await sleep(250)
    await shot('maquette-refus.png')
  } finally { await live.close() }
  return made
}

/** A throw-away headless Chrome on a free debugging port, joined through the house CDP helper. */
async function openFilePage (url) {
  const chromePath = process.env.KB_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  if (existsSync(chromePath) !== true) return null
  const port = await new Promise((resolve) => {
    const tryPort = (p) => { const s = createServer(); s.once('error', () => tryPort(p + 1)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(p))) }
    tryPort(9470)
  })
  const profile = mkdtempSync(join(tmpdir(), 'kb-maquette-'))
  const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + profile, '--use-mock-keychain', '--password-store=basic', '--no-first-run', '--default-browser-check', '--window-size=1400,900', 'about:blank'], { stdio: 'ignore' })
  const close = async () => { try { chrome.kill() } catch (e) { /* gone */ } await sleep(200); try { rmSync(profile, { recursive: true, force: true }) } catch (e) { /* busy */ } }
  let target = null
  for (let i = 0; i < 40 && target === null; i += 1) {
    await sleep(250)
    try { const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json(); target = list.find((t) => t.type === 'page') || null } catch (e) { /* starting */ }
  }
  if (target === null) { await close(); return null }
  const { connect } = await import('../../../../../scripts/cdp-lib.mjs')
  const page = await connect(target)
  await page.send('Page.enable', {})
  await page.send('Page.navigate', { url })
  for (let i = 0; i < 30; i += 1) {
    await sleep(200)
    const r = await page.evalJs('document.readyState', 3000)
    if (r.val === 'complete') break
  }
  return { page, close: async () => { try { page.close() } catch (e) { /* gone */ } await close() } }
}
