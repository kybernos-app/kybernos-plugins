// kybernos-call: the worker's call identity (agent/call_meta.py), through Python's own test runner.
// Standard library only, no LiveKit needed. Skipped when python3 is not installed.
//
//   node packages/kybernos-call/test-agent-meta.mjs
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const agentDir = join(dirname(fileURLToPath(import.meta.url)), 'agent')
const env = Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' })
const python = ['python3', 'python'].find((c) => spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0)
if (python === undefined) { console.log('kybernos-call agent meta: skipped (no python3 on this machine)'); process.exit(0) }

const run = spawnSync(python, ['-B', 'test_call_meta.py'], { cwd: agentDir, encoding: 'utf8', env })
if (run.status !== 0) {
  process.stdout.write(String(run.stdout))
  process.stderr.write(String(run.stderr))
  process.exit(1)
}
const ran = /Ran (\d+) tests?/.exec(String(run.stderr))
console.log('✓ kybernos-call agent meta: ' + (ran ? ran[1] : '?') + ' Python tests (call_meta.py)')
