import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native'
import { useFit } from './fit'
import { Lang, deviceLang } from './i18n'
import { C, T } from './ui'

/** Shown once, before the engine starts: Kybernos sends what the person writes to the company that runs the AI model, and the stores want that said plainly and agreed to first (Apple 5.1.2(i)).
 *  Nothing is sent before the button is pressed: the engine is not even started. The text is versioned (`CONSENT_VERSION`): change it materially and bump the version so everyone is asked again.
 *  It does not push one provider: it names the two ways the answer is made (a Kybernos account, or the provider whose key the person adds). Two short sentences, and the detail one tap away
 *  (« Who receives what? ») so that the page stays one question. A DRAFT: the wording is to be read by a lawyer. */
export const CONSENT_TEXT: Record<Lang, { title: string; lines: string[]; more: string; moreLink: string; hideLink: string; declined: string; agree: string; decline: string; privacy: string }> = {
  en: {
    title: 'Before you start',
    lines: [
      'Kybernos answers with an AI model. What you write, and what an assistant reads to do a task, is sent to Kybernos and its model providers, or straight to the provider whose key you add.',
      'Their terms and privacy policy apply. AI answers can be wrong: check what matters.',
    ],
    more: 'With your own key, your messages go straight from this phone to that provider. With a Kybernos account, they go through Kybernos to the model.',
    moreLink: 'Who receives what?',
    hideLink: 'Hide',
    declined: 'Kybernos cannot answer without sending your messages to a provider, so it stays closed until you agree. You can change your mind at any time.',
    agree: 'I agree',
    decline: 'Not now',
    privacy: 'Read the privacy policy',
  },
  fr: {
    title: 'Avant de commencer',
    lines: [
      'Kybernos répond grâce à un modèle d’IA. Ce que tu écris, et ce que l’assistant lit pour travailler, est envoyé à Kybernos et à ses fournisseurs de modèles, ou directement au fournisseur dont tu ajoutes la clé.',
      'Leurs conditions et leur politique de confidentialité s’appliquent. L’IA peut se tromper : vérifie ce qui compte.',
    ],
    more: 'Avec ta propre clé, tes messages partent directement de ce téléphone vers ce fournisseur. Avec un compte Kybernos, ils passent par Kybernos jusqu’au modèle.',
    moreLink: 'Qui reçoit quoi ?',
    hideLink: 'Masquer',
    declined: 'Kybernos ne peut pas répondre sans envoyer tes messages à un fournisseur : il reste fermé tant que tu n’as pas accepté. Tu peux changer d’avis à tout moment.',
    agree: 'J’accepte',
    decline: 'Pas maintenant',
    privacy: 'Lire la politique de confidentialité',
  },
}

export interface ConsentScreenProps {
  onAgree: () => void
  /** Where the privacy policy is published; the link is left out until there is an address. */
  privacyUrl?: string | null
  lang?: Lang
}

/** Three tiers: 0 normal type; 1 and 2 smaller type and margins. The text itself is never cut. */
export function ConsentScreen({ onAgree, privacyUrl = null, lang }: ConsentScreenProps) {
  const x = CONSENT_TEXT[lang ?? deviceLang()]
  const [declined, setDeclined] = useState(false)
  const [more, setMore] = useState(false)
  const fit = useFit(2, [declined, more])
  const size = [fit.tier === 1 && s.text15, fit.tier >= 2 && s.text14]
  return (
    <View style={s.page}>
      <ScrollView testID="consent-scroll" onLayout={fit.onLayout} onContentSizeChange={fit.onContentSizeChange} bounces={false} showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.body, fit.tier >= 1 && s.bodyTight, fit.tier >= 2 && { gap: 8 }]}>
        <T style={s.title} accessibilityRole="header">{x.title}</T>
        {x.lines.map((l) => <T key={l} style={[s.text, ...size]}>{l}</T>)}
        {more && <T testID="consent-more" style={[s.note, ...size]}>{x.more}</T>}
        <Pressable testID="consent-more-toggle" accessibilityRole="button" accessibilityState={{ expanded: more }} style={s.inline} onPress={() => setMore(!more)}><T style={s.link}>{more ? x.hideLink : x.moreLink}</T></Pressable>
        {privacyUrl !== null && <Pressable testID="consent-privacy" accessibilityRole="link" onPress={() => void Linking.openURL(privacyUrl)}><T style={s.link}>{x.privacy}</T></Pressable>}
        {declined && <T testID="consent-declined" style={s.note}>{x.declined}</T>}
      </ScrollView>
      <View style={s.foot}>
        <Pressable testID="consent-agree" accessibilityRole="button" style={s.primary} onPress={onAgree}><T style={s.primaryText}>{x.agree}</T></Pressable>
        <Pressable testID="consent-decline" accessibilityRole="button" style={s.quiet} onPress={() => setDeclined(true)}><T style={s.quietText}>{x.decline}</T></Pressable>
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
  note: { color: C.note, fontSize: 14, lineHeight: 20 },
  link: { color: C.link, fontSize: 16 },
  inline: { alignSelf: 'flex-start', paddingVertical: 4 },
  foot: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 16, gap: 6 },
  primary: { backgroundColor: C.fg, borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20 },
  primaryText: { color: C.onPrimary, fontSize: 16, fontWeight: '600', textAlign: 'center' },
  quiet: { paddingVertical: 8 },
  quietText: { color: C.note, fontSize: 15, textAlign: 'center' },
})
