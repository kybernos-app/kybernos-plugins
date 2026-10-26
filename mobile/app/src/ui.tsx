import { Text, TextProps } from 'react-native'
import { MAX_TEXT_ZOOM } from './textZoom'

/** The colours of the app's own screens (the values App.tsx and the consent page already used). Only the card and the failure line are new. */
export const C = {
  bg: '#121217', button: '#2a2a35', track: '#333', fg: '#fff', text: '#d6d8de', note: '#9aa0aa', diag: '#8a8a95', link: '#8ab4ff', onPrimary: '#121217',
  card: '#1b1b22', danger: '#ff9a8a',
}

/** The text of the app's own screens grows with the phone's text size up to the same ceiling as the web view (115 %), then the layout steps down (fit.ts) instead of scrolling. */
export const NATIVE_MAX_FONT_SCALE = MAX_TEXT_ZOOM / 100

export function T(props: TextProps) {
  return <Text maxFontSizeMultiplier={NATIVE_MAX_FONT_SCALE} {...props} />
}
