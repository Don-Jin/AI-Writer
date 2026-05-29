# 技术栈与架构设计

## 技术选型

| 层级 | 技术 | 版本要求 | 选型理由 |
|------|------|----------|----------|
| 桌面框架 | Electron | ^28.0.0 | Windows 桌面应用首选，生态成熟 |
| 构建工具 | Vite | ^5.0.0 | 快速 HMR，TypeScript 原生支持 |
| 前端框架 | React | ^18.2.0 | 组件化开发，社区活跃 |
| 类型系统 | TypeScript | ^5.3.0 | 类型安全，减少运行时错误 |
| UI 样式 | Tailwind CSS | ^3.4.0 | 原子化 CSS，快速构建白色主题 |
| 状态管理 | Zustand | ^4.4.0 | 轻量级，API 简洁 |
| 本地数据库 | better-sqlite3 | ^9.4.0 | 同步 API，适合 Electron 主进程 |
| AI SDK | openai (兼容 SDK) | ^4.20.0 | DeepSeek API 兼容 OpenAI 格式 |
| 文件解析 | mammoth.js | ^1.6.0 | 解析 DOCX 文件 |
| 文件解析 | pdf-parse | ^1.1.0 | 解析 PDF 文件 |
| 文档导出 | docx | ^8.5.0 | 生成 DOCX 文件 |
| 文档导出 | jspdf | ^2.5.0 | 生成 PDF 文件 |
| 打包工具 | electron-builder | ^24.9.0 | 打包 Windows .exe |

## 架构概览

```
┌──────────────────────────────────────────────┐
│                 Electron 主进程                │
│  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ 窗口管理  │  │ IPC 通信  │  │ SQLite DB  │  │
│  │ (main.ts) │  │(preload) │  │(database)  │  │
│  └──────────┘  └──────────┘  └────────────┘  │
├──────────────────────────────────────────────┤
│              IPC Bridge (安全隔离)             │
├──────────────────────────────────────────────┤
│              Electron 渲染进程 (React)         │
│  ┌──────────────────────────────────────┐     │
│  │             React Router              │     │
│  ├────────┬────────┬────────┬──────────┤     │
│  │ 项目列表 │ 风格库  │ 写作页  │ 设置页   │     │
│  ├────────┴────────┴────────┴──────────┤     │
│  │          Zustand Store              │     │
│  ├─────────────────────────────────────┤     │
│  │          Services Layer             │     │
│  │  (DeepSeek API / Export / Parse)    │     │
│  └─────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

## 项目目录结构

```
novel-ai-writer/
├── electron/                    # Electron 主进程
│   ├── main.ts                  # 应用入口，窗口创建
│   ├── preload.ts               # contextBridge 安全暴露 API
│   └── database.ts              # SQLite 初始化 + CRUD 操作
├── src/                         # React 渲染进程
│   ├── main.tsx                 # React 入口
│   ├── App.tsx                  # 路由配置
│   ├── index.css                # Tailwind 入口
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx    # 主布局（侧边栏+内容）
│   │   │   ├── Sidebar.tsx      # 左侧导航
│   │   │   └── Header.tsx       # 顶部标题栏
│   │   ├── library/
│   │   │   ├── LibraryList.tsx  # 风格库列表
│   │   │   ├── LibraryImport.tsx # 导入小说弹窗
│   │   │   └── LibraryDetail.tsx # 风格库详情
│   │   ├── project/
│   │   │   ├── ProjectList.tsx  # 项目列表（首页）
│   │   │   └── CreateProject.tsx # 新建项目弹窗
│   │   ├── writing/
│   │   │   ├── OutlineEditor.tsx # 大纲编辑
│   │   │   ├── DetailOutlineEditor.tsx # 细纲编辑
│   │   │   ├── ChapterEditor.tsx # 章节编辑器
│   │   │   └── ChapterList.tsx   # 章节列表侧边栏
│   │   └── common/
│   │       ├── Button.tsx
│   │       ├── Modal.tsx
│   │       ├── Loading.tsx
│   │       └── Toast.tsx
│   ├── services/
│   │   ├── deepseek.ts          # DeepSeek API 客户端
│   │   ├── extractor.ts         # 风格提取 Prompt 模板
│   │   ├── generator.ts         # 大纲/细纲/章节生成 Prompt
│   │   └── export.ts           # 导出逻辑
│   ├── store/
│   │   ├── libraryStore.ts     # 风格库状态
│   │   ├── projectStore.ts     # 项目状态
│   │   └── settingsStore.ts    # 设置状态
│   └── types/
│       └── index.ts            # 共享类型定义
├── resources/                   # 静态资源
│   └── icon.png                 # 应用图标
├── docs/                        # 项目文档
├── dev-logs/                    # 开发日志
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── electron-builder.yml        # 打包配置
```

## 数据流

```
用户操作 → React 组件 → Zustand Store → IPC 调用 → Electron 主进程
                                                          ↓
用户看到 ← React 重新渲染 ← Store 更新 ← IPC 返回 ← SQLite / DeepSeek API
```

- **本地数据**：通过 IPC 从渲染进程调用主进程的 database 方法
- **AI 调用**：从渲染进程通过 IPC 调用主进程，主进程发起 HTTP 请求至 DeepSeek API（保护 API Key 不暴露到渲染进程）
