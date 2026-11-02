// `cd packages/kybernos-motion && node test-assets-info.mjs`
import { inspectGlb, inspectLottie } from './assets-info.mjs'
import { makeGlb, makeRealGlb, makeLottie } from './lib-fixtures.mjs'

let fail = 0
let n = 0
const ok = (name, cond, detail) => {
  n++
  if (cond) return
  fail++
  console.log(`FAIL ${name}${detail === undefined ? '' : ' :: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`)
}

{
  const glb = makeGlb({ asset: { version: '2.0' }, nodes: [{}, {}], meshes: [{}], materials: [{}, {}], skins: [{}], accessors: [{}, { max: [1.5] }, { max: [4] }], animations: [{ name: 'Run', samplers: [{ input: 1 }, { input: 2 }] }, { samplers: [{ input: 1 }] }] })
  const r = inspectGlb(glb)
  ok('glb: animations by name with their length (the longest input)', r.ok && r.animations[0].name === 'Run' && r.animations[0].seconds === 4 && r.animations[1].name === 'animation_1' && r.animations[1].seconds === 1.5, r)
  ok('glb: counts', r.nodes === 2 && r.meshes === 1 && r.materials === 2 && r.skins === 1)
  ok('glb: a model with no animation says so with an empty list', inspectGlb(makeGlb({ asset: {}, meshes: [{}] })).animations.length === 0)
  ok('glb: a wrong header is refused with a reason', inspectGlb(new Uint8Array(40)).ok === false && inspectGlb(new Uint8Array(3)).ok === false && inspectGlb('x').ok === false)
  const bad = makeGlb({}); new DataView(bad.buffer).setUint32(4, 1, true)
  ok('glb: version 1 is refused', inspectGlb(bad).ok === false)
  const cut = makeGlb({ a: 1 }).subarray(0, 24)
  ok('glb: a cut file is refused, not read past its end', inspectGlb(cut).ok === false)
  const junk = makeGlb({ filler: 'x'.repeat(40) }); junk.set(new TextEncoder().encode('{nope'), 20)
  ok('glb: unreadable JSON is refused', inspectGlb(junk).ok === false)
  ok('glb: a Uint8Array view with an offset is read correctly', inspectGlb(new Uint8Array(new Uint8Array([9, 9, 9, ...glb]).buffer, 3)).ok === true)
}
{
  const lottie = { v: '5.7.0', fr: 30, ip: 0, op: 90, w: 512, h: 256, layers: [{}, {}], assets: [] }
  const r = inspectLottie(JSON.stringify(lottie))
  ok('lottie: size, rate, length in seconds and layers', r.ok && r.fps === 30 && r.seconds === 3 && r.width === 512 && r.height === 256 && r.layers === 2 && r.expressions === false, r)
  ok('lottie: an offset start is counted from ip', inspectLottie(JSON.stringify({ ...lottie, ip: 30, op: 60 })).seconds === 1)
  ok('lottie: expressions are flagged (they are never run)', inspectLottie(JSON.stringify({ ...lottie, layers: [{ ks: { o: { k: 100, x: 'var $bm_rt = time;' } } }] })).expressions === true)
  ok('lottie: easing curves are not mistaken for expressions', inspectLottie(JSON.stringify({ ...lottie, layers: [{ ks: { o: { k: [{ o: { x: [0.3], y: [0] }, i: { x: [0.7], y: [1] } }] } } }] })).expressions === false)
  ok('lottie: not a Lottie file is refused with a reason', inspectLottie('{nope').ok === false && inspectLottie('{"a":1}').ok === false && inspectLottie('[]').ok === false && inspectLottie('null').ok === false)
}

{
  const ext = inspectGlb(makeGlb({ asset: {}, buffers: [{ uri: 'model.bin', byteLength: 1 }, { uri: 'data:application/octet-stream;base64,AA==', byteLength: 1 }], images: [{ uri: 'https://x.example/t.png' }, { bufferView: 0 }] }))
  ok('glb: files outside the model are counted (they are never loaded)', ext.ok && ext.externalFiles === 2, ext)
  ok('glb: a self-contained model has none', inspectGlb(makeRealGlb()).externalFiles === 0)
  const lot = inspectLottie(JSON.stringify({ fr: 30, op: 30, layers: [], assets: [{ p: 'img_0.png' }, { p: 'data:image/png;base64,AA' }, { p: '' }, { layers: [] }] }))
  ok('lottie: images outside the file are counted', lot.ok && lot.externalImages === 1, lot)
}
{
  const r = inspectGlb(makeRealGlb())
  ok('fixture: the loadable test model says it has one animation, "Spin", 2 s long', r.ok && r.animations.length === 1 && r.animations[0].name === 'Spin' && r.animations[0].seconds === 2 && r.meshes === 1, r)
  const l = inspectLottie(JSON.stringify(makeLottie(2, 200)))
  ok('fixture: the test Lottie is a valid 2 s, 200 px animation', l.ok && l.seconds === 2 && l.width === 200 && l.expressions === false, l)
}

console.log(`${n - fail}/${n} checks passed`)
process.exit(fail ? 1 : 0)
