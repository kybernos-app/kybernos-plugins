import { fireEvent, render, screen } from '@testing-library/react-native'
import { LOADING_TEXT, LoadingScreen, SLOW_AFTER_S } from '../LoadingScreen'
import { bootDiagnosticsText } from '../bootlog'

const base = { elapsedS: 3, diagnostics: 'engine log: 3 s, status starting, sign-in line not yet, probe no answer (Error: fetch failed: java.net.ConnectException: Failed to connect to /127.0.0.1:)', onShowLog: jest.fn(), onSettings: jest.fn(), onShareLog: jest.fn(), lang: 'en' as const }

describe('LoadingScreen', () => {
  it('says « Starting Kybernos » in plain words and keeps the engine\u2019s own text out of sight', async () => {
    await render(<LoadingScreen {...base} state={{ phase: 'booting' }} />)
    expect(screen.getByText('Starting Kybernos\u2026')).toBeTruthy()
    expect(screen.queryByTestId('boot-log')).toBeNull()
    expect(screen.queryByText(/ConnectException|engine log/)).toBeNull()
    expect(screen.queryByTestId('show-log')).toBeNull(); expect(screen.queryByTestId('boot-settings')).toBeNull()
    expect(screen.queryByTestId('share-log-boot')).toBeNull()
  })
  it('shows a percentage only on the very first launch, while the runtime is being prepared', async () => {
    await render(<LoadingScreen {...base} state={{ phase: 'unpacking', done: 31, total: 58 }} />)
    expect(screen.getByText('Getting Kybernos ready')).toBeTruthy()
    expect(screen.getByText('Preparing 53 %')).toBeTruthy()
    expect(screen.getByText(/only happens the first time/)).toBeTruthy()
  })
  it('behind « Details » there are the diagnostics, the log and the settings, as before', async () => {
    const onShowLog = jest.fn(); const onSettings = jest.fn()
    await render(<LoadingScreen {...base} onShowLog={onShowLog} onSettings={onSettings} state={{ phase: 'booting' }} />)
    await fireEvent.press(screen.getByTestId('boot-details'))
    expect(screen.getByTestId('boot-log').props.accessibilityLabel).toMatch(/^engine log: /)
    await fireEvent.press(screen.getByTestId('show-log')); expect(onShowLog).toHaveBeenCalledTimes(1)
    await fireEvent.press(screen.getByTestId('boot-settings')); expect(onSettings).toHaveBeenCalledTimes(1)
    await fireEvent.press(screen.getByTestId('boot-details'))
    expect(screen.queryByTestId('boot-log')).toBeNull()
  })
  it('says it is slow after ' + SLOW_AFTER_S + ' seconds and offers to share the log (there is no « try again »: a stopped engine needs the app reopened)', async () => {
    const onShareLog = jest.fn()
    await render(<LoadingScreen {...base} onShareLog={onShareLog} elapsedS={SLOW_AFTER_S + 1} state={{ phase: 'booting' }} />)
    expect(screen.getByText('Still starting\u2026')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('share-log-boot')); expect(onShareLog).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/Try again|Réessayer/)).toBeNull()
  })
  it('does not call the first launch slow: unpacking has its own progress', async () => {
    await render(<LoadingScreen {...base} elapsedS={120} state={{ phase: 'unpacking', done: 10, total: 58 }} />)
    expect(screen.queryByText('Still starting\u2026')).toBeNull()
  })
  it('a failed start says so in plain words, not with the exit code, and offers the log', async () => {
    await render(<LoadingScreen {...base} state={{ phase: 'failed', message: 'The engine stopped (exit 1). Close and reopen the app to start it again.' }} />)
    expect(screen.getByText('Kybernos could not start')).toBeTruthy()
    expect(screen.getByText(/Close the app and open it again/)).toBeTruthy()
    expect(screen.queryByText(/exit 1/)).toBeNull()
    expect(screen.getByTestId('share-log-boot')).toBeTruthy()
  })
  it('is in French on a French phone', async () => {
    await render(<LoadingScreen {...base} lang="fr" state={{ phase: 'booting' }} />)
    expect(screen.getByText(LOADING_TEXT.fr.starting)).toBeTruthy(); expect(screen.getByText('Détails')).toBeTruthy()
  })
  it('keeps the diagnostics block the remote test drivers look for', () => {
    expect(bootDiagnosticsText({ status: 'starting', signInInLog: false, probe: null, exitCode: null }, '', 2)).toMatch(/^engine log: 2 s/)
  })
})
