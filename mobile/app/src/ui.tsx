import { Text, TextProps } from 'react-native'
import { MAX_TEXT_ZOOM } from './textZoom'

/** The colours of the app's own screens (the values App.tsx and the consent page already used). Only the card, the accents and the failure line are new. */
export const C = {
  bg: '#121217', button: '#2a2a35', track: '#333', fg: '#fff', text: '#d6d8de', note: '#9aa0aa', diag: '#8a8a95', link: '#8ab4ff', onPrimary: '#121217',
  card: '#1b1b22', danger: '#ff9a8a', blue: '#8ab4ff', amber: '#f2c46d', mint: '#7fd8b0',
  blueTint: 'rgba(138,180,255,0.16)', amberTint: 'rgba(242,196,109,0.16)', mintTint: 'rgba(127,216,176,0.16)',
}

/** The text of the app's own screens grows with the phone's text size up to the same ceiling as the web view (115 %), then the layout steps down (fit.ts) instead of scrolling. */
export const NATIVE_MAX_FONT_SCALE = MAX_TEXT_ZOOM / 100

export function T(props: TextProps) {
  return <Text maxFontSizeMultiplier={NATIVE_MAX_FONT_SCALE} {...props} />
}
