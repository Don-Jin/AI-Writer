import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import DeslopPanel from './DeslopPanel'
import VolumePanel from './VolumePanel'
import DesignPanel from './DesignPanel'
import CheckReportPanel from './CheckReportPanel'
import { getEffectivePatterns, saveCustomBannedPatterns, deterministicReplace, buildStyledRewriteSystem, DESLOP_REWRITE_USER } from '../../services/deslop'
import type { ParagraphScore } from '../../services/deslop'

import {
  PREPARE_SYSTEM, PREPARE_USER,
  OUTLINE_SYSTEM, OUTLINE_USER,
  OUTLINE_NORMALIZE_SYSTEM, OUTLINE_NORMALIZE_USER,
  IDEA_SYSTEM, IDEA_USER,
  GOLDEN_THREE_SYSTEM, GOLDEN_THREE_USER,
  REVERSE_OUTLINE_SYSTEM, REVERSE_OUTLINE_USER,
  VOLUME_OUTLINE_SYSTEM, VOLUME_OUTLINE_USER,
  CHAPTER_SYSTEM, CHAPTER_USER,
  buildExecutionConstraints,
  AUTO_FIX_SYSTEM, AUTO_FIX_USER,
  NARRATIVE_STATE_REPORT_SYSTEM, NARRATIVE_STATE_REPORT_USER,
} from '../../services/generator'
import {
  checkChapter, calcInfoLoss, buildRewritePrompt,
  takeSnapshot, diffSnapshot, buildStatePatchFromEvents, getCalibrationStats,
  DEFAULT_REWRITE_LIMIT,
  type Violation, type CheckResult, type StatePatch,
  type NormalizedLeakScore, type EventExtractionResult,
} from '../../services/checker'
import * as trackerService from '../../services/trackerService'
import type { NovelProject, Chapter, StyleLibrary, SettingLibrary, PersonalityProject } from '../../types'
import type { DisassemblyProject } from '../../store/disassemblyStore'

// ===== 类型 =====
interface Volume {
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
  nodes?: { name: string; chapter_segment: string; task: string; pacing: string; content: string; disasm_ref?: string; setting_ref?: string }[]
  cool_density?: string
  golden_five?: string
  timeline_context?: { current_day: number; days_covered: number }
  chapter_summaries?: { chapter: number; summary: string }[]
  global_info_quota?: string       // 世界观公开度配额
  emotion_stage?: { limit: string } // 感情线阶段限制
  volume_forbidden?: string[]      // 本卷禁止出现的剧情内容
  outline_version?: number
  version?: number
}
interface ChapterPlan {
  chapter_number: number; title: string
  summary?: string; characters?: string[]; key_events?: string[]
  estimated_words: number; emotional_goal?: string
  function?: string; ending_type?: string
  core_event?: string; plot_beats?: string[]
  emotional_arc?: string
  opening_hook?: { type: string; detail: string }
  closing_hook?: { type: string; impact: string }
  cool_moment?: string; status?: string
  forbidden?: string[]; scene_count?: number
  max_info_reveal?: string; emotion_cap?: string
  allowed_reveal?: { world: number; plot: number; character: number }
  volume_version?: number
  plan_version?: number
}

interface ChapterFix {
  chapter_number: number
  severity: string
  issues: string[]
  fix_prompt: string
}

// ===== 构建引用上下文 =====
function parseJson(v: string, fallback: any) { try { return JSON.parse(v) } catch { return fallback } }

/** 构建拆文库上下文（大纲/卷纲用） */
function buildDisassemblyContext(
  primaryDissId: number | null, auxDissIds: number[],
  disassemblies: DisassemblyProject[]
) {
  const ids = [primaryDissId, ...auxDissIds].filter(Boolean) as number[]
  const diss = disassemblies.filter(d => ids.includes(d.id))
  if (!diss.length) return ''
  return diss.map(d => {
    const r = JSON.parse(d.stage_results || '{}')
    return `【${d.id === primaryDissId ? '主参考' : '辅参考'}】${d.name}\n${(r.result || r.stage0 || '').slice(0, 1000)}`
  }).join('\n\n---\n\n')
}

/** 构建设定库上下文（大纲/卷纲用） */
function buildSettingContext(
  primaryId: number | null, auxIds: number[],
  settingLibraries: SettingLibrary[]
) {
  const ids = [primaryId, ...auxIds].filter(Boolean) as number[]
  const libs = settingLibraries.filter(l => ids.includes(l.id))
  if (!libs.length) return ''
  return libs.map(l => {
    const d = l.setting_data || {}
    const chars = (d as any).characters || []
    const worlds = (d as any).worlds || []
    const rules = (d as any).rules || []
    const prefix = l.id === primaryId ? '【主设定】' : '【辅设定】'
    let ctx = `${prefix}《${l.name}》`
    if (chars.length) {
      ctx += `\n角色(${chars.length}个)：`
      ctx += chars.map((c: any) => {
        const parts = [c.name]
        if (c.info) parts.push(`身份：${c.info}`)
        if (c.abilities) parts.push(`能力：${c.abilities}`)
        if (c.role) parts.push(`定位：${c.role}`)
        return parts.join('，')
      }).join('；')
    }
    if (worlds.length) {
      ctx += `\n世界观(${worlds.length}个)：`
      ctx += worlds.map((w: any) => {
        const parts = [w.name]
        if (w.description) parts.push(w.description)
        if (w.category) parts.push(`类别：${w.category}`)
        return parts.join('：')
      }).join('；')
    }
    if (rules.length) {
      ctx += `\n规则(${rules.length}个)：`
      ctx += rules.map((r: any) => `${r.name}：${r.description || ''}`).join('；')
    }
    return ctx
  }).join('\n\n')
}

/** 构建风格库上下文（正文用） — v3 丰富约束 */
/** 从长文本中提取条目列表（按句号/换行/分号拆分，取前N条） */
function extractItems(text: string | undefined, maxItems: number): string[] {
  if (!text || text.length < 5) return []
  const items = text.split(/[。；\n]+/).map(s => s.trim()).filter(s => s.length > 3)
  return items.slice(0, maxItems)
}

function buildStyleContext(
  primaryStyleId: number | null, auxStyleIds: number[],
  styleLibraries: StyleLibrary[]
) {
  try {
  const ids = [primaryStyleId, ...auxStyleIds].filter(Boolean) as number[]
  const styles = styleLibraries.filter(l => ids.includes(l.id))
  if (!styles.length) return ''

  return styles.map((s) => {
    const p = s.style_profile as any
    const prefix = `【🎨 风格材料池——${s.id === primaryStyleId ? '主' : '辅'}】${s.name}`

    // V4 格式：22类替换指南
    if (p?.replacements && typeof p.replacements === 'object' && !Array.isArray(p.replacements)) {
      const r = p.replacements
      const lines: string[] = [prefix]
      const keys = ['心理', '表情', '动作', '对话', '比喻', '结尾', '解释', '评判', '句子', '句式', '副词', '煽情', '描写', '连接词', '猜测', '过渡', '总结', '收束', '泛化', '成语', '预告']
      let count = 0
      for (const k of keys) {
        const dim = r[k]
        if (!dim || typeof dim !== 'object' || count >= 8) continue
        count++
        lines.push(`\n【${k}】`)
        if (Array.isArray(dim.ai_uses) && dim.ai_uses.length) lines.push(`❌ AI会用：${dim.ai_uses.join('、')}`)
        if (Array.isArray(dim.human_uses) && dim.human_uses.length) lines.push(`✅ 人类写法：${dim.human_uses.slice(0, 2).map((u: string) => `"${u}"`).join(' / ')}`)
        if (typeof dim.rule === 'string') lines.push(`📏 规则：${dim.rule}`)
      }
      return lines.join('\n')
    }

    // V3 旧格式回退
    const n = p?.narrative; const rh = p?.sentence_rhythm
    const pg = p?.paragraph; const l = p?.language; const a = p?.atmosphere
    const hard: string[] = []; const soft: string[] = []; const style: string[] = []

    if (n?.perspective) hard.push(`- 使用「${n.perspective}」。禁止切换视角。`)
    if (n?.pov_rules) hard.push(`- ${n.pov_rules}`)
    if (pg?.forbidden) hard.push(`- 禁止：${pg.forbidden}`)
    if (l?.forbidden_words) {
      const words = l.forbidden_words.split(/[,，、\s]+/).filter((w: string) => w.length > 1)
      if (words.length > 0) hard.push(`- 禁用词汇：${words.slice(0, 20).join('、')}`)
    }
    if (rh && typeof rh === 'object') {
      if (rh.short_max) soft.push(`- 短句≤${rh.short_max}字`)
      if (rh.long_min) soft.push(`- 长句≥${rh.long_min}字`)
      if (rh.density) soft.push(`- 句式密度：${rh.density}`)
      if (rh.exception) soft.push(`- 例外：${rh.exception}`)
    } else if (typeof rh === 'string' && rh.length > 2) soft.push(`- 句式：${rh}`)
    else { const ws = p?.writing_style; if (ws?.sentence_characteristics) soft.push(`- 句式：${ws.sentence_characteristics}`) }
    if (l?.vocab_level) soft.push(`- 词汇层级：${l.vocab_level}`)
    if (l?.dialogue_vs_narrative) soft.push(`- 叙事vs对话：${l.dialogue_vs_narrative}`)
    if (a?.emotion_scale) soft.push(`- 情绪跨度：${a.emotion_scale}`)
    if (pg?.habit) soft.push(`- 段落习惯：${pg.habit}`)
    if (n?.narrator_intrusion) style.push(`- 叙事者行为：${n.narrator_intrusion}`)
    if (!hard.length && !soft.length) {
      const ws = p?.writing_style; const lf = p?.language_features
      if (ws?.narrative_perspective) hard.push(`- ${ws.narrative_perspective}`)
      if (ws?.pace) soft.push(`- 节奏：${ws.pace}`)
      if (lf?.vocabulary_preference) soft.push(`- 词汇：${lf.vocabulary_preference}`)
    }
    const sects = [prefix]
    if (hard.length) sects.push(`🔴 必须遵守：\n${hard.slice(0, 7).join('\n')}`)
    if (soft.length) sects.push(`🟡 优先遵守：\n${soft.slice(0, 10).join('\n')}`)
    return sects.join('\n\n')
  }).join('\n')
  } catch { return '' }
}

/** 构建人格库上下文（正文用）— V2：5核行为替换图谱，❌→✅ 可执行格式 */
function buildPersonalityContext(
  primaryId: number | null, auxIds: number[],
  personalityProjects: PersonalityProject[]
) {
  const ids = [primaryId, ...auxIds].filter(Boolean) as number[]
  const projects = personalityProjects.filter(p => ids.includes(p.id))
  if (!projects.length) return ''
  return projects.map(p => {
    const d = p.personality_data || {} as any
    const prefix = `【🧠 人格材料池——${p.id === primaryId ? '主' : '辅'}】${p.name}`

    // V2 新格式：5核替换器
    if (d?.emotion || d?.imagery || d?.dialogue) {
      const lines: string[] = [prefix]
      // 1. 情绪替换器
      if (d.emotion) {
        const emoLines: string[] = []
        for (const [label, dim] of Object.entries(d.emotion) as any) {
          if (!dim?.author_uses?.length) continue
          emoLines.push(`  ${label}: ❌${(dim.ai_defaults||[]).join('、')} → ✅${dim.author_uses.join('、')}`)
          if (dim.principle) emoLines.push(`    📏 ${dim.principle}`)
        }
        if (emoLines.length) lines.push('【情绪替换器】\n' + emoLines.join('\n'))
      }
      // 2. 意象替换器
      if (d.imagery) {
        const imgLines: string[] = []
        for (const [label, dim] of Object.entries(d.imagery) as any) {
          if (!dim?.author_uses?.length) continue
          imgLines.push(`  ${label}: ❌${(dim.ai_defaults||[]).join('、')} → ✅${dim.author_uses.join('、')}`)
          if (dim.principle) imgLines.push(`    📏 ${dim.principle}`)
        }
        if (imgLines.length) lines.push('【意象替换器】\n' + imgLines.join('\n'))
      }
      // 3. 对话替换器
      if (d.dialogue) {
        const diaLines: string[] = []
        for (const [label, dim] of Object.entries(d.dialogue) as any) {
          if (!dim?.author_uses?.length) continue
          diaLines.push(`  ${label}: ❌${(dim.ai_defaults||[]).join('、')} → ✅${dim.author_uses.join('、')}`)
          if (dim.principle) diaLines.push(`    📏 ${dim.principle}`)
        }
        if (diaLines.length) lines.push('【对话替换器】\n' + diaLines.join('\n'))
      }
      // 4. 节奏替换器
      if (d.rhythm) {
        const rhyLines: string[] = []
        for (const [label, dim] of Object.entries(d.rhythm) as any) {
          if (!dim?.author_uses?.length) continue
          rhyLines.push(`  ${label}: ❌${(dim.ai_defaults||[]).join('、')} → ✅${dim.author_uses.join('、')}`)
          if (dim.principle) rhyLines.push(`    📏 ${dim.principle}`)
        }
        if (rhyLines.length) lines.push('【节奏替换器】\n' + rhyLines.join('\n'))
      }
      // 5. 观察替换器
      if (d.observation) {
        const obsLines: string[] = []
        for (const [label, dim] of Object.entries(d.observation) as any) {
          if (!dim?.author_uses?.length) continue
          obsLines.push(`  ${label}: ❌${(dim.ai_defaults||[]).join('、')} → ✅${dim.author_uses.join('、')}`)
          if (dim.principle) obsLines.push(`    📏 ${dim.principle}`)
        }
        if (obsLines.length) lines.push('【观察替换器】\n' + obsLines.join('\n'))
      }
      // 全局模式
      if (d.style_profile?.global_pattern) {
        lines.push(`【全局模式】${d.style_profile.global_pattern}`)
      }
      return lines.join('\n')
    }

    // V1 旧格式回退
    const soft: string[] = []; const style: string[] = []

    const imgs = extractItems(d.private_imagery, 8)
    if (imgs.length) soft.push(`- 私人意象（只能用以下，禁止训练数据套路意象）：\n${imgs.map(i => `  · ${i}`).join('\n')}`)
    const quirks = extractItems(d.emotional_quirks, 5)
    if (quirks.length) soft.push(`- 情绪怪癖（极端情绪下只能这样反应）：\n${quirks.map(q => `  · ${q}`).join('\n')}`)
    const rhetorics = extractItems(d.private_rhetoric, 5)
    if (rhetorics.length) soft.push(`- 私人修辞（比喻必须从以下生长）：\n${rhetorics.map(r => `  · ${r}`).join('\n')}`)
    const dialogue = extractItems(d.dialogue_fingerprint, 6)
    if (dialogue.length) soft.push(`- 对话指纹（角色说话方式只能从以下模式中取）：\n${dialogue.map(dl => `  · ${dl}`).join('\n')}`)
    const scenery = extractItems(d.scenery_fingerprint, 5)
    if (scenery.length) soft.push(`- 风景指纹（景物描写方式）：\n${scenery.map(sc => `  · ${sc}`).join('\n')}`)

    const rhythm = extractItems(d.rhythm_fingerprint, 5)
    if (rhythm.length) style.push(`- 节奏指纹：\n${rhythm.map(r => `  · ${r}`).join('\n')}`)
    const nonsense = extractItems(d.nonsense_style, 4)
    if (nonsense.length) style.push(`- 废话风格：\n${nonsense.map(n => `  · ${n}`).join('\n')}`)
    const narration = extractItems(d.narrative_distance, 4)
    if (narration.length) style.push(`- 叙事距离：\n${narration.map(nr => `  · ${nr}`).join('\n')}`)
    const infoRelease = extractItems(d.info_release, 4)
    if (infoRelease.length) style.push(`- 信息释放：\n${infoRelease.map(ir => `  · ${ir}`).join('\n')}`)

    const sections: string[] = [prefix]
    if (soft.length) sections.push(`🟡 优先遵守（${soft.length}条）：\n${soft.join('\n')}`)
    if (style.length) sections.push(`🔵 风格漂移（${style.length}条）：\n${style.join('\n')}`)
    return sections.join('\n\n')
  }).join('\n')
}

/** 构建可见的违规标记块（用于插入正文顶部，用户修改后可手动删除） */
function buildViolationMarkers(violations: Array<{ type: string; detail: string; source: string }>): string {
  const hard = violations.filter(v => v.source !== 'ai_suggestion')
  if (hard.length === 0) return ''
  return hard.map((v, i) =>
    `\n══════════════════════════════════════\n` +
    `⚠️ 硬违规 ${i + 1}/${hard.length}：[${v.type}] ${v.detail}\n` +
    `👆 修改后请删除本标记块\n` +
    `══════════════════════════════════════`
  ).join('')
}

/** 剥离正文中的违规标记块，返回干净的文本 */
function stripViolationMarkers(text: string): string {
  return text
    .replace(/\n?══════════════════════════════════════\n⚠️ 硬违规 \d+\/\d+：\[[\s\S]*?══════════════════════════════════════/g, '')
    .trim()
}

/** 卷纲高级字段 — 可折叠展示 */
export default function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // 核心数据
  const [project, setProject] = useState<NovelProject | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [prepareContent, setPrepareContent] = useState('')
  const [outlineContent, setOutlineContent] = useState('')
  const [outlineVersion, setOutlineVersion] = useState(1)
  const [volumes, setVolumes] = useState<Volume[]>([])
  const [chapterPlans, setChapterPlans] = useState<ChapterPlan[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [plotSummary, setPlotSummary] = useState('')

  // UI 状态
  const [selectedChapter, setSelectedChapter] = useState<number>(1)
  const [editingContent, setEditingContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genTarget, setGenTarget] = useState('')
  // v3.0: 自动续写（queueEndChapter>0 表示正在运行中）
  const autoContinueRef = useRef(true)  // true = 允许续写, false = 中断
  const [queueEndChapter, setQueueEndChapter] = useState<number>(0)  // 自动续写终点章节，0=未运行
  const [autoContinueDialog, setAutoContinueDialog] = useState(false)
  const [autoContinueStart, setAutoContinueStart] = useState('')
  const [autoContinueInput, setAutoContinueInput] = useState('')
  const [stopOnPlotDeviation, setStopOnPlotDeviation] = useState(false)
  const [budgetInfo, setBudgetInfo] = useState<{ charTokens?: number; totalChars?: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [rightTab, setRightTab] = useState<'outline' | 'volumes' | 'facts' | 'review'>('outline')
  const [expandedVolume, setExpandedVolume] = useState<number | null>(null)
  // ── 叙事控制台 v2 state ──
  const [lastCheckResult, setLastCheckResult] = useState<CheckResult | null>(null)
  const [lastEventData, setLastEventData] = useState<EventExtractionResult | null>(null)
  const [lastLeakScore, setLastLeakScore] = useState<NormalizedLeakScore | null>(null)
  const [calibrationStats, setCalibrationStats] = useState<{ chapters: number; mean: number; std: number } | null>(null)
  const [narrativeReport, setNarrativeReport] = useState<{
    narrative_state: string; pacing: string; characters: string; risk: string
    suggested_actions: { text: string; target_chapter: number | null; executable: false }[]
  } | null>(null)
  const [narrativeReportLoading, setNarrativeReportLoading] = useState(false)
  const [fixingChapter, setFixingChapter] = useState<number | null>(null)
  const [fullscreenEdit, setFullscreenEdit] = useState<{ title: string; content: string; onSave: (c: string) => void } | null>(null)
  const [fixPreview, setFixPreview] = useState<{ chapterNum: number; original: string; modified: string; skipped: string[] } | null>(null)
  const [showMarks, setShowMarks] = useState(false)
  const [markData, setMarkData] = useState<{ scores: ParagraphScore[]; selected: Set<number> } | null>(null)
  // 选中文字 → 一键禁用
  const [banSelection, setBanSelection] = useState<{ text: string; x: number; y: number } | null>(null)
  const [banFormOpen, setBanFormOpen] = useState(false)
  // 版本历史
  const [historyModal, setHistoryModal] = useState<{ type: string; key: string; currentContent: string; onRestore?: (c: string) => void } | null>(null)
  const [historyList, setHistoryList] = useState<any[]>([])
  // 灵感脑洞
  const [ideaInput, setIdeaInput] = useState('')
  const [ideaData, setIdeaData] = useState<any>(null)
  const [ideaLoading, setIdeaLoading] = useState(false)

  /** 灵感脑洞生成 */
  const handleGenerateIdea = async () => {
    if (!ideaInput.trim()) { showToast('error', '请输入灵感描述'); return }
    setIdeaLoading(true)
    cancelledRef.current = false
    try {
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: IDEA_SYSTEM },
        { role: 'user', content: IDEA_USER(ideaInput) },
      ], '灵感脑洞')
      if (cancelledRef.current) return
      const jm = reply.match(/\{[\s\S]*\}/)
      if (jm) { setIdeaData(JSON.parse(jm[0])); showToast('success', '灵感脑洞已生成') }
      else showToast('error', 'AI 返回格式异常')
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', '生成失败：' + (e.message || '未知'))
    } finally { setIdeaLoading(false) }
  }

  /** 黄金三章生成 */
  const [goldenLoading, setGoldenLoading] = useState(false)
  const handleGenerateGoldenThree = async () => {
    if (!ideaData) return
    setGoldenLoading(true)
    cancelledRef.current = false
    try {
      const { styleContext, personalityContext } = await getRefs()
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: GOLDEN_THREE_SYSTEM },
        { role: 'user', content: GOLDEN_THREE_USER(ideaData, styleContext, personalityContext) },
      ], '黄金三章')
      if (cancelledRef.current) return
      const parts = reply.split(/===\s*第\d+章\s*===/).filter(Boolean)
      for (let i = 0; i < Math.min(parts.length, 3); i++) {
        const content = parts[i].trim()
        if (content) {
          await saveChapter(i + 1, ideaData.hook?.slice(0, 20) || '黄金三章', content)
        }
      }
      await window.electronAPI.settings.set(`golden_three_${id}`, 'done')
      showToast('success', '黄金三章已生成')
      await loadAll()
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', '黄金三章失败：' + (e.message || '未知'))
    } finally { setGoldenLoading(false) }
  }

  /** 从黄金三章出大纲 */
  const handleReverseOutline = async () => {
    const ch1 = chapters.find(c => c.chapter_number === 1)
    const ch2 = chapters.find(c => c.chapter_number === 2)
    const ch3 = chapters.find(c => c.chapter_number === 3)
    if (!ch1 || !ch2 || !ch3) { showToast('error', '请先生成黄金三章'); return }
    setGenerating(true)
    try {
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: REVERSE_OUTLINE_SYSTEM },
        { role: 'user', content: REVERSE_OUTLINE_USER(ideaData || {}, [ch1.content, ch2.content, ch3.content]) },
      ], '反向大纲')
      await saveOutline(reply)
      showToast('success', '大纲已从黄金三章提取')
    } catch (e: any) { showToast('error', '提取失败：' + (e.message || '未知')) }
    finally { setGenerating(false) }
  }

  // 引用 — 大纲/卷纲用：拆文库 + 设定库
  const [primaryDissId, setPrimaryDissId] = useState<number | null>(null)
  const [auxDissIds, setAuxDissIds] = useState<number[]>([])
  const [primarySettingLibId, setPrimarySettingLibId] = useState<number | null>(null)
  const [auxSettingLibIds, setAuxSettingLibIds] = useState<number[]>([])
  // 引用 — 正文用：风格库 + 人格库
  const [primaryStyleId, setPrimaryStyleId] = useState<number | null>(null)
  const [auxStyleIds, setAuxStyleIds] = useState<number[]>([])
  const [primaryPersonalityId, setPrimaryPersonalityId] = useState<number | null>(null)
  const [auxPersonalityIds, setAuxPersonalityIds] = useState<number[]>([])
  // 库数据
  const [styleLibraries, setStyleLibraries] = useState<StyleLibrary[]>([])
  const [disassemblies, setDisassemblies] = useState<DisassemblyProject[]>([])
  const [settingLibraries, setSettingLibraries] = useState<SettingLibrary[]>([])
  const [personalityProjects, setPersonalityProjects] = useState<PersonalityProject[]>([])

  const [canonRefresh, setCanonRefresh] = useState(0)
  const [correctionRefresh, setCorrectionRefresh] = useState(0)
  const [suggestedForeshadowIds, setSuggestedForeshadowIds] = useState<number[]>([])  // v3.0: 伏笔匹配高亮

  // 流式生成
  const [streamingText, setStreamingText] = useState('')
  const cancelledRef = useRef(false)
  const generatingRef = useRef(false)
  const genChapterRef = useRef<any>(null)  // 始终指向最新的 genChapter，防 setTimeout 闭包陈旧
  const reviewingRef = useRef(false)
  const narrativeReportLoadingRef = useRef(false)

  // 同步 ref
  useEffect(() => { generatingRef.current = generating }, [generating])
  useEffect(() => { narrativeReportLoadingRef.current = narrativeReportLoading }, [narrativeReportLoading])
  const cancelStreamRef = useRef<(() => void) | null>(null)
  const editorRef = useRef<HTMLTextAreaElement>(null)
  const [checkedChapter, setCheckedChapter] = useState<number | null>(null)
  // 存储 rewrite 所需的上下文（检查是异步的，改错时复用）
  const rewriteCtxRef = useRef<{
    allFacts: any[]; timelineHistory: any[]; currentAbsoluteDay: number | null
    stateDrift: number; narrativeMode: string; charNames: string[]
    plan: ChapterPlan; chapNum: number
  } | null>(null)

  const handleCancel = () => {
    cancelledRef.current = true
    autoContinueRef.current = false  // v3.0: 中断自动续写链
    window.electronAPI?.cancelAi()
  }

  // 导出
  const [showExport, setShowExport] = useState(false)

  // ========== 一键全流程优化 ==========
  const [optimizing, setOptimizing] = useState(false)
  const [optimizeProgress, setOptimizeProgress] = useState<{ step: number; total: number; status: string[] }>({ step: 0, total: 5, status: [] })

  const optimizeChapter = async () => {
    if (optimizing || !editingContent.trim()) return
    setOptimizing(true)
    setOptimizeProgress({ step: 0, total: 5, status: ['禁词扫描', '去AI味改写', 'Checker检查', '自动修复', '更新事实簿'] })
    cancelledRef.current = false

    try {
      let text = editingContent
      const plan = chapterPlans.find(p => p.chapter_number === selectedChapter)
      const facts = await trackerService.getChapterTracker(Number(id), selectedChapter)

      // Step 1: 禁词扫描
      setOptimizeProgress(p => ({ ...p, step: 1 }))
      const { text: cleaned, replaced } = deterministicReplace(text)
      if (replaced > 0) { text = cleaned }
      if (cancelledRef.current) return

      // Step 2: 去AI味改写
      setOptimizeProgress(p => ({ ...p, step: 2 }))
      const deslopSystem = buildStyledRewriteSystem(
        buildStyleContext(primaryStyleId, auxStyleIds, styleLibraries),
        buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects)
      )
      const deslopReply = await window.electronAPI!.aiChat([
        { role: 'system', content: deslopSystem },
        { role: 'user', content: DESLOP_REWRITE_USER(text, '中度', {
          styleContext: buildStyleContext(primaryStyleId, auxStyleIds, styleLibraries),
          personalityContext: buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects),
        }) },
      ], '优化-去AI味')
      if (cancelledRef.current) return
      text = deslopReply
      await (async () => {})(); (0 as any); (Number(id), selectedChapter, 'optimize', 1)

      // Step 3: Checker
      setOptimizeProgress(p => ({ ...p, step: 3 }))
      // v4.0: 从 story_tracker 读取状态用于检查
      let allFacts: any[] = []
      try { allFacts = await window.electronAPI!.db.query("SELECT * FROM story_tracker WHERE project_id = ?", [Number(id)]) } catch {}
      const checkResult = checkChapter(text, plan || {} as any, allFacts, [], null, Number(id))
      if (cancelledRef.current) return

      // Step 4: Auto fix violations
      if (checkResult.violations.length > 0) {
        setOptimizeProgress(p => ({ ...p, step: 4 }))
        for (let round = 0; round < 2 && checkResult.violations.length > 0; round++) {
          const fixPrompt = buildRewritePrompt(text, checkResult.violations)
          const fixReply = await window.electronAPI!.aiChat([
            { role: 'system', content: AUTO_FIX_SYSTEM },
            { role: 'user', content: AUTO_FIX_USER(selectedChapter, text, checkResult.violations.map(v => v.detail), fixPrompt) },
          ], `优化-修复${round + 1}`)
          if (cancelledRef.current) return
          const jm = fixReply.match(/\{[\s\S]*\}/)
          if (jm) {
            const { fixes } = JSON.parse(jm[0])
            for (const { find, replace } of fixes) {
              if (find !== 'SKIP' && text.includes(find)) text = text.replace(find, replace)
            }
          }
          const recheck = checkChapter(text, plan || {} as any, allFacts, [], null, Number(id))
          if (recheck.violations.length === 0) break
        }
      }

      // Step 5: 更新事实簿
      setOptimizeProgress(p => ({ ...p, step: 5 }))
      await (async () => {})(); (0 as any); (Number(id), selectedChapter)

      setEditingContent(text)
      saveChapter(selectedChapter, plan?.title || `第${selectedChapter}章`, text)
      setOptimizeProgress(p => ({ ...p, step: 5 }))
      showToast('success', '优化完成')
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消优化')
      else showToast('error', '优化失败：' + e.message)
    } finally {
      setOptimizing(false)
    }
  }

  // ========== 加载 ==========
  const loadAll = useCallback(async () => {
    try {
      if (!window.electronAPI) { setLoaded(true); return }
      const proj = await window.electronAPI.db.get('SELECT * FROM novel_projects WHERE id = ?', [Number(id)])
      if (!proj) { showToast('error', '项目不存在'); navigate('/'); return }
      setProject(proj)

      const prep = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`prepare_${id}`])
      if (prep) setPrepareContent(prep.value)

      const outl = await window.electronAPI.db.get('SELECT content, version FROM outlines WHERE project_id = ?', [Number(id)])
      if (outl) { setOutlineContent(outl.content); setOutlineVersion(outl.version || 1) }

      // 加载卷纲
      const volRow = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`volumes_${id}`])
      if (volRow) { try { setVolumes(JSON.parse(volRow.value)) } catch {} }

      // 加载细纲
      const det = await window.electronAPI.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
      if (det) setChapterPlans(JSON.parse(det.chapters))

      const chRows = await window.electronAPI.db.query('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_number', [Number(id)])
      setChapters(chRows)

      // v4.0: context_state 已删除，不再读取
      setPlotSummary('')

      if (proj.primary_style_id) setPrimaryStyleId(proj.primary_style_id)
      try { setAuxStyleIds(JSON.parse(proj.auxiliary_style_ids || '[]')) } catch {}
      const libs = await window.electronAPI.db.query('SELECT * FROM style_libraries ORDER BY created_at DESC')
      setStyleLibraries(libs.map((l: any) => ({ ...l, style_profile: typeof l.style_profile === 'string' ? JSON.parse(l.style_profile) : l.style_profile })))
      const diss = await window.electronAPI.db.query('SELECT * FROM disassembly_projects ORDER BY updated_at DESC')
      setDisassemblies(diss)
      const setLibs = await window.electronAPI.db.query('SELECT * FROM setting_libraries ORDER BY created_at DESC')
      setSettingLibraries(setLibs.map((l: any) => ({ ...l, setting_data: typeof l.setting_data === 'string' ? JSON.parse(l.setting_data || '{}') : (l.setting_data || {}) })))
      const pers = await window.electronAPI.db.query('SELECT * FROM personality_projects ORDER BY updated_at DESC')
      setPersonalityProjects(pers.map((p: any) => ({ ...p, personality_data: typeof p.personality_data === 'string' ? JSON.parse(p.personality_data || '{}') : (p.personality_data || {}) })))

      // 恢复上次章节
      const lastCh = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`workspace_ch_${id}`])
      if (lastCh) setSelectedChapter(Number(lastCh.value))

      // 加载当前章节内容
      const curCh = chRows.find((c: Chapter) => c.chapter_number === (lastCh ? Number(lastCh.value) : 1))
      if (curCh) setEditingContent(curCh.content || '')
    } catch { showToast('error', '加载失败') }
    setLoaded(true)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  // 离开工作台时自动取消正在运行的生成（不弹toast，由catch处理）
  useEffect(() => {
    return () => {
      if (generatingRef.current || narrativeReportLoadingRef.current) {
        cancelledRef.current = true
        window.electronAPI?.cancelAi()
      }
    }
  }, [])

  // 切换章节
  const switchChapter = async (num: number, preserveCheck = false) => {
    setSelectedChapter(num)
    const ch = chapters.find(c => c.chapter_number === num)
    setEditingContent(ch?.content || '')
    if (!preserveCheck) {
      setLastCheckResult(null)
      setCheckedChapter(null)
    }
    if (window.electronAPI) {
      await window.electronAPI.settings.set(`workspace_ch_${id}`, String(num))
    }
  }

  // ========== 保存 ==========
  const saveChapter = async (num: number, title: string, content: string) => {
    if (!window.electronAPI) return
    const ex = chapters.find(c => c.chapter_number === num)
    if (ex?.content && ex.content.trim()) await saveVersion('chapter', String(num), ex.content)
    ex
      ? await window.electronAPI.db.run("UPDATE chapters SET title=?, content=?, word_count=?, status='edited', updated_at=datetime('now','localtime') WHERE id=?", [title, content, content.length, ex.id])
      : await window.electronAPI.db.run("INSERT INTO chapters (project_id, chapter_number, title, content, word_count, status) VALUES (?,?,?,?,?,'generated')", [Number(id), num, title, content, content.length])
    // 更新本地 state，不重载整个项目（避免 setEditingContent 被 loadAll 覆盖）
    setChapters(prev => {
      const updated = prev.find(c => c.chapter_number === num)
      if (updated) return prev.map(c => c.chapter_number === num ? { ...c, content, title, word_count: content.length } : c)
      return [...prev, { id: ex?.id || 0, project_id: Number(id), chapter_number: num, title, content, word_count: content.length, status: 'generated', created_at: '', updated_at: '' } as Chapter]
    })
  }

  const saveOutline = async (content: string) => {
    if (!window.electronAPI) return
    if (outlineContent.trim()) await saveVersion('outline', 'outline', outlineContent)
    const ex = await window.electronAPI.db.get('SELECT id FROM outlines WHERE project_id=?', [Number(id)])
    const newVersion = outlineVersion + 1
    ex
      ? await window.electronAPI.db.run("UPDATE outlines SET content=?, version=?, updated_at=datetime('now','localtime') WHERE project_id=?", [content, newVersion, Number(id)])
      : await window.electronAPI.db.run('INSERT INTO outlines (project_id,content,version) VALUES (?,?,?)', [Number(id), content, 1])
    setOutlineContent(content)
    setOutlineVersion(newVersion)
    showToast('success', `大纲已保存 (v${newVersion})`)
  }

  const saveVolumes = async (vols: Volume[]) => {
    if (!window.electronAPI) return
    await window.electronAPI.settings.set(`volumes_${id}`, JSON.stringify(vols))
    setVolumes(vols)
  }

  const saveChapterPlans = async (plans: ChapterPlan[]) => {
    if (!window.electronAPI) return
    const ex = await window.electronAPI.db.get('SELECT id FROM detailed_outlines WHERE project_id=?', [Number(id)])
    ex
      ? await window.electronAPI.db.run("UPDATE detailed_outlines SET chapters=?, updated_at=datetime('now','localtime') WHERE project_id=?", [JSON.stringify(plans), Number(id)])
      : await window.electronAPI.db.run('INSERT INTO detailed_outlines (project_id,chapters) VALUES (?,?)', [Number(id), JSON.stringify(plans)])
    setChapterPlans(plans)
  }

  /** 卷纲字段编辑 */
  const updateVolume = (volNum: number, field: string, value: string) => {
    const updated = volumes.map(v => v.volume_number === volNum ? { ...v, [field]: value, version: (v.version || 1) + 1 } : v)
    saveVolumes(updated)
  }

  /** 细纲字段编辑 */
  const updateChapterPlan = (chapNum: number, field: string, value: any) => {
    const updated = chapterPlans.map(p => p.chapter_number === chapNum ? { ...p, [field]: value, plan_version: (p.plan_version || 1) + 1 } : p)
    saveChapterPlans(updated)
  }

  // v4.0: 状态已由 trackerService 管理，不再需要 context_state
  const updateContext = async (_chapNum: number, _newContent: string) => {}
  const getRefs = async () => {
    // 大纲/卷纲用：拆文库 + 设定库
    const disassemblyContext = buildDisassemblyContext(primaryDissId, auxDissIds, disassemblies)
    const settingLibContext = buildSettingContext(primarySettingLibId, auxSettingLibIds, settingLibraries)
    // 正文用：风格库 + 人格库
    const styleContext = buildStyleContext(primaryStyleId, auxStyleIds, styleLibraries)
    const personalityContext = buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects)
    // v4.0: 从 story_tracker 读取主表设定（角色/事件/伏笔/规则）
    let cardContext = ''
    try {
      const masterItems = await trackerService.getMasterTracker(Number(id))
      if (masterItems && masterItems.length > 0) {
        const chars = masterItems.filter((t: any) => t.tracker_type === 'character')
        const events = masterItems.filter((t: any) => t.tracker_type === 'event')
        const rules = masterItems.filter((t: any) => t.tracker_type === 'rules')
        if (chars.length) cardContext += '【角色】\n' + chars.map((t: any) => `- ${t.tracker_key}: ${t.summary}`).join('\n') + '\n'
        if (events.length) cardContext += '【事件】\n' + events.map((t: any) => `- ${t.tracker_key}: ${t.summary}`).join('\n') + '\n'
        if (rules.length) cardContext += '【规则】\n' + rules.map((t: any) => `- ${t.tracker_key}: ${t.summary}`).join('\n') + '\n'
      }
    } catch {}
    return { disassemblyContext, settingLibContext, styleContext, personalityContext, cardContext }
  }

  /** 弹出生成配置后生成 */
  const startGenWithConfig = (title: string, desc: string, callback: (config: any) => Promise<void>) => {
    showToast('info', '弹出选择窗口...')
    setGenConfig({ open: true, title, desc, onConfirm: async (c) => { setGenConfig(prev => ({ ...prev, open: false })); await callback(c) } })
  }

  /** 生成大纲 — 读：准备+风格+拆文 */
  // 生成面板显示状态
  const [showGenPanel, setShowGenPanel] = useState<'outline' | 'chapter' | 'volumes' | 'detail' | null>(null)
  const [genHint, setGenHint] = useState('')
  const [genDetailTarget, setGenDetailTarget] = useState(1)

  const genOutline = async (config?: any, hint?: string) => {
    if (!project || !window.electronAPI) return
    setShowGenPanel(null); setGenHint('')
    setGenerating(true); setGenTarget('大纲')
    try {
      // 大纲用：拆文库 + 设定库。不注入风格库、人格库、事实簿（大纲生成事实，不被事实约束）
      let disassemblyContext = '', settingLibContext = ''
      if (config) {
        disassemblyContext = buildDisassemblyContext(config.primaryDissId, config.auxDissIds, disassemblies)
        settingLibContext = buildSettingContext(config.primarySettingLibId, config.auxSettingLibIds, settingLibraries)
      } else {
        const refs = await getRefs()
        disassemblyContext = refs.disassemblyContext
        settingLibContext = refs.settingLibContext
      }
      let userPrompt = OUTLINE_USER(project.title, project.description, prepareContent, '', disassemblyContext, settingLibContext || undefined, undefined, undefined)
        + (hint ? `\n\n【作者额外提示】\n${hint}\n\n请根据以上提示调整大纲。` : '')
      cancelledRef.current = false
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: OUTLINE_SYSTEM },
        { role: 'user', content: userPrompt },
      ], '大纲生成')
      if (cancelledRef.current) return
      await saveOutline(reply)
      showToast('success', '大纲已生成')
      // v4.0: 提取总表（状态机架构）
      ;(async () => {
        try {
          const count = await trackerService.extractMasterFromOutline(Number(id), reply)
          if (count > 0) {
            showToast('success', `总表已提取 ${count} 项`)
            setCanonRefresh(prev => prev + 1)
          }
        } catch {}
      })()
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消生成')
      else showToast('error', '大纲生成失败：' + (e.message || '未知'))
    }
    finally { setGenerating(false); setGenTarget('') }
  }

  // 确认生成（使用当前选择的引用）
  const confirmGen = () => {
    if (showGenPanel === 'outline') genOutline({ primaryDissId, auxDissIds, primarySettingLibId, auxSettingLibIds }, genHint)
    else if (showGenPanel === 'volumes') genSingleVolume()
    else if (showGenPanel === 'detail') genSingleChapterPlan(genDetailTarget, { primaryStyleId, auxStyleIds, primaryPersonalityId, auxPersonalityIds })
    else if (showGenPanel === 'chapter') genChapter(selectedChapter, { primaryStyleId, auxStyleIds, primaryPersonalityId, auxPersonalityIds }, genHint)
  }

  /** 生成单卷卷纲 — 读：大纲+前卷+风格+拆文 */
  const genSingleVolume = async () => {
    if (!outlineContent) { showToast('error', '请先生成大纲'); return }
    if (!window.electronAPI) return
    const total = chapterPlans.length || 40
    const prevVol = volumes.length > 0 ? volumes[volumes.length - 1] : null
    const nextVolNum = volumes.length + 1
    // 读取每卷章数配置
    let chaptersPerVol = 10
    try {
      const proj = await window.electronAPI.db.get('SELECT chapters_per_volume FROM novel_projects WHERE id = ?', [Number(id)])
      if (proj?.chapters_per_volume) chaptersPerVol = proj.chapters_per_volume
    } catch {}
    const startChapter = prevVol ? prevVol.chapter_range[1] + 1 : 1
    const endChapter = startChapter + chaptersPerVol - 1
    setGenerating(true)
    try {
      const { disassemblyContext, settingLibContext, cardContext } = await getRefs()
      let enrichedOutline = outlineContent
      if (disassemblyContext) enrichedOutline += '\n\n【📚 拆文库学习】\n' + disassemblyContext
      if (settingLibContext) enrichedOutline += '\n\n【📋 设定库参考】\n' + settingLibContext
      if (cardContext) enrichedOutline += '\n\n【📖 角色与世界设定】\n' + cardContext.slice(0, 1500)

      // 前一卷的上下文
      let prevVolContext = '', prevChapterPlansStr = ''
      if (prevVol) {
        prevVolContext = `第${prevVol.volume_number}卷《${prevVol.title}》\n主题：${prevVol.theme}\n${prevVol.detailed_summary || prevVol.summary}`
        const prevPlans = chapterPlans.filter(p => p.chapter_number >= prevVol.chapter_range[0] && p.chapter_number <= prevVol.chapter_range[1])
        if (prevPlans.length) {
          prevChapterPlansStr = prevPlans.map(p => `第${p.chapter_number}章 ${p.title}: ${p.summary}`).join('\n')
        }
      }

      // v4.0: 总表上下文（替代旧 cardContext，从 story_tracker 读取）
      const canonFactsContext = cardContext || ''

      // v4.0: 伏笔状态（从 story_tracker master 层读取）
      let foreshadowingStatus = ''
      try {
        const masterTrackers = await trackerService.getMasterTracker(Number(id))
        const fsItems = masterTrackers.filter((t: any) => t.tracker_type === 'foreshadow' && t.status !== 'resolved')
        if (fsItems.length > 0) {
          foreshadowingStatus = `共 ${fsItems.length} 个活跃伏笔：\n` + fsItems.map((f: any) =>
            `- ${f.tracker_key}: ${f.summary}`
          ).join('\n')
        }
      } catch {}

      // v4.0: 前卷执行结果（从 story_tracker chapter 层读取摘要）
      let prevVolOutcomes = ''
      if (prevVol) {
        try {
          const prevChapTrackers = await trackerService.getVolumeTracker(Number(id), prevVol.volume_number)
          if (prevChapTrackers && prevChapTrackers.length > 0) {
            const lines = prevChapTrackers.map((t: any) =>
              `第${t.chapter_number}章 [${t.tracker_type}] ${t.tracker_key}: ${t.summary}`
            )
            prevVolOutcomes = lines.join('\n')
          }
        } catch {}
      }

      // v4.0: 时间上下文（简化为从章节总数估算）
      let timelineContext: { current_day: number } | undefined
      try {
        const totalChs = chapters.filter(c => c.status !== 'draft').length
        if (totalChs > 0) {
          timelineContext = { current_day: totalChs }
        }
      } catch {}

      cancelledRef.current = false
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: VOLUME_OUTLINE_SYSTEM },
        { role: 'user', content: VOLUME_OUTLINE_USER(
          enrichedOutline, total, nextVolNum, prevVolContext, prevChapterPlansStr,
          canonFactsContext, foreshadowingStatus, prevVolOutcomes, timelineContext
        ) },
      ], '卷纲生成')
      if (cancelledRef.current) return

      // 去掉 markdown 代码块标记
      let text = reply
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .replace(/^[\s\n]*json[\s\n]*/i, '')
        .trim()
      // 从第一个 { 到最后一个 } 提取
      const firstBrace = text.indexOf('{')
      const lastBrace = text.lastIndexOf('}')
      let jsonStr = ''
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonStr = text.slice(firstBrace, lastBrace + 1)
      } else {
        // 尝试数组
        const firstBracket = text.indexOf('[')
        const lastBracket = text.lastIndexOf(']')
        if (firstBracket >= 0 && lastBracket > firstBracket) {
          jsonStr = text.slice(firstBracket, lastBracket + 1)
        }
      }
      if (!jsonStr) {
        console.error('VOLUME PARSE FAILED. Text length:', reply.length, 'Preview:', reply.slice(0, 300))
        showToast('error', `卷纲格式异常（返回${reply.length}字符，无JSON）。请重试。`)
        return
      }
      let vol: any
      try { vol = JSON.parse(jsonStr) } catch {
        try { vol = JSON.parse(jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']').replace(/[\x00-\x1f]/g, ' ')) } catch {}
      }
      if (!vol) { showToast('error', '卷纲格式异常，请重试'); return }
      const newVol: Volume = {
        volume_number: nextVolNum,
        title: vol.title || `第${nextVolNum}卷`,
        summary: vol.detailed_summary || vol.summary || '',
        chapter_range: vol.chapter_range || [startChapter, endChapter],
        theme: vol.theme || '',
        key_events: [],
        detailed_summary: vol.detailed_summary || vol.summary,
        character_arcs: vol.character_arcs,
        key_events_str: vol.key_events_str,
        emotional_curve: vol.emotional_curve,
        foreshadowing: vol.foreshadowing,
        // v1.7.0 卷纲优化新增字段
        word_count_target: vol.word_count_target,
        connection_prev: vol.connection_prev,
        connection_next: vol.connection_next,
        pacing_design: vol.pacing_design,
        emotional_cadence: vol.emotional_cadence,
        foreshadowing_plant: vol.foreshadowing_plant,
        foreshadowing_payoff: vol.foreshadowing_payoff,
        foreshadowing_advance: vol.foreshadowing_advance,
        character_milestones: vol.character_milestones,
        conflict_nodes: vol.conflict_nodes,
        nodes: vol.nodes,
        cool_density: vol.cool_density,
        golden_five: vol.golden_five,
        timeline_context: vol.timeline_context,
        chapter_summaries: vol.chapter_summaries,
        // v1.8.0 卷纲约束字段（VOLUME_OUTLINE_SYSTEM 定义，补齐 Volume 类型）
        global_info_quota: vol.global_info_quota,
        emotion_stage: vol.emotion_stage,
        volume_forbidden: vol.volume_forbidden,
        outline_version: outlineVersion,
        version: 1,
      }
      const newVols = [...volumes, newVol]
      await saveVolumes(newVols)

      // v4.0: 卷表将在卷结束时由 extractVolumeState 汇总章表状态生成
      // （旧 canon_facts / foreshadowing_registry 写入已删除）

      // v4.0: 卷纲生成后提取卷表（expected_state）
      ;(async () => {
        try {
          const count = await trackerService.extractVolumeFromOutline(
            Number(id), nextVolNum, JSON.stringify(newVol), nextVolNum - 1
          )
          if (count > 0) {
            showToast('success', `第${nextVolNum}卷《${newVol.title}》已生成，卷表提取 ${count} 项`)
            setCanonRefresh(prev => prev + 1)
          } else {
            showToast('success', `第${nextVolNum}卷《${newVol.title}》已生成`)
            setCanonRefresh(prev => prev + 1)
          }
        } catch {
          showToast('success', `第${nextVolNum}卷《${newVol.title}》已生成`)
          setCanonRefresh(prev => prev + 1)
        }
      })()
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消生成')
      else showToast('error', '卷纲生成失败：' + (e.message || '未知'))
    } finally { setGenerating(false) }
  }

  /** 生成某一章的细纲 — 读：大纲+所在卷纲+上一章细纲(如有)+风格+人格+事实簿 */
  const genSingleChapterPlan = async (chapNum: number, config?: { primaryStyleId: number | null; auxStyleIds: number[]; primaryPersonalityId: number | null; auxPersonalityIds: number[] }) => {
    if (!outlineContent) { showToast('error', '请先生成大纲'); return }
    if (!window.electronAPI) return
    let vol = volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
    // 自动续写刚生成的卷纲 state 可能未刷新，从 DB 回退
    if (!vol) {
      try {
        const dbVols = await window.electronAPI!.db.query('SELECT * FROM volumes WHERE project_id = ?', [Number(id)])
        vol = dbVols.find((v: any) => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
      } catch {}
    }
    if (!vol) { showToast('error', `第${chapNum}章不属于任何卷，请先调整卷纲`); return }

    setGenerating(true)
    cancelledRef.current = false
    try {
      const styleContext = config
        ? buildStyleContext(config.primaryStyleId, config.auxStyleIds, styleLibraries)
        : buildStyleContext(primaryStyleId, auxStyleIds, styleLibraries)
      const personalityContext = config
        ? buildPersonalityContext(config.primaryPersonalityId, config.auxPersonalityIds, personalityProjects)
        : buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects)
      const isFirstChapterInBook = chapNum === 1
      const isFirstChapterInVol = chapNum === vol.chapter_range[0]

      // 上一章细纲 + 上一章正文结尾（非全书第一章时读取）
      const prevPlan = isFirstChapterInBook ? null : chapterPlans.find(p => p.chapter_number === chapNum - 1)
      const prevChapter = isFirstChapterInBook ? null : chapters.find(c => c.chapter_number === chapNum - 1)

      const volContext = `【所在卷】第${vol.volume_number}卷《${vol.title}》
概要：${vol.summary} | 主题：${vol.theme}
章节范围：第${vol.chapter_range[0]}-${vol.chapter_range[1]}章`

      // 找到章节所在的节点，注入节点级约束
      let nodeContext = ''
      const volNodes = (vol as any).nodes || []
      if (volNodes.length > 0) {
        const curNode = volNodes.find((n: any) => {
          const seg = n.chapter_segment || ''
          const m = seg.match(/第?(\d+)[-–—至到]第?(\d+)/)
          if (m) return chapNum >= parseInt(m[1]) && chapNum <= parseInt(m[2])
          return false
        })
        if (curNode) {
          nodeContext = `\n【当前节点：${curNode.name}（${curNode.chapter_segment}）】
节点任务：${curNode.task}
节点内容：${curNode.content || '（无）'}
节奏：${curNode.pacing || '中'}`
          if (curNode.node_forbidden) nodeContext += `\n⛔ 节点禁区：${curNode.node_forbidden}`
          if (curNode.emotion_limit) nodeContext += `\n💕 感情限制：${curNode.emotion_limit}`
          if (curNode.info_quota) nodeContext += `\n🔐 信息配额：${curNode.info_quota}`
        }
      }

      const prevContentExcerpt = prevChapter?.content
        ? `\n【上一章正文结尾（${prevChapter.content.length}字）】\n${prevChapter.content.slice(-400)}\n（确保本章起点和上章结尾衔接）`
        : ''

      // 上一章的情节点序列用于因果衔接
      const prevBeatsContext = prevPlan?.plot_beats?.length
        ? `\n【上一章情节点序列（最后3条）】\n${prevPlan.plot_beats.slice(-3).map((b, i) => `${prevPlan.plot_beats!.length - 3 + i + 1}. ${b}`).join('\n')}`
        : prevPlan?.key_events?.length
          ? `\n【上一章关键事件】${prevPlan.key_events.join('；')}`
          : ''

      const prevContext = isFirstChapterInBook
        ? '（全书第一章，无前章）'
        : isFirstChapterInVol
          ? `（本卷第一章，请基于大纲和卷纲直接设计开篇，不需要依赖前一章细纲）${prevContentExcerpt}`
          : prevPlan
            ? `【上一章】第${prevPlan.chapter_number}章 ${prevPlan.title}${prevBeatsContext}${prevContentExcerpt}`
            : `（上一章细纲尚未生成，请基于大纲和卷纲独立设计本章）${prevContentExcerpt}`

      // v3.2: 读取上一章delta状态（等待最多5秒）
      let prevDeltaContext = ''
      if (!isFirstChapterInBook && !isFirstChapterInVol) {
        try {
          const prevDeltas = await (async () => ([] as any[]))(); (0 as any); (Number(id), chapNum - 1, 5000)
          if (prevDeltas.length > 0) {
            const byChar = new Map<string, any[]>()
            for (const d of prevDeltas) { if (!byChar.has(d.character_name)) byChar.set(d.character_name, []); byChar.get(d.character_name)!.push(d) }
            prevDeltaContext = '\n【上一章结束时的角色状态——请基于此状态规划本章】\n'
            for (const [name, deltas] of byChar) {
              const parts: string[] = []
              const em = deltas.find((d: any) => d.delta_type === 'emotion')
              const loc = deltas.find((d: any) => d.delta_type === 'location')
              if (em) { try { const v = JSON.parse(em.delta_value); parts.push(`情绪=${v.to}`) } catch {} }
              if (loc) { try { const v = JSON.parse(loc.delta_value); parts.push(`位置=${v.to}`) } catch {} }
              if (parts.length > 0) prevDeltaContext += `- ${name}：${parts.join('，')}\n`
            }
          }
        } catch {}
      }

      // 本章概述约束（来自卷纲 chapter_summaries）
      let summaryConstraint = ''
      const volSummaries = (vol as any).chapter_summaries as { chapter: number; summary: string }[] | undefined
      if (volSummaries) {
        const thisSummary = volSummaries.find(s => s.chapter === chapNum)
        const nextSummary = volSummaries.find(s => s.chapter === chapNum + 1)
        if (thisSummary) {
          summaryConstraint += `\n【本章概述——细纲不得超出此范围】\n${thisSummary.summary}\n⚠️ 情节点必须在此概述描述的剧情内。不要生成概述中没有的情节、不要引入概述之外的人物、不要让故事推进到概述的"合"之后。`
        }
        if (nextSummary) {
          summaryConstraint += `\n【下一章概述——结尾必须衔接至此】\n${nextSummary.summary}\n⚠️ 本章结尾（closing_hook + 最后1-2个情节点）必须能自然衔接到下一章概述的起点。`
        }
      }

      // v4.0: 细纲用 tracker 上下文
      let canonFactsContext = ''
      try {
        const trackers = await trackerService.getChapterTracker(Number(id), chapNum)
        if (trackers && trackers.length > 0) {
          canonFactsContext = trackers.map((t: any) => `- [${t.tracker_type}] ${t.tracker_key}: ${t.summary}`).join('\n')
        }
      } catch {}

      const promptParts = [
        outlineContent.slice(0, 3000),
        volContext,
        nodeContext,
        summaryConstraint,
        prevContext,
        prevDeltaContext,
        styleContext ? '【风格】\n' + styleContext : '',
        personalityContext ? '【🧠 人格参考】\n' + personalityContext : '',
        canonFactsContext ? '【状态追踪】\n' + canonFactsContext : '',
      ].filter(Boolean)

      const chapterTypeHint = isFirstChapterInBook
        ? '这是全书第一章（黄金首章），需要：强力钩子+快速建立主角+展示核心冲突。'
        : isFirstChapterInVol
          ? '这是新一卷的开篇章节，需要：新卷氛围建立+承上启下的过渡+保持读者期待。'
          : '请基于上一章情节点序列的结尾，连贯设计本章的情节点，确保因果衔接。'

      const reply = await window.electronAPI.aiChat([
        {
          role: 'system',
          content: `你是章节细纲规划师。只规划第 ${chapNum} 章。${chapterTypeHint}

## 情节点序列（plot_beats）是核心
输出 8-15 条情节点，每条是一个具体的、可被 AI 直接写出来的动作或事件。
- 因果关系链：上一条触发下一条，不跳跃
- 具体：写"凌瑶在旧代码堆中找到一扇代码门——凌寒山写的"，不写"两人找到了入口"
- 时序明确：情节点按时间顺序排列

## 钩子设计
- opening_hook：如何在前100字抓住读者。type: 倒计时式|悬念式|动作式|对话式|场景反转式
- closing_hook：如何让读者想翻下一章。type: 空间转换式|信息揭秘式|情绪悬念式|动作中断式。impact: 强|中|弱

## 情绪弧线（emotional_arc）
情绪在章节内的变化轨迹。格式：起始情绪→中间转折→章尾情绪（如"紧张→刺激→敬畏"）

## 人格指纹参考
如果 prompt 中包含【🧠 人格参考】，其中的对话指纹和风景指纹是本作角色的说话方式和景物描写模板。设计情节点时：
- 对话场景的情节点应体现对话指纹中的情绪表达方式和角色声音差异
- 涉及景物描写的场景应体现风景指纹中的切入方式和情绪承载模式

## 约束与禁区（这是最重要的字段）
- **forbidden**：本章绝对禁止出现的剧情内容（3-5条）。告诉AI"只能写到这里，不能碰这些"。格式："禁止：XXX在本章被揭露/确认/出现"
- **scene_count**：本章场景数（2-4个）
- **max_info_reveal**：本章允许推进的最大信息量（如"世界观公开度从15%→20%，禁止超过25%"）
- **emotion_cap**：感情线数值上限（如"阶段2/10，本章最多到2.5，禁止肢体接触/表白"）

## 输出 JSON 对象
{ "chapter_number": ${chapNum}, "title": "标题5-15字", "core_event": "核心事件一句话", "plot_beats": ["情节点", ...], "emotional_arc": "情绪A→情绪B→情绪C", "opening_hook": {"type":"倒计时式","detail":"..."}, "closing_hook": {"type":"空间转换式","impact":"强"}, "forbidden": ["禁止揭露XX","禁止引入XX"], "scene_count": 3, "max_info_reveal": "世界观公开度从15%→20%", "emotion_cap": "感情阶段2/10，本章最多到2.5", "estimated_words": 3000 }
输出严格的JSON对象，不要数组，不要markdown代码块。`
        },
        { role: 'user', content: promptParts.join('\n\n') + `\n\n请输出第 ${chapNum} 章的细纲JSON对象。` },
      ], `细纲-第${chapNum}章`)

      if (cancelledRef.current) return
      let newPlan: ChapterPlan
      try {
        const jm = reply.match(/\{[\s\S]*\}/)
        newPlan = JSON.parse(jm ? jm[0] : reply)
      } catch {
        newPlan = {
          chapter_number: chapNum,
          title: `第${chapNum}章`,
          core_event: reply.slice(0, 100),
          plot_beats: [],
          emotional_arc: '',
          estimated_words: 3000,
        }
      }
      newPlan.chapter_number = chapNum
      newPlan.volume_version = (volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1]) || {} as any).version || 1
      newPlan.plan_version = 1

      // V2 强制校验：确保关键字段存在
      if (!newPlan.plot_beats || newPlan.plot_beats.length === 0) newPlan.plot_beats = ['开始本章情节']
      if (!newPlan.forbidden) newPlan.forbidden = ['禁止引入未登场的新核心角色']
      if (!newPlan.emotional_arc) newPlan.emotional_arc = '推进→转折→收束'
      if (!newPlan.scene_count) newPlan.scene_count = 3
      if (!newPlan.opening_hook) newPlan.opening_hook = { type: '悬念式', detail: '以具体场景开始' }
      if (!newPlan.closing_hook) newPlan.closing_hook = { type: '动作中断式', impact: '中' }

      // v4.0: 禁区补充已由细纲 prompt 处理，不再从旧表读取
      try {
        const trackers = await trackerService.getChapterTracker(Number(id), chapNum - 1)
        // 从上一章章表读取角色状态作为禁区参考
        for (const t of trackers) {
          if (t.tracker_type === 'character' && !newPlan.forbidden!.some((f: string) => f.includes(t.tracker_key))) {
            // 不再自动添加禁区，保持细纲 prompt 生成的内容
          }
        }
      } catch {}

      // 从 DB 读取最新细纲（避免循环中闭包 state 过期导致覆盖）
      let latestPlans: ChapterPlan[] = chapterPlans
      try {
        const dbRow = await window.electronAPI!.db.get('SELECT chapters FROM detailed_outlines WHERE project_id=?', [Number(id)])
        if (dbRow?.chapters) { const parsed = JSON.parse(dbRow.chapters); if (Array.isArray(parsed)) latestPlans = parsed }
      } catch {}
      const merged = latestPlans.filter(p => p.chapter_number !== chapNum)
      merged.push(newPlan)
      merged.sort((a, b) => a.chapter_number - b.chapter_number)
      await saveChapterPlans(merged)
      showToast('success', `第${chapNum}章细纲已生成：${newPlan.title}`)
      // v4.0: 写入章表初始 state（从细纲推断）
      try {
        for (const char of (newPlan.characters || [])) {
          await trackerService.upsertTracker({
            project_id: Number(id), tier: 'chapter', volume_number: 0,
            chapter_number: chapNum, tracker_type: 'character', tracker_key: char,
            summary: `${char} 出场于第${chapNum}章 "${newPlan.title}"`,
            state: { emotion: newPlan.emotional_arc?.split('→')[0] || '', goal: newPlan.core_event || '', location: '', relationships: {}, scene: '', unfinished_action: '' },
            status: '',
          })
        }
        setCanonRefresh(prev => prev + 1)
      } catch {}
    } catch (e: any) {
      if (cancelledRef.current) { showToast('info', '已取消生成'); throw e }
      else showToast('error', `第${chapNum}章细纲生成失败：${e.message || '未知错误'}`)
    } finally {
      setGenerating(false)
    }
  }

  /** 生成某一章正文 — 流式输出 + 卡片上下文 + 自动摘要 */
  const genChapter = async (chapNum: number, config?: any, hint?: string) => {
    if (!project || !window.electronAPI) return
    let plan = chapterPlans.find(p => p.chapter_number === chapNum)
    // 自动续写刚生成的细纲可能尚未同步到 state，从 DB 回退读取
    if (!plan) {
      try {
        const row = await window.electronAPI!.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
        if (row?.chapters) {
          plan = JSON.parse(row.chapters).find((p: any) => p.chapter_number === chapNum)
        }
      } catch {}
    }
    if (!plan) { showToast('error', '该章尚无细纲，请先生成对应卷的细纲'); return }

    setShowGenPanel(null); setGenHint('')
    setGenerating(true); setGenTarget(`第${chapNum}章`)
    setStreamingText('')
    setLastCheckResult(null); setCheckedChapter(null)
    autoContinueRef.current = true  // v3.0: 重置续写链标志

    try {
      const { styleContext, personalityContext } = config
        ? { styleContext: buildStyleContext(config.primaryStyleId, config.auxStyleIds, styleLibraries),
            personalityContext: buildPersonalityContext(config.primaryPersonalityId, config.auxPersonalityIds, personalityProjects) }
        : (await getRefs())

      // 找所在卷
      const vol = volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
      const volContext = vol
        ? `【所在卷】第${vol.volume_number}卷《${vol.title}》\n概要：${vol.summary}\n主题：${vol.theme}` +
          (vol.pacing_design ? `\n节奏设计：${vol.pacing_design}` : '') +
          (vol.emotional_cadence ? `\n情绪节奏：${vol.emotional_cadence}` : '') +
          (vol.cool_density ? `\n爽点密度：${vol.cool_density}` : '') +
          (vol.connection_prev ? `\n承接上卷：${vol.connection_prev}` : '') +
          (vol.connection_next ? `\n铺垫下卷：${vol.connection_next}` : '')
        : ''

      // 找章节所在节点
      let nodeContext = ''
      if (vol) {
        const volNodes = (vol as any).nodes || []
        const curNode = volNodes.find((n: any) => {
          const seg = n.chapter_segment || ''
          const m = seg.match(/第?(\d+)[-–—至到]第?(\d+)/)
          if (m) return chapNum >= parseInt(m[1]) && chapNum <= parseInt(m[2])
          return false
        })
        if (curNode) {
          nodeContext = `\n【当前节点：${curNode.name}】${curNode.task}\n节点内容：${curNode.content || ''}`
          if (curNode.node_forbidden) nodeContext += `\n⛔ 节点禁区：${curNode.node_forbidden}`
          if (curNode.emotion_limit) nodeContext += `\n💕 感情限制：${curNode.emotion_limit}`
          if (curNode.info_quota) nodeContext += `\n🔐 信息配额：${curNode.info_quota}`
        }
      }

      // v4.0: 上一章结束状态（从 story_tracker 读取，替代旧 prevExcerpt + prevStateContext）
      let endingStateContext = ''
      if (chapNum > 1) {
        try {
          const endingState = await trackerService.getEndingState(Number(id), chapNum - 1)
          if (endingState) {
            const parts: string[] = []
            if (endingState.scene) parts.push(`场景: ${endingState.scene}`)
            if (endingState.emotion) parts.push(`情绪: ${endingState.emotion}`)
            if (endingState.unfinished_action) parts.push(`未完成: ${endingState.unfinished_action}`)
            if (parts.length > 0) endingStateContext = `【上章结尾状态】\n${parts.join('，')}`
          }
        } catch {}
      }

      // v4.0: 本章章表状态上下文（从 story_tracker 读取，替代旧 canonFactsContext）
      let trackerContext = ''
      try {
        const chapterTrackers = await trackerService.getChapterTracker(Number(id), chapNum)
        if (chapterTrackers && chapterTrackers.length > 0) {
          const lines = chapterTrackers.map((t: any) =>
            `- [${t.tracker_type}] ${t.tracker_key}: ${t.summary}`
          )
          trackerContext = '【状态追踪——本章角色/事件/伏笔预期状态】\n' + lines.join('\n')
        }
      } catch {}

      // v4.0: 精简后的正文注入（~4000 chars）
      const planAny = plan as any
      let userPrompt = CHAPTER_USER(
        project.title, prepareContent.slice(0, 500), chapNum, plan.title,
        plan.summary || '', plan.characters || [], plan.key_events || [], plan.estimated_words || 3000,
        planAny.emotional_goal || planAny.emotional_arc || '', planAny.function || '', planAny.ending_type || '自然收尾',
        styleContext, plotSummary, endingStateContext,
        (volContext + nodeContext),
        trackerContext, personalityContext,
        plan.plot_beats, plan.emotional_arc, plan.cool_moment,
        plan.forbidden, plan.scene_count, plan.max_info_reveal, plan.emotion_cap,
        (plan as any).opening_hook, (plan as any).closing_hook
      ) + (hint ? '\n\n【作者额外提示】\n' + hint : '')

      // v3.2: 强化字数约束 — 显式要求，防止 AI 偷懒
      const minWords = Math.floor((plan.estimated_words || 3000) * 0.85)
      userPrompt += `\n\n⚠️ 重要要求：本章必须写满 ${plan.estimated_words || 3000} 字（至少 ${minWords} 字），逐条完成上方所有情节点后方可收尾。未完成不允许结束。`

      // 使用流式 API
      let fullText = ''
      cancelledRef.current = false
      const cleanup = window.electronAPI.onStreamChunk((data) => {
        if (data.error) {
          cancelledRef.current = true
          setGenerating(false); setStreamingText(''); setGenTarget('')
          return
        }
        if (!data.done && data.chunk) {
          fullText += data.chunk
          setStreamingText(fullText)
        }
      })

      const reply = await window.electronAPI.aiChatStream([
        { role: 'system', content: buildExecutionConstraints(styleContext, personalityContext) + '\n\n' + CHAPTER_SYSTEM },
        { role: 'user', content: userPrompt },
      ], '章节生成')

      cleanup()

      if (cancelledRef.current) {
        showToast('info', '已取消生成')
        return
      }

      const finalText = reply || fullText
      setEditingContent(finalText)
      setStreamingText('')
      setGenerating(false)
      setGenTarget('')
      await saveChapter(chapNum, plan.title, finalText)
      await updateContext(chapNum, finalText)
      showToast('success', `第${chapNum}章生成完成`)

      // v4.0: 同步提取章表状态（替代旧记录官，在主流程中运行）
      try {
        const prevTracker = await trackerService.getChapterTracker(Number(id), chapNum - 1)
        const count = await trackerService.extractChapterState(Number(id), chapNum, finalText, prevTracker)
        if (count > 0) setCanonRefresh(prev => prev + 1)
      } catch {}

      // v4.0: 剧情跑偏检查（简化版——从 lastCheckResult 读取）
      if (stopOnPlotDeviation && !cancelledRef.current && queueEndChapter > 0) {
        if (lastCheckResult && lastCheckResult.hardViolationCount > 3) {
          const confirmed = window.confirm(
            `第${chapNum}章检测到 ${lastCheckResult.hardViolationCount} 处违规。\n\n是否暂停自动续写？\n\n点「确定」暂停，点「取消」继续。`
          )
          if (confirmed) {
            setQueueEndChapter(0)
            autoContinueRef.current = false
            showToast('info', '自动续写已暂停')
            return
          }
        }
      }

      // ── v3.0 自动续写检测（含自动生成细纲+卷纲）──
      if (!cancelledRef.current && queueEndChapter > 0) {
        const nextChapter = chapNum + 1
        if (nextChapter > queueEndChapter) {
          showToast('success', `自动续写完成：第${queueEndChapter}章已完成`)
          setQueueEndChapter(0)
          return
        }
        setTimeout(async () => {
          try {
          if (!autoContinueRef.current) return
          // v4.0: 章表已同步提取，无需等待
          let curVol = volumes.find(v => nextChapter >= v.chapter_range[0] && nextChapter <= v.chapter_range[1])
          if (!curVol) {
            // v4.0: 卷结束时运行卷检查
            const completedVol = volumes[volumes.length - 1]
            if (completedVol) {
              try {
                const chNums: number[] = []
                for (let cn = completedVol.chapter_range[0]; cn <= completedVol.chapter_range[1]; cn++) chNums.push(cn)
                const report = await trackerService.runVolumeCheck(Number(id), completedVol.volume_number, chNums)
                setCanonRefresh(prev => prev + 1)
                if (report.rule_violations.length > 0 || report.character_deviations.length > 0) {
                  showToast('info', `卷${completedVol.volume_number}检查：${report.score}分，${report.rule_violations.length}个违规`)
                }
              } catch {}
            }
            showToast('info', `正在生成第${volumes.length + 1}卷卷纲...`)
            await genSingleVolume()
            if (!autoContinueRef.current) return
            // genSingleVolume 写入 DB，但 state 未刷新 → 从 DB 读取
            try {
              const dbVols = await window.electronAPI!.db.query('SELECT * FROM volumes WHERE project_id = ?', [Number(id)])
              const allVols = dbVols.map((v: any) => ({ ...v, chapter_range: typeof v.chapter_range === 'string' ? JSON.parse(v.chapter_range) : v.chapter_range }))
              curVol = allVols.find((v: any) => nextChapter >= v.chapter_range[0] && nextChapter <= v.chapter_range[1])
            } catch {}
            if (!curVol) {
              showToast('error', '卷纲生成失败，自动续写中断')
              setQueueEndChapter(0)
              return
            }
          }
          let nextPlan = chapterPlans.find(p => p.chapter_number === nextChapter)
          if (!nextPlan) {
            try {
              const row = await window.electronAPI!.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
              if (row?.chapters) nextPlan = JSON.parse(row.chapters).find((p: any) => p.chapter_number === nextChapter)
            } catch {}
          }
          if (!nextPlan) {
            showToast('info', `正在生成第${nextChapter}章细纲...`)
            await genSingleChapterPlan(nextChapter)
            if (!autoContinueRef.current) return
            // 验证写入成功
            try {
              const row = await window.electronAPI!.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
              if (row?.chapters) nextPlan = JSON.parse(row.chapters).find((p: any) => p.chapter_number === nextChapter)
            } catch {}
            if (!nextPlan) {
              showToast('error', `第${nextChapter}章细纲生成失败，自动续写中断`)
              setQueueEndChapter(0)
              return
            }
          }
          genChapterRef.current(nextChapter)
          } catch (e) { console.error('auto-continue error:', e); showToast('error', '自动续写出错，已暂停'); setQueueEndChapter(0) }
        }, 1500)
      }

      // v4.0: Checker（保留，仍在 background 运行）
      ;(async () => {
        const pid = Number(id)
        try {
          const checkResult = checkChapter(
            finalText, plan, [], [], null, pid, undefined, undefined, 0.03, 'stable'
          )
          setLastCheckResult(checkResult)
          if (checkResult.leakScore) setLastLeakScore(checkResult.leakScore)
          setCalibrationStats(getCalibrationStats(pid))
          if (checkResult.hardViolationCount > 0) {
            setCheckedChapter(chapNum)
            const markers = buildViolationMarkers(checkResult.violations)
            if (markers) {
              setEditingContent(markers + '\n' + finalText)
              await saveChapter(chapNum, plan.title, markers + '\n' + finalText)
            }
          }
        } catch {}
      })()
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', '生成失败：' + e.message)
    }
    finally { setGenerating(false); setGenTarget(''); setStreamingText('') }
  }

  const handleSave = async () => {
    setSaving(true)
    const plan = chapterPlans.find(p => p.chapter_number === selectedChapter)
    await saveChapter(selectedChapter, plan?.title || `第${selectedChapter}章`, editingContent)
    setSaving(false)
    showToast('success', '已保存')
  }

  // 删除章节（包括正文和细纲）
  const deleteChapter = async (chapNum: number) => {
    const ch = chapters.find(c => c.chapter_number === chapNum)
    const plan = chapterPlans.find(p => p.chapter_number === chapNum)
    const label = ch ? `第 ${chapNum} 章「${ch.title}」` : plan ? `第 ${chapNum} 章细纲「${plan.title}」` : `第 ${chapNum} 章`
    if (!window.confirm(`确定删除${label}吗？此操作不可恢复。`)) return
    try {
      if (window.electronAPI) {
        if (ch) {
          await window.electronAPI.db.run('DELETE FROM chapters WHERE id = ?', [ch.id])
          // v4.0: 清理 tracker 关联数据（旧 chapter_summaries/story_timeline 等表已删除）
          await window.electronAPI.db.run('DELETE FROM story_tracker WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum])
          await window.electronAPI.db.run('DELETE FROM tracker_transitions WHERE project_id = ? AND chapter_number = ?', [Number(id), chapNum])
        }
        const newPlans = chapterPlans.filter(p => p.chapter_number !== chapNum)
        await saveChapterPlans(newPlans)
        await loadAll()
        setCanonRefresh(prev => prev + 1)
        showToast('success', `${label}已删除`)
        if (selectedChapter === chapNum) {
          setEditingContent('')
          if (newPlans.length > 0) switchChapter(newPlans[0].chapter_number)
        }
      }
    } catch { showToast('error', '删除失败') }
  }

  // 新建章节（加到末尾）
  const addChapter = async () => {
    const maxNum = chapterPlans.length > 0 ? Math.max(...chapterPlans.map(p => p.chapter_number)) : 0
    const newPlan: ChapterPlan = {
      chapter_number: maxNum + 1,
      title: `第${maxNum + 1}章`,
      summary: '',
      characters: [],
      key_events: [],
      estimated_words: 3000,
      emotional_goal: '',
      function: '📖 展开',
      ending_type: '自然收尾',
    }
    const newPlans = [...chapterPlans, newPlan].sort((a, b) => a.chapter_number - b.chapter_number)
    // 重新编号
    const renumbered = newPlans.map((p, i) => ({ ...p, chapter_number: i + 1 }))
    await saveChapterPlans(renumbered)
    await loadAll()
    showToast('success', `已添加：第${maxNum + 1}章`)
  }

  // 删除卷
  const deleteVolume = async (volNum: number) => {
    const vol = volumes.find(v => v.volume_number === volNum)
    if (!vol) return
    if (!window.confirm(`确定删除「${vol.title}」吗？卷内章节细纲不会被删除。`)) return
    const newVols = volumes.filter(v => v.volume_number !== volNum).map((v, i) => ({ ...v, volume_number: i + 1 }))
    await saveVolumes(newVols)
    showToast('success', `已删除「${vol.title}」`)
  }

  // 新建卷
  const addVolume = async () => {
    const maxNum = volumes.length > 0 ? Math.max(...volumes.map(v => v.volume_number)) : 0
    const lastVol = volumes.find(v => v.volume_number === maxNum)
    const start = lastVol ? lastVol.chapter_range[1] + 1 : 1
    const end = start + 7
    const newVol: Volume = {
      volume_number: maxNum + 1,
      title: `第${maxNum + 1}卷`,
      summary: '',
      chapter_range: [start, end],
      theme: '',
      key_events: [],
    }
    const newVols = [...volumes, newVol]
    await saveVolumes(newVols)
    showToast('success', `已添加：第${maxNum + 1}卷`)
  }

  // 拖拽移动章节到指定卷
  const moveChapterToVolume = (chapNum: number, targetVolNum: number) => {
    const newVols = volumes.map(v => ({ ...v }))
    // 从原卷移出：调整原卷的 chapter_range
    const oldVol = newVols.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
    const targetVol = newVols.find(v => v.volume_number === targetVolNum)
    if (!targetVol || !oldVol) return

    if (oldVol.volume_number === targetVolNum) return // 同卷不移动

    // 缩小原卷范围
    if (oldVol.chapter_range[0] === chapNum) oldVol.chapter_range[0]++
    else if (oldVol.chapter_range[1] === chapNum) oldVol.chapter_range[1]--
    else {
      // 章节在中间，拆分为两个卷（简化：只调整范围）
      // 这里简单处理：从原卷移除，放到目标卷末尾
    }

    // 扩大目标卷范围
    targetVol.chapter_range[1] = Math.max(targetVol.chapter_range[1], chapNum)
    targetVol.chapter_range[0] = Math.min(targetVol.chapter_range[0], chapNum)

    // 重排序所有卷的 chapter_range
    const sorted = newVols.sort((a, b) => a.chapter_range[0] - b.chapter_range[0])
    sorted.forEach((v, i) => {
      v.volume_number = i + 1
    })

    saveVolumes(sorted)
    showToast('success', `第${chapNum}章已移至第${targetVolNum}卷`)
    loadAll()
  }

  // 拖拽状态
  const [dragChapter, setDragChapter] = useState<number | null>(null)

  // 全屏查看大纲/细纲
  const [fullView, setFullView] = useState<{ title: string; content: string } | null>(null)

  // 生成配置弹窗
  const [genConfig, setGenConfig] = useState<{
    open: boolean; title: string; desc: string; onConfirm: (c: any) => void
  }>({ open: false, title: '', desc: '', onConfirm: () => {} })

  // 重命名
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const startRename = () => { setRenameText(project?.title || ''); setRenaming(true) }
  const confirmRename = async () => {
    if (!renameText.trim() || !project || !window.electronAPI) { setRenaming(false); return }
    await window.electronAPI.db.run('UPDATE novel_projects SET title=?, updated_at=datetime("now","localtime") WHERE id=?', [renameText.trim(), project.id])
    setProject({ ...project, title: renameText.trim() })
    setRenaming(false)
    showToast('success', '书名已更新')
  }

  // 面板宽度 — 从本地记忆恢复
  const [leftWidth, setLeftWidth] = useState(() => {
    try { return parseInt(localStorage.getItem('workspace_leftWidth') || '') || 192 } catch { return 192 }
  })
  const [rightWidth, setRightWidth] = useState(() => {
    try { return parseInt(localStorage.getItem('workspace_rightWidth') || '') || 334 } catch { return 334 }
  })
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [showFuncBar, setShowFuncBar] = useState(false)

  // 面板宽度变化时持久化
  useEffect(() => { localStorage.setItem('workspace_leftWidth', String(leftWidth)) }, [leftWidth])
  useEffect(() => { localStorage.setItem('workspace_rightWidth', String(rightWidth)) }, [rightWidth])

  // ========== 叙事控制台 ==========
  const handleNarrativeReport = async () => {
    if (!window.electronAPI) return
    setNarrativeReportLoading(true)
    setNarrativeReport(null)
    cancelledRef.current = false
    try {
      // Gather data for the report
      const lcr = lastCheckResult
      const lls = lastLeakScore
      const led = lastEventData
      const cal = calibrationStats

      // Event stats string
      const eventTypeCounts: Record<string, number> = {}
      if (led) for (const e of led.events) { eventTypeCounts[e.event_type] = (eventTypeCounts[e.event_type] || 0) + 1 }
      const eventStats = led
        ? Object.entries(eventTypeCounts).map(([t, c]) => `${t}:${c}`).join(' ')
        : '暂无事件数据'

      const revealEst = led?.reveal_estimates
        ? `world+${led.reveal_estimates.world}% plot+${led.reveal_estimates.plot}% character+${led.reveal_estimates.character}%`
        : '暂无'

      // v4.0: 伏笔计数（从 story_tracker 读取）
      let activeFS = 0, resolvedFS = 0
      try {
        const fsTrackers = await trackerService.getMasterTracker(Number(id))
        for (const t of fsTrackers) {
          if (t.tracker_type === 'foreshadow') {
            try { const st = (typeof t.state === 'string' ? JSON.parse(t.state) : t.state) || {}; if (st.status === 'resolved') resolvedFS++; else if (st.status !== 'resolved') activeFS++ } catch {}
          }
        }
      } catch {}

      // v4.0: 最近摘要（从 story_tracker chapter 层读取）
      let recentSummaries = '暂无'
      try {
        const allChaps = await trackerService.getVolumeTracker(Number(id), volumes[volumes.length - 1]?.volume_number || 1)
        if (allChaps && allChaps.length > 0) {
          recentSummaries = allChaps.slice(-5).map((t: any) => `第${t.chapter_number}章 [${t.tracker_type}]: ${(t.summary || '').slice(0, 100)}`).join('\n')
        }
      } catch {}

      // v4.0: 当前天数（简化为从章数估算）
      let curDay = chapters.length

      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: NARRATIVE_STATE_REPORT_SYSTEM },
        {
          role: 'user', content: NARRATIVE_STATE_REPORT_USER(
            lcr?.hardViolationCount || 0,
            lls?.z || 0, lls?.raw || 0, lls?.threshold || 'unknown',
            cal?.chapters || 0, cal?.mean || 0, cal?.std || 0,
            eventStats, revealEst, curDay,
            activeFS, resolvedFS,
            recentSummaries,
          )
        },
      ], '叙事报告')

      const jm = reply.match(/\{[\s\S]*\}/)
      if (jm) {
        const parsed = JSON.parse(jm[0])
        setNarrativeReport({
          narrative_state: parsed.narrative_state || '',
          pacing: parsed.pacing || '',
          characters: parsed.characters || '',
          risk: parsed.risk || '',
          suggested_actions: (parsed.suggested_actions || []).map((a: any) => ({
            text: a.text || '', target_chapter: a.target_chapter || null, executable: false as const,
          })),
        })
      }
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消')
      else showToast('error', '报告生成失败：' + (e.message || '未知'))
    }
    finally { setNarrativeReportLoading(false) }
  }

  /** 将建议文本注入到额外提示框 */
  const handleInjectHint = (text: string) => {
    setGenHint(prev => prev ? `${prev}\n[建议] ${text}` : `[建议] ${text}`)
    showToast('success', '建议已注入到额外提示框')
  }

  /** 大纲标准化 */
  const [normalizing, setNormalizing] = useState(false)
  const handleNormalizeOutline = async () => {
    const sourceContent = fullscreenEdit?.content || outlineContent
    if (!sourceContent.trim()) return
    setNormalizing(true)
    cancelledRef.current = false
    try {
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: OUTLINE_NORMALIZE_SYSTEM },
        { role: 'user', content: OUTLINE_NORMALIZE_USER(sourceContent) },
      ], '大纲标准化')
      if (cancelledRef.current) return
      if (reply) {
        if (fullscreenEdit) {
          setFullscreenEdit({ ...fullscreenEdit, content: reply })
        } else {
          await saveOutline(reply)
        }
        showToast('success', '大纲已标准化')
      }
    } catch (e: any) {
      if (cancelledRef.current) return
      showToast('error', '标准化失败：' + (e.message || '未知错误'))
    } finally {
      setNormalizing(false)
    }
  }
  const cancelNormalize = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
    setNormalizing(false)
    showToast('info', '已取消标准化')
  }

  /** 保存版本历史 */
  const saveVersion = async (type: string, key: string, content: string) => {
    if (!window.electronAPI || !content.trim()) return
    try {
      const last = await window.electronAPI.db.get(
        'SELECT MAX(version) as v FROM version_history WHERE project_id = ? AND content_type = ? AND content_key = ?',
        [Number(id), type, key]
      )
      const nextV = (last?.v || 0) + 1
      await window.electronAPI.db.run(
        'INSERT INTO version_history (project_id, content_type, content_key, version, content) VALUES (?,?,?,?,?)',
        [Number(id), type, key, nextV, content]
      )
    } catch { /* best effort */ }
  }

  const loadHistory = async (type: string, key: string) => {
    if (!window.electronAPI) return
    try {
      const rows = await window.electronAPI.db.query(
        'SELECT * FROM version_history WHERE project_id = ? AND content_type = ? AND content_key = ? ORDER BY version DESC LIMIT 20',
        [Number(id), type, key]
      )
      setHistoryList(rows || [])
    } catch { setHistoryList([]) }
  }

  const cancelOperation = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
    setIdeaLoading(false); setGoldenLoading(false)
    setFixingViolations(false)
    showToast('info', '已取消')
  }

  /** 手动触发违规修改。mode='selected' 时分段修改选中段落，mode='full' 时全文修改 */
  const [fixingViolations, setFixingViolations] = useState(false)
  const handleFixViolations = async (
    mode: 'selected' | 'full' = 'full',
    selectedParagraphs?: { index: number; text: string }[]
  ) => {
    const ctx = rewriteCtxRef.current
    if (!ctx || !lastCheckResult || !editingContent || !window.electronAPI) return
    setFixingViolations(true)
    cancelledRef.current = false

    const { allFacts, timelineHistory, currentAbsoluteDay, stateDrift, narrativeMode, charNames, plan, chapNum } = ctx
    const cleanText = stripViolationMarkers(editingContent)

    // ── 分段修改模式 ──
    if (mode === 'selected' && selectedParagraphs && selectedParagraphs.length > 0) {
      try {
        showToast('info', `正在修改 ${selectedParagraphs.length} 个段落...`)

        // 构建分段改写 prompt
        const sections = selectedParagraphs.map((p, i) =>
          `[PARA_${p.index}] 原文：\n${p.text}\n\n请只输出修改后的段落文本（不要解释）：`
        ).join('\n\n---\n\n')

        const paraRewritePrompt = `你有 ${selectedParagraphs.length} 个段落需要修改。这些段落触发了以下违规规则：
${lastCheckResult!.violations.filter(v => v.source !== 'ai_suggestion').map(v => `- ${v.detail}`).join('\n')}

改写规则：
1. 只改违规涉及的内容，保持其他部分完全不变
2. 保持原文的风格、语调、人称、节奏
3. 不要增加新的情节、设定、或信息
4. 改写后必须比原文更保守

${sections}

重要：只输出修改后的段落文本，用 [PARA_END] 分隔。不要输出原文。不要任何解释。`

        const rewritten = await window.electronAPI!.aiChat([
          { role: 'system', content: '你是小说修改助手。按指令精准修改指定段落，只改违规部分。' },
          { role: 'user', content: paraRewritePrompt },
        ], '分段修改')

        if (!rewritten || cancelledRef.current) { setFixingViolations(false); return }

        // 解析 AI 返回的段落
        const rewrittenParas = rewritten.split(/\[PARA_END\]/).map(p => p.trim()).filter(Boolean)
        if (rewrittenParas.length === 0) {
          showToast('info', 'AI 未返回修改结果，请重试全文修改')
          setFixingViolations(false)
          return
        }

        // 将修改后的段落注入原文
        const allParas = cleanText.split(/\n\n+/)
        for (let i = 0; i < Math.min(selectedParagraphs.length, rewrittenParas.length); i++) {
          const origIdx = selectedParagraphs[i].index
          if (origIdx < allParas.length) {
            allParas[origIdx] = rewrittenParas[i]
          }
        }
        const newText = allParas.join('\n\n')

        // 复查
        const reCheck = checkChapter(
          newText, plan, allFacts, timelineHistory,
          currentAbsoluteDay, Number(id),
          undefined, undefined, stateDrift, narrativeMode as any,
        )

        setEditingContent(newText)
        await saveChapter(chapNum, plan.title, newText)
        setTimeout(() => editorRef.current?.scrollTo(0, 0), 100)

        if (reCheck.hardViolationCount === 0) {
          setLastCheckResult(null)
          setCheckedChapter(null)
          showToast('success', '分段修改完成，违规已全部修复')
        } else {
          // 还有剩余违规，重新标记
          const markers = buildViolationMarkers(reCheck.violations)
          const markedText = markers ? markers + '\n' + newText : newText
          setEditingContent(markedText)
          await saveChapter(chapNum, plan.title, markedText)
          setLastCheckResult({
            violations: [...reCheck.violations],
            concerns: [...reCheck.concerns],
            hardViolationCount: reCheck.hardViolationCount,
            leakScore: reCheck.leakScore,
          })
          setCheckedChapter(chapNum)
          showToast('info', `修改完成，剩余 ${reCheck.hardViolationCount} 处违规已重新标记`)
        }
      } catch {
        if (!cancelledRef.current) showToast('info', '分段修改失败，请重试全文修改')
      }
      setFixingViolations(false)
      return
    }

    // ── 全文修改模式 ──
    let activeText = cleanText
    let rewriteCount = 0
    const { maxRetries, entropyLimit } = DEFAULT_REWRITE_LIMIT
    let snapshot = takeSnapshot(activeText, chapNum, charNames)
    const checkResult: CheckResult = {
      violations: [...lastCheckResult.violations],
      concerns: [...lastCheckResult.concerns],
      hardViolationCount: lastCheckResult.hardViolationCount,
      leakScore: lastCheckResult.leakScore,
    }

    while (checkResult.hardViolationCount > 0 && rewriteCount <= maxRetries) {
      if (cancelledRef.current) break

      if (rewriteCount >= maxRetries) {
        activeText = buildViolationMarkers(checkResult.violations) + '\n' + activeText
        showToast('info', `修改${maxRetries}次仍未完全解决，已重新标记违规段落`)
        break
      }

      showToast('info', `正在修改违规 (${rewriteCount + 1}/${maxRetries})...`)

      try {
        const rewritePrompt = buildRewritePrompt(activeText, checkResult.violations, snapshot)
        const rewriteMsg = [
          { role: 'system' as const, content: '你是小说修改助手。按指令精准修改文本，只改违规部分。' },
          { role: 'user' as const, content: `原文：\n${activeText.slice(0, 6000)}\n\n${rewritePrompt}` },
        ]
        const rewritten = await window.electronAPI!.aiChat(rewriteMsg, '违规修改')

        if (!rewritten || cancelledRef.current) break

        if (rewritten.trim() === activeText.trim()) {
          activeText = buildViolationMarkers(checkResult.violations) + '\n' + activeText
          showToast('info', 'AI 未修改文本，请手动处理标记的违规段落')
          break
        }

        const diff = diffSnapshot(snapshot, rewritten, charNames)
        if (!diff.isStable || diff.semanticChangeRatio > 0.35) {
          activeText = buildViolationMarkers(checkResult.violations) + '\n' + activeText
          showToast('info', `修改语义漂移过大（${Math.round(diff.semanticChangeRatio * 100)}%），保留原文`)
          break
        }

        const infoLoss = calcInfoLoss(activeText, rewritten)
        if (infoLoss > entropyLimit) {
          activeText = buildViolationMarkers(checkResult.violations) + '\n' + activeText
          showToast('info', `修改信息损失 ${Math.round(infoLoss * 100)}% 超限，保留原文`)
          break
        }

        const reCheck = checkChapter(
          rewritten, plan, allFacts, timelineHistory,
          currentAbsoluteDay, Number(id),
          undefined, undefined, stateDrift, narrativeMode as any,
        )

        if (reCheck.hardViolationCount === 0) {
          activeText = rewritten
          setEditingContent(rewritten)
          await saveChapter(chapNum, plan.title, rewritten)
          setLastCheckResult(null)
          setCheckedChapter(null)
          showToast('success', '违规已全部修复')
          break
        }

        activeText = rewritten
        snapshot = takeSnapshot(rewritten, chapNum, charNames)
        checkResult.violations = reCheck.violations
        checkResult.hardViolationCount = reCheck.hardViolationCount
        if (reCheck.leakScore) checkResult.leakScore = reCheck.leakScore
        rewriteCount++
      } catch {
        activeText = buildViolationMarkers(checkResult.violations) + '\n' + activeText
        showToast('info', '修改调用失败，请手动处理标记的违规段落')
        break
      }
    }

    // 保存修改后的文本
    if (activeText !== cleanText) {
      setEditingContent(activeText)
      await saveChapter(chapNum, plan.title, activeText)
      setTimeout(() => editorRef.current?.scrollTo(0, 0), 100)
    }

    // 更新 checker 状态（必须新对象，否则 React 不重渲染）
    if (checkResult.hardViolationCount > 0) {
      setLastCheckResult({
        violations: [...checkResult.violations],
        concerns: [...checkResult.concerns],
        hardViolationCount: checkResult.hardViolationCount,
        leakScore: checkResult.leakScore,
      })
      setCheckedChapter(chapNum)
    }

    setFixingViolations(false)
  }

  /** 续写 */
  /** 编辑器选中文字 → 弹出禁用按钮（鼠标） */
  const handleTextSelect = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const ta = e.currentTarget
    checkSelection(ta, e.clientX, e.clientY)
  }

  /** 键盘选中（Shift+方向键等） */
  const handleKeySelect = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta' && !e.key.startsWith('Arrow')) return
    const ta = e.currentTarget
    const rect = ta.getBoundingClientRect()
    checkSelection(ta, rect.left + rect.width / 2, rect.top + rect.height / 2)
  }

  const checkSelection = (ta: HTMLTextAreaElement, x: number, y: number) => {
    // 延迟一帧，等浏览器更新 selection
    setTimeout(() => {
      const start = ta.selectionStart
      const end = ta.selectionEnd
      if (start === end) { setBanSelection(null); return }
      const selected = ta.value.slice(start, end).trim()
      if (selected.length < 2 || selected.length > 40) { setBanSelection(null); return }
      setBanSelection({ text: selected, x, y })
    }, 0)
  }

  /** 确认添加选中文字为禁用词 */
  const handleConfirmBan = (level: number) => {
    if (!banSelection) return
    const existing = getEffectivePatterns()
    // 检查是否已存在
    if (existing.some(p => p.pattern === banSelection.text)) {
      showToast('info', `"${banSelection.text}" 已在禁用词列表中`)
      setBanSelection(null)
      return
    }
    const next = [...existing, { pattern: banSelection.text, replacement: '', category: '自定义', level, enabled: true }]
    saveCustomBannedPatterns(next)
    showToast('success', `已添加禁用词：${banSelection.text}（L${level}）`)
    setBanSelection(null)
    setBanFormOpen(false)
  }

  /** 自动修改单章 */
  const autoFixChapter = async (chNum: number, issues: string[], fixPrompt: string) => {
    if (!window.electronAPI) return
    const chapter = chapters.find(c => c.chapter_number === chNum)
    if (!chapter?.content) { showToast('error', '该章无内容'); return }
    setFixingChapter(chNum)
    cancelledRef.current = false
    try {
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: AUTO_FIX_SYSTEM },
        { role: 'user', content: AUTO_FIX_USER(chNum, chapter.content, issues, fixPrompt) },
      ], '自动修改')
      // 去除 markdown 代码块
      let jsonStr = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = jsonStr.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', 'AI 返回格式异常，请重试'); return }
      const { fixes }: { fixes: { find: string; replace: string }[] } = JSON.parse(jm[0])
      let modified = chapter.content
      const skipped: string[] = []
      for (const f of fixes) {
        if (f.find === 'SKIP' || !f.find.trim()) { skipped.push(f.replace); continue }
        // 精确匹配：查找并替换（只替换第一个匹配）
        const idx = modified.indexOf(f.find)
        if (idx === -1) { skipped.push(`未找到匹配文本: "${f.find.slice(0, 50)}..."`); continue }
        // 确认唯一匹配
        const secondIdx = modified.indexOf(f.find, idx + 1)
        if (secondIdx !== -1) { skipped.push(`匹配不唯一: "${f.find.slice(0, 30)}..."`); continue }
        modified = modified.slice(0, idx) + f.replace + modified.slice(idx + f.find.length)
      }
      setFixPreview({ chapterNum: chNum, original: chapter.content, modified, skipped })
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消修改')
      else showToast('error', '自动修改失败：' + (e.message || '未知'))
    }
    finally { setFixingChapter(null) }
  }

  const applyFixPreview = async () => {
    if (!fixPreview || !window.electronAPI) return
    try {
      const chapter = chapters.find(c => c.chapter_number === fixPreview.chapterNum)
      if (!chapter) return
      await window.electronAPI.db.run(
        "UPDATE chapters SET content=?, word_count=?, status='edited', updated_at=datetime('now','localtime') WHERE id=?",
        [fixPreview.modified, fixPreview.modified.length, chapter.id]
      )
      setChapters(prev => prev.map(c =>
        c.chapter_number === fixPreview.chapterNum ? { ...c, content: fixPreview.modified, word_count: fixPreview.modified.length } : c
      ))
      if (selectedChapter === fixPreview.chapterNum) setEditingContent(fixPreview.modified)
      showToast('success', `第${fixPreview.chapterNum}章 已修改`)
      setFixPreview(null)
    } catch (e: any) { showToast('error', '保存失败') }
  }

  // ========== 导出 ==========
  const handleExport = async (format: 'txt' | 'docx' | 'md') => {
    if (chapters.length === 0) { showToast('error', '无已生成章节'); return }
    setShowExport(false)
    const t = project?.title || '未命名'
    try {
      if (format === 'txt') {
        const { exportToTxt } = await import('../../services/export')
        const text = exportToTxt(t, chapters)
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.txt`, filters: [{ name: 'TXT', extensions: ['txt'] }] })
        if (r) { await window.electronAPI.writeFile(r.filePath, text); showToast('success', '已导出') }
      } else if (format === 'docx') {
        const { exportToDocx } = await import('../../services/export')
        const blob = await exportToDocx(t, chapters)
        const ab = await blob.arrayBuffer(); const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)))
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.docx`, filters: [{ name: 'Word', extensions: ['docx'] }] })
        if (r) { await window.electronAPI.writeBuffer(r.filePath, b64); showToast('success', '已导出') }
      } else {
        const { exportToMd } = await import('../../services/export')
        const md = exportToMd(t, chapters)
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] })
        if (r) { await window.electronAPI.writeFile(r.filePath, md); showToast('success', '已导出') }
      }
    } catch (e: any) { showToast('error', '导出失败') }
  }

  // 面板拖拽
  const [dragging, setDragging] = useState<'left' | 'right' | null>(null)
  const handleDividerMouseDown = (side: 'left' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault()
    setDragging(side)
    const startX = e.clientX
    const startW = side === 'left' ? leftWidth : rightWidth
    const onMove = (ev: MouseEvent) => {
      const delta = side === 'left' ? ev.clientX - startX : startX - ev.clientX
      const newW = Math.max(140, Math.min(400, startW + delta))
      if (side === 'left') setLeftWidth(newW); else setRightWidth(newW)
    }
    const onUp = () => { setDragging(null); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ========== 渲染 ==========
  const chDone = (n: number): boolean => {
    const ch = chapters.find(c => c.chapter_number === n)
    return !!(ch && (ch.status === 'generated' || ch.status === 'edited'))
  }

  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (!project) return null
  genChapterRef.current = genChapter  // 始终保持指向最新闭包

  return (
    <div className="flex h-full">
      {/* ===== 左栏：章节目录 ===== */}
      <aside className="shrink-0 bg-bg-secondary/50 flex flex-col" style={{ width: leftCollapsed ? 36 : leftWidth }}>
        <div className="px-2 py-2.5 border-b border-border bg-bg-secondary flex items-center gap-1">
          {!leftCollapsed && <button onClick={() => navigate('/')} className="text-xs text-text-secondary hover:text-primary">← 返回</button>}
          {!leftCollapsed && renaming ? (
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onBlur={confirmRename}
              onKeyDown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') setRenaming(false) }}
              className="w-full mt-0.5 text-sm font-medium px-1 py-0.5 border border-primary rounded"
            />
          ) : (
            !leftCollapsed ? <h2 onClick={startRename} className="text-sm font-medium text-text-main mt-0.5 truncate cursor-pointer hover:text-primary" title="点击改名">
              {project.title}
            </h2> : null
          )}
          <button onClick={() => setLeftCollapsed(!leftCollapsed)}
            className="text-xs text-text-placeholder hover:text-text-main shrink-0 w-5 h-5 flex items-center justify-center ml-auto"
            title={leftCollapsed ? '展开目录' : '折叠目录'}
          >{leftCollapsed ? '▶' : '◀'}</button>
        </div>
        {!leftCollapsed && <>
          <div className="flex-1 overflow-auto py-1">
          {/* 新建章按钮 */}
          <button
            onClick={addChapter}
            className="w-full text-left px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-secondary flex items-center gap-1.5 border-b border-border mb-1"
          >
            <span>+</span>
            <span>新建章</span>
          </button>

          {chapterPlans.length === 0 ? (
            <p className="text-xs text-text-placeholder text-center py-8">暂无细纲</p>
          ) : (
            chapterPlans.map(p => (
              <div key={p.chapter_number} className="group flex items-center">
                <button
                  onClick={() => switchChapter(p.chapter_number)}
                  className={`flex-1 text-left px-3 py-1.5 text-xs flex items-center gap-1.5 transition-colors
                    ${selectedChapter === p.chapter_number ? 'bg-primary-light text-primary font-medium' : 'text-text-secondary hover:bg-bg-secondary'}
                  `}
                >
                  <span className={chDone(p.chapter_number) ? 'text-success' : 'text-text-placeholder'}>
                    {chDone(p.chapter_number) ? '●' : '○'}
                  </span>
                  <span className="truncate">{p.chapter_number}. {p.title}</span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteChapter(p.chapter_number) }}
                  className="px-1.5 text-xs text-text-placeholder hover:text-danger transition-colors shrink-0"
                  title="删除"
                >
                  x
                </button>
              </div>
            ))
          )}
          </div>
          <div className="px-3 py-2 border-t border-border text-xs text-text-placeholder flex justify-between">
            <span>{chapters.filter(c => c.status !== 'draft').length}/{chapterPlans.length} 章已写</span>
            <button onClick={addChapter} className="hover:text-primary">＋</button>
          </div>
        </>}
      </aside>

      {/* 左-中分隔线 */}
      <div
        onMouseDown={handleDividerMouseDown('left')}
        className={`w-1 cursor-col-resize shrink-0 transition-colors ${dragging === 'left' ? 'bg-primary' : 'bg-border hover:bg-primary/50'}`}
      />

      {/* ===== 中栏：编辑器 ===== */}
      <main className="flex-1 flex flex-col min-w-0 bg-bg-secondary">
        <div className="sticky top-0 z-10 bg-white border-b border-border px-4 py-2 flex items-center justify-between shrink-0">
          <span className="text-sm font-medium text-text-main">
            第 {selectedChapter} 章 · {chapterPlans.find(p => p.chapter_number === selectedChapter)?.title || '未命名'}
          </span>
          <div className="flex gap-1.5">
            {generating ? (
              <div className="flex items-center gap-1.5">
                <span className="px-3 py-1.5 text-xs text-warning flex items-center gap-1">
                  <div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> {genTarget || '生成中...'}
                </span>
                <button onClick={() => handleCancel()} className="px-2 py-1 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">取消</button>
              </div>
            ) : (
              <>
                <button onClick={() => setShowGenPanel(showGenPanel === 'chapter' ? null : 'chapter')}
                  className="px-3 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
                  {editingContent ? '重新生成' : '生成本章'}
                </button>
                {/* v3.0: 自动续写 — 点击弹出输入框 */}
                <button
                  onClick={() => {
                    const defaultEnd = queueEndChapter > 0 ? queueEndChapter
                      : (chapterPlans[chapterPlans.length - 1]?.chapter_number || selectedChapter)
                    setAutoContinueStart(String(selectedChapter))
                    setAutoContinueInput(String(defaultEnd))
                    setAutoContinueDialog(true)
                  }}
                  className="px-2.5 py-1.5 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary hover:border-primary/30"
                  title="点击设置自动续写范围"
                >
                  自动续写
                </button>
                {/* auto-continue inline dialog */}
                {autoContinueDialog && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => setAutoContinueDialog(false)}>
                    <div className="bg-white rounded-card border shadow-lg p-4 w-72" onClick={e => e.stopPropagation()}>
                      <div className="text-sm font-medium mb-3">自动续写设置</div>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs text-text-secondary shrink-0">起始章</span>
                        <input
                          type="number"
                          value={autoContinueStart}
                          onChange={e => setAutoContinueStart(e.target.value)}
                          min={1}
                          max={999}
                          className="w-full text-sm border border-border-input rounded px-2 py-1"
                        />
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs text-text-secondary shrink-0">终止章</span>
                        <input
                          type="number"
                          value={autoContinueInput}
                          onChange={e => setAutoContinueInput(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                          min={1}
                          max={999}
                          autoFocus
                          className="w-full text-sm border border-border-input rounded px-2 py-1"
                          placeholder={`默认 ${chapterPlans[chapterPlans.length - 1]?.chapter_number || selectedChapter}`}
                        />
                      </div>
                      <label className="flex items-center gap-1.5 text-xs text-text-secondary mb-3 cursor-pointer">
                        <input type="checkbox" checked={stopOnPlotDeviation} onChange={e => setStopOnPlotDeviation(e.target.checked)} className="accent-danger" />
                        剧情严重跑偏时暂停生成
                      </label>
                      {/* 风格库选择 */}
                      {styleLibraries.length > 0 && (
                        <div className="mb-2">
                          <span className="text-xs text-text-secondary block mb-1">风格库</span>
                          <select value={String(primaryStyleId ?? '')} onChange={e => {
                            const v = e.target.value
                            setPrimaryStyleId(v ? Number(v) : null)
                          }}
                            className="w-full text-xs border border-border-input rounded px-2 py-1 bg-white">
                            <option value="">不使用</option>
                            {styleLibraries.map(lib => (
                              <option key={lib.id} value={String(lib.id)}>{lib.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {/* 人格库选择 */}
                      {personalityProjects.length > 0 && (
                        <div className="mb-3">
                          <span className="text-xs text-text-secondary block mb-1">人格库</span>
                          <select value={String(primaryPersonalityId ?? '')} onChange={e => {
                            const v = e.target.value
                            setPrimaryPersonalityId(v ? Number(v) : null)
                          }}
                            className="w-full text-xs border border-border-input rounded px-2 py-1 bg-white">
                            <option value="">不使用</option>
                            {personalityProjects.map(p => (
                              <option key={p.id} value={String(p.id)}>{p.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            autoContinueRef.current = false
                            setQueueEndChapter(0)
                            setAutoContinueDialog(false)
                            showToast('info', '自动续写已停止')
                          }}
                          className="px-3 py-1.5 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary"
                        >停止续写</button>
                        <button
                          onClick={() => setAutoContinueDialog(false)}
                          className="px-3 py-1.5 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary"
                        >取消</button>
                        <button
                          onClick={async () => {
                            const startCh = parseInt(autoContinueStart)
                            const endCh = parseInt(autoContinueInput)
                            if (isNaN(startCh) || startCh < 1) { showToast('error', '请输入有效的起始章节'); return }
                            if (isNaN(endCh) || endCh < startCh) { showToast('error', '终止章必须大于等于起始章'); return }
                            setAutoContinueDialog(false)
                            setQueueEndChapter(endCh)
                            autoContinueRef.current = true
                            showToast('info', `自动续写：第${startCh}章 → 第${endCh}章（点「取消」可随时中断）`)

                            let curVol = volumes.find(v => startCh >= v.chapter_range[0] && startCh <= v.chapter_range[1])
                            if (!curVol) {
                              showToast('info', `正在生成第${volumes.length + 1}卷卷纲...`)
                              await genSingleVolume()
                              if (!autoContinueRef.current) return
                            }
                            let plan = chapterPlans.find(p => p.chapter_number === startCh)
                            if (!plan) {
                              try {
                                const row = await window.electronAPI!.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
                                if (row?.chapters) plan = JSON.parse(row.chapters).find((p: any) => p.chapter_number === startCh)
                              } catch {}
                            }
                            if (!plan) {
                              showToast('info', `正在生成第${startCh}章细纲...`)
                              await genSingleChapterPlan(startCh)
                              if (!autoContinueRef.current) return
                              try {
                                const row = await window.electronAPI!.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
                                if (row?.chapters) plan = JSON.parse(row.chapters).find((p: any) => p.chapter_number === startCh)
                              } catch {}
                              if (!plan) {
                                showToast('error', `第${startCh}章细纲生成后未找到记录`)
                                return
                              }
                            }
                            genChapterRef.current(startCh)
                          }}
                          className="px-3 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover"
                        >开始</button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            {editingContent && (
              <button onClick={() => { loadHistory('chapter', String(selectedChapter)); setHistoryModal({ type: 'chapter', key: String(selectedChapter), currentContent: editingContent }) }}
                className="px-3 py-1.5 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary">
                版本
              </button>
            )}
            <button onClick={handleSave} disabled={saving}
              className="px-3 py-1.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light disabled:opacity-50">
              {saving ? '...' : '保存'}
            </button>
            {editingContent && (
              <button onClick={optimizeChapter} disabled={optimizing || !editingContent.trim()}
                className="px-3 py-1.5 text-xs bg-success text-white rounded-btn hover:bg-success/80 disabled:opacity-50" title="禁词扫描->去AI味->Checker->修复->更新事实簿">
                {optimizing ? '...' : '优化'}
              </button>
            )}
            <div className="relative">
              <button onClick={() => setShowExport(!showExport)}
                className="px-2.5 py-1.5 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary">导出</button>
              {showExport && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-card border shadow-lg z-20 w-28">
                  {(['txt','docx','md'] as const).map(f => (
                    <button key={f} onClick={() => handleExport(f)}
                      className="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-secondary first:rounded-t-card last:rounded-b-card">
                      {f==='txt'?'📄 TXT':f==='docx'?'📝 Word':'📋 MD'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 细纲提示 — 默认折叠 */}
        {(() => {
          const plan = chapterPlans.find(p => p.chapter_number === selectedChapter) as any
          if (!plan) return null
          return (
            <div className="px-4 pt-2">
              <div className="bg-primary-light/10 rounded border border-primary/10 text-xs">
                <button onClick={() => setShowFuncBar(!showFuncBar)}
                  className="w-full px-3 py-1.5 flex items-center gap-2 text-text-secondary hover:text-text-main">
                  <span className="truncate">第{selectedChapter}章 · {plan.core_event || plan.summary || '—'}</span>
                  <span className="text-text-placeholder shrink-0 text-xxs">{showFuncBar ? '▲' : '▼'}</span>
                </button>
                {showFuncBar && (
                  <div className="px-3 pb-1.5 space-y-1.5 border-t border-primary/10 pt-1.5">
                    {plan.core_event && <div className="text-text-main">{plan.core_event}</div>}
                    {plan.emotional_arc && <div><span className="text-text-placeholder">情绪弧线：</span>{plan.emotional_arc}</div>}
                    {plan.plot_beats && plan.plot_beats.length > 0 ? (
                      <div>
                        <span className="text-text-placeholder">情节点（{plan.plot_beats.length}）：</span>
                        <div className="mt-0.5 space-y-0.5 max-h-32 overflow-auto">
                          {plan.plot_beats.map((b: string, i: number) => <div key={i} className="text-text-secondary">{i + 1}. {b}</div>)}
                        </div>
                      </div>
                    ) : (
                      <>
                        {plan.estimated_words > 0 && <span><span className="text-text-placeholder">字数：</span>{plan.estimated_words}字</span>}
                        {plan.summary && <span className="truncate"><span className="text-text-placeholder">概要：</span>{plan.summary}</span>}
                      </>
                    )}
                    {plan.cool_moment && <div><span className="text-text-placeholder">爽点：</span>{plan.cool_moment}</div>}
                    {plan.opening_hook && <div><span className="text-text-placeholder">章首钩子：</span>{plan.opening_hook.type} · {plan.opening_hook.detail}</div>}
                    {plan.closing_hook && <div><span className="text-text-placeholder">章尾钩子：</span>{plan.closing_hook.type}（期待度：{plan.closing_hook.impact}）</div>}
                    {plan.forbidden && plan.forbidden.length > 0 && (
                      <div><span className="text-text-placeholder">⛔ 禁区：</span>
                        {plan.forbidden.map((f: string, i: number) => <span key={i} className="text-danger">{i > 0 ? ' | ' : ''}{f}</span>)}
                      </div>
                    )}
                    {plan.scene_count && <div><span className="text-text-placeholder">🎬 场景数：</span>{plan.scene_count}个</div>}
                    {plan.emotion_cap && <div><span className="text-text-placeholder">💕 感情上限：</span>{plan.emotion_cap}</div>}
                    {plan.max_info_reveal && <div><span className="text-text-placeholder">🔐 信息上限：</span>{plan.max_info_reveal}</div>}
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* 生成选择面板 */}
        {showGenPanel && (
          <div className="mx-4 mt-2 bg-white rounded-card border border-primary/30 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text-main">
                🤖 生成{showGenPanel === 'outline' ? '大纲' : showGenPanel === 'volumes' ? '卷纲' : showGenPanel === 'detail' ? '细纲' : '章节'} — 选择参考
              </span>
              <button onClick={() => setShowGenPanel(null)} className="text-text-placeholder hover:text-text-main">✕</button>
            </div>
            <div className="flex gap-4">
              {showGenPanel === 'outline' || showGenPanel === 'volumes' ? (
                <>
                  <div className="flex-1">
                    <h4 className="text-xs font-medium text-text-main mb-1">📚 拆文库</h4>
                    {disassemblies.filter(d => d.current_stage >= 1).length === 0 ? <p className="text-xs text-text-placeholder">暂无</p> :
                      disassemblies.filter(d => d.current_stage >= 1).map(d => {
                        const isPrimary = primaryDissId === d.id
                        return (
                        <div key={d.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <input type="checkbox" checked={isPrimary}
                            onChange={() => {
                              if (!isPrimary) setAuxDissIds(prev => prev.filter(x => x !== d.id))
                              setPrimaryDissId(isPrimary ? null : d.id)
                            }} className="accent-primary" />
                          <span className="flex-1">{d.name}</span>
                          <input type="checkbox" checked={auxDissIds.includes(d.id)}
                            onChange={() => {
                              if (isPrimary) setPrimaryDissId(null)
                              setAuxDissIds(prev => prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id])
                            }} className="accent-primary" />
                          <span className="text-text-placeholder">辅</span>
                        </div>
                      )})}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-medium text-text-main mb-1">📋 设定库</h4>
                    {settingLibraries.length === 0 ? <p className="text-xs text-text-placeholder">暂无</p> :
                      settingLibraries.map(lib => {
                        const isPrimary = primarySettingLibId === lib.id
                        return (
                        <div key={lib.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <input type="checkbox" checked={isPrimary}
                            onChange={() => {
                              if (!isPrimary) setAuxSettingLibIds(prev => prev.filter(x => x !== lib.id))
                              setPrimarySettingLibId(isPrimary ? null : lib.id)
                            }} className="accent-primary" />
                          <span className="flex-1">{lib.name}</span>
                          <input type="checkbox" checked={auxSettingLibIds.includes(lib.id)}
                            onChange={() => {
                              if (isPrimary) setPrimarySettingLibId(null)
                              setAuxSettingLibIds(prev => prev.includes(lib.id) ? prev.filter(x => x !== lib.id) : [...prev, lib.id])
                            }} className="accent-primary" />
                          <span className="text-text-placeholder">辅</span>
                        </div>
                      )})}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex-1">
                    <h4 className="text-xs font-medium text-text-main mb-1">🎨 风格库</h4>
                    {styleLibraries.length === 0 ? <p className="text-xs text-text-placeholder">暂无</p> :
                      styleLibraries.map(lib => {
                        const isPrimary = primaryStyleId === lib.id
                        return (
                        <div key={lib.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <input type="checkbox" checked={isPrimary}
                            onChange={() => {
                              if (!isPrimary) setAuxStyleIds(prev => prev.filter(x => x !== lib.id))
                              setPrimaryStyleId(isPrimary ? null : lib.id)
                            }} className="accent-primary" />
                          <span className="flex-1">{lib.name}</span>
                          <input type="checkbox" checked={auxStyleIds.includes(lib.id)}
                            onChange={() => {
                              if (isPrimary) setPrimaryStyleId(null)
                              setAuxStyleIds(prev => prev.includes(lib.id) ? prev.filter(x => x !== lib.id) : [...prev, lib.id])
                            }} className="accent-primary" />
                          <span className="text-text-placeholder">辅</span>
                        </div>
                      )})}
                  </div>
                  <div className="flex-1">
                    <h4 className="text-xs font-medium text-text-main mb-1">🧠 人格库</h4>
                    {personalityProjects.filter(p => {
                      const d = p.personality_data as any
                      return !!(d?.emotion || d?.imagery || d?.dialogue || d?.private_imagery || d?.emotional_quirks)
                    }).length === 0 ? <p className="text-xs text-text-placeholder">暂无可用的</p> :
                      personalityProjects.filter(p => {
                        const d = p.personality_data as any
                        return !!(d?.emotion || d?.imagery || d?.dialogue || d?.private_imagery || d?.emotional_quirks)
                      }).map(p => {
                        const isPrimary = primaryPersonalityId === p.id
                        return (
                        <div key={p.id} className="flex items-center gap-1.5 text-xs py-0.5">
                          <input type="checkbox" checked={isPrimary}
                            onChange={() => {
                              if (!isPrimary) setAuxPersonalityIds(prev => prev.filter(x => x !== p.id))
                              setPrimaryPersonalityId(isPrimary ? null : p.id)
                            }} className="accent-primary" />
                          <span className="flex-1">{p.name}</span>
                          <input type="checkbox" checked={auxPersonalityIds.includes(p.id)}
                            onChange={() => {
                              if (isPrimary) setPrimaryPersonalityId(null)
                              setAuxPersonalityIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])
                            }} className="accent-primary" />
                          <span className="text-text-placeholder">辅</span>
                        </div>
                      )})}
                  </div>
                </>
              )}
            </div>
            <div>
              <textarea
                value={genHint}
                onChange={(e) => setGenHint(e.target.value)}
                placeholder="💡 额外提示（可选）..."
                rows={2}
                className="w-full px-3 py-1.5 text-xs border border-border-input rounded-btn resize-none focus:outline-none focus:border-primary placeholder:text-text-placeholder"
              />
            </div>
            {budgetInfo && showGenPanel === 'chapter' && (
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span>📊 上下文预算:</span>
                <span>角色 ~{budgetInfo.charTokens || 0} tokens</span>
                <span>· 总计 ~{Math.ceil((budgetInfo.totalChars || 0) * 0.4)} tokens</span>
                {(budgetInfo.totalChars || 0) * 0.4 > 5000 ? (
                  <span className="text-danger">⚠ 偏高</span>
                ) : (
                  <span className="text-green-600">✅ 适中</span>
                )}
              </div>
            )}
            {generating ? (
              <div className="flex gap-2">
                <span className="px-4 py-2 text-xs text-warning flex items-center gap-1"><div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> 生成中...</span>
                <button onClick={() => handleCancel()} className="px-4 py-2 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消生成</button>
              </div>
            ) : (
              <button onClick={confirmGen} className="px-4 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
                🤖 确定生成
              </button>
            )}
          </div>
        )}

        {/* 去AI味 */}
        {editingContent && (
          <div className="px-4 pt-2">
            <DeslopPanel
              content={editingContent}
              onApply={(c) => {
                setEditingContent(c)
                const plan = chapterPlans.find(p => p.chapter_number === selectedChapter)
                saveChapter(selectedChapter, plan?.title || `第${selectedChapter}章`, c)
              }}
              styleContext={buildStyleContext(primaryStyleId, auxStyleIds, styleLibraries)}
              personalityContext={buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects)}
              forbiddenContext={(chapterPlans.find(p => p.chapter_number === selectedChapter)?.forbidden || []).join('；')}
              projectId={Number(id)}
              chapterNum={selectedChapter}
              onMarksChange={(scores, selected) => setMarkData({ scores, selected })}
            />
          </div>
        )}

        {/* 编辑器 */}
        <div className="flex-1 min-h-0 overflow-auto py-6 px-8">
          <div className="max-w-[860px] mx-auto h-full">
          {(streamingText || generating) && genTarget === `第${selectedChapter}章` ? (
            <div className="w-full h-full shadow-card rounded-card overflow-auto flex flex-col">
              <div className="sticky top-0 z-10 flex items-center gap-2 px-6 py-3 bg-white/80 backdrop-blur border-b border-border">
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-text-secondary">AI 正在写作中...</span>
                <button onClick={() => handleCancel()} className="ml-auto px-2 py-0.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消</button>
              </div>
              <pre className="text-base text-text-main whitespace-pre-wrap leading-relaxed font-sans flex-1 min-h-0 overflow-auto p-8">
                {streamingText || '...'}
              </pre>
            </div>
          ) : showMarks && markData ? (
            /* 标记视图 */
            <div className="w-full h-full min-h-[400px] overflow-auto rounded-card bg-white shadow-card">
              <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-2 bg-bg-secondary border-b border-border">
                <span className="text-xs text-text-secondary">
                  🔍 标记视图 — {markData.scores.filter(s => s.score > 0).length} 段有问题，{markData.selected.size} 段已选
                </span>
                <button onClick={() => setShowMarks(false)}
                  className="px-2 py-1 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light">
                  ✏️ 返回编辑
                </button>
              </div>
              <div className="px-10 py-8 text-base leading-relaxed whitespace-pre-wrap font-sans">
                {(() => {
                  const paragraphs = editingContent.split(/\n\n+/)
                  return paragraphs.map((para, i) => {
                    const scoreItem = markData.scores.find(s => s.index === i)
                    const isSelected = markData.selected.has(i)
                    const hasIssue = scoreItem && scoreItem.score > 0

                    let bgClass = ''
                    let badge = ''
                    if (isSelected && hasIssue) {
                      bgClass = 'bg-warning/10 border-l-2 border-warning pl-3 -ml-3 rounded-r'
                      badge = `⭐${scoreItem!.score}`
                    } else if (hasIssue && !isSelected) {
                      bgClass = 'bg-gray-50 opacity-50'
                    }

                    return (
                      <p key={i} className={`mb-2 ${bgClass}`}>
                        {badge && <span className="text-xxs text-warning mr-1.5">{badge}</span>}
                        {para || ' '}
                      </p>
                    )
                  })
                })()}
              </div>
            </div>
          ) : (
            <>
              {markData && (
                <div className="flex justify-end mb-1.5">
                  <button onClick={() => setShowMarks(true)}
                    className="px-2 py-1 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary hover:border-primary hover:text-primary transition-colors">
                    🔍 标记段落
                  </button>
                </div>
              )}
              {/* 违规横幅 */}
              {lastCheckResult && lastCheckResult.hardViolationCount > 0 && checkedChapter === selectedChapter && (
                <div className="mb-2 px-4 py-2.5 bg-warning/10 border border-warning/30 rounded-btn flex items-start gap-2">
                  <span className="text-base shrink-0">⚠️</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-text-main font-medium">
                      硬违规 ({lastCheckResult.hardViolationCount} 处) — 已标记在正文顶部
                    </p>
                    <p className="text-xs text-text-secondary mt-0.5">
                      {lastCheckResult.violations.filter(v => v.source !== 'ai_suggestion').slice(0, 3).map((v, i) => (
                        <span key={i} className="block mt-0.5 text-text-placeholder truncate">· {v.detail}</span>
                      ))}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {fixingViolations ? (
                      <button onClick={cancelOperation}
                        className="px-3 py-1.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10 whitespace-nowrap">
                        ⏹ 取消修改
                      </button>
                    ) : (
                      <button onClick={() => handleFixViolations('full')}
                        className="px-3 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover whitespace-nowrap">
                        🔧 修改违规
                      </button>
                    )}
                    <button onClick={() => { setCheckedChapter(null); setLastCheckResult(null) }}
                      className="text-xs text-text-placeholder hover:text-text-secondary shrink-0">✕</button>
                  </div>
                </div>
              )}
              <textarea
                ref={editorRef}
                value={editingContent}
                onChange={(e) => setEditingContent(e.target.value)}
                onMouseUp={handleTextSelect}
                onKeyUp={handleKeySelect}
                className="w-full h-full min-h-[400px] px-10 py-8 text-base leading-relaxed
                  focus:outline-none focus:shadow-glow rounded-card resize-none
                  bg-white shadow-card placeholder:text-text-placeholder"
                placeholder="在左侧目录选择章节，点击「生成本章」开始..."
              />
              {/* 选中文字 → 浮动禁用按钮 */}
              {banSelection && !banFormOpen && (
                <div className="fixed z-50" style={{ left: banSelection.x - 60, top: banSelection.y - 40 }}>
                  <button
                    onClick={() => setBanFormOpen(true)}
                    className="px-2 py-1 text-xs bg-danger text-white rounded shadow-lg hover:bg-danger/80 whitespace-nowrap">
                    🚫 禁用此表达
                  </button>
                </div>
              )}
              {banSelection && banFormOpen && (
                <div className="fixed z-50 bg-white border border-border rounded-card shadow-lg p-3" style={{ left: banSelection.x - 100, top: banSelection.y - 50 }}>
                  <p className="text-xs text-text-main mb-2 truncate max-w-[220px]">添加禁用词："{banSelection.text}"</p>
                  <div className="flex items-center gap-1 mb-2">
                    <span className="text-xs text-text-secondary mr-1">毒级：</span>
                    {[1, 2, 3, 4, 5].map(l => (
                      <button key={l}
                        onClick={() => handleConfirmBan(l)}
                        className={`px-1.5 py-0.5 rounded text-xxs font-medium ${
                          l >= 4 ? 'bg-red-100 text-red-700 hover:bg-red-200' :
                          l >= 3 ? 'bg-orange-100 text-orange-700 hover:bg-orange-200' :
                          'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}>
                        L{l}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { setBanSelection(null); setBanFormOpen(false) }}
                    className="text-xs text-text-placeholder hover:text-text-secondary">取消</button>
                </div>
              )}
            </>
          )}
          </div>
        </div>
      </main>

      {/* 中-右分隔线 */}
      <div
        onMouseDown={handleDividerMouseDown('right')}
        className={`w-1 cursor-col-resize shrink-0 transition-colors ${dragging === 'right' ? 'bg-primary' : 'bg-border hover:bg-primary/50'}`}
      />

      {/* ===== 右栏：工具面板 ===== */}
      <aside className="shrink-0 bg-bg-secondary/50 flex flex-col min-h-0" style={{ width: rightCollapsed ? 36 : rightWidth }}>
        {/* Tab 切换 */}
        <div className="flex border-b border-border shrink-0 items-center">
          <button onClick={() => setRightCollapsed(!rightCollapsed)}
            className="text-xs text-text-placeholder hover:text-text-main shrink-0 w-6 h-6 flex items-center justify-center"
            title={rightCollapsed ? '展开面板' : '折叠面板'}
          >{rightCollapsed ? '◀' : '▶'}</button>
          {!rightCollapsed && (['outline', 'volumes', 'facts', 'review'] as const).map(tab => (
            <button key={tab}
              onClick={() => setRightTab(tab)}
              className={`flex-1 py-1 text-xs tracking-wide transition-colors text-center whitespace-nowrap
                ${rightTab === tab ? 'text-primary font-semibold' : 'text-text-secondary hover:text-text-main font-normal'}
              `}>
              <span className="relative inline-block pb-1">
                {{ outline: '大纲', volumes: '细纲', facts: '设计台', review: '检查' }[tab]}
                {rightTab === tab && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                )}
              </span>
            </button>
          ))}
        </div>

        {!rightCollapsed && <div className="flex-1 overflow-auto">
          {/* 大纲 Tab */}
          {rightTab === 'outline' && (
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-text-main">故事大纲</span>
                <div className="flex gap-2 items-center">
                  <button onClick={() => { loadHistory('outline', 'outline'); setHistoryModal({ type: 'outline', key: 'outline', currentContent: outlineContent }) }}
                    className="text-xs text-text-secondary hover:underline">历史</button>
                  <button onClick={() => setFullscreenEdit({ title: '编辑大纲', content: outlineContent, onSave: (c: string) => { saveOutline(c) } })}
                    className="text-xs text-primary hover:underline">编辑</button>
                  {outlineContent && (
                    <button onClick={() => setFullView({ title: '故事大纲', content: outlineContent })}
                      className="text-xs text-text-secondary hover:underline">查看</button>
                  )}
                  <button onClick={() => setShowGenPanel(showGenPanel === 'outline' ? null : 'outline')} disabled={generating}
                    className="text-xs text-primary hover:underline disabled:opacity-50">重新生成</button>
                </div>
              </div>
              {outlineContent ? (
                <pre className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed px-1">
                  {outlineContent}
                </pre>
              ) : (
                <div className="text-center py-4 space-y-3">
                  <p className="text-xs text-text-placeholder">尚无大纲</p>
                  <button onClick={() => setShowGenPanel(showGenPanel === 'outline' ? null : 'outline')} disabled={generating}
                    className="px-3 py-1 text-xs bg-primary text-white rounded-btn">🤖 直接生成大纲</button>
                  {/* 灵感脑洞 → 黄金三章 → 大纲 流程 */}
                  <div className="border-t border-border pt-3 mt-3">
                    <p className="text-xs text-text-secondary mb-2">💡 或者从灵感开始</p>
                    <textarea value={ideaInput} onChange={e => setIdeaInput(e.target.value)}
                      placeholder="输入一句话灵感，如：一个能看见死亡倒计时的程序员…"
                      className="w-full text-xs border border-border-input rounded p-2 resize-none h-16 mb-2"
                    />
                    {ideaLoading ? (
                      <button onClick={cancelOperation}
                        className="px-3 py-1 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">
                        ⏹ 取消
                      </button>
                    ) : (
                      <button onClick={handleGenerateIdea} disabled={!ideaInput.trim()}
                        className="px-3 py-1 text-xs bg-primary text-white rounded-btn disabled:opacity-50">
                        💡 生成脑洞
                      </button>
                    )}
                    {ideaData && (
                      <div className="mt-2 p-2 bg-bg-secondary rounded text-xs text-left space-y-1">
                        <p><b>核心梗：</b>{ideaData.hook}</p>
                        <p><b>题材：</b>{ideaData.genre} · <b>基调：</b>{ideaData.tone}</p>
                        <p><b>主角：</b>{ideaData.prototype}</p>
                        <div className="flex gap-2 mt-2">
                          {goldenLoading ? (
                            <button onClick={cancelOperation}
                              className="px-2 py-1 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">
                              ⏹ 取消
                            </button>
                          ) : (
                            <button onClick={handleGenerateGoldenThree}
                              className="px-2 py-1 text-xs bg-success text-white rounded-btn disabled:opacity-50">
                              📖 生成黄金三章
                            </button>
                          )}
                          {chapters.filter(c => c.chapter_number <= 3).length >= 3 && (
                            <button onClick={handleReverseOutline} disabled={generating}
                              className="px-2 py-1 text-xs border border-primary text-primary rounded-btn disabled:opacity-50">
                              📋 从三章出大纲
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 细纲 Tab */}
          {rightTab === 'volumes' && (
            <VolumePanel
              volumes={volumes} chapterPlans={chapterPlans}
              expandedVolume={expandedVolume} setExpandedVolume={setExpandedVolume}
              generating={generating} outlineContent={outlineContent}
              outlineVersion={outlineVersion}
              showGenPanel={showGenPanel} setShowGenPanel={setShowGenPanel}
              setGenDetailTarget={setGenDetailTarget}
              dragChapter={dragChapter} setDragChapter={setDragChapter}
              selectedChapter={selectedChapter}
              addVolume={addVolume} deleteVolume={deleteVolume}
              moveChapterToVolume={moveChapterToVolume}
              genSingleChapterPlan={genSingleChapterPlan}
              setFullView={setFullView} chDone={chDone}
              onUpdateVolume={updateVolume}
              onUpdateChapterPlan={updateChapterPlan}
              onFullscreenEdit={(title, content, onSave) => setFullscreenEdit({ title, content, onSave })}
            />
          )}

          {/* 设计台 Tab（设定/角色跟踪/事件跟踪/伏笔） */}
          {rightTab === 'facts' && (
            <DesignPanel
              projectId={Number(id)}
              outlineContent={outlineContent}
              chapters={chapters.map(c => ({ chapter_number: c.chapter_number, title: c.title, content: c.content }))}
              volumes={volumes}
              refreshKey={canonRefresh}
            />
          )}

          {/* 检查 Tab */}
          {rightTab === 'review' && (
            <CheckReportPanel projectId={Number(id)} volumes={volumes} refreshKey={canonRefresh} />
          )}

          {/* 自动修改预览弹窗 */}
          {fixPreview && (
            <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setFixPreview(null)}>
              <div className="bg-white rounded-card shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
                  <h3 className="text-sm font-medium">第{fixPreview.chapterNum}章 — 修改预览</h3>
                  <button onClick={() => setFixPreview(null)} className="text-text-placeholder hover:text-text-main">✕</button>
                </div>
                <div className="p-4 overflow-auto flex-1 space-y-3">
                  <div className="text-xs text-text-secondary">
                    <p className="font-medium mb-1">📝 修改后内容（红字为改动部分示意，请对照确认）</p>
                    <pre className="text-xs text-text-main whitespace-pre-wrap leading-relaxed max-h-64 overflow-auto bg-bg-secondary p-3 rounded">
                      {fixPreview.modified}
                    </pre>
                  </div>
                  {fixPreview.skipped.length > 0 && (
                    <div className="text-xs text-warning">
                      <p className="font-medium">⚠️ 以下问题未能自动修改（需手动处理）：</p>
                      <ul className="list-disc list-inside mt-1 space-y-0.5">
                        {fixPreview.skipped.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
                <div className="px-4 py-3 border-t border-border flex gap-2 justify-end shrink-0">
                  <button onClick={() => setFixPreview(null)} className="px-3 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary">取消</button>
                  <button onClick={applyFixPreview} className="px-3 py-1.5 text-xs bg-primary text-white rounded-btn">✅ 确认修改并保存</button>
                </div>
              </div>
            </div>
          )}
        </div>
        }
      </aside>

      {/* 生成配置弹窗 */}
      {genConfig.open && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={() => setGenConfig(prev => ({ ...prev, open: false }))}>
          <div className="bg-white rounded-card shadow-xl max-w-md w-full mx-4 max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
              <h2 className="text-lg">{genConfig.title}</h2>
              <button onClick={() => setGenConfig(prev => ({ ...prev, open: false }))} className="text-text-placeholder hover:text-text-main text-lg">✕</button>
            </div>
            <div className="px-5 py-3 space-y-3 overflow-auto flex-1">
              <p className="text-xs text-text-secondary">{genConfig.desc}</p>
              <div>
                <h4 className="text-xs font-medium text-text-main mb-1.5">🎨 风格库</h4>
                {styleLibraries.length === 0 ? <p className="text-xs text-text-placeholder">暂无</p> :
                  styleLibraries.map(lib => (
                    <label key={lib.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <input type="radio" name="cfgPrimary" checked={primaryStyleId === lib.id}
                        onChange={() => setPrimaryStyleId(primaryStyleId === lib.id ? null : lib.id)} className="accent-primary" />
                      <span className="flex-1">{lib.name}</span>
                      <input type="checkbox" checked={auxStyleIds.includes(lib.id)}
                        onChange={() => setAuxStyleIds(prev => prev.includes(lib.id) ? prev.filter(x => x !== lib.id) : [...prev, lib.id])}
                        disabled={primaryStyleId === lib.id} className="accent-primary" />
                      <span className="text-text-placeholder w-10">辅</span>
                    </label>
                  ))}
              </div>
              <div>
                <h4 className="text-xs font-medium text-text-main mb-1.5">📚 拆文库</h4>
                {disassemblies.filter(d => d.current_stage >= 1).length === 0 ? <p className="text-xs text-text-placeholder">暂无已拆解</p> :
                  disassemblies.filter(d => d.current_stage >= 1).map(d => (
                    <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <input type="checkbox" checked={auxDissIds.includes(d.id)}
                        onChange={() => setAuxDissIds(prev => prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id])} className="accent-primary" />
                      <span>{d.name}</span>
                    </label>
                  ))}
              </div>
              <div>
                <h4 className="text-xs font-medium text-text-main mb-1.5">🧠 人格库</h4>
                {personalityProjects.filter(p => {
                  const d = p.personality_data as any
                  return !!(d?.emotion || d?.imagery || d?.dialogue || d?.private_imagery || d?.emotional_quirks)
                }).length === 0 ? <p className="text-xs text-text-placeholder">暂无可用的</p> :
                  personalityProjects.filter(p => {
                    const d = p.personality_data as any
                    return !!(d?.emotion || d?.imagery || d?.dialogue || d?.private_imagery || d?.emotional_quirks)
                  }).map(p => (
                    <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer py-0.5">
                      <input type="radio" name="cfgPrimaryPersonality" checked={primaryPersonalityId === p.id}
                        onChange={() => setPrimaryPersonalityId(primaryPersonalityId === p.id ? null : p.id)} className="accent-primary" />
                      <span className="flex-1">{p.name}</span>
                      <input type="checkbox" checked={auxPersonalityIds.includes(p.id)}
                        onChange={() => setAuxPersonalityIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])}
                        disabled={primaryPersonalityId === p.id} className="accent-primary" />
                      <span className="text-text-placeholder w-10">辅</span>
                    </label>
                  ))}
              </div>
            </div>
            <div className="px-5 py-3 border-t border-border flex justify-end gap-2 shrink-0">
              <button onClick={() => setGenConfig(prev => ({ ...prev, open: false }))}
                className="px-4 py-2 text-xs border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary">取消</button>
              <button onClick={() => {
                const c = { primaryStyleId, auxStyleIds, primaryPersonalityId, auxPersonalityIds }
                setGenConfig(prev => ({ ...prev, open: false }))
                genConfig.onConfirm(c)
              }} className="px-4 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">🤖 确定生成</button>
            </div>
          </div>
        </div>
      )}

      {/* 全屏编辑弹窗 */}
      {fullscreenEdit && (
        <div className="fixed inset-0 z-50 bg-white flex flex-col" onClick={() => {}}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0">
            <span className="text-sm font-medium text-text-main">✏️ {fullscreenEdit.title}</span>
            <div className="flex gap-2">
              {normalizing ? (
                <button onClick={cancelNormalize}
                  className="px-4 py-2 border border-danger text-danger rounded-btn text-sm hover:bg-danger/10">
                  ⏹ 取消标准化
                </button>
              ) : (
                <button onClick={handleNormalizeOutline}
                  className="px-4 py-2 border border-primary text-primary rounded-btn text-sm hover:bg-primary-light">
                  🔧 标准化
                </button>
              )}
              <button onClick={() => { fullscreenEdit.onSave(fullscreenEdit.content); setFullscreenEdit(null) }}
                className="px-4 py-2 bg-primary text-white rounded-btn text-sm hover:bg-primary-hover">💾 保存并关闭</button>
              <button onClick={() => { if (normalizing) cancelNormalize(); setFullscreenEdit(null) }}
                className="px-4 py-2 border border-border-input text-text-secondary rounded-btn text-sm hover:bg-bg-secondary">取消</button>
            </div>
          </div>
          <textarea
            value={fullscreenEdit.content}
            onChange={e => setFullscreenEdit({ ...fullscreenEdit, content: e.target.value })}
            className="flex-1 w-full px-8 py-4 text-sm leading-relaxed resize-none focus:outline-none font-mono"
            spellCheck={false}
          />
        </div>
      )}

      {/* 全屏查看弹窗 */}
      {fullView && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setFullView(null)}>
          <div className="bg-white rounded-card shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="text-lg text-text-main">{fullView.title}</h2>
              <button onClick={() => setFullView(null)} className="w-8 h-8 flex items-center justify-center rounded-btn hover:bg-bg-secondary text-text-secondary">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-5 min-h-0">
              <pre className="text-base text-text-main whitespace-pre-wrap leading-relaxed font-sans">{fullView.content}</pre>
            </div>
            <div className="px-5 py-3 border-t border-border text-right">
              <button onClick={() => setFullView(null)} className="px-4 py-2 bg-primary text-white rounded-btn text-base hover:bg-primary-hover">关闭</button>
            </div>
          </div>
        </div>
      )}
      {/* 版本历史弹窗 */}
      {historyModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onClick={() => setHistoryModal(null)}>
          <div className="bg-white rounded-card shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-border">
              <h2 className="text-lg text-text-main">📜 历史版本</h2>
              <button onClick={() => setHistoryModal(null)} className="w-8 h-8 flex items-center justify-center rounded-btn hover:bg-bg-secondary text-text-secondary">✕</button>
            </div>
            <div className="flex-1 overflow-auto p-4 space-y-2 min-h-0">
              {historyList.length === 0 && <p className="text-sm text-text-placeholder text-center py-8">暂无历史版本</p>}
              {historyList.map((h: any, i: number) => (
                <div key={i} className="flex items-center gap-3 p-3 rounded bg-bg-secondary/50 hover:bg-bg-secondary">
                  <span className="text-xs text-text-secondary font-mono shrink-0">v{h.version}</span>
                  <span className="text-xs text-text-placeholder shrink-0">{h.created_at?.replace('T', ' ').slice(0, 16) || ''}</span>
                  <span className="text-xs text-text-main truncate flex-1">{h.content?.slice(0, 50) || ''}…</span>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => { setFullView({ title: `v${h.version} — ${h.created_at?.slice(0, 10) || ''}`, content: h.content }); setHistoryModal(null) }}
                      className="text-xs text-primary hover:underline">查看</button>
                    <button onClick={() => {
                      if (historyModal.type === 'outline') { saveOutline(h.content) }
                      else if (historyModal.type === 'chapter') { setEditingContent(h.content); saveChapter(Number(historyModal.key), '', h.content) }
                      else { historyModal.currentContent && historyModal.onRestore?.(h.content) }
                      setHistoryModal(null)
                      showToast('success', `已恢复 v${h.version}`)
                    }} className="text-xs text-danger hover:underline">恢复</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
