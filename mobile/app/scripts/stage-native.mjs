#!/usr/bin/env node
// Stages the build inputs the native module needs and the repository never carries: the Node library of each platform (fogtape build) and the runtime payload (mobile/payload).
//   node scripts/stage-native.mjs --payload <dir with payload.kbpack, payload.json, bootstrap.mjs, kbpack.mjs> [--platform ios|android|all] [--node-xcframework <path>] [--node-android <dir>] [--abis arm64-v8a,x86_64]
// Defaults: the libraries fetched and checked by mobile/ios/fetch-node.sh (.deps/node-mobile) and mobile/android/fetch-node.sh. Copies are APFS clones where possible.
import { constants, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const mod = join(here, '..', 'modules', 'kybernos-host')
const a = process.argv.slice(2); const arg = (k) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined }
const die = (m) => { console.error(m); process.exit(2) }
const payload = arg('payload')
if (!payload) die('usage: stage-native.mjs --payload <dir> [--platform ios|android|all] [--node-xcframework <path>] [--node-android <dir>] [--abis a,b]')
const platform = arg('platform') ?? 'all'
const FILES = ['payload.kbpack', 'payload.json', 'bootstrap.mjs', 'kbpack.mjs']
for (const f of FILES) if (!existsSync(join(resolve(payload), f))) die('missing ' + join(payload, f))
const clone = { recursive: true, mode: constants.COPYFILE_FICLONE }
const staged = []

if (platform === 'ios' || platform === 'all') {
  const xcf = resolve(arg('node-xcframework') ?? join(here, '..', '..', 'ios', '.deps', 'node-mobile', 'NodeMobile.xcframework'))
  if (!existsSync(join(xcf, 'Info.plist'))) { if (platform === 'ios') die('no NodeMobile.xcframework at ' + xcf + ' (run mobile/ios/fetch-node.sh or pass --node-xcframework)') } else {
    const ios = join(mod, 'ios')
    rmSync(join(ios, 'vendor'), { recursive: true, force: true }); rmSync(join(ios, 'payload'), { recursive: true, force: true })
    mkdirSync(join(ios, 'vendor'), { recursive: true }); mkdirSync(join(ios, 'payload'), { recursive: true })
    cpSync(xcf, join(ios, 'vendor', 'NodeMobile.xcframework'), clone)
    for (const f of FILES) cpSync(join(resolve(payload), f), join(ios, 'payload', f))
    staged.push('ios')
  }
}

if (platform === 'android' || platform === 'all') {
  const lib = resolve(arg('node-android') ?? join(here, '..', '..', 'android', '.deps', 'node-mobile'))
  const abis = (arg('abis') ?? 'arm64-v8a').split(',')
  if (!abis.every((abi) => existsSync(join(lib, 'bin', abi, 'libnode.so')))) { if (platform === 'android') die('no libnode.so for ' + abis.join(', ') + ' in ' + lib + ' (run mobile/android/fetch-node.sh or pass --node-android)') } else {
    const main = join(mod, 'android', 'src', 'main')
    rmSync(join(main, 'jniLibs'), { recursive: true, force: true }); rmSync(join(main, 'assets'), { recursive: true, force: true })
    mkdirSync(join(main, 'assets'), { recursive: true })
    for (const abi of abis) { mkdirSync(join(main, 'jniLibs', abi), { recursive: true }); cpSync(join(lib, 'bin', abi, 'libnode.so'), join(main, 'jniLibs', abi, 'libnode.so'), clone) }
    for (const f of FILES) cpSync(join(resolve(payload), f), join(main, 'assets', f))
    staged.push('android (' + abis.join(', ') + ')')
  }
}
if (staged.length === 0) die('nothing staged: no Node library found for ' + platform)
console.log('staged: ' + staged.join(' and ') + ' (git-ignored). Next: npx expo prebuild --no-install, then pod install in ios/ or gradlew in android/.')
