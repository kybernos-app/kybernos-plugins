import { fireEvent, render, screen } from '@testing-library/react-native'
import { Linking } from 'react-native'
import { CONSENT_TEXT, ConsentScreen } from '../ConsentScreen'

describe('ConsentScreen', () => {
  it('names who receives the text, with no provider as the default, and nothing happens until the person agrees', async () => {
    const onAgree = jest.fn()
    await render(<ConsentScreen onAgree={onAgree} lang="en" />)
    expect(screen.getByText(/sent to the company that runs the model/)).toBeTruthy()
    for (const l of ['en', 'fr'] as const) {
      const text = CONSENT_TEXT[l].lines.join(' ')
      expect(text).toMatch(/Kybernos/)
      expect(text).not.toMatch(/Anthropic/) // the page does not push one provider
    }
    expect(onAgree).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('consent-agree'))
    expect(onAgree).toHaveBeenCalledTimes(1)
  })
  it('is in French on a French phone, same buttons', async () => {
    await render(<ConsentScreen onAgree={jest.fn()} lang="fr" />)
    expect(screen.getByText('Avant de commencer')).toBeTruthy()
    expect(screen.getByText('J\u2019accepte')).toBeTruthy()
    expect(screen.getByTestId('consent-decline')).toBeTruthy()
  })
  it('keeps the app closed after « Not now » and says why, without agreeing', async () => {
    const onAgree = jest.fn()
    await render(<ConsentScreen onAgree={onAgree} lang="en" />)
    expect(screen.queryByTestId('consent-declined')).toBeNull()
    await fireEvent.press(screen.getByTestId('consent-decline'))
    expect(screen.getByTestId('consent-declined')).toBeTruthy()
    expect(onAgree).not.toHaveBeenCalled()
  })
  it('shows the two page dots only when the welcome page came just before', async () => {
    const a = await render(<ConsentScreen onAgree={jest.fn()} lang="en" />)
    expect(screen.queryByTestId('page-dots')).toBeNull()
    await a.unmount()
    await render(<ConsentScreen onAgree={jest.fn()} lang="en" dots />)
    expect(screen.getByTestId('page-dots')).toBeTruthy()
  })
  it('shows the privacy link only when there is an address, and opens it', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    const none = await render(<ConsentScreen onAgree={jest.fn()} lang="en" />)
    expect(screen.queryByTestId('consent-privacy')).toBeNull()
    await none.unmount()
    await render(<ConsentScreen onAgree={jest.fn()} lang="en" privacyUrl="https://example.test/privacy" />)
    await fireEvent.press(screen.getByTestId('consent-privacy'))
    expect(open).toHaveBeenCalledWith('https://example.test/privacy')
    open.mockRestore()
  })
})
