import { act, fireEvent, render, screen } from '@testing-library/react-native'
import App from '../../App'
import { host } from '../../modules/kybernos-host/src'
import { CONSENT_SLOT, CONSENT_VERSION, WELCOME_SLOT } from '../settings'

// the native half and the device storage are stood in for: this test is about WHEN the engine is started, which is App's job
const mockStore = new Map<string, string>()
jest.mock('../../modules/kybernos-host/src', () => ({
  host: { platform: 'ios', selfTestDelay: null, selfTestHasKey: false, start: jest.fn(() => true), status: () => ({ phase: 'none', done: 0, total: 0 }), exitCode: () => null, logTail: () => '', memory: () => ({ footprintMb: 1, availableMb: 1, totalMb: 1 }), writeSelfTestResult: jest.fn() },
}))
jest.mock('../secureStorage', () => ({ deviceStorage: { get: async (n: string) => mockStore.get(n) ?? null, set: async (n: string, v: string) => { mockStore.set(n, v) }, remove: async (n: string) => { mockStore.delete(n) } } }))
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default)
jest.mock('react-native-webview', () => ({ WebView: () => null }))

const start = host!.start as jest.Mock
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })

describe('App: the engine starts only after the person agrees', () => {
  beforeEach(() => { mockStore.clear(); start.mockClear(); (host as any).selfTestDelay = null })

  it('a first launch shows the welcome page, then the agreement, and starts nothing until « I agree », which is then remembered', async () => {
    const first = await render(<App />)
    await flush()
    expect(screen.getByTestId('welcome-continue')).toBeTruthy()
    expect(screen.queryByTestId('consent-agree')).toBeNull()
    expect(start).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('welcome-continue'))
    await flush()
    expect(mockStore.get(WELCOME_SLOT)).toBe('1')
    expect(screen.getByTestId('consent-agree')).toBeTruthy()
    expect(screen.queryByTestId('page-dots')).toBeNull() // one question per page: no counter of pages
    expect(start).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('consent-decline'))
    await flush()
    expect(start).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('consent-agree'))
    await flush()
    expect(start).toHaveBeenCalledTimes(1)
    expect(mockStore.get(CONSENT_SLOT)).toBe(CONSENT_VERSION)
    first.unmount()
  })

  it('does not show the welcome page again once it was seen: only the agreement', async () => {
    mockStore.set(WELCOME_SLOT, '1')
    const r = await render(<App />)
    await flush()
    expect(screen.queryByTestId('welcome-continue')).toBeNull()
    expect(screen.getByTestId('consent-agree')).toBeTruthy()
    expect(start).not.toHaveBeenCalled()
    r.unmount()
  })

  it('never asks for a model key at the first launch: the engine starts and the loading page shows', async () => {
    mockStore.set(CONSENT_SLOT, CONSENT_VERSION)
    const r = await render(<App />)
    await flush()
    expect(screen.queryByText('Add your model key')).toBeNull()
    expect(screen.queryByText(/Paste your Anthropic key/)).toBeNull()
    expect(screen.getByTestId('loading-screen')).toBeTruthy()
    r.unmount()
  })

  it('does not ask again once the agreement is stored, and a person who agreed never sees the welcome page', async () => {
    mockStore.set(CONSENT_SLOT, CONSENT_VERSION)
    const r = await render(<App />)
    await flush()
    expect(screen.queryByTestId('consent-agree')).toBeNull()
    expect(screen.queryByTestId('welcome-continue')).toBeNull()
    expect(start).toHaveBeenCalledTimes(1)
    r.unmount()
  })

  it('asks again when the stored agreement is for an older text', async () => {
    mockStore.set(CONSENT_SLOT, 'old'); mockStore.set(WELCOME_SLOT, '1')
    const r = await render(<App />)
    await flush()
    expect(screen.getByTestId('consent-agree')).toBeTruthy(); expect(start).not.toHaveBeenCalled()
    r.unmount()
  })

  it('clears the old web sessions before the engine starts', async () => {
    mockStore.set(CONSENT_SLOT, CONSENT_VERSION)
    const order: string[] = []
    ;(host as any).clearWebSession = jest.fn(async () => { await new Promise((r) => setTimeout(r, 5)); order.push('cleared') })
    start.mockImplementation(() => { order.push('start'); return true })
    const r = await render(<App />)
    await flush()
    expect(order).toEqual(['cleared', 'start'])
    r.unmount()
    delete (host as any).clearWebSession
    start.mockImplementation(() => true)
  })

  it('starts the engine anyway when clearing the web sessions fails', async () => {
    mockStore.set(CONSENT_SLOT, CONSENT_VERSION)
    ;(host as any).clearWebSession = jest.fn(() => Promise.reject(new Error('no web view')))
    const r = await render(<App />)
    await flush()
    expect(start).toHaveBeenCalledTimes(1)
    r.unmount()
    delete (host as any).clearWebSession
  })

  it('has nobody to ask in a device-cloud self-test build: it starts at once', async () => {
    ;(host as any).selfTestDelay = 60
    const r = await render(<App />)
    await flush()
    expect(screen.queryByTestId('consent-agree')).toBeNull()
    expect(screen.queryByTestId('welcome-continue')).toBeNull()
    expect(start).toHaveBeenCalledTimes(1)
    r.unmount()
  })
})
