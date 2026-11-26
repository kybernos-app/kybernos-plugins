## Regard

- **vu** : au premier rendu, la grille montait à trois colonnes et la troisième rangée était coupée
  net au-dessus du verrou (une carte sans son pied, ça se lit comme un bug, pas comme un voile) ;
  la feuille du verrou avait son titre écrasé sous la croix parce que j'avais mis
  `.kbm-mdl-dialog` et `.kbm-mdl-content` sur le même élément ; à 480 px le panneau du verrou se
  réduisait à un mot par ligne ; l'onglet « Tes apps » s'affichait en une seule colonne (grille
  imbriquée dans une grille) ; les nombres de la carte (r12, p16, logo 44, titre 600) ne collaient
  pas à la capture.
- **corrigé** : balisage réel de la modale (`header/.kbm-mdl-title` + `.kbm-mdl-close`, `body`,
  `footer`), gap de 10 px et retour vers les deux portes ; voile rendu *sticky* avec dégradé qui
  commence à 42 % et panneau pleine largeur en étroit ; géométrie passée aux valeurs mesurées
  (`minmax(300px)`, gap 14, **r16 / p18 / 170**, logo **42** SVG 74 %, titre **650**, description
  **12,5 px**) ; « 1 500 » remplacé par « environ 1 559 » sourcé (`index.js:145`) ; anneau de focus
  retiré de la boîte de dialogue (on la focalise, on ne l'encadre pas).
- **laissé** : la barre latérale reste **repliée** — la déplier voudrait dire recopier des titres de
  sessions personnels dans un fichier versionné ; les descriptions et catégories des 100 apps sont
  **verbatim** (données réelles, on ne réécrit pas une source) ; le compteur reste **annoncé** et
  non mesuré, et le README le dit ; les deux apps sans logo (`addresszen`, `airparser`) gardent leur
  monogramme, comme le fait déjà le produit.
