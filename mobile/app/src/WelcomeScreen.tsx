import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { BrandMark } from './BrandMark'
import { useFit } from './fit'
import { Lang, deviceLang } from './i18n'
import { C, T } from './ui'

/** The first page of a first launch: what Kybernos is for, in words about the result. Nothing starts here (the engine waits for the next page, the agreement). Written for the phone, in English and French. */
export const WELCOME_TEXT: Record<Lang, { title: string; sub: string; rows: Array<{ title: string; text: string }>; note: string; next: string }> = {
  en: {
    title: 'Be more productive',
    sub: 'Kybernos puts AI assistants to work on your tasks, right from your phone.',
    rows: [
      { title: 'Get more things done', text: 'Describe what you need. An assistant does the work and brings you the result.' },
      { title: 'Automate your tasks', text: 'Schedule a task once and let Kybernos handle it. You get a notification when it is time.' },
      { title: 'Stay in control', text: 'Assistants ask before they do something that matters. You decide what they can reach.' },
    ],
    note: 'You decide what each assistant may do. Check what it asks before you accept.',
    next: 'Continue',
  },
  fr: {
    title: 'Gagne en productivité',
    sub: 'Kybernos met des assistants IA au travail sur tes tâches, depuis ton téléphone.',
    rows: [
      { title: 'Fais avancer plus de choses', text: 'Décris ce dont tu as besoin. Un assistant fait le travail et t\u2019apporte le résultat.' },
      { title: 'Automatise tes tâches', text: 'Programme une tâche une fois et laisse Kybernos s\u2019en occuper. Tu reçois une notification au bon moment.' },
      { title: 'Garde la main', text: 'Les assistants demandent avant de faire quelque chose d\u2019important. Tu décides de ce qu\u2019ils peuvent toucher.' },
    ],
    note: 'Tu décides de ce que chaque assistant peut faire. Vérifie ce qu\u2019il demande avant d\u2019accepter.',
    next: 'Continuer',
  },
}

// Three flat two-tone pictures (a star, a clock, a shield), drawn in the app's own colours.
function Glyph({ kind, size }: { kind: 0 | 1 | 2; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {kind === 0 && <><Path fill={C.blue} d="M10.5 2.5c.7 5 3 7.3 8 8-5 .7-7.3 3-8 8-.7-5-3-7.3-8-8 5-.7 7.3-3 8-8z" /><Path fill="#cfe0ff" d="M19 15c.35 2.2 1.3 3.15 3.5 3.5-2.2.35-3.15 1.3-3.5 3.5-.35-2.2-1.3-3.15-3.5-3.5 2.2-.35 3.15-1.3 3.5-3.5z" /></>}
      {kind === 1 && <><Circle cx={12} cy={12} r={9.5} fill={C.amber} /><Path d="M12 6.8V12l3.4 2.1" fill="none" stroke={C.bg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></>}
      {kind === 2 && <><Path fill={C.mint} d="M12 2.5l7.6 2.9v5.7c0 4.7-3.2 8.4-7.6 10.4-4.4-2-7.6-5.7-7.6-10.4V5.4z" /><Path d="M8.4 12.1l2.5 2.5 4.7-4.9" fill="none" stroke={C.bg} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></>}
    </Svg>
  )
}
const TINT = [C.blueTint, C.amberTint, C.mintTint]

export interface WelcomeScreenProps {
  onContinue: () => void
  lang?: Lang
}

/** Five tiers: 0 everything; 1 smaller logo, margins and type; 2 the note goes; 3 the sentence under the title goes; 4 the rows keep only their titles. */
export function WelcomeScreen({ onContinue, lang }: WelcomeScreenProps) {
  const x = WELCOME_TEXT[lang ?? deviceLang()]
  const fit = useFit(4)
  const tight = fit.tier >= 1
  return (
    <View style={s.page} testID="welcome-screen">
      <ScrollView testID="welcome-scroll" onLayout={fit.onLayout} onContentSizeChange={fit.onContentSizeChange} bounces={false} showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.body, tight && s.bodyTight, fit.tier >= 3 && { gap: 8 }]}>
        <View style={s.mark}><BrandMark height={fit.tier >= 3 ? 36 : tight ? 44 : 56} /></View>
        <T style={[s.title, tight && s.titleTight]} accessibilityRole="header">{x.title}</T>
        {fit.tier < 3 && <T style={[s.sub, tight && s.textTight]}>{x.sub}</T>}
        <View style={s.rows}>
          {x.rows.map((r, i) => (
            <View key={r.title} style={[s.row, tight && s.rowTight]}>
              <View style={[s.tile, tight && s.tileTight, { backgroundColor: TINT[i] }]}><Glyph kind={i as 0 | 1 | 2} size={tight ? 20 : 24} /></View>
              <View style={s.rowText}>
                <T style={[s.rowTitle, tight && s.rowTitleTight]}>{r.title}</T>
                {fit.tier < 4 && <T style={[s.rowSub, tight && s.rowSubTight]}>{r.text}</T>}
              </View>
            </View>
          ))}
        </View>
        {fit.tier < 2 && <T style={s.note}>{x.note}</T>}
      </ScrollView>
      <View style={[s.foot, tight && s.footTight]}>
        <View testID="page-dots" style={s.dots}><View style={[s.dot, s.dotOn]} /><View style={s.dot} /></View>
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
  textTight: { fontSize: 15, lineHeight: 21 },
  rows: { gap: 10 },
  row: { flexDirection: 'row', gap: 14, backgroundColor: C.card, borderRadius: 12, padding: 14 },
  rowTight: { gap: 12, padding: 10 },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileTight: { width: 34, height: 34, borderRadius: 10 },
  rowText: { flex: 1 },
  rowTitle: { color: C.fg, fontSize: 16, fontWeight: '600', marginBottom: 2 },
  rowTitleTight: { fontSize: 15 },
  rowSub: { color: C.note, fontSize: 14, lineHeight: 20 },
  rowSubTight: { fontSize: 13, lineHeight: 18 },
  note: { color: C.note, fontSize: 14, lineHeight: 20 },
  foot: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 8 },
  footTight: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, gap: 6 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.track },
  dotOn: { backgroundColor: C.fg },
  primary: { backgroundColor: C.fg, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  primaryTight: { paddingVertical: 10, paddingHorizontal: 16 },
  primaryText: { color: C.onPrimary, fontSize: 16, fontWeight: '600' },
})
