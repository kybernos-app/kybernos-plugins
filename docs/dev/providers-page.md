# The Providers tab (Settings → AI provider and models)

One page for what DSH's native Models page does, with the same writes underneath.
Everything below was measured on DSH 0.2.0-rc.2 (`dsh-client-ui-settings-models`), not assumed.

## What a user sees

- **Cards** read at rest: icon, name, the model count and the key count as icons (the words come on hover and on
  keyboard focus, and are the accessible name), a key dot, a *Custom* tag, the *Free models · quota ↗* link where one
  exists. **A click on the card opens the provider's sheet** (the Models tab is still the page's other tab; a
  provider that cannot be edited here, switched off or managed, shows its models there instead).
- **Actions on hover** (and on focus; always visible on touch screens): the switch (disable) and a menu
  (Add model…, Delete…). There is no pencil: the card is the edit.
- **The sheet** (one side panel, built like DSH's editor) holds, top to bottom: the API key, **what the provider
  says about it**, the provider's models (all of them, each with a checkbox, a search and *All / None*), the custom
  models of the provider, *Customized settings* (folded: display name and protocol on hand-declared routes only, base
  URL) and the enable / delete zone. Apply writes only what changed. See *The sheet* below.
- **Add** opens the same panel with two tabs, like DSH's: the models.dev catalog (213 providers,
  icons, search, Free / Popular / All groups, arrow keys, *Already added* last) and *Custom API*
  (Provider ID, name, base URL, protocol, key, models).
- **Delete** asks for the provider id before it enables the button, and offers *Disable instead*.
- **Disable** is described in `disabling-providers.md`.

## The sheet

Opening a provider's sheet asks the provider for its models with the **stored** key, through the host's live route
(`POST /kybernos-models/models/live`: the key never leaves the host); pasting a key asks again once the typing stops
(650 ms), with the typed key for that call alone. Emptying the field goes back to the stored key. A route that names
no key at all (a local Ollama) is asked with none and claims nothing about a key. A route whose key is missing waits
for the paste. A newer check replaces an older one; a late answer is dropped.

The answer gives the **key's state**, in words under the field, never a blocker:

| State | When | Says |
|---|---|---|
| `checking` | the call is out | spinner and *Checking the key…* |
| `ok` | the provider listed its models with the key | *Connected, the key works. N models found.* |
| `listed` | the same list also came back for a key that cannot be real (a second call, only after an `ok`) | the provider lists its models to anyone, so the key is checked on the first request |
| `refused` | 401 or 403 | *The provider refused this key (HTTP n)*; the models the engine's catalog ships stay on screen |
| `unreachable` | no network | *The provider cannot be reached*; the key is checked later |
| `unknown` | any other refusal, or the engine refused too | *The key could not be verified* |

For `refused`, `unreachable` and `unknown` (and when a custom model does not answer) **Apply becomes *Apply anyway***:
the check informs, it never holds the button.

**Models.** The list is the provider's whole answer (no cap, no « + N more »): a list of 173 models is 173 rows in a
scrolling box with a search, and *All / None* act on what the search shows. A model is ticked as the route serves it
today (its saved `models` list, else the engine's catalog); the first tick materialises the choice. Writing follows
the old picker's rules: ticked candidates become `models` rows (a row already there keeps every field it carried), a
model the engine's catalog does not describe is flagged `outside` and moves to the provider's companion route on save
(`kbPvSaveSmart`), *Restore default models* removes the override. Nothing is written until *Apply*.

**Custom models.** *Add a custom model* puts the id under *Your models* at once and checks it in the background with the
host's probe (`POST /kybernos-models/models/probe`, one tiny call, the route's **stored** key only): *answers*,
*rate-limited, but it exists*, *not found / does not answer* (a red dot), *cannot be checked*. With a key that is typed
but not saved yet the probe cannot run (it never takes a key from the page): the dot says *will be checked once the key
is saved*. An id that is already in the provider's list is ticked instead of added twice.

Not in the sheet yet: **several named keys per provider** (the engine takes one key per route, so extra keys would be
sibling routes grouped under one card; the open points are the models' capabilities on a declared copy and how Auto
Routing's whitelist and failover see them), and the same inline check in **Add ▸ Catalog**.

## Fetch available models

`llm.discoverModels(settingsNs, { provider?, baseURL?, api?, apiKey? })` is the call the native page makes. A route the
adapter's own catalog describes (anthropic, openai, …) is answered **from that catalog, with no network call**; a gateway
or a self-hosted server is asked over the wire, with the key typed in the panel for that call alone (never stored). An
edit names its route (and the form's base URL); an add (Custom API) names the endpoint and protocol, so the button waits
for a base URL. Every field but the id is optional (`name`, `contextWindow`, `maxTokens`, `inputModalities`).

- Models not yet in the list are ticked on opening; models already there are shown, ticked and locked (*Already added*):
  adopting never touches a row that exists, because the user may have tuned it. A model adopted keeps what the
  endpoint disclosed (context window, max tokens, input types), like the native page's `adopt`.
- **A catalog route's `models` list replaces the built-in one** (`models` already replaces the catalog, per the engine's
  own docs): the picker says so, and *Restore default models* (next to the button, only where it applies) removes
  the list altogether, which is what the native *Restore defaults* does. Emptying the rows is different: it writes an
  empty list, i.e. no model offered.
- A refusal, a dead endpoint, a timeout (30 s) or a DSH without the service show a plain message under the header.
- Nothing is written until *Apply*; the picker only edits the draft.
- Verified with a real write (one throwaway provider, settings backed up first, a local HTTP endpoint serving an
  OpenAI-style listing): DSH 0.2.0-rc.2 accepts the adopted list; the capacities the endpoint disclosed
  (`contextWindow`, `maxTokens`; the wire listing carries no input types, and a missing name falls back to the id) land
  in the profile; a later Edit keeps a tuned row (name, capacities) and adds only the new one; the typed key goes to the
  endpoint for that call and to the credential store on Create, never to settings.

## The writes (the same ones the native page makes)

| Gesture | Calls |
|---|---|
| Add | `settings.mutate` `set providers.<id>`, then `credentials.set(<ID>_API_KEY, key)` |
| Apply (edit) | `settings.mutate` with one `set` per changed key and one `unset` per removed key; a typed key goes to `credentials.set` and the profile records `apiKeyEnv` |
| Delete | `credentials.unset(ref)` **first**, then `settings.mutate` `unset providers.<id>` |
| Disable / Enable | park the profile on the host, then `unset`; or `set` it back, then forget the copy |

The key never touches settings; the page never asks for an environment-variable name (it is derived,
`<ROUTE>_API_KEY`, unless the profile already names one). Model rows keep every field they carried
(context window, max tokens, input types): only id and display name are edited here.

What cannot be changed here, and why the control says so:

- a provider the **base layer** also declares (an `unset` would just reveal the base copy);
- `kybernos` (Kybernos Cloud): `kybernos-cloud` rewrites that route on every sync;

## DeepSeek: two adapters in their own namespaces

DSH ships two DeepSeek adapters outside `llm-pi-ai`; the page shows each as a *Built into DSH* card and edits both
(`llm.listConfigurableProviders()` names them; the settings path is empty: the namespace IS the profile).

| Card | Namespace | What the panel edits |
|---|---|---|
| DeepSeek (`deepseek-official`) | `llm-deepseek` | the API key (credential under the profile's `apiKeyEnv`, `DEEPSEEK_API_KEY` by default), then, folded under *Customized settings*, the base URL and the model catalog |
| DeepSeek Account (`deepseek-account`) | `llm-deepseek-account` | the model catalog only: it signs in with the user's account, so no key and no URL |

- The catalog rows show id, display name, context window and max output tokens (typed like the native page: `131072`, `256K`,
  `1M`; blank inherits the adapter's default, shown as the placeholder), and an image-input toggle. They validate like the
  adapter (ID required and unique, name not empty, capacities positive integers); Apply is disabled while a row is invalid.
- `models` is replaced as **one array**: the first edit writes every inherited row into the user layer, with the fields the page
  does not show (description, `systemPromptUpdate`, `toolUpdate`…), which travel with their row. *Restore default models*
  removes the override instead of copying defaults into it, so the user layer goes back to empty.
- Each namespace has its own revision: a write to one never uses the other's, nor the models page's.
- Verified with a real write on the official catalog (settings backed up, undone through the page): DSH accepts it, nothing the
  page does not show is lost, the other adapter is untouched, and Restore returns the user layer to `{}`.

## "Custom", display names and key state come from the engine

`llm.listConfigurableProviders()` gives `displayName`, `declared` (a route only configuration knows)
and `error` (a configuration diagnostic). `credentials.describe(refs)` gives `configured` per reference.
If the directory cannot be read, "custom" falls back to "not in models.dev".

## DSH's native Models page

The page and DSH's native one read and write the **same** namespace and listen to the same
invalidations, so they stay in sync by construction.

- The menu cell is hidden while this plugin is active and healthy. **The default is hidden**
  (`KB_NAT_DEFAULT_HIDDEN = true`, since this page does everything the native one does); a stored choice always wins.
  The engine has no way to unregister another plugin's Settings section, so it is hidden in the DOM
  (`data-kb-native-nav`): the cell is the one whose text equals `locale.bind('settings.models')('nav')`, inside a menu
  that also holds ours. If the label cannot be read, nothing is hidden.
- It stays one click away: *⋯ → Open DSH's native Models page*; *⋯ → Hide DSH's native page from the Settings menu*
  toggles the cell. On the native page a note (its `settings.models.footer` seat) links back and has a checkbox to show
  the native cell again (stored per browser, `kb.models.hideNative`: `1` hide, `0` show).
- **Safety**: the page is wrapped in an error boundary. If it crashes, the native cell comes back and the page
  offers the native page. Safe mode loads no non-base bundle, so the native page is untouched there. Disposing
  the plugin shows the cell again.

## Tests

- `packages/kybernos-models/test-client.mjs` — the pure rules and the write layer (create, save, delete, key
  handling, ordering, rollbacks) run against a fake settings and credential store; wiring checks on the source.
- On the real GUI, read-only (client swapped into the served bundle, host routes faked, no write button
  pressed): cards, hover, edit, add and the picker, delete confirmation, the native page round trip. The fetch picker
  is checked the same way (the real engine answers; the settings file's hash is compared before and after).
- `scripts/check-provider-sheet-live.mjs` (sandbox only): the sheet end to end against a fake local provider (60 models, a good
  key, unknown models answering 404, a switch that makes the list public): card icons and hover words, click opens the
  sheet, key states, the whole list, ticks, custom models, 400 px, Apply and reopen.

## Not done yet

- The Models tab is described in `models-page.md`, the health chip in `model-health.md`.
