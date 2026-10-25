import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import type { Settings } from './settings'

export interface SettingsScreenProps {
  settings: Settings
  /** The engine is already running: a changed key only reaches it at the next launch. */
  engineRunning: boolean
  /** First-run version of the screen: says why it is here and offers to skip. */
  firstRun?: boolean
  onClose: () => void
  onShareLog: () => void
  /** Told when the stored key changes (true: a key is stored now). */
  onKeyChanged?: (stored: boolean) => void
}

export function SettingsScreen({ settings, engineRunning, firstRun = false, onClose, onShareLog, onKeyChanged }: SettingsScreenProps) {
  const [hint, setHint] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => { void settings.keyHint().then(setHint) }, [settings])

  // reading the clipboard from code makes iOS ask for permission; if it answers with nothing, the field's own Paste menu (press and hold) always works
  const paste = async () => {
    try {
      const t = await Clipboard.getStringAsync()
      if (t === '') setMessage('Nothing to paste. Copy the key first, or press and hold the field and choose Paste.')
      else { setText(t); setMessage(null) }
    } catch { setMessage('The clipboard could not be read: press and hold the field and choose Paste.') }
  }
  const save = async () => {
    const r = await settings.save(text)
    if (!r.ok) { setMessage(r.reason); return }
    setText(''); setHint(await settings.keyHint()); onKeyChanged?.(true)
    setMessage(engineRunning ? 'Saved in the secure storage of this phone. Close the app completely and open it again to use it.' : 'Saved in the secure storage of this phone.')
  }
  const remove = async () => {
    await settings.remove(); setHint(null); onKeyChanged?.(false)
    setMessage(engineRunning ? 'Removed. Close the app completely and open it again for the engine to forget it.' : 'Removed.')
  }

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{firstRun ? 'Add your model key' : 'Settings'}</Text>
        {firstRun && <Text style={styles.note}>Kybernos answers with a model you pay for yourself. Paste your Anthropic key now, or skip and add it later from the gear button.</Text>}
        <Text style={styles.label}>Anthropic key</Text>
        <Text testID="key-status" style={styles.status}>{hint ? 'Stored in the secure storage of this phone (' + hint + ')' : 'No key stored'}</Text>
        <TextInput
          testID="key-input"
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="sk-ant-…"
          placeholderTextColor="#777"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="no"
        />
        <View style={styles.row}>
          <Pressable testID="key-paste" style={styles.button} onPress={paste}><Text style={styles.buttonText}>Paste</Text></Pressable>
          <Pressable testID="key-save" style={[styles.button, styles.primary]} onPress={save}><Text style={[styles.buttonText, styles.primaryText]}>Save</Text></Pressable>
          {hint !== null && <Pressable testID="key-remove" style={styles.button} onPress={remove}><Text style={styles.buttonText}>Remove</Text></Pressable>}
        </View>
        {message !== null && <Text testID="settings-message" style={styles.message}>{message}</Text>}
        <Text style={styles.note}>The key is kept in the iOS Keychain or the Android Keystore, never in a file, and is given to the engine only when it starts.</Text>
        <Pressable testID="share-log" style={styles.link} onPress={onShareLog}><Text style={styles.linkText}>Share the engine log</Text></Pressable>
        <Pressable testID="settings-close" style={styles.link} onPress={onClose}><Text style={styles.linkText}>{firstRun ? 'Skip for now' : 'Done'}</Text></Pressable>
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#121217' },
  body: { padding: 24, gap: 12 },
  title: { color: '#fff', fontSize: 24, fontWeight: '600' },
  label: { color: '#fff', fontSize: 15, marginTop: 8 },
  status: { color: '#9aa0aa', fontSize: 13 },
  input: { color: '#fff', backgroundColor: '#1d1d25', borderRadius: 8, padding: 12, fontSize: 15 },
  row: { flexDirection: 'row', gap: 10 },
  button: { backgroundColor: '#2a2a35', borderRadius: 8, paddingVertical: 10, paddingHorizontal: 16 },
  buttonText: { color: '#fff', fontSize: 15 },
  primary: { backgroundColor: '#fff' },
  primaryText: { color: '#121217', fontWeight: '600' },
  message: { color: '#8ab4ff', fontSize: 14 },
  note: { color: '#9aa0aa', fontSize: 13 },
  link: { paddingVertical: 8 },
  linkText: { color: '#8ab4ff', fontSize: 16 },
})
