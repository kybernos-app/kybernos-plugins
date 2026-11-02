// The command (`bin/front-desk.mjs`), wired the way an operator uses it: flags, environment, --help, --print-config, --scenarios and
// the refusals. No long-running server is started here (the end-to-end test does that); every child gets a hermetic environment and
// secrets are only ever allowed to show up masked.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/front-desk.mjs', import.meta.url));
const FICHE = fileURLToPath(new URL('../examples/atelier-lune.json', import.meta.url));
const OWNER = 'owner-SECRET-token-0123456789abcdef';
const TELEGRAM = '987654321:AAE-telegram-SECRET-bot-token-value';
const KEY = 'sk-model-SECRET-key-0123456789';
const SECRETS = [OWNER, TELEGRAM, KEY];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-bin-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** Runs the command with only PATH, HOME and what the test passes: nothing leaks in from the machine running the tests. */
function run(args, env = {}) {
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
  const r = spawnSync(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, HOME: home, ...env }, encoding: 'utf8', timeout: 10_000, cwd: home });
  assert.equal(r.error, undefined, `the command did not finish: ${r.error && r.error.message}`);
  return { code: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}\n${r.stderr}` };
}
const noSecret = (text, what) => {
  for (const s of SECRETS) {
    assert.ok(!text.includes(s), `${what}: a secret was printed in full`);
    assert.ok(!text.includes(s.slice(4)), `${what}: most of a secret was printed`);
  }
};
const ALL_SECRETS = { FRONT_DESK_OWNER_TOKEN: OWNER, TELEGRAM_BOT_TOKEN: TELEGRAM, MODEL_API_KEY: KEY };

test('--print-config with --dry-run: exits 0, says what would run, masks every secret and touches nothing on disk', () => {
  const data = path.join(tmp, 'dry-data');
  const r = run(['--fiche', FICHE, '--data', data, '--port', '0', '--dry-run', '--print-config'], ALL_SECRETS);
  assert.equal(r.code, 0, r.all);
  noSecret(r.all, '--print-config');
  const cfg = JSON.parse(r.out);
  assert.deepEqual([cfg.shop, cfg.dir, cfg.host, cfg.port, cfg.publicUrl, cfg.owner, cfg.model], ['atelier-lune', data, '127.0.0.1', 0, null, 'token set', 'dry-run']);
  assert.match(cfg.telegram, /^98… \(\d+ chars\)$/, 'Telegram is shown masked, with its length only');
  assert.equal(cfg.guardrails.actions.leave_message, 'auto');
  assert.equal(cfg.guardrails.budget.dailyCapMicro, 2_000_000);
  assert.equal(fs.existsSync(data), false, 'printing the configuration creates no data folder');
});

test('--print-config for a real model: the address and name are shown, the key only masked; no owner token means no admin; no Telegram token means it is off', () => {
  const env = { MODEL_BASE_URL: 'https://models.example/v1', MODEL_NAME: 'some-model', MODEL_API_KEY: KEY };
  const r = run(['--fiche', FICHE, '--data', path.join(tmp, 'live-data'), '--print-config'], env);
  assert.equal(r.code, 0, r.all);
  noSecret(r.all, 'live config');
  const cfg = JSON.parse(r.out);
  assert.deepEqual(cfg.model, { baseUrl: 'https://models.example/v1', model: 'some-model', apiKey: `sk… (${KEY.length} chars)` });
  assert.deepEqual([cfg.owner, cfg.telegram, cfg.port], ['no admin', 'off', 8787]);

  const bare = run(['--fiche', FICHE, '--print-config'], {});
  assert.equal(bare.code, 0, 'printing needs no model');
  assert.deepEqual(JSON.parse(bare.out).model, { apiKey: '(not set)' });
});

test('the environment and the flags both configure it, and a flag wins; the public address is cut down to its origin', () => {
  const env = { FRONT_DESK_FICHE: FICHE, FRONT_DESK_DIR: path.join(tmp, 'env-data'), FRONT_DESK_PORT: '9001', FRONT_DESK_HOST: '0.0.0.0', FRONT_DESK_PUBLIC_URL: 'https://desk.example/some/path?token=abc#x' };
  const fromEnv = JSON.parse(run(['--dry-run', '--print-config'], env).out);
  assert.deepEqual([fromEnv.shop, fromEnv.dir, fromEnv.port, fromEnv.host], ['atelier-lune', path.join(tmp, 'env-data'), 9001, '0.0.0.0']);
  assert.equal(fromEnv.publicUrl, 'https://desk.example', 'no path, query or fragment survives into what is shown on the owner\'s page');
  const flagged = JSON.parse(run(['--dry-run', '--print-config', '--port', '1234', '--host', '127.0.0.1', '--public-url', 'http://localhost:8080'], env).out);
  assert.deepEqual([flagged.port, flagged.host, flagged.publicUrl], [1234, '127.0.0.1', 'http://localhost:8080']);
});

test('--help prints the usage, exits 0, starts nothing and shows no secret', () => {
  const r = run(['--help'], ALL_SECRETS);
  assert.equal(r.code, 0, r.all);
  noSecret(r.all, '--help');
  for (const word of ['Usage: node bin/front-desk.mjs', '--fiche', '--data', '--dry-run', '--print-config', '--scenarios', '--trust-proxy', 'FRONT_DESK_OWNER_TOKEN', 'TELEGRAM_BOT_TOKEN']) assert.ok(r.out.includes(word), word);
  assert.equal(r.err, '');
});

test('--scenarios replays the five scenarios and exits 0', () => {
  const r = run(['--scenarios'], {});
  assert.equal(r.code, 0, r.all);
  assert.equal(r.out.match(/^PASS /gm).length, 5);
  assert.doesNotMatch(r.out, /FAIL/);
});

test('refusals are plain: no fiche, a bad fiche, a bad public address; exit codes 2 and 1; never a stack trace or a secret', () => {
  const noFiche = run(['--dry-run'], ALL_SECRETS);
  assert.equal(noFiche.code, 2);
  assert.match(noFiche.err, /A fiche is required/);

  const bad = path.join(tmp, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ slug: 'bad-shop' }));
  const noName = run(['--fiche', bad, '--dry-run', '--print-config'], ALL_SECRETS);
  assert.equal(noName.code, 1);
  assert.match(noName.err, /front-desk: fiche: "name" is required/);

  const broken = path.join(tmp, 'broken.json');
  fs.writeFileSync(broken, '{ nope');
  const notJson = run(['--fiche', broken, '--print-config'], ALL_SECRETS);
  assert.equal(notJson.code, 1);
  const missing = run(['--fiche', path.join(tmp, 'absent.json'), '--print-config'], ALL_SECRETS);
  assert.equal(missing.code, 1);

  for (const url of ['ftp://desk.example', 'not a url', 'javascript:alert(1)']) {
    const r = run(['--fiche', FICHE, '--dry-run', '--print-config', '--public-url', url], ALL_SECRETS);
    assert.equal(r.code, 2, url);
    assert.match(r.err, /--public-url must be an http\(s\) address/);
  }
  for (const r of [noFiche, noName, notJson, missing]) {
    assert.doesNotMatch(r.all, /\n\s+at [\w.<]/, 'no stack trace');
    noSecret(r.all, 'a refusal');
  }
});

test('a fiche that asks above the ceilings still prints a config, with the lowered values and a warning', () => {
  const file = path.join(tmp, 'greedy.json');
  fs.writeFileSync(file, JSON.stringify({ slug: 'greedy-shop', name: 'Greedy', guardrails: { budget: { dailyCap: 500 }, limits: { perIpPerMin: 9999 } } }));
  const r = run(['--fiche', file, '--dry-run', '--print-config'], {});
  assert.equal(r.code, 0, r.all);
  assert.match(r.err, /fiche: budget\.dailyCap: 500 is above the ceiling, lowered to 20/);
  assert.match(r.err, /fiche: limits\.perIpPerMin: 9999 is above the ceiling, lowered to 120/);
  const cfg = JSON.parse(r.out);
  assert.deepEqual([cfg.guardrails.budget.dailyCapMicro, cfg.guardrails.limits.perIpPerMin], [20_000_000, 120]);
});
