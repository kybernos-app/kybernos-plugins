// Tiny valid files for the tests, built on the fly (no media in git): a binary glTF with one animation, a Lottie animation.

/** A minimal .glb: header and JSON chunk (enough for a loader to read the structure the tests care about). */
export function makeGlb (json) {
  const body = new TextEncoder().encode(JSON.stringify(json))
  const padded = new Uint8Array(Math.ceil(body.length / 4) * 4).fill(0x20)
  padded.set(body)
  const out = new Uint8Array(20 + padded.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, out.length, true)
  dv.setUint32(12, padded.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(padded, 20)
  return out
}

/** A .glb that says it has the animations `names` (each 2 seconds long). */
export function glbWithClips (names) {
  return makeGlb({ asset: { version: '2.0' }, nodes: [{}], meshes: [{}], accessors: [{ max: [2] }], animations: names.map((name) => ({ name, samplers: [{ input: 0 }] })) })
}

/** A Lottie animation: a coloured square that moves, `seconds` long at 30 fps. */
export function makeLottie (seconds = 2, size = 200) {
  const op = Math.round(seconds * 30)
  return {
    v: '5.7.0', fr: 30, ip: 0, op, w: size, h: size, nm: 'square', ddd: 0, assets: [],
    layers: [{
      ddd: 0, ind: 1, ty: 4, nm: 'sq', sr: 1, ip: 0, op, st: 0, bm: 0,
      ks: {
        o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 1, k: [{ t: 0, s: [30, size / 2, 0], i: { x: 0.5, y: 1 }, o: { x: 0.5, y: 0 } }, { t: op, s: [size - 30, size / 2, 0] }] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] },
      },
      shapes: [{ ty: 'gr', it: [{ ty: 'rc', d: 1, s: { a: 0, k: [40, 40] }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 } }, { ty: 'fl', c: { a: 0, k: [1, 0.3, 0.1, 1] }, o: { a: 0, k: 100 }, r: 1 }, { ty: 'tr', p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } }] }],
    }],
  }
}

/**
 * A REAL, loadable .glb: one triangle on one node, and an animation "Spin" that turns the node half a turn about Y in two seconds.
 * Small enough to build here (no file in git), complete enough for GLTFLoader to build a scene and an AnimationClip from it.
 */
export function makeRealGlb () {
  const positions = new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0, 0.6, 0])
  const times = new Float32Array([0, 2])
  const quats = new Float32Array([0, 0, 0, 1, 0, 1, 0, 0]) // identity, then 180 degrees about Y
  const bin = new Uint8Array(positions.byteLength + times.byteLength + quats.byteLength)
  bin.set(new Uint8Array(positions.buffer), 0)
  bin.set(new Uint8Array(times.buffer), positions.byteLength)
  bin.set(new Uint8Array(quats.buffer), positions.byteLength + times.byteLength)
  const json = {
    asset: { version: '2.0', generator: 'kybernos-motion tests' },
    scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'tri', mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, mode: 4 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: times.byteLength },
      { buffer: 0, byteOffset: positions.byteLength + times.byteLength, byteLength: quats.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, -0.5, 0], max: [0.5, 0.6, 0] },
      { bufferView: 1, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [2] },
      { bufferView: 2, componentType: 5126, count: 2, type: 'VEC4' },
    ],
    animations: [{ name: 'Spin', samplers: [{ input: 1, output: 2, interpolation: 'LINEAR' }], channels: [{ sampler: 0, target: { node: 0, path: 'rotation' } }] }],
  }
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json))
  const jsonPad = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4).fill(0x20)
  jsonPad.set(jsonBytes)
  const binPad = new Uint8Array(Math.ceil(bin.length / 4) * 4)
  binPad.set(bin)
  const out = new Uint8Array(12 + 8 + jsonPad.length + 8 + binPad.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, 0x46546c67, true)
  dv.setUint32(4, 2, true)
  dv.setUint32(8, out.length, true)
  dv.setUint32(12, jsonPad.length, true)
  dv.setUint32(16, 0x4e4f534a, true)
  out.set(jsonPad, 20)
  const o = 20 + jsonPad.length
  dv.setUint32(o, binPad.length, true)
  dv.setUint32(o + 4, 0x004e4942, true)
  out.set(binPad, o + 8)
  return out
}
