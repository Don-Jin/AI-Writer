# 事实簿手动操作影响分析 + 200万字最终评估

## 一、事实簿手动操作 → AI 生成的完整传导链路

### 1.1 数据流架构

```
用户操作 (CanonFactPanel)
  │
  ├─ 增删改事实 → canonService.upsertFact / updateFact / deleteFact
  │                   │
  │                   ▼
  │              canon_facts 表 (SQLite, project_id scoped)
  │                   │
  │         genChapter 每次调用时 FRESH READ
  │                   │
  │     ┌─────────────┼──────────────┐
  │     ▼             ▼              ▼
  │  getRefs()    getChapterFacts  buildExecutionConstraints
  │  (is_hard=1)  (is_hard+info    (writing_rule)
  │                permissions)
  │     │             │              │
  │     ▼             ▼              ▼
  │  cardContext   canonFactsCtx   executionConstraints
  │  (used by      (CHAPTER_USER    (CHAPTER_SYSTEM
  │   outline/     参数14)         副零层铁律)
  │   volume)
  │
  └─ 每次genChapter都是全新读取，无缓存
```

### 1.2 各类操作的实际影响

| 操作 | 存储位置 | 注入位置 | 对生成影响 | 说明 |
|------|---------|---------|-----------|------|
| **添加角色硬规则** | canon_facts (is_hard_rule=1) | CHAPTER_USER 参数14 | **高** | AI 作为硬约束遵守 |
| **添加世界观硬规则** | canon_facts (is_hard_rule=1) | CHAPTER_USER 参数14 | **高** | AI 作为硬约束遵守 |
| **修改规则的 fact_value** | canon_facts | CHAPTER_USER 参数14 | **高** | 下次生成立即生效 |
| **设置 revealed_level=0** | canon_facts | infoPermissions → forbidden | **高** | 本章禁区自动补充 |
| **设置 revealed_level<50** | canon_facts | infoPermissions ("部分公开") | **中** | AI 参考但不强制 |
| **设置 is_hard_rule=0** | canon_facts | 仅 allFacts 中可见 | **低** | 不注入 prompt，仅 buildMinimalContext 使用 |
| **添加写作规则** | canon_facts (writing_rule) | CHAPTER_SYSTEM 副零层 | **极高** | 每条规则作为铁律注入系统提示 |
| **删除事实** | canon_facts DELETE | 移除注入 | **高** | 下次生成立即不再约束 |
| **标记事实为废弃** | replaced_by 字段 | 从查询中排除 | **高** | 立即失效 |
| **编辑 details JSON** | canon_facts.details | buildMinimalContext | **低-中** | 不影响主 prompt，仅影响一致性检查上下文 |

### 1.3 关键发现

#### ✅ 无缓存问题
`genChapter` 每次执行都通过 SQL 查询从 `canon_facts` 表读取最新数据。用户在事实簿中的任何修改，下次点击"生成本章"时立即生效。

#### ⚠️ 风格库/人格库不在传导链内
风格库（writing_style_libraries）和人格库（novel_personalities）的数据**不经过** canon_facts 表。它们是独立的表，通过 `buildStyleContext()` 和 `buildPersonalityContext()` 读取。
用户对 canon_facts 中的角色/设定/规则的编辑**不会**影响风格和人格的注入。

#### ⚠️ cardContext 与 canonFactsContext 重复
`getRefs()` 和 `getChapterFacts()` 都查询 `canon_facts WHERE is_hard_rule=1`，产生相同数据。
- `getRefs()` 的 `cardContext` → 用于 genOutline/genSingleVolume
- `getChapterFacts()` 的 `canonFactsContext` → 用于 genChapter

正文生成时，`getRefs()` 返回的 `cardContext` **未被使用**（只使用了 `styleContext` 和 `personalityContext`）。
在 genChapter 第 1387-1390 行：
```typescript
const { styleContext, personalityContext } = config
  ? { styleContext: ..., personalityContext: ... }
  : (await getRefs())
```
这里只解构了 `styleContext` 和 `personalityContext`，`cardContext` 被丢弃。真正的事实簿注入在后续的 `getChapterFacts()` 调用。

#### ⚠️ 事实簿不控制"细纲"生成
`genSingleChapterPlan`（细纲）通过 `getChapterFacts` 的 `revealedMap` 自动补充 `forbidden` 字段，但不会将完整的事实簿内容注入细纲的 system/user prompt。

---

## 二、续写功能区分

### 两种续写的本质区别

| | 续写本章 | 自动续写下一章 |
|---|---|---|
| **调用函数** | `handleContinue()` | genChapter 末尾自动触发 |
| **操作对象** | 同一章追加内容 | 开启下一章全新生成 |
| **触发方式** | 手动点击「续写本章」按钮 | 自动续写模式开启后自动 |
| **Prompt 区别** | CONTINUE_CHAPTER_USER（包含前面全文作为上下文） | CHAPTER_USER（完整的新章 prompt） |
| **流式追加** | 是，追加到现有 content 后 | 否，覆盖或新建 |
| **使用场景** | 本章只写了3000字要补到5000字 | 写完第5章自动开第6章 |
| **UI 按钮** | 「续写本章」 | 「自动续写: 关/确认/开」 |

### UI 清晰度改进（v3.0）
- 「续写本章」= 继续写当前章，追加更多字数
- 「自动续写: 关」= 不自动跳到下一章
- 「自动续写: 确认」= 每章完后弹窗确认是否继续
- 「自动续写: 开」= 全自动，静默覆盖旧数据推进

---

## 三、重新评估：现在的系统能不能输出 200 万汉字

### 评估框架

| 维度 | 改造前 | 改造后 | 状态 |
|------|--------|--------|------|
| **单章生成** | ✅ max_tokens=16384，单章~10000字 | ✅ 不变 | 🟢 可用 |
| **逐章流水线** | ✅ 生成→记录官→事件提取→检查 | ✅✅ 新增自动续写+队列续写 | 🟢 可用 |
| **数据库容量** | ✅ SQLite ~20MB/667章 | ✅ 不变 | 🟢 可用 |
| **上下文窗口** | ⚠️ canonFacts无截断上限 | ⚠️ 仍未截断，但context_snapshots分卷减轻压力 | 🟢 基本可用 |
| **API成本** | ✅ ~¥30/200万字 | ✅ 不变 | 🟢 可用 |
| **叙事一致性** | 🔴 context_state单条JSON，200章后失忆 | ✅ context_snapshots分卷 + character_snapshots每章快照 | 🟢 已修复 |
| **自动续写** | 🔴 667章手动逐章点击 | ✅ 三种模式 + 队列续写 + 中断恢复 | 🟢 已修复 |
| **全局连贯性** | 🔴 无跨卷检查、无伏笔追踪、无角色弧线 | ✅ 四维跨卷检查 + 回收率 + 时间跳跃 + 角色弧线 | 🟢 已修复 |

### 最终结论：🟢 能够输出 200 万字

核心瓶颈全部解决：

1. **叙事一致性崩塌**（🔴→🟢）：`context_snapshots` 按卷存储，`character_snapshots` 每章快照，第 200 章生成时 AI 可以回溯到任意卷的上下文。

2. **手动点击地狱**（🔴→🟢）：自动续写三种模式 + 队列续写"第1-50章"，用户只需设置一次，系统自动推进。

3. **全局连贯性缺失**（🔴→🟢）：伏笔回收率统计 + 逾期检测 + 智能匹配；时间跳跃检测；角色弧线追踪（状态变化/地点变化/转折点）；卷结束时自动四维检查评分。

### 剩余风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| canonFactsContext 无截断 | 667章后硬规则列表可能超长，挤压 AI 上下文 | 建议后续添加截断（如最多注入30条最高优先级硬规则） |
| 多日批量生成中断后恢复 | 跨多天执行时需记住断点 | 可通过 auto_continue_queue 表持久化断点 |
| AI 风格漂移 | 100章后的文风可能与第1章不同 | 风格库始终注入 CHAPTER_SYSTEM，理论上一致 |
| 角色数量膨胀 | 每章 character_snapshots 累积大量数据 | SQLite 足够，但需注意查询性能 |

### 建议的后续优化

1. **canonFactsContext 截断**：注入前按 `is_hard_rule DESC, established_at DESC` 排序，取前 30 条
2. **断点续传**：利用已有的 `auto_continue_queue` 表，支持"从第 237 章继续"
3. **风格一致性检查**：每 50 章抽样对比文风指纹
