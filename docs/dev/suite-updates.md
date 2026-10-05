# Suite updates: a signed catalogue and a whole-suite update

The Suite panel can ask an online catalogue whether a newer suite exists, show what changed per module, and install it. Three decisions
shape it: the unit of update is the **whole suite** (the lifecycle robot already installs a complete, hash-verified archive with a safety
snapshot, a boot check and a rollback; there is no second, riskier install path), the catalogue and archives are **GitHub Releases** of
the open-core repo (a normal release, not a pre-release: `releases/latest/download/` skips pre-releases), and the catalogue is **signed with Ed25519**, the private key kept off the repo by the maintainer.

## The trust chain

```
public key in the bundle (catalog-pubkey.json) ── verifies ──▶ catalog.release.json.sig
catalog.release.json (signed bytes) ── names ──▶ the archive: SHA-256 and size
the archive's own manifest.json ── lists ──▶ every file's hash, checked by the lifecycle robot inside it
```

A release is refused when it is unsigned, signed by a key nobody trusts, malformed, or **older than the suite already installed** (a replayed
old release is a rollback). Nothing is parsed before the signature verifies. No trusted key installed means the network is never asked.
`packages/kybernos-hub/catalogue-distant.mjs` is the pure logic; `telechargement.mjs` the bounded downloads (https only, size caps, the
archive streamed to a temp file while hashed, a tar listing that may not leave its folder); `suite-host.mjs` the refresh and the update.

The pure half of the publishing CLI (`catalogue-publication.mjs`: key pair, release document, signature) lives in the bundle, so the tests that play it ship with it.

## Publishing a release (the maintainer)

```bash
node scripts/catalog-release.mjs keygen --out ~/keys/kybernos-catalog.key --embed   # once: the private key stays OUTSIDE the repo
node scripts/paquet.mjs --construire --plateforme mac                               # the archive(s); repeat for linux and windows
node scripts/catalog-release.mjs build --key ~/keys/kybernos-catalog.key --out dist/release \
  --archive mac=dist/kybernos-1.1.0-mac.tar.gz=https://github.com/<org>/<repo>/releases/download/v1.1.0/kybernos-1.1.0-mac.tar.gz
```

Upload `catalog.release.json`, `catalog.release.json.sig` and the archives to one GitHub release. `build` replays the panel's own check with the
embedded key and refuses to call a release good when the key would not accept it. `--notes <file.json>` (`{ "<module id>": [{ "fr", "en" }] }`)
adds per-module release notes, shown as "What's new" on the module's page; there is no changelog tab until there are real notes.

`keygen` refuses to overwrite a key and refuses a path inside this repo. Commit `packages/kybernos-hub/catalog-pubkey.json` (public) and nothing else.
Rotation: the file holds a list of keys; any of them verifies.

## What the user sees

*Check for updates* asks `catalogueUrl` (the setting of `~/.dsh/kybernos/settings.json`; default `releases/latest/download/catalog.release.json`; an
empty string turns it off), verifies, caches the verified bytes (re-verified on every use) and says what it found. A newer suite shows a banner
(*Update the suite*, then one more confirmation naming what protects the install), the Updates tab, per-module notes, and the source line
"Signed catalogue · suite X". The update runs on the host (download, SHA-256 and size against the signed document, extraction, then the robot **inside**
the archive: the same contract as `./kybernos-update`), the panel polls `GET /kybernos-hub/update/status`, and the end is the existing "restart DSH" banner.
DSH is not restarted by the update itself.

**A development checkout is never updated this way**: a git working tree (`.git` at the repo root) answers 409 `development-checkout` and the panel says to use git.

## The notification

Nothing is installed without the user, but the user must hear about it. The Maintenance bundle (`packages/kybernos-maintenance`) owns the
notification: a check about 15 s after launch, then every 6 h and on returning to the tab; a discreet card once per version and session ("Later"
postpones it 24 h, "Skip this version" silences it); the account menu keeps an "Update available" line until it is applied.

The **signed release decides**: each check also asks the Suite's `POST /kybernos-hub/catalogue/refresh`, and a suite newer than the installed one is announced
as the Kybernos update (`fusionnerSigne`). When this install can apply it (not a git checkout) the dialog offers **Update now**, which starts
`POST /kybernos-hub/update`, follows `/update/status` and ends on "Restart DSH to finish". A development checkout keeps the git steps. When there is no
key, no release or nothing newer, the host's own answer stands (the `VERSION` published on `main`).

A bug hid all of this until 2026-10-05: `GET /kybernos-maintenance/update` answered 500 on every machine (`existsSync` was not imported), so no update
was ever announced. `test-update.mjs` now runs the route's measure for real. **Installs of 1.0.0-beta.2 carry that bug**: they only learn of a newer suite
through *Check for updates* in the Suite panel, once; the first release that carries the fix announces the next ones by itself.

How it was checked on the real GUI, with nothing of the user's touched: a throwaway DSH home (APFS clone of the profile, bundles linked to an extracted
archive, `DSH_HOME` and `HOME` isolated, own port) running the suite from the archive, the signed release served by a local https server (self-signed
certificate, `NODE_EXTRA_CA_CERTS` for that process only, `catalogueUrl` pointing at it), and the update archive built with the robot forced to dry-run so the
engine is never patched. The release is "published" by copying a newer signed document into the served folder; then: no card before, the card at the next
launch, the dialog, Update now, the steps, the end.

## Routes

| Route | |
|---|---|
| `POST /kybernos-hub/catalogue/refresh` | ask, verify, cache; 200 `{ etat: nouveau \| a-jour }`, 400 with the reason (`pas-de-cle`, `signature`, `plus-ancien`, `forme`, `url`…), 502 offline, 409 busy |
| `POST /kybernos-hub/update` `{ confirm: true }` | 202 and starts; 409 with the reason when it cannot (`development-checkout`, `no-release`, `up-to-date`, `no-archive-for-platform`, `busy`) |
| `GET /kybernos-hub/update/status` | `{ etat: idle \| telechargement \| extraction \| installation \| termine \| echec, version?, erreur?, detail? }` |
| `GET /kybernos-hub/suite` | now also `catalogue.source` (`signe` or `embarque`), `catalogue.suite` and `distant` (key, release, whether an update can be applied and why not) |

All POSTs are strict same-origin JSON. One operation at a time: while the update runs, a second update, a refresh and a module install answer 409.

## Not done

- The key pair exists (id `e69d1ec06bf2`, public half in `catalog-pubkey.json`); the first real release is `1.0.0-beta.2`. The update was exercised end to end
  with a real archive, a signed release and a local server in a throwaway DSH home, with the robot in `--dry`; see the release notes for what ran on a real install.
- Per-module DSH ranges (the verdict still comes from the suite-wide `dsh-compat.json`).

## Tests

`packages/kybernos-hub/test-catalogue-distant.mjs` (document shape, signature, rollback guard, the publishing CLI), `test-telechargement.mjs`
(local server, real tar), `test-suite-update.mjs` (refresh, cached verdict, status, the update, every route), `test-suite-store.mjs` (the words and the
wiring in the panel). On the real GUI, read-only, with the host routes faked: the check, a development checkout's reason, the confirmation, the steps, the
restart banner, a refused catalogue, the release notes.
