# 正文注入分析报告 — 为什么越往后内容越短

## 每章 genChapter 注入清单（按行号）

### System Prompt（固定）
| 组件 | 来源 | 大小 | 变化 |
|------|------|------|:---:|
| CHAPTER_SYSTEM | generator.ts:557 | ~6K chars | 固定 |
| buildExecutionConstraints | 风格V4+人格V2 | ~2K chars | 固定 |

### User Prompt（动态）

| # | 组件 | 行号 | 来源 | 变化 | 问题 |
|---|------|------|------|:---:|------|
| 1 | stateContext | 1685 | buildStateContext | 固定 | — |
| 2 | CHAPTER_USER 基础 | 1686-1694 | plan字段 | **3000字目标** | — |
| 3 | canonFactsContext | 1529 | getChapterFacts | 稳定(~45条) | ✅ LIMIT 15+20+10 |
| 4 | infoPermissionContext | 1529 | getChapterFacts | ⚠️ **无 LIMIT！** | 🔴 所有 revealed_level<100 的事实全注入 |
| 5 | timeProgressionContext | 1542-1570 | allFacts 遍历 | ⚠️ **随时间增长** | 🟡 天数越多，时间敏感事实越多 |
| 6 | consistencyChecklist | 1576-1671 | 伏笔/冲突检查 | 稳定(~10行) | — |
| 7 | progressContext | 1700-1710 | chapters/volumes | ⚠️ **线性增长** | 🟡 章数越多，字符串越长 |
| 8 | buildMinimalContext | 1713-1734 | 角色+世界设定 | 稳定 | — |
| 9 | "重要要求" | 1736 | plan.estimated_words | 固定(~50字) | — |
| 10 | prevStateContext | 1496-1519 | chapter_fact_deltas | 稳定(~5角色) | — |
| 11 | prevSummaryContext | 1522-1526 | chapter_summaries | 稳定(~200字) | — |
| 12 | hint | 1695 | 用户输入 | 可为空 | — |

## 🔴 两个致命增长源

### 1. infoPermissionContext — 无 LIMIT
```sql
SELECT * FROM canon_facts 
WHERE revealed_level < 100 
AND volume_number IN (0, N)  -- 全局+当前卷
```
每提取一条事实（大纲提取22条，每章写入delta后聚合更多），这里就多一条。50章后可能有上百条。

### 2. timeProgressionContext — 随时间线性增长
```sql
-- 遍历 allFacts，找 details.established_day > 0 的
-- 每条输出：- [category] key：第 X 天记录 → 距今 Y 天。原文：...
```
第10章有5条时间记录，第50章可能有30条。

## 🟡 auto-continue 的阻塞问题

```javascript
setTimeout(async () => {
    await getChapterDeltasForChapter(id, chapNum, 3000)  // 等待 3 秒！
    await genSingleVolume()      // 可能需要 AI 调用 10-30 秒
    await genSingleChapterPlan() // 可能需要 AI 调用 5-10 秒
    genChapter(nextChapter)
}, 1500)
```

每章生成完后，auto-continue 等待总共 3~45 秒才开始下一章。期间取消按钮响应不及时（UI 线程被 setTimeout 阻塞）。

## 建议修复

### P0（直接导致内容变短的修复）
1. `infoPermissionContext` 加 LIMIT 30
2. `timeProgressionContext` 只取最近 15 条时间敏感事实
3. 删除刚加上的 15000 字符截断——它在裁掉上下文的同时也可能裁掉了关键写作指令

### P1（流程优化）
4. 删除 auto-continue 中的 `getChapterDeltasForChapter` 等待——让 genChapter 自己从 DB 读 delta，不等待
5. genSingleVolume/genSingleChapterPlan 保留（它们是必需的），但不做 DB 再验证（已在上层做过）
