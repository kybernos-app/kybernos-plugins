// A4-19 of the audit: one English UI showed « 31 Ko · 549 o » in Creations, « 880 B · 86 KB » in the media player and
// « About 5,0 MB » then « 31 Ko » in the Motion export dialog; Creations also labelled mp3 / wav / mp4 files « Autre ».
// The three bundles each keep their own copy of the formatter (a bundle never imports another); this test cuts them out
// of their sources and proves they agree, in English and in French, and that audio and video have a type of their own.
//
//   node scripts/test-size-style.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (f) => readFileSync(join(root, f), 'utf8')
const core = read('packages/kybernos-plugin/client.js')
const player = read('packages/dsh-media-player/src/plugin.js')
const motion = read('packages/kybernos-motion/src/plugin.js')
const cut = (src, from, to, label) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a + from.length)
  assert.ok(a >= 0 && b > a, 'cannot find ' + label)
  return src.slice(a, b + to.length)
}

// The three formatters, each as its bundle ships it.
const coreFmt = (lang) => new Function('kbLangResolve', cut(core, 'const kbFmtSize = (s) => {', '\n    }\n', 'kbFmtSize') + '\nreturn kbFmtSize')(() => lang)
const playerFmt = new Function(cut(player, 'function humanBytes(bytes) {', '\n}\n', 'humanBytes') + '\nreturn humanBytes')()
const motionFmt = (fr) => new Function('kt', cut(motion, 'const fmtBytes = (n) => {', '\n}\n', 'fmtBytes') + '\nreturn fmtBytes')((a, b) => (fr ? a : b))

let n = 0
const ok = (label, fn) => { fn(); n += 1; console.log('  ✓ ' + label) }

const SIZES = [0, 1, 549, 880, 1023, 1024, 1500, 31 * 1024, 31 * 1024 + 511, 86 * 1024 + 300, 1048575, 1048576, 1572864, 5 * 1048576, 12345678]

ok('the audit\'s numbers, in English: 549 B, 31 KB, 86 KB, 5.0 MB (one decimal, a point)', () => {
  const en = coreFmt('en')
  assert.equal(en(549), '549 B')
  assert.equal(en(31 * 1024), '31 KB')
  assert.equal(en(86 * 1024 + 300), '86 KB')
  assert.equal(en(5 * 1048576), '5.0 MB')
  assert.equal(en(1572864), '1.5 MB')
})

ok('Creations, Motion and the media player agree to the character in an English UI, on every size', () => {
  const en = coreFmt('en')
  const mo = motionFmt(false)
  for (const s of SIZES) {
    assert.equal(en(s), playerFmt(s), 'Creations vs media player at ' + s)
    assert.equal(mo(s), playerFmt(s), 'Motion vs media player at ' + s)
  }
})

ok('French says o / Ko / Mo with a comma, in Creations and in Motion alike', () => {
  const fr = coreFmt('kybernos')
  const mo = motionFmt(true)
  assert.equal(fr(549), '549 o')
  assert.equal(fr(31 * 1024), '31 Ko')
  assert.equal(fr(5 * 1048576), '5,0 Mo')
  assert.equal(coreFmt('fr-FR')(1572864), '1,5 Mo')
  for (const s of SIZES) assert.equal(fr(s), mo(s), 'French, Creations vs Motion at ' + s)
})

ok('a language that is neither English nor French gets English units, never French ones', () => {
  for (const lang of ['es', 'ar', 'de']) assert.equal(coreFmt(lang)(31 * 1024), '31 KB', lang)
})

ok('no size, or a nonsense one, gives an empty string', () => {
  const en = coreFmt('en')
  assert.equal(en(undefined), '')
  assert.equal(en(null), '')
  assert.equal(en(-5), '')
  assert.equal(en('12'), '')
})

ok('the project documents list uses the same formatter (it printed « 12 345 o » in every language)', () => {
  assert.ok(/const tailleTxt = \(o\) => \(typeof o === 'number' \? kbFmtSize\(o\)/.test(core))
  assert.ok(!/toLocaleString\('fr-FR'\) \+ ' o'/.test(core))
})

ok('Motion\'s export hint uses it too: « Up to about 5.0 MB », no comma bolted on an English unit', () => {
  assert.ok(/const est = fmtBytes\(/.test(motion))
  assert.ok(/'Up to about ' \+ est/.test(motion))
  assert.ok(!/\.replace\('\.', ','\)\s*$/m.test(motion.split('\n').filter((l) => /const est =/.test(l)).join('\n')))
  assert.ok(/fmtBytes\(result\.size\)/.test(motion))
})

// ── the type badge ──────────────────────────────────────────────────────────
const KB_T = { 'deliv.type.media': 'Audio / Video' }
const kbe = (en) => en
const typing = new Function('kbe', 'kbt', [
  cut(core, 'const KB_ART_TYPES = [', '\n    ]\n', 'KB_ART_TYPES'),
  cut(core, 'const KB_ART_TYPE_MEDIA = ', '\n', 'KB_ART_TYPE_MEDIA'),
  cut(core, 'const KB_KIND_SUFFIX = ', '\n', 'KB_KIND_SUFFIX'),
  cut(core, 'const kbTypeById = ', '\n', 'kbTypeById'),
  cut(core, 'const KB_FAM_EXTS = {', '\n    }\n', 'KB_FAM_EXTS'),
  cut(core, 'const kbArtType = (name) => {', '\n    }\n', 'kbArtType'),
  'return { kbArtType, KB_ART_TYPES }',
].join('\n'))(kbe, (k) => KB_T[k] || k)

ok('mp3, wav, mp4 and the other audio / video files are « Audio / Video », not « Autre »', () => {
  for (const f of ['tone.wav', 'song.MP3', 'intro.mp4', 'clip.webm', 'voice.m4a', 'x.opus', 'movie.mkv']) {
    const t = typing.kbArtType(f)
    assert.equal(t.id, 'media', f)
    assert.equal(t.label, 'Audio / Video', f)
  }
})

ok('what is really « other » says « Other » in English (the label was a bare French word)', () => {
  const t = typing.kbArtType('thing.xyz')
  assert.equal(t.id, 'other')
  assert.equal(t.label, 'Other')
  assert.ok(!/label: 'Autre'/.test(core), 'no bare « Autre » label left')
})

ok('the other types are untouched', () => {
  assert.equal(typing.kbArtType('notes.md').id, 'doc')
  assert.equal(typing.kbArtType('photo.png').id, 'image')
  assert.equal(typing.kbArtType('app.miniapp.json').id, 'miniapp')
  assert.equal(typing.kbArtType('quiz-1.quiz').id, 'quiz')
  assert.equal(typing.kbArtType('data.csv').id, 'data')
})

ok('the media type is NOT a row of the type picker: the Audio & Video family already is the tile', () => {
  assert.ok(!typing.KB_ART_TYPES.some((t) => t.id === 'media'))
})

ok('its label exists in French and English', () => {
  assert.ok(/'deliv\.type\.media': \{ kybernos: '[^']+', en: 'Audio \/ Video' \}/.test(core))
})

console.log('size style: ' + n + ' checks')
