// boot.mjs — what the entry points (server.js, scripts/mint-link.mjs) read from the outside: the environment and the data folder.
//
//   PORT             the port to listen on (the apps runtime sets it)
//   KB_HOST          the address to listen on, 127.0.0.1 unless a container needs more
//   KB_PUBLIC_URL    where people reach the app (https://…); without it the app answers to its own loopback address
//   KB_AUTH_SECRET   32+ characters; KB_BOOT_KEY  32+ hex characters. Both generated into <data>/secrets.json when absent (a local run); a hosted run passes them
//   KB_DATA_DIR      where auth.sqlite, apps/ and secrets.json live (default: ./data)
//   KB_TRUST_PROXY   1 when a reverse proxy sets x-forwarded-for
//   KB_BUNDLE_MAX_BYTES   the most an app bundle may weigh when the owner's computer sends one (default 256 MiB, 1 MiB to 2 GiB)
//   KB_MAIL_API_KEY, KB_MAIL_FROM, KB_MAIL_REPLY_TO, KB_MAIL_API_BASE   invitations by e-mail through Resend (lib/mailer.mjs); with no key nothing is sent and the owner gets the link
//   KB_REGION_LABEL, KB_PRIVACY_CONTACT   what the privacy page says: where the space lives, and who to ask (when unset it says « ask the owner »; no address is ever made up)
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_MAX_BYTES } from './db.mjs'
import { mailConfig } from './mailer.mjs'
import { DEFAULT_REGION } from './privacy.mjs'
import { SECRETS_FILE, resolveSecrets } from './secrets.mjs'

export const BUNDLE_MAX_FLOOR = 1024 * 1024
export const BUNDLE_MAX_CEILING = 2 * 1024 * 1024 * 1024

/** A line of text from the environment, cleaned of control characters and cut to `max`; null when nothing is left. */
export const settingText = (text, max) => {
  const t = typeof text === 'string' ? text.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
  return t === '' ? null : t
}

/** The cap of a bundle from the environment's text (`KB_BUNDLE_MAX_BYTES`); the default when it is empty. Throws on anything else. */
export function bundleCap (text) {
  if (text === undefined || text === '') return DEFAULT_MAX_BYTES
  const n = Number(text)
  if (!Number.isInteger(n) || n < BUNDLE_MAX_FLOOR || n > BUNDLE_MAX_CEILING) throw new Error('KB_BUNDLE_MAX_BYTES must be a whole number of bytes, ' + BUNDLE_MAX_FLOOR + ' to ' + BUNDLE_MAX_CEILING)
  return n
}

export function loadConfig (env, root, { needPort = true } = {}) {
  const dataDir = env.KB_DATA_DIR ? resolve(env.KB_DATA_DIR) : join(root, 'data')
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const file = join(dataDir, SECRETS_FILE)
  const secrets = resolveSecrets({
    env,
    read: () => JSON.parse(readFileSync(file, 'utf8')),
    write: (obj) => { writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 }); chmodSync(file, 0o600) },
  })
  const mail = mailConfig(env)
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
    bundleMaxBytes: bundleCap(env.KB_BUNDLE_MAX_BYTES),
    mail: mail.config ?? undefined,
    mailProblem: mail.problem,
    privacy: { region: settingText(env.KB_REGION_LABEL, 120) ?? DEFAULT_REGION, contact: settingText(env.KB_PRIVACY_CONTACT, 200) },
  }
}
