#!/usr/bin/env node
// The public service of one shop ("Accueil client"): a chat page on a public link, run by a model called directly, under rules the
// model cannot change. It holds none of the owner's DSH keys: it has its own model key, its own data folder, its own owner token.
//
//   FRONT_DESK_FICHE=shop.json FRONT_DESK_OWNER_TOKEN=... MODEL_BASE_URL=... MODEL_API_KEY=... MODEL_NAME=... node bin/front-desk.mjs
//
// Options: --fiche <file> --data <dir> --port <n> --host <addr> --trust-proxy --dry-run (a scripted echo model, no key, no cost)
//          --scenarios (replay the five scenarios and exit) --print-config (what would run, secrets masked) --help
// The operator's console (this file, its log lines) is English only.

import process from 'node:process';
import path from 'node:path';
import { loadFiche } from '../core/fiche.mjs';
import { createService } from '../core/service.mjs';
import { createOpenAiCompatModel } from '../core/model.mjs';
import { scriptedModel, dryRunHandler } from '../core/scripted.mjs';
import { runScenarios } from '../core/scenarios.mjs';
import { createHttpServer } from '../server/http.mjs';

const HELP = `Accueil client: public chat service (one shop)

Usage: node bin/front-desk.mjs [options]

Environment: FRONT_DESK_FICHE, FRONT_DESK_DIR, FRONT_DESK_OWNER_TOKEN, FRONT_DESK_PORT, FRONT_DESK_HOST,
             MODEL_BASE_URL, MODEL_API_KEY, MODEL_NAME
Options:
  --fiche <file>     the shop's fiche (JSON)
  --data <dir>       where conversations, the ledger and the kill file live (default ./data)
  --port <n>         default 8787          --host <addr>   default 127.0.0.1
  --trust-proxy      read the visitor's IP from X-Forwarded-For (only behind your own proxy)
  --dry-run          a scripted model that echoes (try "my name is Ann"): wiring test, no key, no cost
  --scenarios        replay the five scenarios and exit (non-zero when one fails)
  --print-config     print what would run (secrets masked) and exit
`;

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, env, def) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : (process.env[env] || def); };
const mask = (s) => (s ? `${String(s).slice(0, 2)}… (${String(s).length} chars)` : '(not set)');

async function main() {
  if (flag('--help')) { console.log(HELP); return 0; }
  if (flag('--scenarios')) {
    const results = await runScenarios();
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.failures.length ? `\n      ${r.failures.join('\n      ')}` : ''}`);
    return results.every((r) => r.ok) ? 0 : 1;
  }
  const ficheFile = opt('--fiche', 'FRONT_DESK_FICHE');
  if (!ficheFile) { console.error('A fiche is required: --fiche <file> or FRONT_DESK_FICHE.'); return 2; }
  const { fiche, warnings } = loadFiche(ficheFile);
  for (const w of warnings) console.warn(`fiche: ${w}`);
  const dir = path.resolve(opt('--data', 'FRONT_DESK_DIR', './data'));
  const port = Number(opt('--port', 'FRONT_DESK_PORT', '8787'));
  const host = opt('--host', 'FRONT_DESK_HOST', '127.0.0.1');
  const ownerToken = process.env.FRONT_DESK_OWNER_TOKEN || null;
  const dry = flag('--dry-run');
  const cfg = { baseUrl: process.env.MODEL_BASE_URL, apiKey: process.env.MODEL_API_KEY, model: process.env.MODEL_NAME };
  if (flag('--print-config')) {
    console.log(JSON.stringify({ shop: fiche.slug, dir, host, port, owner: ownerToken ? 'token set' : 'no admin', model: dry ? 'dry-run' : { baseUrl: cfg.baseUrl, model: cfg.model, apiKey: mask(cfg.apiKey) }, guardrails: fiche.guardrails }, null, 2));
    return 0;
  }
  if (!dry && !(cfg.baseUrl && cfg.apiKey && cfg.model)) { console.error('MODEL_BASE_URL, MODEL_API_KEY and MODEL_NAME are required (or use --dry-run).'); return 2; }
  const model = dry ? scriptedModel(dryRunHandler) : createOpenAiCompatModel(cfg);
  const service = createService({ fiche, model, dir });
  const server = createHttpServer({ service, ownerToken, trustProxy: flag('--trust-proxy') });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  console.log(`front-desk: "${fiche.name}" on http://${host}:${port}/  (data: ${dir}${ownerToken ? `, owner page: http://${host}:${port}/boite` : ', no owner token: admin is off'})`);
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  return null;
}

main().then((code) => { if (code !== null) process.exit(code); }, (e) => { console.error(`front-desk: ${e.message}`); process.exit(1); });
