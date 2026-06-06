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
  // 旧字段（向后兼容）
  summary?: string
  characters?: string[]
  key_events?: string[]
  function?: string
  ending_type?: string
  emotional_goal?: string
  // 新字段
  core_event?: string                    // 核心事件，一句话
  plot_beats?: string[]                  // 情节点序列，8-15条
  emotional_arc?: string                 // 情绪弧线：情绪A→情绪B→情绪C
  opening_hook?: { type: string; detail: string }  // 章首钩子
  closing_hook?: { type: string; impact: string }  // 章尾钩子 + 期待度
  // 约束字段
  forbidden?: string[]      // 本章禁止出现的剧情内容（3-5条）
  scene_count?: number      // 场景数（2-4个）
  max_info_reveal?: string  // 本章允许揭示的最大信息量（旧格式，向后兼容）
  emotion_cap?: string      // 感情线上限（旧格式）
  allowed_reveal?: { world: number; plot: number; character: number }  // 数值化信息配额
  estimated_words: number
  status?: string
  volume_version?: number          // 基于哪个卷纲版本生成
  plan_version?: number            // 自身编辑版本
}

// ========== 卷纲 ==========
export interface VolumeNode {
  name: string                    // 节点名：开篇/发展/转折一/转折二/高潮/矛盾结果/转折三/结局
  chapter_segment: string         // 章段，如"第001-006章"
  task: string                    // 核心任务
  pacing: string                  // 节奏：快/中/慢/极快
  content: string                 // 具体内容
  disasm_ref?: string             // 拆文借鉴
  setting_ref?: string            // 设定库角色参考
}

export interface Volume {
  volume_number: number; title: string; summary: string
  chapter_range: [number, number]; theme: string
  key_events: string[]
  detailed_summary?: string
  character_arcs?: string
  key_events_str?: string
  emotional_curve?: string
  foreshadowing?: string
  foreshadowing_planted?: string[]
  foreshadowing_recovered?: string[]
  word_count_target?: number
  connection_prev?: string
  connection_next?: string
  pacing_design?: string
  emotional_cadence?: string
  foreshadowing_plant?: string[]
  foreshadowing_payoff?: string[]
  foreshadowing_advance?: string
  character_milestones?: { character: string; start_state: string; end_state: string; key_event: string }[]
  conflict_nodes?: { description: string; chapter_segment: string; escalation_type: string }[]
  // 八节点结构
  nodes?: VolumeNode[]
  cool_density?: string            // 爽点密度描述
  golden_five?: string             // 黄金五章对照
  timeline_context?: { current_day: number; days_covered: number }
  global_info_quota?: string       // 世界观公开度配额（如"在[XX事件]暗示→在[YY事件]确认"）
  emotion_stage?: { limit: string } // 感情线阶段限制（如"直到[具体事件]发生前，感情不超过[阶段]"）
  volume_forbidden?: string[]      // 本卷禁止出现的剧情内容
  outline_version?: number         // 基于哪个大纲版本生成
  version?: number                 // 卷自身编辑版本
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
export type ForeshadowingStatus = 'pending' | 'active' | 'done'
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
  timeline_id: string       // 时间线标识（默认 'main'）
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
  revealed_level: number  // 公开度 0-100（0=完全隐藏，100=完全公开）
  dependencies: string    // JSON: 依赖的其他事实 { fact_key: string }[]
  confidence: string      // 'low' | 'medium' | 'high' — 置信度
  source_type: string     // 'system_core' | 'imported_user' | 'auto_extracted' — 来源权威层级
  created_at: string
  updated_at: string
}

// ========== 冲突记忆 ==========
export interface VersionHistory {
  id: number
  project_id: number
  content_type: 'outline' | 'chapter_plan' | 'chapter'
  content_key: string
  version: number
  content: string
  created_at: string
}

export interface ConflictFact {
  id: number
  project_id: number
  fact_a_id: number | null
  fact_b_id: number | null
  fact_a_text: string
  fact_b_text: string
  conflict_type: 'contradiction' | 'inconsistency' | 'ambiguity'
  resolution_status: 'unresolved' | 'resolved_a' | 'resolved_b' | 'merged' | 'accepted' | 'permanent'
  detected_chapter: number | null
  created_at: string
}

// ========== 设定库 ==========
export interface SettingProfile {
  characters: { name: string; info: string; abilities: string; role: string }[]
  worlds: { name: string; description: string; category: string }[]
  rules: { name: string; description: string }[]
  relationships: { char_a: string; char_b: string; relation: string; description: string }[]
}

export interface SettingLibrary {
  id: number
  name: string
  source_text: string
  setting_data: SettingProfile
  created_at: string
  updated_at: string
}

// ========== 人格库 ==========
export interface PersonalityProfile {
  // V1 字段（旧格式回退）
  private_imagery?: string
  emotional_quirks?: string
  rhythm_fingerprint?: string
  nonsense_style?: string
  private_rhetoric?: string
  dialogue_fingerprint?: string
  scenery_fingerprint?: string
  narrative_distance?: string
  info_release?: string
  raw_analysis?: string
  // V2 字段：5核行为替换图谱
  emotion?: Record<string, { ai_defaults: string[]; author_uses: string[]; principle: string }>
  imagery?: Record<string, { ai_defaults: string[]; author_uses: string[]; principle: string }>
  dialogue?: Record<string, { ai_defaults: string[]; author_uses: string[]; principle: string }>
  rhythm?: Record<string, { ai_defaults: string[]; author_uses: string[]; principle: string }>
  observation?: Record<string, { ai_defaults: string[]; author_uses: string[]; principle: string }>
  style_profile?: { perspective?: string; global_pattern?: string }
}

export interface PersonalityProject {
  id: number
  name: string
  source_text: string
  personality_data: PersonalityProfile
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
    checkUpdate: () => Promise<{ hasUpdate?: boolean; currentVersion?: string; latestVersion?: string; url?: string; name?: string; body?: string; error?: string }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
