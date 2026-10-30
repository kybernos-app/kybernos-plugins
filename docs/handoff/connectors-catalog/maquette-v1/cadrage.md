travail: creation
fidelite: interactive
dossier: docs/handoff/connectors-catalog/maquette-v1
raison: ce qu'il faut juger est un parcours — voir tout le catalogue, se faire arrêter au bon moment par le verrou, choisir compte Kybernos ou clé personnelle — un wireframe ne dit pas si l'incitation tient.
regions:
  - l'en-tête (Connecteurs / Connexions / Create), les onglets Yours·Discover et la barre d'actions (recherche, filtre, rafraîchir, Load the full catalog) — source: capture — .chasse-bugs-ui/captures/w6-connectors-discover.png
  - la grille des cartes d'app (logo, nom, catégorie, description, état Connected, barre d'état) — source: capture + donnees — .chasse-bugs-ui/captures/w0-connectors.png + donnees-catalogue.js + donnees-logos.js (100 apps, 98 logos SVG réels, extraits de packages/kybernos-composio/catalog.js)
  - le verrou « compte Kybernos ou clé Composio » (bandeau, feuille à deux portes, saisie de clé, refus 401) — source: port — libellés de packages/kybernos-composio/client.js (kb.cp.nokey, kb.cp.err.401, kb.cp.pv.composio, kb.cp.loadall) + demande utilisateur du 30/10
  - l'onglet Yours et le bloc « Custom connectors » — source: capture — .chasse-bugs-ui/captures/w0-connectors.png
hors-champ:
  - la barre latérale dépliée : elle porte des titres de sessions personnels, donc montrée repliée (rail d'icônes), et hors périmètre
  - la page Réglages › Connecteurs où la clé se saisit pour de vrai — seule la feuille de la maquette la simule
  - l'OAuth réel de chaque app (aller-retour navigateur)
  - les ~1 400 apps non embarquées : aucun nom réel disponible (l'API Composio répond 401 sans clé, mesuré le 30/10) — donc jamais inventées, montrées comme des cartes verrouillées sans nom
  - les PNG sources restent hors du dépôt (règle « pas de média en git ») : chemins ci-dessus, dans .chasse-bugs-ui/ (gitignoré)
