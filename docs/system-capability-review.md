# 系统生成能力全面审查：200万字小说

## 一、生成管线全景（从零到667章）

```
大纲 (1次)
  │ 输入: 书名+简介+风格+人格+拆文+事实簿+目标字数
  │ 输出: 分卷规划(4-8卷) + 伏笔地图 + 时间线 + 人物弧线
  │ ⚠️ 硬编码"40-80章/20-40万字"——200w字不匹配！
  │
  ├─ 卷纲 (67次)
  │   输入: 大纲+前卷状态+风格+拆文
  │   输出: 章节概要(10章) + 节点结构 + 感情限制 + 信息配额
  │   ✅ 节点自适应(≤20章=5-6节点)
  │
  ├─ 细纲 (667次)
  │   输入: 卷纲+上一章正文+事实簿+风格+人格
  │   输出: plot_beats(8-15) + forbidden + emotion_cap + 钩子
  │   ✅ 已有上一章正文上下文
  │
  └─ 正文 (667次)
      输入: 22个源，三层事实注入(~1800 tokens)
      输出: 3000字正文 (max_tokens=16384)
      ✅ 流式输出 + checker + 记录官 + canonService联动
```

## 二、每章注入精确清单（22个源）

| # | 来源 | 内容 | Token估算 | 来源表/函数 |
|---|------|------|-----------|------------|
| 1 | project.title | 书名 | ~20 | novel_projects |
| 2 | prepareContent | 简介(前500字) | ~200 | 用户输入 |
| 3 | plan.title | 章标题 | ~30 | ChapterPlan |
| 4 | plan.summary | 本章概要 | ~50 | ChapterPlan |
| 5 | plan.characters | 出场角色 | ~100 | ChapterPlan |
| 6 | plan.key_events | 关键事件 | ~100 | ChapterPlan |
| 7 | plan.estimated_words | 目标字数 | — | 约束参数 |
| 8 | plan.emotional_arc | 情绪弧线 | ~30 | ChapterPlan |
| 9 | styleContext | 风格库(V4) | ~300 | writing_style_libraries |
| 10 | plotSummary | 前情摘要 | ~200 | context_state |
| 11 | prevExcerpt | 上一章末尾(800字) | ~300 | chapters.content |
| 12 | volContext+nodeContext | 卷纲+节点 | ~400 | volumes |
| 13 | prevSummaryContext | 前一章摘要 | ~200 | chapter_summaries |
| 14 | canonFactsContext | 三层事实 | ~1800 | canon_facts + deltas |
| 15 | personalityContext | 人格库(V2) | ~300 | novel_personalities |
| 16 | plot_beats | 情节点(8-15) | ~400 | ChapterPlan |
| 17 | cool_moment | 爽点 | ~30 | ChapterPlan |
| 18 | forbidden | 禁区 | ~100 | ChapterPlan |
| 19 | scene_count | 场景数 | — | 约束参数 |
| 20 | max_info_reveal | 信息配额 | — | 约束参数 |
| 21 | emotion_cap | 感情上限 | — | 约束参数 |
| 22 | hooks | 章首/尾钩子 | ~100 | ChapterPlan |
| + | buildExecutionConstraints | 副零层铁律 | ~2000 | 写作规则+风格+人格 |
| + | CHAPTER_SYSTEM | 五层递进prompt | ~4000 | generator.ts |
| **合计** | | | **~10,000 tokens** | (128K窗口内安全) |

## 三、200万字能力评估

### ✅ 强项

| 维度 | 状态 | 说明 |
|------|------|------|
| 单章生成 | ✅✅ | max_tokens=16384, 3000字/章, 流式输出 |
| 自动续写 | ✅✅ | 三模式(弹出/队列/全自动) + 细纲+卷纲自动补全 |
| 上下文隔离 | ✅✅ | 三层事实分卷注入，恒定~1800 tokens，不随章节增长 |
| 叙事连贯性 | ✅ | context_snapshots分卷 + character_snapshots角色状态 |
| 质量监控 | ✅ | checker + correction_queue + 卷末四维检查 |
| 数据完整 | ✅ | 卷纲/细纲/正文/事实/delta 全部写入DB |

### ⚠️ 弱项/待优化

| 问题 | 严重度 | 说明 |
|------|--------|------|
| **OUTLINE_SYSTEM硬编码短篇参数** | 🔴 高 | 提示"40-80章/20-40万字"，与200w目标矛盾。AI会按短篇思维规划 |
| **大纲无200w字意识** | 🔴 高 | 没有"分67卷"的规划，大纲输出只有4-8卷的概要 |
| **章间情感连接弱** | 🟡 中 | 上一章正文只取末尾800字做衔接，没有情感状态传递 |
| **风格一致性无检查** | 🟡 中 | 100章后文风可能漂移，没有采样对比机制 |
| **细纲生成没有批量能力** | 🟡 低 | 每次genSingleChapterPlan调一次AI，667次调用的开销 |
| **checker不检查文风** | 🟡 低 | 只检查硬违规(禁区/信息泄露/时间线)，不检查风格一致性 |

### ⚠️ 新功能未充分联动

| 功能 | 设计状态 | 代码状态 | 差距 |
|------|---------|---------|------|
| 分层事实(全局/卷级/章级) | ✅ 已设计 | ✅ 已实施 | getChapterFacts改造完成 |
| 卷级聚合 | ✅ 已设计 | ✅ 已实施 | aggregateVolumeDeltas在genSingleVolume后调用 |
| 章级delta | ✅ 已设计 | ✅ 已实施 | 从记录官提取写入chapter_fact_deltas |
| 卷筛选UI | ✅ 已设计 | ✅ 已实施 | CanonFactPanel卷下拉 + 动态子标签 |
| 矫正队列 | ✅ 已设计 | ✅ 已实施 | correction_queue + CorrectionSummaryPanel |
| **大纲适配200w字** | ✅ 已设计 | ❌ 未实施 | OUTLINE_SYSTEM仍是"40-80章" |
| 剧情暂停开关 | ✅ 已设计 | ✅ 已实施 | 对话框checkbox + genChapter L3检测 |

## 四、核心问题与修复建议

### 🔴 P0: OUTLINE_SYSTEM 适配200万字

当前提示：`全书 40-80 章，每卷 10-20 章，全书 20-40 万字`

应该改为：

```
全书 600-700 章，每卷 10 章（共约 67 卷），全书 180-210 万字
分卷结构规划：输出 67 条卷概要（每条 50-100 字）
每 5-7 卷标注一个关键高潮节点
```

### 🟡 P1: 章间情感状态传递

当前：上一章正文末尾 800 字作为上下文
缺失：上一章结束时的角色情感状态

建议：在 `genChapter` 的 user prompt 中加入：
```
【上一章结束时的角色状态】
- 程澈：情绪=紧张，位置=地下实验室，关系=与凌瑶信任度20/100
```
数据来源：`chapter_fact_deltas` 中最近 3 章的 delta

### 🟡 P2: 大纲生成时写入分卷事实

当前：大纲用 `CANON_EXTRACTION_SYSTEM` 提取事实，全部写入 `volume_number=0`
缺失：没有按卷写入分卷概要

建议：大纲输出新增 `volume_summaries` 数组，每卷一条 `canon_facts(volume_summary, vol=N)`

### 🟡 P3: 风格一致性抽样

建议：每 50 章时，对前 10 章的文风特征和最近 10 章做对比。如果差异显著 → L2 矫正项
