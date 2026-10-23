#!/usr/bin/env node
// The file that defines an Agent Team is called « the team file » in the words a person reads (UX audit 2026-10-20). No browser.
//
//   node packages/kybernos-plugin/test-team-file-wording.mjs
//
// « kyber.yml » was in 28 texts (Budget, Skills, Insight, the model caveats, the help), a leftover of the old name « Kyber » in an
// interface that says Agent Team. The exact name stays where it is the thing itself: the code that reads the file, the path shown
// on the technical page, the Atlas definition column, the raw-text view.
import { readFileSync } from 'node:fs'

let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) console.log('  ✓ ' + name)
  else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const SRC = readFileSync(new URL('./client.js', import.meta.url), 'utf8').split('\n')
const mentions = SRC.map((l, i) => [i + 1, l.trim()]).filter(([, t]) => t.includes('kyber.yml') && !/^(\/\/|\*|\/\*)/.test(t))
const ALLOWED = [
  ["'kbat.col.def'", 'the Atlas definition column names the file it reads'],
  ["'kbat.c3.b'", 'the Atlas card says where the definition lives'],
  ["'kbui.kyber.declares'", 'the technical help table (definition versus runtime) names the file it describes'],
  ["raw text", 'the raw-text view is the file itself'], ["texte brut", 'the French twin of the raw-text view'],
  ["for (const cand of ['kyber.yml'", 'the code that looks for the file'],
  ["'kbat.hr2.a'", 'the path shown on the technical page'],
  ["const chemin =", 'the path built by the code'],
]
const stray = mentions.filter(([, t]) => !ALLOWED.some(([k]) => t.includes(k)))
check('no text a person reads names kyber.yml, but the technical ones', stray.length === 0, stray.map(([n, t]) => n + ' ' + t.slice(0, 90)))
check('the exact name is still where it is the thing itself', ALLOWED.filter(([k]) => mentions.some(([, t]) => t.includes(k))).length >= 6, mentions.length)
const text = SRC.join('\n')
check('the team file has its words in both languages', text.includes("'team file', 'fichier d’équipe'") && text.includes("'skills folder', 'dossier de compétences'"))
check('a skill row names where the skill is declared in words, not « skills/ » or « kyber.yml »', !/pushT\(s1, 'skills\/'|pushSkill\(s1, 'skills\/'|pushT\(s2, 'kyber\.yml'|pushSkill\(s2, 'kyber\.yml'/.test(text))
check('the budget sentences speak of a budget section, not of a « budget: » block', !/budget: block|bloc budget:|`budget:`/.test(text))
// V1-27 (video review): the share popover's footer button went disabled with no reason (« le lien d'invitation ne donne
// rien quand il n'y a pas de partage public »). A disabled button now says why, in both languages.
check('V1-27: a share button disabled for lack of a link says so',
  SRC.join('\n').includes("'kbsd.link.none'") &&
  /inactif === true && busy !== true && niveau === 'me' && meilleurDispo !== true/.test(SRC.join('\n')) &&
  /'data-kb': 'share-link-none'/.test(SRC.join('\n')))

// V1-19 (video review): « No tool claimed » above five connected tools read as a contradiction. The sentence now names the
// population it is about (the roles' `tools:` field) and says the connectors below stay usable.
check('V1-19: the empty claimed-tools line names its population and points at the connectors below',
  /Aucun outil réclamé dans le champ tools : des rôles\./.test(SRC.join('\n')) &&
  /Les connecteurs ci-dessous restent utilisables par l’équipe\./.test(SRC.join('\n')) &&
  /The connectors below are still usable by the team\./.test(SRC.join('\n')))

process.exit(fail === 0 ? 0 : 1)
