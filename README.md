# AI 小说写作软件

一款 Windows 桌面 AI 小说写作工具，基于 Electron + React + TypeScript 构建，DeepSeek API 驱动。从提示词工具进化为**状态机式叙事引擎**：三层 tracker（总表/卷表/章表）+ 迁移规则校验 + 卷结束结构化对比。

当前版本：**v2.2.0**

## 核心功能

### 四库系统
- **🔬 拆文库**：导入爆款小说 → AI 拆解结构/爽点/套路 → 注入大纲→卷纲→细纲→正文
- **📋 设定库**：导入小说 → AI 提取角色/世界/规则/关系 → 注入大纲→卷纲
- **🎨 风格库**：V4·22类替换指南（❌AI会用 → ✅人类写法 → 📏规则）→ 注入正文→去AI味
- **🧠 人格库**：V2·5核行为替换图谱（情绪/意象/对话/节奏/观察）→ 注入正文→去AI味

### 状态机式叙事引擎 (v2.2)
- **三层 tracker**：总表(master) → 卷表(volume, 含 expected_state) → 章表(chapter, 含实际 state)
- **固定 schema**：character(emotion/location/goal/relationships) + event(phase/progress) + foreshadow(status)
- **迁移规则**：情绪允许路径、关系 max_delta、事件阶段跳转 → validateTransition 自动校验
- **卷结束检查**：expected_state vs actual_state 四维对比（角色弧线/事件推进/迁移规则/伏笔统计）
- **设计台**：四子标签（设定/角色跟踪/事件跟踪/伏笔）+ 可编辑 summary + 关系可视化
- **不可变日志**：tracker_transitions 表记录每次状态迁移，支持回滚和调试

### 精简注入 (v2.2)
- 正文注入从 ~8K chars 降至 ~4K chars（移除冗余的 prevExcerpt/timeProgression/consistencyChecklist）
- 上一章 800 字全文 → ending_state 200 字结构化摘要
- 每章 2 次 AI（正文 + 章表提取）替代旧的 3 次（正文 + 记录官 + 事件提取器）

### 三级编辑 + 版本追踪
- 大纲：全屏 Markdown 编辑，version 自增
- 卷纲：全屏 JSON 编辑，outline_version + volume_version
- 细纲：全屏 JSON 编辑，volume_version + plan_version
- 编辑原则：单向传播，不回溯。已生成内容不可变

### 自动续写
- 工具栏弹窗设置起始章/终止章 + 风格库 + 人格库
- 流程：正文(N) → 检测细纲/卷纲 → 自动生成 → 正文(N+1) → ... → 卷结束 → 卷检查 → 新卷纲
- 中断：点击取消 → 链式中止。删除章节 → 清理 tracker → 重新续写覆盖

### 工作台 (v2.2)
- 大纲/细纲/设计台(四子标签)/检查(卷检查报告)
- 流式正文生成 + 去AI味(本地扫描+AI改写+人味注入)
- Checker 三层检测 + Rewrite Loop
- 多模型(DeepSeek/OpenAI/Claude/通义千问) + TXT/DOCX 导出

## 更新日志

### v2.2.0 — 状态机式叙事引擎（事实簿全面重构）

| 模块 | 更新内容 |
|------|---------|
| 🏗️ 状态追踪 | 删除 9 张旧表（canon_facts/chapter_fact_deltas/foreshadowing_registry/story_timeline 等），新建 story_tracker + tracker_transitions + volume_check_reports 三表 |
| 📊 三层 tracker | master(大纲后提取) → volume(卷纲后提取, 含 expected_state) → chapter(正文后提取, 含实际 state) |
| 🔗 迁移规则 | tracker_type='rules' 记录情绪允许路径/关系 max_delta/事件阶段跳转，validateTransition 自动校验 |
| ✅ 卷检查 | runVolumeCheck 四维对比（角色弧线/事件推进/迁移规则/伏笔统计），自动续写卷结束时触发 |
| 🎛️ 设计台 | 新 UI 替代旧 CanonFactPanel，四子标签：设定(角色/世界观/事件节点分类) + 角色跟踪 + 事件跟踪 + 伏笔 |
| 📋 检查面板 | CheckReportPanel 替代旧 ReviewPanel/CorrectionSummaryPanel，卷选择器 + 评分 + 偏差列表 + 违规列表 |
| 🗑️ 删除记录官 | 删除 CHAPTER_SUMMARY + EVENT_EXTRACTION 两次 AI 调用，章表提取替代（每章省 2 次） |
| 📉 注入精简 | 正文注入 ~8K → ~4K：prevExcerpt(800字)→ending_state(200字)，删除 timeProgression/consistencyChecklist/progressContext |
| 🔄 状态迁移日志 | tracker_transitions 不可变日志，每次写章记录 old_state→new_state + transition_valid |
| 🎨 风格库 V4 | 22 类替换指南格式（ai_uses→human_uses+rule），选择器支持 V4/V3/V1 格式 |
| 🧠 人格库 V2 | 5 核行为替换图谱，选择器修复 V2 格式检测（emotion/imagery/dialogue） |
| 🐛 修复 | VolumePanel DOM 嵌套、自动续写起始章跳过、设计台不刷新、检查面板无数据、风格/人格库选择白屏、personality 注入旧格式、genConfig 弹窗缺人格库选择器 |
| 📦 删除 | CanonFactPanel/ReviewPanel/CorrectionSummaryPanel/ForeshadowingPanel/TimelinePanel；canonService.ts(900+行)；DETAIL_OUTLINE_SYSTEM/USER 死代码 |

### v2.1.0 — 去AI味深度重构 + 新创作流程

| 模块 | 更新内容 |
|------|---------|
| 🎯 视角铁律 | 新增第零层约束——全文限制在角色感知范围内，禁上帝视角总结、禁并列信息堆叠、禁象征性收尾 |
| 🗣️ 对话规则 | 重写对话要求：情绪第一位、角色声音不能一样、对话不是问答机。禁止短句无情绪 |
| 🔍 结构级禁令 | "不是A而是B"从关键词升级为结构识别，区分无情绪版本（禁止）vs 有情绪版本（允许） |
| 🎨 白描禁令 | 白描从六模式之一降级为禁止默认语调，新增"记录员测试"判断标准 |
| 📝 六模式轮换 | 叙事模式从单一白描扩展为口语叙述/动作推进/对话交锋/内心噪音/感官细节/事实交代六模式交替 |
| 🧠 人格库9维 | 从5维扩展到9维：新增对话指纹、风景指纹、叙事距离、信息释放 |
| 🚫 禁用词端到端 | buildBannedWordsInjection() 改用 getEffectivePatterns()，自定义规则真正注入生成prompt |
| ⚡ 快捷禁用 | 编辑器选中文字→浮动🚫按钮选毒级一键添加；扫描命中词旁＋一键添加 |
| 🛡️ 极短独段检测 | 新增人名独段（排除80+非人名词）、AI转场碎片检测（1-4字零信息独段） |
| 🔧 大纲标准化 | 全屏编辑弹窗新增「标准化」按钮，AI重写自由格式大纲为标准分卷结构 |
| ✏️ 续写 | 编辑器工具栏新增续写按钮，取上文500字+细纲方向，AI续写1000-2000字追加 |
| 📜 历史版本 | 新增version_history表，大纲/正文保存时自动存档，支持查看和恢复历史版本 |
| 💡 灵感→三章→大纲 | 新增创作流程：输入灵感→AI生成脑洞→黄金三章→反向提取大纲 |
| 🐛 Bug修复 | 自定义规则注入生成prompt、saveChapter不再全量重载、时间线重复清理、重写空转检测、SENTENCE_PATTERNS lastIndex污染修复 |
| ⚡ max_tokens | 8192→16384，解决大纲/卷纲输出截断 |

### v2.0.0 — 叙事编译器架构

| 模块 | 说明 |
|------|------|
| 🏗️ Checker 三层 | ①deterministic(关键词+数值) ②structural(事件模式+语义泄露评分5维加权) ③AI judge(仅建议) |
| 📊 连续影响力 | truth_value+stability+conflict_weight，Tier Ceilings(speculative≤0.6,soft≤0.9) |
| ⚡ 冲突记忆 | conflict_facts 表，冲突参与 state context 构建，permanent 永久张力 |
| 🌊 状态漂移 | computeStateDrift(sigmoid+noiseFloor) |
| 🎭 叙事模式 | selectMode→stable/explore/decay/conflict_peak |
| 🔄 Rewrite Loop | 语义锚点快照+Jaccard diff+熔断 |
| 🖊️ 三级编辑 | 大纲Markdown+卷纲JSON+细纲JSON，全屏编辑，版本追踪 |
| 🎛️ 叙事控制台 | 约束健康+结构纵览+跨层关联+AI叙事报告 |

### v1.7.0 — 历史版本 + 去AI味增强

参见 git log 或 GitHub Releases。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 状态管理 | Zustand |
| 数据库 | SQLite (sql.js) — 15 表 |
| AI API | DeepSeek / OpenAI / Claude / 通义千问 |
| 构建 | Vite + esbuild + electron-builder |

## 快速开始

### 1. 安装

```bash
npm install
```

### 2. 配置 API Key

启动后进入「设置」页面，选择模型并输入 API Key。

### 3. 开发

```bash
npm run dev
```

### 4. 打包

```bash
npm run package
```

---

## 项目结构

```
novel-ai-writer/
├── electron/                # Electron 主进程
│   ├── main.ts              # 窗口 + IPC + AI 流式调用
│   ├── preload.ts           # contextBridge API
│   └── database.ts          # SQLite 封装 (15表)
├── src/                     # React 渲染进程
│   ├── components/
│   │   ├── writing/         # Workspace + VolumePanel + DesignPanel
│   │   │                    # + CheckReportPanel + DeslopPanel + ChapterEditor
│   │   ├── library/         # 风格库管理
│   │   ├── disassembly/     # 拆文库管理
│   │   ├── setting/         # 设定库管理
│   │   ├── personality/     # 人格库管理
│   │   └── common/          # Toast / Modal / ReferenceSelector
│   ├── services/
│   │   ├── generator.ts     # 所有 Prompt 模板
│   │   ├── trackerService.ts # 状态追踪 (master/volume/chapter tracker + 迁移规则 + 卷检查)
│   │   ├── checker.ts       # Checker三层 + 语义泄露 + Rewrite Loop
│   │   ├── deslop.ts        # 去AI味检测+改写
│   │   ├── extractor.ts     # 风格提取 (V4: 22类替换指南)
│   │   ├── disassembler.ts  # 拆文6阶段
│   │   ├── personalityExtractor.ts # 人格提取 (V2: 5核行为替换图谱)
│   │   ├── settingExtractor.ts     # 设定提取
│   │   └── export.ts        # TXT/DOCX 导出
│   ├── store/               # Zustand
│   └── types/               # TypeScript 类型
├── docs/                    # 设计文档
│   ├── factbook-full-redesign-plan.md        # v4.0 重构计划
│   ├── plan-vs-implementation.md             # 计划 vs 实现对照
│   └── outline-dataflow-analysis.md          # 大纲/卷纲/细纲输入输出分析
└── package.json
```

## License

MIT
