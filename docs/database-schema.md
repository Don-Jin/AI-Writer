# 数据库设计

## 技术说明

- 使用 **better-sqlite3**，同步 API，在主进程中运行
- 数据库文件存储在应用数据目录：`%APPDATA%/novel-ai-writer/data.db`
- 通过 Electron IPC 暴露给渲染进程调用

## 表结构

### 1. settings — 系统设置

```sql
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
```

| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT | 设置键（如 `api_key`、`data_path`） |
| value | TEXT | 设置值 |

预置记录：
- `api_key` → 空字符串（用户自行填写）
- `api_base_url` → `https://api.deepseek.com`
- `api_model` → `deepseek-chat`

---

### 2. style_libraries — 风格库

```sql
CREATE TABLE IF NOT EXISTS style_libraries (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT NOT NULL,              -- 风格库名称
    source_novel_title TEXT,                       -- 源小说标题
    style_profile      TEXT NOT NULL,              -- 风格分析结果 (JSON)
    created_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
```

| 字段 | 类型 | 说明 |
|------|------|------|
| id | INTEGER | 自增主键 |
| name | TEXT | 用户命名的风格库名称 |
| source_novel_title | TEXT | 源小说的标题（可选） |
| style_profile | TEXT (JSON) | AI 分析的风格画像 |
| created_at | TEXT | 创建时间 |

**style_profile JSON 结构**：

```json
{
  "writing_style": {
    "narrative_perspective": "第三人称限知视角",
    "sentence_characteristics": "短句为主，节奏紧凑",
    "pace": "快速推进，场景切换频繁"
  },
  "language_features": {
    "vocabulary_preference": "现代口语词汇，少用成语",
    "colloquial_level": "中等偏口语化",
    "literary_ratio": "白话为主，偶有书面语点缀"
  },
  "rhetoric": {
    "metaphor": "少量使用，多为科技类比喻",
    "parallelism": "很少使用",
    "symbolism": "经常使用物品象征",
    "other": []
  },
  "atmosphere": {
    "primary": "悬疑",
    "secondary": "紧张",
    "emotional_tone": "冷峻克制"
  },
  "sample_passages": [
    "从原文中提取的 3-5 个代表性段落，各 200-500 字"
  ],
  "raw_analysis": "AI 返回的完整分析原文"
}
```

---

### 3. novel_projects — 小说项目

```sql
CREATE TABLE IF NOT EXISTS novel_projects (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    title               TEXT NOT NULL,
    description         TEXT DEFAULT '',
    primary_style_id    INTEGER,                   -- 主风格库 ID
    auxiliary_style_ids TEXT DEFAULT '[]',          -- 辅风格库 ID 列表 (JSON 数组)
    status              TEXT NOT NULL DEFAULT 'outline',
    -- status: 'outline' | 'detailed_outline' | 'writing' | 'completed'
    created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (primary_style_id) REFERENCES style_libraries(id) ON DELETE SET NULL
);
```

---

### 4. outlines — 大纲

```sql
CREATE TABLE IF NOT EXISTS outlines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE,
    content    TEXT NOT NULL DEFAULT '',
    version    INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
```

---

### 5. detailed_outlines — 细纲

```sql
CREATE TABLE IF NOT EXISTS detailed_outlines (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL UNIQUE,
    chapters   TEXT NOT NULL DEFAULT '[]',          -- JSON 数组
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
```

**chapters JSON 结构**：

```json
[
  {
    "chapter_number": 1,
    "title": "第一章标题",
    "summary": "本章内容概要",
    "characters": ["出场人物A", "出场人物B"],
    "key_events": ["关键事件1", "关键事件2"],
    "estimated_words": 3000,
    "status": "pending"
  }
]
```

---

### 6. chapters — 章节正文

```sql
CREATE TABLE IF NOT EXISTS chapters (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL,
    chapter_number INTEGER NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    content        TEXT NOT NULL DEFAULT '',
    word_count     INTEGER NOT NULL DEFAULT 0,
    status         TEXT NOT NULL DEFAULT 'draft',
    -- status: 'draft' | 'generating' | 'generated' | 'edited'
    created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE,
    UNIQUE(project_id, chapter_number)
);
```

---

### 7. context_state — 上下文状态（长篇写作辅助）

```sql
CREATE TABLE IF NOT EXISTS context_state (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id     INTEGER NOT NULL UNIQUE,
    character_state TEXT NOT NULL DEFAULT '{}',     -- 人物状态表 (JSON)
    plot_summary    TEXT NOT NULL DEFAULT '',        -- 情节进展摘要
    last_chapter    INTEGER NOT NULL DEFAULT 0,      -- 最后生成的章节号
    updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
```

**character_state JSON 结构**：

```json
{
  "人物A": {
    "status": "存活",
    "location": "京城",
    "current_goal": "寻找失踪的师傅",
    "relationships": {
      "人物B": "同伴，互相信任",
      "人物C": "敌对，但暂时合作"
    },
    "last_appearance_chapter": 5
  }
}
```

## 索引

```sql
CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, chapter_number);
CREATE INDEX IF NOT EXISTS idx_style_libraries_name ON style_libraries(name);
CREATE INDEX IF NOT EXISTS idx_novel_projects_status ON novel_projects(status);
```

## 级联删除规则

- 删除项目 → 自动删除该项目的大纲、细纲、章节、上下文状态
- 删除风格库 → 引用该风格库的项目的 `primary_style_id` 设为 NULL
