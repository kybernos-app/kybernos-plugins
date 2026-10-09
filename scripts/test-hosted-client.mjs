// The hosted-instance rule of the core client: on a browser that is not on loopback, DSH cannot remember its "Preview
// Notice" (it keeps UI settings in memory there), so the notice is shadowed instead of coming back at every page load.
// Runs the block marked KB-HOSTED-CORE of packages/kybernos-plugin/client.js as-is (the client is one bundle with no
// relative imports, hence the extraction, same as test-brand.mjs).
// Usage: node scripts/test-hosted-client.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(root + 'packages/kybernos-plugin/client.js', 'utf8')
const m = src.match(/\/\/ KB-HOSTED-CORE-BEGIN([\s\S]*?)\/\/ KB-HOSTED-CORE-END/)
if (m === null) { console.error('BLOCK KB-HOSTED-CORE NOT FOUND in packages/kybernos-plugin/client.js'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kbIsLoopbackHost }'))

let fails = 0
const eq = (label, got, want) => {
  if (got !== want) { fails++; console.log('FAIL', label, '| got', JSON.stringify(got), '| want', JSON.stringify(want)) } else console.log('ok  ', label)
}

// Same rule as DSH's own `isLoopbackHostname` (dsh-client-connection): localhost, [::1], 127.x.x.x.
for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', '[::1]']) eq(`${host} is loopback`, mod.kbIsLoopbackHost(host), true)
for (const host of ['kb.localhost', 'dsh.example.com', 'dsh-kb-test.188.245.44.122.sslip.io', '10.0.0.5', '192.168.1.20', '127.0.0.256', '127.0.0', '127.0.0.1.evil.example', 'localhost.evil.example', '[2001:db8::1]']) {
  eq(`${host} is a remote browser`, mod.kbIsLoopbackHost(host), false)
}
// No page address at all (a non-browser host): DSH treats it as loopback too, so nothing is shadowed.
for (const host of ['', undefined, null, 42]) eq(`${String(host)} is treated as loopback`, mod.kbIsLoopbackHost(host), true)

// The wiring: the notice is shadowed with the same list-slot id at a lower priority, only for a remote browser.
const reg = src.match(/if \(!kbIsLoopbackHost\([^)]*\)[^)]*\) \{\s*ctx\.effect\(\(\) => slots\.inject\('settings\.onboarding'[\s\S]*?\}\n/)
eq('the shadow entry exists behind the remote-browser guard', reg !== null, true)
if (reg !== null) {
  eq('it targets the welcome-notice id of settings.onboarding', /name: 'settings\.onboarding', id: 'welcome-notice'/.test(reg[0]), true)
  eq('at priority -1 (the lowest renders, the native one is at 0)', /priority: -1/.test(reg[0]), true)
  eq('and renders nothing', /, \(\) => null\)\)/.test(reg[0]), true)
}
eq('the block touches no DOM and no globals', /document\.|window\.|localStorage/.test(m[1]), false)

console.log(fails === 0 ? '\nALL PASS' : '\n' + fails + ' FAILED')
process.exit(fails === 0 ? 0 : 1)
