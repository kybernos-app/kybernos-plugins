// The spreadsheet editor: IronCalc (MIT or Apache-2.0) in the frame. The whole file is read into an IronCalc model and written back by it:
// what it cannot hold (charts, comments, validation) is said by the guard of the host before this opens (office-guard.mjs).
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { IronCalc, init } from '@ironcalc/workbook'
import '@ironcalc/workbook/style.css'
import { Model } from '@ironcalc/wasm-xlsx'
import { LANG, READONLY, dirty, errorText, fail, fetchFile, listen, loaded } from './envelope.js'

const open = (bytes) => {
  let model
  try { model = Model.fromXlsx(bytes, 'workbook', 'en', 'UTC', LANG) } catch (e) { model = Model.fromXlsx(bytes, 'workbook', 'en', 'UTC', 'en') }
  model.evaluate()
  model.flushSendQueue()
  return model
}

class Boundary extends React.Component {
  state = { err: null }
  static getDerivedStateFromError (err) { return { err } }
  componentDidCatch (err) { fail(err) }
  render () { return this.state.err ? <pre style={{ padding: 16, color: '#b00', whiteSpace: 'pre-wrap' }}>{errorText(this.state.err)}</pre> : this.props.children }
}

function App () {
  const [cur, setCur] = useState(null)
  const readOnly = READONLY
  const state = useRef({ model: null, dirty: false, saved: false })

  const load = async () => {
    const f = await fetchFile()
    const model = open(f.bytes)
    state.current = { model, dirty: false, saved: false }
    setCur({ model, n: (cur ? cur.n : 0) + 1 })
    dirty(false)
    loaded(f.hash, readOnly)
  }

  useEffect(() => {
    listen({
      exportBytes: () => state.current.model.toXlsx(),
      reload: load,
      saved: () => { state.current.dirty = false; state.current.saved = true; dirty(false) }
    })
    load().catch(fail)
    // « Changed » = the model queued a diff since the last look (an empty queue is one byte). A model back at its first state, never saved, is clean again.
    const timer = setInterval(() => {
      const s = state.current
      if (s.model === null) return
      if (s.model.flushSendQueue().length > 1) s.dirty = true
      if (s.dirty && !s.saved && !s.model.canUndo()) s.dirty = false
      if (s.dirty !== s.last) { s.last = s.dirty; dirty(s.dirty) }
    }, 300)
    return () => clearInterval(timer)
  }, [])

  return cur === null ? null : <Boundary key={cur.n}><React.Suspense fallback={null}><IronCalc model={cur.model} canEdit={!readOnly} /></React.Suspense></Boundary>
}

await init({ module_or_path: new URL('wasm_bg.wasm', import.meta.url) })
createRoot(document.getElementById('app')).render(<App />)
