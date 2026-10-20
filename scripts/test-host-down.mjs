// A3-34 of the audit: a Settings page whose host half does not answer (DSH not restarted after an update, a failing route)
// used to say four different things (a bare « Failed to fetch », an endless « … », « Load failed: Failed to fetch »,
// « Error: Failed to fetch » under « No free model detected »). Every page now says the same sentence with a Retry.
// Each page keeps its own copy (a bundle never depends on another to draw its failure); this test pins the wording so
// the five copies cannot drift apart.
//
//   node scripts/test-host-down.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EN = 'This page’s helper is not answering. If DSH was just updated, restart DSH, then press Retry.'
const FR = 'L’assistant de cette page ne répond pas. Si DSH vient d’être mis à jour, redémarre DSH, puis appuie sur Réessayer.'

// [package, where the sentence lives (a key, or the kt() pair), the Retry control]
const PAGES = [
  ['kybernos-websearch', 'Web Search'],
  ['kybernos-auto', 'Auto routing'],
  ['kybernos-models', 'AI provider and models'],
  ['kybernos-free-llms', 'Free LLMs'],
  ['kybernos-modeles-locaux', 'Ollama local models'],
]

let n = 0
for (const [pkg, page] of PAGES) {
  const src = readFileSync(join(root, 'packages', pkg, 'client.js'), 'utf8')
  // the apostrophe is written as a character in most files and as ’ in kybernos-models
  const count = (text) => src.split(text).length - 1
  assert.ok(count(EN) + count(EN.replace(/’/g, '\\u2019')) >= 1, pkg + ' (' + page + ') says the shared English sentence')
  assert.ok(count(FR) + count(FR.replace(/’/g, '\\u2019')) >= 1, pkg + ' (' + page + ') says the shared French sentence')
  assert.ok(/Retry|Réessayer/.test(src), pkg + ' has a Retry')
  n += 1
  console.log('  ✓ ' + pkg + ' (' + page + ')')
}

// The two pages that used to print « Failed to fetch » verbatim no longer do: the message is mapped, not passed through.
const free = readFileSync(join(root, 'packages', 'kybernos-free-llms', 'client.js'), 'utf8')
assert.ok(!/error: String\(e && e\.message \? e\.message : e\)/.test(free), 'free-llms does not pass the browser message through')
const models = readFileSync(join(root, 'packages', 'kybernos-models', 'client.js'), 'utf8')
assert.ok(/failed to fetch\|load failed\|networkerror/.test(models), 'models maps the browser words')
assert.ok(!/data-kbmh': 'loaderror'/.test(models), 'models tells a load failure once, not twice')
n += 3

console.log('host-down wording: ' + n + ' checks')
