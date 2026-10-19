# Kaby, phase 1 : décisions prises et plan (19 octobre 2026)

Statut : décisions du propriétaire prises en conversation le 19 octobre 2026, plan proposé. **Rien n'est construit.** Ce document est le point d'entrée : le détail est dans les études citées en bas.

## 1. Décisions confirmées par le propriétaire

| Sujet | Décision |
|---|---|
| Nom et identité | « Second You » est abandonné partout. Kaby est le seul nom. |
| Canaux | Les canaux ne servent qu'à joindre **Kaby**, avec **un bot partagé par canal**. Pas de système de bots libre (le bot que chaque personne crée elle-même) en phase 1. |
| WhatsApp | Un seul numéro, celui de Kybernos, dédié à Kaby, relié par Baileys dans le serveur, comme **pont de bêta**. Service WhatsApp **séparé** de l'API, une seule instance. L'API officielle de Meta reste la cible. |
| Autres canaux | **Un canal à la fois.** WeChat plus tard, si le marché le demande et après lecture des conditions de Tencent. |
| Architecture | Le cœur ne connaît aucun canal ; un adaptateur à la fin. Le contrat prévoit deux sortes d'adaptateurs : par appel (Telegram, API WhatsApp) et par connexion maintenue (Baileys, WeChat iLink). |
| Appairage WhatsApp | Le plus simple possible : un bouton et un QR code, la personne envoie le message prérempli. Le code est caché sous « Ça ne marche pas ? ». |
| Accès | Pas de login et mot de passe séparés pour un ordinateur cloud (ADR 0052 § 24). Un **lien direct** dans la carte de l'ordinateur, qui passe par la connexion au compte. Les variables d'environnement de l'ADR 0052 § 24 restent prévues ; les secrets d'un pack seront limités à chaque script. |
| `dsh-im` | Reste **indépendant** : rien de chez nous ne l'importe, ne l'embarque ni ne le documente. |
| Paiements, hébergement, packs | Link différé (États-Unis et Canada seulement) ; pas de bascule vers Maritime, un essai d'une journée plus tard ; format de pack après le reste. |

## 2. Proposé, à confirmer

- L'entrée **« Téléphone et canaux »** dans le menu du compte, juste avant « Réglages » (à la place d'une icône à côté de la cloche).
- Le principe **« accord demandé quand la commande ne vient pas du clavier »** (téléphone relié, messagerie, chat natif de Kaby).
- La voix de Kaby **v0.2** (texte dans la conversation et dans la mémoire du projet), à ajuster après l'étape 0.
- La vue **« Personnes »** de l'admin : numéros masqués, nombre de messages, état, bloquer ; jamais le contenu des messages.
- Retirer `dsh-im` du profil réel une fois le test terminé (sauvegarde `package.json.bak-avant-dsh-im-20261019-125209`).

## 3. Plan, dans l'ordre

| Étape | Quoi | Terminé quand |
|---|---|---|
| 0 | Mesurer : dix mêmes questions à Kaby sur Telegram (serveur dev) et dans le chat natif | Les réponses sont gardées comme référence |
| 1 | **Gain immédiat : un seul Kaby.** Une identité courte, la même sur les deux corps ; retirer « Second You » et l'équipe Echo/Mira/Atlas du serveur (`kybers/service.ts`, `kybers/validate.ts`, `hosted/service.ts`) ; renommer les kybers existants (migration) | Les dix questions donnent la même voix des deux côtés |
| 2 | Petit jeu d'essais (10 à 20 cas) livré avec l'étape 1 | Il passe, et une règle d'injection ne perd jamais un cas |
| 3 | Élargir la porte d'approbation (`tools/pre-execute`) au chat natif de Kaby et aux sessions pilotées de l'extérieur | Une action lancée depuis le chat natif demande l'accord |
| 4 | Bloc « situation » à chaque tour (heure, canal généré depuis les capacités de la porte, ordinateur) | La ligne « canal » vient de l'adaptateur |
| 5 | Journal v1 (ajout en fin de tour), puis connaissance v1 (un dossier, extraction du texte des PDF) | « Qu'as-tu fait aujourd'hui ? » correspond aux lignes enregistrées |
| 6 | WhatsApp : rendre le code des canaux indépendant de Telegram (après la fusion de kybernos-server#230), adaptateur Baileys, service séparé, écran admin avec QR ; démarches Meta en parallèle | Un message WhatsApp reçoit une réponse de Kaby, le numéro se relie depuis l'admin |
| 7 | Page « Téléphone et canaux » (fenêtre, page de Réglages, bande de Kaby réduite aux états), variables d'environnement et lien direct de l'ordinateur cloud | La maquette v3 est reproduite dans DSH |

Plus tard : format de pack, essai Maritime, WeChat, iMessage (notre propre adaptateur si nécessaire).

## 4. Réserves à garder en tête

- Baileys contrevient aux conditions de WhatsApp : le numéro peut être bloqué sans préavis, et **tous** les utilisateurs WhatsApp perdraient Kaby d'un coup. Numéro dédié neuf, réponse seulement, jamais de message en premier, bêta annoncée.
- Les boutons d'approbation ne sont probablement pas fiables sur ce type de compte : réponse « 1, 2 ou 3 » en citant la question (à vérifier).
- Comment Instinct connecte WhatsApp n'est pas confirmé.
- Le trou de sécurité du chat natif de Kaby (aucune porte d'approbation) existe sur tous les systèmes, Windows compris.
- Non vérifié : ce que fait le moteur de l'équipe « Second You » envoyée par le serveur ; la maquette à l'écran ; l'existence de la révocation d'un téléphone depuis le compte web ; le comportement du Gate avec une adresse nue.

## 5. Pour le détail

- WhatsApp : `docs/dev/whatsapp-door-study-2026-10-19.md` (options, politique de Meta, tarifs, option E).
- Prompt, packs, paiements, hébergement : `docs/dev/kaby-packs-study-2026-10-19.md` (français : `2026-10-19-kaby-et-packs-etude-independante.md`).
- Maquette (page privée) : https://claude.ai/artifact/VjSMfbuhUQazfReyTt2Gxi
- ADR 0052 (§ 7 le port fournisseur, § 24 les variables d'environnement) et ADR 0053 (§ 13.1 le port de canal) de kybernos-server.
