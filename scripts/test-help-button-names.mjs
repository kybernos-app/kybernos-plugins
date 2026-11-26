#!/usr/bin/env node
// The help cards name the buttons and switches of the page by the words the page draws (T1-14, 2026-10-24).
// Three sentences named « Re-import models », « Send chats » and « Create skills »; the buttons read « Re-import », « Send Kybernos chats » and the switch « Suggest skills from stable automations ».
// For each card sentence checked here: every name in quotes must be a string the page's client draws (in the language of the sentence), and the old names are gone.
//   node scripts/test-help-button-names.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { table } from '../packages/kybernos-plugin/lib-i18n-test.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const CASES = [
  { help: 'packages/kybernos-cloud/help.json', client: 'packages/kybernos-cloud/client.js',
    names: { en: ['Re-import', 'Send Kybernos chats'], fr: ['Réimporter', 'Envoyer les chats Kybernos'] }, gone: ['Re-import models', '“Send chats”', 'Réimporter les modèles', '« Envoyer les chats »'] },
  { help: 'packages/kybernos-plugin/help.json', client: 'packages/kybernos-plugin/client.js',
    // The Team step (2026-10-24): the segment next to « Yours » and the row action. Both are drawn by the page (the French « Équipe » and « Proposer à l’équipe… » too).
    names: { en: ['Suggest skills from stable automations', 'Team', 'Propose to team…'], fr: ['Suggérer des skills depuis les automatisations stables', 'Équipe', 'Proposer à l’équipe…'] }, gone: ['“Create skills”', '« Créer des skills »'] },
]
// The core client's texts live in i18n/fr.json and en.json: a name is drawn when it is a literal of client.js OR the text of a dictionary entry (in the language of the sentence).
const dict = { fr: new Set(), en: new Set() }
for (const e of Object.values(table())) { dict.fr.add(e.kybernos); dict.en.add(e.en) }
const drawn = (c, client, name, lang) => client.includes("'" + name + "'") || (c.client === 'packages/kybernos-plugin/client.js' && dict[lang].has(name))
let pass = 0
for (const c of CASES) {
  const help = read(c.help)
  const client = read(c.client)
  for (const lang of ['en', 'fr']) {
    for (const name of c.names[lang]) {
      const quoted = lang === 'en' ? '“' + name + '”' : '« ' + name + ' »'
      assert.ok(help.includes(quoted), c.help + ': the card names ' + quoted)
      assert.ok(drawn(c, client, name, lang), c.client + ': the page draws « ' + name + ' » (' + lang + ')')
    }
  }
  for (const old of c.gone) assert.ok(!help.includes(old), c.help + ': the old name ' + old + ' is gone')
  pass += 1
  console.log('  ✓ ' + c.help + ': the names in the card are the words the page draws')
}
// the Suite catalogue mirrors the cards
const catalog = read('packages/kybernos-hub/catalog.json')
for (const old of ['Re-import models', 'Réimporter les modèles', '“Create skills”', '« Créer des skills »']) assert.ok(!catalog.includes(old), 'the Suite catalogue no longer carries ' + old)
for (const w of ['Propose to team…', 'Proposer à l’équipe…']) assert.ok(catalog.includes(w), 'the Suite catalogue carries the Team step (' + w + ')')
console.log('  ✓ and the Suite catalogue carries the same words')
console.log('\n' + (pass + 1) + ' checks passed')
