# 事实簿 + 矫正 全面重构计划（v3 — 状态机架构完整版）

## 零、删除清单（不受影响的模块明确列出）

### 删除的数据库表（9 张）
```
canon_facts              → story_tracker (tier=master)
chapter_fact_deltas      → story_tracker (tier=chapter)
context_snapshots        → story_tracker
character_snapshots      → story_tracker
cross_volume_checks      → volume_check_reports
correction_queue         → volume_check_reports
foreshadowing_registry   → story_tracker
story_timeline           → story_tracker
conflict_facts           → 删除
chapter_summaries        → story_tracker.summary（记录官语义替代）
```

### 删除的 UI 组件
```
CanonFactPanel.tsx        → DesignPanel.tsx（新）
ReviewPanel.tsx           → 删除
CorrectionSummaryPanel.tsx → 删除
```

### 删除的 AI 调用（每章省 2 次）
```
CHAPTER_SUMMARY_SYSTEM/USER   (记录官)     → 章表提取替代
EVENT_EXTRACTION_SYSTEM/USER  (事件提取器)  → 章表提取替代
```

### 删除的注入项（7 个）
```
prevExcerpt (上一章正文 800 字)    → ending_state 替代
infoPermissionContext              → 删除
timeProgressionContext             → 删除
consistencyChecklist               → 删除
buildMinimalContext (智能上下文)    → 删除
prevSummaryContext                 → 删除
stateContext                       → 删除
```

### 保留且完全不改的模块
```
disassembly_projects (拆文库)     → 存储/UI/注入逻辑均不变
setting_libraries    (设定库)     → 存储/UI/注入逻辑均不变
style_libraries      (风格库)     → 存储/UI 不变，注入量精简但不改库本身
personality_projects (人格库)     → 存储/UI 不变，注入量精简但不改库本身
token_usage, version_history      → 不变
novel_projects, chapters, volumes, detailed_outlines → 表结构不变
```

---

## 一、新数据库（3 张表）

### 1.1 story_tracker（唯一核心状态表）
```sql
CREATE TABLE story_tracker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  tier TEXT NOT NULL,               -- 'master' | 'volume' | 'chapter'
  volume_number INTEGER DEFAULT 0,
  chapter_number INTEGER DEFAULT 0,
  tracker_type TEXT NOT NULL,       -- 'character' | 'event' | 'foreshadow' | 'rules'
  tracker_key TEXT NOT NULL,        -- 角色名 / 事件名 / 伏笔ID / "global"
  importance TEXT DEFAULT 'minor',  -- 伏笔专用：'major' | 'minor'

  -- 双轨数据
  summary TEXT NOT NULL DEFAULT '', -- 自然语言，给 AI 阅读
  state TEXT NOT NULL DEFAULT '{}', -- 结构化 JSON，固定 schema，给系统判断
  expected_state TEXT DEFAULT NULL, -- 仅 volume 层，卷结束时的预期终态

  status TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, tier, volume_number, chapter_number, tracker_type, tracker_key)
);
CREATE INDEX idx_tracker_lookup ON story_tracker(project_id, tier, volume_number, chapter_number);
CREATE INDEX idx_tracker_type ON story_tracker(project_id, tracker_type, tier);
```

### state 固定 schema（按 tracker_type）

**character：**
```json
{
  "emotion": "string",
  "location": "string",
  "goal": "string",
  "thoughts": "string",
  "relationships": { "角色名": -5..5 },
  "scene": "string",
  "unfinished_action": "string"
}
```

**event：**
```json
{
  "phase": "setup|rising|climax|falling|resolved",
  "progress": 0..100,
  "next_milestone": "string",
  "summary": "string"
}
```

**foreshadow：**
```json
{
  "planted_chapter": 0,
  "target_chapter": 0,
  "reveal_condition": "string",
  "revealed_chapter": 0,
  "status": "pending|hinted|revealed|resolved"
}
```

**rules（仅 master 层，tracker_key='global'）：**
```json
{
  "emotion": {
    "allowed_transitions": [
      ["calm","anxious"], ["anxious","fear"], ["fear","collapse"],
      ["collapse","resignation"], ["resignation","hope"],
      ["hope","determination"], ["determination","confident"]
    ],
    "max_jumps_per_volume": 3
  },
  "relationship": {
    "max_delta_per_chapter": 2,
    "max_delta_per_volume": 6
  },
  "event_phase": {
    "allowed_transitions": [
      ["setup","rising"], ["rising","climax"],
      ["climax","falling"], ["falling","resolved"]
    ],
    "can_skip": false
  }
}
```

### 1.2 tracker_transitions（不可变日志，只追加）
```sql
CREATE TABLE tracker_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  chapter_number INTEGER NOT NULL,
  tracker_key TEXT NOT NULL,
  tracker_type TEXT NOT NULL,
  old_state TEXT,
  new_state TEXT,
  transition_valid INTEGER DEFAULT 1,  -- 是否符合迁移规则
  rule_violation TEXT DEFAULT '',       -- 违规描述（如有）
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_transitions ON tracker_transitions(project_id, tracker_key, chapter_number);
```

作用：diff 可视化 / 回滚 / 调试状态漂移 / 检查异常跳变。

### 1.3 volume_check_reports（卷检查）
```sql
CREATE TABLE volume_check_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  volume_number INTEGER NOT NULL,
  results TEXT NOT NULL DEFAULT '{}',
  -- JSON: {
  --   character_deviations: [{ key, field, expected, actual, delta }],
  --   event_deviations: [{ key, field, expected, actual }],
  --   foreshadow_status: { total, resolved, overdue },
  --   rule_violations: [{ key, rule, detail }],
  --   score: 0-100
  -- }
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
```

---

## 二、新 UI：DesignPanel 四标签 + 右侧栏调整

### 右侧栏 tabs 调整
```
旧：大纲 | 细纲 | 事实簿 | 校对
新：大纲 | 细纲 | 设计台 | 检查
```

### 设计台（DesignPanel）— 4 个子标签

**标签 1：设定（只读事实簿）**
- 来源 = story_tracker(tier='master')
- 四个子分类：角色 | 关系 | 世界观 | 特殊事件/节点
- 只读，可手动编辑 summary
- "从大纲提取"按钮 → 写入 tier='master'
- 不注入任何生成流程

**标签 2：角色跟踪**
- 来源 = story_tracker(tracker_type='character')
- 按角色分组，卷/章展开
- 每行：章号 → emotion / location / goal / relationships
- 预期 vs 实际双列对比（volume 层 expected_state vs chapter 层实际 state）
- 异常跳变高亮（transition_valid=0）

**标签 3：事件跟踪**
- 来源 = story_tracker(tracker_type='event')
- 按事件分组，弧线进度条
- phase 状态可视化（setup→rising→climax→falling→resolved）
- 当前进度百分比

**标签 4：伏笔**
- 来源 = story_tracker(tracker_type='foreshadow')
- 按 importance 分组：重要 | 普通
- 埋入章→目标章→当前状态→揭示条件

**各标签底部**：卷检查结果（偏差矩阵 / 违规列表）

### 检查标签（替代旧校对）
- 卷检查报告列表
- 按卷号展示，每份报告：评分 / 四维偏差 / 迁移规则违规
- 不阻塞生成流程

---

## 三、四阶段提取 + 输出 + 注入 + UI 对照

### 3.1 大纲 → 总表提取

| 维度 | 内容 |
|------|------|
| **触发** | genOutline 完成后，主流程同步 |
| **输入** | AI 生成的大纲文本 |
| **AI 调用** | 1 次，按固定 schema 输出 |
| **输出** | story_tracker(tier='master')： |
| | tracker_type='character'：各角色总弧线 summary + 初始 state |
| | tracker_type='event'：总事件弧线 summary |
| | tracker_type='foreshadow'：总体伏笔要求 summary |
| | tracker_type='rules'：状态迁移规则（emotion 允许路径/relationship max_delta/event_phase 允许跳转） |
| **注入到** | genSingleVolume（卷纲生成时读总表） |
| **UI 展示** | DesignPanel > 设定标签（角色/关系/世界观/事件节点只读） |

### 3.2 卷纲 → 卷表提取

| 维度 | 内容 |
|------|------|
| **触发** | genSingleVolume 内部，卷纲 AI 生成后 |
| **输入** | 大纲 + 总表(tier='master') + 上一卷卷表 state 终态 |
| **AI 调用** | 1 次（与卷纲生成合并或紧随其后） |
| **输出** | story_tracker(tier='volume', vol=N)： |
| | tracker_type='character'：summary + expected_state({emotion, goal, relationships}) |
| | tracker_type='event'：summary + expected_state({phase, progress}) |
| | tracker_type='foreshadow'：summary + expected_state({planted, target}) |
| **注入到** | genSingleChapterPlan（细纲生成时读卷表） |
| **UI 展示** | DesignPanel > 角色跟踪/事件跟踪/伏笔（按卷筛选，显示 expected_state） |

### 3.3 细纲 → 章表初始 state

| 维度 | 内容 |
|------|------|
| **触发** | genSingleChapterPlan 内部 |
| **输入** | 卷纲 + 上一章细纲 + 上一章章表(state + ending_state) |
| **AI 调用** | 与细纲生成合并为 1 次调用（同时输出 plot_beats 和章表初始 state） |
| **输出** | detailed_outlines(chapter N) + story_tracker(tier='chapter', ch=N)：初始 state |
| | 角色目标、预期情绪、事件节点（从细纲推断，非 AI 专门提取） |
| **注入到** | genChapter（正文生成时读本章章表 summary） |
| **UI 展示** | DesignPanel > 角色跟踪/事件跟踪（显示本章预期状态，灰色） |

### 3.4 正文 → 章表最终 state

| 维度 | 内容 |
|------|------|
| **触发** | genChapter 主流程同步，在 saveChapter 之后、auto-continue 之前 |
| **输入** | 本章正文(前 8000 字) + 细纲 + 章表初始 state + 固定 schema 模板 |
| **AI 调用** | 1 次（替代原来的记录官+事件提取器 2 次） |
| **输出** | 更新 story_tracker(tier='chapter', ch=N)： |
| | state（按固定 schema：emotion/location/goal/relationships/scene/unfinished_action） |
| | ending_state（从 state 提取：scene/emotion/unfinished_action） |
| | summary（本章摘要） |
| | + tracker_transitions INSERT（old_state → new_state + transition_valid） |
| **注入到** | genChapter(N+1)：ending_state（替代旧上章 800 字） |
| | genSingleChapterPlan(N+1)：上章章表 state |
| **UI 展示** | DesignPanel > 角色跟踪/事件跟踪（显示实际状态，与 expected 对比，异常高亮） |

---

## 四、注入清单（恒定，不随章节增长）

### 正文注入（~4000 chars）

| # | 注入内容 | 来源 | 大小 |
|---|---------|------|------|
| 1 | plot_beats + forbidden + emotional_arc + hooks | 细纲 | ~600 |
| 2 | estimated_words + 字数要求 | plan | 50 |
| 3 | 本章章表 summary（AI 可读的角色/事件/伏笔状态描述） | story_tracker(ch=N) | ~800 |
| 4 | 上一章 ending_state（scene/emotion/unfinished_action） | story_tracker(ch=N-1).state | ~200 |
| 5 | 风格库 | styleLibraries | ~1500 |
| 6 | 人格库 | personalityProjects | ~1000 |

### 细纲注入（~7000 chars）

| # | 注入内容 | 来源 | 大小 |
|---|---------|------|------|
| 1 | 大纲前 3000 字 | outlineContent | 3000 |
| 2 | 卷纲（volContext + nodeContext） | volumes | ~1000 |
| 3 | 上一章细纲（prevBeatsContext） | chapterPlans | ~500 |
| 4 | 上一章 ending_state | story_tracker(ch-1).state | ~200 |
| 5 | 卷表角色/事件/伏笔状态 summary | story_tracker(volume) | ~800 |
| 6 | 风格库 | styleLibraries | ~1000 |
| 7 | 人格库 | personalityProjects | ~800 |

### 卷纲注入

| # | 注入内容 | 来源 |
|---|---------|------|
| 1 | 大纲 | outlineContent |
| 2 | 总表 summary（角色弧线/事件弧线/伏笔规则/迁移规则） | story_tracker(master) |
| 3 | 上一卷卷表 state 终态 | story_tracker(volume, N-1) |
| 4 | 拆文库 + 设定库 | disassemblies / settingLibraries |

---

## 五、章表同步提取 prompt（替代记录官）

每章 1 次 AI 调用，系统 prompt 强制固定 schema：

```
你是状态提取器。阅读正文后按以下固定格式输出。key 不可变，value 不可改类型。

输出 JSON：
{
  "chapter_summary": "100-150字摘要",
  "states": {
    "character": [
      {
        "key": "角色名",
        "state": {
          "emotion": "当前情绪",
          "location": "当前位置",
          "goal": "当前目标",
          "thoughts": "当前想法/困惑",
          "relationships": { "关联角色": -5到5的整数 },
          "scene": "当前场景描述（10-20字）",
          "unfinished_action": "截止章尾未完成的动作（用于下章衔接）"
        }
      }
    ],
    "event": [
      {
        "key": "事件名",
        "state": { "phase": "setup|rising|climax|falling|resolved", "progress": 0-100, "next_milestone": "下个关键节点" }
      }
    ],
    "foreshadow": [
      {
        "key": "伏笔主题",
        "state": { "status": "pending|hinted|revealed|resolved", "reveal_condition": "揭示条件" }
      }
    ]
  }
}
```

系统逐 key 校验后写入 story_tracker + tracker_transitions。

---

## 六、自动续写流程（无等待、无轮询）

```
genChapter(1)
  → saveChapter
  → 章表提取（同步，1 次 AI）→ 写入 story_tracker + tracker_transitions
  → ending_state 写入章表 state
  → genSingleChapterPlan(2) [若细纲不存在] → 章表(2)初始 state
  → genChapterRef.current(2)
  → ...直到卷末
  → 卷表更新 + 卷检查
    → 结构化对比 expected_state vs actual_state
    → 迁移规则校验（emotion 跳变/relationship delta 超限）
    → volume_check_reports 写入
    → 若 stopOnPlotDeviation=开 && 偏差超阈值 → 弹窗暂停
  → genSingleVolume(2) → 读取总表 + 上卷卷表终态 → 卷表(2)提取
  → 循环...
```

---

## 七、矫正系统

### 卷结束检查（4 维）

```
1. 角色弧线偏差
   对比：volume.expected_state.{character}.emotion/goal/relationships
        vs chapter[N].state 的终态
   超阈值 → character_deviations

2. 事件推进偏差
   对比：volume.expected_state.{event}.phase/progress
        vs chapter[N].state 的终态
   超阈值 → event_deviations

3. 迁移规则违规
   读取：master.tracker_type='rules'
   检查：每相邻两章的 state 变化是否符合 allowed_transitions/max_delta
   违规 → rule_violations（tracker_transitions.transition_valid=0）

4. 伏笔状态
   统计：total / resolved / overdue
   逾期 → foreshadow_status
```

### 矫正 UI
- 设计台各标签底部：对应类型检查结果
- 检查标签（旧校对）：卷检查报告列表，按卷号展开
- 不阻断生成流程

---

## 八、trackerService.ts 核心 API

```typescript
// 读取
getMasterTracker(projectId): Tracker[]
getVolumeTracker(projectId, volNum): Tracker[]
getChapterTracker(projectId, chNum): Tracker[]
getEndingState(projectId, chNum): EndingState

// 写入
upsertTracker(params): number
extractMasterFromOutline(projectId, outlineContent): Promise<void>
extractVolumeFromOutline(projectId, volNum, context): Promise<void>
extractChapterState(projectId, chNum, chapterText, plan): Promise<void>

// 检查
runVolumeCheck(projectId, volNum): CheckReport
getTransitionLog(projectId, trackerKey): Transition[]
getCheckReports(projectId): CheckReport[]

// 迁移规则
getTransitionRules(projectId): TransitionRules
validateTransition(oldState, newState, rules): { valid: boolean, violations: string[] }
```

~200 行，替代旧 canonService.ts 的 900+ 行。

---

## 九、实施顺序

### Phase 1：数据库（4 项）
1. 删除旧表（9 张）
2. 创建 story_tracker 表
3. 创建 tracker_transitions 表
4. 创建 volume_check_reports 表

### Phase 2：服务层（2 项）
5. 新建 trackerService.ts
6. 删除 generator.ts 中 CANON_EXTRACTION / 卷概要提取 / 记录官 / 事件提取器

### Phase 3：生成管线（5 项）
7. genOutline → 提取总表（含迁移规则）
8. genSingleVolume → 读总表+上卷卷表 → 提取卷表
9. genSingleChapterPlan → 读卷表+上章章表 → 细纲 + 章表初始 state
10. genChapter → 读细纲+章表 → 正文 → 同步提取章表最终 state → auto-continue
11. 卷结束时：卷表更新 + 结构化卷检查

### Phase 4：UI（4 项）
12. 新建 DesignPanel.tsx（四标签）
13. 新建 CheckReportPanel.tsx（检查标签）
14. 删除 CanonFactPanel / ReviewPanel / CorrectionSummaryPanel
15. Workspace.tsx 注入清单精简 + 右侧栏 tabs 调整

---

## 十、关键变更对照

| 旧 | 新 |
|----|----|
| 9 张状态表 | 3 张状态表 |
| canonService.ts (900+ 行) | trackerService.ts (~200 行) |
| 每章 3 次 AI（正文+记录官+事件） | 每章 2 次 AI（正文+章表提取） |
| delta 后台异步 + 轮询等待 | delta 同步写入主流程 |
| 正文注入 ~10K（越往后越大） | 正文注入 ~4K（恒定） |
| 上一章正文 800 字 | 上一章 ending_state 200 字 |
| 矫正逐章累积 | 卷结束结构化对比 + 迁移规则校验 |
| 状态 UPDATE 覆盖 | 状态 INSERT 追加 + transitions 日志 |
| 自由 JSON 被 LLM 污染 | 固定 schema + 系统校验 |
| 文本对比卷检查 | expected_state vs actual_state 结构化对比 |
