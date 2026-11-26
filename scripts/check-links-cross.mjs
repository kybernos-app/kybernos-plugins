#!/usr/bin/env node
// Case J21-04 of docs/tests/user-journey: the legal and support links a person meets on the public site, in the server's own pages and in what the app reads from the server all lead to the same live pages.
// The app does not hold legal links of its own: it reads them from the active server (`GET /v1/public/legal`, which the DSH route /kybernos-cloud/legal proxies), so the server's index is the reference.
//
//   node scripts/check-links-cross.mjs [--site https://kybernos.app] [--server https://api.kybernos.app] [--json]
//
// Read only: GET requests, no cookie. Checks: L1 the index lists the documents and each answers 200 in English and French; L2 the two documents the app shows (terms, privacy) have the address the pages are served at;
// L3 every legal link on the site's pages goes to the server's origin and to a listed document (documents the site never links to are listed, not failed); L4 each document names a contact address at the product's
// domain, and the addresses found are listed so the owner can see that « the one support address » is one. Exit 0 when every check passed, 1 otherwise, 2 on a refusal (both origins must be https).
import { pathToFileURL } from 'node:url'
import { linksOf, textOf } from './crawl-site.mjs'

const UA = { 'user-agent': 'kybernos-recette/1' }
// Third parties the documents name on purpose: the consumer mediator of the terms (the French sale conditions must name one).
const THIRD_PARTY = ['cm2c.net']
const get = async (url) => { try { const r = await fetch(url, { headers: UA, redirect: 'manual', signal: AbortSignal.timeout(20000) }); return { status: r.status, body: await r.text(), location: r.headers.get('location') } } catch (e) { return { status: 0, body: '', error: String(e.message || e) } } }

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
  const site = opt('--site', 'https://kybernos.app').replace(/\/$/, '')
  const server = opt('--server', 'https://api.kybernos.app').replace(/\/$/, '')
  if (!/^https:\/\//.test(site) || !/^https:\/\//.test(server)) { console.error('check-links-cross: both origins must be https (it reads the live public pages, read only)'); process.exit(2) }
  const results = []
  const notes = []
  const check = (id, ok, detail) => { results.push({ id, ok }); console.log(`  ${ok ? '✓' : '✗'} ${id}${detail ? ' — ' + detail : ''}`) }
  console.log('J21-04 legal and support links across the site and the server')

  const index = await get(`${server}/v1/public/legal`)
  let idx = null
  try { idx = JSON.parse(index.body) } catch { /* reported below */ }
  const docs = idx && Array.isArray(idx.legal_pages) ? idx.legal_pages : []
  check('L1 the server\'s legal index lists the documents', index.status === 200 && docs.length >= 6, `${docs.length} documents: ${docs.join(', ')}`)
  const pages = {}
  const bad = []
  for (const doc of docs) for (const lang of ['en', 'fr']) {
    const r = await get(`${server}/legal/${doc}?lang=${lang}`)
    pages[`${doc}/${lang}`] = r
    if (r.status !== 200 || r.body.length < 500) bad.push(`${doc}/${lang} answered ${r.status} (${r.body.length} characters)`)
  }
  check('L1b each document answers 200 with a real page in English and in French', bad.length === 0, bad.join('; ') || `${docs.length * 2} pages`)

  const shown = idx ? [idx.terms, idx.privacy] : []
  check('L2 the terms and privacy addresses the app shows are served by the same server, at /legal/<document>', shown.length === 2 && shown.every((d, i) => d && d.url === `${server}/legal/${['terms', 'privacy'][i]}`), shown.map((d) => d && d.url).join(' and '))

  const sm = await get(`${site}/sitemap.xml`)
  const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const linked = new Map()
  const foreign = []
  for (const u of urls) {
    const r = await get(u)
    for (const l of linksOf(r.body, u)) {
      let p
      try { p = new URL(l) } catch { continue }
      if (!/\/(legal|terms|privacy|dpa|subprocessors|acceptable-use|legal-notice)(\/|$)/i.test(p.pathname)) continue
      if (p.origin !== server && !/^\/legal\/?$/.test(p.pathname)) foreign.push(`${u} → ${l}`)
      const doc = (p.pathname.match(/^\/legal\/([a-z-]+)/) || [])[1]
      if (doc) linked.set(doc, (linked.get(doc) || 0) + 1)
    }
  }
  check('L3 every legal link on the site goes to the server\'s origin and to a listed document', urls.length > 0 && foreign.length === 0 && [...linked.keys()].every((d) => docs.includes(d)), foreign.slice(0, 3).join('; ') || `${urls.length} pages read, ${[...linked.keys()].join(', ')} linked`)
  const never = docs.filter((d) => !linked.has(d))
  if (never.length) notes.push(`documents the site never links to: ${never.join(', ')} (the footer carries ${[...linked.keys()].join(', ') || 'none'})`)

  const addresses = new Map()
  for (const [k, r] of Object.entries(pages)) for (const m of textOf(r.body).matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g)) { const a = m[0].toLowerCase(); addresses.set(a, (addresses.get(a) || new Set()).add(k.split('/')[0])) }
  const outside = [...addresses.keys()].filter((a) => !/@kybernos\.app$/.test(a) && !THIRD_PARTY.some((d) => a.endsWith('@' + d)))
  const missing = docs.filter((d) => ![...addresses.values()].some((s) => s.has(d)))
  check('L4 every document names a contact address, and each address is at the product\'s domain', missing.length === 0 && outside.length === 0, missing.length ? `no address in: ${missing.join(', ')}` : outside.length ? `outside the domain: ${outside.join(', ')}` : `${addresses.size} address(es)`)
  for (const [a, s] of addresses) notes.push(`${a} appears in ${[...s].join(', ')}${THIRD_PARTY.some((d) => a.endsWith('@' + d)) ? ' (a third party named on purpose)' : ''}`)
  if (![...addresses.entries()].some(([a, s]) => /^(contact|support|help)@/.test(a) && s.has('terms'))) notes.push('the terms name no support address (contact@ is in the privacy policy only; the terms give legal@): a person with a question about an order has to guess')
  if (idx && idx.security_contact === null) notes.push('the index gives no security contact (`security_contact` is null), while the pages name one')

  if (argv.includes('--json')) console.log(JSON.stringify({ results, notes }, null, 2))
  else { for (const n of notes) console.log('  · ' + n); const failed = results.filter((r) => !r.ok).length; console.log(`\n${results.length - failed} passed, ${failed} failed`) }
  process.exit(results.every((r) => r.ok) ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main().catch((e) => { console.error(String(e.message || e)); process.exit(1) })
