# kybernos-modeleur

**Depuis le chat DSH, l'agent dessine un modèle 2D ou 3D ; il s'anime dans la
barre latérale droite, objet par objet, puis se relit.**

```
chat DSH ──(outil `modeliser`)──▶ hôte ──(GET /kybernos-modeleur/state)──▶ panneau « Modeleur »
```

## Ce que ça fait

| Moitié | Fichier | Rôle |
|---|---|---|
| Hôte | `index.js` | Outil `modeliser` + deux routes. Tient le magasin (une commande par session), l'espace (2d/3d) et l'**horloge de pose** (`t0`, `dureeMs`). Ne dessine rien. |
| Client | `client.js` | Panneau de la barre latérale droite : moteur 2D à l'échelle (ops SVG-like), moteur 3D solides (facettes + tri du peintre), exécuteur d'ops, transport (lecture, vitesses, curseur, relecture). |

Le panneau **ne joue pas une animation locale** : il pose
`total × (maintenant − t0) / durée` objets, d'après l'horloge de l'hôte. Un
onglet qui arrive en retard rattrape son retard au lieu de rejouer depuis zéro.

## Les deux espaces

### 3D — solides orbitables

```jsonc
[
  { "op": "box",     "x": -5, "y": -4, "z": 0, "w": 10, "d": 8, "h": 4, "color": "#EFE4C8" },
  { "op": "cone",    "cx": 0, "cy": 0, "z": 4, "r": 7, "h": 3, "color": "#8E1B14", "n": 4 },
  { "op": "cyl",     "cx": 0, "cy": 0, "z": 0, "r": 4, "r2": 2.5, "h": 15, "color": "#EFE4C8" },
  { "op": "sphere",  "cx": 0, "cy": 0, "cz": 18, "r": 1.4, "color": "#F2C31A" },
  { "op": "tube",    "cx": 0, "cy": 0, "z": 16, "r": 3, "t": 0.6, "h": 2.5, "color": "#D9C08C" },
  { "op": "extrude", "points": [[0,0],[6,0],[3,4]], "z": 0, "h": 2, "color": "#7C848A" }
]
```

`n:4` sur un cône = toit pyramidal carré, et `rot: 45` aligne ses arêtes sur
les diagonales (murs droits). `r2` sur un cylindre = tronc de cône
(tour effilée). `fond:true` ajoute la face du bas. Le rendu est un tri du
peintre — clé = profondeur du **point le plus lointain** de chaque facette,
et les plafonds couverts (faces horizontales sous le point culminant) se
dessinent en premier — donc des solides **juxtaposés**, pas interpénétrés.

### Boucle « redessiner → réajuster »

Le pinceau ✏ du panneau annote par-dessus le modèle — **5 outils** : trait
libre (moteur [perfect-freehand](https://github.com/steveruizok/perfect-freehand),
traits feutre à épaisseur variable), rectangle, ellipse et flèche (moteur
[Rough.js](https://roughjs.com/) façon main levée, graine stable par forme) et
texte. 3 couleurs, bouton « Effacer ». L'agent les relit par `modeliser` avec
`relire: true` — annotations typées en coordonnées normalisées 0..1 (rect/
ellipse = zone, flèche = direction, texte = consigne littérale, trait =
entourage ou biffure) — puis pousse le modèle ajusté en `mode:"modifier"`.
Route hôte : `POST /kybernos-modeleur/annote` ; un nouveau push repart feuille
neuve. Vendors inlinés MIT (~32 Ko) : zéro dépendance, zéro CDN.

### 2D — dessin à l'échelle

```jsonc
[
  { "op": "axes",  "x": 0, "y": 0, "w": 90, "h": 50 },
  { "op": "rect",  "x": 8, "y": 8, "w": 50, "h": 34 },
  { "op": "circle", "cx": 33, "cy": 25, "r": 10 },
  { "op": "arrow", "x1": 58, "y1": 25, "x2": 80, "y2": 25 },
  { "op": "path",  "d": "M10 44 C 25 50, 40 38, 55 44" },
  { "op": "text",  "x": 33, "y": 26, "text": "Ø 20", "anchor": "middle", "bold": true }
]
```

Repère mathématique (Y vers le haut), ajusté au cadre, grille au pas rond
(`1/2/5×10^k`). Chaque op accepte `stroke`, `fill`, `width`, `dash`.

Les deux familles détaillées dans la skill **`modeleur-2d-3d`**
(`~/.dsh/skills/modeleur-2d-3d/SKILL.md`) — c'est elle qui apprend le DSL aux
modèles ; ce README ne donne que la forme.

## Enchaîner

`modeliser` avec `mode: "modifier"` **ajoute** des objets au modèle courant,
seulement dans le même espace : passer de 3D à 2D repart forcément d'un modèle
neuf (le magasin l'impose, pas le client). Seuls les objets neufs sont animés.

## Installation

Le profil doit lister le paquet — `dsh.profile.bundles` **et** une dépendance
`link:` dans `~/.dsh/profiles/web/package.json`, plus le lien symbolique
correspondant dans `node_modules/@local/`. Un redémarrage de DSH est nécessaire
(la liste des bundles est lue au démarrage) :

```bash
ln -s /Users/miled/dyad-apps/dsh-kybernos/kybernos-modeleur \
      ~/.dsh/profiles/web/node_modules/@local/kybernos-modeleur
# puis ajouter "@local/kybernos-modeleur" à dsh.profile.bundles et relancer DSH
```

Le panneau s'ouvre **tout seul** quand un modèle arrive, et le type d'onglet
**Modeleur** reste offert en permanence par le sélecteur (`+`) de la barre
latérale droite. Aucun bouton dans le pied de la sidebar (même décision que
kybernos-bricks).

## Tests

```bash
node test-host.mjs      # outil + routes sur un vrai serveur HTTP
node test-client.mjs    # moteurs 2D/3D, exécuteur d'ops, câblage — sans navigateur
```

`test-client.mjs` vérifie notamment : facettes par primitive, bornes, tri du
peintre (remplissage dans la famille de la couleur), ops 2D invalides ignorées,
parseur de chemin (absolus, relatifs, `Z` qui ferme), pose partielle, et les
trois démos de l'état vide sans perte de lot.

## Décisions

- **Canvas 2D, pas Three.js/WebGL.** Facettes + tri du peintre suffisent à des
  solides juxtaposés, et le paquet garde **zéro dépendance** : ni CDN, ni
  node_modules.
- **L'horloge est chez l'hôte.** Sinon deux onglets ouverts sur la même session
  jouent deux animations différentes.
- **`t0` + rattrapage.** Le panneau rejoint l'horloge du chat ; il ne redémarre
  pas à son montage.
- **Un `Map` en mémoire, pas de persistance.** Un modèle est un spectacle, pas
  un document — pour garder, le chat redemande le modèle.
- **Le changement d'espace repart à zéro** (imposé par l'hôte) : superposer un
  plan 2D sur une scène 3D n'a pas de sens visuel.
