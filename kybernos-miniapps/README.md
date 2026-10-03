# kybernos-miniapps

« Install as app » pour les mini-apps de la barre latérale droite de DSH
(Briques, Modeleur, Slides) — dans l'esprit des apps Goose qui restent actives
quand l'application principale est fermée.

## Ce que ça fait

- un bouton **App ⤓** apparaît dans l'en-tête de chaque mini-app reconnue ;
- au clic, le panneau est **sérialisé** (DOM + règles CSS applicables +
  canvas figés en images) et envoyé à l'hôte ;
- l'hôte pose une **app native macOS** (fenêtre flottante sans bord, toujours
  au-dessus, déplaçable, icône de barre de menus avec Recharger/Quitter) dans
  `~/Applications/Kybernos/` — elle **survit à la fermeture de DSH** ;
- après installation, le bouton ouvre un menu : **Lancer**, **Démarrage auto**
  (LaunchAgent `app.kybernos.miniapps.<id>`), **Désinstaller**.

## Limites assumées

- l'app installée est un **instantané** : une mini-app qui parle au serveur
  en direct (relecture animée, sondes) vivra figée hors DSH ;
- macOS uniquement (NSPanel + codesign + launchctl) — ailleurs, refus poli ;
- le binaire du wrapper (`template/template.app/Contents/MacOS/miniapp`) est
  compilé arm64 depuis `template/miniapp.swift` : `swiftc -O -o miniapp miniapp.swift`.

## Routes

- `POST /kybernos-miniapps/install` `{id, titre, html, largeur, hauteur, auto}`
- `POST /kybernos-miniapps/uninstall` `{id}`
- `GET /kybernos-miniapps/list`
