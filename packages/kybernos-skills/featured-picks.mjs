// Featured picks: the catalogue Kybernos proposes on the Featured tab.
//
// A plain JSON file shipped with the package (featured-picks.json): editorial text in English and French, the skill's source repository,
// and the install counts and security verdicts read from skills.sh on `asOf`. Nothing here touches the network; the host only reads that
// file and checks its shape, so that a damaged or hand-edited file can drop an entry but never take the tab down.
import { readFileSync } from 'node:fs'

export const PICK_CATEGORIES = ['Documents', 'Data', 'Design', 'Media', 'Research', 'Marketing', 'Automation', 'Build']
// What a pick needs beyond the skill itself: an account or a key of a third-party service, named so that the card can say it.
export const PICK_NEEDS = ['firecrawl', 'tavily', 'google']

const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/ // same rule as the registry and the install route
const SOURCE_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/
const AUDIT_STATUS = ['pass', 'warn', 'fail']
const SHA256_RE = /^[0-9a-f]{64}$/
const MAX_ITEMS = 100
const MAX_TEXT = 400

const isText = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max
const bilingual = (v) => (v !== null && typeof v === 'object' && isText(v.en, MAX_TEXT) && isText(v.fr, MAX_TEXT) ? { en: v.en, fr: v.fr } : null)

const auditsOf = (v) => {
  if (!Array.isArray(v)) return []
  const out = []
  for (const row of v) {
    if (out.length >= 8) break
    if (Array.isArray(row) && isText(row[0], 60) && AUDIT_STATUS.indexOf(row[1]) >= 0) out.push([row[0], row[1], typeof row[2] === 'string' ? row[2].slice(0, 12) : ''])
  }
  return out
}

// One entry, or null when it cannot be shown. The entry is rebuilt field by field: nothing the file carries beyond these fields travels on.
export const pickOf = (raw, categories = PICK_CATEGORIES) => {
  if (raw === null || typeof raw !== 'object') return null
  if (typeof raw.id !== 'string' || !SKILL_NAME_RE.test(raw.id) || raw.id.length > 64) return null
  if (typeof raw.source !== 'string' || !SOURCE_RE.test(raw.source)) return null
  if (categories.indexOf(raw.category) < 0) return null
  const title = bilingual(raw.title)
  const outcome = bilingual(raw.outcome)
  const prompt = bilingual(raw.prompt)
  if (title === null || outcome === null || prompt === null) return null
  return {
    id: raw.id,
    source: raw.source,
    category: raw.category,
    title,
    outcome,
    prompt,
    needs: PICK_NEEDS.indexOf(raw.needs) >= 0 ? raw.needs : null,
    // The SHA-256 of the cover picture (a WebP). A machine that does not have the file asks the relay for it and keeps it only if its bytes
    // hash to this: the picture that was shipped with the plugin, whatever relay answers.
    coverSha256: typeof raw.coverSha256 === 'string' && SHA256_RE.test(raw.coverSha256) ? raw.coverSha256 : null,
    installs: Number.isInteger(raw.installs) && raw.installs >= 0 ? raw.installs : 0,
    audits: auditsOf(raw.audits)
  }
}

export const validatePicks = (raw) => {
  const empty = { asOf: '', categories: PICK_CATEGORIES.slice(), items: [] }
  if (raw === null || typeof raw !== 'object' || !Array.isArray(raw.items)) return empty
  const seen = new Set()
  const items = []
  for (const r of raw.items) {
    if (items.length >= MAX_ITEMS) break
    const it = pickOf(r)
    if (it === null || seen.has(it.id)) continue
    seen.add(it.id)
    items.push(it)
  }
  return { asOf: typeof raw.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.asOf) ? raw.asOf : '', categories: PICK_CATEGORIES.slice(), items }
}

export const readPicks = (file) => {
  try { return validatePicks(JSON.parse(readFileSync(file, 'utf8'))) } catch (e) { return validatePicks(null) } // missing or corrupt: an empty tab, never an outage
}
