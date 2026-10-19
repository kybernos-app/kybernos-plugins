#!/usr/bin/env node
// The privacy default of the core plugin: DSH's `session-log-deepseek` row (it uploads the whole session log with every request to the OFFICIAL
// DeepSeek API, `enabled: true` in the dsh-base bundle) is switched off by the bundle patch, and docs/privacy.md says so.
//
//   node packages/kybernos-plugin/test-privacy-default.mjs
//
// The page-level proof (Settings › General shows the switch off on a fresh instance, on 0.2.1-rc.2) is a measurement made on an isolated instance;
// this file keeps the two texts from drifting apart: the patch row and the sentence.
import { readFileSync } from 'node:fs'

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail).slice(0, 200))) }
}

const patch = readFileSync(new URL('./cordis.patch.yml', import.meta.url), 'utf8')
const privacy = readFileSync(new URL('../../docs/privacy.md', import.meta.url), 'utf8')
const lines = patch.split('\n').filter((l) => !/^\s*#/.test(l))

check('the plugin is still inserted into the layer stack', lines.some((l) => /^- insert:/.test(l)) && lines.some((l) => /name: '@local\/kybernos'/.test(l)))
const at = lines.findIndex((l) => /^- id: session-log-deepseek\s*$/.test(l))
check('the patch addresses the row session-log-deepseek by id', at >= 0)
const block = at >= 0 ? lines.slice(at, at + 4).join('\n') : ''
check('…and sets enabled: false in its config', /config:\s*\n\s+enabled: false/.test(block), block)
check('…without disabling the row itself (the switch of Settings › General stays available)', !/disabled:\s*true/.test(block))
const sl = privacy.search(/The session log\./)
check('docs/privacy.md has a section on the session log', sl >= 0)
check('…and says Kybernos ships it off', sl >= 0 && /\*\*off\*\*/.test(privacy.slice(sl, sl + 700)))
check('…and no longer calls the model provider « the one request » that carries your prompts', !/the one request that carries/.test(privacy))

console.log('\n' + (fail === 0 ? 'PRIVACY DEFAULT GREEN' : 'PRIVACY DEFAULT RED') + ' — ' + pass + ' checks, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
