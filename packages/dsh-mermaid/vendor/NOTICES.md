# Composants tiers

## mermaid

- Version : 11.14.0
- Licence : MIT
- Source : paquet npm `mermaid` (bundle ESM `dist/mermaid.core.mjs` via son entrée)
- Usage : rendu des diagrammes des fences ```mermaid.
- Fichier dérivé : `vendor/mermaid.iife.js` — bundle IIFE minifié produit par
  `scripts/build.mjs` avec esbuild (`--format=iife --global-name=__DSH_MERMAID_NS`).
  Régénérable hors ligne : `node scripts/build.mjs`.

Le fichier vendoré est un artefact de build : il n'est jamais édité à la main.
Le texte de licence MIT de mermaid accompagne le paquet npm d'origine.

## Contributions propres

Tout le reste (accroche DOM, thème par jetons `--dsw-*`, cartes, gestion
d'erreur) est original et sous licence MIT, comme ce paquet.