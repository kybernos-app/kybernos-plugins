import { useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Linking, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { host } from './modules/kybernos-host/src'
import { bootDiagnosticsText } from './src/bootlog'
import { redact } from './src/redact'
import { runSelfTest } from './src/selftest'
import { deviceStorage } from './src/secureStorage'
import { createSettings } from './src/settings'
import { decideLink, WEBVIEW_ORIGINS } from './src/links'
import { fetchTasks, planReminders } from './src/reminders'
import { isAppEntryMessage } from './src/webMessage'
import { SettingsScreen } from './src/SettingsScreen'
import { BootState, baseOf, createSupervisor } from './src/supervisor'

const UA = `KybernosHost/0.1.0 (${Platform.OS})`

export default function App() {
  const supervisor = useMemo(() => (host ? createSupervisor({ host, fetch: fetch as any, port: 0 }) : null), [])
  const [state, setState] = useState<BootState>(supervisor?.state ?? { phase: 'failed', message: 'The native half of the app is missing in this build.' })
  const [showLog, setShowLog] = useState(false)
  const [log, setLog] = useState('')
  const [selfTest, setSelfTest] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState('')
  const settings = useMemo(() => createSettings(deviceStorage), [])
  const [showSettings, setShowSettings] = useState(false)
  const [firstRun, setFirstRun] = useState(false)
  const [keyStored, setKeyStored] = useState(false)
  const [webEntry, setWebEntry] = useState(false) // the interface says it has its own entry to the settings: the fallback gear goes
  const keyStoredRef = useRef(false)
  const started = useRef(false)
  const noteKey = (stored: boolean) => { keyStoredRef.current = stored; setKeyStored(stored) }

  useEffect(() => {
    if (!supervisor || started.current) return
    started.current = true
    const off = supervisor.subscribe(setState)
    // the model key comes out of the Keychain / Keystore here and goes to the engine's environment: it is never written to a file
    void settings.engineEnv().then((env) => { noteKey(Object.keys(env).length > 0); supervisor.begin(env) })
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void supervisor.healthCheck().then((ok) => console.log('kybernos: server answers after foreground: ' + ok)) })
    return () => { off(); sub.remove(); supervisor.stop() }
  }, [supervisor])

  // while the engine is not ready the screen says what it is doing: a start that hangs must show where
  useEffect(() => {
    if (!supervisor || !host || state.phase === 'ready') return
    const t0 = Date.now()
    const tick = () => setDiagnostics(bootDiagnosticsText(supervisor.diagnostics(), host!.logTail(4096), Math.round((Date.now() - t0) / 1000)))
    tick()
    const id = setInterval(tick, 2000)
    return () => clearInterval(id)
  }, [supervisor, state.phase === 'ready'])

  useEffect(() => {
    if (state.phase !== 'ready' || !host || host.selfTestDelay === null) return
    const t = runSelfTest(state.url, host.selfTestDelay, { fetch: fetch as any, now: () => new Date(), show: setSelfTest, writeResult: (j) => host!.writeSelfTestResult(j), hasKey: host.selfTestHasKey || keyStoredRef.current, memory: () => host!.memory() })
    return t.stop
  }, [state.phase === 'ready' ? state.url : null])

  // first launch without a key: offer the key screen once (never in a device-cloud self-test build, which must not wait for a person)
  useEffect(() => {
    if (state.phase !== 'ready' || !host || host.selfTestDelay !== null) return
    void settings.promptDone().then((done) => { if (!done && !keyStoredRef.current) { setFirstRun(true); setShowSettings(true) } })
  }, [state.phase === 'ready'])

  // Background section of the settings. Android: a foreground service keeps the engine's process alive (the person is told by a notification). iOS: nothing can run while the app is suspended,
  // so a reminder says when an automation is due.
  const refreshReminders = async (url: string) => {
    if (!host?.setReminders) return
    const base = baseOf(url)
    const tasks = base === null ? null : await fetchTasks(base, fetch as any)
    if (tasks !== null) await host.setReminders(planReminders(tasks, Date.now()))
  }
  const changeBackground = async (kind: 'keepRunning' | 'reminders', on: boolean): Promise<{ ok: boolean; message?: string }> => {
    if (!host) return { ok: false }
    if (kind === 'keepRunning') {
      let message: string | undefined
      if (on && Platform.OS === 'android' && Number(Platform.Version) >= 33) {
        const asked = await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS')
        if (asked !== PermissionsAndroid.RESULTS.GRANTED) message = 'Notifications are refused for this app, so the notice is hidden; the engine still keeps running.'
      }
      if (on) host.startKeepAlive?.(); else host.stopKeepAlive?.()
      await settings.setKeepRunning(on)
      return { ok: true, message }
    }
    if (on && !(await host.requestReminderPermission?.())) return { ok: false, message: 'Notifications are refused for this app: allow them in the iPhone settings, then try again.' }
    await settings.setReminders(on)
    if (!on) await host.setReminders?.([])
    else if (state.phase === 'ready') await refreshReminders(state.url)
    return { ok: true }
  }

  // Links from the system (kybernos://settings from a notification, a shortcut, a test): the same two screens the web interface can open
  useEffect(() => {
    const open = (url: string | null | undefined) => {
      if (url === null || url === undefined) return
      const a = decideLink(url)
      if (a.kind === 'app') { if (a.screen === 'settings') setShowSettings(true); else openLog() }
    }
    void Linking.getInitialURL().then(open).catch(() => undefined)
    const sub = Linking.addEventListener('url', (e) => open(e.url))
    return () => sub.remove()
  }, [])

  // Android: start the background service at launch when the person switched it on (it can only be started while the app is in front, which it is here)
  useEffect(() => {
    if (Platform.OS !== 'android' || !host?.startKeepAlive) return
    void settings.keepRunning().then((on) => { if (on || host!.keepAliveRequested === true) host!.startKeepAlive!() })
  }, [settings])

  // iOS: sign in once (so the task list can be read), plan the reminders when the app leaves the screen, drop them when it comes back (the engine catches up and runs what is due)
  useEffect(() => {
    if (Platform.OS !== 'ios' || state.phase !== 'ready' || !host?.setReminders) return
    const url = state.url
    void fetch(url).catch(() => undefined)
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background') void settings.reminders().then((on) => { if (on) void refreshReminders(url) })
      else if (s === 'active') void host!.setReminders!([])
    })
    return () => sub.remove()
  }, [state.phase === 'ready' ? state.url : null])

  const openLog = () => { setLog(redact(host?.logTail(20000) ?? '')); setShowLog(true) }
  const shareLog = () => { void Share.share({ title: 'Kybernos engine log', message: redact(host?.logTail(60000) ?? '') }) }
  const closeSettings = () => { setShowSettings(false); if (firstRun) { setFirstRun(false); void settings.markPromptDone() } }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {state.phase === 'ready' ? (
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          <WebView
            source={{ uri: state.url }}
            style={styles.fill}
            applicationNameForUserAgent={UA}
            onMessage={(e) => { if (isAppEntryMessage(e.nativeEvent.data)) setWebEntry(true) }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            webviewDebuggingEnabled
            originWhitelist={WEBVIEW_ORIGINS}
            onShouldStartLoadWithRequest={(r) => {
              const action = decideLink(r.url)
              if (action.kind === 'allow') return true
              console.log('kybernos: web view asked to open a ' + (r.url.split(':')[0] || '?') + ' link' + (action.kind === 'app' ? ' (' + action.screen + ')' : ''))
              if (action.kind === 'app') { if (action.screen === 'settings') setShowSettings(true); else openLog() } else void Linking.openURL(action.url)
              return false
            }}
          />
          {!webEntry && <Gear onPress={() => setShowSettings(true)} />}
          {selfTest !== null && <Text testID="selftest" accessibilityLabel={selfTest} style={styles.selfTest}>{selfTest}</Text>}
        </SafeAreaView>
      ) : (
        <View style={styles.boot}>
          <Text testID="boot-status" style={styles.status}>{describe(state)}</Text>
          {(state.phase === 'unpacking' || state.phase === 'copying') && <View style={styles.track}><View style={[styles.bar, { width: `${state.total > 0 ? Math.round((state.done / state.total) * 100) : 0}%` }]} /></View>}
          {diagnostics !== '' && <Text testID="boot-log" accessibilityLabel={diagnostics} style={styles.diagnostics}>{diagnostics}</Text>}
          <Pressable testID="show-log" onPress={openLog}><Text style={styles.link}>Show log</Text></Pressable>
          <Pressable testID="boot-settings" onPress={() => setShowSettings(true)}><Text style={styles.link}>Settings</Text></Pressable>
        </View>
      )}
      {/* a Modal is its own window: it needs its own safe-area provider or its content slides under the status bar */}
      <Modal visible={showSettings} animationType="slide" onRequestClose={closeSettings}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.fill}>
            <SettingsScreen settings={settings} engineRunning={state.phase !== 'failed'} firstRun={firstRun} onClose={closeSettings} onShareLog={shareLog} onKeyChanged={noteKey} platform={Platform.OS === 'android' ? 'android' : 'ios'} onBackgroundChange={changeBackground} />
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
      <Modal visible={showLog} animationType="slide" onRequestClose={() => setShowLog(false)}>
        <SafeAreaProvider>
          <SafeAreaView style={styles.logPage}>
            <ScrollView><Text style={styles.logText} selectable>{log}</Text></ScrollView>
            <Pressable onPress={() => setShowLog(false)}><Text style={styles.link}>Done</Text></Pressable>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaProvider>
  )
}

/** The button that opens the settings over the web interface (the interface can also open them with a kybernos://settings link). It sits above the home indicator, not across it. */
function Gear({ onPress }: { onPress: () => void }) {
  const insets = useSafeAreaInsets()
  return <Pressable testID="open-settings" accessibilityLabel="Settings" style={[styles.gear, { bottom: insets.bottom + 16 }]} onPress={onPress}><Text style={styles.gearText}>⚙</Text></Pressable>
}

const describe = (s: BootState): string => {
  switch (s.phase) {
    case 'starting': return 'Starting Kybernos…'
    case 'copying': return `First launch: copying the runtime out of the app (${s.done} of ${s.total} files)`
    case 'unpacking': return `First launch: preparing the runtime (${s.done} of ${s.total} files)`
    case 'booting': return 'Starting the engine…'
    case 'ready': return 'Ready'
    case 'failed': return s.message
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#121217' },
  boot: { flex: 1, backgroundColor: '#121217', alignItems: 'stretch', justifyContent: 'center', padding: 24, gap: 16 },
  status: { color: '#fff', fontSize: 17, textAlign: 'center' },
  track: { height: 4, backgroundColor: '#333', borderRadius: 2, overflow: 'hidden' },
  bar: { height: 4, backgroundColor: '#fff' },
  diagnostics: { color: '#8a8a95', fontSize: 10, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
  link: { color: '#8ab4ff', fontSize: 16, textAlign: 'center', padding: 8 },
  logPage: { flex: 1, backgroundColor: '#fff', padding: 12 },
  logText: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 11 },
  gear: { position: 'absolute', right: 12, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(18,18,23,0.55)', alignItems: 'center', justifyContent: 'center' },
  gearText: { color: '#fff', fontSize: 18 },
  selfTest: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.7)', fontSize: 9, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
})
