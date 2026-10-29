travail: creation
fidelite: interactive
dossier: docs/handoff/desktop-electron/maquette-v1
raison: the request introduces a new desktop journey, so creation at interactive fidelity is needed to judge first install, daily opening, recovery and diagnostics rather than a static welcome screen.
regions:
  - split desktop shell and native action hierarchy — source: existing DSH alias tokens — ../session-msg/maquette-v1/cards.css
  - Kybernos K mark — source: generated brand geometry — ../../../../scripts/icone-kybernos.mjs
  - first installation, progress, ready, failure and diagnostic states — source: existing lifecycle journeys — ../../../../docs/install.md
hors-champ:
  - Kybernos Cloud account sign-in — this mockup covers automatic authentication to the local DSH session only
  - signed/notarized installers and auto-update — packaging concerns, not drawn as fake product controls

## Design plan

- Colour: DSH aliases for surfaces, labels, borders and focus; Kybernos red `#f2372a` is reserved for the brand and primary action. No gradient or decorative palette.
- Type: native system sans for an OS utility; 36 px welcome, 24 px state title, 15 px body, 13 px secondary information. Sentence case throughout.
- Layout: a quiet 34% orientation rail beside a 66% task area. The task area holds one state and one primary action, never a dashboard of setup cards.

```text
┌────────────────────┬──────────────────────────────────┐
│ K Kybernos         │ Welcome / current state          │
│ Your workspace,    │ plain-language explanation       │
│ ready by itself.   │                                  │
│                    │ Install → Start → Open           │
│ Local and private. │ [ one primary action ]           │
└────────────────────┴──────────────────────────────────┘
```

- Principle: the memorable element is the live three-step readiness rail, because it explains the product while the person uses it. Everything else remains quiet.

The plan was checked against the non-developer brief. A marketing hero, a feature-card grid, a fake terminal and technical setup fields were rejected: they would describe the app instead of completing its job. Dark mode, keyboard focus, reduced motion and a 720 px minimum usable width are part of the contract.
