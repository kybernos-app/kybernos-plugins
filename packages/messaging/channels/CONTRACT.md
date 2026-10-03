# Contrat d'adaptateur de canal

Un canal est un fichier qui exporte `create<Canal>Adapter(options)` et renvoie un
objet avec les capacités ci-dessous. Le cœur (`core/runner.mjs`) ne connaît que
ce contrat : ajouter Discord, Slack, WhatsApp ou Matrix ne demande aucune
modification du cœur.

## Obligatoire

| Membre | Signature | Rôle |
|---|---|---|
| `name` | `string` | Nom du canal, affiché dans `/status` |
| `start` | `async ({ onMessage, inboxFor, signal })` | Démarre la réception ; `onMessage(message)` par message ; rend la main quand `signal` est avorté |
| `send` | `async (chatId, text, { replyTo }) → { messageId }` | Envoie un message texte |
| `edit` | `async (chatId, messageId, text) → boolean` | Remplace un message déjà envoyé (streaming) |

## Optionnel (dégradation propre si absent)

| Membre | Signature | Rôle |
|---|---|---|
| `sendFile` | `async (chatId, filePath, { caption })` | Pièce jointe sortante |
| `download` | `async (attachment, destDir) → cheminLocal` | Pièce jointe entrante |

`runner.deliver()` n'appelle `sendFile` que si l'adaptateur le fournit ; sans lui,
les fichiers ne sont simplement pas envoyés (et `/status` reste valide).

## Message normalisé fourni au cœur

```js
{
  updateId,            // identifiant monotone de la plateforme (déduplication)
  chatId,              // string, sert de clé de session et d'allowlist
  messageId,
  chatType,            // 'private' | 'group' | … (informatif)
  from,                // libellé humain de l'expéditeur (journaux seulement)
  text,                // texte brut (légende comprise)
  attachments: [{
    kind,              // 'photo' | 'document' | 'voice' | …
    fileId, name, size, mime,
    localPath,         // posé par l'adaptateur après download()
  }],
  receivedAt
}
```

## Règles

1. **Sortant d'abord.** Un canal qui écoute en entrant sans URL publique
   (long polling, WebSocket sortant, Socket Mode) est préféré : aucun tunnel,
   aucun port ouvert, aucune surface exposée.
2. **Les erreurs fatales se distinguent des transitoires.** Un token invalide ou
   un conflit de mode (`409` Telegram) doit lever et arrêter le démon ; une
   coupure réseau se réessaie avec repli exponentiel.
3. **Pas de secret dans les journaux.** `send`/`edit`/`download` ne doivent
   jamais écrire un token, une URL signée ou un identifiant d'utilisateur brut
   dans la sortie standard.
4. **Une dégradation n'est pas une erreur.** Si la plateforme refuse une
   fonction (édition indisponible, taille maximale), l'adaptateur le signale et
   le cœur continue en texte simple.
