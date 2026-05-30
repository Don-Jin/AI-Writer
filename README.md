# AI 小说写作软件

一款 Windows 桌面 AI 小说写作工具，基于 Electron + React + TypeScript 构建，调用 DeepSeek API 驱动 AI 辅助长篇小说创作。

## 核心功能

- **风格库**：导入小说 → AI 分析写作风格 → 保存为可复用模板
- **拆文库**：深度拆解爆款小说（6 阶段管线：概要→黄金三章→逐章摘要→聚合分析→文风→汇总报告）
- **写作工作台**：三栏布局（章节目录 + 正文编辑 + 工具面板）
  - 情绪驱动选题：先定情绪目标 → 匹配题材 → 设计故事
  - 卷纲 + 细纲：按卷组织章节，每章独立生成细纲
  - 逐章生成：层级依赖（大纲→卷纲→章细纲→上一章正文），确保连贯
  - 去 AI 味：Gate 检测 + 自然改写
- **导出**：TXT / Word / PDF
- **Token 监控**：侧边栏实时显示 API 用量和费用

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 前端 | React 18 + TypeScript + Tailwind CSS |
| 状态管理 | Zustand |
| 数据库 | SQLite (sql.js) |
| AI API | DeepSeek (兼容 OpenAI SDK) |
| 文档处理 | mammoth.js / pdf-parse / docx / jsPDF |
| 构建 | Vite + esbuild + electron-builder |

## 快速开始

### 1. 安装依赖

```bash
npm install
```

如果 Electron 二进制下载失败（国内常见问题），手动下载：

```bash
# 设置国内镜像加速 npm 包下载
npm config set registry https://registry.npmmirror.com

# 安装依赖
npm install

# Electron 二进制需从 GitHub 下载，失败则手动下载解压
curl -L -o /tmp/electron.zip "https://github.com/electron/electron/releases/download/v28.3.3/electron-v28.3.3-win32-x64.zip"
rm -rf node_modules/electron/dist
unzip /tmp/electron.zip -d node_modules/electron/dist/
printf "electron.exe" > node_modules/electron/path.txt
```

### 2. 配置 API Key

启动应用后，进入「设置」页面，输入 DeepSeek API Key。

获取 Key：[platform.deepseek.com](https://platform.deepseek.com)

### 3. 启动开发模式

```bash
npm run dev
```

### 4. 打包

```bash
npm run build && npx electron-builder --win --dir
```

打包输出在 `release/win-unpacked/`。

## 项目结构

```
novel-ai-writer/
├── electron/           # Electron 主进程
│   ├── main.ts         # 窗口 + IPC + AI 调用
│   ├── preload.ts      # 安全 API 桥接
│   └── database.ts     # SQLite 封装
├── src/                # React 渲染进程
│   ├── components/     # UI 组件
│   │   ├── layout/     # 布局（侧边栏）
│   │   ├── writing/    # 写作工作台
│   │   ├── library/    # 风格库
│   │   ├── disassembly/# 拆文库
│   │   ├── project/    # 项目管理
│   │   ├── settings/   # 设置
│   │   └── common/     # 通用组件
│   ├── services/       # 业务逻辑
│   │   ├── generator.ts   # 生成 Prompt
│   │   ├── disassembler.ts# 拆文 Prompt
│   │   ├── extractor.ts   # 风格提取 Prompt
│   │   ├── deslop.ts      # 去 AI 味
│   │   └── export.ts      # 导出
│   ├── store/          # Zustand 状态
│   └── types/          # TypeScript 类型
├── docs/               # 设计文档
├── scripts/            # 构建脚本
└── dev-logs/           # 开发日志
```

## License

MIT
