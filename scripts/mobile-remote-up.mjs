// Try the phone link with a REAL phone, against a REAL Kybernos server, from one terminal.
//
//   source scripts/sandbox/env.sh && scripts/sandbox/start.sh        # an isolated DSH serving this checkout
//   KYBERNOS_SERVER_DIR=<kybernos-server checkout> node scripts/mobile-remote-up.mjs
//
// It opens a public https tunnel (ngrok, the person's own account), starts the application of kybernos-server on an
// embedded Postgres (scripts/replica.ts there: made-up owner, stand-ins for payments and models, nothing real), publishes a
// plan that lists the phone link, connects the isolated DSH to it, and shows the QR code in this terminal. Scan it with the
// phone's camera. The tunnel's free plan shows a one-time warning page on the first visit: tap "Visit Site".
// The phone then asks for the 4-digit check: compare it with the one printed here and answer y. Ctrl-C ends everything and puts
// the isolated DSH's files back.
import { createInterface } from 'node:readline'
import { startBackend } from './lib-mobile-remote-backend.mjs'

const HOST = process.env.KB_HOST || ''
if (HOST === '' || HOST === '127.0.0.1:3080' || !(process.env.DSH_HOME || '').includes('.kybernos-sandbox')) {
  console.error('This needs the isolated DSH (source scripts/sandbox/env.sh && scripts/sandbox/start.sh), never the real one.')
  process.exit(2)
}
const BASE = 'http://' + HOST
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function host (method, path) {
  const res = await fetch(BASE + '/kybernos-mobile/remote/' + path, {
    method,
    headers: { origin: BASE, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    body: method === 'POST' ? '{}' : undefined,
  })
  return res.json()
}

/** Black modules on white whatever the terminal's theme: two rows of the code per line, drawn with explicit colours. */
function drawQr (modules) {
  const size = modules.length
  const quiet = 4
  const at = (r, c) => r >= 0 && c >= 0 && r < size && c < size && modules[r][c] === '1'
  const lines = []
  for (let r = -quiet; r < size + quiet; r += 2) {
    let line = ''
    for (let c = -quiet; c < size + quiet; c += 1) {
      const top = at(r, c)
      const bottom = at(r + 1, c)
      line += '\x1b[' + (top ? 30 : 97) + ';' + (bottom ? 40 : 107) + 'm▀'
    }
    lines.push(line + '\x1b[0m')
  }
  return lines.join('\n')
}

const ask = (question) => new Promise((resolve) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()) })
})

const backend = await startBackend({ real: true, serverDir: process.env.KYBERNOS_SERVER_DIR, log: (m) => console.log('  . ' + m) })
let stopping = false
const shutdown = async (code) => {
  if (stopping) return
  stopping = true
  console.log('\nstopping: the tunnel, the server, and the isolated DSH\'s files are put back')
  try { await host('POST', 'pair/cancel') } catch (e) { /* the DSH may be gone */ }
  await backend.close()
  process.exit(code)
}
process.on('SIGINT', () => { void shutdown(0) })
process.on('SIGTERM', () => { void shutdown(0) })

try {
  // The isolated DSH reads its server entry at the first request: wait until it says the link is usable.
  let st = null
  for (let i = 0; i < 60; i += 1) {
    st = await host('GET', 'status').catch(() => null)
    if (st !== null && st.available === true && st.connected === true && st.configured === true && st.entitled === true) break
    await sleep(1000)
  }
  if (st === null || st.entitled !== true) throw new Error('the DSH does not offer the phone link: ' + JSON.stringify(st))

  let lastUrl = null
  let announced = false
  console.log('\nThe phone link is ready on ' + backend.phoneOrigin)
  await host('POST', 'pair')
  for (;;) {
    st = await host('GET', 'status')
    const p = st.pairing
    if (p === null || p === undefined) {
      if (st.devices.length > 0 && st.devices.some((d) => d.online)) {
        if (!announced) { announced = true; console.log('\nThe phone is linked and the computer\'s DSH page runs on it. Ctrl-C ends the test.') }
      } else {
        await host('POST', 'pair')
      }
    } else if (p.state === 'verify') {
      console.log('\nThe phone asks to be linked: ' + p.phone_label)
      console.log('The check number is  ' + p.sas + '  : does the phone show the same one?')
      const answer = await ask('Approve? [y/N] ')
      if (answer === 'y' || answer === 'yes' || answer === 'o' || answer === 'oui') { await host('POST', 'pair/approve'); console.log('approved') } else { await host('POST', 'pair/deny'); console.log('refused') }
    } else if (p.qr !== null && p.url !== null && p.url !== lastUrl) {
      lastUrl = p.url
      console.log('\nScan this with the phone\'s camera (first visit: tap "Visit Site" on the tunnel\'s warning page):\n')
      console.log(drawQr(p.qr.modules))
      console.log('\n' + p.url.replace(/#.*/u, '#...'))
    }
    await sleep(1000)
  }
} catch (e) {
  console.error('\n' + (e && e.message ? e.message : e))
  await shutdown(1)
}
