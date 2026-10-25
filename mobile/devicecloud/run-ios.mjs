#!/usr/bin/env node
// Builds the iPhone test app, uploads it to BrowserStack, runs the self-test session on a real device, then deletes the upload and the local copies, whatever happens.
//   node mobile/devicecloud/run-ios.mjs --payload <payload dir> [--xcframework <NodeMobile.xcframework>] [--model] [--device "iPhone 18 Pro"] [--os 27]
// --model puts ANTHROPIC_API_KEY (from mobile/.env) into the Info.plist of a PRIVATE COPY of the app so the automation can finish with a real answer; that copy is uploaded for the run,
// then removed from BrowserStack and from disk. Use a throwaway key with a spend limit and revoke it afterwards. Keys are never printed and never reach a command line.
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MOBILE_DIR, cleanEnv, injectPlistString, loadEnv, redact, requireEnv } from './lib.mjs'
import { remove, upload } from './app.mjs'
import { runSession } from './session.mjs'

const opt = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]) }
const payload = opt('payload', process.env.KB_PAYLOAD_DIR)
const xcframework = opt('xcframework', process.env.KB_NODE_XCFRAMEWORK ?? join(MOBILE_DIR, 'ios', '.deps', 'node-mobile', 'NodeMobile.xcframework'))
const withModel = opt('model', false) === true
const device = opt('device', 'iPhone 18 Pro'); const osVersion = String(opt('os', '27'))

let work = null; let appUrl = null; let result = null
try {
  loadEnv(); requireEnv(['BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY']); if (withModel) requireEnv(['ANTHROPIC_API_KEY'])
  if (typeof payload !== 'string' || !existsSync(join(payload, 'payload.kbpack'))) throw new Error('give --payload <dir with payload.kbpack> (output of mobile/payload/build-payload.mjs) or set KB_PAYLOAD_DIR')
  if (!existsSync(join(xcframework, 'ios-arm64'))) throw new Error('no device framework at ' + xcframework + ' (run mobile/ios/fetch-node.sh or pass --xcframework)')
  const budget = Number(process.env.BROWSERSTACK_BUDGET_MINUTES ?? 10)

  console.log('building the device test app (no key inside)')
  execFileSync('bash', [join(MOBILE_DIR, 'ios', 'build.sh'), resolve(payload), resolve(xcframework)], { env: cleanEnv({ TARGET: 'device', SELFTEST_DELAY: '90' }), stdio: 'inherit' })
  const built = join(MOBILE_DIR, 'ios', 'build', 'device', 'KybernosHost.app')

  work = mkdtempSync(join(tmpdir(), 'kb-devrun-')); chmodSync(work, 0o700)
  mkdirSync(join(work, 'ipa', 'Payload'), { recursive: true })
  const app = join(work, 'ipa', 'Payload', 'KybernosHost.app')
  cpSync(built, app, { recursive: true })
  if (withModel) {
    const plist = join(app, 'Info.plist')
    const xml = execFileSync('plutil', ['-convert', 'xml1', '-o', '-', plist], { encoding: 'utf8' })
    writeFileSync(plist, injectPlistString(xml, 'KBSelfTestAnthropicKey', process.env.ANTHROPIC_API_KEY))
    for (const target of [join(app, 'Frameworks', 'NodeMobile.framework'), app]) execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', target], { env: cleanEnv(), stdio: 'ignore' })
  }
  const ipa = join(work, 'KybernosHost-test.ipa')
  execFileSync('zip', ['-qry', ipa, 'Payload'], { cwd: join(work, 'ipa') })

  console.log('uploading the test app' + (withModel ? ' (it carries the model key until the end of this run)' : ''))
  appUrl = await upload(ipa, 'kybernos-host-run-' + Date.now())
  result = await runSession({ appUrl, device, osVersion, expectAnswer: withModel, maxMinutes: Math.min(budget, 9.5), outDir: join(MOBILE_DIR, 'devicecloud', 'runs', new Date().toISOString().replace(/[:.]/g, '-')) })
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
