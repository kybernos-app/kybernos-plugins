// An empty retry cap must not zero every provider: KB_RETRY_PLAFOND is read the way a person types it.
// (This block used to live in test-compaction-seuil.mjs, with the compaction-threshold checks of the retired preset.)
//   node packages/kybernos-plugin/test-retry-plafond.mjs
import { plafondDepuisEnv } from './retry-policy.mjs'

let failed = 0
const check = (name, ok, detail) => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

console.log('KB_RETRY_PLAFOND')
{
  const cap = (value) => plafondDepuisEnv(value === undefined ? {} : { KB_RETRY_PLAFOND: value })
  check('unset → 10', cap(undefined) === 10)
  check('empty → 10 (it was 0: every provider cut to zero retries)', cap('') === 10, String(cap('')))
  check('blank → 10 (it was 0)', cap('   ') === 10, String(cap('   ')))
  check('"7" → 7', cap('7') === 7)
  check('" 7 " → 7', cap(' 7 ') === 7)
  check('"0" → 0 (an explicit zero is a choice)', cap('0') === 0)
  check('"abc" → 10', cap('abc') === 10)
  check('"-1" → 10', cap('-1') === 10)
  check('"1.5" → 10', cap('1.5') === 10)
  check('"0x10" → 10 (not read as 16)', cap('0x10') === 10, String(cap('0x10')))
  check('"1e1" → 10', cap('1e1') === 10)
  check('a number too large to be a safe integer → 10', cap('9'.repeat(30)) === 10)
  check('no env object at all → 10', plafondDepuisEnv(undefined) === 10 || process.env.KB_RETRY_PLAFOND !== undefined)
}

console.log(failed === 0 ? '\nOK' : `\n${failed} failure(s)`)
process.exit(failed === 0 ? 0 : 1)
