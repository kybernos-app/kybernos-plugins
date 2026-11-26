# Sharing a chat Journal as a link

Decided with the owner on 2026-11-02 (« Oui, le lien »). The Journal of a chat already goes out as **one `.html` file** (Share sheet, `journal-page.mjs`). A link is the same document on the
Kybernos server, drawn by one fixed page, so that the reader needs nothing but the address. It reuses the server half of the shared dashboards (kybernos-server `docs/contract/snapshots.md`,
ADR 0007 § 8c: `/v1/snapshots`, `GET /s/<id>`, `GET /s/<id>.json`, quotas, take-down) and adds a second kind of document next to the dashboard snapshot.

## What is shared

The **Journal document** (`kind: "kybernos-journal"`, `version: 1`), exactly what the file page carries: built by `journalDocument()` from a whitelist, so a field that is not named there never
leaves the computer. The same switches decide what is in it (decisions, durations, deliverables on by default; the text of prompts, names, computers, the chat number off by default;
« verifiable » forces names, computers and the chat number on because the seals cover them). Never in it: tool inputs and outputs, local file paths, engine prompts. A photograph of the
day it was made: it does not follow the chat; refreshing it = publishing again to the same link.

Moments are cut to the last 400, deliverables to 60, connectors to 40, crews to 30, logos to 40 (`data:image/svg+xml;base64,…`, 30 000 characters of SVG each at most). A document over the
server's `max_bytes` (1 000 000 by default) is refused by the plugin before sending: it says so and offers the file.

## Protected links (password)

Optional, and **on by default**. The document is sealed in the plugin with the code of the shared dashboards (`kybernos-db/share/seal.mjs`, vendored as
`packages/kybernos-plugin/vendored-share-seal.mjs`, kept equal by `scripts/vendor-share.mjs`): PBKDF2-SHA256 (600 000 rounds) → AES-256-GCM. The server only ever holds the envelope
`{ kind: "kybernos-snapshot", version: 1, sealed: true, kdf, cipher, data }` (the envelope's `kind` stays `kybernos-snapshot`, it is the same envelope as a dashboard's) and the page asks
the reader for the password and opens it in their browser. The plugin makes the password (100 bits, shown once in the sheet) and keeps it only in its local record so that an update keeps
the link AND the password the readers were given. With a sealed link the seals of the decisions are still checked in the reader's browser, after it opens.

## The page

`packages/kybernos-plugin/journal-viewer.js` + `journal-viewer.css`, assembled by `journal-page.mjs` (`journalViewerHtml()`): one script, one style sheet, an empty root, the lock-screen words
in both languages as inert JSON. The same bytes for every link. Content policy: `default-src 'none'; script-src 'sha256-…'; style-src 'sha256-…'; img-src data:; connect-src 'self'; base-uri
'none'; form-action 'none'` (the server adds `frame-ancestors 'none'`). It loads `<its own address>.json`, asks for the password when that is an envelope, and draws the document as text
nodes and SVG shapes, never as HTML. The story is read a page at a time (10, 25, 50 or 100 moments, 25 to begin with, the reader's choice for as long as the page is open; every moment when
printing; no pager for 10 moments or fewer), drawn in the browser from the same document: the pinned copy of the viewer on the server (`viewer:sync`) is what a link serves, so a viewer change
reaches the links already made only with the next server deploy. Build for the server:

```bash
node scripts/journal-viewer-build.mjs --out <folder>     # viewer.html (same bytes every run) + policy.txt (the policy to send as a header)
KB_NODE_MODULES=<node_modules with playwright-core> node scripts/check-journal-link-page.mjs    # real Chrome: open link, lock screen, wrong/right password, gone link, French, phone, dark, policy
```

## What the server has to add (its own session, on top of the shared-dashboards work)

The request and the neutral answers stay as in `snapshots.md`; the differences are only these.

1. **A kind of document on each link.** `POST /v1/snapshots` and `PUT /v1/snapshots/{id}` take one more optional field, `doc`: `"dashboard"` (the default, today's behaviour) or `"journal"`.
   It is stored with the link. A `PUT` without `doc` keeps the link's kind; a `PUT` with another kind than the link's is `400 invalid_request` (a link never changes what it is). The listing
   (`GET /v1/snapshots`) returns `doc` for each link.
2. **Validation of a plain Journal** (`sealed: false`, `doc: "journal"`): valid JSON, well-formed Unicode, an object with `kind: "kybernos-journal"`, `version: 1`, `moments` an array of at most
   400 objects, `crews` ≤ 30, `connectors` ≤ 40, `deliverables` ≤ 60, `logos` an object of at most 40 entries whose values are strings starting `data:image/svg+xml;base64,` and at most 45 000
   characters; every other field is the plugin's. `sealed: true` with `doc: "journal"` is validated as any envelope (the server cannot look inside). A document whose `kind` does not match
   `doc` is `400 invalid_snapshot`; as before the message says what is wrong and never echoes the text.
3. **The page follows the link's kind.** `GET /s/<id>` serves the dashboard page for `dashboard` and the Journal page for `journal`: two pinned files, the Journal's built by
   `scripts/journal-viewer-build.mjs` in the plugins repository (`viewer:sync` / `viewer:check` extended to copy and compare both, digests pinned in the test with the reason in the ADR). Same
   headers as the dashboard page, the policy of the Journal build (its `img-src data:` is the only difference). `GET /s/<id>.json` is unchanged.
4. **One quota for both kinds** (count, bytes, life, plan gate): a person's 20 links are 20 links, whatever they show. Take-down, sweep, account export (add the kind to each row) and deletion
   apply to both.

## The plugin's side (this repository)

| piece | what |
|---|---|
| `packages/kybernos-cloud/index.js` | the `snapshots` seam (`globalThis[Symbol.for('kybernos.snapshots')]`): `status()`, `put({ id?, sealed, text, doc })`, `remove(id)` over `/v1/snapshots`, with the account's token added there; the token never leaves that file |
| `packages/kybernos-plugin/journal-link.mjs` | the verbs `state`, `publish` (create or update), `remove`; the local record `<DSH home>/kybernos/journal-links/index.json` (mode 600: link, end date, and the password so that an update keeps it) |
| `/kybernos/journal/link` (GET state, POST publish, POST remove) | same-origin guard, write guard, like `/kybernos/journal/page` |
| Share sheet (`client.js`) | « Link » part under the file button: create, copy, update, delete; the password shown with the link; nothing when the server has no `/v1/snapshots` (the sheet says so) |

Not here: the server work above; the dashboards (`kybernos-db`) still do not read the seam (a one-line change once the server is deployed); the domain of the link (`SNAPSHOT_LINK_BASE`) is the
server owner's.

## Checking it against a real server

`node scripts/check-journal-link-e2e.mjs` (11 checks, not part of `run-all-tests`: it needs a server and a Chrome) drives the real `journal-link.mjs` and the cloud bundle's seam against a running
kybernos-server: make a link, open the protected page in headless Chrome with a wrong then the right password, update (same link, same password), delete, the neutral 404, `gone`. Seen green on
2026-11-02 against the server branch `claude/journal-link-server-6e8795` (17138513) on a throw-away database.

The server's own test helpers can serve its real app on a port. Put this file in the server's `test/` folder as `zz-e2e-runner.test.ts` (do not commit it), then in two terminals:

```
E2E_INFO=/tmp/e2e-info.json pnpm vitest run test/zz-e2e-runner.test.ts          # in the server folder; waits for /tmp/e2e-info.json.done
KB_NODE_MODULES=<a node_modules with playwright-core> node scripts/check-journal-link-e2e.mjs --info /tmp/e2e-info.json   # here; then: touch /tmp/e2e-info.json.done
```

```ts
// TEMPORARY, never committed to the server: serves this branch's real app over HTTP on a throw-away database so that the plugins repository's scripts/check-journal-link-e2e.mjs can run against it.
import { existsSync, writeFileSync } from "node:fs"
import { createServer as netServer, type AddressInfo } from "node:net"
import { serve } from "@hono/node-server"
import { afterAll, beforeAll, expect, it } from "vitest"
import { createHarness, type Harness } from "./helpers/app.ts"
import { createTestDb, type TestDb } from "./helpers/db.ts"

const INFO = process.env.E2E_INFO ?? ""
let db: TestDb
let h: Harness
let port = 0

beforeAll(async () => {
  const probe = netServer()
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r))
  port = (probe.address() as AddressInfo).port
  await new Promise<void>((r) => probe.close(() => r()))
  db = await createTestDb()
  h = createHarness(db, { SNAPSHOT_LINK_BASE: `http://127.0.0.1:${port}` })
})
afterAll(async () => {
  await db.drop()
})

it("serves the plugin's end-to-end check", async () => {
  const user = await h.signUp("e2e@example.test", "E2E Tester")
  const { token } = await h.pairDevice(user, "E2E Mac")
  const server = serve({ fetch: h.app.fetch, port, hostname: "127.0.0.1" })
  await new Promise<void>((r) => server.on("listening", () => r()))
  writeFileSync(INFO, JSON.stringify({ base: `http://127.0.0.1:${port}`, token }))
  for (let i = 0; i < 2400 && !existsSync(`${INFO}.done`); i += 1) await new Promise((r) => setTimeout(r, 100))
  server.close()
  expect(existsSync(`${INFO}.done`)).toBe(true)
}, 300000)
```
