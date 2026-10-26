import { useEffect, useRef, useState } from 'react'
import { LayoutChangeEvent, useWindowDimensions } from 'react-native'

/** « Fit »: a screen that must not need a scrollbar steps down, one tier at a time, until its content fits the room it has. Tier 0 shows everything; each next tier is a smaller
 *  layout or drops the least important line (the screen decides what). The ScrollView stays as a safety net for the last tier and for tiny phones. Give the scroll area `onLayout`
 *  and `onContentSizeChange` from this hook. The measure is re-done when the window, the text size or the language changes. */
export const useFit = (maxTier: number, deps: ReadonlyArray<unknown> = []) => {
  const win = useWindowDimensions()
  const [tier, setTier] = useState(0)
  const box = useRef(0)
  const content = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tierRef = useRef(0)
  tierRef.current = tier
  // wait a moment after the last measure: a tier change that does not change the height sends no new measure, and the next step must still happen
  const decide = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      if (box.current > 0 && content.current > box.current + 1 && tierRef.current < maxTier) setTier((t) => t + 1)
    }, 60)
  }
  useEffect(() => { content.current = 0; setTier(0) }, [win.width, win.height, win.fontScale, maxTier, ...deps])
  useEffect(() => { decide(); return () => { if (timer.current !== null) clearTimeout(timer.current) } }, [tier])
  return {
    tier,
    onLayout: (e: LayoutChangeEvent) => { box.current = Math.round(e.nativeEvent.layout.height); decide() },
    onContentSizeChange: (_w: number, h: number) => { content.current = Math.round(h); decide() },
  }
}
