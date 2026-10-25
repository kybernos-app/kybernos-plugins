import { useEffect, useMemo, useRef, useState } from 'react'
import { AppState, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { WebView } from 'react-native-webview'
import { host } from './modules/kybernos-host/src'
import { bootDiagnosticsText } from './src/bootlog'
import { redact } from './src/redact'
import { runSelfTest } from './src/selftest'
import { BootState, createSupervisor } from './src/supervisor'

const UA = `KybernosHost/0.1.0 (${Platform.OS})`
const LOCAL = /^(https?:\/\/127\.0\.0\.1[:/]|about:|blob:|data:)/

export default function App() {
  const supervisor = useMemo(() => (host ? createSupervisor({ host, fetch: fetch as any, port: 0 }) : null), [])
  const [state, setState] = useState<BootState>(supervisor?.state ?? { phase: 'failed', message: 'The native half of the app is missing in this build.' })
  const [showLog, setShowLog] = useState(false)
  const [log, setLog] = useState('')
  const [selfTest, setSelfTest] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (!supervisor || started.current) return
    started.current = true
    const off = supervisor.subscribe(setState)
    supervisor.begin()
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
    const t = runSelfTest(state.url, host.selfTestDelay, { fetch: fetch as any, now: () => new Date(), show: setSelfTest, writeResult: (j) => host!.writeSelfTestResult(j), hasKey: host.selfTestHasKey })
    return t.stop
  }, [state.phase === 'ready' ? state.url : null])

  const openLog = () => { setLog(redact(host?.logTail(20000) ?? '')); setShowLog(true) }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {state.phase === 'ready' ? (
        <SafeAreaView style={styles.fill} edges={['top', 'bottom']}>
          <WebView
            source={{ uri: state.url }}
            style={styles.fill}
            applicationNameForUserAgent={UA}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            webviewDebuggingEnabled
            onShouldStartLoadWithRequest={(r) => { if (LOCAL.test(r.url)) return true; void Linking.openURL(r.url); return false }}
          />
          {selfTest !== null && <Text testID="selftest" accessibilityLabel={selfTest} style={styles.selfTest}>{selfTest}</Text>}
        </SafeAreaView>
      ) : (
        <View style={styles.boot}>
          <Text testID="boot-status" style={styles.status}>{describe(state)}</Text>
          {(state.phase === 'unpacking' || state.phase === 'copying') && <View style={styles.track}><View style={[styles.bar, { width: `${state.total > 0 ? Math.round((state.done / state.total) * 100) : 0}%` }]} /></View>}
          {diagnostics !== '' && <Text testID="boot-log" accessibilityLabel={diagnostics} style={styles.diagnostics}>{diagnostics}</Text>}
          <Pressable testID="show-log" onPress={openLog}><Text style={styles.link}>Show log</Text></Pressable>
        </View>
      )}
      <Modal visible={showLog} animationType="slide" onRequestClose={() => setShowLog(false)}>
        <SafeAreaView style={styles.logPage}>
          <ScrollView><Text style={styles.logText} selectable>{log}</Text></ScrollView>
          <Pressable onPress={() => setShowLog(false)}><Text style={styles.link}>Done</Text></Pressable>
        </SafeAreaView>
      </Modal>
    </SafeAreaProvider>
  )
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
  selfTest: { color: '#fff', backgroundColor: 'rgba(0,0,0,0.7)', fontSize: 9, fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }) },
})
