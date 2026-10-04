# `@local/kybernos-slash`

Saved prompts as **slash commands** and **message actions**. Type `/` in the composer to insert (or send) a saved
prompt template, optionally through an inline form; actions sit under assistant messages; both are managed in
Settings → *Commands*.

## What the user sees

- **`/` menu:** the entries are a source of DSH's native trigger menu (`name: 'kybernos'`, listed after the native
  commands). When the typed text matches nothing, a `Create "/xyz" with AI` row appears.
- **Composer:** a slash button opens a palette (browse, run, edit, create); a bookmark button, *Save as command*,
  shows up once the composer has text.
- **Form sheet** for entries that declare fields (text, long text, number, choice, yes/no, date). Fields can have one
  show condition (the editor writes `showIf`; the runtime also honours `hideIf` and `requireIf` when an entry carries
  them). The result is inserted at the caret, or sent at once when the entry's delivery is `send`.
- **Message actions** under assistant messages: icon buttons, right-click to edit or delete, a *More actions* menu
  for entries hidden from the toolbar, and a `+` to build one or start *Create with AI*. A template may use
  `{message}`, the text of the message acted on.
- **Settings → *Commands*/*Commandes*** (slot order 27): two tabs, search, editor dialog, delete with a 5 s *Undo*
  toast, and a viewer of the stored JSON.
- *Create with AI* starts a new chat pre-filled with `/skill-slash-msgaction-creator <text>`. That skill is not in
  this repository; whether it is installed in a profile: not verified.

## Host routes

| Route | Behaviour |
| --- | --- |
| `GET /kybernos/slash/entries` | `{ok, version, path, total, slash, action, entries}`, sorted by `order` then name. If the file is present but unusable: HTTP 500 `{ok: false, state: 'corrupt'\|'unreadable', error, path}` and no `entries` (see *Corrupt store* below) |
| `POST /kybernos/slash/entries` | upsert (`{entry}`, `{entries}`, one entry or an array), `{delete: id\|[ids]}` (or `remove`), `{replace: [...]}`; validation refusals are 400; the reply is the store re-read from disk; an unusable file or a failed write is HTTP 500 with the reason and nothing written |
| `GET /kybernos/slash/status` | path, exists, bytes, mtime, counts; plus `state` and `error` when the file is present but unusable (the counts are then 0, which does not mean empty) |
| `GET /kybernos/slash/message?sessionId=&messageId=` | `{ok, text}` of an assistant message, read from the session log |

Body ≤ 256 KiB, ≤ 500 entries. A POST is refused (403) when an `Origin` header differs from `Host`; a request with no
`Origin` (a script, the creator skill) is accepted. GET routes have no origin check.

## Files and settings

- `$DSH_HOME/kybernos-slash/entries.json` (default `~/.dsh/kybernos-slash/entries.json`): one JSON array merged by
  `id`. `KYBERNOS_SLASH_STORE` overrides the path for test harnesses.
- **Write:** atomic. A temp file `.entries.json.tmp-<pid>-<ms>` in the same directory, `chmod` to the existing
  file's mode (0600 for a new file), then `rename`; the temp file is removed if anything fails. A symlinked
  `entries.json` is followed (`realpath`): the target is replaced, the link stays.
- **Corrupt store:** a missing file, or one that is empty or only whitespace, is an empty list. A file that is
  present but is not a JSON array (truncated, hand-edited, valid JSON of another type) or cannot be read
  (permissions, a directory) is never read as empty. GET and `/status` report it, and every POST (upsert, delete,
  replace) is refused with a 500 and the reason, so the file stays byte for byte as it was until it is fixed or
  removed. A refused POST first keeps a copy of a corrupt file as `entries.json.corrupt-<ms>` (mode 0600, created
  with the exclusive flag, a `-1`, `-2`... suffix if the name is taken): one copy per distinct content, at most
  five, so repeated attempts do not pile up files. A GET never writes, so no copy exists until a save is tried; an
  unreadable file gets no copy. Once the file is valid again, saving works and the copies stay for the user to delete.
  The design is copied from `kybernos-sessions` (`KB-SETTINGS-FILE-BEGIN` block): bundles ship one by one, so there
  is no shared import and no test keeps the copies in step.
- Browser `localStorage` `kybernos-slash-delivery`: `{id: 'send'}`, a local copy of the *send right away* choice for
  a host that has not been restarted onto the code that stores `delivery`.
- `model.js` is the shared semantics (conditions, `render`, `normalize` for the two legacy shapes). `client.js`
  embeds a copy between `KB-MODEL-BEGIN` / `KB-MODEL-END`.
- `kybernos-plugin`'s client seeds a built-in `/widget` entry (`id: widget`, order 40) through the POST route when
  this bundle answers.

## DSH seams and network

- Host: `ctx.inject(['webServer'])` then `webServer.register({kind: 'exact'})` inside `ctx.effect`, one registration
  per path (DSH's exact table throws on duplicates, so `entries` dispatches on the method itself);
  `ctx.get('sessionPersistence')` for `/message`.
- Client: `inject: ['slots']`; slots `conversation.input.left`, `conversation.input.overlay`,
  `conversation.chat.assistant-actions`, `shell.overlay`, `settings.section`; `inputTriggers.registerSource` through
  `ctx.inject`. Read opportunistically (each in a try/catch): `conversation.input.shell(sid)` (the source says it is
  runtime-only, not in the public type; fallback `sessions.scope(sid)`), `uiWorkspace`, `sessions`, `timer`, and the
  DOM node `[data-composer-input]`. It also publishes `window.__kybernosSlash` as a diagnostic object.
- `package.json` lists eight `@deepseek-ai/*` client packages in `dsh.client.inject`, including `dsh-api-remotes`.
  `remote.*` is never called in the code (checked).
- Network: same-origin `fetch` to the routes above only.

## Tests

`node packages/kybernos-slash/test-host.mjs` (also run by CI's `packages/*/test*.mjs` loop): the store and the routes
through the real `apply(ctx)` on a fake web server, in a temporary directory only. It covers a missing file, a valid
file (the happy path), a corrupt file (copy kept, file untouched, GET and `/status` report it, every POST refused, a
repaired file works again), an unreadable file, copies capped at five and deduplicated (including the same
millisecond), the atomic write (no temp file, failure cleanup, replaced rather than rewritten in place), permissions,
and a symlinked store. The read-only-folder and `chmod 000` cases are skipped when run as root.

Nothing else covers this bundle (the lifecycle and packaging tests only use its name), and no test covers `client.js`
or `model.js`. The comments in `client.js` cite `scripts/test-kybernos-slash-parity.mjs` and
`docs/handoff/slash-actions/REFERENCE.md`; neither exists in this repository. Syntax check only for the client:
`node --check packages/kybernos-slash/client.js`.

## Known limits

- Nothing checks that the embedded model copy still equals `model.js`.
- No lock between processes: the route's read-merge-replace is synchronous inside one process, but a write by another process (the creator skill's file fallback when the route is absent) can be overwritten by it.
- An array that holds entries without an id keeps them on disk until the next upsert, which drops them (`mergeEntries` only keeps entries that have an id).
- Labels can be `{fr, en, ar}`, but the client only picks `fr` or `en` (from `navigator.language`); `ar` is never shown.
- Many strings in the editor and the settings page are hard-coded French or English.
