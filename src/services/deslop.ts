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

// ==================== 类型定义 ====================

export interface BannedPattern {
  pattern: string
  replacement: string
  category: string
  level: number
  enabled?: boolean
}

export interface ParagraphScore {
  index: number
  text: string
  score: number
  hits: string[]
}

// ==================== Gate 检测关键词库 ====================

/** Gate A: AI 高频禁用词/句式（5级毒级） */
export const DEFAULT_BANNED_PATTERNS: BannedPattern[] = [
  // ***** 最毒级
  { pattern: '不是……而是', replacement: '加情绪词改写：竟然是…而不是 / 我就知道是…不是 / 搞了半天是…', category: '句式', level: 5 },
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
  // 解释层
  { pattern: '意思是', replacement: '（删除整句，信息已被动作传达）', category: '解释', level: 5 },
  { pattern: '也就是说', replacement: '（删除）', category: '解释', level: 4 },
  { pattern: '这意味着', replacement: '（删除）', category: '解释', level: 4 },
  { pattern: '说白了', replacement: '（删除）', category: '解释', level: 4 },
  { pattern: '换句话说', replacement: '（删除）', category: '解释', level: 4 },
  // 抽象收束
  { pattern: '像某种', replacement: '换成具体描写', category: '总结', level: 4 },
  { pattern: '仿佛一切', replacement: '换成动作或感官', category: '总结', level: 4 },
  // 破折号
  { pattern: '——', replacement: '用句号或逗号', category: '标点', level: 3 },
]

/** 向后兼容：BANNED_PATTERNS 别名 */
export const BANNED_PATTERNS = DEFAULT_BANNED_PATTERNS

// ==================== 自定义禁用词持久化 ====================

const CUSTOM_PATTERNS_KEY = 'deslop_custom_patterns'

export function loadCustomBannedPatterns(): BannedPattern[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PATTERNS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((p: any) => typeof p.pattern === 'string' && p.pattern.trim())
  } catch { return [] }
}

export function saveCustomBannedPatterns(patterns: BannedPattern[]): void {
  try {
    localStorage.setItem(CUSTOM_PATTERNS_KEY, JSON.stringify(patterns))
  } catch { /* localStorage 不可用 */ }
}

/** 获取生效的规则：自定义规则优先替换同名默认规则 */
export function getEffectivePatterns(): BannedPattern[] {
  const defaults = DEFAULT_BANNED_PATTERNS.map(p => ({ ...p, enabled: true }))
  const customs = loadCustomBannedPatterns().map(p => ({ ...p, enabled: p.enabled !== false }))

  // 自定义规则中与默认同名（pattern 相同）的替换默认
  const customPatterns = new Set(customs.map(c => c.pattern))
  const merged = defaults
    .filter(d => !customPatterns.has(d.pattern)) // 移除被自定义覆盖的默认
    .concat(customs)

  // 只返回启用的规则，自定义规则置顶，然后按 level 降序
  return merged.filter(p => p.enabled !== false).sort((a, b) => {
    const aCustom = a.category === '自定义' ? 0 : 1
    const bCustom = b.category === '自定义' ? 0 : 1
    if (aCustom !== bCustom) return aCustom - bCustom
    return b.level - a.level
  })
}

// ==================== 句式套路检测 ====================

/** Gate B: AI 常用句式套路 */
export const SENTENCE_PATTERNS = [
  { name: '无情绪否定纠正(不是A而是B)', pattern: /(?:不是|并非|并不是|绝不是|并不是说|不能说|与其说).{1,20}(?:而是|就是|才是|应当是|不如)/g, fix: '无情绪的"不是A而是B"是AI味。加情绪词改写为："竟然是A，不是B""我就知道是A，而不是B""搞了半天是A"——或改为先肯定B再否定A的顺序' },
  { name: 'AI碎片白描(结果在…)', pattern: /^结果.{0,15}(?:之前|之后|的时候).{0,10}(?:停|断|没|空|消失)/gm, fix: '合并到前一句，或扩展为有具体信息的完整句子' },
  { name: '极短独段(1-4字)', pattern: /(?:^|\n\n)[^。！？\n]{1,4}。\s*(?:\n\n|$)/gm, fix: '极短独段是AI假装分镜——零信息、零情绪。除非此处确实需要一个强节奏停顿，否则融进前后句', enabled: true },
  { name: '带着…万能状语', pattern: /，带着.{1,8}(?:的)?/g, fix: '拆成短句，或换具体动作' },
  { name: '仿佛/犹如比喻', pattern: /(?:仿佛|犹如|宛若).{2,15}(?:一般|一样)/g, fix: '删除比喻，直接白描' },
  { name: '总结升华结尾', pattern: /(?:他终于明白|她这才意识到|此刻.{2,10}终于|原来.{2,15}才是)/g, fix: '用动作或对话收尾' },
  { name: '章末预告', pattern: /(?:他不知道的是|更大的.{2,10}即将|(?:这件事|一切|结局|命运).{0,3}注定)/g, fix: '用具体钩子物件/事件收束' },
  { name: '三连修饰', pattern: /(?:微微|淡淡|轻轻|缓缓|一丝|一抹|些许|几分)(?:.{0,5})(?:微微|淡淡|轻轻|缓缓|一丝|一抹|些许|几分)/g, fix: '去掉修饰词，直接写核心动作' },
  // 深层伪文学模式
  { name: '潜台词显式化', pattern: /(?:意思是|也就是说|这意味着|换句话说|说白了)/g, fix: '删掉解释句，动作本身已传达' },
  { name: '装饰性否定修正', pattern: /(?:不是|并非)\S{1,5}[，,]\S{1,5}(?:是|而是)/g, fix: '加情绪词或改顺序：先肯定后否定（"是B，不是A"），或加"竟然/原来/我就知道"' },
  { name: '破折号节奏装饰', pattern: /——(?:带着|也不敢|或者说|更像是|仿佛|像是)/g, fix: '删破折号，用正常句子。破折号仅用于真正的信息中断' },
  { name: '连续单句成段(3段以上)', pattern: /(?:^[^。]{1,15}。$\r?\n){3,}/gm, fix: '合并短句或扩展信息量，连续单句段不超过2' },
  { name: '抽象情绪收束', pattern: /(?:像某种|像是.{2,10}(?:一样|似的)|仿佛.{2,15}(?:一般|一样|了))/g, fix: '换成具体动作或感官细节' },
]

/** Gate C: 心理描写 = 告诉而非展示 */
export const TELLING_PATTERNS = [
  { pattern: /他(感到|觉得|认为|明白|知道|意识到|发现|终于明白)/g, name: '心理告知' },
  { pattern: /(紧张|害怕|愤怒|兴奋|激动|悲伤|绝望|幸福|心痛|委屈)地/g, name: '情绪副词' },
  { pattern: /内心(充满了|充满了|涌起了|感到|一阵)/g, name: '内心陈述' },
  { pattern: /(眼中|嘴角|脸上|心底)(闪过|勾起|浮现|泛起|涌起)/g, name: '面部AI描写' },
  { pattern: /(深吸一口气|缓缓|微微|轻轻|淡淡)(地)?/g, name: '弱化副词堆砌' },
  // 深层伪文学模式
  { pattern: /(?:意思是|也就是说|这意味着|换句话说|说白了|潜台词[是就])/g, name: '潜台词翻译' },
  { pattern: /(?:不是|并非)\S{1,5}[，,]\S{1,5}(?:是|而是)/g, name: '装饰性否定' },
  { pattern: /——(?:带着|也不敢|或者说|更像是)/g, name: '破折号节奏装饰' },
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
${DEFAULT_BANNED_PATTERNS.map(p => `- "${p.pattern}"（${p.category}）`).join('\n')}

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

// ==================== Phase 2: 改写 ====================

/** 构建包含风格边界的改写 system prompt */
export function buildStyledRewriteSystem(styleContext?: string, personalityContext?: string): string {
  const parts: string[] = [
    '你是网文润色专家。将AI味浓重的文本改写为自然的网文风格。',
    '',
    '## 改写铁律',
    '',
    '### 原则 1：改最少，效果最大',
    '- 能改一个词就不改一句',
    '- 能删一句就不重写一段',
    '- 没有问题的句子尽量保留原句',
    '- 人名、地名、数字、专有名词优先保留',
    '',
    '### 原则 2：保留创作意图',
    '- 只改"怎么说"，不改"说什么"',
    '- 剧情、人设、情节走向一概不动',
    '- 不新增原文没有的情节、设定、关系',
    '- 如果原文有逻辑问题，那不是去AI味的活',
    '',
    '### 原则 3：自然化改造',
    '',
    '**禁用词替换**：',
    DEFAULT_BANNED_PATTERNS.slice(0, 15).map(p => `- "${p.pattern}" → "${p.replacement}"`).join('\n'),
    '',
    '**句式改造**：',
    '- 连续排比 → 保留1-2个，第三个改为不同句式',
    '- 段落整齐 → 拆1-2个独句成段',
    '- "带着…带着" → 第二个改为不同动词',
    '',
    '**心理描写改造**：',
    '- "他感到紧张" → "手心全是汗"',
    '- "他愤怒地" → "一拳砸在桌上"',
    '- "心中涌起" → 直接写动作或对话',
    '',
    '**对话自然化**：',
    '- 删除60%以上的对话标签，用动作代替',
    '- 如："你好，"他说 → 他抬起头。"你好。"',
    '- 增加口语词："嘶""靠""啧""行吧""那个…"',
    '- 对话留潜台词，不要把所有想法都说出来',
    '',
    '**结尾处理**：',
    '- 删除总结式结尾',
    '- 改用动作或对话收尾',
    '- 结尾留白，给读者想象空间',
    '',
    '**潜台词修复**：',
    '- "意思是走。走。" → "那就走。" / "我跟了上去。"（动作+反应=两拍，不要三拍）',
    '- "不是土，是灰。" → 直接写"灰"（无信息增量的否定→删除否定，直接写后者）',
    '- 段末"他终于明白…" → 删除。如果动作已表达，不需要总结',
    '',
    '**破折号修复**：',
    '- "风吹过废墟——带着铁锈味" → "风吹过废墟，带着铁锈味"（逗号足够）',
    '- "他没回头——也不敢回头" → "他没回头。不敢。"（句号更诚实）',
    '- 删除所有非信息中断的破折号，用逗号或句号替代',
    '',
    '**单句段落修复**：',
    '- "很冷。特别冷。冷得骨头疼。" → "冷得骨头疼。"（一句到位，不要三连）',
    '- 合并连续单句段，信息量不足的删除',
    '',
    '**忍住不解释检查清单**：',
    '- 如果一句话在翻译上一句的潜台词 → 删掉',
    '- 如果"不是X，是Y"中X和Y读者都已经知道 → 删掉否定，直接写Y',
    '- 如果段末用"像某种/仿佛一切/终于/从此"收束 → 删掉',
    '- 如果破折号两侧没有信息转折 → 换成逗号或句号',
    '',
    '**感官写作检查**：',
    '- 视角是否始终在角色感官里？（看到什么/闻到什么/碰到什么）',
    '- 有没有"作者跳出来装气氛"的句子？→ 删掉',
    '- 情绪是否通过动作和物体体现，而非抽象总结？→ 如果不是，改写',
    '',
    '## 输出要求',
    '直接输出改写后的完整文本。不要输出改写说明，不要标注改动位置。',
    '',
    NATURAL_BENCHMARK,
  ]

  // 注入风格边界
  if (styleContext?.trim()) {
    parts.push(
      '',
      '---',
      '',
      '## ⚠️ 风格边界（你只能在这个范围内改写）',
      '',
      '以下是你从参考小说中提取的风格约束。改写时必须遵守这些边界——不允许使用边界之外的写法。',
      '',
      styleContext,
    )
  }

  // 注入人格指纹
  if (personalityContext?.trim()) {
    parts.push(
      '',
      '---',
      '',
      '## 🧠 人味材料池',
      '',
      '以下是你从参考文本中提取的人味指纹。改写时从这里取材料——这些意象、怪癖、修辞是你的工具箱，不允许使用工具箱之外的套路化表达。',
      '',
      personalityContext,
    )
  }

  return parts.join('\n')
}

/** 默认改写 system（无风格/人格时使用） */
export const DESLOP_REWRITE_SYSTEM = buildStyledRewriteSystem()

export const DESLOP_REWRITE_USER = (
  text: string,
  severity: string,
  opts?: { styleContext?: string; personalityContext?: string; targetParagraphs?: number[]; detectedPatterns?: string[] }
) => {
  const severityGuide: Record<string, string> = {
    '轻度': '请对文本进行轻度去AI味处理。主要修改：禁用词替换 + 减少对话标签。保留90%以上的原文结构和内容。',
    '中度': '请对文本进行中度去AI味处理。主要修改：禁用词替换 + 句式多样化 + 对话自然化 + 心理描写动作化。保留80%以上的原文内容。',
    '重度': '请对文本进行重度去AI味处理。完整过6 Gate：禁用词替换 + 句式重构 + 心理描写动作化 + 对话腔调自然化 + 结尾处理 + 节奏调节。保留70%以上的原文核心内容，但可以大幅调整句式和段落。',
  }

  let instruction = severityGuide[severity] || severityGuide['中度']

  // 注入具体检测到的模式——硬性要求逐一消除
  if (opts?.detectedPatterns && opts.detectedPatterns.length > 0) {
    const uniquePatterns = [...new Set(opts.detectedPatterns)].slice(0, 20)
    instruction += `\n\n🔴 以下AI写作痕迹已被检测到——必须全部消除，一条不留：\n${uniquePatterns.map(p => `- ${p}`).join('\n')}`
    instruction += `\n\n消除规则：\n1. 禁用词/禁用句式 → 找到并替换为日常表达\n2. 破折号 → 改用句号或逗号连接\n3. "不是...而是" → 改为直接陈述\n4. 每个标记处都必须修改，不能跳过\n5. 修改后重新检查，确保没有任何残留`
  }

  // 定点改写
  if (opts?.targetParagraphs && opts.targetParagraphs.length > 0) {
    instruction += `\n\n⚠️ 只改写第 ${opts.targetParagraphs.map(i => i + 1).join('、')} 段。其他段落保持原样不动。输出时请用 [DESLOP_PARA_END] 标记每段结束。`
  }

  // 风格边界提醒
  if (opts?.styleContext?.trim()) {
    instruction += '\n\n⚠️ 所有改写必须在以下风格边界内进行，不允许越界：\n' + opts.styleContext.slice(0, 800)
  }

  // 人格材料提醒
  if (opts?.personalityContext?.trim()) {
    instruction += '\n\n⚠️ 从以下人味材料池取意象和修辞，不使用材料池之外的套路表达：\n' + opts.personalityContext.slice(0, 500)
  }

  return `${instruction}

原文：
---
${text.slice(0, 8000)}
---

请直接输出改写后的全文，不要任何额外解释。`
}

// ==================== 段落分析 ====================

/** 按空行分段 */
export function splitParagraphs(text: string): { index: number; text: string }[] {
  return text
    .split(/\n\n+/)
    .map((p, i) => ({ index: i, text: p.trim() }))
    .filter(p => p.text.length > 0)
}

/** 单段 AI 味评分 */
export function scoreParagraph(para: string, patterns?: BannedPattern[]): { score: number; hits: string[] } {
  const effectivePatterns = patterns || getEffectivePatterns()
  const hits: string[] = []
  let score = 0

  for (const bp of effectivePatterns) {
    try {
      const regex = new RegExp(bp.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      const matches = para.match(regex)
      if (matches && matches.length > 0) {
        hits.push(bp.pattern)
        score += matches.length * bp.level
      }
    } catch { /* 无效正则跳过 */ }
  }

  // 也检查句式套路
  for (const sp of SENTENCE_PATTERNS) {
    if ((sp as any).enabled === false) continue
    try {
      sp.pattern.lastIndex = 0 // 重置 lastIndex，防止多段落循环时污染
      if (sp.pattern.test(para)) {
        hits.push(`[句式]${sp.name}`)
        score += 5
      }
    } catch { /* 无效正则跳过 */ }
  }

  return { score, hits }
}

/** 对全文所有段落评分 */
export function scoreAllParagraphs(text: string): ParagraphScore[] {
  const patterns = getEffectivePatterns()
  return splitParagraphs(text).map(({ index, text: paraText }) => {
    const { score, hits } = scoreParagraph(paraText, patterns)
    return { index, text: paraText, score, hits }
  })
}

// ==================== 确定性修复（immutable paragraph pipeline） ====================

/** 确定性修复：对段落数组做 immutable transform，逐段替换禁用词。
 *  不再需要位置索引——直接对段落文本做 split→replace→join。 */
export function deterministicFixParagraphs(
  paragraphs: { index: number; text: string }[],
  patterns?: BannedPattern[]
): { paragraphs: { index: number; text: string }[]; replaced: { pattern: string; replacement: string; count: number }[] } {
  const effective = patterns || DEFAULT_BANNED_PATTERNS
  const replaced: { pattern: string; replacement: string; count: number }[] = []

  const fixed = paragraphs.map(p => {
    let text = p.text
    for (const bp of effective) {
      if (bp.enabled === false) continue
      if (!text.includes(bp.pattern)) continue

      let effectiveReplacement: string | null = null
      const r = bp.replacement

      if (['说', '看到', '笑了', '皱眉', '愣了下', '瞪大眼', '挥手', '接着', '就是', '已经', '没', '小声说'].includes(r)) {
        effectiveReplacement = r
      } else if (r.includes('删掉') || r === '删' || r.includes('删除')) {
        effectiveReplacement = ''
      } else if (r.includes('句号或逗号')) {
        effectiveReplacement = '，'
      } else if (r.includes('胸口')) {
        effectiveReplacement = r
      } else {
        continue // AI 才能处理的，跳过
      }

      const before = text
      text = text.split(bp.pattern).join(effectiveReplacement)
      if (text !== before) {
        const escaped = bp.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const matches = before.match(new RegExp(escaped, 'g'))
        const count = matches ? matches.length : 1
        replaced.push({ pattern: bp.pattern, replacement: effectiveReplacement, count })
      }
    }
    return { index: p.index, text }
  })

  return { paragraphs: fixed, replaced }
}

// ==================== 批量 AI 改写 ====================

/** 构建批量改写 prompt：3-5 段一组，标注 [PARA_N]，用 [PARA_END] 分隔输出 */
export function buildBatchRewritePrompt(
  badParas: { index: number; text: string; issues: string[] }[]
): string {
  const sections = badParas.map((p, i) =>
    `[PARA_${i + 1}] 原文：
${p.text}

命中问题：${p.issues.join('、')}

请输出修改后的段落（只输出修改后的文本，不要解释）：`
  ).join('\n\n---\n\n')

  return `你有 ${badParas.length} 个段落需要修改。每个段落原文和问题如下。请逐个修改后输出，用 [PARA_END] 分隔每个修改后的段落。

改写规则：
1. 禁用词 → 替换为日常口语表达
2. 破折号（——）→ 改用句号或逗号连接
3. "不是...而是"（无情绪版本）→ 加情绪词或改为先肯定后否定
4. 每处标记的问题都必须修改，不能跳过
5. 保持原文的剧情、人设、情节不变——只改"怎么说"，不改"说什么"
6. 不要为了"写得好"而添加原文没有的修饰

${sections}

重要：只输出修改后的段落文本，用 [PARA_END] 分隔。不要输出原文。不要解释。`
}

// ==================== 轻量完整性检查 ====================

/** 轻量完整性检查：段落是否真的被修改了。
 *  不做语义判断——只做内容级 + 简单 hash 对比。
 *  用途：防止 AI 返回与原文完全相同的文本（"假修改"检测）。 */
export function verifyParagraphRewrite(original: string, rewritten: string): { changed: boolean; hashChanged: boolean } {
  const trimmedOrig = original.trim()
  const trimmedNew = rewritten.trim()
  const changed = trimmedOrig !== trimmedNew
  // 简单 hash：长度 + 首尾各10字符的快照
  const origHash = `${trimmedOrig.length}:${trimmedOrig.slice(0, 10)}:${trimmedOrig.slice(-10)}`
  const newHash = `${trimmedNew.length}:${trimmedNew.slice(0, 10)}:${trimmedNew.slice(-10)}`
  const hashChanged = origHash !== newHash
  return { changed, hashChanged }
}

// ==================== 原有类型 ====================

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
  paragraphScores: ParagraphScore[]
}

/** 确定性替换——用代码直接替换，不依赖 AI */
export function deterministicReplace(text: string, patterns?: BannedPattern[]): { text: string; replaced: number; skipped: string[] } {
  const effective = patterns || DEFAULT_BANNED_PATTERNS
  let result = text
  let replaced = 0
  const skipped: string[] = []
  for (const p of effective) {
    if (p.enabled === false) continue
    if (!text.includes(p.pattern)) continue
    const r = p.replacement
    let effectiveReplacement: string | null = null

    // ① 真正可替换的简单词 → 直接替换
    if (['说', '看到', '笑了', '皱眉', '愣了下', '瞪大眼', '挥手', '接着', '就是', '已经', '没', '小声说'].includes(r)) {
      effectiveReplacement = r
    }
    // ② （删掉）类 → 替换为空字符串
    else if (r.includes('删掉') || r === '删') {
      effectiveReplacement = ''
    }
    // ③ （删除）类 → 替换为空字符串
    else if (r.includes('删除')) {
      effectiveReplacement = ''
    }
    // ④ 标点替换
    else if (r.includes('句号或逗号')) {
      effectiveReplacement = '，'
    }
    // ⑤ 语义替换（如 胸口起伏了一下）
    else if (r.includes('胸口')) {
      effectiveReplacement = r
    }
    // ⑥ 其余为 AI 处理项（如 用动作展示领悟/换成具体描写）
    else {
      skipped.push(p.pattern)
      continue
    }

    const before = result.length
    result = result.split(p.pattern).join(effectiveReplacement)
    if (result.length !== before) replaced++
  }
  return { text: result, replaced, skipped }
}

/** 本地快速扫描，不需要调用 AI */
export function localScan(text: string): DeslopLocalReport {
  const words = text.length
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim())
  const totalSentences = text.split(/[。！？.!?]/).filter(s => s.trim()).length
  const avgSentPerPara = paragraphs.length > 0 ? totalSentences / paragraphs.length : 0

  // 使用动态生效规则
  const effectivePatterns = getEffectivePatterns()

  // Gate A: 禁用词检测
  const bannedHits = effectivePatterns.map(bp => {
    try {
      const regex = new RegExp(bp.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      const matches = text.match(regex)
      return { pattern: bp.pattern, count: matches ? matches.length : 0, category: bp.category }
    } catch { return { pattern: bp.pattern, count: 0, category: bp.category } }
  }).filter(h => h.count > 0)

  const totalBannedHits = bannedHits.reduce((sum, h) => sum + h.count, 0)
  const bannedDensity = words > 0 ? (totalBannedHits / words) * 1000 : 0

  // Gate B: 句式套路
  const sentencePatternHits: string[] = []
  SENTENCE_PATTERNS.forEach(sp => {
    if ((sp as any).enabled === false) return
    try {
      sp.pattern.lastIndex = 0 // 重置，防止跨段落/跨扫描污染
      if (sp.pattern.test(text)) sentencePatternHits.push(sp.name)
    } catch { /* 无效正则跳过 */ }
  })
  const hasParallelism = false  // 连续排比检测已移除（误判率高），改用句式多样性综合判断

  // Gate C: 心理描写
  let tellingCount = 0
  TELLING_PATTERNS.forEach(tp => {
    const matches = text.match(tp.pattern)
    if (matches) tellingCount += matches.length
  })
  const hasTelling = tellingCount > 2

  // Gate D: 节奏均匀
  const hasUniformRhythm = avgSentPerPara >= 3 && avgSentPerPara <= 6 && paragraphs.length > 5

  // 段落评分
  const paragraphScores = scoreAllParagraphs(text)

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
    hasUniformRhythm, paragraphScores,
  }
}
