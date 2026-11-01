#!/usr/bin/env node
// Cuts the parts of a shelf video (scripts/video-parts.mjs: clips, a voice, a piece of music) into ONE finished MP4 with ffmpeg: shots with cross-fades, animated
// texts (ASS, drawn by libass with a system font), a voice over, music that ducks under the voice, and the small animated kybernos mark at the bottom.
// Nothing here is paid for; the parts are files on disk, so a cut can be redone as often as needed.
//
//   node scripts/video-compose.mjs <recipe.json> --parts <dir> --out <file.mp4> [--wm-dir <dir>] [--ass <file>]
//
// recipe.json (docs/dev/templates-lots/video-compose/<id>.json; the recipe is the edit, the parts are the product):
//   { "id": "video_ad_x", "size": [1366, 768],                     even sides; the shots are scaled to fill it and cropped
//     "fps": 24, "fade": 0.4,                                      the cross-fade between two shots (0 = hard cut); a shot may carry its own "fade" (the one that LEADS INTO it)
//     "shots":  [ { "file": "ad-1.mp4", "trim": [0, 4.6], "fade": 0.4, "transition": "fade" } ],     file names are read in --parts
//     "grade":  "eq=contrast=1.05:saturation=1.1",                 optional ffmpeg video filter, applied before the texts
//     "texts":  [ { "at": 0.6, "to": 3.8, "text": "ALDERINE", "style": "title|sub|lower|pill|caption|label", "x": 0.5, "y": 0.45, "anim": "fade|rise|pop", "color": "#ffffff" } ],
//               a text may hold \N for a line break, [#rrggbb] to colour a stretch, [s1.6] to enlarge it, and [/] to end either
//     "voice":  [ { "file": "voice.mp3", "at": 1.2, "gain": 1.0 } ],
//     "music":  { "file": "music.mp3", "start": 0, "gain": 0.5, "fadeIn": 0.6, "fadeOut": 1.8, "duck": true },
//     "ambient": 0.3,                                              gain of the sound the clips came with (0 = none)
//     "shade": 0.4,                                                darkening of the bottom 14% so the mark and the captions read on a pale picture (0 = none)
//     "watermark": true }                                          or { "at": 1, "speed": 1 } (a film of 5 s: { "at": 0.5, "speed": 1.8 }), or false
// The kybernos mark is drawn by scripts/kybernos-watermark.py, once per size and start, into --wm-dir (default <parts>/../watermarks): it comes in whole in the
// bottom right corner at "watermark.at" seconds (1 by default), then only the K stays. "watermark": false for none, {"at": 0.5, "speed": 1.8} for a short film.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const FFMPEG = '/opt/homebrew/bin/ffmpeg'
const args = process.argv.slice(2)
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback }
const recipeFile = args.find((a, i) => !a.startsWith('--') && !['--parts', '--out', '--wm-dir', '--ass'].includes(args[i - 1]))
const partsDir = flag('--parts')
const outFile = flag('--out')
if (recipeFile === undefined || partsDir === undefined || outFile === undefined) { console.error('usage: node scripts/video-compose.mjs <recipe.json> --parts <dir> --out <file.mp4> [--wm-dir <dir>]'); process.exit(2) }
const fail = (m) => { console.error('✗ ' + m); process.exit(1) }
const recipe = JSON.parse(readFileSync(resolve(recipeFile), 'utf8'))
const parts = resolve(partsDir)
const wmDir = resolve(flag('--wm-dir', join(parts, '..', 'watermarks')))
const [W, H] = recipe.size
const FPS = recipe.fps || 24
if (!Array.isArray(recipe.shots) || recipe.shots.length < 1 || W % 2 || H % 2) fail('a recipe needs shots and an even size')

/** Length and sound of a file, from what `ffmpeg -i` says about it (this machine has no ffprobe). */
const probe = (file) => {
  if (!existsSync(file)) fail('missing part: ' + file)
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr)
  if (m === null) fail('cannot read ' + file)
  return { seconds: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]), audio: /Stream #\d+:\d+.*Audio:/.test(r.stderr) }
}
const f = (n) => String(Math.round(n * 1000) / 1000)

// ── shots ────────────────────────────────────────────────────────────────────
const inputs = []
const filters = []
const shots = recipe.shots.map((s, i) => {
  const file = join(parts, s.file)
  const p = probe(file)
  const [a, b] = s.trim || [0, p.seconds]
  inputs.push(file)
  return { i, a, b: Math.min(b, p.seconds), audio: p.audio, fade: i === 0 ? 0 : (s.fade !== undefined ? s.fade : (recipe.fade ?? 0.4)), transition: s.transition || 'fade' }
})
for (const s of shots) {
  const len = s.b - s.a
  filters.push(`[${s.i}:v]trim=start=${f(s.a)}:end=${f(s.b)},setpts=PTS-STARTPTS,scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${FPS},format=yuv420p[v${s.i}]`)
  if (s.audio) filters.push(`[${s.i}:a]atrim=start=${f(s.a)}:end=${f(s.b)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${s.i}]`)
  else filters.push(`anullsrc=r=48000:cl=stereo,atrim=0:${f(len)},asetpts=PTS-STARTPTS[a${s.i}]`)
}
let vCur = 'v0'
let aCur = 'a0'
let total = shots[0].b - shots[0].a
for (const s of shots.slice(1)) {
  const len = s.b - s.a
  if (s.fade > 0) {
    filters.push(`[${vCur}][v${s.i}]xfade=transition=${s.transition}:duration=${f(s.fade)}:offset=${f(total - s.fade)}[x${s.i}]`)
    filters.push(`[${aCur}][a${s.i}]acrossfade=d=${f(s.fade)}[ax${s.i}]`)
    total += len - s.fade
  } else {
    filters.push(`[${vCur}][v${s.i}]concat=n=2:v=1:a=0[x${s.i}]`)
    filters.push(`[${aCur}][a${s.i}]concat=n=2:v=0:a=1[ax${s.i}]`)
    total += len
  }
  vCur = 'x' + s.i
  aCur = 'ax' + s.i
}
const T = total

// ── texts (ASS) ──────────────────────────────────────────────────────────────
const FONT = recipe.font || 'Avenir Next'
const bgr = (hex) => { const h = hex.replace('#', ''); return h.slice(4, 6) + h.slice(2, 4) + h.slice(0, 2) }
const stamp = (t) => { const cs = Math.round(t * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}` }
const sz = (k) => Math.round(H * k)
const STYLES = {
  title:   { size: sz(0.085), bold: 1, spacing: 10, outline: 1.5, shadow: 3, color: '#ffffff' },
  sub:     { size: sz(0.04), bold: 1, spacing: 6, outline: 2.5, shadow: 2, color: '#ffffff' },
  lower:   { size: sz(0.04), bold: 1, spacing: 2, outline: 0, shadow: 0, color: '#ffffff', box: true },
  caption: { size: sz(0.046), bold: 1, spacing: 0, outline: 3, shadow: 1, color: '#ffffff', outlineColor: '&H00000000' },
  label:   { size: sz(0.034), bold: 1, spacing: 4, outline: 2, shadow: 2, color: '#ffffff' },
  pill:    { size: sz(0.034), bold: 1, spacing: 2, outline: 0, shadow: 0, color: '#1d1d22', box: true, boxColor: '&H00EDEDF0' }
}
const markup = (t) => t.replace(/\[(#[0-9a-fA-F]{6})\]/g, (m, c) => `{\\c&H${bgr(c)}&}`).replace(/\[s([\d.]+)\]/g, (m, k) => `{\\fscx${Math.round(k * 100)}\\fscy${Math.round(k * 100)}}`).replace(/\[\/\]/g, '{\\r}')
const ass = [
  '[Script Info]', 'ScriptType: v4.00+', `PlayResX: ${W}`, `PlayResY: ${H}`, 'WrapStyle: 2', 'ScaledBorderAndShadow: yes', '',
  '[V4+ Styles]', 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
  ...Object.entries(STYLES).map(([n, s]) => `Style: ${n},${FONT},${s.size},&H00${bgr(s.color)},&H00FFFFFF,${s.box ? (s.boxColor || '&H8C000000') : (s.outlineColor || '&H80000000')},&H99000000,${s.bold},0,0,0,100,100,${s.spacing},0,${s.box ? 3 : 1},${s.box ? Math.round(H * 0.012) : s.outline},${s.shadow},5,10,10,10,1`),
  '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text'
]
for (const t of recipe.texts || []) {
  const x = Math.round(W * (t.x ?? 0.5))
  const y = Math.round(H * (t.y ?? 0.5))
  const fadeIn = Math.round((t.fadeIn ?? 0.35) * 1000)
  const fadeOut = Math.round((t.fadeOut ?? 0.35) * 1000)
  const anim = t.anim === 'rise' ? `\\move(${x},${y + Math.round(H * 0.025)},${x},${y},0,450)` : `\\pos(${x},${y})`
  const pop = t.anim === 'pop' ? '\\fscx82\\fscy82\\t(0,350,\\fscx100\\fscy100)' : ''
  const tint = t.color !== undefined ? `\\c&H${bgr(t.color)}&` : ''
  const size = t.size !== undefined ? `\\fs${sz(t.size)}` : ''
  ass.push(`Dialogue: 0,${stamp(t.at)},${stamp(Math.min(t.to, T))},${t.style || 'sub'},,0,0,0,,{\\an5${anim}${pop}${tint}${size}\\fad(${fadeIn},${fadeOut})}${markup(String(t.text)).replace(/\\n/g, '\\N')}`)
}
const assFile = resolve(flag('--ass', outFile.replace(/\.mp4$/, '') + '.ass'))
mkdirSync(dirname(assFile), { recursive: true })
writeFileSync(assFile, ass.join('\n') + '\n')

// ── picture: grade, texts, mark ──────────────────────────────────────────────
let vLast = vCur
if (recipe.grade) { filters.push(`[${vLast}]${recipe.grade}[vg]`); vLast = 'vg' }
const shade = recipe.shade ?? 0.4
if (shade > 0) { filters.push(`[${vLast}]geq=lum='lum(X,Y)*(1-${shade}*pow(max(0,(Y/H-0.86)/0.14),1.6))':cb='cb(X,Y)':cr='cr(X,Y)'[vs]`); vLast = 'vs' }
if ((recipe.texts || []).length > 0) { filters.push(`[${vLast}]subtitles=${assFile.replace(/[:\\']/g, '\\$&')}:fontsdir=/System/Library/Fonts[vt]`); vLast = 'vt' }
if (recipe.watermark !== false) {
  // the mark: small, in the bottom right corner; it comes in whole, then only the K stays (scripts/kybernos-watermark.py draws it, once per size and start)
  const k = Math.round(Math.max(W, H) * 0.011)
  const start = typeof recipe.watermark === 'object' ? (recipe.watermark.at ?? 1) : 1
  const speed = typeof recipe.watermark === 'object' ? (recipe.watermark.speed ?? 1) : 1
  const wm = join(wmDir, `wm2-${k}-${f(start)}-${f(speed)}.mov`)
  if (!existsSync(wm)) {
    const r = spawnSync('python3', [join(dirname(fileURLToPath(import.meta.url)), 'kybernos-watermark.py'), wm, '--k-height', String(k), '--delay', f(start), '--speed', f(speed)], { encoding: 'utf8' })
    if (r.status !== 0) fail('the mark could not be drawn: ' + r.stderr.slice(0, 300))
  }
  const at = inputs.length
  inputs.push(wm)
  const mx = Math.max(0, Math.round(W * 0.02) - 6)   // 6 = the transparent border of the mark's canvas
  const my = Math.max(0, Math.round(H * 0.03) - 6)
  filters.push(`[${vLast}]format=yuv444p[vb]`)
  filters.push(`[vb][${at}:v]overlay=x=W-w-${mx}:y=H-h-${my}:format=yuv444,format=yuv420p[vout]`)
} else filters.push(`[${vLast}]format=yuv420p[vout]`)

// ── sound: the clips' own, the voice, the music ducked under it ──────────────
const buses = []
filters.push(`[${aCur}]atrim=0:${f(T)},volume=${f(recipe.ambient ?? 0.3)}[amb]`)
buses.push('amb')
const voices = []
;(recipe.voice || []).forEach((v, n) => {
  const at = inputs.length
  inputs.push(join(parts, v.file))
  probe(join(parts, v.file))
  filters.push(`[${at}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round((v.at || 0) * 1000)}|${Math.round((v.at || 0) * 1000)},volume=${f(v.gain ?? 1)}[vo${n}]`)
  voices.push(`vo${n}`)
})
if (voices.length > 0) {
  filters.push(voices.length > 1 ? `${voices.map((v) => `[${v}]`).join('')}amix=inputs=${voices.length}:normalize=0[voice]` : `[${voices[0]}]anull[voice]`)
  filters.push('[voice]asplit=2[voiceMix][voiceKey]')
  buses.push('voiceMix')
}
if (recipe.music) {
  const m = recipe.music
  const at = inputs.length
  inputs.push(join(parts, m.file))
  probe(join(parts, m.file))
  const out = m.fadeOut ?? 1.8
  filters.push(`[${at}:a]atrim=start=${f(m.start || 0)}:end=${f((m.start || 0) + T)},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,afade=t=in:st=0:d=${f(m.fadeIn ?? 0.6)},afade=t=out:st=${f(T - out)}:d=${f(out)},volume=${f(m.gain ?? 0.5)}[mus]`)
  if (voices.length > 0 && m.duck !== false) { filters.push('[mus][voiceKey]sidechaincompress=threshold=0.01:ratio=12:attack=15:release=450[musd]'); buses.push('musd') } else buses.push('mus')
} else if (voices.length > 0) filters.push('[voiceKey]anullsink')
filters.push(`${buses.map((b) => `[${b}]`).join('')}amix=inputs=${buses.length}:normalize=0:duration=longest,atrim=0:${f(T)},loudnorm=I=-16:TP=-1.5:LRA=9[aout]`)

const argv = ['-hide_banner', '-loglevel', 'error', '-y']
for (const inp of inputs) argv.push('-i', inp)
argv.push('-filter_complex', filters.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', f(T),
  '-c:v', 'libx264', '-preset', 'slow', '-crf', String(recipe.crf ?? 22), '-maxrate', '3800k', '-bufsize', '7600k', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-r', String(FPS),
  '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', resolve(outFile))
mkdirSync(dirname(resolve(outFile)), { recursive: true })
const started = Date.now()
const run = spawnSync(FFMPEG, argv, { encoding: 'utf8', maxBuffer: 1 << 26 })
if (run.status !== 0) fail('ffmpeg: ' + (run.stderr || '').split('\n').slice(-12).join('\n'))
const size = readFileSync(resolve(outFile)).length
console.log(`✓ ${outFile}  ${f(T)} s  ${W}x${H}  ${(size / 1024 / 1024).toFixed(1)} MB  (${Math.round((Date.now() - started) / 1000)} s)`)
