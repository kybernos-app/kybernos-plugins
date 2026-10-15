// kybernos-kyber — host half. The tab is client-only (it reads `/kybernos-cloud/kyber`, which the cloud plugin serves with the
// account's token), so there is nothing to serve here; the file exists because every bundle has both halves.
export const name = 'kybernos-kyber'
export function apply (ctx) {
  try {
    void ctx
  } catch (e) {
    console.log('[kybernos-kyber] disabled: ' + String(e?.message ?? e))
  }
}
