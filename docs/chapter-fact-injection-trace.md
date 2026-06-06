# 正文事实注入路径验证

## 调用链

```
genChapter(chapNum=N)
  │
  ├─ line 1495: canonService.getChapterFacts(projectId, N)
  │   │
  │   ├─ 1. 确定 volumeNumber (从 chapters.volume_number 或 volumes 表)
  │   ├─ 2. 全局层: canon_facts WHERE vol=0, is_hard=1 LIMIT 15
  │   ├─ 3. 卷级层: canon_facts WHERE vol=volumeNumber, is_hard=1 LIMIT 20
  │   ├─ 4. 章级层: chapter_fact_deltas WHERE chapter=N-1, applied_to_canon=0 LIMIT 10
  │   └─ 5. infoPermissions: canon_facts WHERE vol IN(0,volumeNumber), revealed<100
  │
  ├─ line 1643: canonFactsContext → CHAPTER_USER(param14)
  │             infoPermissionContext → userPrompt 末尾追加
  │
  └─ 正文生成完成 → 背景任务写入 chapter_fact_deltas (line ~2090)
       │           → aggregateVolumeDeltas 在 genSingleVolume 后调用
```

## 验证：随章节生成更新

| 章节 | 全局层 | 卷级层 | 章级(delta) | 说明 |
|------|--------|--------|-------------|------|
| 第1章 | 大纲提取的全局事实(vol=0) | — (vol=1尚未生成) | 无(无前章) | ✅ 正常 |
| 第2章 | 同上 | — | 读取第1章delta | ⚠️ 第1章背景任务可能未完成 |
| 第3-10章 | 同上 | genSingleVolume后写入vol=1事实 | 读取前章delta | ⚠️ 存在时序问题 |
| 第11章 | 同上 | vol=2事实(由vol=1聚合而来) | 读取第10章delta | ⚠️ 时序 |

## 🔴 发现：章级delta时序竞争

自动续写链条: `genChapter(N) → setTimeout 1.5s → genChapter(N+1)`

但delta写入在后台任务`;(async () => {...})()`中，与genChapter并行执行。

**当genChapter(N+1)调用getChapterFacts时，genChapter(N)的delta可能尚未写入。**

这意味着`chapter_fact_deltas WHERE chapter_number=N AND applied_to_canon=0`返回空。

## 🟡 发现：allFacts查询无分层

第1499-1503行：`SELECT * FROM canon_facts WHERE project_id = ?` 查询**全部**事实（用于buildMinimalContext和时间推移），没有按volume_number过滤。但buildMinimalContext内部有截断，所以影响有限。

## ✅ 确认：卷级事实的更新路径

```
genSingleVolume(1) → 写入vol=1事实 → 第1-10章可用
genChapter(1→10) → 每章写入delta → applied_to_canon=0
genSingleVolume(2) → aggregateVolumeDeltas(1) → 标记applied_to_canon=1 → 写入vol=2事实
genChapter(11→20) → 每章注入vol=2事实 + 新delta
```

卷级事实的更新路径完整，但**章级delta存在1-2章的延迟**。
