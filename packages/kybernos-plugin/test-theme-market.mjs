#!/usr/bin/env node
// The listing's unit (A7-theme-marketplace): the pure block of packages/kybernos-plugin/client.js run as-is — the client is one bundle
// with no relative imports, hence the extraction, the same idiom as scripts/test-onboarding.mjs:14-18 — and the UI block read as text.
// The logic is proven here, without a browser; the drawing is proven by the captures of the vision pass. No port, no clock, no network,
// no <DSH home>: the route's answer is a fixture, A6's installer is a fake.
//
// Usage: node packages/kybernos-plugin/test-theme-market.mjs   (exit 0 = everything passes)
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const src = readFileSync(here + 'client.js', 'utf8')
const pure = /\/\/ KB-MARKET-PURE-BEGIN([\s\S]*?)\/\/ KB-MARKET-PURE-END/.exec(src)
const ui = /\/\/ KB-MARKET-UI-BEGIN([\s\S]*?)\/\/ KB-MARKET-UI-END/.exec(src)
if (pure === null || ui === null) { console.error('BLOCKS KB-MARKET-PURE / KB-MARKET-UI NOT FOUND in packages/kybernos-plugin/client.js'); process.exit(1) }
const names = 'marketCards, marketSay, marketField, marketLevelLabel, marketLevelHelp, marketLeftOut, marketRefusals, marketNameOf, LEVELS, LEVEL_LABEL, LEVEL_HELP, kitLine, marketState, marketInstallable, marketInstall, marketReport, marketCount'
const mod = await import('data:text/javascript,' + encodeURIComponent(pure[1] + '\nexport { ' + names + ' }'))

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want })

/* ── The fixtures: A6's answer (its GET /kybernos/themes, A6 §GET), never a document read here ─────────────────────────────── */
const OFFICIAL = {
  id: 'kybernos/medecin', version: '1.0.0', level: 'official',
  manifest: {
    id: 'kybernos/medecin',
    name: { en: 'Medical practice', fr: 'Cabinet médical' },
    description: { en: 'A practice that keeps its own records', fr: 'Un cabinet qui tient ses dossiers' },
    author: { id: 'kybernos', name: 'Kybernos' },
    license: 'Apache-2.0',
  },
  archive: { url: 'https://example.invalid/medecin-1.0.0.tgz', sha256: 'a'.repeat(64), size: 2048 },
  source: 'off-1',
}
const COMMUNITY = {
  id: 'acme/vet', version: '2.1.0', level: 'community',
  // A manifest that writes its own trust: the card must still show the route's level (a level never survives a change, :423-424).
  manifest: {
    id: 'acme/vet',
    name: { en: 'Vet clinic', fr: 'Clinique vétérinaire' },
    description: { en: 'Care for pets', fr: 'Soins des animaux' },
    author: { id: 'acme', name: 'Acme' },
    license: 'MIT',
    level: 'official', trust: 'official', official: true,
  },
  archive: { url: 'https://example.invalid/vet-2.1.0.tgz', sha256: 'b'.repeat(64), size: 1024 },
  source: 'off-1',
}
const LOCAL = {
  id: 'local/clinic', version: '0.1.0', level: 'local',
  manifest: {
    id: 'local/clinic',
    name: { en: 'My clinic', fr: 'Mon cabinet' },
    description: { en: 'A folder of this computer', fr: 'Un dossier de cet ordinateur' },
    author: { id: 'local', name: 'Local' },
    license: 'LicenseRef-private',
  },
  archive: { url: 'file:///tmp/clinic', sha256: 'c'.repeat(64), size: 512 },
  source: 'local',
}
const VIEW = { ok: true, themes: [OFFICIAL, COMMUNITY, LOCAL], records: [], sources: ['https://example.invalid/catalogue.json'], refused: [{ id: 'acme/broken', code: 'signature' }] }
const viewOf = (themes, extra) => Object.assign({ ok: true, themes, records: [], sources: ['https://example.invalid/c.json'], refused: [] }, extra)
/** A fake of A6's seam (M7): it records every call, and answers what the test tells it to. */
const seam = (answer) => {
  const calls = []
  const install = (arg) => { calls.push(arg); return answer }
  return { calls, install }
}

/* ── 1. The card: the manifest's words, the route's level ───────────────────────────────────────────────────────────────────── */
{
  const cards = mod.marketCards(VIEW, 'en')
  const ok = Array.isArray(cards) && cards.length === 3 &&
    cards.map((c) => c.id).join() === 'kybernos/medecin,acme/vet,local/clinic' &&
    cards[0].id === 'kybernos/medecin' && cards[0].version === '1.0.0' && cards[0].name === 'Medical practice' &&
    cards[0].author === 'Kybernos' && cards[0].license === 'Apache-2.0' &&
    cards[0].source === 'off-1' && cards[0].sha256 === 'a'.repeat(64) && cards[0].size === 2048
  check('a card carries the theme id, its name, its version and the level the verifier produced', ok && cards[1].level === 'community', cards)
  check('the card shows the manifest\'s own words and licence, verbatim', cards[1].name === 'Vet clinic' && cards[1].description === 'Care for pets' && cards[1].author === 'Acme' && cards[1].license === 'MIT', cards[1])
  check('a manifest that writes its own trust, level or official changes nothing', cards.map((c) => c.level).join() === 'official,community,local', cards.map((c) => c.level))
  const dropped = mod.marketCards(viewOf([
    Object.assign({}, COMMUNITY, { level: 'yanked' }),
    Object.assign({}, COMMUNITY, { level: 'revoked' }),
    Object.assign({}, COMMUNITY, { level: 'unlisted' }),
    Object.assign({}, COMMUNITY, { id: '' }),
    Object.assign({}, COMMUNITY, { version: '' }),
    null,
  ]), 'en')
  check('a yanked, revoked or unlisted entry, or one without an id or a version, makes no card', dropped.length === 0, dropped)
  check('an answer that failed, or one with no `themes`, makes no card', mod.marketCards({ ok: false, themes: [OFFICIAL] }, 'en').length === 0 && mod.marketCards({ ok: true }, 'en').length === 0 && mod.marketCards(null, 'en').length === 0)
}

/* ── 2. The levels: the contract's four, displayed never computed ────────────────────────────────────────────────────────────── */
{
  eq('the four levels are the contract\'s, in its order', mod.LEVELS, ['official', 'verified', 'community', 'local'])
  eq('the labels are Official / Verified / Community / Local development in English', mod.LEVELS.map((l) => mod.marketLevelLabel(l, 'en')), ['Official', 'Verified', 'Community', 'Local development'])
  eq('the labels are French in French', mod.LEVELS.map((l) => mod.marketLevelLabel(l, 'fr')), ['Officiel', 'Vérifié', 'Communauté', 'Développement local'])
  check('every label and every help line holds both languages, and the help stays short', mod.LEVELS.every((l) => Array.isArray(mod.LEVEL_LABEL[l]) && mod.LEVEL_LABEL[l].every((t) => typeof t === 'string' && t !== '') && Array.isArray(mod.LEVEL_HELP[l]) && mod.LEVEL_HELP[l].every((t) => typeof t === 'string' && t !== '' && t.length < 90)))
  check('an unknown level is displayed as its raw string, labelled, never mapped to a nicer one', mod.marketLevelLabel('partner', 'en') === 'partner' && mod.marketLevelLabel('partner', 'fr') === 'partner' && mod.marketLevelHelp('partner', 'en').length > 0)
  check('Unlisted is not one of the marketplace levels', mod.LEVELS.indexOf('unlisted') < 0 && mod.LEVEL_LABEL.unlisted === undefined)
}

/* ── 3. The three honest states ──────────────────────────────────────────────────────────────────────────────────────────────── */
{
  const noSource = mod.marketState({ ok: true, themes: [], records: [], sources: [], refused: [] }, 'en')
  const empty = mod.marketState({ ok: true, themes: [], records: [], sources: ['https://example.invalid/c.json'], refused: [] }, 'en')
  const refused = mod.marketState({ ok: true, themes: [], records: [], sources: ['https://example.invalid/c.json'], refused: [{ id: 'acme/broken', code: 'signature' }, { id: 'acme/old', error: 'yanked' }] }, 'en')
  const distinct = noSource !== null && empty !== null && refused !== null &&
    noSource.state !== empty.state && empty.state !== refused.state && noSource.state !== refused.state &&
    noSource.text !== empty.text && empty.text !== refused.text && noSource.text !== refused.text
  check('no source, an empty catalogue and a source the verifier refuses say three different things', distinct && noSource.state === 'no-source' && empty.state === 'empty' && refused.state === 'refused', { noSource, empty, refused })
  check('a refused entry is named with the verifier\'s own code, never invented', refused.leftOut !== null && refused.leftOut.indexOf('2') >= 0 && JSON.stringify(mod.marketRefusals({ refused: [{ id: 'acme/broken', code: 'signature' }, { id: 'acme/old', error: 'yanked' }, { code: '' }] })) === JSON.stringify([{ id: 'acme/broken', code: 'signature' }, { id: 'acme/old', code: 'yanked' }]), refused)
  check('a state never shows a card and a card never shows a state', mod.marketState(VIEW, 'en') === null && mod.marketCards(viewOf([]), 'en').length === 0)
  check('the three sentences exist in both languages, and French is French', noSource.text !== mod.marketState({ ok: true, sources: [], refused: [] }, 'fr').text && mod.marketState({ ok: true, sources: [], refused: [] }, 'fr').text.indexOf('Aucune') === 0)
  check('a failed read is not one of the three states (the page owns its own line)', mod.marketState(null, 'en') === null && mod.marketState({ ok: false, sources: [] }, 'en') === null)
}

/* ── 4. Both languages from one answer ──────────────────────────────────────────────────────────────────────────────────────── */
{
  const fr = mod.marketCards(VIEW, 'fr')
  const en = mod.marketCards(VIEW, 'en')
  const sameShape = fr.length === en.length && fr.every((c, i) => c.id === en[i].id && c.version === en[i].version && c.level === en[i].level && c.sha256 === en[i].sha256)
  check('both languages come from one answer', sameShape && fr[0].name === 'Cabinet médical' && en[0].name === 'Medical practice' && fr[1].description === 'Soins des animaux' && en[1].description === 'Care for pets', { fr: fr[0], en: en[0] })
  check('a language that is neither French nor English reads English (the kt rule)', mod.marketCards(VIEW, 'es')[0].name === 'Medical practice' && mod.marketCards(VIEW, 'ar')[0].name === 'Medical practice' && mod.kitLine({ skills: 2 }, 'ar') === 'Adds 2 skills')
  check('a manifest text missing in French falls back to English, never to a hole', mod.marketCards(viewOf([Object.assign({}, COMMUNITY, { manifest: Object.assign({}, COMMUNITY.manifest, { name: { en: 'Vet clinic' } }) })]), 'fr')[0].name === 'Vet clinic')
}

/* ── 5. The kit sentence (A6's plan counts, INT5) ────────────────────────────────────────────────────────────────────────────── */
{
  eq('the kit sentence pluralises, in English', mod.kitLine({ skills: 4, teams: 1, automations: 2 }, 'en'), 'Adds 4 skills, 1 team and 2 automations')
  eq('the kit sentence pluralises, in French', mod.kitLine({ skills: 4, teams: 1, automations: 2 }, 'fr'), 'Ajoute 4 compétences, 1 équipe et 2 automatisations')
  eq('a single item reads in the singular', mod.kitLine({ skills: 1 }, 'en') + ' | ' + mod.kitLine({ skills: 1 }, 'fr'), 'Adds 1 skill | Ajoute 1 compétence')
  eq('a zero count is omitted, never written as « 0 skills »', mod.kitLine({ skills: 0, teams: 3, automations: 0 }, 'en'), 'Adds 3 teams')
  eq('an all-zero kit says so, in both languages', mod.kitLine({ skills: 0, teams: 0, automations: 0 }, 'en') + ' | ' + mod.kitLine({}, 'fr'), 'Adds no kit yet | N’ajoute encore rien au kit')
  eq('an empty kit is the same sentence as an absent one', mod.kitLine(null, 'en'), 'Adds no kit yet')
}

/* ── 6. The install gate and the one click (M3, M7) ──────────────────────────────────────────────────────────────────────────── */
{
  const card = mod.marketCards(VIEW, 'en')[1]
  eq('an entry with an id, a version and an archive hash is installable', mod.marketInstallable(card), { ok: true })
  eq('an entry without a hash is not', mod.marketInstallable(Object.assign({}, card, { archive: { url: 'x' } })), { ok: false, reason: 'incomplete' })
  eq('an entry the verifier refused is refused', mod.marketInstallable(Object.assign({}, card, { level: 'yanked' })), { ok: false, reason: 'refused' })

  const fake = seam({ ok: true })
  check('no click, no call: nothing hands an entry to the installer at mount', fake.calls.length === 0)
  const answer = mod.marketInstall(card, fake.install)
  const single = fake.calls.length === 1 && JSON.stringify(fake.calls[0]) === JSON.stringify({ source: 'catalogue', id: 'acme/vet', version: '2.1.0' }) && Object.keys(fake.calls[0]).length === 3
  check('one click hands the entry to the installer once, never at mount', single && JSON.stringify(answer) === JSON.stringify({ ok: true, id: 'acme/vet', version: '2.1.0' }), { calls: fake.calls, answer })

  const none = mod.marketInstall(card, null)
  check('without the installer the action is explained, not a dead button', JSON.stringify(none) === JSON.stringify({ ok: false, error: 'no-installer' }) && /kb-market-why/.test(ui[1]) && /disabled:/.test(ui[1]) && /No installer is loaded on this page\./.test(ui[1]), none)

  const refusedFake = seam({ ok: true })
  const yanked = mod.marketInstall(Object.assign({}, card, { level: 'yanked' }), refusedFake.install)
  const revoked = mod.marketInstall(Object.assign({}, card, { level: 'revoked' }), refusedFake.install)
  check('an entry the verifier refused or revoked never reaches the installer', refusedFake.calls.length === 0 && yanked.error === 'refused' && revoked.error === 'refused', { calls: refusedFake.calls, yanked, revoked })

  const throwing = mod.marketInstall(card, () => { throw new Error('boom') })
  check('a seam that throws is a reason, never an exception', JSON.stringify(throwing) === JSON.stringify({ ok: false, error: 'installer-failed' }), throwing)
}

/* ── 7. The report: A6's plan, drawn (INT4, INT5) ────────────────────────────────────────────────────────────────────────────── */
{
  const plan = {
    ok: true,
    style: { id: 'clinic-style', name: 'Clinic style', settings: { acc: '#1B7F76' }, file: 'themes/clinic.json' },
    kit: { skills: [{ name: 'vet-notes' }], teams: [], automations: [] },
  }
  const report = mod.marketReport({ ok: true, added: 5, skipped: 2, failed: 1 }, plan, 'en')
  const kinds = report.rows.map((r) => r.kind)
  const style = report.rows.filter((r) => r.kind === 'style')[0]
  check('the report draws A6\'s plan: the style\'s id and accent, the kit counts, the added count', kinds.join() === 'style,kit,added,skipped,failed' && style.id === 'clinic-style' && style.acc === '#1B7F76' && report.rows[1].text === 'Adds 1 skill' && report.rows[2].count === 5, report.rows)
  const listed = mod.marketReport({ ok: true, added: [{ name: 'Clinic style' }, { name: { fr: 'Cabinet', en: 'Practice' } }, { file: 'themes/x.json' }, 'Field'] }, null, 'en')
  check('an item without a name is dropped from the report, never invented', listed.rows.map((r) => r.text).join(' | ') === 'Clinic style | Practice | Field', listed.rows)
  const bare = mod.marketReport(null, null, 'en')
  check('a report with nothing to say says nothing', Array.isArray(bare.rows) && bare.rows.length === 0, bare)
  const french = mod.marketReport({ added: 1 }, null, 'fr')
  check('the report speaks French in French', french.rows[0].text === '1 élément ajouté', french.rows)
}

/* ── 8. The blocks themselves: pure, guarded, and where they must be ─────────────────────────────────────────────────────────── */
{
  check('the pure block holds no React, no fetch, no window, no document', !/React\.|fetch\(|window\.|document\.|addEventListener/.test(pure[1]))
  // D2 of the strategy owns the full forbidden list for this block; the two ways to hash are named here too, and no literal of a
  // verifier's name sits in this file either — the tree keeps ONE catalogue verifier, and a suite is not one.
  check('the pure block names no way to hash and imports nothing (it displays the route\'s level)', !/createHash|createPublicKey|require\(|^import /m.test(pure[1]))
  check('the UI block calls no manager, applies no style and writes no file of its own', !/installBundle|removeBundle|setBundleEnabled|__KB_THEME_APPLY__|localStorage|writeFile/.test(ui[1]))
  const marketCalls = (ui[1].match(/marketInstall\(/g) || []).length
  check('the UI block calls marketInstall from the click, and only there', marketCalls === 1 && /onClick: \(\) => installer\(card\)/.test(ui[1]) && !/React\.useEffect\(\(\) => \{[^}]*marketInstall/.test(ui[1]), marketCalls)
  const reads = (ui[1].match(/fetch\('\/kybernos\/themes'/g) || []).length
  check('the listing reads A6\'s route through one call, re-read after a click and never cached', reads === 1 && /cache: 'no-store'/.test(ui[1]) && (ui[1].match(/relire\(\)/g) || []).length >= 2)
  check('both blocks sit outside the first-run wizard\'s KB-OB block (A1-kit-wizard\'s perimeter)', src.indexOf('// KB-MARKET-PURE-BEGIN') < src.indexOf('// KB-OB-CORE-BEGIN') && src.indexOf('// KB-MARKET-UI-END') < src.indexOf('// KB-OB-CORE-BEGIN'))
}

/* ── 9. One component, registered as a Settings section, never a second page (INT1, M2) ──────────────────────────────────────── */
{
  const registrations = (src.match(/name: 'settings\.section', id: 'kybernos-themes-market'/g) || []).length
  const defs = (src.match(/const KbThemesMarket = /g) || []).length
  const pageBranch = /\bview: 'themes'|\bview === 'themes'|kbOpenPage/.test(ui[1])
  check('the listing is one component registered as a Settings section, never a second page', registrations === 1 && defs === 1 && pageBranch === false && /order: 30/.test(ui[1]) && /label: marketSay\(\['Thèmes', 'Themes'\]/.test(ui[1]) && /marketCards\(view, lang\)/.test(ui[1]) && /marketState\(view, lang\)/.test(ui[1]), { registrations, defs, pageBranch })
  check('the Settings menu knows the section: a nav key, an icon and the Interface group\'s word', /'kybernos-themes-market': 'themes'/.test(src) && /'themes': '<path/.test(src) && /id: 'look'[^}]*mots: \['theme', 'themes', 'langue', 'language'\]/.test(src))
  check('the registration is guarded, so a broken listing never stops the bundle from starting', /ctx\.effect\(\(\) => \{\s*try \{/.test(ui[1]) && /catch \(e\) \{ return undefined \}/.test(ui[1]))
  check('the listing uses the host\'s shell classes and its own prefix only', !/(^|[^a-z-])kb[0-9a-z]*-[a-z]+\{/.test(ui[1].replace(/\.kbtm-[^{]*\{/g, '')))
}

console.log('\n' + String(pass) + ' verifications, ' + String(fail) + ' failure(s)')
process.exit(fail === 0 ? 0 : 1)
