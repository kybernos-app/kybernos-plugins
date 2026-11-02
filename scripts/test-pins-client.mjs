// Test du noyau PUR du réordonnancement, côté client : `scripts/dsh-pins-client.js`
// est injecté tel quel dans le bundle DSH (pas d'imports relatifs possibles),
// d'où l'extraction du bloc balisé KB-PINS-CLIENT-CORE — même méthode que
// scripts/test-pins-host.mjs pour le noyau de l'hôte.
//
// `kyberPinsMove` sert au clavier (Alt+↑/↓ : un cran), `kyberPinsPlace` au
// glisser-déposer calqué sur Workspaces : la moitié survolée décide de
// l'insertion AVANT ou APRÈS la rangée, ce n'est pas un échange de places.
// Usage : node scripts/test-pins-client.mjs   (exit 0 = tout passe)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(root + 'scripts/dsh-pins-client.js', 'utf8')
const m = src.match(/\/\/ KB-PINS-CLIENT-CORE-BEGIN([\s\S]*?)\/\/ KB-PINS-CLIENT-CORE-END/)
if (m === null) { console.error('BLOC KB-PINS-CLIENT-CORE INTROUVABLE'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1] + '\nexport { kyberPinsMove, kyberPinsPlace };'))

let fails = 0
const eq = (label, got, want) => {
  const ok = String(got) === String(want)
  if (ok !== true) { fails += 1; console.log('FAIL', label, '| got', String(got), '| want', String(want)) } else console.log('ok  ', label)
}
const ABC = ['a', 'b', 'c']

/* ── 1. Clavier : un cran, bornes, immuabilité ───────────────────────────── */
eq('move : descend d’un cran', JSON.stringify(mod.kyberPinsMove(ABC, 0, 1)), '["b","a","c"]')
eq('move : monte d’un cran', JSON.stringify(mod.kyberPinsMove(ABC, 2, 1)), '["a","c","b"]')
eq('move : même place = identique', JSON.stringify(mod.kyberPinsMove(ABC, 1, 1)), '["a","b","c"]')
eq('move : borne basse', JSON.stringify(mod.kyberPinsMove(ABC, 2, -5)), '["c","a","b"]')
eq('move : borne haute', JSON.stringify(mod.kyberPinsMove(ABC, 0, 99)), '["b","c","a"]')
eq('move : index de départ invalide', JSON.stringify(mod.kyberPinsMove(ABC, 9, 0)), '["a","b","c"]')
eq('move : liste trop courte', JSON.stringify(mod.kyberPinsMove(['a'], 0, 0)), '["a"]')
const source = ['a', 'b', 'c']
mod.kyberPinsMove(source, 0, 2)
eq('move : la liste d’entrée n’est pas modifiée', JSON.stringify(source), '["a","b","c"]')

/* ── 2. Dépôt : la moitié décide de l’insertion ──────────────────────────── */
const ABCD = ['a', 'b', 'c', 'd']
// Descendre : a déposé sur la moitié BASSE de c → juste après c.
eq('place : descendre, moitié basse (après la cible)', JSON.stringify(mod.kyberPinsPlace(ABCD, 0, 2, 'after')), '["b","c","a","d"]')
// Descendre : a déposé sur la moitié HAUTE de c → juste avant c.
eq('place : descendre, moitié haute (avant la cible)', JSON.stringify(mod.kyberPinsPlace(ABCD, 0, 2, 'before')), '["b","a","c","d"]')
// Monter : d déposé sur la moitié haute de b → juste avant b.
eq('place : monter, moitié haute', JSON.stringify(mod.kyberPinsPlace(ABCD, 3, 1, 'before')), '["a","d","b","c"]')
// Monter : d déposé sur la moitié basse de b → juste après b.
eq('place : monter, moitié basse', JSON.stringify(mod.kyberPinsPlace(ABCD, 3, 1, 'after')), '["a","b","d","c"]')
// Ranger voisin : a sur la moitié basse de b → ils s’échangent (l’ordre change).
eq('place : voisin immédiat, moitié basse', JSON.stringify(mod.kyberPinsPlace(ABC, 0, 1, 'after')), '["b","a","c"]')
// a sur la moitié HAUTE de b → il est déjà là : aucun changement.
eq('place : voisin immédiat, moitié haute = sur place', JSON.stringify(mod.kyberPinsPlace(ABC, 0, 1, 'before')), '["a","b","c"]')
// Dernier sur la première, moitié haute → tout en tête.
eq('place : dernier en tête', JSON.stringify(mod.kyberPinsPlace(ABC, 2, 0, 'before')), '["c","a","b"]')
// Moitié inconnue : traitée comme « après » (l’hôte DSH normalise pareil).
eq('place : moitié inconnue = après', JSON.stringify(mod.kyberPinsPlace(ABC, 0, 2, 'n’importe')), '["b","c","a"]')
// Cible et source confondues : on ne bouge pas.
eq('place : même rangée', JSON.stringify(mod.kyberPinsPlace(ABC, 1, 1, 'before')), '["a","b","c"]')
// Bornes et listes courtes.
eq('place : source hors bornes', JSON.stringify(mod.kyberPinsPlace(ABC, -1, 2, 'after')), '["a","b","c"]')
eq('place : cible hors bornes', JSON.stringify(mod.kyberPinsPlace(ABC, 0, 7, 'after')), '["a","b","c"]')
eq('place : liste trop courte', JSON.stringify(mod.kyberPinsPlace(['a'], 0, 0, 'after')), '["a"]')
const entree = ['a', 'b', 'c', 'd']
mod.kyberPinsPlace(entree, 0, 3, 'after')
eq('place : la liste d’entrée n’est pas modifiée', JSON.stringify(entree), '["a","b","c","d"]')
// Le geste ne perd ni ne duplique jamais un identifiant.
const grand = Array.from({ length: 40 }, (_, i) => 'id' + String(i))
const melange = mod.kyberPinsPlace(grand, 7, 31, 'before')
eq('place : même longueur', melange.length, grand.length)
eq('place : aucun doublon', new Set(melange).size, grand.length)
eq('place : la cible reste voisine de la source', melange.indexOf('id7') + 1, melange.indexOf('id31'))

console.log(fails === 0 ? '\n✓ ' + String(0) + ' échec — noyau de réordonnancement conforme' : '\n✗ ' + String(fails) + ' échec(s)')
process.exit(fails === 0 ? 0 : 1)
