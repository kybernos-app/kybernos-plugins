// kybernos-summary — host half. The tab is client-only (it reads what the engine already holds in the browser), so
// there is nothing to serve here; the file exists because every bundle has both halves.
export const name = 'kybernos-summary'
export function apply (ctx) {
  try {
    void ctx
  } catch (e) {
    console.log('[kybernos-summary] disabled: ' + String(e?.message ?? e))
  }
}
