import { sampleText } from './disassembler'

export const SETTING_EXTRACTION_SYSTEM = `你是小说设定分析专家。从小说文本中提取以下结构化信息：

## 提取维度
1. **角色**：所有有名有姓的角色，包含：姓名、身份/定位、性格特点、能力/特长
2. **世界观**：地点、势力、组织、宗门、国家等，包含：名称、描述、类别
3. **规则**：力量体系、修炼等级、魔法规则、社会制度等硬性规则
4. **关系**：角色之间的重要关系（师徒、敌对、爱慕、同盟等）

## 输出格式
严格JSON，不要markdown代码块：
{
  "characters": [
    {"name":"角色名","info":"身份/定位描述(30字)","abilities":"能力/特长","role":"main/support/antagonist/minor"}
  ],
  "worlds": [
    {"name":"名称","description":"描述(50字)","category":"location/faction/organization"}
  ],
  "rules": [
    {"name":"规则名","description":"规则描述(50字)"}
  ],
  "relationships": [
    {"char_a":"角色A","char_b":"角色B","relation":"关系类型","description":"关系描述"}
  ]
}`

export const SETTING_EXTRACTION_USER = (text: string) => {
  const sampled = sampleText(text)
  return `请从以下小说中提取角色、世界观、规则、关系。

【智能采样说明】
原文共 ${text.length.toLocaleString()} 字符，采样后 ${sampled.length.toLocaleString()} 字符：

---
${sampled}
---

请输出JSON。`
}
