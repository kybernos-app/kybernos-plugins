// deploy.mjs — the deployable artifact of one app: a faithful snapshot with a checksum manifest,
// built WITHOUT secrets. This is the locally provable half of the cloud batch (the Fly provisioning
// consumes it later): what goes in, what must never go in, and that the copy is faithful.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { cpSync } from 'node:fs'

const HORS = new Set(['.deploy', 'logs', 'node_modules', '.runtime.json', '.git'])
const SECRETS = [
  { nom: 'Stripe secret key', motif: /sk_(live|test)_[A-Za-z0-9]{8,}/ },
  { nom: 'Stripe publishable key', motif: /pk_(live|test)_[A-Za-z0-9]{8,}/ },
  { nom: 'assigned credential', motif: /(api[_-]?key|secret|token|password|passwd)\s*[:=]\s*['"][A-Za-z0-9_\-/+=]{16,}['"]/i },
]
const TEXTES = new Set(['.js', '.mjs', '.cjs', '.json', '.html', '.css', '.sql', '.md', '.txt', '.yml', '.yaml', '.toml'])

const marcher = (racine, dossier, sortie) => {
  const fichiers = []
  for (const entree of readdirSync(dossier, { withFileTypes: true })) {
    if (HORS.has(entree.name) === true) continue
    const absolu = join(dossier, entree.name)
    if (entree.isDirectory() === true) { fichiers.push(...marcher(racine, absolu, sortie)); continue }
    if (entree.isFile() !== true) continue
    if (/^\.env/i.test(entree.name) === true || /^credentials/i.test(entree.name) === true) {
      throw new Error('refused: a credentials file would enter the artifact (' + entree.name + ')')
    }
    const contenu = readFileSync(absolu)
    const extension = entree.name.slice(entree.name.lastIndexOf('.'))
    if (TEXTES.has(extension) === true) {
      const texte = contenu.toString('utf8')
      for (const s of SECRETS) {
        if (s.motif.test(texte) === true) throw new Error('refused: ' + s.nom + ' found in ' + relative(racine, absolu))
      }
    }
    fichiers.push({ chemin: relative(racine, absolu).split(sep).join('/'), poids: contenu.length, sha256: createHash('sha256').update(contenu).digest('hex') })
  }
  return fichiers
}

/**
 * Build the artifact: `<dir>/.deploy/app/` (the snapshot) + `manifest.json` (files, checksums,
 * size). Refuses outright when a credentials file or a secret-shaped string would enter.
 */
export function buildDeploy (dir) {
  const sortie = join(dir, '.deploy')
  try {
    rmSync(sortie, { recursive: true, force: true })
    const cible = join(sortie, 'app')
    mkdirSync(cible, { recursive: true })
    const fichiers = marcher(dir, dir, cible)
    for (const f of fichiers) {
      mkdirSync(join(cible, f.chemin.split('/').slice(0, -1).join('/')), { recursive: true })
      cpSync(join(dir, f.chemin), join(cible, f.chemin))
    }
    const manifeste = {
      version: 1,
      construit_le: new Date().toISOString(),
      fichiers,
      poids: fichiers.reduce((s, f) => s + f.poids, 0),
    }
    writeFileSync(join(sortie, 'manifest.json'), JSON.stringify(manifeste, null, 2) + '\n')
    return { ok: true, sortie, fichiers: fichiers.length, poids: manifeste.poids }
  } catch (e) {
    rmSync(sortie, { recursive: true, force: true })
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) }
  }
}

/** Verify an artifact against its manifest (the deploy step runs this before shipping). */
export function verifyDeploy (dir) {
  try {
    const manifeste = JSON.parse(readFileSync(join(dir, '.deploy', 'manifest.json'), 'utf8'))
    for (const f of manifeste.fichiers) {
      const absolu = join(dir, '.deploy', 'app', ...f.chemin.split('/'))
      if (existsSync(absolu) !== true) return { ok: false, error: 'missing file: ' + f.chemin }
      const somme = createHash('sha256').update(readFileSync(absolu)).digest('hex')
      if (somme !== f.sha256) return { ok: false, error: 'checksum mismatch: ' + f.chemin }
    }
    return { ok: true, fichiers: manifeste.fichiers.length, poids: manifeste.poids }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e).slice(0, 160) }
  }
}
