# 校对系统重构计划：分级矫正 + 自动生成联动

## 核心设计

自动生成过程中不打断流程，所有问题累积到矫正汇总表。生成完成后用户统一决策：自动修正 / 手动修正 / 忽略。

---

## 一、问题分级

### Level 1 — 描写问题（轻度）
- **定义**：AI味词汇、重复句式、描写密度不当、禁用词
- **来源**：Checker 的 deterministic + ai_suggestion 层
- **处理**：不叫停生成，写入 `correction_queue` 表
- **修正方式**：定位到章节 → 分段修改（`handleFixViolations('selected')`）

### Level 2 — 设定偏差（中度）
- **定义**：角色表现与 canon_facts 不一致、信息权限边界轻微越界
- **来源**：Checker 的 structural 层 + canon_facts.revealed_level 对比
- **处理**：不叫停生成，写入 `correction_queue` 带 flag
- **修正方式**：定位到章节 → 可单选全文修改或分段修改

### Level 3 — 剧情跑偏（严重）
- **定义**：情节明显偏离大纲/卷纲、关键设定被破坏、角色弧线断裂
- **来源**：Checker concerns + 大纲/卷纲语义对比 + character_snapshots 弧线检查
- **处理**：用户可选择是否叫停。设置「剧情预警开关」
  - 开关开启 → 立即暂停自动续写，弹出决策框
  - 开关关闭 → 写入 `correction_queue`，全部完成后统一提示

---

## 二、数据库设计

### 新表：`correction_queue`

```sql
CREATE TABLE correction_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  chapter_number INTEGER NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,           -- 1=描写 2=设定 3=剧情
  type TEXT NOT NULL,                          -- forbidden/emotion_exceed/info_leak/timeline_error/plot_deviation/setting_deviation
  detail TEXT NOT NULL,                        -- 违规描述
  source TEXT NOT NULL DEFAULT 'checker',      -- checker/manual
  status TEXT NOT NULL DEFAULT 'pending',      -- pending/fixed/ignored
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_correction_queue ON correction_queue(project_id, status, level);
```

### 新增：`project_settings` 字段

```sql
ALTER TABLE novel_projects ADD COLUMN settings TEXT DEFAULT '{}';
-- JSON: { "auto_stop_on_plot_deviation": false, "auto_fix_level": 0 }
-- auto_stop_on_plot_deviation: 剧情跑偏时是否叫停
-- auto_fix_level: 0=不自动修复, 1=仅L1自动修复, 2=L1+L2自动修复
```

---

## 三、与现有系统联动

### 3.1 与 Checker 联动
- `genChapter` 后台任务中，Checker 跑完后：
  - L1 违规 → INSERT INTO correction_queue
  - L2 违规 → INSERT + 对比 canon_facts 输出具体偏差
  - L3 违规 → INSERT + 检查 `auto_stop_on_plot_deviation` 开关

### 3.2 与 canon_facts 联动
- L2/L3 检测时读取 canon_facts 做交叉验证：
  - 角色行为是否违反 hard_rule
  - 信息揭示是否超过 revealed_level
  - 设定值是否与 fact_value 矛盾
- 对比结果写入 correction_queue.detail

### 3.3 与 character_snapshots 联动
- L3 检测：对比本章 character_snapshot 与前章快照
  - 角色状态突变（如从"友善"直接跳到"敌对"）→ 标记为 L3
  - 角色消失超过 10 章未出现 → L2 提醒

### 3.4 与 cross_volume_checks 联动
- 跨卷检查结果中的 issues 自动写入 correction_queue（L2/L3）

---

## 四、UI 设计

### 4.1 矫正汇总面板（新增右侧标签或替换 ReviewPanel）

```
┌─────────────────────────────────┐
│ 📋 矫正汇总 (自动生成报告)        │
│                                 │
│ L3 🔴 剧情跑偏      2 项         │
│   ├ 第12章：主角行为与设定矛盾    │
│   └ 第18章：情节偏离卷纲          │
│                                 │
│ L2 🟡 设定偏差      5 项         │
│   ├ 第5章：角色状态突变           │
│   ├ 第8章：信息权限越界           │
│   └ ...                         │
│                                 │
│ L1 ⚪ 描写问题      23 项         │
│   ├ 第3章：AI味词汇×3            │
│   └ ...                         │
│                                 │
│ [自动修正 L1+L2]  [逐项手动修正]  │
│ [定位到章节]     [全部忽略]       │
└─────────────────────────────────┘
```

### 4.2 剧情预警弹窗（L3 + 开关开启时）

```
┌──────────────────────────────────┐
│ ⚠ 剧情跑偏预警                    │
│                                  │
│ 第15章内容疑似偏离大纲：            │
│ "主角突然决定放弃任务"             │
│ 与卷纲「本章主角应继续执行任务」矛盾 │
│                                  │
│ [暂停生成，手动处理]  [忽略继续]    │
│ [关闭预警，不再提示]               │
└──────────────────────────────────┘
```

### 4.3 自动续写对话框增强

```
┌─────────────────────────┐
│ 自动续写设置              │
│                         │
│ 从第4章写到第50章         │
│ [50                    ] │
│                         │
│ ☐ 剧情跑偏时暂停生成       │
│                         │
│ [停止续写] [取消] [开始]  │
└─────────────────────────┘
```

对话框只控制生成行为（是否叫停）。所有修正统一在生成完成后通过矫正汇总面板执行，不在生成过程中自动修复。

---

## 五、实施计划

### Phase 1：数据库 + 数据收集（基础）
1. 创建 `correction_queue` 表
2. `novel_projects` 添加 `settings` JSON 字段（仅 `auto_stop_on_plot_deviation` 一个开关）
3. `genChapter` 后台任务：Checker 完成后将违规写入 correction_queue
4. 分级逻辑：L1=deterministic层, L2=structural层+canon_facts对比, L3=concerns+弧线异常

### Phase 2：矫正汇总面板（UI）
1. 新建 `CorrectionSummaryPanel.tsx` 组件
2. 替代或增强现有 ReviewPanel
3. 按 L1/L2/L3 分组折叠显示
4. 「定位到章节」「分段修复」「忽略」按钮
5. 「一键修正 L1+L2」按钮（调用 handleFixViolations，事后执行）

### Phase 3：剧情预警开关（交互）
1. 自动续写对话框增加 ☐ 剧情跑偏时暂停
2. `project_settings` 读写
3. L3 检测时检查开关 → 弹窗或静默记录

### Phase 4：canon_facts 联动（深度）
1. L2 检测时对比 canon_facts.hard_rule
2. L3 检测时对比 character_snapshots 弧线
3. cross_volume_checks issues → correction_queue

---

## 六、流程总览

```
自动续写开始
  │
  ├→ genChapter(N) 完成
  │   └→ Checker 跑完
  │       ├→ L1 违规 → 写入 correction_queue
  │       ├→ L2 违规 → 写入 correction_queue + canon_facts 对比
  │       ├→ L3 违规 → 检查 auto_stop 开关
  │       │   ├→ 开 → 弹出预警弹窗 → 用户决策
  │       │   └→ 关 → 写入 correction_queue（继续）
  │       └→ 无违规 → 继续
  │
  ├→ genChapter(N+1) ...
  │
  └→ 全部完成
      └→ 矫正汇总面板（用户统一决策）
          ├→ 「一键修正 L1+L2」
          ├→ 「逐项手动修正」
          └→ 「全部忽略」
```
