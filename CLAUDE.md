# CLAUDE.md

## 项目
Windows 桌面 AI 小说写作软件。Electron 28 + React 18 + TypeScript + Tailwind + sql.js + DeepSeek API。
GitHub: https://github.com/223151/AI-Writer

## 运行
```bash
npm run dev      # 开发 (Vite + Electron)
npm run build    # 生产构建
```
Windows 注意：`ELECTRON_RUN_AS_NODE=1` 环境变量会导致 Electron 以 Node 模式运行，脚本需清除。

## 架构 (v4.0 — 状态机式叙事引擎)

```
渲染进程 (React)                    主进程 (Electron)
├─ App.tsx 路由                     ├─ main.ts (窗口+IPC)
├─ components/                      ├─ database.ts (sql.js, 15表)
│  ├─ writing/Workspace.tsx         ├─ preload.ts (contextBridge)
│  ├─ writing/VolumePanel           └─ SQLite: %APPDATA%/novel-ai-writer/data.db
│  ├─ writing/MoreFields
│  ├─ writing/DesignPanel (v4.0 设计台)
│  ├─ writing/CheckReportPanel (v4.0 检查)
│  ├─ writing/DeslopPanel
│  ├─ writing/ChapterEditor
│  ├─ setting/SettingDetail
│  ├─ personality/PersonalityDetail
│  ├─ library/LibraryDetail
│  └─ layout/Sidebar
├─ services/
│  ├─ generator.ts (所有 Prompt 模板)
│  ├─ trackerService.ts (v4.0 状态追踪)
│  ├─ checker.ts (Checker 三层)
│  ├─ deslop.ts (去AI味检测+改写)
│  ├─ extractor.ts (风格提取)
│  ├─ disassembler.ts (拆文6阶段)
│  ├─ personalityExtractor.ts (人格提取 V2: 5核行为替换图谱)
│  ├─ settingExtractor.ts (设定提取)
│  └─ export.ts (TXT/DOCX)
├─ store/ (Zustand)
│  ├─ libraryStore.ts (风格库)
│  ├─ settingStore.ts (设定库)
│  ├─ personalityStore.ts (人格库)
│  └─ disassemblyStore.ts (拆文库)
└─ types/index.ts (所有类型定义)
```

## 数据库表 (v4.0)
```
settings / style_libraries / novel_projects / outlines / detailed_outlines
/ chapters / volumes / disassembly_projects / token_usage
/ setting_libraries / personality_projects / version_history

v4.0 新表（状态机架构）:
/ story_tracker (三层 tracker: master/volume/chapter × character/event/foreshadow/rules)
/ tracker_transitions (不可变状态迁移日志)
/ volume_check_reports (卷结束结构化对比)
```

## 功能模块

### 四库系统（左侧栏）
| 库 | 功能 | 注入阶段 |
|----|------|---------|
| 拆文库 | 从参考小说提取结构/爽点/套路，注入大纲→卷纲→细纲→正文 | 全程 |
| 设定库 | 从参考小说提取角色/世界/规则/关系，注入大纲→卷纲 | 规划阶段 |
| 风格库 | V4·22类替换指南（ai_uses→human_uses+rule），注入正文→去AI味 | 约束层 |
| 人格库 | V2·5核行为替换图谱（情绪/意象/对话/节奏/观察），注入正文→去AI味 | 约束层 |

### 工作台（右侧栏 v4.0）
| 标签 | 功能 |
|------|------|
| 大纲 | AI 生成 + 全屏编辑(Markdown) + 版本追踪 |
| 细纲 | 逐章约束字段 + 全屏编辑(JSON) + 版本追踪 |
| 设计台 | 设定(角色/世界观/事件节点) + 角色跟踪 + 事件跟踪 + 伏笔，四子标签 |
| 检查 | 卷结束结构化对比（角色弧线/事件推进/迁移规则/伏笔统计）+ 手动运行 |

### 约束与控制系统
| 模块 | 功能 |
|------|------|
| Checker 三层 | ① deterministic(关键词+数值) ② structural(事件模式+语义泄露评分) ③ AI judge(仅建议) |
| 语义泄露评分 | 5维加权(density+identity+world_bleed+reveal_verbs+emotion_spike)，z-score校准 |
| Rewrite Loop | 语义快照+锚点diff+熔断(max 2次) |
| 状态追踪 | story_tracker 三层(master/volume/chapter) + tracker_transitions 不可变日志 |
| 迁移规则 | validateTransition: 情绪允许路径 + 关系max_delta + 事件阶段跳转 |
| 卷检查 | runVolumeCheck: expected_state vs actual_state 四维对比 |

## 完整生成管线 (v4.0)

### 阶段总览

```
准备(PREPARE) → 大纲(OUTLINE) → 总表提取(MASTER_TRACKER)
  ↓
卷纲(VOLUME_OUTLINE) → 卷表提取(VOLUME_TRACKER)
  ↓
细纲(DETAIL_OUTLINE) → 章表初始写入
  ↓
正文(CHAPTER) → 章表提取(CHAPTER_TRACKER) + Checker
  ↓
自动续写：细纲→正文→细纲→正文→...→卷结束→卷检查→卷纲→...
```

---

### 0. 准备阶段
```
触发：用户点击"生成准备"
Prompt：PREPARE_SYSTEM + PREPARE_USER(title, description)
输出：情绪定位、题材匹配、核心梗、角色设计、世界观框架、对标分析
存储：settings 表 (key='prepare_{id}')
```

### 1. 大纲生成 → 总表提取
```
触发：用户点击"生成大纲"
Prompt：OUTLINE_SYSTEM + OUTLINE_USER
注入：拆文库 + 设定库
输出：分卷结构 + 全书字数规划 + 伏笔地图 + 感情线阶段表

→ extractMasterFromOutline(): AI 提取角色总弧线/事件总弧线/伏笔/迁移规则
→ 写入 story_tracker(tier='master', tracker_type='character'|'event'|'foreshadow'|'rules')
→ 展示：设计台 > 设定标签
```

### 2. 卷纲生成 → 卷表提取
```
触发：自动续写卷结束时 或 手动"生成下一卷"
Prompt：VOLUME_OUTLINE_SYSTEM + VOLUME_OUTLINE_USER
注入：大纲 + 总表(master tracker) + 上卷卷表终态 + 拆文库 + 设定库 + 伏笔状态

→ extractVolumeFromOutline(): AI 提取本卷 expected_state (角色终态/事件终态/伏笔计划)
→ 写入 story_tracker(tier='volume', expected_state={...})
→ 展示：设计台 > 角色跟踪/事件跟踪/伏笔（卷级 expected vs actual 对比）
```

### 3. 细纲生成 → 章表初始状态
```
触发：自动续写中细纲缺失时 或 手动生成
Prompt：内联模板 (genSingleChapterPlan)
注入：大纲(前3000字) + 卷纲 + 上章细纲 + 上章 ending_state + 卷表状态 + 风格库 + 人格库

→ 写入章表初始 state: story_tracker(tier='chapter', tracker_type='character')
  state = { emotion: 从emotional_arc推断, goal: 从core_event推断, ... }
→ 后续正文提取时 UPSERT 覆盖为实际值
```

### 4. 正文生成 — 核心管线 (v4.0 精简版)

#### 4a. 上下文构建（~4000 chars，恒定）
```
① 细纲 plot_beats + forbidden + emotional_arc + hooks (~600)
② 字数要求 (50)
③ 本章章表 summary (~800) — 从 story_tracker(chapter) 读取
④ 上章 ending_state (~200) — scene/emotion/unfinished_action
⑤ 风格库 (~1500)
⑥ 人格库 (~1000)
```

#### 4b. 流式生成
```
CHAPTER_SYSTEM (4层递进约束) + CHAPTER_USER
aiChatStream → 实时流式输出 → setStreamingText
完成后 → setEditingContent → saveChapter → showToast
```

#### 4c. 生成后处理（精简为 2 步）
```
① 章表提取 (extractChapterState):
   - 读本章正文(前8000字) + 上章 tracker 状态
   - AI 提取角色/事件/伏笔最新 state
   - upsertTracker 写入 story_tracker(tier='chapter')
   - logTransition 写入 tracker_transitions (old→new + transition_valid)
   - validateTransition 校验迁移规则

② Checker 三层检测 (checkChapter):
   - deterministic + structural + AI judge
   - violations → 标记段落 + 可选重写
   - 简化模式：facts=[] + timelineHistory=[]（不依赖旧表）
```

### 5. 卷结束检查 (runVolumeCheck)
```
自动续写检测卷边界 → 四个维度:
  ① 角色弧线：volume.expected_state vs 本卷最后章 actual_state
  ② 事件推进：expected phase/progress vs actual
  ③ 迁移规则：检查 tracker_transitions 中的 transition_valid=0
  ④ 伏笔状态：total/resolved/overdue/recovery_rate

→ 写入 volume_check_reports
→ 展示：检查标签 (CheckReportPanel)
```

## 三级编辑 (v4.0)
| 层级 | 编辑方式 | 版本追踪 |
|------|---------|---------|
| 大纲 | 全屏 Markdown 编辑器 | outlines.version 自增 |
| 卷纲 | 全屏 JSON 编辑器 | Volume.version + outline_version |
| 细纲 | 全屏 JSON 编辑器 | ChapterPlan.plan_version + volume_version |

**编辑原则**: 单向传播，不回溯。编辑只影响向下生成的新内容，已生成内容不可变。

## 去AI味系统
- 生成前：CHAPTER_SYSTEM 人味注入(7原则) + 硬禁令
- 生成后：deslop.ts 检测(53禁用词+12句式模式+8心理模式) + AI改写
- 风格库 V4：22类替换指南，❌AI会用 → ✅人类写法 → 📏规则
- 人格库 V2：5核行为替换图谱，情绪/意象/对话/节奏/观察

## 自动续写
```
三种入口:
  ① 工具栏"自动续写"按钮 → 弹窗设置起始章/终止章 + 风格库 + 人格库
  ② genChapter 内部链式触发（autoContinueRef）

流程: genChapter(N) → 检测 N+1 是否有细纲 → 无则 genSingleChapterPlan(N+1)
      → 检测 N+1 是否在当前卷 → 无则 genSingleVolume(新卷) + runVolumeCheck(旧卷)
      → genChapter(N+1) → ...

中断: 点击"取消" → autoContinueRef=false → 链式中止
删除重写: 删除章节 → 清理 story_tracker + tracker_transitions → 自动续写覆盖
```

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
