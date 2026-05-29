import { create } from 'zustand'

export interface DisassemblyProject {
  id: number
  name: string
  source_text: string
  total_chapters: number
  current_stage: number
  stage_results: string
  created_at: string
  updated_at: string
}

interface DisassemblyState {
  projects: DisassemblyProject[]
  loaded: boolean
  load: () => Promise<void>
  create: (name: string, sourceText: string) => Promise<number | null>
  remove: (id: number) => Promise<void>
  updateStage: (id: number, stage: number, result: any) => Promise<void>
}

export const useDisassemblyStore = create<DisassemblyState>((set, get) => ({
  projects: [],
  loaded: false,

  load: async () => {
    try {
      if (window.electronAPI) {
        const rows = await window.electronAPI.db.query(
          'SELECT * FROM disassembly_projects ORDER BY updated_at DESC'
        )
        set({ projects: rows, loaded: true })
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
          'INSERT INTO disassembly_projects (name, source_text) VALUES (?, ?)',
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
        await window.electronAPI.db.run('DELETE FROM disassembly_projects WHERE id = ?', [id])
        await get().load()
      }
    } catch {
      // ignore
    }
  },

  updateStage: async (id, stage, result) => {
    try {
      if (window.electronAPI) {
        const proj = get().projects.find(p => p.id === id)
        const stageResults = proj ? JSON.parse(proj.stage_results || '{}') : {}
        stageResults[`stage${stage}`] = result

        await window.electronAPI.db.run(
          `UPDATE disassembly_projects
           SET current_stage = ?, stage_results = ?, updated_at = datetime('now','localtime')
           WHERE id = ?`,
          [stage, JSON.stringify(stageResults), id]
        )
        await get().load()
      }
    } catch {
      // ignore
    }
  },
}))
