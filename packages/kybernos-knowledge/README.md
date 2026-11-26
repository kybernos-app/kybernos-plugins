# @local/kybernos-knowledge

Local-first document knowledge base and auto-maintained Markdown wiki for DSH.

## Capabilities

- **Zero-dependency extraction**: parses `.md`, `.markdown`, `.txt`, `.csv`, `.docx`, and `.pdf` files using Node built-ins only (`node:fs`, `node:zlib`, `node:crypto`).
- **Incremental local index**: skips unchanged files via `(mtime, size)` and SHA-256 checks, prunes deleted files, and skips symlinks, hidden folders, and secret files (`.env*`, `*.key`, `*.pem`, `.credentials*`).
- **BM25 lexical search**: accent- and case-insensitive search with title, section heading, and phrase boosting; masks secret-looking tokens in snippets and returns exact citations (`[Collection] path#section (locator)`).
- **Auto-maintained Markdown wiki**: writes `<DSH_HOME>/kybernos/knowledge/wiki/<collection>/index.md` and per-document outline pages under `pages/`.
- **Agent & Front Desk exposure**:
  - Registers `knowledge_search` and `knowledge_list` on DSH's `tools` service.
  - Injects a concise Kaby `systemPrompt.context` brief only when at least one collection is indexed.
  - Publishes `globalThis[Symbol.for('kybernos.knowledge')]` and `GET /kybernos-knowledge/front-desk/facts` so `kybernos-front-desk` can pull unvalidated candidate facts for owner review in the Atelier.

## Routes

All routes live under `/kybernos-knowledge/` behind the loopback/trusted Host fence and Origin checks; every `POST` requires DSH's signed session cookie (`session-guard.mjs`) and a 32 KiB body cap:

- `GET  /kybernos-knowledge/collections`
- `GET  /kybernos-knowledge/documents?collection=<id>`
- `GET  /kybernos-knowledge/search?q=<query>&collection=<id>&frontDeskOnly=1&limit=6`
- `GET  /kybernos-knowledge/front-desk/facts?collection=<id>&q=<query>&limit=15`
- `POST /kybernos-knowledge/collections/add`
- `POST /kybernos-knowledge/collections/reindex`
- `POST /kybernos-knowledge/collections/update`
- `POST /kybernos-knowledge/collections/remove`

## Tests

```bash
node packages/kybernos-knowledge/test-knowledge.mjs
node packages/kybernos-knowledge/test-write-guard.mjs
```
