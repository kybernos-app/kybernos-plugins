// Where the text of a « ? How it works » card comes from, for the live checks (scripts/check-help-live.mjs).
//
// The hub shows the help of the SIGNED catalogue downloaded at the last release when this DSH home holds one
// (<DSH home>/kybernos/catalogue-distant.json, kept by kybernos-hub); the help.json shipped in packages/ is only the fallback for a module
// the catalogue lacks. A check that compares a card with packages/<dir>/help.json therefore compares with the wrong text as soon as a
// help.json was edited after the last signed release: the card is one release behind and no code change can turn the line green
// (audit 2026-10-16, A3-33: the Ollama card showed the previous release's step). This says which source the cards come from, and which
// modules differ, so the check can say so instead of leaving a red line nobody can explain.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** JSON with the keys in a fixed order: two helps are the same when their content is. */
const canon = (v) => JSON.stringify(v, (k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x))

/**
 * @param {{ repo: string, home: string }} where  the checkout (packages/*) and the DSH home the page is served from
 * @returns {{ cached: boolean, version: string|null, differ: string[] }} `cached`: the cards show the downloaded catalogue;
 *   `version`: the suite it was signed for; `differ`: the modules whose help in it is not the help.json of this checkout.
 */
export const helpSource = ({ repo, home }) => {
  let doc = null
  try { doc = JSON.parse(readFileSync(join(home, 'kybernos', 'catalogue-distant.json'), 'utf8')) } catch (e) { doc = null }
  const modules = doc !== null && typeof doc === 'object' && doc.catalogue !== undefined && doc.catalogue !== null && Array.isArray(doc.catalogue.modules) ? doc.catalogue.modules : null
  if (modules === null) return { cached: false, version: null, differ: [] }
  const differ = []
  for (const m of modules) {
    if (m === null || typeof m !== 'object' || m.aide === undefined || typeof m.id !== 'string') continue
    let shipped = null
    try { shipped = JSON.parse(readFileSync(join(repo, 'packages', m.id, 'help.json'), 'utf8')) } catch (e) { continue }
    if (canon(m.aide) !== canon(shipped)) differ.push(m.id)
  }
  const version = doc.suite !== undefined && doc.suite !== null && typeof doc.suite.version === 'string' ? doc.suite.version : null
  return { cached: true, version, differ }
}

/** The line a check prints, once, before it compares any card. */
export const describeHelpSource = (source) => (source.cached === false
  ? 'the cards show the help.json shipped with this checkout (no signed catalogue downloaded in this DSH home)'
  : 'the cards show the signed catalogue downloaded for suite ' + (source.version === null ? '(unknown version)' : source.version) + ', not packages/*/help.json: '
    + (source.differ.length === 0 ? 'the two say the same' : 'they differ for ' + source.differ.join(', ') + ' (a card of those modules can only turn green after the next signed release)'))
