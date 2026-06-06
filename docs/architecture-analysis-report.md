# novel-ai-writer 架构全面分析报告

> 分析日期：2026-06-06  
> 版本范围：v2.1.0  
> 分析范围：所有 AI 文字生成逻辑、组件间数据流、输入输出匹配度、潜在问题
> 上次修订：2026-06-06 — 补充实际数据流验证 + 已修复问题记录

---

## 一、项目总览

### 1.1 技术栈

| 层 | 技术 |
|---|------|
| 容器 | Electron 28 |
| 前端 | React 18 + TypeScript + TailwindCSS |
| 状态管理 | Zustand |
| 本地数据库 | SQLite (sql.js + WASM) |
| AI 调用 | OpenAI SDK → DeepSeek/OpenAI/Anthropic/Qwen |
| 文档导出 | docx, jspdf (docx/PDF/TXT/MD) |

### 1.2 项目定位

"AI 小说写作软件——学习小说风格，辅助长篇小说创作"。核心理念来自 oh-story-claudecode 方法论：**套路 = 确定性的情绪满足**。从情绪出发而非从灵感出发，用验证过的模式可靠地交付情绪。

---

## 二、整体架构图

```
┌─────────────────────────────────────────────────────┐
│                    Electron 主进程                     │
│  main.ts ── 窗口管理 + IPC 路由 + AI SDK 调用         │
│  preload.ts ── contextBridge 暴露 electronAPI         │
│  database.ts ── SQLite CRUD (16表) + 数据迁移         │
└──────────────┬──────────────────────────────────────┘
               │ IPC (ipcRenderer.invoke / on)
               ▼
┌─────────────────────────────────────────────────────┐
│                    React 渲染进程                      │
│                                                     │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│  │ 风格库  │ │ 拆文库  │ │ 设定库  │ │  人格库  │  │
│  │Library  │ │Disassem │ │Setting  │ │Personality│  │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬─────┘  │
│       │           │          │           │         │
│       └───────────┼──────────┼───────────┘         │
│                   │          │                      │
│            ReferenceSelector                        │
│          (用户选择参考资源)                             │
│                   │                                 │
│       ┌───────────┼───────────┐                     │
│       ▼           ▼           ▼                     │
│  ┌─────────────────────────────────────┐           │
│  │         Workspace (核心工作台)        │           │
│  │  ┌──────────────────────────┐        │           │
│  │  │    AI 生成流水线          │        │           │
│  │  │  准备→大纲→卷纲→细纲→正文  │        │           │
│  │  └──────────────────────────┘        │           │
│  │  + Checker(三层次检查)               │           │
│  │  + Deslop(去AI味)                    │           │
│  │  + ReviewPanel(校对面板)              │           │
│  └─────────────────────────────────────┘           │
│                                                     │
│  ┌─────────────────────────────────────┐           │
│  │       ChapterEditor (章节编辑器)      │           │
│  │   简化版: 生成正文 + 去AI味 + 导出     │           │
│  │   不完全具备 Workspace 的检查能力      │           │
│  └─────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

---

## 三、AI 文字生成全部链路分析

### 3.1 五大参考资源（输入源）— 修正后（v3 最终版）

| 资源类型 | 提取服务 | 存储表 | 输出给 AI 的阶段 | GenPanel 选择器 | 与 canon_facts 关系 |
|---------|---------|--------|-----------------|----------------|-------------------|
| 风格库 | extractor.ts | style_libraries | 细纲、正文 | ✅ 细纲/正文面板可选 | 无直接关系（素材模板） |
| 拆文库 | disassembler.ts | disassembly_projects | 大纲、卷纲 | ✅ 大纲/卷纲面板可选 | 无直接关系（素材模板） |
| 设定库(外部参考) | settingExtractor.ts | setting_libraries | 大纲、卷纲 | ✅ 大纲/卷纲面板可选 | **无直接关系**——AI读设定库作为参考，生成本项目原创角色/世界观→再由CANON_EXTRACTION提取入 canon_facts |
| 人格库 | personalityExtractor.ts | personality_projects | 细纲、正文 | ✅ 细纲/正文面板可选 | 无直接关系（素材模板） |
| **本项目设定(事实簿)** | **generator.ts: CANON_EXTRACTION** | **canon_facts** | **大纲、卷纲、细纲、正文** | 📌 自动注入（不作为用户选择项） | **内部真理**——来自大纲提取+Checker更新，随创作推进自动演化 |

### 3.1.1 关键概念：两个"设定库"

| | 外部设定库 | 本项目设定（事实簿） |
|---|---|---|
| **是什么** | 从参考小说提取的模板素材 | 本小说已确立的不可更改的事实 |
| **谁创建** | 用户导入参考书 → AI提取 | 大纲AI生成本项目角色/世界观 → CANON_EXTRACTION提取 |
| **谁更新** | 用户手动重新提取 | 卷纲后(character_milestones)→Checker后(revealed_level) |
| **数据流** | → genOutline() prompt → AI灵感来源 | → genVolume()/genDetail()/genChapter() prompt → 硬约束 |
| **存储** | setting_libraries 表 | canon_facts 表 |

### 3.2 AI 生成主链路（按创作阶段）— 完整输入清单

#### 阶段1: 准备 (prepare)
| 输入 | 来源 | 必填 |
|------|------|------|
| 书名 | 用户输入 | ✅ |
| 作者想法 | 用户输入 | 否 |

→ 输出: Markdown 创作方案 (情绪定位/题材/角色/世界观/对标)

#### 阶段2: 大纲 (outline) — `genOutline()`
| 输入 | 来源 | 确定方式 |
|------|------|---------|
| 书名 + 描述 | 项目信息 | ✅ 固定 |
| 准备方案 | settings 表 `prepare_${id}` | ✅ 固定 |
| 拆文库上下文 | GenPanel 选择(主/辅拆文库) | 🎛 用户可选 |
| 设定库上下文 | GenPanel 选择(主/辅设定库) | 🎛 用户可选 |
| 事实簿(硬规则) | canon_facts 表 (is_hard_rule=1) | 📌 自动注入 |
| 额外提示 | GenPanel hint 文本框 | 🎛 用户可选 |

→ 输出: Markdown 大纲(8大板块) → 自动提取事实簿 → canon_facts 表

#### 阶段3: 卷纲 (volume) — `genSingleVolume()`
| 输入 | 来源 | 确定方式 |
|------|------|---------|
| 大纲全文 | outlines 表 | ✅ 固定 |
| 拆文库上下文 | GenPanel 选择(与大纲共用同一组 state) | 🎛 用户可选 |
| 设定库上下文 | GenPanel 选择(与大纲共用同一组 state) | 🎛 用户可选 |
| 事实簿(硬规则) | canon_facts 表 | 📌 自动注入 |
| 前一卷上下文 | volumes state (上一卷标题/主题/摘要) | 🔗 自动 |
| 前一卷细纲 | chapterPlans (上一卷范围内的细纲) | 🔗 自动 |
| 前一卷实际执行 | chapter_summaries 表 (记录官摘要) | 🔗 自动 |
| 伏笔注册表状态 | foreshadowing_registry 表 (active/pending) | 📌 自动注入 |
| 时间线当前位置 | story_timeline 表 (MAX(absolute_day)) | 📌 自动注入 |

→ 输出: JSON 卷纲 (8节点 + 章概述 + 爽点/伏笔/禁区/时间线)

#### 阶段4: 细纲 (detail) — `genSingleChapterPlan()`
| 输入 | 来源 | 确定方式 |
|------|------|---------|
| 大纲片段(3000字) | outlines 表 | ✅ 固定 |
| 所在卷上下文 | volumes state (卷号/标题/概要/主题) | 🔗 自动 |
| 节点约束 | 卷纲 nodes[] (当前章节所在节点: 禁区/感情限制/信息配额) | 🔗 自动 |
| 卷纲章概述 | 卷纲 chapter_summaries[] (本章概述+下一章概述) | 🔗 自动 |
| 上一章上下文 | chapterPlans + chapters (上一章情节点最后3条+正文结尾400字) | 🔗 自动 |
| 风格库上下文 | GenPanel 选择(主/辅风格库) | 🎛 用户可选 |
| 人格库上下文 | GenPanel 选择(主/辅人格库) | 🎛 用户可选 |
| 事实簿(硬规则) | canon_facts 表 (is_hard_rule=1) | 📌 自动注入 |
| 信息权限 | canon_facts 表 (revealed_level<100, 分级: 完全禁止/部分公开) | 📌 自动注入 |

→ 输出: JSON 单章细纲 (情节点序列 + 钩子 + 禁区 + 情绪弧线)

#### 阶段5: 正文 (chapter) — `genChapter()`
| 输入 | 来源 | 确定方式 |
|------|------|---------|
| 书名 | 项目信息 | ✅ 固定 |
| 准备方案(500字) | settings 表 | ✅ 固定 |
| **细纲所有约束字段** | chapterPlans: | |
|  - plot_beats | 情节点序列(8-15条, 必须按顺序完成) | ⛓ 核心约束 |
|  - emotional_arc | 情绪弧线(起始→转折→最终) | ⛓ 核心约束 |
|  - forbidden[] | 本章禁区(绝对禁止, 3-5条) | ⛓ 核心约束 |
|  - scene_count | 场景数(2-4个) | ⛓ 约束 |
|  - max_info_reveal | 信息释放上限 | ⛓ 约束 |
|  - emotion_cap | 感情线上限(数值化) | ⛓ 约束 |
|  - opening_hook | 章首钩子(类型+具体内容) | ⛓ 约束 |
|  - closing_hook | 章尾钩子(类型+强度) | ⛓ 约束 |
|  - cool_moment | 本章爽点 | ⛓ 约束 |
| 风格库上下文 | buildStyleContext(主/辅) | 🎛 用户可选 |
| 人格库上下文 | buildPersonalityContext(主/辅) | 🎛 用户可选 |
| 事实簿(硬规则) | canon_facts 表 (is_hard_rule=1) | 📌 自动注入 |
| 信息权限 | canon_facts 表 (分级: 完全禁止/部分公开) | 📌 自动注入 |
| 前情摘要 | context_state.plot_summary | 🔗 自动 |
| 上章结尾(800字) | chapters 表 (上一章 content 末尾) | 🔗 自动 |
| 卷上下文 + 节点上下文 | volumes + nodes (禁区/感情/信息配额) | 🔗 自动 |
| 前一章记录官摘要 | chapter_summaries 表 | 🔗 自动 |
| 时间推移上下文 | story_timeline + canon_facts (时间差计算) | 📌 自动注入 |
| 一致性检查清单 | 近期伏笔预警 + 角色平衡 + 状态快照 | 📌 自动注入 |
| 角色上下文(分级) | buildMinimalContext(HOT/WARM/COLD) | 🔗 自动 |
| 禁用词清单 | getEffectivePatterns() (内置 + 用户自定义) | 📌 自动注入 |
| 作者额外提示 | GenPanel hint 文本框 | 🎛 用户可选 |

→ 输出: 纯正文(无标题/章节号) → Checker 检查 → 自动状态写入

### 3.3 GenPanel 选择器生效验证

| 生成阶段 | GenPanel 显示 | 选择器 | 传递路径 | 验证 |
|---------|--------------|--------|---------|------|
| 大纲 | `showGenPanel='outline'` | 拆文库 + 设定库 | `confirmGen()` → `genOutline({ primaryDissId, auxDissIds, primarySettingLibId, auxSettingLibIds })` → `buildDisassemblyContext()` / `buildSettingContext()` | ✅ |
| 卷纲 | `showGenPanel='volumes'` | 拆文库 + 设定库 | `confirmGen()` → `genSingleVolume()` → `getRefs()` 读取全局 state(primaryDissId/auxDissIds) | ✅ |
| 细纲 | `showGenPanel='detail'` | 风格库 + 人格库 | `confirmGen()` → `genSingleChapterPlan(target, { primaryStyleId, auxStyleIds, primaryPersonalityId, auxPersonalityIds })` → `buildStyleContext()` / `buildPersonalityContext()` | ✅ |
| 正文 | `showGenPanel='chapter'` | 风格库 + 人格库 | `confirmGen()` → `genChapter(chapNum, { primaryStyleId, auxStyleIds, primaryPersonalityId, auxPersonalityIds })` → `buildStyleContext()` / `buildPersonalityContext()` | ✅ |

**每个阶段都有独立的 state 变量**: 大纲/卷纲共享 `primaryDissId/auxDissIds/primarySettingLibId/auxSettingLibIds`，细纲/正文共享 `primaryStyleId/auxStyleIds/primaryPersonalityId/auxPersonalityIds`。事实簿(canon_facts)在所有阶段自动注入，不作为用户选择项。

### 3.4 输入分类图例

```
🎛 用户可选 — GenPanel 中勾选/取消的库
📌 自动注入 — 代码自动从数据库读取
🔗 自动链接 — 基于上下文自动构建(前一章/前卷/节点)
⛓ 核心约束 — 来自细纲的强制约束字段(禁区/配额/钩子)
✅ 固定 — 项目信息，始终可用
```

```
### 3.5 辅助 AI 链路

A) 灵感脑洞 (idea)
   IDEA_SYSTEM + IDEA_USER(input) → JSON { hook, genre, protagonist, ... }
   
B) 黄金三章 (golden three)
   GOLDEN_THREE_SYSTEM + GOLDEN_THREE_USER(ideaJson, styleContext, personalityContext)
   → 三章正文 (用 "=== 第N章 ===" 分隔)
   
C) 反向大纲 (reverse outline)
   REVERSE_OUTLINE_SYSTEM + REVERSE_OUTLINE_USER(ideaJson, [ch1, ch2, ch3])
   → Markdown 大纲

D) 大纲标准化 (outline normalize)
   OUTLINE_NORMALIZE_SYSTEM + OUTLINE_NORMALIZE_USER(outlineContent)
   → Markdown 标准格式

E) 记录官 (chapter summary) — 记录官摘要时调用，不是每章自动
   CHAPTER_SUMMARY_SYSTEM + CHAPTER_SUMMARY_USER(chapterNum, title, content, outlineContext)
   → JSON 结构化摘要

F) 事件提取器 (event extraction) — Checker 驱动
   EVENT_EXTRACTION_SYSTEM + EVENT_EXTRACTION_USER(chapterNum, title, content, outlineContext, chars)
   → JSON { events[], reveal_estimates }

G) 事实簿提取 (canon extraction) — 大纲生成后自动
   CANON_EXTRACTION_SYSTEM + CANON_EXTRACTION_USER(outlineContent)
   → JSON 数组 → canon_facts 表

H) 叙事状态报告 (narrative report) — 用户手动触发
   NARRATIVE_STATE_REPORT_SYSTEM + NARRATIVE_STATE_REPORT_USER(...)
   → JSON 叙事分析

I) 自动修改 (auto fix) — Checker 发现违规后
   AUTO_FIX_SYSTEM + AUTO_FIX_USER(chapterNum, content, issues, fixPrompt)
   → JSON { fixes: [{ find, replace }] }

J) 去AI味扫描/改写 (deslop scan/rewrite)
   DESLOP_SCAN_SYSTEM + DESLOP_SCAN_USER(text) → AI味报告
   buildStyledRewriteSystem(...) + DESLOP_REWRITE_USER(...) → 改写后文本

K) 上下文预算管理 (buildMinimalContext)
   纯代码函数，不调AI，按HOT/WARM/COLD分级注入角色上下文
```

---

## 四、各组件间数据流关系

### 4.1 核心数据流向图

```
                        ┌──────────────┐
                        │  用户操作/输入  │
                        └──────┬───────┘
                               │
          ┌────────────────────┼────────────────────┐
          ▼                    ▼                    ▼
   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
   │  风格库提取   │   │   拆文分析    │   │  设定库提取   │
   │ extractor.ts │   │disassembler  │   │settingExtract│
   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘
          │                  │                  │
          ▼                  ▼                  ▼
   ┌──────────────────────────────────────────────────┐
   │            ReferenceSelector                      │
   │  用户选择: 主/辅风格库 + 拆文库 + 设定库 + 人格库     │
   └──────────────────────┬───────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌──────────┐   ┌──────────────┐   ┌──────────┐
   │ 准备阶段  │   │   大纲生成    │   │  卷纲生成  │
   │(仅标题+  │──▶│(准备→大纲)   │──▶│(大纲→卷纲)│
   │ 描述)    │   │              │   │          │
   └──────────┘   └──────┬───────┘   └────┬─────┘
                         │                │
                         │ ⚡事实簿提取     │
                         ▼                ▼
                  ┌──────────┐    ┌──────────────┐
                  │ canon_   │    │  细纲生成      │
                  │ facts    │◀───│(大纲/卷纲→细纲) │
                  └────┬─────┘    └──────┬────────┘
                       │                │
                       │         ┌──────▼────────┐
                       │         │   正文生成      │
                       │         │(细纲→正文)     │
                       │         └──────┬────────┘
                       │                │
                       │         ┌──────▼────────┐
                       │         │  Checker 三层次 │
                       │         │  ①确定层 ②结构层 │
                       │         │  ③语义泄露       │
                       │         └──────┬────────┘
                       │                │
                       │    ┌───────────┼───────────┐
                       │    ▼           ▼           ▼
                       │ ┌──────┐ ┌──────────┐ ┌──────────┐
                       │ │ 违规  │ │ 自动修改  │ │ 手动编辑  │
                       │ │ 标记  │ │(auto fix)│ │          │
                       │ └──────┘ └──────────┘ └──────────┘
                       │                │
                       ▼                ▼
                ┌──────────────────────────────┐
                │     上下文更新                 │
                │ (character_state + plot_summary│
                │  → context_state 表)          │
                └──────────────────────────────┘
```

### 4.2 关键数据传递矩阵

| 从 → 到 | 传递内容 | 传递方式 |
|---------|---------|---------|
| 准备 → 大纲 | prepareContent (创作方案Markdown) | 字符串拼接进 User Prompt |
| 风格库 → 大纲 | buildStyleContext() 输出 | User Prompt 中的 `【写作风格要求】` |
| 拆文库 → 大纲 | buildDisassemblyContext() 输出 | User Prompt 中的 `【📚 拆文库学习】` |
| 设定库 → 大纲 | buildSettingContext() 输出 | User Prompt 中的 `【📋 设定库参考】` |
| 人格库 → 大纲 | buildPersonalityContext() 输出 | User Prompt 中的 `【🧠 人格参考】` |
| 事实簿 → 大纲 | canon_facts 硬规则 | User Prompt 中的 `【📖 已确立的事实簿】` |
| 大纲 → 卷纲 | outlineContent (完整大纲) | User Prompt 中的 `【全书大纲】` |
| 上一卷 → 下一卷 | prevVolContext + prevChapterPlans + prevVolOutcomes | User Prompt 拼接 |
| 大纲 → 细纲 | outlineContent + styleContext + disassemblyContext | User Prompt |
| 细纲 → 正文 | plot_beats[] + emotional_arc + forbidden[] + scene_count + hooks 等 | CHAPTER_USER() 参数 |
| 上下文 → 正文 | context_state.character_state + plot_summary | 作为 plotSummary/characterState 注入 |
| 正文 → Checker | chapterText + plan.forbidden + canon_facts | checkChapter() 参数 |
| Checker → 正文 | violations[] + concerns[] + leakScore | 返回对象，触发 UI 标记 |
| 正文 → 上下文更新 | newContent(前5000字) + prevState | AI 调用更新 context_state |

---

## 五、问题分析

### 5.1 输入输出不匹配 / 断层问题

#### 问题 1: 细纲 → 正文的字段传递不完整（严重）

**位置**: `Workspace.tsx` (genChapter) vs `CHAPTER_USER()` 参数签名

**分析**:  
`CHAPTER_USER()` 的设计签名包含 `plotBeats`, `emotionalArc`, `coolMoment`, `forbidden[]`, `sceneCount`, `maxInfoReveal`, `emotionCap`, `openingHook`, `closingHook` 等大量字段。

但在 `ChapterEditor.tsx` 的 `handleGenerate()` 中：
```typescript
// ChapterEditor.tsx 第157-165行
const messages = [
  { role: 'system', content: CHAPTER_SYSTEM },
  { role: 'user', content: CHAPTER_USER(
    project.title, outlineSummary, currentChapter, plan.title,
    plan.summary || '', plan.characters || [], plan.key_events || [],
    plan.estimated_words || 3000,
    emotionalGoal, functionTag, endingType,
    styleDesc, plotSummary, characterState, prevExcerpt, disassemblyContext
  )},
]
```
**问题**: ChapterEditor 没有传递 `plotBeats`、`emotionalArc`、`coolMoment`、`forbidden`、`sceneCount`、`maxInfoReveal`、`emotionCap`、`openingHook`、`closingHook` 等新字段。这意味着即使细纲中包含了这些约束字段（如本章禁区、情节点序列、钩子），ChapterEditor 也不会传递给 AI。**Constraints 层在 ChapterEditor 中完全失效**。

Workspace.tsx 中的 genChapter 是完整的：
```typescript
// Workspace.tsx
CHAPER_USER(
  project.title, targetReader || '', chapterNum, plan.title,
  plan.summary || '', plan.characters || [], plan.key_events || [],
  plan.estimated_words || 3000,
  emotionalGoal, functionTag, endingType,
  styleDesc, plotSummary, prevExcerpt, disassemblyContext,
  canonFactsContext, personalityContext,
  plan.plot_beats, plan.emotional_arc, undefined, // coolMoment 传了 undefined
  plan.forbidden, plan.scene_count, plan.max_info_reveal, plan.emotion_cap,
  plan.opening_hook, plan.closing_hook,
)
```

**影响**: ★★★★ 严重。ChapterEditor 生成的正文不受细纲约束，可能违反禁区、跳过情节点、不遵循钩子设计。

**建议**: ChapterEditor 需要和 Workspace 保持一致，传递完整的细纲字段。或者废弃 ChapterEditor，统一使用 Workspace。

---

#### 问题 2: 记录官摘要 vs 事件提取器 重复叠加（中等）

**位置**: `generator.ts` 的 `CHAPTER_SUMMARY_*` vs `EVENT_EXTRACTION_*` vs `checker.ts` 的 `buildStatePatchFromEvents()`

**分析**:  
项目中存在三套并行的"章节分析"机制：
1. **记录官** (`CHAPTER_SUMMARY_SYSTEM`): AI 调用，输出 JSON 摘要（含 summary, characters, events, foreshadowing, etc.）
2. **事件提取器** (`EVENT_EXTRACTION_SYSTEM`): AI 调用，输出 JSON 事件列表 + reveal_estimates
3. **buildStatePatchFromEvents()**: 确定性代码函数，从事件列表中构建 StatePatch（不调 AI）

三者功能重叠：
- 记录官返回的字段可以覆盖事件提取器的需求
- 但当前流程是：先生成正文 → Checker 调用事件提取器(再次调AI) → 记录官(再次调AI)

**影响**: ★★★ 中等。每个章节可能触发 3 次独立 AI 调用而获取高度重叠的信息。Token 浪费严重。

**建议**: 将记录官和事件提取器合并为单次调用，统一输出格式。或者用 `buildStatePatchFromEvents` 替代记录官(确定性，不调 AI)。

---

#### 问题 3: ChapterEditor 缺少 Checker 集成（严重）

**位置**: `ChapterEditor.tsx`

**分析**:  
Workspace.tsx 集成了完整的 Checker 三层次检查（`checkChapter` + `takeSnapshot` + `diffSnapshot` + `buildRewritePrompt`），但 `ChapterEditor.tsx` 完全没有。这意味着：
- ChapterEditor 生成的正文没有经过违规检测
- 没有语义泄露评分
- 没有信息配额检查
- 没有时间线一致性验证
- 如果用户从 ChapterEditor 生成章节，所有约束检查都跳过了

**影响**: ★★★★ 严重。ChapterEditor 是用户可独立访问的路径，缺少安全保障。

**建议**: 将 Checker 逻辑抽取为独立组件/hook，在 ChapterEditor 中复用。

---

#### 问题 4: 上下文预算管理函数未被调用（中等）

**位置**: `generator.ts` 的 `buildMinimalContext()` 函数

**分析**:  
`buildMinimalContext()` 是一个设计精良的函数，按 HOT/WARM/COLD 三级注入角色上下文，每5章做主角全面刷新。但在代码中搜索调用点，仅在 `generator.ts` 中定义，**在任何组件中都未被调用**。

当前的上下文注入方式是通过 `context_state.character_state` 和 `plot_summary` 直接传递给 AI——没有做分级过滤，可能造成上下文浪费。

**影响**: ★★ 低-中。功能存在但未接入，导致每章都传递全量角色状态，浪费 Token。

**建议**: 在生成章节前调用 `buildMinimalContext()` 过滤角色上下文。

---

#### 问题 5: 去AI味改写不传递禁区信息（中等）

**位置**: `DeslopPanel.tsx` → `deslop.ts` → AI 改写

**分析**:  
`deslop.ts` 的改写函数 (`buildStyledRewriteSystem`, `DESLOP_REWRITE_USER`) 知道风格约束和人格约束，但**不知道本章的 forbidden 列表**。AI 在"去 AI 味"改写时可能：
- 无意中添加新的信息揭示（违反了 info_reveal配额）
- 触发禁止的剧情内容
- 突破感情线限制

**影响**: ★★★ 中等。改写后的文本可能引入新的违规。

**建议**: 在 DeslopPanel 的改写调用中注入当前章节的 forbidden + emotion_cap + max_info_reveal 上下文。

---

### 5.2 数据一致性问题

#### 问题 6: 大纲 → canon_facts 提取的上下文截断

**位置**: `generator.ts` 的 `CANON_EXTRACTION_USER`

```typescript
export const CANON_EXTRACTION_USER = (outlineContent: string) =>
  `请从以下大纲中提取所有不可更改的核心事实：
  ${outlineContent.slice(0, 5000)}  // ← 截断至5000字
  输出JSON数组。`
```

**分析**: 一篇完整的8板块大纲可能远超5000字（特别是含伏笔地图、人物弧线、分章规划时）。截断到5000字意味着后半部分大纲中建立的事实不会被提取。

**影响**: ★★★ 中等。可能导致 canon_facts 不完整，后续 Checker 的语义泄露评分依据不全面。

**建议**: 使用智能采样或分段提取策略，而非简单截断。或者提高截断上限到 15000 字符。

---

#### 问题 7: volumes 存储在 settings 表而非独立表

**位置**: `Workspace.tsx` 的 `saveVolumes()` 和 `loadAll()`

```typescript
// 存储
await window.electronAPI.settings.set(`volumes_${id}`, JSON.stringify(vols))

// 读取
const volRow = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`volumes_${id}`])
```

**分析**: 卷纲 (volumes) 是大纲和细纲之间的关键中间产物，却被序列化为 JSON 字符串存在 `settings` 表中（key-value结构），而非拥有独立的数据库表。这带来：
- 无法对单卷进行查询/更新/版本管理
- settings 表变成杂物堆（prepare、volumes 都存在此）
- JSON 字符串过大时可能影响 settings 表的性能

**影响**: ★★ 低-中。功能可用但不规范。

**建议**: 为 volumes 创建独立表（或在 outlines 表中增加 volume 字段）。

---

### 5.3 架构设计问题

#### 问题 8: 两套并行的写作界面

**分析**:  
项目同时存在 `Workspace.tsx`（完整功能）和 `ChapterEditor.tsx`（简化版）。两者功能差异巨大：
| 功能 | Workspace | ChapterEditor |
|------|-----------|--------------|
| 准备/大纲/卷纲/细纲 | ✅ | ❌ |
| 正文生成 | ✅ (完整约束) | ✅ (缺少约束) |
| Checker 三层次 | ✅ | ❌ |
| 叙事控制台 | ✅ | ❌ |
| 去AI味 | ✅ | ✅ |
| 上下文更新 | ✅ | ✅ |
| 事件提取 | ✅ | ❌ |
| 记录官 | ✅ | ❌ |
| 伏笔/时间线面板 | ✅ | ❌ |

双界面导致维护成本翻倍和功能不一致（如问题1和问题3）。

**影响**: ★★★ 中等。

**建议**: 统一为 Workspace，或至少让 ChapterEditor 复用 Workspace 的核心 hooks。

---

#### 问题 9: Prompt 中的 JSON 输出格式不稳定

**分析**:  
大量 AI Prompt 要求输出严格 JSON，但代码中使用 `reply.match(/\{[\s\S]*\}/)` 或 `.replace(/```json\s*/gi, '').replace(/```\s*/g, '')` 来解析。这些是脆弱的字符串处理，在以下情况会失败：
- JSON 中包含嵌套的 `{` 或 `}`
- AI 返回了 markdown 代码块外的额外文字
- AI 返回了多个 JSON 对象

受影响的位置（至少8处）：
- `CHAPTER_SUMMARY_USER` → 记录官
- `EVENT_EXTRACTION_USER` → 事件提取
- `CANON_EXTRACTION_USER` → 事实簿
- `CONTEXT_UPDATE_USER` → 上下文更新
- `NARRATIVE_STATE_REPORT_USER` → 叙事报告
- `AUTO_FIX_USER` → 自动修改
- `IDEA_USER` → 灵感脑洞
- `STYLE_EXTRACTION_USER` → 风格提取

**影响**: ★★ 低-中。JSON 解析失败会导致静默错误（catch 块往往是空的）。

**建议**: 实现一个健壮的 JSON 提取工具函数，支持：
1. 尝试直接 `JSON.parse` 全文
2. 剥离 markdown 代码块后再解析
3. 对嵌套括号做平衡匹配
4. 失败时记录日志并提示用户

---

#### 问题 10: Tool Search / MCP 工具命名模糊

**位置**: `docs/` 目录下的设计文档

**分析**:  
`electron/preload.ts` 暴露了 `aiChat` 和 `aiChatStream` 两个独立方法。但 `ai:chatStream` 在主进程中的 `recordTokenUsage` 调用后的 `return fullContent`（第206行），而 stream chunk 是通过 `webContents.send` 发送的。这意味着：
- 渲染进程从 `invoke` 拿到的是完整文本（`return fullContent`）
- 同时还需要通过 `onStreamChunk` 监听实时数据块
- 这是两条独立的通信通道处理同一件事

**影响**: ★ 低。机制冗余但不影响功能。

---

#### 问题 11: 内存中的 calibration store 不持久化

**位置**: `checker.ts` 的 `calibrationMap`

```typescript
const calibrationMap = new Map<number, CalibrationStats>()
```

**分析**:  
Checker 的校准数据（语义泄露评分的项目级统计）存储在内存 Map 中。虽然提供了 `exportCalibration()` / `importCalibration()` 用于持久化，但在实际代码中找不到导入/导出的调用点。每次应用重启，校准数据都会丢失，需要重新积累。

**影响**: ★★ 低。校准效果在应用重启后会短暂退化。

**建议**: 在应用启动时从 settings 表加载校准数据，在每章检查后保存。

---

### 5.4 潜在风险

#### 问题 12: API Key 明文存储

**位置**: `database.ts` → `settings` 表 → `api_key`

**分析**: 用户的 API Key 明文存储在 SQLite 数据库中。Electron 应用的 userData 目录通常没有额外的加密保护。

**影响**: ★★ 安全风险。如果电脑被他人访问，API Key 可能泄露。

**建议**: 使用操作系统的安全凭据存储（如 Windows Credential Manager、macOS Keychain）。

---

#### 问题 13: 未处理 PDF 文件解析

**位置**: `electron/main.ts` → `file:parse`

**分析**: `parseFile` 支持 TXT/DOCX/MD，但文件对话框的过滤器包含 PDF。解析代码遇到 PDF 时会直接抛出 "不支持的文件格式" 错误。项目 `package.json` 中有 `pdf-parse` 依赖，但在 `file:parse` 中没有使用。

**影响**: ★ 低。用户体验不佳，但不会崩溃。

**建议**: 移除 PDF 过滤器或实现 PDF 解析。

---

## 六、问题严重性汇总

| # | 问题 | 严重性 | 影响范围 |
|---|------|--------|---------|
| 1 | ChapterEditor 缺少细纲约束传递 | ★★★★ 严重 | 正文质量 |
| 3 | ChapterEditor 缺少 Checker | ★★★★ 严重 | 质量保障 |
| 5 | 去AI味改写不传递禁区 | ★★★ 中等 | 改写安全性 | ✅ 已修复 — DeslopPanel 新增 `forbiddenContext` prop，改写时注入当前章节禁区 |
| 6 | 大纲截断导致事实簿不完整 | ★★★ 中等 | 一致性 | |
| 2 | 记录官/事件提取/StatePatch 重叠 | ★★★ 中等 | Token 浪费 | |
| 8 | 两套写作界面 | ★★★ 中等 | 维护成本 | |
| 9 | JSON 解析不稳定 | ★★ 低-中 | 可靠性 | |
| 4 | 上下文预算未被调用 | ★★ 低-中 | Token 浪费 | |
| 7 | volume 存 settings 表不规范 | ★★ 低-中 | 数据规范 | |
| 11 | calibration 不持久化 | ★★ 低 | 检查精度 | |
| 12 | API Key 明文存储 | ★★ 低 | 安全性 | |
| 13 | PDF 解析未实现 | ★ 低 | 用户体验 | |
| 10 | 流式双通道冗余 | ★ 低 | 架构 | |

---

## 七、改进建议

### 7.1 立即修复（P0）

1. **统一 ChapterEditor 和 Workspace 的正文生成逻辑**：将 `CHAPTER_USER` 调用包装为共享函数，确保所有约束字段都传递。或废弃 ChapterEditor。
2. **ChapterEditor 集成 Checker**：将 checkChapter 逻辑抽取为独立 hook 供复用。

### 7.2 短期优化（P1）

3. **合并记录官和事件提取器**：编写统一的章节分析 Prompt，一次调用输出所有需要的结构化数据。
4. **修复大纲截断**：对超长大纲使用智能采样或分段提取。
5. **去AI味改写注入禁区**：在 DeslopPanel 调用改写时传递 forbidden 列表。

### 7.3 中期重构（P2）

6. **volumes 独立表**：为卷纲创建独立的数据库表和 CRUD 接口。
7. **JSON 解析工具函数**：实现健壮的 `parseAIJson()` 工具。
8. **接入 buildMinimalContext**：在章节生成前过滤角色上下文。
9. **校准数据持久化**：章节检查后自动保存校准数据。

### 7.4 长期规划（P3）

10. **安全凭据存储**：使用操作系统原生 API 存储 API Key。
11. **实现 PDF 解析**：或从对话框中移除 PDF 选项。
12. **统一双界面**：将 ChapterEditor 重构为 Workspace 的子模式。

---

## 八、优化后的数据流图（建议）

```
用户输入 → 准备阶段 → 大纲生成 → 事实簿提取(自动)
                                    ↓
                    ┌─────── 卷纲生成 ───────┐
                    │  (含 canon/foreshadowing │
                    │   timeline 上下文注入)    │
                    └───────────┬─────────────┘
                                ↓
                    ┌─────── 细纲生成 ───────┐
                    │  (含 hooks/forbidden/    │
                    │   plot_beats 约束字段)    │
                    └───────────┬─────────────┘
                                ↓
         ┌────────── 正文生成 ──────────────┐
         │  ① buildMinimalContext (上下文预算) │
         │  ② 风格约束 + 人格约束 + 事实簿      │
         │  ③ 禁用词清单 + 禁区 + 信息配额     │
         │  ④ 情节点序列 + 钩子 + 情绪弧线     │
         └───────────┬──────────────────────┘
                     ↓
         ┌────────── Checker 检查 ──────────┐
         │  ① 确定层: 禁区/信息配额/感情上限  │
         │  ② 结构层: 时间线/事实一致性       │
         │  ③ 语义泄露评分                   │
         │  → 违规则触发 auto_fix 或标记      │
         └───────────┬──────────────────────┘
                     ↓
         ┌──── 统一章节分析 (替代记录官+事件提取) ───┐
         │  一次 AI 调用 → JSON                    │
         │  { summary, events, foreshadowing,     │
         │    character_changes, world_changes,     │
         │    reveal_estimates }                   │
         └───────────┬─────────────────────────────┘
                     ↓
         ┌────────── State Write ──────────┐
         │  ① chapter_summaries (摘要)      │
         │  ② story_timeline (事件时间线)    │
         │  ③ foreshadowing_registry (伏笔) │
         │  ④ character_arc_log (角色弧线)  │
         │  ⑤ relationship_timeline (关系)  │
         │  ⑥ context_state (上下文)       │
         │  ⑦ canon_facts 更新 (事实簿)     │
         └──────────────────────────────────┘
```

---

## 九、实际数据流逐阶段核对（2026-06-06 修订）

### 9.1 目标资源注入矩阵

| 资源类型 | 提取服务 | 存储表 | 目标阶段 |
|---------|---------|--------|---------|
| 风格库 | extractor.ts | style_libraries | 细纲、正文 |
| 拆文库 | disassembler.ts | disassembly_projects | 大纲、卷纲 |
| 设定库 | settingExtractor.ts | setting_libraries | 大纲、卷纲 |
| 人格库 | personalityExtractor.ts | personality_projects | 细纲、正文 |
| 事实簿(Canon) | generator.ts: CANON_EXTRACTION | canon_facts | 大纲、卷纲、细纲、正文 |

### 9.2 实际注入逐阶段验证

#### 大纲生成 (genOutline)

| 资源 | 修改前 | 修改后 | 状态 |
|------|--------|--------|------|
| 拆文库 | ✅ buildDisassemblyContext | ✅ | 不变 |
| 设定库 | ✅ buildSettingContext | ✅ | 不变 |
| 风格库 | ⚠️ config路径硬编码为''，无config路径通过getRefs注入 | ✅ 统一为'' | 已修复 |
| 人格库 | ⚠️ config路径从错误state构建，无config路径通过getRefs注入 | ✅ 统一排除 | 已修复 |
| 事实簿 | ❌ config路径硬编码为'' | ✅ 从canon_facts读取 | 已修复 |

#### 卷纲生成 (genSingleVolume)

| 资源 | 修改前 | 修改后 | 状态 |
|------|--------|--------|------|
| 拆文库 | ✅ 通过enrichedOutline注入 | ✅ | 不变 |
| 设定库 | ✅ 通过enrichedOutline注入 | ✅ | 不变 |
| 风格库 | ❌ 未注入 | ✅ 不注入(符合目标) | 不变 |
| 人格库 | ❌ 未注入 | ✅ 不注入(符合目标) | 不变 |
| 事实簿 | ✅ canonFactsContext | ✅ | 不变 |

#### 细纲生成 (genSingleChapterPlan)

| 资源 | 修改前 | 修改后 | 状态 |
|------|--------|--------|------|
| 风格库 | ✅ buildStyleContext(当前state) | ✅ 支持config选择器 | 已增强 |
| 拆文库 | ⚠️ disassemblyContext注入 | ✅ 已移除 | 已修复 |
| 人格库 | ✅ buildPersonalityContext(当前state) | ✅ 支持config选择器 | 已增强 |
| 事实簿 | ❌ 完全缺失 | ✅ 从canon_facts读取 | 已修复 |
| 选择器UI | ❌ 无，直接使用全局state | ✅ 新增GenPanel('detail')类型 | 已添加 |

#### 正文生成 — Workspace (genChapter)

| 资源 | 修改前 | 修改后 | 状态 |
|------|--------|--------|------|
| 风格库 | ✅ | ✅ | 不变 |
| 人格库 | ✅ | ✅ | 不变 |
| 拆文库 | ✅ 不注入(符合目标) | ✅ | 不变 |
| 事实簿 | ✅ | ✅ | 不变 |
| 约束字段 | ✅ 完整 | ✅ | 不变 |

#### 正文生成 — ChapterEditor (handleGenerate)

| 资源 | 修改前 | 修改后 | 状态 |
|------|--------|--------|------|
| 风格库 | ⚠️ V1旧格式(buildReferenceContext) | ✅ V3新格式(buildStyleContext) | 已修复 |
| 人格库 | ❌ 完全缺失 | ✅ buildPersonalityContext | 已修复 |
| 事实簿 | ❌ 缺失 | ✅ 从canon_facts读取 | 已修复 |
| 约束字段 | ❌ 全缺(plotBeats/forbidden/hooks等) | ✅ 完整传递 | 已修复 |
| 选择器UI | ⚠️ 仅风格库 | ✅ 风格库+人格库面板 | 已添加 |

### 9.3 数据结构验证

#### buildStyleContext vs buildReferenceContext

| 维度 | V3 buildStyleContext | V1 buildReferenceContext |
|------|---------------------|------------------------|
| 格式 | 三层分级(🔴硬约束/🟡软约束/🔵风格漂移) | 扁平文本 |
| 约束精确度 | 短句≤15字, 长句≥40字 等数值 | "句式特点: 短句为主"(模糊) |
| narrative解析 | 使用v3格式(narrative/perspective) | 使用v1格式(writing_style) |
| sentence_rhythm | ✅ | ❌ |
| 禁区词汇 | ✅ | ❌ |
| 情绪跨度 | ✅ | ❌ |
| 向后兼容 | ✅ | 仅V1格式 |

修改前ChapterEditor使用V1格式(模糊描述 "句式特点: 未知")，修改后统一为V3格式(精确数值约束)。

#### buildPersonalityContext 数据流

```
PersonalityProject.personality_data (JSON)
  ├── private_imagery      → extractItems() → 私人意象清单
  ├── emotional_quirks     → extractItems() → 情绪怪癖清单  
  ├── private_rhetoric     → extractItems() → 私人修辞清单
  ├── dialogue_fingerprint → extractItems() → 对话指纹清单
  ├── scenery_fingerprint  → extractItems() → 风景指纹清单
  ├── rhythm_fingerprint   → extractItems() → 节奏指纹(风格漂移层)
  ├── nonsense_style       → extractItems() → 废话风格(风格漂移层)
  ├── narrative_distance   → extractItems() → 叙事距离(风格漂移层)
  └── info_release         → extractItems() → 信息释放(风格漂移层)
```

每个维度被拆分为`[。；\n]+`分隔的条目，再按 `maxItems` 截断。输出格式为两层：🟡优先遵守 + 🔵风格漂移。

#### canon_facts 数据流

```
canon_facts 表查询
  ├── is_hard_rule=1 → 硬规则上下文(角色/设定/规则分类)
  └── revealed_level<100 → 信息权限上下文(分级: 完全禁止/部分公开)
```

修改前：细纲生成完全缺失 canon_facts 注入。修改后：从两个查询构建 (1) 硬规则 (2) 信息权限。

### 9.4 修改清单

| # | 文件 | 修改内容 | 影响 |
|---|------|---------|------|
| 1 | Workspace.tsx: genOutline | 移除style/personality注入，添加canon_facts | 大纲不再被风格/人格干扰 |
| 2 | Workspace.tsx: genSingleChapterPlan | 移除disassemblyContext，添加canon_facts，支持config参数 | 细纲注入符合目标表 |
| 3 | Workspace.tsx: showGenPanel type | 添加'detail'类型 | 细纲生成可用独立选择面板 |
| 4 | Workspace.tsx: confirmGen | 添加'detail'分支 | 连接选择面板到生成函数 |
| 5 | Workspace.tsx: GenPanel UI | 'detail'类型显示风格库+人格库选择器 | UI覆盖 |
| 6 | VolumePanel.tsx: Props | 更新genSingleChapterPlan签名，添加setGenDetailTarget | 接口升级 |
| 7 | VolumePanel.tsx: 按钮 | 单章/重生成按钮改为打开GenPanel | 体验升级 |
| 8 | ChapterEditor.tsx: 导入 | 添加PersonalityProject类型 | 类型支持 |
| 9 | ChapterEditor.tsx: buildStyleContext | 新增V3格式buildStyleContext函数 | 风格约束升级 |
| 10 | ChapterEditor.tsx: buildPersonalityContext | 新增buildPersonalityContext函数 | 人格约束新增 |
| 11 | ChapterEditor.tsx: handleGenerate | 完整约束字段注入+canon_facts+人格 | 正文质量对齐 |
| 12 | ChapterEditor.tsx: UI | 添加人格库选择器+约束详情预览 | 用户体验 |
| 13 | DeslopPanel.tsx: Props | 新增 `forbiddenContext` prop | 改写安全 |
| 14 | DeslopPanel.tsx: 改写prompt | 注入本章禁区上下文 | 改写安全 |
| 15 | Workspace.tsx: DeslopPanel调用 | 传入当前章节forbidden列表 | 改写安全 |
| 16 | ChapterEditor.tsx: DeslopPanel调用 | 传入style+personality+forbidden | 全面对齐 |

### 9.5 已知数据断层（验证后确认为无实质问题）

| 检查项 | 结果 |
|--------|------|
| 风格库 → 细纲 prompt 格式 | ✅ V3 buildStyleContext 三层输出，与细纲内联 system prompt 匹配 |
| 人格库 → 细纲 prompt 格式 | ✅ buildPersonalityContext 两层输出，细纲 system prompt 引用了"如果包含【🧠 人格参考】" |
| 人格库 → 正文 prompt 格式 | ✅ CHAPTER_SYSTEM 多层引用了人格指纹中的 对话指纹/风景指纹/私人意象/情绪怪癖 |
| canon_facts → 细纲 prompt | ✅ 新增，格式为 `【📖 事实簿——不可违反的硬规则】` + `【🔐 信息权限】` |
| canon_facts → 正文 prompt | ✅ "【📖 事实簿——不可违反】"注入 + "【🔐 信息权限——以下设定尚未公开】"分级注入 |
| 细纲 forbidden 字段 → 正文 | ✅ plot.forbidden 数组 → CHAPTER_USER → 【⛔ 本章禁区】 |

### 9.6 剩余问题（无阻塞性）

1. **DETAIL_OUTLINE_SYSTEM 常量死代码** — `generator.ts` 中定义的 `DETAIL_OUTLINE_SYSTEM` 和 `DETAIL_OUTLINE_USER` 从未被 Workspace 调用（内联 prompt 替代了它们）。建议清理或统一。

2. **VolumePanel 批量生成(循环调用genSingleChapterPlan)不经过选择面板** — 卷内全部生成时直接使用全局 state，而非每次弹出选择器。这是合理的设计权衡，但用户可能期望批量生成也能指定风格/人格。

3. **ReferenceSelector 组件残留** — ChapterEditor 仍使用 `ReferenceSelector` 组件显示风格库选择器，但其 `disassemblyIds` 已硬编码为空数组。`buildReferenceContext` 函数已不再使用，可考虑清理。

---

## 十、正文生成 23 个输入源逐项深度分析

> 分析对象：`genChapter()` 函数（Workspace.tsx:1139-1438）
> 原则：对每个输入追踪来源 → 可用性 → 对正文质量的影响 → 上游阻断风险 → 必要性判断

### 10.1 项目级固定输入

#### ① 书名 (project.title)

| 维度 | 详情 |
|------|------|
| **来源** | `novel_projects` 表 `title` 字段，用户创建项目时填写 |
| **可用性** | ✅ 始终可用（项目创建时必填） |
| **必要性** | ✅ 必须——CHAPTER_USER 将其置于 prompt 最顶部 `【📖 小说】《XXX》` |
| **阻断风险** | 无 |
| **问题** | 无 |

#### ② 准备方案 (prepareContent)

| 维度 | 详情 |
|------|------|
| **来源** | `settings` 表，key=`prepare_${id}` |
| **写入时机** | 用户在 PreparePage 手动填写或 AI 生成准备方案后存储 |
| **截断** | `slice(0, 500)` ——只用前 500 字 |
| **可用性** | ⚠️ 可能为空。如果用户跳过准备阶段直接进入 Workspace 生成大纲，`prepareContent` 为空字符串 |
| **必要性** | 中——CHAPTER_USER 将其注入 `【🎯 目标读者】` 段。空值时该段不渲染，不影响生成但失去目标读者指引 |
| **阻断风险** | 无——空字符串不影响调用 |
| **问题** | 准备方案可达数千字，仅用 500 字截断可能丢失关键内容。500 字只够容纳情绪定位+题材匹配，角色设计和世界观框架被丢弃 |

### 10.2 细纲约束层（来自 chapterPlans）

#### ③ plot_beats（情节点序列）

| 维度 | 详情 |
|------|------|
| **来源** | `detailed_outlines` 表 → `genSingleChapterPlan()` 生成的 JSON |
| **上游生成器** | `genSingleChapterPlan()` —— 内联 system prompt，接收大纲+卷纲+节点+上一章+风格+人格+事实簿 |
| **可用性** | ⚠️ 取决于细纲是否已生成。未生成时字段为 `undefined` |
| **必要性** | ★★★★★ 核心约束。CHAPTER_SYSTEM 明确规定"情节点序列是本章必须完成的事件清单，必须按顺序覆盖每一项——跳过即违规" |
| **阻断风险** | **高**——如果 `plot_beats` 为 undefined/falsy，CHAPTER_USER 回退到 V1 格式（旧版 plan.summary + characters + key_events），约束力从"8-15条具体可执行情节点"降级为"一句话概要+人物列表" |
| **问题** | ① 细纲 AI 可能产生模糊的情节点（如"发生了意外"而非"XX在密室发现了旧照片"）；② 多条情节点可能导致 prompt 过长 |

#### ④ emotional_arc（情绪弧线）

| 维度 | 详情 |
|------|------|
| **来源** | 细纲 JSON 字段，格式如"紧张→刺激→敬畏" |
| **可用性** | ⚠️ 细纲 AI 可能生成模糊/空值 |
| **必要性** | 中——指导章节情绪走向，但 AI 也可从情节点推断 |
| **问题** | 细纲 system prompt 要求该字段，但格式校验弱（纯文本字符串） |

#### ⑤ forbidden[]（本章禁区）

| 维度 | 详情 |
|------|------|
| **来源** | 细纲 JSON 字段，格式如 `["禁止揭露凌瑶身份","禁止引入新核心角色"]` |
| **可用性** | ⚠️ 细纲 AI 可能生成不到位的禁区（太宽泛或太严格） |
| **必要性** | ★★★★★ 核心安全机制。CHAPTER_USER 将其注入 `【⛔ 本章禁区——绝对不能出现以下内容】`。CheckLayer 的确定层也依赖此字段 |
| **阻断风险** | **严重**——如果 `forbidden` 为空或过于宽松，AI 可能在早期章节就揭露核心秘密 |
| **问题** | ① 完全依赖 AI 生成的细纲质量；② 没有代码层兜底——如果细纲 AI 没生成禁区，正文就没有禁区约束；③ 细纲 system prompt 要求 3-5 条，但没有数量校验 |

#### ⑥ scene_count（场景数）

| 维度 | 详情 |
|------|------|
| **来源** | 细纲 JSON 字段 |
| **必要性** | 低-中——仅作为建议（"2-4 个场景"），不强制执行。CHAPTER_USER 仅文本展示 |
| **问题** | 缺乏 enforce 机制——AI 可以完全忽略 |

#### ⑦ max_info_reveal（信息释放上限）

| 维度 | 详情 |
|------|------|
| **来源** | 细纲 JSON 字段，如"世界观公开度从15%→20%" |
| **必要性** | ★★★★ 重要——控制信息释放节奏，防止过早揭露。注入为 `【🔐 信息释放上限】` |
| **阻断风险** | **中**——此字段在 V1（旧版细纲）中不存在，只存在于 V2 细纲。旧版章节生成时不具备此约束 |
| **问题** | ① 只在 prompt 层建议，无强制校验；② Checker 的 `checkHardRules` 通过 `allowed_reveal` 数值字段做了代码层验证，但二者格式不统一（文本 vs 数值） |

#### ⑧ emotion_cap（感情线上限）

| 维度 | 详情 |
|------|------|
| **可用性** | 同 max_info_reveal——V1 细纲无此字段 |
| **必要性** | ★★★——感情线过早推进是常见问题。CheckLayer 有确定性校验 `recordedEmotion > parseFloat(capMatch[1])` |
| **问题** | 代码层校验依赖于 `recordedEmotion`（来自事件提取器的 `reveal_estimates.character`），但事件提取器和情感数值不是同一维度，匹配度存疑 |

#### ⑨ opening_hook / closing_hook（章首/章尾钩子）

| 维度 | 详情 |
|------|------|
| **来源** | 细纲 JSON 字段 |
| **必要性** | ★★★——CHAPTER_SYSTEM 多个位置引用了钩子约束（前 100 字必须抓住读者、结尾必须是钩子） |
| **问题** | 与 plot_beats 第1条和最后1条可能重复/冲突 |

#### ⑩ cool_moment（本章爽点）

| 维度 | 详情 |
|------|------|
| **可用性** | ⚠️ genChapter 传了 `plan.cool_moment`，但 CHAPTER_USER 对此参数的内部处理为 `undefined`（第 1330 行传了但 CHAPTER_USER 不消费此字段） |
| 来看看 CHAPTER_USER 的签名中是否有 cool_moment 参数 |
| **问题** | 确认中——实际上，genChapter 传 `plan.cool_moment` 但 CHAPTER_USER 签名中**没有** cool_moment 参数。查看签名第 19 位是 `plotBeats, emotionalArc, coolMoment`——有 cool_moment。但在 CHAPTER_USER 内部，prompt 中没有消耗 `coolMoment`。也就是说传了但没用。 |

### 10.3 风格与人格约束

#### ⑪ 风格库上下文 (styleContext)

| 维度 | 详情 |
|------|------|
| **来源** | `buildStyleContext(primaryStyleId, auxStyleIds, styleLibraries)` |
| **上游数据源** | `style_libraries` 表中的 `style_profile` JSON |
| **可用性** | 🎛 用户可选——未选择风格库时为空字符串 |
| **必要性** | ★★★★——CHAPTER_SYSTEM 第二层的"⚠️ 口语优先原则"和"文学化表述只能从风格约束中提取"重度依赖此输入 |
| **问题** | ① 风格库的 `style_profile` 格式不统一（V3 format: narrative/perspective vs V1 format: writing_style）；② `buildStyleContext` 中有 V1/V2 回退兼容逻辑，旧格式风格库输出精度低；③ 风格库提取(extractor.ts) 通过 `sampleText()` 采样，长文本可能丢失风格特征 |

#### ⑫ 人格库上下文 (personalityContext)

| 维度 | 详情 |
|------|------|
| **来源** | `buildPersonalityContext(primaryPersonalityId, auxPersonalityIds, personalityProjects)` |
| **上游数据源** | `personality_projects` 表中的 `personality_data` JSON（9 维度指纹） |
| **可用性** | 🎛 用户可选 |
| **必要性** | ★★★★——CHAPTER_SYSTEM 第二层的"对话必须从人格库的对话指纹中生长""风景描写必须从风景指纹中生长"依赖此输入 |
| **问题** | ① `extractItems` 按 `[。；\n]+` 拆分后可能产生不完整的条目；② 人格提取 (personalityExtractor.ts) 依赖 AI 单次调用，9 个维度各 150-300 字，AI 可能偷懒；③ 人格库选择器要求 `private_imagery` 或 `emotional_quirks` 非空才显示（过滤掉了数据不完整的人格项目） |

### 10.4 事实与信息权限

#### ⑬ 事实簿硬规则 (canonFactsContext)

| 维度 | 详情 |
|------|------|
| **来源** | `canon_facts` 表，查询 `is_hard_rule=1` |
| **上游数据源** | ① 大纲生成后自动提取(CANON_EXTRACTION, source='大纲') ② 旧 card 数据迁移(source='卡片迁移') |
| **可用性** | 📌 自动——大纲生成后才有数据 |
| **必要性** | ★★★★★——注入为 `【📖 事实簿——不可违反】`，确保角色名/核心设定/规则一致 |
| **阻断风险** | **高**——如果用户跳过大纲步骤，canon_facts 表为空 |
| **问题** | ① CANON_EXTRACTION 截断大纲至 5000 字（问题#6）；② `fact_value` 字段可能包含过长的描述（如迁移的旧角色卡 personality 被截断 200 字）；③ 读取出 `details` 列但只用于 `buildMinimalContext`，未在事实簿文本中展示扩展信息 |

#### ⑭ 信息权限 (infoPermissionContext)

| 维度 | 详情 |
|------|------|
| **来源** | `canon_facts` 表，查询 `revealed_level < 100`，分组为 `revealed_level=0`（完全禁止）和 `<50`（部分公开） |
| **必要性** | ★★★★——注入为 `【🔐 信息权限——以下设定尚未公开】`，控制信息释放 |
| **阻断风险** | **中**——① revealed_level 初始值由 CANON_EXTRACTION 时硬编码（角色=50, 事件=60, 关系=40, 其余=30），无法反映章节推进后的真实公开度；② 没有任何代码在章节生成后自动更新 revealed_level |

### 10.5 上下文串

#### ⑮ 前情摘要 (plotSummary)

| 维度 | 详情 |
|------|------|
| **来源** | `context_state` 表的 `plot_summary` 字段 |
| **上游机制** | `updateContext()` ——每章生成后 AI 调用 `CONTEXT_UPDATE_SYSTEM` 更新 |
| **可用性** | ⚠️ 第 1 章时为空；后续章节由上一章的 updateContext 写入 |
| **必要性** | ★★★——CHAPTER_USER 将其注入 `【前情】` 段 (slice(0,500)) |
| **阻断风险** | **中**——如果 updateContext 调用失败（AI 返回格式异常导致 JSON 解析失败，catch 块静默吞错），plotSummary 不会更新。后续章节的上下文逐渐陈旧 |
| **问题** | ① `CONTEXT_UPDATE_USER` 截断新章内容至 5000 字，长章节可能丢失关键信息；② JSON 解析仅使用 `reply.match(/\{[\s\S]*\}/)` 这种脆弱模式；③ 没有 fallback——如果 AI 解析失败，context_state 完全不被更新 |

#### ⑯ 上章结尾 (prevExcerpt)

| 维度 | 详情 |
|------|------|
| **来源** | `chapters` 表，上一章 `content.slice(-800)` |
| **可用性** | 第 1 章时为空字符串 |
| **必要性** | ★★★——注入为 `【上章结尾】`，帮助 AI 无缝衔接 |
| **问题** | ① 仅取最后 800 字，如果上章结尾是对话中或动作中断，800 字足够；但如果结尾处有重要的背景展开，可能被截断；② 如果上一章的 content 不完整（生成中断），此值不可靠 |

#### ⑰ 卷上下文 + 节点上下文 (volContext + nodeContext)

| 维度 | 详情 |
|------|------|
| **来源** | `volumes` state（来自 `settings` 表 `volumes_${id}`） |
| **上游生成器** | `genSingleVolume()` ——调用 VOLUME_OUTLINE_SYSTEM |
| **可用性** | ⚠️ 卷纲未生成时为空 |
| **必要性** | ★★★——提供所在卷的主题/节奏/情感氛围/节点禁区 |
| **阻断风险** | **低**——空值时不影响生成，但缺少结构性指引 |
| **问题** | ① volumes 存储为 JSON 字符串在 settings 表中（问题#7）；② `nodeContext` 依赖 `vol.nodes[]` 中的 `chapter_segment` 正则匹配 `第?(\d+)[-–—至到]第?(\d+)\)`——如果 AI 生成的章段格式不标准（如"第 1 至 6 章"），匹配失败，nodeContext 为空 |

#### ⑱ 前一章记录官摘要 (prevSummaryContext)

| 维度 | 详情 |
|------|------|
| **来源** | `chapter_summaries` 表，查询上一章的 `summary` 字段 |
| **上游机制** | 记录官 (CHAPTER_SUMMARY_SYSTEM) 或 Checker 的 applyStatePatches |
| **可用性** | ⚠️ 第 1 章时为空；后续章节取决于是否执行了记录官/Checker |
| **必要性** | ★★——辅助性上下文，提供上一章的结构化总结 |
| **阻断风险** | **低**——空值时不影响生成 |
| **问题** | ① 如果用户只生成章节而不运行 Checker/记录官，此表始终为空；② 记录官和 buildStatePatchFromEvents 可能写入不同的 summary 格式 |

### 10.6 自动化分析层

#### ⑲ 时间推移上下文 (timeProgressionContext)

| 维度 | 详情 |
|------|------|
| **来源** | `story_timeline` 表的 `MAX(absolute_day)` + `canon_facts` 表中 `details.established_day` |
| **可用性** | ⚠️ 需要 story_timeline 有数据（由 Checker 的 applyStatePatches 写入） |
| **必要性** | ★★★——重要的叙事一致性功能。防止 AI 写"三个月后"但实际上只过了三天 |
| **阻断风险** | **低**——空值时静默跳过 |
| **问题** | ① `details.established_day` 字段在 canon_facts details JSON 中，但此字段的写入来源不明确——CANON_EXTRACTION 不写此字段；② 依赖 Checker 的事件提取器才能更新 story_timeline |

#### ⑳ 一致性检查清单 (consistencyChecklist)

| 维度 | 详情 |
|------|------|
| **来源** | 实时计算：① `foreshadowing_registry` 中近期需回收的伏笔；② `chapter_summaries` 中主角连续缺失检查 |
| **可用性** | 📌 自动——始终执行（try/catch 包裹但无硬依赖） |
| **必要性** | ★★★——主动提醒 AI 不应遗漏的关键叙事元素 |
| **问题** | ① 代码缺陷——`consistencyChecklist` 被赋值两次（第 1373、1374 行，完全相同），属于无意义重复；② 主角缺失检测逻辑有 bug——只从 `chapter_summaries` 查最近 10 章，但 chapter_summaries 可能无数据 |

#### ㉑ 叙事状态上下文 (stateContext)

| 维度 | 详情 |
|------|------|
| **来源** | `buildStateContext()` ——聚合叙事状态：信息配额 + 世界观公开度 + 感情阶段 + 叙事漂移度 + 冲突记忆 + 叙事模式 |
| **可用性** | 📌 自动——始终执行 |
| **必要性** | ★★★★——注入到 userPrompt 最前面，设置整体叙事约束 |
| **问题** | ① `buildStateContext` 依赖多个数据源（revealed_level, emotion_stage, conflict_facts, canon_facts.details），其中 `conflict_facts` 表目前没有任何写入逻辑——为空表；② `emotion_stage` 来自卷纲的 `emotion_stage` 字段，此字段由 AI 生成，格式可能不标准 |

#### ㉒ 角色上下文分级 (buildMinimalContext)

| 维度 | 详情 |
|------|------|
| **来源** | `buildMinimalContext(chapNum, plan.characters, allChars, allWorlds, recentText)` |
| **数据来源链** | `allChars` ← canon_facts (fact_category='character') → details JSON (role_type, personality, status_tracking, abilities) |
| **必要性** | ★★★——按热度分级注入，控制上下文长度 |
| **问题** | ① `buildMinimalContext` 的重构角色数据从 `canon_facts.details` JSON 解析，但 `details` 的格式在迁移(old char_cards/world_settings)和 AI 提取(canon_extraction)之间不统一；② 角色 card 已迁移到 canon_facts，但 `character_cards` 和 `world_settings` 表已被 DROP，`buildMinimalContext` 的参数签名使用的字段名 `personality`/`abilities`/`status_tracking` 来自旧的 character_cards 结构，canon_facts 的 `details` JSON 中可能没有这些字段名 |

#### ㉓ 禁用词清单 (getEffectivePatterns)

| 维度 | 详情 |
|------|------|
| **来源** | `getEffectivePatterns()` → 合并 `DEFAULT_BANNED_PATTERNS` (内置规则) + `localStorage deslop_custom_patterns` (用户自定义) |
| **必要性** | ★★★★——CHAPTER_USER 末尾注入 `buildBannedWordsInjection()`，包含结构禁令 + 语调禁令 + 标点规则 |
| **问题** | ① `localStorage` 依赖浏览器环境，Electron 中有效但非标准；② 自定义规则仅在本地生效，不随项目同步 |

### 10.7 输入源阻塞链分析

```
项目创建 ✅
  └── 准备方案 ⚠️ 可跳过 → 空值可用（仅失去目标读者指引）
      └── 大纲生成 ✅ 关键节点
          ├── canon_facts ⚠️ 大纲后才存在 → 无大纲则无事实簿注入
          ├── 卷纲生成 ⚠️ 可跳过 → volContext/nodeContext 为空
          │   └── 细纲生成 ⚠️ 关键节点
          │       ├── plot_beats ⚠️ 细纲后才存在 → 无细纲则降级为 V1 格式
          │       ├── forbidden[] ⚠️ 细纲生成质量决定安全性
          │       └── hooks/emotion_cap 等 ⚠️ V2 细纲才有
          ├── 上下文更新 ⚠️ 每章后 AI 更新 → 解析失败则上下文停滞
          └── Checker 运行 ⚠️ 事后执行
              ├── story_timeline ⚠️ Checker 后才更新
              ├── chapter_summaries ⚠️ Checker 后才写入
              └── 时间推移 ⚠️ 依赖 timeline 数据
```

### 10.8 关键发现

1. **canon_facts 是事实簿的数据基石，但来源不完整**：仅在大纲生成后自动提取一次（截断 5000 字），后续章节生成后不自动更新。revealed_level 初始硬编码，不反映真实进展。

2. **角色上下文的数据格式分裂**：`character_cards`/`world_settings` 已迁移到 `canon_facts`（旧表已 DROP），但 `buildMinimalContext` 的参数依然使用旧的字段名。canon_facts 的 `details` JSON 在迁移代码和 AI 提取代码中使用了不同的字段命名。

3. **V1/V2 细纲断层**：旧版细纲（通过旧版生成或早期版本）缺少 `plot_beats`/`forbidden`/`hooks` 等 V2 字段。正文降级到 V1 格式时，约束力从 15+ 个精确字段降为 5 个模糊字段。

4. **上下文状态系统脆弱**：`updateContext()` 依赖 AI JSON 解析，解析失败静默跳过。如果连续多章解析失败，`plotSummary` 永远停留在最早的版本。

5. **conflict_facts 表为空**：v2.3 创建的冲突记忆表，表结构存在但没有任何写入代码。

6. **节点匹配正则脆弱**：`chapter_segment` 的匹配正则 `/第?(\d+)[-–—至到]第?(\d+)/` 对 AI 生成的非标准格式可能失败。

---

*报告完毕(修订版 v3)。*
