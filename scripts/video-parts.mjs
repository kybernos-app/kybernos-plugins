#!/usr/bin/env node
// The raw parts of a shelf video (docs/dev/templates-catalogue.md): a clip, a voice, a piece of music, and a way to hear what was said.
// Every part is paid for here, one call at a time, and written as a file OUTSIDE the repository; scripts/video-compose.mjs cuts them together.
//
//   node scripts/video-parts.mjs clip   <out.mp4>   [--image in.jpg] [--aspect 16:9|9:16] [--seconds 5..15] [--res 480p|768p|1080p|2k] [--enhance turbo|quality|ultraquality|disabled] [--seed N] "<prompt>"
//   node scripts/video-parts.mjs restore <out.jpg>  --image old.jpg [--model bfl/flux-kontext-pro] [--aspect 16:9] [--seed N] "<what to restore>"      an old picture made clear and sharp by an image-edit model (about $0.04), the first frame of a clean film
//   node scripts/video-parts.mjs music  <out.mp3>   [--seconds 30..500] [--lyrics "<text>"] "<style prompt>"
//   node scripts/video-parts.mjs voice  <out.mp3>   [--voice af_heart] [--speed 1] "<text>"
//   node scripts/video-parts.mjs listen <file.mp4|mp3|wav> [--segments 1]       prints what a speech model hears in the file (the only way to check a voice here); --segments adds when each line starts and ends
//
// clip:  HeyGen Video 1 on the Vercel AI Gateway (about $0.02 a second at 480p, $0.03 at 768p; it makes its own sound, and speaks a line written in the prompt).
//        The AI SDK is not a dependency of this repository: it lives in the folder KB_GW_DIR (default ~/kybernos-archive/templates-catalogue/tools/gw,
//        `npm i ai @ai-sdk/gateway` there). Without --image the clip is made from the prompt alone.
// music: ACE-Step 1.5 on DeepInfra ($0.001 a second, 30 s at least; cut it afterwards). voice: Kokoro 82M on DeepInfra (almost free). listen: Whisper on DeepInfra.
// Keys: VERCEL_AI_GATEWAY_API_KEY and DEEPINFRA_API_KEY from the environment, else from <DSH home>/.credentials.yaml. They are sent as bearer headers and never printed.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [cmd, ...rest] = process.argv.slice(2)
const flags = {}
const words = []
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--') && rest[i + 1] !== undefined) { flags[rest[i].slice(2)] = rest[i + 1]; i++ } else words.push(rest[i])
}
const out = words[0]
const text = words.slice(1).join(' ')
const fail = (m) => { console.error(m); process.exit(1) }
if (!['clip', 'restore', 'music', 'voice', 'listen'].includes(cmd) || out === undefined) fail('usage: node scripts/video-parts.mjs clip|restore|music|voice <out> [flags] "<text>"  |  listen <file>')

const credential = (name) => {
  if (process.env[name]) return process.env[name]
  try {
    for (const line of readFileSync(join(process.env.DSH_HOME || join(homedir(), '.dsh'), '.credentials.yaml'), 'utf8').split('\n')) {
      const m = new RegExp('^\\s*' + name + '\\s*:\\s*(\\S+)').exec(line)
      if (m) return m[1].replace(/^['"]|['"]$/g, '')
    }
  } catch (e) { /* no file: the key is missing */ }
  return fail(name + ' is not set (environment or <DSH home>/.credentials.yaml)')
}
const save = (file, bytes) => { mkdirSync(dirname(resolve(file)), { recursive: true }); writeFileSync(resolve(file), bytes) }
const ffmpeg = (...a) => execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a])

/** One DeepInfra inference call; the answer carries the audio as a data URL or an address, whichever the model uses. */
const deepinfra = async (model, body) => {
  const res = await fetch('https://api.deepinfra.com/v1/inference/' + model, {
    method: 'POST', headers: { authorization: 'bearer ' + credential('DEEPINFRA_API_KEY'), 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(600000)
  })
  if (res.status !== 200) fail(model + ' answered ' + res.status + ': ' + (await res.text()).slice(0, 200).replace(/\s+/g, ' '))
  const json = await res.json()
  const field = Object.values(json).find((v) => typeof v === 'string' && /^(data:|https?:)/.test(v))
  if (field === undefined) fail(model + ' answered without audio (fields: ' + Object.keys(json).join(', ') + ')')
  if (field.startsWith('data:')) return Buffer.from(field.slice(field.indexOf(',') + 1), 'base64')
  return Buffer.from(await (await fetch(field)).arrayBuffer())
}

if (cmd === 'clip') {
  const gw = resolve(process.env.KB_GW_DIR || join(homedir(), 'kybernos-archive', 'templates-catalogue', 'tools', 'gw'))
  const { experimental_generateVideo: generateVideo } = await import(pathToFileURL(join(gw, 'node_modules', 'ai', 'dist', 'index.js')).href)
  const { createGateway } = await import(pathToFileURL(join(gw, 'node_modules', '@ai-sdk', 'gateway', 'dist', 'index.js')).href)
  const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY || credential('VERCEL_AI_GATEWAY_API_KEY') })
  const started = Date.now()
  const result = await generateVideo({
    model: gateway.video('heygen/heygen-video-1'),
    prompt: flags.image !== undefined ? { image: readFileSync(resolve(flags.image)), text } : text,
    duration: Number(flags.seconds || 5), aspectRatio: flags.aspect || '16:9', seed: Number(flags.seed || 1),
    providerOptions: { heygen: { resolution: flags.res || '768p', ...(flags.enhance !== undefined ? { promptEnhancement: flags.enhance } : {}) } },
    poll: { intervalMs: 5000, timeoutMs: 900000 }
  })
  save(out, result.videos[0].uint8Array)
  console.log(out + ': ' + Math.round((Date.now() - started) / 1000) + ' s, ' + result.videos[0].uint8Array.length + ' bytes ' + JSON.stringify(result.warnings || []).slice(0, 200))
} else if (cmd === 'restore') {
  const gw = resolve(process.env.KB_GW_DIR || join(homedir(), 'kybernos-archive', 'templates-catalogue', 'tools', 'gw'))
  const { generateImage } = await import(pathToFileURL(join(gw, 'node_modules', 'ai', 'dist', 'index.js')).href)
  const { createGateway } = await import(pathToFileURL(join(gw, 'node_modules', '@ai-sdk', 'gateway', 'dist', 'index.js')).href)
  const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY || credential('VERCEL_AI_GATEWAY_API_KEY') })
  if (flags.image === undefined) fail('restore needs --image <the old picture>')
  const result = await generateImage({
    model: gateway.image(flags.model || 'bfl/flux-kontext-pro'),
    prompt: { images: [readFileSync(resolve(flags.image))], text },
    aspectRatio: flags.aspect || '16:9', seed: Number(flags.seed || 1)
  })
  save(out, result.images[0].uint8Array)
  console.log(out + ': ' + result.images[0].uint8Array.length + ' bytes ' + JSON.stringify(result.warnings || []).slice(0, 200))
} else if (cmd === 'music') {
  const body = { prompt: text, duration: Math.max(30, Number(flags.seconds || 30)), response_format: 'mp3' }
  if (flags.lyrics !== undefined) body.lyrics = flags.lyrics
  const bytes = await deepinfra('ACE-Step/acestep-v15-xl-sft', body)
  save(out, bytes)
  console.log(out + ': ' + bytes.length + ' bytes')
} else if (cmd === 'voice') {
  const bytes = await deepinfra('hexgrad/Kokoro-82M', { text, preset_voice: [flags.voice || 'af_heart'], output_format: 'mp3', speed: Number(flags.speed || 1) })
  save(out, bytes)
  console.log(out + ': ' + bytes.length + ' bytes')
} else {
  const dir = mkdtempSync(join(tmpdir(), 'listen-'))
  try {
    ffmpeg('-i', resolve(out), '-vn', '-ac', '1', '-ar', '16000', join(dir, 'a.wav'))
    const form = new FormData()
    form.append('model', 'openai/whisper-large-v3')
    if (flags.segments !== undefined) form.append('response_format', 'verbose_json')
    form.append('file', new Blob([readFileSync(join(dir, 'a.wav'))], { type: 'audio/wav' }), 'a.wav')
    const res = await fetch('https://api.deepinfra.com/v1/openai/audio/transcriptions', { method: 'POST', headers: { authorization: 'bearer ' + credential('DEEPINFRA_API_KEY') }, body: form })
    if (res.status !== 200) fail('whisper answered ' + res.status + ': ' + (await res.text()).slice(0, 200))
    const heard = await res.json()
    if (flags.segments !== undefined && Array.isArray(heard.segments)) { for (const s of heard.segments) console.log('[' + s.start.toFixed(1) + ' - ' + s.end.toFixed(1) + '] ' + String(s.text).trim()) } else console.log((heard.text || '').trim() || '(nothing heard)')
  } finally { rmSync(dir, { recursive: true, force: true }) }
}
