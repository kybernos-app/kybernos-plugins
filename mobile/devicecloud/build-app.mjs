#!/usr/bin/env node
// Builds the test artifacts of mobile/app for a device cloud: an ad hoc signed IPA (BrowserStack re-signs it) and a re-signed APK. Both carry the self-test settings, and, only when the run is allowed to
// use a model, the Anthropic key from mobile/.env: in the Info.plist of a private copy (iOS) or in assets/kb-selftest.json of a private copy (Android). Keys never reach a command line or a log.
//   node mobile/devicecloud/build-app.mjs --platform ios|android --out <file> [--delay 90] [--model] [--no-build]
// Prerequisites: mobile/app staged, prebuilt and (iOS) pod-installed, see mobile/app/README.md.
import { execFileSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { MOBILE_DIR, cleanEnv, injectPlistInteger, injectPlistString, loadEnv, redact, requireEnv, selfTestAsset } from './lib.mjs'

const APP = join(MOBILE_DIR, 'app')
export const IOS_APP = join(APP, 'ios', 'build', 'dd-device', 'Build', 'Products', 'Release-iphoneos', 'Kybernos.app')
export const ANDROID_APK = join(APP, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
const ANDROID_HOME = process.env.ANDROID_HOME ?? '/opt/homebrew/share/android-commandlinetools'
const JAVA_HOME = process.env.JAVA_HOME ?? '/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home'

const privateDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); chmodSync(d, 0o700); return d }
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { env: cleanEnv({ LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8', JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME }), stdio: 'inherit', ...opts })
const latestBuildTools = () => {
  const dir = join(ANDROID_HOME, 'build-tools')
  const v = existsSync(dir) ? readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).pop() : undefined
  if (v === undefined) throw new Error('no Android build-tools in ' + dir + ' (set ANDROID_HOME)')
  return join(dir, v)
}

/** Compiles the app for a real iPhone without Xcode signing: the frameworks and the app are signed ad hoc afterwards. */
export const buildIosApp = () => {
  if (!existsSync(join(APP, 'ios', 'Kybernos.xcworkspace'))) throw new Error('mobile/app/ios is not generated: follow mobile/app/README.md (stage, prebuild, pod install)')
  run('xcodebuild', ['-workspace', 'Kybernos.xcworkspace', '-scheme', 'Kybernos', '-configuration', 'Release', '-sdk', 'iphoneos', '-destination', 'generic/platform=iOS',
    '-derivedDataPath', 'build/dd-device', 'ARCHS=arm64', 'ONLY_ACTIVE_ARCH=NO', 'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGN_IDENTITY=', 'build', '-quiet'], { cwd: join(APP, 'ios') })
}

/** A private copy of the device app with the self-test settings (and the model key when given), ad hoc signed, zipped as an IPA at `out`. */
export const makeIpa = ({ out, delay = 90, key }) => {
  if (!existsSync(IOS_APP)) throw new Error('no device build at ' + IOS_APP + ' (run without --no-build)')
  const work = privateDir('kb-ipa-')
  try {
    mkdirSync(join(work, 'Payload'))
    const app = join(work, 'Payload', 'Kybernos.app')
    cpSync(IOS_APP, app, { recursive: true })
    const plist = join(app, 'Info.plist')
    let xml = execFileSync('plutil', ['-convert', 'xml1', '-o', '-', plist], { encoding: 'utf8' })
    xml = injectPlistInteger(xml, 'KBSelfTestTaskDelay', delay)
    if (key) xml = injectPlistString(xml, 'KBSelfTestAnthropicKey', key)
    writeFileSync(plist, xml)
    const frameworks = join(app, 'Frameworks')
    const inner = existsSync(frameworks) ? readdirSync(frameworks).filter((f) => f.endsWith('.framework')).map((f) => join(frameworks, f)) : []
    for (const target of [...inner, app]) execFileSync('codesign', ['--force', '--sign', '-', '--timestamp=none', target], { env: cleanEnv(), stdio: 'ignore' })
    rmSync(out, { force: true })
    execFileSync('zip', ['-qry', resolve(out), 'Payload'], { cwd: work })
  } finally { rmSync(work, { recursive: true, force: true }) }
  return out
}

export const buildAndroidApk = () => {
  if (!existsSync(join(APP, 'android', 'gradlew'))) throw new Error('mobile/app/android is not generated: follow mobile/app/README.md (stage, prebuild)')
  run('./gradlew', ['assembleRelease', '-q'], { cwd: join(APP, 'android') })
}

/** A private copy of the release APK with assets/kb-selftest.json, aligned and signed with the debug key (a device cloud takes any valid signature), written to `out`. */
export const makeApk = ({ out, delay = 90, key }) => {
  if (!existsSync(ANDROID_APK)) throw new Error('no APK at ' + ANDROID_APK + ' (run without --no-build)')
  const tools = latestBuildTools()
  const keystore = join(APP, 'android', 'app', 'debug.keystore')
  const work = privateDir('kb-apk-')
  try {
    const base = join(work, 'base.apk'); cpSync(ANDROID_APK, base)
    mkdirSync(join(work, 'stage', 'assets'), { recursive: true })
    writeFileSync(join(work, 'stage', 'assets', 'kb-selftest.json'), selfTestAsset(delay, key), { mode: 0o600 })
    execFileSync('zip', ['-q', base, 'assets/kb-selftest.json'], { cwd: join(work, 'stage'), env: cleanEnv() })
    const aligned = join(work, 'aligned.apk')
    execFileSync(join(tools, 'zipalign'), ['-P', '16', '-f', '4', base, aligned], { env: cleanEnv() })
    rmSync(out, { force: true })
    execFileSync(join(tools, 'apksigner'), ['sign', '--ks', keystore, '--ks-pass', 'pass:android', '--key-pass', 'pass:android', '--ks-key-alias', 'androiddebugkey', '--v4-signing-enabled', 'false', '--out', resolve(out), aligned], { env: cleanEnv({ JAVA_HOME }) })
    execFileSync(join(tools, 'apksigner'), ['verify', resolve(out)], { env: cleanEnv({ JAVA_HOME }) })
  } finally { rmSync(work, { recursive: true, force: true }) }
  return out
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const opt = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i < 0 ? fallback : (process.argv[i + 1]?.startsWith('--') || process.argv[i + 1] === undefined ? true : process.argv[i + 1]) }
  try {
    loadEnv()
    const platform = opt('platform'); const out = opt('out'); const delay = Number(opt('delay', 90)); const withModel = opt('model', false) === true
    if ((platform !== 'ios' && platform !== 'android') || typeof out !== 'string') { console.error('usage: build-app.mjs --platform ios|android --out <file.ipa|file.apk> [--delay 90] [--model] [--no-build]'); process.exit(2) }
    if (withModel) requireEnv(['ANTHROPIC_API_KEY'])
    const key = withModel ? process.env.ANTHROPIC_API_KEY : undefined
    if (opt('no-build', false) !== true) (platform === 'ios' ? buildIosApp : buildAndroidApk)()
    ;(platform === 'ios' ? makeIpa : makeApk)({ out, delay, key })
    console.log('wrote ' + out + (key ? ' (it carries the model key: delete it after the run)' : ' (no key inside)'))
  } catch (e) { console.error(redact(e.message)); process.exit(1) }
}
