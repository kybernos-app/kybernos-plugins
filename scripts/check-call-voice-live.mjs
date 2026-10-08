#!/usr/bin/env node
// A call's voice, end to end against the app's REAL voice engine: the worker's code (call_voice.py, in the worker's own
// Python environment) asks the core's /kybernos/tts/speak for a sentence, gets the real m4a back and decodes it.
//
//   source scripts/sandbox/env.sh && node scripts/check-call-voice-live.mjs [--edge]
//
// It needs a sandbox instance (scripts/sandbox/setup.sh + start.sh); refuses the user's own DSH (exit 3). The worker's
// Python is $KB_CALL_PYTHON, else <real home>/.dsh/kybernos/appel-venv/bin/python (the venv of the call worker).
//
// Only LOCAL engines are used (macOS `say`, Piper, Supertonic): no text leaves the machine. `--edge` adds the Edge engine,
// which sends the sentence to Microsoft's online voice service.
//
// What it checks: the engines the app has, a member's voice on one of them (the request the worker builds, the answer, the
// audio it decodes: its length, that it is not silence), and the same call asked for another language (the engine picks a
// voice of that language). Nothing is played. It writes only the engine's own cache under the sandbox's DSH_HOME.
// Exit code 0 / 1 / 3.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const agentDir = join(here, '..', 'packages', 'kybernos-call', 'agent')
const host = process.env.KB_HOST || '127.0.0.1:3080'
if (host === '127.0.0.1:3080') { console.error('○ inconclusive: this check needs a sandbox instance, not the one on :3080. Set KB_HOST, DSH_HOME and HOME (source scripts/sandbox/env.sh).'); process.exit(3) }
const python = process.env.KB_CALL_PYTHON || join(process.env.KB_REAL_HOME || homedir(), '.dsh', 'kybernos', 'appel-venv', 'bin', 'python')
if (!existsSync(python)) { console.error('○ inconclusive: no worker Python at ' + python + ' (set KB_CALL_PYTHON)'); process.exit(3) }
const withEdge = process.argv.includes('--edge')

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok === true) { pass += 1; console.log('  ✓ ' + name) } else { fail += 1; console.log('  ✗ ' + name + (detail === undefined ? '' : ' — ' + JSON.stringify(detail))) }
}

console.log('the engines the app has')
const listed = await fetch('http://' + host + '/kybernos/tts/voices').then((r) => r.json()).catch(() => null)
const engines = (listed && Array.isArray(listed.engines)) ? listed.engines.filter((e) => e.ready === true && Array.isArray(e.voices) && e.voices.length > 0) : []
const usable = engines.filter((e) => ['say', 'piper', 'supertonic'].includes(e.id) || (withEdge && e.id === 'edge'))
console.log('    ready: ' + engines.map((e) => e.id + ' (' + e.voices.length + ' voices)').join(', '))
check('the app lists its voice engines', listed !== null && listed.ok === true && engines.length > 0, listed && listed.ok)
if (usable.length === 0) { console.error('○ inconclusive: no local engine is ready in this instance'); process.exit(3) }

const engine = usable[0]
const wanted = engine.voices.find((v) => v.lang === 'fr') || engine.voices[0]
const other = engine.voices.find((v) => v.lang && v.lang !== wanted.lang && v.lang === 'es') || engine.voices.find((v) => v.lang && v.lang !== wanted.lang)
console.log('    using ' + engine.id + ', voice "' + wanted.id + '" (' + wanted.lang + ')' + (other ? ', then a ' + other.lang + ' voice exists' : ''))

// The worker's own code does the asking, in the worker's Python.
const probe = `
import json, sys
sys.path.insert(0, ${JSON.stringify(agentDir)})
from call_meta import CallMeta, VoiceChoice
from call_voice import audio_bytes, decode_pcm, speak_request, voice_request
import numpy as np
host, engine, voice, lang, text, language = sys.argv[1:7]
meta = CallMeta(language="auto", voice=VoiceChoice(engine, voice, lang))
fields = voice_request(meta, language)
answer = speak_request(host, text, fields)
pcm = decode_pcm(audio_bytes(answer))
samples = np.frombuffer(pcm, dtype=np.int16)
print(json.dumps({"fields": fields, "engine": answer.get("engine"), "voice": answer.get("voice"), "lang": answer.get("lang"),
                  "seconds": round(len(samples) / 24000, 2), "peak": int(np.abs(samples).max()), "cached": answer.get("cached")}))
`
const ask = (text, language) => {
  const r = spawnSync(python, ['-B', '-c', probe, 'http://' + host, engine.id, wanted.id, wanted.lang || '', text, language], { encoding: 'utf8', env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }), timeout: 120000 })
  if (r.status !== 0) return { error: String(r.stderr).split('\n').filter(Boolean).slice(-2).join(' | ') }
  try { return JSON.parse(String(r.stdout).trim().split('\n').pop()) } catch (e) { return { error: 'unreadable: ' + String(r.stdout).slice(0, 120) } }
}

console.log('a member\'s voice, in the member\'s language')
const first = ask('Bonjour, voici une phrase pour essayer la voix de l\'appel.', wanted.lang || 'fr')
check('the worker\'s request reached the app\'s engine and came back as audio', first.error === undefined, first)
if (first.error === undefined) {
  check('the engine used is the one asked for, with the member\'s voice', first.engine === engine.id && first.voice === wanted.id, first)
  check('the audio decodes to a sentence\'s worth of speech (> 1 s)', first.seconds > 1, first.seconds)
  check('and it is a real signal, not silence', first.peak > 500, first.peak)
}

if (other) {
  console.log('the same member, a reply in another language (' + other.lang + ')')
  const second = ask('Hola, esta es una frase para probar la voz de la llamada.', other.lang)
  check('the engine answered', second.error === undefined, second)
  if (second.error === undefined) {
    check('the worker asked for the other language, on the same engine, without forcing the member\'s voice', second.fields.lang === other.lang && second.fields.engine === engine.id && second.fields.voice === undefined, second.fields)
    check('the engine picked a voice of that language', second.lang === other.lang && second.voice !== wanted.id, { lang: second.lang, voice: second.voice })
    check('and it speaks (> 1 s, a real signal)', second.seconds > 1 && second.peak > 500, second)
  }
} else {
  console.log('    (this engine has no voice in another language here: that part is skipped)')
}

console.log('\n' + (fail === 0 ? '✓' : '✗') + ' kybernos-call voice live: ' + pass + ' passed, ' + fail + ' failed')
process.exit(fail === 0 ? 0 : 1)
