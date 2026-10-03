# kybernos-bricks

**Le POC : depuis le chat DSH, une maquette en briques naît dans la barre
latérale droite — brique par brique, en direct, puis se relit.**

```
chat DSH ──(outil `animer_briques`)──▶ hôte ──(GET /kybernos-bricks/state)──▶ panneau « Briques »
```

## Ce que ça fait

| Moitié | Fichier | Rôle |
|---|---|---|
| Hôte | `index.js` | Outil `animer_briques` + deux routes. Tient le magasin (une commande par session) et l'**horloge de pose** (`t0`, `dureeMs`). Ne dessine rien. |
| Client | `client.js` | Panneau de la barre latérale droite : moteur isométrique Canvas 2D, 9 générateurs, exécuteur d'ops, transport (lecture, vitesses, curseur, relecture). |

Le panneau **ne joue pas une animation locale** : il pose
`total × (maintenant − t0) / durée` briques, d'après l'horloge de l'hôte. Un
onglet qui arrive en retard rattrape son retard au lieu de rejouer depuis zéro.

## Les deux chemins

1. **`prompt`** — « construis un phare sur des rochers ». Le panneau classe la
   demande et choisit un archétype : château, chalet alpin, phare, fusée, robot,
   place à horloge, mosaïque, van, colibri.
2. **`ops`** — l'agent dessine lui-même. Chaque lot est posé dans l'ordre du
   tableau :

```jsonc
[
  { "op": "plate",  "x": 0, "y": 0, "z": 0, "w": 12, "d": 12, "color": "#4C9A52" },
  { "op": "rect",   "x": 2, "y": 2, "z": 1, "w": 8,  "d": 8,  "h": 3, "color": "#9BA3A7" },
  { "op": "disc",   "cx": 6, "cy": 6, "r": 3, "z": 4, "color": "#C4291C" },
  { "op": "cone",   "cx": 6, "cy": 6, "z": 7, "r": 3, "niveaux": 3 },
  { "op": "tree",   "x": 10, "y": 10, "z": 1, "h": 3 }
]
```

Ops connues : `rect`/`wall`/`bloc`, `plate`/`dalle`, `disc`/`cylindre`,
`ring`/`anneau`, `cone`, `pyramide`, `arbre`/`tree`, `brique`/`brick`/`point`,
`archetype` (un modèle entier). Un op inconnu est ignoré, sans créer de lot.

Enchaîner `animer_briques` avec `mode: "modifier"` **ajoute** des lots à la
maquette courante : c'est le chemin « le chat continue de dessiner », et seuls
les lots neufs sont animés.

## Installation

Le profil doit lister le paquet — `dsh.profile.bundles` **et** une dépendance
`link:` dans `~/.dsh/profiles/web/package.json`, plus le lien symbolique
correspondant dans `node_modules/@local/`. Un redémarrage de DSH est nécessaire
(la liste des bundles est lue au démarrage) :

```bash
ln -s /Users/miled/dyad-apps/dsh-kybernos/kybernos-bricks \
      ~/.dsh/profiles/web/node_modules/@local/kybernos-bricks
# puis ajouter "@local/kybernos-bricks" à dsh.profile.bundles et relancer DSH
```

Le panneau s'ouvre **tout seul** quand une maquette arrive, et le type d'onglet
**Briques** reste offert en permanence par le sélecteur (le `+`) de la barre
latérale droite. Aucun bouton n'est posé dans le pied de la sidebar : un
« ▦ Briques » permanent y traînait pour rien.

## Tests

```bash
node test-host.mjs      # outil + routes sur un vrai serveur HTTP
node test-client.mjs    # moteur, ops, rendu, câblage des slots — sans navigateur
```

`test-client.mjs` vérifie notamment, pour les 9 archétypes, qu'aucun n'a d'îlot
de briques détachées (test de connexité 6-voisins depuis le sol) — le défaut le
plus coûteux d'un générateur de maquettes, et celui qui ne se voit qu'à l'œil.

## Décisions

- **Canvas 2D, pas Three.js.** L'ombrage plat par face et les arêtes franches du
  rendu « brique » sont plus proches de la référence en 2D qu'en WebGL, et le
  paquet n'a **aucune dépendance** : ni CDN, ni node_modules.
- **L'horloge est chez l'hôte.** Sinon deux onglets ouverts sur la même session
  jouent deux animations différentes.
- **`t0` + rattrapage.** Le panneau rejoint l'horloge du chat ; il ne redémarre
  pas à son montage.
- **Un `Map` en mémoire, pas de persistance.** Une maquette est un spectacle,
  pas un document.