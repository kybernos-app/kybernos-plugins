// Test du noyau « épingles de la sidebar » : lecture tolérante, validation,
// bascule, plafond, sérialisation. Importe le bloc balisé KB-PINS-CORE de
// kybernos-plugin/index.js (le plugin host tourne en bundle sans imports
// relatifs — d'où l'extraction, comme scripts/test-scheduled-tasks-host.mjs).
// Usage : node scripts/test-pins-host.mjs   (exit 0 = tout passe)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const src = readFileSync(root + 'packages/kybernos-plugin/index.js', 'utf8')
const m = src.match(/\/\/ KB-PINS-CORE-BEGIN([\s\S]*?)\/\/ KB-PINS-CORE-END/)
if (m === null) { console.error('BLOC KB-PINS-CORE INTROUVABLE dans index.js'); process.exit(1) }
const mod = await import('data:text/javascript,' + encodeURIComponent(m[1]))

let fails = 0
const eq = (label, got, want) => {
  const ok = String(got) === String(want)
  if (ok !== true) { fails += 1; console.log('FAIL', label, '| got', String(got), '| want', String(want)) } else console.log('ok  ', label)
}

const WS = '863b38e2-1e81-4681-8fbf-785251e5708f'
const S1 = 'session-e2ac55e3-0f5e-4d0e-9c7f-1c7a3b1e0001'
const S2 = 'od-abc_12.34:56'

/* ── 1. État vide et champs de type ─────────────────────────────────────── */
eq('empty shape', JSON.stringify(mod.emptyPins()), '{"version":1,"workspaces":[],"sessions":[]}')
eq('field workspace', mod.pinsFieldOf('workspace'), 'workspaces')
eq('field session', mod.pinsFieldOf('session'), 'sessions')
eq('field inconnu', String(mod.pinsFieldOf('dossier')), 'null')
eq('nom du fichier', mod.PINS_FILE, '.kyber-pins.json')

/* ── 2. Validation d’identifiant (le fichier ne doit jamais porter de chemin) */
eq('uuid accepté', mod.isPinId(WS), 'true')
eq('session acceptée', mod.isPinId(S1), 'true')
eq('id vide refusé', mod.isPinId(''), 'false')
eq('espaces refusés', mod.isPinId('a b'), 'false')
eq('traversée refusée', mod.isPinId('../etc/passwd'), 'false')
eq('slash refusé', mod.isPinId('a/b'), 'false')
eq('point en tête refusé', mod.isPinId('.hidden'), 'false')
eq('non-chaîne refusée', mod.isPinId(42), 'false')
eq('trop long refusé', mod.isPinId('a'.repeat(mod.PINS_MAX_ID + 1)), 'false')
eq('longueur max acceptée', mod.isPinId('a'.repeat(mod.PINS_MAX_ID)), 'true')

/* ── 3. Lecture tolérante : ni exception, ni doublon, ni déchet ─────────── */
eq('normalize d’un non-objet', JSON.stringify(mod.normalizePins(null)), '{"version":1,"workspaces":[],"sessions":[]}')
eq('normalize chaîne', JSON.stringify(mod.normalizePins('x')), '{"version":1,"workspaces":[],"sessions":[]}')
eq('normalize dédoublonne et filtre',
  JSON.stringify(mod.normalizePins({ workspaces: [WS, WS, '', '../x', 'ok-id'], sessions: [S1, 7] })),
  '{"version":1,"workspaces":["' + WS + '","ok-id"],"sessions":["' + S1 + '"]}')
eq('normalize ignore un champ non-tableau',
  JSON.stringify(mod.normalizePins({ workspaces: 'nope', sessions: [S2] })),
  '{"version":1,"workspaces":[],"sessions":["' + S2 + '"]}')
eq('parse JSON cassé', JSON.stringify(mod.parsePins('{oops')), '{"version":1,"workspaces":[],"sessions":[]}')
eq('parse vide', JSON.stringify(mod.parsePins('   ')), '{"version":1,"workspaces":[],"sessions":[]}')
eq('parse non-chaîne', JSON.stringify(mod.parsePins(undefined)), '{"version":1,"workspaces":[],"sessions":[]}')
eq('parse version inconnue ramenée à 1',
  JSON.stringify(mod.parsePins('{"version":9,"workspaces":["' + WS + '"]}')),
  '{"version":1,"workspaces":["' + WS + '"],"sessions":[]}')

/* ── 4. Sérialisation : JSON lisible, saut de ligne final ───────────────── */
const serialized = mod.serializePins({ workspaces: [WS], sessions: [S1] })
eq('sérialisation indentée', serialized.split('\n')[1].startsWith('  "version"'), 'true')
eq('saut de ligne final', serialized.endsWith('\n'), 'true')
eq('aller-retour', JSON.stringify(mod.parsePins(serialized)), JSON.stringify({ version: 1, workspaces: [WS], sessions: [S1] }))
eq('projection wire', JSON.stringify(mod.pinsPayload({ version: 1, workspaces: [WS], sessions: [S1], extra: 1 })),
  '{"workspaces":["' + WS + '"],"sessions":["' + S1 + '"]}')

/* ── 5. Bascule : nouvel état, jamais de mutation ───────────────────────── */
const base = mod.emptyPins()
const pinned = mod.applyPin(base, { kind: 'workspace', id: WS, pinned: true })
eq('épinglage ok', pinned.ok, 'true')
eq('épinglage changed', pinned.changed, 'true')
eq('épinglage écrit la liste', JSON.stringify(pinned.pins.workspaces), '["' + WS + '"]')
eq('état d’origine intact', JSON.stringify(base.workspaces), '[]')
eq('re-épinglage = no-op', mod.applyPin(pinned.pins, { kind: 'workspace', id: WS, pinned: true }).changed, 'false')
const two = mod.applyPin(pinned.pins, { kind: 'session', id: S1, pinned: true })
eq('types indépendants', JSON.stringify(two.pins.workspaces) + '|' + JSON.stringify(two.pins.sessions), '["' + WS + '"]|["' + S1 + '"]')
eq('désépinglage', JSON.stringify(mod.applyPin(two.pins, { kind: 'session', id: S1, pinned: false }).pins.sessions), '[]')
eq('désépinglage d’un absent = no-op', mod.applyPin(two.pins, { kind: 'session', id: 'jamais-vu', pinned: false }).changed, 'false')
eq('ordre d’épinglage conservé',
  JSON.stringify(mod.applyPin(two.pins, { kind: 'session', id: S2, pinned: true }).pins.sessions),
  '["' + S1 + '","' + S2 + '"]')

/* ── 6. Refus : type, identifiant, booléen, plafond ─────────────────────── */
const badKind = mod.applyPin(base, { kind: 'dossier', id: WS, pinned: true })
eq('type inconnu refusé', badKind.ok, 'false')
eq('type inconnu — motif', badKind.error.includes('kind'), 'true')
eq('id invalide refusé', mod.applyPin(base, { kind: 'session', id: '../x', pinned: true }).ok, 'false')
eq('id invalide — motif', mod.applyPin(base, { kind: 'session', id: '../x', pinned: true }).error, 'id invalide')
eq('pinned non booléen refusé', mod.applyPin(base, { kind: 'session', id: S1, pinned: 'oui' }).ok, 'false')
eq('demande absente refusée', mod.applyPin(base, null).ok, 'false')
const full = { version: 1, workspaces: Array.from({ length: mod.PINS_MAX_PER_KIND }, (_, i) => 'ws-' + String(i)), sessions: [] }
eq('plafond atteint refusé', mod.applyPin(full, { kind: 'workspace', id: 'ws-new', pinned: true }).ok, 'false')
eq('plafond — désépinglage permis', mod.applyPin(full, { kind: 'workspace', id: 'ws-0', pinned: false }).ok, 'true')
eq('lecture plafonnée', mod.normalizePins({ workspaces: Array.from({ length: mod.PINS_MAX_PER_KIND + 50 }, (_, i) => 'ws-' + String(i)) }).workspaces.length, mod.PINS_MAX_PER_KIND)

/* ── 7. Une bascule refusée ne touche pas l’état reçu ───────────────────── */
const kept = mod.applyPin(pinned.pins, { kind: 'nope', id: WS, pinned: false })
eq('état inchangé après refus', JSON.stringify(kept.pins), JSON.stringify(pinned.pins))

/* ── 8. Réordonnancement : l’ordre donné devient la liste ───────────────── */
const trois = { version: 1, workspaces: [WS, 'ws-b', 'ws-c'], sessions: [S1, S2] }
eq('ordre appliqué', JSON.stringify(mod.applyPinOrder(trois, { kind: 'workspace', order: ['ws-c', WS, 'ws-b'] }).pins.workspaces),
  '["ws-c","' + WS + '","ws-b"]')
eq('ordre identique = no-op', mod.applyPinOrder(trois, { kind: 'workspace', order: [WS, 'ws-b', 'ws-c'] }).changed, 'false')
eq('ordre changé = écriture', mod.applyPinOrder(trois, { kind: 'workspace', order: ['ws-c', 'ws-b', WS] }).changed, 'true')
eq('ordre — l’état reçu n’est pas muté', JSON.stringify(trois.workspaces), '["' + WS + '","ws-b","ws-c"]')
eq('ordre — doublons retirés', JSON.stringify(mod.applyPinOrder(trois, { kind: 'session', order: [S2, S2, S1] }).pins.sessions), '["' + S2 + '","' + S1 + '"]')
eq('ordre — identifiant invalide ignoré', JSON.stringify(mod.applyPinOrder(trois, { kind: 'session', order: ['../x', S1] }).pins.sessions), '["' + S1 + '"]')
eq('ordre — liste vide acceptée', JSON.stringify(mod.applyPinOrder(trois, { kind: 'session', order: [] }).pins.sessions), '[]')
eq('ordre — type inconnu refusé', mod.applyPinOrder(trois, { kind: 'dossier', order: [WS] }).ok, 'false')
eq('ordre — sans liste refusée', mod.applyPinOrder(trois, { kind: 'session', order: 'a,b' }).ok, 'false')
eq('ordre — demande absente refusée', mod.applyPinOrder(trois, null).ok, 'false')
eq('ordre — refus n’écrit rien', JSON.stringify(mod.applyPinOrder(trois, { kind: 'nope', order: [WS] }).pins), JSON.stringify(trois))
eq('ordre — plafond refusé', mod.applyPinOrder(full, { kind: 'workspace', order: full.workspaces.concat(['ws-new']) }).ok, 'false')

/* ── 9. Appartenance NATIVE des conversations (0.1.7) ───────────────────── */
// DSH tient l'épinglage des conversations ; notre fichier ne porte plus que
// l'ordre. Une nouvelle épingle native passe devant (règle de DSH), une épingle
// native que nous avions ordonnée garde sa place relative.
const ordre = { version: 1, workspaces: [WS], sessions: [S2, S1] }
eq('natif : nouveau en tête, ordre conservé',
  JSON.stringify(mod.pinsPayload(ordre, [S1, 'session-nouvelle', S2]).sessions),
  '["session-nouvelle","' + S2 + '","' + S1 + '"]')
eq('natif : désépinglée disparaît de la projection',
  JSON.stringify(mod.pinsPayload(ordre, [S1]).sessions), '["' + S1 + '"]')
eq('natif : les dossiers restent les nôtres', JSON.stringify(mod.pinsPayload(ordre, []).workspaces), '["' + WS + '"]')
eq('natif : rien d’épinglé', JSON.stringify(mod.pinsPayload(ordre, []).sessions), '[]')
eq('natif : source annoncée', mod.pinsPayload(ordre, [S1]).source, 'natif')
eq('natif : identifiants invalides écartés', JSON.stringify(mod.pinsPayload(ordre, ['../x', S1]).sessions), '["' + S1 + '"]')
eq('natif : doublons écartés', JSON.stringify(mod.pinsPayload({ version: 1, workspaces: [], sessions: [] }, [S1, S1]).sessions), '["' + S1 + '"]')
eq('service absent : notre liste fait foi',
  JSON.stringify(mod.pinsPayload(ordre, null).sessions) + '|' + String(mod.pinsPayload(ordre, null).source),
  '["' + S2 + '","' + S1 + '"]|undefined')

console.log(fails === 0 ? '\n✓ ' + String(0) + ' échec — noyau épingles conforme' : '\n✗ ' + String(fails) + ' échec(s)')
process.exit(fails === 0 ? 0 : 1)
