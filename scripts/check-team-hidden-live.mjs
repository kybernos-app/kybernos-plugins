#!/usr/bin/env node
// What a team's own DSH does not show (docs/dev/team-profiles-cadrage.md, step 3b), on REAL pages of the SANDBOX: a REAL `dsh web` is started for a made-up team through the host's
// own route, its page is opened in Chrome next to the page of the sandbox's personal DSH, and the two are compared. Kaby (its page, its Settings pages), the Telegram and WhatsApp doors,
// the Home computer and the phone link belong to the account: the personal DSH has them, the team's has none. The made-up session can reach no server (closed port); nothing leaves the machine.
//
//   bash scripts/sandbox/start.sh && source scripts/sandbox/env.sh && node scripts/check-team-hidden-live.mjs [--shots /tmp/shots]
//
// Sandbox only: it refuses :3080 (exit 3). Exit 0 all good, 1 a check failed, 3 not run.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLivePage, openSettings, waitFor } from './live-page.mjs'

const home = process.env.DSH_HOME || ''
if (!home.includes('/.kybernos-sandbox/') || process.env.HOME === process.env.KB_REAL_HOME || (process.env.KB_HOST || '127.0.0.1:3080').endsWith(':3080')) {
  console.error('○ not run: sandbox only. `bash scripts/sandbox/start.sh && source scripts/sandbox/env.sh` first (DSH_HOME is "' + home + '")')
  process.exit(3)
}
if (!existsSync(join(home, 'profiles', 'web', 'package.json'))) { console.error('○ not run: no sandbox profile; `bash scripts/sandbox/setup.sh` first'); process.exit(3) }
const shotsAt = process.argv.includes('--shots') ? process.argv[process.argv.indexOf('--shots') + 1] : null
if (shotsAt !== null) mkdirSync(shotsAt, { recursive: true })

const TEAM = 'live-hidden-team'
const LEFT_OUT = ['@local/kybernos-kyber', '@local/kybernos-kaby-customisation', '@local/kybernos-mobile']
const dshBin = realpathSync(execFileSync('which', ['dsh'], { encoding: 'utf8' }).trim())
const teamHome = join(home, 'teams', TEAM)
// The made-up account lives in a file of its own: the sandbox's personal DSH never reads it (its server would be the real one, and it would sign the made-up session out).
const scratch = mkdtempSync(join(tmpdir(), 'kb-hidden-live-'))
const personalState = join(scratch, 'kybernos-cloud.json')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let pass = 0
const failures = []
const check = (label, cond, detail) => {
  if (cond) { pass += 1; console.log('  ✓ ' + label) } else { failures.push(label); console.log('  ✗ ' + label + (detail === undefined ? '' : '  — ' + JSON.stringify(detail).slice(0, 300))) }
}

Object.assign(process.env, { KYBERNOS_CLOUD_API: 'http://127.0.0.1:9', KYBERNOS_TEAM_DSH_BIN: dshBin, KYBERNOS_CLOUD_STATE: personalState })
delete process.env.KYBERNOS_TEAM_ID
writeFileSync(personalState, JSON.stringify({
  token: 'kys-' + 'h'.repeat(43),
  api: 'http://127.0.0.1:9',
  user: { id: 'u-hidden', name: 'Hidden Check', email: 'hidden@example.test' },
  workspaces: [{ id: 'w-hidden-personal', name: 'Hidden Check', personal: true }, { id: TEAM, name: 'Hidden team', personal: false }]
}), { mode: 0o600 })
const mod = await import('../packages/kybernos-cloud/index.js')
const hostCall = (path, body) => mod.ROUTES.find((r) => r.path === '/kybernos-cloud/team-dsh/' + path).run({ headers: {} }, body)

// What a page shows of the account's things: the sidebar and the new-chat page as text, the Settings navigation, the account menu.
const PROBE_TEXT = `(() => {
  const labels = Array.from(document.querySelectorAll('button, a, [role="button"], [role="tab"]')).map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().split('\\n')[0]).filter((t) => t !== '')
  return { labels, wizard: /Welcome to Kybernos/.test(document.body.innerText || ''), newchatCloud: document.querySelector('[data-kb="newchat-cloud"]') !== null, seams: { mobile: window.__KB_MOBILE__ !== undefined, kaby: window.__KB_KABY__ !== undefined, kyber: window.__KB_KYBER__ !== undefined } }
})()`
const NAV = `Array.from(document.querySelectorAll('button[class*="navCell"]')).map((x) => (x.innerText || '').trim().split('\\n')[0])`
const MENU = `Array.from(document.querySelectorAll('.kbfp-menu [data-kb^="menu-"]')).map((e) => e.getAttribute('data-kb'))`

const look = async (authority, cookieHome, name) => {
  const was = process.env.DSH_HOME
  process.env.DSH_HOME = cookieHome // the browser session is signed with the secret of the DSH asked
  let live
  try { live = await openLivePage({ authority, width: 1400, height: 860 }) } finally { process.env.DSH_HOME = was }
  const { page } = live
  const val = async (js) => { const r = await page.evalJs(js, 9000); return r.err !== undefined ? { err: r.err } : r.val }
  try {
    await waitFor(page, `document.readyState === 'complete'`, 15000)
    await sleep(2500) // the new-chat page reads the Home computer a moment after it is drawn
    const text = await val(PROBE_TEXT)
    if (shotsAt !== null) await page.shot(join(shotsAt, name + '-home.png'))
    let menu = []
    if (await waitFor(page, `document.querySelector('[data-kb="workspace-card"]') !== null`, 8000) !== null) {
      await val(`document.querySelector('[data-kb="workspace-card"] .kbfp-cardmain').click()`)
      await waitFor(page, `document.querySelector('.kbfp-menu') !== null`, 4000)
      menu = (await val(MENU)) || []
      if (shotsAt !== null) await page.shot(join(shotsAt, name + '-menu.png'))
    }
    let settled = false
    if (menu.includes('menu-settings')) {
      await val(`(() => { const e = document.querySelector('.kbfp-menu [data-kb="menu-settings"]'); if (e) e.click() })()`)
      settled = (await waitFor(page, `document.querySelectorAll('[class*="navCell"]').length > 3`, 10000)) !== null
      if (settled) await page.evalJs(`document.documentElement.setAttribute('data-kb-all-pages', '1')`, 4000)
    } else settled = await openSettings(page)
    const nav = settled ? ((await val(NAV)) || []) : []
    if (shotsAt !== null) await page.shot(join(shotsAt, name + '-settings.png'))
    return { text, menu, nav, settings: settled }
  } finally { await live.close() }
}

let opened = null
try {
  console.log('team DSH, what belongs to the account stays out — live on the sandbox')
  rmSync(teamHome, { recursive: true, force: true })
  opened = await hostCall('open', { workspace_id: TEAM })
  assert.equal(opened.ok, true, JSON.stringify(opened))

  // The profile and the log.
  const manifest = JSON.parse(readFileSync(join(teamHome, 'profiles', 'web', 'package.json'), 'utf8')).dsh.profile.bundles
  const personalManifest = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')).dsh.profile.bundles
  check('the sandbox\'s personal profile loads Kaby, its settings and the phone link (the comparison means something)', LEFT_OUT.every((id) => personalManifest.includes(id)), personalManifest.filter((id) => LEFT_OUT.includes(id)))
  check('the team\'s profile loads none of the three', LEFT_OUT.every((id) => !manifest.includes(id)), manifest.filter((id) => LEFT_OUT.includes(id)))
  const log = readFileSync(join(teamHome, 'logs', 'team-dsh.log'), 'utf8').replace(/token=[^\s]+/gu, '')
  check('and its log shows none of them mounted', !/kybernos-kyber|kybernos-kaby|kybernos-mobile/u.test(log))

  // The server half.
  const origin = opened.url.replace(/\/$/u, '')
  const asked = await fetch(opened.url + 'kybernos-cloud/kyber', { headers: { origin } })
  const askedBody = await asked.json().catch(() => null)
  check('the team\'s DSH refuses the Home computer\'s state: 403 personal_only', asked.status === 403 && askedBody !== null && askedBody.error === 'personal_only', { status: asked.status, body: askedBody })
  const pairing = await fetch(opened.url + 'kybernos-cloud/telegram/pairing/state', { headers: { origin } })
  check('and the Telegram door', pairing.status === 403)
  const status = await fetch(opened.url + 'kybernos-cloud/status')
  check('while the status, which the page needs, is served', status.status === 200)

  // The pages.
  const team = await look('127.0.0.1:' + opened.port, teamHome, 'team')
  const personal = await look(process.env.KB_HOST, home, 'personal')
  console.log('    personal menu: ' + personal.menu.join(' ') + '\n    team menu:     ' + team.menu.join(' '))
  console.log('    personal settings: ' + personal.nav.join(' | ') + '\n    team settings:     ' + team.nav.join(' | '))
  check('both Settings dialogs opened', personal.settings === true && team.settings === true)

  const hasKaby = (labels) => labels.some((l) => /^kaby\b/iu.test(l))
  check('(control) the personal DSH has Kaby and the phone link in its Settings, and publishes their seams', personal.nav.some((l) => /^kaby$/iu.test(l)) && personal.nav.some((l) => /phone and channels/iu.test(l)) && personal.text.seams.mobile === true && personal.text.seams.kaby === true, { nav: personal.nav, seams: personal.text.seams })
  check('the team\'s Settings has no Kaby page', !team.nav.some((l) => /^kaby$/iu.test(l)), team.nav)
  check('no « Phone and channels », in Settings or in the account menu', !team.nav.some((l) => /phone and channels/iu.test(l)) && !team.menu.includes('menu-phone') && team.text.seams.mobile === false, { nav: team.nav, menu: team.menu, seams: team.text.seams })
  check('and none of the seams Kaby and the phone publish', team.text.seams.kaby === false && team.text.seams.kyber === false && team.text.seams.mobile === false, team.text.seams)
  check('the team\'s page opens on its work: no first-run wizard over it', team.text.wizard === false, team.text.wizard)
  check('the team\'s account menu still has its other entries', team.menu.length > 0 && team.menu.includes('menu-switch'), team.menu)
  check('the team\'s sidebar and new-chat page offer no Kaby and no Home computer card', !hasKaby(team.text.labels) && team.text.newchatCloud === false, { kaby: hasKaby(team.text.labels), card: team.text.newchatCloud })
  console.log('    (control) the personal page: Kaby entry ' + hasKaby(personal.text.labels) + ', Home computer card ' + personal.text.newchatCloud)
} catch (e) {
  failures.push('run')
  console.error('  ✗ ' + (e !== null && typeof e === 'object' && e.stack ? e.stack : e))
} finally {
  try { await hostCall('stop', { workspace_id: TEAM }) } catch (e) { /* nothing left to stop */ }
  rmSync(teamHome, { recursive: true, force: true })
  rmSync(scratch, { recursive: true, force: true })
}
console.log('\n' + pass + ' checks passed' + (failures.length > 0 ? ', ' + failures.length + ' failed' : ''))
process.exit(failures.length > 0 ? 1 : 0)
