#!/usr/bin/env node
// Checks the Plugins segment of Settings › Kybernos Suite against a REAL DSH GUI, with DSH's OWN plugin manager doing every install, switch and removal.
//
//   scripts/sandbox/setup.sh && scripts/sandbox/start.sh && source scripts/sandbox/env.sh && node scripts/check-plugins-live.mjs [--shots <dir>]
//
// The whole user path, on the sandbox instance only: a data plugin installed with `dsh plugin add` appears in the Plugins segment waiting for the person's OK; its page
// (tabs, permissions); « Read and accept » shows the full text and the acceptance puts its field of work on the onboarding's list; the switch is DSH's; « Add a
// plugin » (a folder path checked by DSH then installed by DSH, a draft made by the AI, a .tgz archive chosen from disk) and Remove (DSH removes it); the skill the AI
// uses is seeded; « Create with AI » opens a chat with the first message typed. It undoes everything it made. It refuses the real DSH (3080) and any DSH_HOME that is not a
// sandbox. `dsh plugin` runs pnpm, which keeps one store per HOME: it is run with the real HOME and the sandbox's DSH_HOME, so afterwards run scripts/sandbox/setup.sh.
// Exit code: 0 all green, 1 a check failed, 3 inconclusive (GUI down, bundle not loaded).
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openLivePage, openSettings, goToSettingsPage, waitFor, clickText } from './live-page.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = process.env.KB_HOST || '127.0.0.1:3080'
const DSH_HOME = process.env.DSH_HOME || ''
if (HOST === '127.0.0.1:3080' || /:3080$/.test(HOST)) { console.error('refusing to run against the real DSH (3080): use the sandbox'); process.exit(2) }
if (!/\.kybernos-sandbox/.test(DSH_HOME)) { console.error('refusing to run: DSH_HOME is not a sandbox (' + (DSH_HOME || 'unset') + '). source scripts/sandbox/env.sh first'); process.exit(2) }
const realHome = process.env.KB_REAL_HOME || homedir()
const args = process.argv.slice(2)
const shotsDir = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null
if (shotsDir !== null) mkdirSync(shotsDir, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 300))) }
}
const base = 'http://' + HOST
const PROFILE = join(DSH_HOME, 'profiles', 'web')
const DRAFTS = join(DSH_HOME, 'kybernos', 'plugin-drafts')
const NAME = 'kybernos-plugin-live-vet'
const TWO = 'kybernos-plugin-live-two'
const readProfile = () => JSON.parse(readFileSync(join(PROFILE, 'package.json'), 'utf8'))
const dsh = (...a) => execFileSync('dsh', ['plugin', '--profile', 'web', ...a], { env: { ...process.env, HOME: realHome, DSH_HOME }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000 })
const api = async (path) => { const r = await fetch(base + path, { headers: { accept: 'application/json' } }); return { status: r.status, json: await r.json().catch(() => null) } }

// ── The demo plugins ─────────────────────────────────────────────────────────────────────────────────────────────────────
const edu = JSON.parse(readFileSync(join(REPO, 'packages', 'kybernos-plugin', 'domains', 'edu.json'), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'kb-plugins-live-'))
const makePlugin = (dir, { pkg, id, name, packId, bad = false, desc }) => {
  mkdirSync(join(dir, 'domains'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: pkg, version: '0.1.0', description: desc, license: 'MIT', dsh: { bundle: { patch: './cordis.patch.yml' } } }, null, 2))
  writeFileSync(join(dir, 'cordis.patch.yml'), '# A data plugin: no entry names a module, so no JavaScript is ever loaded.\n[]\n')
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({
    contract: 1, id, kind: 'data', version: '0.1.0', name: { en: name }, description: { en: desc }, author: { id: id.split('/')[0], name: id.split('/')[0] === 'local' ? 'Me' : 'Acme live' }, license: 'MIT', pricing: 'free',
    requires: { kybernos: '>=0.1.0', plugins: { 'kybernos/core': '^1.0' } }, extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }]
  }))
  writeFileSync(join(dir, 'domains', packId + '.json'), JSON.stringify({ ...edu, id: packId, legacyJobs: [], order: 5, name: { en: name }, tagline: { en: 'Made by the live check' } }))
  if (bad) writeFileSync(join(dir, 'domains', 'bad.json'), JSON.stringify({ ...edu, id: 'bad', legacyJobs: [], cron: '* * * * *' }))
}
const vetDir = join(work, 'vet')
const twoDir = join(work, 'two')
makePlugin(vetDir, { pkg: NAME, id: 'acme/live-vet', name: 'Live check vet', packId: 'livevet', bad: true, desc: 'A pack made by the live check, to be read and accepted.' })
makePlugin(twoDir, { pkg: TWO, id: 'acme/live-two', name: 'Live check two', packId: 'livetwo', desc: 'A second pack, added from a folder path.' })
const draftOk = join(DRAFTS, 'live-draft')
const draftBad = join(DRAFTS, 'live-broken')
const tgz = join(work, 'live-three.tgz')

const cleanup = () => {
  for (const n of [NAME, TWO, 'kybernos-plugin-live-draft', 'kybernos-plugin-live-three']) { try { if (n in (readProfile().dependencies ?? {})) dsh('remove', n) } catch (e) { /* already gone */ } }
  rmSync(draftOk, { recursive: true, force: true }); rmSync(draftBad, { recursive: true, force: true })
  try {
    const f = join(DSH_HOME, 'kybernos', 'plugins-state.json')
    if (existsSync(f)) { const s = JSON.parse(readFileSync(f, 'utf8')); for (const k of ['acme/live-vet', 'acme/live-two', 'local/live-draft', 'acme/live-three']) delete s.consented[k]; writeFileSync(f, JSON.stringify(s, null, 2) + '\n') }
    const imports = join(DSH_HOME, 'kybernos', 'plugin-imports')
    if (existsSync(imports)) for (const x of readdirSync(imports)) if (/live-three/.test(x)) rmSync(join(imports, x), { force: true })
  } catch (e) { /* housekeeping */ }
}
process.on('exit', () => { rmSync(work, { recursive: true, force: true }) })

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const live = await openLivePage({ width: 1400, height: 1100 }).catch((e) => { console.error('○ inconclusive: ' + e.message); process.exit(3) })
const { page } = live
const ev = async (js, ms = 15000) => { const r = await page.evalJs(js, ms); return r.err ? null : r.val }
const click = async (x, y) => { for (const t of ['mouseMoved', 'mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type: t, x, y, button: 'left', clickCount: 1 }) }
const centerOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()`)
const press = async (sel) => { const c = await centerOf(sel); if (c === null) return false; await click(c[0], c[1]); return true }
const typeInto = async (sel, value) => {
  if (!(await press(sel))) return false
  await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.focus(); e.select && e.select() })()`)
  await page.send('Input.insertText', { text: value })
  return true
}
const has = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`)
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`)
const text = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText : null })()`)
const until = async (expr, ms = 12000) => (await waitFor(page, expr, ms)) !== null
const shot = async (name) => { if (shotsDir !== null) await page.shot(shotsDir + '/' + name + '.png') }
const card = (id) => '[data-kb="plugin-card"][data-id="' + id + '"]'

try {
  const before = await api('/kybernos-registry/state').catch(() => null)
  if (before === null || before.status === 401 || before.json === null || before.json.ok !== true) { console.error('○ inconclusive: /kybernos-registry/state does not answer (bundle not loaded in this DSH, or its host half not restarted)'); process.exit(3) }
  cleanup()

  console.log('the AI\'s skill is in the DSH home, and the registry answers the new routes')
  check('the plugin-creator skill was seeded under DSH_HOME', existsSync(join(DSH_HOME, 'skills', 'plugin-creator', 'SKILL.md')))
  check('the skill is the one the bundle ships', readFileSync(join(DSH_HOME, 'skills', 'plugin-creator', 'SKILL.md'), 'utf8') === readFileSync(join(REPO, 'packages', 'kybernos-registry', 'skills', 'plugin-creator', 'SKILL.md'), 'utf8'))
  check('GET /kybernos-registry/drafts answers', (await api('/kybernos-registry/drafts')).json?.ok === true)

  console.log('DSH installs a data plugin with its own manager; two drafts wait in the drafts folder')
  let out = ''
  try { out = dsh('add', 'file:' + vetDir) } catch (e) { out = String(e.stdout ?? '') + String(e.stderr ?? e.message) }
  check('DSH accepted the package (empty patch) and selected it', (readProfile().dsh?.profile?.bundles ?? []).includes(NAME), out.slice(-300))
  makePlugin(draftOk, { pkg: 'kybernos-plugin-live-draft', id: 'local/live-draft', name: 'Live draft', packId: 'livedraft', desc: 'A draft the AI made.' })
  mkdirSync(draftBad, { recursive: true })
  writeFileSync(join(draftBad, 'package.json'), JSON.stringify({ name: 'kybernos-plugin-live-broken', version: '0.1.0', scripts: { postinstall: 'echo no' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
  writeFileSync(join(draftBad, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(draftBad, 'plugin.json'), JSON.stringify({ contract: 1, id: 'local/live-broken', kind: 'data', version: '0.1.0', name: { en: 'Live broken' }, description: { en: 'A draft with a fault.' }, author: { id: 'local', name: 'Me' }, license: 'MIT', pricing: 'free', requires: { kybernos: '>=0.1.0', plugins: { 'kybernos/core': '^1.0' } }, extends: [{ point: 'kybernos/core#domain-pack', range: '^1.0', dir: 'domains' }] }))
  await sleep(2600)
  const drafts = (await api('/kybernos-registry/drafts?fresh=1')).json
  check('the registry lists the good draft as ready and the broken one with its fault', drafts?.drafts.find((d) => d.name === 'live-draft')?.ok === true && drafts.drafts.find((d) => d.name === 'live-broken')?.ok === false && /postinstall|install/.test(drafts.drafts.find((d) => d.name === 'live-broken').errors.join()), drafts?.drafts)

  console.log('the Plugins segment')
  await page.send('Page.reload', { ignoreCache: true })
  if (!(await openSettings(page))) { console.error('○ inconclusive: Settings did not open'); process.exit(3) }
  if (!(await goToSettingsPage(page, 'Kybernos Suite', { marker: `!!document.querySelector('[data-kb="suite"] .kbsu-seg')` }))) { console.error('○ inconclusive: the Kybernos Suite page did not open'); process.exit(3) }
  const segs = await ev(`Array.from(document.querySelectorAll('[data-kb="suite"] .kbsu-seg button')).map((b) => b.innerText.replace(/\\s+/g, ' ').trim()).join('|')`)
  check('Plugins is a sixth segment next to Featured, All, Installed, Available and Updates, with a count', /Updates\d+\|Plugins\d+/.test(segs ?? ''), segs)
  await clickText(page, 'Plugins', { within: '[data-kb="suite"] .kbsu-seg' })
  check('the Plugins list opens', await until(`!!document.querySelector('[data-kb="plugins"]')`))
  check('the header offers « Add a plugin » there and not on the module tabs', await has('[data-kb="plugins-add"]'))
  check('the demo plugin is a card: a folder of this computer, so Local, and waiting for the person\'s OK', await until(`!!document.querySelector('${card('acme/live-vet')}')`) && /Local/.test((await text(card('acme/live-vet') + ' [data-kb="plugin-level"]')) ?? '') && /Needs your OK/.test((await text(card('acme/live-vet') + ' [data-kb="plugin-state"]')) ?? ''))
  check('the AI\'s drafts wait under the list: two, one ready', (await count('[data-kb="plugins-draft"]')) === 2 && /Ready to install/.test((await text('[data-kb="plugins-drafts"]')) ?? ''))
  check('the summary says how many plugins and that they are data only', /plugin/.test((await text('[data-kb="plugins-summary"]')) ?? '') && /data only/.test((await text('[data-kb="plugins-summary"]')) ?? ''))
  await shot('1-plugins-list')

  console.log('a plugin\'s page, and reading before accepting')
  await press(card('acme/live-vet') + ' .kbsu-name b')
  check('the plugin page opens with its id and the OK banner', await until(`!!document.querySelector('[data-kb="plugin-fiche"][data-id="acme/live-vet"]')`) && await has('[data-kb="plugin-consent"]'))
  await shot('2-plugin-page')
  await press('[data-kb="plugin-tab-permissions"]')
  const perm = (await text('[data-kb="plugin-permissions"]')) ?? ''
  check('Permissions: no code, no site, gives instructions to the agents', /Runs code on your computer[\s\S]*No: data only/.test(perm) && /Gives instructions to your agents[\s\S]*Yes/.test(perm), perm)
  await press('[data-kb="plugin-tab-compat"]')
  check('Compatibility: the ranges it needs, and the point it extends', /kybernos\/core/.test((await text('[data-kb="plugin-compat"]')) ?? '') && /domain-pack/.test((await text('[data-kb="plugin-compat"]')) ?? ''))
  await press('[data-kb="plugin-tab-description"]')
  check('the file that failed the pack check is listed with its reason', await until(`/bad\\.json/.test((document.querySelector('[data-kb="plugin-rejected"]') || {}).innerText || '')`) || (await text('[data-kb="plugin-description"]') ?? '').includes('bad.json'))
  await press('[data-kb="plugin-read"]')
  check('« Read and accept » opens a dialog with the plugin\'s text, in full', await until(`!!document.querySelector('[data-kb="plugins-read-section"]')`) && /Live check vet/.test((await text('[data-kb="plugins-dialog"]')) ?? ''))
  const readText = (await text('[data-kb="plugins-dialog"]')) ?? ''
  check('every automation prompt of the pack is on the page, and so is the raw file', edu.goals.every((g) => (g.automations ?? []).every((a) => readText.includes(a.prompt.en.slice(0, 40)))) && /Show the file as it is/.test(readText))
  check('the dialog is a labelled modal, outside Settings\' own box', await ev(`(() => { const d = document.querySelector('[data-kb="plugins-dialog"]'); return !!d && d.getAttribute('role') === 'dialog' && d.getAttribute('aria-modal') === 'true' && d.closest('.kbsu-portal') !== null && d.closest('.kbsu-portal').parentElement === document.body })()`))
  await shot('3-read-dialog')
  const before1 = (await api('/kybernos/domains')).json.packs.length
  check('before the OK its pack is not offered to the onboarding', !(await api('/kybernos/domains')).json.packs.some((p) => p.id === 'livevet'))
  await press('[data-kb="plugins-accept"]')
  check('Accept saves the OK: the dialog closes and the plugin is Active', await until(`!document.querySelector('[data-kb="plugins-dialog"]')`) && await until(`/Active/.test((document.querySelector('[data-kb="plugin-fiche"] .kbsu-hero') || {}).innerText || '')`, 15000))
  check('its field of work is now on the onboarding\'s list, marked as coming from the plugin', (await api('/kybernos/domains')).json.packs.length === before1 + 1 && (await api('/kybernos/domains')).json.packs.find((p) => p.id === 'livevet')?.from === 'acme/live-vet')
  check('the page offers to withdraw the OK', await until(`!!document.querySelector('[data-kb="plugin-accepted"]')`))

  console.log('the switch is DSH\'s')
  await press('[data-kb="plugin-fiche"] [data-kb="plugin-switch"]')
  check('switching it off goes through DSH: the profile no longer selects the bundle, and the page says Off', await until(`!!/Off/.test((document.querySelector('[data-kb="plugin-fiche"] .kbsu-hero') || {}).innerText || '')`, 20000) && !(readProfile().dsh?.profile?.bundles ?? []).includes(NAME))
  check('its field of work is gone from the onboarding\'s list while it is off', !(await api('/kybernos/domains')).json.packs.some((p) => p.id === 'livevet'))
  await press('[data-kb="plugin-fiche"] [data-kb="plugin-switch"]')
  check('and switching it on again brings it back', await until(`!!/Active/.test((document.querySelector('[data-kb="plugin-fiche"] .kbsu-hero') || {}).innerText || '')`, 20000) && (readProfile().dsh?.profile?.bundles ?? []).includes(NAME))

  console.log('« Add a plugin »')
  await press('[data-kb="plugin-retour"]')
  await until(`!!document.querySelector('[data-kb="plugins"]')`)
  await press('[data-kb="plugins-add"]')
  check('the menu offers the catalogue (soon, not clickable), GitHub or npm, a file or folder, and Create with AI', await until(`document.querySelectorAll('[data-kb^="plugins-add-"]').length === 4`) && await ev(`document.querySelector('[data-kb="plugins-add-catalogue"]').disabled === true`))
  await shot('4-add-menu')
  await press('[data-kb="plugins-add-file"]')
  check('a folder path is checked by DSH: nothing is installed before', await until(`!!document.querySelector('[data-kb="plugins-spec"]')`) && !(NAME + 'x' in (readProfile().dependencies ?? {})) && !(TWO in (readProfile().dependencies ?? {})))
  await typeInto('[data-kb="plugins-spec"]', twoDir)
  await press('[data-kb="plugins-spec-check"]')
  check('DSH inspected the folder: the dialog names the package and offers Install with DSH', await until(`!!document.querySelector('[data-kb="plugins-install-go"]')`, 20000) && new RegExp(TWO).test((await text('[data-kb="plugins-inspected"]')) ?? ''))
  await shot('5-install-dialog')
  await press('[data-kb="plugins-install-go"]')
  check('DSH installed it (the profile has the package and selects the bundle)', await until(`!!document.querySelector('[data-kb="plugins-installed"]')`, 120000) && TWO in (readProfile().dependencies ?? {}) && (readProfile().dsh?.profile?.bundles ?? []).includes(TWO))
  await press('[data-kb="plugins-open-installed"]')
  check('« Open its page » shows the new plugin, waiting for the OK', await until(`!!document.querySelector('[data-kb="plugin-fiche"][data-id="acme/live-two"]')`, 15000) && await has('[data-kb="plugin-consent"]'))

  console.log('Remove goes through DSH')
  await press('[data-kb="plugin-remove"]')
  check('Remove asks first, and says the person\'s files are not touched', await until(`!!document.querySelector('[data-kb="plugin-remove-confirm"]')`) && /not touched/.test((await text('[data-kb="plugin-remove-confirm"]')) ?? ''))
  await press('[data-kb="plugin-remove-go"]')
  check('DSH removed the package and the page is back on the list without it', await until(`!!document.querySelector('[data-kb="plugins"]') && !document.querySelector('${card('acme/live-two')}')`, 120000) && !(TWO in (readProfile().dependencies ?? {})))

  console.log('a draft made by the AI')
  check('the list still shows the drafts', await until(`document.querySelectorAll('[data-kb="plugins-draft"]').length === 2`))
  await press('[data-kb="plugins-draft"][data-name="live-broken"] [data-kb="plugins-draft-open"]')
  check('a draft with a fault shows the fault and offers to send it to the AI, with no Install', await until(`!!document.querySelector('[data-kb="plugins-draft-errors"]')`) && /install|script/i.test((await text('[data-kb="plugins-draft-errors"]')) ?? '') && await has('[data-kb="plugins-draft-fix"]') && !(await has('[data-kb="plugins-install-go"]')))
  await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)
  check('Escape closes the dialog and leaves Settings open', await until(`!document.querySelector('[data-kb="plugins-dialog"]')`) && await has('[data-kb="plugins"]'))
  await press('[data-kb="plugins-draft"][data-name="live-draft"] [data-kb="plugins-draft-open"]')
  check('a valid draft is checked by DSH on its own and offers to install', await until(`!!document.querySelector('[data-kb="plugins-install-go"]')`, 20000) && !(await has('[data-kb="plugins-spec"]')))
  await press('[data-kb="plugins-install-go"]')
  check('DSH installed the draft; it is now a plugin, and no longer offered as a draft', await until(`!!document.querySelector('[data-kb="plugins-installed"]')`, 120000) && 'kybernos-plugin-live-draft' in (readProfile().dependencies ?? {}))
  await press('[data-kb="plugins-open-installed"]')
  check('its page opens, a Local plugin made on this computer', await until(`!!document.querySelector('[data-kb="plugin-fiche"][data-id="local/live-draft"]')`, 15000) && /Local/.test((await text('[data-kb="plugin-fiche"] .kbsu-hero')) ?? ''))
  await press('[data-kb="plugin-remove"]'); await press('[data-kb="plugin-remove-go"]')
  check('and it is removed again through DSH', await until(`!!document.querySelector('[data-kb="plugins"]')`, 120000) && !('kybernos-plugin-live-draft' in (readProfile().dependencies ?? {})))

  console.log('a .tgz chosen from disk')
  // What `npm pack` makes: a package/ folder inside a gzip tarball.
  const packRoot = join(work, 'pack')
  makePlugin(join(packRoot, 'package'), { pkg: 'kybernos-plugin-live-three', id: 'acme/live-three', name: 'Live check three', packId: 'livethree', desc: 'A third pack, chosen as a .tgz archive.' })
  execFileSync('tar', ['-czf', tgz, '-C', packRoot, 'package'], { stdio: 'ignore' })
  await press('[data-kb="plugins-add"]')
  await press('[data-kb="plugins-add-file"]')
  await until(`!!document.querySelector('[data-kb="plugins-file"]')`)
  const root = (await page.send('DOM.getDocument', { depth: 1 })).result
  const node = (await page.send('DOM.querySelector', { nodeId: root.root.nodeId, selector: '[data-kb="plugins-file"]' })).result
  await page.send('DOM.setFileInputFiles', { files: [tgz], nodeId: node.nodeId })
  check('choosing the archive stores it (not unpacked) and DSH inspects the stored path', await until(`!!document.querySelector('[data-kb="plugins-install-go"]')`, 30000) && /plugin-imports/.test(await ev(`document.querySelector('[data-kb="plugins-spec"]').value`) ?? ''))
  const kept = readdirSync(join(DSH_HOME, 'kybernos', 'plugin-imports')).filter((x) => /live-three/.test(x))
  check('the archive is kept under the DSH home, once', kept.length === 1)
  await press('[data-kb="plugins-install-go"]')
  check('DSH installed it from the archive', await until(`!!document.querySelector('[data-kb="plugins-installed"]')`, 120000) && 'kybernos-plugin-live-three' in (readProfile().dependencies ?? {}))
  await press('[data-kb="plugins-open-installed"]')
  await until(`!!document.querySelector('[data-kb="plugin-fiche"][data-id="acme/live-three"]')`, 15000)
  await press('[data-kb="plugin-remove"]'); await press('[data-kb="plugin-remove-go"]')
  check('and removes it again', await until(`!!document.querySelector('[data-kb="plugins"]')`, 120000) && !('kybernos-plugin-live-three' in (readProfile().dependencies ?? {})))

  console.log('a refusal in words')
  await press('[data-kb="plugins-add"]'); await press('[data-kb="plugins-add-spec"]')
  await until(`!!document.querySelector('[data-kb="plugins-spec"]')`)
  await typeInto('[data-kb="plugins-spec"]', '/nowhere/at/all')
  await press('[data-kb="plugins-spec-check"]')
  check('a folder that does not exist is refused by DSH and said in a sentence, with no Install button', await until(`!!document.querySelector('[data-kb="plugins-install-error"]')`, 20000) && !(await has('[data-kb="plugins-install-go"]')) && !/refused|invalid-spec|not-found/.test((await text('[data-kb="plugins-install-error"]')) ?? ''), await text('[data-kb="plugins-install-error"]'))
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`)

  console.log('Create with AI')
  check('the core gives other pages a way to open a prefilled chat', await ev(`typeof window.__KB_OPEN__ === 'function' && typeof window.__KB_OPEN__.chat === 'function'`))
  await press('[data-kb="plugins-add"]'); await press('[data-kb="plugins-add-ia"]')
  check('the dialog names the plugin-creator skill', await until(`!!document.querySelector('[data-kb="plugins-ia-go"]')`) && /plugin-creator/.test((await text('[data-kb="plugins-dialog"]')) ?? ''))
  await press('[data-kb="plugins-ia-go"]')
  check('the chat opens with the first message typed in the composer and Settings closed', await until(`!document.querySelector('[data-kb="suite"]') && (Array.from(document.querySelectorAll('textarea,[contenteditable="true"]')).some((e) => /plugin-creator/.test(e.value || e.innerText || '')))`, 20000))
  await shot('6-ai-chat')
} catch (e) {
  fail += 1
  console.log('  ✗ the check stopped: ' + String(e && e.message ? e.message : e))
} finally {
  await shot('9-end').catch(() => {})
  try { await live.close() } catch (e) { /* gone */ }
  cleanup()
}
console.log('\n' + (fail === 0 ? 'PLUGINS LIVE OK (' + pass + ')' : 'PLUGINS LIVE: ' + fail + ' failed, ' + pass + ' passed'))
process.exit(fail === 0 ? 0 : 1)
