import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useFit } from './fit'
import { Lang, deviceLang } from './i18n'
import { C, T } from './ui'

/** Shown once, before the engine starts: Kybernos sends what the person writes to the company that runs the AI model, and the stores want that said plainly and agreed to first (Apple 5.1.2(i)).
 *  Nothing is sent before the button is pressed: the engine is not even started. The text is versioned (`CONSENT_VERSION`): change it materially and bump the version so everyone is asked again.
 *  It does not push one provider: it names the two ways the answer is made (a Kybernos account, or the provider whose key the person adds). A DRAFT: the wording is to be read by a lawyer. */
export const CONSENT_TEXT: Record<Lang, { title: string; lines: string[]; declined: string; agree: string; decline: string; privacy: string }> = {
  en: {
    title: 'Before you start',
    lines: [
      'Kybernos answers with an AI model. What you write, and the files or web pages an assistant reads to do a task, are sent to the company that runs the model: Kybernos and its model providers when you use a Kybernos account, or the provider whose key you add.',
      'With your own key, they go straight from this phone to that provider. With a Kybernos account, they go through Kybernos to the model. Either way, the provider\u2019s terms and privacy policy apply.',
      'AI answers can be wrong or inappropriate. Check what matters before you rely on it.',
    ],
    declined: 'Kybernos cannot answer without sending your messages to a provider, so it stays closed until you agree. You can change your mind at any time.',
    agree: 'I agree',
    decline: 'Not now',
    privacy: 'Read the privacy policy',
  },
  fr: {
    title: 'Avant de commencer',
    lines: [
      'Kybernos répond grâce à un modèle d\u2019IA. Ce que tu écris, ainsi que les fichiers ou pages web qu\u2019un assistant lit pour faire une tâche, sont envoyés à l\u2019entreprise qui fait tourner le modèle : Kybernos et ses fournisseurs de modèles si tu as un compte Kybernos, ou le fournisseur dont tu ajoutes la clé.',
      'Avec ta propre clé, ils partent directement de ce téléphone vers ce fournisseur. Avec un compte Kybernos, ils passent par Kybernos jusqu\u2019au modèle. Dans les deux cas, les conditions et la politique de confidentialité du fournisseur s\u2019appliquent.',
      'Les réponses de l\u2019IA peuvent être fausses ou inadaptées. Vérifie ce qui compte avant de t\u2019y fier.',
    ],
    declined: 'Kybernos ne peut pas répondre sans envoyer tes messages à un fournisseur : il reste fermé tant que tu n\u2019as pas accepté. Tu peux changer d\u2019avis à tout moment.',
    agree: 'J\u2019accepte',
    decline: 'Pas maintenant',
    privacy: 'Lire la politique de confidentialité',
  },
}

export interface ConsentScreenProps {
  onAgree: () => void
  /** Where the privacy policy is published; the link is left out until there is an address. */
  privacyUrl?: string | null
  lang?: Lang
  /** Two dots under the text (« page 2 of 2 ») when the welcome page came just before. */
  dots?: boolean
}

/** Three tiers: 0 normal type; 1 and 2 smaller type and margins. The text itself is never cut. */
export function ConsentScreen({ onAgree, privacyUrl = null, lang, dots = false }: ConsentScreenProps) {
  const x = CONSENT_TEXT[lang ?? deviceLang()]
  const [declined, setDeclined] = useState(false)
  const fit = useFit(2, [declined])
  return (
    <View style={s.page}>
      <ScrollView testID="consent-scroll" onLayout={fit.onLayout} onContentSizeChange={fit.onContentSizeChange} bounces={false} showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.body, fit.tier >= 1 && s.bodyTight, fit.tier >= 2 && { gap: 8 }]}>
        <T style={s.title} accessibilityRole="header">{x.title}</T>
        {x.lines.map((l) => <T key={l} style={[s.text, fit.tier === 1 && s.text15, fit.tier >= 2 && s.text14]}>{l}</T>)}
        {privacyUrl !== null && <Pressable testID="consent-privacy" accessibilityRole="link" onPress={() => void Linking.openURL(privacyUrl)}><T style={s.link}>{x.privacy}</T></Pressable>}
        {declined && <T testID="consent-declined" style={s.note}>{x.declined}</T>}
      </ScrollView>
      <View style={s.foot}>
        {dots && <View testID="page-dots" style={s.dots}><View style={s.dot} /><View style={[s.dot, s.dotOn]} /></View>}
        <Pressable testID="consent-agree" accessibilityRole="button" style={[s.button, s.primary]} onPress={onAgree}><T style={[s.buttonText, s.primaryText]}>{x.agree}</T></Pressable>
        <Pressable testID="consent-decline" accessibilityRole="button" style={s.button} onPress={() => setDeclined(true)}><T style={s.buttonText}>{x.decline}</T></Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  body: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24, gap: 14 },
  bodyTight: { paddingHorizontal: 20, paddingVertical: 14, gap: 10 },
  title: { color: C.fg, fontSize: 26, fontWeight: '600', lineHeight: 32 },
  text: { color: C.text, fontSize: 16, lineHeight: 23 },
  text15: { fontSize: 15, lineHeight: 21 },
  text14: { fontSize: 14, lineHeight: 20 },
  note: { color: C.note, fontSize: 14 },
  link: { color: C.link, fontSize: 16 },
  foot: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.track },
  dotOn: { backgroundColor: C.fg },
  button: { backgroundColor: C.button, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, alignItems: 'center' },
  buttonText: { color: C.fg, fontSize: 16 },
  primary: { backgroundColor: C.fg },
  primaryText: { color: C.onPrimary, fontWeight: '600' },
})
