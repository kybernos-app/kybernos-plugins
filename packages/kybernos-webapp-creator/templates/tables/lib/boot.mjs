// boot.mjs — what the entry points (server.js, scripts/mint-link.mjs) read from the outside: the environment and the data folder.
//
//   PORT             the port to listen on (the apps runtime sets it)
//   KB_HOST          the address to listen on, 127.0.0.1 unless a container needs more
//   KB_PUBLIC_URL    where people reach the app (https://…); without it the app answers to its own loopback address
//   KB_AUTH_SECRET   32+ characters; KB_BOOT_KEY  32+ hex characters. Both generated into <data>/secrets.json when absent (a local run); a hosted run passes them
//   KB_DATA_DIR      where auth.sqlite, apps/ and secrets.json live (default: ./data)
//   KB_TRUST_PROXY   1 when a reverse proxy sets x-forwarded-for
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SECRETS_FILE, resolveSecrets } from './secrets.mjs'

export function loadConfig (env, root, { needPort = true } = {}) {
  const dataDir = env.KB_DATA_DIR ? resolve(env.KB_DATA_DIR) : join(root, 'data')
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const file = join(dataDir, SECRETS_FILE)
  const secrets = resolveSecrets({
    env,
    read: () => JSON.parse(readFileSync(file, 'utf8')),
    write: (obj) => { writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 }); chmodSync(file, 0o600) },
  })
  const port = env.PORT === undefined || env.PORT === '' ? undefined : Number(env.PORT)
  if (needPort && !(Number.isInteger(port) && port >= 1 && port <= 65535)) throw new Error('PORT must be a port number')
  return {
    dataDir,
    authSecret: secrets.authSecret,
    bootKey: secrets.bootKey,
    port,
    host: env.KB_HOST || '127.0.0.1',
    publicUrl: env.KB_PUBLIC_URL || undefined,
    trustProxy: env.KB_TRUST_PROXY === '1',
  }
}
