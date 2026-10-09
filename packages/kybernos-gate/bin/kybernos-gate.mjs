#!/usr/bin/env node
// kybernos-gate            run the gate (configuration from the environment, see README.md)
// kybernos-gate hash       print a scrypt verifier for KYBERNOS_GATE_PASSWORD_HASH (reads the password from stdin)
import { createInterface } from 'node:readline'
import { ConfigError, loadConfig } from '../core/config.mjs'
import { hashPassword } from '../core/password.mjs'
import { createGate } from '../core/server.mjs'

const args = process.argv.slice(2)

if (args[0] === 'hash') {
  const rl = createInterface({ input: process.stdin, terminal: false })
  const password = await new Promise((resolve) => { rl.once('line', resolve); rl.once('close', () => resolve('')) })
  rl.close()
  if (password.length < 8) { console.error('the password must be at least 8 characters (read one line from stdin)'); process.exit(2) }
  console.log(await hashPassword(password))
  process.exit(0)
}
if (args.length > 0) { console.error('usage: kybernos-gate [hash]'); process.exit(2) }

let config
try {
  config = await loadConfig(process.env, { warn: (message) => console.error('[gate] ' + message) })
} catch (e) {
  if (e instanceof ConfigError) { console.error('[gate] ' + e.message); process.exit(2) }
  throw e
}
const gate = createGate(config)
const address = await gate.listen()
console.log(`[gate] listening on ${address.address}:${address.port}, forwarding to ${config.upstream.origin} (user "${config.user}", sessions ${config.sessionDays} days${config.trustProxy ? ', behind a trusted proxy' : ''})`)

const stop = async () => { await gate.close(); process.exit(0) }
process.on('SIGTERM', stop)
process.on('SIGINT', stop)
