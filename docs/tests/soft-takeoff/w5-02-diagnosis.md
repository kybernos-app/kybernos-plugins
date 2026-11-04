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
| `automation-load` | timeout | restart the sandbox with `start.sh` while the keeper's DSH is not the one it stops (« sandbox did not restart ») | replayed on the paired sandbox: pass, 115 of 115 (355 s; limit 420 s). On an unpaired sandbox it had one red: the « do not start sub-agents » line was not in the request to the model |
| `automations-board` | fail | the first `.kba-lcard` is now the Ideas card (as T-029); a first message needs a workspace chosen | fixed, 78 checks green alone |
| `automations-list` | fail | the first `.kba-lcard` is now the Ideas card (as T-029) | fixed, green alone |
| `bundle-guards` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `business-dashboards` | inconclusive | Tables (`kybernos-db`) is off in the freeze; its routes answer 404 / `db_off` | skipped by `--frozen` |
| `call-team` | fail | a first message needs a workspace chosen (« Choose a workspace to start »); the check typed into the composer without one | fixed with `chooseWorkspace`, green alone |
| `call-ui` | fail | a first message needs a workspace chosen (« Choose a workspace to start »); the check typed into the composer without one | fixed with `chooseWorkspace`, green alone |
| `cloud-menu` | inconclusive | the replica session of A had ended (« not connected ») | replayed on A paired on the replica: pass, 6 of 6, 10 s |
| `connectors-matrix` | timeout | a matrix of real third-party servers, each hot-loaded and tested, exit 0 when it ran; 150 s is too short; its « ko » rows (deepwiki-sse 405, httpbin swagger2, github spec_too_large, open-meteo 404) are the servers' or the importer's limits, not read here | replayed: pass in 186 s |
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
| `join` | fail | restart the sandbox with `start.sh` while the keeper's DSH is not the one it stops (« sandbox did not restart ») | replayed: pass in 25 s |
| `journal-story` | fail | a first message needs a workspace chosen | fixed, green alone |
| `kaby-customisation` | fail | Kaby customisation is off in the freeze | skipped by `--frozen` |
| `kybernos-maquettes` | timeout | Mockups (`kybernos-maquettes`) is off in the freeze | skipped by `--frozen` |
| `kybernos-office` | fail | Office (`kybernos-office`) is off in the freeze | skipped by `--frozen` |
| `kyby` | fail | Kaby (`kybernos-kyber`) is off in the freeze; its menu row, phone and channels page and Kyby panel are absent by design | skipped by `--frozen` |
| `language` | timeout | rewrite the settings and restart the sandbox; timed out with the whole battery | replayed (paired, with a model): 104 of 108. One stale assertion fixed (the help button is a bare round « ? » since 2026-11-02). 3 reds left, all « DSH 0 texts »: DSH 0.2.2-alpha.2 ships Spanish natively, so for `es` the page leaves DSH's half out by design. Stale: move the family to a language DSH does not ship (as `settings-nav-i18n` did with `it`) |
| `language-creation` | fail | rewrite the settings and restart the sandbox; timed out with the whole battery | replayed on A paired with a model: pass in 103 s (on an unpaired sandbox it ends inconclusive: no chat can be mounted without a model) |
| `language-disk` | timeout | rewrite the settings and restart the sandbox; timed out with the whole battery | replayed: 25 of 27. The 2 reds are « DSH half: 0 texts, 1000 expected » and the screen-marks count that follows from it: the same stale `es` as `language`. The file on the disk is complete and the texts come back from it |
| `language-job` | fail | rewrite the settings and restart the sandbox; timed out with the whole battery | replayed: red, a setup gap. It needs a listed model that has NO key. The paired sandbox has a working route, so the translation really runs (job `running`, 0 of 4247); the unpaired one lists no model, so it is inconclusive. The note switch (quiet by default since d9ec57e5) is now turned on by the check; not verified |
| `language-run` | timeout | rewrite the settings and restart the sandbox; timed out with the whole battery | replayed: red, probably the same stale `es` (the reds count the DSH half and the « Ready » state of a pack that has marks); not confirmed |
| `menu-business` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `miniapps-panels` | fail | Mini-apps (`kybernos-miniapps`) is off in the freeze | skipped by `--frozen` |
| `mobile-remote` | fail | ran against a DSH started with the replica override `KYBERNOS_CLOUD_API`: the replica answers 401 to the check's stand-in token and the app ends the session « revoked ». Environment, not product | replayed on a DSH started without the override: pass, 37 of 37 |
| `model-failures` | inconclusive | the profile has no `GLM` route on its model menu (needs `KB_E2E_DIR` and the E2E model routes) | inconclusive by design |
| `modeleur` | fail | Modeleur is off in the freeze | skipped by `--frozen` |
| `models` | fail | first view read as connected on a paired sandbox; the A3-11 rows used a model the engine's catalog does not describe (the engine rejects the context change and the page reverts silently, see T-038) | fixed, 20 of 20 green alone |
| `motion` | fail | Motion is off in the freeze | skipped by `--frozen` |
| `onboarding` | timeout | 237 s alone, not a hang; one stale assertion: the Creations tile list now includes the core « Mini-app » tile | replayed after the fix: pass in 232 s |
| `pages` | inconclusive | no creation in the sandbox to show as a row | inconclusive by design |
| `phone-apps` | timeout | same cause as `mobile-remote` (`KYBERNOS_CLOUD_API` override), then, once that is gone, 2 reds on the Kaby chat strip: Kaby (`kybernos-kyber`) is off in the freeze | fixed: reads `--frozen` and skips the Kaby block; replayed without the override: pass in 32 s |
| `phone-channels` | fail | Kaby (`kybernos-kyber`) is off in the freeze; its menu row, phone and channels page and Kyby panel are absent by design | skipped by `--frozen` |
| `phone-width` | timeout | not a hang (213 s). 5 reds: Connectors radios, Workers chevrons, and on Commands the name, search and tabs, all « not found ». Cause: a headless page takes the focus at its FIRST pointer event, and the browser then scrolls the focused cell (« General ») back into view, so the Settings list jumped to the top between the measure and the tap and every cell below the fold opened « Usage » (the "page does not scroll sideways" passes next to it were measuring the wrong page). A real phone has the focus from the start: not a product defect | fixed in the check (it gives the page a first pointer event before measuring): pass, 33 of 33, 219 s |
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
| `settings-nav-i18n` | timeout | rewrite the settings and restart the sandbox; timed out with the whole battery | replayed: pass in 154 s |
| `settings-search` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |
| `skills-learned-v2` | fail | appended its journal frame twice on a reused session (DSH then calls it torn and refuses new chats in that workspace); needed a workspace chosen | fixed, idempotent, 24 of 24 green alone |
| `slides` | fail | sandbox profile did not list `kybernos-slides` (T-035); a first message needs a workspace | profile brought to the plan, green alone |
| `suggested-pages` | fail | read the Dashboards menu row, now folded into Creations | fixed, green alone |
| `tables-big` | fail | Tables (`kybernos-db`) is off in the freeze; its routes answer 404 / `db_off` | skipped by `--frozen` |
| `team` | inconclusive | needs `--console-url` (the workspace console page) | inconclusive by design |
| `team-dsh` | fail | the replica session of A had ended (« not connected ») | replayed on A paired and pinned to `kybernos/glm`: pass in 6 s (a first replay, right after `cloud-menu`, failed on a missing `kybernos-cloud.json`) |
| `team-hidden` | fail | Kaby (`kybernos-kyber`) is off in the freeze; its menu row, phone and channels page and Kyby panel are absent by design | skipped by `--frozen` |
| `theme` | timeout | replayed twice: 455 s, then 900 s (it reaches its last section at about 14 minutes). 46 to 49 reds of about 285 checks, in three families: a stale count (19 shipped theme dots against a hard-coded 18), cascades from a section that stopped on a missing element (the radius is still « Net » 3 px at the start of the next section; « Reset all » stops on `.kbth-skin[-1]`; Colors stops on `.kbth-tok[1]`), and the wallpaper section (16 reds, no wallpaper layer at boot). The sandbox theme state is clean (`theme-presets.json` only appears after the gallery install), so it is not the owner's profile | replayed, red: not classified; limit raised to 1500 s; needs a session of its own |
| `themes-gallery` | timeout | 398 s. The gallery and theme-page scenes pass (24). Everything after « Install template » is red: the plan answers `no-registry` because the plan needs the Registry (`kybernos-registry`), which is off in the freeze (`theme-installer.mjs`, action `plan`). The theme page then shows the raw text « ⚠ no-registry » | bundle off in the freeze: skipped by `--frozen`; the raw text is T-039 |
| `themes-install` | timeout | 252 s. The folder and preview scenes pass (15). After the Add button the plan never opens (same `no-registry` answer, Registry off in the freeze) | bundle off in the freeze: skipped by `--frozen` |
| `usage` | timeout | not reproduced: green alone on a quiet machine (the first run was inflated by the bundle-faults run started at the same time, finding 40) | no change |
| `websearch` | inconclusive | the free web engines are other people's servers (DuckDuckGo answers a 202 challenge, Brave is rate limited, Exa finds nothing) | exit 3 « not measured » |
| `workers` | fail | not reproduced: green alone on a quiet machine (the first run was inflated by the bundle-faults run started at the same time, finding 40) | no change |
| `workspaces-health` | fail | a first message needs a workspace chosen | fixed, green alone |
| `write-guard` | fail | read the pages and routes of bundles that are off in the freeze as defects (Apps row, Atlas help, Language pages, db routes) | fixed: reads `--frozen`, green alone |

## Replay on a fresh sandbox (2026-11-04)

One new sandbox A (frozen, started without `KYBERNOS_CLOUD_API`), then the same sandbox paired on the replica with its model pinned to `kybernos/glm`, replayed the 15 « not replayed » checks and 7 others. Where the 74 stand at the end:

| Where it stands | Checks |
|---|---|
| green (fixed, replayed or green alone) | 37, and `display` (no error in the 450 s it was given; it needs 1800 s) |
| skipped by `--frozen`, the bundle is off in the freeze | 24 (the 22 of the first pass, plus `themes-gallery` and `themes-install`: the template plan asks the Registry) |
| inconclusive by design | 6 (`model-failures`, `pages`, `role-replace`, `roles`, `team`, `websearch`) |
| open, stale and not fixed | 3 (`language`, `language-disk`, `language-run`: the language family translates `es`, which DSH ships natively since alpha.2) |
| open, a setup gap | 1 (`language-job`: needs a listed model with no key) |
| open, not classified | 1 (`theme`) |
| open, product | 1 (`settings-frame`, T-037) |

Replayed green this time: `footer`, `mobile-remote`, `phone-apps`, `phone-width`, `onboarding`, `connectors-matrix`, `join`, `automation-load`, `settings-nav-i18n`, `cloud-menu`, `team-dsh`, `language-creation`.

Four lessons from the replay (ledger, findings 43, 47, 48):

- The phone checks (`phone-apps`, `mobile-remote`) need a DSH started WITHOUT `KYBERNOS_CLOUD_API`: the replica refuses their stand-in token (401) and the app then ends the session « revoked ». This is the root cause of finding 43.
- A headless page takes the focus at its first pointer event and the browser then scrolls the focused cell back into view: a Settings list measured before that moved under the tap. `phone-width` now gives the page one pointer event first. Real phones are not affected.
- With the Registry off the template page shows the raw text « no-registry » (T-039).
- The Mac's free disk fell from 5.0 GiB to under 1 GiB during the run: 116 orphan Chrome profiles of killed checks, about 170 MB each. `live-page.mjs` now removes its profile when it is killed (finding 47).

## What changed in the runner and the checks

- `check-all-live.mjs --frozen` reports `skipped` for the checks whose subject is an off bundle (`LIVE_NEEDS`) and hands `--frozen` to the checks that read pages of off bundles (`FROZEN_AWARE`); both tables live in `scripts/lib-live-bundles.mjs` and `test-soft-takeoff-plan.mjs` keeps them in step with the scripts.
- `LIVE_MIN_SECONDS` gives `dead-clicks`, `display` and `onboarding` the time they need alone.
- `chooseWorkspace(page)` in `scripts/live-page.mjs` picks a workspace when the composer asks for one; `ensureConversation` and `selectModelOn` call it.
- `soft-takeoff-freeze.mjs` adds the bundles linked to an « on » one, so the sandbox profile matches the plan (T-035).

## What is left

- `language`, `language-disk`, `language-run`: move the family to a language DSH does not ship (`it`, as `settings-nav-i18n` did). About 115 lines name `es`, `Español`, `Spanish` or the flag; one constant per check, then a replay on a paired sandbox (about 12 minutes in all).
- `language-job`: needs a sandbox profile that lists a model and has no key. Neither the unpaired nor the paired sandbox gives it; a half-configured provider in the profile would.
- `theme`: 46 to 49 reds of about 285, replay needs 15 minutes. Start with the stale count (19 shipped dots, 18 hard-coded) and the sections that stop on a missing element, which leave their state to the next one.
- `display` alone with 1800 s, `dead-clicks` with 450 s, `settings-frame` (T-037).
