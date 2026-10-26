// Licences of what the phone app ships. The payload is third-party code copied into an app that stores redistribute, so two things are checked and written at build time:
//   1. every package in the shipped trees has a licence that allows it (an allow-list of permissive SPDX ids; anything else, or no licence at all, stops the build);
//   2. a THIRD-PARTY-NOTICES.txt lists every package with its licence, its author and its licence text, which the app shows (« The Kybernos app » page).
// Pure and offline: `scanTrees` reads folders, `audit` and `render` take plain data (tested in scripts/test-mobile-licences.mjs).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** SPDX ids that allow redistribution inside a closed binary with a notice. MPL-2.0 is file-level copyleft: fine unmodified, and listed so its text ships. */
export const ALLOWED = new Set([
  'MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Apache-2.0', 'MPL-2.0', 'CC0-1.0', 'Unlicense', 'BlueOak-1.0.0', 'Python-2.0', 'CC-BY-4.0', 'Zlib',
].map((id) => id.toUpperCase()))
const ALIASES = { 'APACHE 2.0': 'APACHE-2.0', 'APACHE2': 'APACHE-2.0', 'APACHE-2': 'APACHE-2.0', 'BSD': 'BSD-3-CLAUSE', 'BSD-3': 'BSD-3-CLAUSE', 'EXPAT': 'MIT' } // upper case: ids are compared in upper case

/** Packages whose licence the package.json does not say but a human read: `name` -> { license, reason }. Empty on purpose: each line is a decision someone made. */
export const OVERRIDES = {}

const FILE_NAMES = /^(licen[sc]e|licen[sc]e[-.].*|copying|notice|unlicense)(\.(md|txt|markdown))?$/i

/** What a licence text is, by its own words (used when package.json has no `license` field). null when it is not one of the permissive ones. */
export const sniff = (text) => {
  const t = String(text).slice(0, 4000)
  if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(t)) return 'Apache-2.0'
  if (/Permission is hereby granted, free of charge/i.test(t) && /THE SOFTWARE IS PROVIDED "AS IS"/i.test(String(text))) return 'MIT'
  if (/Permission to use, copy, modify, and\/or distribute this software for any purpose with or without fee/i.test(t)) return 'ISC'
  if (/Redistribution and use in source and binary forms/i.test(t) && /Neither the name of/i.test(t)) return 'BSD-3-Clause'
  if (/Redistribution and use in source and binary forms/i.test(t)) return 'BSD-2-Clause'
  if (/Mozilla Public License[\s\S]{0,40}2\.0/i.test(t)) return 'MPL-2.0'
  return null
}

const normalise = (id) => { const k = id.trim().toUpperCase(); return ALIASES[k] ?? k }

/** `(MIT OR Apache-2.0)`, `MIT AND CC0-1.0`, a single id. OR: one allowed alternative is enough; AND: all must be. Unknown words are not allowed. */
export const allowedExpression = (expr) => {
  const s = String(expr).replace(/[()]/g, ' ').trim()
  if (s === '') return false
  const ors = s.split(/\s+OR\s+/i)
  return ors.some((alt) => alt.split(/\s+AND\s+/i).every((id) => ALLOWED.has(normalise(id))))
}

const declared = (pkg) => {
  const l = pkg.license
  if (typeof l === 'string' && l.trim() !== '') return l.trim()
  if (l !== null && typeof l === 'object' && typeof l.type === 'string') return l.type
  if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) return pkg.licenses.map((x) => (typeof x === 'string' ? x : x.type)).filter(Boolean).join(' OR ')
  return ''
}
const authorOf = (pkg) => {
  const a = pkg.author
  if (typeof a === 'string') return a.replace(/\s*<[^>]*>/, '').replace(/\s*\([^)]*\)/, '').trim()
  if (a !== null && typeof a === 'object' && typeof a.name === 'string') return a.name
  return ''
}
const homeOf = (pkg) => {
  if (typeof pkg.homepage === 'string') return pkg.homepage
  const r = pkg.repository
  const u = typeof r === 'string' ? r : (r !== null && typeof r === 'object' && typeof r.url === 'string' ? r.url : '')
  return u.replace(/^git\+/, '').replace(/\.git$/, '')
}

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

/** Every package (name, version) in the given node_modules folders, nested ones included, once each. A licence file next to the package.json is read (first 60 KB). */
export function scanTrees (roots) {
  const seen = new Map()
  const visit = (dir) => {
    let names
    try { names = readdirSync(dir) } catch { return }
    for (const n of names) {
      if (n.startsWith('.')) continue
      const p = join(dir, n)
      if (n.startsWith('@')) { visit(p); continue }
      const pj = join(p, 'package.json')
      if (!existsSync(pj)) continue
      const pkg = readJson(pj)
      if (pkg === null || typeof pkg.name !== 'string') continue
      const key = pkg.name + '@' + (pkg.version ?? '')
      if (!seen.has(key)) {
        const files = []
        try {
          for (const f of readdirSync(p)) {
            if (!FILE_NAMES.test(f)) continue
            const fp = join(p, f)
            if (statSync(fp).isFile()) files.push({ name: f, text: readFileSync(fp, 'utf8').slice(0, 60000) })
          }
        } catch { /* a package without readable files has none */ }
        seen.set(key, { name: pkg.name, version: pkg.version ?? '', license: declared(pkg), author: authorOf(pkg), home: homeOf(pkg), files })
      }
      const nested = join(p, 'node_modules')
      if (existsSync(nested)) visit(nested)
    }
  }
  for (const r of roots) visit(r)
  return [...seen.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1))
}

/** Gives every entry its final licence id and `problems`: [{ name, version, license, reason }]. */
export function audit (entries, overrides = OVERRIDES) {
  const ok = []
  const problems = []
  for (const e of entries) {
    const o = overrides[e.name]
    let id = o !== undefined ? o.license : e.license
    let how = o !== undefined ? 'override: ' + o.reason : 'package.json'
    if (id === '' || /^SEE LICENSE|^UNLICENSED$|^NONE$/i.test(id)) {
      const found = e.files.map((f) => sniff(f.text)).find((x) => x !== null)
      if (found !== undefined && !/^UNLICENSED$/i.test(id)) { id = found; how = 'licence file' } else { problems.push({ name: e.name, version: e.version, license: id === '' ? '(none)' : id, reason: 'no licence that allows redistribution' }); continue }
    }
    if (!allowedExpression(id)) { problems.push({ name: e.name, version: e.version, license: id, reason: 'licence not on the allow-list' }); continue }
    ok.push({ ...e, license: id, how })
  }
  return { ok, problems }
}

/** The text of THIRD-PARTY-NOTICES.txt. `extra` is a list of { title, body } sections written by the build (Kybernos itself, the embedded Node). */
export function render ({ entries, extra = [], built = new Date().toISOString() }) {
  const out = []
  out.push('Kybernos: open-source components', '', 'This app is made of the software below. Each part keeps its own licence; the text of each licence follows the list.', 'Built ' + built + '.', '')
  for (const x of extra) out.push('== ' + x.title + ' ==', '', x.body.trim(), '')
  out.push('== Packages (' + entries.length + ') ==', '')
  for (const e of entries) out.push(e.name + ' ' + e.version + ' . ' + e.license + (e.author !== '' ? ' . ' + e.author : '') + (e.home !== '' ? ' . ' + e.home : ''))
  out.push('', '== Licence texts ==', '')
  const byText = new Map()
  for (const e of entries) {
    const texts = e.files.length > 0 ? e.files.map((f) => f.text.trim()).filter((t) => t !== '') : []
    for (const t of texts) { if (!byText.has(t)) byText.set(t, []); byText.get(t).push(e.name) }
  }
  for (const [text, names] of byText) {
    const shown = [...new Set(names)]
    out.push('-- ' + shown.slice(0, 6).join(', ') + (shown.length > 6 ? ' and ' + (shown.length - 6) + ' more' : '') + ' --', '', text, '')
  }
  const withoutText = entries.filter((e) => e.files.length === 0 || e.files.every((f) => f.text.trim() === ''))
  if (withoutText.length > 0) out.push('-- Packages that ship no licence file (the licence named in their package.json applies) --', '', withoutText.map((e) => e.name + ' (' + e.license + ')').join(', '), '')
  return out.join('\n')
}
