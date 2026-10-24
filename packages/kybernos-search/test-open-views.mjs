#!/usr/bin/env node
/** Every page Search everywhere can open is a page the sidebar's router draws (T2-08, 2026-10-24).
 *  A result for an Agent Team asked for the view `kybers`; the router had no branch for it, so the click fell through to the old read-only panel
 *  (« Plugin is read-only ») instead of the Agent Teams page.
 *  Usage: node packages/kybernos-search/test-open-views.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const sources = readFileSync(join(here, 'sources.mjs'), 'utf8')
const client = readFileSync(join(here, '..', 'kybernos-plugin', 'client.js'), 'utf8')

const views = Array.from(new Set(Array.from(sources.matchAll(/open:\s*\{\s*kind:\s*'page',\s*view:\s*'([a-z]+)'/g)).map((m) => m[1]))).sort()
assert.ok(views.length >= 3, 'the sources open at least skills, tasks and agent teams: ' + views.join(','))

// The router is the chain of `if (s.view === …) return h(Page, props)` of the sidebar; the last line is the fallback panel.
const at = client.indexOf("if (s.view === 'gallery' || s.view === 'marketplace'")
assert.ok(at > 0, 'the router exists')
const router = client.slice(at, client.indexOf('const hasDetail', at))
const fallback = /return h\(KybersPanel, props\)/.exec(client.slice(at))
assert.ok(fallback !== null, 'and its fallback is the old panel')
for (const view of views) {
  assert.ok(new RegExp("s\\.view === '" + view + "'").test(router), 'the router draws a page for the view « ' + view + ' »')
}
console.log('  ✓ every view that Search everywhere opens (' + views.join(', ') + ') has a page in the router, so none lands on the old read-only panel')
console.log('\n1 check passed')
