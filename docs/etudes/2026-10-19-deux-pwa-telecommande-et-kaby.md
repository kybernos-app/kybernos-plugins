# Deux applications pour la télécommande : « Kybernos à distance » et « Kaby » (étude du 19 octobre 2026)

Statut : **étude et maquette. Rien n'est construit, aucun fichier épinglé n'est modifié.** La maquette cliquable (page privée, clair et sombre, largeur téléphone, jetons DSH réels) : https://claude.ai/artifact/5nMr7Y387HpSG3dHXZKTC5

Décision du propriétaire (19 octobre 2026) : l'application web Expo reste uniquement le site commercial et n'est pas touchée. Les deux applications se proposent depuis la **page téléphone** de la télécommande (`packages/kybernos-mobile/phone/`).

Ce que « vérifié » veut dire ici : mesuré sur la machine (avec le détail), ou lu dans le code ou dans une page officielle citée au § 10. Tout le reste est dans le § 7, « non vérifié », avec le test qui le lèverait.

## 1. Réponses courtes

1. **Deux PWA sur une même origine : oui, c'est simple.** Deux manifestes avec chacun un `id`, un `start_url` et un `scope` à lui. Mesuré dans Chrome 155 : le manifeste actuel est installable sans erreur, et un second manifeste d'`id` `/__kb/kaby/` donne une seconde application distincte. **Aucun service worker de plus** : un seul, de portée `/`, sert les deux (une inscription, trois pages contrôlées, mesuré). Un nom d'hôte par appairage ne change rien à cela : il isole les appairages entre eux, pas les deux applications d'un même appairage.
2. **Le point dur est l'iPhone, pas la double application.** Apple dit qu'une application de l'écran d'accueil a des cookies et un stockage **séparés** de Safari. La clé de liaison est dans IndexedDB : sur iPhone, l'application installée **ne reprend pas** l'appairage fait dans Safari. Elle doit se relier elle-même, et le seul geste prévu aujourd'hui est de scanner un QR code avec l'appareil photo, qui ouvre le navigateur, pas l'application. Sur Android, Chrome partage son stockage avec l'application installée : l'appairage suit (documentation de 2017, à confirmer sur un téléphone).
3. **Ouvrir la conversation de Kaby : DSH n'a aucune adresse par conversation.** Mesuré sur le vrai DSH : l'URL reste `/`, la session courante est dans `localStorage['dsh.sessions.current']`, et la navigation passe par `uiWorkspace.openSession(id)`, dans la page. La route hôte `GET /kybernos-cloud/kyby/native` donne l'identifiant. Le plan : l'application Kaby est une seconde page de la même origine (`/__kb/kaby/`) ; un petit pont dans `kybernos-kyber` (plugin ouvert, aucun fichier épinglé) lit `parent.location` (même origine) et ouvre la conversation avec le `openChat()` qui existe déjà.
4. **Ordinateur éteint** : la télécommande ne joint que le DSH local, sans file d'attente. La page affiche déjà « Ton ordinateur est hors ligne » et réessaie seule. Pour Kaby, un texte propre à Kaby. Le téléphone n'a pas de compte : il ne peut ni ouvrir un ordinateur cloud (ticket à usage unique, ADR 0052 § 11) ni savoir si Telegram est relié. Il ne promet donc que ce qu'il sait.
5. **Où proposer** : sur la page téléphone, **entre l'approbation du code et DSH**, par plateforme : bouton natif sous Chrome (événement `beforeinstallprompt`), explication en deux étapes sous iPhone. Aujourd'hui, la page passe droit à DSH et ne propose rien.
6. **Push** (hors périmètre) : possible sans que le serveur lise le contenu, mais il faut des gestionnaires dans le service worker (fichier épinglé), une souscription et une clé VAPID, et sur iPhone l'installation est une condition. Sans push, rien n'alerte quand l'application est fermée. Détail au § 3.5.
7. **Sécurité** : pas de service worker de plus, deux fichiers statiques de plus sous la même politique de sécurité, ni `sw.js` ni `remote-e2e.mjs` modifiés dans les étapes 1 à 5. Une application installée garde l'appairage (Android) ou doit refaire le sien (iPhone) ; un téléphone retiré affiche « n'est plus autorisé » et perd sa clé. **Deux icônes ne sont pas deux droits** : un téléphone relié a la puissance du clavier, quelle que soit l'icône.

## 2. Ce qui existe (vérifié)

| Sujet | Constat | Source |
|---|---|---|
| La page téléphone est déjà techniquement une PWA | manifeste « Kybernos », `start_url` `/__kb/`, `scope` `/`, `display` `standalone`, une icône SVG `sizes: any` ; service worker avec gestionnaire `fetch` | `phone/manifest.webmanifest`, `phone/sw.js` |
| Installable aujourd'hui (Chrome) | **0 erreur d'installabilité**, identifiant calculé = `start_url` (`/__kb/`), mesuré avec `Page.getInstallabilityErrors` et `Page.getAppId`, Chrome 155 de bureau, serveur jetable sur le port local. L'icône SVG seule ne bloque pas, alors que web.dev demande 192 et 512 px | mesure du 19 octobre, hors dépôt |
| Aucune invitation | pas de `beforeinstallprompt`, pas d'`apple-touch-icon`, pas d'explication « Ajouter à l'écran d'accueil », pas de test de mode standalone dans la page | `grep` sur `phone/` et `remote-e2e.mjs` : aucune occurrence de `beforeinstallprompt`, `apple-touch`, `navigator.standalone`, `display-mode`, `appinstalled` |
| Pas de manifeste pour Kaby, pas de lien profond | un seul manifeste ; la page charge DSH par `frame.src = '/'` | `phone.mjs:288` |
| Service worker | portée `/` ; laisse passer `/sw.js`, `/ws` et tout chemin qui commence par `/__kb` ; confie le reste à la page téléphone, qui le chiffre pour l'ordinateur ; cache `kbmr-assets-v1` pour les fichiers à empreinte | `sw.js:41-50`, `sw.js:68` |
| L'appairage vit dans IndexedDB | base `kb-mobile-remote`, clé `phone` ; **un seul appairage par origine** | `phone.mjs:71-72`, `phone.mjs:165-166` |
| Origine | **une seule** (décision du 12 octobre) : `https://phone.kybernos.app` en production ; l'hôte par appairage (`{sid}.…`, certificat générique) est pris en charge par le code et pas retenu | ADR 0047 § 6 et § 9, `phone.ts` |
| Fichiers épinglés | six : `index.html`, `phone.mjs`, `remote-e2e.mjs`, `manifest.webmanifest`, `icon.svg`, `sw.js` ; le serveur les sert à l'octet près sous `/__kb/…` et `/sw.js` ; **la table des chemins est exacte** (`FILES`) : `/__kb/kaby/` répond 404 aujourd'hui | `phone.ts`, ADR 0047 § 6 |
| La copie du serveur a du retard | `phone.mjs` : empreinte serveur `e5aaa47e…`, plugin `670b372a…` ; deux écarts : les textes du scan (« Réglages › Mobile » contre « menu du compte › Téléphone et canaux ») et la reprise après trois trames perdues (correctif du 13 octobre). `test/remote-phone.test.ts` : 3 réussis, 1 échoué (« même octets qu'un dépôt plugins »), mesuré aujourd'hui. Les cinq autres fichiers sont identiques | comparaison `shasum`, `vitest` |
| Route de Kaby | `GET /kybernos-cloud/kyby/native` répond `{ sessionId (ou null), cwd }` ; `kyby/native/set` demande l'origine et le cookie de session de DSH ; aucune des deux n'est dans la liste des refus pour un téléphone | `kybernos-cloud/index.js:4962`, `:5003-5004`, `remote-host.mjs:36-45` |
| Ouvrir la conversation de Kaby | `openChat()` lit le pointeur, crée la conversation si elle manque (dans un espace de travail à elle, en mode « workspace-write, ask »), puis `uiSvc.openSession(sid)` | `kybernos-kyber/client.js:664-696` |
| DSH (0.2.1-rc.2) n'a pas d'adresse par session | URL du vrai DSH : `http://127.0.0.1:3080/` ; clés `dsh.sessions.current`, `dsh.conversation.session-<id>`, `dsh.workspace.view.v5` ; `openSession(target)` est « une action de navigation » de l'interface | lecture seule du vrai DSH, README de `dsh-client-ui-workspace` |
| Ordinateur éteint | texte « Ton ordinateur est hors ligne » ; reprise avec délai 1,5 s doublé jusqu'à 30 s ; bandeau « Ordinateur hors ligne, reconnexion… » si l'application tournait | `phone.mjs:18`, `:274-281` |
| Révocation | l'ordinateur retire le téléphone : le serveur ferme le canal des deux côtés (`revoked`) ; la page efface la clé et affiche « Ce téléphone n'est plus autorisé » ; elle **laisse** le service worker, le cache des fichiers de DSH et le `localStorage` de DSH | `phone.mjs:165-171`, ADR 0047 § 3 et § 5 |
| Nombre de téléphones | 3 par défaut (`remote_max_devices_per_user`), 5 minutes de vie pour un code | ADR 0047 § 2, `service.ts:17` |

## 3. Réponses détaillées

### 3.1 Deux PWA distinctes sur la même origine

- **Identité.** MDN : un `id` qui ne correspond à aucune application installée est une application distincte, même servie par la même URL ; le même `id` remplace le manifeste existant. Sans `id`, il vaut `start_url`. Mesuré : `/__kb/` et `/__kb/kaby/` donnent deux identifiants différents.
- **Manifestes proposés.** « Kybernos à distance » : `id` et `start_url` `/__kb/`, `scope` inchangé. « Kaby » : `id`, `start_url` et `scope` `/__kb/kaby/`. Chaque page a son propre `<link rel="manifest">` statique : le bouton « Installer » de Chrome et l'ajout à l'écran d'accueil d'iOS lisent le manifeste du document affiché. Changer le manifeste par script est possible sous Chrome, pas vérifié sous Safari : on ne s'y fie pas.
- **Service worker.** Il reste unique, de portée `/`. Mesuré : une seule inscription, les trois pages d'essai (la page actuelle, une variante avec des icônes PNG, la page de Kaby) sont contrôlées. Il passe `/__kb*` sans le traduire, donc la page `/__kb/kaby/` marche sans toucher `sw.js`. À noter : `tunnel()` prend **la première fenêtre** sous `/__kb` comme page téléphone (`sw.js:68`) ; avec deux applications ouvertes à la fois, voir le risque R2.
- **Portées emboîtées.** `/__kb/kaby/` est dans la portée `/` de l'autre application. MDN ne dit rien du cas de deux applications installées aux portées emboîtées. Risque faible (personne n'ouvre de lien dans ces applications : le QR code ouvre un navigateur) mais non vérifié ; restreindre la portée de la première à `/__kb/` aide peu (elle contient encore `/__kb/kaby/`). Deux portées disjointes demanderaient de déplacer l'une des pages, ce qui change l'adresse du QR code : à éviter.
- **Hôte par appairage.** Chaque hôte a son service worker, son stockage et son icône d'écran d'accueil. Les deux applications d'un même appairage partagent l'hôte, donc tout ce qui précède s'applique tel quel. Deux ordinateurs auraient chacun deux icônes de même nom : le manifeste est un fichier épinglé, il ne peut pas porter le nom de l'ordinateur sans devenir dynamique. Aucun effet avec l'origine unique retenue.
- **Android (Chrome).** La page doit avoir été cliquée et regardée 30 s avant que Chrome n'émette `beforeinstallprompt` (web.dev, mise à jour le 19 septembre 2024). Juste après un appairage ce délai est probablement atteint, pas garanti : prévoir le texte de repli « Menu ⋮ › Installer l'application ». L'événement n'est pas standard (MDN : « disponibilité limitée »). Le stockage d'une application Chrome installée est celui du profil Chrome (web.dev, « WebAPKs on Android », 2017 ; Chromium) : l'appairage suit.
- **iPhone (Safari).** Ajouter à l'écran d'accueil est dans le menu Partager ; les autres navigateurs le proposent depuis iOS 16.4 avec une autorisation (WebKit, 16 février 2023). Depuis iOS 26, tout site ajouté s'ouvre en application web par défaut (WebKit, 9 juin 2025). Le manifeste est lu depuis iOS 15.4 ; `apple-touch-icon` passe devant. `id` est pris en charge depuis iOS 16.4. **Stockage séparé de Safari** (Apple, WWDC 2023, séance 10120) ; sur Mac Safari copie les cookies à l'ajout, **pas** le reste du stockage local. Que deux applications d'un même site partagent leur stockage entre elles n'est pas documenté : à mesurer (§ 7).

### 3.2 Comment « Kaby » ouvre la conversation de Kaby

1. L'application Kaby démarre sur `/__kb/kaby/` : la page téléphone habituelle (mêmes `phone.mjs` et `remote-e2e.mjs`), avec son manifeste. Elle charge DSH dans le cadre, comme aujourd'hui.
2. Dans le cadre, le plugin `kybernos-kyber` (ouvert, non épinglé) détecte qu'il tourne dans l'application Kaby : même origine, donc `window.parent.location.pathname === '/__kb/kaby/'` est lisible. Aucune modification de la page téléphone n'est nécessaire pour cela.
3. Une fois l'interface prête, il appelle `openChat()` : il lit `GET /kybernos-cloud/kyby/native`, crée la conversation de Kaby si c'est la première fois, puis `uiWorkspace.openSession(sid)`. Toute erreur est avalée (règle 2 d'`AGENTS.md`).
4. La reprise de DSH au démarrage (la session notée dans `dsh.sessions.current`) ne doit pas reprendre le dessus. La documentation de DSH dit qu'une navigation ultérieure annule la sélection de démarrage : à vérifier en pratique, avec la limite que les deux applications d'un même stockage (Android) partagent cette clé. La première application rouvre alors la dernière conversation vue, qui peut être celle de Kaby : gêne, pas défaut.
5. Sur le téléphone, cette conversation passe par la même liaison chiffrée que le reste. Une application « Kaby » **n'est pas un droit plus petit** : le tiroir de DSH mène à tout. Un mode Kaby sans tiroir serait cosmétique tant que l'ordinateur n'impose pas lui-même une limite (ce que DSH ne sait pas faire par conversation). Il ne faut pas le présenter comme une protection.
6. **Dépendance** : le principe « accord demandé quand la commande ne vient pas du clavier » (document des décisions, § 2, encore « proposé ») et l'étape 3 du plan (porte d'approbation du chat natif de Kaby) devraient précéder l'application Kaby. Elle ouvre la porte d'un chat qui, aujourd'hui, n'a que le mode « workspace-write, ask » posé à la création.

### 3.3 Ordinateur éteint, et ce qu'on dit

- **Ce que le code fait déjà** : « Ton ordinateur est hors ligne / Allume-le et ouvre Kybernos : la connexion reprend toute seule. », reprise automatique, bouton « Réessayer ». Dans l'application ouverte : bandeau « Ordinateur hors ligne, reconnexion… ».
- **Pour Kaby** : « Kaby est sur ton ordinateur. Il est éteint, ou Kybernos n'est pas ouvert. Allume-le : la connexion reprend toute seule. » (chaînes de `phone.mjs`, épinglé).
- **Ce qu'on ne dit pas** : un ordinateur cloud s'ouvre depuis le compte par un ticket de 60 s (ADR 0052 § 11) ; le téléphone n'a aucun identifiant de compte (ADR 0047 § 1), il ne peut ni ouvrir ce ticket ni savoir qu'un ordinateur cloud existe. Il ne sait pas non plus si Telegram est relié, ni si Kaby y répond ordinateur éteint (cela dépend de l'ordinateur choisi pour Kaby, `kybernos-kyber/README.md`). Une ligne « écris à Kaby sur Telegram » n'est possible que si **l'ordinateur l'a dit à la liaison** (un champ de plus dans la trame `ready`, hors v1). Sans cela, aucune ligne.

### 3.4 Où et quand proposer

- **Quand** : au premier passage à l'état « connecté » après un appairage réussi, **avant** de montrer DSH. Pas à chaque ouverture, pas dans une application déjà installée (`display-mode: standalone` ou `navigator.standalone`, web.dev). « Plus tard » est mémorisé (clé à un nom de la page, dans le `localStorage` partagé avec DSH, donc nommée avec soin) ; on ne repropose pas avant des jours.
- **Android** : deux cartes (« Kybernos à distance », « Kaby ») avec « Installer ». Le premier bouton déclenche la fenêtre native. Kaby est une autre page : le bouton y mène, puis la fenêtre native s'y propose. Si l'événement n'est pas arrivé, l'explication du menu ⋮.
- **iPhone** : deux cartes avec « Comment faire » : (1) Partager, en bas de Safari ; (2) « Sur l'écran d'accueil », puis « Ajouter » ; (3) ouvrir l'icône et **coller le lien de liaison**, parce que l'application ne connaît pas l'appairage. Le meilleur ordre est d'**installer avant d'appairer** : le QR code ouvre Safari avec le secret dans le fragment, la page le copie sur demande dans le presse-papiers, la personne installe, ouvre l'icône, colle. Un seul appairage, un seul code (valable 5 minutes, usage unique). Le contrôle des 4 chiffres reste sur l'ordinateur.
- **Seconde chance** : un rang « Installer sur l'écran d'accueil » dans la page Réglages › Téléphone et canaux **telle qu'elle s'affiche sur le téléphone** (plugin `kybernos-mobile`, non épinglé ; il demande à la page téléphone de rouvrir l'invitation par `postMessage`, un petit gestionnaire de plus dans `phone.mjs`).
- **Sur l'ordinateur** : la fenêtre « Téléphone et canaux » est faite par une autre session. Seule une phrase y est suggérée : « Sur le téléphone, installe l'application après la liaison. » Rien n'est touché.

### 3.5 Notifications push (hors périmètre)

Ce qu'il faudrait, avec un relais qui ne lit pas le contenu :

- **Une souscription** : le téléphone la crée (adresse du service de push, clé ECDH, secret d'authentification). RFC 8291 : le contenu du message est chiffré avec ces clés pour que le service de push ne puisse pas le lire. **Qui envoie** est la vraie décision. P1 : **l'ordinateur** envoie (il reçoit la souscription par le canal chiffré, génère la paire VAPID, poste lui-même chez le service de push) : le serveur Kybernos n'est pas dans le chemin et ne voit rien ; cela ne marche que pendant que l'ordinateur tourne, c'est-à-dire quand l'agent tourne. P2 : **le serveur** envoie un réveil générique (l'ADR 0047 § 9 dit déjà que c'est tout ce qu'il peut faire) ; il faut alors stocker les souscriptions (une table, rétention, export, suppression : ADR 0012) et décider de ce que « générique » dit.
- **Le service worker** : un gestionnaire `push` et `notificationclick`, donc un changement de `sw.js` (épinglé) ; ou le Declarative Web Push d'iOS 18.4 (WebKit, 27 mars 2025), qui s'en passe mais fixe le format.
- **Toujours une notification visible** : WebKit interdit le push silencieux ; Chrome et Edge exigent `userVisibleOnly: true` (MDN). Chaque push doit donc afficher quelque chose, même générique (« une action attend ton accord »).
- **iPhone** : la permission ne s'offre que dans une application de l'écran d'accueil, sur un geste de la personne (WebKit, 16 février 2023). **Installer est donc un préalable au push iPhone.**
- **À la révocation** : se désabonner et que l'ordinateur oublie la souscription.
- **Coût estimé** : 6 à 10 jours, hors décision. **Ce qu'on perd sans push** : rien n'alerte quand l'application est fermée ; le système suspend la page, la connexion tombe, elle ne repart qu'à l'ouverture. Les accords à donner et la fin d'une longue tâche se découvrent en ouvrant l'application. Kaby n'écrit jamais le premier (décision du 19 octobre pour les canaux) : la perte porte surtout sur les accords.

### 3.6 Sécurité

- **Surface** : aucun service worker de plus (mesuré). Deux fichiers statiques de plus (`kaby.html`, `kaby.webmanifest`), sous la même politique de sécurité (`script-src 'self'`, `frame-ancestors 'none'`, `manifest-src 'self'`) : elle doit s'appliquer aussi à `/__kb/kaby/`, aujourd'hui elle est posée pour `/__kb/` seul (`phone.ts`). `remote-e2e.mjs` (la cryptographie) et `sw.js` ne changent pas dans les étapes 1 à 5.
- **La limite de l'ADR 0047 § 6 ne bouge pas** : la page vient d'un hôte web, le chiffrement protège du relais et pas d'un hôte web hostile. Une application installée reçoit les corrections au lancement suivant (fichiers `no-store`, vérification du service worker) comme un onglet. Elle cache en revanche la barre d'adresse : la personne ne lit plus l'origine. Raison de plus de ne rien demander de plus que le lien à coller, qui ne part vers aucun serveur.
- **L'application installée garde-t-elle l'appairage ?** Android : oui, même stockage que Chrome (à confirmer). iPhone : non, stockage séparé (Apple) ; elle fait son propre appairage, donc **une ligne de plus dans la liste des téléphones** (trois au maximum par défaut) et un libellé à distinguer (`deviceLabel()` ne dit pas l'application ; en mode autonome l'agent utilisateur perd peut-être « Safari », non vérifié). À l'inverse, **un onglet Safari peut perdre son appairage** : Safari efface IndexedDB, les inscriptions de service worker et leurs caches après sept jours d'usage de Safari sans interaction avec le site ; une application de l'écran d'accueil a son propre compteur (WebKit, 24 mars 2020 : la règle est de 2020, pas relue pour 2026). Installer protège donc aussi la liaison.
- **Si le téléphone est retiré** : le serveur oublie l'adresse du canal et ferme les deux bouts ; l'application affiche « n'est plus autorisé » et efface la clé. L'icône reste à l'écran jusqu'à ce que la personne la retire. À corriger (épinglé, petit) : `revoked()` laisse le service worker, le cache et le `localStorage` de DSH. Sur Android, retirer un téléphone retire les deux applications ; sur iPhone, chaque application est une liaison à retirer.

## 4. Ce qui manque

1. Une seconde page et un second manifeste, servis par le serveur (table `FILES`, politique de sécurité, empreintes).
2. Une icône pour Kaby et des icônes utilisables sur iPhone. `garde-depot` interdit les `.png` suivis dans git : voir la décision D4.
3. L'écran d'invitation, ses chaînes en français et en anglais, la mémoire de « Plus tard », la détection du mode autonome.
4. Un moyen de se relier **dans** l'application sur iPhone (coller le lien).
5. Les textes propres à Kaby (hors ligne, retiré).
6. Le pont dans `kybernos-kyber`, ses tests et une extension de `scripts/check-mobile-remote-live.mjs`.
7. Le rattrapage de la copie serveur de `phone.mjs` (deux écarts non décidés).
8. Le nettoyage à la révocation et un libellé d'appareil par application.

## 5. Découpage proposé et coût

Estimations en jours d'une personne, tests et relecture des fichiers épinglés comprise, **jamais mesurées** (aucune n'a été chronométrée sur une étape de ce type).

| Étape | Contenu | Fichiers | Coût | Terminé quand |
|---|---|---|---|---|
| **0. Mesure sur appareils** | un hôte d'essai, deux manifestes, un iPhone et un Android du propriétaire (liste du § 7) ; aucun code produit | aucun dans le dépôt | 0,5 à 1 j | chaque ligne du § 7 a une réponse ; le § 3 est corrigé là où elle contredit |
| **1. Rattrapage de la copie serveur** | décider les deux écarts de `phone.mjs`, nouvelles empreintes, ligne dans l'ADR | serveur : `test/remote-phone.test.ts`, ADR 0047 | 0,25 j | `remote-phone.test.ts` passe en entier |
| **2. La seconde application** | `kaby.html`, `kaby.webmanifest`, `id`, noms, icônes (D4), table `FILES`, politique de sécurité, relais de test, vérifications en direct | plugins `phone/` (3 nouveaux, 2 modifiés), serveur `phone.ts` + test + ADR | 1,5 j | Chrome voit deux applications d'`id` différents sur le serveur de test ; le test d'épinglage connaît les nouveaux fichiers |
| **3. Kaby s'ouvre sur sa conversation** | le pont, attente de l'interface prête, tests unitaires et en direct sur le DSH d'essai ; **après** l'étape 3 du plan des décisions | plugin `kybernos-kyber` (non épinglé) | 1,5 j | dans `/__kb/kaby/`, la conversation de Kaby s'ouvre seule, sans que la reprise de DSH la remplace |
| **4. L'invitation** | écran après approbation, bouton Chrome, explication iPhone, « Plus tard », mode autonome, textes Kaby, fr/en | plugins `phone/index.html`, `kaby.html`, `phone.mjs` | 2 j | les cinq écrans de la maquette existent sur le DSH d'essai, clair et sombre, 390 px |
| **5. iPhone : se relier dans l'application** | état « coller le lien », copie depuis Safari avant l'installation, libellé par application ; **variante** : scanner dans l'application = +3 à 4 j et un décodeur de QR dans la page qui tient les clés | `phone.mjs` (+ éventuel fichier de plus) | 1,5 j (coller) | l'installation puis l'appairage de bout en bout sur un iPhone réel |
| **6. Ménage** | `revoked()` vide service worker, cache et `localStorage` ; seconde chance dans Réglages (plugin) | `phone.mjs`, `kybernos-mobile` | 0,5 j | un téléphone retiré ne laisse que l'icône |
| **7. Push** (hors périmètre) | § 3.5 | `sw.js`, `remote-e2e.mjs` ou la trame `ready` | 6 à 10 j | à décider |

**Version 1 Android** : étapes 1 à 4, environ 5,25 j. **Avec l'iPhone** : + étape 5, environ 6,75 j. L'étape 0 vient d'abord et peut déplacer ces chiffres.

## 6. Risques

- **R1. iPhone sans appairage dans l'application.** Si rien n'est prévu pour se relier dedans, l'application installée est une coquille qui demande de scanner et ne le peut pas. C'est l'écart entre « la PWA existe » et « la PWA marche ». Réponse : étape 5 avant de proposer l'installation sur iPhone.
- **R2. Deux applications ouvertes en même temps, une seule liaison (Android).** Le relais accepte une connexion téléphone par adresse et en remplace la précédente ; `tunnel()` prend la première fenêtre sous `/__kb`. Deux fenêtres actives se chasseraient (« Connexion perdue, reconnexion… » en boucle). En pratique une seule est au premier plan ; non mesuré. Repli : une adresse par application (une liaison de plus, deux lignes dans la liste).
- **R3. Deux liaisons sur iPhone** si les deux applications ont chacune leur stockage : deux codes, deux contrôles, deux lignes parmi trois places.
- **R4. Une application Kaby qui ouvre un chat sans porte d'approbation** (étape 3 du plan). À ne pas proposer avant.
- **R5. Pas de scanner dans l'application, pas de lien profond.** Les liens ouverts depuis l'appareil photo vont au navigateur ; que l'application installée les capte n'est pas documenté (non vérifié).
- **R6. Changer un fichier épinglé qui tient les clés.** Le dernier changement de `phone.mjs` a eu une relecture humaine de 29 lignes ; le reste n'en a pas eu (ADR 0047 § 6). L'étape 4 et 5 ajoutent de quoi relire : garder le diff petit et séparé de la logique de clé.
- **R7. Icône SVG seule.** Sans effet pour Chrome de bureau (mesuré) ; iPhone préfère `apple-touch-icon` et n'a pas de SVG documenté ; Android : minting d'un WebAPK non vérifié.
- **R8. Les noms** : le manifeste est statique, la langue de la personne ne l'est pas. « Kybernos à distance » en français s'affiche aussi à un anglophone.
- **R9. Un onglet qui perd son appairage au bout de 7 jours** (iPhone, règle de 2020) : c'est le cas actuel de la page téléphone, avant toute application.

## 7. Ce qui n'est pas vérifié

Chaque ligne est un test de l'étape 0.

| # | Question | Pourquoi on ne sait pas | Test |
|---|---|---|---|
| 1 | Sur iPhone, les deux icônes de la même origine partagent-elles leur stockage ? Une icône voit-elle celui de Safari ? | Apple dit « séparé du navigateur » ; rien sur deux applications du même site ; sur Mac, plusieurs instances servent à séparer travail et privé | deux manifestes sur un hôte d'essai, écrire une clé IndexedDB dans l'un, la lire dans l'autre et dans Safari |
| 2 | Un lien ouvert par l'appareil photo ou par Messages va-t-il à l'application installée ? | pas de page officielle lue | scanner un QR code de l'hôte d'essai avec l'application installée |
| 3 | iPhone : lecture du presse-papiers en mode autonome, icône (SVG, PNG, `apple-touch-icon`), nom coupé, `navigator.standalone`, libellé d'appareil | non documenté ou non lu | idem |
| 4 | Android : l'application installée voit-elle l'IndexedDB de Chrome (Chrome actuel, Android actuel) ? WebAPK avec une icône SVG seule ? | page de 2017 ; l'installabilité mesurée l'est sur Chrome de bureau, sans interface (headless) | idem sur un Android |
| 5 | Android : `beforeinstallprompt` arrive-t-il après un appairage (30 s de présence) ? | règle de web.dev, pas mesurée sur ce flux | chronométrer |
| 6 | Deux applications ouvertes en même temps sur une adresse : saccades ? | lecture du relais, pas de mesure | deux fenêtres sur un Android, écran partagé |
| 7 | Portées emboîtées (`/` et `/__kb/kaby/`) : quelle application prend un lien ? | MDN ne dit rien | ouvrir un lien de la portée sur un Android avec les deux installées |
| 8 | Le pont de Kaby gagne-t-il sur la reprise de DSH au démarrage ? | la documentation dit qu'une navigation ultérieure annule la sélection de démarrage, jamais essayé | live check sur le DSH d'essai |
| 9 | Un hôte web « Samsung Internet » ou Firefox pour Android installe-t-il comme Chrome ? | non lus | non nécessaire en v1 : texte d'explication générique |
| 10 | La règle de sept jours de Safari est-elle encore celle de 2026 ? | billet de 2020 | page de WebKit actuelle |
| 11 | Kaby sur Telegram répond-il ordinateur éteint ? | dépend de l'ordinateur choisi pour Kaby | hors de cette étude ; aucune ligne tant que l'ordinateur ne le dit pas |
| 12 | Des hôtes par appairage avec deux icônes de même nom | nom du manifeste statique | sans objet avec l'origine unique |

## 8. Changements aux fichiers épinglés (décisions du propriétaire)

Aujourd'hui épinglés par empreinte (ADR 0047 § 6, `test/remote-phone.test.ts`) : `index.html`, `phone.mjs`, `remote-e2e.mjs`, `manifest.webmanifest`, `icon.svg`, `sw.js`. **Les empreintes nouvelles ne se calculent qu'à la construction** ; ci-dessous, ce qui change, par fichier. Chaque ligne appelle de nouvelles empreintes et une ligne dans l'ADR.

| Fichier | Étape | Changement | Taille probable |
|---|---|---|---|
| `phone/phone.mjs` | 1 | **rattrapage** : textes du scan (menu du compte › Téléphone et canaux) et reprise après trois trames perdues. Relecture humaine requise, le fichier tient les clés | déjà dans le dépôt plugins |
| `phone/phone.mjs` | 4, 5, 6 | écran d'invitation ; mode autonome ; mémoire de « Plus tard » ; textes propres à Kaby (hors ligne, retiré) ; état « coller le lien » ; libellé d'appareil par application ; `revoked()` qui vide service worker, cache et `localStorage` ; écoute du message « rouvre l'invitation » | 80 à 150 lignes |
| `phone/index.html` | 2, 4 | styles et balisage de l'invitation ; `apple-touch-icon` si D4 le permet | 30 à 60 lignes |
| `phone/kaby.html` (**nouveau**) | 2 | copie de `index.html` avec un autre `<link rel="manifest">`, un autre `<title>`, un `data-app="kaby"` ; un test vérifie qu'ils ne diffèrent que de ces lignes | 46 lignes |
| `phone/kaby.webmanifest` (**nouveau**) | 2 | `id`, `start_url` et `scope` `/__kb/kaby/`, nom, icônes | ~12 lignes |
| `phone/manifest.webmanifest` | 2 | `id` `/__kb/`, nom (D3), `short_name`, description, icônes (D4) | ~5 lignes |
| `phone/icon.svg` | 2 | inchangé, ou remplacé si D4 le décide ; une icône de Kaby est un fichier de plus | – |
| `phone/sw.js` | 1 à 6 | **aucun changement** ; il en faudrait pour le push (étape 7) | 0 |
| `remote-e2e.mjs` | 1 à 6 | **aucun changement** | 0 |

Non épinglé mais à changer en même temps : serveur `src/modules/remote/phone.ts` (deux chemins de plus dans la table, la politique de sécurité de `/__kb/` aussi sur `/__kb/kaby/`, la liste `PHONE_FILES` qui en dépend), `test/remote-phone.test.ts`, ADR 0047 § 6 (une ligne par fichier), `docs/runbooks/remote.md` ; plugins `remote-fake-relay.mjs` (même table de chemins), `scripts/check-mobile-remote-live.mjs`, `packages/kybernos-kyber` (le pont), `packages/kybernos-mobile` (rang des Réglages).

## 9. Recommandation et décisions qui reviennent au propriétaire

**Recommandation : faire les deux applications, dans cet ordre.** L'étape 0 d'abord (une demi-journée à une journée avec les deux téléphones) parce qu'elle décide de la forme iPhone ; puis le rattrapage (étape 1), qui est nécessaire quoi qu'on décide ; puis la seconde application et le pont (étapes 2 et 3) ; puis l'invitation (étape 4). **Android d'abord**, où l'appairage suit l'installation et où la fenêtre native fait le travail. **iPhone en second**, avec « installer avant d'appairer » et un lien à coller : ne pas proposer l'installation sur iPhone tant que l'application ne peut pas se relier elle-même. **Pas d'application Kaby avant l'étape 3 du plan** (porte d'approbation du chat natif). Ne toucher ni `sw.js` ni `remote-e2e.mjs`.

Décisions, avec ma proposition par défaut :

1. **D1. Deux pages et deux manifestes sur l'origine unique** (plutôt qu'une application avec un raccourci Kaby, qui est plus petite mais ne donne qu'une icône). Par défaut : oui.
2. **D2. Décider le rattrapage de la copie serveur de `phone.mjs`**, dont la reprise après trois trames perdues (relecture humaine du correctif du 13 octobre). Par défaut : oui, avant tout le reste.
3. **D3. Noms et langues.** « Kybernos à distance » et « Kaby » en français ; en anglais « Kybernos Remote » ? `short_name` à choisir (iPhone coupe). Un manifeste par langue ou un nom neutre.
4. **D4. Icônes.** `garde-depot` interdit les `.png` suivis. Options : (a) SVG seul (risque iPhone et WebAPK) ; (b) le serveur rend les PNG depuis le SVG à son démarrage ; (c) PNG en base64 dans un fichier texte, qui contourne la règle sans la respecter : déconseillé. Par défaut : (b) si le serveur a déjà de quoi rendre une image, sinon (a) et mesure à l'étape 0.
5. **D5. Une liaison ou une par application.** Par défaut : partagée sur Android ; une par application sur iPhone (imposé par Apple si le test 1 le confirme). Bascule sur « une par application » partout si le test 6 montre des saccades.
6. **D6. iPhone : coller le lien** (par défaut, 1,5 j) **ou scanner dans l'application** (+3 à 4 j, un décodeur de QR dans la page qui tient les clés, relecture).
7. **D7. Ordre avec le plan de phase 1** : l'application Kaby après l'étape 3 (porte d'approbation), l'application « à distance » peut sortir avant.
8. **D8. La ligne Telegram de l'écran « éteint »** : par défaut, aucune ligne. Elle demande un champ dans la trame `ready` envoyé par l'ordinateur.
9. **D9. Le push** : hors de la v1, à reprendre avec le choix P1 (l'ordinateur envoie) ou P2 (le serveur envoie un réveil).

## 10. Sources

Pages officielles, lues le 19 octobre 2026 (dates de publication entre parenthèses) :

- Apple, WWDC 2023, séance 10120 : cookies et stockage séparés pour une application de l'écran d'accueil ; Safari copie les cookies à l'ajout sur Mac, pas le stockage local ; plusieurs instances d'un site ; `id` : https://developer.apple.com/videos/play/wwdc2023/10120/
- WebKit, « Web Push for Web Apps on iOS and iPadOS » (16 février 2023) : écran d'accueil requis, geste de la personne, `id` depuis 16.4, icônes depuis 15.4, `apple-touch-icon` prioritaire, ajout depuis d'autres navigateurs : https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WebKit, « WebKit Features in Safari 17.0 » (septembre 2023) : https://webkit.org/blog/14445/webkit-features-in-safari-17-0/
- WebKit, « News from WWDC25 » (9 juin 2025) : tout site ajouté s'ouvre en application web par défaut : https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- WebKit, « Meet Declarative Web Push » (27 mars 2025) : pas de push silencieux : https://webkit.org/blog/16535/meet-declarative-web-push/
- WebKit, « Full Third-Party Cookie Blocking and More » (24 mars 2020) : sept jours, IndexedDB, service workers et caches ; les applications de l'écran d'accueil ont leur propre compteur : https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- web.dev, « What does it take to be installable? » (mise à jour 19 septembre 2024) : critères de Chrome, 30 s de présence, icônes 192 et 512 : https://web.dev/articles/install-criteria
- web.dev, « How to provide your own in-app install experience » (14 février 2020) : `beforeinstallprompt`, `appinstalled`, détection du mode autonome : https://web.dev/articles/customize-install
- web.dev, « WebAPKs on Android » (21 mai 2017, ancienne) : données dans le profil Chrome : https://web.dev/articles/webapks
- MDN, membre `id` du manifeste : https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/id ; membre `scope` : https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/scope ; évènement `beforeinstallprompt` (« disponibilité limitée ») : https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event ; `PushManager.subscribe` : https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe
- RFC 8291, chiffrement des messages Web Push : https://www.rfc-editor.org/rfc/rfc8291.html

Dans le dépôt : `docs/dev/mobile-remote.md`, `packages/kybernos-mobile/README.md`, `docs/etudes/2026-10-19-kaby-phase-1-decisions-et-plan.md`. Dépôt serveur : ADR 0047 (liaison du téléphone, § 1 à 9), ADR 0052 § 11 et § 24 (ordinateurs, ticket), ADR 0053. Mesures du 19 octobre (hors dépôt) : installabilité et identifiants de deux manifestes dans Chrome 155 ; lecture seule de l'URL et des clés de stockage du vrai DSH ; échec de `test/remote-phone.test.ts` (1 sur 4) et empreintes des copies du serveur.
