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

The answers are skills.sh's own JSON, unchanged: the plugin parses them as before. A good answer is cacheable; every refusal and
failure is `no-store`, and upstream's error text is never relayed (our token or quota being refused is reported as
"index unavailable", 502 or 503).

## Limits to keep in mind

- skills.sh allows **600 requests a minute per Vercel team and project**, shared by every Kybernos user. Browsing is cached an
  hour, so each page costs skills.sh at most one request an hour (per CDN region) however many users there are: that is the
  "refresh every hour" of the index, with no database and no job. **Search is the one open door**: every different word is a
  new request. Five minutes of cache helps for popular words only, so the Vercel Firewall should carry a rate-limit rule on this
  project. If abuse shows up, the fallback is to search only inside a local file of the most installed skills.
- skills.sh documents the token for apps hosted on Vercel and publishes cache lifetimes, but says nothing about redistributing
  its data. This relay serves a short-lived cache of the answers users ask for; it does not copy the index.

## Code and tests

- `relay-core.mjs`: pure (route table, validation, cache policy); the network and the token are injected.
- `api/relay.js`: the Vercel function that wires the real `fetch` and `getVercelOidcToken()`. `vercel.json` rewrites `/v1/*` to it.
- `node scripts/test-skills-relay.mjs`: 15 checks, mutation-tested, no network.

## Deploying

From this folder, linked to the `kybernos-skills-index` project (`vercel link`): `vercel deploy --prod`. Publishing makes a
public endpoint, so it is done on purpose, not by CI. After a deploy, check the four routes from outside the project and that
production is not behind Vercel Authentication.
