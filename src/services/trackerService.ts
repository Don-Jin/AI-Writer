// ==================== v4.0 trackerService — 状态机核心 ====================
// 替代旧 canonService.ts (900+ 行) — 从"知识库"升级为"状态机"

const db = () => {
  return {
    query: (sql: string, params?: any[]) => (window as any).electronAPI.db.query(sql, params),
    run: (sql: string, params?: any[]) => (window as any).electronAPI.db.run(sql, params),
    get: (sql: string, params?: any[]) => (window as any).electronAPI.db.get(sql, params),
  }
}

// ==================== 类型 ====================

export interface TrackerItem {
  id?: number
  project_id: number
  tier: 'master' | 'volume' | 'chapter'
  volume_number: number
  chapter_number: number
  tracker_type: 'character' | 'event' | 'foreshadow' | 'rules'
  tracker_key: string
  importance?: 'major' | 'minor'
  summary: string
  state: Record<string, any>
  expected_state?: Record<string, any> | null
  status: string
  created_at?: string
  updated_at?: string
}

export interface TransitionLog {
  id: number
  project_id: number
  chapter_number: number
  tracker_key: string
  tracker_type: string
  old_state: string
  new_state: string
  transition_valid: number
  rule_violation: string
  created_at: string
}

export interface TransitionRules {
  emotion?: {
    allowed_transitions: string[][]
    max_jumps_per_volume: number
  }
  relationship?: { max_delta_per_chapter: number; max_delta_per_volume: number }
  event_phase?: { allowed_transitions: string[][]; can_skip: boolean }
}

export interface CheckReport {
  volume_number: number
  score: number
  character_deviations: Array<{ key: string; field: string; expected: any; actual: any; delta: string }>
  event_deviations: Array<{ key: string; field: string; expected: any; actual: any }>
  foreshadow_status: { total: number; resolved: number; overdue: number; recovery_rate: number }
  rule_violations: Array<{ key: string; rule: string; detail: string }>
  checked_at: string
}

// ==================== 读取 ====================

export async function getMasterTracker(projectId: number): Promise<TrackerItem[]> {
  try {
    const rows = await db().query(
      "SELECT * FROM story_tracker WHERE project_id=? AND tier='master' ORDER BY tracker_type, tracker_key",
      [projectId]
    )
    return rows.map(parseTracker)
  } catch { return [] }
}

export async function getVolumeTracker(projectId: number, volNum: number): Promise<TrackerItem[]> {
  try {
    const rows = await db().query(
      "SELECT * FROM story_tracker WHERE project_id=? AND tier='volume' AND volume_number=? ORDER BY tracker_type, tracker_key",
      [projectId, volNum]
    )
    return rows.map(parseTracker)
  } catch { return [] }
}

export async function getChapterTracker(projectId: number, chNum: number): Promise<TrackerItem[]> {
  try {
    const rows = await db().query(
      "SELECT * FROM story_tracker WHERE project_id=? AND tier='chapter' AND chapter_number=? ORDER BY tracker_type, tracker_key",
      [projectId, chNum]
    )
    return rows.map(parseTracker)
  } catch { return [] }
}

export async function getEndingState(projectId: number, chNum: number): Promise<Record<string, any> | null> {
  try {
    if (chNum <= 0) return null
    const rows = await db().query(
      "SELECT tracker_key, state FROM story_tracker WHERE project_id=? AND tier='chapter' AND chapter_number=? AND tracker_type='character'",
      [projectId, chNum]
    )
    if (rows.length === 0) return null
    const result: Record<string, any> = {}
    for (const r of rows) {
      try { result[r.tracker_key] = JSON.parse(r.state || '{}') } catch {}
    }
    return { characters: result }
  } catch { return null }
}

export async function getTransitionRules(projectId: number): Promise<TransitionRules> {
  try {
    const row = await db().get(
      "SELECT state FROM story_tracker WHERE project_id=? AND tier='master' AND tracker_type='rules' AND tracker_key='global'",
      [projectId]
    )
    if (row?.state) return JSON.parse(row.state)
    return {}
  } catch { return {} }
}

export async function getTransitionLog(projectId: number, trackerKey?: string): Promise<TransitionLog[]> {
  try {
    let sql = 'SELECT * FROM tracker_transitions WHERE project_id=?'
    const params: any[] = [projectId]
    if (trackerKey) { sql += ' AND tracker_key=?'; params.push(trackerKey) }
    sql += ' ORDER BY chapter_number ASC'
    return await db().query(sql, params)
  } catch { return [] }
}

export async function getCheckReports(projectId: number): Promise<CheckReport[]> {
  try {
    const rows = await db().query(
      'SELECT * FROM volume_check_reports WHERE project_id=? ORDER BY volume_number DESC',
      [projectId]
    )
    return rows.map((r: any) => JSON.parse(r.results || '{}'))
  } catch { return [] }
}

// ==================== 写入 ====================

export async function upsertTracker(item: Omit<TrackerItem, 'id' | 'created_at' | 'updated_at'>): Promise<number> {
  try {
    const existing = await db().get(
      `SELECT id FROM story_tracker WHERE project_id=? AND tier=? AND volume_number=? AND chapter_number=? AND tracker_type=? AND tracker_key=?`,
      [item.project_id, item.tier, item.volume_number, item.chapter_number, item.tracker_type, item.tracker_key]
    )
    const stateStr = JSON.stringify(item.state || {})
    const expectedStr = item.expected_state ? JSON.stringify(item.expected_state) : null

    if (existing) {
      await db().run(
        `UPDATE story_tracker SET summary=?, state=?, expected_state=?, importance=?, status=?, updated_at=datetime('now','localtime') WHERE id=?`,
        [item.summary, stateStr, expectedStr, item.importance || 'minor', item.status, existing.id]
      )
      return existing.id
    } else {
      const r = await db().run(
        `INSERT INTO story_tracker (project_id, tier, volume_number, chapter_number, tracker_type, tracker_key, importance, summary, state, expected_state, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [item.project_id, item.tier, item.volume_number, item.chapter_number, item.tracker_type, item.tracker_key,
         item.importance || 'minor', item.summary, stateStr, expectedStr, item.status]
      )
      return r.lastInsertRowid
    }
  } catch { return 0 }
}

export async function logTransition(
  projectId: number, chapterNumber: number,
  trackerKey: string, trackerType: string,
  oldState: Record<string, any>, newState: Record<string, any>,
  valid: boolean, violation: string
): Promise<void> {
  try {
    await db().run(
      `INSERT INTO tracker_transitions (project_id, chapter_number, tracker_key, tracker_type, old_state, new_state, transition_valid, rule_violation)
       VALUES (?,?,?,?,?,?,?,?)`,
      [projectId, chapterNumber, trackerKey, trackerType,
       JSON.stringify(oldState), JSON.stringify(newState),
       valid ? 1 : 0, violation]
    )
  } catch {}
}

export async function deleteMasterTrackers(projectId: number): Promise<void> {
  try { await db().run("DELETE FROM story_tracker WHERE project_id=? AND tier='master'", [projectId]) } catch {}
}

// ==================== 提取（AI 调用） ====================

// ==================== 状态迁移校验 ====================

export function validateTransition(
  rules: TransitionRules | null,
  oldState: Record<string, any>,
  newState: Record<string, any>,
  trackerType: 'character' | 'event' | 'foreshadow'
): { valid: boolean; violations: string[] } {
  const violations: string[] = []
  if (!rules) return { valid: true, violations: [] }

  if (trackerType === 'character') {
    // 情绪迁移校验
    if (rules.emotion && oldState.emotion && newState.emotion && oldState.emotion !== newState.emotion) {
      const allowed = rules.emotion.allowed_transitions || []
      const match = allowed.find(([from, to]) => from === oldState.emotion && to === newState.emotion)
      if (!match) {
        violations.push(`情绪跳变违规: ${oldState.emotion} → ${newState.emotion} (不在允许路径中)`)
      }
    }
    // 关系变化幅度校验
    if (rules.relationship && oldState.relationships && newState.relationships) {
      const maxDelta = rules.relationship.max_delta_per_chapter || 2
      const oldRels = oldState.relationships || {}
      const newRels = newState.relationships || {}
      for (const [name, newVal] of Object.entries(newRels)) {
        const oldVal = (oldRels as any)[name] || 0
        if (Math.abs((newVal as number) - (oldVal as number)) > maxDelta) {
          violations.push(`关系变化违规: ${name} ${oldVal}→${newVal} (delta=${Math.abs((newVal as number) - (oldVal as number))} > ${maxDelta})`)
        }
      }
    }
  }

  if (trackerType === 'event') {
    // 事件阶段迁移校验
    if (rules.event_phase && oldState.phase && newState.phase && oldState.phase !== newState.phase) {
      const allowed = rules.event_phase.allowed_transitions || []
      const match = allowed.find(([from, to]) => from === oldState.phase && to === newState.phase)
      if (!match && !rules.event_phase.can_skip) {
        violations.push(`事件阶段跳变违规: ${oldState.phase} → ${newState.phase} (不在允许路径中)`)
      }
    }
  }

  // foreshadow 不做严格校验
  return { valid: violations.length === 0, violations }
}

const EXTRACT_MASTER_PROMPT = `你是小说设定提取器。阅读大纲后提取结构化信息。

## 输出格式
严格 JSON：
{
  "characters": {
    "角色名": {
      "summary": "总弧线描述（50字）",
      "state": { "emotion": "初始情绪", "location": "初始位置", "goal": "初始目标", "thoughts": "", "relationships": {}, "scene": "", "unfinished_action": "" }
    }
  },
  "events": {
    "事件名": {
      "summary": "总弧线描述（50字）",
      "state": { "phase": "setup", "progress": 0, "next_milestone": "第一个关键节点", "summary": "" }
    }
  },
  "foreshadow": {
    "伏笔主题": {
      "summary": "伏笔描述（30字）",
      "state": { "planted_chapter": 0, "target_chapter": 0, "reveal_condition": "", "revealed_chapter": 0, "status": "pending" },
      "importance": "major|minor"
    }
  },
  "rules": {
    "emotion": { "allowed_transitions": [["calm","anxious"]], "max_jumps_per_volume": 3 },
    "relationship": { "max_delta_per_chapter": 2, "max_delta_per_volume": 6 },
    "event_phase": { "allowed_transitions": [["setup","rising"]], "can_skip": false }
  }
}
仅输出 JSON，不要 markdown。`

export async function extractMasterFromOutline(projectId: number, outlineContent: string): Promise<number> {
  try {
    const m = [
      { role: 'system' as const, content: EXTRACT_MASTER_PROMPT },
      { role: 'user' as const, content: outlineContent.slice(0, 6000) },
    ]
    const r = await (window as any).electronAPI.aiChat(m, '总表提取')
    const jm = (r || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').match(/\{[\s\S]*\}/)
    if (!jm) return 0

    const data = JSON.parse(jm[0])
    let count = 0

    // 写入角色
    if (data.characters) {
      for (const [key, val] of Object.entries(data.characters)) {
        const v = val as any
        await upsertTracker({
          project_id: projectId, tier: 'master', volume_number: 0, chapter_number: 0,
          tracker_type: 'character', tracker_key: key,
          summary: v.summary || '',
          state: v.state || {},
          status: '',
        })
        count++
      }
    }
    // 写入事件
    if (data.events) {
      for (const [key, val] of Object.entries(data.events)) {
        const v = val as any
        await upsertTracker({
          project_id: projectId, tier: 'master', volume_number: 0, chapter_number: 0,
          tracker_type: 'event', tracker_key: key,
          summary: v.summary || '',
          state: v.state || {},
          status: (v.state as any)?.phase || 'setup',
        })
        count++
      }
    }
    // 写入伏笔
    if (data.foreshadow) {
      for (const [key, val] of Object.entries(data.foreshadow)) {
        const v = val as any
        await upsertTracker({
          project_id: projectId, tier: 'master', volume_number: 0, chapter_number: 0,
          tracker_type: 'foreshadow', tracker_key: key,
          importance: v.importance || 'minor',
          summary: v.summary || '',
          state: v.state || {},
          status: (v.state as any)?.status || 'pending',
        })
        count++
      }
    }
    // 写入迁移规则
    if (data.rules) {
      await upsertTracker({
        project_id: projectId, tier: 'master', volume_number: 0, chapter_number: 0,
        tracker_type: 'rules', tracker_key: 'global',
        summary: '状态迁移规则',
        state: data.rules,
        status: 'active',
      })
    }

    return count
  } catch { return 0 }
}

// ==================== 卷表提取 ====================

const EXTRACT_VOLUME_PROMPT = `你是卷纲要状态提取器。阅读卷纲和总表后提取本卷预期的角色终态和事件终态。

## 输入
- 大纲总表：角色总弧线、事件总弧线、伏笔规则
- 卷纲：本卷主题、章节规划、角色发展、事件推进

## 输出格式
严格 JSON：
{
  "characters": {
    "角色名": {
      "summary": "本卷角色弧线描述（50字）",
      "expected_state": {
        "emotion": "卷末预期情绪",
        "location": "卷末预期位置",
        "goal": "卷末预期目标",
        "relationships": { "关联角色": 数值 }
      }
    }
  },
  "events": {
    "事件名": {
      "summary": "本卷事件推进描述（50字）",
      "expected_state": {
        "phase": "setup|rising|climax|falling|resolved",
        "progress": 0-100,
        "next_milestone": "卷末关键节点"
      }
    }
  },
  "foreshadow": {
    "伏笔主题": {
      "summary": "本卷伏笔计划（30字）",
      "expected_state": { "status": "pending|hinted|revealed|resolved", "target_chapter": 0 }
    }
  }
}
仅输出 JSON，不要 markdown。`

export async function extractVolumeFromOutline(
  projectId: number, volNum: number,
  volumeOutline: string, previousVolNum?: number
): Promise<number> {
  try {
    // 读取总表作为上下文
    const masterItems = await getMasterTracker(projectId)
    const masterCtx = masterItems
      .map(t => `[${t.tracker_type}] ${t.tracker_key}: ${t.summary}`)
      .join('\n')

    // 读取上一卷卷表终态
    let prevVolCtx = ''
    if (previousVolNum && previousVolNum > 0) {
      const prevItems = await getVolumeTracker(projectId, previousVolNum)
      if (prevItems.length > 0) {
        prevVolCtx = prevItems
          .map(t => `[${t.tracker_type}] ${t.tracker_key}: expected=${JSON.stringify(t.expected_state)}`)
          .join('\n')
      }
    }

    const m = [
      { role: 'system' as const, content: EXTRACT_VOLUME_PROMPT },
      { role: 'user' as const, content: `总表：\n${masterCtx}\n\n上一卷卷表：\n${prevVolCtx || '(首卷)'}\n\n卷纲：\n${volumeOutline.slice(0, 6000)}` },
    ]
    const r = await (window as any).electronAPI.aiChat(m, '卷表提取')
    const jm = (r || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').match(/\{[\s\S]*\}/)
    if (!jm) return 0

    const data = JSON.parse(jm[0])
    let count = 0

    if (data.characters) {
      for (const [key, val] of Object.entries(data.characters)) {
        const v = val as any
        await upsertTracker({
          project_id: projectId, tier: 'volume', volume_number: volNum, chapter_number: 0,
          tracker_type: 'character', tracker_key: key,
          summary: v.summary || '',
          state: {},
          expected_state: v.expected_state || {},
          status: '',
        })
        count++
      }
    }
    if (data.events) {
      for (const [key, val] of Object.entries(data.events)) {
        const v = val as any
        await upsertTracker({
          project_id: projectId, tier: 'volume', volume_number: volNum, chapter_number: 0,
          tracker_type: 'event', tracker_key: key,
          summary: v.summary || '',
          state: {},
          expected_state: v.expected_state || {},
          status: (v.expected_state as any)?.phase || 'setup',
        })
        count++
      }
    }
    if (data.foreshadow) {
      for (const [key, val] of Object.entries(data.foreshadow)) {
        const v = val as any
        await upsertTracker({
          project_id: projectId, tier: 'volume', volume_number: volNum, chapter_number: 0,
          tracker_type: 'foreshadow', tracker_key: key,
          summary: v.summary || '',
          state: {},
          expected_state: v.expected_state || {},
          status: (v.expected_state as any)?.status || 'pending',
        })
        count++
      }
    }

    return count
  } catch { return 0 }
}

// ==================== 章节状态提取 ====================

const EXTRACT_CHAPTER_PROMPT = `你是状态提取器。阅读正文后按固定格式输出。key 不可变，value 不可改类型。

输出 JSON：
{
  "chapter_summary": "100-150字摘要",
  "states": {
    "character": [
      { "key": "角色名", "state": { "emotion":"", "location":"", "goal":"", "thoughts":"", "relationships":{}, "scene":"", "unfinished_action":"" } }
    ],
    "event": [
      { "key": "事件名", "state": { "phase":"setup|rising|climax|falling|resolved", "progress":0, "next_milestone":"", "summary":"" } }
    ],
    "foreshadow": [
      { "key": "伏笔主题", "state": { "status":"pending|hinted|revealed|resolved", "reveal_condition":"" } }
    ]
  }
}
仅输出 JSON。`

export async function extractChapterState(
  projectId: number, chapNum: number,
  chapterContent: string, existingTrackers: TrackerItem[]
): Promise<number> {
  try {
    // 构建上章状态摘要，帮助 AI 识别变化
    const prevCtx = existingTrackers
      .map(t => `[${t.tracker_type}] ${t.tracker_key}: ${JSON.stringify(t.state)}`)
      .join('\n')

    const m = [
      { role: 'system' as const, content: EXTRACT_CHAPTER_PROMPT },
      { role: 'user' as const, content: `上一章结束时状态：\n${prevCtx}\n\n本章正文：\n${chapterContent.slice(0, 8000)}` },
    ]
    const r = await (window as any).electronAPI.aiChat(m, '章表提取')
    const jm = (r || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').match(/\{[\s\S]*\}/)
    if (!jm) return 0

    const data = JSON.parse(jm[0])
    let count = 0

    // 写入角色状态
    if (data.states?.character) {
      for (const { key, state } of data.states.character) {
        if (!key) continue
        const oldTracker = existingTrackers.find(t => t.tracker_key === key && t.tracker_type === 'character')
        const oldState = oldTracker?.state || {}

        // 迁移规则校验
        const rules = await getTransitionRules(projectId)
        const { valid, violations } = validateTransition(rules, oldState, state || {}, 'character')
        const violation = violations.join('; ')

        await upsertTracker({
          project_id: projectId, tier: 'chapter', volume_number: 0, chapter_number: chapNum,
          tracker_type: 'character', tracker_key: key,
          summary: data.chapter_summary || '',
          state: state || {},
          status: state?.emotion || '',
        })

        await logTransition(projectId, chapNum, key, 'character', oldState, state || {}, valid, violation)
        count++
      }
    }

    // 写入事件状态
    if (data.states?.event) {
      for (const { key, state } of data.states.event) {
        if (!key) continue
        const oldTracker = existingTrackers.find(t => t.tracker_key === key && t.tracker_type === 'event')
        const oldState = oldTracker?.state || {}

        const rules = await getTransitionRules(projectId)
        const { valid, violations } = validateTransition(rules, oldState, state || {}, 'event')
        const violation = violations.join('; ')

        await upsertTracker({
          project_id: projectId, tier: 'chapter', volume_number: 0, chapter_number: chapNum,
          tracker_type: 'event', tracker_key: key,
          summary: data.chapter_summary || '',
          state: state || {},
          status: state?.phase || 'setup',
        })
        await logTransition(projectId, chapNum, key, 'event', oldState, state || {}, valid, violation)
        count++
      }
    }

    // 写入伏笔状态
    if (data.states?.foreshadow) {
      for (const { key, state } of data.states.foreshadow) {
        if (!key) continue
        const oldTracker = existingTrackers.find(t => t.tracker_key === key && t.tracker_type === 'foreshadow')
        const oldState = oldTracker?.state || {}

        await upsertTracker({
          project_id: projectId, tier: 'chapter', volume_number: 0, chapter_number: chapNum,
          tracker_type: 'foreshadow', tracker_key: key,
          summary: '',
          state: state || {},
          status: state?.status || 'pending',
        })
        await logTransition(projectId, chapNum, key, 'foreshadow', oldState, state || {}, true, '')
        count++
      }
    }

    return count
  } catch { return 0 }
}

// ==================== 卷检查 ====================

export async function runVolumeCheck(projectId: number, volNum: number, chapters: number[]): Promise<CheckReport> {
  const report: CheckReport = {
    volume_number: volNum, score: 100,
    character_deviations: [], event_deviations: [],
    foreshadow_status: { total: 0, resolved: 0, overdue: 0, recovery_rate: 0 },
    rule_violations: [],
    checked_at: new Date().toISOString(),
  }

  try {
    // 读卷表 expected_state
    const volTrackers = await getVolumeTracker(projectId, volNum)

    // 读本卷最后一个章表
    const lastCh = chapters[chapters.length - 1]
    const chTrackers = lastCh ? await getChapterTracker(projectId, lastCh) : []

    for (const vt of volTrackers) {
      if (vt.tracker_type === 'foreshadow') continue
      const expected = vt.expected_state || {}
      const actual = chTrackers.find(ct => ct.tracker_key === vt.tracker_key && ct.tracker_type === vt.tracker_type)
      if (!actual) continue

      for (const [field, expVal] of Object.entries(expected)) {
        const actVal = (actual.state as any)?.[field]
        if (actVal != null && JSON.stringify(expVal) !== JSON.stringify(actVal)) {
          if (vt.tracker_type === 'character') {
            report.character_deviations.push({
              key: vt.tracker_key, field,
              expected: expVal, actual: actVal,
              delta: `${expVal} → ${actVal}`,
            })
          } else {
            report.event_deviations.push({
              key: vt.tracker_key, field,
              expected: expVal, actual: actVal,
            })
          }
        }
      }
    }

    // 评分
    const deductions = report.character_deviations.length * 5 + report.event_deviations.length * 3
    report.score = Math.max(0, 100 - deductions)

    // 写入
    await db().run(
      `INSERT INTO volume_check_reports (project_id, volume_number, results) VALUES (?,?,?)`,
      [projectId, volNum, JSON.stringify(report)]
    )
  } catch {}

  return report
}

// ==================== 辅助 ====================

function parseTracker(row: any): TrackerItem {
  return {
    ...row,
    state: tryParseJSON(row.state, {} as any),
    expected_state: row.expected_state ? tryParseJSON(row.expected_state, null) : null,
  }
}

function tryParseJSON(str: string | null, fallback: any): any {
  if (!str) return fallback
  try { return JSON.parse(str) } catch { return fallback }
}
