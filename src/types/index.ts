// ========== 风格库 ==========
export interface StyleProfile {
  writing_style: {
    narrative_perspective: string
    sentence_characteristics: string
    paragraph_ratio: string
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

// ========== 角色卡片 ==========
export type CharacterRoleType = 'main' | 'support' | 'antagonist' | 'minor'

export interface CharacterCard {
  id: number
  project_id: number
  name: string
  role_type: CharacterRoleType
  personality: string
  background: string
  appearance: string
  abilities: string
  relationships: { name: string; relation: string; description: string }[]
  status_tracking: { current_status: string; location: string; goal: string }
  notes: string
  created_at: string
  updated_at: string
}

// ========== 世界设定卡片 ==========
export type WorldCategory = 'location' | 'faction' | 'rule' | 'timeline' | 'general'

export interface WorldSetting {
  id: number
  project_id: number
  category: WorldCategory
  name: string
  description: string
  details: string
  trigger_keywords: string
  priority: number
  is_global: number
  notes: string
  created_at: string
  updated_at: string
}

// ========== 章节摘要 ==========
export interface ChapterSummary {
  id: number
  project_id: number
  chapter_number: number
  summary: string
  characters_appeared: string[]
  locations: string[]
  key_events: string[]
  foreshadowing_planted: string[]
  foreshadowing_recovered: string[]
  character_changes: Record<string, any>
  world_changes: Record<string, any>
  created_at: string
}

// ========== 伏笔注册表 ==========
export type ForeshadowingStatus = 'planned' | 'planted' | 'buried' | 'recycled' | 'resolved' | 'expired'
export type ForeshadowingPriority = 'critical' | 'high' | 'normal' | 'low'

export interface ForeshadowingItem {
  id: number
  project_id: number
  foreshadow_id: string
  description: string
  status: ForeshadowingStatus
  priority: ForeshadowingPriority
  planted_chapter: number | null
  target_chapter: number | null
  resolved_chapter: number | null
  related_characters: string[]
  notes: string
  created_at: string
  updated_at: string
}

// ========== 故事时间线 ==========
export type TimelineEventType = 'plot' | 'character_development' | 'revelation' | 'conflict' | 'resolution' | 'world_building'

export interface TimelineEvent {
  id: number
  project_id: number
  chapter_number: number
  event_order: number
  event_description: string
  time_label: string
  absolute_day: number | null
  location: string
  characters_involved: string[]
  event_type: TimelineEventType
  is_major: number
  created_at: string
}

// ========== 事实簿 ==========
export type FactCategory = 'character' | 'setting' | 'timeline' | 'rule' | 'relationship' | 'event'

export interface CanonFact {
  id: number
  project_id: number
  fact_category: FactCategory
  fact_key: string
  fact_value: string
  established_chapter: number | null
  last_verified: number | null
  is_hard_rule: number
  verification_status: number
  source: string
  notes: string
  details: string  // JSON: 扩展信息（角色卡的性格/能力/关系，或世界设定的触发词/优先级等）
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

// ========== LLM Provider ==========
export type LLMProvider = 'deepseek' | 'openai' | 'anthropic' | 'qwen'

export interface LLMConfig {
  provider: LLMProvider
  apiKey: string
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
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
  aiChatStream: (messages: { role: string; content: string }[], purpose?: string) => Promise<string>
  cancelAi: () => void
  onStreamChunk: (callback: (data: { chunk: string; done: boolean; error?: string }) => void) => () => void
  tokens: {
    stats: () => Promise<{ today: { tokens: number; prompt: number; output: number; cached: number; calls: number }; total: { tokens: number; prompt: number; output: number; cached: number; calls: number } }>
    history: () => Promise<any[]>
    onLastUsage: (callback: (data: { purpose: string; model: string; promptTokens: number; cachedTokens: number; outputTokens: number; totalTokens: number; cost: number }) => void) => () => void
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
