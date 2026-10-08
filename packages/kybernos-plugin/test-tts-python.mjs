// Which Python runs a voice engine: the first one that can import its module.
import assert from 'node:assert/strict'
import { createPythonPicker, TTS_PYTHONS } from './tts-python.mjs'

let n = 0
const ok = (name) => { n += 1; console.log('  ✓ ' + name) }
const fake = (has) => {
  const calls = []
  const exec = async (bin, argv) => { calls.push(bin + ' ' + argv.join(' ')); return { ok: (has[bin] ?? []).includes(argv[1].replace('import ', '')) } }
  return { exec, calls }
}

console.log('kybernos tts-python')
{
  // The measured case: DSH was started with Homebrew's python3, Piper and edge-tts are in the system's.
  const f = fake({ '/usr/bin/python3': ['piper', 'edge_tts'] })
  const picker = createPythonPicker(f.exec, ['python3', '/usr/bin/python3', '/opt/homebrew/bin/python3'])
  assert.equal(await picker.first('piper'), '/usr/bin/python3')
  assert.equal(picker.pythonOf('piper'), '/usr/bin/python3')
  assert.equal(await picker.first('edge_tts'), '/usr/bin/python3')
  ok('an engine whose module is only in the system Python runs with the system Python')
}
{
  const f = fake({ python3: ['piper'], '/usr/bin/python3': ['piper'] })
  const picker = createPythonPicker(f.exec, ['python3', '/usr/bin/python3'])
  assert.equal(await picker.first('piper'), 'python3')
  assert.deepEqual(f.calls, ['python3 -c import piper'])
  ok('the first interpreter that works is the one used, and the others are not even tried')
}
{
  const f = fake({})
  const picker = createPythonPicker(f.exec, ['python3', '/usr/bin/python3'])
  assert.equal(await picker.first('supertonic'), null)
  assert.equal(picker.pythonOf('supertonic'), 'python3')
  ok('a module no interpreter has: not found, and the default name is kept so the error stays readable')
}
{
  let seen = 0
  const picker = createPythonPicker(async () => { seen += 1; throw new Error('boom') }, ['a', 'b', 'a'])
  assert.equal(await picker.first('piper'), null)
  assert.equal(seen, 2)
  ok('an interpreter that cannot even be run is skipped, and the same one is not tried twice')
}
{
  const state = { has: ['piper'] }
  const picker = createPythonPicker(async (bin) => ({ ok: bin === '/usr/bin/python3' && state.has.includes('piper') }), ['python3', '/usr/bin/python3'])
  assert.equal(await picker.first('piper'), '/usr/bin/python3')
  state.has = []
  assert.equal(await picker.first('piper'), null)
  assert.equal(picker.pythonOf('piper'), 'python3')
  ok('when a module goes away the remembered interpreter is forgotten')
}
{
  assert.ok(TTS_PYTHONS.includes('python3') && TTS_PYTHONS.includes('/usr/bin/python3'))
  ok('the default candidates are the PATH python3 first, then the usual system locations')
}
console.log('\nkybernos tts-python: ' + n + ' checks')
