import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { WELCOME_TEXT, WelcomeScreen } from '../WelcomeScreen'

const scroll = () => screen.getByTestId('welcome-scroll')
const later = (ms: number) => act(async () => { jest.advanceTimersByTime(ms) })

describe('WelcomeScreen', () => {
  it('says what Kybernos is for in three rows about the result, then continues', async () => {
    const onContinue = jest.fn()
    await render(<WelcomeScreen onContinue={onContinue} lang="en" />)
    for (const t of ['Be more productive', 'Get more things done', 'Automate your tasks', 'Stay in control', 'Continue']) expect(screen.getByText(t)).toBeTruthy()
    expect(screen.getByTestId('page-dots')).toBeTruthy()
    expect(onContinue).not.toHaveBeenCalled()
    await fireEvent.press(screen.getByTestId('welcome-continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })
  it('is in French on a French phone', async () => {
    await render(<WelcomeScreen onContinue={jest.fn()} lang="fr" />)
    for (const t of ['Gagne en productivité', 'Fais avancer plus de choses', 'Automatise tes tâches', 'Garde la main', 'Continuer']) expect(screen.getByText(t)).toBeTruthy()
  })
  it('does not borrow another product\u2019s sentences and does not promise a duration', () => {
    const all = JSON.stringify(WELCOME_TEXT)
    expect(all).not.toMatch(/OpenClaw|minutes?|living on/i)
  })
  describe('fit: it steps down instead of scrolling', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())
    it('drops the note, then the sentence under the title, then the row texts, as the room gets smaller', async () => {
      await render(<WelcomeScreen onContinue={jest.fn()} lang="en" />)
      const tooTall = async () => { await fireEvent(scroll(), 'contentSizeChange', 300, 1200); await later(70) }
      await fireEvent(scroll(), 'layout', { nativeEvent: { layout: { height: 500 } } })
      expect(screen.queryByText(WELCOME_TEXT.en.note)).toBeTruthy()
      await tooTall()                                   // tier 1: smaller, everything still there
      expect(screen.queryByText(WELCOME_TEXT.en.note)).toBeTruthy()
      await tooTall()                                   // tier 2: the note goes
      expect(screen.queryByText(WELCOME_TEXT.en.note)).toBeNull(); expect(screen.queryByText(WELCOME_TEXT.en.sub)).toBeTruthy()
      await tooTall()                                   // tier 3: the sentence under the title goes
      expect(screen.queryByText(WELCOME_TEXT.en.sub)).toBeNull(); expect(screen.queryByText(WELCOME_TEXT.en.rows[0].text)).toBeTruthy()
      await tooTall()                                   // tier 4: the rows keep only their titles
      expect(screen.queryByText(WELCOME_TEXT.en.rows[0].text)).toBeNull(); expect(screen.getByText(WELCOME_TEXT.en.rows[0].title)).toBeTruthy()
      expect(screen.getByTestId('welcome-continue')).toBeTruthy() // the button never goes
    })
    it('shows everything when the content fits', async () => {
      await render(<WelcomeScreen onContinue={jest.fn()} lang="en" />)
      await fireEvent(scroll(), 'layout', { nativeEvent: { layout: { height: 700 } } })
      await fireEvent(scroll(), 'contentSizeChange', 300, 600); await later(300)
      expect(screen.queryByText(WELCOME_TEXT.en.note)).toBeTruthy(); expect(screen.queryByText(WELCOME_TEXT.en.rows[2].text)).toBeTruthy()
    })
  })
})
