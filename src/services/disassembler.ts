/**
 * 拆文库服务 v2
 * 智能采样 + 单次 AI 调用，适合处理百万字级小说
 *
 * 策略：
 * 1. 本地智能采样（开头+结尾+每隔N章抽关键段）
 * 2. 单次 AI 调用返回完整结构化分析
 * 3. 采样总长度控制在 50000 字符以内，确保低 token 消耗
 */

/**
 * 清理文本中的危险控制字符和非法转义序列
 * DeepSeek API 对异常转义序列极为敏感，直接删除所有反斜杠最稳妥
 * 中文小说中反斜杠极其罕见，删除不影响内容
 */
export function sanitizeText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '') // 移除控制字符
    .replace(/\\[xX][0-9a-fA-F]{0,2}/g, '')             // 无效 \x/\X 序列
    .replace(/\\u[0-9a-fA-F]{0,4}/g, '')                // 无效 \u 序列
    .replace(/\0/g, '')                                  // 空字符
}

/**
 * 从全文智能采样，提取代表性片段
 * @param text 完整原文
 * @returns 采样后的文本（≤50000字）
 */
export function sampleText(text: string): string {
  const MAX_LENGTH = 50000
  const clean = sanitizeText(text)
  if (clean.length <= MAX_LENGTH) return clean

  const parts: string[] = []

  // 1. 开头 4000 字（黄金三章核心区域）
  parts.push('=== 开篇（黄金三章） ===')
  parts.push(clean.slice(0, 4000))

  // 2. 结尾 2000 字
  parts.push('\n\n=== 结尾 ===')
  parts.push(clean.slice(-2000))

  // 3. 中间均匀采样
  const remaining = MAX_LENGTH - parts.join('\n').length - 200
  const mid = clean.slice(4000, -2000)
  const sampleCount = Math.min(40, Math.floor(remaining / 600))
  const step = Math.floor(mid.length / sampleCount)

  parts.push(`\n\n=== 中间章节采样（共 ${sampleCount} 个片段） ===`)
  for (let i = 0; i < sampleCount; i++) {
    const start = i * step
    const snippet = sanitizeText(mid.slice(start, start + 500))
    if (snippet.trim()) {
      parts.push(`\n[片段 ${i + 1}]\n${snippet}`)
    }
  }

  return parts.join('\n').slice(0, MAX_LENGTH)
}

/**
 * 估算章节数（本地扫描，不用AI）
 */
export function estimateChapters(text: string): number {
  // 匹配 "第X章" "Chapter X" 等模式
  const cnMatch = text.match(/第[一二三四五六七八九十百千0-9]+章/g)
  if (cnMatch && cnMatch.length > 5) return cnMatch.length

  // 匹配 "### Chapter" 或换行+数字+标题的模式
  const lines = text.split('\n')
  let count = 0
  for (const line of lines) {
    if (/^\s*(第[一二三四五六七八九十百千0-9]+[章回节]|Chapter\s+\d+|^\d+[\.\、]\s+\S)/i.test(line)) {
      count++
    }
  }
  return count > 5 ? count : Math.ceil(text.length / 4000) // fallback: ~4000字/章
}

// ==================== 单次拆文 Prompt ====================

export const DISASSEMBLE_SYSTEM = `你是网文拆解分析师。从小说采样中提取可复用的结构策略——不是文学评论，是给大纲和卷纲生成用的参考。

## 提取维度（只提取以下内容）

### 1. 黄金三章
开篇钩子用了什么类型？主角怎么建立的？核心冲突怎么引入的？爽点怎么安排的？

### 2. 剧情结构
故事分几个大幕/卷？各幕的章节范围和核心事件。关键转折点在哪几章？跨卷伏笔怎么埋怎么收？

### 3. 爽点模式
这本书的爽点是什么类型（碾压/揭秘/成长/逆袭/感情）？密度怎样（几章一个）？爽点的三要素怎么搭配？

### 4. 可复用套路
提炼 3-5 个可复用的写作套路——具体的、可操作的。比如"先压后爆：连续3章铺垫对手的强大→第4章主角低调出手→第5章围观群众震惊"

## 输出 Markdown（用 ## 标题分隔）
控制在 2000 字以内。不要写角色分析和文风分析——那些由设定库和风格库专门处理。`

export const DISASSEMBLE_USER = (sampledText: string, totalChapters: number, totalChars: number) =>
  `【全文采样数据】
原文总字数：约 ${totalChars.toLocaleString()} 字
预估章节数：${totalChapters} 章
采样策略：开头4000字 + 结尾2000字 + 全书均匀40段采样

【采样内容】
${sampledText}

请从采样中提取完整拆解分析，严格按照 System Prompt 中的 7 个 ## 二级标题输出 Markdown 格式。
如果某个维度信息不足，可标注"从采样中无法确定"。核心分析必须基于采样内容给出。`

// 保留旧版 stage 函数供兼容
export const STAGE0_SYSTEM = ''
export const STAGE1_SYSTEM = ''
export const STAGE2_SYSTEM = ''
export const STAGE3_CHARACTER_SYSTEM = ''
export const STAGE3_PLOT_SYSTEM = ''
export const STAGE3_WORLD_SYSTEM = ''
export const STAGE4_SYSTEM = ''
export const STAGE5_SYSTEM = ''
export function stage0User(t: string) { return '' }
export function stage2User(t: string) { return '' }
export function stage4User(t: string) { return '' }
