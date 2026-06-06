# novel-ai-writer v3 全局重构计划

> 基于架构分析报告(v2)全部发现 + 用户需求整合  
> 核心目标：统一事实簿 → 消除冗余 → 合约强制 → 一键全流程

---

## 一、架构决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 数据架构 | 核心合并 + 关键独立表 | canon_facts 吸收设定库运行时数据 + 记录官摘要 + 事件；时间线/伏笔保留独立表（需要高效结构化查询） |
| 库的定位 | 全部独立 | 风格库/人格库/拆文库/设定库 作为"素材模板池"保持独立表，不合并进 canon_facts。但项目引用设定库时，角色/世界观/规则数据**复制**进 canon_facts |
| 一键全流程 | 点击触发，内部分步 | 禁词扫描→去AI味→Checker检查→自动修违规→更新事实簿，串联为一个操作但不合并 prompt |

## 二、核心概念重新定义

### 2.1 事实簿(canon_facts) 新定位

**以前**：仅在大纲生成后提取一次，后续永不更新  
**以后**：贯穿创作全生命周期的**统一事实记录系统**

```
canon_facts 的生命周期：
  大纲生成 → 初始提取(限5000字) → source='outline'
  卷纲生成 → 补充/更新/冲突标记 → source='volume_N'
  细纲生成 → 预验证事实一致性 → 不写入但检验
  正文生成 → Checker 验证 → 冲突记录 → source='chapter_N'
  去AI味   → 修改记录 → source='deslop_N'
  用户手动 → 直接编辑 → source='manual'
```

### 2.2 四个子系统在 canon_facts 中的角色

| 子系统 | 在 canon_facts 中的表现 | 独立表保留？ |
|--------|------------------------|------------|
| 设定库 | 作为 `source='setting_lib_${id}'` 的事实来源 | ✅ style_libraries/disassembly_projects/personality_projects/setting_libraries 全部保留 |
| 记录官摘要 | `chapter_summaries` 表保留(结构化查询需要)，但摘要内容同时作为 `fact_category='chapter_summary'` 写入 canon_facts | ✅ chapter_summaries 保留 |
| 事件提取器 | 事件列表写入 `story_timeline` 表；reveal_estimates 写入对应的 canon_facts.revealed_level 更新 | ✅ story_timeline 保留 |
| 伏笔注册表 | 保留独立表（状态流转需要结构化查询） | ✅ foreshadowing_registry 保留 |

---

## 三、数据模型变更

### 3.1 canon_facts 表字段扩展

```sql
-- 新增/修改字段
ALTER TABLE canon_facts ADD COLUMN fact_version INTEGER DEFAULT 1;        -- 事实版本号
ALTER TABLE canon_facts ADD COLUMN replaced_by TEXT DEFAULT '';           -- 被哪个新事实取代(JSON: {fact_id, updated_at})
ALTER TABLE canon_facts ADD COLUMN established_at TEXT DEFAULT '';        -- 事实确立的阶段：outline|volume|detail|chapter|manual
ALTER TABLE canon_facts ADD COLUMN chapter_range TEXT DEFAULT '';         -- 事实适用的章节范围（如"1-40"）
ALTER TABLE canon_facts ADD COLUMN tags TEXT DEFAULT '[]';                -- 标签(JSON数组，用于分类搜索)
ALTER TABLE canon_facts ADD COLUMN last_event_at TEXT DEFAULT '';         -- 最后事件触发时间

-- 索引
CREATE INDEX IF NOT EXISTS idx_canon_category ON canon_facts(fact_category);
CREATE INDEX IF NOT EXISTS idx_canon_source ON canon_facts(source);
CREATE INDEX IF NOT EXISTS idx_canon_established ON canon_facts(established_at);
```

### 3.2 新增 canon_events 表（事实变更日志）

```sql
CREATE TABLE IF NOT EXISTS canon_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  fact_id INTEGER,                          -- 关联的 canon_fact
  event_type TEXT NOT NULL,                 -- 'created'|'updated'|'conflicted'|'obsoleted'|'revealed'|'verified'
  chapter_number INTEGER,                   -- 触发章节
  source TEXT DEFAULT '',                   -- 触发源：checker|deslop|manual|outline_gen|volume_gen
  old_value TEXT DEFAULT '',                -- 变更前值(JSON)
  new_value TEXT DEFAULT '',                -- 变更后值(JSON)
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_canon_events_project ON canon_events(project_id, created_at);
```

### 3.3 表清理计划

| 表 | 操作 | 说明 |
|----|------|------|
| setting_libraries | 保留 | 作为模板库 |
| character_cards | 已DROP(迁移代码) | ← 确认已执行 |
| world_settings | 已DROP(迁移代码) | ← 确认已执行 |
| conflict_facts | 保留 + 补充写入逻辑 | 冲突表，由 Checker 写入 |

---

## 四、统一事实簿 API 层

新增 `src/services/canonService.ts`，作为所有事实操作的唯一入口：

```typescript
// ===== 读取 =====

/** 获取项目的活跃事实（排除已废弃的） */
getActiveFacts(projectId: number): Promise<CanonFact[]>

/** 获取事实的当前公开度 */
getRevealedLevel(projectId: number, factKey: string): number

/** 获取需要在本章关注的事实（硬规则 + 信息权限分级） */
getChapterFacts(projectId: number, chapterNum: number): Promise<{
  hardRules: string,        // 硬规则文本
  infoPermissions: string,  // 信息权限文本
  revealedMap: Map<string, number>
}>

// ===== 写入 =====

/** 创建或更新一个事实（同一 project_id + fact_key 去重） */
upsertFact(params: {
  projectId: number
  category: FactCategory
  key: string
  value: string
  isHardRule: boolean
  source: string           // 'outline'|'volume_1'|'chapter_5'|'setting_lib_X'|'checker'|'manual'
  chapterNumber?: number
  revealedLevel?: number
  confidence?: 'low'|'medium'|'high'
  details?: object
}): Promise<number>

/** 批量更新多个事实的公开度 */
batchUpdateRevealedLevel(projectId: number, updates: { factKey: string; newLevel: number }[]): Promise<void>

/** 标记事实为废弃（被新事实取代） */
obsoleteFact(factId: number, replacedByFactId: number): Promise<void>

/** 从设定库导入事实到项目 */
importFromSettingLibrary(projectId: number, settingLibId: number): Promise<number>

/** 从章节生成结果更新事实 */
updateFromChapter(projectId: number, chapterNum: number, events: ExtractedEvent[]): Promise<void>

// ===== 冲突 =====

/** 检测并记录事实冲突 */
detectConflicts(projectId: number): Promise<ConflictFact[]>

/** 解决冲突 */
resolveConflict(conflictId: number, resolution: 'keep_a'|'keep_b'|'merge'|'accept_both'): Promise<void>
```

---

## 五、合约强制清单

每个数据传递点都需验证输入输出匹配：

### 5.1 大纲 → 事实簿提取

| 检查点 | 验证 |
|--------|------|
| OUTLINE 输出格式 | ✅ Markdown（调用方不用改） |
| CANON_EXTRACTION 输入 | ⚠ 当前截断 5000 字 → **改为分段提取**（前3000+中间2000+后2000） |
| CANON_EXTRACTION 输出 → canon_facts 写入 | ✅ 已有写入逻辑，需增加 `upsertFact` 替换 |
| canon_facts 输出 → genVolume/genDetail/genChapter | ✅ 通过 `getChapterFacts()` 统一读取 |

### 5.2 卷纲 → 事实簿更新

| 检查点 | 验证 |
|--------|------|
| genSingleVolume 输出格式 | ✅ JSON 卷纲 |
| 卷纲中的伏笔 → foreshadowing_registry | ✅ 已有写入逻辑 |
| **新增**：卷纲中的角色里程碑 → canon_facts | ❌ 当前无 → **新增**：角色状态变化写入 canon_facts |
| **新增**：卷纲生成后自动运行冲突检测 | ❌ 当前无 → **新增** |

### 5.3 细纲 → 事实簿预验证

| 检查点 | 验证 |
|--------|------|
| genSingleChapterPlan 输出 | ✅ JSON ChapterPlan |
| **新增**：细纲 forbidden → 对照 canon_facts 验证 | ❌ 当前无 → **新增**：细纲生成后检查 forbidden 是否与 canon_facts 冲突 |
| **新增**：细纲 plot_beats → 检查是否引用了未公开的事实 | ❌ 当前无 → **新增** |

### 5.4 正文 → Checker → 事实簿更新

| 检查点 | 验证 |
|--------|------|
| genChapter 输出 | ✅ 纯文本 |
| Checker 输入 | ✅ chapterText + plan + facts |
| **新增**：Checker 输出 → canon_facts 更新 | ❌ 当前无 → **新增**：违规 → conflict_facts；reveal_estimates → 更新 revealed_level |
| **新增**：去AI味 输出 → canon_facts 修改记录 | ❌ 当前无 → **新增** |

### 5.5 去AI味 + 禁词库 → 事实簿

| 检查点 | 验证 |
|--------|------|
| 禁词扫描输入 | ✅ 正文文本 |
| 去AI味改写输入 | ✅ 正文 + forbiddenContext(已修复) |
| **新增**：去AI味改写输出 → canon_events 记录 | ❌ 当前无 → **新增** |
| **新增**：用户自定义禁词 → canon_facts (writing_rule) | ❌ 当前无 → **新增**：从 localStorage 迁移到 canon_facts |

---

## 六、自动更新机制

### 6.1 触发点设计

```
┌──────────────┐
│  大纲生成      │──→ 初始事实提取(canon_extraction) → upsertFact
│  genOutline   │     (前3000+中2000+后2000 分段提取)
└──────────────┘

┌──────────────┐
│  大纲重新生成   │──→ 清除 source='outline' 的事实 → 重新提取
│  (重新生成)    │     旧事实标记为 obsoleted → canon_events 记录
└──────────────┘

┌──────────────┐
│  卷纲生成      │──→ ① 角色里程碑 → canon_facts (character状态)
│  genSingleVol │     ② 卷纲伏笔 → foreshadowing_registry (已有)
└──────────────┘     ③ 冲突检测(新增)

┌──────────────┐
│  细纲生成      │──→ ① 对照 canon_facts 验证 forbidden
│  genSingleCP  │     ② 对照 canon_facts 验证 info_reveal
└──────────────┘     (预验证，不写入，输出 warnings)

┌──────────────┐
│  正文生成      │──→ ① Checker 检查 → 违规 → conflict_facts
│  genChapter   │     ② reveal_estimates → canon_facts.revealed_level
└──────────────┘     ③ buildStatePatch → chapter_summaries + story_timeline

┌──────────────┐
│  一键优化      │──→ ① 禁词扫描
│  optimizeChap │     ② 去AI味改写 → canon_events 记录
└──────────────┘     ③ Checker → 修复 → canon_facts 更新
                     ④ 全部完成后 checkChapter 重新检查
```

### 6.2 事实过期自动覆盖策略

```
新增事实时：
  SELECT * FROM canon_facts 
  WHERE project_id=? AND fact_key=? AND fact_category=?
  
  如果存在：
    比较 source 的权威层级：
      system_core > imported_user > auto_extracted
    比较 established_at 的时间先后：
      volume_5 > volume_3 > outline
    同一事实(fact_key相同)：
      新值 → fact_version + 1, 旧值 → obsoleted(fact_id → replaced_by)
    冲突事实(同一 fact_key 但不同 fact_value)：
      → 写入 conflict_facts
```

---

## 七、去AI味 + 校对 + 禁词库 重构

### 7.1 一键全流程 (`optimizeChapter`)

```typescript
async function optimizeChapter(
  projectId: number,
  chapterNum: number,
  chapterText: string,
  chapterPlan: ChapterPlan,
  styleContext: string,
  personalityContext: string,
): Promise<{
  optimizedText: string,
  violationsFixed: number,
  deslopChanges: { pattern: string; count: number }[],
  factUpdates: { factKey: string; change: string }[]
}> {
  const results = { violationsFixed: 0, deslopChanges: [], factUpdates: [] }

  // Step 1: 禁词确定性扫描 + 替换（纯代码，不调AI）
  const { text: cleaned, replaced } = deterministicReplace(chapterText)
  if (replaced > 0) {
    results.deslopChanges.push(...replaced)
    chapterText = cleaned
  }

  // Step 2: 去AI味 AI改写（携带 forbidden + canon_facts 约束）
  const facts = await getChapterFacts(projectId, chapterNum)
  const deslopPrompt = buildOptimizedDeslopSystem(
    styleContext, personalityContext,
    chapterPlan.forbidden || [],
    facts.hardRules
  )
  const { text: desloped } = await aiDeslopRewrite(chapterText, deslopPrompt)

  // Step 3: Checker 三层次检查
  const checkResult = checkChapter(desloped, chapterPlan, facts, ...)

  // Step 4: 自动修复违规（最多2轮）
  if (checkResult.violations.length > 0) {
    const fixPrompt = buildRewritePrompt(desloped, checkResult.violations)
    const { text: fixed } = await aiAutoFix(desloped, fixPrompt)
    const recheck = checkChapter(fixed, chapterPlan, facts, ...)

    if (recheck.violations.length === 0) {
      chapterText = fixed
      results.violationsFixed = checkResult.violations.length
    } else {
      // 2轮后仍有违规：标记在文本中，让用户手动处理
      chapterText = fixed + buildViolationMarkers(recheck.violations)
    }
  } else {
    chapterText = desloped
  }

  // Step 5: 更新事实簿
  const factUpdates = await canonService.updateFromChapter(
    projectId, chapterNum, checkResult.events
  )
  results.factUpdates = factUpdates

  return { optimizedText: chapterText, ...results }
}
```

### 7.2 禁词库迁移

| 当前 | 以后 |
|------|------|
| `localStorage deslop_custom_patterns` | `canon_facts` 表 `fact_category='writing_rule'` |
| 仅本地生效 | 随项目存储，可导出 |
| `getEffectivePatterns()` 合并 localStorage + 默认 | `canonService.getWritingRules(projectId)` 读取 |

### 7.3 去AI味与事实簿接轨

改写 prompt 中注入：
```
【⛔ 本章禁区——改写绝对不能触碰】
${forbiddenList}

【📖 当前事实簿——改写不能违反】
- 角色「林辰」性别男（硬规则）
- 时间线：第 45 天
- 感情阶段：3/10（本章上限）

【📝 改写规则】
如果某个去AI味改写会导致以上任何一条被违反 → 跳过该改写，标注 [未修改]
```

---

## 八、细纲生成与事实簿接轨

### 8.1 genSingleChapterPlan 改造

当前细纲生成不接受 canon_facts（刚修复，但验证是事后）。改为：

```typescript
// genSingleChapterPlan 改造后流程
① 读取 canon_facts → getChapterFacts(projectId, chapNum)
② 注入细纲 system prompt（已有）
③ AI 生成细纲
④ 自动验证：
   - 细纲 forbidden 是否与 canon_facts 硬规则冲突？
   - 细纲 plot_beats 中是否引用了 revealed_level=0 的事实？
   - 细纲 emotion_cap 是否与 canon_facts 感情阶段一致？
⑤ 发现冲突 → showToast('warning', '细纲与事实簿有X处冲突，请检查') + 高亮标记
```

### 8.2 正文生成源头约束

在 `genChapter` 的 userPrompt 构建前，添加：

```typescript
// 源头约束检查
const facts = await getChapterFacts(projectId, chapNum)

// 如果细纲 forbidden 缺少了 canon_facts 中 revealed_level=0 的关键事实
const missingForbidden = facts.revealedMap
  .filter(([key, level]) => level === 0 && !plan.forbidden?.some(f => f.includes(key)))
  .map(([key]) => `禁止揭示：${key}`)

if (missingForbidden.length > 0) {
  // 自动补充到 forbidden
  plan.forbidden = [...(plan.forbidden || []), ...missingForbidden]
}

// 注入事实簿约束
userPrompt = `【📖 事实簿约束——以下硬规则不可违反】
${facts.hardRules}

${facts.infoPermissions}

${userPrompt}`
```

---

## 九、所有已发现问题修复清单

### 9.1 报告第六章问题

| # | 问题 | 修复方案 | 阶段 |
|---|------|---------|------|
| 1 | ChapterEditor 缺少细纲约束 | ✅ 已修复 | v3 主线 |
| 2 | 记录官/事件提取/StatePatch 重叠 | canonService 统一管理三者 | Phase 2 |
| 3 | ChapterEditor 缺少 Checker | 一键全流程覆盖 ChapterEditor | Phase 3 |
| 4 | 上下文预算未被调用 | ✅ 已接入(genChapter line 1408) | done |
| 5 | 去AI味不传递禁区 | ✅ 已修复(DeslopPanel forbiddenContext) | done |
| 6 | 大纲截断导致事实簿不完整 | CANON_EXTRACTION 分段提取(前3k+中2k+后2k) | Phase 1 |

### 9.2 报告第十章发现

| # | 问题 | 修复方案 | 阶段 |
|---|------|---------|------|
| A | canon_facts 来源单一不更新 | canonService 在卷纲/正文后自动更新 | Phase 1 |
| B | context_state 更新脆弱 | 增加 JSON 解析后校验 + 3次重试 + 最终 fallback(代码层构造) | Phase 2 |
| C | V1/V2 细纲断层 | genSingleChapterPlan 输出强制 V2 格式 | Phase 2 |
| D | 角色上下文格式分裂 | buildMinimalContext 适配 canon_facts details JSON | Phase 2 |
| E | conflict_facts 空表 | Checker 输出 → conflict_facts 写入 | Phase 2 |
| F | 节点匹配正则脆弱 | 增加格式容错（"第1至6章"/"第1-6章"/"1-6章"） | Phase 3 |
| G | cool_moment 传了没用 | CHAPTER_USER 增加 `【本章爽点】` 段消费 cool_moment | Phase 3 |
| H | consistencyChecklist 双赋值 | 删除重复行 | Phase 1 |
| I | revealed_level 从不更新 | canonService.updateFromChapter 自动推进 | Phase 1 |
| J | buildMinimalContext 字段名过时 | 适配 canon_facts.details 的双重格式 | Phase 2 |

### 9.3 新增问题

| # | 问题 | 修复方案 | 阶段 |
|---|------|---------|------|
| K | 准备方案截断 500 字丢失信息 | 智能采样保留角色+世界观部分 | Phase 3 |
| L | DETAIL_OUTLINE_SYSTEM 死代码 | 删除或统一使用 | Phase 3 |
| M | deslop 自定义规则在 localStorage 不安全 | 迁移到 canon_facts | Phase 2 |

---

## 十、实施阶段

### Phase 1：事实簿核心（基础 + 关键修复）

**目标**：canon_facts 成为可用的统一事实记录

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 1.1 | 创建 `canonService.ts` — upsertFact/getChapterFacts/obsoleteFact | 新文件 | 大 |
| 1.2 | ALTER canon_facts 新增字段 (v3_fact_version 等) | database.ts | 小 |
| 1.3 | CANON_EXTRACTION 分段提取(前3k+中2k+后2k) | generator.ts | 小 |
| 1.4 | genOutline 后调用 canonService.upsertFact（替代旧插入） | Workspace.tsx | 中 |
| 1.5 | genChapter 前调用 canonService.getChapterFacts（统一读取） | Workspace.tsx | 中 |
| 1.6 | Checker 后调用 canonService.updateFromChapter | Workspace.tsx | 中 |
| 1.7 | 修复 consistencyChecklist 双赋值 + revealed_level 推进 | Workspace.tsx | 小 |

**输出**：事实簿可以被后续阶段读取和写入

### Phase 2：冗余消除 + 系统整合

**目标**：设定库 → canon_facts 迁移，Checkler/Deslop/禁词库与事实簿接轨

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 2.1 | canonService.importFromSettingLibrary | canonService.ts | 中 |
| 2.2 | setting_libraries 数据迁移到 canon_facts（source='setting_lib_X'） | database.ts 迁移 | 大 |
| 2.3 | 移除 setting_libraries 的独立使用（genOutline/genVolume 改为读 canon_facts） | Workspace.tsx | 中 |
| 2.4 | buildMinimalContext 适配 canon_facts details JSON 双格式 | generator.ts | 中 |
| 2.5 | Checker 冲突写入 conflict_facts | checker.ts | 中 |
| 2.6 | context_state 更新增加 3 次重试 + fallback | Workspace.tsx | 小 |
| 2.7 | genSingleChapterPlan 强制 V2 格式输出 | Workspace.tsx | 小 |
| 2.8 | 禁词库从 localStorage 迁移到 canon_facts | deslop.ts + canonService.ts | 中 |
| 2.9 | Deslop 改写后写入 canon_events | DeslopPanel.tsx | 中 |

**输出**：设定库与 canon_facts 统一，Checker/Deslop 可读写真簿

### Phase 3：一键全流程 + 体验优化

**目标**：optimizeChapter 串联全流程，细纲/正文生成源头约束

| 任务 | 文件 | 工作量 |
|------|------|--------|
| 3.1 | 创建 `optimizeChapter()` | Workspace.tsx | 大 |
| 3.2 | UI：替换现有分散按钮为"🤖 一键优化本章"按钮 | Workspace.tsx | 中 |
| 3.3 | genSingleChapterPlan 增加 canon_facts 预验证 | Workspace.tsx | 中 |
| 3.4 | genChapter 增加源头约束注入（auto-supplement forbidden） | Workspace.tsx | 中 |
| 3.5 | ChapterEditor 集成 optimizeChapter | ChapterEditor.tsx | 中 |
| 3.6 | 节点匹配正则容错 + cool_moment 消费 | Workspace.tsx + generator.ts | 小 |
| 3.7 | 准备方案智能采样 + DETAIL_OUTLINE_SYSTEM 清理 | generator.ts | 小 |
| 3.8 | VolumePanel 批量生成通过 canonService 读取 | VolumePanel.tsx | 小 |

**输出**：一键全流程可用，源头约束生效

---

## 十一、风险缓解

| 风险 | 缓解措施 |
|------|---------|
| canon_facts 表膨胀 | fact_version>1 的旧版本定期清理（保留最近3个版本） |
| 迁移过程中数据丢失 | Phase 1+2 保留旧表备份，迁移完成后手动确认再 DROP |
| AI JSON 解析失败导致事实簿不更新 | canonService 所有 JSON 操作使用 `tryParseJSON` 工具函数(3次重试+校验+日志) |
| 一键全流程耗时过长 | 显示分步进度条，允许中途取消，每步结果可回退 |
| 事实簿初始为空时无法约束 | genChapter 检测 canon_facts 为空时静默跳过，不阻塞 |

---

## 十二、验证清单（重构完成后逐项确认）

- [ ] 大纲生成 → canon_facts 有数据（canon_events 有 created 记录）
- [ ] 卷纲生成 → canon_facts 中角色状态更新
- [ ] 细纲生成 → 控制台无"细纲与事实簿冲突"warning
- [ ] 正文生成 → userPrompt 包含 `【📖 事实簿约束】` 段
- [ ] Checker 通过 → canon_facts.revealed_level 更新
- [ ] Checker 违规 → conflict_facts 有新记录
- [ ] 一键优化 → 依次完成禁词/去AI味/Checker/修复/事实簿更新
- [ ] 重新生成大纲 → 旧事实标记 obsoleted，新事实写入
- [ ] 禁词库 → canon_facts 中有 `fact_category='writing_rule'` 的记录
- [ ] context_state → 3次重试后即使解析失败也能 fallback 更新
- [ ] buildMinimalContext → 从 canon_facts details 正确解析角色信息

---

*计划版本：v1.0，待用户审阅确认后开始实施。*
