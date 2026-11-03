// The document editor: eigenpal docx-editor (Apache-2.0) in the frame. It keeps tracked changes and comments; accepting or refusing them is a
// paid tier of that editor, so the guard of the host calls them « review » (office-guard.mjs) and the full editor is the way to review.
import React, { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { DocxEditor, useFonts } from '@docx-editor.dev/react'
import { packagedFonts } from '@docx-editor.dev/fonts'
import '@docx-editor.dev/core/styles/editor.css'
import { LANG, NAME, READONLY, dirty, errorText, fail, fetchFile, listen, loaded } from './envelope.js'

class Boundary extends React.Component {
  state = { err: null }
  static getDerivedStateFromError (err) { return { err } }
  componentDidCatch (err) { fail(err) }
  render () { return this.state.err ? <pre style={{ padding: 16, color: '#b00', whiteSpace: 'pre-wrap' }}>{errorText(this.state.err)}</pre> : this.props.children }
}

function Editor ({ bytes, readOnly, edRef, onChange }) {
  const fonts = useFonts(packagedFonts())
  return <DocxEditor ref={edRef} document={bytes} mode={readOnly ? 'view' : 'edit'} fonts={fonts} locale={LANG} title={NAME.replace(/\.docx$/i, '')} onChange={onChange} />
}

function App () {
  const [cur, setCur] = useState(null)
  const readOnly = READONLY
  const ed = useRef(null)
  const state = useRef({ dirty: false, since: 0 })

  const load = async () => {
    const f = await fetchFile()
    state.current = { dirty: false, since: performance.now() }
    setCur({ bytes: f.bytes, n: (cur ? cur.n : 0) + 1 })
    dirty(false)
    loaded(f.hash, readOnly)
  }
  // The editor normalises the document when it opens and says « changed » for it: only what comes after the first moment counts.
  const onChange = () => {
    const s = state.current
    if (performance.now() - s.since < 1500 || s.dirty) return
    s.dirty = true
    dirty(true)
  }

  useEffect(() => {
    listen({
      exportBytes: async () => {
        const out = await ed.current.save()
        if (!out) throw new Error('Nothing to save.')
        return out
      },
      reload: load,
      saved: () => { state.current.dirty = false; dirty(false) }
    })
    load().catch(fail)
  }, [])

  return cur === null ? null : <Boundary key={cur.n}><Editor bytes={cur.bytes} readOnly={readOnly} edRef={ed} onChange={onChange} /></Boundary>
}

createRoot(document.getElementById('app')).render(<App />)
