/** What the app does with a link the web interface wants to open. The WebView must hand EVERY link to this (`originWhitelist={['*']}` in App.tsx): by default react-native-webview keeps
 *  only http(s) and gives every other scheme to the operating system, which for `kybernos://settings` opened the app on itself and showed nothing (seen in the iOS log). */
export type LinkAction = { kind: 'allow' } | { kind: 'app'; screen: 'settings' | 'log' } | { kind: 'external'; url: string }

const LOCAL = /^(https?:\/\/127\.0\.0\.1[:/]|about:|blob:|data:)/
const APP_LINKS: Record<string, 'settings' | 'log'> = { 'kybernos://settings': 'settings', 'kybernos://log': 'log' }

export const decideLink = (url: string): LinkAction => {
  if (LOCAL.test(url)) return { kind: 'allow' }
  const screen = APP_LINKS[url.replace(/[?#].*$/, '')]
  if (screen !== undefined) return { kind: 'app', screen }
  return { kind: 'external', url }
}

/** Everything reaches `decideLink`: see above. */
export const WEBVIEW_ORIGINS = ['*']
