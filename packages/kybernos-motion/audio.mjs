// Motion audio: pure sample maths. No Web Audio, no files, no clock.
//
//   synth(name, pitch, rate)      a built-in sound effect as mono samples (no file, no licence)
//   mix(tracks, duration, rate, decoded)   all of a scene's audio tracks as one stereo mix
//
// Decoding a user's sound file needs the browser (decodeAudioData); the player hands the decoded channels
// in through `decoded` (a Map of src -> { rate, channels: [Float32Array, ...] }). Everything else is here so
// it can be tested, and rendered the same way for the preview and for the MP4.
//
// Keep this file free of `import`: scripts/build.mjs pastes it into the browser bundle.

export const SAMPLE_RATE = 48000
export const MAX_SECONDS = 300

const TAU = Math.PI * 2

/** Deterministic white noise in [-1, 1) (LCG): the same effect sounds the same every time. */
function noiser (seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return (s / 2147483648) - 1
  }
}

function peak (buf, target) {
  let m = 0
  for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]))
  if (m > 0) { const g = target / m; for (let i = 0; i < buf.length; i++) buf[i] *= g }
  return buf
}

/** Seconds a built-in sound lasts (so the editor can draw it on the timeline). */
export const SYNTH_SECONDS = { click: 0.05, tick: 0.03, pop: 0.18, ding: 1.4, hit: 0.5, whoosh: 0.8, riser: 1.6 }

export function synth (name, pitch, rate) {
  const sr = rate || SAMPLE_RATE
  const p = Math.min(4, Math.max(0.25, pitch || 1))
  const secs = SYNTH_SECONDS[name]
  if (secs === undefined) return new Float32Array(0)
  const n = Math.round(secs * sr)
  const out = new Float32Array(n)
  const noise = noiser(0x5eed + name.length * 977)
  if (name === 'click') {
    for (let i = 0; i < n; i++) { const t = i / sr; out[i] = (noise() * 0.6 + Math.sin(TAU * 1800 * p * t) * 0.6) * Math.exp(-t * 140) }
  } else if (name === 'tick') {
    for (let i = 0; i < n; i++) { const t = i / sr; out[i] = Math.sin(TAU * 2400 * p * t) * Math.exp(-t * 260) }
  } else if (name === 'pop') {
    let phase = 0
    for (let i = 0; i < n; i++) { const t = i / sr; const f = (120 + 380 * Math.exp(-t * 28)) * p; phase += (TAU * f) / sr; out[i] = Math.sin(phase) * Math.exp(-t * 22) }
  } else if (name === 'ding') {
    for (let i = 0; i < n; i++) { const t = i / sr; out[i] = (Math.sin(TAU * 880 * p * t) + 0.35 * Math.sin(TAU * 880 * 2.76 * p * t)) * Math.exp(-t * 3.2) * Math.min(1, t * 400) }
  } else if (name === 'hit') {
    let phase = 0
    for (let i = 0; i < n; i++) { const t = i / sr; const f = (40 + 60 * Math.exp(-t * 18)) * p; phase += (TAU * f) / sr; out[i] = Math.sin(phase) * Math.exp(-t * 7) + noise() * 0.5 * Math.exp(-t * 90) }
  } else if (name === 'whoosh') {
    let lp = 0
    for (let i = 0; i < n; i++) {
      const x = i / n
      const env = Math.pow(Math.sin(Math.PI * x), 1.6)
      const a = 0.02 + 0.5 * Math.pow(x, 1.4) * p / 1.5 // the filter opens as it passes
      lp += (noise() - lp) * Math.min(0.95, a)
      out[i] = lp * env
    }
  } else if (name === 'riser') {
    let phase = 0
    for (let i = 0; i < n; i++) {
      const x = i / n
      phase += (TAU * (200 + 1800 * x * x) * p) / sr
      out[i] = (Math.sin(phase) * 0.7 + noise() * 0.25 * x) * Math.pow(x, 1.2) * (x > 0.96 ? (1 - x) / 0.04 : 1)
    }
  }
  return peak(out, 0.8)
}

/** Linear-interpolation resample of one channel. */
export function resample (data, fromRate, toRate) {
  if (fromRate === toRate) return data
  const n = Math.max(1, Math.round((data.length * toRate) / fromRate))
  const out = new Float32Array(n)
  const k = fromRate / toRate
  for (let i = 0; i < n; i++) {
    const x = i * k
    const i0 = Math.floor(x)
    const i1 = Math.min(data.length - 1, i0 + 1)
    out[i] = data[Math.min(data.length - 1, i0)] * (1 - (x - i0)) + data[i1] * (x - i0)
  }
  return out
}

/** The list of `src` files a scene needs decoded before it can be mixed. */
export function sourcesOf (tracks) {
  const out = []
  for (const t of tracks || []) if (typeof t.src === 'string' && !out.includes(t.src)) out.push(t.src)
  return out
}

/**
 * Mix every track of a scene. `tracks` are the validated audio entries ({at, volume, synth|src, pitch, loop, trim,
 * fadeIn, fadeOut}). Returns { rate, left, right } of exactly `duration` seconds, softly limited (never above 0.98).
 * A file that is not in `decoded` is skipped (the caller reports it); `missing` lists those.
 */
export function mix (tracks, duration, rate, decoded) {
  const sr = rate || SAMPLE_RATE
  const secs = Math.min(MAX_SECONDS, Math.max(0, duration))
  const total = Math.round(secs * sr)
  const left = new Float32Array(total)
  const right = new Float32Array(total)
  const missing = []
  for (const t of tracks || []) {
    const start = Math.round(t.at * sr)
    if (start >= total) continue
    let chans
    if (typeof t.synth === 'string') chans = [synth(t.synth, t.pitch, sr)]
    else {
      const d = decoded && decoded.get ? decoded.get(t.src) : null
      if (!d || !d.channels || d.channels.length === 0) { if (!missing.includes(t.src)) missing.push(t.src); continue }
      chans = d.channels.map((c) => resample(c, d.rate, sr))
      if (t.trim) chans = chans.map((c) => c.subarray(Math.min(c.length, Math.round(t.trim[0] * sr)), Math.min(c.length, Math.round(t.trim[1] * sr))))
    }
    const len = chans[0].length
    if (len === 0) continue
    const fadeIn = Math.round((t.fadeIn || 0) * sr)
    const fadeOut = Math.round((t.fadeOut || 0) * sr)
    const loop = t.loop === true && typeof t.src === 'string'
    const span = loop ? total - start : Math.min(len, total - start)
    for (let i = 0; i < span; i++) {
      const j = loop ? i % len : i
      let g = t.volume
      if (fadeIn > 0 && i < fadeIn) g *= i / fadeIn
      const fromEnd = (loop ? total - start : len) - i
      if (fadeOut > 0 && fromEnd < fadeOut) g *= Math.max(0, fromEnd / fadeOut)
      const l = chans[0][j] * g
      const r = (chans.length > 1 ? chans[1][j] : chans[0][j]) * g
      left[start + i] += l
      right[start + i] += r
    }
  }
  // soft limiter: transparent below 0.6, saturating smoothly towards 0.98 (headroom for the AAC encoder)
  const lim = (x) => (Math.abs(x) <= 0.6 ? x : Math.sign(x) * (0.6 + 0.38 * Math.tanh((Math.abs(x) - 0.6) / 0.38)))
  for (let i = 0; i < total; i++) { left[i] = lim(left[i]); right[i] = lim(right[i]) }
  return { rate: sr, left, right, missing }
}
