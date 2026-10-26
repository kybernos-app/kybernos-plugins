# `@local/kybernos-models`

**Model catalog** panel at the foot of the native *Settings → Models* page: it reads the
models actually configured in `settings.yaml`, prefills them from models.dev, and lets the
user override their characteristics — really writing the fields the harness accepts, and
**always saying which ones**.

The usage guide and the proofs lived in `docs/handoff/model-catalog/`, which is no longer in this repository.

## « Kybernos Models » header block

The plugin also paints, **before the `deepseek-official` row** of the native page, a
« Kybernos Models » block: the brand, the pitch (« curated list of LLMs, automatic fallbacks,
auto-routing — one subscription ») and the chips of the `kybernos/*` models actually
imported — or the invitation to connect Kybernos Cloud when there are none. It only reads
the state already loaded (`KBM`), writes nothing and invents nothing.

No engine from 0.2.1-alpha.2 on declares this seat (checked on alpha.2, alpha.4 and rc.2), so on those the block is not painted.
On an older harness it is added by `scripts/patch-dsh-models-header.mjs` (`--check` / `--revert`), **to be replayed after every
DSH update** — the native page then exposes `settings.models.header`, a list-type seat
rendered just before the rows.

## The first view (WP-11)

The page opens short, and everything else is one click away:

- **Kybernos Cloud** is one card, the first cell of the provider grid (before the first provider), with the anatomy of a
  provider card on a night blue that does not follow the theme: the logo tile, « Kybernos Cloud » with a green dot when
  connected, and one line under it (« N models included », or « Recommended » + « Start for free »). The action is on the
  right: nothing when connected (the account, its plan, its teams and the way out are in the account menu: a « Manage » button
  only opened a copy of them), « Connect » when not (the full name, « Connect to Kybernos Cloud », is the tooltip and the accessible name). The small « or add a key » link under it and the « Recommended »
  tag are gone once connected on a paid account, which has nothing to paste; they stay while Kybernos Cloud is not connected,
  and on a Free account (the plan is read from `GET /kybernos-cloud/status`: `space_plan.key`, else `user.plan`). The card IS
  the `kybernos` provider: its plain card is not drawn beside it (it stays in a search result), and the name opens the Models
  view on its models. It used to be a full-width banner above the tab bar, which pushed the tabs down on this tab only.
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
| `POST /kybernos-models/models/probe` | `{ok, api, baseURL}` or `{ok:false, error}` — `{route, model}`: which protocol a model outside the engine's catalog speaks, asked of the provider (address and key are the route's, never the caller's): one single-token POST per protocol (OpenAI chat, Anthropic messages, OpenAI responses) until one answers 2xx; 401/403/429 and a network failure stop the search. `error`: `refused`, `rate-limited`, `unreachable`, `unknown-protocol`, `bad-route`, `bad-model`, `no-endpoint`. Same origin + session required. |
| `POST /kybernos-models/models/live` | `{ok, source:'live', url, models:[{id, name, contextWindow?, maxTokens?, inputModalities?}]}` or `{ok:false, error, status?, detail?}` — `{route, baseURL?, api?, key?}`: « Fetch available models » for a catalog route. The host asks the provider's own endpoint (`GET {baseURL}/models`, Anthropic: `{root}/v1/models`) with the key the route's profile names, read through the `credentials` service (a typed `key` wins); the address is the profile's, else the shipped catalogue's. A page-typed `baseURL` is followed only beside a typed `key`. https (or http on this machine), redirect refused, 4 MB ceiling, global fetch, never `web.fetch`. `error`: `refused` (+`status`, `detail` = the provider's own `error.message`), `unreachable`, `bad-reply`, `too-big`, `no-endpoint`, `foreign-endpoint`, `unsupported-protocol`, `bad-endpoint`, `bad-route`, `bad-key`. The key never comes back. Same origin + session required. |
| `GET /kybernos-models/modelsdev?route=&id=&force=1` | `{ok, at, stale, match:{…}\|null}`; `modelsdev-unavailable` when there is no index |
| `POST /kybernos-models/scores/list` | `{ok, at, stale, scores:{ 'route/id': 52.3 }}` — `{models:[{key, name?}]}` (800 at most): the headline score (Artificial Analysis' intelligence index) of every model the snapshot knows, by the same matching rules as the sheet; a model it does not know is simply absent |

The models.dev index is cached for 6 h in `$DSH_HOME/kybernos-models/modelsdev.json`, in the
form `{ at, data }` (the old form, index at the root, is still read). Offline, the cache is
still served and the answer carries `stale: true`.

## Fetch available models: live, then the engine

The picker of the provider panel (`Fetch available models`) asks, in this order:

1. **The provider's own endpoint, through the host** (`POST /kybernos-models/models/live`), for a catalog route. This is the only
   answer that sees a model the provider added yesterday: the engine's `llm.discoverModels` answers from its embedded catalog, with
   no network call, whenever the route has one (measured on DSH 0.2.1-rc.2), and that catalog holds one protocol's models per
   provider (`opencode-go`: 18 of 29 in the catalog, 37 at the endpoint on 20/10/2026). The key stays in the host: the page never
   reads it. No engine patch.
2. **The engine** (`llm.discoverModels`) when there is no live answer (no key accepted, endpoint unreachable, a DSH whose host
   half has not been restarted). The picker then **says so** — « Live list unavailable (the provider refused the key (HTTP 401)).
   These are the models DSH ships for this provider, possibly out of date » — so a stale catalog never passes for the real list.
3. A **custom** provider (declared with its own address) is asked over the wire by the engine, as before; **Add provider** keeps the
   engine's answer too (a live list of hundreds is not adopted unasked).

Where the endpoint lists bare ids (`opencode-go`), the name and capacities the engine's catalog knows for the same id are filled
in; the live list alone decides which models exist.

**Custom models of a catalog provider.** The engine takes ONE `api` and ONE `baseURL` per route and none per model, and a model its
installed catalog does not describe has neither: it is refused (« model "x" needs an api », then « …needs a baseURL ») on a route whose
catalog serves several protocols (`opencode-go`: 4 protocols over 2 addresses). Setting them on the route would bind every other model
to them. So a model outside the catalog is added as a **custom model of the provider**, which the engine sees as a route of its own, a
**companion** (`<route>-custom-chat|resp|msgs`, one per protocol): declared with its own `api` and `baseURL`, the provider's key
reference (the key is not pasted again) and the name « <provider> (custom) ». Nothing else of the provider changes, and no other model
is bound to anything. The page draws the provider alone: the companion has no card, its models count with the provider's (« 30 models »),
the Models tab lists them under the provider with a « custom » tag, and the Edit panel lists them (« Custom models ») with a remove each.
Deleting the provider deletes its companions, switching it off or on moves them with it.

The picker tags the models outside the catalog (« Not in DSH's catalog ») and does not tick them on opening: each one costs a probe. On
Apply the save is tried as it is (a provider whose catalog serves one protocol accepts them on its own route and no companion is made);
when the engine refuses one, it and the models flagged as outside the catalog move to the companion and the rest is saved. The protocol
of each is asked of the provider (`POST /kybernos-models/models/probe`, host side, with the stored key: one request of a single token per
protocol, OpenAI chat, then Anthropic messages, then OpenAI responses, until one answers; the key and the answers never come back); when
it cannot be asked (no key, unreachable) the model is added on OpenAI chat at the provider's address and the page says it was a guess.
Measured on rc.2 against the sandbox's real engine: `opencode-go` + `minimax-m3.1-flash-free` → « Applied », 30 models, the companion
accepted with the same key reference. A typed Base URL is not sent to the live list unless a key is typed with it.

The provider's card counts the models declared in its profile; its Models view shows all of them, whatever their health (the
« not answering » fold applies to the unscoped list only), so « 3 models » is 3 on screen.

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

The review screenshots of this redesign (both tabs, both widths) and the script that took them are not in this repository (no media in git).

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

## Creation models (pictures, videos, voices)

The server's creation models are rows of the same list, typed image / video / audio, with the output capability lit and the price of one
unit (`$0.14 / image`, `$0.40 / s`, `$0.06 / 1,000 chars`) on the row. They are read from `GET /kybernos-cloud/models` (`models.creation`),
never from `settings.yaml`: DSH's chat picker lists every model of a route, and these are not chat models. A row is read-only (kind
`creation`): no trash button, a locked name, a note in its sheet, and any write is refused with « managed by your Kybernos account » before
anything is sent (`kbMPersist`). No key is asked for: the account is what pays. The page asks for them each time it reads the list, so a
server that has none (or a signed-out account) adds no row. The pure part is the `KB-CREATION-PURE` block, tested in `test-client.mjs`.

## Checks

```bash
node scripts/check-models-live.mjs            # the page as a person meets it (sandbox only)
node scripts/check-models-creation-live.mjs   # the creation models on that page, the server's answer faked in the page (sandbox only)
```

The older host, refresh and screen scripts (`check-model-catalog-host`, `-refresh`, `-ui`, `-browser`, `build-model-catalog-css`,
`shot-model-catalog-refonte`) are no longer in this repository. The host and the client are covered by the `test-*.mjs` files of this folder.
The frozen mode of the screen is asked for with `?kybernos-models=sample` on the served URL.

## « Add provider » provider catalogue (02/10/2026)

The add-provider form (Providers tab) takes up the skeleton of DSH's native dialog — tabs
*Catalog provider / Custom API*, Provider, API key, *Advanced settings* — with the ~210
providers of [models.dev](https://github.com/anomalyco/models.dev)
(sections Free · Popular · All, search, ↑↓ + Enter, themed logos).

| Host route | Answer |
| --- | --- |
| `GET /kybernos-models/providers` | `provider-catalog.json`: `{version, source, providers:[{id, nom, env, url, doc, logo, modele?}]}` |
| `GET /kybernos-models/logo?id=<id>` | cleaned SVG (`logos/<id>.svg`), 404 otherwise; strict CSP, 24 h cache |

Both are read from disk, no network call. The generator that built `provider-catalog.json` from a clone of models.dev
(`build-provider-catalog.mjs`) is not in this repository any more: until it is restored, the JSON file is the source.

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

`window.__KB_MODELS__ = { saveKey(provider, key), saveCredential(ref, key), providers, catalogue() }` (published by `apply`, withdrawn at `dispose`).
`providers` is the four the wizard shows first; `catalogue()` answers `{ ok, popular: [id…], providers: [{ id, nom, doc, logoId, libre, usable }] }`,
the catalogue of this page in its order (the wizard's « Other providers » list: `logoId` is the id of `/kybernos-models/logo`, `libre` a free-quota
provider, `usable` whether a key can be saved here, i.e. the catalogue knows its address and that address is not the account's own). `saveKey` does
the « Add provider » flow's write (`kbPvCreate`) or, when the route is already declared, only its key (`apiKeyEnv` reference
set if absent, then `credentials.set`), for any provider of the catalogue. It answers `{ok:true, slug, existed}` or `{ok:false, reason}`; the reason
is a code (`unknown_provider`, `empty`, `unavailable`, `readonly`, `write_refused`, `key_not_stored`, `refused`), never a
provider's text.

`saveCredential(ref, key)` only sets the secret: for a route already declared that lacks its key (the « this chat cannot answer
yet » card of `kybernos-plugin` reads the reference in the engine's sentence). `ref` must be a `*_API_KEY` name;
`{ok:true}` or `{ok:false, reason}` (`bad_reference`, `empty`, `unavailable`, `key_not_stored`, `refused`). Test: `node packages/kybernos-models/test-key-check.mjs` (route); the seam itself is checked
on the sandbox by `scripts/check-onboarding-live.mjs`.
