#!/usr/bin/env node
/** The « force de proposition » section of <DSH home>/AGENTS.md (WP-08, N-03).
 *
 *  v1 told the agents to put their closed question to the « Decision Brain » (setting `decisionBrain`, default
 *  typesafe-ai/jev), which no longer exists. v2 names the Study model. Machines that already hold the v1 section must get
 *  v2 without anyone touching their file: the boot REPLACES the v1 section (only when it is byte for byte the one this
 *  plugin laid, so a person's own edit is never overwritten), once, and is idempotent after. Everything runs in a temporary
 *  directory.
 *
 *  Usage: node packages/kybernos-plugin/test-agents-proposition.mjs   (exit 0 = all pass) */
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { poserForceProposition, MARQUEUR_OUVERT, MARQUEUR_FERME } from './agents-proposition.mjs'

let ok0 = 0
let ko = 0
const ok = (nom, cond, detail) => {
  if (cond === true) { ok0 += 1; console.log('  ✓ ' + nom) } else { ko += 1; console.log('  ✗ ' + nom + (detail !== undefined ? ' → ' + JSON.stringify(detail).slice(0, 300) : '')) }
}

// The v1 section, exactly as the plugin laid it on every machine until now (copied from the shipped module).
const V1 = [
  '<!-- kybernos:force-proposition v1 -->',
  '## Force de proposition — matching systématique Agent Team/skill (posée par le plugin Kybernos)',
  '',
  'À chaque demande (et à chaque changement de sujet), AVANT de proposer une',
  'ressource, passer la demande dans le double étage — jamais au flair :',
  '',
  '1. **Score lexical en front** : confronter les 1-2 phrases de la demande aux',
  '   missions des Agent Teams installées (`~/.dsh/kybers/`) et aux descriptions',
  '   des skills du catalogue ; garder les 2 meilleurs de chaque.',
  '2. **Arbitre** si le lexical hésite (scores proches ou aucun net) : une',
  '   question fermée au Decision Brain (réglage `decisionBrain`, défaut',
  '   typesafe-ai/jev) : « demande X → Agent Team/skill parmi A, B, aucun ?',
  '   réponds un seul mot ».',
  '',
  'Ne proposer QUE les gagnants — nommés, en une phrase de mission, avec une',
  'question fermée (« je le lance ? »). Une skill se propose, elle ne se charge',
  'qu\'après un oui. Rien de ce qui n\'existe pas ne se propose.',
  '',
  '<!-- /kybernos:force-proposition -->'
].join('\n')
const V1_POSE = '\n' + V1 + '\n' // what appendFileSync wrote

const racine = mkdtempSync(join(tmpdir(), 'kb-agents-prop-'))
let n = 0
const nouveau = () => { n += 1; const d = join(racine, 'c' + n); mkdirSync(d); return join(d, 'AGENTS.md') }
const lire = (f) => readFileSync(f, 'utf8')
const nbMarqueurs = (t, m) => t.split(m).length - 1

console.log('\n── a fresh machine gets v2 ──')
{
  const f = nouveau()
  const r = poserForceProposition(f)
  const t = lire(f)
  ok('the section is laid', r.etat === 'pose' && r.chemin === f, r)
  ok('it carries the v2 marker and its closing marker, once', MARQUEUR_OUVERT.endsWith('v2 -->') && nbMarqueurs(t, MARQUEUR_OUVERT) === 1 && nbMarqueurs(t, MARQUEUR_FERME) === 1, MARQUEUR_OUVERT)
  ok('it names the Study model', /Study model/.test(t), t)
  ok('it no longer mentions the Decision Brain, its setting or its default model', !/Decision Brain|decisionBrain|typesafe-ai|jev/i.test(t), t)
  ok('the double-stage rule is still there (lexical score first, then a closed question)', /Score lexical/.test(t) && /question fermée/.test(t))
  const encore = poserForceProposition(f)
  ok('a second boot changes nothing (idempotent)', encore.etat === 'deja' && lire(f) === t, encore)
}

console.log('\n── a machine that holds v1 is migrated, once ──')
{
  const f = nouveau()
  const avant = '# The person\'s own agent rules\n\nAlways answer in French.\n'
  const apres = '\n## Another section the person wrote\n\nKeep it short.\n'
  writeFileSync(f, avant + V1_POSE + apres)
  const r = poserForceProposition(f)
  const t = lire(f)
  ok('the boot reports a migration', r.etat === 'migre', r)
  ok('the v1 section is gone', !t.includes('force-proposition v1') && !/Decision Brain|decisionBrain|typesafe-ai/.test(t), t)
  ok('the v2 section is there exactly once', nbMarqueurs(t, MARQUEUR_OUVERT) === 1 && nbMarqueurs(t, MARQUEUR_FERME) === 1 && /Study model/.test(t))
  ok('it took the very place of the old one: what the person wrote before and after is byte for byte unchanged', t.startsWith(avant + '\n' + MARQUEUR_OUVERT) && t.endsWith(MARQUEUR_FERME + '\n' + apres), t)
  const encore = poserForceProposition(f)
  ok('the next boot does nothing', encore.etat === 'deja' && lire(f) === t, encore)
}
{
  const f = nouveau()
  writeFileSync(f, V1_POSE)
  const r = poserForceProposition(f)
  ok('a file that holds only v1 (the usual case) is migrated too', r.etat === 'migre' && nbMarqueurs(lire(f), MARQUEUR_OUVERT) === 1 && !lire(f).includes('v1'), r)
}
{
  const f = nouveau()
  const crlf = '# Rules\r\n' + V1_POSE.replace(/\n/g, '\r\n') + '\r\nAfter.\r\n'
  writeFileSync(f, crlf)
  const r = poserForceProposition(f)
  const t = lire(f)
  ok('a file saved with Windows line endings is migrated, and keeps them', r.etat === 'migre' && !/[^\r]\n/.test(t) && nbMarqueurs(t, MARQUEUR_OUVERT) === 1 && t.endsWith('After.\r\n'), JSON.stringify(t.slice(0, 120)))
}

console.log('\n── the person\'s own text is never overwritten ──')
{
  const f = nouveau()
  const edite = '\n' + V1.replace('réponds un seul mot', 'réponds en une phrase') + '\n'
  writeFileSync(f, edite)
  const r = poserForceProposition(f)
  ok('a v1 section the person edited is left alone, and the boot says so', r.etat === 'v1-modifiee' && lire(f) === edite, r)
}
{
  const f = nouveau()
  const abime = '\n<!-- kybernos:force-proposition v1 -->\n## Half a section\n'
  writeFileSync(f, abime)
  const r = poserForceProposition(f)
  ok('a v1 opening marker with no closing one (damaged) is left alone', r.etat === 'v1-modifiee' && lire(f) === abime, r)
}
{
  const f = nouveau()
  const variante = '# Rules\n\n## Force de proposition dès l\'ouverture d\'un chat\n\nMy own version of the rule.\n'
  writeFileSync(f, variante)
  const r = poserForceProposition(f)
  ok('the author\'s hand-written variant (same title, no marker) is still left alone', r.etat === 'variante-locale' && lire(f) === variante, r)
}

console.log('\n── how the file is written ──')
{
  const f = nouveau()
  writeFileSync(f, V1_POSE)
  chmodSync(f, 0o640)
  poserForceProposition(f)
  ok('the file keeps its permissions', (statSync(f).mode & 0o777) === 0o640, (statSync(f).mode & 0o777).toString(8))
  ok('no temporary file is left next to it', readdirSync(join(f, '..')).join() === 'AGENTS.md', readdirSync(join(f, '..')))
}
{
  const f = nouveau()
  const cible = join(racine, 'dotfiles-AGENTS.md')
  writeFileSync(cible, 'mine\n' + V1_POSE)
  symlinkSync(cible, f)
  const r = poserForceProposition(f)
  ok('a symlinked AGENTS.md stays a link, and its target is the file that gets migrated', r.etat === 'migre' && lstatSync(f).isSymbolicLink() && lire(cible).includes('v2') && !lire(cible).includes('v1') && lire(cible).startsWith('mine\n'), r)
}
{
  const f = nouveau()
  writeFileSync(f, V1_POSE)
  const dossier = join(f, '..')
  const estRoot = typeof process.getuid === 'function' && process.getuid() === 0
  if (estRoot) console.log('  (skipped: running as root, read-only folder tests are meaningless)')
  else {
    chmodSync(dossier, 0o555)
    let r
    try { r = poserForceProposition(f) } catch (e) { r = { etat: 'LEVEE', erreur: String(e) } }
    chmodSync(dossier, 0o755)
    ok('a folder that cannot be written is reported (erreur), never thrown, and the file is as it was', r.etat === 'erreur' && lire(f) === V1_POSE, r)
  }
}
{
  const f = join(racine, 'neuf', 'AGENTS.md')
  mkdirSync(join(racine, 'neuf'))
  ok('no AGENTS.md yet: it is created by the boot', poserForceProposition(f).etat === 'pose' && existsSync(f))
}

rmSync(racine, { recursive: true, force: true })
console.log('\nAGENTS PROPOSITION — ' + (ok0 + ko) + ' assertions, ' + ko + ' failure(s)')
process.exit(ko === 0 ? 0 : 1)
