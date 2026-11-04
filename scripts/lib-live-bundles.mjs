import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Which bundle a live check is about. `check-all-live.mjs --frozen` does not run a check whose bundle the soft-takeoff plan
// (docs/tests/soft-takeoff/plugins.json) switches off: it reports it `skipped`. Without this the expected 404 of a bundle that is off
// read as a defect (W5-02: 17 of the 74 reds). Only checks whose WHOLE subject is an off bundle are listed; a check that merely meets
// one on a page (a row of the menu, a Settings page) is read by hand. A package dir, as in plugins.json.
export const LIVE_NEEDS = {
  'check-apps-live.mjs': ['kybernos-db'],
  'check-business-dashboards-live.mjs': ['kybernos-db'],
  'check-db-map-live.mjs': ['kybernos-db'],
  'check-db-templates-live.mjs': ['kybernos-db'],
  'check-tables-big-live.mjs': ['kybernos-db'],
  'check-tables-front-live.mjs': ['kybernos-db'],
  'check-publish-live.mjs': ['kybernos-db'],
  'check-front-desk-live.mjs': ['kybernos-front-desk'],
  'check-kaby-customisation-live.mjs': ['kybernos-kaby-customisation'],
  'check-kyby-live.mjs': ['kybernos-kyber'],
  'check-phone-channels-live.mjs': ['kybernos-kyber'],
  'check-team-hidden-live.mjs': ['kybernos-kyber'],
  'check-kybernos-maquettes-live.mjs': ['kybernos-maquettes'],
  'check-kybernos-office-live.mjs': ['kybernos-office'],
  'check-kybernos-office-cards-live.mjs': ['kybernos-office'],
  'check-kybernos-deck-live.mjs': ['kybernos-office'],
  'check-miniapps-panels-live.mjs': ['kybernos-miniapps'],
  'check-quiz-live.mjs': ['kybernos-miniapps'],
  'check-modeleur-live.mjs': ['kybernos-modeleur'],
  'check-motion-live.mjs': ['kybernos-motion'],
  'check-plugins-live.mjs': ['kybernos-registry'],
  'check-registry-live.mjs': ['kybernos-registry'],
  'check-pulse-live.mjs': ['kybernos-pulse'],
  'check-servers-live.mjs': ['kybernos-servers'],
  'check-session-msg-live.mjs': ['kybernos-session-msg'],
}

/**
 * The checks that take longer than the runner's default limit even alone, in seconds (measured in the W5-02 triage; the default 150 s read them as hangs).
 * `check-all-live.mjs` gives each at least this long. The display sweep is 3 schemes x 2 sizes at about 4 to 5 minutes each.
 */
export const LIVE_MIN_SECONDS = {
  'check-dead-clicks-live.mjs': 450,
  'check-display-live.mjs': 1800,
  'check-onboarding-live.mjs': 450,
}

/** The checks that read `--frozen` themselves (a page of an off bundle is skipped, not read as a defect). The runner hands them the flag; a test keeps this list and the scripts in step. */
export const FROZEN_AWARE = new Set(['check-bundle-guards-live.mjs', 'check-creation-sources-live.mjs', 'check-footer-live.mjs', 'check-help-intro-live.mjs', 'check-help-live.mjs', 'check-language-creation-live.mjs', 'check-menu-business-live.mjs', 'check-settings-search-live.mjs', 'check-write-guard-live.mjs'])

/**
 * The package dirs the plan switches off, for a check that runs with `--frozen` (an empty set otherwise: the check reads what it finds).
 * A check that meets an off bundle on a page it owns (a route family, a Settings page) skips that part with it: absent by design, not a defect.
 */
export function frozenOff(argv = process.argv) {
  if (!argv.includes('--frozen')) return new Set()
  const plan = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'tests', 'soft-takeoff', 'plugins.json'), 'utf8'))
  return new Set(Object.entries(plan.bundles).filter(([, e]) => e.state === 'off').map(([dir]) => dir))
}

/** A write route is `/<package dir>/…` for these bundles: is its package off in the freeze? */
export const routeIsOff = (off, path) => off.has(String(path).split('/')[1])
