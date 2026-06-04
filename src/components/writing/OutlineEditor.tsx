import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import ReferenceSelector, { buildReferenceContext } from '../common/ReferenceSelector'
import { OUTLINE_SYSTEM, OUTLINE_USER } from '../../services/generator'
import type { NovelProject, StyleLibrary } from '../../types'
import type { DisassemblyProject } from '../../store/disassemblyStore'

export default function OutlineEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<NovelProject | null>(null)
  const [prepareContent, setPrepareContent] = useState('')
  const [outlineContent, setOutlineContent] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const [primaryStyleId, setPrimaryStyleId] = useState<number | null>(null)
  const [auxiliaryStyleIds, setAuxiliaryStyleIds] = useState<number[]>([])
  const [disassemblyIds, setDisassemblyIds] = useState<number[]>([])
  const [styleLibraries, setStyleLibraries] = useState<StyleLibrary[]>([])
  const [disassemblies, setDisassemblies] = useState<DisassemblyProject[]>([])

  useEffect(() => {
    (async () => {
      try {
        if (!window.electronAPI) { setLoaded(true); return }
        const proj = await window.electronAPI.db.get('SELECT * FROM novel_projects WHERE id = ?', [Number(id)])
        if (!proj) { showToast('error', '项目不存在'); navigate('/'); return }
        setProject(proj)

        // 加载准备内容
        const row = await window.electronAPI.db.get("SELECT value FROM settings WHERE key = ?", [`prepare_${id}`])
        if (row) setPrepareContent(row.value)

        // 加载大纲
        const outline = await window.electronAPI.db.get('SELECT content FROM outlines WHERE project_id = ?', [Number(id)])
        if (outline) setOutlineContent(outline.content)

        // 引用
        if (proj.primary_style_id) setPrimaryStyleId(proj.primary_style_id)
        try { setAuxiliaryStyleIds(JSON.parse(proj.auxiliary_style_ids || '[]')) } catch {}
        const libs = await window.electronAPI.db.query('SELECT * FROM style_libraries ORDER BY created_at DESC')
        setStyleLibraries(libs.map((l: any) => ({ ...l, style_profile: typeof l.style_profile === 'string' ? JSON.parse(l.style_profile) : l.style_profile })))
        const diss = await window.electronAPI.db.query('SELECT * FROM disassembly_projects ORDER BY updated_at DESC')
        setDisassemblies(diss)
      } catch { showToast('error', '加载失败') }
      setLoaded(true)
    })()
  }, [id])

  const handleGenerate = async () => {
    if (!project) return
    setGenerating(true)
    try {
      const { styleContext, disassemblyContext } = buildReferenceContext(
        primaryStyleId, auxiliaryStyleIds, disassemblyIds, styleLibraries, disassemblies
      )

      const messages = [
        { role: 'system' as const, content: OUTLINE_SYSTEM },
        { role: 'user' as const, content: OUTLINE_USER(project.title, project.description, prepareContent, styleContext, disassemblyContext) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '大纲生成')
      setOutlineContent(reply)
      showToast('success', '大纲生成完成！')
      // 保存引用
      await window.electronAPI.db.run('UPDATE novel_projects SET primary_style_id=?, auxiliary_style_ids=? WHERE id=?', [primaryStyleId, JSON.stringify(auxiliaryStyleIds), Number(id)])
    } catch (e: any) { showToast('error', '生成失败：' + e.message) }
    finally { setGenerating(false) }
  }

  const handleSave = async () => {
    if (!outlineContent.trim()) { showToast('error', '大纲为空'); return }
    setSaving(true)
    try {
      if (!window.electronAPI) return
      const ex = await window.electronAPI.db.get('SELECT id FROM outlines WHERE project_id=?', [Number(id)])
      ex
        ? await window.electronAPI.db.run("UPDATE outlines SET content=?, version=version+1, updated_at=datetime('now','localtime') WHERE project_id=?", [outlineContent, Number(id)])
        : await window.electronAPI.db.run('INSERT INTO outlines (project_id,content) VALUES (?,?)', [Number(id), outlineContent])
      showToast('success', '已保存')
    } catch { showToast('error', '保存失败') }
    finally { setSaving(false) }
  }

  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (!project) return null

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-text-secondary mb-4">
        <button onClick={() => navigate('/')} className="hover:text-primary">首页</button>
        <span>/</span>
        <button onClick={() => navigate(`/project/${id}/prepare`)} className="hover:text-primary">{project.title}</button>
        <span>/</span>
        <span className="text-primary">大纲</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl text-text-main">{project.title}</h1>
          <p className="text-sm text-text-secondary mt-1">📋 故事大纲：情绪弧线 + 爽点分布 + 钩子设计</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving || !outlineContent.trim()}
            className={`px-4 py-2 rounded-btn text-base transition-colors ${outlineContent.trim() ? 'border border-primary text-primary hover:bg-primary-light' : 'border border-border-input text-text-placeholder cursor-not-allowed'}`}>
            {saving ? '保存中...' : '💾 保存'}
          </button>
          <button onClick={() => { handleSave(); navigate(`/project/${id}/detail-outline`) }} disabled={!outlineContent.trim()}
            className={`px-4 py-2 rounded-btn text-base transition-colors ${outlineContent.trim() ? 'bg-primary text-white hover:bg-primary-hover' : 'bg-border text-text-placeholder cursor-not-allowed'}`}>
            下一步：细纲 →
          </button>
        </div>
      </div>

      <ReferenceSelector
        primaryStyleId={primaryStyleId} auxiliaryStyleIds={auxiliaryStyleIds}
        disassemblyIds={disassemblyIds}
        onChange={(refs) => { setPrimaryStyleId(refs.primaryStyleId); setAuxiliaryStyleIds(refs.auxiliaryStyleIds); setDisassemblyIds(refs.disassemblyIds) }}
      />

      {!prepareContent && !outlineContent && (
        <div className="bg-warning/10 rounded-card border border-warning/30 p-4 mb-4 text-base text-text-secondary">
          ⚠️ 建议先去「准备」页面完成情绪定位和角色设计，再生成大纲效果更好。
          <button onClick={() => navigate(`/project/${id}/prepare`)} className="ml-2 text-primary hover:underline">去准备 →</button>
        </div>
      )}

      {!outlineContent && !generating ? (
        <div className="bg-white rounded-card border border-border p-12 text-center">
          <span className="text-5xl mb-4 block">📐</span>
          <h2 className="text-lg text-text-main mb-2">生成故事大纲</h2>
          <p className="text-base text-text-secondary mb-6">
            AI 将根据准备方案、风格库和拆文库，生成包含情绪弧线、爽点分布和钩子设计的完整大纲
          </p>
          <button onClick={handleGenerate} className="px-6 py-3 bg-primary text-white rounded-btn text-base hover:bg-primary-hover transition-colors">
            🤖 生成大纲
          </button>
        </div>
      ) : generating ? (
        <div className="bg-white rounded-card border border-border p-12 text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-base text-text-main">AI 正在构思故事架构...</p>
          <p className="text-sm text-text-secondary mt-1">正在学习参考内容，约需 40-80 秒</p>
        </div>
      ) : (
        <div className="bg-white rounded-card border border-border p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg text-text-main">大纲</h2>
            <button onClick={handleGenerate} className="text-sm text-primary hover:underline">🔄 重新生成</button>
          </div>
          <textarea value={outlineContent} onChange={(e) => setOutlineContent(e.target.value)}
            className="w-full min-h-[500px] px-4 py-3 border border-border-input rounded-btn text-base focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 resize-y leading-relaxed" />
        </div>
      )}
    </div>
  )
}
