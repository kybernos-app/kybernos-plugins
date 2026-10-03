# kybernos-computers — ordinateurs cloud pour les agents (half host, phase 1)

Backend d'exécution distant pour DSH : l'agent peut exécuter du code dans une
**sandbox cloud éphémère** (microVM [E2B](https://e2b.dev)) au lieu du poste
local. Modèle **BYOK** — bring your own key : l'utilisateur apporte sa clé E2B,
le calcul est facturé sur SON compte E2B, Kybernos ne gère aucun quota.

Phase 1 (half host) + carte de configuration : le **half host** — store de la
clé, cycle de vie des sandboxes (start / exec / write / read / stop), TTL
automatique, cap de sandbox simultanées — avec un **Config** exporté
(schemastery : `apiKey` role secret, `apiKeyEnv` credential-ref) qui fait
servir le namespace de réglages `kybernos-computers`. Le **half client**
injecte alors dans la page **Plugins** une carte de configuration native,
sur le modèle de « Web search » : champ « Clé API » qui écrit dans le store
de credentials (`remote.credentials`, jamais le fichier de réglages), badge
« une clé est configurée », « laisser vide pour conserver la clé actuelle ».

**Phase 4 : l'agent EMBARQUÉ (modèle Manus)** — template E2B `kybernos-dsh`
(Dockerfile dans `template-dsh/` : node 22 + dsh + settings câblés au proxy
Kybernos, secret injecté par envs) et l'outil `computer_task` : une mission
part à une microVM où tourne `dsh headless` avec la clé du client — les appels
LLM sont facturés au compte Kybernos, un seul aller-retour, aucun stdout
intermédiaire. Pièges mesurés : install locale + symlink (le `npm -g` du
builder E2B casse l'arbre), node ≥ 22 (sinon headless se tait), patch du
modèle par défaut au format `- id:`.

**Phase 3 : les outils agent** — `computer_start`, `computer_exec`,
`computer_write`, `computer_read`, `computer_stop`, `computer_pause` / `computer_resume` (gel betaPause E2B : CPU non facturé, disque conservé), `computer_list`, exposés
au modèle (même contrat `tools.register` que les outils mémoire de
kybernos-cloud, render dans `output.render`) : l'agent crée et pilote
lui-même ses microVM, sans toucher au poste. Reste : le sélecteur composer.

## Sécurité

- La clé E2B est un **secret de facturation** : elle vit dans le store de
  credentials (`~/.dsh/.credentials.yaml`, 0600) sous la référence
  `E2B_API_KEY` — jamais dans le client, jamais loggée, jamais renvoyée par
  une route (seul un booléen `keyPresent` sort).
- Toutes les routes sont same-origin (`guarded: true`), jamais cross-origin.
- Cap par défaut : **4 sandboxes simultanées**, TTL par défaut **15 min**
  (max 2 h, échéance réglable par sandbox). Le balayeur TTL arrête (kill)
  toute sandbox dont l'échéance est passée, même si le processus a redémarré.
- Le SDK `@e2b/sdk` est résolu depuis le `node_modules` du bundle, puis celui
  du profil ; en dernier recours il est **auto-installé** dans
  `~/.dsh/kybernos-computers/node_modules` (journalisé). Aucune dépendance
  n'est chargée tant qu'aucune route E2B n'est appelée.

## Routes locales (toutes POST sauf mention)

| Route | Rôle |
|---|---|
| `GET  /kybernos-computers/status` | état : clé présente, SDK dispo, nb de sandboxes |
| `POST /kybernos-computers/key/set` | pose la clé E2B (`{"key":"e2b_…"}`) dans le credential |
| `POST /kybernos-computers/key/clear` | retire la clé (et arrête les sandboxes locales) |
| `GET  /kybernos-computers/sandboxes` | sandboxes suivies localement (+ vérif vivantes) |
| `POST /kybernos-computers/sandboxes/start` | démarre une sandbox (`label?`, `ttlMs?`) |
| `POST /kybernos-computers/sandboxes/exec` | exécute une commande (`sandboxId`, `command`, `timeoutMs?`) |
| `POST /kybernos-computers/sandboxes/write` | écrit un fichier (`sandboxId`, `path`, `content`) |
| `GET  /kybernos-computers/sandboxes/read` | lit un fichier (`?sandboxId=&path=`) |
| `POST /kybernos-computers/sandboxes/stop` | arrête une sandbox (`{"sandboxId":…,"confirm":true}`) |

## Architecture visée (le plugin est la brique 1)

```
composer du chat ──► sélecteur d'environnement : Desktop | Cloud | E2B …
outils agent (computer_exec, computer_screenshot …) ──► contrat backend-agnostique
backends : desktop (cua-driver, déjà là) · e2b (ce bundle) · modal/blaxel (plus tard)
```

## Tests

```bash
npm test          # test-computers-host.mjs — SDK factice, aucune clé réelle requise
node --check index.js
```
