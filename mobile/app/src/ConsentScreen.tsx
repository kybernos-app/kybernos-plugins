import { useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'

/** Shown once, before the engine starts: Kybernos sends what the person writes to an AI provider, and the stores want that said plainly and agreed to first (Apple 5.1.2(i)). Nothing is sent
 *  before the button is pressed: the engine is not even started. The text is versioned (`CONSENT_VERSION`): change it materially and bump the version so everyone is asked again. */
export const CONSENT_LINES = [
  'Kybernos answers with an AI model. What you write, and the files or web pages an assistant reads to do a task, are sent to the AI provider you set up. By default that is Anthropic, with your own key.',
  'With your own key, they go straight from this phone to that provider, under the provider\'s own terms and privacy policy.',
  'AI answers can be wrong or inappropriate. Check what matters before you rely on it.',
]

export interface ConsentScreenProps {
  onAgree: () => void
  /** Where the privacy policy is published; the link is left out until there is an address. */
  privacyUrl?: string | null
}

export function ConsentScreen({ onAgree, privacyUrl = null }: ConsentScreenProps) {
  const [declined, setDeclined] = useState(false)
  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>Before you start</Text>
        {CONSENT_LINES.map((l) => <Text key={l} style={styles.text}>{l}</Text>)}
        {privacyUrl !== null && <Pressable testID="consent-privacy" onPress={() => void Linking.openURL(privacyUrl)}><Text style={styles.link}>Read the privacy policy</Text></Pressable>}
        {declined && <Text testID="consent-declined" style={styles.note}>Kybernos cannot answer without sending your messages to a provider, so it stays closed until you agree. You can change your mind at any time.</Text>}
        <View style={styles.row}>
          <Pressable testID="consent-agree" style={[styles.button, styles.primary]} onPress={onAgree}><Text style={[styles.buttonText, styles.primaryText]}>I agree</Text></Pressable>
          <Pressable testID="consent-decline" style={styles.button} onPress={() => setDeclined(true)}><Text style={styles.buttonText}>Not now</Text></Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#121217' },
  body: { padding: 24, gap: 14, flexGrow: 1, justifyContent: 'center' },
  title: { color: '#fff', fontSize: 26, fontWeight: '600' },
  text: { color: '#d6d8de', fontSize: 16, lineHeight: 23 },
  note: { color: '#9aa0aa', fontSize: 14 },
  link: { color: '#8ab4ff', fontSize: 16 },
  row: { flexDirection: 'row', gap: 10, marginTop: 8 },
  button: { backgroundColor: '#2a2a35', borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20 },
  buttonText: { color: '#fff', fontSize: 16 },
  primary: { backgroundColor: '#fff' },
  primaryText: { color: '#121217', fontWeight: '600' },
})
