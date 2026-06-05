/**
 * Constraint Checker v2.2 — 三层检查器 + 三个稳定器
 *
 * ① deterministic layer：关键词 + 数值硬检测
 * ② structural parser：事件模式 + 时间线结构 + semantic leak scoring
 * ③ AI judge：叙事担忧（仅建议，不触发自动重写）
 *
 * 稳定器1：Calibration Layer — z-score 归一化
 * 稳定器2：Semantic Anchor Diff — entity+action+reveal 三元组
 * 稳定器3：Event Canonicalizer — 事件合并去重
 *
 * 核心原则：把判断权从 LLM 拿回到代码手里。
 */

import type { ChapterPlan, CanonFact, TimelineEvent } from '../types'

// ==================== 基础类型 ====================

export interface Violation {
  type: 'forbidden' | 'emotion_exceed' | 'info_reveal_exceed' | 'timeline_error'
  detail: string
  source: 'deterministic' | 'structural' | 'ai_suggestion'
  paragraphIndex?: number
}

export interface AIConcern {
  type: 'possible_leak' | 'emotion_rush' | 'info_rush'
  detail: string
  severity: 'low' | 'medium' | 'high'
}

export interface CheckResult {
  violations: Violation[]
  concerns: AIConcern[]
  hardViolationCount: number
  leakScore?: NormalizedLeakScore
}

export interface StatePatch {
  summary?: {
    chapter_number: number
    summary: string
    characters_appeared: string[]
    locations: string[]
    key_events: string[]
    time_labels: string[]
    absolute_day: number | null
    foreshadowing_planted: { id?: string; desc: string }[]
    foreshadowing_recovered: { id?: string; desc: string }[]
    character_changes: Record<string, string>
    world_changes: Record<string, string>
    relationship_changes: { char_a: string; char_b: string; chapter_number: number; relation_type: string; change_description: string }[]
  }
  foreshadowing_new?: { foreshadow_id: string; description: string; chapter_number: number }[]
  foreshadowing_done?: { foreshadow_id: string; chapter_number: number }[]
  timeline_events?: {
    chapter_number: number; event_order: number; event_description: string
    time_label: string; absolute_day: number | null; location: string
    characters_involved: string; is_major: number
  }[]
  character_arcs?: { character_name: string; chapter_number: number; change_type: string; change_description: string }[]
  relationship_changes?: { char_a: string; char_b: string; chapter_number: number; relation_type: string; change_description: string }[]
}

// ==================== 稳定器1：Calibration Layer ====================

export interface CalibrationStats {
  projectId: number
  samples: number
  mean: number
  m2: number            // Welford's M2 (sum of squared diffs from mean)
  min: number
  max: number
  chapterCount: number
}

export interface NormalizedLeakScore {
  raw: number
  z: number
  percentile: number
  threshold: 'safe' | 'watch' | 'elevated' | 'critical'
}

/** Per-project calibration store (in-memory, can be persisted to DB) */
const calibrationMap = new Map<number, CalibrationStats>()

function initCalibration(projectId: number): CalibrationStats {
  return { projectId, samples: 0, mean: 20, m2: 0, min: 0, max: 100, chapterCount: 0 }
}

/** Update calibration with a new raw score using Welford's online algorithm */
function updateCalibration(projectId: number, rawScore: number): void {
  let cal = calibrationMap.get(projectId)
  if (!cal) cal = initCalibration(projectId)

  cal.samples++
  cal.chapterCount++
  const delta = rawScore - cal.mean
  cal.mean += delta / cal.samples
  cal.m2 += delta * (rawScore - cal.mean)
  if (rawScore < cal.min) cal.min = rawScore
  if (rawScore > cal.max) cal.max = rawScore
  calibrationMap.set(projectId, cal)
}

/** Compute standard deviation from Welford's M2 */
function getStdDev(cal: CalibrationStats): number {
  if (cal.samples < 2) return 8
  return Math.sqrt(cal.m2 / (cal.samples - 1))
}

// ── 全局先验（基于典型网文章节的估计，虚拟 50 章） ──
const GLOBAL_PRIOR = { mean: 18, std: 6, virtualSamples: 50 }

/** Bayesian blend: 从小样本的全局先验平滑过渡到项目本地校准 */
function getBlendedStats(cal: CalibrationStats | undefined): { mean: number; std: number } {
  if (!cal || cal.samples < 3) {
    return { mean: GLOBAL_PRIOR.mean, std: GLOBAL_PRIOR.std }
  }
  const w = Math.min(1, cal.samples / 20)  // 0→1 over 20 chapters
  return {
    mean: w * cal.mean + (1 - w) * GLOBAL_PRIOR.mean,
    std: w * getStdDev(cal) + (1 - w) * GLOBAL_PRIOR.std,
  }
}

/** Approximate percentile from z-score (normal distribution) */
function zToPercentile(z: number): number {
  // Abramowitz approximation for normal CDF
  const absZ = Math.abs(z)
  const t = 1 / (1 + 0.2316419 * absZ)
  const d = 0.3989423 * Math.exp(-absZ * absZ / 2)
  const prob = 1 - d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return Math.round((z > 0 ? prob : 1 - prob) * 1000) / 10
}

/** Normalize a raw score using per-project calibration blended with global prior */
export function normalizeLeakScore(projectId: number, rawScore: number): NormalizedLeakScore {
  const cal = calibrationMap.get(projectId)
  const { mean, std } = getBlendedStats(cal)
  const z = std > 0.01 ? (rawScore - mean) / std : 0
  const percentile = zToPercentile(z)

  let threshold: NormalizedLeakScore['threshold']
  if (z >= 3.0 || rawScore >= 70) threshold = 'critical'
  else if (z >= 2.0 || rawScore >= 40) threshold = 'elevated'
  else if (z >= 1.0 || rawScore >= 20) threshold = 'watch'
  else threshold = 'safe'

  return { raw: rawScore, z: Math.round(z * 100) / 100, percentile, threshold }
}

/** Get calibration stats for UI display */
export function getCalibrationStats(projectId: number): { chapters: number; mean: number; std: number } | null {
  const cal = calibrationMap.get(projectId)
  if (!cal || cal.samples < 1) return null
  return { chapters: cal.chapterCount, mean: Math.round(cal.mean * 10) / 10, std: Math.round(getStdDev(cal) * 10) / 10 }
}

/** Export calibration data for DB persistence (returned as JSON string) */
export function exportCalibration(projectId: number): string | null {
  const cal = calibrationMap.get(projectId)
  if (!cal) return null
  return JSON.stringify(cal)
}

/** Import calibration data from DB */
export function importCalibration(projectId: number, json: string): void {
  try {
    const cal = JSON.parse(json) as CalibrationStats
    calibrationMap.set(projectId, cal)
  } catch { /* ignore corrupt data */ }
}

// ==================== 连续影响力模型 ====================

const TIER_CEILINGS: Record<string, number> = {
  speculative: 0.6,
  soft_canon: 0.9,
  hard_canon: 1.0,
}

/** 从 canon_facts.details JSON 读取连续值 */
function getTruthValues(fact: { details?: string }): { tv: number; stability: number; cw: number; non_collapse: boolean } {
  let d: any = {}
  try { d = JSON.parse(fact.details || '{}') } catch {}
  return {
    tv: typeof d.truth_value === 'number' ? d.truth_value : (d.is_hard_rule ? 0.9 : 0.5),
    stability: typeof d.stability === 'number' ? d.stability : 0.5,
    cw: typeof d.conflict_weight === 'number' ? d.conflict_weight : 0,
    non_collapse: d.non_collapse === true,
  }
}

/** 从 truth_value 计算 canon_tier */
function computeTier(tv: number): 'speculative' | 'soft_canon' | 'hard_canon' {
  if (tv >= 0.8) return 'hard_canon'
  if (tv >= 0.4) return 'soft_canon'
  return 'speculative'
}

/** 计算内生状态漂移 */
export function computeStateDrift(
  activeConflicts: number,
  speculativeCount: number,
  avgStability: number,
): number {
  const computed = activeConflicts * 0.1 + speculativeCount * 0.05 + (1 - avgStability) * 0.15
  const modeled = 1 / (1 + Math.exp(-(computed - 0.3) * 8))
  const noiseFloor = 0.03
  return modeled + noiseFloor
}

// ==================== 叙事模式选择器 ====================

export type NarrativeMode = 'stable' | 'explore' | 'decay' | 'conflict_peak'

/** 每章选择一个主模式，统一 truth_value/drift/decay 的方向 */
export function selectMode(
  chapterInVol: number,
  totalInVol: number,
  activeConflicts: number,
  prevDrift: number,
): NarrativeMode {
  if (totalInVol <= 1) return 'stable'
  const pos = chapterInVol / totalInVol
  if (pos <= 0.2) return 'explore'
  if (pos >= 0.85 || activeConflicts >= 3) return 'conflict_peak'
  if (prevDrift > 0.6) return 'decay'
  return 'stable'
}

/** 按模式权重化 tv 增量 */
export function modeTvDelta(mode: NarrativeMode): number {
  switch (mode) {
    case 'stable': return 0.15
    case 'explore': return 0.05
    case 'decay': return -0.05
    case 'conflict_peak': return -0.02
  }
}

/** 按模式权重化 decay 速率 */
export function modeDecayRate(mode: NarrativeMode): number {
  switch (mode) {
    case 'stable': return 0.03
    case 'explore': return 0.01
    case 'decay': return 0.06
    case 'conflict_peak': return 0.02
  }
}

/** 按模式额外注入 drift */
export function modeDriftBonus(mode: NarrativeMode): number {
  switch (mode) {
    case 'stable': return 0
    case 'explore': return 0.1
    case 'decay': return 0.05
    case 'conflict_peak': return 0.2
  }
}

// ==================== ① Deterministic Layer ====================

function extractKeywords(forbiddenRule: string): string[] {
  const cleaned = forbiddenRule
    .replace(/^禁止[：:]\s*/i, '')
    .replace(/^禁止\s*/i, '')
    .trim()

  const quoted: string[] = []
  const qm = cleaned.match(/[""「」『』"]([^""「」『』""]{1,20})[""「」『』""]/g)
  if (qm) {
    for (const q of qm) {
      quoted.push(q.replace(/[""「」『』""]/g, ''))
    }
  }

  const entities = cleaned.match(/[一-鿿]{2,4}/g) || []
  const keywords = [...new Set([...quoted, ...entities])]
  if (keywords.length === 0 && cleaned.length > 0) {
    keywords.push(cleaned.slice(0, 20))
  }
  return keywords.filter(k => k.length >= 2)
}

function getForbiddenCategory(rule: string): string {
  if (rule.includes('身份') || rule.includes('真实') || rule.includes('暴露') || rule.includes('揭露') || rule.includes('秘密')) return 'identity'
  if (rule.includes('感情') || rule.includes('表白') || rule.includes('亲吻') || rule.includes('肢体') || rule.includes('恋爱') || rule.includes('关系')) return 'romance'
  if (rule.includes('真相') || rule.includes('谜底') || rule.includes('幕后') || rule.includes('终极') || rule.includes('黑手')) return 'truth'
  if (rule.includes('能力') || rule.includes('金手指') || rule.includes('升级') || rule.includes('突破') || rule.includes('觉醒')) return 'power'
  if (rule.includes('新角色') || rule.includes('引入') || rule.includes('出场')) return 'character'
  if (rule.includes('死亡') || rule.includes('死') || rule.includes('杀')) return 'death'
  return 'general'
}

export function checkHardRules(
  chapterText: string,
  forbiddenList: string[],
  allowedReveal: { world: number; plot: number; character: number } | undefined,
  emotionCap: string | undefined,
  recordedReveal?: { world: number; plot: number; character: number },
  recordedEmotion?: number,
  stateDrift?: number,
  mode?: NarrativeMode,
): Violation[] {
  const violations: Violation[] = []

  for (let fi = 0; fi < forbiddenList.length; fi++) {
    const rule = forbiddenList[fi]
    const keywords = extractKeywords(rule)
    const category = getForbiddenCategory(rule)

    for (const kw of keywords) {
      if (!kw) continue
      const idx = chapterText.indexOf(kw)
      if (idx !== -1) {
        const contextStart = Math.max(0, idx - 40)
        const contextEnd = Math.min(chapterText.length, idx + kw.length + 40)
        const context = chapterText.slice(contextStart, contextEnd)

        if (category === 'identity' || category === 'truth' || category === 'death') {
          violations.push({
            type: 'forbidden',
            detail: `禁止规则"${rule}"被触发：正文出现"${kw}"（上下文："${context.replace(/\n/g, ' ')}"）`,
            source: 'deterministic',
            paragraphIndex: Math.round(idx / 100),
          })
          break
        } else {
          const beforeKw = chapterText.slice(contextStart, idx)
          const inDialogue = beforeKw.includes('"') || beforeKw.includes('"') || beforeKw.includes('「')
          if (!inDialogue && kw.length >= 3) {
            violations.push({
              type: 'forbidden',
              detail: `禁止规则"${rule}"可能被触发：正文出现"${kw}"（非对话场景）`,
              source: 'deterministic',
              paragraphIndex: Math.round(idx / 100),
            })
            break
          }
        }
      }
    }
  }

  if (allowedReveal && recordedReveal) {
    const dims: ('world' | 'plot' | 'character')[] = ['world', 'plot', 'character']
    const dimLabels: Record<string, string> = { world: '世界观', plot: '主线', character: '感情' }
    for (const dim of dims) {
      const allowed = allowedReveal[dim] || 0
      const actual = recordedReveal[dim] || 0
      if (actual > allowed * 1.5 && allowed > 0) {
        violations.push({
          type: 'info_reveal_exceed',
          detail: `${dimLabels[dim]}公开度：允许+${allowed}%，实际推进约${actual}%（超出阈值）`,
          source: 'deterministic',
        })
      } else if (actual > allowed && allowed > 0) {
        violations.push({
          type: 'info_reveal_exceed',
          detail: `${dimLabels[dim]}公开度：允许+${allowed}%，实际推进约${actual}%（轻微超出）`,
          source: 'deterministic',
        })
      }
    }
  }

  if (emotionCap && recordedEmotion != null) {
    const capMatch = emotionCap.match(/(\d+\.?\d*)/)
    if (capMatch && recordedEmotion > parseFloat(capMatch[1])) {
      violations.push({
        type: 'emotion_exceed',
        detail: `感情上限${capMatch[0]}，实际推进到${recordedEmotion}`,
        source: 'deterministic',
      })
    }
  }

  // ── Drift + Mode 放宽 ──
  const effectiveDrift = (stateDrift || 0) + modeDriftBonus(mode || 'stable')
  if (effectiveDrift > 0.4) {
    return violations.filter(v => v.type === 'forbidden' || v.type === 'timeline_error')
  }
  if (mode === 'conflict_peak') {
    // 冲突高峰：只保留 forbidden，连 info_reveal 和 emotion 都放掉
    return violations.filter(v => v.type === 'forbidden')
  }

  return violations
}

// ==================== ② Structural Parser ====================

export function checkStructure(
  chapterText: string,
  chapterPlan: ChapterPlan,
  _facts: CanonFact[],
  timelineHistory: TimelineEvent[],
  currentAbsoluteDay: number | null,
): Violation[] {
  const violations: Violation[] = []

  const forbiddenList = chapterPlan.forbidden || []
  for (const rule of forbiddenList) {
    const category = getForbiddenCategory(rule)

    if (category === 'identity') {
      const keywords = extractKeywords(rule)
      for (const kw of keywords) {
        if (kw.length < 2) continue
        const pattern = new RegExp(`${kw}[^。！？\\n]{0,15}(是|就是|原来|竟然|居然|其实|真实身份|真正)`, 'g')
        const matches = chapterText.match(pattern)
        if (matches && matches.length > 0) {
          violations.push({
            type: 'forbidden',
            detail: `结构检测：禁止的身份信息"${kw}"似乎被揭示（匹配到${matches.length}处疑似暴露）`,
            source: 'structural',
          })
          break
        }
      }
    }

    if (category === 'romance') {
      const keywords = extractKeywords(rule)
      for (const kw of keywords) {
        if (kw.length < 2) continue
        const romancePatterns = [
          new RegExp(`${kw}[^。！？]{0,20}(吻|抱|牵|碰|触|靠|贴|拥)`),
          new RegExp(`(吻|抱|牵|碰|触|靠|贴|拥)[^。！？]{0,20}${kw}`),
        ]
        for (const rp of romancePatterns) {
          if (rp.test(chapterText)) {
            violations.push({
              type: 'forbidden',
              detail: `结构检测：禁止的感情内容"${kw}"可能已发生（匹配亲密动作模式）`,
              source: 'structural',
            })
            break
          }
        }
      }
    }

    if (category === 'truth') {
      const keywords = extractKeywords(rule)
      for (const kw of keywords) {
        if (kw.length < 2) continue
        const revealPattern = new RegExp(`${kw}[^。！？]{0,20}(真相|秘密|其实|原来|从来|根本|根本)`, 'g')
        if (revealPattern.test(chapterText)) {
          violations.push({
            type: 'forbidden',
            detail: `结构检测：禁止揭示的真相"${kw}"可能已被揭示`,
            source: 'structural',
          })
          break
        }
      }
    }
  }

  if (currentAbsoluteDay != null && currentAbsoluteDay > 0) {
    const dayPatterns = [/第(\d+)\s*天/g, /(\d+)\s*天[前后]/g, /第(\d+)\s*日/g]
    for (const dp of dayPatterns) {
      let m: RegExpExecArray | null
      while ((m = dp.exec(chapterText)) !== null) {
        const dayNum = parseInt(m[1])
        if (!isNaN(dayNum) && dayNum > 0 && dayNum < currentAbsoluteDay - 1) {
          violations.push({
            type: 'timeline_error',
            detail: `时间线异常：当前第${currentAbsoluteDay}天，但正文出现"第${dayNum}天"（可能是闪回未标注）`,
            source: 'structural',
          })
          break
        }
      }
    }
  }

  return violations
}

// ==================== ③ Semantic Leak Scorer ====================

export interface LeakSignal {
  dimension: string
  score: number
  evidence: string[]
}

export interface RawLeakScore {
  total: number
  signals: LeakSignal[]
}

// ── Reveal-intent verbs ──
const REVEAL_VERBS = ['知道', '明白', '发现', '意识到', '终于', '原来如此', '懂了', '恍然', '醒悟', '察觉']

// ── Identity-reveal patterns in close proximity ──
const IDENTITY_PROXIMITY_VERBS = ['是', '就是', '其实是', '原来是', '竟然是', '居然是', '真实身份', '真正的', '并非', '不是']

// ── World-building leak indicators ──
const WORLD_LEAK_INDICATORS = ['因为', '所以', '由于', '导致', '规则', '力量', '能力', '等级', '系统', '设定']

// ── Emotional spike indicators ──
const EMOTIONAL_SPIKE_MARKERS = /!{2,}|！{2,}|([^。！？\n]{1,8}\n){3,}/g  // multiple ! or consecutive short lines

/**
 * Semantic Leak Scorer — 不是判违规，是算风险分数
 * 5 维加权：forbidden_density(0.3) + identity_overlap(0.25) + world_bleed(0.2) + reveal_verbs(0.15) + emotion_spike(0.1)
 */
export function scoreSemanticLeak(
  chapterText: string,
  forbiddenList: string[],
  facts: CanonFact[],
  projectId: number,
): { normalized: NormalizedLeakScore; signals: LeakSignal[] } {
  const totalChars = chapterText.length || 1
  const signals: LeakSignal[] = []

  // ── Signal 1: forbidden term density (weight 0.3) ──
  let forbiddenHits = 0
  const hitEvidence: string[] = []
  for (const rule of forbiddenList) {
    const keywords = extractKeywords(rule)
    for (const kw of keywords) {
      let pos = 0
      while (pos < chapterText.length) {
        const idx = chapterText.indexOf(kw, pos)
        if (idx === -1) break
        forbiddenHits++
        if (hitEvidence.length < 3) {
          const ctx = chapterText.slice(Math.max(0, idx - 15), Math.min(chapterText.length, idx + kw.length + 15))
          hitEvidence.push(ctx.replace(/\n/g, ' '))
        }
        pos = idx + 1
      }
    }
  }
  const densityScore = Math.min(1, forbiddenHits / (totalChars * 0.002)) * 100
  signals.push({ dimension: 'forbidden_term_density', score: densityScore, evidence: hitEvidence.slice(0, 3) })

  // ── Signal 2: identity context overlap (weight 0.25) ──
  // Character names + identity-reveal verbs within 50-char window
  const charNames = facts
    .filter(f => f.fact_category === 'character')
    .map(f => f.fact_key)
    .filter(n => n.length >= 2)
  let identityOverlaps = 0
  const identityEvidence: string[] = []
  for (const name of charNames) {
    const nameIdx = chapterText.indexOf(name)
    if (nameIdx === -1) continue
    const window50 = chapterText.slice(nameIdx, Math.min(chapterText.length, nameIdx + 50))
    for (const verb of IDENTITY_PROXIMITY_VERBS) {
      if (window50.includes(verb)) {
        identityOverlaps++
        if (identityEvidence.length < 3) {
          identityEvidence.push(`"${name}" + "${verb}" 共现于: "${window50.slice(0, 40).replace(/\n/g, ' ')}..."`)
        }
        break
      }
    }
  }
  const identityScore = Math.min(1, identityOverlaps / Math.max(1, charNames.length)) * 100
  signals.push({ dimension: 'identity_context_overlap', score: identityScore, evidence: identityEvidence.slice(0, 3) })

  // ── Signal 3: world knowledge bleed (weight 0.2) ──
  // Setting/rule terms appearing outside explanatory context
  const worldTerms = facts
    .filter(f => f.fact_category === 'setting' || f.fact_category === 'rule')
    .map(f => f.fact_key)
    .filter(k => k.length >= 2)
  let worldBleeds = 0
  const bleedEvidence: string[] = []
  for (const term of worldTerms) {
    let pos = 0
    while (pos < chapterText.length) {
      const idx = chapterText.indexOf(term, pos)
      if (idx === -1) break
      // Check if term appears in non-explanatory context (not preceded by "是"/"指")
      const before = chapterText.slice(Math.max(0, idx - 20), idx)
      const isExplanatory = /(是|指|即|所谓|定义|称为|说明)/.test(before)
      if (!isExplanatory && before.includes(term)) {
        worldBleeds++
        if (bleedEvidence.length < 3) {
          bleedEvidence.push(`"${term}" 出现在非说明语境: "${before.slice(-20).replace(/\n/g, ' ')}${term}"`)
        }
      }
      pos = idx + 1
    }
  }
  const worldBleedScore = Math.min(1, worldBleeds / Math.max(1, worldTerms.length * 0.5)) * 100
  signals.push({ dimension: 'world_knowledge_bleed', score: worldBleedScore, evidence: bleedEvidence.slice(0, 3) })

  // ── Signal 4: reveal-intent verb density (weight 0.15) ──
  let revealHits = 0
  const revealEvidence: string[] = []
  for (const verb of REVEAL_VERBS) {
    let pos = 0
    while (pos < chapterText.length) {
      const idx = chapterText.indexOf(verb, pos)
      if (idx === -1) break
      revealHits++
      if (revealEvidence.length < 3) {
        const ctx = chapterText.slice(Math.max(0, idx - 10), Math.min(chapterText.length, idx + verb.length + 10))
        revealEvidence.push(ctx.replace(/\n/g, ' '))
      }
      pos = idx + 1
    }
  }
  const revealScore = Math.min(1, revealHits / (totalChars * 0.003)) * 100
  signals.push({ dimension: 'reveal_intent_verbs', score: revealScore, evidence: revealEvidence.slice(0, 3) })

  // ── Signal 5: emotional spike proximity (weight 0.1) ──
  const spikeMatches = chapterText.match(EMOTIONAL_SPIKE_MARKERS) || []
  const spikeCount = spikeMatches.length
  // Check if any forbidden keywords appear near emotional spikes
  let spikeOverlaps = 0
  const spikeEvidence: string[] = []
  for (const rule of forbiddenList) {
    const kw = extractKeywords(rule)[0]
    if (!kw) continue
    for (const spike of spikeMatches.slice(0, 5)) {
      const spikeIdx = chapterText.indexOf(spike)
      if (spikeIdx === -1) continue
      const window100 = chapterText.slice(Math.max(0, spikeIdx - 50), Math.min(chapterText.length, spikeIdx + spike.length + 50))
      if (window100.includes(kw)) {
        spikeOverlaps++
        if (spikeEvidence.length < 3) spikeEvidence.push(`情绪峰 + "${kw}" 在附近`)
      }
    }
  }
  const spikeScore = Math.min(1, (spikeCount / 10 + spikeOverlaps / 2)) * 100
  signals.push({ dimension: 'emotional_spike_proximity', score: spikeScore, evidence: spikeEvidence.slice(0, 3) })

  // ── Weighted total ──
  const weights = { forbidden_term_density: 0.3, identity_context_overlap: 0.25, world_knowledge_bleed: 0.2, reveal_intent_verbs: 0.15, emotional_spike_proximity: 0.1 }
  const total = signals.reduce((sum, s) => sum + (weights[s.dimension as keyof typeof weights] || 0) * s.score, 0)

  // ── Update calibration ──
  updateCalibration(projectId, total)

  return {
    normalized: normalizeLeakScore(projectId, total),
    signals,
  }
}

// ==================== 稳定器2：Semantic Anchor Diff ====================

/** 动作动词词表（中文高频动作动词） */
const ACTION_VERBS = new Set([
  '说', '问', '答', '喊', '叫', '笑', '哭', '叹', '道', '讲', '听', '看', '望', '盯', '瞪',
  '走', '跑', '跳', '站', '坐', '躺', '倒', '爬', '冲', '退', '进', '出', '来', '去',
  '打', '推', '拉', '抓', '握', '拿', '放', '扔', '摔', '砸', '碰', '触', '拍', '敲',
  '吃', '喝', '咬', '吞', '吐',
  '开', '关', '推', '翻', '拆',
  '杀', '死', '伤', '流血',
  '抱', '吻', '牵', '靠', '贴', '拥',
  '写', '画', '刻', '读',
  '沉默', '离开', '留下', '转身', '回头', '停下', '等待',
])

const REVEAL_FLAG_VERBS = new Set(['知道', '明白', '发现', '意识到', '原来', '其实', '真相', '秘密', '真正', '真实', '身份', '终于', '揭露', '揭示'])

export interface SemanticAnchor {
  paragraphIndex: number
  entities: string[]        // 角色名 + 关键物品/地点
  actionVerbs: string[]     // 动作动词
  revealFlags: string[]     // 信息揭示信号词
  firstSentence: string     // 段落首句（20字）
}

export interface SceneSnapshot {
  chapterNumber: number
  originalText: string
  anchors: SemanticAnchor[]
  totalParas: number
}

export interface SceneDiff {
  unchangedCount: number
  changedIndices: number[]
  changedRatio: number
  semanticChangeRatio: number
  isStable: boolean
}

/** 从段落中提取语义锚点（纯正则，不依赖 LLM） */
function extractAnchors(paragraph: string, charNames: string[], index: number): SemanticAnchor {
  // 实体
  const entities = charNames.filter(n => paragraph.includes(n))
  // 额外: 引号中的名词作为潜在实体
  const quotedMatch = paragraph.match(/[""「」『』]([^""「」『』""]{1,8})[""「」『』"]/g)
  if (quotedMatch) {
    for (const q of quotedMatch) {
      const inner = q.replace(/[""「」『』""]/g, '')
      if (inner.length >= 2 && inner.length <= 8 && !entities.includes(inner)) {
        entities.push(inner)
      }
    }
  }

  // 动作动词
  const actionVerbs: string[] = []
  for (const verb of ACTION_VERBS) {
    if (paragraph.includes(verb)) actionVerbs.push(verb)
  }

  // 揭示信号
  const revealFlags: string[] = []
  for (const flag of REVEAL_FLAG_VERBS) {
    if (paragraph.includes(flag)) revealFlags.push(flag)
  }

  return {
    paragraphIndex: index,
    entities: entities.slice(0, 10),
    actionVerbs: actionVerbs.slice(0, 15),
    revealFlags: revealFlags.slice(0, 10),
    firstSentence: paragraph.slice(0, 20).replace(/\n/g, ' '),
  }
}

/** 计算两个锚点的语义距离 (0-1, 越低越相似) */
function anchorDistance(a: SemanticAnchor, b: SemanticAnchor): number {
  if (!a.actionVerbs.length && !b.actionVerbs.length) return 0
  if (!a.actionVerbs.length || !b.actionVerbs.length) return 1

  // Jaccard distance on action verbs (weight 0.4)
  const verbIntersection = a.actionVerbs.filter(v => b.actionVerbs.includes(v)).length
  const verbUnion = new Set([...a.actionVerbs, ...b.actionVerbs]).size
  const verbDist = verbUnion > 0 ? 1 - verbIntersection / verbUnion : 1

  // Jaccard distance on reveal flags (weight 0.3)
  const revealIntersection = a.revealFlags.filter(f => b.revealFlags.includes(f)).length
  const revealUnion = new Set([...a.revealFlags, ...b.revealFlags]).size
  const revealDist = revealUnion > 0 ? 1 - revealIntersection / revealUnion : 0

  // Entity overlap (weight 0.3)
  const entityIntersection = a.entities.filter(e => b.entities.includes(e)).length
  const entityUnion = new Set([...a.entities, ...b.entities]).size
  const entityDist = entityUnion > 0 ? 1 - entityIntersection / entityUnion : 0

  return verbDist * 0.4 + revealDist * 0.3 + entityDist * 0.3
}

/** 对章节文本建立场景快照 */
export function takeSnapshot(chapterText: string, chapterNumber: number, charNames: string[]): SceneSnapshot {
  const paras = chapterText.split(/\n\n+/).filter(p => p.trim())
  const anchors = paras.map((p, i) => extractAnchors(p, charNames, i))
  return {
    chapterNumber,
    originalText: chapterText,
    anchors,
    totalParas: paras.length,
  }
}

/** 语义 diff：比较快照与改写后的文本 */
export function diffSnapshot(snapshot: SceneSnapshot, rewritten: string, charNames: string[]): SceneDiff {
  const newParas = rewritten.split(/\n\n+/).filter(p => p.trim())
  const newAnchors = newParas.map((p, i) => extractAnchors(p, charNames, i))

  // 段落数量变化
  const paraRatio = snapshot.totalParas > 0
    ? Math.abs(newParas.length - snapshot.totalParas) / snapshot.totalParas
    : 0

  // 语义变化：对每个原始锚点找最近的新锚点
  let totalSemanticChange = 0
  const changedIndices: number[] = []

  for (const origAnchor of snapshot.anchors) {
    let minDist = 1
    for (const newAnchor of newAnchors) {
      const dist = anchorDistance(origAnchor, newAnchor)
      if (dist < minDist) minDist = dist
    }
    totalSemanticChange += minDist
    if (minDist > 0.4) changedIndices.push(origAnchor.paragraphIndex)
  }

  const avgSemanticChange = snapshot.anchors.length > 0
    ? totalSemanticChange / snapshot.anchors.length
    : 0

  const semanticChangeRatio = avgSemanticChange
  const changedRatio = Math.max(paraRatio, changedIndices.length / Math.max(1, snapshot.totalParas))

  return {
    unchangedCount: snapshot.totalParas - changedIndices.length,
    changedIndices,
    changedRatio,
    semanticChangeRatio,
    isStable: changedRatio < 0.3 && semanticChangeRatio < 0.35,
  }
}

// ==================== 组合检查 ====================

export function checkChapter(
  chapterText: string,
  plan: ChapterPlan,
  facts: CanonFact[],
  timelineHistory: TimelineEvent[],
  currentAbsoluteDay: number | null,
  projectId: number,
  recordedReveal?: { world: number; plot: number; character: number },
  recordedEmotion?: number,
  stateDrift?: number,
  mode?: NarrativeMode,
): CheckResult {
  const hard = checkHardRules(
    chapterText, plan.forbidden || [], plan.allowed_reveal, plan.emotion_cap,
    recordedReveal, recordedEmotion, stateDrift, mode,
  )
  const structural = checkStructure(chapterText, plan, facts, timelineHistory, currentAbsoluteDay)

  // Semantic leak scoring
  const leak = scoreSemanticLeak(chapterText, plan.forbidden || [], facts, projectId)

  // If critical leak score, convert to violation
  const leakViolations: Violation[] = []
  if (leak.normalized.threshold === 'critical') {
    leakViolations.push({
      type: 'forbidden',
      detail: `语义泄露评分 critical（raw=${leak.normalized.raw} z=${leak.normalized.z}）：可能在不经意间泄漏了禁止内容`,
      source: 'structural',
    })
  }

  const violations = [...hard, ...structural, ...leakViolations]
  const concerns: AIConcern[] = []

  // If elevated leak score, add as concern (warning, not violation)
  if (leak.normalized.threshold === 'elevated') {
    concerns.push({
      type: 'possible_leak',
      detail: `语义泄露评分 elevated（raw=${leak.normalized.raw} z=${leak.normalized.z}）`,
      severity: 'medium',
    })
  }

  return {
    violations,
    concerns,
    hardViolationCount: hard.length + structural.length + leakViolations.length,
    leakScore: leak.normalized,
  }
}

// ==================== AI Concerns ====================

export function aiConcernsToViolations(concerns: AIConcern[]): Violation[] {
  const typeMap: Record<string, Violation['type']> = {
    possible_leak: 'info_reveal_exceed',
    emotion_rush: 'emotion_exceed',
    info_rush: 'info_reveal_exceed',
  }
  return concerns.map(c => ({
    type: typeMap[c.type] || 'info_reveal_exceed',
    detail: `[AI建议] ${c.detail}（严重度：${c.severity}）`,
    source: 'ai_suggestion' as const,
  }))
}

// ==================== 稳定器3：Event Canonicalizer ====================

export interface ExtractedEvent {
  event_order: number
  event_type: 'reveal' | 'action' | 'interaction' | 'world_change' | 'emotion_shift'
  subject: string
  action: string
  object: string
  location: string
  characters: string[]
  dimension: 'world' | 'plot' | 'character'
  time_label: string
  absolute_day_offset: number
}

export interface EventExtractionResult {
  events: ExtractedEvent[]
  reveal_estimates: { world: number; plot: number; character: number }
}

const CANONICALIZE_RULES: {
  name: string
  condition: (a: ExtractedEvent, b: ExtractedEvent) => boolean
  merge: (a: ExtractedEvent, b: ExtractedEvent) => ExtractedEvent
}[] = [
  {
    // 规则1: interaction + reveal 同时发生 → merge into interaction (keeps reveal info)
    name: 'interaction_reveal_merge',
    condition: (a, b) =>
      a.event_type === 'interaction' && b.event_type === 'reveal' &&
      a.subject === b.subject && sameScene(a, b),
    merge: (a, b) => ({
      ...a,
      action: `${a.action}（揭示：${b.action}）`,
      characters: [...new Set([...a.characters, ...b.characters])],
      dimension: Math.max(dimensionWeight(a.dimension), dimensionWeight(b.dimension)) === dimensionWeight('plot') ? 'plot' : a.dimension,
    }),
  },
  {
    // 规则2: interaction + emotion_shift → merge
    name: 'interaction_emotion_merge',
    condition: (a, b) =>
      a.event_type === 'interaction' && b.event_type === 'emotion_shift' &&
      a.subject === b.subject && sameScene(a, b),
    merge: (a, b) => ({
      ...a,
      action: `${a.action}（情绪：${b.action}）`,
      characters: [...new Set([...a.characters, ...b.characters])],
    }),
  },
  {
    // 规则3: 同一 subject + 同一 action → dedup (keep the more specific)
    name: 'dedup_same_action',
    condition: (a, b) =>
      a.subject === b.subject && a.action === b.action && sameScene(a, b),
    merge: (a, _b) => a, // keep first, discard duplicate
  },
  {
    // 规则4: reveal + world_change 在同一场景 → keep reveal (it subsumes world_change)
    name: 'reveal_subsume_world',
    condition: (a, b) =>
      a.event_type === 'reveal' && b.event_type === 'world_change' &&
      a.subject === b.subject && sameScene(a, b),
    merge: (a, _b) => ({
      ...a,
      action: `${a.action}（含世界观信息）`,
      dimension: 'world',
    }),
  },
]

function sameScene(a: ExtractedEvent, b: ExtractedEvent): boolean {
  return a.location === b.location && Math.abs(a.absolute_day_offset - b.absolute_day_offset) <= 0
}

function dimensionWeight(d: string): number {
  return d === 'world' ? 3 : d === 'plot' ? 2 : 1
}

/** 低频事件保护：如果某类型事件在全集只出现 ≤1 次，不参与合并（保留细节） */
function isLowFrequency(event: ExtractedEvent, allEvents: ExtractedEvent[]): boolean {
  return allEvents.filter(e => e.event_type === event.event_type).length <= 1
}

/** 规范化事件列表：应用合并规则消除重复/碎片化。低频事件自动保留。 */
export function canonicalizeEvents(events: ExtractedEvent[]): ExtractedEvent[] {
  if (events.length <= 1) return events

  let result = [...events]

  for (const rule of CANONICALIZE_RULES) {
    const merged = new Set<number>()
    const next: ExtractedEvent[] = []
    for (let i = 0; i < result.length; i++) {
      if (merged.has(i)) continue
      let current = { ...result[i] }
      for (let j = i + 1; j < result.length; j++) {
        if (merged.has(j)) continue
        // 低频事件保护：唯一 emotion_shift/world_change 不合并（仅 dedup 规则例外）
        if (rule.name !== 'dedup_same_action') {
          if (isLowFrequency(current, result) || isLowFrequency(result[j], result)) continue
        }
        if (rule.condition(current, result[j])) {
          current = rule.merge(current, result[j])
          merged.add(j)
        }
      }
      next.push(current)
    }
    result = next
  }

  return result.map((e, i) => ({ ...e, event_order: i + 1 }))
}

/** 从规范化事件构建 StatePatch（确定性，不依赖 LLM 总结） */
export function buildStatePatchFromEvents(
  events: ExtractedEvent[],
  chapterNumber: number,
  foreshadowingPlanted: { id?: string; desc: string }[],
  foreshadowingRecovered: { id?: string; desc: string }[],
  aiConcerns: AIConcern[],
): StatePatch {
  const canonical = canonicalizeEvents(events)

  // Summary: splice first 3 events
  const summaryText = canonical.slice(0, 3).map(e => `${e.subject}${e.action}`).join('；') || ''

  // Key events: action + reveal type events
  const keyEvents = canonical
    .filter(e => e.event_type === 'action' || e.event_type === 'reveal')
    .map(e => e.action)

  // Characters appeared: union of all event characters
  const charactersAppeared = [...new Set(canonical.flatMap(e => e.characters))]

  // Locations: union of all event locations
  const locations = [...new Set(canonical.map(e => e.location).filter(Boolean))]

  // Time labels
  const timeLabels = [...new Set(canonical.map(e => e.time_label).filter(Boolean))]

  // Absolute day
  const absoluteDay = canonical.find(e => e.absolute_day_offset > 0)?.absolute_day_offset || null

  // Character changes: emotion_shift events where dimension === 'character'
  const characterChanges: Record<string, string> = {}
  for (const e of canonical.filter(e => e.event_type === 'emotion_shift' && e.dimension === 'character')) {
    if (!characterChanges[e.subject]) characterChanges[e.subject] = ''
    characterChanges[e.subject] += `${e.action}；`
  }

  // World changes: world_change events
  const worldChanges: Record<string, string> = {}
  for (const e of canonical.filter(e => e.event_type === 'world_change')) {
    const key = e.object || e.subject
    if (!worldChanges[key]) worldChanges[key] = ''
    worldChanges[key] += e.action
  }

  // Relationship changes: interaction events
  const relationshipChanges = canonical
    .filter(e => e.event_type === 'interaction' && e.characters.length >= 2)
    .map(e => ({
      char_a: e.characters[0],
      char_b: e.characters[1],
      chapter_number: chapterNumber,
      relation_type: e.dimension === 'character' ? 'lover' : 'ally' as string,
      change_description: e.action,
    }))

  // Timeline events
  const timelineEvents = canonical.map(e => ({
    chapter_number: chapterNumber,
    event_order: e.event_order,
    event_description: `${e.subject}${e.action}`,
    time_label: e.time_label,
    absolute_day: e.absolute_day_offset > 0 ? e.absolute_day_offset : null,
    location: e.location,
    characters_involved: JSON.stringify(e.characters),
    is_major: e.event_type === 'reveal' || e.event_type === 'action' ? 1 : 0,
  }))

  // Character arcs: emotion_shift events
  const characterArcs = canonical
    .filter(e => e.event_type === 'emotion_shift')
    .map(e => ({
      character_name: e.subject,
      chapter_number: chapterNumber,
      change_type: 'development' as string,
      change_description: e.action,
    }))

  return {
    summary: {
      chapter_number: chapterNumber,
      summary: summaryText,
      characters_appeared: charactersAppeared,
      locations,
      key_events: keyEvents,
      time_labels: timeLabels,
      absolute_day: absoluteDay,
      foreshadowing_planted: foreshadowingPlanted,
      foreshadowing_recovered: foreshadowingRecovered,
      character_changes: characterChanges,
      world_changes: worldChanges,
      relationship_changes: relationshipChanges,
    },
    foreshadowing_new: foreshadowingPlanted
      .filter(f => f.desc)
      .map((f, i) => ({
        foreshadow_id: f.id || `F${String(chapterNumber).padStart(3, '0')}-${i + 1}`,
        description: f.desc,
        chapter_number: chapterNumber,
      })),
    foreshadowing_done: foreshadowingRecovered
      .filter(f => f.id)
      .map(f => ({ foreshadow_id: f.id!, chapter_number: chapterNumber })),
    timeline_events: timelineEvents,
    character_arcs: characterArcs,
    relationship_changes: relationshipChanges,
  }
}

// ==================== State Write Authority ====================

export async function applyStatePatches(
  db: { run: (sql: string, params?: any[]) => Promise<any>; get: (sql: string, params?: any[]) => Promise<any> },
  projectId: number,
  patch: StatePatch,
): Promise<void> {
  if (patch.summary) {
    const s = patch.summary
    const prevSum = await db.get(
      'SELECT id FROM chapter_summaries WHERE project_id = ? AND chapter_number = ?',
      [projectId, s.chapter_number]
    )
    const summaryData = [
      s.summary || '', JSON.stringify(s.characters_appeared || []), JSON.stringify(s.locations || []),
      JSON.stringify(s.key_events || []), JSON.stringify(s.foreshadowing_planted || []),
      JSON.stringify(s.foreshadowing_recovered || []), JSON.stringify(s.character_changes || {}),
      JSON.stringify(s.world_changes || {}),
    ]
    if (prevSum) {
      await db.run(
        `UPDATE chapter_summaries SET summary=?,characters_appeared=?,locations=?,key_events=?,foreshadowing_planted=?,foreshadowing_recovered=?,character_changes=?,world_changes=? WHERE project_id=? AND chapter_number=?`,
        [...summaryData, projectId, s.chapter_number]
      )
    } else {
      await db.run(
        `INSERT INTO chapter_summaries (project_id,chapter_number,summary,characters_appeared,locations,key_events,foreshadowing_planted,foreshadowing_recovered,character_changes,world_changes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [projectId, s.chapter_number, ...summaryData]
      )
    }
  }

  if (patch.foreshadowing_new && patch.foreshadowing_new.length > 0) {
    for (const item of patch.foreshadowing_new) {
      if (!item.description) continue
      await db.run(
        `INSERT OR IGNORE INTO foreshadowing_registry (project_id,foreshadow_id,description,status,planted_chapter) VALUES (?,?,?,?,?)`,
        [projectId, item.foreshadow_id, item.description, 'active', item.chapter_number]
      )
    }
  }

  if (patch.foreshadowing_done && patch.foreshadowing_done.length > 0) {
    for (const item of patch.foreshadowing_done) {
      await db.run(
        `UPDATE foreshadowing_registry SET status='done',resolved_chapter=?,updated_at=datetime('now','localtime') WHERE project_id=? AND foreshadow_id=? AND status!='done'`,
        [item.chapter_number, projectId, item.foreshadow_id]
      )
    }
  }

  // 先清理该章节的旧时间线事件（重新生成时避免重复）
  if (patch.summary?.chapter_number) {
    await db.run(
      'DELETE FROM story_timeline WHERE project_id = ? AND chapter_number = ?',
      [projectId, patch.summary.chapter_number]
    )
  }
  if (patch.timeline_events && patch.timeline_events.length > 0) {
    for (const ev of patch.timeline_events) {
      await db.run(
        `INSERT INTO story_timeline (project_id,chapter_number,event_order,event_description,time_label,absolute_day,location,characters_involved,is_major) VALUES (?,?,?,?,?,?,?,?,?)`,
        [projectId, ev.chapter_number, ev.event_order, ev.event_description, ev.time_label, ev.absolute_day, ev.location, ev.characters_involved, ev.is_major]
      )
    }
  }

  // 先清理该章的旧角色弧线和关系时间线
  if (patch.summary?.chapter_number) {
    await db.run('DELETE FROM character_arc_log WHERE project_id = ? AND chapter_number = ?', [projectId, patch.summary.chapter_number])
    await db.run('DELETE FROM relationship_timeline WHERE project_id = ? AND chapter_number = ?', [projectId, patch.summary.chapter_number])
  }
  if (patch.character_arcs && patch.character_arcs.length > 0) {
    for (const ca of patch.character_arcs) {
      await db.run(
        `INSERT INTO character_arc_log (project_id,character_name,chapter_number,change_type,change_description,before_state) VALUES (?,?,?,?,?,'')`,
        [projectId, ca.character_name, ca.chapter_number, ca.change_type, ca.change_description]
      )
    }
  }

  if (patch.relationship_changes && patch.relationship_changes.length > 0) {
    for (const rc of patch.relationship_changes) {
      if (!rc.char_a || !rc.char_b || !rc.change_description) continue
      await db.run(
        `INSERT INTO relationship_timeline (project_id,char_a,char_b,chapter_number,relation_type,change_description) VALUES (?,?,?,?,?,?)`,
        [projectId, rc.char_a, rc.char_b, rc.chapter_number, rc.relation_type || 'ally', rc.change_description]
      )
    }
  }
}

// ==================== Semantic InfoLoss ====================

export function calcInfoLoss(original: string, rewritten: string): number {
  if (!original || !rewritten) return 1.0
  const origParas = original.split(/\n\n+/).filter(p => p.trim()).length
  const newParas = rewritten.split(/\n\n+/).filter(p => p.trim()).length
  if (origParas === 0) return 0
  const paraRatio = Math.abs(newParas - origParas) / origParas
  const lenRatio = Math.abs(rewritten.length - original.length) / original.length
  return paraRatio * 0.6 + lenRatio * 0.4
}

// ==================== Rewrite 熔断 ====================

export interface RewriteLimit {
  maxRetries: number
  entropyLimit: number
}

export const DEFAULT_REWRITE_LIMIT: RewriteLimit = { maxRetries: 2, entropyLimit: 0.15 }

/** 构建带段落锚点的重写 prompt */
export function buildRewritePrompt(
  originalText: string,
  violations: Violation[],
  snapshot?: SceneSnapshot,
): string {
  const vList = violations
    .filter(v => v.source !== 'ai_suggestion')
    .map(v => `- [${v.type}] ${v.detail}`)
    .join('\n')

  let prompt = `你刚刚生成的文本违反以下硬性约束规则：

${vList}

请重写本章中**仅涉及违规的部分段落**。规则：
1. 只改违规段落——其他内容原封不动保留
2. 不要为了"修复"而引入新的信息或情节
3. 不要增加任何新的设定揭露、感情推进、或禁止内容
4. 改写后的段落必须比原段落更保守——宁可写得含蓄一些
5. 直接输出重写后的全文`

  // If snapshot is available, add anchor constraints
  if (snapshot && snapshot.anchors.length > 0) {
    const violationIndices = new Set(violations.filter(v => v.paragraphIndex != null).map(v => v.paragraphIndex!))
    prompt += `\n\n以下是原文的段落索引。你**只能修改标记了 ⚠ 的段落**，其余段落必须逐字保留：\n\n`
    for (const a of snapshot.anchors) {
      const marker = violationIndices.has(a.paragraphIndex) ? '⚠ 需修改' : '✓ 保留'
      prompt += `[段落${a.paragraphIndex}] ${marker} | 首句："${a.firstSentence}" | 实体：${a.entities.join('、') || '无'} | 动作：${a.actionVerbs.slice(0, 5).join('、') || '无'}\n`
    }
  }

  return prompt
}
