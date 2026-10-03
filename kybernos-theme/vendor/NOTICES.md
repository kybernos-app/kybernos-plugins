# Attribution des palettes — `kybernos-theme/vendor/palettes/`

Kyberos · Theme n'invente aucune couleur de base : il **compile** des palettes
publiées par leurs auteurs. Ce dossier contient une copie figée de leurs sources
canoniques, pour que la compilation soit reproductible hors ligne et vérifiable.

| Fichier local | Source amont | Licence | Copie figée |
|---|---|---|---|
| `catppuccin.json` | https://github.com/catppuccin/palette — `palette.json` | MIT | 4 saveurs × 26 couleurs (+ OKLCH amont) |
| `rose-pine.json` | https://github.com/rose-pine/rose-pine-palette — `palette.json` | MIT | 3 variantes (`main`, `moon`, `dawn`) |
| `selenized-{dark,light,black,white}.json` | https://github.com/jan-warchol/selenized — `terminals/tilix/` | MIT | 4 variantes, schéma Tilix |

Les palettes **Nord**, **Gruvbox**, **Tokyo Night**, **Solarized** et **Flexoki**
sont définies par des constantes documentées dans `scripts/gen-kybernos-theme-mockup.mjs` :
leurs dépôts amont n'exposent pas de fichier JSON canonique unique, et une copie
figée d'un fichier de configuration d'éditeur serait plus fragile qu'une table
explicite. Chaque entrée y porte sa source et sa licence.

## Palettes volontairement exclues

- **Monokai** — aucun dépôt officiel, aucun fichier de licence retrouvé. Trois
  plugins de l'écosystème DSH redistribuent pourtant ses valeurs ; nous ne le
  faisons pas, faute de titularité identifiable.
- **VS Code Material Theme** — les deux dépôts amont (`equinusocio/vsc-material-theme`,
  `material-theme/vsc-material-theme`) répondent 404 : le projet amont n'est plus
  distribué. Les jetons Material 3 (`material-foundation/material-tokens`,
  Apache-2.0) couvrent le même besoin avec une licence claire.

## Règle

Toute palette ajoutée ici **doit** avoir : une source amont citable, une licence
identifiable, et une entrée dans ce fichier. Une palette sans licence n'entre pas,
même si sa popularité est grande.
