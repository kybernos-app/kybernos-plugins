#!/usr/bin/env node
// journal-viewer-build.mjs — writes the page that shows a shared chat Journal, for the server that hosts the links (docs/dev/journal-link.md):
//
//   node scripts/journal-viewer-build.mjs --out <folder>      viewer.html (the page, the same bytes for every link) and policy.txt (its Content-Security-Policy, to send as a header)
//
// The page loads its document from the address it was served at plus `.json`, and asks for the password when that is sealed; its hashes in the policy change whenever the page does,
// so the server takes both files from the same run. Same shape as scripts/share-viewer-build.mjs (the shared dashboard's page).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// loaded by a computed address: this script is a tool of the repository and ships without the plugin sources it reads
const { journalViewerHtml } = await import(new URL('../packages/kybernos-plugin/journal-page.mjs', import.meta.url).href)
const at = process.argv.indexOf('--out')
if (at < 0 || process.argv[at + 1] === undefined) { console.error('usage: node scripts/journal-viewer-build.mjs --out <folder>'); process.exit(2) }
const out = resolve(process.argv[at + 1])
const { html, policy } = journalViewerHtml()
mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'viewer.html'), html)
writeFileSync(join(out, 'policy.txt'), policy + "; frame-ancestors 'none'\n")
console.log('wrote ' + join(out, 'viewer.html') + ' (' + Buffer.byteLength(html) + ' bytes) and policy.txt')
