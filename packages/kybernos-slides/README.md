# kybernos-slides

**Depuis le chat DSH, l'agent écrit un deck de slides en TEMPS RÉEL dans la
barre latérale droite ; l'utilisateur modifie en live (texte, pinceau) ;
l'agent relit ces retouches et corrige — chaque passage corrigé est souligné
à l'écran.**

```
chat (outil `creer_slides`) ──▶ hôte ──▶ panneau « Slides » (frappe machine à écrire)
panneau ──(POST /kybernos-slides/push)──▶ hôte ──▶ l'agent relit (appel SANS `slides`)
```

## Ce que ça fait

| Moitié | Fichier | Rôle |
|---|---|---|
| Hôte | `index.js` | Outil `creer_slides` + deux routes. Tient le **deck** (une commande par session) ET les **annotations** (éditions de texte + traits) — une correction garde les annotations, `effacer_annotations` les vide. Ne dessine rien. |
| Client | `client.js` | Panneau : moteur de frappe (poids par slide, segments ordonnés, caret), layouts (`titre`, `statement`, `puces`, `chiffre`, `citation`, `fin`), thèmes (`sombre`, `clair`, `corail`, `papier`), édition par textarea superposée, pinceau/gomme sur canvas 1600×900, diff de correction souligné, vignettes, relecture. |

La frappe est calée sur `t0`/`dureeMs` de l'hôte (rattrapage, pas de rejeu
local à l'ouverture d'un onglet). Le diff de correction compare le deck
précédent au deck corrigé **champ par champ** : chaque passage touché reçoit
un halo vert 5 s, une pastille `IA · n corrections` s'affiche en en-tête.

## La boucle complète (le cœur du chantier)

1. **L'agent écrit** : `creer_slides { titre, theme, slides }` — le panneau
   tape le texte caractère par caractère, slide après slide.
2. **L'utilisateur modifie en live** : **double-clic sur un texte** (à la
   Google Slides — ou outil `✎ Texte`), palette de **couleur** sous la boîte
   d'édition, `✎ Pinceau` (traits colorés), `Gomme`. Chaque retouche — texte,
   couleur ou trait — est poussée à l'hôte aussitôt.
3. **L'agent relit** : `creer_slides` **sans** `slides` rend le deck courant
   plus `annotations.edits` (qui a changé quoi, champ par champ) et les traits.
4. **L'agent corrige** : `creer_slides { mode: "corriger", slides }` avec le
   deck intégré — le panneau souligne chaque passage corrigé, garde les
   annotations (`effacer_annotations: true` pour les effacer).

## Installation

Même recette que kybernos-modeleur : lien symbolique dans
`~/.dsh/profiles/web/node_modules/@local/`, dépendance `link:` et entrée
`dsh.profile.bundles` dans `~/.dsh/profiles/web/package.json`, puis relance
de DSH (la liste des bundles est lue au démarrage).

## Tests

```bash
node test-host.mjs      # outil, normalisation, annotations, routes HTTP
node test-client.mjs    # moteur de frappe, diff, gomme, rendu du panneau — sans navigateur
```

## Décisions

- **DOM, pas canvas, pour le texte** : l'édition inline (textarea superposée,
  fontes copiées au pixel) et le soulignement des corrections sont gratuits ;
  le canvas ne sert qu'aux traits, calque au-dessus du slide.
- **Scène 1600×900 mise à l'échelle par `transform`** : les coordonnées des
  traits et des layouts sont fixes, quel que soit le panneau.
- **Les annotations vivent chez l'hôte** : un second onglet rattrape les
  retouches au chargement ; l'agent les lit sans route dédiée (appel sans
  `slides`).
- **Une correction garde les annotations par défaut** : l'agent est censé
  intégrer les retouches ; il n'efface les traits que s'il le demande.
- **Le diff compare champ par champ, pas ligne par ligne** : un titre corrigé
  se souligne entier — c'est le niveau de lisibilité voulu.
