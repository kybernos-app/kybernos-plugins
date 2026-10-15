// The host half: it loads, it does nothing, and it never stops DSH from starting.
import { apply, name } from './index.js'

let fail = 0
const ok = (n, cond, detail) => { console.log((cond ? 'ok   ' : 'FAIL ') + n + (cond ? '' : '  ' + (detail || ''))); if (!cond) fail++ }

ok('named after its folder', name === 'kybernos-summary')
ok('apply does not throw with a bare context', (() => { try { apply({}); return true } catch (e) { return false } })())
ok('apply does not throw without a context', (() => { try { apply(undefined); return true } catch (e) { return false } })())
ok('apply registers no route', (() => {
  let touched = false
  apply({ get () { touched = true }, inject () { touched = true } })
  return touched === false
})())

process.exit(fail > 0 ? 1 : 0)
