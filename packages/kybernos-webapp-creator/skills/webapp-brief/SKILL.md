---
name: webapp-brief
description: "Cadrer une app web (Webapp Creator) en 2 à 5 questions fermées et produire le brief webapp.json — pages, entités, style, accès, slug. Use when the person asks to create an app, a site or a webapp (« crée-moi… », « je veux un site de… »)."
---

# webapp-brief — du besoin au brief, en cinq questions maximum

Le brief est le contrat de tout le reste : `webapp.json` posé dans le dossier de
l'app. Pas de brief, pas de build — `webapp-build` refuse de deviner.

## Le parcours

1. **Le cœur en une phrase.** Reformule : qui, quelle action, quelle donnée.
   Ex. « Un cabinet prend ses rendez-vous : les clients réservent un créneau. »
2. **2 à 5 questions FERMÉES** (des choix proposés, jamais « décrivez-moi… ») :
   - **Public** : qui ouvre le lien ? moi seul · mon équipe · mes clients · tout le monde ;
   - **Pages** : les 3 à 5 écrans (propose-les par métier, à cocher) ;
   - **Données** : les entités et 3 à 8 champs chacune ;
   - **Style** : 3 directions en une ligne (sobre · chaleureux · technique…) ;
   - **Accès** : lien à clé (défaut) ou public.
   Dès que c'est tranché, on arrête : jamais plus de 5 questions.
3. **Écrire `webapp.json`** dans le dossier de l'app :

```json
{
  "version": 1,
  "nom": "Prise de rendez-vous",
  "slug": "rdv-cabinet",
  "pages": ["Accueil", "Réserver", "Mes rendez-vous", "Admin"],
  "entites": [
    { "table": "clients", "champs": ["nom", "email", "telephone"] },
    { "table": "rendezvous", "champs": ["client_id", "debut", "duree_min", "motif", "statut"] }
  ],
  "style": { "direction": "chaleureux", "accent": "#f2372a", "sombre": true },
  "acces": "cle",
  "donnees": "personnel"
}
```

4. **Valider en une ligne** (« Voilà le brief — je construis ? ») puis passer la
   main à `webapp-build`.

## Règles du brief

- **slug** : un seul label, minuscules, 32 caractères max, pas de tiret initial ni
  final ; mots réservés refusés : www, api, app, kaby, admin, mail, static.
- **`donnees`** : `personnel` dès que le domaine touche santé, droit, contacts,
  paiements… → `acces` ne peut alors PAS être `public` : la clé est obligatoire
  (RGPD — non négociable, et on le dit au lieu de le subir).
- **Aucune donnée réelle dans le brief** : les exemples sont marqués « démo »
  (emails `.test`).
- Ce qui n'est pas dans le brief n'existe pas. Une demande pendant le build met à
  jour le brief d'abord.
