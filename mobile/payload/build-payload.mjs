#!/usr/bin/env node
// Builds the runtime payload of the mobile apps: the DSH engine, the iOS profile with its plugins, the start-up shims and the bootstrap, pruned of everything a phone cannot use,
// then packed into one kbpack file. Nothing here is committed: the payload is a build product.
//
//   node mobile/payload/build-payload.mjs --engine <moteur dir> --profile <installed profile dir> --packages <repo packages dir> --out <dir> [--extra-modules <node_modules-like dir>] [--node-license <file>]
//
// --engine    the engine tree of one DSH release (holds node_modules/@deepseek-ai/dsh)
// --profile   a profile directory whose node_modules is installed (the source of the third-party packages and of the shipped @deepseek-ai bundles)
// --packages  this repository's packages/ folder: every @local/* package is taken from there, never from the profile's links
// --extra-modules  extra packages copied into the profile's node_modules (for example just-bash and its dependencies)
// --node-license  the licence file of the embedded Node.js (with the licences of the components it bundles), appended to THIRD-PARTY-NOTICES.txt; without it the notice carries a link
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pack } from './kbpack.mjs'
import { audit, render, scanTrees } from './notices.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const args = (() => {
  const a = process.argv.slice(2); const o = {}
  for (let i = 0; i < a.length; i += 2) o[a[i].replace(/^--/, '')] = a[i + 1]
  return o
})()
for (const k of ['engine', 'profile', 'packages', 'out']) if (!args[k]) { console.error('missing --' + k); process.exit(2) }

// Packages a phone cannot run (native code for another system, programs the app cannot launch, desktop control, local speech models) or has no use for.
const DROP_PACKAGE = [
  /^@local\//, /^@openai\/codex/, /^@anthropic-ai\/claude-agent-sdk/, /^@deepseek-ai\/dsh-subagent-(claude-code|codex)$/, /^@trycua\//, /^@vscode\/ripgrep/,
  /^@deepseek-ai\/libreoffice-kit/, /^sherpa-onnx/, /^@img\//, /^@koromix\/koffi-/, /^@tencent-qqmail\/agently-cli/,
  /^playwright(-core)?$/, /^chrome-devtools-mcp$/, /^puppeteer/,
  // The chat-channel plugin (QQ, WeCom, DingTalk, e-mail): not one of the phone's bundles, and its QQ connector carries no licence at all, which an app we publish cannot redistribute.
  /^@xmanrui\/dsh-im$/, /^@tencent-connect\//,
  // Our own sub-agent providers for command-line programs (Gemini, Hermes, OpenCode, Qwen): the phone cannot launch programs, and none of them is one of the phone's bundles.
  /^dsh-subagent-(gemini|hermes|opencode|qwen)$/,
  /-(darwin|linux|win32|freebsd|android|openbsd)-(x64|arm64|arm|ia32|riscv64|ppc64|s390x)(-[a-z]+)?$/,
]
// Files that are never needed at run time. Markdown stays unless it is a readme or a changelog: skills and prompt templates are markdown. A folder called `doc` can hold code
// (yaml's does), so only `docs` goes.
const DROP_FILE = [/\.map$/, /\.d\.[cm]?ts$/, /(?<!\.d)\.tsx?$/, /(^|\/)(docs|tests?|__tests__|examples?|\.github)(\/|$)/i, /(^|\/)test-[^/]*\.(mjs|js)$/, /\.test\.[cm]?js$/, /(^|\/)(README|CHANGELOG|CHANGES|HISTORY|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|AUTHORS)[^/]*\.md$/i, /(^|\/)\.DS_Store$/]
// Our own packages ship their skills, help and assets: only tests, readmes and nested installs are dropped.
const DROP_LOCAL_FILE = [/(^|\/)test-[^/]*\.(mjs|js)$/, /\.test\.[cm]?js$/, /(^|\/)compare-[^/]*\.mjs$/, /(^|\/)README\.md$/, /(^|\/)\.DS_Store$/]
const KEEP_FILE = [/(^|\/)(LICENSE|LICENCE|NOTICE|COPYING)[^/]*$/i]
const DROP_NATIVE_DIR = /(^|\/)(prebuilds|third_party|build\/Release|darwin_[a-z0-9]+|linux_[a-z0-9]+|win32_[a-z0-9]+)(\/|$)/

const bundles = JSON.parse(readFileSync(join(here, 'profile-ios', 'bundles.json'), 'utf8')).bundles

const packageName = (rel) => {
  const parts = rel.split('/')
  const i = parts.lastIndexOf('node_modules')
  if (i < 0) return null
  const first = parts[i + 1]
  if (first === undefined) return null
  return first.startsWith('@') ? (parts[i + 2] === undefined ? first : first + '/' + parts[i + 2]) : first
}

const makeFilter = (root, { local = false } = {}) => (src) => {
  const rel = src.slice(root.length + 1)
  if (rel === '') return true
  if (/(^|\/)\.(bin|pnpm)(\/|$)/.test(rel) || /(^|\/)\.(modules\.yaml|pnpm-workspace-state[^/]*)$/.test(rel)) return false
  const name = packageName(root.endsWith('node_modules') ? 'node_modules/' + rel : rel)
  if (name !== null && DROP_PACKAGE.some((rx) => rx.test(name))) return false
  if (DROP_NATIVE_DIR.test(rel)) return false
  if (KEEP_FILE.some((rx) => rx.test(rel))) return true
  let st
  try { st = statSync(src) } catch { return false } // follows links: a broken link is skipped, not an error
  if (local) return st.isDirectory() ? true : !DROP_LOCAL_FILE.some((rx) => rx.test(rel))
  if (st.isDirectory()) return !(/(^|\/)(docs|tests?|__tests__|examples?|\.github)$/i.test(rel))
  return !DROP_FILE.some((rx) => rx.test(rel))
}

const copyTree = (from, to, { nested = true, local = false } = {}) => {
  const base = makeFilter(from, { local })
  const filter = nested ? base : (src) => base(src) && !/(^|\/)node_modules(\/|$)/.test(src.slice(from.length + 1))
  cpSync(from, to, { recursive: true, dereference: true, filter, force: true, errorOnExist: false })
}
const dirSize = (d) => { let n = 0; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); n += e.isDirectory() ? dirSize(p) : e.isFile() ? statSync(p).size : 0 } return n }
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'

const out = resolve(args.out)
const stage = join(out, 'stage')
rmSync(stage, { recursive: true, force: true })
mkdirSync(join(stage, 'engine'), { recursive: true })
mkdirSync(join(stage, 'profile'), { recursive: true })

// 1. engine
const engineNm = join(resolve(args.engine), 'node_modules')
if (!existsSync(join(engineNm, '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) { console.error('not an engine tree: ' + engineNm); process.exit(2) }
copyTree(engineNm, join(stage, 'engine', 'node_modules'))
console.log('engine   ', mb(dirSize(join(stage, 'engine'))))

// 2. profile packages: third-party and shipped bundles from the installed profile, @local from this repository
const profileNm = join(resolve(args.profile), 'node_modules')
copyTree(profileNm, join(stage, 'profile', 'node_modules'))
const local = join(stage, 'profile', 'node_modules', '@local')
rmSync(local, { recursive: true, force: true }); mkdirSync(local, { recursive: true })
const packagesDir = resolve(args.packages)
const localPackages = {}
for (const d of readdirSync(packagesDir)) {
  const pj = join(packagesDir, d, 'package.json')
  if (!existsSync(pj)) continue
  const j = JSON.parse(readFileSync(pj, 'utf8'))
  if (typeof j.name === 'string' && j.name.startsWith('@local/')) localPackages[j.name] = join(packagesDir, d)
}
const missing = []
for (const b of bundles.filter((x) => x.startsWith('@local/'))) {
  const dir = localPackages[b]
  if (dir === undefined) { missing.push(b); continue }
  copyTree(dir, join(local, b.slice('@local/'.length)), { nested: false, local: true })
}
if (missing.length > 0) { console.error('no package in --packages for: ' + missing.join(', ')); process.exit(2) }
if (args['extra-modules']) copyTree(resolve(args['extra-modules']), join(stage, 'profile', 'node_modules'))
console.log('profile  ', mb(dirSize(join(stage, 'profile'))))

// 3. profile files: bundle list, root config, patch
const srcPkg = JSON.parse(readFileSync(join(resolve(args.profile), 'package.json'), 'utf8'))
const present = (n) => existsSync(join(stage, 'profile', 'node_modules', n, 'package.json'))
const deps = {}
for (const n of Object.keys(srcPkg.dependencies ?? {})) if (present(n)) deps[n] = srcPkg.dependencies[n]
for (const b of bundles) if (b.startsWith('@local/') && present(b)) deps[b] = 'link:./node_modules/' + b
const dsh = { ...(srcPkg.dsh ?? {}), profile: { ...(srcPkg.dsh?.profile ?? {}), bundles } }
writeFileSync(join(stage, 'profile', 'package.json'), JSON.stringify({ name: 'dsh-profile-ios', private: true, dependencies: deps, dsh }, null, 2) + '\n')
writeFileSync(join(stage, 'profile', 'cordis.yml'), '# dsh profile root: an empty entry list. The tree is composed from the bundles, then cordis.patch.yml.\n[]\n')
cpSync(join(here, 'profile-ios', 'cordis.patch.yml'), join(stage, 'profile', 'cordis.patch.yml'))

// 4. shims and bootstrap
cpSync(join(here, 'shims'), join(stage, 'shims'), { recursive: true })

// 4b. licences: every package that ships must have a licence that allows it (the build stops otherwise), and the app carries the list with the licence texts
const shipped = scanTrees([join(stage, 'engine', 'node_modules'), join(stage, 'profile', 'node_modules')])
const checked = audit(shipped)
if (checked.problems.length > 0) {
  console.error('licences: ' + checked.problems.length + ' package(s) cannot be redistributed as they are:')
  for (const p of checked.problems) console.error('  ' + p.name + '@' + p.version + ' [' + p.license + '] ' + p.reason)
  console.error('drop them in DROP_PACKAGE, or record the licence you checked by hand in OVERRIDES (mobile/payload/notices.mjs)')
  process.exit(3)
}
const nodeText = args['node-license'] ? readFileSync(resolve(args['node-license']), 'utf8') : 'The embedded Node.js (a nodejs-mobile build) is under the MIT licence together with the components it bundles (V8, OpenSSL, ICU, zlib, ...). Their licence texts: https://github.com/nodejs/node/blob/main/LICENSE'
const noticesText = render({
  entries: checked.ok,
  extra: [
    { title: 'Kybernos', body: 'The Kybernos plugins and this app are released under the Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0). The names Kybernos and the K logo are trademarks and are not covered by that licence (TRADEMARK.md in the source repository).' },
    { title: 'Node.js', body: nodeText },
  ],
})
writeFileSync(join(stage, 'THIRD-PARTY-NOTICES.txt'), noticesText)
console.log('licences ', checked.ok.length, 'packages checked,', mb(Buffer.byteLength(noticesText)), 'of notices')

// 5. pack
const engineVersion = JSON.parse(readFileSync(join(engineNm, '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
// the bootstrap, the pack reader and the provider seed ship NEXT TO the pack, not inside it: the host needs them to open it
cpSync(join(here, 'bootstrap.mjs'), join(out, 'bootstrap.mjs'))
cpSync(join(here, 'kbpack.mjs'), join(out, 'kbpack.mjs'))
cpSync(join(here, 'provider-seed.mjs'), join(out, 'provider-seed.mjs'))
const packFile = join(out, 'payload.kbpack')
const r = await pack(stage, packFile)
const manifest = { format: 'kbpack1', engine: engineVersion, bundles: bundles.length, files: r.files, bytes: r.bytes, packed: r.packed, sha256: r.sha256, built: new Date().toISOString() }
writeFileSync(join(out, 'payload.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log('payload  ', r.files, 'files,', mb(r.bytes), '->', mb(r.packed), 'packed, sha256', r.sha256.slice(0, 16) + '…', '(' + basename(packFile) + ')')
