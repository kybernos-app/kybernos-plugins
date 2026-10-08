// kybernos-call: the worker's Python side, through Python's own test runner.
//   · test_call_meta.py  — who a call is with, what is worth saying aloud, the speech poll. Standard library only.
//   · test_call_agent.py — who answers (the session or the small model) and the loop that speaks the session's
//     replies. It needs livekit-agents, so it is skipped where that is not installed (CI); on a machine with the
//     worker's venv it runs for real:  <venv>/bin/python agent/test_call_agent.py
// The whole file is skipped when python3 is not installed.
//
//   node packages/kybernos-call/test-agent-meta.mjs
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const agentDir = join(dirname(fileURLToPath(import.meta.url)), 'agent')
const env = Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' })
const python = ['python3', 'python'].find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0)
if (python === undefined) { console.log('kybernos-call agent (python): skipped (no python3 on this machine)'); process.exit(0) }

let ran = 0
let skipped = 0
for (const file of ['test_call_meta.py', 'test_call_agent.py']) {
  const run = spawnSync(python, ['-B', file], { cwd: agentDir, encoding: 'utf8', env })
  if (run.status !== 0) {
    process.stdout.write(String(run.stdout))
    process.stderr.write(String(run.stderr))
    console.log('✗ ' + file)
    process.exit(1)
  }
  const n = /Ran (\d+) tests?/.exec(String(run.stderr))
  const s = /skipped=(\d+)/.exec(String(run.stderr))
  ran += n ? Number(n[1]) : 0
  skipped += s ? Number(s[1]) : 0
}
console.log('✓ kybernos-call agent (python): ' + ran + ' tests' + (skipped > 0 ? ', ' + skipped + ' skipped (livekit-agents is not installed here)' : ''))
