# 分层事实注入方案：卷级 + 章级 + 全局级

## 当前问题

```
genChapter(N) 调用 getChapterFacts(projectId)
  → SELECT * FROM canon_facts WHERE is_hard_rule=1  ← 全项目所有硬规则
  → SELECT * FROM canon_facts WHERE revealed_level<100  ← 全项目所有信息权限
  → 无截断，200万字后可能膨胀到 5000+ tokens
```

## 设计：三层事实注入

```
┌──────────────────────────────────────────────┐
│ 全局层 (volume_number=0)                      │
│ 核心世界观、基础规则、主角人设                  │
│ 每章必注入，数量少（通常<15条）                 │
├──────────────────────────────────────────────┤
│ 卷级层 (volume_number=N)                      │
│ 本卷特有设定、本卷角色状态、本卷事件            │
│ 仅在所属卷的章节中注入                          │
│ 卷结束时从 chapter_deltas 聚合更新              │
├──────────────────────────────────────────────┤
│ 章级层 (chapter_fact_deltas)                  │
│ 本章情感变化、位置移动、关系更新、新信息揭示     │
│ 每章生成后自动写入，轻量注入（单章<500 tokens）  │
│ 卷结束时被聚合到卷级层                          │
└──────────────────────────────────────────────┘
```

## 一、数据库改动

### 1.1 canon_facts 新增字段

```sql
ALTER TABLE canon_facts ADD COLUMN volume_number INTEGER DEFAULT 0;
-- 0=全局，正整数=所属卷号
CREATE INDEX idx_cf_volume ON canon_facts(project_id, volume_number);
```

### 1.2 新表：chapter_fact_deltas

```sql
CREATE TABLE chapter_fact_deltas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  chapter_number INTEGER NOT NULL,
  character_name TEXT NOT NULL,
  delta_type TEXT NOT NULL,
  delta_value TEXT NOT NULL,
  applied_to_canon INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (project_id) REFERENCES novel_projects(id) ON DELETE CASCADE
);
CREATE INDEX idx_cfd ON chapter_fact_deltas(project_id, chapter_number, applied_to_canon);
```

### 1.3 novel_projects 新增卷规划字段

```sql
ALTER TABLE novel_projects ADD COLUMN chapters_per_volume INTEGER DEFAULT 10;
```

## 二、注入逻辑改造

### 2.1 canonService.getChapterFacts 改为分层查询

```
getChapterFacts(projectId, chapterNumber)

1. 确定当前卷号 (从 chapters.volume_number 或 volumes 表)
2. 查询全局层: WHERE volume_number=0 AND is_hard_rule=1  → hardRules_global
3. 查询卷级层: WHERE volume_number=当前卷号 AND is_hard_rule=1 → hardRules_volume
4. 查询章级层: chapter_fact_deltas WHERE chapter_number=当前章 → chapterDeltas
5. 合并: hardRules = hardRules_global + hardRules_volume + "[本章动态]" + chapterDeltas
6. infoPermissions 同理：只查 volume_number IN (0, 当前卷号)

Token 估算:
- 全局: ~15条 × 30字 = ~600 tokens
- 卷级: ~20条 × 30字 = ~800 tokens
- 章级: ~8条 × 40字 = ~400 tokens
- 总计: ~1800 tokens（远小于原来的无上限）
```

### 2.2 章级 delta 自动写入

genChapter 后台任务中，在 checker 和 summary 完成后：

```
从记录官数据提取本章变化:
  character_changes (情感/状态) → delta_type=emotion/status
  locations (位置) → delta_type=location
  relationship_changes (关系) → delta_type=relationship
  事件提取中的 revealed_info → delta_type=revealed_info

写入 chapter_fact_deltas:
  INSERT (project_id, chapter_number, character_name, delta_type, delta_value)
```

### 2.3 卷级事实更新（卷结束时）

新函数 `aggregateVolumeDeltas(projectId, volumeNumber)`:

```
1. 读取 chapter_fact_deltas WHERE applied_to_canon=0 AND chapter_number 在卷范围内
2. 按角色聚合:
   - 情感变化: 取最后一次 → 更新 canon_facts.details.emotion
   - 位置变化: 取最后一次 → 更新 canon_facts.details.location
   - 关系变化: 合并 → 更新 canon_facts.details.relationships
   - 状态变化: 取最后一次 → 更新 canon_facts.details.current_status
3. 为新出现的角色/设定创建 canon_facts (volume_number=当前卷号)
4. 标记 applied_to_canon=1
```

## 三、200万字小说卷章规划

### 3.1 10章/卷 vs 5章/卷

| | 10章/卷 | 5章/卷 |
|---|---|---|
| 总卷数 (667章) | 67卷 | 133卷 |
| 卷内字数 | ~30,000 | ~15,000 |
| 叙事弧线 | 完整的小故事弧 | 半个弧就被截断 |
| genSingleVolume 开销 | 67次 | 133次（2倍） |
| 事实聚合时机 | 每30000字更新一次 | 每15000字更新一次 |
| 角色弧线粒度 | 充分，每卷有足够空间发展 | 太细碎，弧线被频繁打断 |
| 推荐 | ✅ | ❌ |

**结论：10章/卷**。每卷 ~3 万字构成一个完整叙事单元。67 卷总量可控。

### 3.2 大纲系统改造

当前大纲是一段自由文本。对于 200 万字巨量，需要三层结构：

```
大纲（宏观，1份）
  │
  ├─ 卷纲（中观，67份）
  │   ├─ 第1卷: 章1-10 概要 + 角色弧线 + 情感曲线 + 禁区
  │   ├─ 第2卷: 章11-20 ...
  │   └─ ...
  │
  └─ 细纲（微观，667份）
      ├─ 第1章: plot_beats + forbidden + emotion_cap + ...
      └─ ...
```

### 3.3 大纲生成改造

**改动1：大纲 prompt 适配超长篇**

OUTLINE_SYSTEM 中增加：
- 提示总目标字数，要求规划分卷数量
- 输出分卷概要列表（每卷 50-100 字描述）
- 标注关键转折点（每 5-7 卷一个大高潮）

**改动2：卷纲自动计算章节范围**

genSingleVolume 改为：
```typescript
const chaptersPerVolume = project.settings?.chapters_per_volume || 10
const startChapter = prevVol ? prevVol.chapter_range[1] + 1 : 1
const endChapter = startChapter + chaptersPerVolume - 1
```

不再硬编码 `prevVol.chapter_range[1] + 10`，改用可配置参数。

**改动3：卷纲自动生成时同步创建下一卷事实层**

genSingleVolume 完成后：
1. 调用 `aggregateVolumeDeltas` 聚合上一卷的变化
2. 将新生成卷纲中的角色/设定写入 canon_facts（volume_number=新卷号）

这样下一卷的章节自动获得更新后的事实。

### 3.4 项目设置存储

```json
// novel_projects.settings
{
  "chapters_per_volume": 10,
  "auto_stop_on_plot_deviation": false
}
```

创建项目时默认 10，可在设置中修改。

## 四、注入格式设计

```
【全局设定】
- 主角程澈：前特种兵，现为大学保安
...

【第2卷设定】
- 反派凌瑶已暴露身份
- 暗门计划进入第二阶段
...

【本章动态】
- 程澈：情绪 好奇→警惕（原因：发现暗门后凌瑶的痕迹）
- 程澈：位置 教学楼→地下实验室
- 凌瑶：揭示 她的真实目的是寻找父亲留下的代码门
```

## 五、实施计划

### Phase 1：数据库（基础设施）
1. canon_facts 添加 volume_number 列 + 索引
2. 创建 chapter_fact_deltas 表
3. novel_projects 添加 chapters_per_volume (default 10)
4. 现有 fact 迁移：volume_number=0

### Phase 2：大纲系统适配
1. OUTLINE_SYSTEM 增加 200w 字规划提示
2. genSingleVolume 使用 chapters_per_volume 计算范围
3. genSingleVolume 完成后触发 aggregateVolumeDeltas
4. 卷纲自动写入本卷事实到 canon_facts

### Phase 3：分层注入核心
1. 改造 getChapterFacts：按 volume_number 分层查询
2. 改造 getActiveFacts：支持 volume_number 过滤
3. genChapter 中 canonFactsContext 使用新格式

### Phase 4：章级 delta + 卷级聚合
1. genChapter 后台任务提取本章变化 → chapter_fact_deltas
2. 新增 aggregateVolumeDeltas 函数
3. 在 runCrossVolumeCheck 中集成

### Phase 5：UI
1. CanonFactPanel 增加卷筛选
2. 项目设置中可配置 chapters_per_volume
3. delta 查看面板
