# 200万字自动续写 + 事实簿全局化重构计划

> 基于 `docs/200w-words-capability-assessment.md` 的6项P0/P1修复，结合事实簿下伏笔/时间线/设定的全局化升级。

---

## 一、术语定义

| 术语 | 定义 | 触发条件 |
|------|------|----------|
| **继续写本章** | 当前章已生成但字数不够（如目标5000字实际3000字），从断点处续写同章 | 用户手动点击「续写」按钮 |
| **自动续写** | 当前章写完后，自动开启下一章的生成流程（不需手动操作） | 检测到当前章已达目标字数且 Checker 通过 |
| **队列续写** | 自动续写的升级版：可以预先配置续写范围（如"自动写第1-20章"） | 用户设置目标章节数后启动 |

---

## 二、当前系统状态总览

### 2.1 续写现状

```
当前只有一个「✏️ 续写」按钮（Workspace.tsx:2777）
  → 调用 handleContinue()（第2439行）
  → 使用 CONTINUE_SYSTEM + CONTINUE_USER
  → 功能：在编辑器中当前内容的末尾追加续写文字
  → 适用场景：本章没写完，继续写
  → 问题：没有「自动续写下一章」的功能
```

**当前流程：**
```
用户点「生成本章」→ genChapter(5) → 写完 → 手动保存 → 
用户点「续写」→ handleContinue() → 追加内容 → 手动保存 →
用户手动选择第6章 → 点「生成本章」→ genChapter(6) → ...
```

### 2.2 事实簿现状

| 子模块 | 数据表 | 全局能力 | 缺失 |
|--------|--------|----------|------|
| **设定** | `canon_facts` | truth_value 收敛/衰减、revealed_level 渐进公开 | 角色弧线追踪、跨卷变化检测 |
| **时间线** | `story_timeline` | absolute_day 时间锚点、时间推移推算 | 无跨卷时间跳跃检测、无并行时间线管理 |
| **伏笔** | `foreshadowing_registry` | planted→active→done 状态机、模糊匹配兜底回收 | 无回收率统计、无逾期提醒、无跨卷伏笔追踪 |
| **冲突** | `conflict_facts` | 语义矛盾检测（关键词重叠法） | 无叙事模式联动、无自动提醒 |

### 2.3 叙事一致性现状

| 组件 | 当前行为 | 200章后问题 |
|------|----------|------------|
| `context_state` | 全局一个JSON，每次覆盖 | 第200章的角色状态覆盖了第20章的，信息丢失 |
| `updateContext()` | 每次调 AI 解析新内容更新 | 成本高（每章1次额外调用），覆盖式存储 |
| `buildStateContext()` | 从多个源聚合当前状态 | 只给当前章节用，没有历史快照 |

---

## 三、改造计划

### Phase 0：基础类型与数据库扩展（优先）

#### 0.1 数据库新增表/字段

```sql
-- 角色快照表（解决叙事一致性崩塌）
CREATE TABLE IF NOT EXISTS character_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  chapter_number INTEGER NOT NULL,
  character_name TEXT NOT NULL,
  status TEXT DEFAULT '',
  location TEXT DEFAULT '',
  current_goal TEXT DEFAULT '',
  emotional_state TEXT DEFAULT '',
  arc_phase TEXT DEFAULT '',          -- 角色弧线阶段（如"建立期/成长期/低谷/觉醒/巅峰"）
  arc_progress INTEGER DEFAULT 0,     -- 弧线进度 0-100
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_char_snapshots ON character_snapshots(project_id, character_name, chapter_number);

-- 跨卷一致性检查日志（记录每次一致性检查结果）
CREATE TABLE IF NOT EXISTS cross_volume_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  volume_number INTEGER NOT NULL,
  check_type TEXT NOT NULL,             -- 'character_arc' / 'foreshadow_recovery' / 'timeline_continuity' / 'setting_consistency'
  check_result TEXT NOT NULL DEFAULT '{}', -- JSON: { passed: bool, issues: [...], suggestions: [...] }
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cross_check ON cross_volume_checks(project_id, volume_number, check_type);

-- 自动续写队列
CREATE TABLE IF NOT EXISTS auto_continue_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  start_chapter INTEGER NOT NULL,
  end_chapter INTEGER NOT NULL,
  current_chapter INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'idle',  -- 'idle' / 'running' / 'paused' / 'completed' / 'error'
  error_message TEXT DEFAULT '',
  chapters_completed INTEGER DEFAULT 0,
  chapters_failed INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);

-- 伏笔回收率追踪
ALTER TABLE foreshadowing_registry ADD COLUMN volume_planted INTEGER;     -- 在哪卷埋下
ALTER TABLE foreshadowing_registry ADD COLUMN volume_resolved INTEGER;    -- 在哪卷回收
ALTER TABLE foreshadowing_registry ADD COLUMN due_chapter INTEGER;        -- 最迟回收章节（逾期提醒用）

-- 时间线跳跃记录
ALTER TABLE story_timeline ADD COLUMN time_jump INTEGER DEFAULT 0;        -- 是否有时间跳跃（天数差>1）
ALTER TABLE story_timeline ADD COLUMN prev_absolute_day INTEGER;          -- 上一事件的绝对天数
```

#### 0.2 新增类型

```typescript
// 角色快照
export interface CharacterSnapshot {
  id: number; project_id: number; chapter_number: number
  character_name: string; status: string; location: string
  current_goal: string; emotional_state: string
  arc_phase: string; arc_progress: number
  created_at: string
}

// 跨卷一致性检查结果
export interface CrossVolumeCheck {
  id: number; project_id: number; volume_number: number
  check_type: 'character_arc' | 'foreshadow_recovery' | 'timeline_continuity' | 'setting_consistency'
  check_result: {
    passed: boolean
    issues: { severity: 'warning' | 'error'; description: string; suggestion: string }[]
    suggestions: string[]
  }
}

// 自动续写队列
export interface AutoContinueQueue {
  id: number; project_id: number; start_chapter: number; end_chapter: number
  current_chapter: number; status: 'idle' | 'running' | 'paused' | 'completed' | 'error'
  error_message: string; chapters_completed: number; chapters_failed: number
}
```

---

### Phase 1：区分「继续写本章」和「自动续写」（核心功能）

#### 1.1 继续写本章（续写当前章节）

**现状：** 已有 `handleContinue()` 函数（Workspace.tsx:2439），功能完整。

**优化：**
- 在 UI 上明确标注为「✏️ 继续写本章」（区别于自动续写）
- 续写时注入 `canonService.getChapterFacts()` 和伏笔预警
- 续写后自动触发 Checker + 记录官

**改动文件：**
- `Workspace.tsx` — 按钮文案改为「继续写本章」，续写逻辑增强
- `generator.ts` — `CONTINUE_USER` 增强：注入 `canonFactsContext`、伏笔预警、叙事状态

#### 1.2 自动续写下一章

**新增功能：** 当前章完成 Checker 检查（0硬违规）且字数达标后，自动触发下一章的生成。

**触发条件（三选一，用户可配置）：**
1. **章节写完**：`word_count >= estimated_words * 0.9` 且 `checkResult.hardViolationCount === 0`
2. **手动确认**：当前章写完弹出提示「是否继续生成下一章？」
3. **始终自动**：不管 Checker 结果，写完就自动下一章

**实现方案：**

```
genChapter(chapNum) → 写完 → Checker → 记录官 → 事件提取 → 
  ├─ 检查自动续写开关
  │   ├─ off → 完成，不做任何操作
  │   ├─ on_confirm → 弹出确认框「第N章已完成，是否继续生成第N+1章？」
  │   └─ on_auto → 自动调用 genChapter(chapNum + 1)
  └─ 生成下一章
```

**改动文件：**
- `Workspace.tsx` — 在 `genChapter()` 的后处理流程末尾添加自动续写逻辑
- 新增状态：`autoContinueMode: 'off' | 'on_confirm' | 'on_auto'`
- UI 新增：工具栏添加「自动续写」开关（三段式下拉或按钮组）
- `database.ts` — 保存用户偏好到 `settings` 表

#### 1.3 队列续写（批量自动）

**新增功能：** 用户设置「从第X章写到第Y章」，系统自动逐章生成。

**实现：**
- 新增 `auto_continue_queue` 表记录队列状态
- 新增 `startAutoContinue(start, end)` 和 `pauseAutoContinue()` 函数
- 每章完成后检查是否还有下一章需要写
- 支持暂停/恢复/取消
- UI：在工具栏显示队列进度条（如「第 5/20 章 | ⏸ 暂停」）

**改动文件：**
- `Workspace.tsx` — 新增队列状态管理 + 进度条 UI
- 新增 `src/services/autoContinueService.ts` — 队列逻辑封装

---

### Phase 2：事实簿全局化 — 伏笔

#### 2.1 伏笔回收率追踪

**现状问题：**
- `foreshadowing_registry` 只有 `status` 字段（pending/active/done），没有回收率统计
- 没有逾期提醒（target_chapter 过了但还没回收）
- 没有跨卷追踪（不知道哪些伏笔跨了卷）

**改造：**

```typescript
// 新增服务函数
export async function getForeshadowStats(projectId: number): Promise<{
  total: number; active: number; resolved: number
  recoveryRate: number; overdue: number; crossVolume: number
}>
```

**新增数据库字段：**
- `volume_planted` — 埋设卷号
- `volume_resolved` — 回收卷号
- `due_chapter` — 最迟回收章节（逾期提醒）

**新增服务函数：**
- `getForeshadowStats()` — 获取伏笔统计（总数/活跃/已回收/回收率/逾期数）
- `getOverdueForeshadowings(chapterNum)` — 获取逾期伏笔列表
- `getCrossVolumeForeshadowings()` — 获取跨卷伏笔

**UI 更新：**
- 事实簿 > 伏笔子标签顶部新增统计栏：`总计 12 | 🌱活跃 5 | ✅已回收 7 | 回收率 58% | ⚠逾期 2`
- 逾期伏笔用红色高亮标注
- 跨卷伏笔标注卷号

#### 2.2 伏笔自动回收智能匹配

**现状问题：**
- 回收只靠模糊匹配 `description LIKE '%xxx%'`（第1747-1753行）
- 没有语义匹配，容易漏回收

**改造：**
- 新增 `smartResolveForeshadowing(chapterContent, activeForeshadowings)` — 基于关键词+语义的智能匹配
- 记录回收置信度（`resolve_confidence`）
- 低置信度回收标记为「待确认」

---

### Phase 3：事实簿全局化 — 时间线

#### 3.1 时间跳跃检测

**现状问题：**
- `story_timeline` 只有 `absolute_day`，没有跳跃检测
- 200万字长篇中，可能有不经意的时间跳跃（如第30章突然跳到三个月后）

**改造：**

```sql
ALTER TABLE story_timeline ADD COLUMN time_jump INTEGER DEFAULT 0;
ALTER TABLE story_timeline ADD COLUMN prev_absolute_day INTEGER;
```

**新增服务函数：**
- `detectTimeJumps(projectId)` — 扫描时间线，检测连续事件间天数差 > 1 的跳跃
- `getTimelineStats(projectId)` — 获取时间线统计（总天数/事件数/时间跳跃数/覆盖卷数）
- `getTimelineByVolume(projectId, volumeNumber)` — 按卷获取时间线

**UI 更新：**
- 事实簿 > 时间线子标签顶部新增统计栏：`总事件 156 | 覆盖 4卷 | 时间跳跃 8处`
- 时间跳跃点用 ⚡ 标注
- 按卷折叠时显示卷的时间跨度

#### 3.2 多时间线并行管理

**现状：** `timeline_id` 字段已存在（默认 'main'），但 UI 没有展示。

**改造：**
- UI 新增「时间线切换」下拉框：主线 / 闪回 / 回忆 / 梦境
- 每条时间线独立统计
- 跨时间线事件关联（如闪回中揭示的信息在主时间线何时被角色得知）

---

### Phase 4：事实簿全局化 — 设定

#### 4.1 角色弧线追踪

**现状问题：**
- `canon_facts` 中角色设定只有 `fact_value`（静态描述）和 `revealed_level`（公开度）
- 没有角色弧线进度追踪——不知道角色在第几章的成长阶段

**改造：**
- 利用 `character_snapshots` 表记录每章结束时角色的状态快照
- 新增 `character_arc_log` 的增强使用（表已存在但未充分利用）

**新增服务函数：**
- `takeCharacterSnapshot(projectId, chapterNum)` — 在每章写完后记录所有角色状态
- `getCharacterArc(projectId, characterName)` — 获取角色完整弧线（从第1章到当前章的状态变化）
- `detectArcDeviation(projectId, characterName)` — 检测角色行为是否偏离已建立的弧线

**UI 更新：**
- 事实簿 > 设定 > 角色子标签：每个角色显示弧线进度条
- 点击角色展开弧线时间轴

#### 4.2 设定跨卷一致性

**现状问题：**
- `canon_facts` 有 `truth_value` 和 `stability`，但没有跨卷一致性检查
- 第30章说「凌瑶是孤儿」，第80章可能出现「凌瑶的妈妈」

**改造：**
- 新增 `cross_volume_checks` 表
- 每卷完成后自动触发一致性检查（角色设定/世界设定/规则）

**新增服务函数：**
- `checkVolumeConsistency(projectId, volumeNumber)` — 跨卷一致性检查
- `getSettingDrift(projectId)` — 设定漂移分析（哪些设定在新卷中被改变了）

---

### Phase 5：叙事一致性修复 — context_state 分卷存储

#### 5.1 现状问题

```
当前：context_state 只有一行（project_id UNIQUE）
  → 每次 updateContext() 都覆盖 character_state 和 plot_summary
  → 第200章更新时，第20章的角色状态被永久覆盖
  → AI 在第201章生成时看到的角色状态是第200章的，不是第20章的
```

#### 5.2 改造方案：分卷快照

**方案A（推荐）：分卷存储**

```sql
-- 修改 context_state 表结构
-- 原：UNIQUE(project_id)
-- 新：UNIQUE(project_id, volume_number)

-- 迁移：将现有数据迁移到新结构
ALTER TABLE context_state ADD COLUMN volume_number INTEGER NOT NULL DEFAULT 1;
-- 删除旧 UNIQUE 约束并添加新约束（SQLite 不支持直接修改约束，需重建表）

-- 或者：新建 context_snapshots 表
CREATE TABLE IF NOT EXISTS context_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  volume_number INTEGER NOT NULL,
  chapter_number INTEGER NOT NULL,
  character_state TEXT NOT NULL DEFAULT '{}',
  plot_summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE,
  UNIQUE(project_id, volume_number, chapter_number)
);
CREATE INDEX IF NOT EXISTS idx_context_snapshots ON context_snapshots(project_id, volume_number);
```

**新的 updateContext 逻辑：**
```
写完第N章 → updateContext(chapNum, content)
  → 找到 chapNum 所属卷 V
  → 更新 context_state WHERE project_id=X AND volume_number=V
  → 同时写入 context_snapshots（每章一份快照，不覆盖）
```

**genChapter 注入逻辑：**
```
生成第N章时 → 找到 chapNum 所属卷 V
  → 读取 context_state WHERE volume_number=V（当前卷状态）
  → 读取 context_snapshots WHERE volume_number=V-1（上卷末状态作为起点）
  → 将两者合并注入到 stateContext
```

#### 5.3 角色快照替代方案（更细粒度）

`character_snapshots` 表替代 `context_state.character_state`：
- 每章写完后自动记录所有已知角色的状态
- 不再依赖 AI 解析 context_state（节省每章1次 API 调用）
- 用事件提取器的 `character_changes` 字段驱动快照更新

---

### Phase 6：跨卷一致性自动检查

#### 6.1 卷结束时触发

```
写完某卷最后一章 → 自动触发跨卷一致性检查：
  1. 角色弧线检查：该卷每个角色的起始状态 vs 结束状态是否符合卷纲的 character_milestones
  2. 伏笔回收检查：该卷范围内 planted 的伏笔是否都在卷内/指定章节回收
  3. 时间线连续性：该卷最后一章的时间 vs 下一卷第一章的时间是否合理
  4. 设定一致性：该卷是否引入了与之前冲突的新设定
```

#### 6.2 检查结果展示

- 事实簿 > 冲突子标签新增「跨卷检查」入口
- 每个检查项显示通过/警告/错误
- 错误项提供修复建议（如「建议在第X章回收伏笔#F003-2」）

---

## 四、实现优先级排序

| 优先级 | Phase | 内容 | 理由 |
|--------|-------|------|------|
| **P0** | Phase 1.2 | 自动续写下一章 | 200万字最直接的痛点：667次手动点击 |
| **P0** | Phase 5 | context_state 分卷存储 | 叙事一致性崩塌的核心修复 |
| **P1** | Phase 1.3 | 队列续写 | 自动续写的升级，批量生成 |
| **P1** | Phase 2.1 | 伏笔回收率追踪 | 全局伏笔管理 |
| **P1** | Phase 3.1 | 时间跳跃检测 | 时间线全局管理 |
| **P1** | Phase 4.1 | 角色弧线追踪 | 角色全局管理 |
| **P2** | Phase 2.2 | 伏笔智能回收匹配 | 增强回收准确率 |
| **P2** | Phase 3.2 | 多时间线并行 | 高级功能 |
| **P2** | Phase 4.2 | 设定跨卷一致性 | 卷结束时检查 |
| **P2** | Phase 6 | 跨卷一致性自动检查 | 汇总检查 |

---

## 五、预计改动文件清单

| 文件 | Phase | 改动内容 |
|------|-------|----------|
| `electron/database.ts` | 0 | 新增4张表 + 4个ALTER |
| `src/types/index.ts` | 0 | 新增5个类型 |
| `src/services/canonService.ts` | 2-4 | 新增10+个全局服务函数 |
| `src/services/autoContinueService.ts` | 1 | **新建** — 自动续写队列逻辑 |
| `src/services/generator.ts` | 1,5 | CONTINUE_USER增强、context_state改造 |
| `src/components/writing/Workspace.tsx` | 1,5 | 自动续写UI、开关、队列进度、context_state注入 |
| `src/components/writing/CanonFactPanel.tsx` | 2-4 | 伏笔统计栏、时间线统计栏、角色弧线、跨卷检查入口 |

---

## 六、风险与注意事项

1. **自动续写死循环**：如果某章 Checker 始终不通过，自动续写会卡住。需要设置最大重试次数（3次）和超时（5分钟）。
2. **API 成本**：自动续写会显著增加 API 调用量。需要在 UI 显示预估成本。
3. **context_state 迁移**：现有 `context_state` 表有数据，迁移到分卷存储需要兼容旧数据。
4. **并发问题**：自动续写时用户不能手动操作同一章（需要加锁）。
5. **取消机制**：自动续写必须支持随时暂停/取消（复用 `cancelledRef` 机制）。
