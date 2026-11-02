// fd-config.mjs: where the plugin keeps its state, what is secret, what the child process is given.
import { mkdtempSync, readFileSync, statSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConfigStore, cleanBaseUrl, cleanPublicUrl, starterFiche, stateDir } from './fd-config.mjs'
import { parseFiche } from './service/core/fiche.mjs'

let failed = 0
const ok = (name, cond, detail) => { console.log((cond ? '  ok   ' : '  FAIL ') + name + (cond || detail === undefined ? '' : '  -- ' + detail)); if (!cond) failed += 1 }
const home = () => mkdtempSync(join(tmpdir(), 'kb-fd-config-'))
const mode = (f) => (statSync(f).mode & 0o777).toString(8)

const KEY = 'sk-test-0123456789abcdef'
const TG = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw'

// ── addresses ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
ok('a model address keeps its path and drops the trailing slash', cleanBaseUrl('https://ai-gateway.vercel.sh/v1/') === 'https://ai-gateway.vercel.sh/v1')
ok('a model address with credentials, a query or a non-http scheme is refused', cleanBaseUrl('https://u:p@x.example/v1') === null && cleanBaseUrl('https://x.example/v1?key=1') === null && cleanBaseUrl('file:///etc/passwd') === null && cleanBaseUrl('javascript:alert(1)') === null)
ok('a public address is reduced to its origin', cleanPublicUrl('https://shop.example/path?x=1') === 'https://shop.example' && cleanPublicUrl('ftp://x') === null && cleanPublicUrl('not a url') === null)

// ── the store ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const h = home()
const c = createConfigStore({ home: h })
ok('defaults: nothing set, not ready, lists what is missing', c.read().model.baseUrl === null && c.ready().ok === false && c.ready().missing.join() === 'model_url,model_name,model_key')
const t1 = c.ownerToken()
ok('the owner token is long, stable, and kept 0600', t1.length >= 32 && c.ownerToken() === t1 && mode(join(stateDir(h), 'secrets.json')) === '600')
ok('the folder holding the secrets is 0700', mode(stateDir(h)) === '700')

ok('an invalid value refuses the whole patch: nothing is written', c.write({ publicUrl: 'https://ok.example', model: { baseUrl: 'ftp://nope' } }).error === 'bad_model_url' && c.read().publicUrl === null)
ok('a bad key, a bad bot token, a bad model name are refused', c.write({ model: { apiKey: 'short' } }).error === 'bad_model_key' && c.write({ telegram: { token: 'abc' } }).error === 'bad_telegram_token' && c.write({ model: { name: 'a b;c' } }).error === 'bad_model_name')
ok('an empty patch says so', c.write({}).error === 'nothing_to_write' && c.write(null).error === 'nothing_to_write')
ok('a good patch is written', c.write({ publicUrl: 'https://shop.example', model: { baseUrl: 'https://gw.example/v1', name: 'kimi-k3.1-pro', apiKey: KEY } }).ok === true)
ok('now it is ready, and says which secrets are set without showing them', c.ready().ok === true && c.secretsSet().modelKey === true && c.secretsSet().telegram === false)
ok('no secret is in config.json, none comes out of read()', !readFileSync(join(stateDir(h), 'config.json'), 'utf8').includes(KEY) && !JSON.stringify(c.read()).includes(KEY) && !JSON.stringify(c.secretsSet()).includes(KEY))
ok('secrets.json holds the key, 0600', readFileSync(join(stateDir(h), 'secrets.json'), 'utf8').includes(KEY) && mode(join(stateDir(h), 'secrets.json')) === '600' && mode(join(stateDir(h), 'config.json')) === '600')
ok('the token survives a later write', c.ownerToken() === t1)
ok('a Telegram token is stored and can be switched off', c.write({ telegram: { token: TG } }).ok && c.secretsSet().telegram === true && c.read().telegram === true && c.write({ telegram: { off: true } }).ok && c.secretsSet().telegram === false && c.read().telegram === false)
ok('autostart is a plain switch', c.write({ autostart: true }).ok && c.read().autostart === true && c.write({ autostart: false }).ok && c.read().autostart === false)
ok('clearing the public address works', c.write({ publicUrl: '' }).ok && c.read().publicUrl === null)

// ── the child's environment ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────
c.write({ publicUrl: 'https://shop.example', telegram: { token: TG } })
const env = c.childEnv({ port: 8790, env: { PATH: '/usr/bin', HOME: '/home/x', ANTHROPIC_API_KEY: 'LEAK1', DSH_TOKEN: 'LEAK2', OPENAI_API_KEY: 'LEAK3' } })
ok('the child gets what it needs', env.FRONT_DESK_PORT === '8790' && env.FRONT_DESK_HOST === '127.0.0.1' && env.MODEL_API_KEY === KEY && env.MODEL_NAME === 'kimi-k3.1-pro' && env.FRONT_DESK_OWNER_TOKEN === t1 && env.FRONT_DESK_PUBLIC_URL === 'https://shop.example' && env.TELEGRAM_BOT_TOKEN === TG)
ok('and nothing else of the owner\'s environment', !Object.values(env).some((v) => String(v).startsWith('LEAK')) && Object.keys(env).every((k) => /^(PATH|HOME|FRONT_DESK_|MODEL_|TELEGRAM_BOT_TOKEN)/.test(k)), Object.keys(env).join())
c.write({ telegram: { off: true } })
ok('no Telegram variable when it is off', c.childEnv({ port: 1, env: {} }).TELEGRAM_BOT_TOKEN === undefined)

// ── the starter fiche ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const f = c.ensureFiche('Atelier Lune')
ok('the starter fiche is written once', existsSync(f) && JSON.parse(readFileSync(f, 'utf8')).slug === 'atelier-lune')
writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), name: 'Edited by hand' }))
c.ensureFiche('Something else')
ok('and never over an existing one', JSON.parse(readFileSync(f, 'utf8')).name === 'Edited by hand')
const parsed = parseFiche(starterFiche('Café Étoilé & Fils'))
ok('the starter fiche is accepted by the service, with a clean slug, no fact, nothing "on its own" but forgetting', /^[a-z0-9-]{3,40}$/.test(parsed.fiche.slug) && parsed.fiche.knowledge.length === 0 && parsed.fiche.guardrails.actions.leave_message === 'approve' && parsed.fiche.guardrails.actions.note_visitor === 'off')
ok('a name that gives no usable slug falls back to one', parseFiche(starterFiche('é')).fiche.slug === 'my-shop' && parseFiche(starterFiche('!!')).fiche.slug === 'my-shop')
process.exit(failed ? 1 : 0)
