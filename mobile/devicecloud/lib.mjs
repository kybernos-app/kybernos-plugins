// Shared helpers of the device-cloud runners: the .env file, BrowserStack authentication, and redaction. Values never reach a log, a file or a command line.
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const MOBILE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
export const API = 'https://api-cloud.browserstack.com'
export const HUB = 'https://hub-cloud.browserstack.com/wd/hub'

/** Reads mobile/.env (KEY=VALUE lines, # comments) into process.env without overriding what is already set. Returns the names that now have a value. */
export const loadEnv = (file = join(MOBILE_DIR, '.env')) => {
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
      if (m === null || line.trim().startsWith('#')) continue
      const value = m[2].replace(/^(["'])(.*)\1$/, '$2')
      if (value !== '' && process.env[m[1]] === undefined) process.env[m[1]] = value
    }
  }
  return ['ANTHROPIC_API_KEY', 'BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY', 'BROWSERSTACK_BUDGET_MINUTES'].filter((n) => (process.env[n] ?? '') !== '')
}

export const requireEnv = (names) => {
  const missing = names.filter((n) => (process.env[n] ?? '') === '')
  if (missing.length > 0) throw new Error('missing in mobile/.env: ' + missing.join(', ') + ' (see mobile/env.example)')
}

export const authHeader = () => 'Basic ' + Buffer.from(process.env.BROWSERSTACK_USERNAME + ':' + process.env.BROWSERSTACK_ACCESS_KEY).toString('base64')

/** Masks every secret this process knows, plus anything shaped like an Anthropic key. */
export const redact = (text) => {
  let s = String(text).replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…')
  for (const n of ['ANTHROPIC_API_KEY', 'BROWSERSTACK_ACCESS_KEY']) { const v = process.env[n]; if (v) s = s.split(v).join('***') }
  return s
}

/** The environment for child processes (builds, signing): no keys. */
export const cleanEnv = (extra = {}) => {
  const env = { ...process.env, ...extra }
  for (const n of ['ANTHROPIC_API_KEY', 'BROWSERSTACK_ACCESS_KEY', 'BROWSERSTACK_USERNAME']) delete env[n]
  return env
}

export const api = async (method, path, { body, timeoutMs = 60000 } = {}) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(API + path, { method, headers: { Authorization: authHeader() }, body, signal: ctl.signal })
    const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: r.status, json, text }
  } finally { clearTimeout(t) }
}

const xmlEscape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** Adds `<key>name</key><string>value</string>` to the top-level dict of an XML Info.plist. Done in JavaScript so the value never appears on a command line. */
export const injectPlistString = (xml, name, value) => {
  const i = xml.lastIndexOf('</dict>')
  if (i < 0) throw new Error('not an XML plist')
  if (xml.includes('<key>' + name + '</key>')) throw new Error(name + ' is already in the plist')
  return xml.slice(0, i) + '<key>' + xmlEscape(name) + '</key><string>' + xmlEscape(value) + '</string>\n' + xml.slice(i)
}
