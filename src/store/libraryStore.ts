import { create } from 'zustand'
import type { StyleLibrary, StyleProfile } from '../types'

interface LibraryState {
  libraries: StyleLibrary[]
  loaded: boolean
  loading: boolean
  load: () => Promise<void>
  create: (name: string, sourceNovelTitle: string, styleProfile: StyleProfile) => Promise<number | null>
  remove: (id: number) => Promise<void>
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  libraries: [],
  loaded: false,
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      if (window.electronAPI) {
        const rows = await window.electronAPI.db.query(
          'SELECT * FROM style_libraries ORDER BY created_at DESC'
        )
        const parsed = rows.map((r: any) => {
          try {
            return {
              ...r,
              style_profile: typeof r.style_profile === 'string'
                ? JSON.parse(r.style_profile)
                : (r.style_profile || {}),
            }
          } catch (e: any) {
            console.error(`Failed to parse style_profile for library ${r.id}:`, e.message)
            return { ...r, style_profile: {} }
          }
        })
        set({ libraries: parsed, loaded: true, loading: false })
      } else {
        set({ loaded: true, loading: false })
      }
    } catch (e: any) {
      console.error('Failed to load style libraries:', e.message)
      set({ loaded: true, loading: false })
    }
  },

  create: async (name, sourceNovelTitle, styleProfile) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.db.run(
          'INSERT INTO style_libraries (name, source_novel_title, style_profile) VALUES (?, ?, ?)',
          [name, sourceNovelTitle, JSON.stringify(styleProfile)]
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
        await window.electronAPI.db.run('DELETE FROM style_libraries WHERE id = ?', [id])
        await get().load()
      }
    } catch {
      // ignore
    }
  },
}))
