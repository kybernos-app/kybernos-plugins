// The retouch of a shop photo (shop-photo.mjs). Two kinds of check: the logic (which sides and qualities are tried, what is refused) against a stand-in for the image library, and the
// real thing against `sharp` when this machine has it (the cloud image does; a Mac running the plugin tests may not, and then that part says it was skipped, it does not pass in silence).
// Run: node test-shop-photo.mjs
import { LOOK_SETTINGS, MAX_BYTES, MAX_LIFT, QUALITIES, SIDES, TARGET_MEAN, createLazyRetouch, createRetouch, exposureFor, loadSharp } from './shop-photo.mjs'

let fail = 0
const ok = (name, cond, detail) => { if (cond) console.log('ok   ' + name); else { fail += 1; console.log('FAIL ' + name + (detail === undefined ? '' : '  ' + JSON.stringify(detail).slice(0, 400))) } }

/** A stand-in for sharp: a chain that records what was asked and weighs the output by a table of `edge/quality → bytes`. */
const standIn = ({ width = 3000, height = 4000, weigh = () => 100_000, broken = false, mean = TARGET_MEAN, noStats = false } = {}) => {
  const log = []
  const make = (ops) => {
    const chain = {
      rotate: () => { ops.push('rotate'); return chain },
      clone: () => make([...ops]),
      metadata: async () => ({ width, height }),
      resize: (o) => { ops.push({ resize: o }); return chain },
      normalise: () => { ops.push('normalise'); return chain },
      modulate: (o) => { ops.push({ modulate: o }); return chain },
      sharpen: (o) => { ops.push({ sharpen: o }); return chain },
      jpeg: (o) => { ops.push({ jpeg: o }); return chain },
      stats: async () => { if (noStats) throw new Error('no stats'); return { channels: [{ mean }, { mean }, { mean }] } },
      toBuffer: async () => {
        if (broken) throw new Error('Input buffer contains unsupported image format')
        const edge = ops.find((x) => x.resize !== undefined).resize.width
        const quality = ops.find((x) => x.jpeg !== undefined).jpeg.quality
        log.push({ edge, quality, ops })
        return { data: Buffer.alloc(weigh(edge, quality)), info: { width: edge, height: edge } }
      }
    }
    return chain
  }
  const sharp = (bytes, options) => { log.push({ options }); const ops = []; return make(ops) }
  return { sharp, log }
}
const tries = (log) => log.filter((x) => x.edge !== undefined)
const brightnessOf = (t) => t.ops.find((o) => o.modulate !== undefined).modulate.brightness

// ── the logic ──────────────────────────────────────────────────────────────────────────────────
{
  const { sharp, log } = standIn()
  const r = await createRetouch(sharp)(Buffer.from('x'), 'natural')
  ok('a photo that fits at once is made at the largest side and the best quality, square', r.ok === true && r.width === SIDES[0] && r.height === SIDES[0] && tries(log).length === 1 && tries(log)[0].quality === QUALITIES[0], r)
  const ops = tries(log)[0].ops
  ok('it is turned upright first, cropped square on the subject, lifted and sharpened', ops[0] === 'rotate' && ops.some((o) => o.resize !== undefined && o.resize.fit === 'cover' && o.resize.position === 'attention' && o.resize.width === o.resize.height) && ops.some((o) => o.modulate !== undefined) && ops.some((o) => o.sharpen !== undefined), ops)
  ok('the levels are never stretched automatically (measured: it made a dim photo darker)', !ops.includes('normalise') && !ops.includes('normalize'), ops)
  ok('the file is a JPEG, and no metadata is asked to be kept (the place of the photo goes)', ops.some((o) => o.jpeg !== undefined) && !ops.some((o) => typeof o === 'string' && /meta/i.test(o)) && !JSON.stringify(ops).includes('withMetadata') && !JSON.stringify(ops).includes('keepExif'))
  ok('the library is told to refuse a broken file and a huge one', log[0].options.failOn === 'error' && log[0].options.limitInputPixels <= 100_000_000, log[0].options)
}
{
  const { sharp, log } = standIn({ weigh: (edge, q) => (edge === 1024 ? 400_000 : edge === 800 && q === 84 ? 300_000 : 120_000) })
  const r = await createRetouch(sharp)(Buffer.from('x'))
  ok('a photo too heavy is made smaller: the quality first, then the side', r.ok === true && r.width === 800 && tries(log).map((t) => t.edge + '/' + t.quality).join(' ') === '1024/84 1024/72 800/84 800/72', tries(log).map((t) => t.edge + '/' + t.quality))
  ok('what is kept weighs no more than the shop keeps', r.jpeg.length <= MAX_BYTES)
}
{
  const { sharp } = standIn({ weigh: () => MAX_BYTES + 1 })
  const r = await createRetouch(sharp)(Buffer.from('x'))
  ok('a photo that never gets light enough is refused, not cut', r.ok === false && r.why === 'too_heavy', r)
}
{
  const { sharp, log } = standIn({ width: 600, height: 900, weigh: () => 50_000 })
  const r = await createRetouch(sharp)(Buffer.from('x'))
  ok('a small picture is never enlarged: the square is cut on its shortest side', r.ok === true && r.width === 600 && tries(log)[0].edge === 600, r)
  const heavy = standIn({ width: 600, height: 900, weigh: (edge) => (edge >= 600 ? 400_000 : 100_000) })
  const h = await createRetouch(heavy.sharp)(Buffer.from('x'))
  ok('a small picture that is still too heavy is shrunk, and no side is tried twice', h.ok === true && h.width === 480 && tries(heavy.log).map((t) => t.edge + '/' + t.quality).join(' ') === '600/84 600/72 480/84', tries(heavy.log).map((t) => t.edge + '/' + t.quality))
}
{
  const tiny = await createRetouch(standIn({ width: 90, height: 400 }).sharp)(Buffer.from('x'))
  ok('a picture under 100 pixels is too small', tiny.ok === false && tiny.why === 'too_small', tiny)
  const none = await createRetouch(standIn({ width: 0, height: 0 }).sharp)(Buffer.from('x'))
  ok('a picture with no size is unreadable', none.ok === false && none.why === 'unreadable', none)
  const broken = await createRetouch(standIn({ broken: true }).sharp)(Buffer.from('not a picture'))
  ok('a file the library cannot read is unreadable, never a throw', broken.ok === false && broken.why === 'unreadable', broken)
  const gone = await createRetouch(null)(Buffer.from('x'))
  ok('no library means unreadable, never a throw', gone.ok === false && gone.why === 'unreadable', gone)
}
{
  const natural = standIn(); const vivid = standIn(); const unknown = standIn()
  await createRetouch(natural.sharp)(Buffer.from('x'), 'natural')
  await createRetouch(vivid.sharp)(Buffer.from('x'), 'vivid')
  await createRetouch(unknown.sharp)(Buffer.from('x'), 'sepia')
  const mod = (t) => tries(t.log)[0].ops.find((o) => o.modulate !== undefined).modulate
  ok('each look sets its own light and colour, and an unknown look falls back to natural', mod(vivid).saturation === LOOK_SETTINGS.vivid.saturation && mod(vivid).saturation > mod(natural).saturation && JSON.stringify(mod(unknown)) === JSON.stringify(LOOK_SETTINGS.natural))
  ok('no look darkens or washes out the picture', Object.values(LOOK_SETTINGS).every((l) => l.brightness >= 1 && l.brightness <= 1.15 && l.saturation >= 1 && l.saturation <= 1.3))
}
{
  let loaded = 0
  const lazy = createLazyRetouch(() => { loaded += 1; return standIn().sharp })
  ok('the library is not loaded until a photo comes', loaded === 0)
  await lazy(Buffer.from('x')); await lazy(Buffer.from('y'))
  ok('and then once', loaded === 1)
  const none = await createLazyRetouch(() => null)(Buffer.from('x'))
  ok('a computer with no library answers unreadable', none.ok === false && none.why === 'unreadable')
  const throwing = await createLazyRetouch(() => { throw new Error('boom') })(Buffer.from('x'))
  ok('a library that blows up at load is a plain « unreadable », never a throw', throwing.ok === false && throwing.why === 'unreadable', throwing)
}

// ── light ─────────────────────────────────────────────────────────────────────────────────────
{
  ok('a photo lighter than the target is never darkened', exposureFor(TARGET_MEAN) === 1 && exposureFor(200) === 1 && exposureFor(255) === 1)
  ok('a dark photo is lifted towards the target, by no more than the cap', exposureFor(TARGET_MEAN / 1.2) > 1.19 && exposureFor(TARGET_MEAN / 1.2) < 1.21 && exposureFor(10) === MAX_LIFT && exposureFor(1) === 1, [exposureFor(TARGET_MEAN / 1.2), exposureFor(10)])
  ok('a measure that is no number changes nothing', exposureFor(null) === 1 && exposureFor(NaN) === 1 && exposureFor(undefined) === 1 && exposureFor(0) === 1)
  const dark = standIn({ mean: 50 })
  const d = await createRetouch(dark.sharp)(Buffer.from('x'), 'natural')
  const renders = tries(dark.log)
  ok('a dark photo is rendered again with its light lifted, and says by how much', d.ok === true && renders.length === 2 && brightnessOf(renders[0]) === LOOK_SETTINGS.natural.brightness && brightnessOf(renders[1]) === LOOK_SETTINGS.natural.brightness * MAX_LIFT && d.lifted === Math.round((MAX_LIFT - 1) * 100), { n: renders.length, lifted: d.lifted })
  const fine = standIn({ mean: 140 })
  const f = await createRetouch(fine.sharp)(Buffer.from('x'), 'natural')
  ok('a photo that is light enough is rendered once and left as it was', f.ok === true && tries(fine.log).length === 1 && f.lifted === 0 && brightnessOf(tries(fine.log)[0]) === LOOK_SETTINGS.natural.brightness, { n: tries(fine.log).length, lifted: f.lifted })
  const near = standIn({ mean: TARGET_MEAN / 1.02 })
  ok('a lift under 3% is not worth a second pass', (await createRetouch(near.sharp)(Buffer.from('x'))).lifted === 0 && tries(near.log).length === 1)
  const blind = standIn({ mean: 20, noStats: true })
  const b = await createRetouch(blind.sharp)(Buffer.from('x'))
  ok('when the library cannot measure the light the photo is still made, as it is', b.ok === true && b.lifted === 0 && tries(blind.log).length === 1, b)
  const darkHeavy = standIn({ mean: 50, weigh: (edge, q) => (edge === 1024 ? 400_000 : 100_000) })
  const dh = await createRetouch(darkHeavy.sharp)(Buffer.from('x'))
  ok('a dark photo that is also too heavy keeps its lift while it is shrunk', dh.ok === true && dh.width === 800 && dh.lifted === Math.round((MAX_LIFT - 1) * 100) && tries(darkHeavy.log).slice(2).every((t) => brightnessOf(t) === LOOK_SETTINGS.natural.brightness * MAX_LIFT), tries(darkHeavy.log).map((t) => t.edge + '/' + t.quality + '/' + brightnessOf(t)))
}

// ── the real library, where there is one ───────────────────────────────────────────────────────
const sharp = loadSharp()
if (sharp === null) console.log('SKIPPED: the real retouch — sharp is not installed on this machine (the cloud image has it; checked live)')
else {
  // A phone-like picture made on the spot: 1600×1200, a bright square on a dark ground, with noise so it does not compress to nothing.
  const w = 1600; const h = 1200
  const raw = Buffer.alloc(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3
    const inside = x > 500 && x < 1100 && y > 300 && y < 900
    const n = (x * 7 + y * 13) % 29
    raw[i] = (inside ? 180 : 40) + n; raw[i + 1] = (inside ? 120 : 45) + n; raw[i + 2] = (inside ? 90 : 55) + n
  }
  const phone = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).withMetadata({ exif: { IFD0: { Copyright: 'someone', Make: 'PhoneCo' } } }).toBuffer()
  const r = await createRetouch(sharp)(phone, 'bright')
  ok('real: a phone picture becomes a square JPEG that fits the shop', r.ok === true && r.width === r.height && r.width <= 1024 && r.width >= 100 && r.jpeg.length <= MAX_BYTES && r.jpeg[0] === 0xff && r.jpeg[1] === 0xd8, r.ok ? { w: r.width, bytes: r.jpeg.length } : r)
  const meta = await sharp(r.jpeg).metadata()
  ok('real: the camera\'s metadata does not leave with it', meta.exif === undefined && meta.format === 'jpeg', { exif: meta.exif === undefined })
  // A dim picture really gets lighter, a light one does not get darker: the average brightness is measured on what comes out.
  const lumaOf = async (jpeg) => { const st = await sharp(jpeg).stats(); const c = st.channels; return 0.299 * c[0].mean + 0.587 * c[1].mean + 0.114 * c[2].mean }
  const dim = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 38, g: 40, b: 52 } } }).composite([{ input: { create: { width: 300, height: 300, channels: 3, background: { r: 112, g: 88, b: 120 } } }, left: 250, top: 150 }]).jpeg({ quality: 95 }).toBuffer()
  const dimOut = await createRetouch(sharp)(dim, 'natural')
  ok('real: a dim picture comes out lighter than it went in', dimOut.ok === true && dimOut.lifted > 0 && (await lumaOf(dimOut.jpeg)) > (await lumaOf(dim)), dimOut.ok ? { lifted: dimOut.lifted, before: await lumaOf(dim), after: await lumaOf(dimOut.jpeg) } : dimOut)
  const white = await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: 245, g: 245, b: 245 } } }).composite([{ input: { create: { width: 300, height: 300, channels: 3, background: { r: 120, g: 90, b: 60 } } }, left: 250, top: 150 }]).jpeg({ quality: 95 }).toBuffer()
  const whiteOut = await createRetouch(sharp)(white, 'natural')
  ok('real: a picture on a white background stays white', whiteOut.ok === true && whiteOut.lifted === 0 && (await lumaOf(whiteOut.jpeg)) > 0.9 * (await lumaOf(white)), whiteOut.ok ? { lifted: whiteOut.lifted, before: await lumaOf(white), after: await lumaOf(whiteOut.jpeg) } : whiteOut)
  const bad = await createRetouch(sharp)(Buffer.from('this is not a picture at all'))
  ok('real: a file that is not a picture is unreadable, not a throw', bad.ok === false && bad.why === 'unreadable', bad)
}

if (fail > 0) { console.log(fail + ' failed'); process.exit(1) }
console.log('all ok')
