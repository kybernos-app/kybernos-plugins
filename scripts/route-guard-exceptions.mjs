// The write routes that an Origin alone lets through, written down with the reason (docs/dev/route-origin-rule.md, « What stays open »).
//
// DSH serves plugin routes before its own login and an Origin header is forgeable by any local program, so a write route is meant to need DSH's signed session cookie as well
// (session-guard.mjs). `node scripts/audit-routes.mjs --check` (and scripts/test-route-guards.mjs, which CI runs) FAILS on a write route that an Origin alone lets through and that
// is not in one of the two lists below, and on an entry that no longer matches such a route. Adding a route here is a decision, and it is reviewed as one: the reason says which caller
// cannot send the cookie, or why the route is public.
//
// An entry names the bundle, the path (`path`, or `paths` for several routes of one reason) and, when only some methods are concerned, the `methods`. No `methods` means every write method
// of that path that the audit finds weak.

/** Decided and permanent: a caller that cannot send the cookie, or a route that is public by design. */
export const EXCEPTIONS = [
  // ── a caller that is not a browser ─────────────────────────────────────────────────────────────────────────────
  { bundle: 'kybernos-auto', paths: ['/kybernos-auto/report', '/kybernos-auto/router'], methods: ['POST'],
    reason: 'cli/auto-router.mjs, which the agent runs, posts here: it sends no Origin and has no session. A foreign page is refused (docs/dev/route-origin-rule.md).' },
  { bundle: 'kybernos-free-llms', path: '/free-llms/v1/chat/completions', methods: ['POST'],
    reason: 'The gateway DSH\'s engine calls: no Origin, no cookie, no browser header. It refuses what a browser marks as another site (test-gateway-origin.mjs); the Settings page\'s own routes are under the rule.' },
  { bundle: 'kybernos-hub', path: '/kybernos-hub/beacon', methods: ['POST'],
    reason: 'The boot crash detector: it must keep working when the session cannot be judged, and a forged verdict only shows a « safe mode is recommended » banner (safe mode itself is only turned on by the person, with the lifecycle robot).' },
  { bundle: 'kybernos-cloud', paths: ['/kybernos-cloud/turn', '/kybernos-cloud/turn/answer', '/kybernos-cloud/turn/continue'], methods: ['POST'],
    reason: 'The cloud computer\'s own runner starts, answers and continues a turn here with no browser session; the handlers add the runner\'s own check (turnAuthorized).' },
  { bundle: 'kybernos-cloud', path: '/kybernos-cloud/computer/claimed', methods: ['POST'],
    reason: 'The claim step of the cloud computer image (services/computer-image/claimer.mjs) posts here over loopback with an Origin and no browser session; the request carries nothing and the identity is read from the volume.' },
  { bundle: 'kybernos-cloud', path: '/kybernos-cloud/server/apply', methods: ['POST'],
    reason: 'kybernos-servers\' host applies the active server over loopback with this listener\'s Origin and no cookie. It joins the rule the day that loopback call signs a cookie (docs/dev/route-origin-rule.md).' },
  // ── public by design ───────────────────────────────────────────────────────────────────────────────────────────
  { bundle: 'kybernos-plugin', paths: ['/kybernos/widget/api/message', '/kybernos/widget/api/account'], methods: ['POST'],
    reason: 'A website\'s widget: the visitor is on another site and has no DSH session; their own message is the whole exchange (the conversation\'s history-delete token is its fence).' },
  { bundle: 'kybernos-plugin', path: '/kybernos/hooks', methods: ['POST'],
    reason: 'The webhook receiver: each automation\'s own secret is its fence, and the caller is the outside service that fires it.' },
  // ── routes that answer every method alike and only read (the audit lists them apart as reads) ───────────────────
  { bundle: 'kybernos-auto', paths: ['/kybernos-auto/state', '/kybernos-auto/models'],
    reason: 'Reads that answer every method alike (the handler does not look at the method); nothing is written behind them. Documented in docs/dev/route-origin-rule.md.' },
  { bundle: 'kybernos-free-llms', paths: ['/free-llms/status', '/free-llms/health', '/free-llms/v1/models'],
    reason: 'The gateway\'s reads (the panel\'s state, the live probe, the model list); they answer every method alike and are called by the engine and the panel. They refuse what a browser marks as another site (test-gateway-origin.mjs).' },
  { bundle: 'kybernos-miniapps', path: '/kybernos-miniapps/list',
    reason: 'The list of installed native apps: a read that answers every method alike. Its install and uninstall siblings are under the rule.' },
  { bundle: 'kybernos-webapp-creator', paths: ['/kybernos-webapp-creator/state', '/kybernos-webapp-creator/logs'],
    reason: 'The app list with their status and the app log tail: reads that answer every method alike; nothing is written behind them. Their create, start and stop siblings are under the signed-session rule.' },
  { bundle: 'kybernos-modeles-locaux', paths: ['/modeles-locaux/installation', '/modeles-locaux/machine'],
    reason: 'The state of the install job and the machine\'s chip and memory: reads that answer every method alike. The routes that install or download are under the rule.' },
  { bundle: 'kybernos-models', paths: ['/kybernos-models/annotations', '/kybernos-models/logo', '/kybernos-models/modelsdev', '/kybernos-models/providers', '/kybernos-models/scores', '/kybernos-models/scores/status', '/kybernos-models/status'],
    reason: 'Reads that answer every method alike (the notes, a provider logo, the models.dev catalogue, the providers, the scores and the status). Their writes have routes of their own, under the rule; a forced models.dev download is under the rule inside the handler.' },
]

/** A debt, not a decision: the route should take the cookie and has not yet. This list must only shrink; `until` says what removes each entry. */
export const QUEUED = [
  { bundle: 'kybernos-plugin', paths: ['/kybernos/art-load', '/kybernos/art-previews'], methods: ['POST'],
    reason: 'Creations reads (a project\'s files). Their open defect is the reach of what they read (L3-07), not the cookie; the cookie is a separate decision.',
    until: 'fix/file-serving is merged and the owner decides whether these two also take the cookie.' },
  { bundle: 'kybernos-plugin', paths: ['/kybernos/widget/api/config', '/kybernos/widget/api/reply'], methods: ['POST'],
    reason: 'The widget\'s own page: its configuration and the owner\'s reply to a visitor. No recette finding names them; the visitor-facing routes next to them are public by design, these two are not.',
    until: 'Each is read, and put under the rule or written in EXCEPTIONS with its non-browser caller.' },
  { bundle: 'kybernos-kaby-customisation', paths: ['/kybernos-kaby-customisation/portrait', '/kybernos-kaby-customisation/portrait/remove', '/kybernos-kaby-customisation/profile', '/kybernos-kaby-customisation/voice-sample', '/kybernos-kaby-customisation/voice-sample/remove'], methods: ['POST'],
    reason: 'Kaby\'s portrait, voice sample and profile. The voice-clone consent (`consent: true`) is supplied by the caller and becomes the stored `consentAt` (L3-29, P3).',
    until: 'The Kaby settings page is checked and the five routes take the cookie (L3-29).' },
  { bundle: 'kybernos-usage', paths: ['/kybernos-usage/budget', '/kybernos-usage/observe'], methods: ['POST'],
    reason: 'The usage ledger: a budget and observed usage written by the page (L3-29, P3).',
    until: 'The two routes take the cookie (L3-29).' },
  { bundle: 'kybernos-multi-device', path: '/kybernos-multi-device/private-folder', methods: ['POST'],
    reason: 'Creates a folder under <Documents>/Kybernos/<name> for a project that has none (L3-29, P3); it takes a name, never a path, and is driven by a page.',
    until: 'The route takes the cookie (L3-29).' },
  { bundle: 'kybernos-dashboards', paths: ['/kybernos-dashboards/clone', '/kybernos-dashboards/discard', '/kybernos-dashboards/flags', '/kybernos-dashboards/open', '/kybernos-dashboards/preset', '/kybernos-dashboards/restore', '/kybernos-dashboards/save'], methods: ['POST'],
    reason: 'The dashboards page\'s writes (save, clone, restore, discard, flags, open, preset). No recette finding names them; they are page-driven, so they can take the cookie.',
    until: 'Each is read, and put under the rule or written in EXCEPTIONS with its non-browser caller.' },
  { bundle: 'kybernos-theme', paths: ['/kybernos-theme/boot', '/kybernos-theme/gallery', '/kybernos-theme/loader-store', '/kybernos-theme/preset-store'], methods: ['POST'],
    reason: 'The theme\'s stores (boot sheet, gallery, loader, presets). No recette finding names them; they are page-driven. `boot` is read by the page before it paints, so its caller needs a look first.',
    until: 'Each is read, and put under the rule or written in EXCEPTIONS with its non-browser caller.' },
  { bundle: 'kybernos-maintenance', path: '/kybernos-maintenance/settings', methods: ['POST'],
    reason: 'The About page\'s switch « Check for updates automatically » (`{ autoCheck }`, nothing else). No recette finding names it; page-driven.',
    until: 'The route takes the cookie.' },
  { bundle: 'kybernos-flow', path: '/kybernos/queue-move', methods: ['POST'],
    reason: 'Reorders the queue of waiting messages (the Flow panel). No recette finding names it; page-driven (scripts/smoke-gui.mjs and scripts/plugin-scan.mjs only name it).',
    until: 'The route takes the cookie.' },
]
