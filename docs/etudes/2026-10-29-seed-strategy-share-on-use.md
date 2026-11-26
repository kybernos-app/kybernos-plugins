# Seed by sharing: every artifact is an invitation

Status: **strategy proposal, 2026-10-29**. Scope: the acquisition loop for the first thousand
users. It adds no engine patch: it repairs the referral plumbing that is already there, puts a
signature and a reference on what the product already produces, and measures the loop server-side.

## 1. The question, and the one-line answer

How does a new user share something while using the product?

**Do not add a share button to the product. Make every object the product produces leave with a
link and a signature.** The unit of seeding is the artifact — a published site, a shared
deliverable, a deck, a video — not the sign-up page. A share button asks the user for a favour; an
artifact link delivers the user's own goal (bookings, approval, a client's yes) and carries the
product along.

## 2. Why the artifact and not the referral card

The referral card pays money to promote a brand. An artifact link pays the user's own outcome and
mentions the brand in passing. Money-limited programs plateau in single-digit percentages and
attract deal-hunters; artifact links compound, because the recipient is a peer with the same
problem, in the same field, at the same moment.

| Loop | Who shares | Why the recipient clicks | Marginal cost per install |
|---|---|---|---|
| Artifact link | anyone who produced something | curiosity, or a real need (book, buy, approve) | an OG image |
| Approval / review | one user, one client | they must comment or sign off | one guest seat |
| Theme gallery | nobody — it is indexed | search: "site cabinet vétérinaire" | one static page |

## 3. Privacy posture first — it decides the design

Kybernos sells locality: *kept on this device, never sent*. A public-by-default product would
break that promise and would look like the auto-published AI slop it competes with. Sharing is
therefore an **explicit act**, in three tiers:

- **Private (default)** — local only, nothing leaves.
- **Link-only (unlisted)** — anyone holding the link; used for approvals and client deliverables,
  never indexed. The cloud already models this as an audience `only_me | link | password`; an
  object flagged with personal data is forced into link-only, never public
  (`webapp-publish/SKILL.md`).
- **Public** — sites, shops, videos, theme previews; indexed, badged, stable slug.

Sensitive objects never go public: CRM records, client data, conversation logs.

This is a differentiator. A link the user *chose* to publish is honest, and an honest link converts
better than an auto-generated one: the recipient can feel the difference between "I made this for
you" and "an app spat this out".

## 4. The three loops, in order of cost

**Loop A — artifact.** Produce → publish a link (or an export) → badge → link preview → the
recipient lands on the live object → contextual call to action → sign-up with the sender's
reference captured.

**Loop B — approval and collaboration.** A deck, a report or a dashboard is sent to a client or a
colleague who must comment or sign off. To do that they need an account, which is a guest seat.
This is the cheapest acquisition there is, because the invitation is already a work obligation: the
person does not discover the product through an ad, they use it to say yes.

**Loop C — theme gallery and remix.** Sector themes become public preview sites (vet clinic, SSII,
doctor's practice): searchable, relevant, each an installable demo. "Use this theme" is an
activation in under a minute, and it seeds the next artifact.

Sequence: **A first** (cheap, gives measurement and attribution), **B second** (best conversion per
unit of effort), **C last** (compounding, but it only pays off once A's attribution exists).

## 5. Where the product stands today (verified)

The rails are built; the traffic is not.

- **Deliverables can already be shared as a link.** The deliverables pane reads a local file, pushes
  it (`POST /kybernos-cloud/artifacts/push`), sets the audience to `link` and gets back
  `<web>/s/<slug>`. A chat can be shared the same way (idempotent by `external_ref`).
  **Those public pages are paused by decision** (ADR 0007/0011): the new server answers
  `not_found`, the client degrades cleanly and hides the control.
- **The referral is a dead end.** The card shows the account's code and `share_url`
  (`/r/<code>`), but a pasted code is written to `localStorage` and *never sent* — the label even
  says "Kept on this device, never sent" — and the card itself needs a signed account and a
  reachable server, so it is invisible to the one person the loop is for: a brand-new user.
- **Nothing the product produces carries a signature.** No "Made with" on a video, a deck, an HTML
  artifact or an app; no OG/Twitter card anywhere; no `?ref=` on any generated link.
- **No publishing path for apps.** `*.kaby.app` is decided and ordered, apps still bind
  `127.0.0.1`, publishing is a later batch.
- **No client telemetry, by contract.** `dsh web` sends nothing. The loop must therefore be
  measured **server-side** — share page views, sign-ups, first artifacts — not with client events.

## 6. The mechanics to build

1. **Make the referral code do something.** Saving a pasted code or link opens `<web>/r/<code>` in
   the system browser (the host open path already exists for the gift card). Ten lines, live
   today; without it no referral can ever be credited from inside DSH.
2. **Tag every generated link.** Append `?ref=<code>` in the three link builders (deliverables
   publish, chat share, referral page). Harmless while the pages are paused, indispensable the day
   they resume.
3. **Attribution on what leaves as a file.** A discreet end card on exported video, a last-slide
   mark on decks, a footer on HTML artifacts. This ships with no server work and seeds the
   broadest channels (TikTok, WhatsApp, LinkedIn) — slower conversion, but it works on day one.
4. **Social card.** One automatic OG image per shared object (title, accent, screenshot). Without
   it WhatsApp and LinkedIn show a grey rectangle, and the first impression is a placeholder.
5. **Contextual landing.** The recipient sees the object full-screen behind a slim bar, never a
   marketing page, and the line names the sender and the object: *"Ce site de cabinet a été créé
   en 4 min par X — créez le vôtre."*
6. **Reason-shaped CTA.** Bookings for a shop, approval for a deck, review for a report, "make
   yours" for a site. One CTA per loop, never four.
7. **No login wall to view.** A shared link that demands an account is an ad for the wall.
8. **First-run invite, not a first-run ad.** The onboarding wizard's last step can carry the gift
   card it already renders elsewhere — same component, no new screen.

## 7. Instrumentation — server-side, one counter per step

The loop is read where the server already sees it:

- `share_created` (type: artifact | chat | site, audience), `share_viewed` (share id, day),
- `signup_with_ref` (ref, share id), `first_artifact` (within 24 h of sign-up),
- `referral_redeemed` (code, day) — the one that stays at zero until §6.1 ships.

Indicators:

- **share rate** = users who shared at least once / activated users, at 7 days;
- **view → signup**, **signup → activation**, **cycle time** (create → share → recipient creates);
- **K** = shares per user × recipient → activation. A defensible sequence is 0.2 in month 1, 0.4 in
  month 2, 0.7–1.0 in the quarter. K ≥ 1 is rare: do not put it on a roadmap slide.

Guardrails: spam reports, badge complaints, link CTR by channel. A tactic that has not moved the
share rate in three weeks is removed, not "optimized".

## 8. Four weeks

| Week | Ship | Metric that decides |
|---|---|---|
| 1 | referral code made actionable + `?ref=` on the three link builders + server-side counters + file attribution on one export type | baseline share rate |
| 2 | one publish path (`*.kaby.app` or a re-enabled `/s/<slug>` share) with OG card and contextual landing | view → signup |
| 3 | Loop B on one flow (deck or report approval), link-only audience, guest invitation | invite → activation |
| 4 | two theme preview pages, search basics — only if A or B moved | signup → activation |

One metric and one decision per week. No week ships two loops.

## 9. Anti-patterns

- **Invite-gating features.** Buys a spike, spends trust (Clubhouse's decay).
- **Paying per sign-up without an activation cap.** Attracts fraud; a privacy-first brand cannot
  afford a reputation for it.
- **Auto-posting to the user's social feed without a preview.** One bad post costs the user and the
  brand at once.
- **Login wall on a shared link.** Kills 40–60 % of views and turns the share into an ad for the
  wall.
- **A badge the size of a billboard.** It is a signature, not an advertisement.
- **"Share to unlock".** Teaches the user that the product extorts, not that it helps.

## 10. Decisions that are the owner's

1. **Badge:** always visible, or removable on the first paid tier? (Recommendation: visible on
   free, removable on paid, and the badge links to the *theme*, not the homepage.)
2. **First object type:** site/shop, or video? (Recommendation: site/shop through a theme; video is
   a second channel — broader audience, slower conversion.)
3. **Reward unit:** cash credit or product (a theme, a month, a skill)? (Recommendation: product —
   it teaches the product and does not attract bargain hunters.)
4. **Guest seats in Loop B:** free forever, or one object then paid? (Recommendation: free for one
   object, then paid.)
5. **The paused shares:** keep them paused and build on exports, or re-enable `/s/<slug>` behind an
   explicit, moderated publish act? The pause was a decision, so lifting it is one too — but no
   link loop exists until it is taken.
