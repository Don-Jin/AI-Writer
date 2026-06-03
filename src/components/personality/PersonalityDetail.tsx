import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import { usePersonalityStore } from '../../store/personalityStore'
import { PERSONALITY_EXTRACTION_SYSTEM, PERSONALITY_EXTRACTION_USER, sampleText } from '../../services/personalityExtractor'

interface FieldProps {
  label: string
  path: (keyof any)[]
  profile: any
  onSave: (path: string[], value: string) => void
}

function Field({ label, path, profile, onSave }: FieldProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  // Resolve value from nested path
  let current = profile
  for (const key of path) {
    current = current?.[key]
  }
  const displayValue = (current as string) || ''

  const startEdit = () => { setValue(displayValue); setEditing(true) }
  const saveEdit = () => { onSave(path as string[], value); setEditing(false) }

  return (
    <div className="flex items-start gap-2 text-sm mb-1">
      <span className="text-text-placeholder shrink-0 w-20">{label}：</span>
      {editing ? (
        <div className="flex-1 flex gap-1">
          <textarea value={value} onChange={e => setValue(e.target.value)}
            rows={3}
            className="flex-1 text-sm border border-primary rounded px-2 py-1 focus:outline-none resize-y" autoFocus />
          <button onClick={saveEdit} className="text-xs text-primary shrink-0">保存</button>
          <button onClick={() => setEditing(false)} className="text-xs text-text-placeholder shrink-0">取消</button>
        </div>
      ) : (
        <span
          className="text-text-main cursor-pointer hover:text-primary flex-1 whitespace-pre-wrap"
          onClick={startEdit}
        >
          {displayValue || '（点击编辑）'}
        </span>
      )}
    </div>
  )
}

export default function PersonalityDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<any>(null)
  const [profile, setProfile] = useState<any>({})
  const [running, setRunning] = useState(false)
  const cancelledRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [viewTab] = useState<'humantouch'>('humantouch')

  useEffect(() => {
    return () => {
      if (running) {
        cancelledRef.current = true
        window.electronAPI?.cancelAi()
      }
    }
  })

  useEffect(() => {
    (async () => {
      try {
        if (!window.electronAPI) { setLoaded(true); return }
        const proj = await window.electronAPI.db.get(
          'SELECT * FROM personality_projects WHERE id = ?', [Number(id)]
        )
        if (proj) {
          setProject(proj)
          const data = typeof proj.personality_data === 'string'
            ? JSON.parse(proj.personality_data || '{}')
            : (proj.personality_data || {})
          setProfile({
            private_imagery: data.private_imagery || '',
            emotional_quirks: data.emotional_quirks || '',
            rhythm_fingerprint: data.rhythm_fingerprint || '',
            nonsense_style: data.nonsense_style || '',
            private_rhetoric: data.private_rhetoric || '',
            raw_analysis: data.raw_analysis || '',
          })
        }
      } catch (e: any) { setError(e.message || String(e)) }
      setLoaded(true)
    })()
  }, [id])

  const saveField = async (path: string[], value: string) => {
    if (!project || !window.electronAPI) return
    const newProfile = JSON.parse(JSON.stringify(profile))
    let obj = newProfile
    for (let i = 0; i < path.length - 1; i++) obj = obj[path[i]]
    obj[path[path.length - 1]] = value
    setProfile(newProfile)

    await window.electronAPI.db.run(
      'UPDATE personality_projects SET personality_data = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
      [JSON.stringify(newProfile), project.id]
    )
    showToast('success', '已保存')
  }

  const handleExtract = async () => {
    if (!project || !window.electronAPI) return
    const sourceText = project.source_text || ''
    if (!sourceText.trim()) { showToast('error', '源文本为空，请先导入访谈文本'); return }

    setRunning(true)
    cancelledRef.current = false
    try {
      const sampled = sampleText(sourceText)
      showToast('info', `全文 ${sourceText.length.toLocaleString()} 字 → 采样 ${sampled.length.toLocaleString()} 字 → AI 分析中...`)

      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: PERSONALITY_EXTRACTION_SYSTEM },
        { role: 'user', content: PERSONALITY_EXTRACTION_USER(sampled) },
      ], '人格提取')

      if (cancelledRef.current) return

      // Parse JSON
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', 'AI 返回格式异常，请重试'); return }

      let parsed: any
      try { parsed = JSON.parse(jm[0]) } catch {
        try { parsed = JSON.parse(jm[0].replace(/,\s*}/g, '}').replace(/[\x00-\x1f]/g, ' ')) } catch { showToast('error', 'JSON 解析失败'); return }
      }
      if (!parsed) { showToast('error', 'AI 返回格式异常'); return }

      const newProfile = {
        private_imagery: parsed.private_imagery || '',
        emotional_quirks: parsed.emotional_quirks || '',
        rhythm_fingerprint: parsed.rhythm_fingerprint || '',
        nonsense_style: parsed.nonsense_style || '',
        private_rhetoric: parsed.private_rhetoric || '',
        raw_analysis: parsed.raw_analysis || '',
      }
      setProfile(newProfile)

      await window.electronAPI.db.run(
        'UPDATE personality_projects SET personality_data = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
        [JSON.stringify(newProfile), project.id]
      )
      showToast('success', '人格提取完成！')
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消提取')
      else showToast('error', '提取失败：' + (e.message || '未知'))
    } finally {
      setRunning(false)
    }
  }

  if (!loaded) return <div className="flex justify-center py-24 text-text-secondary">加载中...</div>
  if (error) return <div className="flex justify-center py-24 text-text-secondary">错误：{error}</div>
  if (!project) return <div className="flex justify-center py-24 text-text-secondary">项目不存在或已被删除 (id={id})</div>

  const hasData = !!(profile.private_imagery || profile.emotional_quirks || profile.rhythm_fingerprint)

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate('/personality')} className="px-3 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary hover:text-text-main mb-4 inline-flex items-center gap-1">← 返回人格库</button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-page-title text-text-main">{project.name}</h1>
          <p className="text-caption text-text-secondary mt-1">
            源文本 {(project.source_text || '').length.toLocaleString()} 字
          </p>
        </div>
      </div>

      {/* 提取按钮（仅当有源文本时显示） */}
      {project.source_text ? (
        <div className="mb-6">
          {running ? (
            <div className="flex items-center gap-3 px-4 py-3 bg-primary-light/10 border border-primary/30 rounded-card">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <div>
                <p className="text-sm font-medium text-primary">AI 正在分析...</p>
                <p className="text-xs text-text-secondary mt-0.5">正在从访谈/随笔中提取写作人格</p>
              </div>
              <button onClick={() => { cancelledRef.current = true; window.electronAPI?.cancelAi() }}
                className="ml-auto px-3 py-1.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">
                ⏹ 取消
              </button>
            </div>
          ) : (
            <button onClick={handleExtract}
              className="w-full px-4 py-3 text-sm bg-primary text-white rounded-card hover:bg-primary-hover transition-colors">
              {hasData ? '🔄 重新提取' : '🤖 开始提取（一键完成人格分析）'}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-text-placeholder mb-6 text-center">手动模式 — 直接在下方填写各维度</p>
      )}

      <div className="space-y-4">
        <div className="bg-white rounded-card border border-border p-4">
          <h3 className="text-sm font-medium text-text-main mb-3">私人意象</h3>
          <Field label="私人意象" path={['private_imagery']} profile={profile} onSave={saveField} />
        </div>
        <div className="bg-white rounded-card border border-border p-4">
          <h3 className="text-sm font-medium text-text-main mb-3">情绪怪癖</h3>
          <Field label="情绪怪癖" path={['emotional_quirks']} profile={profile} onSave={saveField} />
        </div>
        <div className="bg-white rounded-card border border-border p-4">
          <h3 className="text-sm font-medium text-text-main mb-3">节奏指纹</h3>
          <Field label="节奏指纹" path={['rhythm_fingerprint']} profile={profile} onSave={saveField} />
        </div>
        <div className="bg-white rounded-card border border-border p-4">
          <h3 className="text-sm font-medium text-text-main mb-3">废话风格</h3>
          <Field label="废话风格" path={['nonsense_style']} profile={profile} onSave={saveField} />
        </div>
        <div className="bg-white rounded-card border border-border p-4">
          <h3 className="text-sm font-medium text-text-main mb-3">私人修辞</h3>
          <Field label="私人修辞" path={['private_rhetoric']} profile={profile} onSave={saveField} />
        </div>
        {profile.raw_analysis && (
          <div className="bg-white rounded-card border border-border p-4">
            <h3 className="text-sm font-medium text-text-main mb-3">综合分析</h3>
            <Field label="综合分析" path={['raw_analysis']} profile={profile} onSave={saveField} />
          </div>
        )}
      </div>
    </div>
  )
}
