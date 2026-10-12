# @local/kybernos-free-llms — « Free LLMs »

Branche des modèles de langage **gratuits** sur DSH, sans compte ni clé API, via la
couche gratuite d'**OpenCode Zen**. Deux moitiés :

- **hôte (`index.js`)** — une passerelle locale (`/free-llms/v1/*`) qui reçoit une
  requête OpenAI ordinaire, la **réécrit** pour satisfaire le contrat de la couche
  gratuite, la transmet à `opencode.ai`, et renvoie la réponse en SSE compatible
  OpenAI. C'est cette passerelle que le fournisseur `opencode-free` vise.
- **client (`client.js`)** — le panneau « Free LLMs » (section Réglages dédiée) :
  liste les modèles gratuits, les branche sur DSH, et sonde la santé du verrou.

## Pourquoi une passerelle (et pas juste un fournisseur)

La couche gratuite d'OpenCode est verrouillée par un **contrat de requête strict** :
sans lui, elle répond `403 FreeTierError`. Mesuré barrière par barrière (2026-10-12,
bissection en live) — les quatre doivent être vraies **en même temps** :

| Barrière | Mesure |
|---|---|
| `User-Agent: opencode/<version>` (≥ 1.17) | obligatoire (426 en dessous) |
| `x-opencode-session` = `ses_` + 12 hex + 14 base62 | la forme est validée, pas la valeur |
| `stream: true` dans le corps | `stream:false` → 403 |
| tableau `tools` non vide, **vrais noms** `{bash, glob, grep, read}` | `[]` → 403, faux noms → 403, le quartet → 200 |

L'adaptateur `openai-completions` de DSH n'injecte ni `tools` ni de session par
requête — d'où la passerelle, qui fait exactement cette réécriture
(`gateway-contract.mjs`) puis transmet le reste **tel quel**. Aucun patch moteur.

## Ce que le bundle n'écrit JAMAIS

Aucun fichier de configuration côté hôte : `cordis.patch.yml` n'insère que le plugin
dans la pile. La route `opencode-free` du namespace `llm-pi-ai` est écrite **par la
GUI** (`remote.settings.mutate`), comme la page Models native. La seule trace disque
est le marqueur d'activation `~/.dsh/kybernos/free-llms.json`.

## Les deux garde-fous (design validé)

1. **Confidentialité** : les conditions de Zen indiquent que les prompts envoyés aux
   modèles gratuits **peuvent être conservés pour entraînement**. Le branchement
   n'est **jamais silencieux** : il faut cocher « J'ai compris… » avant « Brancher ».
2. **Pas de point de défaillance unique** : c'est un fournisseur **parmi d'autres**.
   L'activation automatique au premier lancement (`/free-llms/auto-enable`) ne se
   déclenche que si la personne **n'a aucun modèle qui marche déjà** (ni cloud, ni
   clé, ni local) **et** a accusé réception du point 1.

## Fragilité assumée

OpenCode durcit cette couche régulièrement (bascule du 17/09). Le panneau ne simule
rien : si le verrou refuse, la sonde affiche « Verrou refusé : `free_tier_locked` ».
Un modèle dont le protocole fil n'est pas servi rapporte `model_protocol_unsupported`
(ex. `jev-1.13-free`, `muse-spark-*` au 12/10) — c'est une propriété du modèle, pas
un verrou qu'on peut franchir.

## Vérification

```bash
node packages/kybernos-free-llms/test-contract.mjs    # 18 tests — contrat, profil, activation
node packages/kybernos-free-llms/test-gateway.mjs     # 5 tests  — réécriture + pliage SSE
node packages/kybernos-free-llms/poc/poc-pont.mjs     # PoC live : le vrai fil pi-ai vers opencode.ai
```

Le PoC (`poc/poc-pont.mjs`) est la preuve de bout en bout : il passe la **vraie**
sérialisation `openai-completions` de pi-ai (celle de DSH) vers la couche gratuite et
obtient de vraies réponses. Il tourne sur `127.0.0.1:8848` :

```bash
curl -s localhost:8848/v1/models
curl -s localhost:8848/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"mimo-v2.6-flash-free","messages":[{"role":"user","content":"Dis bonjour."}],"max_tokens":50}'
```

## Routes hôte

| Route | Rôle |
|---|---|
| `POST /free-llms/v1/chat/completions` | passerelle → opencode.ai (réécrit + SSE) |
| `GET /free-llms/v1/models` | liste gratuite live (OpenAI `list`) |
| `GET /free-llms/status` | liste + état d'activation (panneau) |
| `GET /free-llms/health?model=` | sonde le contrat complet sur un modèle |
| `POST /free-llms/enable` | branche la route (`acknowledged: true` requis) |
| `POST /free-llms/disable` | retire la route (garde l'accusé) |
| `POST /free-llms/auto-enable` | premier lancement, si aucun modèle perso + accusé |
