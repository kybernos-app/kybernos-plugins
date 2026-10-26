import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { WELCOME_TEXT, WelcomeScreen } from '../WelcomeScreen'

const scroll = () => screen.getByTestId('welcome-scroll')
const later = (ms: number) => act(async () => { jest.advanceTimersByTime(ms) })

describe('WelcomeScreen', () => {
  it('says what Kybernos is for in one sentence, with one button, then continues', async () => {
    const onContinue = jest.fn()
    await render(<WelcomeScreen onContinue={onContinue} lang="en" />)
    for (const t of ['Assistants that do the work for you', 'Say what you need. Kybernos takes care of it.', 'Get started']) expect(screen.getByText(t)).toBeTruthy()
    expect(screen.queryByTestId('page-dots')).toBeNull() // one question per page: no counter of pages
    expect(onContinue).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('welcome-continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
  it('is in French on a French phone', async () => {
    await render(<WelcomeScreen onContinue={jest.fn()} lang="fr" />)
    for (const t of ['Des assistants qui font le travail pour toi', 'Commencer']) expect(screen.getByText(t)).toBeTruthy()
  })
  it('does not borrow another product\u2019s sentences and does not promise a duration', () => {
    const all = JSON.stringify(WELCOME_TEXT)
    expect(all).not.toMatch(/OpenClaw|minutes?|living on/i)
  })
  describe('fit: it steps down instead of scrolling', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())
    it('drops the sentence under the title when the room is too small, and never the title or the button', async () => {
      await render(<WelcomeScreen onContinue={jest.fn()} lang="en" />)
      const tooTall = async () => { await fireEvent(scroll(), 'contentSizeChange', 300, 1200); await later(70) }
      await fireEvent(scroll(), 'layout', { nativeEvent: { layout: { height: 500 } } })
      expect(screen.queryByText(WELCOME_TEXT.en.sub)).toBeTruthy()
      await tooTall()                                   // tier 1: smaller, everything still there
      expect(screen.queryByText(WELCOME_TEXT.en.sub)).toBeTruthy()
      await tooTall()                                   // tier 2: the sentence under the title goes
      expect(screen.queryByText(WELCOME_TEXT.en.sub)).toBeNull()
      expect(screen.getByText(WELCOME_TEXT.en.title)).toBeTruthy(); expect(screen.getByTestId('welcome-continue')).toBeTruthy()
    })
    it('shows everything when the content fits', async () => {
      await render(<WelcomeScreen onContinue={jest.fn()} lang="en" />)
      await fireEvent(scroll(), 'layout', { nativeEvent: { layout: { height: 700 } } })
      await fireEvent(scroll(), 'contentSizeChange', 300, 600); await later(300)
      expect(screen.queryByText(WELCOME_TEXT.en.sub)).toBeTruthy()
    })
  })
})
