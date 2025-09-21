import { ref, watch } from 'vue'

export interface Settings {
  cachePolicy: 'cache-first' | 'cache-and-network' | 'network-only' | 'cache-only'
  relayMode: 'infinite' | 'page'
  ssr: boolean
  optimistic: boolean
}
const STORAGE_KEY = 'spellbook-settings'

const defaultSettings: Settings = {
  cachePolicy: 'cache-first',
  relayMode: 'infinite',
  ssr: false,
  optimistic: true
}

// Load settings from localStorage or use defaults
const loadSettings = (): Settings => {
  if (typeof window === 'undefined') return { ...defaultSettings }
  
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? { ...defaultSettings, ...JSON.parse(saved) } : { ...defaultSettings }
  } catch (e) {
    console.error('Failed to load settings:', e)
    return { ...defaultSettings }
  }
}

export const useSettings = () => {
  const settings = ref<Settings>(loadSettings())

  // Save settings to localStorage whenever they change
  watch(
    settings,
    (newSettings) => {
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings))
        } catch (e) {
          console.error('Failed to save settings:', e)
        }
      }
    },
    { deep: true }
  )

  return settings
}
