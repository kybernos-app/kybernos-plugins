// Tests of the address and discovery rules (pure: the network is a stand-in).   node packages/kybernos-servers/test-discovery.mjs
// SRV-01 (addresses), SRV-02 (every way discovery stops), SRV-04 (services kept as published).
import { MAX_BYTES, WELL_KNOWN, compareVersions, discover, parseAddress, slugFor } from './discovery.mjs'

let failed = 0
const check = (name, ok, detail) => { console.log((ok ? '  ✓ ' : '  ✗ ') + name + (ok || detail === undefined ? '' : '  — ' + JSON.stringify(detail))); if (!ok) failed += 1 }
const base = (a) => { const r = parseAddress(a); return r.ok ? r.base : r.error }

console.log('SRV-01 the address typed')
check('a bare host becomes https', base('kb.acme.corp') === 'https://kb.acme.corp', base('kb.acme.corp'))
check('host:port works and stays https', base('kb.acme.corp:8443') === 'https://kb.acme.corp:8443', base('kb.acme.corp:8443'))
check('a full URL keeps its scheme and path, without a trailing slash', base('https://kb.acme.corp/app/') === 'https://kb.acme.corp/app', base('https://kb.acme.corp/app/'))
check('a bare loopback host becomes http (a local server rarely has a certificate)', base('localhost:8791') === 'http://localhost:8791' && base('127.0.0.1:8791') === 'http://127.0.0.1:8791' && base('[::1]:8791') === 'http://[::1]:8791', [base('localhost:8791'), base('127.0.0.1:8791'), base('[::1]:8791')])
check('http is accepted for loopback only', base('http://localhost:8791') === 'http://localhost:8791' && base('http://kb.acme.corp') === 'insecure_address', base('http://kb.acme.corp'))
check('https on loopback is kept as typed', base('https://localhost:8791') === 'https://localhost:8791')
check('surrounding spaces are ignored', base('  kb.acme.corp  ') === 'https://kb.acme.corp')
const AT = String.fromCharCode(64) // credentials in an address are written with this sign; kept out of the source text so no line looks like a mail address
for (const bad of ['', '   ', 'user:pw' + AT + 'kb.acme.corp', 'https://u:p' + AT + 'kb.acme.corp', 'kb.acme.corp?x=1', 'kb.acme.corp#frag', 'https://kb.acme.corp/?a=b', 'x'.repeat(301)]) check('refused: ' + JSON.stringify(bad.slice(0, 30)), parseAddress(bad).ok === false, base(bad))
for (const bad of ['ftp://kb.acme.corp', 'javascript:alert(1)', 'mailto:someone', 'file:///etc/passwd', 'ws://kb.acme.corp']) check('not completed, not accepted: ' + bad, parseAddress(bad).ok === false, base(bad))
check('non-strings are refused', [undefined, null, 5, {}, []].every((v) => parseAddress(v).ok === false))

console.log('versions and slugs')
check('0.1.10 is later than 0.1.7, a suffix after a hyphen is ignored', compareVersions('0.1.10', '0.1.7') === 1 && compareVersions('0.2.1-alpha.4', '0.2.1') === 0 && compareVersions('0.1.6', '0.1.6') === 0 && compareVersions('0.1.5', '0.1.6') === -1)
check('a slug is a safe id: at most 40 characters, never empty', slugFor('Acme Corp', 'x') === 'acme-corp' && slugFor('  ', 'kb.acme.corp') === 'kb-acme-corp' && slugFor('###', '') === 'server' && slugFor('a'.repeat(80), 'x').length === 40)

// ── A server that answers what it is told to ──
const reply = (status, body, headers = {}) => async () => ({ status, headers, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) })
const GOOD = { schema: 1, name: 'Acme Corp', version: '1.4.0', dsh_min: '0.1.6', api: 'https://kb.acme.corp', web: 'https://kb.acme.corp/app', console: 'https://kb.acme.corp/app/workspace-console', services: { llm: 'https://llm.acme.corp', connections: 'https://kb.acme.corp/v1/mcp/connections' } }
const run = (doFetch, extra = {}) => discover('kb.acme.corp', Object.assign({ fetch: doFetch, dshVersion: '0.2.1' }, extra))

console.log('SRV-02 a server that answers: three steps and the profile')
{
  let seen = null
  const r = await run(async (url, init) => { seen = { url, init }; return reply(200, GOOD)() })
  check('it reads the well-known path of the typed address, with no redirect followed', seen.url === 'https://kb.acme.corp' + WELL_KNOWN && seen.init.redirect === 'manual', seen)
  check('three green steps, the version on the last one', r.ok === true && r.steps.map((s) => s.id + ':' + s.ok).join() === 'reach:true,wellknown:true,compat:true' && r.steps[2].note === '1.4.0', r.steps)
  check('the profile carries the name, api, web, console and both services', r.profile.name === 'Acme Corp' && r.profile.api === GOOD.api && r.profile.web === GOOD.web && r.profile.console === GOOD.console && r.profile.services.llm === GOOD.services.llm && r.profile.services.connections === GOOD.services.connections, r.profile)
  check('the published name and the host are reported for the page', r.published === 'Acme Corp' && r.host === 'kb.acme.corp')
}
console.log('SRV-04 services are kept as published')
{
  const only = await run(reply(200, { schema: 1, api: 'https://kb.acme.corp' }))
  check('only `api` is required: no services, no web, no console, the host names the server', only.ok === true && only.profile.services === undefined && only.profile.web === undefined && only.profile.name === 'kb.acme.corp', only.profile)
  const off = await run(reply(200, { schema: 1, api: 'https://kb.acme.corp', services: { llm: false, connections: false } }))
  check('`false` is kept for both (no Kybernos models, no connected apps)', off.profile.services.llm === false && off.profile.services.connections === false, off.profile)
  const junk = await run(reply(200, { schema: 1, api: 'https://kb.acme.corp', services: { llm: 5, connections: ['x'] } }))
  check('a value that is neither a URL nor false is left out (absent = default)', junk.ok === true && junk.profile.services === undefined, junk.profile)
}
console.log('SRV-02 every way it stops names the step')
{
  const stop = async (label, doFetch, error, step, extra) => {
    const r = await run(doFetch, extra)
    check(label, r.ok === false && r.error === error && (step === undefined || r.steps.some((s) => s.id === step.id && s.ok === step.ok)), r)
    return r
  }
  await stop('no answer at all: unreachable, at the first step', async () => { throw new Error('ECONNREFUSED') }, 'unreachable', { id: 'reach', ok: false })
  await stop('a redirect is refused, not followed', reply(301, '', { location: 'https://elsewhere' }), 'redirect', { id: 'reach', ok: false })
  await stop('a 404 says it publishes no profile', reply(404, 'no'), 'no_profile', { id: 'wellknown', ok: false })
  await stop('not JSON', reply(200, 'hello'), 'no_profile', { id: 'wellknown', ok: false })
  await stop('JSON without `api`', reply(200, { schema: 1 }), 'no_profile', { id: 'wellknown', ok: false })
  await stop('an array is not a profile', reply(200, '[]'), 'no_profile')
  await stop('a profile over 64 KB', reply(200, JSON.stringify(Object.assign({}, GOOD, { pad: 'x'.repeat(MAX_BYTES) }))), 'no_profile', { id: 'wellknown', ok: false })
  await stop('an unknown schema is incompatible', reply(200, Object.assign({}, GOOD, { schema: 2 })), 'incompatible', { id: 'compat', ok: false })
  const old = await stop('a server that needs a newer DSH says which version', reply(200, Object.assign({}, GOOD, { dsh_min: '0.9.0' })), 'incompatible', { id: 'compat', ok: false })
  check('…and the version it needs', old.dsh_min === '0.9.0')
  const slow = await discover('kb.acme.corp', { fetch: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), timeoutMs: 60 })
  check('a server that never answers is given up on in time', slow.ok === false && slow.error === 'unreachable', slow)
  let called = false
  const insecure = await discover('http://kb.acme.corp', { fetch: async () => { called = true; return reply(200, GOOD)() } })
  check('an insecure address stops before any request is made', insecure.ok === false && insecure.error === 'insecure_address' && called === false, insecure)
  const unknownDsh = await run(reply(200, Object.assign({}, GOOD, { dsh_min: '9.9.9' })), { dshVersion: null })
  check('when this DSH version is not known, the minimum is not enforced (the server is not refused for a guess)', unknownDsh.ok === true)
}

// ── L3-25: the document is read within bounds ─────────────────────────────────────────────────────────────────────────────────
// A server that answers 200 and then sends without end was read in full by `res.text()` (+2 GB of memory in 3 s) before the size was looked at, and the timer
// stopped at the headers. Nothing below is sent for real over the network except the last case, which stops by itself at 64 MiB: the streams are stand-ins that count
// what is pulled from them.
console.log('SRV-05 a response is read within bounds')
{
  const BLOCK = 16 * 1024
  const within = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve('TIMED OUT'), ms))])
  const counted = (total, extra = {}) => {
    const seen = { pulled: 0, cancelled: false }
    const block = new TextEncoder().encode(' '.repeat(BLOCK))
    const body = new ReadableStream({
      pull (controller) { if (seen.pulled >= total) { controller.close(); return } seen.pulled += BLOCK; controller.enqueue(block) },
      cancel () { seen.cancelled = true },
    }, { highWaterMark: 0 })
    return { seen, fetch: async () => new Response(body, { status: 200, headers: extra }) }
  }
  {
    const { seen, fetch } = counted(64 * 1024 * 1024)
    const r = await within(run(fetch), 5000)
    check('a body that goes on for 64 MiB is refused after about 64 KB, as an unreadable profile', r !== 'TIMED OUT' && r.ok === false && r.error === 'no_profile' && r.steps.some((x) => x.id === 'wellknown' && x.note === 'unreadable'), r)
    check('…at most 3 blocks past the limit were pulled (' + Math.round(seen.pulled / 1024) + ' KiB), and the stream was cancelled', seen.pulled <= MAX_BYTES + 3 * BLOCK && seen.cancelled === true, seen)
  }
  {
    const { seen, fetch } = counted(64 * 1024 * 1024, { 'content-length': String(64 * 1024 * 1024) })
    const r = await within(run(fetch), 5000)
    check('a body that announces more than the limit is refused before a byte is pulled', r !== 'TIMED OUT' && r.ok === false && r.error === 'no_profile' && seen.pulled === 0 && seen.cancelled === true, { r, seen })
  }
  {
    // The headers and one block arrive, then nothing: the timer must still be running. Like a real connection, the stream fails when the request is aborted.
    const stalled = async (url, init) => new Response(new ReadableStream({
      start (controller) { controller.enqueue(new TextEncoder().encode('{"schema":1,')) },
      pull () { return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))) },
    }), { status: 200 })
    const started = Date.now()
    const r = await within(discover('kb.acme.corp', { fetch: stalled, timeoutMs: 80 }), 4000)
    check('a body that stalls after the headers is given up on at the time limit, not waited for', r !== 'TIMED OUT' && r.ok === false && r.error === 'no_profile' && Date.now() - started < 3000, r)
  }
  {
    // The only real network of this file: a loopback server that answers 200 and writes 16 KiB blocks (honouring back-pressure) until it has written 64 MiB or the client is gone.
    const http = await import('node:http')
    let written = 0
    let clientGone = false
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      const block = Buffer.alloc(BLOCK, 0x20)
      res.on('close', () => { clientGone = true })
      const pump = () => {
        while (written < 64 * 1024 * 1024 && !clientGone) { written += BLOCK; if (res.write(block) === false) { res.once('drain', pump); return } }
        if (!clientGone) res.end()
      }
      pump()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const r = await within(discover('127.0.0.1:' + server.address().port, { timeoutMs: 4000 }), 6000)
    await new Promise((resolve) => setTimeout(resolve, 100))
    check('a real server that keeps sending is cut: no profile, and nowhere near 64 MiB left the server (' + Math.round(written / 1024) + ' KiB)', r !== 'TIMED OUT' && r.ok === false && r.error === 'no_profile' && clientGone === true && written < 16 * 1024 * 1024, { r, written, clientGone })
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
}

console.log(failed === 0 ? '\nall good' : '\n' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)
