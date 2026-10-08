// Which Python runs a voice engine.
//
// DSH is started with whatever `python3` the shell had at that moment (Homebrew's, on the owner's Mac), while Piper and
// edge-tts are often installed for the system's. A voice engine whose module the first interpreter lacks was reported
// absent, or "ready" and then failing (measured 2026-10-08: Piper said ready, then "No module named piper"). An engine
// therefore runs with the first interpreter that can import its module.

export const TTS_PYTHONS = ['python3', '/usr/bin/python3', '/opt/homebrew/bin/python3', '/usr/local/bin/python3']

/**
 * exec(bin, argv, { timeoutMs }) → Promise<{ ok: boolean }>   (it never throws)
 * first(module) → the interpreter that imports it (and remembers it), or null
 * pythonOf(module) → the remembered interpreter, 'python3' when none is known
 */
export function createPythonPicker (exec, candidates = TTS_PYTHONS) {
  const found = {}
  const first = async (moduleName) => {
    const name = String(moduleName)
    const seen = new Set()
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue
      seen.add(candidate)
      let res = null
      try { res = await exec(candidate, ['-c', 'import ' + name], { timeoutMs: 20000 }) } catch (e) { res = null }
      if (res !== null && res !== undefined && res.ok === true) { found[name] = candidate; return candidate }
    }
    delete found[name]
    return null
  }
  const pythonOf = (moduleName) => found[String(moduleName)] ?? 'python3'
  return { first, pythonOf }
}
