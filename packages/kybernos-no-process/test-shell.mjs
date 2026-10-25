import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runShell } from './mini-shell.mjs'
const root = mkdtempSync(join(tmpdir(), 'ms-'))
mkdirSync(join(root, 'ws')); const ws = join(root, 'ws')
writeFileSync(join(ws, 'a.txt'), 'one\ntwo\nthree\n')
const sh = async (script, mode = 'workspace-write', cwd = ws) => { let o = ''; let e = ''; const code = await runShell(script, { cwd, env: { HOME: ws, FOO: 'bar' }, out: (s) => { o += s }, err: (s) => { e += s }, policy: { mode, root: ws } }); return { o, e, code } }
let r = await sh('echo hello && echo "$FOO and ${FOO}" ; echo $((1))'); assert.equal(r.o.split('\n').slice(0, 2).join('|'), 'hello|bar and bar')
r = await sh('cat a.txt | grep t | wc -l'); assert.equal(r.o.trim(), '2')
r = await sh('echo hi > out.txt && cat out.txt'); assert.equal(r.o, 'hi\n'); assert.equal(readFileSync(join(ws, 'out.txt'), 'utf8'), 'hi\n')
r = await sh('echo x > /usr/kybernos-escape.txt'); assert.equal(r.code, 1); assert.match(r.e, /Operation not permitted \(sandbox workspace-write\)/); assert.equal(existsSync('/usr/kybernos-escape.txt'), false)
r = await sh('echo x > nope.txt', 'read-only'); assert.equal(r.code, 1); assert.equal(existsSync(join(ws, 'nope.txt')), false)
r = await sh('curl https://example.com'); assert.equal(r.code, 127); assert.match(r.e, /command not found/)
r = await sh('mkdir -p d/e && touch d/e/f && ls d/e && rm -rf d && test -d d || echo gone'); assert.equal(r.o, 'f\ngone\n')
r = await sh('false || echo recovered; true && echo and-ok'); assert.equal(r.o, 'recovered\nand-ok\n')
r = await sh('echo $(pwd) | grep ws'); assert.equal(r.code, 0)
console.log('shell stand-in: all checks pass')
