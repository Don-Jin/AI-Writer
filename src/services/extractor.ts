/**
 * 风格提取 Prompt 模板 v3
 * 智能采样 + 单次 AI 调用，提取可操作的写作约束
 */

import { sampleText } from './disassembler'

export const STYLE_EXTRACTION_SYSTEM = `从小说采样中提取可操作的风格约束。不是文学评论概括，是给 AI 的"只能这样写"的边界清单。

## 1. 叙事约束
- 第几人称？全知/限知/多视角？
- 能进谁的内心、不能进谁的内心？是全章不能进还是特定场景不能进？
- 叙事者可以插嘴吗？什么时机插？（如：关键对话后突然冒出来感慨一句）
- 视角切换的频率和触发条件——什么情况下切视角？

## 2. 句式与节奏约束
- 短句字数范围（<X字）和长句字数范围（>Y字）。给数值，不要"短句为主"这种模糊描述
- 什么情况下可以破例用长句——情绪转折时？重要物件出现时？回忆闪回时？
- 每千字的平均句数。段落之间的句数差——相邻段落不能都太长或都太短

## 3. 段落约束
- 按场景类型给段长：对话/冲突/回忆/描写/内心活动各用什么节奏
- 有没有作者独有的段落习惯？（如：冲突场景只写对话，不加任何动作描写；回忆场景第一句永远是长句）
- 禁止什么段落模式？（如：禁止连续3段以上全短段）

## 4. 语言约束
- 具体词汇档位：能用什么等级的成语？能用方言/脏话/古语吗？对话中允许多少口语词？
- 叙事语言和对话语言的分界——叙事更书面还是和对话一致？
- 禁止什么词汇类型？（如：禁止四级以上成语、禁止"忽然""突然"超过每千字2次）

## 5. 情绪表达约束
- 给出情绪表达的档位表，不是一句概括：
  0=完全不写任何内心，"他垂下眼"就是极限了
  3=可以通过动作暗示，但不写"他觉得/他感到"
  6=允许写"他感到一阵——"，但不超过1句
  9=允许大段内心独白
- 什么触发可以升档？（如：关键转折点可以升到6、只有结局前的高潮可以到9）
- 什么情况必须降档？（如：动作场景降回0、对话场景最多3）

## 输出 JSON
{
  "narrative": { "perspective": "", "pov_rules": "", "narrator_intrusion": "" },
  "sentence_rhythm": { "short_max": 0, "long_min": 0, "exception": "", "density": "" },
  "paragraph": { "by_scene_type": "", "habit": "", "forbidden": "" },
  "language": { "vocab_level": "", "dialogue_vs_narrative": "", "forbidden_words": "" },
  "atmosphere": { "emotion_scale": "", "level_triggers": "", "must_downgrade": "" },
  "sample_passages": ["...", "..."],
  "raw_analysis": ""
}`

export const STYLE_EXTRACTION_USER = (text: string) => {
  const sampled = sampleText(text)
  return `请分析以下小说的风格约束。

【智能采样说明】
原文共 ${text.length.toLocaleString()} 字符，以下是从全书均匀采样的代表性片段（${sampled.length.toLocaleString()} 字符）：

---
${sampled}
---

请按照 System Prompt 中要求的 JSON 格式输出风格分析报告。只输出 JSON，不要包含任何其他文字。`
}
