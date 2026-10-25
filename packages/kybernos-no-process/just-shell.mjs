// The shell of this host: just-bash (a bash written in JavaScript, Apache-2.0) over a virtual file system that mirrors the sandbox policy.
//   read-only         -> the workspace is a read-only overlay: reads come from disk, writes are refused
//   workspace-write   -> the workspace is mounted read-write at its REAL absolute path (the paths the other tools print keep working); /tmp is in memory
//   danger-full-access-> the whole disk is mounted read-write
// Same signature as mini-shell.mjs: (script, { cwd, env, out, err, signal, policy }) => exit code.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Bash, InMemoryFs, MountableFs, OverlayFs, ReadWriteFs } from 'just-bash'

// Anything outside the mounted workspace and /tmp is a read-only view of an empty directory: a write there fails loudly instead of landing in memory and vanishing.
let emptyDir = null
const empty = () => (emptyDir ??= mkdtempSync(join(tmpdir(), 'kybernos-empty-')))

const cleanEnv = (env) => { const o = {}; for (const [k, v] of Object.entries(env ?? {})) if (typeof v === 'string') o[k] = v; return o }

export const runShell = async (script, { cwd, env, out, err, signal, policy }) => {
  const mode = policy?.mode ?? 'danger-full-access'
  const root = policy?.root ?? cwd
  let fs
  if (mode === 'danger-full-access') fs = new ReadWriteFs({ root: '/' })
  else {
    fs = new MountableFs({ base: new OverlayFs({ root: empty(), readOnly: true }) })
    fs.mount('/tmp', new InMemoryFs())
    if (mode === 'read-only') fs.mount(root, new OverlayFs({ root, readOnly: true }))
    else fs.mount(root, new ReadWriteFs({ root }))
  }
  const opts = { fs, cwd, env: cleanEnv(env) }
  if (process.env.KYBERNOS_INPROC_NET === '1') opts.network = { dangerouslyAllowFullInternetAccess: true }
  const bash = new Bash(opts)
  let r
  try { r = await bash.exec(script, { signal }) } catch (e) { err('bash: ' + (e && e.message ? e.message : String(e)) + (/EROFS|read-only/i.test(String(e && e.message)) ? ' (sandbox ' + mode + ')' : '') + '\n'); return 1 }
  if (r.stdout) out(r.stdout)
  if (r.stderr) err(r.stderr)
  return r.exitCode
}
