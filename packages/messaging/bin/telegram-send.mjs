#!/usr/bin/env node
// Envoi proactif DSH → Telegram (sans attendre une question).
//
//   node messaging/bin/telegram-send.mjs "texte" [--chat <id>] [--file <chemin>]...
//   echo "texte" | node messaging/bin/telegram-send.mjs
//
// Utilisable depuis une session DSH, un script, un cron ou un hook.

import fs from 'node:fs';
import process from 'node:process';

import { loadConfig } from '../core/config.mjs';
import { createBridge } from '../core/runner.mjs';
import { allowChat, loadState, saveState } from '../core/state.mjs';
import { createTelegramAdapter } from '../channels/telegram.mjs';

const HELP = `Envoi proactif vers Telegram

Usage: node messaging/bin/telegram-send.mjs "texte" [options]
       echo "texte" | node messaging/bin/telegram-send.mjs

Options:
  --chat <id>        chat cible (défaut: TELEGRAM_CHAT_ID du .env)
  --file <chemin>    pièce jointe à envoyer (répétable)
  --env-file <c>     fichier .env (défaut: config.json du pont)
  --config <c>       config.json du pont
  --allow <id>       autorise ce chat avant l'envoi (persistant)
  --help
`;

function parseArgs(argv) {
  const out = { files: [], allow: [] };
  const words = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      return argv[i];
    };
    switch (arg) {
      case '--chat':
        out.chat = String(next());
        break;
      case '--file':
        out.files.push(next());
        break;
      case '--env-file':
        out.envFile = next();
        break;
      case '--config':
        out.config = next();
        break;
      case '--allow':
        out.allow.push(String(next()));
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        words.push(arg);
    }
  }
  out.text = words.join(' ');
  return out;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(HELP);
    return 0;
  }
  const text = args.text || (await readStdin());
  if (!text && !args.files.length) {
    process.stderr.write('telegram-send: rien à envoyer (texte ou --file requis)\n');
    return 2;
  }

  const config = loadConfig({ configPath: args.config, envFile: args.envFile });
  if (!config.token) {
    process.stderr.write('telegram-send: aucun token Telegram (--env-file ou $TELEGRAM_BOT_TOKEN)\n');
    return 2;
  }

  const state = loadState(config.statePath);
  for (const id of args.allow) allowChat(state, id);
  if (args.allow.length) saveState(config.statePath, state);

  const chatId = String(args.chat || config.defaultChat || '');
  if (!chatId) {
    process.stderr.write('telegram-send: aucun chat cible (--chat ou TELEGRAM_CHAT_ID)\n');
    return 2;
  }
  for (const file of args.files) {
    if (!fs.existsSync(file)) {
      process.stderr.write(`telegram-send: fichier introuvable — ${file}\n`);
      return 2;
    }
  }

  const adapter = createTelegramAdapter({ token: config.token, log: (m) => process.stderr.write(`[send] ${m}\n`) });
  const bridge = createBridge({ adapter, config, state, stateFile: config.statePath, log: (m) => process.stderr.write(`[send] ${m}\n`) });
  await bridge.notify(chatId, text || '', { files: args.files });
  process.stdout.write(`envoyé à ${chatId}${args.files.length ? ` (+${args.files.length} fichier(s))` : ''}\n`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`telegram-send: ${err.message}\n`);
    process.exitCode = 1;
  });
