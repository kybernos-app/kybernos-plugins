import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import * as Clipboard from 'expo-clipboard'
import { SettingsScreen } from '../SettingsScreen'
import { createSettings, KEY_SLOT, SecureStorage } from '../settings'

jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn() }))

const GOOD = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUv_-0123'
const memory = () => {
  const data = new Map<string, string>()
  const store: SecureStorage = { get: async (n) => data.get(n) ?? null, set: async (n, v) => { data.set(n, v) }, remove: async (n) => { data.delete(n) } }
  return { data, store }
}
const setup = async (over: Partial<React.ComponentProps<typeof SettingsScreen>> = {}) => {
  const { data, store } = memory()
  const props = { settings: createSettings(store), engineRunning: true, onClose: jest.fn(), onShareLog: jest.fn(), onKeyChanged: jest.fn(), ...over }
  await render(<SettingsScreen {...props} />)
  return { data, props }
}

describe('SettingsScreen', () => {
  beforeEach(() => (Clipboard.getStringAsync as jest.Mock).mockReset())

  it('starts with no key and refuses something that is not a key, storing nothing', async () => {
    const { data, props } = await setup()
    expect(await screen.findByText('No key stored')).toBeTruthy()
    await fireEvent.changeText(screen.getByTestId('key-input'), 'hello')
    await fireEvent.press(screen.getByTestId('key-save'))
    expect(await screen.findByText(/does not look like an Anthropic key/)).toBeTruthy()
    expect(data.size).toBe(0); expect(props.onKeyChanged).not.toHaveBeenCalled()
  })

  it('pastes, saves in the secure storage, shows only the end of the key and says to reopen the app', async () => {
    ;(Clipboard.getStringAsync as jest.Mock).mockResolvedValue(GOOD + '\n')
    const { data, props } = await setup()
    await fireEvent.press(screen.getByTestId('key-paste'))
    await waitFor(() => expect(screen.getByTestId('key-input').props.value).toBe(GOOD + '\n'))
    await fireEvent.press(screen.getByTestId('key-save'))
    expect(await screen.findByText(/Stored in the secure storage of this phone \(…0123\)/)).toBeTruthy()
    expect(screen.getByTestId('settings-message').props.children).toMatch(/Close the app completely and open it again/)
    expect(data.get(KEY_SLOT)).toBe(GOOD)
    expect(props.onKeyChanged).toHaveBeenCalledWith(true)
    expect(screen.getByTestId('key-input').props.value).toBe('') // the field is emptied: the key is not left on screen
    expect(JSON.stringify(screen.toJSON())).not.toContain(GOOD)
  })

  it('does not ask to reopen the app when the engine is not running yet', async () => {
    ;(Clipboard.getStringAsync as jest.Mock).mockResolvedValue(GOOD)
    await setup({ engineRunning: false })
    await fireEvent.press(screen.getByTestId('key-paste'))
    await waitFor(() => expect(screen.getByTestId('key-input').props.value).toBe(GOOD))
    await fireEvent.press(screen.getByTestId('key-save'))
    expect((await screen.findByTestId('settings-message')).props.children).toBe('Saved in the secure storage of this phone.')
  })

  it('removes a stored key (the button exists only when one is stored)', async () => {
    const { data, props } = await setup()
    expect(screen.queryByTestId('key-remove')).toBeNull()
    await fireEvent.changeText(screen.getByTestId('key-input'), GOOD)
    await fireEvent.press(screen.getByTestId('key-save'))
    await fireEvent.press(await screen.findByTestId('key-remove'))
    expect(await screen.findByText('No key stored')).toBeTruthy()
    expect(data.has(KEY_SLOT)).toBe(false); expect(props.onKeyChanged).toHaveBeenLastCalledWith(false)
  })

  it('says so when there is nothing to paste', async () => {
    ;(Clipboard.getStringAsync as jest.Mock).mockResolvedValue('')
    await setup()
    await fireEvent.press(screen.getByTestId('key-paste'))
    expect(await screen.findByText(/Nothing to paste/)).toBeTruthy()
  })

  it('first run explains itself and offers to skip; later it is just Settings with Done', async () => {
    const first = await setup({ firstRun: true })
    expect(screen.getByText('Add your model key')).toBeTruthy()
    await fireEvent.press(screen.getByText('Skip for now'))
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
    expect(await screen.findByText('No key stored')).toBeTruthy()
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
