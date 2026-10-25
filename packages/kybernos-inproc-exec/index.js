// kybernos-inproc-exec: a subprocess provider for a host that cannot create processes (iOS). It implements the engine's own seam,
// `SubprocessRuntime` (ctx.subprocess), and answers the few programs the model-facing tools launch by running them inside the process:
// `rg` (glob and grep, rg.mjs) and, when a shell is wired, `bash -c`. Anything else is refused the way the OS would refuse it.
import { Readable } from 'node:stream'
import { basename } from 'node:path'
import { SubprocessRuntime, SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
import { runRg } from './rg.mjs'
import { runShell as miniShell } from './mini-shell.mjs'

// just-bash (a bash written in JavaScript) when it can be loaded, the small stand-in shell otherwise (KYBERNOS_INPROC_SHELL=mini forces it).
const pickShell = async () => {
  if (process.env.KYBERNOS_INPROC_SHELL === 'mini') return ['mini-shell (forced)', miniShell]
  try { return ['just-bash', (await import('./just-shell.mjs')).runShell] } catch (e) { return ['mini-shell (just-bash unavailable: ' + (e && e.code ? e.code : String(e && e.message)).slice(0, 80) + ')', miniShell] }
}
const [SHELL_NAME, SHELL] = await pickShell()
try { console.log('[kybernos-inproc-exec] shell: ' + SHELL_NAME) } catch { /* no console */ }

const eperm = (what) => Object.assign(new Error(`spawn ${what} EPERM: this device cannot create processes (kybernos-inproc-exec)`), { code: 'EPERM', errno: -1, syscall: 'spawn' })
const VIRTUAL = '/__inproc__/'
const SHELLS = new Set(['bash', 'sh', 'zsh'])

// One output stream: a buffer read by offset (collect mode) or a Readable (pipe mode).
const sink = (mode) => {
  const chunks = []
  let total = 0
  let readable = null
  if (mode === 'pipe') readable = new Readable({ read() {} })
  return {
    write: (s) => { const b = Buffer.from(s); chunks.push(b); total += b.length; if (readable !== null) readable.push(b) },
    end: () => { if (readable !== null) readable.push(null) },
    stream: readable ?? undefined,
    reader: typeof mode === 'object' && mode !== null ? { readFrom: (from) => { const all = Buffer.concat(chunks); return { text: all.subarray(from).toString('utf8'), nextOffset: total, lossy: false } } } : undefined,
  }
}

export default class InProcessSubprocess extends SubprocessRuntime {
  live = new Set()
  /** The shell this host offers: async (script, { cwd, env, out, err, signal, policy }) => exit code. */
  shell = SHELL

  async resolveExecutable(command) {
    const name = basename(command)
    if (SHELLS.has(name) || name === 'rg') return VIRTUAL + name
    throw new SubprocessExecutableNotFoundError(`kybernos-inproc-exec: ${JSON.stringify(command)} is not available in this process`)
  }

  async terminalEnvironment() { return { platform: 'posix', defaultShell: VIRTUAL + 'bash' } }

  spawn(spec) {
    if (spec.signal?.aborted) throw spec.signal.reason ?? new Error('aborted')
    if (!Array.isArray(spec.argv) || spec.argv.length === 0) throw new Error('kybernos-inproc-exec: argv must be non-empty')
    // The sandbox provider of this host wraps argv as [confine, mode, root, ...argv]: unwrap it and carry the policy to the shell.
    let argv = spec.argv
    let policy = { mode: 'danger-full-access', root: spec.cwd }
    if (argv[0] === '/__inproc__/confine') { policy = { mode: argv[1], root: argv[2] }; argv = argv.slice(3) }
    const name = basename(argv[0])
    const out = sink(spec.stdio.stdout)
    const errs = sink(spec.stdio.stderr)
    const ctl = new AbortController()
    spec.signal?.addEventListener('abort', () => ctl.abort(), { once: true })
    let run
    if (name === 'rg') run = () => runRg(argv, spec.cwd, out.write, errs.write, ctl.signal)
    else if (SHELLS.has(name)) {
      const ci = argv.indexOf('-c')
      const script = ci > 0 ? argv[ci + 1] : undefined
      run = async () => {
        if (this.shell === null || typeof script !== 'string') { errs.write(`${name}: no shell is available in this process\n`); return 127 }
        return this.shell(script, { cwd: spec.cwd, env: spec.env, out: out.write, err: errs.write, signal: ctl.signal, policy })
      }
    } else {
      const done = Promise.reject(eperm(argv[0]))
      done.catch(() => {})
      return { stdin: undefined, stdout: undefined, stderr: undefined, control: undefined, collected: {}, done, terminate() {}, waitForExit: async () => true }
    }
    const done = Promise.resolve().then(run).then((code) => ({ exitCode: code, signal: ctl.signal.aborted ? 'SIGTERM' : null }), (e) => { errs.write(String(e && e.message ? e.message : e) + '\n'); return { exitCode: 2, signal: null } })
      .finally(() => { out.end(); errs.end() })
    const handle = { stdin: undefined, stdout: out.stream, stderr: errs.stream, control: undefined, collected: { stdout: out.reader, stderr: errs.reader }, done, terminate: () => ctl.abort(), waitForExit: async () => { await done; return true } }
    this.live.add(handle)
    done.finally(() => this.live.delete(handle))
    return handle
  }

  async spawnTerminal() { throw eperm('terminal') }
}
