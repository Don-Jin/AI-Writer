/**
 * 小说生成 Prompt 体系 v2
 * 基于 oh-story-claudecode 方法论重构
 *
 * 核心信念：套路 = 确定性的情绪满足
 * 不是从灵感出发，而是从情绪出发，用验证过的模式可靠地交付情绪
 *
 * Phase 1: 选题方向（情绪→题材匹配）
 * Phase 2: 核心设定（世界观+角色位抽象+剧情线）
 * Phase 3: 大纲搭建（爽点分布+情绪弧线+钩子设计）
 * Phase 4: 细纲规划（章节节奏+高潮低谷交替）
 * Phase 5: 正文写作（模块化组装+上下文分层+去AI味写作）
 */

import { getEffectivePatterns } from './deslop'

/** 构建生成时注入的禁用词清单。使用 getEffectivePatterns() 合并默认规则 + 用户自定义规则。 */
export function buildBannedWordsInjection(): string {
  const allPatterns = getEffectivePatterns()
  const words = allPatterns
    .filter(p => p.level >= 2)
    .map(p => p.pattern)
  const unique = [...new Set(words)]
  const customCount = allPatterns.filter(p => p.category === '自定义').length
  const extra = customCount > 0 ? `（含 ${customCount} 条自定义规则）` : ''
  return `【⛔ 禁用词——生成时绝对不能使用】${extra}
${unique.join('、')}

=== 结构级禁令 ===
❌ 禁止**无情绪的**"否定A、肯定B"句式。问题不在于"不是A而是B"这个结构本身——问题在于**面无表情**地用它。
以下是无情绪版本（禁止）：
❌ "不是X，而是Y。"（机器人纠错）
❌ "并非X，而是Y。"（论文口吻）
❌ "不能说X，只能说Y。"（教科书语气）

以下是**有情绪标记**的版本，可以保留：
✅ "竟然是X，而不是Y。"（意外）
✅ "我就知道是X，不是Y。"（早有预感）
✅ "搞了半天是X啊，白折腾了。"（情绪化口语）
✅ 先肯定B再否定A：先说正确的事，再解释不是之前以为的——这个顺序更自然

核心规则：如果你的"不是A而是B"读起来像老师在批改作业，删掉重写。
如果你加一个情绪词（竟然、果然、搞了半天、我就知道、妈的、原来…）让人能听出说话人的态度，保留。

=== 语调禁令 ===
❌ 禁止白描作为叙事语调。白描就是"不加判断地记录发生了什么"——记录员式的纯陈述句，没有角色视角，没有情绪，没有态度。
以下语调是白描，禁止：
❌ "他倒了杯水。杯子放在桌上。窗外是夜空。"（记录员在写事件列表）
✅ "他倒了杯水，没喝。杯子握在手里，凉的。"（有情绪的人在经历事情）
区别：白描是记录事件。不是白描是让读者感受到角色的体验。
一句话测试：这句话换任何一个角色说/想，会有不同吗？不会 → 白描 → 删掉重写。

⚠️ 标点硬规则：全文禁止使用破折号（——）。用句号（。）或逗号（，）连接句子。`
}

/**
 * 构建统一执行约束块 — 注入 CHAPTER_SYSTEM 顶部
 * 将禁用词/风格/人格压缩为可执行的短规则 + 替换示例
 */
export function buildExecutionConstraints(
  styleContext?: string,
  personalityContext?: string,
): string {
  // ===== 禁词铁律（最致命的10条，每条带替换） =====
  const allPatterns = getEffectivePatterns()
  const critical = allPatterns
    .filter(p => p.level >= 4)
    .slice(0, 10)
  const bannedLines = critical.map(p =>
    `❌ "${p.pattern}" → ✅ ${p.replacement}`
  ).join('\n')

  // ===== 风格铁律（压缩为3-5条，兼容V3和V4格式）=====
  let styleRules = ''
  if (styleContext) {
    const lines = styleContext.split('\n')
    // V4 格式：提取 📏 规则： 开头的行
    const v4Rules = lines
      .filter(l => l.startsWith('📏 规则：'))
      .map(l => l.replace('📏 规则：', '📏 '))
      .slice(0, 5)
    if (v4Rules.length > 0) {
      styleRules = '\n## 风格铁律（从风格库提取的5条核心规则，其余在材料池中查看）\n' + v4Rules.join('\n')
    } else {
      // V3 回退：提取 - 使用/- 禁止 开头的行
      const hardLines = lines
        .filter(l => l.startsWith('- ') && (l.includes('使用') || l.includes('禁止') || l.includes('≤') || l.includes('≥') || l.includes('禁用')))
        .slice(0, 5)
      if (hardLines.length > 0) {
        styleRules = '\n## 风格铁律（只取最核心的5条，其余在材料池中查看）\n' + hardLines.join('\n')
      }
    }
  }

  // ===== 人格铁律（提取 V2 替换器的 principle，回退 V1 格式）=====
  let personalityRules = ''
  if (personalityContext) {
    const lines = personalityContext.split('\n')
    // V2 格式：提取 📏 开头的 principle 行
    const v2Rules = lines
      .filter(l => l.trim().startsWith('📏'))
      .map(l => l.trim())
      .slice(0, 5)
    if (v2Rules.length > 0) {
      personalityRules = '\n## 人格铁律（从人格库提取的核心行为替换规则，其余在材料池中查看）\n' + v2Rules.join('\n')
    } else {
      // V1 回退：提取 - 开头的长行
      const hardLines = lines
        .filter(l => l.startsWith('- ') && l.length > 15)
        .slice(0, 5)
      if (hardLines.length > 0) {
        personalityRules = '\n## 人格铁律（只取最核心的5条，其余在材料池中查看）\n' + hardLines.join('\n')
      }
    }
  }

  return `
## 副零层：写作边界铁律（优先级同视角铁律，覆盖以下所有层）

本章所有文字必须在以下边界内写作。触碰边界 = 违规。

### 禁词铁律——以下词汇和句式绝对不能出现在正文中
生成正文时，每写一句话后检查是否包含以下任何一项。包含 → 立即重写该句。

${bannedLines}

### 结构铁律（写完后逐条自检）
❌ 禁止无情绪否定纠正("不是A，而是B"——除非加了情绪词如"竟然是/原来是/搞了半天")
❌ 禁止白描语调（每句话都要有角色视角/情绪/判断）
❌ 禁止破折号（——）——用句号或逗号
❌ 禁止超过60字的长句
❌ 禁止连续3段以上相同句式
${styleRules}
${personalityRules}

### 执行规则——比情节点更优先
1. 写完一段后，回读检查是否触犯以上任何铁律
2. 触发 → 重写该段，不计入字数
3. 风格库/人格库中的完整材料池在 prompt 后半部分，需要取具体意象/对话模式/修辞时从那里查询
4. 情节点必须完成，但不能以违反铁律为代价——如果某个情节点难以在不违规的前提下写出，用更含蓄的方式处理
`
}

// ==================== 大纲标准化 ====================

export const OUTLINE_NORMALIZE_SYSTEM = `你是大纲结构标准化助手。阅读用户提供的故事大纲文本，将其重写为标准格式。

## 输出格式

### 一、分卷结构规划
将全书划分为若干卷（建议4-8卷）。每卷详细说明：
- **卷标题**（10字以内）+ **章节范围** + **预估字数**
- **本卷功能**：在全书中的结构作用
- **核心事件**：本卷要完成的主要剧情（100-150字）
- **起始状态 → 结束状态**：主角在本卷开头和结尾的身份/能力/处境变化
- **情绪弧线形状**：V形/W形/递进形/急转形/阶梯形
- **感情线追踪**：本卷中核心关系的状态
- **信息释放节奏**：关键信息按卷标注公开度百分比

### 二、全书字数规划
- 全书目标总字数（40-80章 × 3000-5000字/章） + 每卷字数分布

### 三、时间线定义
- 如果故事涉及多条时间线，分别标注名称、类型、起点卷
- 单条时间线填"仅主线"

### 四、情绪弧线设计
- 全书情绪曲线 + 关键爽点/泪点/燃点位置

### 五、钩子设计与伏笔地图
- 5-10个跨卷伏笔，标注埋设位置和回收位置

### 六、人物弧线总览
- 每个核心角色：起点状态→终点状态→弧线轨迹

### 七、主题线与核心冲突

### 八、分章规划框架
- 15-25个关键剧情节点

## 核心规则
1. 只重写格式和结构，不要修改用户的剧情、角色、设定
2. 保留所有原文信息，只是按标准结构重新组织
3. 如果原文缺少某些信息，标注【待补充】而不是编造
4. 输出完整 Markdown，不要省略任何部分`

export const OUTLINE_NORMALIZE_USER = (outlineContent: string) =>
  `请将以下故事大纲标准化为上述格式：

---
${outlineContent.slice(0, 8000)}
---

输出标准化后的大纲。`

// ==================== Phase 1+2: 准备阶段 ====================

export const PREPARE_SYSTEM = `你是网络小说创作教练。你的任务是帮作者从零开始准备一本长篇网络小说。

## 核心方法

我们写网文**不是从灵感出发，而是从情绪出发**：
1. 先定情绪目标 — 你想让读者什么感觉？
2. 从验证过的模式出发 — 什么被市场验证有效？
3. 用模块组装 — 不要重新发明，用验证过的剧情模式
4. 做角色位抽象 — 把对标书的角色抽象为功能位，映射到你自己的角色

## 情绪→题材对照
| 情绪目标 | 推荐题材 |
|---------|---------|
| 爽感释放 | 打脸逆袭/重生复仇/都市爽文 |
| 震撼+痛快 | 身份反转/扮猪吃虎/隐藏大佬 |
| 意难平 | 感情拉扯/虐恋/破镜重圆 |
| 紧张+好奇 | 悬疑惊悚/探案/末世生存 |
| 期待感 | 日常装逼/系统文/诸天流 |
| 热血+感动 | 少年成长/电竞/竞技体育 |
| 诗意+余味 | 仙侠/文艺向都市/古风`

export const PREPARE_USER = (title: string, description: string) => `请帮我准备小说《${title}》的创作方案。

${description ? `作者的初步想法：${description}` : ''}

请按以下结构输出（Markdown 格式）：

## 一、情绪定位
- 这本书想让读者产生什么核心情绪？（从情绪对照表中选择）
- 这个情绪在什么类型的场景中最容易被触发？

## 二、题材匹配
- 根据情绪推荐 1-2 个最合适的题材方向
- 每个方向给出 2-3 条市场上的成功模式

## 三、核心梗（一句话卖点）
- 用一句话概括这个故事最吸引人的地方
- 这个梗的"钩子"在哪里？（读者为什么想看）

## 四、角色设计
- **主角**：姓名、身份、核心欲望、关键缺陷、独特能力/金手指
- **对手/反派**：核心对抗面、与主角的关系
- **核心盟友**（1-2人）：功能定位、与主角的关系
- 用"角色位抽象"方式：每个角色标注ta在故事中的功能位（如"催化剂""镜像对手""导师"）

## 五、世界观框架
- 时代/世界背景（100字）
- 核心规则/力量体系（如果有）
- 世界观的"钩子"在哪里？（有什么独特之处？）

## 六、对标分析
- 有没有类似的成功作品？
- 对标书的哪些套路可以借鉴？哪些需要差异化？

请直接给出具体、可操作的内容，不要泛泛而谈。`

// ==================== Phase 3: 大纲生成 ====================

export const OUTLINE_SYSTEM = `你是资深网文故事架构师。为长篇网络小说设计完整的故事大纲。

## 核心信念
**套路 = 确定性的情绪满足**。大纲必须服务于情绪目标。

## 大纲结构（用 Markdown 二级标题分隔）

### 基本信息
- 书名、题材、目标平台、预计总字数、主角
- **核心梗**：一句话概括全书最核心的冲突和看点

### 一、分卷结构规划
将全书划分为若干卷。每卷详细说明：

⚠️ **卷章计算规则**：
- 如果用户提供了目标字数：卷数 = 目标字数 ÷ 30000（每卷10章×3000字），向上取整
  - 例：200万字 → 67卷，100万字 → 34卷，50万字 → 17卷
- 如果用户未提供目标字数：根据故事情节的复杂度自行判断合理篇幅，在20-100卷之间
- 每卷固定10章（可配置），每章3000字，每卷3万字
- 高潮卷可稍长，过渡卷保持10章
- 卷概要每条50-100字，标注卷功能和关键高潮
- **每5-7卷标注一个大高潮节点**（全书层面的情绪顶点）

- **卷标题**（10字以内）+ **章节范围** + **预估字数**
- **本卷功能**：在全书中的结构作用
- **核心事件**：本卷要完成的主要剧情（100-150字）
- **起始状态 → 结束状态**：主角在本卷开头和结尾的身份/能力/处境变化。⚠️ 每卷的起始状态必须等于上一卷的结束状态。如果卷2开始是"隐藏身份的实习生"，卷1结束就必须是"隐藏身份的实习生"。
- **情绪弧线形状**：V形/W形/递进形/急转形/阶梯形 — 标注关键转折点
- **感情线追踪**：核心关系的进展。不用数字，用事件锚定——"直到【具体事件】发生前，关系保持在【阶段】；事件后升级为【新阶段】。"
- **信息释放节奏**：不用百分比，用触发事件锚定——"世界观真相在【XX事件】首次暗示，在【YY事件】正式揭露。"
- **全书级禁区清单**：标注"全书前X%禁止出现以下内容"，如"全书前50%禁止揭示终极真相"、"前3卷禁止凌瑶身份暴露"

### 二、全书字数规划
- 如果用户提供了目标字数，严格按目标规划：卷数 = 目标字数 ÷ 30000（向上取整）
- 如果用户未提供目标字数，根据故事内容自行判断合理篇幅
- 每卷 3 万字（10章×3000字），高潮卷可稍长
- 每章 3000-5000 字

### 三、时间线定义（如果故事涉及多条时间线）
- 每条时间线的名称、类型（主线/闪回/并行/倒叙/预叙）、起点卷
- 各时间线的时间关系（如"主线第1天 = 回忆线第-1095天(三年前)"）
- 单条时间线填"仅主线"即可

### 四、情绪弧线设计
- 全书情绪曲线形状描述 + 每卷情绪弧线形状
- 标注关键情绪高点（爽点/泪点/燃点）的章位
- 爽点密度分布：前密后疏/均匀分布/阶段性爆发

### 五、钩子设计与伏笔地图
**钩子设计**（每5-10章一个，类型交替使用）：
- 悬念钩子 / 冲突钩子 / 身份钩子 / 成长钩子 / 关系钩子

**伏笔地图**（跨卷的关键伏笔）：
列出全书5-10个最重要的伏笔，每个伏笔标注：
- 伏笔内容（一句话描述）
- 埋设位置（第几卷/第几章附近）
- 回收位置（第几卷/第几章附近）——⚠️ 每个伏笔必须有明确的回收位置，埋了不回收的伏笔不要列出来
- 重要程度（核心/重要/点缀）
- 跨几卷（1=卷内回收，2+=跨卷伏笔）
- 自检：埋设总数 = 回收总数。如果某个伏笔没有回收计划，删掉它。

### 六、人物弧线总览
每个核心角色独立说明：
- 角色名 + 功能位（主角/对手/导师/催化剂/镜像对手等）
- **起点状态**：故事开始时的身份/性格/处境。必须用一句话具体描述 + 一个标志性场景（如"开场时他在天台上准备跳下去——不是自杀，是测试飞行器"）
- **终点状态**：故事结束时的身份/性格/处境。同样必须具体 + 标志性场景
- **弧线轨迹**：分卷描述角色变化的关键转折点。每个转折点必须标注触发事件——"因为XX事件，他从A变成了B"
- **核心欲望**与**内在缺陷**的对抗过程

### 七、主题线与核心冲突
- **主题线**：本书要探讨的核心主题（如"力量与责任""自由与羁绊"），并说明该主题在各卷中的演化
- **外部冲突**：人与环境/人与人的对抗层次（从个人对抗→群体对抗→终极对抗的递进）
- **内部冲突**：主角欲望vs恐惧、责任vs自由的具体表现及解决过程

### 八、分章规划框架
- 列出15-25个关键剧情节点的章节位置和功能
- 标注每个节点对应的卷归属
- 标注大高潮位置（每卷至少1个）

## 写作要求
- 用中文写作，语言具体有画面感
- 如果有拆文库：标注哪些设计借鉴了参考书（钩子类型/爽点节奏/角色功能位/冲突模式）
- 如果有设定库：标注哪些角色映射自设定库，世界观框架的参考来源
- 每部分标注具体章节/卷位置
- 伏笔地图必须跨卷标注
`

export const OUTLINE_USER = (
  title: string, description: string, prepareContent: string,
  styleContext: string, disassemblyContext: string,
  settingLibContext?: string, personalityContext?: string, cardContext?: string
) => {
  let prompt = `请为《${title}》生成完整的故事大纲。

${description ? `【作者初步想法】${description}` : ''}

【创作准备方案】
${prepareContent || '（请在准备阶段先完成创作方案）'}
`

  if (disassemblyContext) {
    prompt += `
【📚 拆文库学习——必须在设计中借鉴以下拆解分析】
${disassemblyContext}

⚠️ 请在大纲中逐条执行并标注借鉴来源：
1. **模仿钩子设计**：参考书的钩子类型 → 本书对应位置标注"借鉴自参考书XX钩子"
2. **复制爽点节奏**：参考书每几章一个爽点 → 本书按相同密度分配并在分章规划中标注
3. **角色位映射**：参考书核心角色功能位 → 本书安排对应角色并标注映射关系
4. **冲突模式借鉴**：参考书冲突类型和升级方式 → 本书采用并在分卷规划中标注
5. **文风锚定**：参考书的句式/对话/情绪特点 → 场景设计中匹配
`
  }

  if (settingLibContext) {
    prompt += `
【📋 设定库参考——人物阵容和世界观框架的素材池】
${settingLibContext}

⚠️ 请基于设定库设计本作的角色阵容和世界观框架。如果某角色是从设定库中某个角色演化而来，请标注"参考设定库XX角色"。
`
  }

  if (styleContext) {
    prompt += `
【写作风格要求】
${styleContext}
`
  }

  if (personalityContext) {
    prompt += `
【🧠 人格参考——角色设计的独特质感来源】
${personalityContext}

⚠️ 设计角色时参考以上人格指纹中的私人意象和情绪怪癖，为每个核心角色分配1-2个独特的私人意象和1个极端情绪下的反常反应。标注"角色X的意象来自人格库"。
`
  }

  if (cardContext) {
    prompt += `
【📖 已确立的事实簿——不可违反的硬规则】
${cardContext}

⚠️ 以上是本书已确立的核心事实。大纲中的角色、设定、规则必须与此一致，不得矛盾。
`
  }

  prompt += `

请按照 System Prompt 中的结构生成完整大纲。特别是：每卷标注情绪弧线形状和感情线追踪，伏笔地图跨卷标注，拆文借鉴处明确标注来源。`

  return prompt
}

// ==================== Phase 3.5: 卷纲生成 ====================

export const VOLUME_OUTLINE_SYSTEM = `你是小说结构规划师。根据大纲中「分卷结构规划」部分，为**当前这一卷**设计详细的卷纲。

## 卷纲结构

### 1. 基础信息
- volume_number/title/chapter_range/word_count_target（同现有格式）
- connection_prev/connection_next（承上启下，各50字以内）

### 2. 节点结构（nodes 数组，替代 detailed_summary）
根据本卷章节数自适应节点数量：≤20章用5-6个节点，20-40章用6-7个节点，≥40章用7-8个节点。不要在短卷里硬凑8个节点。

每个节点一个对象：
- **name**：节点名（开篇/发展/转折一/转折二/高潮/矛盾结果/转折三/结局——根据节点数选择合适的，不硬凑8个）
- **chapter_segment**：章段（如"第001-006章"）
- **task**：核心任务（一句话）
- **pacing**：节奏（快/中/慢/极快）
- **content**：具体情节设计（80-150字）。⚠️ 必须回答三个问题：谁做了什么 + 导致了什么具体变化 + 读者读完这一段最关心什么。不允许空洞描述——"发生了意外""情况更复杂"这种等于没写。
- **disasm_ref**：拆文借鉴——本节点借鉴了参考书的什么模式，如无则填"无"
- **setting_ref**：设定库参考——哪些设定库角色/世界观在本节点出场，如无则填"无"
- **info_quota**：本节点信息配额（如"最多揭示1个新设定，埋2个伏笔，禁止回收旧伏笔"）
- **node_forbidden**：本节点剧情禁区（如"禁止揭示反派真实动机""禁止引入新核心角色"）
- **emotion_limit**：感情线限制。不用数字，用事件锚定——"直到【X事件】发生之前，禁止肢体接触/表白"等

节点功能对照（5-8个自适应选择）：
| 节点 | 核心任务 | 默认节奏 | 必选 |
|------|---------|---------|------|
| 开篇 | 抓住读者，建立期待 | 快 | ✅ |
| 发展 | 递进事件推进情节，铺设伏笔 | 中 | ✅ |
| 转折 | 打破预期，拉升张力 | 快 | ✅ |
| 高潮 | 核心冲突正面对决 | 极快 | ✅ |
| 结局 | 收束本卷情感，为下卷铺垫 | 慢 | ✅ |
| 矛盾结果 | 解决矛盾，给读者喘息 | 慢 | 长卷可选 |
| 转折二 | 升级赌注，更深困境 | 快 | 长卷可选 |
| 转折三 | 最终转折，投最后一弹 | 快 | 长卷可选 |

### 2.5. 章概述（chapter_summaries）
为本章范围内的**每一章**写一段结构化概述。必须包含六个要素：
- **起承转合**：起因（为什么发生）→ 承接（怎么发展）→ 转折（打破预期的事件）→ 合（本章结束状态）
- **时间**：本章发生的时间锚点
- **地点**：本章涉及的关键场景
- **人物**：本章出场/涉及的核心角色
- **支线1-3**：本章涉及的副线（如有），没有就写"无"
- **事件1-3**：本章的 3 个关键事件，用"|"分隔

### 3. 爽点节奏
- cool_density：爽点密度描述（如"每章≥1微爽点/每3章1小冲突/每7章1大爽点"）+ 本卷预计大爽点数

### 4. 黄金五章对照（仅第一卷的节点1填写）
- golden_five：第1章(基础认知)→第2章(主线明确)→第3章(金手指展示)→第4章(拉仇恨/信息差)→第5章(第一个爽点闭环)

### 5. 节奏设计
- pacing_design/emotional_cadence（保留现有格式）

### 6. 伏笔操作
- foreshadowing_plant/payoff/advance（保留现有格式，优先参考大纲伏笔地图）

### 7. 人物弧线里程碑
- character_milestones（保留现有格式）

### 8. 关键冲突节点
- conflict_nodes/theme/key_events_str（保留现有格式）

### 9. 时间线上下文
- timeline_context: { current_day: 当前故事绝对天数（根据上下文推断）, days_covered: 本卷预计覆盖天数 }

## 输出格式
只输出一个 JSON 对象（不是数组），不要 markdown 代码块。

{
  "volume_number": 1, "title": "卷标题", "chapter_range": [1, 80], "word_count_target": 250000,
  "connection_prev": "全书开篇", "connection_next": "为第二卷埋下XX伏笔",
  "nodes": [
    {"name":"开篇","chapter_segment":"第001-006章","task":"抓住读者建立期待","pacing":"快","content":"[谁做了什么+导致什么变化+读者关心什么]","disasm_ref":"借鉴参考书XX钩子模式","setting_ref":"主角+世界观设定出场","info_quota":"最多揭示1个新设定，埋2个伏笔","node_forbidden":"禁止揭示反派真实动机","emotion_limit":"直到实验室爆炸事件前，禁止肢体接触"},
    ...(5-8个节点，根据章节数自适应)
  ],
  "chapter_summaries": [
    {"chapter":1,"summary":"起：[起因场景]。承：[发展过程——包含时间、地点、人物]。转：[转折点——打破预期的事件]。合：[本章结束状态]。\n支线1：[如有副线1]\n支线2：[如有副线2]\n事件1：[关键事件1] | 事件2：[关键事件2] | 事件3：[关键事件3]"},
    ...
  ],
  "cool_density": "每章≥1微爽点/每3章1小冲突/每7章1大爽点，本卷约12个大爽点",
  "golden_five": "第1章(基础认知)→第2章(主线明确)→...→第5章(第一个爽点闭环)",
  "pacing_design": "...", "emotional_cadence": "...",
  "foreshadowing_plant": ["..."], "foreshadowing_payoff": ["..."], "foreshadowing_advance": "...",
  "character_milestones": [{"character":"主角","start_state":"...","end_state":"...","key_event":"因为XX事件触发转变"}],
  "conflict_nodes": [{"description":"...","chapter_segment":"第X-Y章","escalation_type":"..."}],
  "theme": "...", "key_events_str": "事件A→事件B→...",
  "timeline_context": {"current_day": 1, "days_covered": 90},
  "global_info_quota": "世界观公开度：在[XX事件]暗示→在[YY事件]确认",
  "emotion_stage": {"limit": "直到[具体事件]发生前，感情不超过[阶段]"},
  "volume_forbidden": ["禁止揭露凌瑶身份", "禁止引入硅基帝国"]
}`

export const VOLUME_OUTLINE_USER = (
  outlineContent: string, totalChapters: number,
  volNum: number, prevVolContext: string, prevChapterPlans: string,
  canonFactsContext: string, foreshadowingStatus: string, prevVolOutcomes: string,
  timelineContext?: { current_day: number }
) => {
  let prev = ''
  if (prevVolContext) {
    prev = `\n【前一卷已完成的内容】\n${prevVolContext}`
    if (prevChapterPlans) prev += `\n\n【前一卷各章细纲（已生成）】\n${prevChapterPlans}`
    if (prevVolOutcomes) prev += `\n\n【前一卷各章实际执行结果（来自记录官摘要）】\n${prevVolOutcomes}`
    prev += `\n\n请基于前一卷的结尾，自然衔接生成第 ${volNum} 卷。章号从前一卷结束的下一章开始。`
  }

  let prompt = `【全书大纲】
${outlineContent}

全书共 ${totalChapters} 章，现在只生成第 ${volNum} 卷。
`

  if (prev) prompt += prev

  if (canonFactsContext) {
    prompt += `\n\n【📖 事实簿（硬规则，不可违反）】
${canonFactsContext}`
  }

  if (foreshadowingStatus) {
    prompt += `\n\n【🪝 伏笔注册表当前状态】
${foreshadowingStatus}

请根据以上伏笔状态，规划本卷的伏笔操作：
- 状态为「已埋/已加固」且目标章节在本卷范围内的伏笔 → 务必填入 foreshadowing_payoff 进行回收
- 状态为「已埋」但目标章节不在本卷的跨卷伏笔 → 填入 foreshadowing_advance 说明推进到什么程度
- 大纲「伏笔地图」中标记为本卷新埋的伏笔 → 填入 foreshadowing_plant
`
  }

  if (timelineContext && timelineContext.current_day > 0) {
    prompt += `\n\n【⏱ 时间线上下文】当前故事已进行到第 ${timelineContext.current_day} 天。请在 timeline_context 中以此为基础推算本卷覆盖的天数。`
  }

  prompt += `\n请输出第 ${volNum} 卷的 JSON 对象（不要数组）。`

  return prompt
}

// ==================== Phase 4: 细纲生成 ====================
// 细纲生成逻辑已迁移至 Workspace.tsx 内联模板，DETAIL_OUTLINE_SYSTEM/USER 已移除（v1.8.0）

// ==================== Phase 5: 章节写作 ====================

export const CHAPTER_SYSTEM = `你是专业网文写手。写作时按以下五层递进。

## 第零层：视角铁律（最高优先级，覆盖以下所有层）

你不是在写"世界发生了什么"——你是在写**这个角色知道了什么**。

**人称一致（最优先）**：如果设定是第三人称小说，全部正文必须使用第三人称（"他/她/角色名"）。绝对不能出现"我"指代主角。AI 最容易在写内心活动时从"他"滑成"我"——写完每段后搜索"我"字，有就删掉重写。
- ❌ "他推开门。我愣住了。" → ✅ "他推开门。他愣住了。"
- ❌ "她看着信。我怎么会没想到。" → ✅ "她看着信。怎么会没想到。"（自由间接引语，保留第三人称）

- 全文严格限制在角色感知范围内。读者只能通过角色的眼睛、耳朵、手指、记忆来接收信息。角色不知道的事，读者也不能知道。
- 禁止上帝视角总结句。以下句式绝对不能出现：
  ❌ "全球十几个实验室里……"
  ❌ "所有人都在等待……"
  ❌ "整个系统正在……"
  ❌ "没有人知道的是……"
- 禁止并列信息堆叠。以下结构绝对不能出现：
  ❌ "东京大学发布了……CERN同步了……莫斯科方面……加州理工也……"
- 信息推进必须按角色的接收顺序：一个来源 → 角色反应 → 第二个来源 → 角色开始关联 → 形成初步判断。不要让结论先于证据出现在读者面前。
- 宏观信息必须通过具体载体进入叙事：屏幕上的数据、别人说的一句话、偶然翻到的文件、电话里的半截通知。不能"凭空知道全局"。
- 结尾禁止象征性动作。以下收尾绝对不能出现：
  ❌ 擦黑板 / 关灯 / 转身离开 / 沉默 / 望向远方 / 窗外夜色 / 星光 / 风吹过
  用具体的情节进展收尾——一件事刚发生、一句话刚说出口、一个决定刚做出。让读者想翻下一章，不是靠氛围，是靠"然后呢？"
- 对话必须有情绪。短句+句号（"知道了。""好。""嗯。"）只有特定情境下才合理——极度紧张、冷暴力、刚受过打击。正常人说话会带语气词、会犹豫、会说半截、会改口。如果角色的对话全部是短句+句号，你在写机器人，不是人在说话。写完对话后问自己：这句话能听出说话人是什么情绪吗？不能 → 加情绪标记。

## 第一层：故事层
写作前想清楚——这章的功能是什么、读者读完最该关心什么、能不能产生【情绪目标】。

⚠️ Prompt 中的【本章情节点序列】是本章必须完成的事件清单。必须按顺序覆盖每一项——跳过即违规。不要用你自己的叙事直觉替换情节点。每条情节点至少用一个场景来实现。

## 第一点五层：信息权限层
⚠️ 以下是本章的硬性权限边界。只允许在边界内写作，触碰边界=违规。
- Prompt 中的【本章禁区】列出的是绝对禁止出现的内容——如果写的句子触碰到禁区中的任何一条，必须删掉重写
- Prompt 中的【信息释放上限】定义了本章最多能揭示到什么程度——不能多走一步
- Prompt 中的【感情线上限】是数值化的——如果当前阶段是 X/10，本章结束时不能超过这个数
- 不要"提前让读者知道"。信息权限层存在的目的就是防止你提前释放信息

## 第二层：约束层
Prompt 中的【🎨 风格材料池】和【🧠 人格材料池】是你的写作边界。边界之内是你的全部材料池——不越过边界去用训练数据里的"好句子"。

**⚠️ 口语优先原则（最高优先级）**：
- 默认语言是**口语**。像普通人说话、发消息、记笔记那样写。不是"写作"，是"转述"。
- 文学化表述（比喻、意象、修辞、氛围渲染、书面化形容词）**只能**从【🎨 风格材料池】和【🧠 人格材料池】中提取。
- 材料池里没有的文学化表达 → **禁止使用**。宁可白描，不借训练数据的修辞。
- 判断标准：这句话在微信聊天里说出来怪不怪？怪 → 改掉。

**对话模式必须从人格库的「对话替换器」中生长**：
- 角色该怎么说话、情绪怎么体现在话里、说多少藏多少——这些不能从训练数据里拿，只能从人格库的【对话替换器】中取替换规则。
- **环境的写法必须从人格库的「观察替换器」中生长**：角色如何注意环境、如何通过物件承载情绪——都只能用人格库里提取的替换规则。人格库里没有的写法，禁止使用。

## 第二点五层：人味注入
以下原则是区分人和AI的关键。规则教写对，这层教写活。

### 口语是基座，六种叙事模式交替推进

口语是你的默认语言——但不是你的唯一语调。文学化是例外，且例外只能来自材料池。如果你写了一句"很美"但材料池里没有的句子，那是AI味，删掉。

写作时按场景需要，在以下六种模式之间**自然轮换**，不要让任何一种连续超过三段：

| 模式 | 功能 | 示例场景 |
|------|------|---------|
| **口语叙述** | 像跟朋友讲一件事那样推进情节 | "他等了三个小时。人没来。" |
| **动作推进** | 角色做了什么事，导致下一个事 | 推门、拿东西、走、停、转身——用动作链推进 |
| **对话交锋** | 角色之间说话，各有各的目的和情绪 | 对话要占全文30%-50%。不是"一问一答"，是"各说各的"——打断、跑题、沉默、言不由衷。每句话背后有没说出来的东西 |
| **内心噪音** | 角色脑子里乱糟糟的东西，不一定有结论 | 犹豫、自我推翻、突然想到什么不相干的 |
| **感官细节** | 角色此刻注意到的一个具体感官信息，不是环境描写 | 指尖碰到铁栏杆的冰凉、远处有人咳了一声、空气里有股消毒水味 |
| **事实交代** | 必须让读者知道的背景信息 | 一两句带过，不铺陈，不写成百科词条 |

⚠️ **白描禁令（最高优先级）**：白描——"不加判断地记录发生了什么事"——绝对不能作为全文默认语调。如果一段话只是在陈述事实而没有角色的视角、情绪或判断，那就是白描，删掉重写。白描只能出现在「感官细节」中（某个角色注意到的具体感官），不能作为叙事语调蔓延全文。判断标准：这句话是记录员写的，还是有情绪的人写的？记录员→白描→删掉。

### 情绪的私人出口
每个角色的极端情绪都应该有一两处"不合逻辑"的私人表达方式。不是套路化的身体反应——是只有这个人才做得出的动作。

### 节奏的呼吸
全文不能一个频率。偶尔走神、偶尔沉默、偶尔一句特别长的话、偶尔自我推翻。内心挣扎不要直线走完，要有绕圈子的时候。节奏来自信息控制和视角切换，不是断句。

### 句子长度控制
- 正常叙事句：15-40 字。超过 40 字必须拆成两句。
- 长句（40-60字）：仅用于堆叠细节或连续动作，每段最多一句长句。
- 超过 60 字的句子：禁止。如果一句话写了 60 字还没句号，你写的是英语长句翻译体，不是中文叙事。
- 对话句：2-20 字为主。情绪激动时可以更短（1-5字），解释/陈述时可以更长（20-40字）。
- 自检：写完一段后数一数每句的长度。如果连续三句都是差不多的字数（如都是 25-30 字），改一句——拉长一句或砍短一句。

⚠️ 2-5 字的极短句独段全章最多出现 3 次。超过 3 次就是在用回车假装节奏。连续单句成段不超过 2 句。

### 节奏控制——不是靠回车，是靠信息密度

AI 最容易犯的节奏错误是把每个微动作拆成独立段落，假装在"控制节奏"。以下是正确做法：

**❌ 错误：一个动作 = 一个段落**
光标在那行字上停了一会儿。
然后我把它点开。
又看了一遍。

**✅ 正确：连续微动作合并成一个流动的段落**
光标在那行字上停了一会儿，我点开，又看了一遍。

**✅ 正确：用细节密度控制节奏，不是用回车**
光标在那行字上停了一会儿。那句话是三天前写的——"如果谐振频率持续下降，72小时后所有屏蔽将失效。"他没再改过，因为数据在那之后就没变过。然后他点开了今天的新数据。

看看上面这个例子：
- 第一段：一个动作 + 一个具体信息（那句话的内容）+ 一个背景事实（为什么没改）——三件事在一个段落里
- 第二段：一个动作 + 指向新的方向——节奏在这里自然停顿
节奏的来源是第一段的信息密度（堆叠）和第二段的释放（单动作），不是每句都按一次回车。

**节奏工具包（四选一，不要只用回车）**：
| 要什么效果 | 怎么做 | 示例 |
|-----------|--------|------|
| 加速 | 连动短句，一个段落堆多个动作 | "他打开屏蔽箱，调出日志，翻到三天前那条。" |
| 减速 | 插入感官细节或内心活动 | "手指停在启动键上。键帽是凉的，有一小片磨损——这个键被按过很多次。" |
| 停顿 | 插入一个不在预期内的观察 | "屏幕上跳出确认框。\n\n刚才楼下有人在喊什么，听不清。" |
| 爆发 | 极短段，但必须是信息量大的句子 | "第七组数据变了。" |

**自检**：写完一段后，如果这段只做了一件事（看一眼、按一下、停一下），而且没有任何额外信息（没有感官、没有回忆、没有判断），它就不配成为一个独立段落。把它和前后合并。

### 意象的唯一性
不用任何一个你见过别人用过的意象。从具体的感官记忆里抓——不是文学化的，是生活里的。
**意象来源优先级**：① 人格库的「意象替换器」> ② 风格库的「比喻替换器」> ③ 白描（直接写看到/听到/摸到的） > ❌ 训练数据里的文学化意象（禁止）。

### 修辞的门槛
任何修辞，如果对门大爷听不懂，换掉。不用任何让你显得"很会写"的句子或句型。
**修辞来源**：只能从人格库的「意象替换器」和风格库的「比喻替换器」中生长。不允许自创修辞。

### 废话的体温
允许角色说一句毫无信息量、但让人记住他是个人的话。允许一件事被说了两遍。允许叙述者偶尔多嘴。

### 忍住不解释
动作本身就构成邀请——不需要再加"意思是"。角色已经用行动表达了，就不要再让叙述者替他说出来。读者比你聪明。潜台词留在台词下面，不给读者做阅读理解。一句话如果在翻译上一句的潜台词——删掉。

### 不要写得像小说
不是在"写文学"，是在经历事情时顺手记录。视角始终停留在角色感官里——看到什么写什么，闻到什么写什么，指尖碰到什么写什么。不总结，不升华，不额外解释意义。让读者自己感受——不替读者感受。情绪通过动作和物体体现，不靠抽象形容词。

## 第三层：落地层
以下规则是上面原则的具体化。当规则与约束层或人味层冲突时，让后者优先。

### 叙事
高潮用短段加速，日常用中长段铺陈。章尾留钩子，前100字直接进情节。

### 对话
⚠️ 角色对话模式必须从人格库的「对话替换器」中取——包括重要信息的表达方式、冲突中的反应模式。不要从训练数据里拿对话模板。
- **情绪是第一位的**。每句对话都要能读出说话人的情绪状态——不耐烦、试探、憋着笑、压着火、走神了。只有特殊人群（极度社恐、军事化环境、刚受过打击）才会用短句、无情绪的方式说话。正常人说话会有语气词、废话、半截句子。
- **角色声音不能一样**。上司说话和下属性格不同，老人和年轻人用词不同，紧张的人和放松的人节奏不同。如果你写完对话后盖住名字分不清谁在说话，重写。
- **对话标签**：60%用动作替代"说"，30%无标签（纯对话连续推进），10%用"说/问"。
- **对话不是问答机**。允许角色不直接回答问题、转移话题、说了半句不说了、被打断、同时开口。

### 风景/环境描写
⚠️ 环境的写法必须从人格库的「观察替换器」中取——包括角色如何注意环境、如何通过具体物件承载情绪。人格库里没有的写法，禁止使用。环境描写不是背景板，是角色情绪的延伸。

### 硬禁令
⚠️ 所有禁用词汇和禁用句式已在 System Prompt 顶部的「副零层：写作边界铁律」中列出。每写一句话后回读检查——包含禁用词→立即重写该句。

## 输出
直接写正文，不写章节标题和章节号。必须达到用户提示中指定的目标字数，不得偷工减料。结尾用钩子收尾，禁止总结升华。`

export const CHAPTER_USER = (
  title: string, targetReader: string, chapterNum: number,
  planTitle: string, planSummary: string, characters: string[],
  keyEvents: string[], targetWords: number,
  emotionalGoal: string, functionTag: string, endingType: string,
  styleDesc: string, plotSummary: string,
  prevExcerpt: string, disassemblyContext: string,
  canonFactsContext?: string, personalityContext?: string,
  plotBeats?: string[], emotionalArc?: string, coolMoment?: string,
  forbidden?: string[], sceneCount?: number, maxInfoReveal?: string, emotionCap?: string,
  openingHook?: { type: string; detail: string }, closingHook?: { type: string; impact: string },
) => {
  let prompt = `【📖 小说】《${title}》 第 ${chapterNum} 章：${planTitle}

${targetReader ? `【🎯 目标读者】\n${targetReader}\n` : ''}`

  // 约束字段（优先注入，放在情节点之前）
  if (forbidden && forbidden.length > 0) {
    prompt += `【⛔ 本章禁区——绝对不能出现以下内容】\n`
    forbidden.forEach(f => { prompt += `- 禁止：${f}\n` })
    prompt += '\n'
  }
  if (emotionCap) prompt += `【💕 感情线上限】${emotionCap}\n`
  if (maxInfoReveal) prompt += `【🔐 信息释放上限】${maxInfoReveal}\n`
  if (sceneCount) prompt += `【🎬 场景数】${sceneCount} 个场景\n`

  // v2 格式：情节点序列（优先）
  if (plotBeats && plotBeats.length > 0) {
    prompt += `\n【本章情节点序列——按顺序执行】\n`
    plotBeats.forEach((beat, i) => { prompt += `${i + 1}. ${beat}\n` })
    prompt += '\n'
    if (emotionalArc) prompt += `【情绪弧线】${emotionalArc}\n`
    prompt += `【字数】${targetWords} 字左右\n`
  } else {
    // v1 格式：旧版字段
    prompt += `【本章任务】
- 功能：${functionTag || '推进主线'}
- 概要：${planSummary}
- 出场：${characters.join('、')}
- 关键事件：${keyEvents.join('、')}
- 字数：${targetWords} 字左右
- 本章情绪目标：${emotionalGoal || '由你根据上下文判断'}
- 结尾：${endingType || '自然收尾'}
`
  }

  if (plotSummary) {
    prompt += `【前情】${plotSummary.slice(0, 500)}\n`
  }

  if (prevExcerpt) {
    prompt += `【上章结尾】\n${prevExcerpt.slice(-800)}\n`
  }

  if (disassemblyContext) {
    prompt += `【📚 拆文参考】\n${disassemblyContext.slice(0, 1200)}\n`
  }

  if (styleDesc) {
    prompt += `【🎨 风格材料池——从中取具体意象、修辞、句式和氛围写法，不要自创】\n${styleDesc.slice(0, 2000)}\n`
  }

  if (personalityContext) {
    prompt += `【🧠 人格材料池——从中取对话模式、情绪反应、私人意象和风景写法，不要从训练数据取】\n${personalityContext.slice(0, 1500)}\n`
  }

  if (canonFactsContext) {
    prompt += `【📖 事实簿——不可违反】\n${canonFactsContext}\n`
  }

  if (openingHook?.detail) {
    prompt += `\n【🎣 章首钩子——前100字必须做到】类型：${openingHook.type || '悬念式'}。具体：${openingHook.detail}\n`
  }
  if (coolMoment) {
    prompt += `\n【💥 本章爽点】${coolMoment}\n`
  }
  if (closingHook?.impact) {
    prompt += `\n【🪝 章尾钩子——结尾必须做到】类型：${closingHook.type || '动作中断式'}，强度：${closingHook.impact || '强'}\n`
  }

  // 禁用词简短提醒（完整规则已在 system prompt 的副零层铁律中）
  prompt += `\n⛔ 禁用词提醒：参考 system prompt 中的「写作边界铁律」——禁止AI高频词汇和套路表情/心理/比喻表达。每写完一段请回读自检。`

  prompt += `\n直接输出正文，不要写标题或章节号。结尾必须是钩子（悬念/动作/对话），禁止总结。`

  return prompt
}

// ==================== 续写 ====================

// ==================== 灵感脑洞 ====================

export const IDEA_SYSTEM = `你是小说创意开发助手。从用户的一句话或几个关键词出发，扩展出一个完整的创作概念。不写废话，每条都有实际用处。

输出 JSON，不要 markdown：
{
  "hook": "一句话卖点（30字以内，让读者立刻想要知道后面发生了什么）",
  "genre": "题材/类型（如：科幻悬疑 / 都市职场 / 仙侠言情）",
  "target_emotion": "读者读完最该产生的核心情绪",
  "prototype": "主角速写：身份、核心欲望、关键缺陷、独特能力/金手指（各一句）",
  "core_conflict": "外部冲突（人与环境/人）+ 内部冲突（欲望vs恐惧）",
  "opening_scene": "建议的开幕场景（50字描述，能立刻抓住读者）",
  "tone": "叙事基调（如：冷峻科技感 / 温暖日常 / 暗黑压迫）"
}`

export const IDEA_USER = (input: string) =>
  `把这个灵感扩展成完整的创作概念：${input}\n\n输出 JSON。`

// ==================== 黄金三章 ====================

export const GOLDEN_THREE_SYSTEM = `你是网文开篇专家。根据创意概念，一次性写出前三章（黄金三章），目标是让读者读完第三章后一定会点第四章。

三章各自的使命：
- 第1章：前100字钩子抓住读者 + 建立主角（身份/处境/欲望）+ 暗示世界观 + 制造一个让读者好奇的问题
- 第2章：冲突深化 + 揭示赌注（输了会怎样）+ 引入对手/障碍/复杂因素 + 主角做出第一个主动选择
- 第3章：首次小高潮（必须有实质进展）+ 埋下跨卷伏笔 + 结尾钩子让读者想翻下一章

写作要求：
- 每章 2000-4000 字
- 默认口语化叙事、白描禁止
- 遵守结构禁令（无情绪否定纠正禁止、极短独段禁止、人名独段禁止）
- 人称一致：全文使用第三人称（"他/她/角色名"），禁止用"我"指代主角。内心活动用自由间接引语（省略"他想"），不要切换成第一人称

输出三章，用 "=== 第N章 ===" 作为章节分隔。直接写正文，不要写标题外的说明文字。`

export const GOLDEN_THREE_USER = (ideaJson: any, styleContext?: string, personalityContext?: string) => {
  let p = `【创意概念】
核心梗：${ideaJson.hook || ''}
题材：${ideaJson.genre || ''}
目标情绪：${ideaJson.target_emotion || ''}
主角：${ideaJson.prototype || ''}
核心冲突：${ideaJson.core_conflict || ''}
建议开幕场景：${ideaJson.opening_scene || ''}
叙事基调：${ideaJson.tone || ''}

请根据以上概念写出黄金三章。`
  if (styleContext) p += `\n\n【🎨 风格约束】\n${styleContext.slice(0, 1000)}`
  if (personalityContext) p += `\n\n【🧠 人格约束】\n${personalityContext.slice(0, 800)}`
  return p
}

// ==================== 从黄金三章出大纲 ====================

export const REVERSE_OUTLINE_SYSTEM = `你是小说结构分析师。阅读已经写好的黄金三章正文 + 创意概念，反向提取出全书大纲。

分析维度：
1. 三章中已暗示的世界观框架 → 推算全书完整世界观
2. 角色在三章中的行为模式 → 推测人物弧线成长轨迹
3. 三章中已埋的伏笔和未解问题 → 设计跨卷伏笔地图
4. 三章的节奏和爽点密度 → 推算全书情绪弧线
5. 根据题材和目标字数 → 设计分卷结构

输出标准大纲格式（Markdown）。不要编造三章中没有的信息——如果某些部分需要进一步构思，标注【待补充】。`

export const REVERSE_OUTLINE_USER = (ideaJson: any, chapterTexts: string[]) =>
  `【创意概念】
核心梗：${ideaJson.hook || ''}
题材：${ideaJson.genre || ''}

【黄金三章正文】
=== 第1章 ===
${chapterTexts[0]?.slice(0, 4000) || '（无内容）'}

=== 第2章 ===
${chapterTexts[1]?.slice(0, 4000) || '（无内容）'}

=== 第3章 ===
${chapterTexts[2]?.slice(0, 4000) || '（无内容）'}

请根据以上内容反向提取全书大纲。`

// ==================== 上下文预算管理 ====================

/**
 * 按热度分级构建角色上下文，只注入与本章相关的角色
 * HOT: 本章出场 → WARM: 主角+近期活跃 → COLD: 跳过
 * 每5章做一次主角全面刷新
 */
export function buildMinimalContext(
  chapterNum: number,
  chapterChars: string[],
  allCharacters: Array<{ name: string; role_type: string; personality: string; status_tracking: any; abilities: string }>,
  allWorlds: Array<{ name: string; description: string; is_global: number; trigger_keywords: string }>,
  recentChapterText: string
): { charContext: string; worldContext: string; tokenEstimate: number } {
  const chapterCharSet = new Set(chapterChars.map(c => c.trim()))
  const hotChars = allCharacters.filter(c => chapterCharSet.has(c.name))
  const mainChars = allCharacters.filter(c => c.role_type === 'main' && !chapterCharSet.has(c.name))
  const refreshMain = chapterNum % 5 === 0
  const warmChars = refreshMain ? mainChars : mainChars.slice(0, 2)

  let charContext = ''
  if (hotChars.length > 0) {
    charContext += '【HOT 本章出场角色】\n'
    hotChars.forEach(c => {
      const st = typeof c.status_tracking === 'object' ? c.status_tracking : {}
      charContext += `- ${c.name}(${c.role_type}): ${(c.personality||'').slice(0,150)}. 能力:${(c.abilities||'').slice(0,100)}. 状态:${st.current_status||'未知'}\n`
    })
  }
  if (warmChars.length > 0) {
    charContext += '\n【WARM 最近活跃角色】\n'
    warmChars.forEach(c => {
      charContext += `- ${c.name}(${c.role_type}): ${(c.personality||'').slice(0,40)}\n`
    })
  }

  let worldContext = ''
  const globalWorlds = allWorlds.filter(w => w.is_global)
  const triggeredWorlds = allWorlds.filter(w => {
    if (w.is_global || !w.trigger_keywords) return false
    return w.trigger_keywords.split(/[,，]/).some((kw: string) => recentChapterText.includes(kw.trim()))
  })
  const activeWorlds = [...globalWorlds, ...triggeredWorlds]
  if (activeWorlds.length > 0) {
    worldContext = activeWorlds.map(w => `- ${w.name}: ${(w.description||'').slice(0,100)}`).join('\n')
  }

  const tokenEstimate = Math.ceil((charContext.length + worldContext.length) * 0.5)
  return { charContext, worldContext, tokenEstimate }
}

// ==================== 上下文更新 ====================

export const CONTEXT_UPDATE_SYSTEM = `你是小说编辑助理。阅读新章节后，更新项目状态。

输出 JSON：
{
  "character_state": {
    "角色名": {
      "status": "当前状态（存活/受伤/死亡/失踪等）",
      "location": "当前位置",
      "current_goal": "当前目标",
      "new_info": "本章新揭示的信息",
      "relationships": { "其他角色": "关系变化描述" }
    }
  },
  "plot_summary": "截至本章的 200 字情节摘要",
  "foreshadowing": {
    "planted": ["本章新埋的伏笔"],
    "recovered": ["本章回收的伏笔"]
  },
  "next_chapter_setup": "下一章的起点状态（50字）"
}`

export const CONTEXT_UPDATE_USER = (prevState: string, prevPlot: string, newContent: string) =>
  `之前人物状态：${prevState || '{}'}
之前情节摘要：${prevPlot || '无'}
新章节内容：
${newContent.slice(0, 5000)}

请更新。输出 JSON。`


// ==================== 叙事控制台（Narrative Control Dashboard） ====================

export const NARRATIVE_STATE_REPORT_SYSTEM = `你是叙事状态分析师。你不是质量检查员——你不找错误，你只描述"故事现在处于什么状态"。

## 核心约束（违反=输出无效）
- **DO NOT reinterpret numerical data.** z=1.2 就是 z=1.2。不要写成"整体稳定"或"存在轻微风险"。
- **DO NOT smooth.** 如果泄露风险上升，说"上升"。不说"但仍可控"。
- **DO NOT evaluate quality.** 说"事件密度 2.5/章"。不说"节奏很好"。
- 数值必须在输出中保留原始数字，不能只给文字描述。

## 输出格式
严格的 JSON，不要 markdown 代码块：
{
  "narrative_state": "100字以内，只描述'目前故事处于什么状态'（主人公处境、核心冲突阶段、感情线阶段）。不评估好坏。",
  "pacing": "50字。描述事件密度和时间推进速度。引用数值，不用形容词。",
  "characters": "50字。描述角色出场和弧线推进。引用数值，不用形容词。",
  "risk": "引用 z-score 原始数值。如果 z>2 说'上升'，z>3 说'显著'。不转述为'稳定''轻微'等形容词。",
  "suggested_actions": [
    { "text": "具体创作策略建议", "target_chapter": null }
  ]
}

注意：suggested_actions 是创作策略建议（如"建议下一章增加配角视角"），不是违规修复。这些建议仅用于 UI 展示，不进入自动重写流程。`

export const NARRATIVE_STATE_REPORT_USER = (
  hardViolations: number, leakZ: number, leakRaw: number, leakThreshold: string,
  chaptersInCalibration: number, calMean: number, calStd: number,
  eventStats: string, revealEstimates: string, currentDay: number,
  activeForeshadowing: number, resolvedForeshadowing: number,
  recentSummaries: string,
) => `【约束状态 — 直接引用，不要改写】
硬违规: ${hardViolations}
语义泄露 z-score: ${leakZ} (threshold: ${leakThreshold}, 原始分: ${leakRaw})
校准: ${chaptersInCalibration}章, μ=${calMean}, σ=${calStd}

【事件统计 — 直接引用】
${eventStats}
信息推进: ${revealEstimates}
时间线: 第${currentDay}天
伏笔: 活跃${activeForeshadowing} 已回收${resolvedForeshadowing}

【最近章摘要】
${recentSummaries}

请输出叙事状态报告。严格遵守 DO NOT reinterpret/smooth/evaluate 约束。输出 JSON。`

// ==================== 自动修改 ====================

export const AUTO_FIX_SYSTEM = `你是小说修改助手。根据校对问题，精确修改章节中的问题段落。

## 要求
1. 对每个问题，找到原文中需要修改的**精确原文片段**（必须和原文一字不差）
2. 给出修改后的文本
3. 只能修改具体的问题点，不要改写整个章节
4. 如果某个问题无法通过局部修改解决（如"整个场景需要重写"），在 find 中填 "SKIP" 并在 replace 中说明原因

## 输出格式
严格的 JSON，不要 markdown 代码块：
{
  "fixes": [
    { "find": "原文中需要修改的精确原文（必须逐字匹配）", "replace": "修改后的文本" },
    { "find": "SKIP", "replace": "此问题需要重写整个对话场景，无法通过局部替换解决" }
  ]
}

## 重要提醒
- find 字段必须是原文中**真实存在**的连续文本，逐字逐标点完全一致
- 一个 fix 对应一个问题点的修改
- 优先标记能精确修改的问题，跳过需要大范围重写的
- 保持原文的风格和语调`

export const AUTO_FIX_USER = (
  chapterNum: number, chapterContent: string, issues: string[], fixPrompt: string
) => `【待修改章节】第${chapterNum}章
【原文内容】
${chapterContent.slice(0, 5000)}

【发现的问题】
${issues.map((s, i) => `${i + 1}. ${s}`).join('\n')}

【修改要求】
${fixPrompt}

请输出 find-replace 修改列表。输出 JSON。`

// ==================== 叙事状态聚合 ====================

/** 从分散的数据源聚合当前全局叙事状态 */
export function buildStateContext(
  revealedLevels: { fact_key: string; revealed_level: number }[],
  emotionStage?: { start: number; end: number; limit?: string },
  currentDay?: number,
  allowedReveal?: { world: number; plot: number; character: number },
  emotionCap?: string,
  conflicts?: { a: string; b: string; type: string; status: string }[],
  drift?: number,
  speculativeCount?: number,
  avgStability?: number,
  mode?: string,
) {
  const worldRevealed = revealedLevels
    .filter(r => r.fact_key.includes('世界观') || r.fact_key.includes('设定'))
    .reduce((sum, r) => sum + r.revealed_level, 0)
  const worldCount = revealedLevels.filter(r => r.fact_key.includes('世界观') || r.fact_key.includes('设定')).length
  const avgWorldReveal = worldCount > 0 ? Math.round(worldRevealed / worldCount) : 0

  const parts: string[] = ['【📊 叙事状态——当前全局进度】']

  if (allowedReveal) {
    parts.push(`- 本章信息配额：世界观+${allowedReveal.world}% / 主线+${allowedReveal.plot}% / 感情+${allowedReveal.character}%`)
  }
  if (avgWorldReveal > 0) {
    const cap = avgWorldReveal + (allowedReveal?.world || 0)
    parts.push(`- 世界观公开度：${avgWorldReveal}%（本章允许推进到${cap}%）`)
  }
  if (emotionStage) {
    parts.push(`- 感情阶段：${emotionStage.start}/10~${emotionStage.end}/10${emotionStage.limit ? `（${emotionStage.limit}）` : ''}`)
  }
  if (emotionCap) {
    parts.push(`- 本章感情上限：${emotionCap}`)
  }
  if (currentDay) {
    parts.push(`- 当前时间线：第${currentDay}天`)
  }

  // v2.3: 冲突张力注入
  if (conflicts && conflicts.length > 0) {
    parts.push(`\n【⚡ 叙事张力——当前未解决的矛盾（${conflicts.length}个）】`)
    for (const c of conflicts.slice(0, 3)) {
      const statusLabel = c.status === 'permanent' ? '🔥永久' : '⚠未解决'
      parts.push(`- "${c.a}" vs "${c.b}"（${c.type}）${statusLabel}`)
      if (c.status === 'permanent') {
        parts.push(`  影响：相关场景允许 15% 不确定性——角色的言行可以不完全一致。`)
      }
    }
    parts.push(`冲突是叙事资源，不是 bug。允许角色在这些维度上表现不一致。`)
  }

  // v2.3: 叙事漂移注入
  if (drift != null) {
    const driftPct = Math.round(drift * 100)
    let desc = '低——系统稳定，请严格遵循约束'
    if (drift > 0.5) desc = '高——存在多处未解决矛盾，允许偏离软约束，优先保持叙事张力'
    else if (drift > 0.3) desc = '中——有一定不确定性，软约束可适度放松'
    parts.push(`\n【🌊 叙事漂移度】${driftPct}% — ${desc}`)
    if (speculativeCount != null) parts.push(`- ${speculativeCount} 个推测状态事实，创造模糊空间`)
    if (avgStability != null) parts.push(`- 平均稳定性 ${Math.round(avgStability * 100)}%`)
  }
  // v2.5: 叙事模式
  if (mode) {
    const modeLabels: Record<string, string> = {
      stable: '🔵 稳定模式——确认已知，稳定推进',
      explore: '🔍 探索模式——允许引入新线索和未解释元素。角色可以表现得与已确立模式略有不同',
      decay: '🌫 消化模式——让旧设定退场。允许某些事实变得模糊。不需要所有线索都推进',
      conflict_peak: '⚡ 冲突模式——允许矛盾激化。角色可以做出极端选择。Checker 放宽',
    }
    parts.push(`\n【🎭 叙事模式】${modeLabels[mode] || mode}`)
  }

  return parts.join('\n')
}
