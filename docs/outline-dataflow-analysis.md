# 大纲/卷纲/细纲 输入输出分析（200万字版）

## 参数假设
- 总字数: 2,000,000
- 每章字数: ~3,000
- 总章数: ~667
- **每卷章数: 10（推荐）**
- 总卷数: ~67

## 超长篇特有需求

### 1. 大纲层
```
输入: 书名+简介+风格+人格+拆文库+事实簿(全局)+目标200万字
输出: 分卷概要列表(67条) + 核心世界观 + 主角弧线总纲 + 关键高潮节点
```

不在大纲中输出逐章概要（67×10=670条太多），只输出卷级概要。

### 2. 卷纲层（genSingleVolume，67次调用）

```
每卷输入:
  - 大纲中的该卷概要
  - 上一卷的实际结果（角色状态快照、事实簿变化）
  - 本卷章节范围（如 21-30）
  - 风格库 + 人格库

每卷输出:
  - 10章的概要（chapter_summaries）
  - 本卷角色弧线
  - 本卷禁区
  - 本卷事实（写入 canon_facts volume_number=N）
```

### 3. 细纲层（genSingleChapterPlan，667次调用）

```
每章输入:
  - 卷纲中的本章概要
  - 上一章的实际正文
  - 所在卷的事实簿
  - 风格库 + 人格库 + 拆文库

每章输出:
  - plot_beats(8-15条) + forbidden + emotion_cap + scene_count + 钩子
```

## 与分层事实注入的联动

```
第 1 卷 (章 1-10)
  genSingleVolume(1) → 创建 canon_facts(vol=1)
  genSingleChapterPlan(1→10) → 每章注入 vol=1 事实
  genChapter(1→10) → 每章写入 chapter_fact_deltas
  aggregateVolumeDeltas(1) → 聚合 deltas → 更新 canon_facts(vol=2)

第 2 卷 (章 11-20)
  genSingleVolume(2) → 创建 canon_facts(vol=2) ← 已包含上卷聚合结果
  genSingleChapterPlan(11→20) → 每章注入 vol=2 事实
  ...
```

## 改动清单

| 文件 | 改动 | 影响 |
|------|------|------|
| generator.ts | OUTLINE_SYSTEM 加 200w 字规划 | 大纲更宏观 |
| Workspace.tsx | genSingleVolume 用 chapters_per_volume | 卷范围可配 |
| canonService.ts | getChapterFacts 分层查询 | 注入量恒定 |
| electron/database.ts | +volume_number +chapter_fact_deltas +chapters_per_volume | 3个新字段/表 |
| types/index.ts | Volume/Project 类型更新 | 类型安全 |
