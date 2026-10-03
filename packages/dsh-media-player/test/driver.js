// test/driver.js — banc d'essai du renderer média, dans un vrai navigateur.
//
// Chargé après client/client.js (voir harness.html) : on rejoue exactement le
// contrat du chargeur de modules DSH (fabrique → objet plugin), on monte le
// corps d'aperçu avec React dans un DOM réel, et on mesure ce qui compte —
// l'élément média existe, il pointe une Blob URL, le WAV est réellement
// décodé (durée > 0), et un conteneur illisible produit un message.
import React from 'react'
import { createRoot } from 'react-dom/client'

window.__TEST_REACT__ = React

/** Octets d'un WAV PCM 16 bits mono (silence + sinusoïde), valide pour <audio>. */
function wavBytes(seconds = 0.4, hz = 440, rate = 8000) {
  const frames = Math.floor(seconds * rate)
  const buffer = new ArrayBuffer(44 + frames * 2)
  const view = new DataView(buffer)
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  ascii(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, frames * 2, true)
  for (let i = 0; i < frames; i += 1) {
    const fade = Math.min(1, i / (rate * 0.02), (frames - i) / (rate * 0.02))
    const sample = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12000 * fade)
    view.setInt16(44 + i * 2, sample, true)
  }
  return new Uint8Array(buffer)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Attend qu'un prédicat devienne vrai, sinon rend la main. */
async function until(predicate, timeoutMs = 6000, stepMs = 50) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await sleep(stepMs)
  }
  return undefined
}

/** Monte un composant dans un conteneur et laisse React committer. */
async function mount(selector, Body, props) {
  const container = document.querySelector(selector)
  const root = createRoot(container)
  root.render(React.createElement(Body, props))
  await sleep(120)
  return container
}

function fakeContext(captured) {
  const ctx = {
    effect: (fn) => {
      const disposer = fn()
      return disposer
    },
    locale: {
      bind: () => (key) => key,
      register: (namespace, dictionaries) => {
        captured.locale = { namespace, dictionaries }
        return () => {}
      }
    },
    slots: {
      inject: (name, fn) => fn(),
      register: (spec, component) => {
        captured.slot = spec
        captured.body = component
        return () => {}
      }
    },
    documentPreviews: {
      register: (definition) => {
        captured.definition = definition
        return () => {}
      }
    }
  }
  return ctx
}

async function main() {
  const report = { console: [] }
  const definition = window.__PLUGIN__
  report.plugin_id = definition === undefined ? null : definition.id

  // Le chargeur DSH fournit `require` : React vient de la table de la plateforme.
  const exports_ = definition.factory((id) =>
    id === 'react' ? window.__TEST_REACT__ : undefined
  )
  report.exports = Object.keys(exports_).sort()

  const captured = {}
  exports_.apply(fakeContext(captured))

  const meta = captured.definition
  report.declared = meta === undefined ? null : {
    id: meta.id,
    loading: meta.loading,
    priority: meta.priority,
    wrap: meta.wrap,
    extensions: meta.extensions,
    binaryExtensions: meta.binaryExtensions,
    title: meta.title()
  }
  report.inject = exports_.inject
  report.locale_namespace = captured.locale === undefined ? null : captured.locale.namespace
  report.locale_languages = captured.locale === undefined ? null : Object.keys(captured.locale.dictionaries).sort()
  report.slot = captured.slot

  const helpers = exports_.__test
  report.helpers = {
    mp3: helpers.mediaFor('dir/bonjour.mp3'),
    upper: helpers.mediaFor('CLIP.MP4'),
    webm: helpers.mediaFor('a/b/clip.webm'),
    text: helpers.mediaFor('notes.txt'),
    decoded: helpers.filePathOf('dsh-resource://file/session/sess-1/un%20dossier/mon%20fichier.mp3'),
    bytes: helpers.humanBytes(10080)
  }

  // ── cas 1 : audio valide ────────────────────────────────────────────────
  await mount('#audio', captured.body, {
    content: { kind: 'bytes', data: wavBytes() },
    resourceAddress: 'dsh-resource://file/session/s1/demo/bonjour.wav',
    t: (key) => key
  })
  const audio = await until(() => document.querySelector('#audio audio'))
  const duration = audio === undefined ? null : await until(() => (audio.duration > 0 ? audio.duration : undefined), 6000)
  report.audio = audio === undefined ? null : {
    tag: audio.tagName.toLowerCase(),
    controls: audio.controls === true,
    blob: audio.src.startsWith('blob:'),
    duration,
    hasHead: document.querySelector('#audio .dsh-media-name') !== null,
    frameKind: document.querySelector('#audio .dsh-media')?.getAttribute('data-dsh-media'),
    download: document.querySelector('#audio .dsh-media-open')?.getAttribute('download'),
    // Les contrôles natifs doivent suivre le thème sombre marqué par DSH.
    colorScheme: getComputedStyle(audio).colorScheme
  }

  // ── cas 2 : vidéo aux octets illisibles → message d'échec ───────────────
  const junk = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  await mount('#video', captured.body, {
    content: { kind: 'bytes', data: junk },
    resourceAddress: 'dsh-resource://file/session/s1/demo/clip.mp4',
    t: (key) => key
  })
  const video = await until(() => document.querySelector('#video video'))
  await until(() => document.querySelector('#video [data-state="failed"]'), 6000)
  report.video = video === undefined ? null : {
    tag: video.tagName.toLowerCase(),
    controls: video.controls === true,
    blob: video.src.startsWith('blob:'),
    frameKind: document.querySelector('#video .dsh-media')?.getAttribute('data-dsh-media'),
    failureText: document.querySelector('#video [data-state="failed"]')?.textContent ?? null
  }

  // ── cas 3 : contenu qui n'est pas des octets → « non lisible » ──────────
  await mount('#text', captured.body, {
    content: { kind: 'text', text: 'hello' },
    resourceAddress: 'dsh-resource://file/session/s1/demo/clip.mp4',
    t: (key) => key
  })
  const alert = await until(() => document.querySelector('#text [role="alert"]'))
  report.textContent = alert === undefined ? null : {
    tag: alert.tagName.toLowerCase(),
    text: alert.textContent
  }

  window.__RESULT__ = report
  return report
}

main().catch((error) => {
  window.__RESULT__ = { fatal: String((error && error.stack) || error) }
})
