---
name: loading-text
description: Writes a personal pack of short waiting labels (for example "Reviewing guidelines") that fit the user's job or world, for Settings > Theme > Animation > Text > "Mon pack". Use when the user describes their profession or universe and wants the thinking text to match, or types /loading-text (or /skill-loading-text) followed by a description.
whenToUse: The user describes their job, field or world (for example "independent midwife") and wants the waiting text to speak their language.
---

# Loading text: a personal pack of waiting labels

While the assistant works, the app shows a short label with the elapsed time, so each
label must read naturally before "for 12s". You write 10 to 14 of them for the user's
world and save them where the Theme plugin reads them. No restart. The user can also
start this from the chat with `/skill-loading-text <description>`; the Theme settings
page offers a button that copies that command.

## Steps

1. Take the job or universe from the user's message (ask only if there is none).
2. Language: write the labels in the language of the user's interface; if you cannot
   tell, the language they are writing to you in. Say which one you used and offer another.
3. Write 10 to 14 labels following the rules below.
4. Merge, do not replace. If the pack already holds words, keep them and add the new
   ones. Replace them only if the user clearly asks to, and ask first when it is
   unclear. At most 40 words in total, no duplicates (case-insensitive).
5. Save with the command below: put your labels in `add`, and set `replace` to true only
   after the user agreed. It reads the current file, merges, and writes atomically.
6. Reply (see "Reply").

## Save command

```
node - <<'JS'
const fs = require('fs'), path = require('path'), os = require('os')
const dir = path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'kybernos')
const file = path.join(dir, 'loading-text.json')
const add = ['Reviewing guidelines', 'Preparing the file']
const replace = false
let old = []
try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); old = Array.isArray(j) ? j : j.words || [] } catch (e) { /* no file yet */ }
const seen = new Set(), out = []
for (const w of [...(replace ? [] : old), ...add]) {
  const t = String(w).replace(/\s+/g, ' ').trim()
  if (t && t.length <= 40 && !seen.has(t.toLowerCase())) { seen.add(t.toLowerCase()); out.push(t) }
}
if (out.length > 40) console.log('Over 40, dropped:', out.slice(40))
fs.mkdirSync(dir, { recursive: true })
fs.writeFileSync(file + '.tmp', JSON.stringify({ version: 1, words: out.slice(0, 40) }, null, 2))
fs.renameSync(file + '.tmp', file)
console.log(Math.min(out.length, 40) + ' words saved in ' + file)
JS
```

## Rules for each label

- 1 to 3 words, at most 24 characters, no emoji, no punctuation at the end (no dot, no
  "...", no "!"). The app adds the time.
- An action or a state, in the gerund or noun form, that reads after "... for 12s":
  "Reviewing guidelines", "Chart review", "Comparing references".
- Vary the verbs: reading, comparing, checking, organising, summarising, drafting,
  calculating, reviewing. No duplicates, no near-duplicates.
- Professional and respectful. Never mock the profession, never joke at the expense of
  the people the user serves. No brand names, no names of people, nothing taken from
  the user's private details.
- Truthful. The label describes what an AI assistant can really be doing with
  information. It must never claim a real-world act, and never a regulated or risky one:
  no diagnosing, prescribing, treating, operating, judging, filing, paying, calling or
  sending. Write "Reviewing guidelines", never "Diagnosing the patient"; "Checking the
  contract clauses", never "Drafting your legal defence"; "Comparing ledger entries",
  never "Filing your taxes".

## Example

"independent midwife", interface in English:
Reviewing guidelines, Preparing the file, Checking the care plan, Comparing references,
Organising the visit notes, Summarising the record, Reading recent studies, Drafting the
summary, Checking the schedule, Reviewing the checklist, Sorting the questions.

"sage-femme libérale", interface in French (the app then adds "depuis 12 s"):
Relecture des recommandations, Préparation du dossier, Vérification du suivi,
Comparaison des références, Tri des questions, Synthèse du dossier, Lecture des études
récentes, Rédaction du résumé.

## Reply

Short, in the user's language: the labels you saved (one line), the language you used,
how many words the pack holds now, and that it is picked up automatically, with no
restart, under Settings > Theme > Animation > Text > "Mon pack". The file is plain JSON
(`loading-text.json` in the `kybernos` folder of the DSH home): the user can edit it by
hand. Offer to adjust the tone, the language, or to remove a label.
