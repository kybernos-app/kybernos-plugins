# @local/kybernos-modeles-locaux — « Modèles locaux »

Le panneau du chantier du même nom (maquette validée : `docs/handoff/modeles-locaux/maquette-v1/`),
en pied de **Réglages → Models** : le harnais consomme le siège
`settings.models.footer` juste après la liste des fournisseurs et le bouton
« Ajouter un fournisseur » (mesuré 27/09 dans le lot client servi : le siège
« header » n'est plus rendu par personne — l'en-tête de kybernos-models non plus).

## Le parcours, câblé pour de vrai

1. **Détecter** — `GET /modeles-locaux/machine` (hôte) : chip + RAM (`sysctl`),
   Ollama (`ollama --version`), modèles tirés (`ollama list`). Cache 30 s,
   `?force=1` pour forcer.
2. **Recommander** — catalogue local (`client.js`, sources citées en en-tête)
   filtré par la RAM mesurée ; la recommandation = le plus grand modèle qui tient.
3. **Installer** — `POST /modeles-locaux/installer` : un seul job à la fois —
   `brew install ollama` (macOS, explicite) puis `ollama pull <id>` ; progression
   et octets lus sur la sortie du processus ; `POST /modeles-locaux/annuler` (SIGTERM).
4. **Brancher** — `remote.settings.mutate('llm-pi-ai', …)` (le canal de la page
   Models native) : déclare `providers['ollama-local']`
   (`api: openai-completions`, `baseURL: http://127.0.0.1:11434/v1`) et ses
   modèles (contexte 32768 éditable, `input` du catalogue). Retrait par modèle,
   route retirée quand la liste devient vide. Si le modèle n'apparaît pas dans
   le sélecteur : relance DSH (noté dans le panneau).

## Ce que le bundle n'écrit JAMAIS

Aucun fichier de configuration côté hôte : `cordis.patch.yml` du bundle ne porte
que l'insertion du plugin dans la pile (sans elle, le bundle est sauté au boot —
mesuré le 27/09, routes jamais montées) ; les écritures de réglages passent
toutes par le canal settings validé du harnais. Le catalogue de recommandations
ne s'installe pas tout seul — chaque téléchargement part d'un clic.

## Vérification

```bash
curl -s http://127.0.0.1:3080/modeles-locaux/machine | head -c 400   # après relance
node kybernos-sessions/garde.mjs --check                             # avant d'annoncer
KB_SHOT=/tmp/kml-gui.png node scripts/check-modeles-locaux-live.mjs  # 10/10 — panneau rendu,
                                     # détection réelle, reco sur qwen3.5:9b (Chrome headless
                                     # éphémère + cookie de session posé via CDP)
```
