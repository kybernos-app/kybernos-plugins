#!/usr/bin/env node
// Proactive DSH → Telegram send (without waiting for a question).
//
//   node messaging/bin/telegram-send.mjs "text" [--chat <id>] [--file <path>]...
//   echo "text" | node messaging/bin/telegram-send.mjs
//
// Usable from a DSH session, a script, a cron job or a hook. The text is the caller's own;
// the console output of this file is English only.

import fs from 'node:fs';
import process from 'node:process';

import { loadConfig } from '../core/config.mjs';
import { createBridge } from '../core/runner.mjs';
import { allowChat, loadState, saveState } from '../core/state.mjs';
import { createTelegramAdapter } from '../channels/telegram.mjs';

const HELP = `Proactive send to Telegram

Usage: node messaging/bin/telegram-send.mjs "text" [options]
       echo "text" | node messaging/bin/telegram-send.mjs

Options:
  --chat <id>        target chat (default: TELEGRAM_CHAT_ID of the .env)
  --file <path>      attachment to send (repeatable)
  --env-file <p>     .env file (default: config.json of the bridge)
  --config <p>       config.json of the bridge
  --allow <id>       allow this chat before sending (persistent)
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
    process.stderr.write('telegram-send: nothing to send (text or --file required)\n');
    return 2;
  }

  const config = loadConfig({ configPath: args.config, envFile: args.envFile });
  if (!config.token) {
    process.stderr.write('telegram-send: no Telegram token (--env-file or $TELEGRAM_BOT_TOKEN)\n');
    return 2;
  }

  const state = loadState(config.statePath);
  for (const id of args.allow) allowChat(state, id);
  if (args.allow.length) saveState(config.statePath, state);

  const chatId = String(args.chat || config.defaultChat || '');
  if (!chatId) {
    process.stderr.write('telegram-send: no target chat (--chat or TELEGRAM_CHAT_ID)\n');
    return 2;
  }
  for (const file of args.files) {
    if (!fs.existsSync(file)) {
      process.stderr.write(`telegram-send: file not found — ${file}\n`);
      return 2;
    }
  }

  const adapter = createTelegramAdapter({ token: config.token, log: (m) => process.stderr.write(`[send] ${m}\n`) });
  const bridge = createBridge({ adapter, config, state, stateFile: config.statePath, log: (m) => process.stderr.write(`[send] ${m}\n`) });
  await bridge.notify(chatId, text || '', { files: args.files });
  process.stdout.write(`sent to ${chatId}${args.files.length ? ` (+${args.files.length} file${args.files.length === 1 ? '' : 's'})` : ''}\n`);
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
