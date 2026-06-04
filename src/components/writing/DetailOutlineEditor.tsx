import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import ReferenceSelector, { buildReferenceContext } from '../common/ReferenceSelector'
import { DETAIL_OUTLINE_SYSTEM, DETAIL_OUTLINE_USER } from '../../services/generator'
import type { NovelProject, ChapterPlan, StyleLibrary } from '../../types'
import type { DisassemblyProject } from '../../store/disassemblyStore'

export default function DetailOutlineEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<NovelProject | null>(null)
  const [outlineContent, setOutlineContent] = useState('')
  const [chapters, setChapters] = useState<ChapterPlan[]>([])
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [editingChapter, setEditingChapter] = useState<number | null>(null)

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

        const outline = await window.electronAPI.db.get('SELECT content FROM outlines WHERE project_id = ?', [Number(id)])
        if (outline) setOutlineContent(outline.content)

        const detail = await window.electronAPI.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
        if (detail) setChapters(JSON.parse(detail.chapters))

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
    if (!outlineContent) { showToast('error', '请先生成大纲'); return }
    setGenerating(true)
    try {
      const { styleContext, disassemblyContext } = buildReferenceContext(primaryStyleId, auxiliaryStyleIds, disassemblyIds, styleLibraries, disassemblies)
      const messages = [
        { role: 'system' as const, content: DETAIL_OUTLINE_SYSTEM },
        { role: 'user' as const, content: DETAIL_OUTLINE_USER(outlineContent, styleContext, disassemblyContext) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '细纲生成')
      const jsonMatch = reply.match(/```json\s*([\s\S]*?)\s*```/) || reply.match(/\[[\s\S]*\]/)
      const parsed = JSON.parse(jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : reply)
      setChapters(parsed)
      showToast('success', `细纲生成完成！共 ${parsed.length} 章`)
    } catch (e: any) { showToast('error', '生成失败：' + e.message) }
    finally { setGenerating(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (!window.electronAPI) return
      const ex = await window.electronAPI.db.get('SELECT id FROM detailed_outlines WHERE project_id=?', [Number(id)])
      ex
        ? await window.electronAPI.db.run("UPDATE detailed_outlines SET chapters=?, updated_at=datetime('now','localtime') WHERE project_id=?", [JSON.stringify(chapters), Number(id)])
        : await window.electronAPI.db.run('INSERT INTO detailed_outlines (project_id,chapters) VALUES (?,?)', [Number(id), JSON.stringify(chapters)])
      showToast('success', '已保存')
    } catch { showToast('error', '保存失败') }
    finally { setSaving(false) }
  }

  const updateChapter = (i: number, field: keyof ChapterPlan, value: any) =>
    setChapters(prev => prev.map((ch, idx) => idx === i ? { ...ch, [field]: value } : ch))

  const totalWords = chapters.reduce((s, ch) => s + (ch.estimated_words || 0), 0)
  const functionCounts = chapters.reduce((acc, ch) => {
    const f = (ch as any).function || (ch as any).function_tag || ''
    acc[f] = (acc[f] || 0) + 1; return acc
  }, {} as Record<string, number>)

  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (!project) return null

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-text-secondary mb-4">
        <button onClick={() => navigate('/')} className="hover:text-primary">首页</button>
        <span>/</span>
        <button onClick={() => navigate(`/project/${id}/outline`)} className="hover:text-primary">{project.title}</button>
        <span>/</span>
        <span className="text-primary">细纲</span>
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl text-text-main">{project.title}</h1>
          <p className="text-sm text-text-secondary mt-1">📑 章节细纲：功能标签 + 情绪目标 + 节奏控制</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleSave} disabled={saving || chapters.length === 0}
            className={`px-4 py-2 rounded-btn text-base ${chapters.length>0 ? 'border border-primary text-primary hover:bg-primary-light' : 'border border-border-input text-text-placeholder cursor-not-allowed'}`}>
            {saving?'保存中...':'💾 保存'}
          </button>
          <button onClick={() => { handleSave(); navigate(`/project/${id}/write`) }} disabled={chapters.length === 0}
            className={`px-4 py-2 rounded-btn text-base ${chapters.length>0 ? 'bg-primary text-white hover:bg-primary-hover' : 'bg-border text-text-placeholder cursor-not-allowed'}`}>
            开始写作 →
          </button>
        </div>
      </div>

      <ReferenceSelector
        primaryStyleId={primaryStyleId} auxiliaryStyleIds={auxiliaryStyleIds}
        disassemblyIds={disassemblyIds}
        onChange={(refs) => { setPrimaryStyleId(refs.primaryStyleId); setAuxiliaryStyleIds(refs.auxiliaryStyleIds); setDisassemblyIds(refs.disassemblyIds) }}
      />

      {chapters.length === 0 && !generating ? (
        <div className="bg-white rounded-card border border-border p-12 text-center">
          <span className="text-5xl mb-4 block">📑</span>
          <h2 className="text-lg text-text-main mb-2">生成章节细纲</h2>
          <p className="text-base text-text-secondary mb-6">
            AI 将根据大纲和参考内容规划逐章纲要，每章标注功能、情绪目标和节奏位置
          </p>
          <button onClick={handleGenerate} className="px-6 py-3 bg-primary text-white rounded-btn text-base hover:bg-primary-hover">🤖 生成细纲</button>
        </div>
      ) : generating ? (
        <div className="bg-white rounded-card border border-border p-12 text-center">
          <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-base text-text-main">AI 正在规划章节节奏...</p>
          <p className="text-sm text-text-secondary mt-1">约需 40-80 秒</p>
        </div>
      ) : (
        <>
          <div className="flex gap-4 mb-4 flex-wrap">
            <div className="bg-white rounded-card border border-border px-4 py-2"><span className="text-sm text-text-secondary">总章节：</span><span className="text-base font-medium text-text-main">{chapters.length} 章</span></div>
            <div className="bg-white rounded-card border border-border px-4 py-2"><span className="text-sm text-text-secondary">预估总字数：</span><span className="text-base font-medium text-text-main">约 {totalWords.toLocaleString()} 字</span></div>
            {Object.entries(functionCounts).filter(([k]) => k).slice(0, 4).map(([k, v]) => (
              <div key={k} className="bg-white rounded-card border border-border px-3 py-2"><span className="text-sm">{k}</span><span className="text-base font-medium text-text-main ml-1">×{v}</span></div>
            ))}
          </div>

          <div className="space-y-1.5">
            {chapters.map((ch: any, i: number) => (
              <div key={i} className="bg-white rounded-card border border-border hover:border-primary/30 transition-colors">
                <div onClick={() => setEditingChapter(editingChapter === i ? null : i)} className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                  <span className="w-7 h-7 rounded-full bg-primary-light text-primary flex items-center justify-center text-xs font-medium shrink-0">{ch.chapter_number}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-main truncate">{ch.title || `第${ch.chapter_number}章`}</span>
                      {(ch.function || ch.function_tag) && <span className="text-xs px-1.5 py-0.5 rounded bg-bg-secondary text-text-secondary">{ch.function || ch.function_tag}</span>}
                      {(ch.emotional_goal) && <span className="text-xs text-text-placeholder">🎯 {ch.emotional_goal}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-text-placeholder mt-0.5">
                      <span>{ch.estimated_words}字</span>
                      {(ch as any).ending_type && <span>结尾：{(ch as any).ending_type}</span>}
                    </div>
                  </div>
                  <span className="text-text-placeholder text-xs">{editingChapter === i ? '▲' : '▼'}</span>
                </div>
                {editingChapter === i && (
                  <div className="px-4 pb-3 border-t border-border pt-3 space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                      <div><label className="text-xs text-text-secondary mb-0.5 block">标题</label><input value={ch.title} onChange={e => updateChapter(i, 'title', e.target.value)} className="w-full h-8 px-2 border border-border-input rounded text-xs focus:outline-none focus:border-primary" /></div>
                      <div><label className="text-xs text-text-secondary mb-0.5 block">字数</label><input type="number" value={ch.estimated_words} onChange={e => updateChapter(i, 'estimated_words', Number(e.target.value))} className="w-full h-8 px-2 border border-border-input rounded text-xs" /></div>
                      <div><label className="text-xs text-text-secondary mb-0.5 block">功能</label><input value={(ch as any).function || ''} onChange={e => { const u = {...ch, function: e.target.value}; setChapters(prev => prev.map((c,idx) => idx===i ? u : c)) }} className="w-full h-8 px-2 border border-border-input rounded text-xs" /></div>
                      <div><label className="text-xs text-text-secondary mb-0.5 block">情绪目标</label><input value={(ch as any).emotional_goal || ''} onChange={e => { const u = {...ch, emotional_goal: e.target.value}; setChapters(prev => prev.map((c,idx) => idx===i ? u : c)) }} className="w-full h-8 px-2 border border-border-input rounded text-xs" /></div>
                    </div>
                    <div><label className="text-xs text-text-secondary mb-0.5 block">概要</label><textarea value={ch.summary} onChange={e => updateChapter(i, 'summary', e.target.value)} rows={2} className="w-full px-2 py-1 border border-border-input rounded text-xs resize-none focus:outline-none focus:border-primary" /></div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><label className="text-xs text-text-secondary mb-0.5 block">人物</label><input value={ch.characters.join(', ')} onChange={e => updateChapter(i, 'characters', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))} className="w-full h-8 px-2 border border-border-input rounded text-xs" /></div>
                      <div><label className="text-xs text-text-secondary mb-0.5 block">关键事件</label><input value={ch.key_events.join(', ')} onChange={e => updateChapter(i, 'key_events', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))} className="w-full h-8 px-2 border border-border-input rounded text-xs" /></div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
