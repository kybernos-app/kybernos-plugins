#!/usr/bin/env node
// Démon du pont DSH ↔ messagerie.
//
//   node messaging/bin/telegram-daemon.mjs [options]
//
// Aucun port n'est ouvert : la connexion à Telegram est sortante (long polling).

import path from 'node:path';
import process from 'node:process';

import { describeConfig, loadConfig } from '../core/config.mjs';
import { createBridge } from '../core/runner.mjs';
import { allowChat, loadState, saveState } from '../core/state.mjs';
import { createTelegramAdapter } from '../channels/telegram.mjs';

const HELP = `Pont DSH ↔ Telegram (long polling sortant, aucun tunnel)

Usage: node messaging/bin/telegram-daemon.mjs [options]

Options:
  --env-file <chemin>   fichier .env contenant TELEGRAM_BOT_TOKEN (défaut: config.json)
  --config <chemin>     config.json du pont (défaut: ~/.dsh/telegram-bridge/config.json)
  --state <chemin>      état (défaut: ~/.dsh/telegram-bridge/state.json)
  --workspaces <dir>    racine des dossiers de travail par chat
  --allow <chatId>      autorise ce chat (répétable, persistant)
  --allow-all           autorise TOUS les chats (dangereux : accès outils complet)
  --dry-run             ne lance pas DSH, renvoie un écho (test du câblage)
  --print-config        affiche la configuration résolue (secrets masqués) et sort
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
        if (arg.startsWith('--')) throw new Error(`option inconnue: ${arg}`);
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
    final: `🧪 dry-run — aucune exécution DSH.\n\nTâche reçue:\n${task}`,
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
      `telegram-daemon: aucun token.\n` +
        `  cherché dans ${config.envFile || '(aucun .env configuré)'} et dans $TELEGRAM_BOT_TOKEN\n` +
        `  crée ${config.configPath} avec {"envFile":"/chemin/vers/.env"} ou exporte TELEGRAM_BOT_TOKEN\n`,
    );
    return 2;
  }

  const log = (message) => process.stdout.write(`[${stamp()}] ${message}\n`);
  log(`pont démarré — ${JSON.stringify(describeConfig(config))}`);
  if (config.configFileError) log(`config illisible: ${config.configFileError}`);
  for (const note of config.notes || []) log(`note: ${note}`);
  if (config.allowAll) log('⚠️  --allow-all : tout chat Telegram peut piloter ce Harness');

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
          log(`état non enregistré: ${err.message}`);
        }
      }
    },
  });

  try {
    const me = await adapter.me();
    log(`bot: @${me.username || me.first_name} (id ${me.id})`);
  } catch (err) {
    process.stderr.write(`telegram-daemon: token refusé — ${err.message}\n`);
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
    log(`signal ${signal} — arrêt du pont`);
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
