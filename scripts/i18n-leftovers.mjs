#!/usr/bin/env node
// J18-02 helper: the English a French run left, from two `--json` reports of scripts/audit-i18n-live.mjs.
//
//   node scripts/i18n-leftovers.mjs <baseline.json> <french.json>
//
// `audit-i18n-live.mjs --baseline --json …` on an English DSH, then `--french --json …`. A text of the French run that the English baseline also shows, word for word, is a leftover
// (or a word that is the same in both languages, a brand, a model name, a name from the data): those are listed, most widespread first. The rest of what the run calls English is
// French the heuristic did not recognise. Judging which leftovers are Kybernos's own is for a reader: this prints, it does not gate. Exit 0, 2 on a bad call.
import { readFileSync } from 'node:fs'
import { leftovers } from './lib-i18n-audit.mjs'

const [base, run] = process.argv.slice(2)
if (!base || !run) { console.error('usage: node scripts/i18n-leftovers.mjs <baseline.json> <french.json>'); process.exit(2) }
const load = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch (e) { console.error('i18n-leftovers: cannot read ' + f + ': ' + e.message); process.exit(2) } }
const b = load(base)
const r = load(run)
const all = new Set(r.flatMap((p) => p.en || []))
const left = leftovers(b, r)
console.log(`${all.size} texts called English in the run, ${left.length} of them also in the English baseline (the others are French the heuristic did not recognise)`)
for (const l of left) console.log(String(l.pages.length).padStart(3) + '  ' + l.text.slice(0, 100) + '   [' + l.pages[0] + (l.pages.length > 1 ? ' +' + (l.pages.length - 1) : '') + ']')
