#!/usr/bin/env node
/** The cover maker (cover-maker.mjs): a made-up DeepInfra, no network, no key.
 *  Usage: node packages/kybernos-skills/test-cover-maker.mjs   (exit 0 = all pass) */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync, crc32 } from 'node:zlib'
import { touchesEdge, COVER_EXAMPLES, COVER_LIMITS, COVER_MODELS, COVER_STYLE, COVER_TAIL, coverState, coversDir, decodePng, encodePng, fallbackScene, hasCover, idle, keyOf, makeCover, realNet, requestCovers, scenePrompt, setAuto, settingsPath, trimPng } from './cover-maker.mjs'

let pass = 0
const ok = (label) => { pass += 1; console.log('  ✓ ' + label) }
const dsh = mkdtempSync(join(tmpdir(), 'kb-cover-'))
const NOW = Date.parse('2026-10-23T10:00:00Z')

// ── the style is the shipped one ─────────────────────────────────────────────────────────────────
{
  const doc = readFileSync(new URL('../../docs/dev/skills-featured-covers.md', import.meta.url), 'utf8')
  assert.ok(doc.includes('`' + COVER_STYLE + '`'), 'the style is the style sheet\'s, word for word')
  assert.ok(doc.includes('`' + COVER_TAIL + '`'), 'the tail is the style sheet\'s, word for word')
  for (const k of Object.keys(COVER_EXAMPLES)) assert.ok(doc.includes('| `' + k + '` | ' + COVER_EXAMPLES[k] + ' |'), k)
  ok('the style, the tail and the four example scenes are the style sheet of the shipped covers, word for word')
  const p = scenePrompt('ticket-triage', 'Triage a support ticket. Use when a ticket comes in.')
  assert.ok(p.system.includes('- cold-email: ') && p.system.includes('Never put any text') && p.user.includes('Skill: ticket triage') && p.user.includes('Triage a support ticket'))
  assert.ok(fallbackScene('stock-check', 'Reads a stock file. Use when asked.').includes('this task: Reads a stock file'))
  assert.ok(fallbackScene('x-y', '').includes('the task called x y'))
  ok('the scene is asked for in the register of the examples, with a plain fallback')
}

// ── the key ──────────────────────────────────────────────────────────────────────────────────────
{
  assert.equal(keyOf(dsh, {}), '')
  writeFileSync(join(dsh, '.credentials.yaml'), 'OTHER: a\nDEEPINFRA_API_KEY: "abc123"  # mine\n')
  assert.equal(keyOf(dsh, {}), 'abc123')
  assert.equal(keyOf(dsh, { DEEPINFRA_API_KEY: ' fromenv ' }), 'fromenv')
  rmSync(join(dsh, '.credentials.yaml'))
  ok('the key comes from the environment, then from the credentials file; none means none')
}

// ── the PNG ──────────────────────────────────────────────────────────────────────────────────────
const picture = (w, h, box) => {
  const rgba = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4
    const inside = x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]
    rgba[i] = 200; rgba[i + 1] = (x * 3) & 255; rgba[i + 2] = (y * 5) & 255; rgba[i + 3] = inside ? 255 : 0
  }
  return { rgba, png: encodePng(w, h, rgba) }
}
const filtered = (w, h, rgba, type) => {
  // a PNG whose every row uses the same filter type, to prove the decoder undoes all five
  const stride = w * 4
  const raw = Buffer.alloc((stride + 1) * h)
  for (let y = 0; y < h; y += 1) {
    raw[y * (stride + 1)] = type
    for (let x = 0; x < stride; x += 1) {
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0
      let pred = 0
      if (type === 1) pred = a
      else if (type === 2) pred = b
      else if (type === 3) pred = (a + b) >> 1
      else if (type === 4) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); pred = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c) }
      raw[y * (stride + 1) + 1 + x] = (rgba[y * stride + x] - pred) & 255
    }
  }
  const mk = (t, d) => { const body = Buffer.concat([Buffer.from(t, 'latin1'), d]); const o = Buffer.alloc(12 + d.length); o.writeUInt32BE(d.length, 0); body.copy(o, 4); o.writeUInt32BE(crc32(body) >>> 0, 8 + d.length); return o }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 6
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), mk('IHDR', head), mk('IDAT', deflateSync(raw)), mk('IEND', Buffer.alloc(0))])
}
{
  const src = picture(40, 30, [10, 8, 29, 21])
  const back = decodePng(src.png)
  assert.equal(back.width, 40); assert.equal(back.height, 30)
  assert.ok(back.rgba.equals(src.rgba))
  for (const type of [1, 2, 3, 4]) assert.ok(decodePng(filtered(40, 30, src.rgba, type)).rgba.equals(src.rgba), 'filter ' + String(type))
  ok('a PNG is written and read back byte for byte, whatever filter its rows use')
  const trimmed = decodePng(trimPng(src.png))
  // the drawn box is 20 x 14: three percent of 20 is 1 pixel around it
  assert.deepEqual([trimmed.width, trimmed.height], [22, 16])
  const corner = trimmed.rgba[3]
  assert.equal(corner, 0)
  assert.equal(trimmed.rgba[(1 * 22 + 1) * 4 + 3], 255)
  ok('the cut-out is trimmed to its drawn box with three percent of padding')
  assert.equal(trimPng(picture(20, 20, [-5, -5, -1, -1]).png).length > 0, true)
  const all = picture(20, 20, [0, 0, 19, 19]).png
  assert.ok(trimPng(all).equals(all))
  assert.ok(trimPng(Buffer.from('not a png')).equals(Buffer.from('not a png')))
  const rgb = Buffer.from(all); rgb[25] = 2
  assert.ok(trimPng(rgb).equals(rgb))
  ok('a blank picture, a full one, a file that is not a PNG and a colour type it does not read come back as they are')
}

// ── the network, replaced ────────────────────────────────────────────────────────────────────────
const makeFetch = (answers) => {
  const calls = []
  const f = async (url, init) => {
    calls.push({ url: String(url), init })
    const a = answers.shift()
    if (a instanceof Error) throw a
    return a
  }
  f.calls = calls
  return f
}
const jsonRes = (v, status = 200) => ({ ok: status === 200, status, json: async () => v, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer })
{
  const f = makeFetch([
    jsonRes({ choices: [{ message: { content: '"Scene: tiny postmen sorting a mountain of tickets into three baskets, one stamping urgent ones."' } }] }),
    jsonRes({ data: [{ b64_json: Buffer.from('PICTURE').toString('base64') }] }),
    jsonRes({ images: ['data:image/png;base64,' + Buffer.from('CUTOUT').toString('base64')] })
  ])
  const net = realNet('KEY123', f)
  const scene = await net.scene('ticket-triage', 'Triage a ticket')
  assert.equal(scene, 'tiny postmen sorting a mountain of tickets into three baskets, one stamping urgent ones')
  const pic = await net.image('PROMPT')
  assert.equal(pic.toString(), 'PICTURE')
  const cut = await net.cutout(Buffer.from('X'))
  assert.equal(cut.toString(), 'CUTOUT')
  assert.deepEqual(f.calls.map((c) => c.url), ['https://api.deepinfra.com/v1/openai/chat/completions', 'https://api.deepinfra.com/v1/openai/images/generations', 'https://api.deepinfra.com/v1/inference/Bria/remove_background'])
  assert.ok(f.calls.every((c) => c.init.headers.authorization === 'Bearer KEY123' && c.init.redirect === 'error' && c.init.method === 'POST'))
  assert.equal(JSON.parse(f.calls[0].init.body).model, COVER_MODELS.chat)
  const image = JSON.parse(f.calls[1].init.body)
  assert.deepEqual([image.model, image.size, image.response_format, image.prompt], [COVER_MODELS.image, '1344x768', 'b64_json', 'PROMPT'])
  assert.ok(JSON.parse(f.calls[2].init.body).image.startsWith('data:image/png;base64,'))
  ok('the three calls go to api.deepinfra.com only, with the key, no redirect, and the models of the style sheet')

  const f2 = makeFetch([jsonRes({ images: ['https://evil.example/x.png'] }), jsonRes({ images: ['https://xyz.deepinfra.com/tmp/x.png'] }), { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(Buffer.from('FROMURL')).buffer }, jsonRes({ images: ['https://temp.bria.ai/9c4d/x.png'] }), { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from(Buffer.from('FROMBRIA')).buffer }, jsonRes({ images: ['http://temp.bria.ai/9c4d/x.png'] }), jsonRes({ images: ['https://temp.bria.ai.evil.example/x.png'] }), jsonRes({ choices: [{ message: { content: 'ok' } }] }), jsonRes({}, 500), new Error('down')])
  const n2 = realNet('K', f2)
  assert.equal(await n2.cutout(Buffer.from('x')), null)
  assert.equal((await n2.cutout(Buffer.from('x'))).toString(), 'FROMURL')
  assert.equal(f2.calls[2].url, 'https://xyz.deepinfra.com/tmp/x.png')
  assert.equal((await n2.cutout(Buffer.from('x'))).toString(), 'FROMBRIA')
  assert.equal(f2.calls[4].url, 'https://temp.bria.ai/9c4d/x.png')
  assert.equal(await n2.cutout(Buffer.from('x')), null, 'plain http is refused')
  assert.equal(await n2.cutout(Buffer.from('x')), null, 'a look-alike host is refused')
  assert.equal(await n2.scene('a-b', 'd'), '')
  assert.equal(await n2.image('p'), null)
  assert.equal(await n2.image('p'), null)
  ok('a temporary address is fetched only on DeepInfra\'s own hosts and on temp.bria.ai (https, no look-alike); a scene that is too short, a refusal and a network error give nothing')
}

// ── one cover ────────────────────────────────────────────────────────────────────────────────────
// A cut-out that looks like a floating tile (a quarter of the box is see-through) and one that kept its whole background.
const tilePng = () => { const w = 60; const h = 40; const rgba = picture(w, h, [10, 5, 49, 34]).rgba; for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (x % 2 === 1 && y % 2 === 1) rgba[(y * w + x) * 4 + 3] = 0; return encodePng(w, h, rgba) }
const roomPng = () => picture(60, 40, [0, 0, 59, 39]).png
// a tile that reaches the bottom edge of the picture (the frame cropped it)
const croppedPng = () => { const w = 60; const h = 40; const rgba = picture(w, h, [10, 5, 49, 39]).rgba; for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) if (x % 2 === 1 && y % 2 === 1) rgba[(y * w + x) * 4 + 3] = 0; return encodePng(w, h, rgba) }
const goodNet = (calls) => ({
  scene: async (n, d) => { calls.push(['scene', n, d]); return 'tiny people sorting support tickets into trays while one stamps urgent ones' },
  image: async (p) => { calls.push(['image', p]); return tilePng() },
  cutout: async (b) => { calls.push(['cutout']); return b }
})
{
  const calls = []
  const res = await makeCover({ dsh, name: 'ticket-triage', description: 'Triage tickets', net: goodNet(calls), now: NOW })
  assert.deepEqual(res, { ok: true, name: 'ticket-triage', state: 'made', images: 1 })
  const prompt = calls.find((c) => c[0] === 'image')[1]
  assert.equal(prompt, 'tiny people sorting support tickets into trays while one stamps urgent ones. ' + COVER_STYLE + '. ' + COVER_TAIL)
  const file = join(coversDir(dsh), 'ticket-triage.png')
  const written = decodePng(readFileSync(file))
  assert.deepEqual([written.width, written.height], [42, 32])
  const info = JSON.parse(readFileSync(join(coversDir(dsh), 'ticket-triage.cover.json'), 'utf8'))
  assert.equal(info.scene, 'tiny people sorting support tickets into trays while one stamps urgent ones')
  assert.equal(info.fallbackScene, false)
  assert.equal(hasCover(dsh, 'ticket-triage'), true)
  assert.deepEqual(await makeCover({ dsh, name: 'ticket-triage', description: '', net: goodNet([]), now: NOW }), { ok: true, name: 'ticket-triage', state: 'have', images: 0 })
  assert.ok(info.opaqueShare > 0.5 && info.opaqueShare < 0.72 && info.pictures === 1)
  ok('a cover is made from « scene. style. tail », cut out, trimmed and written next to the scene that made it; one that exists is not made again')

  // The cover must be a floating tile: a cut-out that kept its room is tried again (a new picture, told to be one compact tile), the best is kept, and a card whose every try is a room has none.
  const roomCalls = []
  const roomNet = { scene: async () => 'a library with ladders and desks all around', image: async (p) => { roomCalls.push(p); return roomPng() }, cutout: async (b) => b }
  const none = await makeCover({ dsh, name: 'always-a-room', description: 'x', net: roomNet, now: NOW })
  assert.deepEqual(none, { ok: false, error: 'not_a_tile', images: COVER_LIMITS.attempts })
  assert.equal(hasCover(dsh, 'always-a-room'), false)
  assert.ok(!roomCalls[0].endsWith('around it.') && roomCalls[1].endsWith('The whole scene is one compact tile with clear empty white space all around it.'))
  let n = 0
  const secondNet = { scene: async () => 'a map table with tiny surveyors and flags', image: async () => (n += 1) === 1 ? roomPng() : tilePng(), cutout: async (b) => b }
  assert.deepEqual(await makeCover({ dsh, name: 'second-try', description: 'x', net: secondNet, now: NOW }), { ok: true, name: 'second-try', state: 'made', images: 2 })
  const sceneCall = (name) => JSON.parse(readFileSync(join(coversDir(dsh), name + '.cover.json'), 'utf8'))
  assert.equal(sceneCall('second-try').pictures, 2)
  // a tile cropped by the frame is worth less than one that floats: the second try wins, and with only cropped ones the card still gets the best of them
  let c = 0
  const cropNet = { scene: async () => 'a harbour with tiny crane drivers and crates on a long pier', image: async () => (c += 1) === 1 ? croppedPng() : tilePng(), cutout: async (b) => b }
  assert.deepEqual(await makeCover({ dsh, name: 'uncropped-second', description: 'x', net: cropNet, now: NOW }), { ok: true, name: 'uncropped-second', state: 'made', images: 2 })
  assert.equal(touchesEdge(readFileSync(join(coversDir(dsh), 'uncropped-second.png'))), false)
  const allCropped = { scene: async () => 'a harbour with tiny crane drivers and crates on a long pier', image: async () => croppedPng(), cutout: async (b) => b }
  const lastResort = await makeCover({ dsh, name: 'only-cropped', description: 'x', net: allCropped, now: NOW })
  assert.deepEqual([lastResort.ok, lastResort.images], [true, COVER_LIMITS.attempts])
  // a cut-out that fails once is tried again on the same picture (one picture paid for); two failures pay for a new picture
  let cuts = 0
  const flakyNet = { scene: async () => 'tiny chefs around a long table of dishes', image: async () => tilePng(), cutout: async (b) => { cuts += 1; if (cuts === 1) throw new Error('down'); return b } }
  assert.deepEqual(await makeCover({ dsh, name: 'flaky-cut', description: 'x', net: flakyNet, now: NOW }), { ok: true, name: 'flaky-cut', state: 'made', images: 1 })
  const deadNet = { scene: async () => 'tiny chefs around a long table of dishes', image: async () => tilePng(), cutout: async () => null }
  assert.deepEqual(await makeCover({ dsh, name: 'dead-cut', description: 'x', net: deadNet, now: NOW }), { ok: false, error: 'cutout_failed', images: COVER_LIMITS.attempts })
  ok('a cut-out that kept its room is tried again with a new picture, the best tile is kept, none is written when every try is a room; a failing cut-out is tried twice on the same picture before a new one is paid for')

  const calls2 = []
  const net2 = { ...goodNet(calls2), scene: async () => '' }
  await makeCover({ dsh, name: 'stock-check', description: 'Reads a stock file. Use when asked.', net: net2, now: NOW })
  assert.ok(calls2.find((c) => c[0] === 'image')[1].startsWith('tiny people at work on a miniature workshop table around this task: Reads a stock file'))
  assert.equal(JSON.parse(readFileSync(join(coversDir(dsh), 'stock-check.cover.json'), 'utf8')).fallbackScene, true)
  assert.deepEqual(await makeCover({ dsh, name: 'bad-1', description: '', net: { ...goodNet([]), image: async () => null }, now: NOW }), { ok: false, error: 'image_failed', images: 0 })
  assert.deepEqual(await makeCover({ dsh, name: 'bad-2', description: '', net: { ...goodNet([]), cutout: async () => null }, now: NOW }), { ok: false, error: 'cutout_failed', images: COVER_LIMITS.attempts })
  assert.deepEqual(await makeCover({ dsh, name: 'Bad Name', description: '', net: goodNet([]), now: NOW }), { ok: false, error: 'bad_name', images: 0 })
  assert.equal(hasCover(dsh, 'bad-1'), false)
  ok('a model that does not answer gives the plain scene; a failed picture or cut-out writes nothing; a bad name is refused')
}

// ── the queue, the day's limit, the switch ───────────────────────────────────────────────────────
{
  const root = mkdtempSync(join(tmpdir(), 'kb-cover-q-'))
  assert.equal(coverState({ dsh: root, names: ['a-b'], now: NOW, env: {} }).can, false)
  assert.deepEqual(requestCovers({ dsh: root, items: [{ name: 'a-b', description: 'd' }], now: NOW, env: {} }).items, { 'a-b': 'none' })
  ok('without a key nothing is made and nothing is queued')

  const env = { DEEPINFRA_API_KEY: 'k' }
  const order = []
  const slow = { scene: async (n) => { order.push('start ' + n); await new Promise((r) => setTimeout(r, 15)); return 'tiny people doing a thing with many props and a long scene for ' + n }, image: async () => tilePng(), cutout: async (b) => b }
  const names = Array.from({ length: 20 }, (_, i) => 'skill-' + String(i).padStart(2, '0'))
  const first = requestCovers({ dsh: root, items: names.map((n) => ({ name: n, description: 'x' })), net: slow, now: NOW, env })
  assert.equal(first.can, true)
  // one request takes at most twelve names; the day's sixteen are spent over two of them
  assert.equal(Object.values(first.items).filter((v) => v === 'queued').length, 12)
  assert.equal(Object.values(first.items).filter((v) => v === 'none').length, names.length - 12)
  const mid = coverState({ dsh: root, names: names.slice(0, 2), now: NOW, env })
  assert.ok(['making', 'queued'].includes(mid.items['skill-00']))
  await idle()
  const second = requestCovers({ dsh: root, items: names.slice(12).map((n) => ({ name: n, description: 'x' })), net: slow, now: NOW, env })
  assert.equal(second.left, COVER_LIMITS.perDay - 12)
  assert.equal(Object.values(second.items).filter((v) => v === 'queued').length, COVER_LIMITS.perDay - 12)
  await idle()
  assert.deepEqual(order.slice(0, 3), ['start skill-00', 'start skill-01', 'start skill-02'])
  assert.equal(order.length, COVER_LIMITS.perDay)
  assert.ok(names.slice(0, COVER_LIMITS.perDay).every((n) => hasCover(root, n)))
  const after = coverState({ dsh: root, names, now: Date.now(), env })
  assert.equal(after.left, 0)
  assert.equal(after.items[names[names.length - 1]], 'limit')
  ok('covers are made one at a time, at most sixteen a day (every picture paid for counts); the rest says « limit »')

  const flopRoot = mkdtempSync(join(tmpdir(), 'kb-cover-f-'))
  const flop = { scene: async () => '', image: async () => null, cutout: async (b) => b }
  requestCovers({ dsh: flopRoot, items: [{ name: 'skill-09', description: 'x' }], net: flop, env })
  await idle()
  assert.equal(coverState({ dsh: flopRoot, names: ['skill-09'], env }).items['skill-09'], 'failed')
  assert.equal(coverState({ dsh: flopRoot, names: ['skill-09'], now: Date.now() + 30 * 60 * 1000, env }).items['skill-09'], 'none')
  ok('a failure waits a quarter of an hour before the cover is tried again')
  rmSync(flopRoot, { recursive: true, force: true })
  setAuto(root, false)
  assert.equal(coverState({ dsh: root, names: [], now: NOW, env }).can, false)
  assert.equal(JSON.parse(readFileSync(settingsPath(root), 'utf8')).auto, false)
  assert.equal((statSync(settingsPath(root)).mode & 0o777), 0o600)
  setAuto(root, true)
  assert.equal(coverState({ dsh: root, names: [], now: NOW, env }).can, true)
  ok('the person\'s switch turns it off and on; the file is 0600')
  rmSync(root, { recursive: true, force: true })
}

rmSync(dsh, { recursive: true, force: true })
console.log(pass + ' tests passed')
