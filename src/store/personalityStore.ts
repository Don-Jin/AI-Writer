import { create } from 'zustand'
import type { PersonalityProject } from '../types'

interface PersonalityState {
  projects: PersonalityProject[]
  loaded: boolean
  load: () => Promise<void>
  create: (name: string, sourceText: string) => Promise<number | null>
  remove: (id: number) => Promise<void>
}

export const usePersonalityStore = create<PersonalityState>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    try {
      if (window.electronAPI) {
        const rows = await window.electronAPI.db.query(
          'SELECT * FROM personality_projects ORDER BY updated_at DESC'
        )
        // Parse personality_data JSON
        const parsed = rows.map((r: any) => ({
          ...r,
          personality_data: typeof r.personality_data === 'string'
            ? JSON.parse(r.personality_data || '{}')
            : (r.personality_data || {})
        }))
        set({ projects: parsed, loaded: true })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  create: async (name, sourceText) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.db.run(
          'INSERT INTO personality_projects (name, source_text) VALUES (?, ?)',
          [name, sourceText]
        )
        await get().load()
        return result.lastInsertRowid
      }
      return null
    } catch {
      return null
    }
  },

  remove: async (id) => {
    try {
      if (window.electronAPI) {
        await window.electronAPI.db.run('DELETE FROM personality_projects WHERE id = ?', [id])
        await get().load()
      }
    } catch {
      // ignore
    }
  },
}))
