# Agent brief: playing the `agent` cases of the user-journey plan

You play a small group of cases of `docs/tests/user-journey/cases.json` (each has an `id`, a `how`, an environment). You report what you saw. The lead decides what is a bug and fixes it.

## Rules

1. **You do not fix the product.** You may add NEW files under `scripts/` (a reusable check named `check-<topic>-live.mjs` or `audit-<topic>-live.mjs`, in English, no personal path, exit 0 = pass, 1 = fail, 3 = wrong environment) and nothing else in git. Do not edit, move or delete an existing file of the repository, do not commit, do not touch another agent's file. Evidence (pictures, logs, JSON) goes to your evidence folder, outside git.
2. **Made-up data only.** Accounts are made on a replica with `makeServer()` of `scripts/lib-e2e-server.mjs` (read its header). Never type a real address, password, key or card. **Never type a card number on a Stripe page**; money paths use the replica's stand-in (`POST /__/stripe/pay|refund|dispute|redeliver|subscription` on the control port, see `scripts/check-stripe-replica-money.mjs`). Never print a secret, token or cookie.
3. **Nothing outward.** Read the public site and the public server pages only (GET, no form submitted to a production address). No publish, no purchase, no e-mail to a real person. A step that needs one is `blocked` with the reason.
4. **Ports.** Never open or touch 3080, 8791, 8792 (the owner's own DSH and replica). Do not stop or restart sandboxes or the harness replica unless your brief says so.
5. **Your own replica.** When your cases need a server, start your own disposable one on the ports you are given, from the server checkout the lead gives (`KB_SERVER_DIR`):
   `eval "$(bash scripts/user-journey-replica.sh up <port> <your evidence folder>/replica)"` then use `KB_E2E_API`, `KB_E2E_CONTROL` etc.; stop it with `bash scripts/user-journey-replica.sh down <port> <folder>/replica` when you are done. Its mailbox is `GET $KB_E2E_CONTROL/__/mail?to=<address>`. The replica rate-limits sign-ins per client address: send a different `x-test-ip` per run (the helper does it for you).
6. **The real GUI** is seen through headless Chrome signed in with the session cookie: `scripts/live-page.mjs` (`openLivePage({ host })`, `live.page.evalJs(...)`, screenshots), see `docs/dev/live-testing.md`. A picture is evidence, not a verdict: for every screen you say something about, **measure** it (`getBoundingClientRect`, `getComputedStyle`) and quote the exact text on screen. Do not use the shared browser pane of the lead.
7. **Honest verdicts.** One honest run per case. `pass` needs at least one step with a measured or quoted observation. If a step fails, say which step and what was on screen. If you could not do the case (needs a real device, a real card, a deployed server, a model you do not have), it is `blocked` with the reason, never a guess. Do not retry until it passes; if you suspect your own harness (a stale session, a port), say so and re-run once, and say you did.
8. **Short.** Do not paste logs. Your final message is the JSON below, one object per case, then at most ten lines of remarks. Evidence paths are absolute.

## Verdict (one per case)

```json
{
  "case": "J05-13",
  "verdict": "pass | fail | blocked",
  "env": "replica 8861, headless Chrome",
  "steps": [ { "did": "pressed Revoke on the first device", "saw": "row removed, toast 'Device revoked'", "ok": true } ],
  "findings": [ { "where": "/account > Security", "what": "button 'Disable' does nothing", "measured": "rect 96x32 at (812, 420); no request sent", "artefact": "/abs/path.png" } ],
  "wrote": ["scripts/check-account-tabs-live.mjs"]
}
```

`findings` lists only what you observed and what decides the case or is a plain defect on the screen (cut text, `undefined`, a dead button, a raw technical error, a wrong word, an untranslated string). No opinions and no fixes. A case whose brief says « check that nothing promises X » passes when you searched the shipped screens and strings for the promise and found none: say where you searched.

## Where things are

- Cases: `node -e` over `docs/tests/user-journey/cases.json` (`cases[]`, `journeys{}`); journeys story in `journeys.md`; known gaps in `known-gaps.md`; findings so far in `ledger.md` (do not report a finding already there, name its UJ number instead).
- The DSH GUI plugins: `packages/kybernos-*/client.js` (served live); server pages: `$KB_SERVER_DIR/src/modules/**` (read only).
- Scripts you can reuse: `scripts/check-*-live.mjs` (they take `KB_HOST`), `scripts/lib-e2e-gui.mjs`, `scripts/lib-e2e-server.mjs`, `scripts/look-matrix-live.mjs`.
