# 分层事实更新链条 + 进度上下文系统

## 当前实现 vs 理想状态

### 已实现

| 阶段 | 动作 | 状态 |
|------|------|------|
| 大纲生成 | CANON_EXTRACTION → global facts (vol=0) | ✅ |
| 卷纲生成 | — | ❌ 未写入 volume_summary |
| 正文生成 | chapter deltas (emotion/location/relationship) | ✅ |
| 卷结束 | aggregateVolumeDeltas → 下一卷 canon_facts | ✅ |

### 缺失

| 阶段 | 应做什么 | 效果 |
|------|---------|------|
| 大纲生成 | +提取分卷概要 → volume_summary facts (vol=1..N) | 为每卷创建种子事实 |
| 卷纲生成 | +基于卷概要提取本卷角色/设定 → vol=N facts | 卷级事实初始化 |
| 正文时 | +进度上下文注入 | AI 知道写到哪了 |

---

## 理想链条

```
大纲 → 提取 global_facts (vol=0) + volume_summaries (vol=1..67)
         │
卷纲1 → 基于 vol1_summary 提取卷级 facts (vol=1)
         │
章1→10 → 每章 delta → 注入 vol=1 facts + 最新 delta
         │
卷1结束 → aggregateVolumeDeltas(1) → vol=2 facts 更新
         │
卷纲2 → 基于 vol2_summary + 聚合后的 vol2 facts → 精炼卷级 facts
         │
章11→20 → 注入 vol=2 facts + 最新 delta
         ...
```

---

## 进度上下文注入

在正文生成时，注入类似这样的上下文块：

```
【进度上下文】
第二卷进行中（第11-20章，共67卷）
最后完成：第15章
总进度：15/670章
累计字数：约45,000字

本卷弧线：
011-013：地下世界·初探（入口→规则→遭遇）
014-015：暗门计划·启动（线索→决心）
016-020(待写)：建造者之路（启程→维度→过渡→裂缝→修复之后）

全局进度：22%（15/670），预计还需约196.5万字
```

数据来源：
- 卷范围：volumes 表
- 已完成章数：chapters WHERE status != 'draft'
- 累计字数：SUM(word_count)
- 弧线信息：volume_summary facts (可人工编辑)

---

## 实施计划

### 1. 大纲提取增强 (genOutline 后台任务)

改进 CANON_EXTRACTION 或在事实簿提取后，额外提取分卷概要：

```
CANON_EXTRACTION → global facts (已有)
  +
新增: 分析大纲中的分卷结构，提取 volume_summaries:
  → upsertFact(category='volume_summary', volume_number=N, value='第N卷概要...')
```

### 2. 进度上下文函数

```typescript
async function buildProgressContext(projectId) {
  const volumes = await db.query('SELECT * FROM volumes ORDER BY volume_number')
  const totalChapters = volumes.reduce((sum, v) => sum + (v.chapter_range[1] - v.chapter_range[0] + 1), 0)
  const doneChapters = await db.query(
    "SELECT COUNT(*) as cnt FROM chapters WHERE project_id=? AND status != 'draft'", [projectId]
  )
  const wordCount = await db.query(
    "SELECT COALESCE(SUM(word_count),0) as total FROM chapters WHERE project_id=?", [projectId]
  )
  
  const curVol = volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
  // 读取 volume_summary facts 获取弧线信息
  
  return `【进度上下文】
第${curVol.volume_number}卷进行中
最后完成：第${chapNum-1}章
总进度：${doneChapters}/${totalChapters}章
累计字数：约${wordCount}字
...`
}
```

### 3. 注入位置

在 genChapter 的 userPrompt 末尾追加，每次生成都知道进度。

---

## 需要加吗？

- 进度上下文：**值得加**，对 AI 写作方向有帮助（知道写到哪了，还剩多少）
- 大纲→分卷事实：**应该加**，为每卷提供种子事实，卷纲生成时可以基于这些事实
- 卷纲→卷事实：**已有基础**（genSingleVolume 的角色弧线提取到 canon_facts），但 volume_number 参数需要确保正确传递
