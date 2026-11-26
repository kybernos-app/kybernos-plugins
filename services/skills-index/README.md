# skills-index: the read-only relay of the skills.sh index

The **Discover** tab of the Skills screen shows the public skills.sh ranking, search, curated set and security audits. skills.sh
authenticates its API with the OIDC token of a Vercel project, which only a Vercel deployment receives (and renews) by itself.
Until now every user needed such a token on their machine, valid about 12 hours: for anyone but the developer, Discover was empty.
This relay is the one place that holds it. DSH calls the relay, the relay calls skills.sh, and users need no token and no Vercel CLI.

It deploys to the Vercel project `kybernos-skills-index`. No database, no secret in the repo: the token comes from
`@vercel/oidc` at request time.

## Routes (GET and HEAD only)

| Route | Query (all optional, nothing else is accepted) | CDN cache |
| --- | --- | --- |
| `/v1/skills` | `view` = `all-time` \| `trending` \| `hot`, `page` 0-100000, `per_page` 1-500 | 1 h |
| `/v1/skills/search` | `q` 2-100 characters, `limit` 1-100 | 5 min |
| `/v1/skills/curated` | none | 1 h |
| `/v1/skills/audit/{owner}/{repo}/{skill}` | none | 1 h |
| `/v1/covers/{id}.webp` | none | 1 h in the browser, 1 day at the CDN |

The answers are skills.sh's own JSON, unchanged: the plugin parses them as before. A good answer is cacheable; every refusal and
failure is `no-store`, and upstream's error text is never relayed (our token or quota being refused is reported as
"index unavailable", 502 or 503).

## Covers

The Featured tab of the Skills screen shows one picture per pick. They are not skills.sh data and not in the repository (media is not
committed): `covers/<id>.webp` ships **with the deployment**, put there by `node scripts/prepare-covers.mjs` from the folder the pictures were
made in (`~/.dsh/kybernos/skills-featured`). `api/cover.js` reads them (`vercel.json` `includeFiles: covers/**`), `relay-core.mjs` `cover`
holds the rules: the id is the skill-name pattern and nothing else, `GET`/`HEAD` only, 600 KB at most, a missing file is a 404 that is never cached.

The plugin fetches a picture **once**, when its folder has none, and keeps it only if its bytes hash to the SHA-256 the pick ships
(`featured-picks.json` `coverSha256`): so the relay is a convenience, not a trust: another relay, or a damaged answer, leaves the tile.
Changing a picture means a new file, a new hash in the picks file and a plugin release.

## Limits to keep in mind

- skills.sh allows **600 requests a minute per Vercel team and project**, shared by every Kybernos user. Browsing is cached an
  hour, so each page costs skills.sh at most one request an hour (per CDN region) however many users there are: that is the
  "refresh every hour" of the index, with no database and no job. **Search is the one open door**: every different word is a
  new request. Five minutes of cache helps for popular words only, so the project's Vercel Firewall carries two rate-limit
  rules, per IP and per minute (published 2026-10-06, `vercel firewall overview`): `search-per-ip` (30 on `/v1/skills/search`)
  and `relay-per-ip` (240 on `/v1/`). Measured: 29 searches pass, the next ones are refused, and the block lifts after a minute.
  If abuse shows up, the fallback is to search only inside a local file of the most installed skills.
- The address is **`https://skills.kybernos.app/v1`** (a domain of the team, attached to this project; `kybernos-skills-index.vercel.app`
  keeps answering, because suites up to 1.0.0-beta.4 use it). The plugin's default is the first one, so the relay can move without
  an update.
- skills.sh documents the token for apps hosted on Vercel and publishes cache lifetimes, but says nothing about redistributing
  its data. This relay serves a short-lived cache of the answers users ask for; it does not copy the index.

## Code and tests

- `relay-core.mjs`: pure (route table, validation, cache policy); the network and the token are injected.
- `api/relay.js`: the Vercel function that wires the real `fetch` and `getVercelOidcToken()`. `vercel.json` rewrites `/v1/*` to it.
- `api/cover.js`: the second function (covers). `node scripts/test-skills-relay.mjs`: 20 checks, no network; `node scripts/test-covers-relay.mjs`: relay and
  plugin over a loopback socket.

## Deploying

From this folder, linked to the `kybernos-skills-index` project (`vercel link`): first `node scripts/prepare-covers.mjs` (from the repository
root: it fills `covers/` and checks one picture per pick), then `vercel deploy --prod`. Publishing makes a
public endpoint, so it is done on purpose, not by CI. After a deploy, check the four index routes and one cover (`curl -sI https://skills.kybernos.app/v1/covers/pdf.webp`: 200, `image/webp`) from
outside the project, and that production is not behind Vercel Authentication.
