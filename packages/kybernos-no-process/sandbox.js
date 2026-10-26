// kybernos-no-process/sandbox: the engine's SandboxProvider for a host that runs commands inside the process. `confine` cannot wrap argv in an OS
// runner there; it wraps it for the in-process runner, which enforces the file policy itself (the in-process shell checks every write against it).
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'

export const CONFINE = '/__inproc__/confine'

export default class InProcessSandbox extends SandboxProvider {
  async confine(argv, policy) {
    return {
      argv: [CONFINE, policy.mode, policy.workspaceRoot, ...argv],
      enforcement: 'full',
      denialSignatures: ['operation not permitted (sandbox', 'read-only file system'],
      runnerFailureRules: [],
    }
  }
}
