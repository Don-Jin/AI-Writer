import { create } from 'zustand'
import type { NovelProject } from '../types'

interface ProjectState {
  projects: NovelProject[]
  loaded: boolean
  load: () => Promise<void>
  create: (title: string, description: string) => Promise<number | null>
  remove: (id: number) => Promise<void>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    try {
      if (window.electronAPI) {
        const rows = await window.electronAPI.db.query(
          'SELECT * FROM novel_projects ORDER BY updated_at DESC'
        )
        set({
          projects: rows.map((r: any) => ({
            ...r,
            auxiliary_style_ids: JSON.parse(r.auxiliary_style_ids || '[]'),
          })),
          loaded: true,
        })
      } else {
        set({ loaded: true })
      }
    } catch {
      set({ loaded: true })
    }
  },

  create: async (title, description) => {
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.db.run(
          'INSERT INTO novel_projects (title, description) VALUES (?, ?)',
          [title, description]
        )
        // 刷新列表
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
        await window.electronAPI.db.run(
          'DELETE FROM novel_projects WHERE id = ?',
          [id]
        )
        await get().load()
      }
    } catch {
      // ignore
    }
  },
}))
