#!/usr/bin/env node
// V-39 (audit 2026-10-16): « the button is too small ». Measured in a real GUI: the close cross of the Settings dialog is a 28 px
// icon button (DSH's own), and the main « Create » buttons of the pages are 38 px high, 38 px on a phone too (a finger needs 44).
// The pixels are looked at in the sandbox; this pins the two rules that fix it.
//
//   node packages/kybernos-plugin/test-touch-targets.mjs
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const here = dirname(fileURLToPath(import.meta.url))
const plugin = readFileSync(join(here, 'client.js'), 'utf8')
const mobile = readFileSync(join(here, '..', 'kybernos-mobile', 'mobile.css'), 'utf8')

const close = /\[role="dialog"\]:has\(nav \[class\$="_navCell"\]\) \[class\$="_close"\]\{([^}]*)\}/.exec(plugin)
check('the Settings dialog\'s close cross is at least a 40 px target', close !== null && /min-width:40px/.test(close[1]) && /min-height:40px/.test(close[1]), close && close[1])
check('...and its icon is drawn larger than DSH\'s 14 px', /\[class\$="_close"\] svg\{width:18px;height:18px\}/.test(plugin))
check('...found by its class suffix inside the Settings dialog only (the shell hashes the prefix at every build)', close !== null)

const coarse = /@media \(max-width: 700px\) and \(pointer: coarse\)[^{]*\{([\s\S]*?)\n\}/.exec(mobile)
const main = coarse === null ? null : /\[data-slot="main"\] \.kb8-primary,\s*\[data-slot="main"\] \.kb-createai \{([^}]*)\}/.exec(coarse[1])
check('on a phone (coarse pointer) the main action of a page (Create, Create with AI) is 44 px high at least', main !== null && /min-height:\s*44px/.test(main[1]), main && main[1])
check('...and only there: a pointer keeps the 38 px of the desktop', !/^\s*\[data-slot="main"\] \.kb8-primary/m.test(mobile.replace(coarse === null ? '' : coarse[0], '')))

console.log('\n' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
