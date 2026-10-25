#!/usr/bin/env node
// scripts/pin-model.mjs on FAKE profiles: it sets the default model of a sandbox profile, changes nothing else, is idempotent, and refuses every file that is not
// inside a .kybernos-sandbox folder (a copy elsewhere, a `..` path, a link that leads out). No DSH, no real ~/.dsh.
//
//   node scripts/test-pin-model.mjs
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isSandboxFile, pinModel, pinText, profileOf } from './pin-model.mjs'

const TOOL = join(dirname(fileURLToPath(import.meta.url)), 'pin-model.mjs')
let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }
const throws = (fn) => { try { fn(); return null } catch (e) { return String(e && e.message || e) } }

const PROFILE = [
  '- id: ui-chat', '  name: "@deepseek-ai/dsh-client-ui-chat"', '  config:', '    transcriptView: detailed',
  '- id: agent-default-model', '  name: "@deepseek-ai/dsh-agent-default-model"', '  config:', '    provider: opencode-go', '    model: deepseek-v4.1-flash',
  '- id: ui-theme', '  name: "@deepseek-ai/dsh-client-ui-theme"', '  config:', '    model: not-this-one', ''
].join('\n')

const root = mkdtempSync(join(tmpdir(), 'kb-pin-model-'))
try {
  const sbHome = join(root, '.kybernos-sandbox', 'fake', 'home')
  const file = profileOf(sbHome)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, PROFILE)
  const elsewhere = join(root, 'real-dsh', 'profiles', 'web', 'cordis.patch.yml')
  mkdirSync(dirname(elsewhere), { recursive: true })
  writeFileSync(elsewhere, PROFILE)

  // the pure part
  const pure = pinText(PROFILE, 'kybernos', 'glm')
  check('pinText sets provider and model of the agent-default-model block', /provider: kybernos\n    model: glm\n/.test(pure.text), pure.after)
  check('it reports what it found before', pure.before.provider === 'opencode-go' && pure.before.model === 'deepseek-v4.1-flash' && pure.changed === true, pure.before)
  check('another block that also has a « model: » line is not touched', pure.text.includes('    model: not-this-one') && pure.text.includes('transcriptView: detailed'))
  check('nothing but the two values changed', pure.text.replace('provider: kybernos', 'provider: opencode-go').replace('model: glm', 'model: deepseek-v4.1-flash') === PROFILE)
  check('pinning what is already there changes nothing', pinText(pure.text, 'kybernos', 'glm').changed === false && pinText(pure.text, 'kybernos', 'glm').text === pure.text)
  check('a file without the block is refused', /no agent-default-model block/.test(throws(() => pinText('- id: ui-chat\n', 'kybernos', 'glm')) || ''))
  check('a provider or model that is not a plain id is refused (no YAML injected through the value)', throws(() => pinText(PROFILE, 'kybernos\n  other: 1', 'glm')) !== null && throws(() => pinText(PROFILE, 'kybernos', 'glm # x')) !== null && throws(() => pinText(PROFILE, '', 'glm')) !== null)

  // the files
  check('isSandboxFile accepts a profile inside a .kybernos-sandbox folder', isSandboxFile(file) === true)
  check('isSandboxFile refuses a copy outside, a missing file and an empty path', isSandboxFile(elsewhere) === false && isSandboxFile(join(sbHome, 'nope.yml')) === false && isSandboxFile('') === false)
  check('isSandboxFile refuses a path that only walks into the folder with « .. »', isSandboxFile(join(root, '.kybernos-sandbox', '..', 'real-dsh', 'profiles', 'web', 'cordis.patch.yml')) === false)
  const linkDir = join(root, '.kybernos-sandbox', 'linked', 'home', '.dsh', 'profiles', 'web')
  mkdirSync(linkDir, { recursive: true })
  symlinkSync(elsewhere, join(linkDir, 'cordis.patch.yml'))
  check('isSandboxFile refuses a link inside the sandbox that leads to a file outside it', isSandboxFile(join(linkDir, 'cordis.patch.yml')) === false)

  const refusedOutside = throws(() => pinModel(elsewhere, 'kybernos', 'glm'))
  check('pinModel refuses a profile outside a sandbox, and leaves it as it was', /not a file inside a \.kybernos-sandbox folder/.test(refusedOutside || '') && readFileSync(elsewhere, 'utf8') === PROFILE, refusedOutside)
  check('pinModel refuses the link, and the real file behind it stays as it was', throws(() => pinModel(join(linkDir, 'cordis.patch.yml'), 'kybernos', 'glm')) !== null && readFileSync(elsewhere, 'utf8') === PROFILE)

  const done = pinModel(file, 'kybernos', 'glm')
  check('pinModel writes the sandbox profile', done.changed === true && /provider: kybernos\n    model: glm\n/.test(readFileSync(file, 'utf8')), done)
  check('no temporary file is left beside it', !existsSync(file + '.pin-tmp'))
  check('a second call is a no-op', pinModel(file, 'kybernos', 'glm').changed === false)
  check('and the defaults are kybernos / glm', pinModel(file).after.provider === 'kybernos' && pinModel(file).after.model === 'glm')

  // the command line
  const cli = (...a) => spawnSync(process.execPath, [TOOL, ...a], { encoding: 'utf8' })
  writeFileSync(file, PROFILE)
  const viaHome = cli('--home', sbHome)
  check('the command line pins through --home', viaHome.status === 0 && /opencode-go\/deepseek-v4\.1-flash -> kybernos\/glm/.test(viaHome.stdout) && /provider: kybernos\n/.test(readFileSync(file, 'utf8')), viaHome.stdout + viaHome.stderr)
  check('its output names no path of the person\'s machine', !/\/Users\//.test(viaHome.stdout), viaHome.stdout)
  const viaFile = cli(file, 'kybernos', 'kybernos/glm')
  check('it takes a provider and a model', viaFile.status === 0 && /model: kybernos\/glm\n/.test(readFileSync(file, 'utf8')), viaFile.stderr)
  const bad = cli(elsewhere, 'kybernos', 'glm')
  check('the command line refuses a profile outside a sandbox with exit 2', bad.status === 2 && readFileSync(elsewhere, 'utf8') === PROFILE, bad.stderr)
  check('and says what to do without arguments', cli().status === 2)
} finally { rmSync(root, { recursive: true, force: true }) }

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
