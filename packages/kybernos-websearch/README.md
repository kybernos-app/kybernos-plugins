# `@local/kybernos-websearch`

Web search for the agents, **with or without an API key**. DSH's own `web_search` tool only works with a DeepSeek key
or account (the base composition pins `searchProvider: deepseek-official`). This bundle registers its own search
provider with DSH's web seam (`ctx.web`) and keeps a list of engines behind it: free ones that work right away, keyed
ones that go first when you add a key, and a fallback so that one engine failing does not fail the search.

## What the user sees

Settings › **Web Search**:

- the **chain**: the engines that can answer right now, in the order they are tried (arrows to reorder, a switch each).
  A fresh install has Brave Search, Exa, DuckDuckGo (all "no key") and Wikipedia (off);
- **More engines**: the ones that still need a key or an address. Click one, paste the key (or the address), *Test*.
  It joins the chain at once;
- **Sites**: `example.com` keeps only that site, `!example.com` excludes it (the same syntax as OpenWebUI's domain filter);
- how long an answer is kept (5 minutes by default) and the timeout per engine;
- *Search the way an agent does*: one search through DSH's seam, which proves DSH really uses this list.

An engine that fails is **paused** for a time that fits the cause (a refused key one hour, a captcha ten minutes, a
rate limit five, a timeout one) and the next one answers. The row says why and until when. A search only fails when
every engine did, and then the model is told which ones and what to do, not what the page said.

## Engines

| Engine | Needs | Played against the live service on 2026-10-12 |
|---|---|---|
| Brave Search (`brave-web`) | nothing | page parsed (20 results). Answers HTTP 429 after a burst of requests: the chain moves on |
| Exa (`exa-free`) | nothing | yes, through DSH's seam (its public MCP endpoint, free quota) |
| DuckDuckGo (`duckduckgo`) | nothing | yes, HTML and Lite pages (10 results each). Answered a picture challenge to a bare `curl` the same day: it is "blocked" and paused when it does |
| Wikipedia (`wikipedia`) | nothing, off by default | yes. An encyclopedia, not the web: a last resort the person turns on |
| SearXNG (`searxng`) | the address of your instance | not played (no instance). Public instances were measured to refuse JSON or answer 429, so there is no default one |
| Custom address (`custom`) | an address, key optional | offline only. OpenWebUI's "external search" contract: `POST {query, count}`, `[{link, title, snippet}]` |
| Brave Search API, Tavily, Serper, Exa (API), Kagi, Google Programmable Search, Jina, Perplexity | a key (+ the engine id for Google) | **not played** (no keys): request and answer shapes are from each provider's public documentation and OpenWebUI's open source, and the offline tests assert both |
| DeepSeek native search (`deepseek`) | `DEEPSEEK_API_KEY` | not played. The engine's own default (one model turn per search), kept so a DeepSeek user loses nothing |

Looked at and **not shipped** because a script gets nothing usable from them: Bing's HTML page (returns unrelated
results to a client without a browser session), Mojeek's HTML page (a script challenge), Qwant (403), Yahoo
(redirects), Marginalia (unreachable from the test machine).

## How it works

| File | Role |
|---|---|
| `index.js` | host half: registers provider `kybernos-search` with `ctx.web`, mounts the routes, reads keys through DSH's credentials service |
| `host.mjs` | the service and the five routes (pure, I/O injected): state, settings, key, test, seam |
| `router.mjs` | the chain: order, pauses, per-engine spacing, answer cache, domain filter, abort |
| `engines.mjs` | one object per engine: the request it sends and what it makes of the answer |
| `parse.mjs` | HTML and text helpers: the result pages, entities, URL safety, de-duplication |
| `settings.mjs` | the settings document and its validation |
| `net.mjs` | the only file that touches the network (`fetch`, size cap, timeout) |
| `client.js` | browser half: the Settings page |
| `cordis.patch.yml` | inserts the bundle **and** points the web seam at it (see below) |

- **The pin.** DSH's seam picks exactly one provider, and the base composition pins `deepseek-official`. This bundle's
  patch sets `searchProvider: kybernos-search` on the `web` row (a config override in the bundle layer, no engine patch;
  `fetchProvider: http` is restated because a patch replaces the whole config). Switch the bundle off and the base
  pin comes back. The page shows a banner when DSH is pinned elsewhere or the provider is not registered.
- **Keys** go to DSH's credentials store (the same one the Models page writes) under the conventional names
  `BRAVE_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `EXA_API_KEY`, `KAGI_API_KEY`, `GOOGLE_PSE_API_KEY`,
  `JINA_API_KEY`, `PERPLEXITY_API_KEY`, `DEEPSEEK_API_KEY`, `KYBERNOS_WEBSEARCH_CUSTOM_KEY`. A key you already exported
  in the shell or in `~/.dsh/.env` is found without being entered again. The page is told *whether* a key is there,
  never what it is; the key route only accepts these names.
- **Settings** live in `<DSH_HOME>/kybernos/websearch/settings.json` (no secret in it).
- **Privacy.** A query goes from this machine straight to the engine that answers, nothing goes through Kybernos. Each
  engine you leave on sees the queries it is asked.

## What it takes from OpenWebUI, and what it does differently

OpenWebUI has one setting, *the* search engine, with about thirty providers behind it (one function each, all
normalised to link/title/snippet), a result count, a concurrency cap and a domain filter list. Its keyless options are
DuckDuckGo (through the `ddgs` library) and self-hosted SearXNG / YaCy.

Taken: the keyed engines' request shapes, the domain filter syntax, the "external search" contract (as *Custom
address*). Different: instead of one engine there is a **chain with pauses**, because the free engines are the
unreliable ones and a person who asked an agent a question should not see "search failed" when the next engine would
have answered. Not taken: page loading and embedding (DSH's `web_fetch` reads pages; nothing here indexes them).

## Limits

- The free HTML engines are best effort. They read public result pages meant for people and may challenge a script
  or slow it down; a keyed engine or your own SearXNG is the reliable route.
- If the provider cannot register (a DSH whose seam changed), the pin still points at it and `web_search` fails with
  `WEB_PROVIDER_CONFIGURED_MISSING` until the bundle is switched off. The page says so in a banner.
- The "How it works" button on the page appears once the module is in the Suite's signed catalogue (the hub serves the
  last signed release).
- Results are untrusted text: the tool wraps them for the model; this bundle additionally strips markup and control
  characters, bounds titles and snippets, and drops any URL that is not plain http(s) without credentials.

## Tests

```
cd packages/kybernos-websearch && for t in test*.mjs; do node "$t" || exit 1; done   # offline, ~1 s
source scripts/sandbox/env.sh && node scripts/check-websearch-live.mjs                # a real GUI, the sandbox only
```
