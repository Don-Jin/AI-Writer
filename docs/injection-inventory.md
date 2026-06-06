# 大纲/卷纲/细纲/正文 注入清单与诊断

## 大纲 (genOutline)

| # | 注入项 | 来源 | 状态 |
|---|--------|------|------|
| 1 | project.title | novel_projects | ✅ |
| 2 | project.description | novel_projects | ✅ |
| 3 | prepareContent | 用户输入 | ✅ |
| 4 | disassemblyContext | 拆文库 | ✅ |
| 5 | settingLibContext | 设定库 | ✅ |
| 6 | cardContext | canon_facts (is_hard=1, 全项目) | ✅ |
| 7 | styleContext | 风格库 | ❌ 硬编码 '' |
| 8 | personalityContext | 人格库 | ❌ 硬编码 undefined |
| — | OUTLINE_SYSTEM | ~2000 tokens | ✅ (刚修复自适应字数) |

**问题**: 大纲不注入风格/人格是**故意的**（注释写"它们只在细纲/正文阶段使用"）。合理性：大纲是宏观结构规划，不需要文风指导。✅ 保留现状。

**缺失**: cardContext 查询的是全项目 `is_hard_rule=1`，没有按 volume_number 分层。但大纲阶段 volume 还不存在，所以只能全查。✅ 合理。

---

## 卷纲 (genSingleVolume)

| # | 注入项 | 来源 | 状态 |
|---|--------|------|------|
| 1 | outlineContent | 大纲全文 | ✅ |
| 2 | disassemblyContext | 拆文库 | ✅ |
| 3 | settingLibContext | 设定库 | ✅ |
| 4 | cardContext | canon_facts (is_hard=1, 全项目, 截断1500字) | ✅ |
| 5 | prevVolContext | 上一卷概要 | ✅ |
| 6 | prevChapterPlansStr | 上一卷各章细纲标题 | ✅ |
| 7 | canonFactsContext | = cardContext (复用) | ✅ |
| 8 | foreshadowingStatus | 伏笔注册表状态 | ✅ |
| 9 | previousChaptersSummary | 前卷各章实际执行结果(记录官) | ✅ |
| 10 | timelineCurrentDay | 时间线当前位置 | ✅ |
| 11 | styleContext | 风格库 | ❌ **缺失** |
| 12 | personalityContext | 人格库 | ❌ **缺失** |
| — | VOLUME_OUTLINE_SYSTEM | ~3000 tokens | ✅ |

**问题**: 卷纲没有注入风格库和人格库。这意味着 AI 在规划卷的章节概要时不知道文风方向。虽然大纲阶段不注入合理，但卷纲已经涉及具体章节的概要设计，需要知道文风。

🔧 **应补充**: 在 user prompt 中加入 styleContext 和 personalityContext（截断到各500字）。

---

## 细纲 (genSingleChapterPlan)

| # | 注入项 | 来源 | 状态 |
|---|--------|------|------|
| 1 | outlineContent (前3000字) | 大纲 | ✅ |
| 2 | volContext | 所在卷标题+概要+主题 | ✅ |
| 3 | nodeContext | 卷纲节点(任务+内容+禁区) | ✅ |
| 4 | summaryConstraint | 卷纲 chapter_summaries | ✅ |
| 5 | prevContext | 上一章细纲 + 上一章正文(前400字) | ✅ |
| 6 | styleContext | 风格库(V4) | ✅ |
| 7 | personalityContext | 人格库(V2) | ✅ |
| 8 | canonFactsContext | canon_facts 三层分层 | ✅ |
| 9 | infoPermissionContext | 信息权限 | ✅ |
| — | 内联 system prompt | ~800 tokens | ✅ |

**评估**: 最完善的注入层，9个源全部合理。

---

## 正文 (genChapter)

| # | 注入项 | 来源 | 状态 |
|---|--------|------|------|
| 1 | project.title | 书名 | ✅ |
| 2 | prepareContent (前500字) | 简介 | ✅ |
| 3 | plan.title | 章标题 | ✅ |
| 4 | plan.summary | 本章概要 | ✅ |
| 5 | plan.characters | 出场角色 | ✅ |
| 6 | plan.key_events | 关键事件 | ✅ |
| 7 | plan.estimated_words | 目标字数 | ✅ |
| 8 | plan.emotional_arc | 情绪弧线 | ✅ |
| 9 | styleContext | 风格库 | ✅ |
| 10 | plotSummary | 前情摘要 | ✅ |
| 11 | prevExcerpt + prevStateContext | 上一章状态 | ✅ (刚补) |
| 12 | volContext + nodeContext | 卷纲+节点 | ✅ |
| 13 | prevSummaryContext | 记录官摘要 | ✅ |
| 14 | canonFactsContext | 三层事实(全局+卷级+delta) | ✅ |
| 15 | personalityContext | 人格库 | ✅ |
| 16 | plot_beats | 情节点 | ✅ |
| 17 | cool_moment | 爽点 | ✅ |
| 18 | forbidden | 禁区 | ✅ |
| 19 | scene_count | 场景数 | ✅ |
| 20 | max_info_reveal | 信息配额 | ✅ |
| 21 | emotion_cap | 感情上限 | ✅ |
| 22 | hooks | 章首/尾钩子 | ✅ |
| + | buildExecutionConstraints | 写作边界铁律(禁用词+风格+人格) | ✅ |
| + | CHAPTER_SYSTEM | 五层递进 | ✅ |
| + | buildMinimalContext | 角色/世界智能上下文 | ✅ |
| + | timeProgressionContext | 时间推移 | ✅ |
| + | consistencyChecklist | 一致性检查 | ✅ |
| + | stateContext | 叙事状态 | ✅ |

**评估**: 最完整，无冗余。22个明确参数 + 6个附属注入块。

---

## 总结

| 层级 | 注入数 | 缺失 |
|------|--------|------|
| 大纲 | 7 | 风格/人格(故意不注入) |
| 卷纲 | 10 | 🔴 风格+人格 |
| 细纲 | 9 | 无 |
| 正文 | 22+6 | 无 |

**唯一需要修复的**: 卷纲补充风格库和人格库注入。
