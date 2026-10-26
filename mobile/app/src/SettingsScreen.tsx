import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import type { Settings } from './settings'

export interface SettingsScreenProps {
  settings: Settings
  /** The engine is already running: a withdrawn agreement only takes effect at the next launch. */
  engineRunning: boolean
  onClose: () => void
  onShareLog: () => void
  /** Which phone this is: the Background section is different (Android keeps the engine running, iOS can only remind). */
  platform?: 'ios' | 'android'
  /** Applies a Background switch (permission, native start or stop, saving it). `ok: false` puts the switch back; `message` is shown either way. */
  onBackgroundChange?: (kind: 'keepRunning' | 'reminders', on: boolean) => Promise<{ ok: boolean; message?: string }>
  /** Told when the person withdraws their agreement to send what they write to the AI provider. */
  onConsentWithdrawn?: () => void
}

export function SettingsScreen({ settings, engineRunning, onClose, onShareLog, platform, onBackgroundChange, onConsentWithdrawn }: SettingsScreenProps) {
  const [message, setMessage] = useState<string | null>(null)
  const [keepRunning, setKeepRunning] = useState(false)
  const [reminders, setReminders] = useState(false)
  useEffect(() => { void settings.keepRunning().then(setKeepRunning); void settings.reminders().then(setReminders) }, [settings])
  const flip = async (kind: 'keepRunning' | 'reminders', on: boolean) => {
    const set = kind === 'keepRunning' ? setKeepRunning : setReminders
    set(on)
    const r = onBackgroundChange === undefined ? { ok: true } : await onBackgroundChange(kind, on)
    if (!r.ok) set(!on)
    if (r.message !== undefined) setMessage(r.message)
  }

  const [agreed, setAgreed] = useState(false)
  useEffect(() => { void settings.consented().then(setAgreed) }, [settings])
  const withdraw = async () => {
    await settings.withdrawConsent(); setAgreed(false); onConsentWithdrawn?.()
    setMessage(engineRunning ? 'Withdrawn. Close the app completely: Kybernos asks again the next time you open it, and sends nothing until you agree.' : 'Withdrawn. Kybernos asks again the next time you open it.')
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Settings</Text>
        {message !== null && <Text testID="settings-message" style={styles.message}>{message}</Text>}
        {platform === 'android' && (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>Keep running in the background</Text>
              <Text style={styles.note}>Lets your automations run while the app is closed to the home screen. A notification stays visible while this is on, and the battery is used a little more.</Text>
            </View>
            <Switch testID="switch-keep-running" value={keepRunning} onValueChange={(v) => void flip('keepRunning', v)} />
          </View>
        )}
        {platform === 'ios' && (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>Remind me when an automation is due</Text>
              <Text style={styles.note}>The iPhone cannot run an automation while the app is closed. A notification tells you when one is due: open the app and it runs.</Text>
            </View>
            <Switch testID="switch-reminders" value={reminders} onValueChange={(v) => void flip('reminders', v)} />
          </View>
        )}
        {agreed && (
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Text style={styles.label}>Sending to your AI provider</Text>
              <Text style={styles.note}>You agreed that what you write goes to the provider you set up. You can withdraw that here.</Text>
            </View>
            <Pressable testID="consent-withdraw" style={styles.button} onPress={withdraw}><Text style={styles.buttonText}>Withdraw</Text></Pressable>
          </View>
        )}
        <Pressable testID="share-log" style={styles.link} onPress={onShareLog}><Text style={styles.linkText}>Share the engine log</Text></Pressable>
        <Pressable testID="settings-close" style={styles.link} onPress={onClose}><Text style={styles.linkText}>Done</Text></Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#121217' },
  body: { padding: 24, gap: 12 },
  title: { color: '#fff', fontSize: 24, fontWeight: '600' },
  label: { color: '#fff', fontSize: 15, marginTop: 8 },
  button: { backgroundColor: '#2a2a35', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  buttonText: { color: '#fff', fontSize: 15 },
  message: { color: '#8ab4ff', fontSize: 14 },
  note: { color: '#9aa0aa', fontSize: 13 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  switchText: { flex: 1, gap: 4 },
  link: { paddingVertical: 8 },
  linkText: { color: '#8ab4ff', fontSize: 16 },
})
