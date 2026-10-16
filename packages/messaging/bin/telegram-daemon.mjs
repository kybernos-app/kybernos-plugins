#!/usr/bin/env node
// Daemon of the DSH ↔ messaging bridge.
//
//   node messaging/bin/telegram-daemon.mjs [options]
//
// No port is opened: the connection to Telegram is outbound (long polling).
// The operator's console (this file, the log lines) is English only.

import path from 'node:path';
import process from 'node:process';

import { describeConfig, loadConfig } from '../core/config.mjs';
import { createBridge } from '../core/runner.mjs';
import { allowChat, loadState, saveState } from '../core/state.mjs';
import { createTelegramAdapter } from '../channels/telegram.mjs';

const HELP = `DSH ↔ Telegram bridge (outbound long polling, no tunnel)

Usage: node messaging/bin/telegram-daemon.mjs [options]

Options:
  --env-file <path>     .env file holding TELEGRAM_BOT_TOKEN (default: config.json)
  --config <path>       config.json of the bridge (default: ~/.dsh/telegram-bridge/config.json)
  --state <path>        state (default: ~/.dsh/telegram-bridge/state.json)
  --workspaces <dir>    root of the per-chat working folders
  --allow <chatId>      allow this chat (repeatable, persistent)
  --allow-all           allow EVERY chat (dangerous: full tool access)
  --dry-run             do not start DSH, send an echo back (wiring test)
  --print-config        print the resolved configuration (secrets masked) and exit
  --help
`;

function parseArgs(argv) {
  const out = { allow: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };
    switch (arg) {
      case '--env-file':
        out.envFile = next();
        break;
      case '--config':
        out.config = next();
        break;
      case '--state':
        out.state = next();
        break;
      case '--workspaces':
        out.workspaces = next();
        break;
      case '--allow':
        out.allow.push(String(next()));
        break;
      case '--allow-all':
        out.allowAll = true;
        break;
      case '--dry-run':
        out.dryRun = true;
        break;
      case '--print-config':
        out.printConfig = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        if (arg.startsWith('--')) throw new Error(`unknown option: ${arg}`);
    }
  }
  return out;
}

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

function dryRunTask({ task, sessionId }) {
  return Promise.resolve({
    ok: true,
    exitCode: 0,
    sessionId: sessionId || `session-dry-run-${Date.now()}`,
    final: `🧪 dry-run — DSH was not run.\n\nTask received:\n${task}`,
    error: null,
    usage: null,
    stderr: '',
    durationMs: 0,
    timedOut: false,
    aborted: false,
    events: [],
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const config = loadConfig({ configPath: args.config, envFile: args.envFile });
  if (args.state) config.statePath = args.state;
  if (args.workspaces) config.workspaceRoot = args.workspaces;
  if (args.allowAll) config.allowAll = true;

  const state = loadState(config.statePath);
  for (const id of args.allow) allowChat(state, id);
  if (args.allow.length) saveState(config.statePath, state);

  if (args.printConfig) {
    process.stdout.write(`${JSON.stringify({ ...describeConfig(config), stateChats: Object.keys(state.chats).length }, null, 2)}\n`);
    return 0;
  }
  if (!config.token) {
    process.stderr.write(
      `telegram-daemon: no token.\n` +
        `  looked in ${config.envFile || '(no .env configured)'} and in $TELEGRAM_BOT_TOKEN\n` +
        `  create ${config.configPath} with {"envFile":"/path/to/.env"} or export TELEGRAM_BOT_TOKEN\n`,
    );
    return 2;
  }

  const log = (message) => process.stdout.write(`[${stamp()}] ${message}\n`);
  log(`bridge started — ${JSON.stringify(describeConfig(config))}`);
  if (config.configFileError) log(`config unreadable: ${config.configFileError}`);
  for (const note of config.notes || []) log(`note: ${note}`);
  if (config.allowAll) log('⚠️  --allow-all: any Telegram chat can drive this Harness');

  let lastPersist = 0;
  const adapter = createTelegramAdapter({
    token: config.token,
    log,
    initialOffset: state.offset || 0,
    onOffset: (offset) => {
      state.offset = offset;
      if (Date.now() - lastPersist > 2000) {
        lastPersist = Date.now();
        try {
          saveState(config.statePath, state);
        } catch (err) {
          log(`state not saved: ${err.message}`);
        }
      }
    },
  });

  try {
    const me = await adapter.me();
    log(`bot: @${me.username || me.first_name} (id ${me.id})`);
  } catch (err) {
    process.stderr.write(`telegram-daemon: token refused — ${err.message}\n`);
    return 3;
  }

  const bridge = createBridge({
    adapter,
    config,
    state,
    stateFile: config.statePath,
    runTask: args.dryRun ? dryRunTask : undefined,
    log,
  });

  const controller = new AbortController();
  const stop = (signal) => {
    log(`signal ${signal} — stopping the bridge`);
    controller.abort();
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  try {
    await adapter.start({
      onMessage: bridge.handleIncoming,
      inboxFor: (chatId) => path.join(bridge.workspaceFor(chatId), 'inbox'),
      signal: controller.signal,
    });
  } catch (err) {
    process.stderr.write(`telegram-daemon: ${err.message}\n`);
    saveState(config.statePath, state);
    return 1;
  }
  saveState(config.statePath, state);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`telegram-daemon: ${err.stack || err.message}\n`);
    process.exitCode = 1;
  });
