import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import ReferenceSelector from '../common/ReferenceSelector'
import ChapterList from './ChapterList'
import {
  CHAPTER_SYSTEM, CHAPTER_USER,
  buildExecutionConstraints,
  CONTEXT_UPDATE_SYSTEM, CONTEXT_UPDATE_USER,
} from '../../services/generator'
import { exportToTxt, exportToDocx } from '../../services/export'
import DeslopPanel from './DeslopPanel'
import type { NovelProject, ChapterPlan, Chapter, StyleLibrary, PersonalityProject } from '../../types'
import type { DisassemblyProject } from '../../store/disassemblyStore'
import * as trackerService from '../../services/trackerService'

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
  const [primaryPersonalityId, setPrimaryPersonalityId] = useState<number | null>(null)
  const [auxPersonalityIds, setAuxPersonalityIds] = useState<number[]>([])
  const [styleLibraries, setStyleLibraries] = useState<StyleLibrary[]>([])
  const [personalityProjects, setPersonalityProjects] = useState<PersonalityProject[]>([])

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
      const pers = await window.electronAPI.db.query('SELECT * FROM personality_projects ORDER BY updated_at DESC')
      setPersonalityProjects(pers.map((p: any) => ({ ...p, personality_data: typeof p.personality_data === 'string' ? JSON.parse(p.personality_data || '{}') : (p.personality_data || {}) })))
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

  // ── 构建风格上下文（与 Workspace 一致） ──
  function extractItems(text: string | undefined, maxItems: number): string[] {
    if (!text || text.length < 5) return []
    const items = text.split(/[。；\n]+/).map(s => s.trim()).filter(s => s.length > 3)
    return items.slice(0, maxItems)
  }

  function buildStyleContext(): string {
    const ids = [primaryStyleId, ...auxiliaryStyleIds].filter(Boolean) as number[]
    const styles = styleLibraries.filter(l => ids.includes(l.id))
    if (!styles.length) return ''
    return styles.map((s) => {
      const p = s.style_profile as any
      const prefix = `【🎨 风格材料池——${s.id === primaryStyleId ? '主' : '辅'}】${s.name}`

      // V4 格式：22类替换指南
      if (p?.replacements) {
        const r = p.replacements
        const lines: string[] = [prefix]
        const keys = ['心理', '表情', '动作', '对话', '比喻', '结尾', '解释', '评判', '句子', '句式', '副词', '煽情', '描写', '连接词', '猜测', '过渡', '总结', '收束', '泛化', '成语', '预告']
        let count = 0
        for (const k of keys) {
          const dim = r[k]
          if (!dim || count >= 8) continue
          count++
          lines.push(`\n【${k}】`)
          if (dim.ai_uses?.length) lines.push(`❌ AI会用：${dim.ai_uses.join('、')}`)
          if (dim.human_uses?.length) lines.push(`✅ 人类写法：${dim.human_uses.slice(0, 2).map((u: string) => `"${u}"`).join(' / ')}`)
          if (dim.rule) lines.push(`📏 规则：${dim.rule}`)
        }
        return lines.join('\n')
      }

      // V3 旧格式回退
      const n = p?.narrative; const rh = p?.sentence_rhythm
      const pg = p?.paragraph; const l = p?.language; const a = p?.atmosphere
      const hard: string[] = []; const soft: string[] = []; const style: string[] = []

      if (n?.perspective) hard.push(`- 使用「${n.perspective}」。禁止切换视角。`)
      if (n?.pov_rules) hard.push(`- ${n.pov_rules}`)
      if (pg?.forbidden) hard.push(`- 禁止：${pg.forbidden}`)
      if (l?.forbidden_words) {
        const words = l.forbidden_words.split(/[,，、\s]+/).filter((w: string) => w.length > 1)
        if (words.length > 0) hard.push(`- 禁用词汇（出现即违规）：${words.slice(0, 20).join('、')}`)
      }
      if (rh && typeof rh === 'object') {
        if (rh.short_max) soft.push(`- 短句≤${rh.short_max}字`)
        if (rh.long_min) soft.push(`- 长句≥${rh.long_min}字`)
        if (rh.density) soft.push(`- 句式密度：${rh.density}`)
        if (rh.exception) soft.push(`- 例外：${rh.exception}`)
      } else if (typeof rh === 'string' && rh.length > 2) {
        soft.push(`- 句式：${rh}`)
      } else {
        const ws = p?.writing_style
        if (ws?.sentence_characteristics) soft.push(`- 句式：${ws.sentence_characteristics}`)
      }
      if (l?.vocab_level) soft.push(`- 词汇层级：${l.vocab_level}`)
      if (l?.dialogue_vs_narrative) soft.push(`- 叙事vs对话：${l.dialogue_vs_narrative}`)
      if (a?.emotion_scale) soft.push(`- 情绪跨度：${a.emotion_scale}`)
      if (a?.level_triggers) soft.push(`- 升档触发：${a.level_triggers}`)
      if (a?.must_downgrade) soft.push(`- 必须降档场景：${a.must_downgrade}`)
      if (pg?.habit) soft.push(`- 段落习惯：${pg.habit}`)
      if (pg?.by_scene_type) soft.push(`- 场景段落：${pg.by_scene_type}`)

      if (n?.narrator_intrusion) style.push(`- 叙事者行为：${n.narrator_intrusion}`)
      if (a?.tone) style.push(`- 氛围：${a.tone}`)
      else if (a?.primary) style.push(`- 氛围：${a.primary}`)
      if (!hard.length && !soft.length) {
        const ws = p?.writing_style; const lf = p?.language_features
        if (ws?.narrative_perspective) hard.push(`- 使用「${ws.narrative_perspective}」`)
        if (ws?.pace) soft.push(`- 节奏：${ws.pace}`)
        if (lf?.vocabulary_preference) soft.push(`- 词汇：${lf.vocabulary_preference}`)
        if (ws?.paragraph_ratio) soft.push(`- 段落：${ws.paragraph_ratio}`)
      }

      const sections: string[] = [prefix]
      if (hard.length) sections.push(`🔴 必须遵守（${Math.min(hard.length, 7)}条）：\n${hard.slice(0, 7).join('\n')}`)
      if (soft.length) sections.push(`🟡 优先遵守（${Math.min(soft.length, 12)}条）：\n${soft.slice(0, 12).join('\n')}`)
      if (style.length) sections.push(`🔵 风格漂移（${Math.min(style.length, 15)}条）：\n${style.slice(0, 15).join('\n')}`)
      return sections.join('\n\n')
    }).join('\n')
  }

  function buildPersonalityContext(): string {
    const ids = [primaryPersonalityId, ...auxPersonalityIds].filter(Boolean) as number[]
    const projects = personalityProjects.filter(p => ids.includes(p.id))
    if (!projects.length) return ''
    return projects.map(p => {
      const d = p.personality_data || {} as any
      const prefix = `【🧠 人格材料池——${p.id === primaryPersonalityId ? '主' : '辅'}】${p.name}`

      // V2 新格式：5核替换器
      if (d?.emotion || d?.imagery || d?.dialogue) {
        const lines: string[] = [prefix]
        const addReplacer = (title: string, obj: any) => {
          const sub: string[] = []
          for (const [label, dim] of Object.entries(obj) as any) {
            if (!dim?.author_uses?.length) continue
            sub.push(`  ${label}: ❌${(dim.ai_defaults||[]).join('、')} → ✅${dim.author_uses.join('、')}`)
            if (dim.principle) sub.push(`    📏 ${dim.principle}`)
          }
          if (sub.length) lines.push(`【${title}】\n${sub.join('\n')}`)
        }
        if (d.emotion) addReplacer('情绪替换器', d.emotion)
        if (d.imagery) addReplacer('意象替换器', d.imagery)
        if (d.dialogue) addReplacer('对话替换器', d.dialogue)
        if (d.rhythm) addReplacer('节奏替换器', d.rhythm)
        if (d.observation) addReplacer('观察替换器', d.observation)
        if (d.style_profile?.global_pattern) lines.push(`【全局模式】${d.style_profile.global_pattern}`)
        return lines.join('\n')
      }

      // V1 旧格式回退
      const soft: string[] = []; const style: string[] = []
      const imgs = extractItems(d.private_imagery, 8)
      if (imgs.length) soft.push(`- 私人意象（只能用以下，禁止训练数据套路意象）：\n${imgs.map(i => `  · ${i}`).join('\n')}`)
      const quirks = extractItems(d.emotional_quirks, 5)
      if (quirks.length) soft.push(`- 情绪怪癖（极端情绪下只能这样反应）：\n${quirks.map(q => `  · ${q}`).join('\n')}`)
      const rhetorics = extractItems(d.private_rhetoric, 5)
      if (rhetorics.length) soft.push(`- 私人修辞（比喻必须从以下生长）：\n${rhetorics.map(r => `  · ${r}`).join('\n')}`)
      const dialogue = extractItems(d.dialogue_fingerprint, 6)
      if (dialogue.length) soft.push(`- 对话指纹：\n${dialogue.map(dl => `  · ${dl}`).join('\n')}`)
      const scenery = extractItems(d.scenery_fingerprint, 5)
      if (scenery.length) soft.push(`- 风景指纹：\n${scenery.map(sc => `  · ${sc}`).join('\n')}`)
      const rhythm = extractItems(d.rhythm_fingerprint, 5)
      if (rhythm.length) style.push(`- 节奏指纹：\n${rhythm.map(r => `  · ${r}`).join('\n')}`)
      const nonsense = extractItems(d.nonsense_style, 4)
      if (nonsense.length) style.push(`- 废话风格：\n${nonsense.map(n => `  · ${n}`).join('\n')}`)
      const narration = extractItems(d.narrative_distance, 4)
      if (narration.length) style.push(`- 叙事距离：\n${narration.map(nr => `  · ${nr}`).join('\n')}`)
      const infoRelease = extractItems(d.info_release, 4)
      if (infoRelease.length) style.push(`- 信息释放：\n${infoRelease.map(ir => `  · ${ir}`).join('\n')}`)
      const sections: string[] = [prefix]
      if (soft.length) sections.push(`🟡 优先遵守（${soft.length}条）：\n${soft.join('\n')}`)
      if (style.length) sections.push(`🔵 风格漂移（${style.length}条）：\n${style.join('\n')}`)
      return sections.join('\n\n')
    }).join('\n')
  }

  const handleGenerate = async () => {
    if (!project) return
    const plan = chapterPlans.find(p => p.chapter_number === currentChapter)
    if (!plan) { showToast('error', '未找到本章细纲'); return }

    setGenerating(true)
    try {
      const styleContext = buildStyleContext()
      const personalityContext = buildPersonalityContext()

      const prevChapter = chapters.find(c => c.chapter_number === currentChapter - 1)
      const prevExcerpt = prevChapter?.content?.slice(-800) || ''

      let outlineSummary = ''
      try {
        const outline = await window.electronAPI.db.get('SELECT content FROM outlines WHERE project_id = ?', [Number(id)])
        outlineSummary = outline?.content?.slice(0, 500) || project.description || ''
      } catch { outlineSummary = project.description || '' }

      let characterState = '{}'
      try {
        const ctx = await window.electronAPI.db.get('SELECT character_state FROM context_state WHERE project_id = ?', [Number(id)])
        if (ctx) characterState = ctx.character_state
      } catch {}

      // v4.0: 硬规则从 story_tracker 读取
      let canonFactsContext = ''
      try {
        const masterItems = await trackerService.getMasterTracker(Number(id))
        const hardRules = masterItems.filter((t: any) => t.tracker_type === 'rules' || t.tracker_type === 'character')
        if (hardRules.length > 0) {
          canonFactsContext = hardRules.map((t: any) =>
            `- [${t.tracker_type}] ${t.tracker_key}: ${t.summary}`
          ).join('\n')
        }
      } catch {}

      const planAny = plan as any

      const messages = [
        { role: 'system' as const, content: buildExecutionConstraints(styleContext, personalityContext) + '\n\n' + CHAPTER_SYSTEM },
        { role: 'user' as const, content: CHAPTER_USER(
          project.title, outlineSummary, currentChapter, plan.title,
          plan.summary || '', plan.characters || [], plan.key_events || [],
          plan.estimated_words || 3000,
          planAny.emotional_goal || planAny.emotional_arc || '', planAny.function || '', planAny.ending_type || '自然收尾',
          styleContext, plotSummary, prevExcerpt, '',
          canonFactsContext, personalityContext,
          plan.plot_beats, plan.emotional_arc, planAny.cool_moment,
          plan.forbidden, plan.scene_count, plan.max_info_reveal, plan.emotion_cap,
          planAny.opening_hook, planAny.closing_hook,
        )},
      ]
      const reply = await window.electronAPI.aiChat(messages, '正文生成')
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
  const planAny = plan || {}
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
            <h1 className="text-lg text-text-main">第 {currentChapter} 章 · {title || '未命名'}</h1>
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
          primaryStyleId={primaryStyleId} auxiliaryStyleIds={auxiliaryStyleIds} disassemblyIds={[]}
          onChange={(refs) => { setPrimaryStyleId(refs.primaryStyleId); setAuxiliaryStyleIds(refs.auxiliaryStyleIds) }}
        />

        {/* 人格库选择器 */}
        {personalityProjects.length > 0 && (
          <div className="bg-white rounded-card border border-border overflow-hidden mb-4">
            <div className="px-4 py-2.5 border-b border-border flex items-center gap-2">
              <span>🧠</span>
              <span className="text-sm text-text-secondary">人格库（角色说话方式、意象、怪癖材料池）</span>
            </div>
            <div className="px-4 py-2 space-y-1">
              {personalityProjects.filter(p => {
                const d = p.personality_data as any
                return !!(d?.emotion || d?.imagery || d?.dialogue || d?.private_imagery || d?.emotional_quirks)
              }).map(p => {
                const isPrimary = primaryPersonalityId === p.id
                return (
                  <div key={p.id} className="flex items-center gap-1.5 text-sm py-0.5">
                    <input type="checkbox" checked={isPrimary}
                      onChange={() => {
                        if (!isPrimary) setAuxPersonalityIds(prev => prev.filter(x => x !== p.id))
                        setPrimaryPersonalityId(isPrimary ? null : p.id)
                      }} className="accent-primary" />
                    <span className="flex-1 text-text-main">{p.name}</span>
                    <input type="checkbox" checked={auxPersonalityIds.includes(p.id)}
                      onChange={() => {
                        if (isPrimary) setPrimaryPersonalityId(null)
                        setAuxPersonalityIds(prev => prev.includes(p.id) ? prev.filter(x => x !== p.id) : [...prev, p.id])
                      }} className="accent-primary ml-2" />
                    <span className="text-text-placeholder">辅</span>
                  </div>
                )
              })}
              <p className="text-xs text-text-placeholder mt-1">☑ 主人格（单选）· ☑ 辅人格（多选）——AI将从中取角色说话方式和意象</p>
            </div>
          </div>
        )}

        {/* 去AI味面板 */}
        {content && <DeslopPanel content={content} onApply={(newContent) => { setContent(newContent); handleManualSave() }}
          styleContext={buildStyleContext()}
          personalityContext={buildPersonalityContext()}
          forbiddenContext={(chapterPlans.find(p => p.chapter_number === currentChapter)?.forbidden || []).join('；')}
          projectId={Number(id)}
          chapterNum={currentChapter}
        />}

        {plan && (
          <div className="bg-primary-light/30 rounded-card border border-primary/10 p-3 mb-3">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
              <span><span className="text-text-placeholder">功能：</span>{planAny.function || planAny.function_tag || '推进主线'}</span>
              {(planAny.emotional_goal || planAny.emotional_arc) && <span><span className="text-text-placeholder">情绪：</span>{planAny.emotional_goal || planAny.emotional_arc}</span>}
              <span><span className="text-text-placeholder">概要：</span>{plan.summary}</span>
              <span><span className="text-text-placeholder">人物：</span>{(plan.characters || []).join('、')}</span>
              <span><span className="text-text-placeholder">字数：</span>{plan.estimated_words}字</span>
              {plan.scene_count && <span><span className="text-text-placeholder">场景：</span>{plan.scene_count}个</span>}
              {plan.forbidden && plan.forbidden.length > 0 && (
                <span><span className="text-text-placeholder">⛔ 禁区：</span>{plan.forbidden.slice(0, 3).join('；')}</span>
              )}
            </div>
            {plan.plot_beats && plan.plot_beats.length > 0 && (
              <details className="mt-2">
                <summary className="text-xs text-text-secondary cursor-pointer">情节点序列（{plan.plot_beats.length}条）</summary>
                <ol className="text-xs text-text-secondary mt-1 pl-4 list-decimal">
                  {plan.plot_beats.map((b: string, i: number) => (
                    <li key={i} className="leading-relaxed">{b}</li>
                  ))}
                </ol>
              </details>
            )}
          </div>
        )}

        {generating ? (
          <div className="bg-white rounded-card border border-border p-16 text-center">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-base text-text-main">AI 正在撰写第 {currentChapter} 章...</p>
            <p className="text-xs text-text-secondary mt-1">约需 40-80 秒</p>
          </div>
        ) : !content ? (
          <div className="bg-white rounded-card border border-border p-16 text-center">
            <span className="text-5xl mb-4 block">✍️</span>
            <h2 className="text-lg text-text-main mb-2">第 {currentChapter} 章</h2>
            <p className="text-base text-text-secondary mb-6">{plan ? '点击按钮，AI 将根据细纲和参考内容生成本章' : '请先生成细纲'}</p>
            {plan && <button onClick={handleGenerate} className="px-6 py-3 bg-primary text-white rounded-btn text-base hover:bg-primary-hover">🤖 生成本章</button>}
          </div>
        ) : (
          <textarea value={content} onChange={(e) => setContent(e.target.value)}
            className="w-full min-h-[500px] px-5 py-4 border border-border-input rounded-card text-base focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 resize-y leading-relaxed bg-white" />
        )}
      </div>
    </div>
  )
}
