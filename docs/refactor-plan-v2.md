# novel-ai-writer v3 全局重构计划（修订版 v2）

> 基于用户纠正：设定库（外部参考）≠ 本项目设定（canon_facts 内部真理）
> 核心目标：统一事实簿 → 消除冗余 → 合约强制 → 一键全流程

---

## 〇、关键概念纠正

### 两个"设定库"的区分

| | 外部设定库 | 本项目设定（内部设定簿 = 事实簿） |
|---|---|---|
| **存储位置** | `setting_libraries` 表 | `canon_facts` 表 |
| **数据来源** | 用户导入参考小说 → AI提取 | 大纲AI生成 → CANON_EXTRACTION提取 → 后续由Checker/卷纲持续更新 |
| **用途** | 参考模板：告诉AI"参考这本小说的角色和世界观" | **内部真理+设定簿合一**：告诉AI本项目已确立的不可更改的事实+角色+世界观+规则 |
| **注入方式** | `buildSettingContext()` → 大纲/卷纲 prompt 的 `【📋 设定库参考】` | `getChapterFacts()` → 所有阶段 prompt 的 `【📖 事实簿】` |
| **注入时机** | 仅大纲、卷纲 | **大纲(重新生成时完整注入)、卷纲、细纲、正文** |
| **生命周期** | 用户导入后不变 | 随大纲/卷纲/正文的生成和重写**持续更新** |
| **用途** | 参考模板：告诉AI"参考这本小说的角色和世界观" | 内部真理：告诉AI"本项目已确立的不可更改的事实" |
| **注入方式** | `buildSettingContext()` → 作为大纲/卷纲 prompt 的 `【📋 设定库参考】` | `getChapterFacts()` → 作为细纲/正文 prompt 的 `【📖 事实簿】` |
| **注入阶段** | 仅大纲、卷纲 | 大纲、卷纲、细纲、正文 |
| **生命周期** | 用户导入后不变（除非用户重新提取） | 随大纲/卷纲/正文的生成和重写**持续更新** |

**正确数据流**：
```
外部设定库(setting_libraries)
  │  用户选择 → buildSettingContext() 构建参考文本
  │  包含：角色阵容、世界观框架、规则体系
  ▼
大纲生成(genOutline)
  │  AI 读取 "【📋 设定库参考】" 作为灵感
  │  AI 使用 OUTLINE_SYSTEM 的"角色设计""世界观框架"指令
  │  **生成本项目原创的角色+世界观+规则** ← 这才是"本项目设定"
  ▼
CANON_EXTRACTION (大纲生成后自动触发)
  │  从大纲中提取所有硬规则事实
  │  项目自定义的角色名/设定名/规则名/关系
  ▼
canon_facts（本项目设定，内部真理）
  │  fact_category='character' → 本项目独有的角色（不是参考书的）
  │  fact_category='setting' → 本项目独有的世界观
  │  fact_category='rule' → 本项目独有的规则
  │  is_hard_rule=1 → 不可违反
```

**关键原则**：外部设定库和 canon_facts 是两个独立系统。前者是参考素材，后者是项目真理。

**核心定义**：**内部设定簿 = 事实簿 = canon_facts 表**。本项目不存在独立的"内部设定簿"表——角色、世界观、规则、关系等所有项目级设定，统一存储在 canon_facts 中。canon_facts 既是设定簿，也是事实簿，二者合一。

---

## 一、架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据架构 | 核心合并 + 关键独立表 | canon_facts 吸收 chapter_summaries + 事件 + 状态更新。timeline/foreshadowing 保留独立表 |
| 外部库定位 | 全部独立 | style/personality/disassembly/setting_libraries 保持独立作为"素材模板池" |
| 设定库与事实簿 | **不合并** | 外部设定库是参考模板，canon_facts 是项目内部真理，二者不直接互传 |
| 一键全流程 | 点击触发，内部分步 | 禁词→去AI味→Checker→修复→更新事实簿，串联但不合并 prompt |
| 大纲重生成 | 直接删除重建 | DELETE source='outline' 的事实 → 重新提取 |

---

## 二、核心概念重新定义

### 2.1 canon_facts 新定位

```
canon_facts 的生命周期：
  ┌─────────────────────────────────────────────────┐
  │ 大纲生成 → CANON_EXTRACTION(分段) → upsertFact  │
  │   source='outline'                              │
  │   → 初始硬规则(角色名/核心设定/规则/关系)         │
  │   → revealed_level 初始值(角色50/事件60/关系40)  │
  ├─────────────────────────────────────────────────┤
  │ 大纲重新生成 → DELETE source='outline' → 重新提取 │
  ├─────────────────────────────────────────────────┤
  │ 卷纲生成 → 角色里程碑/冲突检测                     │
  │   source='volume_N'                             │
  │   → 角色状态变化(arc changes)                    │
  │   → 新的世界设定揭示                              │
  ├─────────────────────────────────────────────────┤
  │ 细纲生成 → 预验证(不写入, 产生 warnings)          │
  │   对比 canon_facts 验证 forbidden + info_reveal  │
  ├─────────────────────────────────────────────────┤
  │ 正文生成 → Checker 验证 → 更新 revealed_level     │
  │   source='chapter_N'                            │
  │   → reveal_estimates → 推进公开度                 │
  │   → 新建立的事实(人物关系变化/新设定揭露)           │
  │   → 违规记录 → conflict_facts                    │
  ├─────────────────────────────────────────────────┤
  │ 一键优化(optimizeChapter)                         │
  │   → 去AI味改写记录 → canon_events               │
  │   → Checker 重检 → 事实更新                      │
  └─────────────────────────────────────────────────┘
```

### 2.2 各子系统与 canon_facts 的关系

| 子系统 | 写入 canon_facts | 读取 canon_facts | 独立表保留？ |
|--------|-----------------|-----------------|------------|
| 记录官摘要(chapter_summaries) | ✅ summary + characters_appeared + key_events | - | ✅（结构化查询） |
| 事件提取器(EVENT_EXTRACTION) | - | - | 事件→story_timeline；reveal_estimates→更新canon_facts.revealed_level |
| 伏笔注册表(foreshadowing_registry) | - | ✅（一致性检查清单读取） | ✅（状态流转需要） |
| 时间线(story_timeline) | - | ✅（时间推移上下文读取） | ✅（MAX查询需要） |
| 冲突记忆(conflict_facts) | ✅ Checker 写入 | ✅ buildStateContext 读取 | ✅（冲突追踪需要） |
| Checker | ✅ 违规→conflict_facts；reveal_estimates→canon_facts | ✅ 读取 hard_rules + entity names | - |
| 去AI味(deslop) | ✅ 改写记录→canon_events | ✅ 读取 forbidden + hard_rules | - |
| 禁词库 | ✅ 规则→canon_facts(writing_rule) | - | - |

---

## 三、数据模型变更

### 3.1 canon_facts 字段扩展

```sql
ALTER TABLE canon_facts ADD COLUMN fact_version INTEGER DEFAULT 1;
ALTER TABLE canon_facts ADD COLUMN replaced_by TEXT DEFAULT '';
ALTER TABLE canon_facts ADD COLUMN established_at TEXT DEFAULT '';
ALTER TABLE canon_facts ADD COLUMN tags TEXT DEFAULT '[]';
ALTER TABLE canon_facts ADD COLUMN last_event_at TEXT DEFAULT '';
```

### 3.2 新增 canon_events 表（事实变更日志）

```sql
CREATE TABLE IF NOT EXISTS canon_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  fact_id INTEGER,
  event_type TEXT NOT NULL,       -- 'created'|'updated'|'conflicted'|'obsoleted'|'revealed'|'verified'
  chapter_number INTEGER,
  source TEXT DEFAULT '',         -- 'checker'|'deslop'|'manual'|'outline_gen'|'volume_gen'
  old_value TEXT DEFAULT '',
  new_value TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
```

### 3.3 表清理

| 表 | 操作 |
|----|------|
| setting_libraries | ✅ 保留(外部参考模板) |
| style_libraries | ✅ 保留 |
| personality_projects | ✅ 保留 |
| disassembly_projects | ✅ 保留 |
| conflict_facts | ✅ 保留 + 补充 Checker 写入 |
| character_cards | 已DROP(迁移代码) |
| world_settings | 已DROP(迁移代码) |

---

## 四、统一事实簿 API 层

新增 `src/services/canonService.ts`：

```typescript
// ===== 读取 =====

/** 获取项目的活跃事实 */
getActiveFacts(projectId: number): Promise<CanonFact[]>

/** 获取需要在本章关注的事实（硬规则 + 信息权限分级） */
getChapterFacts(projectId: number, chapterNum: number): Promise<{
  hardRules: string
  infoPermissions: string
  revealedMap: Map<string, number>
}>

/** 获取写作规则（禁词库） */
getWritingRules(projectId: number): Promise<BannedPattern[]>

// ===== 写入 =====

/** 创建/更新事实（同 project_id+fact_key 去重） */
upsertFact(params: {
  projectId: number; category: string; key: string; value: string
  isHardRule: boolean; source: string; chapterNumber?: number
  revealedLevel?: number; confidence?: string; details?: object
}): Promise<number>

/** 批量推进公开度 */
batchUpdateRevealedLevel(
  projectId: number,
  updates: { factKey: string; newLevel: number }[]
): Promise<void>

/** 标记事实为废弃 */
obsoleteFact(factId: number, replacedByFactId: number): Promise<void>

/** 从章节 Checker 结果更新事实 */
updateFromChapter(
  projectId: number, chapterNum: number,
  events: EventExtractionResult, violations: Violation[]
): Promise<{ factUpdates: number; conflicts: number }>

/** 清除指定来源的所有事实（大纲重生成时用） */
clearBySource(projectId: number, source: string): Promise<number>

/** 批量导入事实（大纲提取后使用） */
batchUpsert(projectId: number, facts: CanonFactInput[]): Promise<number>

// ===== 禁词库 =====

/** 保存写作规则 */
saveWritingRule(projectId: number, pattern: string, replacement: string, level: number): Promise<void>

/** 删除写作规则 */
deleteWritingRule(projectId: number, ruleId: number): Promise<void>

// ===== 冲突 =====

/** 检测事实冲突 */
detectConflicts(projectId: number): Promise<ConflictFact[]>

/** 解决冲突 */
resolveConflict(conflictId: number, resolution: string): Promise<void>
```

---

## 五、合约强制清单

### 5.1 大纲 → 事实簿（输入输出全链路验证）

```
输入链：
  外部设定库(setting_libraries) → buildSettingContext() → genOutline prompt
  拆文库(disassembly_projects) → buildDisassemblyContext() → genOutline prompt
  canon_facts(硬规则) → genOutline prompt

genOutline 输出 → CANON_EXTRACTION 输入
  ┌─ 合约：CANON_EXTRACTION_USER 接受 outlineContent.slice(0,5000)
  │  **修复**：改为分段提取 → slice(0,3000) + slice(-2000) + sample中段2000
  │  **合约**：CANON_EXTRACTION_SYSTEM 期望 JSON 数组，每个对象含 fact_category/fact_key/fact_value/is_hard_rule
  └─ ✅ 匹配

CANON_EXTRACTION 输出 → canonService.batchUpsert 输入
  ┌─ 合约：AI返回JSON数组 → batchUpsert 接受 CanonFactInput[]
  │  **修复**：使用健壮JSON解析（tryParseJSON + 3次重试）
  │  **修复**：解析前清理 ```json 标记
  └─ ⚠ 需修复

canonService 输出 → genVolume/genDetail/genChapter 输入
  ┌─ 合约：getChapterFacts() 返回 { hardRules: string, infoPermissions: string }
  │  下游 genVolume 接受 canonFactsContext: string
  │  下游 genDetail(细纲) 接受 canonFactsContext: string
  │  下游 genChapter(正文) 接受 canonFactsContext: string
  └─ ✅ 数据类型匹配
```

### 5.2 卷纲 → 事实簿

```
genSingleVolume 输出 → 合约检查
  ┌─ VOLUME_OUTLINE_USER: JSON 卷纲（8节点 + chapter_summaries + ...）
  │  foreshadowing_plant[] → foreshadowing_registry ✅ 已有写入
  │  character_milestones[] → canonService.upsertFact(新增)
  │  volume_forbidden[] → 不写canon_facts (卷级禁区，非全局事实)
  └─ ⚠ character_milestones 增补写入

genSingleVolume 的输入约束
  ┌─ 合约：genSingleVolume 读取 getRefs() 中的 disassemblyContext + settingLibContext + cardContext
  │  **已验证**：disassemblyContext ✅ | settingLibContext ✅ | cardContext ✅
  └─ ✅ 全部匹配
```

### 5.3 细纲 → 事实簿预验证

```
genSingleChapterPlan 输出 → 合约检查
  ┌─ ChapterPlan JSON: plot_beats[], forbidden[], emotional_arc, hooks...
  │
  │ 新增预验证：
  │   ① forbidden 对照 canon_facts: 细纲的 forbidden 是否覆盖了 fact_key 为"隐藏设定"的硬规则？
  │   ② info_reveal 对照 canon_facts.revealed_level: 细纲的 max_info_reveal 是否与当前公开度一致？
  │   ③ emotion_cap 对照 canon_facts: 如果有感情阶段记录，细纲上限是否合理？
  │
  │  预验证结果：不阻塞生成，但 showToast('warning') 标注不匹配
  └─ ⚠ 新增功能

genSingleChapterPlan 的输入约束
  ┌─ 合约：genSingleChapterPlan 接收 config(primaryStyleId, primaryPersonalityId...)
  │  **已验证**：styleContext ✅ | personalityContext ✅ | canonFactsContext ✅
  │  **已验证**：不再接收 disassemblyContext（已移除）
  └─ ✅ 全部匹配
```

### 5.4 正文 → Checker → 事实簿

```
genChapter 输出 → Checker 输入
  ┌─ 合约：checkChapter(chapterText, plan, facts, timelineHistory, currentAbsoluteDay, projectId)
  │  chapterText: string ← genChapter 纯文本输出 ✅
  │  plan: ChapterPlan ← chapterPlans state ✅
  │  facts: CanonFact[] ← getChapterFacts() ✅
  │  timelineHistory: TimelineEvent[] ← story_timeline 查询 ✅
  │  currentAbsoluteDay: number | null ← story_timeline MAX查询 ✅
  └─ ✅ 全部匹配

Checker 输出 → canonService.updateFromChapter 输入
  ┌─ 合约：updateFromChapter(projectId, chapterNum, events, violations)
  │  events: EventExtractionResult ← Checker 事件提取器 AI 调用
  │  violations: Violation[] ← checkChapter 返回值
  │
  │  写入：
  │    ① reveal_estimates → batchUpdateRevealedLevel
  │    ② 新事件(本体提取器结果中产生新事实的) → upsertFact
  │    ③ violations → conflict_facts
  └─ ⚠ 新增功能
```

### 5.5 一键优化 → 事实簿

```
optimizeChapter 输入
  ┌─ 合约：
  │  ① projectId: number + chapterNum: number
  │  ② chapterText: string ← editingContent state
  │  ③ chapterPlan: ChapterPlan ← chapterPlans state
  │  ④ styleContext: string ← buildStyleContext()
  │  ⑤ personalityContext: string ← buildPersonalityContext()
  │  ⑥ facts: { hardRules, infoPermissions } ← getChapterFacts()
  └─ ✅ 全部可用

optimizeChapter 输出
  ┌─ 返回：
  │  optimizedText: string → 替换 editingContent
  │  violationsFixed: number → 提示用户
  │  deslopChanges: { pattern, count }[] → 提示用户
  │  factUpdates: { factKey, change }[] → 提示用户
  └─ 下游消费：setEditingContent(optimizedText) ✅
```

---

## 六、自动更新机制

### 6.1 触发点与操作

| 触发事件 | 对 canon_facts 的操作 |
|---------|---------------------|
| 大纲生成 | batchUpsert(source='outline') |
| 大纲重新生成 | **① getChapterFacts(projectId, 0) 完整读取现有事实簿** → 注入 OUTLINE_USER prompt → ② AI 基于已有事实生成新大纲 → ③ clearBySource('outline') → ④ batchUpsert(source='outline') |
| 卷纲生成 | upsertFact(source='volume_N') ← character_milestones |
| 卷纲重新生成 | 覆盖 source='volume_N' 的事实 |
| 细纲生成 | 预验证(不写入，产生 warnings) |
| 正文生成 | updateFromChapter(events, violations) |
| 正文重新生成 | 覆盖 source='chapter_N' 的事实 |
| 一键优化 | updateFromChapter(优化后的 Checker 结果) |

### 6.2 自动覆盖机制

```
当新事实与旧事实 fact_key 相同、fact_category 相同 时：
  1. 比较 source 权威层级（source_type）：
     system_core > imported_user > auto_extracted
  2. 同一权威层级：比较 established_at 时间 → 新的覆盖旧的
  3. 不同事实值(fact_value不同)且无法判断 → 写入 conflict_facts
  4. 覆盖的旧事实：fact_version + 1, replaced_by = 新fact_id
```

### 6.3 公开度自动推进

```
canon_facts.revealed_level 更新时机：
  ┌─ 大纲提取时：硬编码初始值(character=50, event=60, relationship=40, 其余=30)
  │
  ├─ 每章 Checker 后：
  │   reveal_estimates.world → 更新 fact_category='setting'/'rule' 的 revealed_level
  │   reveal_estimates.plot → 更新 fact_category='event' 的 revealed_level
  │   reveal_estimates.character → 更新 fact_category='relationship' 的 revealed_level
  │
  └─ 推进规则：
      lv=0 → 不超过20(with 硬性禁止标记)
      lv<50 → 每章最多+15
      lv≥50 → 每章最多+10
      lv≥80 → 每章最多+5(接近完全公开时放慢)
```

---

## 七、一键全流程重构

### 7.1 optimizeChapter 函数

```typescript
async function optimizeChapter(
  projectId: number,
  chapterNum: number,
  chapterText: string,
  chapterPlan: ChapterPlan,
  styleContext: string,
  personalityContext: string,
): Promise<{
  optimizedText: string
  violationsFixed: number
  deslopChanges: string[]
  factUpdates: string[]
}> {
  const results = { violationsFixed: 0, deslopChanges: [] as string[], factUpdates: [] as string[] }

  // === Step 1: 禁词确定性扫描（纯代码，不调 AI）===
  const bannedPatterns = await canonService.getWritingRules(projectId)
  const { text: cleaned, replaced } = deterministicReplace(chapterText, bannedPatterns)
  if (replaced.length > 0) {
    results.deslopChanges = replaced.map(r => `${r.pattern}→${r.replacement}(${r.count}处)`)
    chapterText = cleaned
  }

  // === Step 2: 去AI味 AI改写 ===
  const facts = await canonService.getChapterFacts(projectId, chapterNum)
  const deslopSystem = buildStyledRewriteSystem(styleContext, personalityContext)
    + buildForbiddenConstraint((chapterPlan.forbidden || []).join('；'))
    + `\n【📖 事实簿约束——改写不能违反】\n${facts.hardRules}`

  const deslopUser = DESLOP_REWRITE_USER(chapterText, '中度', {
    styleContext, personalityContext,
    detectedPatterns: bannedPatterns.filter(p => p.level >= 3).map(p => p.pattern),
  })

  const deslopedReply = await window.electronAPI!.aiChat([
    { role: 'system', content: deslopSystem },
    { role: 'user', content: deslopUser },
  ], '去AI味')

  chapterText = deslopedReply

  // === Step 3: Checker 三层次 ===
  const checkResult = checkChapter(
    chapterText, chapterPlan,
    await getActiveFacts(projectId), /* timeline */ [], /* currentDay */ null,
    projectId
  )

  // === Step 4: 自动修复（最多2轮）===
  if (checkResult.violations.length > 0) {
    let fixed = chapterText
    for (let round = 0; round < 2 && checkResult.violations.length > 0; round++) {
      const fixPrompt = buildRewritePrompt(fixed, checkResult.violations)
      const fixReply = await window.electronAPI!.aiChat([
        { role: 'system', content: AUTO_FIX_SYSTEM },
        { role: 'user', content: AUTO_FIX_USER(chapterNum, fixed, 
          checkResult.violations.map(v => v.detail), fixPrompt) },
      ], `修复违规-第${round + 1}轮`)

      const jm = fixReply.match(/\{[\s\S]*\}/)
      if (jm) {
        const { fixes } = JSON.parse(jm[0])
        for (const { find, replace } of fixes) {
          if (find !== 'SKIP' && fixed.includes(find)) {
            fixed = fixed.replace(find, replace)
          }
        }
      }

      const recheck = checkChapter(fixed, chapterPlan, /* facts */, /* timeline */, /* day */, projectId)
      if (recheck.violations.length === 0) {
        chapterText = fixed
        results.violationsFixed += checkResult.violations.length
        break
      }
    }
    // 2轮后仍违规：标记在文本中
    if (checkResult.violations.length > 0) {
      chapterText = fixed + buildViolationMarkers(checkResult.violations)
    }
  }

  // === Step 5: 更新事实簿 ===
  const updateResult = await canonService.updateFromChapter(
    projectId, chapterNum,
    /* events */ null, checkResult.violations
  )
  results.factUpdates = updateResult.factUpdates

  return { optimizedText: chapterText, ...results }
}
```

### 7.2 禁词库迁移

```
Phase 2 迁移步骤：
  ① 读取 localStorage deslop_custom_patterns
  ② 对每条规则 → canonService.saveWritingRule(projectId, pattern, replacement, level)
  ③ DEFAULT_BANNED_PATTERNS → 批量写入 canon_facts (source='system_default')
  ④ canonService.getWritingRules(projectId) → 合并默认+用户自定义
  ⑤ 删除 localStorage 中的旧数据
  ⑥ 更新 DeslopPanel 的规则管理 UI 改为读写 canonService
```

### 7.3 去AI味与事实簿接轨

改写系统 prompt 注入：
```
【⛔ 本章禁区——改写绝对不能触碰】
${forbiddenList}

【📖 当前事实簿——改写不能违反）
${hardRules}

【📝 改写规则】
如果某个去AI味改写会导致以上任何一条被违反 → 跳过该段落，标注 [未修改-禁区]
```

---

## 八、细纲生成——源头约束

### 8.1 生成后预验证

```typescript
// 在 genSingleChapterPlan 返回后
async function validateChapterPlan(projectId: number, plan: ChapterPlan): Promise<{
  warnings: string[]
  missingForbidden: string[]
}> {
  const facts = await canonService.getChapterFacts(projectId, plan.chapter_number)
  const warnings: string[] = []
  const missingForbidden: string[] = []

  // 检查：forbidden 是否覆盖了 revealed_level=0 的事实
  for (const [key, level] of facts.revealedMap) {
    if (level === 0) {
      const covered = (plan.forbidden || []).some(f => f.includes(key))
      if (!covered) {
        missingForbidden.push(`禁止揭示：${key}`)
        warnings.push(`细纲缺少禁区覆盖: "${key}" (公开度0%)`)
      }
    }
  }

  // 检查：emotion_cap 是否与记录的感情阶段一致
  if (plan.emotion_cap) {
    // 对比 canon_facts 中感情线的事实
  }

  return { warnings, missingForbidden }
}

// 调用处：
const { warnings, missingForbidden } = await validateChapterPlan(Number(id), newPlan)
if (missingForbidden.length > 0) {
  newPlan.forbidden = [...(newPlan.forbidden || []), ...missingForbidden]
  // 保存时包含自动补充的禁区
}
if (warnings.length > 0) {
  showToast('warning', `细纲与事实簿有${warnings.length}处不匹配，已自动补充${missingForbidden.length}条禁区`)
}
```

### 8.2 正文生成时的源头注入

```typescript
// genChapter() 中，在构建 userPrompt 之前
const facts = await canonService.getChapterFacts(projectId, chapNum)

// 自动补充细纲遗漏的禁区
const autoForbidden = []
for (const [key, level] of facts.revealedMap) {
  if (level === 0 && !(plan.forbidden || []).some(f => f.includes(key))) {
    autoForbidden.push(`禁止揭示：${key}`)
  }
}
if (autoForbidden.length > 0) {
  plan.forbidden = [...(plan.forbidden || []), ...autoForbidden]
}

// 注入事实簿约束到 userPrompt 顶部
userPrompt = `【📖 事实簿约束——以下硬规则不可违反】
${facts.hardRules}

${facts.infoPermissions}

` + userPrompt
```

---

## 九、所有已发现问题修复清单

### 报告第六章（12 项）

| # | 问题 | 状态/修复方案 | 阶段 |
|---|------|-------------|------|
| 1 | ChapterEditor 缺少细纲约束 | ✅ 已修复 | done |
| 2 | 记录官/事件提取/StatePatch 重叠 | canonService 统一读取（不合并AI调用） | Phase 2 |
| 3 | ChapterEditor 缺少 Checker | 一键全流程覆盖 ChapterEditor | Phase 3 |
| 4 | 上下文预算未被调用 | ✅ 已接入 | done |
| 5 | 去AI味不传递禁区 | ✅ 已修复 | done |
| 6 | 大纲截断→事实簿不完整 | CANON_EXTRACTION 分段提取(前3k+中段采样+后2k) | Phase 1 |

### 报告第十章（10 项）

| # | 问题 | 修复方案 | 阶段 |
|---|------|---------|------|
| A | canon_facts 来源单一不更新 | canonService 在卷纲/正文后自动更新 | Phase 1 |
| B | context_state 更新脆弱 | JSON解析3次重试 + 代码fallback构造 | Phase 2 |
| C | V1/V2 细纲断层 | genSingleChapterPlan强制V2格式 + 验证 | Phase 2 |
| D | 角色上下文格式分裂 | buildMinimalContext适配canon_facts details | Phase 2 |
| E | conflict_facts 空表 | Checker写入了冲突写入 | Phase 2 |
| F | 节点匹配正则脆弱 | 容错多种章段格式 | Phase 3 |
| G | cool_moment 传了没用 | CHAPTER_USER消费 | Phase 3 |
| H | consistencyChecklist 双赋值 | 删除重复行 | Phase 1 |
| I | revealed_level 从不更新 | canonService.updateFromChapter | Phase 1 |
| J | buildMinimalContext 字段名过时 | 适配canon_facts.details双向格式 | Phase 2 |

### 新增问题（5 项）

| # | 问题 | 修复方案 | 阶段 |
|---|------|---------|------|
| K | 准备方案截断500字丢信息 | 智能采样保留角色+世界观 | Phase 3 |
| L | DETAIL_OUTLINE_SYSTEM 死代码 | 统一或删除 | Phase 3 |
| M | 禁词规则在 localStorage 不安全 | 迁移到canonService | Phase 2 |
| N | 细纲缺少canon_facts预验证 | validateChapterPlan | Phase 2 |
| O | 正文生成缺少源头事实簿注入 | 自动补充forbidden + 事实簿 prepend | Phase 3 |

---

## 十、实施阶段（更新）

### Phase 1：事实簿核心可用（基础）

| # | 任务 | 文件 |
|---|------|------|
| 1.1 | 创建 `canonService.ts` | 新文件 |
| 1.2 | ALTER canon_facts 新增字段 | database.ts |
| 1.3 | 创建 canon_events 表 | database.ts |
| 1.4 | CANON_EXTRACTION 分段提取 | generator.ts |
| 1.5 | genOutline 后 canonService.clearBySource('outline') + batchUpsert | Workspace.tsx |
| 1.6 | genChapter 前 canonService.getChapterFacts | Workspace.tsx |
| 1.7 | Checker 后 canonService.updateFromChapter | Workspace.tsx |
| 1.8 | 修复 consistencyChecklist 双赋值 | Workspace.tsx |
| 1.9 | revealed_level 推进(从 reveal_estimates) | canonService.ts |

### Phase 2：系统整合 + 冗余消除

| # | 任务 | 文件 |
|---|------|------|
| 2.1 | buildMinimalContext 适配 canon_facts details 双格式 | generator.ts |
| 2.2 | buildStateContext 适配新格式 | generator.ts |
| 2.3 | Checker 输出→conflict_facts 写入 | checker.ts |
| 2.4 | context_state 更新加固(重试+fallback) | Workspace.tsx |
| 2.5 | genSingleChapterPlan 强制V2格式 + validateChapterPlan | Workspace.tsx |
| 2.6 | 禁词库迁移 localStorage→canonService | deslop.ts + canonService.ts |
| 2.7 | Deslop 改写后记录 canon_events | DeslopPanel.tsx |
| 2.8 | genSingleVolume 后 character_milestones→canonService | Workspace.tsx |

### Phase 3：一键全流程 + UI

| # | 任务 | 文件 |
|---|------|------|
| 3.1 | 创建 optimizeChapter() | Workspace.tsx |
| 3.2 | UI：替换分散按钮为"🤖 一键优化本章" | Workspace.tsx |
| 3.3 | genSingleChapterPlan 后 validateChapterPlan 自动补充forbidden | Workspace.tsx |
| 3.4 | genChapter 源头注入事实簿约束 + auto-supplement forbidden | Workspace.tsx |
| 3.5 | ChapterEditor 集成 optimizeChapter | ChapterEditor.tsx |
| 3.6 | 节点匹配容错 | VolumePanel.tsx |
| 3.7 | cool_moment→CHAPTER_USER 消费 | generator.ts |
| 3.8 | 准备方案智能采样 | generator.ts |
| 3.9 | 清理 DETAIL_OUTLINE_SYSTEM 死代码 | generator.ts |

---

## 十一、风险缓解

| 风险 | 措施 |
|------|------|
| canon_facts 表膨胀 | fact_version>3 的旧版本定期清理 |
| 迁移中数据丢失 | Phase 1+2 保留旧表备份(通过 SQL 导出) |
| AI JSON 返回格式异常 | canonService 所有解析用 tryParseJSON(3次重试+校验+schema验证+日志) |
| 一键全流程耗时 | 显示分步进度条，可中途取消，每步可独立回退 |
| 事实簿初始为空不阻塞 | genChapter/detail 检测 canon_facts 为空时静默跳过 |
| V1 细纲降级风险 | genSingleChapterPlan 强制输出 V2 字段，V1 fallback 标记 warning |

---

## 十二、UI 设计规范

### 12.1 资源选择面板（生成配置）

所有 GenPanel 统一为以下结构：

```
┌────────────────────────────────────────────┐
│ 🤖 生成大纲 — 选择参考                    ✕ │
├────────────────────────────────────────────┤
│                                            │
│ 📚 拆文库                     [展开/收起 ▼]│
│ ┌──────────────────────────────────────┐   │
│ │ ☑ 主  ○ 辅  《斗破苍穹》已拆解       │   │
│ │ ☐ 主  ☑ 辅  《诡秘之主》已拆解       │   │
│ └──────────────────────────────────────┘   │
│                                            │
│ 📋 设定库                     [展开/收起 ▼]│
│ ┌──────────────────────────────────────┐   │
│ │ ☑ 主  ☐ 辅  《三国设定》            │   │
│ └──────────────────────────────────────┘   │
│                                            │
│ 💡 额外提示（可选）                        │
│ ┌──────────────────────────────────────┐   │
│ │ 请更侧重感情线的推进...               │   │
│ └──────────────────────────────────────┘   │
│                                            │
│ 📊 上下文预算: 角色 ~1200tokens · 总计 ~3500│
│                                            │
│ [ ⏹ 取消 ]              [ 🚀 确认生成 ]   │
└────────────────────────────────────────────┘
```

**设计原则**：
- 每个库独立一个可折叠区域（默认展开，项 > 5 时默认收起）
- 主/辅选择用 checkbox（☑主）切换
- 选中的库数量显示在折叠标题旁边（如"拆文库（已选 2）"）
- 底部固定：取消(灰色边框) + 确认(主题色实心)
- 上下文预算实时更新

### 12.2 侧边栏（右侧卷纲/细纲面板）

```
┌─ 卷纲与细纲 ──────────────────────────────┐
│ [+ 新建卷]  [📐 生成下一卷]              │
├──────────────────────────────────────────┤
│ ▼ 第一卷《初入江湖》（第1-15章）          │
│   概要：少年林辰偶得传承...               │
│   节点：开篇(1-6)→发展(7-10)→...        │
│   ┌ 章节列表 ──────────────────────────┐ │
│   │ ● 1. 废柴少年    [编辑] [🔄] [⠿]  │ │
│   │ ● 2. 意外传承    [编辑] [🔄] [⠿]  │ │
│   │ ○ 3. 未生成       [需上章]          │ │
│   └────────────────────────────────────┘ │
│                                          │
│ ▶ 第二卷《风云际会》（第16-30章）[收起]  │
└──────────────────────────────────────────┘
```

### 12.3 一键优化面板

```
┌─ 🛠 本章优化 ────────────────────────────┐
│ 进度: [████████░░] 80%                    │
│                                          │
│ ✅ 禁词扫描 — 已清理 12 处                │
│ ✅ 去AI味改写 — 修改 5 个段落             │
│ ⏳ Checker检查 — 正在分析...              │
│ ⬜ 自动修复                               │
│ ⬜ 更新事实簿                             │
│                                          │
│ [ ⏹ 取消优化 ]                           │
└──────────────────────────────────────────┘
```

### 12.4 事实簿面板（新建设定管理 UI）

```
┌─ 📖 事实簿 — 本项目设定 ──────────────────┐
│ [角色 ▼] [世界观 ▼] [规则 ▼] [关系 ▲]      │
│                                            │
│ 🔴 硬规则（不可违反）                       │
│ ┌──────────────────────────────────────┐   │
│ │ 林辰 — 男，25岁，青云宗外门弟子       │ ✎ │
│ │ 修炼等级 — 九品制，一品最高           │ ✎ │
│ └──────────────────────────────────────┘   │
│                                            │
│ 🟡 软设定（可演化）                         │
│ ┌──────────────────────────────────────┐   │
│ │ 林辰与苏云 — 师徒关系(公开度75%)      │ ✎ │
│ │ 灵石矿脉 — 位于青云宗后山(公开度40%)  │ ✎ │
│ └──────────────────────────────────────┘   │
│                                            │
│ ⚠ 冲突（2 项未解决）                       │
│ ┌──────────────────────────────────────┐   │
│ │ "林辰25岁" vs "林辰入门时18岁+7年"   │ ↙ │
│ └──────────────────────────────────────┘   │
│                                            │
│ [+ 手动添加事实]                            │
└────────────────────────────────────────────┘
```

---

## 十三、取消逻辑规范

### 13.1 所有 AI 生成操作统一取消策略

```typescript
// 全局取消状态（Workspace 中维护）
const cancelledRef = useRef(false)
const generatingRef = useRef(false)

/** 明确的取消处理 */
const handleCancel = () => {
  cancelledRef.current = true
  window.electronAPI?.cancelAi()           // ① 通知主进程 abort 当前请求
  setGenerating(false)
  setGenTarget('')
  setStreamingText('')
  showToast('info', '已取消')              // ② 提示用户
}
```

### 13.2 取消触发场景

| 场景 | 行为 |
|------|------|
| 点击生成面板 [⏹ 取消] 按钮 | `handleCancel()` |
| 点击生成提示条 [⏹ 取消生成] | `handleCancel()` |
| 导航到其他页面（useParams 变化） | `useEffect` cleanup 中 `handleCancel()` |
| 组件卸载 | `useEffect` return 中检查 `generatingRef.current`，若正在生成则取消 |
| 关闭窗口/应用 | 主进程 `app.on('before-quit')` 中 abort 当前请求 |

### 13.3 实现细节

```typescript
// Workspace.tsx — 离开时自动取消
useEffect(() => {
  return () => {
    if (generatingRef.current || narrativeReportLoadingRef.current) {
      cancelledRef.current = true
      window.electronAPI?.cancelAi()
      // 静默取消，不清除 toast（组件已卸载）
    }
  }
}, [])
```

### 13.4 取消状态传播

```
用户操作 → cancelledRef.current = true
  ├── genOutline/genVolume/genChapter: 检查 cancelledRef → return 不保存
  ├── AI stream: signal abort → 主进程发送 error='已取消'
  ├── 渲染进程: onStreamChunk 收到 error → cleanup
  └── 所有 async 函数: catch(A abortError) → showToast('info', '已取消') → return
```

所有 AI 生成路径统一在 try 块顶部和每个 await 后检查 `cancelledRef.current`。

---

## 十四、验证清单

重构完成后逐项确认：

- [ ] 大纲生成 → canon_facts 有来自 source='outline' 的数据
- [ ] 大纲重新生成 → 旧 source='outline' 数据清除，新数据写入
- [ ] 卷纲生成 → canon_facts 中有 source='volume_1' 的角色状态
- [ ] 细纲生成 → 控制台无"与事实簿冲突"warning，forbidden 自动补充
- [ ] 正文生成 → userPrompt 顶部包含 `【📖 事实簿约束】`
- [ ] Checker 后 → canon_facts.revealed_level 被推进
- [ ] Checker 违规 → conflict_facts 有新记录
- [ ] 一键优化 → 依次完成：禁词→去AI味→Checker→修复→事实簿更新
- [ ] 禁词库编辑 → canon_facts 中有 writing_rule 记录
- [ ] context_state → JSON 解析失败时 fallback 也正常更新
- [ ] buildMinimalContext → 从 canon_facts details 正确解析角色/世界信息
- [ ] 外部设定库 → 数据完整保留在 setting_libraries 表中（未被修改）

---

*计划版本 v2（修订版）。关键修正：区分外部设定库与内部事实簿。*
