import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanEnv, injectPlistString, loadEnv, redact, requireEnv } from './lib.mjs'

const dir = mkdtempSync(join(tmpdir(), 'dc-'))
const file = join(dir, '.env')
writeFileSync(file, '# comment\nANTHROPIC_API_KEY="sk-ant-abc123_XYZ"\nBROWSERSTACK_USERNAME = someone\nBROWSERSTACK_ACCESS_KEY=\nEMPTY=\n  # BROWSERSTACK_BUDGET_MINUTES=3\n')
for (const n of ['ANTHROPIC_API_KEY', 'BROWSERSTACK_USERNAME', 'BROWSERSTACK_ACCESS_KEY', 'BROWSERSTACK_BUDGET_MINUTES']) delete process.env[n]
assert.deepEqual(loadEnv(file), ['ANTHROPIC_API_KEY', 'BROWSERSTACK_USERNAME'], 'names with a value only; empty and commented lines are ignored')
assert.equal(process.env.ANTHROPIC_API_KEY, 'sk-ant-abc123_XYZ', 'quotes are stripped')
process.env.BROWSERSTACK_USERNAME = 'already-set'; loadEnv(file); assert.equal(process.env.BROWSERSTACK_USERNAME, 'already-set', 'the environment wins over the file')
assert.throws(() => requireEnv(['BROWSERSTACK_ACCESS_KEY']), /BROWSERSTACK_ACCESS_KEY/)
try { requireEnv(['BROWSERSTACK_ACCESS_KEY', 'ANTHROPIC_API_KEY']) } catch (e) { assert.ok(!e.message.includes('sk-ant'), 'an error names variables, never values') }
process.env.BROWSERSTACK_ACCESS_KEY = 'abcdefghij0123456789'
assert.equal(redact('key abcdefghij0123456789 and sk-ant-abc123_XYZ and sk-ant-zzzzzzzz'), 'key *** and sk-ant-… and sk-ant-…')
const env = cleanEnv({ TARGET: 'device' })
assert.equal(env.TARGET, 'device'); for (const n of ['ANTHROPIC_API_KEY', 'BROWSERSTACK_ACCESS_KEY', 'BROWSERSTACK_USERNAME']) assert.equal(env[n], undefined, n + ' is not passed to child processes')
const xml = '<?xml version="1.0"?><plist version="1.0"><dict><key>A</key><string>b</string></dict></plist>'
const out = injectPlistString(xml, 'KBSelfTestAnthropicKey', 'sk-ant-a&b<c>')
assert.match(out, /<key>KBSelfTestAnthropicKey<\/key><string>sk-ant-a&amp;b&lt;c&gt;<\/string>\n<\/dict><\/plist>$/)
assert.throws(() => injectPlistString(out, 'KBSelfTestAnthropicKey', 'x'), /already/)
assert.throws(() => injectPlistString('nothing', 'K', 'v'), /plist/)
rmSync(dir, { recursive: true, force: true })
console.log('devicecloud lib: .env parsing, redaction, clean child environment, plist injection: all checks pass')
