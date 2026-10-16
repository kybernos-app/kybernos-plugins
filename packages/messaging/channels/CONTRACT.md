# Channel adapter contract

A channel is a file that exports `create<Channel>Adapter(options)` and returns an
object with the capabilities below. The core (`core/runner.mjs`) only knows this
contract: adding Discord, Slack, WhatsApp or Matrix needs no change to the core.

## Required

| Member | Signature | Role |
|---|---|---|
| `name` | `string` | Name of the channel, shown in `/status` |
| `start` | `async ({ onMessage, inboxFor, signal })` | Starts receiving; `onMessage(message)` per message; returns when `signal` is aborted |
| `send` | `async (chatId, text, { replyTo }) → { messageId }` | Sends a text message |
| `edit` | `async (chatId, messageId, text) → boolean` | Replaces a message already sent (streaming) |

## Optional (clean degradation when absent)

| Member | Signature | Role |
|---|---|---|
| `sendFile` | `async (chatId, filePath, { caption })` | Outgoing attachment |
| `download` | `async (attachment, destDir) → localPath` | Incoming attachment |

`runner.deliver()` only calls `sendFile` when the adapter provides it; without it,
files are simply not sent (and `/status` stays valid).

## Normalised message handed to the core

```js
{
  updateId,            // monotonic identifier of the platform (deduplication)
  chatId,              // string, used as the session key and the allowlist key
  messageId,
  chatType,            // 'private' | 'group' | … (informative)
  from,                // human label of the sender (logs only)
  lang,                // the sender's language code as the platform reports it ('fr', 'en-GB'…), or null
  text,                // plain text (caption included)
  attachments: [{
    kind,              // 'photo' | 'document' | 'voice' | …
    fileId, name, size, mime,
    localPath,         // set by the adapter after download()
  }],
  receivedAt
}
```

`lang` only chooses the language of the bridge's own replies (`core/messages.mjs`): French when it
starts with « fr », English for anything else or when it is missing.

## Rules

1. **Outbound first.** A channel that listens inbound without a public URL
   (long polling, outgoing WebSocket, Socket Mode) is preferred: no tunnel,
   no open port, no exposed surface.
2. **Fatal errors are told apart from transient ones.** An invalid token or
   a mode conflict (Telegram `409`) must throw and stop the daemon; a
   network cut is retried with exponential backoff.
3. **No secret in the logs.** `send`/`edit`/`download` must never write a
   token, a signed URL or a raw user identifier to the standard output.
4. **A degradation is not an error.** If the platform refuses a feature
   (editing unavailable, maximum size), the adapter says so and the core
   carries on in plain text.
5. **English for the operator.** An adapter's errors and log lines are for the person who runs
   the daemon: English only. What a person reads in the chat is the core's job (`core/messages.mjs`).
