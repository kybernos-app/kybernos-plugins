#!/usr/bin/env node
// The pure part of scripts/sandbox-instance.mjs: how a profile is re-pointed at a checkout. No DSH, no disk write.
//
//   node scripts/test-sandbox-instance.mjs
import { bundlesOfCheckout, rewriteProfile, LEFT_OUT } from './sandbox-instance.mjs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => { if (ok) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) } }

const REAL = '/Users/someone/plugins'
const MINE = '/work/tree/packages'
const pkg = {
  name: 'dsh-profile-web',
  dependencies: {
    '@deepseek-ai/dsh-base': '0.2.0',
    '@local/kybernos': 'link:' + REAL + '/packages/kybernos-plugin',
    '@local/kybernos-sessions': 'link:' + REAL + '/packages/kybernos-sessions',
    '@local/kybernos-relance': 'link:' + REAL + '/packages/kybernos-relance',
    '@local/kybernos-servers': 'link:/private/paid/packages/kybernos-servers'
  },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@local/kybernos', '@local/kybernos-relance', '@local/kybernos-sessions', '@local/kybernos-servers'], patchReload: 'live' } }
}
const lock = "'@local/kybernos':\n  specifier: link:" + REAL + '/packages/kybernos-plugin\n  version: link:' + REAL + '/packages/kybernos-plugin\n'
const here = { '@local/kybernos': 'kybernos-plugin', '@local/kybernos-sessions': 'kybernos-sessions', '@local/kybernos-changes': 'kybernos-changes', '@local/kybernos-relance': 'kybernos-relance' }
const out = rewriteProfile({ packageJson: pkg, lockText: lock, repoPackages: MINE, bundlesHere: here })

console.log('the profile is re-pointed at the checkout')
check('every @local link goes to the checkout, by the folder it has THERE (the master bundle is kybernos-plugin)', out.packageJson.dependencies['@local/kybernos'] === 'link:' + MINE + '/kybernos-plugin' && out.packageJson.dependencies['@local/kybernos-sessions'] === 'link:' + MINE + '/kybernos-sessions')
check('a bundle the checkout has and the profile lacks is added, as a link and as a bundle', out.packageJson.dependencies['@local/kybernos-changes'] === 'link:' + MINE + '/kybernos-changes' && out.packageJson.dsh.profile.bundles.includes('@local/kybernos-changes'))
check('the paid module and the relaunch tool are left out (dependency and bundle)', LEFT_OUT.every((k) => out.packageJson.dependencies[k] === undefined && !out.packageJson.dsh.profile.bundles.includes(k)), out.packageJson.dependencies)
check('what is not a local bundle is untouched', out.packageJson.dependencies['@deepseek-ai/dsh-base'] === '0.2.0' && out.packageJson.dsh.profile.patchReload === 'live')
check('the lock file follows', out.lockText.indexOf(REAL) < 0 && out.lockText.indexOf('link:' + MINE + '/kybernos-plugin') > 0, out.lockText)
check('the input is not modified', pkg.dependencies['@local/kybernos'].startsWith('link:' + REAL) && pkg.dsh.profile.bundles.length === 5)
check('the bundles are listed once', new Set(out.packageJson.dsh.profile.bundles).size === out.packageJson.dsh.profile.bundles.length)

console.log('the bundles of this checkout')
const mine = bundlesOfCheckout()
check('every DSH bundle is found, with its folder', mine['@local/kybernos'] === 'kybernos-plugin' && mine['@local/kybernos-sessions'] === 'kybernos-sessions' && mine['@local/kybernos-changes'] === 'kybernos-changes', Object.keys(mine).length)
check('the standalone daemon (no `dsh` field) is not a bundle', !Object.values(mine).includes('messaging'))

console.log('\n' + pass + ' ✓  ' + fail + ' ✗')
process.exit(fail === 0 ? 0 : 1)
