#!/usr/bin/env node
// Stages the two build inputs the native module needs and the repository never carries: the Node framework for iOS (180 MB, fogtape build) and the runtime payload (mobile/payload).
//   node scripts/stage-native.mjs --payload <dir with payload.kbpack, payload.json, bootstrap.mjs, kbpack.mjs> [--node-xcframework <NodeMobile.xcframework>]
// Without --node-xcframework it uses mobile/ios/.deps/node-mobile (fetched and checked by mobile/ios/fetch-node.sh). Copies are APFS clones where possible.
import { constants, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ios = join(here, '..', 'modules', 'kybernos-host', 'ios')
const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined }
const payload = arg('payload')
if (!payload) { console.error('usage: stage-native.mjs --payload <dir> [--node-xcframework <path>]'); process.exit(2) }
const xcf = resolve(arg('node-xcframework') ?? join(here, '..', '..', 'ios', '.deps', 'node-mobile', 'NodeMobile.xcframework'))
if (!existsSync(join(xcf, 'Info.plist'))) { console.error('no NodeMobile.xcframework at ' + xcf + ' (run mobile/ios/fetch-node.sh or pass --node-xcframework)'); process.exit(2) }
for (const f of ['payload.kbpack', 'payload.json', 'bootstrap.mjs', 'kbpack.mjs']) if (!existsSync(join(resolve(payload), f))) { console.error('missing ' + join(payload, f)); process.exit(2) }

rmSync(join(ios, 'vendor'), { recursive: true, force: true }); rmSync(join(ios, 'payload'), { recursive: true, force: true })
mkdirSync(join(ios, 'vendor'), { recursive: true }); mkdirSync(join(ios, 'payload'), { recursive: true })
cpSync(xcf, join(ios, 'vendor', 'NodeMobile.xcframework'), { recursive: true, mode: constants.COPYFILE_FICLONE })
for (const f of ['payload.kbpack', 'payload.json', 'bootstrap.mjs', 'kbpack.mjs']) cpSync(join(resolve(payload), f), join(ios, 'payload', f))
console.log('staged: NodeMobile.xcframework and the payload in ' + ios + ' (git-ignored). Next: npx expo prebuild --platform ios, then pod install in ios/.')
