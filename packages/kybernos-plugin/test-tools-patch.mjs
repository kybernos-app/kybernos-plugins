#!/usr/bin/env node
// Settings › Tools: the on/off switch of a tool, as it reads and writes the profile's cordis.patch.yml (tools-patch.mjs).
// Pure text in, text out: no disk, no engine. The fixtures are the shapes of the real profile of this machine (2026-11-02): a row the
// Tools tab wrote, a row switched off inside its own block (ZCode), a row switched off by a patch entry aimed at its id further down
// (the « light mode » block of 2026-10-27: Browser Use and Computer Use drivers), and a bare entry left behind by an earlier « on ».
//
//   node packages/kybernos-plugin/test-tools-patch.mjs   (exit 0 = all pass)
import assert from 'node:assert/strict'
import { patchEntries, rowsOfTool, setSwitch, switchOf } from './tools-patch.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }

const CODEX = { names: ['@deepseek-ai/dsh-subagent-codex'] }
const ZCODE = { names: [], ids: ['mcp-client-zcode'] }
const BROWSER = { names: ['@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'], fallbackNames: ['@deepseek-ai/dsh-browser-use'] }
const COMPUTER = { names: ['@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'], fallbackNames: ['@deepseek-ai/dsh-computer-use'] }

const PATCH = `# Your patch layer
- id: tool-web
  config:
    fetch: true

# ── Outils · Codex — ajoute le 20261003-190501 par l onglet Outils (Kybers)
# Rollback : restaurer cordis.patch.yml.bak-outils-codex-20261003-190501, puis redemarrer DSH.
- insert:
    - id: codex
      name: '@deepseek-ai/dsh-subagent-codex'

- insert:
    - id: computer-use
      name: '@deepseek-ai/dsh-computer-use'
    - id: computer-use-cua-native
      name: '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'
    - id: browser-use
      name: '@deepseek-ai/dsh-browser-use'
    - id: browser-use-playwright
      name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'
      config:
        mode: launch
        headless: false

# connecteur:zcode
- insert:
    - id: mcp-client-zcode
      disabled: true
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: zcode
        command: /opt/homebrew/bin/node # DSH spawns with a scrubbed env
- id: dsh-market
  disabled: true
- id: computer-use-cua-native
  disabled: true
- id: browser-use-playwright
  disabled: true
- id: kybernos-kyber
- id: kybernos-call
  disabled: true
`

console.log('reading')
{
  const e = patchEntries(PATCH)
  assert.ok(e.find((x) => x.id === 'codex' && x.fields.name === '@deepseek-ai/dsh-subagent-codex' && x.indent === 4))
  assert.ok(e.find((x) => x.id === 'dsh-market' && x.fields.disabled === 'true' && x.fields.name === undefined && x.indent === 0))
  ok('entries are found at any indentation, inserted or aimed at an id')
  assert.equal(rowsOfTool(e, CODEX).length, 1)
  assert.equal(rowsOfTool(e, ZCODE).length, 1)
  ok('a tool is found by its package name, or by its row id for a connector without a package of its own')
  assert.deepEqual(switchOf(PATCH, CODEX), { rows: 1, disabled: false, can: true, why: null })
  ok('a mounted row with no `disabled` is on')
  assert.equal(switchOf(PATCH, ZCODE).disabled, true)
  ok('`disabled: true` in the row itself (even before its name) is off — the real ZCode row, shown « Active » until now')
  const b = switchOf(PATCH, BROWSER)
  const c = switchOf(PATCH, COMPUTER)
  assert.equal(b.disabled, true)
  assert.equal(c.disabled, true)
  assert.equal(b.rows, 1)
  ok('a row switched off by a patch entry aimed at its id further down is off (the light-mode block): the driver, not the registry')
  assert.equal(switchOf(PATCH, { names: ['@deepseek-ai/dsh-nothing'] }).why, 'no-row')
  assert.equal(switchOf('# - id: codex\n#   name: "@deepseek-ai/dsh-subagent-codex"\n', CODEX).why, 'no-row')
  ok('nothing to edit when the file only mentions the package in a comment, or not at all')
  assert.equal(switchOf(PATCH.replace('name: \'@deepseek-ai/dsh-subagent-codex\'', 'name: \'@deepseek-ai/dsh-subagent-codex\'\n      disabled: !!js "!ctx.get(\'x\')"'), CODEX).why, 'expression')
  ok('a `disabled` that is a !!js expression is named and never touched')
  assert.equal(switchOf(PATCH.replace("name: '@deepseek-ai/dsh-subagent-codex'", "name: '@deepseek-ai/dsh-subagent-codex'\n      disabled: true # light mode"), CODEX).disabled, true)
  ok('a trailing comment after the value is ignored')
}

console.log('switching off')
{
  const r = setSwitch(PATCH, CODEX, true)
  assert.equal(r.ok, true)
  assert.equal(r.changed, true)
  assert.ok(r.after.includes("    - id: codex\n      name: '@deepseek-ai/dsh-subagent-codex'\n      disabled: true\n"))
  assert.equal(switchOf(r.after, CODEX).disabled, true)
  ok('the line goes under the row\'s name, at the row\'s own indentation')
  const lost = PATCH.split('\n').filter((l) => !r.after.split('\n').includes(l))
  assert.deepEqual(lost, [])
  assert.equal(r.after.split('\n').length, PATCH.split('\n').length + 1)
  ok('exactly one line is added; nothing else in the file moves')
  assert.equal(setSwitch(r.after, CODEX, true).changed, false)
  assert.equal(setSwitch(r.after, CODEX, true).after, r.after)
  ok('switching off twice changes nothing the second time')
  const back = setSwitch(r.after, CODEX, false)
  assert.equal(back.ok, true)
  assert.equal(back.after, PATCH)
  ok('off then on gives the original file back, byte for byte')
}

console.log('switching on')
{
  const z = setSwitch(PATCH, ZCODE, false)
  assert.equal(z.ok, true)
  assert.equal(switchOf(z.after, ZCODE).disabled, false)
  assert.ok(z.after.includes("    - id: mcp-client-zcode\n      name: '@deepseek-ai/dsh-mcp-client'\n"))
  assert.equal(z.after.split('\n').length, PATCH.split('\n').length - 1)
  ok('ZCode: the one `disabled: true` line of its own row goes, its config stays')
  const c = setSwitch(PATCH, COMPUTER, false)
  assert.equal(c.ok, true)
  assert.equal(switchOf(c.after, COMPUTER).disabled, false)
  assert.ok(!c.after.includes('- id: computer-use-cua-native\n  disabled: true'))
  assert.ok(c.after.includes('- id: browser-use-playwright\n  disabled: true'))
  assert.ok(c.after.includes('- id: kybernos-kyber\n- id: kybernos-call\n  disabled: true'))
  assert.equal(c.after.split('\n').length, PATCH.split('\n').length - 2)
  ok('Computer Use: the patch entry that held only `disabled` goes whole; the neighbours (Browser Use, others) are untouched')
  const k = setSwitch(PATCH, BROWSER, false)
  assert.ok(k.ok && switchOf(k.after, BROWSER).disabled === false && switchOf(k.after, COMPUTER).disabled === true)
  ok('one tool at a time: switching Browser Use on leaves Computer Use off')
  const keep = PATCH.replace('- id: browser-use-playwright\n  disabled: true', '- id: browser-use-playwright\n  disabled: true\n  config:\n    mode: launch')
  const kk = setSwitch(keep, BROWSER, false)
  assert.ok(kk.ok && kk.after.includes('- id: browser-use-playwright\n  config:\n    mode: launch'))
  ok('a patch entry that holds more than `disabled` keeps its other keys')
  const twice = PATCH.replace('      name: \'@deepseek-ai/dsh-experimental-browser-use-playwright-mcp\'', '      name: \'@deepseek-ai/dsh-experimental-browser-use-playwright-mcp\'\n      disabled: true')
  const t = setSwitch(twice, BROWSER, false)
  assert.ok(t.ok && switchOf(t.after, BROWSER).disabled === false && !/disabled/.test(t.after.slice(t.after.indexOf('browser-use-playwright'), t.after.indexOf('# connecteur:zcode'))))
  ok('a row and an entry aimed at it both off: both go, so the loader cannot fall back on the other')
}

console.log('off again after on')
{
  const on = setSwitch(PATCH, BROWSER, false).after
  const off = setSwitch(on, BROWSER, true)
  assert.ok(off.ok && switchOf(off.after, BROWSER).disabled === true)
  assert.ok(off.after.includes("      name: '@deepseek-ai/dsh-experimental-browser-use-playwright-mcp'\n      disabled: true\n"))
  ok('a tool that was off by an entry further down goes off again in its own row — one place to look')
  const earlier = '- id: x\n  disabled: false\n- insert:\n    - id: y\n      name: yy\n' + '- id: y\n  disabled: false\n'
  const e = setSwitch(earlier, { names: ['yy'] }, true)
  assert.ok(e.ok && e.after === '- id: x\n  disabled: false\n- insert:\n    - id: y\n      name: yy\n- id: y\n  disabled: true\n')
  ok('a line that says `disabled: false` is turned to `true` instead of adding a second one')
}

console.log('refusals and the family fallback')
{
  const expr = PATCH.replace("name: '@deepseek-ai/dsh-subagent-codex'", "name: '@deepseek-ai/dsh-subagent-codex'\n      disabled: !!js \"false\"")
  assert.deepEqual(setSwitch(expr, CODEX, true), { ok: false, error: 'expression' })
  assert.deepEqual(setSwitch('', CODEX, true), { ok: false, error: 'no-row' })
  ok('an expression or an absent row is refused with its reason, and nothing is written')
  const registry = "- insert:\n    - id: browser-use\n      name: '@deepseek-ai/dsh-browser-use'\n"
  assert.equal(switchOf(registry, BROWSER).rows, 1)
  const off = setSwitch(registry, BROWSER, true)
  assert.ok(off.ok && off.after.includes("name: '@deepseek-ai/dsh-browser-use'\n      disabled: true\n"))
  ok('with no driver in the file, the registry row is the one that is switched')
  const crlf = setSwitch(PATCH.split('\n').join('\r\n'), CODEX, true)
  assert.ok(crlf.ok === true && switchOf(crlf.after, CODEX).disabled === true && switchOf(setSwitch(crlf.after, CODEX, false).after, CODEX).disabled === false)
  ok('a file with Windows line ends is edited and read back the same way')
}

console.log(`\n${pass} checks passed`)
