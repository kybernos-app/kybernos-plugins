# Verdict — maquette v1 « Connecteurs : tout le catalogue, verrouillé au moment d'agir »

Six décisions à trancher. Chacune en quatre lignes : le choix montré, ce qu'il coûte, ce qu'il
rapporte, et ma recommandation. La maquette explique déjà le geste ; ce fichier ne le raconte pas.

## D1 — Le verrou parle à l'affichage, ou seulement à l'action ?
- **Montré** : bandeau en haut de page + voile collant en bas de grille + feuille au clic.
- **Coût** : trois endroits à maintenir au lieu d'un message d'erreur (`client.js:2708`).
- **Rapport** : l'utilisateur sait *avant* de cliquer pourquoi il ne peut pas encore, donc il décide.
- **Reco** : garder les trois, mais le bandeau doit être **un état**, pas une publicité (aucun
  clignotement, aucun compte à rebours).

## D2 — Ordre des deux portes
- **Montré** : « Créer un compte Kybernos » en premier (bouton plein), « J'apporte ma clé Composio »
  ensuite (bouton contour).
- **Coût** : un utilisateur avancé peut lire ça comme « on me pousse vers le compte ».
- **Rapport** : c'est l'incitation demandée, et le compte est le chemin qui marche en un clic.
- **Reco** : cet ordre, **à condition** que la clé reste une porte de première classe (jamais un lien
  gris en bas de feuille) — sinon les profils techniques partent sans revenir.

## D3 — Le nombre affiché
- **Montré** : « environ 1 559 ».
- **Coût** : un chiffre exact qui bougera (Composio ajoute des apps), donc une phrase à ne pas figer.
- **Rapport** : c'est la seule valeur sourcée du dépôt (`packages/kybernos-composio/index.js:145`),
  et « 1 500 » rond n'existe nulle part dans le code.
- **Reco** : afficher « environ 1 559 » **tant que** le proxy le renvoie ; sinon, le nombre d'apps
  réellement reçues (comme aujourd'hui) et pas une promesse.

## D4 — Les logos des ~1 459 apps hors des 100
- **Montré** : la promesse « avec leurs logos, depuis ton compte », sans les dessiner (nous n'avons
  pas ces données — les inventer serait pire).
- **Coût** : si le proxy ne sert pas les logos, on livre 1 459 monogrammes et la promesse tombe.
- **Rapport** : c'est le point qui décide si « tout le catalogue » veut dire quelque chose.
- **Reco** : bloquer la mise en production sur une réponse du proxy : logos servis avec la liste,
  sinon on garde les 100 (avec logos) + la porte, et on ne promet pas.

## D5 — Le voile, ou une modale à l'arrivée
- **Montré** : voile collant en bas de la grille, jamais bloquant ; la page reste lisible et
  défilable.
- **Coût** : moins « agressif » qu'une modale plein écran à la première visite.
- **Rapport** : un catalogue qu'on peut lire donne envie ; une modale qui bloque à l'arrivée fait
  fermer l'onglet.
- **Reco** : le voile. Si on veut mesurer l'incitation, c'est un compteur d'événements sur les deux
  boutons, pas une fenêtre de plus.

## D6 — Après la clé acceptée, que voit-on ?
- **Montré** : le bandeau change de mode (« clé acceptée »), le voile devient un bouton « charger les
  autres apps », et chaque carte non connectée propose « Ajouter une connexion ».
- **Coût** : une action de plus à apprendre (le bouton par carte) en plus du chargement global.
- **Rapport** : un seul vocabulaire d'action — « Ajouter une connexion » — quel que soit l'état.
- **Reco** : implémenter **dans cet ordre** : (1) le bandeau d'état, (2) le compteur sourcé, (3) la
  feuille à deux portes, (4) le voile. Le voile est le seul élément vraiment nouveau ; les trois
  autres sont des états à ajouter à du code qui existe déjà.
