// The on-disk cache of the signed online catalogue: two files that only mean something TOGETHER (the release bytes and their signature).
//
// Written as two separate atomic writes, a failure of the second (disk full, volume unmounted) left NEW bytes next to an OLD signature. The next start
// then read « signature », the verdict that means « tampered », for bytes that were genuine, and the panel offered to download again instead of
// repairing. The rules here:
//   1. both files are first written under temporary names: a failure at this step leaves the previous pair untouched;
//   2. the old signature is removed BEFORE the bytes are replaced, so at no instant (nor after a crash) do new bytes sit next to an old signature:
//      a pair with one file missing reads as « no cache », never as « tampered »;
//   3. a failure while the pair is being replaced removes the pair (and the temporary files): the state left behind is « no cache ».
// Side effects go through `fs` so a test can make any step fail.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const REEL = { mkdirSync, writeFileSync, renameSync, rmSync }

/** Write `{ octets, signature }` as the pair `cache` + `cache.sig`. Throws when it could not; the pair is then either the previous one or absent. */
export function ecrirePaire (cache, { octets, signature }, fs = REEL) {
  const sig = cache + '.sig'
  const tmpOctets = cache + '.tmp-' + process.pid
  const tmpSig = sig + '.tmp-' + process.pid
  const nettoyer = () => { for (const f of [tmpOctets, tmpSig]) { try { fs.rmSync(f, { force: true }) } catch { /* nothing to clean */ } } }
  try {
    fs.mkdirSync(dirname(cache), { recursive: true })
    fs.writeFileSync(tmpOctets, octets)
    fs.writeFileSync(tmpSig, signature)
  } catch (e) { nettoyer(); throw e }
  try {
    fs.rmSync(sig, { force: true })
    fs.renameSync(tmpOctets, cache)
    fs.renameSync(tmpSig, sig)
  } catch (e) {
    for (const f of [cache, sig]) { try { fs.rmSync(f, { force: true }) } catch { /* the next read fails on a missing file anyway */ } }
    nettoyer()
    throw e
  }
}

/** Read the pair, or null when either file is missing or unreadable. */
export function lirePaire (cache, lire = readFileSync) {
  try { return { octets: lire(cache), signature: lire(cache + '.sig', 'utf8') } } catch { return null }
}
