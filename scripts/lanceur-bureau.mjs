// ── A Kybernos icon to click ────────────────────────────────────────────────
//
// A person who does not use a terminal cannot type `node scripts/kybernos-open.mjs`, and a bare `http://127.0.0.1:3080/` answers a plain-text 401
// once the browser's cookie is gone. So the installer puts a launcher where they look for programs, and it only runs `kybernos-open`: start
// Kybernos if it is not running, wait until it is ready, open the browser already signed in.
//
//   macOS  → ~/Applications/Kybernos.app   (a folder with a shell script and the K icon; made HERE, so the system has nothing to warn about)
//   Linux  → ~/.local/share/applications/kybernos.desktop + the icon
//   Windows → not written: nothing of the Windows install has been run, same rule as the start-at-login unit.
//
// The program the icon runs lives in `~/.dsh/kybernos/bin/` (copied by `installerOutils`), not in the archive folder the installer came from: that
// folder changes with every update. Everything takes its I/O as `io`, like service-demarrage.mjs.
import { dirname, join } from 'node:path'
import { NOMS_ICONSET, pngK } from './icone-kybernos.mjs'

export const FAMILLES_LANCEUR = ['mac', 'linux']
export const ID_APP = 'app.kybernos.launcher'
/** The files `kybernos-open.mjs` needs, copied side by side (it imports the second). */
export const OUTILS = ['kybernos-open.mjs', 'service-demarrage.mjs', 'plateforme.mjs']

/** A string as ONE argument of a POSIX shell. */
export const guillemets = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'"

/** The program of `Kybernos.app`. A person gets a note while it starts and a dialog if it fails, in their system language, never a silent nothing. */
export const scriptMac = ({ node, ouvrir, port, path }) => `#!/bin/sh
# Kybernos launcher, written by the Kybernos installer. All it does is run kybernos-open: start Kybernos if needed, open it signed in.
PATH=${guillemets(path)}
export PATH
fr=0
case "$(defaults read -g AppleLanguages 2>/dev/null | tr -d '[:space:]"(),' | cut -c1-2)" in fr) fr=1 ;; esac
if ! curl -sf -m 2 -o /dev/null http://127.0.0.1:${Number(port)}/kybernos-hub/state; then
  if [ "$fr" = 1 ]; then texte="Kybernos démarre. Il s'ouvre dans une vingtaine de secondes."; else texte="Kybernos is starting. It opens in about 20 seconds."; fi
  osascript -e "display notification \\"$texte\\" with title \\"Kybernos\\"" >/dev/null 2>&1
fi
${guillemets(node)} ${guillemets(ouvrir)} --port ${Number(port)} "$@"
code=$?
if [ "$code" -ne 0 ]; then
  if [ "$fr" = 1 ]; then texte="Kybernos n'a pas pu démarrer. Redémarrez l'ordinateur puis réessayez ; si cela continue, envoyez-nous le fichier dsh-web.err.log du dossier .dsh/logs."; else texte="Kybernos could not start. Restart your computer and try again; if it keeps happening, send us the file dsh-web.err.log from the .dsh/logs folder."; fi
  osascript -e "display dialog \\"$texte\\" with title \\"Kybernos\\" buttons {\\"OK\\"} default button \\"OK\\" with icon caution" >/dev/null 2>&1
fi
exit "$code"
`

export const infoPlistMac = () => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Kybernos</string>
  <key>CFBundleDisplayName</key><string>Kybernos</string>
  <key>CFBundleIdentifier</key><string>${ID_APP}</string>
  <key>CFBundleExecutable</key><string>Kybernos</string>
  <key>CFBundleIconFile</key><string>Kybernos</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleShortVersionString</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
`

export const desktopLinux = ({ node, ouvrir, port, icone }) => `[Desktop Entry]
Type=Application
Name=Kybernos
Comment=Open Kybernos
Exec="${node}" "${ouvrir}" --port ${Number(port)}
Icon=${icone}
Terminal=false
Categories=Office;Utility;
`

/** Where each family puts its launcher, and what is written there. `ctx`: { home, node, ouvrir, port, path }. */
export const planLanceur = (fam, ctx) => {
  if (!FAMILLES_LANCEUR.includes(fam)) return null
  if (fam === 'mac') {
    const app = join(ctx.home, 'Applications', 'Kybernos.app')
    return {
      fam, chemin: app, marque: join(app, 'Contents', 'Info.plist'), icone: join(app, 'Contents', 'Resources', 'Kybernos.icns'),
      fichiers: [
        { chemin: join(app, 'Contents', 'Info.plist'), contenu: infoPlistMac(), mode: 0o644 },
        { chemin: join(app, 'Contents', 'MacOS', 'Kybernos'), contenu: scriptMac(ctx), mode: 0o755 },
      ],
    }
  }
  const icone = join(ctx.home, '.local', 'share', 'icons', 'hicolor', '256x256', 'apps', 'kybernos.png')
  const bureau = join(ctx.home, '.local', 'share', 'applications', 'kybernos.desktop')
  return { fam, chemin: bureau, marque: bureau, icone, fichiers: [{ chemin: bureau, contenu: desktopLinux({ ...ctx, icone }), mode: 0o644 }] }
}

/** Copies the small programs the icon runs into `destination`, only the ones that differ. Returns the names written. */
export const installerOutils = ({ source, destination, io }) => {
  const ecrits = []
  for (const nom of OUTILS) {
    const voulu = io.lire(join(source, nom))
    const chemin = join(destination, nom)
    if (io.existe(chemin) && io.lire(chemin) === voulu) continue
    io.ecrire(chemin, voulu, 0o644); ecrits.push(nom)
  }
  return ecrits
}

/**
 * Writes the launcher. `io`: { existe, lire, ecrire(chemin, contenu, mode), dossier(chemin) (mkdir -p), supprimer(chemin), dossierTemporaire() → path, executer(argv) → { code } }.
 * A folder named Kybernos.app that is not ours is never touched. An icon that cannot be built leaves a working launcher with the system's plain icon.
 */
export async function installerLanceur ({ fam, ctx, io, dry = false }) {
  const plan = planLanceur(fam, ctx)
  if (plan === null) return { ok: false, raison: 'not-measured', etapes: [] }
  if (io.existe(plan.marque) && !io.lire(plan.marque).includes(fam === 'mac' ? ID_APP : 'Name=Kybernos')) {
    return { ok: false, raison: 'not-ours', etapes: [], chemin: plan.chemin, message: plan.chemin + ' exists and was not made by Kybernos: left alone.' }
  }
  const etapes = [(io.existe(plan.marque) ? 'refresh ' : 'create ') + plan.chemin]
  if (dry) return { ok: true, dry: true, etapes, chemin: plan.chemin }
  for (const f of plan.fichiers) io.ecrire(f.chemin, f.contenu, f.mode)
  let icone = false
  if (fam === 'linux') { io.ecrire(plan.icone, pngK(256), 0o644); icone = true } else {
    const tmp = io.dossierTemporaire(); const jeu = join(tmp, 'Kybernos.iconset')
    try {
      const rendus = new Map()
      for (const [nom, taille] of NOMS_ICONSET) { if (!rendus.has(taille)) rendus.set(taille, pngK(taille)); io.ecrire(join(jeu, nom), rendus.get(taille), 0o644) }
      // iconutil does not create the folder it writes into (measured: « Failed to generate ICNS » when Resources/ is missing).
      io.dossier(dirname(plan.icone))
      icone = (await io.executer(['iconutil', '-c', 'icns', jeu, '-o', plan.icone])).code === 0
    } catch { icone = false } finally { io.supprimer(tmp) }
    if (!icone) etapes.push('the K icon could not be built: the launcher works with the system\'s plain icon')
  }
  return { ok: true, etapes, chemin: plan.chemin, icone }
}

/** Takes the launcher away (only if it is ours). */
export const retirerLanceur = ({ fam, ctx, io }) => {
  const plan = planLanceur(fam, ctx)
  if (plan === null || !io.existe(plan.marque)) return { ok: true, etapes: [] }
  if (!io.lire(plan.marque).includes(fam === 'mac' ? ID_APP : 'Name=Kybernos')) return { ok: false, raison: 'not-ours', etapes: [] }
  io.supprimer(plan.chemin)
  if (fam === 'linux') io.supprimer(plan.icone)
  return { ok: true, etapes: ['removed ' + plan.chemin] }
}

