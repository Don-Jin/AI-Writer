/**
 * 风格提取 Prompt 模板 v2
 * 智能采样 + 单次 AI 调用，适合处理百万字级小说
 */

import { sampleText } from './disassembler'

export const STYLE_EXTRACTION_SYSTEM = `你是写作风格分析师。从小说采样中提取可操作风格指南——不是文学评论，是给 AI 的写作指令。

## 1. 叙事
- **叙事视角与距离**：第几人称？全知还是限知？叙事者离人物多远——进入内心还是仅外显行为？冷眼旁观还是与人物共情？
- **句式与节奏**：短句为主还是长句为主？一顿一顿的还是一口气到底的？节奏推进快慢如何？给出大致比例描述。

## 2. 语言
- **词汇与文白**：华丽还是朴实？古风词汇还是现代口语？文言占比多少？
- **对话风格**：简洁还是长篇？口语化还是书面语？靠动作还是靠对话推动情节？

## 3. 段落
- **段落配比**：短段（1-2句）/中段（3-5句）/长段（6句+）的大致比例。
- **场景类型与段落**：冲突/对话/描写/内心活动各用什么段长。有没有作者独特的段落习惯？

## 4. 氛围
- **整体基调**：用 2-3 个词概括（悬疑/沉重/诗意/热血/冷峻/温馨/黑暗/幽默等）
- **情绪表达方式**：直给还是克制？用身体细节还是内心独白？高潮处加压释放还是淡淡收笔？

## 输出 JSON（不要 markdown 代码块）
{
  "narrative": { "perspective": "", "distance": "" },
  "sentence_rhythm": "",
  "language": { "vocabulary": "", "dialogue": "" },
  "paragraph": { "ratio": "", "habit": "" },
  "atmosphere": { "tone": "", "emotion_style": "" },
  "sample_passages": ["...", "..."],
  "raw_analysis": ""
}`

export const STYLE_EXTRACTION_USER = (text: string) => {
  const sampled = sampleText(text)
  return `请分析以下小说的写作风格。

【智能采样说明】
原文共 ${text.length.toLocaleString()} 字符，以下是从全书均匀采样的代表性片段（${sampled.length.toLocaleString()} 字符）：

---
${sampled}
---

请按照 System Prompt 中要求的 JSON 格式输出风格分析报告。
只输出 JSON，不要包含任何其他文字。`
}
