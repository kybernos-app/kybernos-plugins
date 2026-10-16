# messaging — a DSH ↔ messaging-apps bridge

Connects a messaging app to your **local DeepSeek Harness**, in both directions:

- **inbound**: a received message starts a DSH session (one session per
  conversation, resumed at every message);
- **outbound**: the answer — and the progress — comes back into the chat, and a
  command can also push a message without waiting for a question.

**No tunnel, no open port, no public URL.** The connection to
Telegram is **outbound** (`getUpdates` long polling), exactly like dsh-im.
A tunnel would only become necessary for a webhook mode — not needed here.

## Architecture

```
messaging/
├── core/
│   ├── config.mjs     # resolved config (.env, allowlist, paths) — no secret copied
│   ├── state.mjs      # persistent 0600 state: chat → DSH session, allowlist, offset
│   ├── dsh-run.mjs    # `dsh --profile headless --json` + NDJSON reading + timeout/abort
│   ├── runner.mjs     # the heart: commands, queue, streaming, delivery
│   └── text.mjs       # 4096 splitting, [[send-file:…]] markers, safe file names
├── channels/
│   ├── telegram.mjs   # Telegram adapter (getUpdates, send/edit, attachments)
│   └── CONTRACT.md    # adapter contract: add a channel without touching the core
├── bin/
│   ├── telegram-daemon.mjs  # the daemon
│   └── telegram-send.mjs    # proactive DSH → Telegram send
└── test/                    # 40 tests: no real network, a fake `dsh` and a fake Bot API
```

The core knows **no platform**: it speaks the contract of 4 required methods
(`name`, `start`, `send`, `edit`) and 2 optional ones (`sendFile`,
`download`). Everything specific to Telegram lives in a single file.

## Getting started

```bash
cd <your checkout>/packages/messaging

# resolved configuration (secrets masked)
node bin/telegram-daemon.mjs --print-config

# the daemon (a single getUpdates consumer per token)
node bin/telegram-daemon.mjs

# proactive send
node bin/telegram-send.mjs "message" [--file /path/report.pdf]
echo "from a pipe" | node bin/telegram-send.mjs
```

The configuration lives in `~/.dsh/telegram-bridge/config.json`:

```json
{ "envFile": "/absolute/path/to/your/.env" }
```

The token is **never copied**: it stays in the existing `.env` (or
`TELEGRAM_BOT_TOKEN`) and is only read in memory.

## Keeping it running (macOS)

A plain `&` or a DSH background job is **not enough**: the process dies
with the session that started it, and a message received at that moment is lost
(seen on 21/09/2026). On macOS, the robust way is a **LaunchAgent**:

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/app.kybernos.telegram-bridge.plist
launchctl print gui/$(id -u)/app.kybernos.telegram-bridge | grep -E 'state|pid'
tail -f ~/.dsh/telegram-bridge/daemon.log
```

The provided plist starts at login (`RunAtLoad`), restarts after a crash
(`KeepAlive.SuccessfulExit = false`, so **not** after a clean `SIGTERM`), and
sets `PATH` — launchd does not inherit the shell, hence `dshBin` as an absolute path in
`config.json`. Logs: `~/.dsh/telegram-bridge/daemon.log` and `daemon.err.log`.

Stop: `launchctl bootout gui/$(id -u)/app.kybernos.telegram-bridge`.

**Delivery guarantee.** The Telegram offset is only confirmed **after**
the message is fully processed: a crash in the middle of a turn therefore leaves the message
unconfirmed, and Telegram delivers it again at restart (at-least-once) instead of
losing it silently. Accepted trade-off: a message can be processed twice
if the crash happens after the turn but before the confirmation.

## Commands in the chat

| Command | Effect |
|---|---|
| `/new` | the conversation will start again on a blank DSH session |
| `/status` | channel, current session, working folder, queue, last turn, daemon uptime |
| `/help` | reminder of the commands |

Any other message goes to DSH. Messages received while a turn is running
are **queued** (5 by default) instead of being lost.

## Files and images

- **Inbound**: photo, document, voice note, audio, video are downloaded into
  `<the chat's workspace>/inbox/` and their path is announced to DSH, which can
  read them with its tools.
- **Outbound**: DSH ends its answer with `[[send-file:/absolute/path]]` (or
  relative to its working folder) and the file goes out as an attachment; the
  marker is removed from the text. `telegram-send --file` does the same outside a
  session.

## Security

1. **The allowlist is the boundary.** The daemon refuses any chat that is not in
   `TELEGRAM_CHAT_ID`, `TELEGRAM_ALLOWED_CHATS`, `allowedChats` (config) or
   `state.allowlist`, and tells the refused chat so.
2. **It is not a formality**: `permission.defaultPreset` is
   `danger-full-access` in this `settings.yaml` — an allowed message can
   run tools without a sandbox. A public bot = RCE for whoever finds
   the bot's identifier. Keep the bot private.
3. `--allow-all` exists but refuses by default; it is logged as
   dangerous.
4. The state is written **0600**, the Telegram offset is persisted (no replay
   after a restart), the logs only contain chat identifiers
   and never a token.
5. A webhook already set on the bot makes `getUpdates` fail with **409**: the
   daemon stops with an explicit message instead of looping.

## Tests

```bash
cd messaging && npm test        # 40 tests, no real network access
```

The fake `dsh` (`test/fixtures/fake-dsh.mjs`) reproduces the real NDJSON stream and
the cases of failure, slowness and file marker; the fake Bot API checks
the long polling, the denormalisation of messages, the 409 webhook, the
"not modified" edit and the `sendPhoto`/`sendDocument` sends.

## Adding another channel

1. Write `channels/<channel>.mjs` exporting `create<Channel>Adapter(options)` with
   the 4 (or 6) members of [`CONTRACT.md`](channels/CONTRACT.md).
2. Prefer an **outbound** transport (WebSocket, Socket Mode, long polling).
3. Run a daemon with that adapter: the core, the commands, the streaming,
   the queue and the state are already shared.

For a turnkey solution on 11 channels, `@xmanrui/dsh-im` remains the option — provided
its compatibility is checked (matrix declared up to DSH
`0.1.5-alpha.1`).

## What this bridge is not

- **Not a Kybernos Cloud channel**: Kybernos Cloud does the auth (device code) and
  the import of the LiteLLM model catalogue; it routes no message. The bridge
  simply uses the default model of `settings.yaml`.
- **Not the DSH webhook**: `@deepseek-ai/dsh-webhook` +
  `dsh-webhook-github` are a real signed HTTP ingress (so a TLS reverse proxy
  or a tunnel) and are mounted in no default profile here.
