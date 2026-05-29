# CLAUDE.md — AI 小说写作软件项目指引

## 项目概述

这是一个 Windows 桌面端 AI 小说写作软件，使用 Electron + React + TypeScript 构建，调用 DeepSeek API 驱动 AI 写作。目标用户是不懂代码的小说创作者。

## 标准文件路径

所有设计文档和规范存放在 `docs/` 目录下，开发过程中务必参照：

| 文档 | 路径 | 说明 |
|------|------|------|
| 需求规格 | [docs/requirements.md](docs/requirements.md) | 完整功能需求（FR-1 到 FR-6），含优先级 |
| 技术架构 | [docs/tech-stack.md](docs/tech-stack.md) | 技术选型、目录结构、数据流 |
| 设计规范 | [docs/design-spec.md](docs/design-spec.md) | 色彩、字体、布局、组件规范 |
| 数据库设计 | [docs/database-schema.md](docs/database-schema.md) | 7 张表的完整 SQL 和字段说明 |
| API 设计 | [docs/api-design.md](docs/api-design.md) | DeepSeek 调用方式 + 5 套 Prompt 模板 |
| 执行计划 | [docs/execution-plan.md](docs/execution-plan.md) | 分 6 个阶段的详细开发步骤 |

## 开发日志

每个开发日结束后，在 `dev-logs/` 目录下创建 `YYYY-MM-DD.md` 文件，记录：
- 本日完成事项
- 待办事项
- 遇到的问题
- 下一步计划

日志模板参考：[dev-logs/2026-05-29.md](dev-logs/2026-05-29.md)

## 工作原则

### 分阶段推进
- **严格按执行计划的 6 个阶段顺序开发**，每个阶段完成并验证后再进入下一阶段
- 每阶段内的步骤也逐步进行，不跳步
- 当前阶段：**第一阶段 — 项目骨架搭建**

### 代码规范
- 所有代码用 TypeScript，类型定义集中在 `src/types/index.ts`
- IPC 通信：渲染进程 → preload 暴露的 API → 主进程处理
- API Key 只在 Electron 主进程中使用，通过 IPC 代理 API 调用
- 组件遵循单一职责原则，UI 组件与服务逻辑分离
- 使用 Tailwind CSS 原子类，遵循 `docs/design-spec.md` 中的色彩和间距规范

### 验证要求
- 每个阶段末尾手动验证功能可用
- `npm run dev` 启动应用确认无报错
- 遇到问题先定位原因再修复，不跳过报错

### 保持项目整洁
- 新增文件放在正确的目录下
- 不要创建临时/测试文件后忘记清理
- 导入顺序：第三方库 → 项目内模块 → 类型

## 关键约定

1. **用户是编程小白**：所有交互文案用中文，报错信息友好易懂
2. **数据在本地**：不上传用户小说到任何云端（除 DeepSeek API 必要调用外）
3. **白色主题**：UI 主背景 #FFFFFF，强调色 #4A90D9
4. **DeepSeek API**：baseURL = `https://api.deepseek.com`，model = `deepseek-chat`
5. **API Key 安全**：存储在 SQLite，仅在主进程读取和调用，永不进入渲染进程
