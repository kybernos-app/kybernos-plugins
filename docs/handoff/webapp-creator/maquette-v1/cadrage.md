travail: creation
fidelite: simple
dossier: docs/handoff/webapp-creator/maquette-v1
raison: A brand-new pane tab has no existing screen to improve, so the verb is creation; one list scene with one real gesture (Start) is enough to judge density, states and controls, so the level is simple rather than a static wireframe or a full journey.
regions:
  - the Webapps pane header (title + total tag) — source: donnees — ~/.dsh/kybers/rdv-demo/export.json
  - the app row (name, display slug, state dot, "8 bookings · 5 clients", Start/Stop + Open) — source: donnees — ~/.dsh/kybers/rdv-demo/export.json
  - the empty state ("No webapp yet — create one from the chat") — source: donnees — ~/.dsh/kybers/rdv-demo/export.json
hors-champ:
  - the pane tab strip and the existing Dashboard tab — no capture of the real sidebar was provided: ask before drawing it
  - the create form / creation from the chat — the pane only lists, creation stays in the conversation
  - the publish dialog and the real *.kaby.app address — publishing comes later, the slug shown is a display value only
  - the error state of a row (failed start) — no real failure message to quote: declared, not drawn
  - the loading state while the app starts — declared, not drawn (simple fidelity: empty state + the state the gesture reaches)
  - the content of the running app (what Open shows) — outside the pane
