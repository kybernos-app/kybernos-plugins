import * as SecureStore from 'expo-secure-store'
import type { SecureStorage } from './settings'

// Readable once the phone has been unlocked once after a restart (an automation that starts the app in the background still finds its key), and never copied to a backup or another device.
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }

export const deviceStorage: SecureStorage = {
  get: (name) => SecureStore.getItemAsync(name, OPTIONS),
  set: (name, value) => SecureStore.setItemAsync(name, value, OPTIONS),
  remove: (name) => SecureStore.deleteItemAsync(name, OPTIONS),
}
