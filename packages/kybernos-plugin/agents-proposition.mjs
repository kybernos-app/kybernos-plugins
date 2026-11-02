// ── "Initiative": the global rule of the Kybernos agents ────────────────────
// (02/10/2026) The shared "system prompt" of the DSH agents lives in
// `<DSH home>/AGENTS.md` (~/.dsh by default) — one file PER MACHINE, never in the
// package. So that every user of the plugin gets the "Agent Team/skill matching" reflex,
// the plugin's boot LAYS the section into that file, idempotently: marked, never
// removed. Same contract as `preset-legacy.mjs`: a boot seam, not an engine patch.
//
// Idempotence: an HTML marker opens and closes the section; if the title of the rule
// ALREADY exists outside the markers (the author's machine), nothing is touched —
// overwriting a user's own text would be a regression.
//
// Versions: the marker carries the version of the text. v2 (2026-10-16) named the Study
// model instead of the retired « Decision Brain ». v3 (2026-10-16, decision D1: English is the
// base of every text) is the same rule written in English. A machine that holds v1 or v2 gets v3
// at the next boot: the old section is REPLACED in place, but only when it is byte for byte the
// one this plugin laid (a person's own edit of it is never overwritten), and once — the next boot
// finds v3 and does nothing. The French text of v1 and v2 lives in agents-proposition-legacy.json,
// as data: it is only what an installed section is compared with.
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { dshHomeSync } from './dsh-home.mjs'

export const MARQUEUR_OUVERT = '<!-- kybernos:force-proposition v3 -->'
export const MARQUEUR_FERME = '<!-- /kybernos:force-proposition -->'

/** The sections laid by earlier versions, newest first: [{ version, marker, state, text }], and the title of the author's hand-written variant. */
const LEGACY = (() => {
  try { return JSON.parse(readFileSync(new URL('./agents-proposition-legacy.json', import.meta.url), 'utf8')) } catch (e) { return { title: '', sections: [] } }
})()

// The body, markers included, joined with \n (a file with other line endings is compared and written in its own).
const BLOC = [
  MARQUEUR_OUVERT,
  '## Initiative — systematic Agent Team/skill matching (laid by the Kybernos plugin)',
  '',
  'For every request (and every change of subject), BEFORE suggesting a',
  'resource, run the request through the two-stage check — never by gut feeling:',
  '',
  '1. **Lexical score first**: compare the 1-2 sentences of the request with the',
  '   missions of the installed Agent Teams (`~/.dsh/kybers/`) and with the',
  '   descriptions of the catalogue skills; keep the 2 best of each.',
  '2. **Referee** if the lexical score hesitates (close scores or no clear winner): a',
  '   closed question to the Study model (the study model of Kybernos Settings,',
  '   chosen automatically by default): "request X → Agent Team/skill among',
  '   A, B, none? answer with one word".',
  '',
  'Suggest ONLY the winners — named, with a one-sentence mission and a',
  'closed question ("shall I run it?"). A skill is suggested, it is only loaded',
  'after a yes. Nothing that does not exist is ever suggested.',
  '',
  MARQUEUR_FERME
].join('\n')

/** Writes `texte` over `chemin` without ever leaving half a file: a temporary file next to it, then a rename. A symlinked
 *  AGENTS.md (a dotfiles repo) stays a link — the new content goes to the real file — and the permissions are kept. */
function ecrireAtomique (chemin, texte) {
  let cible = chemin
  try { cible = realpathSync(chemin) } catch (e) { cible = chemin }
  const temporaire = cible + '.kybernos-' + process.pid + '.tmp'
  try {
    mkdirSync(dirname(cible), { recursive: true })
    writeFileSync(temporaire, texte, 'utf8')
    try { chmodSync(temporaire, statSync(cible).mode & 0o777) } catch (e) { /* the default mode is fine */ }
    renameSync(temporaire, cible)
  } catch (e) {
    try { unlinkSync(temporaire) } catch (e2) { /* nothing was written */ }
    throw e
  }
}

/** Lays the section into `<DSH home>/AGENTS.md` if absent, or replaces an untouched v1/v2 section by v3. Idempotent,
 *  reversible (the markers allow a clean removal). Returns a readable state: `pose`, `deja` (v3 is there), `migre` (an older
 *  section replaced), `v1-modifiee` / `v2-modifiee` (an older section the person edited, or damaged: left alone),
 *  `variante-locale`, `erreur`. */
export function poserForceProposition (chemin = join(dshHomeSync(), 'AGENTS.md')) {
  const brut = existsSync(chemin) ? readFileSync(chemin, 'utf8') : ''
  if (brut.includes(MARQUEUR_OUVERT)) return { etat: 'deja', chemin }
  for (const ancien of LEGACY.sections) {
    const debut = brut.indexOf(ancien.marker)
    if (debut < 0) continue
    const fin = brut.indexOf(MARQUEUR_FERME, debut)
    if (fin < 0) return { etat: ancien.state, chemin }
    const finBloc = fin + MARQUEUR_FERME.length
    if (brut.slice(debut, finBloc).replace(/\r\n/g, '\n') !== ancien.text) return { etat: ancien.state, chemin }
    const eol = brut.includes('\r\n') ? '\r\n' : '\n'
    try {
      ecrireAtomique(chemin, brut.slice(0, debut) + BLOC.replace(/\n/g, eol) + brut.slice(finBloc))
      return { etat: 'migre', chemin }
    } catch (e) {
      return { etat: 'erreur', chemin, erreur: String(e && e.message ? e.message : e) }
    }
  }
  // The author's machine carries the rule written by hand: same title, same
  // spirit — do not double it.
  if (LEGACY.title !== '' && brut.includes(LEGACY.title)) return { etat: 'variante-locale', chemin }
  try {
    appendFileSync(chemin, '\n' + BLOC + '\n', 'utf8')
    return { etat: 'pose', chemin }
  } catch (e) {
    return { etat: 'erreur', chemin, erreur: String(e && e.message ? e.message : e) }
  }
}
