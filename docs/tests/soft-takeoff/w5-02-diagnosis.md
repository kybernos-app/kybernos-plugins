# W5-02 live battery: diagnosis of the 74 reds

The first run of `check-all-live.mjs` on the frozen sandbox A (129 checks) gave 55 pass and 74 red (40 fail, 19 timeout, 15 inconclusive). This is one line per red check, in alphabetical order; the ledger row W5-02 and the defects T-035 to T-038 point here.

| Class | Checks |
|---|---|
| bundle off in the freeze | 22 |
| stale assertion or setup | 21 |
| green alone | 3 |
| needs more time | 4 |
| needs a setup the runner did not give | 8 |
| product defect | 1 |
| not replayed | 15 |

How to read the classes: **bundle off in the freeze** is not a defect (`check-all-live.mjs --frozen` now reports these `skipped`); **stale assertion or setup** was fixed in the script and is green alone; **needs more time** passes or runs without error with a longer limit (the runner's 150 s was too short); **needs a setup the runner did not give** ends `inconclusive` by design; **not replayed** was not played again in this triage (see the end).

| Check | First run | Cause | Now |
|---|---|---|---|
| `apps` | inconclusive | Tables (`kybernos-db`) is off in the freeze; its routes answer 404 / `db_off` | skipped by `--frozen` |
| `automation-load` | timeout | restart the sandbox with `start.sh` while the keeper's DSH is not the one it stops (« sandbox did not restart ») | not replayed: run alone at the end |
| `automations-board` | fail | the first `.kba-lcard` is now the Ideas card (as T-029); a first message needs a workspace chosen | fixed, 78 checks green alone |
| `automations-list` | fail | the first `.kba-lcard` is now the Ideas card (as T-029) | fixed, green alone |
| `bundle-guards` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `business-dashboards` | inconclusive | Tables (`kybernos-db`) is off in the freeze; its routes answer 404 / `db_off` | skipped by `--frozen` |
| `call-team` | fail | a first message needs a workspace chosen (« Choose a workspace to start »); the check typed into the composer without one | fixed with `chooseWorkspace`, green alone |
| `call-ui` | fail | a first message needs a workspace chosen (« Choose a workspace to start »); the check typed into the composer without one | fixed with `chooseWorkspace`, green alone |
| `cloud-menu` | inconclusive | the replica session of A had ended (« not connected ») | replay needs A paired again, just before the run |
| `connectors-matrix` | timeout | a matrix of real third-party servers, each hot-loaded and tested, exit 0 when it ran; 150 s is too short; its « ko » rows (deepwiki-sse 405, httpbin swagger2, github spec_too_large, open-meteo 404) are the servers' or the importer's limits, not read here | not replayed |
| `creation-sources` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `dashboards` | timeout | four stale assumptions: a workspace must be chosen; the Dashboard tab now opens on the agent's own write only (2026-11-02); the menu row is folded into Creations; the sandbox ledger is no longer empty. It was not a hang: 209 s of failed waits | fixed, green alone in 30 s |
| `db-map` | fail | Tables (`kybernos-db`) is off in the freeze; its routes answer 404 / `db_off` | skipped by `--frozen` |
| `db-templates` | inconclusive | Tables (`kybernos-db`) is off in the freeze; its routes answer 404 / `db_off` | skipped by `--frozen` |
| `dead-clicks` | timeout | not a hang: presses everything on every page, 312 s alone | passes in 312 s (needs 450 s) |
| `display` | timeout | not a hang: a sweep of 3 schemes x 2 sizes, about 4 to 5 minutes per combination; it measures and exits 0 | reached the second combination in 450 s without error; run it alone with 1800 s |
| `flow-dark` | fail | not reproduced: green alone on a quiet machine (the first run was inflated by the bundle-faults run started at the same time, finding 40) | no change |
| `footer` | timeout | not a hang: 1317 lines of scenes. It needs a SIGNED-OUT sandbox: on a paired one it ends `inconclusive` in 6 s | replayed on a fresh unpaired sandbox: pass in 131 s (reads `--frozen`; set to 450 s if the runner is slow) |
| `freeze` | fail | `kybernos-slides` is on in the plan and missing from the sandbox profile (T-035); the freeze did not add bundles linked to an « on » one | fixed in `soft-takeoff-freeze.mjs` (adds linked bundles), green |
| `front-desk` | inconclusive | Front desk (`kybernos-front-desk`) is off in the freeze | skipped by `--frozen` |
| `gate-panel` | fail | the check pressed the panel's Refuse (same label) instead of the dialog's | fixed, green alone (J3 and J5 stay inconclusive by design) |
| `help` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `help-dock` | fail | a first message needs a workspace chosen | fixed, green alone |
| `help-intro` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `join` | fail | restart the sandbox with `start.sh` while the keeper's DSH is not the one it stops (« sandbox did not restart ») | not replayed: run alone at the end |
| `journal-story` | fail | a first message needs a workspace chosen | fixed, green alone |
| `kaby-customisation` | fail | Kaby customisation is off in the freeze | skipped by `--frozen` |
| `kybernos-maquettes` | timeout | Mockups (`kybernos-maquettes`) is off in the freeze | skipped by `--frozen` |
| `kybernos-office` | fail | Office (`kybernos-office`) is off in the freeze | skipped by `--frozen` |
| `kyby` | fail | Kaby (`kybernos-kyber`) is off in the freeze; its menu row, phone and channels page and Kyby panel are absent by design | skipped by `--frozen` |
| `language` | timeout | rewrite the settings and restart the sandbox; timed out with the whole battery | not replayed: run alone at the end |
| `language-creation` | fail | rewrite the settings and restart the sandbox; timed out with the whole battery | not replayed: run alone at the end |
| `language-disk` | timeout | rewrite the settings and restart the sandbox; timed out with the whole battery | not replayed: run alone at the end |
| `language-job` | fail | rewrite the settings and restart the sandbox; timed out with the whole battery | not replayed: run alone at the end |
| `language-run` | timeout | rewrite the settings and restart the sandbox; timed out with the whole battery | not replayed: run alone at the end |
| `menu-business` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `miniapps-panels` | fail | Mini-apps (`kybernos-miniapps`) is off in the freeze | skipped by `--frozen` |
| `mobile-remote` | fail | ran against a DSH started with the replica override `KYBERNOS_CLOUD_API`: the replica answers 401 to the check's stand-in token and the app ends the session « revoked ». Environment, not product | replayed on a DSH started without the override: pass, 37 of 37 |
| `model-failures` | inconclusive | the profile has no `GLM` route on its model menu (needs `KB_E2E_DIR` and the E2E model routes) | inconclusive by design |
| `modeleur` | fail | Modeleur is off in the freeze | skipped by `--frozen` |
| `models` | fail | first view read as connected on a paired sandbox; the A3-11 rows used a model the engine's catalog does not describe (the engine rejects the context change and the page reverts silently, see T-038) | fixed, 20 of 20 green alone |
| `motion` | fail | Motion is off in the freeze | skipped by `--frozen` |
| `onboarding` | timeout | 237 s alone, not a hang; one stale assertion: the Creations tile list now includes the core « Mini-app » tile | assertion fixed; not replayed after the fix |
| `pages` | inconclusive | no creation in the sandbox to show as a row | inconclusive by design |
| `phone-apps` | timeout | same cause as `mobile-remote` (`KYBERNOS_CLOUD_API` override), then, once that is gone, 2 reds on the Kaby chat strip: Kaby (`kybernos-kyber`) is off in the freeze | fixed: reads `--frozen` and skips the Kaby block; replayed without the override: pass in 32 s |
| `phone-channels` | fail | Kaby (`kybernos-kyber`) is off in the freeze; its menu row, phone and channels page and Kyby panel are absent by design | skipped by `--frozen` |
| `phone-width` | timeout | not a hang (210 s). 24 of 29 green. 5 reds: Connectors provider radios (`[]`, none found), Workers row chevrons (`[]`), and on Commands the name, search field and tabs (`null`: the selectors find nothing). The page is built (the scrolling and pill checks around them pass); the selectors or the content they need are the suspect | replayed, red: not classified (stale selector vs. content not seeded needs a live probe, not done: disk) |
| `plugins` | inconclusive | Registry (`kybernos-registry`) is off in the freeze; `/kybernos-registry/state` does not answer | skipped by `--frozen` |
| `publish` | inconclusive | Tables (`kybernos-db`) is off in the freeze; its routes answer 404 / `db_off` | skipped by `--frozen` |
| `pulse` | fail | Pulse is off in the freeze | skipped by `--frozen` |
| `quiz` | fail | Mini-apps (`kybernos-miniapps`) is off in the freeze | skipped by `--frozen` |
| `registry` | timeout | Registry (`kybernos-registry`) is off in the freeze; `/kybernos-registry/state` does not answer | skipped by `--frozen` |
| `role-replace` | inconclusive | needs a team named Dev-Team (`--team`) | inconclusive by design |
| `roles` | inconclusive | needs a team named Dev-Team (`--team`) | inconclusive by design |
| `servers` | inconclusive | Servers is off in the freeze; `/kybernos-servers/status` does not answer | skipped by `--frozen` |
| `session-msg` | inconclusive | Session messages is off in the freeze; its route is not mounted | skipped by `--frozen` |
| `settings-frame` | fail | after the stale relative-height assertion was fixed, 2 reds remain: the Templates title sits at y 116 (x 274) and the Phone and channels title at y 117, against 107 on the other Settings pages | T-037 (P3), open |
| `settings-nav-i18n` | timeout | rewrite the settings and restart the sandbox; timed out with the whole battery | not replayed: run alone at the end |
| `settings-search` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `skills-learned-v2` | fail | appended its journal frame twice on a reused session (DSH then calls it torn and refuses new chats in that workspace); needed a workspace chosen | fixed, idempotent, 24 of 24 green alone |
| `slides` | fail | sandbox profile did not list `kybernos-slides` (T-035); a first message needs a workspace | profile brought to the plan, green alone |
| `suggested-pages` | fail | read the Dashboards menu row, now folded into Creations | fixed, green alone |
| `tables-big` | fail | Tables (`kybernos-db`) is off in the freeze; its routes answer 404 / `db_off` | skipped by `--frozen` |
| `team` | inconclusive | needs `--console-url` (the workspace console page) | inconclusive by design |
| `team-dsh` | fail | the replica session of A had ended (« not connected ») | replay needs A paired again, just before the run |
| `team-hidden` | fail | Kaby (`kybernos-kyber`) is off in the freeze; its menu row, phone and channels page and Kyby panel are absent by design | skipped by `--frozen` |
| `theme` | timeout | needs about 455 s and ends red: about 25 reds, the first being `__KB_THEME_HOST_STORE__` not kept across the reload, then « section stopped: element not found `.kbth-tok[1]` » for four sections. The sandbox is a clone of the owner's profile (his theme, wallpaper and accent), while the check assumes a clean one | replayed, red: not classified; needs a clean-slate profile, a limit of 900 s (`LIVE_MIN_SECONDS`) and a probe |
| `themes-gallery` | timeout | 398 s. The gallery and theme-page scenes pass (24). Everything after « Install template » is red: the plan answers `no-registry` because the plan needs the Registry (`kybernos-registry`), which is off in the freeze (`theme-installer.mjs`, action `plan`). The theme page then shows the raw text « ⚠ no-registry » | bundle off in the freeze: skipped by `--frozen`; the raw text is T-039 |
| `themes-install` | timeout | 252 s. The folder and preview scenes pass (15). After the Add button the plan never opens (same `no-registry` answer, Registry off in the freeze) | bundle off in the freeze: skipped by `--frozen` |
| `usage` | timeout | not reproduced: green alone on a quiet machine (the first run was inflated by the bundle-faults run started at the same time, finding 40) | no change |
| `websearch` | inconclusive | the free web engines are other people's servers (DuckDuckGo answers a 202 challenge, Brave is rate limited, Exa finds nothing) | exit 3 « not measured » |
| `workers` | fail | not reproduced: green alone on a quiet machine (the first run was inflated by the bundle-faults run started at the same time, finding 40) | no change |
| `workspaces-health` | fail | a first message needs a workspace chosen | fixed, green alone |
| `write-guard` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |

## Replay on a fresh sandbox (2026-11-04)

One new sandbox A (frozen, never paired, started without `KYBERNOS_CLOUD_API`) replayed 7 of the reds (and the 12 below were left). Result:

| Verdict | Checks |
|---|---|
| green | `footer` (131 s), `mobile-remote` (37 of 37), `phone-apps` (32 s, after the Kaby block learned `--frozen`) |
| off in the freeze (now `skipped`) | `themes-gallery`, `themes-install`: the template plan needs the Registry, which the freeze switches off |
| red, not classified | `phone-width` (5 reds), `theme` (about 25 reds) |
| not replayed | `automation-load`, `join`, `language`, `language-creation`, `language-disk`, `language-job`, `language-run`, `settings-nav-i18n`, `connectors-matrix`, `onboarding`, `cloud-menu`, `team-dsh` (12) |

Why the last two lines were not played at first: the free disk of the Mac fell from 5.0 GiB to under 1 GiB during the run while the sandbox stayed at 1.2 GB. The cause (ledger, finding 47) was 116 orphan Chrome profiles of killed checks, about 170 MB each, in the temp folder; they were deleted and `live-page.mjs` now sweeps its profiles when killed.

Two findings from the replay: the phone checks (`phone-apps`, `mobile-remote`) need a DSH started WITHOUT `KYBERNOS_CLOUD_API`, because the replica refuses their stand-in token and the app then ends the session « revoked » (this is the root cause of finding 43); and with the Registry off the template page shows the raw text « no-registry » (T-039).

## What changed in the runner and the checks

- `check-all-live.mjs --frozen` reports `skipped` for the checks whose subject is an off bundle (`LIVE_NEEDS`) and hands `--frozen` to the checks that read pages of off bundles (`FROZEN_AWARE`); both tables live in `scripts/lib-live-bundles.mjs` and `test-soft-takeoff-plan.mjs` keeps them in step with the scripts.
- `LIVE_MIN_SECONDS` gives `dead-clicks`, `display` and `onboarding` the time they need alone.
- `chooseWorkspace(page)` in `scripts/live-page.mjs` picks a workspace when the composer asks for one; `ensureConversation` and `selectModelOn` call it.
- `soft-takeoff-freeze.mjs` adds the bundles linked to an « on » one, so the sandbox profile matches the plan (T-035).

## What is left to play

12 checks were not replayed and 2 stay red without a class (`phone-width`, `theme`). Order for the next run, each segment under 40 minutes, with 4 GB of free disk checked before each:

1. On a sandbox that was never paired, started without `KYBERNOS_CLOUD_API`: `phone-width` (probe Connectors, Workers and Commands at 390 px first), `theme` (clean-slate profile, limit 900 s), `connectors-matrix` (limit 900 s), `onboarding` (fixed, not replayed).
2. On a sandbox paired on the replica (restart with the override, `e2e-connect.mjs --account a --force`, pin a model): `cloud-menu`, `team-dsh`.
3. Alone at the end, on a sandbox started with `start.sh` and no keeper: `join`, `automation-load`, the five `language-*` checks and `settings-nav-i18n`.
