#!/usr/bin/env node
// Case J20-06 of docs/tests/user-journey, and the gate of README §2: nothing that can spend or open anything is left in the evidence of a run (verdict files, logs, recorded traffic, pictures' text sidecars).
// Reads every text file under a folder (images and other binaries are skipped by name and by content) and reports, without ever printing the value found, only its kind, file and line.
//
//   node scripts/scan-secrets-in-evidence.mjs <evidence folder> [--json]
//
// HARD findings (exit 1): a live Stripe key (sk_live, pk_live, rk_live), a webhook signing secret (whsec_), a private key block, a 16-digit number that passes Luhn and is not one of Stripe's published test cards,
// a JWT or an `Authorization: Bearer` value of 40 characters or more, an AWS access key id, a GitHub or Slack token. SOFT findings (listed, exit 0): a test secret key (sk_test), a published test card number, an e-mail
// address outside the made-up domains of the recette. A folder with nothing readable is a refusal (exit 2), not a pass.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const SKIP_EXT = /\.(png|jpe?g|gif|webp|mp4|mov|zst|gz|zip|woff2?|ttf|pdf|sqlite|db|bin|ico)$/i
const TEST_CARDS = new Set(['4242424242424242', '4000002760003184', '4000000000000002', '4000000000009995', '4000000000000069', '4000000000000127', '4000000000000119', '4000000000000341', '4000000000000259', '5555555555554444', '4111111111111111', '4000000000003220', '378282246310005'])
const MADE_UP_MAIL = /@(replica\.test|example\.(test|com|org)|e2e\.test|yopmail\.com|localhost)$/i

export function luhn (digits) {
  let sum = 0
  let dbl = false
  for (let i = digits.length - 1; i >= 0; i--) { let d = +digits[i]; if (dbl) { d *= 2; if (d > 9) d -= 9 } sum += d; dbl = !dbl }
  return sum % 10 === 0
}

const HARD = [
  ['live Stripe key', /\b(?:sk|pk|rk)_live_[A-Za-z0-9]{8,}/g],
  ['webhook signing secret', /\bwhsec_[A-Za-z0-9]{16,}/g],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{20,}/g],
  ['JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['bearer value', /Bearer\s+[A-Za-z0-9._~+/=-]{40,}/g]
]

// A number in a script or a style sheet saved as evidence (the public site's bundle, say) is a constant of the code, and 16 digits in minified code pass the Luhn check by chance about one time in ten.
const CODE_FILE = /\.(?:m?js|cjs|css|map|svg)$/i

/** Findings of one text: `{ kind, hard, line }` (never the value). `file` is its name, when known. Pure. */
export function scanText (text, file = '') {
  const out = []
  const lines = text.split('\n')
  lines.forEach((ln, i) => {
    for (const [kind, re] of HARD) { re.lastIndex = 0; if (re.test(ln)) out.push({ kind, hard: true, line: i + 1 }) }
    if (!CODE_FILE.test(file)) for (const m of ln.matchAll(/(?<![\w.-])(?:\d{13,19}|\d{4}(?:[ -]\d{4}){3}|\d{4}[ -]\d{6}[ -]\d{5})(?![\w.-])/g)) {
      const digits = m[0].replace(/\D/g, '')
      if (digits.length < 13 || digits.length > 19 || !luhn(digits)) continue
      if (/^1[0-9]{12}$/.test(digits) || /^[0-9]{13}$/.test(digits) && Number(digits) > 1e12 && Number(digits) < 2.5e12) continue // a millisecond timestamp
      out.push(TEST_CARDS.has(digits) ? { kind: 'published test card number', hard: false, line: i + 1 } : { kind: 'card-like number that is not a published test card', hard: true, line: i + 1 })
    }
    if (/\bsk_test_[A-Za-z0-9]{8,}/.test(ln)) out.push({ kind: 'test secret key', hard: false, line: i + 1 })
    for (const m of ln.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) if (!MADE_UP_MAIL.test(m[0])) out.push({ kind: 'e-mail outside the made-up domains', hard: false, line: i + 1 })
  })
  return out
}

function* walk (dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try { st = statSync(p) } catch { continue }
    if (st.isDirectory()) { if (name !== 'node_modules') yield* walk(p) } else if (!SKIP_EXT.test(name) && st.size <= 64 * 1024 * 1024) yield p
  }
}

function main () {
  const argv = process.argv.slice(2)
  const dir = argv.find((a) => !a.startsWith('--'))
  if (!dir || !existsSync(dir) || !statSync(dir).isDirectory()) { console.error('usage: scan-secrets-in-evidence <evidence folder> [--json]'); process.exit(2) }
  const root = resolve(dir)
  const findings = []
  let files = 0
  for (const p of walk(root)) {
    let buf
    try { buf = readFileSync(p) } catch { continue }
    if (buf.subarray(0, 4096).includes(0)) continue
    files += 1
    for (const f of scanText(buf.toString('utf8'), p)) findings.push({ file: p.slice(root.length + 1), ...f })
  }
  if (files === 0) { console.error('scan-secrets-in-evidence: no readable file under that folder'); process.exit(2) }
  const hard = findings.filter((f) => f.hard)
  const soft = findings.filter((f) => !f.hard)
  if (argv.includes('--json')) console.log(JSON.stringify({ files, hard, soft }, null, 2))
  else {
    console.log(`J20-06 evidence scan: ${files} files, ${hard.length} hard finding(s), ${soft.length} soft`)
    const group = (list) => { const g = new Map(); for (const f of list) { const k = `${f.kind} — ${f.file}`; g.set(k, (g.get(k) || []).concat(f.line)) } return g }
    for (const [k, lines] of group(hard)) console.log(`  ✗ ${k} (line ${lines.slice(0, 5).join(', ')}${lines.length > 5 ? ` … ${lines.length} in all` : ''})`)
    for (const [k, lines] of [...group(soft)].slice(0, 10)) console.log(`  · ${k} (${lines.length} line${lines.length === 1 ? '' : 's'})`)
  }
  process.exit(hard.length === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
