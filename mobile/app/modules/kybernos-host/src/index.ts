import { requireOptionalNativeModule } from 'expo'

/** What the native half exposes. It is a thin surface on purpose: the state machine and the self-test are TypeScript (src/supervisor.ts, src/selftest.ts) and testable without a device. */
export interface KybernosHostNative {
  platform: 'ios' | 'android'
  /** Seconds until the self-test's one-off automation is due; null in a product build. */
  selfTestDelay: number | null
  /** Test switch (launch intent extra kb_keepalive=1 on Android): start the background service now. */
  keepAliveRequested?: boolean
  /** The self-test build carries a model key, so the automation can finish with a real answer. */
  selfTestHasKey: boolean
  /** Starts the engine (once per process) with extra environment variables (the model key from the device's secure storage). False when it already runs or the app lacks its payload. */
  start(port: number, env: Record<string, string>): boolean
  /** Progress the bootstrap writes: phase is 'none' until it has started. */
  status(): { phase: string; done: number; total: number }
  /** The exit code of Node, or null while it runs. A stopped Node stays stopped until the app is relaunched. */
  exitCode(): number | null
  logTail(maxBytes: number): string
  /** The process's memory in MB: its footprint (iOS: phys_footprint, what jetsam counts; Android: PSS), what the system says is still available to it, and the device total. */
  /** Android only: the optional foreground service that keeps the engine's process alive in the background. */
  startKeepAlive?(): void
  stopKeepAlive?(): void
  keepAliveRunning?(): boolean
  /** iOS only: asks the person's permission to show reminders; false when refused. */
  requestReminderPermission?(): Promise<boolean>
  /** iOS only: replaces every pending reminder by these ({ id, title, body, at: ms epoch }); returns how many were scheduled. */
  setReminders?(items: Array<{ id: string; title: string; body: string; at: number }>): Promise<number>
  memory(): { footprintMb: number; availableMb: number; totalMb: number }
  writeSelfTestResult(text: string): void
}

/** Null where the native half is missing (a platform without it yet, a test): the app then says so instead of crashing. */
export const host: KybernosHostNative | null = requireOptionalNativeModule<KybernosHostNative>('KybernosHost')
