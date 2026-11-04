#!/usr/bin/env node
// Case J21-03 of docs/tests/user-journey: the plans are called Free, Plus and Pro everywhere a person reads; the words of the catalogue's insides (solo, studio, scale as a plan, pot, tier, component, entitlement)
// never reach a page. Reads the visible text of the public site (every page of the sitemap) and of the server's legal documents in English, read only, and checks two things:
//   W1 none of the internal words appears as a plan or price word (a context list keeps « Design studio », « to scale », « open-source components » and a third party's « free tier » out);
//   W2 the terms name every plan the pricing page sells (a person who buys Plus must find « Plus » in what they accept).
//
//   node scripts/check-wording-cross.mjs [--site https://kybernos.app] [--server https://api.kybernos.app] [--json]
//
// Not covered: the app's own strings and the server's account pages (they are drawn by scripts; read them with the walkers of `user-journey-run.mjs`). Exit 0 when every check passed, 1 otherwise, 2 on a refusal.
import { pathToFileURL } from 'node:url'
import { textOf } from './crawl-site.mjs'

const UA = { 'user-agent': 'kybernos-recette/1' }
const get = async (url) => { try { const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) }); return { status: r.status, body: await r.text() } } catch (e) { return { status: 0, body: '', error: String(e.message || e) } } }

/** The internal words, each with the contexts in which it is a plan or price word (a match outside them is fine). Exported for the tests. */
export const BANNED = [
  ['solo', /\bsolo\b/i, null],
  ['studio', /\bstudio\b/i, /(avatar|design|recording|photo|film|dance|yoga|art|sound|music)\s+studio|studio\s+(ghibli|apartment)/i],
  ['scale plan', /\b(scale\s+(plan|pack|offer)|(plan|pack|offer)\s*(called|named|:)?\s*scale)\b/i, null],
  ['pot', /\bpots?\b/i, /\b(flower|coffee|tea|hot|melting|crock|honey)\s+pots?\b|\bpot\s+of\b/i],
  ['tier (of a plan)', /\b(plan|plans|pack|price|pricing|credit|subscription)s?\b[^.]{0,40}\btiers?\b|\btiers?\b[^.]{0,20}\b(plan|price|pricing)\b/i, /free tier of (opencode|a third|the provider)/i],
  ['component (of a price)', /\b(price|plan|billing|credit|band|seat)s?\W+(\w+\W+){0,3}components?\b|\bcomponents?\W+(\w+\W+){0,3}(price|plan|billing)\b/i, null],
  ['entitlement', /\bentitlements?\b/i, null]
]

export function findBanned (text) {
  const out = []
  for (const [name, re, allow] of BANNED) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
    for (const m of text.matchAll(g)) {
      const ctx = text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50)
      if (allow !== null && allow.test(ctx)) continue
      out.push({ word: name, context: ctx.trim() })
    }
  }
  return out
}

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
  const site = opt('--site', 'https://kybernos.app').replace(/\/$/, '')
  const server = opt('--server', 'https://api.kybernos.app').replace(/\/$/, '')
  if (!/^https:\/\//.test(site) || !/^https:\/\//.test(server)) { console.error('check-wording-cross: both origins must be https (it reads the live public pages, read only)'); process.exit(2) }
  const results = []
  const check = (id, ok, detail) => { results.push({ id, ok }); console.log(`  ${ok ? '✓' : '✗'} ${id}${detail ? ' — ' + detail : ''}`) }
  console.log('J21-03 plan names across the site and the legal documents')

  const sm = await get(`${site}/sitemap.xml`)
  const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const legal = ['terms', 'privacy', 'legal-notice', 'dpa', 'acceptable-use', 'subprocessors'].map((d) => `${server}/legal/${d}?lang=en`)
  const found = []
  const texts = {}
  for (const u of urls.concat(legal)) {
    const r = await get(u)
    if (r.status !== 200) { found.push({ where: u, word: 'page', context: `answered ${r.status}` }); continue }
    const t = textOf(r.body).replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ')
    texts[u] = t
    for (const f of findBanned(t)) found.push({ where: u.replace(/^https:\/\//, ''), ...f })
  }
  check('W1 no internal word of the catalogue reaches a page as a plan or price word', found.length === 0 && urls.length > 0, `${urls.length} site pages and ${legal.length} legal documents read` + (found.length ? '; ' + found.slice(0, 4).map((f) => `${f.where}: « ${f.context} » (${f.word})`).join(' | ') : ''))

  const pricing = Object.entries(texts).find(([u]) => /\/pricing\/?$/.test(u))
  const sold = pricing ? ['Free', 'Plus', 'Pro'].filter((p) => new RegExp('\\b' + p + '\\b').test(pricing[1])) : []
  check('W0 the pricing page sells Free, Plus and Pro', sold.length === 3, pricing ? `names found: ${sold.join(', ')}` : 'no pricing page in the sitemap')
  const terms = texts[`${server}/legal/terms?lang=en`] || ''
  const missing = sold.filter((p) => p !== 'Free' && !new RegExp('\\b' + p + '\\b').test(terms))
  check('W2 the terms name the paid plans the pricing page sells (Free is a plain word, not looked for)', terms !== '' && sold.length > 0 && missing.length === 0, missing.length ? `the terms never say: ${missing.join(', ')} (they say « individual Plan », « team Plan »)` : 'Plus and Pro are named')

  if (argv.includes('--json')) console.log(JSON.stringify({ results, found }, null, 2))
  else { const failed = results.filter((r) => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`) }
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })
