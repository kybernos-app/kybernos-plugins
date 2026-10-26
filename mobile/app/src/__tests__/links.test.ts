import { decideLink, WEBVIEW_ORIGINS } from '../links'

describe('decideLink', () => {
  it('lets the local engine pages and the in-page documents through', () => {
    for (const u of ['http://127.0.0.1:50342/', 'http://127.0.0.1:50342/kybernos/tasks?x=1', 'about:blank', 'blob:http://127.0.0.1:1/abc', 'data:text/html,hi']) expect(decideLink(u)).toEqual({ kind: 'allow' })
  })
  it('opens the app\'s own screens from kybernos:// links, with or without a query', () => {
    expect(decideLink('kybernos://settings')).toEqual({ kind: 'app', screen: 'settings' })
    expect(decideLink('kybernos://log')).toEqual({ kind: 'app', screen: 'log' })
    expect(decideLink('kybernos://settings?from=page#top')).toEqual({ kind: 'app', screen: 'settings' })
  })
  it('sends everything else outside the app', () => {
    expect(decideLink('https://kybernos.app/')).toEqual({ kind: 'external', url: 'https://kybernos.app/' })
    expect(decideLink('mailto:someone@example.com')).toEqual({ kind: 'external', url: 'mailto:someone@example.com' })
  })
  it('does not take a lookalike for the engine or for an app screen', () => {
    expect(decideLink('http://127.0.0.1.evil.example/')).toEqual({ kind: 'external', url: 'http://127.0.0.1.evil.example/' })
    expect(decideLink('http://localhost:3000/')).toEqual({ kind: 'external', url: 'http://localhost:3000/' })
    expect(decideLink('kybernos://settings/extra')).toEqual({ kind: 'external', url: 'kybernos://settings/extra' })
    expect(decideLink('kybernos://other')).toEqual({ kind: 'external', url: 'kybernos://other' })
  })
  it('asks the WebView to show it every link', () => { expect(WEBVIEW_ORIGINS).toEqual(['*']) })
})
