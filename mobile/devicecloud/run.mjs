#!/usr/bin/env node
// Builds the test app of mobile/app for a device cloud, uploads it to BrowserStack, runs the self-test session on a real phone, then deletes the upload and the local copies, whatever happens.
//   node mobile/devicecloud/run.mjs --platform ios|android [--model] [--device "iPhone 18 Pro"] [--os 27] [--delay 90] [--no-build] [--dry-run]
// --model puts ANTHROPIC_API_KEY (from mobile/.env) into a PRIVATE COPY of the app (Info.plist on iOS, assets/kb-selftest.json on Android) so the automation can finish with a real answer; that copy is
// uploaded for the run, then removed from BrowserStack and from disk. Use a throwaway key with a spend limit and revoke it afterwards. Keys are never printed and never reach a command line.
// --dry-run builds and signs the test app and stops there: nothing is uploaded, no BrowserStack key is needed, and --model is refused.
import { mkdtempSync, rmSync, chmodSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MOBILE_DIR, loadEnv, redact, requireEnv } from './lib.mjs'
import { remove, upload } from './app.mjs'
import { buildAndroidApk, buildIosApp, makeApk, makeIpa } from './build-app.mjs'
import { PLATFORMS } from './platforms.mjs'
import { runSession } from './session.mjs'

const opt = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]) }
const platform = opt('platform')
const withModel = opt('model', false) === true
const dryRun = opt('dry-run', false) === true
const delay = Number(opt('delay', 90))

let work = null; let appUrl = null; let result = null
try {
  if (PLATFORMS[platform] === undefined) throw new Error('usage: run.mjs --platform ios|android [--model] [--device <name>] [--os <version>] [--delay 90] [--no-build] [--dry-run]')
  if (dryRun && withModel) throw new Error('--dry-run never uses a model key: drop --model')
  loadEnv()
  if (!dryRun) requireEnv(['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY'])
  if (withModel) requireEnv(['ANTHROPIC_API_KEY'])
  const budget = Number(process.env.BROWSERSTACK_BUDGET_MINUTES ?? 10)

  if (opt('no-build', false) !== true) { console.log('building the ' + platform + ' test app (no key inside)'); (platform === 'ios' ? buildIosApp : buildAndroidApk)() }
  work = mkdtempSync(join(tmpdir(), 'kb-devrun-')); chmodSync(work, 0o700)
  const file = join(work, platform === 'ios' ? 'Kybernos-test.ipa' : 'Kybernos-test.apk')
  ;(platform === 'ios' ? makeIpa : makeApk)({ out: file, delay, key: withModel ? process.env.ANTHROPIC_API_KEY : undefined })
  const mb = (statSync(file).size / 1048576).toFixed(0)
  if (dryRun) { console.log('dry run: the ' + platform + ' test app builds and signs (' + mb + ' MB, self-test delay ' + delay + ' s); nothing was uploaded') } else {
    console.log('uploading the test app (' + mb + ' MB)' + (withModel ? ' (it carries the model key until the end of this run)' : ''))
    appUrl = await upload(file, 'kybernos-' + platform + '-run-' + Date.now())
    result = await runSession({ platform, appUrl, device: opt('device', undefined), osVersion: opt('os', undefined), expectAnswer: withModel, maxMinutes: Math.min(budget, 9.5), outDir: join(MOBILE_DIR, 'devicecloud', 'runs', platform + '-' + new Date().toISOString().replace(/[:.]/g, '-')) })
  }
} catch (e) {
  console.error(redact(e && e.message))
  process.exitCode = 1
} finally {
  if (appUrl) { try { await remove(appUrl); console.log('test app deleted from BrowserStack') } catch (e) { console.error('COULD NOT delete the test app from BrowserStack (' + redact(e.message) + '): remove it with: node mobile/devicecloud/app.mjs delete ' + appUrl); process.exitCode = 1 } }
  if (work) rmSync(work, { recursive: true, force: true })
}
if (result) {
  const v = result.verdict ?? {}
  const ok = result.error === undefined && Object.values(v).every((x) => x === true || x === null)
  console.log('verdict: ' + JSON.stringify(v) + (ok ? ' PASS' : ' FAIL'))
  if (!ok) process.exitCode = 1
}
