# The Kybernos plugin contract (free and paid): draft v0

Status: **specification, 2026-10-21. Phase 1 (the manifest on the 42 modules and its validator) and the foundation of phase 2 (the registry, the seam, the folder scan, the domain-pack point) are built, see section 14; the Plugins page is a mockup; everything else is still only written down.** The six decisions of section 16 and the registry bundle of
section 6.5 were **taken on 2026-10-21: the owner accepted every recommendation**. Section 2 lists where this draft disagrees with the first proposal.

The idea is WordPress's: a plugin is a folder with a header (who, which version, which platform versions, which licence, where updates come
from), the platform exposes **extension points** other plugins build on, a repository tells the person what they are installing, and premium
plugins carry their own commercial terms. WooCommerce is the second half of the idea: it is a plugin that other plugins extend. Here
`kybernos-dashboards` is to Kybernos what WooCommerce is to WordPress.

```
plugin.json ──▶ validator (the conformance tool) ──▶ signed archive ──▶ signed catalogue ──▶ the person's DSH
   │                                                                                           │
   └─ provides / extends versioned points ──▶ the registry fills from installed folders ◀──────┘
```

## 1. Where we start (checked 2026-10-21 on `dev`)

| Piece | Today |
|---|---|
| Per-plugin manifest | **None.** A bundle is `packages/<dir>/package.json` (`@local/<dir>`, `exports`, a `dsh` block), `cordis.patch.yml`, `help.json`. Family, one-line promise and glyph are three tables in `scripts/build-catalog.mjs` (`FICHE`, `TITRES`, `GLYPHES`); mount state is `docs/beta/satellites.json`; the install list is `scripts/lifecycle-packages.json`. A new plugin is registered in five places (`scripts/test-layout.mjs` enforces them). |
| Compatibility | **One DSH zone for the whole repo**: `dsh-compat.json` (`min`, `max`, `testees`), read by the lifecycle robot at install and upgrade. No per-plugin zone, no dependency between plugins. |
| Catalogue | The Suite catalogue `packages/kybernos-hub/catalog.json` (schema 1, 42 modules, **derived** from the repo: no licence, price, range, author or dependency). It travels in a signed release document (schema 2, Ed25519, a list of keys, a release older than the installed suite is refused). Install only switches on a module already in `lifecycle-packages.json`; the unit of update is the whole suite (`docs/dev/suite-updates.md`). |
| Other signed catalogues | Themes, local models, languages: the same idea, written three more times, with a monotonic `seq` instead of a version. Keys exist for the Suite and for local models; the themes and languages key lists are **empty**. The skills index is an unsigned URL setting. |
| A data plugin already | **Domain packs** (`docs/dev/domain-packs.md`): one JSON per field of work, known keys only, bounded, loaded from a folder, never code. This is the model for every data plugin below. |
| Extension points | DSH slots, plus **38 distinct `window.__KB_*__` names** (grep), none versioned, none capability-checked, one documented. Registries are closed: dashboards `PRESETS` (a constant), `KB_MARKET_TEAMS` (hard-coded in the core client), the connectors `CATALOG`, domain packs (shipped folder only). Bundles import nothing from each other; shared code is copied and a test compares the copies (`session-guard.mjs`). |
| Permissions | **None.** A bundle is full-privilege host code in the DSH process plus code in the page. Of the 45 folders under `packages/`, grep (non-test, non-page source) finds `child_process` in 17, outbound HTTP in 16, file writes in 30, host routes in 34. DSH serves plugin routes **before** its own sign-in (`docs/dev/route-origin-rule.md`). |
| Paid | **No mechanism in this repo.** The one precedent, an offline signed licence on `kybernos-servers`, was removed: the page is in the open repo, "nothing to buy and no key to paste" (`docs/dev/servers-page-study-2026-10-19.md`). Entitlement lives on the Kybernos server (`entitled`, `remote_not_in_plan`, `window.__KB_UPGRADE__`). |
| Trust and review | A signed release says the suite comes from us. Nothing says anything about a plugin by someone else. |
| Pieces of a conformance tool | `scripts/test-layout.mjs`, `scripts/test-consistency-guards.mjs`, `scripts/audit-css-prefixes.mjs`, `scripts/garde-depot.mjs`, the help-card test, the compat gate, the route-origin guard test. |

## 2. Where this draft differs from the first proposal

1. **"Data plugin = safe" is only half true.** A theme or a dashboard preset is inert. A skill, an automation prompt or an agent role is text
   an agent with a shell will follow: it cannot run code in our process, but it can make an agent act. Data plugins therefore have two classes
   (`inert`, `instruction`) with different install rules (section 3).
2. **A paid plugin by another developer, unlocked by that developer's API key, does not need third-party code.** Most such plugins are "a
   screen or a source that talks to the vendor's service". If the host runs the request (a *declarative* source: host, path, header, response
   mapping), the plugin is data, the key never reaches third-party code, and its `net:` permission **can be enforced at run time**. This is
   what lets us open to third parties without opening to third-party code.
3. **No offline licence file as a contract mode.** Two models only: the **vendor's key** (the vendor's server decides) and the **Kybernos
   account** (our server decides). An offline licence that gates management is what `kybernos-servers` just removed.
4. **"Verified" is a property of one version, not of a plugin**, and it is not offered until a written checklist and a second reviewer exist.
5. **One catalogue format** for plugins, with `seq` for rollback, instead of a fifth copy of the signature code.
6. **The commercial field is `pricing`, not `tier`**: `tier` already means the socle level in `satellites.json` and `palier` is in `catalog.json`.
7. **The registry is a new small socle bundle**, not more weight on `kybernos-plugin` (2.9 MB client, 0.7 MB host).

## 3. Two kinds of plugin

| | **Data plugin** (`kind: "data"`) | **Code plugin** (`kind: "code"`) |
|---|---|---|
| Contains | `plugin.json` and files of known types: `.json`, `.md`, `.txt`, `.png`, `.webp` (no `.svg`, no `.js`, no `.html`) | a DSH bundle: `package.json`, `index.js` (host), `client.js` (page), `plugin.json` |
| Runs | nothing of its own: the **host** reads and validates it, and for declarative sources makes the HTTP request itself | in the DSH process and in the page, with the person's OS rights |
| Safe by | validation: known keys only, every string and array bounded, no URL to fetch except declared hosts, no code | review, signature, revocation. **Not** by a sandbox (section 7) |
| Can extend | data points | data and code points |
| Open to third parties | **v1** | not in v1 (decision 1, section 16) |
| Examples | domain packs, themes, language packs, dashboard presets, declarative sources, skills, team and automation templates | every module of the suite today |

Data has two classes, declared per point (`provides[].class`):

- **`inert`**: values the host applies (colours, layout, a preset's tiles, a translation). Install shows the card and asks one confirmation.
- **`instruction`**: text an agent follows (a `SKILL.md`, an automation prompt, a team role's prompt, a pack's starter question). Install shows
  **the full text** (and a diff on update), runs the secret scan used for Team skills (linear-time checks only: `docs/dev/team-skills-contract.md`),
  creates automations **switched off** and agent teams with approvals on "ask", and never takes a URL as a body. These are the rules domain packs already follow.

## 4. The manifest: `plugin.json`

One file at the root of every plugin, **generated first for the 42 existing modules** and then hand-kept. For a code plugin `package.json` stays
(DSH's loader needs it) and the two must agree (rules below). A data plugin has no `package.json`, which is why the contract cannot live there.
The shape is [`schemas/plugin.schema.json`](schemas/plugin.schema.json) (JSON Schema 2020-12); `contract` is the version of this contract:
a manifest with a `contract` the host does not know is listed as "needs a newer Kybernos" and never read further.

### 4.1 Fields

| Field | Req. | Meaning |
|---|---|---|
| `contract` | yes | `1` |
| `id` | yes | `author/name`, both `[a-z][a-z0-9-]`, 2 to 32 and 2 to 40 characters. The author part is the **namespace** (section 9.4). `kybernos`, `dsh`, `local` are reserved |
| `kind` | yes | `code` or `data` |
| `version` | yes | semver. For a code plugin it equals `package.json`'s |
| `name`, `description` | yes | texts `{ "en": …, "fr": … }`: `en` required, `fr` required when the author is `kybernos`, other languages fall back to `en`. `name` ≤ 40 characters, `description` ≤ 240 (today's one-line "promise"; the longest in the Suite is 178). Plain text, no `<` or `>` |
| `details` | no | the long description, ≤ 2000 characters |
| `icon` | no | a glyph id the Suite already draws (`GLYPHES`), or a relative `.png`/`.webp` |
| `family` | no | one of the Suite families (`base models teams create data connect cloud`); the host owns the list |
| `keywords` | no | up to 8 words, for search |
| `author` | yes | `{ id, name, url?, contact? }`; `id` equals the namespace of `id` |
| `homepage`, `repository`, `support` | no | `https://` URLs |
| `license` | yes | SPDX expression of the plugin (`Apache-2.0`, `CC-BY-4.0`, `LicenseRef-<name>` for a closed one). The core stays Apache-2.0 (DIGI TECHNOLOGIES); a plugin may use any licence |
| `pricing` | yes | `free` or `paid` |
| `commerce` | iff paid | `{ model, product?, unlocks, worksWithout, key? }` (section 8) |
| `requires` | yes | at least one of: `dsh` (`{ min, max }`, **the same object as `dsh-compat.json`**), `kybernos` (a range on the suite version), `plugins` (`{ "<id>": "<range>" }`). Also `suggests` (ids, never blocking) and `platforms` (`mac linux windows`) |
| `tested` | no | `{ dsh: […], kybernos: […] }`: what was actually played (the `testees` of `dsh-compat.json`) |
| `provides` | no | the points this plugin exposes: `[{ name, version "1.0", kind, class?, summary?, schema?, validator? }]` (section 6): a data point has exactly one of `schema` (a file in the subset of 6.3) and `validator: "builtin"` (the owner registers the check in code) |
| `extends` | no (data: yes) | the points it contributes to: `[{ point "owner/name#point", range, dir? }]`; `dir` is the folder whose files are the contributions (required for a data plugin) |
| `permissions` | code: declared | words of the vocabulary (section 7). A data plugin may declare only `net:<host>` and `secrets.own` |
| `package`, `entry` | code | the DSH package name (`@local/<dir>`) and `{ host?, client?, extra? }`: the `.` and `./client` exports of `package.json`, and `extra` for a bundle that exposes named modules instead (`dsh-subagent-maison`: `./opencode`, `./gemini`…) |
| `claims` | code | the global names it takes: `cssPrefix` (3 to 5 letters), `routePrefixes`, `slotIds`. Collisions are the failure that `scripts/audit-css-prefixes.mjs` and the "slot ids and route paths are global" rule of the new-plugin skill already guard |
| `help` | no | path of the `help.json` card (required for a plugin with a page) |
| `update` | no | `{ catalogue: <https URL>, auth: none \| key \| account }`: where a newer version is announced (WordPress's `Update URI`) |
| `suite` | first-party | `{ core?, default on/off, order?, replaces? }`: what `satellites.json` holds today. Absent for anyone else |

Out of the manifest on purpose: the price (it lives in the catalogue or on the server, so it can change without a new version), the archive size
(`poids_ko`, measured at build), the release notes (per version, in the catalogue).

### 4.2 Examples

A free data plugin (a field of work for the domain-pack point, the smallest useful manifest):

```json
{
  "contract": 1, "id": "acme/vet-clinic", "kind": "data", "version": "0.3.0",
  "name": { "en": "Veterinary clinic", "fr": "Clinique vétérinaire" },
  "description": { "en": "A domain pack for veterinary clinics: goals, skills, reminders." },
  "author": { "id": "acme", "name": "Acme Software" },
  "license": "CC-BY-4.0", "pricing": "free",
  "requires": { "kybernos": "^0.1", "plugins": { "kybernos/core": "^1.0" } },
  "extends": [{ "point": "kybernos/core#domain-pack", "range": "^1.0", "dir": "domains" }]
}
```

A platform (the WooCommerce side), abridged:

```json
{
  "contract": 1, "id": "kybernos/dashboards", "kind": "code", "version": "0.1.0",
  "name": { "en": "Dashboards", "fr": "Tableaux de bord" },
  "description": { "en": "Dashboards built and changed by chat, from your own sources.", "fr": "Des tableaux de bord construits par chat, depuis vos propres sources." },
  "author": { "id": "kybernos", "name": "Kybernos" }, "license": "Apache-2.0", "pricing": "free",
  "package": "@local/kybernos-dashboards", "entry": { "host": "index.js", "client": "client.js" },
  "requires": { "dsh": { "min": "0.1.6-alpha.2", "max": "0.2.1-rc.2" } },
  "provides": [
    { "name": "preset",      "version": "1.0", "kind": "data", "class": "inert", "schema": "schemas/preset.schema.json" },
    { "name": "http-source", "version": "1.0", "kind": "data", "class": "inert", "schema": "schemas/http-source.schema.json" },
    { "name": "source",      "version": "1.0", "kind": "code" }
  ],
  "permissions": ["ui.slot:sidebar.right.pane.tab", "host.routes:/kybernos-dashboards:write", "fs.write:dsh-home"],
  "claims": { "routePrefixes": ["/kybernos-dashboards"] },
  "help": "help.json", "suite": { "default": "on" }
}
```

Illustrative: the real `permissions` and `claims` of each module are written in phase 1 by reading its code, not from this example.

A paid plugin by another developer, unlocked by that developer's key, still a **data** plugin (the extension of the platform above):

```json
{
  "contract": 1, "id": "acme/shop-dashboards", "kind": "data", "version": "1.2.0",
  "name": { "en": "Shop dashboards" },
  "description": { "en": "Sales, orders and stock dashboards for an Acme Shop store." },
  "author": { "id": "acme", "name": "Acme Software", "url": "https://acme.example" },
  "license": "LicenseRef-Acme-EULA", "pricing": "paid",
  "commerce": {
    "model": "key", "product": "shop-dashboards-pro",
    "unlocks": { "en": "Live data from your store, refreshed every 15 minutes." },
    "worksWithout": { "en": "The dashboards open on sample data, and you can import a CSV by hand." },
    "key": { "label": { "en": "Acme Shop API key" }, "hosts": ["api.acme-shop.example"], "getUrl": "https://acme.example/keys", "format": "^ak_[A-Za-z0-9]{32}$" }
  },
  "requires": { "kybernos": "^0.1", "plugins": { "kybernos/dashboards": "^1.0" } },
  "extends": [
    { "point": "kybernos/dashboards#preset",      "range": "^1.0", "dir": "presets" },
    { "point": "kybernos/dashboards#http-source", "range": "^1.0", "dir": "sources" }
  ],
  "permissions": ["net:api.acme-shop.example", "secrets.own"],
  "update": { "catalogue": "https://acme.example/kybernos/catalogue.json", "auth": "key" }
}
```

A paid plugin of ours, by Kybernos account (today's phone link, as it would be declared): `"pricing": "paid", "commerce": { "model": "account",
"product": "phone-link", "unlocks": { "en": "The end-to-end encrypted phone link." }, "worksWithout": { "en": "DSH is fully usable on a narrow screen." } }`.

Fuller versions of these four manifests and 26 broken variants (a data plugin with `exec`, a paid plugin with no `commerce`, a `key` model with no `key` block, an id
in capitals, a code plugin with neither a DSH zone nor a `suite` block, `net:*`, a range with `||`, an `http:` homepage, an unknown top-level key…)
were run against the schema with a standard JSON Schema 2020-12 validator on 2026-10-21: all accepted or refused as expected. That script is not in the repo.

### 4.3 Generating the manifest of the 42 existing modules

| Today | Becomes |
|---|---|
| dir `kybernos-<x>` / `dsh-<x>` / `kybernos-plugin` | `id` `kybernos/<x>` / `kybernos/dsh-<x>` / `kybernos/core`. Directory names are kept, French ones included (`kybernos/modeles-locaux`); no rename in this contract |
| `lifecycle-packages.json` `nom`, `package.json` `name` | `package` |
| `package.json` `version`, `license`, `description` | `version`, `license`; `description` is the English promise |
| `FICHE` `[family, promesse fr, promesse en]`, `TITRES` | `family`, `description`, `name.en` (`name.fr` is new: today the title is English only) |
| `GLYPHES` | `icon` |
| `satellites.json` `socle`, `defaut`, `tier`, `ordre_montage`, `obligatoire` | `suite` |
| `help.json` | stays; `help` points to it |
| `catalog.json` `palier`, `poids_ko`, `notes`, `aide` | stay derived by `build-catalog.mjs` (not in the manifest) |
| (nothing) | `requires.dsh` omitted = inherits the zone of `dsh-compat.json`; `permissions` drafted by a scanner, then **read by a person, module by module** |

`catalog.json` keeps `schema: 1`: the release validator (`formeDuDocument`) reads only the keys it knows, so a newer catalogue with extra fields is
still accepted by an older panel. Packages without a `dsh` block (`messaging`, `kybernos-gate`) are tools, not plugins, and are outside the contract.

### 4.4 Rules beyond the schema (what the validator adds)

1. `author.id` is the namespace of `id`. `kybernos` only with the official key; `local` only for a folder placed on the machine.
2. A code plugin's `version` and `package` equal its `package.json`'s `version` and `name`; a first-party `id` follows the table above.
3. `provides[].name` unique; a data point has a `schema` (the subset in section 6.3) or names a built-in validator; its `class` is set. A code point has no `class`.
4. An `extends` names a point whose owner is listed in `requires.plugins`: you cannot extend what you do not depend on. No cycle; depth at most 4.
5. `claims` are unique across the installed set (a route prefix has one or two segments); every `host.routes:/prefix` permission is inside `claims.routePrefixes`.
6. `commerce.key.hosts` are all in the `net:` permissions, and a code plugin that stores a key declares `secrets.own`; `commerce.key.format` is a regex checked for linear time (no nested quantifiers: the lesson of the Team skills checks).
7. `worksWithout` is non-empty and different from `unlocks`; a reviewer checks it is true.
8. A first-party `requires.dsh` lies **inside** the zone of `dsh-compat.json` (a wider one would claim what nobody tested); `tested.dsh` lies inside the zone.
9. `engine.patch` only for `author.id` = `kybernos` and only for what `scripts/patches.json` lists (AGENTS.md rule 1).
10. Archive hygiene: no symlink, no path leaving the folder, no hidden file, no media in a data plugin beyond an icon and covers of at most 256 KiB each. Proposed bounds: 1 MiB and 64 files for data, 25 MiB for code.
11. `help` exists and passes the help-card test; a plugin with a page ships `fr` and `en` if first-party.

### 4.5 WordPress and WooCommerce, side by side

| WordPress / WooCommerce | Kybernos |
|---|---|
| Plugin header: name, description, version, author, licence | `name`, `description`, `version`, `author`, `license` |
| `Requires at least` / `Requires PHP` | `requires.kybernos` / `requires.dsh` |
| `Requires Plugins` (WordPress 6.5) | `requires.plugins`, with ranges |
| `WC requires at least` / `WC tested up to` | `requires.plugins` range / `tested` |
| `Update URI` | `update.catalogue` |
| Actions and filters (hooks): the public API | points: `provides` / `extends`, versioned, schema-checked |
| WooCommerce is a plugin others extend | `kybernos/dashboards`, `kybernos/core`, `kybernos/skills`… provide points |
| wordpress.org review, the Plugin Check tool | trust levels (section 9), the conformance tool (section 11) |
| Premium plugin with its own licence key and update server | `commerce.model: "key"` and `update.auth: "key"` |
| Woo.com subscription (updates and support, the code keeps running) | `commerce.model: "account"`; **an expired plan never locks** (section 8) |
| No sandbox: a plugin has the site's rights | the same, said out loud (section 7) |

## 5. Compatibility

Three axes, all declared, all checked before anything is mounted or read.

| Axis | Declared by | Checked against | Refused as |
|---|---|---|---|
| DSH | `requires.dsh` (`{ min, max }`, inclusive) | the running DSH version | `needs-dsh` (too old or too new) |
| Kybernos suite | `requires.kybernos` | `VERSION` of the suite | `needs-kybernos` |
| Other plugins and their points | `requires.plugins`, `extends[].range` | installed, enabled, compatible plugins | `missing-dependency`, `incompatible-point` |

**Range grammar** (one, small, written once in the validator): up to four comparators separated by spaces, all must hold; a comparator is
`^x.y.z`, `~x.y.z` or one of `>= <= > < =` with a version; no `||`, no wildcards. Versions compare with `comparerVersions`
(`packages/kybernos-hub/catalogue-distant.mjs`): numbers as numbers, a release above its own pre-releases. `^` follows npm for `0.x` (the first non-zero
segment may not change), which matters because the suite is `0.1.x`. **DSH uses the `{ min, max }` object, not a range string**, and pre-releases
count as ordinary versions in it: every DSH version in `dsh-compat.json` is a pre-release (`0.2.1-rc.2` is the newest), and an npm-style "satisfies" would never match them.

**Status.** At boot the registry gives each installed plugin one status: `ok`, `disabled`, `needs-dsh`, `needs-kybernos`, `missing-dependency`,
`incompatible-point`, `revoked`, `invalid`. Anything but `ok` is **not mounted** (code) or **not read** (data), is listed in the Suite panel with its
reason, and never stops DSH from starting (AGENTS.md rule 2). A broken plugin is a line in a list.

**The gate.** For the suite nothing changes: `dsh-compat.json` stays the single zone the lifecycle robot enforces at install and upgrade, and a bump
is valid only with the lifecycle tests green and the range updated in the same PR (rule 5). A first-party plugin may *narrow* the zone for itself;
it may not widen it. For a plugin outside the suite the declared zone is the only gate, applied at mount time.

## 6. Extension points

### 6.1 The model

A **point** belongs to the plugin that `provides` it, is named `owner/name#point` (`kybernos/dashboards#preset`), and has a `major.minor` version:
a new optional key is a minor, anything else is a major. A **contribution** is a file (data point) or a call (code point). An `extends` states
the range of majors it was written for. The owner supports a set of majors at a time and says which (`GET /kybernos-registry/points`).
The registry key of a contribution is `<plugin id>/<contribution id>`, so two plugins can both ship a pack called `vet`.

### 6.2 Making the registries open, without an engine patch

Today every registry above is a constant. The change is the same each time: **the constant becomes the first contribution** (the shipped
entries are contributed by the owner plugin itself, as `kybernos/*`), and the registry also scans the folder of installed data plugins,
`<DSH home>/kybernos/plugins/<author>/<name>/`, the way `domain-pack.mjs` already scans `domains/`. A file that fails validation is skipped
and logged, as today.

| Point | Kind, class | Today | What opens |
|---|---|---|---|
| `kybernos/core#domain-pack` 1.0 | data, instruction | **opened 2026-10-21**: the shipped `domains/*.json`, plus what enabled plugins contribute through `kybernos-registry`; `domain-pack.mjs` is the built-in validator | done; the others below are not |
| `kybernos/dashboards#preset` 1.0 | data, inert | `PRESETS` in `presets.mjs` | contributions read from the registry |
| `kybernos/dashboards#http-source` 1.0 | data, inert | does not exist ("sources are internal only", `domain-packs.md`) | **new**: declarative sources (6.4) |
| `kybernos/dashboards#source` 1.0 | code | internal | for code plugins only, later |
| `kybernos/core#team-template` 1.0 | data, instruction | `KB_MARKET_TEAMS` in the core client | contributions |
| `kybernos/core#automation-template` 1.0 | data, instruction | a block in the core client (extracted by `test-automation-templates.mjs`) | contributions |
| `kybernos/skills#skill` 1.0 | data, instruction | install from GitHub, shipped skills, `seed-skills.mjs` | a plugin ships skill folders |
| `kybernos/theme#theme` 1.0 | data, inert | `gallery.json`, signed catalogue (empty key list) | same document, same code |
| `kybernos/language#pack` 1.0 | data, inert | signed index (empty key list) | same |
| `kybernos/modeles-locaux#model` 1.0 | data, inert | signed catalogue (key minted) | same |

Themes, languages and local models already *are* data plugins with their own catalogue; the contract folds them into one catalogue format
(section 10) rather than leaving four copies of the signature code.

### 6.3 What a data point must be

The owner's schema (or a pure validator it exports) has to be: **known keys only** (`additionalProperties: false` everywhere), **every string
and every array bounded**, plain values, no code, no URL the host would fetch except declared hosts, and **linear-time checks only**. The schema
language is a deliberate subset (types, `enum`, `const`, `pattern`, length and item bounds, `required`, `allOf`/`anyOf`/`oneOf`/`not`, `if`/`then`/`else`, `$ref` inside the file) so that the validator stays short
with no dependency (this repo has none): `scripts/schema-subset.mjs` is that interpreter, about a hundred lines, and it throws on any keyword outside the subset. The manifest schema itself is validated by it.
The conformance tool rejects a point whose schema is looser than the rules above.

### 6.4 Declarative sources (the way a paid third-party plugin reaches its service)

`kybernos/dashboards#http-source` is the first point of this kind. A source file names a host from the plugin's `net:` permissions, a path template,
the header that carries the key, and a mapping from the JSON answer to tiles. **The host performs the request.** Bounds, to be fixed in that point's schema:
https only; `GET` only in v1; the host must be one of the declared ones (a `*.` prefix matches one label); no redirect to another host; no IP literal and no
loopback, private or link-local address after name resolution; 8 s timeout; answer at most 512 KiB and JSON only; the key goes in a header, never in a URL;
a path language with no expressions; a minimum refresh interval and a per-plugin quota; values are shown as text, never as HTML. What the vendor
returns is **untrusted content** wherever an agent reads it.

### 6.5 The versioned seam

The loose `window.__KB_*__` globals are replaced by one versioned object. Both halves, no engine patch:

```js
// page
const dash = window.__KB__?.use('kybernos/dashboards', '^1')   // service, or null: never throws
window.__KB__.provide('kybernos/dashboards', '1.2.0', service)   // the owner publishes its service
window.__KB__.extend('kybernos/dashboards#source', impl)         // a code contribution, checked against its declared range
window.__KB__.status('acme/shop-dashboards')                     // 'ok' | 'disabled' | 'revoked' | 'absent' | …
window.__KB__.entitlement('acme/shop-dashboards')                // section 8 (phase 3: not there yet)
window.__KB__.on('change', fn)
// host: globalThis[Symbol.for('kybernos.registry')], the same idiom as the trusted-authority predicate (hosted-instances.md)
```

`use` answers `null` plus a reason when the plugin is absent, disabled or the major does not match, so a bundle degrades instead of failing. A
data point's contributions are not pushed by plugin code: the owner reads them with `GET /kybernos-registry/contributions?plugin=…&name=…`
(validated, bounded). Writes (install, enable, disable, remove, save a key) are write routes under the origin rule (strict same origin **and** the signed session cookie).

The 38 existing globals are classified in phase 2 as *service* (becomes a point or a `provide`), *flag*, or *private*; each service stays an
alias of its `__KB__` entry for two suite releases. The first one converted is `__KB_DOMAIN__` (already documented). Shared code copied between bundles
(`session-guard.mjs`) becomes a versioned service of `kybernos/registry` where it can, never at the price of a bundle that cannot start without another.

The registry itself is a **new tiny socle bundle** `kybernos/registry` (no page, host routes, the seam). That changes the list of five
socle bundles. **Decided 2026-10-21: a new bundle**; the alternative, the registry inside `kybernos-plugin`, would have deepened the biggest hot file of the repo.

## 7. Permissions

A vocabulary of fixed words. A new word is a new revision of the contract, never a free string (the schema's `pattern` is the list).

| Word | Meaning | Band |
|---|---|---|
| `ui.slot:<slot>` | mounts a component in a DSH slot (`settings.section`, `conversation.composer.dock`, `sidebar.right.pane.tab`, `plugins.item`…) | low |
| `ui.dom` | observes or rewrites page elements it does not own (`kybernos-refs`) | elevated |
| `host.routes:/<prefix>:read` / `:write` | serves routes under that prefix. `write` means the origin rule: strict same origin + signed session cookie (`route-origin-rule.md`) | elevated |
| `fs.read:` / `fs.write:` `dsh-home` \| `workspace` \| `home` | files outside its own folder: DSH's home, the person's project folders, anywhere the OS user can reach. Its own folder `<DSH home>/kybernos/plugins/<id>/` needs no word | elevated / high |
| `net:<host>` | outbound requests to that host (`*.` for one label, `localhost` for local services). Matches the narrow `remote.*` declaration AGENTS.md rule 2 asks for | elevated |
| `exec` / `exec:<command>` | starts processes; the named form (`exec:git`, `exec:ollama`) is what a reviewer can actually read | high |
| `secrets.own` | stores and reads the one key the person typed **for this plugin** | elevated |
| `secrets.read` | reads other keys (model providers, connectors) | high, first-party only |
| `account` | acts on the Kybernos account session | high, first-party only |
| `agent.prompt` / `agent.tools` | adds to the system prompt (`systemPrompt.context`) / registers tools the model can call | high |
| `memory.read` / `memory.write` | the person's memory and lessons | elevated / high |
| `sessions.read` | the content of chats (summary, search, reference chips) | elevated |
| `engine.patch` | patches DSH; legacy (AGENTS.md rule 1), first-party only | high |

Providing or using another plugin's point needs no word: `requires` and `provides` are the declaration. A plugin whose bands are all *low* gets a
one-line card; *elevated* words are listed; any *high* word is listed first, with a confirmation.

**The honest limit.** **Nothing enforces these words at run time for a code plugin.** The host half runs in the DSH process with the person's rights;
the page half can call every plugin route that the same-origin rule lets a page call. A declared permission is a claim that protects only after a
review has compared it with the code, and a static check (the conformance tool greps for `child_process`, `fetch`, writes outside the plugin folder)
catches honest mistakes and naive abuse, never obfuscated code. Two cases are different: for a **data plugin** the host does the work, so `net:` and
`secrets.own` are enforced; and for a code plugin the later options are real isolation (a child process with the runtime's own permission flags,
a worker for the page half), not evaluated here.

### 7.1 What reading the 42 modules taught the vocabulary (2026-10-21)

The manifests of the Suite were written by reading each module's code (six readers, the scanner as a lead, a second look at every
disagreement). 354 words in all. The shape of the Suite, in words: `exec` in 16 modules (a bare `exec`, command built from input, in 5: connectors, the workers
connectors, workers, calls, terminal), `secrets.read` in 10, `account` in 5, `agent.prompt` in 5, `agent.tools` in 12, `sessions.read` in 10, `memory.*` in 6,
`fs.write:home` in 6 (hub, skills, cloud, mini-apps, workers, workspaces), `engine.patch` in 1. Six modules need only `ui.*` words (language, reference chips,
changes, media player, Mermaid, Kaby's page): their card is one line.

Rulings the reading forced, now part of the contract:

- **Verifying DSH's session cookie is not `secrets.read`.** The origin rule makes about ten modules read the machine secret that signs the cookie; counting it would make the
  word meaningless. A module that **mints** a cookie (the core's widget and gateway, the phone link, calls, the relaunch helper) or reads provider keys declares `secrets.read`.
- **A route prefix has one or two segments.** The core owns `/kybernos`, and `slash`, `composio` and `flow` serve under it, so they claim `/kybernos/slash`, `/kybernos/composio`,
  `/kybernos/queue-move`. Claims are compared for equality; a nested claim is fine.
- **Slot names keep DSH's own capitals** (`conversation.hero.workspace.directoryFlow`).
- **`engine.patch` is declared by the hub**, because the update it starts runs `dsh-lifecycle`, which re-applies the legacy engine patches. No other module declares it: the patches are applied by the robot, not by a bundle.
- A word is declared for what the module's **own code** does, and for the helper it spawns when the helper is part of the shipped feature. A feature that lives in another bundle's route (`kybernos-changes` calls the session routes) belongs to that other bundle.

What the vocabulary **cannot say** (candidates for the next revision of the contract, not added here): sending a key or the chat to an endpoint **named by the
person's configuration** (Models' "fetch the available models" reaches any of 198 provider hosts, Calls' LiveKit address, a skills relay, the servers list) and not by the code, a `net:configured`;
**changing DSH's own settings or profile** (Connectors writes `.env` and `cordis.patch.yml`, Free LLMs repairs a provider route, Auto's failover can swap the model of a chat), a `settings.write`;
**injecting a message into a session** (the queue's auto-continue, calls), a `sessions.write`. Until then the manifest says what it can in `notes` of the review, and the gap is visible.

`scripts/plugin-scan.mjs` and `scripts/test-plugin-scan.mjs` hold the line from here on: a manifest may declare more than the code shows, never less. The few places where
the scan sees something a reader judged not to be shipped behaviour are in `scripts/plugin-scan-exceptions.json`, each with its reason.

## 8. Free and paid

**Principles, all from existing owner decisions.** Gate only where value passes through a server; never remove a free local path; a lapsed plan
never locks anyone out (`servers-page-study-2026-10-19.md`); the person's data and the management of the plugin (disable, remove, export) are never behind a key.
A paid *local* plugin cannot be technically uncopyable, and the contract does not pretend otherwise: what is enforceable is the **service** behind it
and the **distribution** (download and updates). That is also WordPress's practice: a premium licence governs updates and support, not whether the code runs.

| | `model: "key"` (a vendor's key) | `model: "account"` (the Kybernos account) |
|---|---|---|
| Who sells | the plugin's author, outside Kybernos | Kybernos (ours first; third parties only in phase 5) |
| Who decides | the vendor's server, when the plugin calls it with the key | the Kybernos server, from the signed-in account |
| What the person does | gets a key from the vendor (`commerce.key.getUrl`, opened by the person), pastes it once | signs in; the plan is the account's |
| Gates | the features that go through the vendor's server; optionally the archive download (`update.auth: "key"`) | the hosted features; the download of an official paid archive |
| Kybernos's part | stores the key, sends it **only** to the declared hosts, shows the card | answers the entitlement call |

**How the key is handled** (`model: "key"`): one field on the plugin's page, labelled by `commerce.key.label`, checked against `format` before saving, saved
through a write route under the origin rule into a file readable by the owner only (like `servers.json`), keyed by plugin id, **never in the plugin folder,
the archive or the page** (the page keeps no copy after saving, as Connectors does). It is sent in a header to `commerce.key.hosts` and nowhere else; for a data plugin
the host does that; for a code plugin it asks for `secrets.own` and `net:`, and the reviewer checks it. A key is typed by the person, never by an agent.
`GET …/entitlement` never returns it.

**One call answers the question**: `GET /kybernos-registry/entitlement?id=<plugin id>` returns
`{ state: "free" | "active" | "expired" | "none", source: "account" | "key" | "none", until?, checkedAt, stale }`. `free` is a free plugin; `none` is paid with no key or plan;
`stale: true` means the last answer is shown because the network or the vendor did not answer (the state is kept, not dropped). For `account` the Kybernos
server answers; for `key` the vendor's answer is mapped by the source or the plugin.

**What each state does.** `active`: all features. `none` and `expired`: the features in `worksWithout` keep working, the ones in `unlocks` say what they need,
updates stop (a purchased version keeps running, as in WordPress), and **management is untouched**. `worksWithout` is mandatory for a paid plugin, shown on the card,
and what a reviewer checks first: it is how "never remove a free local path" becomes a rule for people who are not us.

Out of this contract's first phases: a Kybernos marketplace where we collect payment for third parties and keep a share (seller of record, VAT, payouts,
refunds). The manifest already has room for it (`model: "account"` with a vendor's `product`); the legal and server side is phase 5.

## 9. Trust, review and signing

### 9.1 Four levels

| Level | Meaning | What proves it | Data plugin | Code plugin |
|---|---|---|---|---|
| **Official** | made and shipped by Kybernos | the suite release key, or the official catalogue key, and namespace `kybernos` | yes | yes (today's suite) |
| **Verified** | **this exact version** was reviewed by us | the author's signature **and** a reviewer's countersignature on the same archive hash | yes | not in v1 (decision 1) |
| **Community** | signed by its author, not reviewed | the author's signature, key published in a catalogue the person added | yes, with a plain warning | **not offered in v1** |
| **Local development** | a folder on this computer | nothing | yes, namespace `local`, never updated | the bundle in a checkout, as today |

The card shows the level, the author, the licence, the last update and the permissions. **A level never survives a change**: an update that adds
a permission, a host or a point never applies silently, and a Verified plugin whose new version is not reviewed is shown as Community until it is.

### 9.2 What a review is

Machine part: the conformance tool (section 11) passes. Human part, per version, written down: the manifest tells the truth (permissions, hosts,
`worksWithout`); the host half is readable source (no minified or obfuscated host code), with no `eval`, `new Function` or dynamic import of a remote URL;
no network use outside the declared hosts and no telemetry that is not declared; keys and personal data handled as section 8 says; the licence is real;
the update does what the changelog says. Who reviews and how fast is open until phase 4; v1 claims no review (decision 3).

### 9.3 Signing

Everything is Ed25519 over exact bytes, reusing the code that exists. Signed messages are UTF-8 lines with a fixed first line, so a signature made for one purpose cannot be replayed for another:

```
author  : "kybernos-plugin-v1" LF <id> LF <version> LF <sha256 of the archive>
review  : "kybernos-plugin-review-v1" LF <id> LF <version> LF <sha256> LF <level>
```

The catalogue document is signed as a whole (side file `.sig`, base64, as `catalog.release.json` is). Nothing is parsed before its signature verifies.
Key lists, so keys rotate; a key has `keyId`, `pem`, optional `notBefore` and `notAfter`; the document can list `revokedKeys`.

### 9.4 Namespaces

`author/name`. The author part is a namespace **registered with its keys in a catalogue** (a first-come claim in the official catalogue, or the
author's own catalogue for a user-added source). The same namespace with different keys in two catalogues is a conflict, shown and refused.
`kybernos`, `dsh` and `local` are reserved; `kybernos/` also because of the trademark.

### 9.5 Revocation and withdrawal

The catalogue carries `revoked: [{ id, versions (a range), sha256?, reason (text), at, action: "disable" | "warn" }]`. It is evaluated at every
refresh **and at boot from the last verified cached copy**, so it works offline. A revoked data plugin is dropped from the registries; a revoked code plugin is not
mounted at the next boot (the hub's boot guard and safe mode already know how to start with only the socle). A missing or unreachable catalogue never blocks the start. A
version can also be `yanked` (no longer offered, installed copies keep working).

## 10. Catalogues and archives

**One document format**, `kind: "kybernos-plugin-catalogue"`, `schema: 1`:

| Key | |
|---|---|
| `catalogue` | `{ id, name, seq, publishedAt }`. `seq` only goes up per `id`; a lower one is refused (rollback), as the themes, languages and models catalogues already do |
| `authors` | `{ "<namespace>": { keys: […] } }`: the namespaces this catalogue vouches for |
| `reviewers` | keys allowed to countersign (only meaningful in the official catalogue) |
| `plugins[]` | `{ id, versions: [{ version, manifest (the plugin.json, embedded), archive: { url (https), sha256, size }, authorSig, review?, notes?, yanked? }] }` |
| `revoked`, `revokedKeys` | section 9.5 |

**Sources.** `pluginCatalogues` in `<DSH home>/kybernos/settings.json`, a list like the existing `catalogueUrl` / `themesCatalogueUrl`. *Official*: ours, key embedded in the
suite. *Partner*: delegated by the official one (its key is listed in the official document). *Added by the person*: a URL, its key pinned on first use and shown
to the person with a warning; everything that comes from it is Community. Removing a source removes the trust, not the installed plugins. Downloads reuse
`telechargement.mjs`: https only, size caps, streamed while hashed, a tar listing that may not leave its folder.

**Per-plugin archive.** A tarball with the plugin's files and a `manifest.json` that lists every file's hash (the format the lifecycle robot already checks for the suite),
its sha256 named in the signed catalogue and signed by the author. A data plugin is installed by an atomic folder swap into
`<DSH home>/kybernos/plugins/<author>/<name>/` (previous version kept for one step back), with no boot check since nothing runs. A code plugin that is part of
the suite keeps the robot, its snapshot, its boot check and its rollback: **the unit of update stays the whole suite**, and the plugin's own `requires` is checked when the suite is built.
Per-plugin install of third-party *code* would need that robot extended to bundles outside `lifecycle-packages.json`; it is not designed here.

**The Suite release is not replaced.** It keeps its schema-2 document, its key and its rules. The plugin catalogue is a second document next to it; the official
one is generated from the same `plugin.json` files (so the Suite panel and the plugin list never disagree).

## 11. The conformance tool

`node scripts/plugin-check.mjs <folder | archive>`: one report, the same checks for us and for others, reusing what exists.

| Check | Reuses |
|---|---|
| manifest against the schema, plus section 4.4 | **exists**: `scripts/plugin-manifest.mjs` on `scripts/schema-subset.mjs`; `scripts/test-layout.mjs` and `build-catalog.mjs` call it for the suite |
| ids, versions, dependencies, points, their schemas (6.3) | new |
| claims (CSS prefix, route prefixes, slot ids) unique and used | `scripts/audit-css-prefixes.mjs`, `scripts/test-consistency-guards.mjs` |
| permissions against the code (grep-level: `child_process`, `fetch`, writes, routes, slots) | **exists**: `scripts/plugin-scan.mjs`, held by `scripts/test-plugin-scan.mjs` (a manifest may declare more than the scan sees, never less); its limit is stated in section 7 |
| every write route under the origin rule | the guard tests (`test-session-guard.mjs`, `test-write-guard.mjs`) |
| no secret, no personal path, no media beyond the bounds | `scripts/garde-depot.mjs` rules, applied to the folder |
| the help card | `test-help-card.mjs` |
| compatibility: zone, `tested`, dependency resolution | the compat gate, `comparerVersions` |
| archive hygiene and hashes | `telechargement.mjs` and the robot's `manifest.json` check |

The report is attached to a catalogue entry as information; the publisher runs it again. A green report is **necessary for every level and sufficient for none**.

## 12. "Compatible with Kybernos": a usage policy (draft)

The mark Kybernos (FR 5306518, filed by DIGI TECHNOLOGIES) is pending. `TRADEMARK.md` rule 1 already lets anyone say software is compatible with, integrates with
or is based on Kybernos; rules 3 and 4 forbid suggesting endorsement or competing names. The contract adds, for plugins:

- **Nominative use is free**: "Shop dashboards for Kybernos", "compatible with Kybernos 0.1", as plain text, with the version it was tested on (`tested`).
- **Reserved**: the namespace `kybernos/`; the words *Official* and *Verified*; the logo and the "K"; a plugin name that is, starts with or reads as "Kybernos …".
- **No badge or logo until the mark is registered**; until then the "compatible" statement is text. The conformance report may be shown as "passes the Kybernos conformance check (v1)".
- The wording to add to `TRADEMARK.md`, and what pending status allows, are for the owner's trademark counsel; this section is a proposal, not legal advice.

## 13. Honest limits, in one place

1. Permissions of a **code** plugin are declarations, enforced by nothing at run time (section 7). Signing proves who, not what.
2. Data is safe from running code, not from steering an agent; `instruction` data is mitigated by consent, disabled-by-default and the secret scan, not made harmless.
3. A paid local plugin can be copied; only a service or a download can be gated (section 8).
4. Revocation is as good as the last refresh; offline it uses the last cached list.
5. Author keys are as safe as authors keep them; a stolen key signs a bad update. Hence "a level never survives a change" and the per-version review.
6. Declarative sources cut the third-party-code risk but add a request-making surface (SSRF, exfiltration through a hostile host); the bounds in 6.4 are the defence and must be tested hard.
7. Hosted routes are served before DSH's own sign-in. A registry route that writes is under the origin rule; one that only reads sits behind the Host fence, like the other reads.

## 14. Phases, and what exists for each

| # | Phase | Exists today | To build | Gate |
|---|---|---|---|---|
| 0 | This spec | the pieces in section 1 | review and decisions of section 16 | the owner |
| 1 | Manifest on the 42 modules + validator | `build-catalog.mjs` tables, `satellites.json`, `lifecycle-packages.json`, `test-layout.mjs`, `catalog.json` schema 1 | **Built 2026-10-21**, see below. `plugin.json` ×42, `scripts/plugin-manifest.mjs` on `scripts/schema-subset.mjs`, `scripts/plugin-scan.mjs`, a check in `test-layout.mjs`, `build-catalog.mjs` reading the manifests; `FICHE`/`TITRES`/`GLYPHES` deleted | `build-catalog.mjs --check`, layout, lifecycle tests; catalogue still accepted by an older panel |
| 2 | Open the registries to data packages | `domain-pack.mjs` and its folder scan; `PRESETS`, `KB_MARKET_TEAMS`, the automation templates as constants | **Foundation built 2026-10-21**, see below: bundle `kybernos/registry` (socle), `__KB__` and the host seam, the folder scan, the domain-pack point, `__KB_DOMAIN__` as an alias. **Left:** the Plugins page (mockup published, awaiting the owner), the other points of 6.2 | the point validators; a hostile data plugin test; DSH starts with a broken plugin: all three exist and pass, on a real `dsh web` in the sandbox |
| 3 | Per-plugin install and update from a signed multi-source catalogue, with the key and account models | signed-catalogue code ×4, `telechargement.mjs`, the origin guard, the Connectors key page as the key-handling model | one catalogue format; `pluginCatalogues`; install/update/remove for data; entitlement call; key storage; revocation; levels on the card; declarative `http-source` | rollback, revoked, wrong key, replay of an author signature; **needs a Kybernos server route for `account` entitlement and keys for the catalogue** |
| 4 | Third-party code, review, Verified (only if the owner reopens decision 1) | the pieces of the conformance tool | `plugin-check.mjs` complete; a written checklist; reviewer keys; the robot extended to extra bundles | a second reviewer exists |
| 5 | Commerce for third parties (revenue share) | nothing | seller of record, VAT, payouts, refunds, terms | counsel; last |

**Phase 1 as built.** Files: `packages/<dir>/plugin.json` ×42; `scripts/schema-subset.mjs` (the interpreter), `scripts/plugin-manifest.mjs` (schema + the rules of 4.4),
`scripts/plugin-scan.mjs` (+ `plugin-scan-exceptions.json`); tests `test-plugin-manifest.mjs` (79 checks, including the three manifests printed in this document),
`test-plugin-scan.mjs`, and two new checks in `test-layout.mjs`. `catalog.json` is byte-identical to what the tables produced, so an older panel is unaffected. What the build settled
that the draft left open:

- `description` may be 240 characters (the longest promise in the Suite is 178); `entry.extra` names the modules of a bundle that has no `.` export (`dsh-subagent-maison`).
- A module's manifest carries no `provides`, `extends` or `requires.plugins` yet (there is no registry to read them: phase 2), `requires.kybernos` is `>=0.1.0` for all, `requires.dsh` is omitted
  so the zone of `dsh-compat.json` applies, and `suite.order` is not stored (the order stays in `lifecycle-packages.json`; a stored copy would change in 42 files whenever a module is inserted).
- `claims` holds the route prefixes only; CSS prefixes and slot ids stay with the audits that already guard them.
- **`kybernos-mobile` is declared `paid` by Kybernos account** (`product: "phone-link"`), as its README says; every other module is `free`. Several have plan limits (connection counts,
  Team locks); a limit is not an unlock, so they stay `free` until the owner says otherwise.
- `name.fr` is new: the Suite only ever had English titles. The 42 French names are a draft for the owner to proof-read. `VEDETTES` (the featured cards) stays in `build-catalog.mjs`.
- The manifest is checked in two places: `build-catalog.mjs` refuses to build a catalogue from an invalid one, and `test-layout.mjs` checks it against `package.json`, `satellites.json` and the other manifests.

**Phase 2 foundation as built** (`packages/kybernos-registry`, the sixth socle bundle, mounted first). What it does is in its README; what the build settled:

- The registry **reads on demand, never at boot** (a scan is reused for two seconds), so a broken plugin cannot stop DSH from starting. A folder it cannot accept is listed `invalid` with its reasons and logged once.
- Only **`local/<name>`** folders are read (`<DSH home>/kybernos/plugins/local/<name>/plugin.json`, namespace `local`, level Local). A folder of another author is listed invalid until phase 3 brings the signed catalogue. A **code** plugin is never loaded from a folder.
- A plugin seen for the first time is **off** (`disabled`), whatever its class, until the person switches it on (`POST /kybernos-registry/enable`: strict same origin and the signed session cookie). The choice lives in `<DSH home>/kybernos/plugins-state.json` (0600).
- **Nothing in a plugin folder is run**: no import, eval or fetch, no symbolic link followed, files read as bounded text (manifest 64 KiB, contribution 256 KiB, 32 files per extension, 64 plugins) and parsed as JSON; a test greps the registry's own sources for `import(`, `eval`, `new Function`, `child_process`.
- The owner of a point **registers it at run time** through the host seam (`definePoint`, idempotent, called at boot and at each question because mount order is not guaranteed); the registry judges `extends` and `requires.plugins` against those points. `requires.dsh` is read but **not enforced** (no reliable DSH version in the process); `requires.kybernos` is enforced from `VERSION`.
- `kybernos/core#domain-pack` is the first point. A contributed pack goes through the same `validatePack` as a shipped one, comes after ours with its `order` held between 50 and 98, cannot reuse an id or a legacy job, and says where it came from (`from`). A plugin pack cannot ship skill folders yet (that is the `skill` point); it can name GitHub skills and the skills we ship.
- The page seam is created when `client.js` is evaluated, announces itself with the event `kybernos:registry`, and the core offers `{ domain }` as `kybernos/core` (and keeps `__KB_DOMAIN__` as the alias). The validator and its schema moved into the bundle (the dev scripts re-export them); the copy in `docs/dev/schemas/` is kept identical by a test.
- Checked on a real `dsh web` in the sandbox (`scripts/check-registry-live.mjs`, 24 checks) and in its page (`window.__KB__` version 1, the core's service is the legacy global). Not done: the real profile is not switched on, the Plugins page is not built.

Each phase is a set of PRs that keep the three pre-push gates green, add no engine patch, and delete what the new thing supersedes.

## 15. Not in this draft

The Plugins page and the card (a visual change: a mockup first). The exact `http-source` and `preset` schemas. Per-plugin install of third-party code.
Run-time isolation. Telemetry, ratings, reviews by users. Pricing, tax and payout mechanics. A rename of the French-named directories.
Auto-update policy (default off for anything that is not Official; never across a permission change).

## 16. Decisions (taken 2026-10-21: every recommendation accepted)

1. **Third-party code plugins in v1, or data only?** Decided: **data only** in v1, including paid ones with the vendor's key through declarative sources (6.4): it
   serves the case you named (another developer, a key that unlocks features) without running anyone's code. Reopen code after the registry and the conformance tool are in use.
2. **The paid model.** Decided: **two models, both in phase 3**: the vendor's key (first, for other developers) and the Kybernos account (ours). **Drop the offline
   licence file** as a contract mode (the `kybernos-servers` lesson), and write "an expired plan never locks, `worksWithout` is mandatory" into the contract as a rule for everyone.
3. **Who reviews, and does "Verified" exist?** Decided: v1 ships **Official, Community (data), Local** only; "Verified" opens in phase 4 with a written checklist
   and a second reviewer, and always means one version.
4. **The "compatible with Kybernos" policy** while mark 5306518 is pending. Decided: nominative text use now (already allowed by `TRADEMARK.md` rule 1), reserved namespace
   and words, no badge or logo until registration; have counsel word the `TRADEMARK.md` addition (section 12).
5. **Per-plugin or whole-suite updates.** Decided: **per plugin for data plugins; whole suite for first-party code** (the robot's snapshot, boot check and rollback stay the single install path); third-party code is not designed.
6. **The namespace.** Decided: `author/name`, the author registered with keys in a signed catalogue, `kybernos`, `dsh` and `local` reserved, existing modules mapped by the table in 4.3
   (`kybernos-x` becomes `kybernos/x`, `kybernos-plugin` becomes `kybernos/core`).
