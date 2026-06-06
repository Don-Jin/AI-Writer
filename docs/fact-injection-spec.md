# 卷事实 & 章事实：精确注入规格

## 一、大纲分卷概要 → 事实库（首次生成时创建）

### 1.1 数据流

```
genOutline() 完成
  → CANON_EXTRACTION_SYSTEM/USER 提取核心事实
  → canonService.clearBySource('outline')
  → canonService.batchUpsert(facts)  ← 全部 volume_number=0（全局）
  
  → 大纲中如果有分卷概要（新增字段 volume_summaries[]）
    → 为每个卷创建一条 canon_fact:
      fact_category='volume_summary'
      fact_key='第N卷概要'
      fact_value=卷概要文本
      volume_number=N  ← 标记所属卷！
      is_hard_rule=0      ← 软事实，仅供参考
      source='outline'
```

### 1.2 大纲 prompt 新增输出

OUTLINE_SYSTEM 增加输出要求：

```json
{
  "title": "...",
  "summary": "...",
  "core_conflict": "...",
  "volume_summaries": [
    {"volume": 1, "summary": "开篇：主角觉醒异能，卷入校园暗流...", "key_facts": ["主角异能类型","校园势力分布"]},
    {"volume": 2, "summary": "深入：进入地下世界，发现异能源头...", "key_facts": ["地下世界规则","异能源头真相"]},
    ...
  ],
  "global_facts": [
    {"fact_category":"character","fact_key":"程澈","fact_value":"...","is_hard_rule":true},
    ...
  ]
}
```

### 1.3 存入 canon_facts 后的结构

```
canon_facts 表:

id=1  volume_number=0  character  程澈      主角人设...    is_hard=1  ← 全局
id=2  volume_number=0  setting    世界观    近未来AI...    is_hard=1  ← 全局
id=3  volume_number=0  rule       核心规则  异能觉醒条件   is_hard=1  ← 全局

id=4  volume_number=1  volume_summary  第1卷概要  开篇：主角觉醒...  is_hard=0
id=5  volume_number=1  character  凌瑶      凌瑶在本卷的身份... is_hard=1  ← 卷级
id=6  volume_number=1  setting    校园势力  三大势力的分布...   is_hard=1  ← 卷级

id=7  volume_number=2  volume_summary  第2卷概要  深入：进入地下...  is_hard=0
id=8  volume_number=2  character  凌瑶      凌瑶在本卷的真实身份... is_hard=1  ← 卷级
```

用户在事实簿面板中可以修改任意卷的概要，下次生成自动生效。

## 二、卷事实注入规格（每章生成时）

### 2.1 注入来源：getChapterFacts(projectId, chapterNumber) 改造后

```typescript
// 1. 全局层（volume_number=0, is_hard_rule=1）
const globalFacts = await db.query(
  `SELECT * FROM canon_facts 
   WHERE project_id=? AND volume_number=0 AND is_hard_rule=1`
)

// 2. 卷级层（volume_number=当前卷号, is_hard_rule=1）
const volumeFacts = await db.query(
  `SELECT * FROM canon_facts 
   WHERE project_id=? AND volume_number=? AND is_hard_rule=1`
)

// 3. 卷概要（volume_number=当前卷号, fact_category='volume_summary'）
const volumeSummary = await db.query(
  `SELECT * FROM canon_facts 
   WHERE project_id=? AND volume_number=? AND fact_category='volume_summary'`
)
```

### 2.2 注入格式（canonFactsContext 字符串）

```
【全局设定——不可违反】
- [角色] 程澈：前特种兵，现大学保安，异能类型为「物质重构」
- [世界设定] 世界观：近未来，AI普及但尚未觉醒，异能者在社会边缘活动
- [规则] 异能限制：每次使用消耗寿命，不可逆

【第2卷设定——本卷专属】
- [卷概要] 深入：进入地下世界，发现异能源头，与凌瑶建立临时联盟
- [角色] 凌瑶（本卷身份）：地下情报贩子，真实目的是寻找父亲的代码门
- [世界设定] 地下世界：三层结构，每层由不同势力控制
- [规则] 本卷禁区：凌瑶的真实身份不能被第三方知晓

【本章动态——实时变化】
- 程澈：情绪 警惕→紧张（原因：暗门后发现了凌瑶的痕迹）
- 程澈：位置 教学楼→地下实验室B2
- 凌瑶：揭示 新信息「暗门是父亲设计的，只有程澈能打开」
- 程澈→凌瑶：关系 陌生人→临时盟友（信任度20/100）
```

**注入位置**：CHAPTER_USER 第14个参数 `canonFactsContext` → userPrompt 中段

### 2.3 Token 控制

```
全局设定:  最多 15 条 × 40 字 = 600 字 → ~800 tokens
卷级设定:  最多 20 条 × 40 字 = 800 字 → ~1000 tokens
本章动态:  最多 10 条 × 30 字 = 300 字 → ~400 tokens
────────────────────────────────────────
总计:      ~2200 tokens（恒定，不随总章节增长）
```

如果某个层级超出上限，截断末尾并加 `...（省略剩余X条）`。

## 三、章事实写入规格（每章生成后）

### 3.1 提取来源（genChapter 后台任务）

从记录官（CHAPTER_SUMMARY_SYSTEM/USER）的返回值中提取：

```typescript
// 记录官返回格式（AI 生成）:
{
  summary: "本章摘要...",
  characters_appeared: ["程澈","凌瑶"],
  locations: ["地下实验室B2"],
  character_changes: {
    "程澈": "情绪从警惕转为紧张，发现了暗门的秘密"
  },
  world_changes: {
    "暗门": "被程澈第一次激活"
  },
  relationship_changes: [
    { char_a: "程澈", char_b: "凌瑶", change: "从陌生人变为临时盟友", type: "ally" }
  ]
}
```

### 3.2 写入 chapter_fact_deltas

```typescript
// 情绪变化 → delta_type='emotion'
INSERT INTO chapter_fact_deltas 
  (project_id, chapter_number, character_name, delta_type, delta_value)
VALUES (1, 5, '程澈', 'emotion', 
  '{"from":"警惕","to":"紧张","cause":"发现暗门后凌瑶的痕迹"}')

// 位置变化 → delta_type='location'
INSERT ... VALUES (1, 5, '程澈', 'location',
  '{"from":"教学楼","to":"地下实验室B2"}')

// 关系变化 → delta_type='relationship'
INSERT ... VALUES (1, 5, '程澈', 'relationship',
  '{"char_a":"程澈","char_b":"凌瑶","from":"陌生人","to":"临时盟友","trust":20}')

// 揭示新信息 → delta_type='revealed_info'
INSERT ... VALUES (1, 5, '凌瑶', 'revealed_info',
  '{"info":"暗门是父亲设计的，只有程澈能打开"}')

// 世界变化 → delta_type='world_change'
INSERT ... VALUES (1, 5, '暗门', 'world_change',
  '{"change":"被程澈第一次激活"}')
```

**写入时机**：genChapter 后台任务中，checker 完成后、状态写入前
**写入位置**：chapter_fact_deltas 表（project_id + chapter_number 索引）

### 3.3 本章动态注入（下一章时使用）

生成第6章时，读取第5章（及之前未聚合的）deltas：

```typescript
const deltas = await db.query(
  `SELECT * FROM chapter_fact_deltas 
   WHERE project_id=? AND chapter_number=? AND applied_to_canon=0`,
  [projectId, chapNum - 1]
)

// 格式化为注入文本:
let chapterDynamic = '【本章动态——实时变化】\n'
for (const d of deltas) {
  if (d.delta_type === 'emotion') {
    const v = JSON.parse(d.delta_value)
    chapterDynamic += `- ${d.character_name}：情绪 ${v.from}→${v.to}（原因：${v.cause}）\n`
  } else if (d.delta_type === 'location') {
    const v = JSON.parse(d.delta_value)
    chapterDynamic += `- ${d.character_name}：位置 ${v.from}→${v.to}\n`
  } else if (d.delta_type === 'relationship') {
    const v = JSON.parse(d.delta_value)
    chapterDynamic += `- ${v.char_a}→${v.char_b}：关系 ${v.from}→${v.to}（信任度${v.trust}/100）\n`
  } else if (d.delta_type === 'revealed_info') {
    const v = JSON.parse(d.delta_value)
    chapterDynamic += `- ${d.character_name}：揭示「${v.info}」\n`
  }
}
```

## 四、卷事实聚合（卷结束时）

### 4.1 aggregateVolumeDeltas 函数

```typescript
export async function aggregateVolumeDeltas(projectId: number, volumeNumber: number) {
  // 1. 收集本卷所有 delta
  const vol = await db().get(
    'SELECT chapter_range FROM volumes WHERE project_id=? AND volume_number=?',
    [projectId, volumeNumber]
  )
  const [startCh, endCh] = vol.chapter_range

  const deltas = await db().query(
    `SELECT * FROM chapter_fact_deltas 
     WHERE project_id=? AND chapter_number BETWEEN ? AND ? AND applied_to_canon=0`,
    [projectId, startCh, endCh]
  )

  // 2. 按角色聚合
  const byChar = new Map<string, any[]>()
  for (const d of deltas) {
    if (!byChar.has(d.character_name)) byChar.set(d.character_name, [])
    byChar.get(d.character_name)!.push(d)
  }

  // 3. 为每个角色更新/创建 canon_facts（volume_number=下一个卷号）
  const nextVol = volumeNumber + 1
  for (const [charName, charDeltas] of byChar) {
    // 取最后一次的状态作为本卷最终状态
    const lastEmotion = charDeltas.filter(d => d.delta_type === 'emotion').pop()
    const lastLocation = charDeltas.filter(d => d.delta_type === 'location').pop()
    const revealedInfos = charDeltas.filter(d => d.delta_type === 'revealed_info')
      .map(d => JSON.parse(d.delta_value).info)

    // 更新或创建
    await upsertFact({
      projectId, category: 'character', key: charName,
      value: `（第${volumeNumber}卷末）${lastEmotion ? '情绪' + JSON.parse(lastEmotion.delta_value).to : ''}，位置${lastLocation ? JSON.parse(lastLocation.delta_value).to : ''}`,
      isHardRule: true, source: `volume_${volumeNumber}`,
      confidence: 'auto_extracted',
      details: {
        last_emotion: lastEmotion?.delta_value,
        last_location: lastLocation?.delta_value,
        revealed_info: revealedInfos,
      },
      volumeNumber: nextVol,  // ← 标记为下一卷的事实
    })
  }

  // 4. 标记已处理
  await db().run(
    `UPDATE chapter_fact_deltas SET applied_to_canon=1 
     WHERE project_id=? AND chapter_number BETWEEN ? AND ?`,
    [projectId, startCh, endCh]
  )
}
```

### 4.2 调用时机

```
genSingleVolume(N+1) 完成后:
  → aggregateVolumeDeltas(projectId, N)  ← 聚合第N卷
  → 下一卷的章节自动使用更新后的事实

或者:
runCrossVolumeCheck 完成后自动触发
```

## 五、完整时间线

```
大纲生成
  → global_facts → canon_facts(vol=0)          ← 全局层初始化
  → volume_summaries → canon_facts(vol=1..67)  ← 卷概要初始化

卷1生成 (genSingleVolume)
  → 卷1角色/设定 → canon_facts(vol=1)          ← 卷级层初始化

章1→10 生成
  → 每章注入: 全局(vol=0) + 卷1(vol=1) + 章delta  ← 三层注入
  → 每章写入: chapter_fact_deltas              ← 增量记录

卷1结束
  → aggregateVolumeDeltas(1)                   ← 聚合
  → chap11 开始注入 vol=2 事实                  ← 自动切换

卷2生成 (genSingleVolume)
  → 卷2角色/设定 → canon_facts(vol=2)          ← 新卷初始化
  → 章11→20 注入: 全局 + vol=2 + 章delta
  ...
```

## 六、用户可修改性

| 修改类型 | 位置 | 影响 |
|---------|------|------|
| 修改全局事实 | CanonFactPanel(vol=0) | 所有卷的所有章节立即生效 |
| 修改某卷事实 | CanonFactPanel(vol=N) | 该卷的章节生效 |
| 修改某卷概要 | canon_facts(volume_summary) | 该卷的 genSingleVolume 和 genSingleChapterPlan |
| 修改某章delta | chapter_fact_deltas(手动) | 仅该章的下一次生成 |
| 重跑卷聚合 | 手动触发 aggregateVolumeDeltas | 覆盖下一卷事实 |
