#!/usr/bin/env node
// Reads the public site like a visitor who follows every link: sitemap, status, title, description, h1, every link of every page, and the legal pages of the server (placeholders left in them).
// Cases J01-01, J01-04, J01-09 and J01-11 of docs/tests/user-journey. Read only: GET requests, no cookie, no form.
//
//   node scripts/crawl-site.mjs [--base https://kybernos.app] [--legal https://server.kybernos.app] [--out report.json] [--max 200]
//
// Exit 0 when nothing is broken and no placeholder is left, 1 otherwise, 2 on a refusal (the base must be an https origin).
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const UA = { 'user-agent': 'kybernos-recette/1' }
const PLACEHOLDER = /TO VERIFY BEFORE PUBLICATION|À VÉRIFIER AVANT PUBLICATION|\bTODO\b|\bFIXME\b|lorem ipsum|\[\.\.\.\]|\bplaceholder\b/gi
const LEGAL = ['terms', 'privacy', 'legal-notice', 'dpa', 'acceptable-use', 'subprocessors']

export function textOf (html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')
}
export const metaOf = (html) => ({
  title: ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim(),
  description: ((html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i) || [])[1] || '').trim(),
  h1: ((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim()
})
export const linksOf = (html, base) => [...new Set([...html.matchAll(/href=["']([^"'#]+)["']/g)].map((m) => m[1]).filter((h) => !/^(mailto:|tel:|javascript:)/i.test(h)).map((h) => { try { return new URL(h, base).href } catch { return null } }).filter(Boolean))]

async function get (url, method = 'GET') {
  try {
    const r = await fetch(url, { method, headers: UA, redirect: 'manual', signal: AbortSignal.timeout(20000) })
    return { status: r.status, location: r.headers.get('location'), type: r.headers.get('content-type') || '', body: method === 'GET' ? await r.text() : '' }
  } catch (e) { return { status: 0, error: String(e.message || e), body: '' } }
}

async function main () {
  const argv = process.argv.slice(2)
  const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
  const base = opt('--base', 'https://kybernos.app').replace(/\/$/, '')
  const legal = opt('--legal', 'https://server.kybernos.app').replace(/\/$/, '')
  const max = Number(opt('--max', '200'))
  for (const o of [base, legal]) if (!/^https:\/\/[a-z0-9.-]+$/.test(o)) { console.error('crawl-site: the base and the legal origin must be https origins'); process.exit(2) }
  const report = { base, pages: [], broken: [], redirects: [], externalChecked: 0, placeholders: [], problems: [] }

  const sm = await get(base + '/sitemap.xml')
  const urls = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).slice(0, max)
  if (sm.status !== 200 || urls.length === 0) report.problems.push(`sitemap.xml answered ${sm.status} with ${urls.length} addresses`)
  const seen = new Map()
  const check = async (url) => {
    if (seen.has(url)) return seen.get(url)
    let r = await get(url, 'HEAD')
    if (r.status === 405 || r.status === 403 || r.status === 0) r = await get(url, 'GET')
    seen.set(url, r)
    return r
  }
  for (const url of urls) {
    const r = await get(url)
    const m = metaOf(r.body)
    const page = { url, status: r.status, ...m, links: 0 }
    if (r.status !== 200) report.problems.push(`${url}: sitemap lists it and it answers ${r.status}`)
    if (!m.title) report.problems.push(`${url}: no title`)
    if (!m.description) report.problems.push(`${url}: no description`)
    const links = linksOf(r.body, url)
    page.links = links.length
    for (const l of links) {
      const same = l.startsWith(base)
      if (!same && /^https?:/.test(l)) report.externalChecked += 1
      const lr = await check(l)
      if (lr.status >= 300 && lr.status < 400) report.redirects.push({ from: l, to: lr.location, on: url })
      else if (lr.status === 0 || lr.status >= 400) report.broken.push({ link: l, status: lr.status, error: lr.error, on: url })
    }
    const hits = [...textOf(r.body).matchAll(PLACEHOLDER)].map((x) => x[0])
    if (hits.length) report.placeholders.push({ url, hits: [...new Set(hits)] })
    report.pages.push(page)
  }
  for (const lang of ['en', 'fr']) {
    for (const p of LEGAL) {
      const url = `${legal}/legal/${p}?lang=${lang}`
      const r = await get(url)
      if (r.status !== 200) { report.broken.push({ link: url, status: r.status, on: 'legal hub' }); continue }
      const hits = [...textOf(r.body).matchAll(PLACEHOLDER)].map((x) => x[0])
      if (hits.length) report.placeholders.push({ url, count: hits.length, hits: [...new Set(hits)] })
    }
  }
  const bad = report.problems.length + report.broken.length + report.placeholders.length
  if (opt('--out', '')) writeFileSync(opt('--out', ''), JSON.stringify(report, null, 2))
  console.log(`${report.pages.length} pages, ${report.externalChecked} external links, ${report.redirects.length} redirects, ${report.broken.length} broken, ${report.placeholders.length} pages with a placeholder, ${report.problems.length} other problems`)
  for (const p of report.problems.slice(0, 20)) console.log('  ✗ ' + p)
  for (const b of report.broken.slice(0, 30)) console.log(`  ✗ broken ${b.status} ${b.link} (on ${b.on})`)
  for (const p of report.placeholders.slice(0, 30)) console.log(`  ✗ placeholder on ${p.url}: ${p.hits.join(' | ')}${p.count ? ' x' + p.count : ''}`)
  process.exit(bad === 0 ? 0 : 1)
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
