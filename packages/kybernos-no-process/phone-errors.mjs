// kybernos-no-process: clear error messages returned to the model when a phone cannot start an external program.
// Pure and dependency-free so tests can exercise the exact wording without the DSH engine runtime.

/** Plain message for the model when a command or program cannot be spawned on this phone. */
export const unavailableProgramMessage = (what) => {
  const name = String(what ?? 'program').trim() || 'program'
  return `${name} cannot run on this phone: this phone cannot start external programs (such as Node or standalone CLIs). Do not retry this command here. Explain plainly that running it requires connecting or choosing a remote or cloud Kybernos computer.`
}

/** EPERM error preserving code/errno/syscall for callers while giving the model a clear explanation with no internal jargon. */
export const epermError = (what) => Object.assign(new Error(unavailableProgramMessage(what)), { code: 'EPERM', errno: -1, syscall: 'spawn' })
