# Cartographie Lot 1 — Kaby proactif

Étape `cartographie` du kyber `dev-team` (lecteur : opencode-go/deepseek-v4.1-flash), 2026-10-28.
Worktree : `kybernos-plugins-proactive` @ `feature/kaby-proactive-lot1`. Passe lecture seule.

Constat global : **aucun code « proactif » / gate / initiative n'existe encore** sur cette branche
(grep « proactive|proactif|gate|initiative » ne hit que `messaging/` et un doc). Les write sets sont donc
des modules NEUFS, plus trois surfaces chaudes existantes : `kybernos-plugin/index.js`,
`kybernos-plugin/client.js`, et le bundle `kybernos-pulse`. Un seul lot peut toucher chacune de ces
surfaces (voir « arbitrages d'unicité »).

## Arbitrages d'unicité (relus par le Lead)

- `packages/kybernos-plugin/index.js` → lot `host-gate-and-queue-routes` uniquement.
- `packages/kybernos-plugin/client.js` → lot `automations-gate-ui` uniquement.
- `packages/kybernos-plugin/automation-tools.mjs` → lot `initiative-queue` uniquement.
- `packages/kybernos-pulse/*` → lot `pulse-proactive-notify` uniquement.
- `packages/kybernos-plugin/automation-gate.mjs` est CRÉÉ par `gate-static-checks`, puis lu par
  `gate-trial-proof`, `host-gate-and-queue-routes` et `automations-gate-ui`.
- `packages/kybernos-plugin/initiative-queue.mjs` est CRÉÉ par `initiative-queue`, puis lu par
  `host-gate-and-queue-routes` et `automations-gate-ui`.

## Lot 1 — `gate-static-checks`

**Contrôle de certification statique pur d'un brouillon d'automation** (cron, fuseau, apps/connecteurs,
permissions, effets de bord).

- Lecture : `packages/kybernos-plugin/index.js`, `automation-suggest.mjs`, `automation-settings.mjs`,
  `automation-published.mjs`, `automation-skills.mjs`, `automation-load.mjs`,
  `skills/automation-creator/SKILL.md`
- Écriture : `packages/kybernos-plugin/automation-gate.mjs` (NEUF : liste de contrôles, verdict,
  forme bornée des findings), `packages/kybernos-plugin/test-automation-gate.mjs` (NEUF)
- Ancres :
  - `index.js:449:     approvals: r.approvals === 'auto' ? 'auto' : 'ask',`
  - `index.js:742: const kbPickAskPreset = (presets) => {`
  - `index.js:765: const KB_MCP_WRITE_WORDS = new Set(['send', 'create', 'update', 'delete', 'remove', 'write', 'post', 'put', 'patch', 'add', 'append',`
  - `index.js:778: const kbIsReadName = (name) => {`
  - `index.js:806: const kbMcpGate = (toolName, args) => {`
  - `automation-suggest.mjs:7: export const SUGGESTED_MAX = 8`
  - `automation-settings.mjs:22: export const STABLE_CHOICES = [3, 5, 10, 20]`
  - `skills/automation-creator/SKILL.md:211:   approvals: spec.approvals === 'auto' ? 'auto' : 'ask',`

## Lot 2 — `gate-trial-proof`

**Essai supervisé et rapport de preuve** (outils appelés, résultat, durée, erreurs, effets externes),
plus l'enregistrement de gate.

- Lecture : `automation-runs.mjs`, `session-outcome.mjs`, `automation-load.mjs`, `automation-skills.mjs`,
  `index.js`, `packages/kybernos-pulse/pulse-core.mjs`
- Écriture : `packages/kybernos-plugin/automation-trial.mjs` (NEUF : machine à états de l'essai,
  rapport de preuve depuis les événements de journal, normalisation de l'enregistrement de gate),
  `packages/kybernos-plugin/test-automation-trial.mjs` (NEUF)
- Ancres :
  - `automation-runs.mjs:31: export const scrub = (v, max = RUN_TEXT_MAX) => {`
  - `automation-runs.mjs:83: export const summarizeRun = (events, options) => {`
  - `automation-runs.mjs:190:     outcome: verdict.open === true ? { state: 'open' } : (verdict.failed === true ? { state: 'failed', code: verdict.code, message: verdict.message } : { state: 'completed' }),`
  - `automation-runs.mjs:205:     approvals: approvals.map((a) => ({ toolName: a.toolName, outcome: a.outcome })),`
  - `session-outcome.mjs:22: export const lastTurnOutcome = (events) => {`
  - `index.js:3046:       // Approvals: only `ask` (the default, anything that is not an explicit `auto`) is enforced. The`
  - `index.js:3397:                 x.history = Array.isArray(x.history) === true ? x.history.concat([{ at: new Date().toISOString(), sessionId: str(res && res.sessionId) || null, status: res && res.queued === true ? 'queued' : 'fired' }]).slice(-20) : []`
  - `pulse-core.mjs:89: export const readRun = (events) => {`

## Lot 3 — `host-gate-and-queue-routes`

**Coutures hôte** : actions de gate sur `/kybernos/tasks`, routes d'essai et d'approbation, routes de la
file d'initiatives — le SEUL lot qui touche `index.js`.

- Lecture : `index.js`, `suggestions.mjs`, `automation-tools.mjs`, `automation-published.mjs`,
  `session-guard.mjs`, `automation-gate.mjs`, `initiative-queue.mjs`, `docs/dev/route-origin-rule.md`
- Écriture : `index.js` (points d'appel KB-TASKS-CORE, actions de `kbTasksHandle`
  `gate-check`/`trial-start`/`trial-report`/`approve` + `queue list`/`queue act`, bloc de routes),
  `packages/kybernos-plugin/test-automation-gate-routes.mjs` (NEUF)
- Ancres :
  - `index.js:3196:         if (kbNeverRuns(task, nx) === true) return { ok: false, error: kbNoNextRunError(task) }`
  - `index.js:3336:               if (autoIsSuggested(t) === true) { refusal = 'suggested: add it first'; break }`
  - `index.js:3597:     try { mountAutomationTools(ctx, { tasks: kbTasksHandle, ledger: { add: async (kind, raw) => (await kbSugg()).add(kind, raw) } }, (m) => { try { console.error('[kybernos] ' + m) } catch (e) { /* console */ } }) } catch (e) { /* never stop DSH from starting */ }`
  - `index.js:11388:       const kbTasksRefused = async (req, markerJudgedLater) => (kbTunnelledWrite(req) && markerJudgedLater !== true ? { status: 403, error: 'refused_on_phone' } : (await kbTasksAuthorized(req) === true ? null : { status: 401, error: 'sign-in required' }))`
  - `index.js:11391:       ctx.effect(() => webServerSvc.register({ kind: 'exact', path: '/kybernos/tasks', handler: async (req, res) => {`
  - `index.js:11522:       ctx.effect(() => webServerSvc.register({ kind: 'exact', path: '/kybernos/automation-skills', handler: async (req, res) => {`
  - `index.js:11599:       ctx.effect(() => webServerSvc.register({ kind: 'exact', path: '/kybernos/tasks/occurrences', handler: async (req, res) => {`
  - `index.js:11662:       ctx.effect(() => webServerSvc.register({ kind: 'exact', path: '/kybernos/tasks/runs', handler: async (req, res) => {`

## Lot 4 — `initiative-queue`

**File bornée d'initiatives** (preuve, risque, réversibilité, plafond, prochaine action) sur les patrons
de ledger de suggestions, avec ses deux outils d'agent.

- Lecture : `suggestions.mjs`, `automation-suggest.mjs`, `automation-tools.mjs`,
  `packages/kybernos-skills/learned.mjs`, `packages/kybernos-memory/index.js`, `lessons-store.mjs`,
  `docs/dev/design-suggested-tasks.md`
- Écriture : `packages/kybernos-plugin/initiative-queue.mjs` (NEUF : forme d'entrée, plafond, dédup,
  prochaine action « brouillon seulement »), `automation-tools.mjs` (outils
  `initiative record`/`initiative list` ajoutés à `toolDefinitions`),
  `packages/kybernos-plugin/test-initiative-queue.mjs` (NEUF)
- Ancres :
  - `suggestions.mjs:11: export const LIMITS = { instructions: { text: 1500, keep: 1 }, memory: { text: 500, keep: 8 } }`
  - `suggestions.mjs:16: export const hasPersonalData = (text) => …`
  - `suggestions.mjs:47:     add: (kind, raw) => serial(async () => {`
  - `learned.mjs:24: export const LEARNED_SEAM = Symbol.for('kybernos.learned-skills')`
  - `learned.mjs:26:   maxPending: 5,        // proposals waiting at once`
  - `learned.mjs:412: export const proposeFromLessons = ({ dsh, lessons, existing = [], now = Date.now() }) => {`
  - `lessons-store.mjs:26: export const LESSON_MAX_CHARS = 500`
  - `automation-tools.mjs:47: export const toolDefinitions = (deps) => {`

## Lot 5 — `automations-gate-ui`

**Page Automations** : panneau de gate sur le brouillon, affichage essai/preuve, activation en attente
de l'accord de la personne, cartes d'initiatives, chaînes i18n.

- Lecture : `client.js`, `index.js`, `automation-gate.mjs`, `initiative-queue.mjs`, `automation-runs.mjs`,
  `help.json`, `shared-ui.css`
- Écriture : `client.js` (blocs KB-BOARD et KB-AUTORUNS, composant de la page Automations et sa table
  i18n), `packages/kybernos-plugin/test-automation-gate-client.mjs` (NEUF)
- Ancres :
  - `client.js:477:       'tasks.sug.title': { kybernos: 'Automations suggérées', en: 'Suggested automations' },`
  - `client.js:6408: const kbTasksNeeds = (raw) => {`
  - `client.js:22886:       const sugRow = (t) => {`
  - `client.js:22898:       const sugEl = (section === 'yours' && sug.length > 0) ? h('div', …`
  - `client.js:23180:               h('h1', { className: 'kb6-title' }, kbDomainTitle('tasks', kbt('tasks.title'))),`
  - `client.js:23206:           h('div', { className: 'kba-sub', role: 'tablist', 'data-kb': 'automations-sections' },`
  - `client.js:21142:     // ── Cards: one card per automation, with what its runs say (the pure part is in the KB-AUTORUNS block)`
  - `client.js:20797:     // GET /kybernos/tasks/runs (the pure part is the KB-AUTORUNS block at the top of this file). Own fetch, not host.call`

## Lot 6 — `pulse-proactive-notify`

**Inbox et bannières** « terminé / échec / action requise », nourries par les événements de gate et de
file.

- Lecture : `pulse-core.mjs`, `pulse-host.mjs`, `index.js`, `client.js`, `panel-page.mjs`, `README.md`
  (tous `packages/kybernos-pulse/`), `packages/kybernos-plugin/automation-runs.mjs`
- Écriture : `pulse-core.mjs`, `pulse-host.mjs`, `index.js`, `client.js`, `test-core.mjs`
  (tous `packages/kybernos-pulse/`)
- Ancres :
  - `pulse-core.mjs:12: export const LEVELS = ['need', 'every', 'never']`
  - `pulse-core.mjs:119:   if (asked.size > 0) return { phase: 'waiting', calls, startedAt, tool: asked.values().next().value }`
  - `pulse-core.mjs:147: const KINDS = ['done', 'failed', 'waiting']`
  - `pulse-core.mjs:180: export const wantsBanner = (item, settings) => {`
  - `pulse-core.mjs:226: export const watchStep = async ({ tasks, state, readRunOf, now }) => {`
  - `pulse-host.mjs:167:   webServer.register({ kind: 'exact', path: '/kybernos-pulse/state', handler: (req, res) => {`
  - `index.js:18: export const PASS_MS = 15000`
  - `client.js:30:       // PANEL-CORE-BEGIN — everything between this line and PANEL-CORE-END is pure …`
