import assert from 'node:assert/strict'
// `just-bash` is carried by the phone payload, not by this repository: without it there is nothing to test here (kybernos-host/payload/test-boot.mjs covers the shell end to end).
if ((await import('just-bash').catch(() => null)) === null) { console.log('SKIPPED: just-bash is not installed here (only the phone payload carries it)'); process.exit(0) }
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const { runShell } = await import('./just-shell.mjs')
const root = realpathSync(mkdtempSync(join(tmpdir(), 'js-')))
const ws = join(root, 'ws'); mkdirSync(ws)
writeFileSync(join(ws, 'a.txt'), 'one\ntwo\nthree\nthree\n')
const sh = async (script, mode = 'workspace-write') => { let o = ''; let e = ''; const t = Date.now(); const code = await runShell(script, { cwd: ws, env: { HOME: ws, FOO: 'bar' }, out: (s) => { o += s }, err: (s) => { e += s }, policy: { mode, root: ws } }); return { o, e, code, ms: Date.now() - t } }
let r = await sh('echo hello && echo "$FOO and ${FOO}"'); assert.equal(r.o, 'hello\nbar and bar\n')
r = await sh('cat a.txt | sort | uniq -c | sort -rn | head -2'); assert.match(r.o, /2 three/)
r = await sh('for i in 1 2 3; do echo n$i; done; f() { echo "fn:$1"; }; f x; if [ -f a.txt ]; then echo yes; else echo no; fi'); assert.equal(r.o, 'n1\nn2\nn3\nfn:x\nyes\n')
r = await sh('echo hi > out.txt && cat out.txt'); assert.equal(r.o, 'hi\n'); assert.equal(readFileSync(join(ws, 'out.txt'), 'utf8'), 'hi\n')
r = await sh(`pwd; sed 's/one/ONE/' a.txt | head -1; awk '{print NR": "$0}' a.txt | tail -1; find . -name '*.txt' | sort; echo '{"a":[1,2]}' | jq '.a[1]'`); console.log(r.o.trim().split('\n').join(' | '), '| err:', r.e.trim().slice(0, 100)); assert.ok(r.o.startsWith(ws))
r = await sh('echo x > /usr/kybernos-escape.txt; echo after'); assert.match(r.e, /EROFS|read-only/i, 'a write outside the workspace fails loudly'); assert.equal(r.code, 1); assert.equal(r.o, '', 'the refused write ends the script (just-bash raises it as an error)'); assert.equal(existsSync('/usr/kybernos-escape.txt'), false); console.log('escape ->', JSON.stringify(r.e.trim()).slice(0, 140), '| out:', JSON.stringify(r.o))
r = await sh('echo scratch > /tmp/s.txt && cat /tmp/s.txt'); assert.equal(r.o, 'scratch\n', '/tmp is writable scratch')
r = await sh('echo x > nope.txt', 'read-only'); assert.equal(existsSync(join(ws, 'nope.txt')), false); console.log('read-only write ->', r.code, JSON.stringify(r.e.trim()).slice(0, 140))
r = await sh('cat ../outside.txt'); console.log('read outside workspace ->', r.code, JSON.stringify(r.e.trim()).slice(0, 100))
r = await sh('curl -s https://example.com | head -2'); console.log('curl without network ->', r.code, JSON.stringify(r.e.trim()).slice(0, 100))
console.log('just-bash on the host: checks pass; last run', r.ms, 'ms')
