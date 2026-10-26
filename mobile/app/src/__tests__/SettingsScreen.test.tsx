import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { SettingsScreen } from '../SettingsScreen'
import { createSettings, SecureStorage } from '../settings'

const memory = () => {
  const data = new Map<string, string>()
  const store: SecureStorage = { get: async (n) => data.get(n) ?? null, set: async (n, v) => { data.set(n, v) }, remove: async (n) => { data.delete(n) } }
  return { data, store }
}
const setup = async (over: Partial<React.ComponentProps<typeof SettingsScreen>> = {}) => {
  const { data, store } = memory()
  const props = { settings: createSettings(store), engineRunning: true, onClose: jest.fn(), onShareLog: jest.fn(), ...over }
  await render(<SettingsScreen {...props} />)
  return { data, props }
}

describe('SettingsScreen', () => {
  it('is Settings with a Done button, with no model key field: the key is asked in the first-run wizard of the web interface and kept by DSH', async () => {
    const first = await setup({})
    expect(screen.getByText('Settings')).toBeTruthy()
    expect(screen.queryByTestId('key-input')).toBeNull(); expect(screen.queryByText(/Anthropic key|Add your model key/)).toBeNull()
    await fireEvent.press(screen.getByText('Done'))
    expect(first.props.onClose).toHaveBeenCalled()
  })
  it('shows the background switch of the phone it runs on, and only that one', async () => {
    await setup({ platform: 'android' })
    expect(screen.getByTestId('switch-keep-running')).toBeTruthy(); expect(screen.queryByTestId('switch-reminders')).toBeNull()
    expect(screen.getByText('Keep running in the background')).toBeTruthy()
  })
  it('on iOS it offers reminders, not a service, and says why', async () => {
    await setup({ platform: 'ios' })
    expect(screen.getByTestId('switch-reminders')).toBeTruthy(); expect(screen.queryByTestId('switch-keep-running')).toBeNull()
    expect(screen.getByText(/cannot run an automation while the app is closed/)).toBeTruthy()
  })
  it('without a platform there is no Background section', async () => {
    await setup()
    expect(screen.queryByTestId('switch-keep-running')).toBeNull(); expect(screen.queryByTestId('switch-reminders')).toBeNull()
  })
  it('turning a switch asks the app to apply it, shows what it says, and puts the switch back when it is refused', async () => {
    const onBackgroundChange = jest.fn(async () => ({ ok: false, message: 'Notifications are refused for this app.' }))
    await setup({ platform: 'ios', onBackgroundChange })
    await fireEvent(screen.getByTestId('switch-reminders'), 'valueChange', true)
    expect(onBackgroundChange).toHaveBeenCalledWith('reminders', true)
    expect(await screen.findByText('Notifications are refused for this app.')).toBeTruthy()
    await waitFor(() => expect(screen.getByTestId('switch-reminders').props.value).toBe(false))
  })
  it('keeps a switch on when the app accepts it', async () => {
    const onBackgroundChange = jest.fn(async () => ({ ok: true }))
    await setup({ platform: 'android', onBackgroundChange })
    await fireEvent(screen.getByTestId('switch-keep-running'), 'valueChange', true)
    expect(onBackgroundChange).toHaveBeenCalledWith('keepRunning', true)
    await waitFor(() => expect(screen.getByTestId('switch-keep-running').props.value).toBe(true))
  })
  it('offers to share the engine log', async () => {
    const { props } = await setup()
    await fireEvent.press(screen.getByTestId('share-log'))
    expect(props.onShareLog).toHaveBeenCalled()
    expect(screen.getByText('Settings')).toBeTruthy(); expect(screen.getByText('Done')).toBeTruthy()
  })
})

describe('SettingsScreen consent row', () => {
  const props = (settings: ReturnType<typeof createSettings>, over = {}) => ({ settings, engineRunning: true, onClose: jest.fn(), onShareLog: jest.fn(), ...over })
  it('offers nothing to withdraw before there is an agreement', async () => {
    const { store } = memory()
    await render(<SettingsScreen {...props(createSettings(store))} />)
    expect(await screen.findByText('Settings')).toBeTruthy()
    expect(screen.queryByTestId('consent-withdraw')).toBeNull()
  })
  it('withdrawing clears the agreement, tells the engine owner, and says to restart', async () => {
    const { data, store } = memory()
    const settings = createSettings(store)
    await settings.giveConsent()
    const onConsentWithdrawn = jest.fn()
    await render(<SettingsScreen {...props(settings, { onConsentWithdrawn })} />)
    await fireEvent.press(await screen.findByTestId('consent-withdraw'))
    expect(await screen.findByText(/Close the app completely: Kybernos asks again/)).toBeTruthy()
    expect(onConsentWithdrawn).toHaveBeenCalled(); expect(await settings.consented()).toBe(false); expect(data.size).toBe(0)
    expect(screen.queryByTestId('consent-withdraw')).toBeNull()
  })
})
