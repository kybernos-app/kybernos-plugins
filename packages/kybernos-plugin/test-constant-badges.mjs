#!/usr/bin/env node
// A badge that says the same thing on every row says nothing (UX audit 2026-10-20), checked at source level. No browser.
//
//   node packages/kybernos-plugin/test-constant-badges.mjs
//
// Measured on the real GUI: « Available » on 9 skills of 9, « Active » on 5 connectors of 5, « Manual » on 4 automations of 4 (the cell was
// written in the code, there was no origin to read). A status now shows only where it differs from the usual one: a skill that is attached,
// a connection that is not active. The Origin column of the Automations list is gone, with its grid track, its skeleton bone and its words.
import { readFileSync } from 'node:fs'

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8')

console.log('skills (the checkbox already says the rest)')
check('the project\'s skill row shows Attached, and nothing when the skill is only available', /\(k\.attached === true \? h\('span', \{ style: pillAttached, 'data-kb': 'project-skill-pill' \}, 'Attached'\) : null\)/.test(SRC))
check('so does the Agent Team\'s skill row', /\(k\.attached === true \? h\('span', \{ style: pillTOn, 'data-kb': 'team-skill-pill' \}, 'Attached'\) : null\)/.test(SRC))
check('no « Available » label is drawn any more', !/'Available'\)/.test(SRC.slice(SRC.indexOf("'data-kb': 'project-skill-pill'") - 200, SRC.indexOf("'data-kb': 'project-skill-pill'") + 200)))

console.log('connectors (only a state that is not the usual one)')
check('the project\'s connection shows its state unless it is active or ready', /\(\(c\.state === 'ACTIVE' \|\| c\.state === 'READY'\) \? null : h\('span', \{ style: Object\.assign\(\{\}, pillStyle,/.test(SRC))
check('the Agent Team\'s connection too', /\(\(c\.state === 'ACTIVE' \|\| c\.state === 'READY'\) \? null : h\('span', \{ style: Object\.assign\(\{\}, pillT,/.test(SRC))
check('a failed or pending connection still says so', /c\.state === 'FAILED' \? \{ color: 'var\(--dsw-alias-state-error-primary\)'/.test(SRC))

console.log('automations (no Origin column)')
check('the header names four columns (name, trigger, last session, sessions) and no origin', (SRC.slice(SRC.indexOf('const kbaListHead = '), SRC.indexOf('const kbaSkeleton = ')).match(/className: 'kba-tabver' \}, kbt\('tasks\.col\.(name|trigger|lastsession|sessions)'\)/g) || []).length === 4 && !/tasks\.col\.origin|tasks\.origin\.manual|kba-origin-badge/.test(SRC))
check('the grid has four tracks, the same for the header and the rows', /\n\.kba-rowbtn,\.kba-rowhead\{display:grid;grid-template-columns:minmax\(0,1\.3fr\) minmax\(0,1\.4fr\) 150px 64px;/.test(SRC))
check('the narrow layouts hide the sessions column, now the fourth', /\.kba-rowbtn>:nth-child\(4\),\.kba-rowhead>:nth-child\(4\)\{display:none\}/.test(SRC))
check('the skeleton row has one bone less, like the real row', /kbBone\('72%', 12\), kbBone\('70%', 12\), kbBone\(20, 12\)\)/.test(SRC))
process.exit(fail === 0 ? 0 : 1)
