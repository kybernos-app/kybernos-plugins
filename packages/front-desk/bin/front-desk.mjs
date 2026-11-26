#!/usr/bin/env node
// The public service of one shop ("Accueil client"): a chat page on a public link, run by a model called directly, under rules the
// model cannot change. It holds none of the owner's DSH keys: it has its own model key, its own data folder, its own owner token.
//
//   FRONT_DESK_FICHE=shop.json FRONT_DESK_OWNER_TOKEN=... MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node bin/front-desk.mjs
//
// The fiche file seeds version 1 the first time. From then on the shop's versions live in the data folder (edited in the Atelier,
// published through its gate), and the file is not read again.
//
// Options: --fiche <file> --data <dir> --port <n> --host <addr> --public-url <url> --trust-proxy --dry-run (a scripted echo model,
//          no key, no cost) --scenarios (replay the five scenarios and exit) --print-config (what would run, secrets masked) --help
// The operator's console (this file, its log lines) is English only.

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { parseFiche } from '../core/fiche.mjs';
import { createService } from '../core/service.mjs';
import { createOpenAiCompatModel } from '../core/model.mjs';
import { scriptedModel, dryRunHandler } from '../core/scripted.mjs';
import { runScenarios } from '../core/scenarios.mjs';
import { t } from '../core/text.mjs';
import { createTelegramChannel } from '../channels/telegram.mjs';
import { createHttpServer } from '../server/http.mjs';

const HELP = `Accueil client: public chat service (one shop)

Usage: node bin/front-desk.mjs [options]

Environment: FRONT_DESK_FICHE, FRONT_DESK_DIR, FRONT_DESK_OWNER_TOKEN, FRONT_DESK_PORT, FRONT_DESK_HOST, FRONT_DESK_PUBLIC_URL,
             MODEL_BASE_URL, MODEL_API_KEY, MODEL_NAME, TELEGRAM_BOT_TOKEN (optional: also answers visitors on Telegram)
Options:
  --fiche <file>       the shop's fiche (JSON). It seeds version 1; after that the data folder holds the versions
  --data <dir>         where conversations, versions, the ledger and the kill file live (default ./data)
  --port <n>           default 8787          --host <addr>   default 127.0.0.1
  --public-url <url>   the address visitors reach this service at (used to write the snippet for the shop's site)
  --trust-proxy        read the visitor's IP from X-Forwarded-For (only behind your own proxy)
  --dry-run            a scripted model that echoes (try "my name is Ann"): wiring test, no key, no cost
  --scenarios          replay the five scenarios and exit (non-zero when one fails)
  --print-config       print what would run (secrets masked) and exit
`;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, env, def) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : (process.env[env] || def); };
const mask = (s) => (s ? `${String(s).slice(0, 2)}… (${String(s).length} chars)` : '(not set)');
const stamp = (m) => console.log(`${new Date().toISOString()} ${m}`);

function publicUrlOf(raw) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch { return null; }
}

async function main() {
  if (flag('--help')) { console.log(HELP); return 0; }
  if (flag('--scenarios')) {
    const results = await runScenarios();
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.failures.length ? `\n      ${r.failures.join('\n      ')}` : ''}`);
    return results.every((r) => r.ok) ? 0 : 1;
  }
  const ficheFile = opt('--fiche', 'FRONT_DESK_FICHE');
  if (!ficheFile) { console.error('A fiche is required: --fiche <file> or FRONT_DESK_FICHE.'); return 2; }
  const rawFiche = JSON.parse(fs.readFileSync(ficheFile, 'utf8'));
  const { fiche, warnings } = parseFiche(rawFiche);
  for (const w of warnings) console.warn(`fiche: ${w}`);
  const dir = path.resolve(opt('--data', 'FRONT_DESK_DIR', './data'));
  const port = Number(opt('--port', 'FRONT_DESK_PORT', '8787'));
  const host = opt('--host', 'FRONT_DESK_HOST', '127.0.0.1');
  const rawPublic = opt('--public-url', 'FRONT_DESK_PUBLIC_URL');
  const publicUrl = publicUrlOf(rawPublic);
  if (rawPublic && !publicUrl) { console.error('--public-url must be an http(s) address, for example https://front-desk.my-shop.example'); return 2; }
  const ownerToken = process.env.FRONT_DESK_OWNER_TOKEN || null;
  const tgToken = process.env.TELEGRAM_BOT_TOKEN || null;
  const dry = flag('--dry-run');
  const cfg = { baseUrl: process.env.MODEL_BASE_URL, apiKey: process.env.MODEL_API_KEY, model: process.env.MODEL_NAME };
  if (flag('--print-config')) {
    console.log(JSON.stringify({ shop: fiche.slug, dir, host, port, publicUrl, owner: ownerToken ? 'token set' : 'no admin', telegram: tgToken ? mask(tgToken) : 'off', model: dry ? 'dry-run' : { baseUrl: cfg.baseUrl, model: cfg.model, apiKey: mask(cfg.apiKey) }, guardrails: fiche.guardrails }, null, 2));
    return 0;
  }
  if (!dry && !(cfg.baseUrl && cfg.apiKey && cfg.model)) { console.error('MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME are required (or use --dry-run).'); return 2; }
  const model = dry ? scriptedModel(dryRunHandler) : createOpenAiCompatModel(cfg);

  // The owner's words reach a Telegram visitor through the channel, which is built after the service (it needs the runner).
  let telegram = null;
  let telegramName = null;
  const deliver = async (meta, text) => (telegram && meta.channel === 'tg' && meta.reach ? (await telegram.send(meta.reach, text)).ok : false);
  const service = createService({ fiche, model, dir, deliver });
  const seeded = service.studio.init(rawFiche);
  stamp(seeded.fromStore ? `fiche: version ${seeded.version} from the data folder (the file is not read again)` : `fiche: first version written from ${path.basename(ficheFile)}`);

  const langOf = (l) => (l === 'en' || l === 'fr' ? l : undefined);
  const abort = new AbortController();
  if (tgToken) {
    try {
      telegram = createTelegramChannel({
        token: tgToken,
        stateFile: path.join(dir, 'telegram.state.json'),
        log: (m) => stamp(m),
        say: (key, l) => t(langOf(l) || service.fiche.language, key),
        handle: ({ senderKey, chatId, text, lang }) => service.runner.handleMessage({ channel: 'tg', senderKey, visitorId: `tg${senderKey}`.toLowerCase(), ip: `tg:${senderKey}`, text, lang: langOf(lang), reach: chatId }),
        consent: async ({ senderKey, noteId, accept }) => {
          const r = service.actions.consent({ noteId, accept, ctx: { channel: 'tg', senderKey } });
          return { ok: r.ok, reply: r.ok ? t(service.fiche.language, r.saved ? 'consent.saved' : 'consent.declined') : undefined };
        },
      });
      const me = await telegram.me();
      telegramName = me.username;
    } catch (e) {
      // A mistyped token must not take the website chat down with it: say so, and go on without Telegram.
      console.error(`front-desk: Telegram is off (${e.message})`);
      telegram = null;
    }
  }

  const info = {
    mode: dry ? 'dry-run' : 'live',
    publicUrl,
    channels: () => ({ site: { connected: true }, telegram: telegram ? { connected: true, username: telegramName } : { connected: false } }),
  };
  const server = createHttpServer({ service, ownerToken, trustProxy: flag('--trust-proxy'), info });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  console.log(`front-desk: "${service.fiche.name}" on http://${host}:${port}/  (data: ${dir}${ownerToken ? `, owner pages: http://${host}:${port}/atelier and /boite` : ', no owner token: admin is off'}${telegram ? `, Telegram: @${telegramName}` : ''})`);
  if (telegram) telegram.start({ signal: abort.signal }).catch((e) => console.error(`front-desk: Telegram stopped (${e.message})`));
  const stop = () => { abort.abort(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return null;
}

main().then((code) => { if (code !== null) process.exit(code); }, (e) => { console.error(`front-desk: ${e.message}`); process.exit(1); });
