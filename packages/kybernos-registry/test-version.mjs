// Versions and ranges (docs/dev/plugin-contract.md, section 5).   node packages/kybernos-registry/test-version.mjs
// Also keeps the copy of the Suite's own comparison honest: the hub's `comparerVersions` and this bundle's `compareVersions` must agree.
import { comparerVersions } from '../kybernos-hub/catalogue-distant.mjs'
import { compareVersions, parseRange, satisfies } from './version.mjs'

let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }

const PAIRS = [['1.0.0', '1.0.0'], ['1.0.0', '1.0.1'], ['0.10.0', '0.9.0'], ['1.0.0-beta.2', '1.0.0-beta.10'], ['1.0.0', '1.0.0-rc.1'], ['0.2.1-rc.2', '0.2.1-alpha.4'], ['0.1.6-alpha.2', '0.1.7-alpha.1'], ['2', '1.9.9'], ['1.2', '1.2.0']]
check('the comparison agrees with the hub on a table', PAIRS.every(([a, b]) => compareVersions(a, b) === comparerVersions(a, b) && compareVersions(b, a) === comparerVersions(b, a)), PAIRS.filter(([a, b]) => compareVersions(a, b) !== comparerVersions(a, b)))

const yes = (v, r) => check(v + ' satisfies ' + r, satisfies(v, r) === true)
const no = (v, r) => check(v + ' does not satisfy ' + r, satisfies(v, r) === false)
yes('1.0.0', '^1'); yes('1.4.2', '^1.0'); yes('1.4.2', '^1.2.3'); no('2.0.0', '^1'); no('1.2.2', '^1.2.3'); no('0.9.9', '^1')
yes('0.1.1', '^0.1'); yes('0.1.9', '^0.1'); no('0.2.0', '^0.1'); yes('0.0.3', '^0.0.3'); no('0.0.4', '^0.0.3'); yes('0.5.0', '^0'); no('1.0.0', '^0')
yes('1.2.9', '~1.2'); no('1.3.0', '~1.2'); yes('1.9.0', '~1'); no('2.0.0', '~1')
yes('0.1.1', '>=0.1.0'); no('0.0.9', '>=0.1.0'); yes('1.0.0', '>=1 <2'); no('2.0.0', '>=1 <2'); yes('1.5.0', '>1.4 <=1.5'); yes('1.0.0', '=1.0.0'); yes('1.0.0', '1.0.0'); no('1.0.1', '=1.0.0')
yes('0.2.1-rc.2', '>=0.1.6-alpha.2 <=0.2.1-rc.2'); no('0.2.1', '>=0.1.6-alpha.2 <=0.2.1-rc.2'); yes('1.0.0-rc.1', '^1.0.0-rc.1')
no('1.0.0', '^1 || ^2'); no('1.0.0', '^1.x'); no('1.0.0', ''); no('1.0.0', '>=1 >=1 >=1 >=1 >=1'); no('not-a-version', '^1'); no('1.0.0', null)
check('parseRange is null for what is not a range', parseRange('^') === null && parseRange('*') === null && parseRange('^1 || ^2') === null && parseRange(7) === null)

console.log(failed === 0 ? '\nVERSION OK' : '\nVERSION: ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
