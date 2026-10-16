# `@local/kybernos-models`

**Model catalog** panel at the foot of the native *Settings → Models* page: it reads the
models actually configured in `settings.yaml`, prefills them from models.dev, and lets the
user override their characteristics — really writing the fields the harness accepts, and
**always saying which ones**.

The usage guide and the proofs are in
[`docs/handoff/model-catalog/README.md`](../docs/handoff/model-catalog/README.md).

## « Kybernos Models » header block

The plugin also paints, **before the `deepseek-official` row** of the native page, a
« Kybernos Models » block: the brand, the pitch (« curated list of LLMs, automatic fallbacks,
auto-routing — one subscription ») and the chips of the `kybernos/*` models actually
imported — or the invitation to connect Kybernos Cloud when there are none. It only reads
the state already loaded (`KBM`), writes nothing and invents nothing.

The installed harness did not declare this seat: it is added by
`scripts/patch-dsh-models-header.mjs` (`--check` / `--revert`), **to be replayed after every
DSH update** — the native page then exposes `settings.models.header`, a list-type seat
rendered just before the rows.

## The first view (WP-11)

The page opens short, and everything else is one click away:

- **Kybernos Cloud** is one card. Connected, it reads « Connected » and « N models included »
  with « Manage Kybernos Cloud »; the « Add your API key » button (and its « or ») and the
  « Recommended » pill are gone, since a connected paid account has nothing to paste. They stay
  while Kybernos Cloud is not connected, and on a Free account (the plan is read from
  `GET /kybernos-cloud/status`: `space_plan.key`, else `user.plan`).
- **The providers that work come first.** A provider with no key (or switched off) answers
  nothing: once at least one provider works, those fold under one line that counts them
  (« Providers with no key or switched off (N) »). With none working nothing folds; the fold
  opens by itself for a provider just added. A catalog provider added with its key left blank
  shows the red « key missing » dot (the key reference is the catalogue's when the profile names
  none) and a line that says what to do next.
- **The models that do not answer fold away.** The Study model's health (published by
  `kybernos-sessions` on `window.__kybernosHealth`) says which models fail and why; the Models
  tab hides them under « Show unavailable (N) », and each one says why on its row: not in your
  Kybernos plan (a Kybernos Cloud model), may no longer be free or out of quota (the Free LLMs
  route, a `:free` id, a provider with a free quota), key refused (the rest), gone from the
  provider, and so on. The chip on the tab bar opens the same reasons; its button says « Check
  key » and opens the provider's Edit panel.
- **A score on each model.** The Models tab shows Artificial Analysis' intelligence index as
  « II 52.3 » in the model cell (its source in the tooltip), with a Score filter and a Score sort,
  once a score is known. One call (`POST /kybernos-models/scores/list`) reads the whole list.
  BenchLM's overall score is another scale: it stays in the model's own sheet.
- **A context size reads back as it was typed.** K is 1 000 and M is 1 000 000 both ways: typing
  `256K` stores 256000 and shows « 256K »; 262144 shows « 262.1K ». The exact count is in the
  tooltip.
- **The keyboard stays in the Add / Edit provider panel** (Tab and Shift+Tab wrap, the focus
  goes back to what opened it), and a refused count is said under its field inside the model
  sheet.

Checked on a real GUI by `scripts/check-models-live.mjs`.

## Two levels

| Level | Fields | Written to |
| --- | --- | --- |
| applied to the harness | `name`, `contextWindow`, `maxTokens`, `input`, `reasoningEfforts` (+ `compat`, outside the panel) | the profile's **settings document**, namespace `llm-pi-ai`: `~/.dsh/settings.yaml` up to 0.1.6, `~/.dsh/profiles/<profile>/cordis.patch.yml` in 0.1.7 (measured on 23/09/2026: `~/.dsh/settings.yaml` is absent, the panel's writes land in the patch) |
| Kybernos annotation | 26 keys (`search`, `s2s`, pricing, type, family, knowledge, release, weights, TTS/image/video, max input…) | `$DSH_HOME/kybernos-models/catalog.json` |

## Host contract (routes)

All answer in JSON. A route that writes or acts (every `POST` below, and `modelsdev?force=1`, a forced download) needs the page's own pair:
the right `Origin` (else `Referer`) of this DSH **and** DSH's signed browser-session cookie (`session-guard.mjs`, the terminal's rule; `docs/dev/route-origin-rule.md`).
No header or a foreign origin is refused (`403`); the right origin without a valid cookie is refused (`401`). Plugin routes are served before DSH's own login,
so this is the only door: a local program that sends the right `Origin` is not the signed-in browser. Every caller is a page of this DSH (the Models page and the
first-run wizard), which carries both by itself. The reads (`GET`) stay open behind the Host fence; `providers/parked` also refuses a foreign `Origin`.

| Route | Answer |
| --- | --- |
| `GET /kybernos-models/status` | `{ok, version, bootedAt, mode, wired[], annotation[], store{}, modelsDev{}}` |
| `GET /kybernos-models/annotations` | `{ok, models:{ 'route/id': {…} }}` |
| `POST /kybernos-models/annotations/save` | `{ok, key, fields, count}` — `{key, fields}`; key `route/id` (≤ 300, non-empty segments); `fields:null` purges the key; a `null`/`''` value removes the field |
| `POST /kybernos-models/journal` | `{ok, line}` — one line per write attempt; `GET …?limit=N` re-reads the last N |
| `POST /kybernos-models/key/check` | `{ok, result}` — `{provider, key}`: a read-only GET on the provider's model list (address chosen here from a table of four: anthropic, openai, deepseek, google; redirect refused; global fetch, never `web.fetch`). `result`: `ok`, `invalid`, `denied`, `rate_limited`, `unreachable`, `unexpected`. Neither the key nor the answer comes back. Same origin required. Used by `kybernos-plugin`'s first-run wizard. |
| `GET /kybernos-models/modelsdev?route=&id=&force=1` | `{ok, at, stale, match:{…}\|null}`; `modelsdev-unavailable` when there is no index |
| `POST /kybernos-models/scores/list` | `{ok, at, stale, scores:{ 'route/id': 52.3 }}` — `{models:[{key, name?}]}` (800 at most): the headline score (Artificial Analysis' intelligence index) of every model the snapshot knows, by the same matching rules as the sheet; a model it does not know is simply absent |

The models.dev index is cached for 6 h in `$DSH_HOME/kybernos-models/modelsdev.json`, in the
form `{ at, data }` (the old form, index at the root, is still read). Offline, the cache is
still served and the answer carries `stale: true`.

## Write rules (namespace `llm-pi-ai`)

- **Declared route** (it carries a `models` list): the service **does not traverse arrays** and
  `path` only accepts strings. The plugin therefore rewrites the whole
  `providers.<route>.models` list, built from the **user layer** (`view.user`); never from the
  resolved layer, which would materialise the schema's defaults (`input: []`).
- **Catalogue route** (no list): `providers.<route>.modelOverrides.<id>.<field>`.
- **Removing** a value = `{op:'unset', path}` (or removing the field in the rewritten list) —
  never a rewrite of the lower layer's value.
- List inherited from a lower layer: explicit refusal, never a rewrite.
- `reasoningEfforts` is only written when the index gives the levels; otherwise an explicit
  refusal.
- Every write sends `KBM.revision` (the last revision read); `settings/conflict` triggers a
  reload rather than a second write.

## Files

| Path | Role |
| --- | --- |
| `$DSH_HOME/kybernos-models/catalog.json` | local annotations (`{version, models}`) |
| `$DSH_HOME/kybernos-models/modelsdev.json` | models.dev index, `{at, data}`, TTL 6 h |
| `$DSH_HOME/kybernos-models/journal.ndjson` | the last 200 write attempts |

`$DSH_HOME` is honoured; otherwise `~/.dsh`.

## The screen

The panel carries the mock-up as it was validated: two tabs (`Providers` by default,
`Model list`), the dense list with search, four DSH `Menu`s, eight capability chips, a counter
and `Sync N from models.dev`, the table of models and the editor in a **dialog** that the arrow
opens. The row's `data-kbm` hooks do not depend on the tab: the proofs remain valid.

### Redesign of 21/09/2026

The panel only lives in **two real widths**, measured: 556 px (the Settings box) and 720 px
(the *Full screen* button). The `@container` steps at 780/900 px were dead code; the grid holds
on **a single step at 620 px**.

| Before | After |
| --- | --- |
| 7 columns crushed into 556 px: cut names (`Claude Sonnet 4.5 (O`), cut ids (`deepseek/deepseek-v4-l`), SOURCE overflowing (`5 overrides · 0 applied`) | **5 columns** (MODEL · CAPABILITIES · CONTEXT · SOURCE · actions); under 620 px, CAPABILITIES disappears and the icons join the context line |
| provider, type and price in their own columns, mostly empty (`—`) | they make up the model's **context line**, under its name: `id · route · type · price` — no empty column left, nothing cut |
| the override drowned in SOURCE, as text (« 5 overrides · 0 applied ») | an **amber pill** next to the name (`5 overrides`, full tooltip) |
| 19 model chips on 4 rows | 10 chips + a `+N more` / `Show less` button |
| provider cards: name + count label | + initial pill, the route's capability icons, counter, folded model rows |
| mute filters (`Provider · undefined`) | grey label + **value**; the trigger turns *business* blue when the filter is active |

Two underlying fixes, invisible but blocking, came with it:

- `Menu` read `props.key` — React reserves `key`, it never passes it as a prop: every filter
  wrote to `UI.undefined` and displayed « · undefined ». The prop is called `field`.
- the theme's amber is called `--dsw-alias-state-warn-primary`, not
  `…state-warning-primary`: the non-existent token made `var()` invalid, so **no** amber
  affordance (overrides, edited values, armed `Restore defaults`) could be seen.

Review screenshots (both tabs, both widths):
`node scripts/shot-model-catalog-refonte.mjs` →
[`9-refonte-liste-556.png`](../docs/handoff/model-catalog/9-refonte-liste-556.png),
[`9-refonte-liste-720.png`](../docs/handoff/model-catalog/9-refonte-liste-720.png),
[`9-refonte-providers-556.png`](../docs/handoff/model-catalog/9-refonte-providers-556.png),
[`9-refonte-providers-720.png`](../docs/handoff/model-catalog/9-refonte-providers-720.png).

The styling is **DSH's own CSS**: the controls' rules extracted from
`@deepseek-ai/dsh-client-ui-primitives` sit in `client.js`, between the `DSH-CONTROLS:BEGIN` /
`:END` markers — a plugin client's factory only exposes the injected services, it cannot import
a file from the package. The extraction script (`scripts/build-model-catalog-css.mjs`) is no
longer in the repository, and the `dsh-css.js` it also wrote was imported by nothing, so it is
gone: refresh the region from the installed sources by hand. The panel's own CSS follows right
after (`CSS_PANEL`).

## Frozen mode

`?kybernos-models=sample` (or `&kybernos-models=sample`) mounts the original mock-up: 4 sample
rows, no read of `settings.yaml`, no write possible. This is the mode of the step-1 checks.

## Refresh (fix of 23/09/2026)

The panel used to re-read `settings.yaml` **only once**, when it was mounted: a provider or a
model added while the page is open stayed invisible until the page was reloaded (« I added
mimo, but I cannot find it in Models », seen twice).

It now subscribes to the **same four invalidations as the native Models page** —
`settings/document-updated`, `credentials/reference-updated`, `llm/adapters-updated` (through
`remote.$on`) and `connection/reset` (local event) — inside a `ctx.effect` (so undone on
unmount, burst guard included). A burst of events gives **one** re-read, 300 ms later; a read
already running is not doubled, it is replayed when it ends. The re-read **carries over the
state** of the rows with the same key (`route/id`): open sheet, models.dev sheet already
obtained, health notes, refusal to show — a revision conflict, however, is not resurrected.

Measured on 23/09/2026 on the open GUI: a `settings/document-updated` write made **outside**
the panel (the theme's text size, through `settings/mutate`) triggers the panel's re-read
(2nd then 3rd read of the annotations), **without** losing the Models tab, the provider filter
or the open sheet; the search « mimo » still returns the 8 models.

Known limit, measured the same day: an edit of `cordis.patch.yml` made **outside the GUI**
(agent, editor, another profile) emits **no** event — the installed harness does not watch
that file (`patchReload` is read by no package). The panel therefore stays silent in front of
an external edit, like the native Models page: DSH has to be restarted.

## Checks

```bash
node scripts/check-model-catalog-host.mjs                                   # 34 — host only
node scripts/check-model-catalog-refresh.mjs                                # 34 — refresh wiring
node scripts/check-model-catalog-ui.mjs     --url "http://127.0.0.1:3080/" # 45 — frozen screen
node scripts/check-model-catalog-browser.mjs --url "http://127.0.0.1:3080/" # 42 — real writes
node scripts/build-model-catalog-css.mjs --check                           # DSH CSS up to date
node scripts/shot-model-catalog-refonte.mjs                                # review screenshots
node scripts/check-models-live.mjs                                         # the page as a person meets it (sandbox only)
```

`check-model-catalog-refresh.mjs` only reads the bundle: it pins the four signals, the
subscription in the effect, the burst guard and the state carry-over — **it does not prove**
the live re-read (that needs a browser, see the measures of § Refresh).

**State of the screen suites on 23/09/2026** (DSH 0.1.7): they still aim at
`~/.dsh/settings.yaml`, which 0.1.7 no longer writes — `check-model-catalog-browser.mjs` exits
**64** without measuring anything, and `check-model-catalog-ui.mjs` carries **3 pre-existing
failures** (verified identical on the git baseline: 7 sections expected against 8 real since
EXTERNAL SCORES, and the « panel / native add » order).

Both screen suites accept `--no-shot` (no screenshots) and the « browser » suite accepts
`--read-only` (no write, one more check skipped). The frozen mode is asked for with
`?kybernos-models=sample` on the served URL, not with a script option.

`check-model-catalog-host.mjs` carries **2 known failures, older than this redesign** (the
disk cache must be written in the `{ at, data }` form it then re-reads): they concern
`index.js`, which this redesign did not touch.

## « Add provider » provider catalogue (02/10/2026)

The add-provider form (Providers tab) takes up the skeleton of DSH's native dialog — tabs
*Catalog provider / Custom API*, Provider, API key, *Advanced settings* — with the ~210
providers of [models.dev](https://github.com/anomalyco/models.dev)
(sections Free · Popular · All, search, ↑↓ + Enter, themed logos).

| Host route | Answer |
| --- | --- |
| `GET /kybernos-models/providers` | `provider-catalog.json`: `{version, source, providers:[{id, nom, env, url, doc, logo, modele?}]}` |
| `GET /kybernos-models/logo?id=<id>` | cleaned SVG (`logos/<id>.svg`), 404 otherwise; strict CSP, 24 h cache |

Both are read from disk, no network call. To regenerate (after a models.dev update):

```bash
git clone --depth 1 https://github.com/anomalyco/models.dev /tmp/mdv
node scripts/build-provider-catalog.mjs --md /tmp/mdv
```

- Many big providers (OpenAI, Groq, Mistral…) have no `api` field in models.dev: the script
  completes them with their OpenAI-compatible endpoint (`FALLBACK_URL`). Providers with a
  proprietary SDK and no OpenAI endpoint (Bedrock, Vertex, Azure…) are left out; those whose
  URL depends on the account (`${VAR}`) stay, with the URL to complete.
- Logos are painted as a **CSS mask** (`LogoMd`): only the silhouette matters, it takes the
  theme's colour. No usable logo → initial.
- The key pasted in the form goes to `remote.credentials.set(<variable>, <key>)` — the same
  vault as the native flow and the Kybernos Cloud card, never `settings.yaml`.
- Without an up-to-date host, the client falls back to the short built-in list (`PROV_CATALOG`).

## Seam for the first-run wizard

`window.__KB_MODELS__ = { saveKey(provider, key), providers }` (published by `apply`, withdrawn at `dispose`). `saveKey` does
the « Add provider » flow's write (`kbPvCreate`) or, when the route is already declared, only its key (`apiKeyEnv` reference
set if absent, then `credentials.set`). It answers `{ok:true, slug, existed}` or `{ok:false, reason}`; the reason
is a code (`unknown_provider`, `empty`, `unavailable`, `readonly`, `write_refused`, `key_not_stored`, `refused`), never a
provider's text.

`saveCredential(ref, key)` only sets the secret: for a route already declared that lacks its key (the « this chat cannot answer
yet » card of `kybernos-plugin` reads the reference in the engine's sentence). `ref` must be a `*_API_KEY` name;
`{ok:true}` or `{ok:false, reason}` (`bad_reference`, `empty`, `unavailable`, `key_not_stored`, `refused`). Test: `node packages/kybernos-models/test-key-check.mjs` (route); the seam itself is checked
on the sandbox by `scripts/check-onboarding-live.mjs`.
