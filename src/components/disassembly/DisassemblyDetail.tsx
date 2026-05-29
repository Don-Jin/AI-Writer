import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import { useDisassemblyStore } from '../../store/disassemblyStore'
import {
  STAGE0_SYSTEM, STAGE1_SYSTEM, STAGE2_SYSTEM,
  STAGE3_CHARACTER_SYSTEM, STAGE3_PLOT_SYSTEM, STAGE3_WORLD_SYSTEM,
  STAGE4_SYSTEM, STAGE5_SYSTEM,
  stage0User, stage2User, stage4User,
} from '../../services/disassembler'

type StageStatus = 'pending' | 'running' | 'done'
interface StageDef { key: string; num: number; title: string; desc: string; agent: string }

const STAGES: StageDef[] = [
  { key: 'stage0', num: 0, title: '概要提取', desc: '识别章节结构，提取 200 字概要', agent: 'Haiku' },
  { key: 'stage1', num: 1, title: '黄金三章', desc: '深度拆解前三章的钩子、人设、爽点、节奏', agent: 'Sonnet' },
  { key: 'stage2', num: 2, title: '逐章摘要', desc: '每章提取 10-20 个情节点和出场角色', agent: 'Haiku' },
  { key: 'stage3', num: 3, title: '聚合分析', desc: '角色档案 + 剧情线 + 世界观体系', agent: 'Sonnet' },
  { key: 'stage4', num: 4, title: '文风分析', desc: '句法/段落/对话/情绪定量分析 + Few-shot 锚点', agent: 'Sonnet' },
  { key: 'stage5', num: 5, title: '汇总报告', desc: '五维评分 + 核心套路提炼 + 对标建议', agent: 'Sonnet' },
]

export default function DisassemblyDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { updateStage } = useDisassemblyStore()

  const [project, setProject] = useState<any>(null)
  const [stageStatus, setStageStatus] = useState<Record<string, StageStatus>>({})
  const [stageResults, setStageResults] = useState<Record<string, string>>({})
  const [expandedStage, setExpandedStage] = useState<string | null>(null)
  const [editingStage, setEditingStage] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    (async () => {
      try {
        if (!window.electronAPI) { setLoaded(true); return }
        const proj = await window.electronAPI.db.get(
          'SELECT * FROM disassembly_projects WHERE id = ?', [Number(id)]
        )
        if (proj) {
          setProject(proj)
          const results = typeof proj.stage_results === 'string' ? JSON.parse(proj.stage_results) : (proj.stage_results || {})
          setStageResults(results)
          const st: Record<string, StageStatus> = {}
          STAGES.forEach(s => { st[s.key] = results[s.key] ? 'done' : 'pending' })
          setStageStatus(st)
        }
      } catch (e: any) { setError(e.message || String(e)) }
      setLoaded(true)
    })()
  }, [id])

  const startEditStage = (key: string, content: string) => { setEditingStage(key); setEditText(content) }
  const saveEditStage = async (key: string, stageNum: number) => {
    if (!project || !window.electronAPI) return
    await updateStage(project.id, stageNum, editText)
    setStageResults(prev => ({ ...prev, [key]: editText }))
    setEditingStage(null)
    showToast('success', '已保存')
  }

  const runStage = async (stage: StageDef) => {
    if (!project || !window.electronAPI) return
    setStageStatus(prev => ({ ...prev, [stage.key]: 'running' }))
    setExpandedStage(stage.key)
    try {
      const sourceText = project.source_text || ''
      let reply = ''

      if (stage.key === 'stage0') {
        reply = await window.electronAPI.aiChat([
          { role: 'system', content: STAGE0_SYSTEM },
          { role: 'user', content: stage0User(sourceText) },
        ], '拆文-概要')
        try {
          const json = JSON.parse(reply.match(/\{[\s\S]*\}/)?.[0] || reply)
          await window.electronAPI.db.run('UPDATE disassembly_projects SET total_chapters = ? WHERE id = ?', [json.total_chapters || 0, project.id])
        } catch {}
      } else if (stage.key === 'stage1') {
        reply = await window.electronAPI.aiChat([
          { role: 'system', content: STAGE1_SYSTEM },
          { role: 'user', content: `请深度拆解黄金三章。原文前12000字：\n---\n${sourceText.slice(0, 12000)}\n---\n从开篇钩子、人设、冲突、爽点、节奏五个维度分析。` },
        ], '拆文-黄金三章')
      } else if (stage.key === 'stage2') {
        const totalChapters = project.total_chapters || 30
        const allResults: string[] = []
        for (let batch = 0; batch < Math.min(totalChapters, 30); batch += 10) {
          const batchChapters = Array.from({ length: Math.min(10, Math.min(totalChapters, 30) - batch) }, (_, i) => `第 ${batch + i + 1} 章`).join('、')
          const r = await window.electronAPI.aiChat([
            { role: 'system', content: STAGE2_SYSTEM },
            { role: 'user', content: `提取以下章节摘要：${batchChapters}\n${batch === 0 ? `原文参考：\n${sourceText.slice(0, 8000)}` : ''}\n输出 JSON 数组。` },
          ], '拆文-逐章摘要')
          allResults.push(r)
        }
        reply = allResults.join('\n\n')
      } else if (stage.key === 'stage3') {
        const summaries = stageResults.stage2 || stageResults.stage0 || sourceText.slice(0, 10000)
        const [cr, pr, wr] = await Promise.all([
          window.electronAPI.aiChat([{ role: 'system', content: STAGE3_CHARACTER_SYSTEM }, { role: 'user', content: `基于摘要建立角色档案：\n${summaries.slice(0, 15000)}` }], '拆文-角色'),
          window.electronAPI.aiChat([{ role: 'system', content: STAGE3_PLOT_SYSTEM }, { role: 'user', content: `基于摘要分析剧情：\n${summaries.slice(0, 15000)}` }], '拆文-剧情'),
          window.electronAPI.aiChat([{ role: 'system', content: STAGE3_WORLD_SYSTEM }, { role: 'user', content: `基于摘要梳理世界观：\n${summaries.slice(0, 15000)}` }], '拆文-世界观'),
        ])
        reply = `# 角色分析\n${cr}\n\n---\n\n# 剧情分析\n${pr}\n\n---\n\n# 世界观分析\n${wr}`
      } else if (stage.key === 'stage4') {
        reply = await window.electronAPI.aiChat([
          { role: 'system', content: STAGE4_SYSTEM },
          { role: 'user', content: stage4User(sourceText) },
        ], '拆文-文风')
      } else if (stage.key === 'stage5') {
        const allContent = STAGES.filter(s => s.key !== 'stage5' && stageResults[s.key])
          .map(s => `## ${s.title}\n${(stageResults[s.key] || '').slice(0, 3000)}`).join('\n\n---\n\n')
        reply = await window.electronAPI.aiChat([
          { role: 'system', content: STAGE5_SYSTEM },
          { role: 'user', content: `整合拆解成果：\n${allContent}\n\n请输出完整的拆文报告。` },
        ], '拆文-汇总')
      }

      await updateStage(project.id, stage.num, reply)
      setStageResults(prev => ({ ...prev, [stage.key]: reply }))
      setStageStatus(prev => ({ ...prev, [stage.key]: 'done' }))
      showToast('success', `${stage.title} 完成！`)
    } catch (e: any) {
      setStageStatus(prev => ({ ...prev, [stage.key]: 'pending' }))
      showToast('error', `${stage.title} 失败：${e.message || '未知'}`)
    }
  }

  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (error) return <div className="flex justify-center py-24 text-text-secondary">错误：{error}</div>
  if (!project) return <div className="flex justify-center py-24 text-text-secondary">项目不存在或已被删除 (id={id})</div>

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-caption text-text-secondary mb-4">
        <button onClick={() => navigate('/disassembly')} className="hover:text-primary">拆文库</button>
        <span>/</span>
        <span className="text-text-main">{project.name}</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-page-title text-text-main">{project.name}</h1>
          <p className="text-caption text-text-secondary mt-1">
            原文 {(project.source_text || '').length.toLocaleString()} 字 · {project.total_chapters || '?'} 章
          </p>
        </div>
      </div>

      {/* 管线进度条 */}
      <div className="flex items-center gap-1 mb-6 overflow-x-auto pb-2">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 shrink-0">
            {i > 0 && <div className={`w-4 h-0.5 ${stageStatus[s.key] === 'done' ? 'bg-primary' : 'bg-border'}`} />}
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0
              ${stageStatus[s.key] === 'done' ? 'bg-primary text-white' :
                stageStatus[s.key] === 'running' ? 'bg-warning text-white animate-pulse' : 'bg-border text-text-placeholder'}`}
              title={s.title}>
              {stageStatus[s.key] === 'done' ? '✓' : stageStatus[s.key] === 'running' ? '⏳' : s.num}
            </div>
          </div>
        ))}
      </div>

      {/* 阶段卡片 */}
      <div className="space-y-3">
        {STAGES.map(stage => {
          const isRunning = stageStatus[stage.key] === 'running'
          const isDone = stageStatus[stage.key] === 'done'
          const isExpanded = expandedStage === stage.key
          const canRun = stage.key === 'stage0' || stageStatus[STAGES[STAGES.findIndex(s => s.key === stage.key) - 1]?.key] === 'done'

          return (
            <div key={stage.key} className={`bg-white rounded-card border ${isRunning ? 'border-warning shadow-md' : 'border-border'}`}>
              <div className="flex items-center gap-4 px-4 py-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0
                  ${isDone ? 'bg-primary text-white' : isRunning ? 'bg-warning text-white' : 'bg-border text-text-placeholder'}`}>
                  {isDone ? '✓' : isRunning ? '⏳' : stage.num}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-body font-medium text-text-main">{stage.title}</h3>
                    <span className="text-caption text-text-placeholder">· {stage.agent}</span>
                  </div>
                  <p className="text-caption text-text-secondary">{stage.desc}</p>
                </div>
                <div className="flex gap-2 shrink-0">
                  {isDone && (
                    <button onClick={() => setExpandedStage(isExpanded ? null : stage.key)}
                      className="px-2 py-1 text-caption border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary">
                      {isExpanded ? '收起' : '查看'}
                    </button>
                  )}
                  {!isDone && !isRunning && (
                    <button onClick={() => runStage(stage)} disabled={!canRun}
                      className={`px-3 py-1 text-caption rounded-btn ${canRun ? 'bg-primary text-white hover:bg-primary-hover' : 'bg-border text-text-placeholder cursor-not-allowed'}`}>
                      开始
                    </button>
                  )}
                  {isRunning && (
                    <div className="flex items-center gap-2 px-3 py-1 text-caption text-warning">
                      <div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" />运行中...
                    </div>
                  )}
                </div>
              </div>
              {isExpanded && isDone && stageResults[stage.key] && (
                <div className="border-t border-border px-4 py-3">
                  {editingStage === stage.key ? (
                    <div>
                      <textarea value={editText} onChange={(e) => setEditText(e.target.value)}
                        className="w-full h-48 px-3 py-2 text-xs border border-primary rounded-btn resize-y font-mono" />
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => saveEditStage(stage.key, stage.num)}
                          className="px-3 py-1 text-xs bg-primary text-white rounded-btn">💾 保存</button>
                        <button onClick={() => setEditingStage(null)}
                          className="px-3 py-1 text-xs border border-border-input rounded-btn">取消</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex justify-end mb-1">
                        <button onClick={() => startEditStage(stage.key, stageResults[stage.key])}
                          className="text-xs text-primary hover:underline">✏️ 编辑</button>
                      </div>
                      <pre className="text-caption text-text-secondary whitespace-pre-wrap leading-relaxed max-h-96 overflow-auto">
                        {(stageResults[stage.key] || '').slice(0, 5000)}
                        {(stageResults[stage.key] || '').length > 5000 && '\n\n... (内容已截断)'}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
