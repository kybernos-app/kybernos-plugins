import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { BrandMark } from './BrandMark'
import { useFit } from './fit'
import { Lang, deviceLang } from './i18n'
import { C, T } from './ui'

/** The first page of a first launch: one sentence about the result and one button. Nothing starts here (the engine waits for the next page, the agreement). Written for the phone, in English and French. */
export const WELCOME_TEXT: Record<Lang, { title: string; sub: string; next: string }> = {
  en: {
    title: 'Assistants that do the work for you',
    sub: 'Say what you need. Kybernos takes care of it.',
    next: 'Get started',
  },
  fr: {
    title: 'Des assistants qui font le travail pour toi',
    sub: 'Dis ce dont tu as besoin. Kybernos s’en occupe.',
    next: 'Commencer',
  },
}

export interface WelcomeScreenProps {
  onContinue: () => void
  lang?: Lang
}

/** Three tiers: 0 everything; 1 smaller logo, margins and type; 2 the sentence under the title goes. The title and the button never go. */
export function WelcomeScreen({ onContinue, lang }: WelcomeScreenProps) {
  const x = WELCOME_TEXT[lang ?? deviceLang()]
  const fit = useFit(2)
  const tight = fit.tier >= 1
  return (
    <View style={s.page} testID="welcome-screen">
      <ScrollView testID="welcome-scroll" onLayout={fit.onLayout} onContentSizeChange={fit.onContentSizeChange} bounces={false} showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.body, tight && s.bodyTight]}>
        <View style={s.mark}><BrandMark height={tight ? 48 : 64} /></View>
        <T style={[s.title, tight && s.titleTight]} accessibilityRole="header">{x.title}</T>
        {fit.tier < 2 && <T style={[s.sub, tight && s.subTight]}>{x.sub}</T>}
      </ScrollView>
      <View style={[s.foot, tight && s.footTight]}>
        <Pressable testID="welcome-continue" accessibilityRole="button" style={[s.primary, tight && s.primaryTight]} onPress={onContinue}><T style={s.primaryText}>{x.next}</T></Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  body: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24, gap: 14 },
  bodyTight: { paddingHorizontal: 20, paddingVertical: 14, gap: 10 },
  mark: { alignItems: 'center' },
  title: { color: C.fg, fontSize: 28, fontWeight: '600', textAlign: 'center', lineHeight: 34 },
  titleTight: { fontSize: 24, lineHeight: 30 },
  sub: { color: C.note, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  subTight: { fontSize: 15, lineHeight: 21 },
  foot: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16 },
  footTight: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  primary: { backgroundColor: C.fg, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  primaryTight: { paddingVertical: 10, paddingHorizontal: 16 },
  primaryText: { color: C.onPrimary, fontSize: 16, fontWeight: '600' },
})
