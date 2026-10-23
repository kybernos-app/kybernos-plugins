# `@local/kybernos-language`

Settings → **Language**: pick any ISO 639-1 language and have the interface of Kybernos **and of DSH itself** translated
by a model the user already configured, with progress, pause and resume. Right-to-left languages mirror the layout.
Translations are saved on the user's disk (`~/.dsh/kybernos/i18n/<lang>.json`), and the browser keeps a copy.

## What the user sees

- Two tabs: **Languages** and **Settings**. The toolbar holds the tabs and *Add a language*.
- A list of languages, one line each, with a flag when one country can stand for the language (built from a table of
  regions; Arabic has an emblem of its own, drawn; a system whose fonts draw no flag, or a language with no country,
  shows the two-letter code): French (the Kybernos source) and English are built in; the picker offers the other 182 of the
  184 ISO 639-1 codes (searchable, native and English names, 20 popular ones as chips).
- Per language, shown **on hover or keyboard focus** (always on a touch screen, and while a run, a stop, a menu or a
  question is what the row is about): *Start translation*, a progress bar with per-area bars (menus/chat/settings, then other DSH screens and
  plugins, then long messages), *Pause*, *Resume*, *Retry the missing texts*, *Use now* once the first area is done,
  *Use*, and a menu to translate again from scratch or remove it. Texts not translated yet show in English.
- A warning (test marks, texts changed since the translation, texts to double-check, a stop) is **a dot** next to the
  name; its words, and the button that answers it, are in the row's details, opened with the chevron. Buttons share one
  height and one shape: filled for the one action a row wants most, outline for the others.
- The **Settings** tab picks the translation model, switches the automatic resume, and states whether translations are on
  disk or in this browser only.
- *Use* switches Kybernos and DSH's own locale (DSH persists it) and reloads the page. `ar he fa ur ps sd ug yi dv`
  are right-to-left: `dir` and `lang` are set on `<html>` (and `lang` is defended against DSH's shell overwriting it).
- A run belongs to **the host**, not to the tab. The page hands the texts that are still missing over once
  (`POST /kybernos/i18n-job`); the host translates them in batches, retries a transient failure with backoff, writes
  every batch to the disk as it lands and keeps the state in a file, so closing the tab changes nothing and a DSH that is
  restarted picks the run up again (unless `i18nAutoResume: false` in `<DSH home>/kybernos/settings.json`). The page only
  watches it (a poll every 2 s while it knows of a run), brings what landed into this browser's copy, and, when the run is
  over, says how it ended once: a toast, and a note for the bell of the footer card, with a « Use » button. A ring with the
  percentage appears in the sidebar footer (`sidebar.footer.action`, order 19) from every page; clicking it opens Settings
  on this page. A host that does not know the job route yet (DSH not restarted since the update) is not a failure: the page
  runs the same engine in the tab, as it always did (with its heartbeat: if the tab is closed mid-run, the next Kybernos tab
  takes the run over once the heartbeat is 20 s old; Settings › Language → « Resume an interrupted translation automatically » turns
  that off). A language that holds progress but is not running shows a grey bar with its count, also after a reload.
- Texts wrapped in `⟦…⟧` are pseudo-translations written by a test run, never real ones: they are not counted as translated,
  « Use » and « Use anyway » are not offered while they are there, a dot says how many there are, and « Translate these
  texts again » removes them (browser and disk) and translates exactly those. Live checks that translate with the
  pseudo-translating stub set `window.__KB_I18N_PSEUDO_OK__ = true` (`openLivePage` does).
- A link under General → Language points to this page. While a translated language is active, hard-coded text on
  Settings pages, in menus and in the sidebar footer is translated as it appears (live layer).

## Host routes it uses (none of its own: `index.js` is an empty `apply()`)

The routes belong to `@local/kybernos` (`i18n-translate.mjs`, `i18n-store.mjs`):

| Route | Role |
| --- | --- |
| `POST /kybernos/i18n-translate` | one batch (≤ 40 strings, ≤ 256 KiB) to a model; `{ok, translations, provider, model}`; a translation that loses `{x}`, `{{x}}`, `%s` or `%d` is dropped |
| `GET\|POST /kybernos/i18n-job` | the run itself (`i18n-job.mjs`): `start` (the missing texts), `pause`, `resume`, `cancel`, `ack`; `GET ?lang=` or all: state, counts per area, model, cause, `acked` |
| `GET /kybernos/i18n-models` | the configured model catalog and a default |
| `GET\|POST /kybernos/i18n-store` | list, read, merge or remove a language on disk |

Model order on the host: the page's pick, then the `brain` setting, then the catalog default. The next candidate is only
tried after a missing or invalid credential, a missing adapter or a quota error.

## Files and settings

- Disk: `<DSH home>/kybernos/i18n/<lang>.json` (`{kb, dsh, live, meta, label}`), `.removed.json` tombstones, a damaged file
  set aside as `<lang>.json.bad-<time>`. Needs `kybernos-plugin`'s route, so DSH must be restarted once after an update.
- Browser `localStorage`: `kybernos.i18n.<id>`, `.meta.<id>`, `.dsh.<id>`, `.live.<id>`, `kybernos.i18n.langs`, `.labels`,
  `.provider` (model pick), `.help`, `.runstate` (`{lang, model, beat}` while a run goes on), `.autoresume` (`off` when switched
  off); the active language is `kybernos.theme.lang`. The two new keys are named so they never look like a language id. Page-level switch
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
node packages/kybernos-language/test-client.mjs      # 253 checks: ISO list, plan, engine, pause/resume, test marks, closed-tab takeover, DSH pack, live layer, disk hand-off
node packages/kybernos-plugin/test-i18n-translate.mjs   # host route, fake LLM stream
node packages/kybernos-plugin/test-i18n-store.mjs       # on-disk store and its route
node packages/kybernos-plugin/test-lang-runtime.mjs     # the always-on runtime
```

`test-client.mjs` loads the core's real runtime and fakes the host and DSH's locale service. The page in a real browser is
covered by `scripts/check-language-live.mjs`, `scripts/check-language-disk-live.mjs` and `scripts/check-language-run-live.mjs`;
they need a signed-in DSH, the first two switch DSH's language and restore English, so read `docs/dev/live-testing.md` first.
`check-language-run-live.mjs` never presses « Use » and runs on a throw-away disk (`--worktree` tests this checkout's client,
`--user-copy` starts from a copy of the user's own `es.json`).

## Known limits

- Runs use batches of ≤ 40 strings or 2,600 characters, 3 in flight, 2 passes. A transient failure (rate limit, timeout, garbled
  answer) is tried up to 4 times with waits of about 2, 6 and 15 s; a failure waiting cannot fix (no key, no model, quota)
  stops the run at once with its cause; three batches in a row that keep failing stop it too. Whatever landed is kept and a
  resume asks only for what is missing. One run at a time on the host (a second language is told « another language is
  being translated »). Pausing aborts the calls in flight; a full browser storage no longer stops a host run (the disk has it).
- Every translated text goes through the checks of `kybernos-plugin/i18n-quality.mjs` before it is kept. Refused (the text is not
  kept, and the next attempt is told which key was refused and why): a variable that changed (`{x}`, `{{x}}`, `${x}`, `%s`,
  `%1$s`), HTML tags that are not the source's, a URL or a markdown link address that changed, inline code that changed,
  numbers that changed (digits in another numeral system count as the same number), a sentence of the model's own
  (« Here is the translation: … », a code fence), a text not written in the target language's script, a length out of
  proportion. Kept and listed under « N texts to double-check » (folded): a sentence that came back exactly as it went, a
  product name (`Kybernos`, `DSH`, `Claude`, `Ollama`, …) that vanished. What is NOT checked: that the sense is right, that two
  related texts use the same term, the register.
- Identical source texts are translated once and written under every key that has them.
- **Ready-made translations.** The project can publish a language already translated and reviewed, signed, so a machine does
  not have to translate it again (`kybernos-plugin/i18n-packs.mjs`, `GET|POST /kybernos/i18n-packs`). A language that has one
  shows « Install the ready-made translation » (and « ready » in the picker): it fills the disk copy at once, with no model and
  no key, keeping every text the person already has, and the host job then translates only what the pack lacks or what changed
  since. The pack is checked against a signed index (Ed25519, key `languages-pubkey.json`; empty until the maintainer generates
  one, and then the network is never asked); a pack whose hash is not the index's is refused before it is parsed. Maintainer side:
  `scripts/language-packs.mjs` (`export` from a language the job produced, `index`, `sign`, `verify`, `keygen`).
- For each text it writes, the host keeps a hash of the source text it translated (`src` in `<DSH home>/kybernos/i18n/<lang>.json`).
  After an update of Kybernos or DSH that changed some texts, a complete language shows « N texts changed since this
  translation » with an « Update translation » button: only those texts are translated again. A text translated before the
  host kept hashes is trusted as current. The page sends the host its whole plan with the translation it already holds
  (`full`); a host from before this protocol (no `v` in `GET /kybernos/i18n-job`) is sent the missing texts only.
- If DSH's dictionaries cannot be read, or DSH already ships the language (`zh`), only Kybernos is translated.
- Live layer: at most 800 new texts per page load, a 5 min cool-down after 3 failures.
