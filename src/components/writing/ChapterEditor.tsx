import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import ReferenceSelector, { buildReferenceContext } from '../common/ReferenceSelector'
import ChapterList from './ChapterList'
import {
  CHAPTER_SYSTEM, CHAPTER_USER,
  CONTEXT_UPDATE_SYSTEM, CONTEXT_UPDATE_USER,
} from '../../services/generator'
import { exportToTxt, exportToDocx } from '../../services/export'
import DeslopPanel from './DeslopPanel'
import type { NovelProject, ChapterPlan, Chapter, StyleLibrary } from '../../types'
import type { DisassemblyProject } from '../../store/disassemblyStore'

export default function ChapterEditor() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<NovelProject | null>(null)
  const [chapterPlans, setChapterPlans] = useState<ChapterPlan[]>([])
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [currentChapter, setCurrentChapter] = useState(1)
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [plotSummary, setPlotSummary] = useState('')
  const [exporting, setExporting] = useState(false)
  const [showExportMenu, setShowExportMenu] = useState(false)

  const [primaryStyleId, setPrimaryStyleId] = useState<number | null>(null)
  const [auxiliaryStyleIds, setAuxiliaryStyleIds] = useState<number[]>([])
  const [disassemblyIds, setDisassemblyIds] = useState<number[]>([])
  const [styleLibraries, setStyleLibraries] = useState<StyleLibrary[]>([])
  const [disassemblies, setDisassemblies] = useState<DisassemblyProject[]>([])

  const loadAll = useCallback(async () => {
    try {
      if (!window.electronAPI) return
      const proj = await window.electronAPI.db.get('SELECT * FROM novel_projects WHERE id = ?', [Number(id)])
      if (!proj) { showToast('error', '项目不存在'); navigate('/'); return }
      setProject(proj)

      const detail = await window.electronAPI.db.get('SELECT chapters FROM detailed_outlines WHERE project_id = ?', [Number(id)])
      if (detail) setChapterPlans(typeof detail.chapters === 'string' ? JSON.parse(detail.chapters) : detail.chapters)

      const chapterRows = await window.electronAPI.db.query('SELECT * FROM chapters WHERE project_id = ? ORDER BY chapter_number', [Number(id)])
      setChapters(chapterRows)

      const ctx = await window.electronAPI.db.get('SELECT * FROM context_state WHERE project_id = ?', [Number(id)])
      if (ctx) setPlotSummary(ctx.plot_summary || '')

      if (proj.primary_style_id) setPrimaryStyleId(proj.primary_style_id)
      try { setAuxiliaryStyleIds(JSON.parse(proj.auxiliary_style_ids || '[]')) } catch {}

      const libs = await window.electronAPI.db.query('SELECT * FROM style_libraries ORDER BY created_at DESC')
      setStyleLibraries(libs.map((l: any) => ({ ...l, style_profile: typeof l.style_profile === 'string' ? JSON.parse(l.style_profile) : l.style_profile })))
      const diss = await window.electronAPI.db.query('SELECT * FROM disassembly_projects ORDER BY updated_at DESC')
      setDisassemblies(diss)
    } catch { showToast('error', '加载失败') }
    setLoaded(true)
  }, [id])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const existing = chapters.find(c => c.chapter_number === currentChapter)
    if (existing) {
      setContent(existing.content || '')
      setTitle(existing.title || '')
    } else {
      const plan = chapterPlans.find(p => p.chapter_number === currentChapter)
      setContent('')
      setTitle(plan?.title || `第 ${currentChapter} 章`)
    }
  }, [currentChapter, chapters, chapterPlans])

  const saveChapter = async (num: number, t: string, c: string) => {
    if (!window.electronAPI) return
    const existing = chapters.find(ch => ch.chapter_number === num)
    if (existing) {
      await window.electronAPI.db.run(
        "UPDATE chapters SET title=?, content=?, word_count=?, status='generated', updated_at=datetime('now','localtime') WHERE id=?",
        [t, c, c.length, existing.id]
      )
    } else {
      await window.electronAPI.db.run(
        "INSERT INTO chapters (project_id, chapter_number, title, content, word_count, status) VALUES (?,?,?,?,?,'generated')",
        [Number(id), num, t, c, c.length]
      )
    }
    await loadAll()
  }

  const updateContext = async (newContent: string) => {
    try {
      if (!window.electronAPI) return
      const ctx = await window.electronAPI.db.get('SELECT * FROM context_state WHERE project_id = ?', [Number(id)])
      const prevCharState = ctx?.character_state || '{}'
      const messages = [
        { role: 'system' as const, content: CONTEXT_UPDATE_SYSTEM },
        { role: 'user' as const, content: CONTEXT_UPDATE_USER(prevCharState, plotSummary, newContent) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '章节生成')
      const jsonMatch = reply.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        const newCharState = JSON.stringify(parsed.character_state || {})
        const newPlotSummary = parsed.plot_summary || ''
        if (ctx) {
          await window.electronAPI.db.run(
            "UPDATE context_state SET character_state=?, plot_summary=?, last_chapter=?, updated_at=datetime('now','localtime') WHERE project_id=?",
            [newCharState, newPlotSummary, currentChapter, Number(id)]
          )
        } else {
          await window.electronAPI.db.run(
            'INSERT INTO context_state (project_id, character_state, plot_summary, last_chapter) VALUES (?,?,?,?)',
            [Number(id), newCharState, newPlotSummary, currentChapter]
          )
        }
        setPlotSummary(newPlotSummary)
      }
    } catch { /* 上下文更新失败不阻塞 */ }
  }

  const handleGenerate = async () => {
    if (!project) return
    const plan = chapterPlans.find(p => p.chapter_number === currentChapter)
    if (!plan) { showToast('error', '未找到本章细纲'); return }

    setGenerating(true)
    try {
      const { styleContext, disassemblyContext } = buildReferenceContext(primaryStyleId, auxiliaryStyleIds, disassemblyIds, styleLibraries, disassemblies)
      const styleDesc = styleContext || '无特殊要求，保持流畅自然的中文写作'

      const prevChapter = chapters.find(c => c.chapter_number === currentChapter - 1)
      const prevExcerpt = prevChapter?.content?.slice(-300) || ''

      let outlineSummary = ''
      try {
        const outline = await window.electronAPI.db.get('SELECT content FROM outlines WHERE project_id = ?', [Number(id)])
        outlineSummary = outline?.content?.slice(0, 1000) || project.description || ''
      } catch { outlineSummary = project.description || '' }

      let characterState = '{}'
      try {
        const ctx = await window.electronAPI.db.get('SELECT character_state FROM context_state WHERE project_id = ?', [Number(id)])
        if (ctx) characterState = ctx.character_state
      } catch {}

      const planAny = plan as any
      const emotionalGoal = planAny.emotional_goal || ''
      const functionTag = planAny.function || planAny.function_tag || ''
      const endingType = planAny.ending_type || '自然收尾'

      const messages = [
        { role: 'system' as const, content: CHAPTER_SYSTEM },
        { role: 'user' as const, content: CHAPTER_USER(
          project.title, outlineSummary, currentChapter, plan.title,
          plan.summary, plan.characters, plan.key_events,
          plan.estimated_words || 3000,
          emotionalGoal, functionTag, endingType,
          styleDesc, plotSummary, characterState, prevExcerpt, disassemblyContext
        )},
      ]
      const reply = await window.electronAPI.aiChat(messages, '上下文更新')
      setContent(reply)
      showToast('success', `第 ${currentChapter} 章生成完成！`)
      await saveChapter(currentChapter, plan.title, reply)
      await updateContext(reply)
    } catch (e: any) { showToast('error', '生成失败：' + (e.message || '未知错误')) }
    finally { setGenerating(false) }
  }

  const handleManualSave = async () => {
    setSaving(true)
    await saveChapter(currentChapter, title, content)
    setSaving(false)
    showToast('success', '章节已保存')
  }

  // 导出
  const handleExport = async (format: 'txt' | 'docx' | 'pdf') => {
    if (chapters.length === 0) { showToast('error', '还没有已生成的章节'); return }
    setExporting(true); setShowExportMenu(false)
    try {
      const t = project?.title || '未命名小说'
      if (format === 'txt') {
        const text = exportToTxt(t, chapters)
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.txt`, filters: [{ name: '文本文档', extensions: ['txt'] }] })
        if (r) { await window.electronAPI.writeFile(r.filePath, text); showToast('success', `已导出：${r.filePath.split(/[/\\]/).pop()}`) }
      } else if (format === 'docx') {
        const blob = await exportToDocx(t, chapters)
        const ab = await blob.arrayBuffer()
        const b64 = btoa(String.fromCharCode(...new Uint8Array(ab)))
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.docx`, filters: [{ name: 'Word', extensions: ['docx'] }] })
        if (r) { await window.electronAPI.writeBuffer(r.filePath, b64); showToast('success', `已导出：${r.filePath.split(/[/\\]/).pop()}`) }
      } else {
        const { default: jsPDF } = await import('jspdf')
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
        let y = 20; const m = 20; const mw = doc.internal.pageSize.getWidth() - m * 2; const lh = 7
        doc.setFontSize(18); doc.text(`《${t}》`, doc.internal.pageSize.getWidth()/2, y, { align: 'center' }); y += lh * 3
        for (const ch of chapters) {
          if (y > 260) { doc.addPage(); y = 20 }
          doc.setFontSize(14); doc.text(`第 ${ch.chapter_number} 章  ${ch.title || ''}`, m, y); y += lh * 2
          doc.setFontSize(10)
          const lines = doc.splitTextToSize(ch.content || '', mw)
          for (const line of lines) { if (y > 270) { doc.addPage(); y = 20 }; doc.text(line, m, y); y += lh }
          y += lh * 2
        }
        const pdfAb = doc.output('arraybuffer')
        const b64p = btoa(String.fromCharCode(...new Uint8Array(pdfAb)))
        const r = await window.electronAPI.saveFile({ defaultPath: `${t}.pdf`, filters: [{ name: 'PDF', extensions: ['pdf'] }] })
        if (r) { await window.electronAPI.writeBuffer(r.filePath, b64p); showToast('success', `已导出：${r.filePath.split(/[/\\]/).pop()}`) }
      }
    } catch (e: any) { showToast('error', '导出失败：' + e.message) }
    finally { setExporting(false) }
  }

  const plan = chapterPlans.find(p => p.chapter_number === currentChapter) as any
  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (!project) return null

  return (
    <div className="flex gap-4 h-full">
      <ChapterList chapterPlans={chapterPlans} generatedChapters={chapters} currentChapter={currentChapter} onSelect={setCurrentChapter} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 text-xs text-text-secondary mb-0.5">
              <button onClick={() => navigate('/')} className="hover:text-primary">首页</button><span>/</span>
              <span className="text-text-main">{project.title}</span>
            </div>
            <h1 className="text-section-title text-text-main">第 {currentChapter} 章 · {title || '未命名'}</h1>
          </div>
          <div className="flex gap-1.5 relative">
            <button onClick={handleManualSave} disabled={saving || !content.trim()}
              className={`px-2.5 py-1.5 rounded-btn text-xs border ${content.trim() ? 'border-primary text-primary hover:bg-primary-light' : 'border-border-input text-text-placeholder cursor-not-allowed'}`}>
              {saving ? '...' : '💾'}
            </button>
            <button onClick={handleGenerate} disabled={generating || !plan}
              className="px-2.5 py-1.5 bg-primary text-white rounded-btn text-xs hover:bg-primary-hover disabled:opacity-50">
              {generating ? '⏳' : content ? '🔄' : '🤖'}
            </button>
            <div className="relative">
              <button onClick={() => setShowExportMenu(!showExportMenu)} disabled={exporting || chapters.length === 0}
                className="px-2.5 py-1.5 rounded-btn text-xs border border-border-input text-text-secondary hover:bg-bg-secondary disabled:opacity-50">📥</button>
              {showExportMenu && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-card border border-border shadow-lg z-10 w-28">
                  {(['txt','docx','pdf'] as const).map(f => (
                    <button key={f} onClick={() => handleExport(f)}
                      className="w-full px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-bg-secondary first:rounded-t-card last:rounded-b-card">
                      {f==='txt'?'📄 TXT':f==='docx'?'📝 Word':'📕 PDF'}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <ReferenceSelector
          primaryStyleId={primaryStyleId} auxiliaryStyleIds={auxiliaryStyleIds} disassemblyIds={disassemblyIds}
          onChange={(refs) => { setPrimaryStyleId(refs.primaryStyleId); setAuxiliaryStyleIds(refs.auxiliaryStyleIds); setDisassemblyIds(refs.disassemblyIds) }}
        />

        {/* 去AI味面板 */}
        {content && <DeslopPanel content={content} onApply={(newContent) => { setContent(newContent); handleManualSave() }} />}

        {plan && (
          <div className="bg-primary-light/30 rounded-card border border-primary/10 p-3 mb-3">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              <span><span className="text-text-placeholder">功能：</span>{(plan as any).function || (plan as any).function_tag || '推进主线'}</span>
              {(plan as any).emotional_goal && <span><span className="text-text-placeholder">情绪：</span>{(plan as any).emotional_goal}</span>}
              <span><span className="text-text-placeholder">概要：</span>{plan.summary}</span>
              <span><span className="text-text-placeholder">人物：</span>{plan.characters.join('、')}</span>
              <span><span className="text-text-placeholder">字数：</span>{plan.estimated_words}字</span>
            </div>
          </div>
        )}

        {generating ? (
          <div className="bg-white rounded-card border border-border p-16 text-center">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-body text-text-main">AI 正在撰写第 {currentChapter} 章...</p>
            <p className="text-xs text-text-secondary mt-1">约需 40-80 秒</p>
          </div>
        ) : !content ? (
          <div className="bg-white rounded-card border border-border p-16 text-center">
            <span className="text-5xl mb-4 block">✍️</span>
            <h2 className="text-section-title text-text-main mb-2">第 {currentChapter} 章</h2>
            <p className="text-body text-text-secondary mb-6">{plan ? '点击按钮，AI 将根据细纲和参考内容生成本章' : '请先生成细纲'}</p>
            {plan && <button onClick={handleGenerate} className="px-6 py-3 bg-primary text-white rounded-btn text-body hover:bg-primary-hover">🤖 生成本章</button>}
          </div>
        ) : (
          <textarea value={content} onChange={(e) => setContent(e.target.value)}
            className="w-full min-h-[500px] px-5 py-4 border border-border-input rounded-card text-body focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 resize-y leading-relaxed bg-white" />
        )}
      </div>
    </div>
  )
}
