# CLAUDE.md — AI 小说写作软件项目指引

## 项目概述

Windows 桌面端 AI 小说写作软件。Electron + React + TypeScript + Tailwind CSS，DeepSeek API 驱动。目标用户是不懂代码的小说创作者。

**GitHub**: https://github.com/223151/AI-Writer

---

## 当前状态：v1.0 功能完整，已知问题待修

### 已完成的模块

| 模块 | 路由 | 状态 |
|------|------|------|
| 🏠 项目管理 | `/` | ✅ 创建/列表/删除/改名 |
| 🎨 风格库 | `/library` `/library/:id` | ✅ 导入小说→AI提取风格→逐字段编辑 |
| 🔬 拆文库 | `/disassembly` `/disassembly/:id` | ✅ 导入→6阶段管线拆解→编辑结果 |
| ✍️ 写作工作台 | `/project/:id/workspace` | ✅ 三栏布局：目录+编辑+大纲/细纲/校对 |
| ⚙ 设置 | `/settings` | ✅ API Key 保存/测试 |
| 📊 Token 监控 | 侧边栏 | ✅ 实时统计+费用估算 |
| 📥 导出 | 写作页 | ✅ TXT/Word/PDF |

### 写作工作台核心流程

```
新建项目 → 工作台（自动进入）
  ├─ 📐 大纲：生成选择面板（选风格库+拆文库+提示词）→ AI 生成
  ├─ 📑 细纲：生成卷纲 → 卷内逐章生成细纲（每章独立）
  └─ ✍️ 正文：生成选择面板 → AI 生成本章 → 去AI味 → 编辑保存
```

层级依赖：大纲 → 卷纲 → 章细纲 → 上一章正文（每级重新生成需读取上级）

### 已知问题

| 问题 | 严重度 | 说明 |
|------|--------|------|
| 拆文库列表有死代码 | 低 | `handleRename` 用 `window.prompt` 但已有 InlineEdit，需手动删除 |
| 风格库列表有死代码 | 低 | 同上 |
| Windows 打包需 `--dir` | 中 | winCodeSign 符号链接在 Windows 解压失败，只能用 portable 模式 |
| 部分旧页面未清理 | 低 | OutlineEditor/DetailOutlineEditor/PreparePage/ChapterEditor 仍存在但已被 Workspace 替代，路由已移除 |

---

## 核心架构

```
渲染进程 (React)                   主进程 (Electron)
┌──────────────────────┐    IPC    ┌─────────────────────────┐
│ App.tsx (路由)        │◄────────►│ main.ts                  │
│ ├─ ProjectList        │  db:query │ ├─ 窗口管理              │
│ ├─ LibraryList/Detail │  db:run  │ ├─ IPC Handlers         │
│ ├─ DisassemblyList/   │  db:get  │ │  ├─ db:* (SQLite CRUD) │
│ │  Detail             │  ai:chat │  │  ├─ settings:*        │
│ ├─ Workspace (核心)   │  file:*  │  │  ├─ ai:chat (DeepSeek)│
│ └─ SettingsPage       │  tokens:*│  │  ├─ file:* (读写/解析) │
│                       │          │  │  └─ tokens:* (统计)   │
│ Zustand Stores:       │          │  │                       │
│ ├─ projectStore       │          │  ├─ database.ts (sql.js) │
│ ├─ libraryStore       │          │  └─ preload.ts (桥接)    │
│ ├─ disassemblyStore   │          │                         │
│ └─ settingsStore      │          │  SQLite: %APPDATA%/     │
│                       │          │    novel-ai-writer/     │
│ Services:             │          │    data.db              │
│ ├─ generator.ts       │          │                         │
│ ├─ disassembler.ts    │          │  表:                    │
│ ├─ extractor.ts       │          │  - settings             │
│ ├─ deslop.ts          │          │  - style_libraries      │
│ └─ export.ts          │          │  - novel_projects       │
└──────────────────────┘          │  - outlines             │
                                  │  - detailed_outlines    │
                                  │  - chapters             │
                                  │  - context_state        │
                                  │  - disassembly_projects │
                                  │  - token_usage          │
                                  └─────────────────────────┘
```

---

## 关键技术细节

### DeepSeek API
- baseURL: `https://api.deepseek.com/v1`
- model: `deepseek-chat`
- 定价: 输入 ¥3/M, 输出 ¥6/M (缓存命中 ¥0.025/M)
- API Key 仅在主进程使用，通过 IPC `ai:chat` 代理
- 所有调用带 `purpose` 参数用于 Token 统计

### 数据库 (sql.js)
- WASM 实现，无需编译原生模块
- 同步 API，在主进程运行
- 每次写操作自动 `saveToDisk()`
- 表结构见 `docs/database-schema.md`

### 写作 Prompt 体系 (generator.ts)
- 基于 oh-story-claudecode 方法论重构
- 情绪驱动：先定情绪→匹配题材→设计故事
- 格式铁律：一句一段≤60字、段间不空行、对话独占行
- 禁用词库 50+ 项分5级毒级 (deslop.ts)
- 层级依赖生成：大纲→卷纲→章细纲→上一章正文

### 环境变量问题
- 系统全局 `ELECTRON_RUN_AS_NODE=1` 会导致 Electron 以 Node.js 模式运行
- 所有脚本需 `env -u ELECTRON_RUN_AS_NODE` 清除此变量

### 构建与运行
```bash
npm run dev      # 开发模式 (Vite + Electron)
npm run build    # 生产构建
npx electron-builder --win --dir  # 打包 (输出 release/win-unpacked/)
```

---

## 项目文件结构

```
novel-ai-writer/
├── electron/                # Electron 主进程
│   ├── main.ts              # 窗口 + 所有 IPC 处理器
│   ├── preload.ts           # contextBridge API 暴露
│   └── database.ts          # sql.js 封装 (8表)
├── src/                     # React 渲染进程
│   ├── App.tsx              # 路由配置
│   ├── main.tsx             # React 入口
│   ├── index.css            # Tailwind + 全局样式
│   ├── components/
│   │   ├── layout/          # AppLayout + Sidebar
│   │   ├── writing/         # Workspace (核心写作页)
│   │   │   ├── Workspace.tsx     # 三栏工作台 (主组件)
│   │   │   ├── DeslopPanel.tsx   # 去AI味面板
│   │   │   ├── ChapterList.tsx   # 左侧章节目录
│   │   │   ├── OutlineEditor.tsx # [旧] 已被 Workspace 替代
│   │   │   ├── DetailOutlineEditor.tsx # [旧]
│   │   │   ├── ChapterEditor.tsx # [旧]
│   │   │   └── PreparePage.tsx   # [旧]
│   │   ├── library/        # 风格库管理
│   │   ├── disassembly/    # 拆文库管理
│   │   ├── project/        # 项目列表
│   │   ├── settings/       # 设置页
│   │   └── common/         # Toast/Modal/InlineEdit/TokenMonitor/ReferenceSelector/GenConfigModal
│   ├── services/
│   │   ├── generator.ts    # 大纲/卷纲/细纲/章节生成 Prompt
│   │   ├── disassembler.ts # 拆文 6 阶段管线 Prompt
│   │   ├── extractor.ts    # 风格提取 Prompt
│   │   ├── deslop.ts       # 去AI味检测+改写
│   │   └── export.ts       # TXT/DOCX/PDF 导出
│   ├── store/              # Zustand 状态管理
│   └── types/              # TypeScript 类型定义
├── scripts/build-electron.mjs  # esbuild 编译 Electron 文件
├── docs/                   # 设计文档 (6份)
├── dev-logs/               # 开发日志
└── resources/icon.png      # 应用图标
```

---

## 数据库表速查

| 表 | 用途 |
|----|------|
| settings | 系统设置 (API Key 等) 以 key-value 存储 |
| style_libraries | 风格库 (name + style_profile JSON) |
| novel_projects | 小说项目 (title + primary_style_id + auxiliary_style_ids) |
| outlines | 大纲 (project_id + content) |
| detailed_outlines | 细纲 (project_id + chapters JSON) |
| chapters | 章节正文 (project_id + chapter_number + content + status) |
| context_state | 写作上下文 (character_state + plot_summary + last_chapter) |
| disassembly_projects | 拆文项目 (name + source_text + current_stage + stage_results) |
| token_usage | Token 用量记录 (purpose + prompt_tokens + output_tokens) |

---

## 未来工作

- [ ] 删除旧页面文件 (OutlineEditor/DetailOutlineEditor/ChapterEditor/PreparePage)
- [ ] 删除 DisassemblyList 和 LibraryList 中的死代码 handleRename
- [ ] 完善写作工作台：卷纲查看/编辑不完整
- [ ] 校对面板功能增强 (目前只做基础检查)
- [ ] Windows NSIS 安装包 (需要解决 winCodeSign 问题)
- [ ] 多个拆文库/风格库的交叉引用分析
- [ ] 章节预览/阅读模式
