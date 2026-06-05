# AI 小说写作软件

一款 Windows 桌面 AI 小说写作工具，基于 Electron + React + TypeScript 构建，DeepSeek API 驱动。从提示词工具进化为**叙事编译器**：视角铁律 + 9维人格指纹 + 六模式叙事轮换 + 结构级禁令 + 白描/否定纠正检测。

当前版本：**v2.1.0**

## 核心功能

### 四库系统
- **🔬 拆文库**：导入爆款小说 → AI 拆解结构/爽点/套路 → 注入大纲→卷纲→细纲→正文
- **📋 设定库**：导入小说 → AI 提取角色/世界/规则/关系 → 注入大纲→卷纲 + 可导入 canon_facts
- **🎨 风格库**：导入小说 → AI 提取5维写作指纹（叙事/句式/段落/词汇/情绪）→ 🔴硬≤7 🟡软≤12 🔵漂移≤15 分层约束
- **🧠 人格库**：导入作者文本 → AI 提取5维人味指纹（意象/怪癖/节奏/废话/修辞）→ 注入大纲(轻量)→正文→去AI味

### 叙事编译器引擎 (v2.1)
- **Checker 三层检测**：① deterministic(关键词+数值) ② structural(事件模式+语义泄露评分5维加权z-score) ③ AI judge(仅建议)
- **连续影响力模型**：truth_value(0-1) + stability + conflict_weight，Tier Ceilings 防全体硬确定，叙事遗忘曲线
- **冲突记忆**：conflict_facts 表，矛盾参与 state context 构建，permanent 永久张力
- **状态漂移**：sigmoid(conflicts+speculative+instability+noiseFloor)，3%不可约噪声基底
- **叙事模式选择器**：每章自动选择 stable/explore/decay/conflict_peak，权重化 tv/drift/decay
- **Rewrite Loop**：语义锚点快照 + Jaccard diff + 熔断(max 2次,熵限0.15,语义漂移>35%)
- **事件提取器 + Canonicalizer**：结构化事件提取 + 4规则合并去重 + 低频保护
- **StatePatch 统一写入**：genChapter 不再直接写 DB → 5表原子写入

### 三级编辑 + 版本追踪
- 大纲：全屏 Markdown 编辑，version 自增
- 卷纲：全屏 JSON 编辑，outline_version + volume_version
- 细纲：全屏 JSON 编辑，volume_version + plan_version
- 编辑原则：单向传播，不回溯。已生成内容不可变

### 叙事控制台 (ReviewPanel)
- 纯渲染：约束健康度 + 结构纵览 + 跨层关联(event↔violation↔伏笔)
- AI 叙事报告：DO NOT reinterpret/smooth/evaluate，半结构化输出
- 策略建议：advisory only，不进入 rewrite pipeline
- 手动干预：fix_prompt 编辑 + autoFixChapter 精确 find-replace

### 工作台
- 大纲/卷纲(八节点结构)/细纲(plot_beats)/设定(CANON)/校对(控制台)/伏笔/时间线
- 流式正文生成 + 去AI味(本地扫描+AI改写+人味注入)
- 多模型(DeepSeek/OpenAI/Claude/通义千问) + TXT/DOCX/MD 导出

## 更新日志

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
| 📊 连续影响力 | truth_value+stability+conflict_weight，Tier Ceilings(speculative≤0.6,soft≤0.9)，P5回流+衰减 |
| ⚡ 冲突记忆 | conflict_facts 表，冲突参与 state context 构建，permanent 永久张力 |
| 🌊 状态漂移 | computeStateDrift(sigmoid+noiseFloor)，drift 从 checker 参数升级为生成控制层 |
| 🎭 叙事模式 | selectMode(卷位置%+冲突+漂移)→stable/explore/decay/conflict_peak，权重化三个机制 |
| 🔄 Rewrite Loop | 语义锚点快照+Jaccard diff+熔断(max2次,语义漂移>35%,熵>0.15) |
| 📝 事件提取器 | 并行调用，5种事件类型(reveal/action/interaction/world_change/emotion_shift) |
| 🔗 Canonicalizer | 4规则合并(interaction+reveal/emotion/dedup/reveal⊃world)+低频保护 |
| 📦 StatePatch | genChapter 不再直接写DB→applyStatePatches 5表统一写入 |
| 🖊️ 三级编辑 | 大纲Markdown+卷纲JSON+细纲JSON，全屏编辑，版本追踪+代际边界锁 |
| 🎛️ 叙事控制台 | 约束健康+结构纵览+跨层关联+AI叙事报告(advisory only)+手动干预 |
| 🎨 约束分层 | 🔴Hard≤7 🟡Soft≤12 🔵Style≤15，buildStyleContext/buildPersonalityContext 重构 |
| 📥 设定库导入 | CanonFactPanel 从设定库手动导入+source_type权威分层+truth_value滑块+冲突标签 |
| 🧠 人格注入大纲 | 人格库(imagery+quirks)轻量注入 OUTLINE_USER |
| 🔙 代际边界锁 | Volume.outline_version + ChapterPlan.volume_version，编辑只影响向下生成 |
| 🗂️ 组件拆分 | VolumePanel + ReviewPanel + MoreFields 独立组件 |

### v1.7.0

| 功能 | 说明 |
|------|------|
| 🔄 版本更新检查 | 设置页新增检查更新功能，对接 GitHub Releases |
| ✍️ 正文四层递进 | CHAPTER_SYSTEM 新增「人味注入」层 |
| 🧹 四库精简 | 拆文库删角色分析/文风/评分；人格库只留5个人味指纹 |
| 📋 设定库详情注入 | 大纲卷纲注入角色info/abilities/role和世界观description |
| 🖥️ UI重构 | 配色Indigo/Slate，编辑器沉浸式居中，左右面板折叠 |

### v1.6.0

| 功能 | 说明 |
|------|------|
| ✍️ 正文生成重构 | CHAPTER_SYSTEM 三层递进，回归情绪驱动 |
| 🎯 目标读者 | PREPARE 结果注入正文生成 |
| 📉 Token 精简 | 删除重复上下文块，每章输入减少 ~43% |

### v1.5.0 ~ v1.1.0

参见 git log 或 GitHub Releases。

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 状态管理 | Zustand |
| 数据库 | SQLite (sql.js) — 16 表 |
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
│   └── database.ts          # SQLite 封装 (16表)
├── src/                     # React 渲染进程
│   ├── components/
│   │   ├── writing/         # Workspace + VolumePanel + ReviewPanel
│   │   │                    # + CanonFactPanel + ForeshadowingPanel + TimelinePanel
│   │   │                    # + DeslopPanel + ChapterEditor
│   │   ├── library/         # 风格库管理
│   │   ├── disassembly/     # 拆文库管理
│   │   ├── setting/         # 设定库管理
│   │   ├── personality/     # 人格库管理
│   │   └── common/          # Toast / Modal / ReferenceSelector
│   ├── services/
│   │   ├── generator.ts     # 所有 Prompt 模板 (大纲/卷纲/细纲/正文/记录官/事件提取器/校对/叙事报告)
│   │   ├── checker.ts       # Checker三层 + 语义泄露 + 连续影响力 + 状态漂移 + StatePatch + 模式选择器
│   │   ├── deslop.ts        # 去AI味检测+改写
│   │   ├── extractor.ts     # 风格提取
│   │   ├── disassembler.ts  # 拆文
│   │   ├── personalityExtractor.ts # 人格提取
│   │   ├── settingExtractor.ts     # 设定提取
│   │   └── export.ts        # TXT/DOCX/MD 导出
│   ├── store/               # Zustand
│   └── types/               # TypeScript 类型
└── package.json
```

## License

MIT
