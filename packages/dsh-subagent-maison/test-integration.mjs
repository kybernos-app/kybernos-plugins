// The providers against the REAL DSH engine — loads the real @deepseek-ai/dsh-subagent seam with a stub context and checks
// that each provider registers properly and that its config schema parses. No model is spent.
//   node packages/dsh-subagent-maison/test-integration.mjs
//
// The engine is found the way the providers find it (moteur.mjs): KB_MOTEUR, the running dsh, the profile's official
// providers, the profile. When there is none (CI, a machine without DSH) the test says so and exits 0 — the same wiring runs on
// a fixture engine in test-moteur.mjs. A crash inside the test counts as a failure: it must never read as a pass.
import { tmpdir } from 'node:os'
import { chargerMoteur } from './moteur.mjs'

let echecs = 0
const ok = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }

try {
  await chargerMoteur()
} catch (e) {
  console.log('SKIPPED: the providers against the real DSH engine — no DSH engine found (' + String(e.message).split(' — ')[0] + ')')
  console.log('INTEGRATION — 0 checks run, SKIPPED')
  process.exit(0)
}

const enregistres = []
const fauxCtx = {
  effect: (fn) => { try { fn() } catch { /* the registration is what is tested */ } return () => {} },
  logger: { warn: () => {} },
  subagents: { registerProvider: (p) => { enregistres.push(p) } },
  subprocess: { spawn: () => { throw new Error('no real spawn in this test') } }
}

try {
  console.log('── integration: the providers register on the real seam ──')
  for (const cli of ['opencode', 'gemini', 'qwen', 'hermes']) {
    const mod = await import(`./dsh-subagent-${cli}/index.js`)
    ok(`${cli} exports name/inject/Config/apply`, typeof mod.name === 'string' && Array.isArray(mod.inject) && typeof mod.apply === 'function' && mod.Config !== undefined)
    ok(`${cli}.inject = [subagents, subprocess]`, mod.inject.join(',') === 'subagents,subprocess')
    let defauts = null
    try { defauts = mod.Config({}) } catch (e) { defauts = { erreur: String(e.message) } }
    ok(`${cli}: the engine's own schema parses an empty config and fills the defaults`, defauts !== null && defauts.erreur === undefined && defauts.providerName === cli && defauts.model === '' && defauts.bin === cli, JSON.stringify(defauts))
    mod.apply(fauxCtx, { model: '', bin: undefined, env: {} })
  }
  ok('the 4 providers registered', enregistres.length === 4, 'saw ' + enregistres.length)
  for (const p of enregistres) ok(`${p.name} has name/capabilities/start`, typeof p.name === 'string' && p.capabilities !== undefined && typeof p.start === 'function')
  ok('the names are the ones the Workers page writes tool lines for', enregistres.map((p) => p.name).join() === 'opencode,gemini,qwen,hermes', enregistres.map((p) => p.name).join())

  // A run, end to end, through the engine's REAL helpers (settleRunResult, subprocessRunHandle, resolveChildCwd, the scrubbed
  // environment): only the process is faked, so no model and no CLI is needed.
  console.log('── a run through the real engine helpers ──')
  const sortie = (texte, code) => ({ stdout: { on: (e, f) => { if (e === 'data') setImmediate(() => f(Buffer.from(texte))) } }, stderr: { on: () => {} }, done: new Promise((resolve) => setTimeout(() => resolve({ exitCode: code, signal: null }), 20)), terminate: () => {}, waitForExit: async () => {} })
  const lances = []
  for (const [i, p] of enregistres.entries()) {
    // each provider got its own ctx at apply time: rebuild one whose spawn we control
    const mod = await import(`./dsh-subagent-${['opencode', 'gemini', 'qwen', 'hermes'][i]}/index.js`)
    const ctx = { effect: (fn) => { fn(); return () => {} }, logger: { warn: () => {} }, subagents: { registerProvider: (x) => { ctx.provider = x } }, subprocess: { spawn: (spec) => { lances.push(spec); return sortie('done: ' + p.name + '\n', 0) } } }
    mod.apply(ctx, { model: 'a-model', env: {} })
    const poignee = await ctx.provider.start({ parent: { session: { header: { cwd: tmpdir() } } }, prompt: [{ type: 'text', text: 'task text' }], signal: new AbortController().signal })
    const r = await poignee.result
    ok(`${p.name}: a real run settles as completed with the CLI's output`, r.stopReason === 'completed' && r.output[0].text === 'done: ' + p.name && typeof poignee.id === 'string' && typeof poignee.dispose === 'function', JSON.stringify(r))
    await poignee.dispose()
  }
  ok('each CLI was started in the parent session folder, with the task last or after its flag', lances.every((l) => l.cwd === tmpdir() && l.argv.includes('task text')) && lances.length === 4)
  ok('and none of them was given a secret-looking variable of this process', lances.every((l) => !Object.keys(l.env).some((k) => /^(ANTHROPIC|OPENAI)_API_KEY$|^GITHUB_TOKEN$/.test(k))))

  console.log('── credential precedence at boot vs per-run store (Phase 0) ──')
  {
    const prevGemini = process.env.GEMINI_API_KEY
    const prevQwen = process.env.QWEN_TOKEN_PLAN_API_KEY
    try {
      process.env.GEMINI_API_KEY = 'boot-env-gemini-key'
      process.env.QWEN_TOKEN_PLAN_API_KEY = 'boot-env-qwen-key'
      const geminiMod = await import('./dsh-subagent-gemini/index.js')
      const qwenMod = await import('./dsh-subagent-qwen/index.js')

      // 1. Live credentials store overrides a stale boot-time process.env value on every run (no restart)
      const storeValues = { GEMINI_API_KEY: 'live-store-gemini-key-v1', QWEN_TOKEN_PLAN_API_KEY: 'live-store-qwen-key-v1' }
      const seenEnvs = []
      const seenArgvs = []
      const makeCtx = () => {
        const ctx = {
          effect: (fn) => { fn(); return () => {} },
          logger: { warn: () => {} },
          credentials: { resolve: async (nom) => (storeValues[nom] !== undefined ? { value: storeValues[nom], source: 'store' } : undefined) },
          subagents: { registerProvider: (x) => { ctx.provider = x } },
          subprocess: { spawn: (spec) => { seenEnvs.push(spec.env); seenArgvs.push(spec.argv); return sortie('ok\n', 0) } }
        }
        return ctx
      }
      const gCtx = makeCtx()
      geminiMod.apply(gCtx, { model: '', env: {} })
      const qCtx = makeCtx()
      qwenMod.apply(qCtx, { model: '', env: {} })

      const gRun1 = await gCtx.provider.start({ parent: { session: { header: { cwd: tmpdir() } } }, prompt: [{ type: 'text', text: 't1' }], signal: new AbortController().signal })
      await gRun1.result; await gRun1.dispose()
      const qRun1 = await qCtx.provider.start({ parent: { session: { header: { cwd: tmpdir() } } }, prompt: [{ type: 'text', text: 't2' }], signal: new AbortController().signal })
      await qRun1.result; await qRun1.dispose()

      // 2. Rotating the key in the store takes effect on the very next run without re-applying the plugin
      storeValues.GEMINI_API_KEY = 'live-store-gemini-key-v2'
      const gRun2 = await gCtx.provider.start({ parent: { session: { header: { cwd: tmpdir() } } }, prompt: [{ type: 'text', text: 't3' }], signal: new AbortController().signal })
      await gRun2.result; await gRun2.dispose()

      // 3. Clearing the store falls back to launch-time process.env
      delete storeValues.GEMINI_API_KEY
      const gRun3 = await gCtx.provider.start({ parent: { session: { header: { cwd: tmpdir() } } }, prompt: [{ type: 'text', text: 't4' }], signal: new AbortController().signal })
      await gRun3.result; await gRun3.dispose()

      ok('gemini: live credentials store wins over boot-time process.env', seenEnvs[0].GEMINI_API_KEY === 'live-store-gemini-key-v1', seenEnvs[0].GEMINI_API_KEY)
      ok('qwen: live credentials store wins over boot-time process.env (forwarded via OPENAI_API_KEY)', seenEnvs[1].OPENAI_API_KEY === 'live-store-qwen-key-v1', seenEnvs[1].OPENAI_API_KEY)
      ok('gemini: rotating the store key reaches the next run with no restart', seenEnvs[2].GEMINI_API_KEY === 'live-store-gemini-key-v2', seenEnvs[2].GEMINI_API_KEY)
      ok('gemini: launch-time process.env remains the fallback when store is empty', seenEnvs[3].GEMINI_API_KEY === 'boot-env-gemini-key', seenEnvs[3].GEMINI_API_KEY)
      ok('no resolved API key ever appears in argv', seenArgvs.every((a) => !a.join(' ').includes('live-store-') && !a.join(' ').includes('boot-env-')))
    } finally {
      if (prevGemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = prevGemini
      if (prevQwen === undefined) delete process.env.QWEN_TOKEN_PLAN_API_KEY; else process.env.QWEN_TOKEN_PLAN_API_KEY = prevQwen
    }
  }
} catch (e) {
  echecs++
  console.log('  ✗ the test itself stopped — ' + String(e && e.stack ? e.stack : e).split('\n').slice(0, 4).join(' | '))
} finally {
  console.log('\nINTEGRATION — ' + echecs + ' failure(s)')
  process.exit(echecs === 0 ? 0 : 1)
}
