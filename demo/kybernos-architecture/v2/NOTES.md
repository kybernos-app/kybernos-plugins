# La carte v2 — deux lectures : ce que c'est, où ça tourne

`v2/index.html` est une copie évoluée de `../index.html` ; l'original n'est pas
touché. Ouvrir les deux côte à côte (double-clic) : même page, même matière,
une lecture de plus.

## Le problème, mesuré sur la v1 (1440 × 900)

| Constat | Mesure |
|---|---|
| Au repos, la carte est éteinte | 23 des 26 briques à `opacity: .33` |
| Le texte descend trop bas | plus petit texte **8,3 px** (26 étiquettes), notes de zone 9,7 px |
| La barre d'étape recouvre le plateau | **880 × 115 px** posée sur le bas du plateau |
| Une seule lecture : le déploiement | le harnais, les outils et les plugins y sont mélangés ; « tout est un plugin » n'y est pas dit |

## Le modèle : deux lectures du même plateau

Chaque brique a maintenant **une couche** (ce qu'elle est) et garde **un lieu**
(où elle tourne). La couleur reste réservée aux lieux ; la couche se lit à
l'index, au libellé et à la position — pas à une nouvelle palette.

| Couche | Rôle | Briques (4 / 7 / 5 / 10) |
|---|---|---|
| **01 · Le harnais** | le moteur : il pense, il exécute, il rend la main | Navigateur desktop · Kybernos local · Serveur Kybernos · Serveur custom |
| **02 · Les outils** | ce que l'agent peut appeler | Workers · Worker vocal · Driver · Webhooks · Apps MCP · Ordinateur cloud · E2B |
| **03 · Les plugins** | ce que Kybernos ajoute au harnais | Téléphone · Kaby · Automations locales · Automations sur l'ordinateur · Chat → cloud |
| **04 · Les services et accès** | ce qui est dehors, ce qui sort de la machine | Compte/quota · Porte canaux · Relais · Accès · Volume · Egress · Modèles · Telegram · WhatsApp · LiveKit |

Vue **Couches** : 4 sections, 23 cartes (6 + 7 + 6 + 4) ; chaque carte porte sa
phrase, ses lieux, sa source, et « voir sur la carte → » quand elle correspond à
des briques. Vue **Lieux** : la carte d'origine, inchangée dans ses positions,
ses tracés, ses 8 parcours et sa narration.

## Les gestes

| Geste | Effet |
|---|---|
| `Couches` / `Lieux` | bascule de lecture ; `#couches` / `#lieux` dans l'URL |
| Chevron d'une section | replie la section à son en-tête |
| Œil « isoler » | ne garde que cette section (les autres se replient) ; re-clic : tout revient |
| « Tout replier / déplier » | replie ou rouvre les 4 couches |
| `1…4` (Couches) | saute à une couche |
| Pastilles de couche (Lieux) | masquent les briques d'une couche, recalculent les compteurs `5/7` |
| Fiche d'une carte | rôle, lieux, source, briques liées (boutons) |
| Fiche d'une brique | ajoute « Couche : outil · voir la couche » : bascule et met la carte en avant |
| `1…8`, `Espace`, `→` `←` (Lieux) | parcours, lecture, pas à pas — inchangés |
| `Échap` | ferme la fiche |

## Ce qui a changé dans la page

1. `layer` ajouté aux 26 briques (aucun titre, aucun texte de fiche modifié).
2. Vue Couches : 4 sections repliables/isolables, 23 cartes, compteurs, sources.
3. Vue Lieux : pastilles de couche **10,5 px** à la place des étiquettes 8,3 px ;
   filtres par couche ; dossiers de zone repliables et isolables ; barre d'étape
   **descendue sous le plateau** (plus de recouvrement).
4. Ponts entre les deux lectures, dans les deux sens.
5. Titres ≥ 12 px, sous-titres ≥ 11 px, plus petit texte de la page 10,5 px.
6. En-tête mobile allégé (marque courte, bouton « Tout replier » masqué).

## Ce qui a été vérifié (Chrome, Playwright)

- 26 briques, 4 zones, 8 parcours, 23 cartes, 4 couches : conservés.
- 1440 × 900 et 1280 × 800 : aucun débordement horizontal ; aucun recouvrement
  entre la barre d'étape et une zone (mesuré après stabilisation).
- 390 × 844 : pas de débordement, rail en tiroir, fiche plein écran.
- 0 erreur, 0 avertissement console.
- Filtres : `Outils` décoché → 19 briques visibles, compteurs `5/7 · 5/8 · 5/7 · 4/4`.
- Isoler une couche : 1 section ouverte, 3 en-têtes, pastille du rail synchronisée.
- Fiche carte ↔ fiche brique ↔ « voir la couche / voir sur la carte » : testés.
- Thème clair et sombre : capturés.

Captures : `captures/` (dossier de preuve, à ne pas committer — règle du dépôt).
`avant-*.png` = la v1, `v2-*.png` = la v2.

## Icônes, couleur, version anglaise (2ᵉ passe)

- **9 icônes ajoutées** au jeu existant : `chip`, `wrench`, `loop`, `list`, `route`,
  `stack`, `gear`, `search`, `globe` — 24 × 24, trait 1,7, bouts ronds, comme les
  anciennes. Placées sur les **4 en-têtes de couche**, les **23 cartes** et les
  **pastilles du rail** (14 px) ; les briques de la carte gardent leurs icônes.
- **La couleur reste celle des lieux** : icône de carte et point de pastille
  prennent la teinte du premier lieu (`toi` teal, `serv` violet, `cloud` ambre,
  `world` bleu) ; « partout » reste neutre. Icônes des briques teintées par zone.
  Rien d'autre ne prend de couleur : pas de fond, pas de bordure, pas de dégradé.
- **Bilingue** : `index.html` (FR) et `index-en.html` (EN), même structure, mêmes
  données, bouton `EN` / `FR` dans l'en-tête ; la vue en cours est conservée
  (`#couches` / `#lieux`). Traduction : 26 briques, 8 parcours et leurs 34 étapes,
  4 couches, 23 cartes, fiches, barre d'étape, chrome et libellés d'accessibilité.
- Vérifié : **0 reste de français** dans le texte visible des deux vues, des
  fiches et de la barre d'étape (balayage des lignes visibles, accents et
  mots-outils) ; 0 erreur console ; en-tête à 390 px toujours sur une ligne.

## Limites connues

- La couche « services et accès » mélange des services (compte, serveur, canaux)
  et des propriétés de machine (volume, egress, accès) : c'est un rangement
  assumé, pas une taxonomie mesurée.
- Les parcours ne se lisent que dans la vue Lieux ; en Couches, la note du rail
  le dit.
- `spyLayers` (surlignage du rail au défilement) peut retarder d'un cran après
  un saut clavier ; le saut lui-même met bien la pastille à jour.
- Aucune mesure du système en marche : c'est une lecture des contrats du dépôt,
  comme la v1.

## Décisions à prendre

1. Garder la vue Couches par défaut, ou ouvrir sur Lieux ?
2. Quatre couches (harnais / outils / plugins / services) ou trois en repliant
   les services dans les lieux ?
3. Remplacer `index.html` par cette v2, ou garder les deux pages ?
4. Deux fichiers bilingues (aujourd'hui) ou un dictionnaire FR/EN dans un seul
   fichier (moins de duplication, plus lourd à lire) ?
