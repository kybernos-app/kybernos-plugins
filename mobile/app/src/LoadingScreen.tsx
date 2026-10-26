import { useEffect, useRef, useState } from 'react'
import { Animated, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { BrandMark } from './BrandMark'
import { useFit } from './fit'
import { Lang, deviceLang } from './i18n'
import type { BootState } from './supervisor'
import { C, T } from './ui'

/** What the person reads while the engine starts, in plain words. The engine's own diagnostics (status line, probe errors, the log) are still there for support, behind « Details »;
 *  a start that is slow or failed says so in a sentence and offers the log. The engine cannot be restarted inside a running app, so there is no « Try again »: a stopped one needs the app closed and opened. */
export const LOADING_TEXT: Record<Lang, {
  first: string; firstSub: string; preparing: string; starting: string; slow: string; slowSub: string; failed: string; failedSub: string
  share: string; details: string; hide: string; showLog: string; settings: string
}> = {
  en: {
    first: 'Getting Kybernos ready', firstSub: 'This only happens the first time. Please keep the app open.', preparing: 'Preparing',
    starting: 'Starting Kybernos\u2026', slow: 'Still starting\u2026', slowSub: 'This is taking longer than usual. It can be slow on an older phone. You can wait, or share the log with us.',
    failed: 'Kybernos could not start', failedSub: 'Something stopped it. Close the app and open it again. If it keeps happening, share the log with us.',
    share: 'Share the log', details: 'Details', hide: 'Hide details', showLog: 'Show log', settings: 'Settings',
  },
  fr: {
    first: 'Préparation de Kybernos', firstSub: 'Ça n\u2019arrive qu\u2019au premier lancement. Garde l\u2019app ouverte.', preparing: 'Préparation',
    starting: 'Démarrage de Kybernos\u2026', slow: 'Toujours en cours\u2026', slowSub: 'C\u2019est plus long que d\u2019habitude. Ça peut être lent sur un ancien téléphone. Tu peux attendre, ou partager le journal avec nous.',
    failed: 'Kybernos n\u2019a pas pu démarrer', failedSub: 'Quelque chose l\u2019en a empêché. Ferme l\u2019app et rouvre-la. Si ça continue, partage le journal avec nous.',
    share: 'Partager le journal', details: 'Détails', hide: 'Masquer les détails', showLog: 'Afficher le journal', settings: 'Réglages',
  },
}

/** After this many seconds without a ready engine the screen says it is slow. */
export const SLOW_AFTER_S = 30

export interface LoadingScreenProps {
  state: BootState
  /** Seconds since the start began. */
  elapsedS: number
  /** The engine's one-block diagnostics (src/bootlog.ts); shown only behind « Details ». */
  diagnostics: string
  onShowLog: () => void
  onSettings: () => void
  onShareLog: () => void
  lang?: Lang
}

function IndeterminateBar() {
  const x = useRef(new Animated.Value(0)).current
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1400, useNativeDriver: false }))
    loop.start()
    return () => loop.stop()
  }, [x])
  return (
    <View style={s.track} accessibilityRole="progressbar">
      <Animated.View style={[s.bar, { position: 'absolute', width: '35%', left: x.interpolate({ inputRange: [0, 1], outputRange: ['-35%', '100%'] }) }]} />
    </View>
  )
}

/** Three tiers: 0 everything; 1 smaller logo and margins; 2 the sentence under the title goes (the title and the buttons stay). */
export function LoadingScreen({ state, elapsedS, diagnostics, onShowLog, onSettings, onShareLog, lang }: LoadingScreenProps) {
  const x = LOADING_TEXT[lang ?? deviceLang()]
  const [open, setOpen] = useState(false)
  const failed = state.phase === 'failed'
  const first = state.phase === 'copying' || state.phase === 'unpacking'
  const slow = !failed && !first && elapsedS >= SLOW_AFTER_S
  const fit = useFit(2, [open, failed, slow, first])
  const pct = first && state.total > 0 ? Math.round((state.done / state.total) * 100) : 0
  const title = failed ? x.failed : slow ? x.slow : first ? x.first : x.starting
  const sub = failed ? x.failedSub : slow ? x.slowSub : first ? x.firstSub : ''
  return (
    <View style={s.page} testID="loading-screen">
      <ScrollView testID="loading-scroll" onLayout={fit.onLayout} onContentSizeChange={fit.onContentSizeChange} bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[s.body, fit.tier >= 1 && { gap: 10, paddingVertical: 14 }]}>
        <View style={s.mark}><BrandMark height={fit.tier >= 1 ? 52 : 72} /></View>
        <T testID="boot-status" style={[s.title, failed && { color: C.danger }]} accessibilityRole="header">{title}</T>
        {sub !== '' && fit.tier < 2 && <T style={s.sub}>{sub}</T>}
        {first ? (
          <>
            <View style={s.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: pct }}><View style={[s.bar, { width: `${pct}%` }]} /></View>
            <T style={s.pct}>{x.preparing + ' ' + pct + ' %'}</T>
          </>
        ) : !failed && <IndeterminateBar />}
      </ScrollView>
      <View style={s.foot}>
        {(slow || failed) && <Pressable testID="share-log-boot" accessibilityRole="button" style={s.button} onPress={onShareLog}><T style={s.buttonText}>{x.share}</T></Pressable>}
        {open && (
          <View style={s.sheet}>
            {diagnostics !== '' && <T testID="boot-log" accessibilityLabel={diagnostics} style={s.diag}>{diagnostics}</T>}
            <Pressable testID="show-log" onPress={onShowLog}><T style={s.link}>{x.showLog}</T></Pressable>
            <Pressable testID="boot-settings" onPress={onSettings}><T style={s.link}>{x.settings}</T></Pressable>
          </View>
        )}
        <Pressable testID="boot-details" accessibilityRole="button" onPress={() => setOpen((o) => !o)}><T style={s.link}>{open ? x.hide : x.details}</T></Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  body: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24, gap: 14 },
  mark: { alignItems: 'center' },
  title: { color: C.fg, fontSize: 24, fontWeight: '600', textAlign: 'center', lineHeight: 30 },
  sub: { color: C.note, fontSize: 16, lineHeight: 23, textAlign: 'center' },
  pct: { color: C.note, fontSize: 14, textAlign: 'center' },
  track: { height: 4, backgroundColor: C.track, borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, backgroundColor: C.fg },
  foot: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 12, gap: 6 },
  button: { backgroundColor: C.button, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  buttonText: { color: C.fg, fontSize: 16 },
  sheet: { backgroundColor: C.card, borderRadius: 12, padding: 12, gap: 4 },
  diag: { color: C.diag, fontSize: 11, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  link: { color: C.link, fontSize: 16, textAlign: 'center', padding: 8 },
})
