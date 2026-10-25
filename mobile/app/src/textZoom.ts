/** Android's WebView scales its text by the system font size (Settings > Display > Font size) unless told otherwise. The interface is drawn for 100 %: at 145 % (a common choice) titles wrap, labels
 *  are cut (« Standard… », « New chat · with… ») and the logo no longer matches its wordmark. The person's choice is still honoured, up to a ceiling the layout copes with. iOS does not scale web text this way. */
export const MAX_TEXT_ZOOM = 115

/** The WebView's text zoom in percent for the system's font scale (1 = 100 %); anything unreadable counts as 1. */
export const webTextZoom = (fontScale: number, max: number = MAX_TEXT_ZOOM): number => {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1
  return Math.max(100, Math.min(max, Math.round(scale * 100)))
}
