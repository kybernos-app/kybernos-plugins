/** What the web interface says to the app through `ReactNativeWebView.postMessage` (strings only). The only message so far: the interface offers its own entry to the app's settings (the
 *  « The Kybernos app » page of the kybernos-mobile plugin), so the app can drop the small gear button it shows as a fallback. Anything else is ignored, never trusted: the page is local, but a
 *  message is data. */
export const isAppEntryMessage = (data: unknown): boolean => {
  if (typeof data !== 'string' || data.length > 200) return false
  try {
    const m = JSON.parse(data)
    return m !== null && typeof m === 'object' && m.kybernos === 'app-entry' && m.entry === 'settings'
  } catch { return false }
}
