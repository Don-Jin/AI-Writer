import { create } from 'zustand'

interface SettingsState {
  apiKey: string
  loaded: boolean
  load: () => Promise<void>
  save: (key: string) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: '',
  loaded: false,

  load: async () => {
    try {
      if (window.electronAPI) {
        const key = await window.electronAPI.settings.get('api_key')
        set({ apiKey: key || '', loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  save: async (key: string) => {
    if (window.electronAPI) {
      await window.electronAPI.settings.set('api_key', key)
      set({ apiKey: key })
    }
  },
}))
