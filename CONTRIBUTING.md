# Contributing

1. Read [`AGENTS.md`](AGENTS.md) first: it holds the working rules (no new engine patches, a bundle must never stop DSH from starting, no media or personal paths in git,
   new code, comments and docs in English).
2. Work on a branch cut from `dev`, and run the gate before you ask for a merge: `node scripts/garde-depot.mjs && node scripts/test-lifecycle-engine.mjs && node scripts/test-paquet.mjs`,
   then `node scripts/run-all-tests.mjs` (it must end with 0 red).
3. A new plugin follows [`docs/dev/plugin-contract.md`](docs/dev/plugin-contract.md) and needs an executable test.
4. By sending a contribution you license it under Apache-2.0, the licence of this repository (section 5 of the licence), and you sign off each commit with `git commit -s` (the Developer Certificate of Origin, <https://developercertificate.org>). There is no CLA. Sign-offs are checked in review for now.
5. A vulnerability is not a contribution or an issue: see [`SECURITY.md`](SECURITY.md). A request for help is not an issue either: see [`SUPPORT.md`](SUPPORT.md).
6. The "Kybernos" name is covered by [`TRADEMARK.md`](TRADEMARK.md).
