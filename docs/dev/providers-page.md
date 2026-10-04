# The Providers tab (Settings → AI Provider & Models)

One page for what DSH's native Models page does, with the same writes underneath.
Everything below was measured on DSH 0.2.0-rc.2 (`dsh-client-ui-settings-models`), not assumed.

## What a user sees

- **Cards** read at rest: icon, name, model count, a key dot, a *Custom* tag, the
  *Free models · quota ↗* link where one exists. A click opens the provider's models.
- **Actions on hover** (and on focus; always visible on touch screens): the switch (disable),
  edit, and a menu (View models, Add model…, Delete…).
- **Edit** opens a side panel like DSH's editor: the API key first, everything else folded
  under *Customized settings* (display name and protocol on hand-declared routes only, base URL,
  models as *Model ID* + *Display name*). Apply writes only what changed.
- **Add** opens the same panel with two tabs, like DSH's: the models.dev catalog (213 providers,
  icons, search, Free / Popular / All groups, arrow keys, *Already added* last) and *Custom API*
  (Provider ID, name, base URL, protocol, key, models).
- **Delete** asks for the provider id before it enables the button, and offers *Disable instead*.
- **Disable** is described in `disabling-providers.md`.

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
- **DeepSeek**: it lives in another namespace (`llm-deepseek`); its card opens DSH's native page.

## "Custom", display names and key state come from the engine

`llm.listConfigurableProviders()` gives `displayName`, `declared` (a route only configuration knows)
and `error` (a configuration diagnostic). `credentials.describe(refs)` gives `configured` per reference.
If the directory cannot be read, "custom" falls back to "not in models.dev".

## DSH's native Models page

The page and DSH's native one read and write the **same** namespace and listen to the same
invalidations, so they stay in sync by construction.

- The menu cell can be hidden while this plugin is active and healthy. **Today the default is visible**
  (`KB_NAT_DEFAULT_HIDDEN = false`): this page does not yet do everything the native one does (the Models tab, *Fetch
  available models*, DeepSeek). One constant flips the default once it does; a stored choice always wins.
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
  pressed): cards, hover, edit, add and the picker, delete confirmation, the native page round trip.

## Not done yet

- *Fetch available models* (the endpoint picker, `llm.discoverModels`) in the add and edit panels.
- The Models tab redesign (table in columns, filters, pagination), and the health chip.
- DeepSeek editing here.
