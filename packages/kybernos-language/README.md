# `@local/kybernos-language`

Settings → **Language**: pick any ISO 639-1 language and have the interface of Kybernos **and of DSH itself** translated
by a model the user already configured, with progress, pause and resume. Right-to-left languages mirror the layout.
Translations are saved on the user's disk (`~/.dsh/kybernos/i18n/<lang>.json`), and the browser keeps a copy.

## What the user sees

- A list of languages: French (the Kybernos source) and English are built in; the picker offers the other 182 of the
  184 ISO 639-1 codes (searchable, native and English names, 20 popular ones as chips).
- Per language: *Start translation*, a progress bar with per-area bars (menus/chat/settings, then other DSH screens and
  plugins, then long messages), *Pause*, *Resume*, *Retry the missing texts*, *Use now* once the first area is done,
  *Use*, and a menu to translate again from scratch or remove it. Texts not translated yet show in English.
- *Advanced* picks the translation model; a line states whether translations are on disk or in this browser only.
- *Use* switches Kybernos and DSH's own locale (DSH persists it) and reloads the page. `ar he fa ur ps sd ug yi dv`
  are right-to-left: `dir` and `lang` are set on `<html>` (and `lang` is defended against DSH's shell overwriting it).
- A link under General → Language points to this page. While a translated language is active, hard-coded text on
  Settings pages, in menus and in the sidebar footer is translated as it appears (live layer).

## Host routes it uses (none of its own: `index.js` is an empty `apply()`)

The routes belong to `@local/kybernos` (`i18n-translate.mjs`, `i18n-store.mjs`):

| Route | Role |
| --- | --- |
| `POST /kybernos/i18n-translate` | one batch (≤ 40 strings, ≤ 256 KiB) to a model; `{ok, translations, provider, model}`; a translation that loses `{x}`, `{{x}}`, `%s` or `%d` is dropped |
| `GET /kybernos/i18n-models` | the configured model catalog and a default |
| `GET\|POST /kybernos/i18n-store` | list, read, merge or remove a language on disk |

Model order on the host: the page's pick, then the `brain` setting, then the catalog default. The next candidate is only
tried after a missing or invalid credential, a missing adapter or a quota error.

## Files and settings

- Disk: `<DSH home>/kybernos/i18n/<lang>.json` (`{kb, dsh, live, meta, label}`), `.removed.json` tombstones, a damaged file
  set aside as `<lang>.json.bad-<time>`. Needs `kybernos-plugin`'s route, so DSH must be restarted once after an update.
- Browser `localStorage`: `kybernos.i18n.<id>`, `.meta.<id>`, `.dsh.<id>`, `.live.<id>`, `kybernos.i18n.langs`, `.labels`,
  `.provider` (model pick), `.help`; the active language is `kybernos.theme.lang`. Page-level switch
  `window.__KB_I18N_HOST_STORE__ = false` turns the disk copy off (live test scripts use it). No env var is read here.
- Switching the bundle off keeps already translated languages working: registration in DSH and the disk reconciliation live
  in the core plugin's always-on `window.__KB_LANG_RUNTIME__`. Only translating, pausing, removing and the live layer go.

## DSH seams and network

- Client `inject: ['slots', 'locale']`; slots `settings.section` (order 2) and `settings.general.item` (order 1). The locale
  service is read through `getLocale`, `setLocale` and `dicts`; **`dicts` is not public API** and is guarded by an
  `instanceof Map` check. Inputs published by the core: `window.__KB_T__`, `__KB_FR_EN__`; this bundle sets
  `window.__KB_I18N_ACTIVE__` and fires `kybernos-lang-change`.
- `remote.*`: none. The browser only does same-origin `fetch` to the routes above and never calls a provider (a test checks
  the source for provider hostnames). The host sends the strings to the **provider of the chosen model**: interface text, not
  chat content. The live layer also sends new Settings, menu and sidebar-footer text, skipping identifiers, paths, URLs,
  e-mails and code; user-written names shown on those pages can still be sent.

## Tests

```bash
node packages/kybernos-language/test-client.mjs      # 156 checks: ISO list, plan, engine, pause/resume, DSH pack, live layer, disk hand-off
node packages/kybernos-plugin/test-i18n-translate.mjs   # host route, fake LLM stream
node packages/kybernos-plugin/test-i18n-store.mjs       # on-disk store and its route
node packages/kybernos-plugin/test-lang-runtime.mjs     # the always-on runtime
```

`test-client.mjs` loads the core's real runtime and fakes the host and DSH's locale service. The page in a real browser is
covered by `scripts/check-language-live.mjs` and `scripts/check-language-disk-live.mjs`; they need a signed-in DSH, switch
DSH's language and restore English, so read `docs/dev/live-testing.md` first. They were not run for this README.

## Known limits

- Runs use batches of ≤ 40 strings or 2,600 characters, 3 in flight, 2 passes, and stop after 3 failed batches in a row.
  Pausing abandons the batches in flight; a full browser storage stops the run.
- Run batches are sent with `source: 'fr'`, English DSH strings included; only the live layer sends `source: 'auto'`.
- If DSH's dictionaries cannot be read, or DSH already ships the language (`zh`), only Kybernos is translated.
- Live layer: at most 800 new texts per page load, a 5 min cool-down after 3 failures.
