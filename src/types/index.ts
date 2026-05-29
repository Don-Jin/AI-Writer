// ========== 风格库 ==========
export interface StyleProfile {
  writing_style: {
    narrative_perspective: string
    sentence_characteristics: string
    pace: string
  }
  language_features: {
    vocabulary_preference: string
    colloquial_level: string
    literary_ratio: string
  }
  rhetoric: {
    metaphor: string
    parallelism: string
    symbolism: string
    other: string[]
  }
  atmosphere: {
    primary: string
    secondary: string
    emotional_tone: string
  }
  sample_passages: string[]
  raw_analysis: string
}

export interface StyleLibrary {
  id: number
  name: string
  source_novel_title: string
  style_profile: StyleProfile
  created_at: string
}

// ========== 小说项目 ==========
export type ProjectStatus = 'outline' | 'detailed_outline' | 'writing' | 'completed'

export interface NovelProject {
  id: number
  title: string
  description: string
  primary_style_id: number | null
  auxiliary_style_ids: number[]
  status: ProjectStatus
  created_at: string
  updated_at: string
}

// ========== 大纲 ==========
export interface Outline {
  id: number
  project_id: number
  content: string
  version: number
  created_at: string
  updated_at: string
}

// ========== 细纲 ==========
export interface ChapterPlan {
  chapter_number: number
  title: string
  summary: string
  characters: string[]
  key_events: string[]
  estimated_words: number
  status: 'pending' | 'generating' | 'generated' | 'edited'
}

export interface DetailedOutline {
  id: number
  project_id: number
  chapters: ChapterPlan[]
  created_at: string
  updated_at: string
}

// ========== 章节 ==========
export type ChapterStatus = 'draft' | 'generating' | 'generated' | 'edited'

export interface Chapter {
  id: number
  project_id: number
  chapter_number: number
  title: string
  content: string
  word_count: number
  status: ChapterStatus
  created_at: string
  updated_at: string
}

// ========== 上下文状态 ==========
export interface CharacterState {
  [name: string]: {
    status: string
    location: string
    current_goal: string
    relationships: { [name: string]: string }
    last_appearance_chapter: number
  }
}

export interface ContextState {
  id: number
  project_id: number
  character_state: CharacterState
  plot_summary: string
  last_chapter: number
  updated_at: string
}

// ========== 设置 ==========
export interface AppSettings {
  api_key: string
  api_base_url: string
  api_model: string
}

// ========== IPC 类型 ==========
export interface ElectronAPI {
  db: {
    query: (sql: string, params?: any[]) => Promise<any[]>
    run: (sql: string, params?: any[]) => Promise<{ changes: number; lastInsertRowid: number }>
    get: (sql: string, params?: any[]) => Promise<any>
  }
  settings: {
    get: (key: string) => Promise<string>
    set: (key: string, value: string) => Promise<boolean>
  }
  aiChat: (messages: { role: string; content: string }[], purpose?: string) => Promise<string>
  tokens: {
    stats: () => Promise<{ today: { tokens: number; prompt: number; output: number; calls: number }; total: { tokens: number; prompt: number; output: number; calls: number } }>
    history: () => Promise<any[]>
  }
  openFile: (options?: any) => Promise<{ filePath: string; fileName: string } | null>
  readFile: (filePath: string) => Promise<string>
  saveFile: (options?: any) => Promise<{ filePath: string } | null>
  writeFile: (filePath: string, content: string) => Promise<void>
  writeBuffer: (filePath: string, base64Data: string) => Promise<void>
  parseFile: (filePath: string) => Promise<string>
  app: {
    getPath: (name: string) => Promise<string>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
