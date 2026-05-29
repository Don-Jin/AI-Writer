# 开发执行计划

## 分阶段开发原则

1. **每阶段只做一件事**：完成并验证后再进入下一阶段
2. **每个阶段末尾做一次手动测试**：确保功能可用
3. **遇到问题先定位再修复**：不跳过任何报错
4. **代码逐步叠加**：新功能不破坏已有功能

---

## 第一阶段：项目骨架搭建

**目标**：在屏幕上看到一个可运行的空白窗口

### 步骤 1.1 — 初始化 npm 项目
- 创建 `package.json`
- 安装 Electron、React、TypeScript、Vite 等核心依赖
- 安装 Tailwind CSS 及相关 PostCSS 插件

### 步骤 1.2 — 配置构建工具链
- 创建 `vite.config.ts`（React 渲染进程）
- 创建 `tsconfig.json` / `tsconfig.node.json`
- 创建 `tailwind.config.js` / `postcss.config.js`

### 步骤 1.3 — 创建 Electron 主进程
- 编写 `electron/main.ts`：创建窗口、加载页面
- 编写 `electron/preload.ts`：安全的 IPC 桥接

### 步骤 1.4 — 创建 React 渲染进程
- 编写 `src/main.tsx`：React 入口
- 编写 `src/App.tsx`：路由配置
- 编写 `src/index.css`：Tailwind 入口
- 编写基础布局组件：`AppLayout.tsx`、`Sidebar.tsx`

### 步骤 1.5 — 验证
- `npm run dev` 启动应用
- 确认窗口正常打开，侧边栏+主内容区布局正常

**预计文件**：~12 个
**完成标志**：白色窗口正常显示，左侧有导航栏，点击可切换页面

---

## 第二阶段：数据库层 + 设置页

**目标**：SQLite 数据库可读写，设置页可配置 API Key

### 步骤 2.1 — 数据库模块
- 编写 `electron/database.ts`：初始化 SQLite、创建表结构
- 在 `main.ts` 中注册 IPC 处理函数

### 步骤 2.2 — 类型定义
- 编写 `src/types/index.ts`：所有共享类型

### 步骤 2.3 — Zustand Store
- 编写 `src/store/settingsStore.ts`
- 编写 `src/store/libraryStore.ts`
- 编写 `src/store/projectStore.ts`

### 步骤 2.4 — 设置页面
- 编写设置页组件（API Key 配置）
- 实现 IPC 调用保存/读取设置

### 步骤 2.5 — 验证
- 在设置页输入 API Key，重启应用后确认 Key 仍在

**预计文件**：~8 个
**完成标志**：设置页可配置 API Key，数据持久化到 SQLite

---

## 第三阶段：风格库功能

**目标**：可导入小说文件，AI 提取风格，保存为风格库

### 步骤 3.1 — 文件导入
- 实现 TXT 文件读取（通过 Electron dialog + fs）
- 实现 DOCX 解析（mammoth.js）
- 实现 PDF 解析（pdf-parse）
- 支持粘贴文本

### 步骤 3.2 — DeepSeek API 封装
- 编写 `src/services/deepseek.ts`
- 在 `electron/main.ts` 中注册 API 调用的 IPC 处理
- 确保 API Key 只在主进程中使用，不暴露到渲染进程

### 步骤 3.3 — 风格提取 Prompt
- 编写 `src/services/extractor.ts`
- 设计风格提取的 System Prompt + User Prompt 模板
- 多次测试调优 Prompt 效果

### 步骤 3.4 — 风格库 UI
- `LibraryList.tsx`：风格库列表
- `LibraryImport.tsx`：导入弹窗（文件/粘贴）
- `LibraryDetail.tsx`：风格库详情查看

### 步骤 3.5 — 验证
- 导入一本小说 → AI 分析 → 保存风格库 → 列表展示

**预计文件**：~10 个
**完成标志**：能导入小说、调用 AI 提取风格、列表查看风格库

---

## 第四阶段：小说项目管理

**目标**：可创建项目、列表展示、选择风格库

### 步骤 4.1 — 项目 Store 完善
- 实现项目的 CRUD IPC 调用

### 步骤 4.2 — 项目 UI
- `ProjectList.tsx`：首页，展示所有项目卡片
- `CreateProject.tsx`：新建项目弹窗（书名、简介、风格选择）

### 步骤 4.3 — 验证
- 新建项目 → 选择风格 → 在列表中看到

**预计文件**：~5 个
**完成标志**：首页可创建和管理项目

---

## 第五阶段：写作流程

**目标**：完整的大纲→细纲→章节写作流程

### 步骤 5.1 — Prompt 模板
- 编写 `src/services/generator.ts`
- 大纲生成 Prompt
- 细纲生成 Prompt
- 章节生成 Prompt（含上下文管理）

### 步骤 5.2 — 大纲编辑
- `OutlineEditor.tsx`：生成按钮 + 编辑区

### 步骤 5.3 — 细纲编辑
- `DetailOutlineEditor.tsx`：章节列表 + 可拖拽排序 + 编辑

### 步骤 5.4 — 章节编辑器
- `ChapterEditor.tsx`：主编辑区
- `ChapterList.tsx`：章节导航侧边栏
- 上下文管理：人物状态表、情节摘要

### 步骤 5.5 — 验证
- 创建项目 → 大纲生成 → 细纲生成 → 生成第 1 章 → 生成第 2 章

**预计文件**：~8 个
**完成标志**：完整走通大纲→细纲→3 章的生成流程

---

## 第六阶段：导出与打包

**目标**：可导出文档，可打包为 .exe

### 步骤 6.1 — 导出功能
- 编写 `src/services/export.ts`
- TXT 导出
- DOCX 导出（含目录）
- PDF 导出

### 步骤 6.2 — 导出 UI
- 导出按钮 + 格式选择弹窗

### 步骤 6.3 — 打包配置
- 编写 `electron-builder.yml`
- 配置 Windows NSIS 安装程序

### 步骤 6.4 — 最终测试
- 完整流程测试
- 边界情况测试（空状态、错误处理等）
- Bug 修复

**完成标志**：生成 Windows .exe 安装包，可安装运行
