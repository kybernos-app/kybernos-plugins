// A pooled cloud computer's claimer. A computer made ahead of need boots with no identity (no id, no token: only the platform's address and a POOL token that opens the platform's
// two pool routes and nothing else), says that it is up, and waits. It is then put to sleep by the platform (a suspended machine keeps its memory and wakes in about a second), and
// when a person needs a computer the platform wakes it and has the next poll answer with the identity. The claimer writes it to the volume (computer-identity.mjs), asks DSH to put
// the token in its credential store, and ends: the entrypoint then goes on as for any computer (the model route, the account link, the reporter, the runner, the gate).
//
//   KYBERNOS_API            the platform's address        KYBERNOS_POOL_TOKEN   the slot's token (never in the environment of anything else)
//   KYBERNOS_POOL_SLOT      the slot's id (not secret): the plugin honours the identity on the volume only where it is set
//   DSH_HOME                the profile on the volume     DSH_PORT              DSH's loopback port (3081)
//   KYBERNOS_IMAGE_VERSION  a short build name, sent once
//
//   POST /v1/pool/ready   {version}   → 200            « I am booted and unclaimed: put me to sleep when you like »
//   POST /v1/pool/claim   {}          → 200 {claimed:false}  or  200 {claimed:true, computer_id, token, model}
//                                       (a claimed slot is answered again, with a fresh token, until its computer says ready: an answer lost on the way is not a lost computer)
//
// Nothing here opens a port, and nothing is taken from an answer but those three fields: the platform's address is the machine's own (its environment), never one an answer names.
// Every request goes on a connection of its own: a socket that was open when the machine was suspended is dead when it wakes, and the first poll after a wake must not wait for it.
// It never reads a person's data (it runs before there is a person) and ends with 0 (claimed and applied), 3 (claimed and written, but DSH did not take the token: the entrypoint
// restarts DSH) or 1 (it was asked to stop).
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { cleanIdentity, readIdentity, writeIdentity } from './computer-identity.mjs'

const log = (line) => console.log('[claimer] ' + line)
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** One request on its own connection. Never throws: a status of 0 is « could not be sent ». */
export function send (method, url, { headers = {}, body, timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    let target
    try { target = new URL(url) } catch (e) { resolve({ status: 0, json: null }); return }
    const payload = body === undefined ? null : JSON.stringify(body)
    const make = target.protocol === 'https:' ? httpsRequest : httpRequest
    const req = make(target, {
      method,
      agent: false,
      headers: { connection: 'close', accept: 'application/json', ...(payload === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }), ...headers },
      timeout: timeoutMs
    }, (res) => {
      const chunks = []
      let size = 0
      res.on('data', (c) => { size += c.length; if (size <= 65536) chunks.push(c) })
      res.on('end', () => {
        let json = null
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (e) { /* not json */ }
        resolve({ status: res.statusCode || 0, json })
      })
      res.on('error', () => resolve({ status: 0, json: null }))
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve({ status: 0, json: null }))
    if (payload !== null) req.write(payload)
    req.end()
  })
}

/**
 * Waits for the claim and applies it. Returns what it ended as: 'claimed' (identity on the volume, token in DSH's store), 'written' (identity on the volume, DSH did not take it),
 * 'already' (a claim was already on the volume) or 'stopped'. Everything is injectable for a test: the clock, the pause, and the number of polls it may make.
 */
export async function waitForClaim (options) {
  const api = String(options.api || '').replace(/\/+$/u, '')
  const poolToken = String(options.poolToken || '')
  const home = String(options.home || '')
  const dshPort = Number(options.dshPort || 3081)
  const pollMs = options.pollMs ?? 500
  const sleep = options.sleep ?? defaultSleep
  const maxPolls = options.maxPolls ?? Infinity
  const version = String(options.version || '').replace(/[^A-Za-z0-9._+-]/gu, '').slice(0, 40)
  const say = options.log ?? log
  if (api === '' || poolToken === '' || home === '' || !options.slot) { say('no platform, pool token, slot or profile given: nothing to wait for'); return 'stopped' }
  if (readIdentity(home) !== null) return 'already'
  const auth = { authorization: 'Bearer ' + poolToken }
  const local = `http://127.0.0.1:${dshPort}`

  // DSH first: a computer that says it is up has a DSH that answers, and the claim needs it.
  for (let n = 0; n < maxPolls; n += 1) {
    const r = await send('GET', local + '/', { timeoutMs: 2500 })
    if (r.status > 0) break
    await sleep(pollMs)
  }

  // « Ready »: until the platform has heard it (it can be a moment behind the machine).
  let heard = false
  for (let attempt = 0; !heard && attempt < maxPolls; attempt += 1) {
    const r = await send('POST', api + '/v1/pool/ready', { headers: auth, body: version === '' ? {} : { version } })
    if (r.status === 200) { heard = true; say('ready: the platform knows this slot is up and unclaimed'); break }
    await sleep(r.status === 401 || r.status === 403 || r.status === 404 ? 5000 : Math.min(5000, 1000 * (attempt + 1)))
  }

  for (let n = 0; n < maxPolls; n += 1) {
    // A short timeout: the platform answers at once, and a request that was in flight when the machine was suspended is dead when it wakes (the next poll must not wait long for it).
    const r = await send('POST', api + '/v1/pool/claim', { headers: auth, body: {}, timeoutMs: 2000 })
    const j = r.status === 200 && r.json !== null && typeof r.json === 'object' ? r.json : null
    if (j !== null && j.claimed === true) {
      // The address is the machine's own; an answer cannot move it.
      const identity = cleanIdentity({ api, computer_id: j.computer_id, token: j.token, model: j.model })
      if (identity === null) { say('a claim came with an identity that is not valid: ignored'); await sleep(pollMs); continue }
      try {
        if (!writeIdentity(home, identity)) { say('the identity could not be written'); await sleep(pollMs); continue }
      } catch (e) { say('the identity could not be written: ' + String((e && e.code) || e)); await sleep(pollMs); continue }
      say('claimed: identity on the volume')
      // DSH puts the token where its model route looks for it. It answered a moment ago; a restart in between is retried for a few seconds.
      for (let attempt = 0; attempt < (options.applyAttempts ?? 20); attempt += 1) {
        const a = await send('POST', local + '/kybernos-cloud/computer/claimed', { headers: { origin: local }, body: {}, timeoutMs: 5000 })
        if (a.status === 200 && a.json !== null && a.json.ok === true) { say('claimed: DSH holds the token'); return 'claimed' }
        await sleep(pollMs)
      }
      say('claimed, but DSH did not take the token: it will be restarted')
      return 'written'
    }
    await sleep(r.status === 0 || r.status === 200 ? pollMs : Math.max(pollMs, 2000))
  }
  return 'stopped'
}

/** Waits (for a few seconds) until DSH says its model route is live: the entrypoint writes the route to the profile after the claim, and the profile is reloaded by DSH itself. */
export async function waitForRoute (options) {
  const dshPort = Number(options.dshPort || 3081)
  const sleep = options.sleep ?? defaultSleep
  const local = `http://127.0.0.1:${dshPort}`
  const deadline = (options.now ?? Date.now)() + (options.timeoutMs ?? 20000)
  let silent = 0
  for (;;) {
    const a = await send('GET', local + '/kybernos-cloud/computer/route', { headers: { origin: local }, timeoutMs: 3000 })
    if (a.status === 200 && a.json !== null && a.json.ok === true && a.json.route === true) return true
    // A DSH that does not answer at all (it crashed during the reload) will not get there: say so now, the entrypoint restarts it.
    silent = a.status === 0 ? silent + 1 : 0
    if (silent >= (options.silentPolls ?? 12)) return false
    if ((options.now ?? Date.now)() > deadline) return false
    await sleep(options.pollMs ?? 250)
  }
}

async function main () {
  // `claimer.mjs route`: after the claim, waits for the model route (exit 0 once it is live, 1 when it never was).
  if (process.argv[2] === 'route') process.exit((await waitForRoute({ dshPort: process.env.DSH_PORT })) ? 0 : 1)
  const out = await waitForClaim({
    api: process.env.KYBERNOS_API,
    poolToken: process.env.KYBERNOS_POOL_TOKEN,
    slot: process.env.KYBERNOS_POOL_SLOT,
    home: process.env.DSH_HOME,
    dshPort: process.env.DSH_PORT,
    version: process.env.KYBERNOS_IMAGE_VERSION
  })
  process.exit(out === 'claimed' || out === 'already' ? 0 : out === 'written' ? 3 : 1)
}

// Run as a program; a test imports the functions above and starts nothing.
if (process.argv[1] !== undefined && import.meta.url === new URL('file://' + process.argv[1]).href) {
  main().catch((e) => { log('stopped: ' + String((e && e.message) || e)); process.exit(1) })
}
