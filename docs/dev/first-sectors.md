# The first sector templates: which ones, in what order, and why

Input: a comparative matrix of ten target sectors (integrations, channels, technical complexity) written by another
model, reviewed on 2026-10-29. This page keeps what the product can actually ship, measured against the connector
catalogue and the packs that exist. The illustrations of the fields come after this list, not before.

## The measurement that orders everything

The Composio catalogue of this checkout holds **100 apps**. Of the 41 integration names the matrix lists, **15 exist here
today and 26 do not** (Stripe is not in the matrix but belongs in the first column):

| Present | Absent |
|---|---|
| Shopify, Zendesk, Gorgias, Stripe | WooCommerce, ShippingBo |
| Google Calendar, Calendly | SeLoger, LeBonCoin, Hektor, Apimo |
| HubSpot, Pipedrive, Salesforce | Bullhorn, RecruitEE, Clearbit, Dropcontact |
| QuickBooks, Google Drive, Google Sheets | Pennylane, Indy, ACD, Box, Xero |
| DocuSign | Doctolib, Maiia, Twilio, Digiforma, Yparfeo, Signaturit, Yousign |
| Make, Slack, LinkedIn | Zapier, Lucca, Factorial, Microsoft Teams |
| Supabase, GitHub, Vercel | Firebase |
| Gmail, Outlook, WhatsApp | SMS (no gateway at all) |

Three consequences, and they matter more than the "technical complexity" column of the matrix:

1. **A vertical French tool is not there.** Every promise of "SeLoger sync", "Doctolib sync", "Pennylane sync" is a
   connector to build, not a configuration. A pack that needs one is not a first template.
2. **SMS is not a channel we have.** WhatsApp is (as a connected app, with the person's own account), e-mail is,
   SMS has no gateway: any template that promises "SMS reminders" is lying. The matrix puts WhatsApp/SMS first for
   real estate, recruitment, health and e-commerce; only half of that sentence is deliverable today.
3. **Health, accounting and HR are not only a connector problem.** HDS hosting is not something we can claim: DSH
   runs on the person's own machine, which is a good answer to "where does my data live", but it is not HDS. Health
   therefore goes after the templates that need no certification claim.

## Wave 1 — six templates, all buildable with what exists

Ordered by value and by how much is already present. Each one reuses an existing pack or adds a goals file.

| # | Template | Pack | Integrations present today | What it does | Why here |
|---|---|---|---|---|---|
| 1 | **E-commerce support** | `com` (tickets, stock) | Shopify, Zendesk, Gorgias, Stripe; Gmail, WhatsApp | triage of customer requests, order and stock answers, follow-ups | biggest market, four of four tools present, the work is text and tables |
| 2 | **Sales ops (PME, SaaS)** | new `ventes` | HubSpot, Pipedrive, Salesforce; Gmail, Outlook, LinkedIn | pipeline hygiene, follow-ups, account briefs, call notes | the three CRMs are present: the strongest "connected" story we can tell |
| 3 | **Accounting firm** | `fin` | QuickBooks, Google Drive, Sheets; Gmail | chase missing documents, reconcile, draft client reminders | regulated work, sticky buyer, and the job is document chasing, which needs no vertical connector |
| 4 | **Training organisation** | `edu` (courses, papers) | Google Drive, DocuSign; Gmail | enrolment forms, session documents, signatures, follow-up | signature plus drive is the whole job; the school pack already carries the vocabulary |
| 5 | **Web / no-code agency** | `dev` (product, review) | Make, GitHub, Vercel, Slack | client briefs, delivery checklists, bug triage, handover notes | the buyer is closest to us and talks to others: advocacy per user is the highest |
| 6 | **Startup (prototyping)** | `dev` (data, quality) | Supabase, GitHub, Vercel | spec to schema, seed data, first deploy checks | cheapest to acquire, and the pack is nearly written already |

## Wave 2 — the rest, with the blocker named

| Template | Blocker to clear first |
|---|---|
| Real estate agencies | no SeLoger / LeBonCoin / Hektor / Apimo connector. Usable today as e-mail + Google Calendar only |
| Recruitment firms | no Bullhorn / RecruitEE ATS; Calendly and LinkedIn are there |
| Private clinics | no Doctolib / Maiia, no SMS gateway, and HDS cannot be claimed |
| Temporary work / HR onboarding | no Lucca / Factorial / Teams |
| E-commerce advanced (stock, shipping) | no WooCommerce, no ShippingBo |

## What this fixes for the illustrations

Wave 1 needs six card pictures, and four of them already exist in the twenty-field palette
(`<DSH home>/kybernos/domain-styles/palette-20-fields.png`): e-commerce (5), accounting (10), agency (14), and
consulting for sales ops (4). Two scenes are missing and must be made: **professional training** (a trainer with
two adults, not a classroom of children) and **startup** (a small team around a screen, not a server room).

## Next

1. The six illustrations, in the retained recipe A, 1344 × 768 (two of them new scenes).
2. Then the packs: the goals, skills, suggested connectors and switched-off automations of each of the six, in the
   `packages/kybernos-plugin/domains/<id>.json` format, checked by `domain-pack.mjs`.
3. Then a conformance pass on two of them with `node scripts/plugin-check.mjs`, before the other four.
