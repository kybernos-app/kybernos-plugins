// The Kybernos icon and its launcher: the picture, the script, the files, with a fake system. The real macOS check (iconutil, LaunchServices) is
// played by hand and written in the commit message.
//   node scripts/test-lanceur-bureau.mjs   (0 = all green)
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { NOMS_ICONSET, peindreK, pngK } from './icone-kybernos.mjs'
import { FAMILLES_LANCEUR, ID_APP, OUTILS, guillemets, installerLanceur, installerOutils, planLanceur, retirerLanceur, scriptMac } from './lanceur-bureau.mjs'

let total = 0
const echecs = []
const ok = (nom, cond, detail = '') => { total++; if (!cond) echecs.push(nom + (detail ? ' — ' + detail : '')) }

// ── the picture ──
const crc = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return (b) => { let c = 0xffffffff; for (const o of b) c = t[(c ^ o) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 } })()
const png = pngK(128)
ok('the PNG starts with the PNG signature', png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a')
{
  let pos = 8; const types = []; let bonCrc = true; let idat = null; let ihdr = null
  while (pos < png.length) {
    const len = png.readUInt32BE(pos); const type = png.subarray(pos + 4, pos + 8).toString('latin1'); const data = png.subarray(pos + 8, pos + 8 + len)
    if (crc(Buffer.concat([Buffer.from(type, 'latin1'), data])) !== png.readUInt32BE(pos + 8 + len)) bonCrc = false
    types.push(type); if (type === 'IDAT') idat = data; if (type === 'IHDR') ihdr = data
    pos += 12 + len
  }
  ok('chunks: IHDR, IDAT, IEND, each with a good CRC', types.join() === 'IHDR,IDAT,IEND' && bonCrc)
  ok('IHDR says 128 x 128, 8-bit RGBA', ihdr.readUInt32BE(0) === 128 && ihdr.readUInt32BE(4) === 128 && ihdr[8] === 8 && ihdr[9] === 6)
  const brut = inflateSync(idat)
  ok('the pixel rows add up (1 filter byte + 4 bytes per pixel)', brut.length === 128 * (128 * 4 + 1))
}
const px = (rgba, taille, x, y) => Array.from(rgba.subarray((y * taille + x) * 4, (y * taille + x) * 4 + 4))
{
  const t = 256; const k = peindreK(t)
  ok('the corners of the plate are transparent', px(k, t, 0, 0)[3] === 0 && px(k, t, t - 1, t - 1)[3] === 0)
  ok('the plate is white', JSON.stringify(px(k, t, 30, 128)) === '[255,255,255,255]')
  const echelle = (t * 0.56) / 36; const ox = (t - 32.5 * echelle) / 2; const oy = (t - 36 * echelle) / 2
  const sur = (kx, ky) => px(k, t, Math.round(ox + kx * echelle), Math.round(oy + ky * echelle))
  ok('the stem of the K is the brand red', JSON.stringify(sur(11, 33)) === '[242,55,42,255]')
  ok('the three dots are white on the stem', [7.5, 18, 28.5].every((ky) => JSON.stringify(sur(6.5, ky)) === '[255,255,255,255]'))
  ok('the arm and the leg are red', JSON.stringify(sur(24, 6)) === '[242,55,42,255]' && JSON.stringify(sur(26, 32)) === '[242,55,42,255]')
}
ok('the iconset names ten files of the five sizes macOS asks for', NOMS_ICONSET.length === 10 && new Set(NOMS_ICONSET.map((n) => n[1])).size === 7 && NOMS_ICONSET.some(([n, s]) => n === 'icon_512x512' + '@' + '2x.png' && s === 1024))

// ── the script ──
ok('shell quoting survives a quote in a path', guillemets("/srv/o'neil/x") === "'/srv/o'\\''neil/x'")
const ctx = { home: '/Users/me', node: '/opt/homebrew/bin/node', ouvrir: '/Users/me/.dsh/kybernos/bin/kybernos-open.mjs', port: 3080, path: '/opt/homebrew/bin:/usr/bin' }
const sh = scriptMac(ctx)
ok('the script runs kybernos-open on the right port and forwards its arguments', sh.includes("'/opt/homebrew/bin/node' '/Users/me/.dsh/kybernos/bin/kybernos-open.mjs' --port 3080 \"$@\""))
ok('the script carries the PATH, no key', sh.includes("PATH='/opt/homebrew/bin:/usr/bin'") && !/API_KEY|TOKEN|SECRET|PASSWORD/i.test(sh))
ok('the person is told while it starts, and told if it fails (not a silent nothing)', sh.includes('display notification') && sh.includes('display dialog') && sh.includes('curl -sf'))
ok('both messages exist in French and English', sh.includes('Kybernos démarre') && sh.includes('Kybernos is starting') && sh.includes("n'a pas pu démarrer") && sh.includes('could not start'))
{
  const d = mkdtempSync(join(tmpdir(), 'kb-lanceur-')); writeFileSync(join(d, 'k.sh'), sh)
  let bon = true; try { execFileSync('sh', ['-n', join(d, 'k.sh')]) } catch { bon = false }
  rmSync(d, { recursive: true, force: true })
  ok('the script is valid shell (sh -n)', bon)
}
ok('a path with a quote cannot break out of the script', !scriptMac({ ...ctx, node: "/a'; rm -rf ~; '" }).includes("'/a'; rm"))

// ── where it goes ──
ok('macOS: Kybernos.app in ~/Applications', planLanceur('mac', ctx).chemin === '/Users/me/Applications/Kybernos.app')
ok('macOS: the program is executable', planLanceur('mac', ctx).fichiers.find((f) => f.chemin.endsWith('MacOS/Kybernos')).mode === 0o755)
ok('Linux: a .desktop file and its icon under ~/.local/share', planLanceur('linux', ctx).chemin === '/Users/me/.local/share/applications/kybernos.desktop' && planLanceur('linux', ctx).icone.endsWith('hicolor/256x256/apps/kybernos.png'))
ok('Linux: no terminal window, the right program', planLanceur('linux', ctx).fichiers[0].contenu.includes('Terminal=false') && planLanceur('linux', ctx).fichiers[0].contenu.includes('--port 3080'))
ok('Windows: nothing is written', planLanceur('windows', ctx) === null && FAMILLES_LANCEUR.join() === 'mac,linux')

// ── writing it, on a fake system ──
const faux = ({ fichiers = {}, iconutil = 0 } = {}) => {
  const fs = { ...fichiers }; const cmds = []; const supprimes = []; const dossiers = []
  return {
    fs, cmds, supprimes, dossiers,
    io: {
      dossier: (c) => { dossiers.push(c); cmds.push('mkdir ' + c) },
      existe: (c) => c in fs, lire: (c) => fs[c],
      ecrire: (c, contenu, mode) => { fs[c] = typeof contenu === 'string' ? contenu : Buffer.from(contenu); fs['mode:' + c] = mode },
      supprimer: (c) => { supprimes.push(c); for (const k of Object.keys(fs)) if (k === c || k.startsWith(c + '/') || k === 'mode:' + c || k.startsWith('mode:' + c + '/')) delete fs[k] },
      dossierTemporaire: () => '/tmp/kb-icon-x',
      executer: async (cmd) => { cmds.push(cmd.join(' ')); return { code: iconutil } },
    },
  }
}
{
  const f = faux()
  const r = await installerLanceur({ fam: 'mac', ctx, io: f.io })
  ok('macOS: created, with its icon', r.ok === true && r.icone === true && r.chemin === '/Users/me/Applications/Kybernos.app')
  ok('macOS: Info.plist and the program are written, the program is executable', f.fs['/Users/me/Applications/Kybernos.app/Contents/Info.plist'].includes(ID_APP) && f.fs['mode:/Users/me/Applications/Kybernos.app/Contents/MacOS/Kybernos'] === 0o755)
  ok('macOS: the Resources folder exists BEFORE iconutil writes into it, and the ten iconset files go through it', Object.keys(f.fs).filter((k) => k.includes('.iconset/')).length === 0 && f.cmds.join(' | ') === 'mkdir /Users/me/Applications/Kybernos.app/Contents/Resources | iconutil -c icns /tmp/kb-icon-x/Kybernos.iconset -o /Users/me/Applications/Kybernos.app/Contents/Resources/Kybernos.icns')
  ok('macOS: the temporary folder is removed', f.supprimes.includes('/tmp/kb-icon-x'))
  const r2 = await installerLanceur({ fam: 'mac', ctx, io: f.io })
  ok('macOS: a second run refreshes it', r2.ok === true && r2.etapes[0].startsWith('refresh'))
}
{
  const f = faux({ iconutil: 1 })
  const r = await installerLanceur({ fam: 'mac', ctx, io: f.io })
  ok('macOS: iconutil refusing leaves a working launcher and says so', r.ok === true && r.icone === false && r.etapes.some((e) => e.includes('plain icon')))
}
{
  const f = faux({ fichiers: { '/Users/me/Applications/Kybernos.app/Contents/Info.plist': '<plist>someone else</plist>' } })
  const r = await installerLanceur({ fam: 'mac', ctx, io: f.io })
  ok('macOS: an app of that name that is not ours is never touched', r.ok === false && r.raison === 'not-ours' && f.supprimes.length === 0 && f.fs['/Users/me/Applications/Kybernos.app/Contents/Info.plist'] === '<plist>someone else</plist>')
  const rr = retirerLanceur({ fam: 'mac', ctx, io: f.io })
  ok('macOS: removing refuses an app that is not ours', rr.ok === false && f.supprimes.length === 0)
}
{
  const f = faux()
  const r = await installerLanceur({ fam: 'mac', ctx, io: f.io, dry: true })
  ok('dry: nothing written', r.ok === true && r.dry === true && Object.keys(f.fs).length === 0 && f.cmds.length === 0)
  await installerLanceur({ fam: 'mac', ctx, io: f.io })
  const rr = retirerLanceur({ fam: 'mac', ctx, io: f.io })
  ok('remove: takes our app away', rr.ok === true && !f.io.existe('/Users/me/Applications/Kybernos.app/Contents/Info.plist') && f.supprimes.includes('/Users/me/Applications/Kybernos.app'))
  ok('remove: nothing there is not an error', retirerLanceur({ fam: 'mac', ctx, io: faux().io }).ok === true)
}
{
  const f = faux()
  const r = await installerLanceur({ fam: 'linux', ctx, io: f.io })
  ok('Linux: the .desktop and a PNG icon are written, no iconutil', r.ok === true && r.icone === true && f.cmds.length === 0 && Buffer.isBuffer(f.fs['/Users/me/.local/share/icons/hicolor/256x256/apps/kybernos.png']))
  ok('Windows: refused, nothing written', (await installerLanceur({ fam: 'windows', ctx, io: f.io })).raison === 'not-measured')
}
// ── the small programs the icon runs ──
{
  const src = Object.fromEntries(OUTILS.map((n) => ['/s/' + n, 'contenu de ' + n]))
  const f = faux({ fichiers: src })
  const premier = installerOutils({ source: '/s', destination: '/d', io: f.io })
  ok('tools: all copied the first time', premier.join() === OUTILS.join() && f.fs['/d/kybernos-open.mjs'] === 'contenu de kybernos-open.mjs')
  ok('tools: nothing rewritten when identical', installerOutils({ source: '/s', destination: '/d', io: f.io }).length === 0)
  f.fs['/s/plateforme.mjs'] = 'nouveau'
  ok('tools: only the changed one is rewritten', installerOutils({ source: '/s', destination: '/d', io: f.io }).join() === 'plateforme.mjs')
}

console.log('KYBERNOS LAUNCHER — ' + total + ' assertions, ' + echecs.length + ' failure(s)')
for (const e of echecs) console.log('  ✗ ' + e)
process.exit(echecs.length === 0 ? 0 : 1)
