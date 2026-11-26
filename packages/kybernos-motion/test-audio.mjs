// Audio tests: pure Node. `cd packages/kybernos-motion && node test-audio.mjs`
import * as A from './audio.mjs'

let fail = 0
let n = 0
const ok = (name, cond, detail) => {
  n++
  if (cond) return
  fail++
  console.log(`FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}
const peak = (b) => { let m = 0; for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i])); return m }
const energy = (b, from, to) => { let e = 0; for (let i = from; i < Math.min(to, b.length); i++) e += b[i] * b[i]; return e }
const SR = 8000 // small rate keeps the tests fast; the maths does not depend on it

for (const name of Object.keys(A.SYNTH_SECONDS)) {
  const s = A.synth(name, 1, SR)
  ok(`synth ${name}: length matches its declared duration`, s.length === Math.round(A.SYNTH_SECONDS[name] * SR), s.length)
  ok(`synth ${name}: audible but never above 0.8`, peak(s) > 0.3 && peak(s) <= 0.8 + 1e-6, peak(s))
  ok(`synth ${name}: every sample is finite`, s.every(Number.isFinite))
  ok(`synth ${name}: the same every time`, JSON.stringify(Array.from(A.synth(name, 1, SR).slice(0, 200))) === JSON.stringify(Array.from(s.slice(0, 200))))
  ok(`synth ${name}: pitch changes the sound`, JSON.stringify(Array.from(A.synth(name, 2, SR).slice(0, 400))) !== JSON.stringify(Array.from(s.slice(0, 400))))
}
ok('synth: an unknown name is silence', A.synth('laser', 1, SR).length === 0)
ok('synth: pitch is bounded', A.synth('ding', 99, SR).every(Number.isFinite) && A.synth('ding', -5, SR).every(Number.isFinite))
{
  const d = A.synth('ding', 1, SR)
  ok('synth ding: it decays', energy(d, 0, 2000) > energy(d, d.length - 2000, d.length) * 20)
}

{
  const x = Float32Array.from([0, 1, 0, -1])
  ok('resample: same rate is the same buffer', A.resample(x, 8000, 8000) === x)
  ok('resample: doubling the rate doubles the length', A.resample(x, 4000, 8000).length === 8)
  ok('resample: interpolates between samples', A.resample(Float32Array.from([0, 1]), 1, 2)[1] === 0.5)
}
ok('sourcesOf: unique files only', A.sourcesOf([{ src: 'a.mp3' }, { synth: 'ding' }, { src: 'a.mp3' }, { src: 'b.wav' }]).join() === 'a.mp3,b.wav')

// ── mix ─────────────────────────────────────────────────────────────────────
const tone = (secs, v = 0.5) => ({ rate: SR, channels: [new Float32Array(Math.round(secs * SR)).fill(v)] })
{
  const m = A.mix([], 2, SR, new Map())
  ok('mix: no tracks is silence of the right length', m.left.length === 2 * SR && m.right.length === 2 * SR && peak(m.left) === 0)
}
{
  const m = A.mix([{ at: 1, volume: 1, synth: 'ding', pitch: 1 }], 3, SR, new Map())
  ok('mix: nothing before the track starts', energy(m.left, 0, SR - 1) === 0 && energy(m.left, SR, SR + 400) > 0)
  ok('mix: a mono sound is on both channels', JSON.stringify(Array.from(m.left.slice(SR, SR + 100))) === JSON.stringify(Array.from(m.right.slice(SR, SR + 100))))
}
{
  const dec = new Map([['a.wav', tone(2, 0.2)]])
  const quiet = A.mix([{ at: 0, volume: 0.5, src: 'a.wav' }], 2, SR, dec)
  const loud = A.mix([{ at: 0, volume: 1, src: 'a.wav' }], 2, SR, dec)
  ok('mix: volume scales the sound', Math.abs(peak(loud.left) / peak(quiet.left) - 2) < 1e-6, [peak(loud.left), peak(quiet.left)])
  const fade = A.mix([{ at: 0, volume: 1, src: 'a.wav', fadeIn: 0.5, fadeOut: 0.5 }], 2, SR, dec)
  ok('mix: fade-in starts silent and fade-out ends silent', fade.left[0] === 0 && Math.abs(fade.left[fade.left.length - 1]) < 0.001 && Math.abs(fade.left[SR]) > 0.19, [fade.left[0], fade.left[fade.left.length - 1], fade.left[SR]])
  const loop = A.mix([{ at: 0, volume: 1, src: 'a.wav', loop: true }], 5, SR, new Map([['a.wav', tone(1, 0.2)]]))
  ok('mix: a loop fills the whole scene', Math.abs(loop.left[5 * SR - 1] - 0.2) < 1e-6)
  const once = A.mix([{ at: 0, volume: 1, src: 'a.wav' }], 5, SR, new Map([['a.wav', tone(1, 0.2)]]))
  ok('mix: without loop it stops when the file ends', once.left[2 * SR] === 0)
  const trim = A.mix([{ at: 0, volume: 1, src: 'a.wav', trim: [0.5, 1] }], 2, SR, new Map([['a.wav', { rate: SR, channels: [Float32Array.from({ length: SR * 2 }, (_, i) => (i < SR ? 0.1 : 0.3))] }]]))
  ok('mix: trim keeps only the chosen part', Math.abs(trim.left[0] - 0.1) < 1e-6 && trim.left[Math.round(0.6 * SR)] === 0, [trim.left[0], trim.left[Math.round(0.6 * SR)]])
  const st = A.mix([{ at: 0, volume: 1, src: 's.wav' }], 1, SR, new Map([['s.wav', { rate: SR, channels: [new Float32Array(SR).fill(0.1), new Float32Array(SR).fill(0.3)] }]]))
  ok('mix: stereo sources keep their sides', Math.abs(st.left[10] - 0.1) < 1e-6 && Math.abs(st.right[10] - 0.3) < 1e-6)
  const rs = A.mix([{ at: 0, volume: 1, src: 'a.wav' }], 1, 2 * SR, new Map([['a.wav', tone(1, 0.2)]]))
  ok('mix: a file at another sample rate is resampled', rs.left.length === 2 * SR && Math.abs(rs.left[100] - 0.2) < 1e-6)
}
{
  const m = A.mix([{ at: 0, volume: 1, src: 'gone.mp3' }, { at: 0, volume: 1, src: 'gone.mp3' }, { at: 99, volume: 1, synth: 'ding', pitch: 1 }], 2, SR, new Map())
  ok('mix: a missing file is listed once and skipped; a track after the end is ignored', m.missing.join() === 'gone.mp3' && peak(m.left) === 0)
}
{
  const many = Array.from({ length: 12 }, () => ({ at: 0, volume: 2, synth: 'hit', pitch: 1 }))
  const m = A.mix(many, 1, SR, new Map())
  ok('mix: the soft limiter never goes above 0.98', peak(m.left) <= 0.98 + 1e-6 && peak(m.left) > 0.9, peak(m.left))
  const quietMix = A.mix([{ at: 0, volume: 0.3, synth: 'ding', pitch: 1 }], 1, SR, new Map())
  const raw = A.synth('ding', 1, SR)
  ok('mix: quiet sounds pass through the limiter untouched', Math.abs(quietMix.left[100] - raw[100] * 0.3) < 1e-6)
}
ok('mix: duration is bounded', A.mix([], 99999, 100, new Map()).left.length === A.MAX_SECONDS * 100)

console.log(`${n - fail}/${n} checks passed`)
process.exit(fail ? 1 : 0)
