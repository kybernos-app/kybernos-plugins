# messaging — pont DSH ↔ messageries

Relie une messagerie à ton **DeepSeek Harness local**, dans les deux sens :

- **entrant** : un message reçu déclenche une session DSH (une session par
  conversation, reprise à chaque message) ;
- **sortant** : la réponse — et la progression — revient dans le chat, et une
  commande permet aussi de pousser un message sans attendre une question.

**Aucun tunnel, aucun port ouvert, aucune URL publique.** La connexion à
Telegram est **sortante** (long polling `getUpdates`), exactement comme dsh-im.
Un tunnel ne deviendrait nécessaire que pour un mode webhook — inutile ici.

## Architecture

```
messaging/
├── core/
│   ├── config.mjs     # config résolue (.env, allowlist, chemins) — aucun secret copié
│   ├── state.mjs      # état persistant 0600 : chat → session DSH, allowlist, offset
│   ├── dsh-run.mjs    # `dsh --profile headless --json` + lecture NDJSON + délai/abandon
│   ├── runner.mjs     # le cœur : commandes, file d'attente, streaming, livraison
│   └── text.mjs       # découpage 4096, marqueurs [[send-file:…]], noms de fichiers sûrs
├── channels/
│   ├── telegram.mjs   # adaptateur Telegram (getUpdates, send/edit, pièces jointes)
│   └── CONTRACT.md    # contrat d'adaptateur : ajouter un canal sans toucher au cœur
├── bin/
│   ├── telegram-daemon.mjs  # le démon
│   └── telegram-send.mjs    # envoi proactif DSH → Telegram
└── test/                    # 40 tests : aucun réseau réel, un faux `dsh` et un faux Bot API
```

Le cœur ne connaît **aucune plateforme** : il parle au contrat de 4 méthodes
obligatoires (`name`, `start`, `send`, `edit`) et 2 optionnelles (`sendFile`,
`download`). Tout ce qui est spécifique à Telegram vit dans un seul fichier.

## Démarrage

```bash
cd /Users/miled/dyad-apps/dsh-kybernos/messaging

# configuration résolue (secrets masqués)
node bin/telegram-daemon.mjs --print-config

# le démon (un seul consommateur getUpdates par token)
node bin/telegram-daemon.mjs

# envoi proactif
node bin/telegram-send.mjs "message" [--file /chemin/rapport.pdf]
echo "depuis un pipe" | node bin/telegram-send.mjs
```

La configuration vit dans `~/.dsh/telegram-bridge/config.json` :

```json
{ "envFile": "/Users/miled/dyad-apps/kybernos/.env" }
```

Le token n'est **jamais copié** : il reste dans le `.env` existant (ou
`TELEGRAM_BOT_TOKEN`) et n'est lu qu'en mémoire.

## Le faire tourner en permanence (macOS)

Un simple `&` ou un job de fond de DSH **ne suffit pas** : le processus meurt
avec la session qui l'a lancé, et un message reçu à ce moment-là est perdu
(constaté le 21/09/2026). Sur macOS, la façon robuste est un **LaunchAgent** :

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.kybernos.telegram-bridge.plist
launchctl print gui/$(id -u)/app.kybernos.telegram-bridge | grep -E 'state|pid'
tail -f ~/.dsh/telegram-bridge/daemon.log
```

Le plist fourni démarre au login (`RunAtLoad`), redémarre après un crash
(`KeepAlive.SuccessfulExit = false`, donc **pas** après un `SIGTERM` propre), et
fixe `PATH` — launchd n'hérite pas du shell, d'où `dshBin` en chemin absolu dans
`config.json`. Journaux : `~/.dsh/telegram-bridge/daemon.log` et `daemon.err.log`.

Arrêt : `launchctl bootout gui/$(id -u)/app.kybernos.telegram-bridge`.

**Garantie de livraison.** L'offset Telegram n'est confirmé qu'**après**
traitement complet du message : un crash en cours de tour laisse donc le message
non confirmé, et Telegram le relivre au redémarrage (au-moins-une-fois) au lieu
de le perdre en silence. Contrepartie assumée : un message peut être traité deux
fois si le crash survient après le tour mais avant la confirmation.

## Commandes dans le chat

| Commande | Effet |
|---|---|
| `/new` | la conversation repartira sur une session DSH vierge |
| `/status` | canal, session courante, dossier de travail, file, dernier tour, durée du démon |
| `/help` | rappel des commandes |

Tout autre message part vers DSH. Les messages reçus pendant qu'un tour tourne
sont **mis en file** (5 par défaut) au lieu d'être perdus.

## Fichiers et images

- **Entrant** : photo, document, vocal, audio, vidéo sont téléchargés dans
  `<workspace du chat>/inbox/` et leur chemin est annoncé à DSH, qui peut les
  lire avec ses outils.
- **Sortant** : DSH termine sa réponse par `[[send-file:/chemin/absolu]]` (ou
  relatif à son dossier de travail) et le fichier part en pièce jointe ; le
  marqueur est retiré du texte. `telegram-send --file` fait la même chose hors
  session.

## Sécurité

1. **L'allowlist est la frontière.** Le démon refuse tout chat absent de
   `TELEGRAM_CHAT_ID`, `TELEGRAM_ALLOWED_CHATS`, `allowedChats` (config) ou
   `state.allowlist`, et le dit au chat refusé.
2. **Ce n'est pas une formalité** : `permission.defaultPreset` vaut
   `danger-full-access` dans ce `settings.yaml` — un message autorisé peut
   exécuter des outils sans bac à sable. Bot public = RCE pour qui trouve
   l'identifiant du bot. Garde le bot privé.
3. `--allow-all` existe mais refuse par défaut ; il est journalisé comme
   dangereux.
4. L'état est écrit en **0600**, l'offset Telegram est persisté (pas de rejeu
   après redémarrage), les journaux ne contiennent que des identifiants de chat
   et jamais de token.
5. Un webhook déjà posé sur le bot fait échouer le `getUpdates` en **409** : le
   démon s'arrête avec un message explicite plutôt que de boucler.

## Tests

```bash
cd messaging && npm test        # 40 tests, aucun accès réseau réel
```

Le faux `dsh` (`test/fixtures/fake-dsh.mjs`) reproduit le flux NDJSON réel et
les cas d'échec, de lenteur et de marqueur de fichier ; le faux Bot API vérifie
le long polling, la dénormalisation des messages, le 409 webhook, l'édition
« not modified » et les envois `sendPhoto`/`sendDocument`.

## Ajouter un autre canal

1. Écrire `channels/<canal>.mjs` exportant `create<Canal>Adapter(options)` avec
   les 4 (ou 6) membres de [`CONTRACT.md`](channels/CONTRACT.md).
2. Préférer un transport **sortant** (WebSocket, Socket Mode, long polling).
3. Lancer un démon avec cet adaptateur : le cœur, les commandes, le streaming,
   la file et l'état sont déjà communs.

Pour du clé-en-main sur 11 canaux, `@xmanrui/dsh-im` reste l'option — à
condition de vérifier sa compatibilité (matrice déclarée jusqu'à DSH
`0.1.5-alpha.1`).

## Ce que ce pont n'est pas

- **Pas un canal Kybernos Cloud** : Kybernos Cloud fait l'auth (device code) et
  l'import du catalogue de modèles LiteLLM ; il ne route aucun message. Le pont
  profite simplement du modèle par défaut de `settings.yaml`.
- **Pas le webhook DSH** : `@deepseek-ai/dsh-webhook` +
  `dsh-webhook-github` sont un vrai ingress HTTP signé (donc reverse proxy TLS
  ou tunnel) et ne sont montés dans aucun profil par défaut ici.
