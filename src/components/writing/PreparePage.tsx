import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import ReferenceSelector, { buildReferenceContext } from '../common/ReferenceSelector'
import { PREPARE_SYSTEM, PREPARE_USER } from '../../services/generator'
import { useDisassemblyStore, DisassemblyProject } from '../../store/disassemblyStore'
import type { NovelProject, StyleLibrary } from '../../types'

export default function PreparePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<NovelProject | null>(null)
  const [prepareContent, setPrepareContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const [primaryStyleId, setPrimaryStyleId] = useState<number | null>(null)
  const [auxiliaryStyleIds, setAuxiliaryStyleIds] = useState<number[]>([])
  const [disassemblyIds, setDisassemblyIds] = useState<number[]>([])
  const [styleLibraries, setStyleLibraries] = useState<StyleLibrary[]>([])
  const [disassemblies, setDisassemblies] = useState<DisassemblyProject[]>([])

  useEffect(() => {
    const load = async () => {
      try {
        if (window.electronAPI) {
          const proj = await window.electronAPI.db.get('SELECT * FROM novel_projects WHERE id = ?', [Number(id)])
          if (!proj) { showToast('error', '项目不存在'); navigate('/'); return }
          setProject(proj)

          // 加载已有准备内容
          const row = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`prepare_${id}`])
          if (row) setPrepareContent(row.value)

          if (proj.primary_style_id) setPrimaryStyleId(proj.primary_style_id)
          try { setAuxiliaryStyleIds(JSON.parse(proj.auxiliary_style_ids || '[]')) } catch {}

          const libs = await window.electronAPI.db.query('SELECT * FROM style_libraries ORDER BY created_at DESC')
          setStyleLibraries(libs.map((l: any) => ({ ...l, style_profile: typeof l.style_profile === 'string' ? JSON.parse(l.style_profile) : l.style_profile })))

          const diss = await window.electronAPI.db.query('SELECT * FROM disassembly_projects ORDER BY updated_at DESC')
          setDisassemblies(diss)
        }
      } catch { showToast('error', '加载失败') }
      setLoaded(true)
    }
    load()
  }, [id])

  const handleGenerate = async () => {
    if (!project) return
    setGenerating(true)
    try {
      const messages = [
        { role: 'system' as const, content: PREPARE_SYSTEM },
        { role: 'user' as const, content: PREPARE_USER(project.title, project.description) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '准备-选题方向')
      setPrepareContent(reply)
      showToast('success', '创作方案生成完成！')
    } catch (e: any) { showToast('error', '生成失败：' + e.message) }
    finally { setGenerating(false) }
  }

  const handleSave = async () => {
    if (!prepareContent.trim()) { showToast('error', '内容为空'); return }
    try {
      if (window.electronAPI) {
        await window.electronAPI.settings.set(`prepare_${id}`, prepareContent)
        await window.electronAPI.db.run(
          'UPDATE novel_projects SET primary_style_id = ?, auxiliary_style_ids = ? WHERE id = ?',
          [primaryStyleId, JSON.stringify(auxiliaryStyleIds), Number(id)]
        )
        showToast('success', '已保存')
      }
    } catch { showToast('error', '保存失败') }
  }

  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (!project) return null

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-text-secondary mb-4">
        <button onClick={() => navigate('/')} className="hover:text-primary">首页</button>
        <span>/</span>
        <span className="text-text-main">{project.title}</span>
        <span>/</span>
        <span className="text-primary">准备</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl text-text-main">{project.title}</h1>
          <p className="text-sm text-text-secondary mt-1">🎯 写作准备：情绪定位 + 角色设计 + 世界观</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={!prepareContent.trim()}
            className={`px-4 py-2 rounded-btn text-base transition-colors ${prepareContent.trim() ? 'border border-primary text-primary hover:bg-primary-light' : 'border border-border-input text-text-placeholder cursor-not-allowed'}`}>
            💾 保存
          </button>
          <button onClick={() => navigate(`/project/${id}/outline`)}
            className="px-4 py-2 bg-primary text-white rounded-btn text-base hover:bg-primary-hover transition-colors">
            下一步：大纲 →
          </button>
        </div>
      </div>

      {/* 引用选择 */}
      <ReferenceSelector
        primaryStyleId={primaryStyleId} auxiliaryStyleIds={auxiliaryStyleIds}
        disassemblyIds={disassemblyIds}
        onChange={(refs) => { setPrimaryStyleId(refs.primaryStyleId); setAuxiliaryStyleIds(refs.auxiliaryStyleIds); setDisassemblyIds(refs.disassemblyIds) }}
      />

      {/* 生成/编辑 */}
      {!prepareContent && !generating ? (
        <div className="bg-white rounded-card border border-border p-12 text-center">
          <span className="text-5xl mb-4 block">🎯</span>
          <h2 className="text-lg text-text-main mb-2">写作准备</h2>
          <p className="text-base text-text-secondary mb-2">AI 帮你想清楚：</p>
          <div className="text-base text-text-secondary mb-6 space-y-1">
            <p>① 这本书给读者什么情绪？→ 匹配什么题材？</p>
            <p>② 主角是谁？核心欲望和缺陷是什么？</p>
            <p>③ 有什么可对标参考的作品？</p>
          </div>
          <button onClick={handleGenerate}
            className="px-6 py-3 bg-primary text-white rounded-btn text-base hover:bg-primary-hover transition-colors">
            🤖 开始准备
          </button>
        </div>
      ) : generating ? (
        <div className="bg-white rounded-card border border-border p-12 text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-base text-text-main">AI 正在分析选题方向...</p>
          <p className="text-sm text-text-secondary mt-1">通常需要 20-40 秒</p>
        </div>
      ) : (
        <div className="bg-white rounded-card border border-border p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg text-text-main">创作方案</h2>
            <button onClick={handleGenerate} className="text-sm text-primary hover:underline">🔄 重新生成</button>
          </div>
          <textarea value={prepareContent} onChange={(e) => setPrepareContent(e.target.value)}
            className="w-full min-h-[500px] px-4 py-3 border border-border-input rounded-btn text-base focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 resize-y leading-relaxed" />
        </div>
      )}
    </div>
  )
}
