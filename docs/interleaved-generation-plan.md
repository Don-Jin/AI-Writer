# 交错生成修改计划：「细纲-正文」穿插模式

## 现状

当前流程（批量模式）：

```
genDetailOutline(volNumber)
  → 批量生成该卷所有章的细纲（一次性）
  → genChapter(1) → genChapter(2) → ... → genChapter(N)
```

问题：生成第 5 章细纲时，第 4 章的实际正文还不存在，AI 只能基于第 4 章的**细纲计划**猜测上下文。

## 目标

交错模式：

```
genSingleChapterPlan(1) → genChapter(1)
  → genSingleChapterPlan(2) → genChapter(2)
    → ... 
      → 卷结束时 genVolumeOutline(nextVol)
        → genSingleChapterPlan(N+1) → genChapter(N+1)
```

## 改动清单

### 1. genChapter 自动续写增加细纲检查（核心改动）

**文件**: `src/components/writing/Workspace.tsx`

**位置**: `genChapter` 的自动续写检测（约 1665 行）

**改动**: 在自动续写跳到下一章前，检查下一章细纲是否存在。不存在则先调用 `genSingleChapterPlan`。

```typescript
// 当前代码（简化后）:
if (!cancelledRef.current && queueEndChapter > 0) {
  const nextChapter = chapNum + 1
  if (nextChapter > queueEndChapter) { /* 完成 */ return }
  const nextPlan = chapterPlans.find(p => p.chapter_number === nextChapter)
  if (!nextPlan) { /* 无细纲, 完成 */ return }
  setTimeout(() => { if (autoContinueRef.current) genChapter(nextChapter) }, 1000)
}

// 改为:
if (!cancelledRef.current && queueEndChapter > 0) {
  const nextChapter = chapNum + 1
  if (nextChapter > queueEndChapter) { /* 完成 */ return }
  setTimeout(async () => {
    if (!autoContinueRef.current) return
    // 检查细纲是否存在
    let nextPlan = chapterPlans.find(p => p.chapter_number === nextChapter)
    if (!nextPlan) {
      // 细纲不存在 → 先生成细纲，再写正文
      showToast('info', `先生成第${nextChapter}章细纲...`)
      await genSingleChapterPlan(nextChapter)
      nextPlan = chapterPlans.find(p => p.chapter_number === nextChapter)
    }
    if (!nextPlan) {
      showToast('error', `第${nextChapter}章细纲生成失败`)
      setQueueEndChapter(0)
      return
    }
    genChapter(nextChapter)
  }, 1500)  // 细纲生成需要更多时间
}
```

### 2. genSingleChapterPlan 增强：读取上一章实际正文

**文件**: `src/components/writing/Workspace.tsx`

**位置**: `genSingleChapterPlan` 函数（约 1180 行）

**当前已有**: 第 1199-1200 行已读取 `prevChapter`（上一章正文），第 1227-1229 行已注入 `prevContentExcerpt`。

**改动**: 增强上一章正文的上下文用量——不仅注入最后 400 字作为衔接，还将上一章结束时的角色状态注入细纲系统提示。

```typescript
// 在第 1227 行附近新增:
const prevChapterState = prevChapter?.content
  ? `\n【上一章结束时角色状态（基于实际正文）】\n请基于上一章实际结尾的情绪和状态来规划本章。确保本章开头自然承接上章结尾。`
  : ''
```

### 3. 卷纲自动触发

**文件**: `src/components/writing/Workspace.tsx`

**位置**: 自动续写检测

**改动**: 当 `chapNum` 恰好是某卷的最后一章时，在生成下一章细纲之前先生成下一卷的卷纲。

```typescript
// 在自动续写中检测卷边界:
const curVol = volumes.find(v => chapNum >= v.chapter_range[0] && chapNum <= v.chapter_range[1])
if (curVol && chapNum === curVol.chapter_range[1]) {
  // 当前章是卷的最后一章 → 需要生成下一卷纲
  const nextVolNum = (curVol.volume_number || 0) + 1
  if (!volumes.find(v => v.volume_number === nextVolNum)) {
    showToast('info', `生成第${nextVolNum}卷卷纲...`)
    await genSingleVolume(nextVolNum)
  }
}
```

### 4. 废除旧的批量细纲生成逻辑（可选）

**文件**: `src/components/writing/Workspace.tsx`

**位置**: `genDetailOutline` 函数

**改动**: 标记为 deprecated，或在 UI 中隐藏批量生成按钮。保留函数本身以备用户手动触发。

---

## 改动影响

| 改动 | 影响范围 | 风险 |
|------|---------|------|
| 自动续写加细纲检查 | genChapter 自动续写链 | 低：仅是增加条件分支 |
| 细纲增强上一章正文 | genSingleChapterPlan | 低：已有 prevChapter 逻辑 |
| 卷纲自动触发 | genChapter 自动续写链 | 中：genSingleVolume 需要足够上下文 |
| 废除批量细纲 | UI + genDetailOutline | 低：保留函数，仅隐藏 |

## 验证点

1. 自动续写第 1-5 章：先生成第 1 章细纲 → 正文 → 第 2 章细纲（此时已有第 1 章正文）→ 正文 → ...
2. 跨卷：第 1 卷第 10 章（最后一章）完成后 → 自动生成第 2 卷卷纲 → 第 11 章细纲 → 正文
3. 中断恢复：取消后再点自动续写，从断点继续
