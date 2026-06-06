# 大纲修复 + 跨层级 Delta 读取计划

## 一、大纲生成失败诊断

### 当前流程
```
genOutline() → OUTLINE_USER(title, description, prepareContent, '', disassembly, settingLib, undefined, cardContext)
            → aiChat([{system: OUTLINE_SYSTEM}, {user: userPrompt}], '大纲生成')
            → reply → saveOutline(reply) → showToast('success')
```

### 可能原因

1. **AI API 超时**：OUTLINE_SYSTEM 约 2000 tokens + userPrompt 可能 3000+ tokens，加上 disassembly/setting/card context 可能超过 8000 tokens。非流式调用 `aiChat` 可能超时。

2. **上下文过长**：cardContext 从 `getRefs()` 读取全项目 `is_hard_rule=1` 的事实，没有截断。对于已有数据的项目，可能很长。

### 修复

1. `cardContext` 在大纲中截断到 2000 字（当前无截断）
2. 大纲的 `aiChat` 改为流式或增大超时

---

## 二、跨层级 Delta 读取方案

### 核心问题

生成链条中，下游的生成应该看到上游的最新状态：

```
genChapter(N) → delta写入DB (异步背景任务)
   ↓ 需要等待
genSingleChapterPlan(N+1) → 应读取第N章的delta
   ↓
genChapter(N+1) → 应读取第N章及之前未聚合的delta
```

当前 `genSingleChapterPlan` 只读 `prevChapter.content.slice(-400)`，不读 delta。

### 方案：带重试的 Delta 读取

在 `canonService` 中添加：

```typescript
/** 读取指定章节的delta，支持等待 */
export async function getChapterDeltasForChapter(projectId, chapterNum, maxWaitMs=5000) {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const deltas = await db().query(
      `SELECT * FROM chapter_fact_deltas 
       WHERE project_id=? AND chapter_number=?`,
      [projectId, chapterNum]
    )
    if (deltas.length > 0) return deltas
    await new Promise(r => setTimeout(r, 500))
  }
  return []
}
```

### genSingleChapterPlan 改造

在现有 `prevContext` 中加入上一章的 delta：

```
【上一章结束时角色状态】
- 程澈：情绪=紧张，位置=地下实验室
- 凌瑶：揭示「暗门是父亲设计的」
```

数据来源：`getChapterDeltasForChapter(projectId, chapNum-1)`，等待最多 5 秒。

### genOutline 改造

大纲阶段无前章 delta，但应读取：
1. 全局事实（已有，截断 2000 字）
2. 如果已有 volume_summary 事实（从旧大纲），一并注入

### 自动续写链条改造

```
genChapter(N) 完成
  │
  ├─ 1.5s 延迟（原来就有）
  ├─ 等待 delta 写入（新增：最多等 3 秒）
  │   └─ getChapterDeltasForChapter(projectId, N, 3000)
  │
  ├─ genSingleChapterPlan(N+1)
  │   └─ 读取上一章 delta（getChapterDeltasForChapter，最多5秒）
  │
  └─ genChapter(N+1)
      └─ getChapterFacts 自动读取最近10条未聚合delta（已修复）
```

## 三、实施清单

| # | 改动 | 文件 | 效果 |
|---|------|------|------|
| 1 | cardContext 截断 2000字 | Workspace.tsx genOutline | 防超时 |
| 2 | outline aiChat 改流式 | Workspace.tsx genOutline | 防超时 |
| 3 | 新增 getChapterDeltasForChapter | canonService.ts | 带重试读取 |
| 4 | genSingleChapterPlan 注入 prevDelta | Workspace.tsx | 细纲看到上一章状态 |
| 5 | 自动续写加 delta 等待 | Workspace.tsx | 确保写入完成再继续 |
