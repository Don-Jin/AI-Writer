# CLAUDE.md

## 项目
Windows 桌面 AI 小说写作软件。Electron 28 + React 18 + TypeScript + Tailwind + sql.js + Zustand + DeepSeek API。
GitHub: https://github.com/223151/AI-Writer

## 运行
```bash
npm run dev      # 开发 (Vite + Electron)
npm run build    # 生产构建
```
Windows 注意：`ELECTRON_RUN_AS_NODE=1` 环境变量会导致 Electron 以 Node 模式运行，脚本需清除。

## 架构

```
渲染进程 (React)                    主进程 (Electron)
├─ App.tsx 路由                     ├─ main.ts (窗口+IPC)
├─ components/                      ├─ database.ts (sql.js, 16表)
│  ├─ writing/Workspace.tsx         ├─ preload.ts (contextBridge)
│  ├─ writing/VolumePanel           └─ SQLite: %APPDATA%/novel-ai-writer/data.db
│  ├─ writing/MoreFields
│  ├─ writing/ReviewPanel (叙事控制台)
│  ├─ writing/DeslopPanel
│  ├─ writing/CanonFactPanel
│  ├─ writing/ForeshadowingPanel
│  ├─ writing/TimelinePanel
│  ├─ writing/ChapterEditor
│  ├─ setting/SettingDetail
│  ├─ personality/PersonalityDetail
│  └─ layout/Sidebar
├─ services/
│  ├─ generator.ts (所有 Prompt 模板)
│  ├─ checker.ts (Checker 三层 + 语义泄露 + 连续影响力 + 状态漂移 + StatePatch)
│  ├─ deslop.ts (去AI味检测+改写)
│  ├─ extractor.ts (风格提取)
│  ├─ disassembler.ts (拆文6阶段)
│  ├─ personalityExtractor.ts (人格提取)
│  ├─ settingExtractor.ts (设定提取)
│  └─ export.ts (TXT/DOCX)
├─ store/ (Zustand)
│  ├─ libraryStore.ts (风格库)
│  ├─ settingStore.ts (设定库)
│  ├─ personalityStore.ts (人格库)
│  └─ disassemblyStore.ts (拆文库)
└─ types/index.ts (所有类型定义)
```

## 数据库表
```
settings / style_libraries / novel_projects / outlines / detailed_outlines
/ chapters / context_state / disassembly_projects / token_usage
/ canon_facts / foreshadowing_registry / story_timeline / chapter_summaries
/ personality_projects / relationship_timeline / character_arc_log
/ conflict_facts (v2.3)
```

## 功能模块

### 四库系统（左侧栏）
| 库 | 功能 | 注入阶段 |
|----|------|---------|
| 拆文库 | 从参考小说提取结构/爽点/套路，注入大纲→卷纲→细纲→正文 | 全程 |
| 设定库 | 从参考小说提取角色/世界/规则/关系，注入大纲→卷纲 | 规划阶段 |
| 风格库 | 从参考小说提取5维写作指纹（叙事/句式/段落/词汇/情绪），注入大纲→细纲→正文→去AI味 | 约束层 |
| 人格库 | 从作者文字提取5维人味指纹（意象/怪癖/节奏/废话/修辞），注入大纲(轻量)→正文→去AI味 | 约束层 |

### 工作台（右侧栏）
| 标签 | 功能 |
|------|------|
| 大纲 | AI 生成 + 全屏编辑(Markdown) + 版本追踪 |
| 卷纲 | 八节点结构 + 一键生成全卷 + 拖拽跨卷 + 全屏编辑(JSON) |
| 细纲 | 逐章约束字段 + 全屏编辑(JSON) + 版本追踪 |
| 设定(CANON) | 角色/世界观/规则/关系/事件分类管理 + 大纲提取 + 章节提取 + AI补全 + 设定库导入 + truth_value 滑块 + 冲突标签 |
| 校对 | 叙事控制台：约束健康度 + 结构纵览 + 跨层关联 + AI叙事报告 + 手动干预 |
| 伏笔 | pending/active/done 三态 + 优先级 + 内联状态切换 + 回收条件/揭示比例 |
| 时间线 | 多时间线支持 + 卷筛选 + 时间倒退检测 + 事件密度统计 |

### 约束与控制系统
| 模块 | 功能 |
|------|------|
| Checker 三层 | ① deterministic(关键词+数值) ② structural(事件模式+语义泄露评分) ③ AI judge(仅建议) |
| 语义泄露评分 | 5维加权(density+identity+world_bleed+reveal_verbs+emotion_spike)，z-score校准，3%噪声基底 |
| Rewrite Loop | 语义快照+锚点diff+熔断(max 2次,熵限0.15,语义漂移>35%) |
| 连续影响力 | truth_value(0-1)+stability+conflict_weight，Tier Ceilings(speculative≤0.6,soft≤0.9) |
| 冲突记忆 | conflict_facts 表 + 参与state context + permanent永久张力 |
| 状态漂移 | computeStateDrift = sigmoid(conflicts+speculative+instability+noiseFloor) |
| 叙事控制台 | 从checker+event数据渲染约束健康/结构纵览/跨层关联 + AI叙事报告(advisory only) |

## 完整生成管线

### 阶段总览

```
准备(PREPARE) → 大纲(OUTLINE) → 卷纲(VOLUME_OUTLINE) → 细纲(DETAIL_OUTLINE) → 正文(CHAPTER)
                                                                                      │
                                          ┌───────────────────────────────────────────┘
                                          ▼
                                    生成后并行处理
                                    ├─ 记录官(摘要+伏笔+ai_concerns)
                                    ├─ 事件提取器(结构化事件)
                                    ├─ Checker 三层检测
                                    ├─ Rewrite Loop(快照+diff+熔断)
                                    ├─ Canonicalizer(事件合并去重)
                                    ├─ StatePatch(统一写入5表)
                                    └─ P5回流(连续影响力+衰减+冲突检测)
```

---

### 0. 准备阶段
```
触发：用户点击"生成准备"
Prompt：PREPARE_SYSTEM + PREPARE_USER(title, description)
输出：情绪定位、题材匹配、核心梗、角色设计(角色位抽象)、世界观框架、对标分析
存储：settings 表 (key='prepare_{id}')
```

### 1. 大纲生成
```
触发：用户点击"生成大纲"
Prompt：OUTLINE_SYSTEM + OUTLINE_USER(title, description, prepareContent,
        styleContext, disassemblyContext, settingLibContext, personalityContext)
注入：
  - 拆文库：buildDisassemblyContext() → 【📚 拆文库学习】
  - 设定库：buildSettingContext() → 【📋 设定库参考】
  - 风格库：buildStyleContext() → 【写作风格要求】
  - 人格库(轻量)：buildPersonalityContext() → 【🧠 人格参考】(仅imagery+quirks)
输出：分卷结构(4-8卷) + 全书字数规划 + 伏笔地图(跨卷标注) + 感情线阶段表(数值化0-10)
      + 信息释放节奏(按卷标注公开度%) + 全书禁区清单 + 时间线定义
存储：outlines 表 (version 自增)
编辑：全屏 Markdown 编辑器 → saveOutline(version++)
```

### 2. 卷纲生成
```
触发：用户点击"生成下一卷" 或 "一键生成全卷"
前置：大纲必须存在
Prompt：VOLUME_OUTLINE_SYSTEM + VOLUME_OUTLINE_USER(outlineContent, prevVolContent,
        volNum, chapterRange, disassemblyContext, settingLibContext,
        foreshadowingStatus, timelineContext)
注入：
  - 大纲 + 上一卷末尾状态 + 拆文库 + 设定库
  - 伏笔状态(pending/active) + 目标章节在本卷范围的伏笔
  - 时间线上下文(当前第N天)
输出：八节点结构(开篇/发展/转折一/转折二/高潮/矛盾结果/转折三/结局)
      + 爽点密度 + 黄金五章对照 + 角色弧线 + 情感曲线 + 冲突节点
      + 伏笔操作(plant/payoff/advance) + 时间线范围
存储：settings 表 (key='volumes_{id}')，标记 outline_version + version
编辑：全屏 JSON 编辑器 → JSON.parse 写回字段
```

### 3. 细纲生成
```
触发：用户点击"生成细纲"(逐章) 或 卷纲展开后"一键生成全卷"
Prompt：DETAIL_OUTLINE_SYSTEM + DETAIL_OUTLINE_USER(outlineContent, styleContext, disassemblyContext)
注入：大纲 + 风格库 + 拆文库
输出：逐章 JSON [
  { chapter_number, title, core_event, plot_beats[8-15条],
    emotional_arc, opening_hook{type,detail}, closing_hook{type,impact},
    forbidden[3-5条], scene_count, max_info_reveal, emotion_cap,
    estimated_words }
]
存储：detailed_outlines 表，标记 volume_version + plan_version
编辑：全屏 JSON 编辑器 → JSON.parse 写回字段
```

### 4. 正文生成 — 核心管线

#### 4a. 生成前：上下文构建（genChapter 函数内，约200行）

```
① 选用细纲 (chapterPlans.find)
② 查询事实簿 (canon_facts WHERE is_hard_rule=1)
   → 【📖 事实簿——不可违反】
③ 查询信息权限 (canon_facts WHERE revealed_level<100)
   → 【🔐 信息权限】⛔完全未公开 / ⚠部分公开
④ 构建角色上下文 (buildMinimalContext)
   → 【👤 角色上下文】+【🌍 世界设定】
⑤ 查询伏笔预警 (foreshadowing_registry WHERE status IN pending/active)
   → 【🪝 伏笔预警】
⑥ 查询时间线 (MAX(absolute_day) FROM story_timeline)
   → 【⏱ 时间线上下文】
⑦ 查询冲突记忆 (conflict_facts WHERE unresolved/permanent)
⑧ 查询推测事实数 + 平均稳定性 (canon_facts details JSON)
⑨ 计算叙事漂移 (computeStateDrift) + 选择叙事模式 (selectMode)
   → 【🌊 叙事漂移度】+【🎭 叙事模式】
⑩ 聚合叙事状态 (buildStateContext)
   → 【📊 叙事状态——当前全局进度】：信息配额 + 世界观公开度 +
      感情阶段 + 时间线 + ⚡冲突张力 + 🌊漂移度 + 🎭模式
⑪ 组装 CHAPTER_USER(
      title, targetReader, chapNum, planTitle, planSummary,
      characters, keyEvents, targetWords, emotionalGoal, functionTag,
      endingType, styleDesc, plotSummary, prevExcerpt,
      disassemblyContext, canonFactsContext, personalityContext,
      plotBeats, emotionalArc, coolMoment,
      forbidden, sceneCount, maxInfoReveal, emotionCap
    )
    → 注入：情节点序列 + 🎨风格约束(🔴硬≤7/🟡软≤12/🔵漂移≤15)
           + 🧠人格约束 + 📚拆文参考 + 前情 + 上章结尾 + 作者提示
```

#### 4b. 流式生成
```
CHAPTER_SYSTEM (4层递进)：
  第一层 故事层：这章的功能是什么、读者读完最该关心什么
  第一点五层 信息权限层：硬性权限边界，触碰=违规
  第二层 约束层：【🎨 风格约束】【🧠 人格约束】是写作边界
  第二点五层 人味注入：7原则(情绪私人出口/节奏呼吸/意象唯一/修辞门槛/废话体温/忍住不解释/不要写得像小说)
  第三层 落地层：硬禁令(禁用词/句式/段落规则)

aiChatStream → 实时流式输出 → setStreamingText
完成后 → setEditingContent → saveChapter → updateContext → showToast
```

#### 4c. 生成后：并行处理（async IIFE，不阻塞 UI）

```
┌─────────────────────────────────────────────────────────────┐
│ Promise.all([                                                │
│   记录官：CHAPTER_SUMMARY_SYSTEM + CHAPTER_SUMMARY_USER       │
│     → 摘要(100-150字) + 出场人物 + 地点 + 关键事件           │
│     → 时间标签 + absolute_day                                │
│     → 伏笔 planted[{id,desc}] + recovered[{id,desc}]         │
│     → 角色变化 + 关系演变 + 世界观变化                       │
│     → ai_concerns[{type,detail,severity}] (仅建议，不判定)    │
│                                                              │
│   事件提取器：EVENT_EXTRACTION_SYSTEM + EVENT_EXTRACTION_USER │
│     → events[{event_order,event_type,subject,action,object,  │
│               location,characters,dimension,time_label}]     │
│     → reveal_estimates{world,plot,character}                 │
│ ])                                                           │
├─────────────────────────────────────────────────────────────┤
│ Checker 三层检测 (checkChapter)                               │
│   ① deterministic：关键词匹配 + 数值对比                      │
│   ② structural：事件模式 + 时间线 + 语义泄露评分(5维z-score)  │
│   ③ AI judge：仅建议                                          │
│   → violations[] (来源:deterministic|structural|ai_suggestion) │
│   → concerns[] + leakScore{z,percentile,threshold}           │
│                                                              │
│   stateDrift + mode 放宽：                                    │
│     stable/explore：正常检查                                   │
│     decay：soft_canon 违规降为 concern                        │
│     conflict_peak：仅保留 forbidden，检查大幅放宽              │
├─────────────────────────────────────────────────────────────┤
│ Rewrite Loop (violations > 0 时触发)                          │
│   ┌─ takeSnapshot (语义锚点：entity+action_verb+reveal_flag)   │
│   ├─ buildRewritePrompt (段落锚点标注需修改的段落)             │
│   ├─ AI 重写 (只改违规段)                                      │
│   ├─ diffSnapshot (语义Jaccard距离)                           │
│   │   ├─ semanticChangeRatio > 0.35 → 熔断                    │
│   │   └─ isStable → 继续                                      │
│   ├─ calcInfoLoss (段落+长度变化)                             │
│   │   └─ > 0.15 → 熔断                                        │
│   ├─ reCheck (checkChapter 复查)                              │
│   │   ├─ violations=0 → 保存重写版本                          │
│   │   └─ violations>0 → 继续 (maxRetries=2)                   │
│   └─ 2次仍违规 → ⚠标记段落 + 保留原文                         │
├─────────────────────────────────────────────────────────────┤
│ Canonicalizer (canonicalizeEvents)                            │
│   4规则：interaction+reveal → merge                           │
│          interaction+emotion_shift → merge                    │
│          dedup(同subject+同action)                            │
│          reveal ⊃ world_change                                │
│   低频保护：全章仅1次的类型不参与合并                          │
├─────────────────────────────────────────────────────────────┤
│ StatePatch (buildStatePatchFromEvents)                        │
│   事件列表 → 确定性构建 StatePatch                             │
│     summary(拼接前3事件) + key_events + characters            │
│     + timeline_events + character_arcs + relationship_changes │
│   回退：事件提取失败 → 从记录官摘要构建                         │
├─────────────────────────────────────────────────────────────┤
│ applyStatePatches (统一写入5表)                                │
│   INSERT/UPDATE chapter_summaries                             │
│   INSERT OR IGNORE foreshadowing_registry (planted)           │
│   UPDATE foreshadowing_registry (resolved)                    │
│   INSERT story_timeline                                       │
│   INSERT character_arc_log + relationship_timeline            │
│   伏笔模糊匹配兜底 (description LIKE %desc%)                  │
├─────────────────────────────────────────────────────────────┤
│ P5 回流：连续影响力模型                                        │
│   新条目：INSERT canon_facts (tv=0.3, stability=0.1, cw=0,    │
│           source_type=auto_extracted)                         │
│   已有条目：tv += modeTvDelta (stable+0.15, explore+0.05,      │
│            decay-0.05, conflict_peak-0.02)                    │
│            Tier Ceilings: speculative≤0.6, soft≤0.9           │
│            non_collapse → 跳过                                  │
│   冲突检测：新事实 vs 已有 soft/hard 事实                      │
│            → 语义矛盾 → 写入 conflict_facts + cw+=0.1          │
│   衰减：未在本章提及的事实                                      │
│         tv -= modeDecayRate (stable 0.03, explore 0.01,       │
│              decay 0.06, conflict_peak 0.02)                  │
│         hard_canon(tv>0.8) 衰减减半                            │
│         non_collapse → 跳过                                    │
└─────────────────────────────────────────────────────────────┘
```

### 5. 叙事控制台 (ReviewPanel)
```
genChapter 存储 checkResult + eventData + leakScore 到 state
    ↓
ReviewPanel 纯渲染 ②约束健康 + ③结构纵览 + ③.5跨层关联
    ↓
用户点击"生成叙事报告"
    → NARRATIVE_STATE_REPORT_SYSTEM + NARRATIVE_STATE_REPORT_USER
    → ① 叙事状态摘要(半结构化，DO NOT reinterpret/smooth/evaluate)
    → ④ 策略建议(advisory only，executable:false，不进rewrite)
    ↓
⑤ 手动干预：fix_prompt 编辑 + autoFixChapter(find-replace 精确修改)
```

## 三级编辑 (v2.4)
| 层级 | 编辑方式 | 版本追踪 |
|------|---------|---------|
| 大纲 | 全屏 Markdown 编辑器 | outlines.version 自增 |
| 卷纲 | 全屏 JSON 编辑器 | Volume.version + outline_version |
| 细纲 | 全屏 JSON 编辑器 | ChapterPlan.plan_version + volume_version |

**编辑原则**: 单向传播，不回溯。编辑只影响向下生成的新内容，已生成内容不可变。

## 去AI味系统
- 生成前：CHAPTER_SYSTEM 人味注入(7原则) + 硬禁令
- 生成后：deslop.ts 检测(53禁用词+12句式模式+8心理模式) + AI改写(含风格边界+人格材料池)
- 伏笔状态：pending(待埋) / active(已埋) / done(已完结)

## 约束系统分层
```
🔴 Hard Constraints (≤7条): 视角+禁用词+段落禁令
🟡 Soft Constraints (≤12条): 句式+对话+情绪档位+节奏
🔵 Style Drift (≤15条): 意象+修辞+废话+怪癖
```

## Canon Facts 连续影响力 (v2.3 + v2.5)
```
truth_value: 0-1 (speculative<0.4 ≤ soft_canon<0.8 ≤ hard_canon)
stability: 0-1 (确认次数强度)
conflict_weight: 0-1 (存在矛盾的权重)
non_collapse: 永不自动提升 tv
Tier Ceilings: speculative≤0.6, soft≤0.9, hard=1.0(仅人工)

P5 回流（强化）：tv += modeTvDelta (stable+0.15, explore+0.05, decay-0.05, conflict_peak-0.02)
P5 衰减（遗忘）：未提及事实 tv -= modeDecayRate (stable 0.03, explore 0.01, decay 0.06, conflict_peak 0.02)
  hard_canon(tv>0.8) 衰减减半 | non_collapse 跳过
冲突检测: 新事实 vs 已有事实语义矛盾 → conflict_facts + cw+=0.1
```

## 叙事模式选择器 (v2.5)
```
selectMode(章在卷内位置%, 卷总章数, 冲突数, 前次漂移):
  卷前20%     → explore (建立新线索, tv增长缓慢, drift偏高, decay最慢)
  卷后15%     → conflict_peak (高潮冲突, tv略降, drift极高, checker大幅放宽)
  冲突数≥3    → conflict_peak
  前次漂移>0.6 → decay (消化旧设定, tv下降, decay加速)
  其他        → stable (正常推进)

模式效果注入：
  stateContext → 【🎭 叙事模式】标签
  checkHardRules → mode 放宽 (conflict_peak 仅保留 forbidden)
  P5 回流 → tv 增量 + decay 速率均按模式权重化
```

## 系统原则

**Checker 是约束警察，不是事实法官。**
- Checker 决定"这章能不能这样写"（是否触发重写）
- Narrative Model 决定"这个世界现在是什么状态"（truth_value/drift/conflict）
- 冲突时 Narrative Model 优先。Checker 只能标记 concern，不能推翻 Narrative Model 的判断。
- soft_canon 违反 → concern（不触发重写），hard_canon 违反 → violation（触发重写）

## 代码规范
1. 变量不跨 try 块使用
2. 禁止 `.replace(/\\/g, '')`，只删异常 hex 转义
3. JSON.parse 后必须判空+return
4. JSON 默认值展开防御空对象
5. 删除操作清理所有关联表
6. 每个 AI 调用必须有取消三件套(cancelledRef+卸载清理+catch判断)
7. state 变更必须同步写 DB
8. 类型定义只在 `src/types/index.ts`
9. 空 catch 必须注释原因
10. 跨组件键名必须一致

## 版本发布
更新 package.json 版本号 → 更新 README 日志 → git push → `npx electron-builder --win --dir` → GitHub Release
