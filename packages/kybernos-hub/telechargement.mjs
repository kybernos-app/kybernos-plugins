// The disk and network half of the online catalogue and of the suite update: small, bounded downloads, an archive streamed to a
// temp file while it is hashed, and a safe extraction. Everything is injected (fetch, temp folder, the tar and the robot launchers), so
// test-telechargement.mjs plays it against a local server and a temp folder.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const erreur = (code, message) => Object.assign(new Error(message ?? code), { code })

/** Pure. Does every path of a tar listing stay inside the folder it is extracted to? (no absolute path, no `..`) */
export const cheminsSurs = (liste) => String(liste).split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l !== '').every((l) => !/^([A-Za-z]:)?[\\/]/.test(l) && !l.split(/[\\/]/).includes('..'))

export function creerTelechargeurs ({ fetchImpl = (...a) => fetch(...a), tmp = tmpdir(), autoriserHttp = false, delaiMs = 30000, delaiArchiveMs = 600000, lancer = execFile } = {}) {
  let dossier = null
  const verifierUrl = (url) => {
    let u
    try { u = new URL(url) } catch (e) { throw erreur('url') }
    if (u.protocol !== 'https:' && !(autoriserHttp && u.protocol === 'http:')) throw erreur('url', 'https only')
    return u
  }
  const ouvrir = async (url, ms) => {
    verifierUrl(url)
    const rep = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(ms), headers: { accept: '*/*' } })
    if (!rep.ok) throw erreur('http', 'HTTP ' + String(rep.status))
    // A redirect must not downgrade the transport.
    if (typeof rep.url === 'string' && rep.url !== '') verifierUrl(rep.url)
    if (rep.body === null || rep.body === undefined) throw erreur('vide')
    return rep
  }
  return {
    /** A small document, in memory, never more than `max` bytes. */
    async telecharger (url, { max }) {
      const rep = await ouvrir(url, delaiMs)
      const lu = []
      let n = 0
      const lecteur = rep.body.getReader()
      for (;;) {
        const { done, value } = await lecteur.read()
        if (done) break
        n += value.length
        if (n > max) { try { await lecteur.cancel() } catch (e) { /* closing anyway */ } throw erreur('trop-gros') }
        lu.push(Buffer.from(value))
      }
      return Buffer.concat(lu)
    },
    /** An archive, streamed to a fresh temp folder while it is hashed. Resolves { fichier, sha256, taille }. */
    async telechargerVers (url, { max }) {
      const rep = await ouvrir(url, delaiArchiveMs)
      dossier = mkdtempSync(join(tmp, 'kybernos-update-'))
      const fichier = join(dossier, 'archive.tar.gz')
      const hash = createHash('sha256')
      const sortie = createWriteStream(fichier)
      let n = 0
      try {
        const lecteur = rep.body.getReader()
        for (;;) {
          const { done, value } = await lecteur.read()
          if (done) break
          n += value.length
          if (n > max) { try { await lecteur.cancel() } catch (e) { /* closing anyway */ } throw erreur('trop-gros') }
          hash.update(value)
          if (!sortie.write(value)) await new Promise((r) => sortie.once('drain', r))
        }
      } finally { await new Promise((r) => sortie.end(r)) }
      return { fichier, sha256: hash.digest('hex'), taille: n }
    },
    /** Extract the archive in the temp folder and return the folder that holds the robot and the manifest. Refuses unsafe paths. */
    async extraire (fichier) {
      const cible = join(dossier, 'contenu')
      mkdirSync(cible, { recursive: true })
      const tar = (args) => new Promise((resolve, reject) => lancer('tar', args, { maxBuffer: 16 * 1024 * 1024 }, (e, out) => (e ? reject(erreur('bad-archive', 'tar: ' + e.message)) : resolve(String(out)))))
      if (!cheminsSurs(await tar(['-tzf', fichier]))) throw erreur('bad-archive', 'the archive has a path that leaves its folder')
      await tar(['-xzf', fichier, '-C', cible])
      const candidats = [cible, ...readdirSync(cible).map((n) => join(cible, n)).filter((p) => statSync(p).isDirectory())]
      const racine = candidats.find((p) => existsSync(join(p, 'scripts', 'dsh-lifecycle.mjs')) && existsSync(join(p, 'manifest.json')))
      if (racine === undefined) throw erreur('bad-archive', 'no scripts/dsh-lifecycle.mjs and manifest.json in the archive')
      return racine
    },
    nettoyer () { if (dossier !== null) { try { rmSync(dossier, { recursive: true, force: true }) } catch (e) { /* left behind */ } dossier = null } },
    dossierTemporaire: () => dossier
  }
}
