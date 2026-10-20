# `@local/kybernos-modeles-locaux` — Ollama local models

Settings › **Ollama local models**: measure the machine, recommend the models that fit its memory, install one with Ollama
and wire it into DSH so it can be used in the model picker. Nothing is downloaded without a click.

## The path, wired for real

1. **Detect** — `GET /modeles-locaux/machine` (host): chip and RAM (`sysctl`), Ollama (`ollama --version`), pulled models
   (`ollama list`). Cached 30 s, `?force=1` to force it.
   If the probe fails (the helper does not answer, or the memory size is unreadable) the page says so in a banner with a
   Retry and gives **no verdict**: every model reads « Memory not measured » (grey), Install stays available, nothing is
   « Recommended ». It used to label every model « Too heavy » and disable Install.
2. **Recommend** — the catalogue (below) filtered by the measured RAM; the recommendation is the largest model that fits.
3. **Install** — `POST /modeles-locaux/installer`: one job at a time, `brew install ollama` (macOS, explicit) then
   `ollama pull <id>`; progress read from the process output; `POST /modeles-locaux/annuler` (SIGTERM). The id is held to
   a safe charset and `..` is refused. A failed install is told **on the row that was pressed**, in plain words (« Install
   failed: Ollama has no model under this name »; the CLI line is the tooltip) with a Retry in place of Install; only the
   engine's own install and a Hugging Face reference, which have no row, use the banner at the top.
4. **Wire** — `remote.settings.mutate('llm-pi-ai', …)` (the channel of DSH's own Models page): declares
   `providers['ollama-local']` (`api: openai-completions`, `baseURL: http://127.0.0.1:11434/v1`) and its models (context
   window 32768, editable; `input` from the catalogue). Removed per model; the route goes when the list is empty. If the
   model is not in the picker, DSH has to be restarted (the panel says so).

## The catalogue, and what « Search for new models » does

The button runs three real calls, in this order, and the page names the one that is running:

1. `POST /modeles-locaux/decouvrir` — asks the Ollama server (`/api/tags`) what it holds and diffs it against the last look.
2. `GET /modeles-locaux/machine?force=1` — measures the machine again.
3. `POST /modeles-locaux/catalogue { op: 'refresh' }` — asks the online catalogue of recommended models.

The list the page shows comes from one of three places, and says which, always (« List: … · date »):

| Source | When |
| --- | --- |
| signed catalogue | the last refresh verified an online catalogue at least as recent as the shipped one |
| shipped with this version | `catalogue.json`, part of the bundle: works with no network and no key |
| built into the page | last resort when the host does not know the route yet (DSH not restarted) |

The online catalogue is `local-models.catalog.json` + `local-models.catalog.json.sig` on `main` (`modeles-catalogue.mjs`
`DEFAULT_URL`; the setting `modelesCatalogueUrl` of `<DSH home>/kybernos/settings.json` overrides it, `''` turns it off). It is
the same chain of trust as the theme gallery: an Ed25519 signature over the exact bytes, checked against `models-pubkey.json`
before anything is parsed; an unsigned, wrongly signed, malformed or **older** document (a rollback) is refused and the list
stays as it was. What is cached is the verified bytes, verified again on every read. An entry's id ends up in `ollama pull`,
so it must have the library's own shape (`name:tag`: no path, no flag, no namespace).

`models-pubkey.json` holds no key until the maintainer generates one (`keygen --embed`): until then the online catalogue is
never asked and the page says so (« Online search is not active yet »).

### Publishing a new model (maintainer)

```bash
node scripts/modeles-locaux-catalogue.mjs draft            # what the Ollama library has that the catalogue does not (estimates)
# write catalog/local-models/<name>_<tag>.json for the ones worth recommending (size and RAM floor MEASURED, desc fr + en)
node scripts/modeles-locaux-catalogue.mjs build --bump     # sources -> packages/kybernos-modeles-locaux/catalogue.json
node scripts/modeles-locaux-catalogue.mjs sign --key <private-key-file>   # -> catalog/local-models.catalog.json(.sig)
node scripts/modeles-locaux-catalogue.mjs verify catalog/local-models.catalog.json catalog/local-models.catalog.json.sig
```

Commit the two signed files: installs pick them up from `main` at their next refresh, with no release. `draft` writes
nothing: a person decides what is recommended (a naive « newest first » would recommend niche models).

## What the bundle never writes

No configuration file on the host: `cordis.patch.yml` only inserts the plugin into the stack (without it the bundle is
skipped at boot); settings writes all go through the harness's validated settings channel. The only thing it caches is the
verified catalogue, under `<DSH home>/kybernos/modeles-locaux-catalogue/`.

## Checks

```bash
node packages/kybernos-modeles-locaux/test-modeles-catalogue.mjs   # rules of belief, refresh against a local server, the route
node packages/kybernos-modeles-locaux/test-machine.mjs
node packages/kybernos-modeles-locaux/test-seam.mjs
node packages/kybernos-modeles-locaux/test-fit.mjs                 # no verdict on an unmeasured machine; why a pull failed, in words
source scripts/sandbox/env.sh && node scripts/check-ollama-search-live.mjs   # the real page: the three steps, the answer, where the list comes from
```

## Seam for the first-run wizard

`window.__KB_LOCAL__ = { recommend(ramGo), connect(id) }` (published by `apply`, removed on dispose). `recommend` returns
`{id, tailleGo, ramMin}` (the same choice as the « Recommended » badge, `kbRecommend`, on the list the page currently holds) or
`null`. `connect(id)` wires an already pulled model with the same profile as the « Wire » button (`kbBuildProfile`) and the same
channel (`settings.mutate`); `{ok:true}` or `{ok:false, reason}` (`unknown_model`, `unavailable`, `readonly`,
`write_refused`, `refused`). The install itself stays the host's job (`/modeles-locaux/installer`).
