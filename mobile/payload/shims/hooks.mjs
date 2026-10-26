// ESM resolve hook: stand-ins for what a phone cannot load.
//  - the two entry points of @deepseek-ai/node-addon-system (a file lock and a Landlock launcher: Linux/macOS native code) become plain JavaScript;
//  - @vscode/ripgrep throws on an unsupported platform before anything runs, so it answers with the path the in-process search provider recognises.
const wrap = (src) => 'data:text/javascript,' + encodeURIComponent(src)
const FLOCK = wrap(`export async function tryLockExclusive(fd) { return undefined }`)
const LANDLOCK = wrap(`
export const LAUNCHER_BIN = 'landlock-run'
export const LAUNCHER_FAILURE_EXIT = 125
export function launcherPath() { return '/nonexistent/landlock-run' }
export function grantArgs(g) { return [...(g.readOnly ?? []).flatMap((r) => ['--ro', r]), ...(g.readWrite ?? []).flatMap((r) => ['--rw', r])] }
export function probe() { return 'unusable' }`)
const RG = wrap(`export const rgPath = '/__inproc__/rg'`)
export async function resolve (specifier, context, next) {
  if (specifier === '@vscode/ripgrep') return { url: RG, shortCircuit: true }
  if (specifier === '@deepseek-ai/node-addon-system/flock') return { url: FLOCK, shortCircuit: true }
  if (specifier === '@deepseek-ai/node-addon-system/landlock-run') return { url: LANDLOCK, shortCircuit: true }
  return next(specifier, context)
}
