import { redact } from './redact'

/** The last lines of the engine's console for the boot screen: redacted, empty lines dropped, long lines cut. */
export const tailLines = (log: string, count = 6, width = 110): string =>
  redact(log).split('\n').map((l) => l.trim()).filter((l) => l !== '').slice(-count).map((l) => (l.length > width ? l.slice(0, width - 1) + '…' : l)).join('\n')

/** One block of text, starting with a fixed marker so a remote driver finds it in the page source ("engine log:"). */
export const bootDiagnosticsText = (d: { status: string; signInInLog: boolean; probe: string | null; exitCode: number | null }, log: string, elapsedS: number): string =>
  ['engine log: ' + elapsedS + ' s, status ' + d.status + ', sign-in line ' + (d.signInInLog ? 'found' : 'not yet') + ', probe ' + (d.probe ?? 'none yet') + (d.exitCode !== null ? ', exit ' + d.exitCode : ''), tailLines(log)].filter((x) => x !== '').join('\n')
