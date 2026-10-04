#!/usr/bin/env node
/** Harnais client de kybernos-auto : parse module + garde-fous de surface,
 *  alignés sur la maquette composer-auto-c-health (panneau + santé). */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(HERE, 'client.js'), 'utf8')

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + String(detail).slice(0, 160) : '')) }
}
const aDataKb = (id) => src.indexOf("'data-kb': '" + id + "'") !== -1 || src.indexOf("setAttribute('data-kb', '" + id + "')") !== -1

ok('data-kb en anglais sur chaque surface (panneau, toggle, pastille, page, chips, santé, re-check, warm cache)',
  ['auto-popover', 'auto-chip-toggle', 'auto-available', 'auto-settings', 'auto-whitelist-chips', 'auto-whitelist-add', 'auto-health', 'auto-health-recheck', 'auto-last-check', 'auto-warm-cache', 'auto-global-toggle']
    .every(aDataKb), ['auto-popover', 'auto-chip-toggle', 'auto-available', 'auto-settings', 'auto-health-recheck', 'auto-warm-cache'].filter((i) => !aDataKb(i)).join(','))
ok('aucune couleur en dur (jetons --dsw-alias uniquement)', !/#[0-9a-fA-F]{6}\b/.test(src), (src.match(/#[0-9a-fA-F]{6}\b/g) || []).slice(0, 4))
ok('titles traduits par kt() (pas de français nu en attribut title)', !/title:\s*'[^']*[éèàêç][^']*'/.test(src) && !/\.title = '[^']*[éèàêç]/.test(src))
ok('la rangée Auto est un enfant du menu natif (sous Model/Effort), pas un overlay flottant',
  src.indexOf('m.appendChild(panneau)') !== -1 && src.indexOf('z-index:1200') === -1 && src.indexOf('document.body.appendChild') === -1)
ok('Model/Effort (menuitem) verrouillés tant qu’Auto est actif, la rangée Auto reste active',
  src.indexOf("querySelectorAll('[role=\"menuitem\"]')") !== -1 && src.indexOf("it.style.pointerEvents = on ? 'none'") !== -1)
ok('le menu est remonté du hauteur de la rangée (ancré par le haut)', src.indexOf("translateY(") !== -1)
ok('id de session lu dans localStorage « dsh.sessions.current » (pas seulement l’URL)', src.indexOf("'dsh.sessions.current'") !== -1)
ok('état PAR SESSION : POST /kybernos-auto/session avec sessionId courant', src.indexOf("'/kybernos-auto/session'") !== -1 && src.indexOf('sessionId: sessionIdCourante()') !== -1)
ok('pastille « N of M models available » alimentée par disponibles/total', src.indexOf('etat.disponibles') !== -1 && src.indexOf('etat.total') !== -1)
ok('colonnes Model / Latency / Errors / Cache hit + badge warm cache', src.indexOf("'Cache hit'") !== -1 && src.indexOf("'warm cache'") !== -1 && src.indexOf("'Latency'") !== -1)
ok('relecture automatique toutes les 60 s + « Check now » qui sonde pour de vrai (POST /kybernos-auto/probe)', src.indexOf('setInterval(lire, 60000)') !== -1 && src.indexOf("'Check now'") !== -1 && src.indexOf("'/kybernos-auto/probe'") !== -1)
ok('l’état d’un modèle dit POURQUOI (cause, retour prévu, dernière erreur), dans la page et dans le composer', src.indexOf('const statutTxt') !== -1 && src.indexOf("'data-kb': 'auto-health-why'") !== -1 && (src.match(/statutTxt\(/g) || []).length === 2)
ok('un clic dans le panneau ne ferme pas le menu natif (pointerdown arrêté)', src.indexOf("'pointerdown'") !== -1 && src.indexOf('stopPropagation') !== -1)

console.log('\n' + (ko === 0 ? 'HARNAIS CLIENT VERT — ' + ok0 + ' contrôles ✓' : ko + ' échec(s)'))
process.exit(ko === 0 ? 0 : 1)
