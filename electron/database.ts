import initSqlJs, { Database, SqlJsStatic } from 'sql.js'
import { app } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'

let db: Database | null = null
let SQL: SqlJsStatic | null = null

/** 数据库文件路径 */
const DB_PATH = join(app.getPath('userData'), 'data.db')

/** 初始化数据库 */
export async function initDatabase(): Promise<void> {
  // 加载 sql.js WASM
  SQL = await initSqlJs()

  // 确保目录存在
  const dir = dirname(DB_PATH)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  // 从磁盘加载已有数据库，或创建新数据库
  if (existsSync(DB_PATH)) {
    const buffer = readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  // 创建表结构
  createTables()
  console.log('Database initialized:', DB_PATH)
}

/** 创建所有表 */
function createTables(): void {
  if (!db) throw new Error('Database not initialized')

  // 启用外键约束（CASCADE DELETE 依赖此设置）
  db.run('PRAGMA foreign_keys = ON')

  db.run(`
    -- 系统设置
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT ''
    );

    -- 风格库
    CREATE TABLE IF NOT EXISTS style_libraries (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      source_novel_title TEXT DEFAULT '',
      style_profile      TEXT NOT NULL DEFAULT '{}',
      created_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 小说项目
    CREATE TABLE IF NOT EXISTS novel_projects (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      title               TEXT NOT NULL,
      description         TEXT DEFAULT '',
      primary_style_id    INTEGER,
      auxiliary_style_ids TEXT DEFAULT '[]',
      settings            TEXT DEFAULT '{}',
      chapters_per_volume INTEGER DEFAULT 10,
      status              TEXT NOT NULL DEFAULT 'outline',
      created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (primary_style_id) REFERENCES style_libraries(id) ON DELETE SET NULL
    );

    -- 大纲
    CREATE TABLE IF NOT EXISTS outlines (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      content    TEXT NOT NULL DEFAULT '',
      version    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );

    -- 细纲
    CREATE TABLE IF NOT EXISTS detailed_outlines (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL UNIQUE,
      chapters   TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );

    -- 章节
    CREATE TABLE IF NOT EXISTS chapters (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id     INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      volume_number  INTEGER,
      title          TEXT NOT NULL DEFAULT '',
      content        TEXT NOT NULL DEFAULT '',
      word_count     INTEGER NOT NULL DEFAULT 0,
      status         TEXT NOT NULL DEFAULT 'draft',
      created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, chapter_number)
    );

    -- 卷纲
    CREATE TABLE IF NOT EXISTS volumes (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL,
      volume_number   INTEGER NOT NULL,
      title           TEXT NOT NULL DEFAULT '',
      theme           TEXT DEFAULT '',
      summary         TEXT DEFAULT '',
      detailed_summary TEXT DEFAULT '',
      chapter_range   TEXT NOT NULL DEFAULT '[0,0]',
      nodes           TEXT DEFAULT '[]',
      timeline_context TEXT DEFAULT '{}',
      chapter_summaries TEXT DEFAULT '[]',
      global_info_quota TEXT DEFAULT '',
      emotion_stage   TEXT DEFAULT '{}',
      volume_forbidden TEXT DEFAULT '[]',
      outline_version INTEGER DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );

    -- Token 用量记录
    CREATE TABLE IF NOT EXISTS token_usage (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      purpose        TEXT NOT NULL DEFAULT '',
      model          TEXT NOT NULL DEFAULT 'deepseek-chat',
      prompt_tokens  INTEGER NOT NULL DEFAULT 0,
      cached_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens  INTEGER NOT NULL DEFAULT 0,
      total_tokens   INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );
    CREATE INDEX IF NOT EXISTS idx_token_usage_date ON token_usage(created_at);

    -- 拆文项目
    CREATE TABLE IF NOT EXISTS disassembly_projects (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      source_text        TEXT NOT NULL DEFAULT '',
      total_chapters     INTEGER NOT NULL DEFAULT 0,
      current_stage      INTEGER NOT NULL DEFAULT 0,
      stage_results      TEXT NOT NULL DEFAULT '{}',
      created_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 设定库
    CREATE TABLE IF NOT EXISTS setting_libraries (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      source_text  TEXT NOT NULL DEFAULT '',
      setting_data TEXT NOT NULL DEFAULT '{}',
      created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 人格库
    CREATE TABLE IF NOT EXISTS personality_projects (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      source_text     TEXT NOT NULL DEFAULT '',
      personality_data TEXT NOT NULL DEFAULT '{}',
      created_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
    );

    -- 版本历史
    CREATE TABLE IF NOT EXISTS version_history (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id   INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      content_key  TEXT NOT NULL,
      version      INTEGER NOT NULL DEFAULT 1,
      content      TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    );
  `)

  // ━━━ 新数据库（v4.0 状态机架构）━━━

  // 核心状态表
  try {
    db.run(`CREATE TABLE IF NOT EXISTS story_tracker (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      tier TEXT NOT NULL,
      volume_number INTEGER DEFAULT 0,
      chapter_number INTEGER DEFAULT 0,
      tracker_type TEXT NOT NULL,
      tracker_key TEXT NOT NULL,
      importance TEXT DEFAULT 'minor',
      summary TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '{}',
      expected_state TEXT DEFAULT NULL,
      status TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE,
      UNIQUE(project_id, tier, volume_number, chapter_number, tracker_type, tracker_key)
    )`)
    db.run('CREATE INDEX IF NOT EXISTS idx_tracker_lookup ON story_tracker(project_id, tier, volume_number, chapter_number)')
    db.run('CREATE INDEX IF NOT EXISTS idx_tracker_type ON story_tracker(project_id, tracker_type, tier)')
  } catch {}

  // 状态迁移日志（只追加）
  try {
    db.run(`CREATE TABLE IF NOT EXISTS tracker_transitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      chapter_number INTEGER NOT NULL,
      tracker_key TEXT NOT NULL,
      tracker_type TEXT NOT NULL,
      old_state TEXT,
      new_state TEXT,
      transition_valid INTEGER DEFAULT 1,
      rule_violation TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    )`)
    db.run('CREATE INDEX IF NOT EXISTS idx_transitions ON tracker_transitions(project_id, tracker_key, chapter_number)')
  } catch {}

  // 卷检查报告
  try {
    db.run(`CREATE TABLE IF NOT EXISTS volume_check_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      volume_number INTEGER NOT NULL,
      results TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
    )`)
    db.run('CREATE INDEX IF NOT EXISTS idx_vcr ON volume_check_reports(project_id, volume_number)')
  } catch {}

  // 删除旧表（v3.x 遗留）
  const oldTables = [
    'canon_facts', 'canon_events', 'character_snapshots', 'cross_volume_checks',
    'auto_continue_queue', 'context_snapshots', 'correction_queue',
    'foreshadowing_registry', 'story_timeline', 'conflict_facts',
    'chapter_summaries', 'chapter_fact_deltas', 'context_state',
    'character_arc_log', 'relationship_timeline',
  ]
  for (const t of oldTables) {
    try { db.run(`DROP TABLE IF EXISTS ${t}`) } catch {}
  }

  // 插入默认设置
  db.run(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('api_key', '');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('api_base_url', 'https://api.deepseek.com');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('api_model', 'deepseek-v4-pro');
  `)

  saveToDisk()
}

/** 持久化到磁盘 */
function saveToDisk(): void {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  writeFileSync(DB_PATH, buffer)
}

/** 执行查询 (SELECT) */
export function query(sql: string, params?: any[]): any[] {
  if (!db) throw new Error('Database not initialized')
  const stmt = db.prepare(sql)
  if (params) stmt.bind(params)
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

/** 执行写操作 (INSERT/UPDATE/DELETE) */
export function run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number } {
  if (!db) throw new Error('Database not initialized')
  db.run(sql, params)
  saveToDisk()
  let lastId = 0
  try {
    const r = db.exec("SELECT last_insert_rowid() AS id")
    if (r.length > 0 && r[0].values.length > 0) lastId = r[0].values[0][0] as number || 0
  } catch {}
  if (lastId === 0 && sql.trim().toUpperCase().startsWith('INSERT')) {
    try {
      const m = sql.match(/INSERT\s+INTO\s+["'`]?(\w+)/i)
      if (m) {
        const r = db.exec(`SELECT MAX(id) AS mid FROM ${m[1]}`)
        if (r.length > 0 && r[0].values.length > 0) lastId = r[0].values[0][0] as number || 0
      }
    } catch {}
  }
  return {
    changes: db.getRowsModified(),
    lastInsertRowid: lastId,
  }
}

/** 查询单行 */
export function get(sql: string, params?: any[]): any | null {
  const rows = query(sql, params)
  return rows.length > 0 ? rows[0] : null
}

/** 关闭数据库 */
export function closeDatabase(): void {
  if (db) {
    saveToDisk()
    db.close()
    db = null
  }
}
