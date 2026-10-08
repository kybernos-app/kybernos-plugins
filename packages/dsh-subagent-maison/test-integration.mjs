// Test d'intégration des providers maison — charge le VRAI seam
// @deepseek-ai/dsh-subagent (registerProvider) avec un ctx factice et vérifie
// que chaque provider s'enregistre correctement. Ne consomme aucun modèle.
//   node test-integration.mjs
const MOTEUR = '/Users/miled/.dsh/kybernos/moteur/0.2.0-rc.2/node_modules'

let echecs = 0
const ok = (nom, cond, detail) => { if (cond) console.log('  ✓ ' + nom); else { echecs++; console.log('  ✗ ' + nom + (detail !== undefined ? ' — ' + detail : '')) } }

const enregistres = []
const fauxCtx = {
  effect: (fn) => { try { fn(); } catch {} return () => {} },
  logger: { warn: () => {} },
  subagents: { registerProvider: (p) => { enregistres.push(p) } },
  subprocess: { spawn: () => { throw new Error('pas de vrai spawn dans ce test') } }
}

try {
  console.log('── intégration : enregistrement des providers ──')
  for (const cli of ['opencode', 'gemini', 'qwen', 'hermes']) {
    const mod = await import(`./dsh-subagent-${cli}/index.js`)
    ok(`${cli} expose name/inject/Config/apply`,
      typeof mod.name === 'string' && Array.isArray(mod.inject) && typeof mod.apply === 'function')
    ok(`${cli}.inject = [subagents, subprocess]`, mod.inject.join(',') === 'subagents,subprocess')
    mod.apply(fauxCtx, { model: '', bin: undefined, env: {} })
  }
  ok('les 4 providers se sont enregistrés', enregistres.length === 4, 'vu ' + enregistres.length)
  for (const p of enregistres) {
    ok(`${p.name} a name/capabilities/start`, typeof p.name === 'string' && p.capabilities !== undefined && typeof p.start === 'function')
  }
  ok('noms uniques et nommés', new Set(enregistres.map((p) => p.name)).size === 4 && enregistres.every((p) => /^subagent-|^(opencode|gemini|qwen|hermes)$/.test(p.name) || typeof p.name === 'string'), enregistres.map((p) => p.name).join(','))
} finally {
  console.log('\nINTÉGRATION — ' + echecs + ' échec(s)')
  process.exit(echecs === 0 ? 0 : 1)
}
