import { fireEvent, render, screen } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { CONSENT_LINES, ConsentScreen } from '../ConsentScreen'

describe('ConsentScreen', () => {
  it('names where the text goes, and nothing happens until the person agrees', async () => {
    const onAgree = jest.fn()
    await render(<ConsentScreen onAgree={onAgree} />)
    expect(screen.getByText(/sent to the AI provider you set up/)).toBeTruthy()
    expect(CONSENT_LINES.join(' ')).toMatch(/Anthropic/)
    expect(onAgree).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('consent-agree'))
    expect(onAgree).toHaveBeenCalledTimes(1)
  })
  it('keeps the app closed after « Not now » and says why, without agreeing', async () => {
    const onAgree = jest.fn()
    await render(<ConsentScreen onAgree={onAgree} />)
    expect(screen.queryByTestId('consent-declined')).toBeNull()
    await fireEvent.press(screen.getByTestId('consent-decline'))
    expect(screen.getByTestId('consent-declined')).toBeTruthy()
    expect(onAgree).not.toHaveBeenCalled()
  })
  it('shows the privacy link only when there is an address, and opens it', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const none = await render(<ConsentScreen onAgree={jest.fn()} />)
    expect(screen.queryByTestId('consent-privacy')).toBeNull()
    none.unmount()
    await render(<ConsentScreen onAgree={jest.fn()} privacyUrl="https://example.test/privacy" />)
    await fireEvent.press(screen.getByTestId('consent-privacy'))
    expect(open).toHaveBeenCalledWith('https://example.test/privacy')
    open.mockRestore()
  })
})
