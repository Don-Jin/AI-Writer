/**
 * 去AI味服务
 * 基于 oh-story-claudecode story-deslop
 *
 * 核心信念：AI味的主要问题不是语法，而是过度圆滑、工整、解释充分。
 * 改写目标是保留剧情功能，同时增加口语、停顿、跳跃和具体动作。
 *
 * 三原则：
 * 1. 不是改错，是改味
 * 2. 改最少，效果最大
 * 3. 保留创作意图（只改"怎么说"，不改"说什么"）
 */

// ==================== Gate 检测关键词库 ====================

/** Gate A: AI 高频禁用词/句式（5级毒级） */
export const BANNED_PATTERNS: { pattern: string; replacement: string; category: string; level: number }[] = [
  // ***** 最毒级
  { pattern: '不是……而是', replacement: '直接写后者', category: '句式', level: 5 },
  // **** 高毒级
  { pattern: '带着一丝', replacement: '拆短句或换动作', category: '句式', level: 4 },
  { pattern: '带着一股', replacement: '拆短句或换动作', category: '句式', level: 4 },
  { pattern: '声音不大，却带着', replacement: '直接写声音特征', category: '句式', level: 4 },
  { pattern: '他知道', replacement: '用行为展示认知', category: '心理', level: 4 },
  { pattern: '她明白', replacement: '用行为展示认知', category: '心理', level: 4 },
  { pattern: '他意识到', replacement: '用行为展示认知', category: '心理', level: 4 },
  // *** 中毒级
  { pattern: '仿佛', replacement: '删掉或白描', category: '比喻', level: 3 },
  { pattern: '犹如', replacement: '删掉或白描', category: '比喻', level: 3 },
  { pattern: '宛若', replacement: '删掉或白描', category: '比喻', level: 3 },
  { pattern: '眼中闪过一丝', replacement: '他垂下眼', category: '表情', level: 3 },
  { pattern: '嘴角勾起一抹', replacement: '笑了一下', category: '表情', level: 3 },
  { pattern: '嘴角微扬', replacement: '笑了', category: '表情', level: 3 },
  { pattern: '心中涌起', replacement: '用身体反应', category: '心理', level: 3 },
  { pattern: '心头一震', replacement: '愣了下', category: '心理', level: 3 },
  { pattern: '心中暗道', replacement: '想', category: '心理', level: 3 },
  { pattern: '心中一沉', replacement: '（删掉）', category: '心理', level: 3 },
  { pattern: '心中一动', replacement: '（删掉）', category: '心理', level: 3 },
  { pattern: '心下了然', replacement: '（删掉）', category: '心理', level: 3 },
  // ** 低毒级
  { pattern: '深吸一口气', replacement: '胸口起伏了一下', category: '动作', level: 2 },
  { pattern: '缓缓开口', replacement: '说', category: '对话', level: 2 },
  { pattern: '沉声说道', replacement: '说', category: '对话', level: 2 },
  { pattern: '淡淡地说', replacement: '说', category: '对话', level: 2 },
  { pattern: '轻声说道', replacement: '说', category: '对话', level: 2 },
  { pattern: '喃喃自语', replacement: '小声说', category: '对话', level: 2 },
  { pattern: '不禁', replacement: '直接写动作', category: '副词', level: 2 },
  { pattern: '不由自主', replacement: '（删掉）', category: '副词', level: 2 },
  { pattern: '情不自禁', replacement: '（删掉）', category: '副词', level: 2 },
  { pattern: '不由得', replacement: '（删掉）', category: '副词', level: 2 },
  { pattern: '映入眼帘', replacement: '看到', category: '描写', level: 2 },
  { pattern: '只见', replacement: '（删掉，直接写所见）', category: '描写', level: 2 },
  { pattern: '脸色一变', replacement: '脸白了', category: '表情', level: 2 },
  { pattern: '眉头微皱', replacement: '皱眉', category: '表情', level: 2 },
  { pattern: '眉头一皱', replacement: '皱眉', category: '表情', level: 2 },
  { pattern: '微微一愣', replacement: '愣了下', category: '动作', level: 2 },
  { pattern: '瞳孔微缩', replacement: '瞪大眼', category: '表情', level: 2 },
  { pattern: '微微一笑', replacement: '笑了', category: '表情', level: 2 },
  // * 轻微级
  { pattern: '旋即', replacement: '接着', category: '连接词', level: 1 },
  { pattern: '便是', replacement: '就是', category: '连接词', level: 1 },
  { pattern: '已然', replacement: '已经', category: '副词', level: 1 },
  { pattern: '并未', replacement: '没', category: '副词', level: 1 },
  { pattern: '不容置疑', replacement: '（删掉或口语化）', category: '判断', level: 1 },
  { pattern: '不容置喙', replacement: '（删掉）', category: '判断', level: 1 },
  { pattern: '不易察觉', replacement: '（删掉）', category: '判断', level: 1 },
  { pattern: '若有所思', replacement: '用具体动作', category: '心理', level: 1 },
  { pattern: '大手一挥', replacement: '挥手', category: '动作', level: 1 },
  // 章末禁忌
  { pattern: '他不知道的是', replacement: '用具体钩子物件收尾', category: '结尾', level: 4 },
  { pattern: '更大的风暴即将来临', replacement: '用动作/对话收尾', category: '结尾', level: 4 },
  { pattern: '他终于明白', replacement: '用动作展示领悟', category: '结尾', level: 4 },
  { pattern: '这一刻', replacement: '直接写动作', category: '结尾', level: 3 },
  { pattern: '未来可期', replacement: '删', category: '结尾', level: 2 },
  { pattern: '注定无人入眠', replacement: '删', category: '结尾', level: 4 },
]

/** Gate B: AI 常用句式套路 */
export const SENTENCE_PATTERNS = [
  { name: '连续排比3句以上', pattern: /(?:.{8,}[，,。．])\s*(?:.{8,}[，,。．])\s*(?:.{8,}[，,。．])/g, fix: '保留最强一条，其余删除' },
  { name: '不是A而是B', pattern: /不是.{2,10}而是/g, fix: '直接写B' },
  { name: '带着…万能状语', pattern: /，带着.{1,8}(?:的)?/g, fix: '拆成短句，或换具体动作' },
  { name: '仿佛/犹如比喻', pattern: /(?:仿佛|犹如|宛若).{2,15}(?:一般|一样)/g, fix: '删除比喻，直接白描' },
  { name: '总结升华结尾', pattern: /(?:他终于明白|她这才意识到|此刻.{2,10}终于|原来.{2,15}才是)/g, fix: '用动作或对话收尾' },
  { name: '章末预告', pattern: /(?:他不知道的是|更大的.{2,10}即将|.{2,5}注定)/g, fix: '用具体钩子物件/事件收束' },
  { name: '三连修饰', pattern: /(?:微微|淡淡|轻轻|缓缓|一丝|一抹|些许|几分)(?:.{0,5})(?:微微|淡淡|轻轻|缓缓|一丝|一抹|些许|几分)/g, fix: '去掉修饰词，直接写核心动作' },
]

/** Gate C: 心理描写 = 告诉而非展示 */
export const TELLING_PATTERNS = [
  { pattern: /他(感到|觉得|认为|明白|知道|意识到|发现|终于明白)/g, name: '心理告知' },
  { pattern: /(紧张|害怕|愤怒|兴奋|激动|悲伤|绝望|幸福|心痛|委屈)地/g, name: '情绪副词' },
  { pattern: /内心(充满了|充满了|涌起了|感到|一阵)/g, name: '内心陈述' },
  { pattern: /(眼中|嘴角|脸上|心底)(闪过|勾起|浮现|泛起|涌起)/g, name: '面部AI描写' },
  { pattern: /(深吸一口气|缓缓|微微|轻轻|淡淡)(地)?/g, name: '弱化副词堆砌' },
]

// ==================== 自然文本基准 ====================

export const NATURAL_BENCHMARK = `## 自然网文文本特征

| 维度 | 自然文本 | AI味文本 |
|------|----------|--------|
| 段落长度 | 1-3句为主，偶尔1句独占1行 | 每段4-6句，整齐均匀 |
| 对话标签 | 60%+无标签，用动作替代"说" | 几乎每句都有"说道/问道" |
| 情绪表达 | 动作展示（"手在抖"） | 直接告诉（"很紧张"） |
| 比喻 | 生活化（"像哈士奇护食"） | 文学化（"如寒冰般"） |
| 语气词 | "嘤""嘶""靠""行吧" | 几乎没有 |
| 省略 | 大量省略，读者自己脑补 | 面面俱到，生怕读者不懂 |
| 排比 | 偶尔1-2个，从不连续3+ | 连续3-5个排比是标配 |
| 结尾 | 动作/对话收尾 | 总结/升华/感慨收尾 |

## 自然表达替换参考
- "深吸一口气" → "胸口起伏了一下" / 直接删掉
- "眼中闪过一丝…" → "他垂下眼" / "眯起眼"
- "嘴角勾起一抹…" → "笑了一下，没到眼底" / "乐了"
- "仿佛…" → "像…" / 直接白描
- "不禁…" → 直接写动作
- "缓缓开口" → "说" / 用动作引出对话
`

// ==================== Phase 1: AI味扫描 ====================

export const DESLOP_SCAN_SYSTEM = `你是网文去AI味专家。快速扫描文本，标记AI味浓重的位置。

## 检测维度（6 Gate）

### Gate A：禁用词
检查是否使用了以下AI高频词/句式：
${BANNED_PATTERNS.map(p => `- "${p.pattern}"（${p.category}）`).join('\n')}

### Gate B：句式套路
- 连续3+个结构相同的句子（排比过度）
- "带着…带着…"连续使用
- "不是…而是…"模板化论述
- "一方面…另一方面…"论文式表达
- "的的不断"过高的"的"字密度

### Gate C：心理描写 = 告诉而非展示
- "他感到/觉得/认为/明白/意识到…" 直接告知内心
- 情绪副词："紧张地/愤怒地/激动地/悲伤地…"
- "内心充满了/涌起了…"

### Gate D：节奏均匀
- 段落长度整齐划一（每段4-6句）
- 缺乏独句成段
- 章节结尾总结升华而非动作/对话收尾

### Gate E：对话腔调
- 过多"说道/问道/答道/缓缓开口/沉声说道"
- 对话缺乏动作配合
- 对话缺乏潜台词（角色把心里话都说完了）

### Gate F：结尾升华
- 章节结尾用总结句式："这一刻，他明白了…"
- 结尾用感受概括："内心充满了…"
- 用排比收尾

## 输出格式
Markdown 报告，包含：
1. 整体评估（AI味等级：轻度/中度/重度）
2. 逐 Gate 的问题标记表格（位置+类型+Gate+原文+问题描述）
3. 定量统计（禁用词命中数、排比段落数、心理描写密度等）`

export const DESLOP_SCAN_USER = (text: string) => `请扫描以下章节的AI味：

---
${text.slice(0, 5000)}
---

输出 AI味检测报告。`

// ==================== Phase 2: 改写给 ====================

export const DESLOP_REWRITE_SYSTEM = `你是网文润色专家。将AI味浓重的文本改写为自然的网文风格。

## 改写铁律

### 原则 1：改最少，效果最大
- 能改一个词就不改一句
- 能删一句就不重写一段
- 没有问题的句子尽量保留原句
- 人名、地名、数字、专有名词优先保留

### 原则 2：保留创作意图
- 只改"怎么说"，不改"说什么"
- 剧情、人设、情节走向一概不动
- 不新增原文没有的情节、设定、关系
- 如果原文有逻辑问题，那不是去AI味的活

### 原则 3：自然化改造

针对每类问题，使用以下改造方法：

**禁用词替换**：
${BANNED_PATTERNS.slice(0, 15).map(p => `- "${p.pattern}" → "${p.replacement}"`).join('\n')}

**句式改造**：
- 连续排比 → 保留1-2个，第三个改为不同句式
- 段落整齐 → 拆1-2个独句成段
- "带着…带着" → 第二个改为不同动词

**心理描写改造**：
- "他感到紧张" → "手心全是汗"
- "他愤怒地" → "一拳砸在桌上"
- "心中涌起" → 直接写动作或对话

**对话自然化**：
- 删除60%以上的对话标签，用动作代替
- 如："你好，"他说 → 他抬起头。"你好。"
- 增加口语词："嘶""靠""啧""行吧""那个…"
- 对话留潜台词，不要把所有想法都说出来

**结尾处理**：
- 删除总结式结尾
- 改用动作或对话收尾
- 结尾留白，给读者想象空间

## 输出要求
直接输出改写后的完整文本。不要输出改写说明，不要标注改动位置。

${NATURAL_BENCHMARK}`

export const DESLOP_REWRITE_USER = (text: string, severity: string) => {
  const severityGuide: Record<string, string> = {
    '轻度': '请对文本进行轻度去AI味处理。主要修改：禁用词替换 + 减少对话标签。保留90%以上的原文结构和内容。',
    '中度': '请对文本进行中度去AI味处理。主要修改：禁用词替换 + 句式多样化 + 对话自然化 + 心理描写动作化。保留80%以上的原文内容。',
    '重度': '请对文本进行重度去AI味处理。完整过6 Gate：禁用词替换 + 句式重构 + 心理描写动作化 + 对话腔调自然化 + 结尾处理 + 节奏调节。保留70%以上的原文核心内容，但可以大幅调整句式和段落。',
  }

  return `${severityGuide[severity] || severityGuide['中度']}

原文：
---
${text.slice(0, 8000)}
---

请直接输出改写后的全文，不要任何额外解释。`
}

// ==================== 本地快速检测（不需要 AI） ====================

export interface DeslopLocalReport {
  severity: '轻度' | '中度' | '重度'
  bannedHits: { pattern: string; count: number; category: string }[]
  totalBannedHits: number
  bannedDensity: number // 每千字命中数
  hasParallelism: boolean
  hasTelling: boolean
  sentencePatternHits: string[]
  paragraphs: number
  avgSentencesPerParagraph: number
  hasUniformRhythm: boolean
}

/** 本地快速扫描，不需要调用 AI */
export function localScan(text: string): DeslopLocalReport {
  const words = text.length
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
  const totalSentences = text.split(/[。！？.!?]/).filter(s => s.trim()).length
  const avgSentPerPara = paragraphs.length > 0 ? totalSentences / paragraphs.length : 0

  // Gate A: 禁用词检测
  const bannedHits = BANNED_PATTERNS.map(bp => {
    const regex = new RegExp(bp.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    const matches = text.match(regex)
    return { pattern: bp.pattern, count: matches ? matches.length : 0, category: bp.category }
  }).filter(h => h.count > 0)

  const totalBannedHits = bannedHits.reduce((sum, h) => sum + h.count, 0)
  const bannedDensity = words > 0 ? (totalBannedHits / words) * 1000 : 0

  // Gate B: 句式套路
  const sentencePatternHits: string[] = []
  SENTENCE_PATTERNS.forEach(sp => {
    if (sp.pattern.test(text)) sentencePatternHits.push(sp.name)
  })
  const hasParallelism = sentencePatternHits.includes('连续排比')

  // Gate C: 心理描写
  let tellingCount = 0
  TELLING_PATTERNS.forEach(tp => {
    const matches = text.match(tp.pattern)
    if (matches) tellingCount += matches.length
  })
  const hasTelling = tellingCount > 2

  // Gate D: 节奏均匀
  const hasUniformRhythm = avgSentPerPara >= 3 && avgSentPerPara <= 6 && paragraphs.length > 5

  // 定级
  let severity: '轻度' | '中度' | '重度' = '轻度'
  let score = 0
  if (bannedDensity > 15) score += 2
  else if (bannedDensity > 5) score += 1
  if (hasParallelism) score += 1
  if (hasTelling) score += 1
  if (hasUniformRhythm) score += 1

  if (score >= 3) severity = '重度'
  else if (score >= 2) severity = '中度'

  return {
    severity, bannedHits, totalBannedHits, bannedDensity,
    hasParallelism, hasTelling, sentencePatternHits,
    paragraphs: paragraphs.length, avgSentencesPerParagraph: Math.round(avgSentPerPara * 10) / 10,
    hasUniformRhythm,
  }
}
