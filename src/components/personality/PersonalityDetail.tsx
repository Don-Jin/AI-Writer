import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import { PERSONALITY_EXTRACTION_SYSTEM, PERSONALITY_EXTRACTION_USER, sampleText } from '../../services/personalityExtractor'

export default function PersonalityDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [project, setProject] = useState<any>(null)
  const [profile, setProfile] = useState<any>({})
  const [running, setRunning] = useState(false)
  const cancelledRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

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
          setProfile(data)
        }
      } catch (e: any) { setError(e.message || String(e)) }
      setLoaded(true)
    })()
  }, [id])

  const saveRaw = async (newData: any) => {
    if (!project || !window.electronAPI) return
    setProfile(newData)
    await window.electronAPI.db.run(
      'UPDATE personality_projects SET personality_data = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
      [JSON.stringify(newData), project.id]
    )
    showToast('success', '已保存')
  }

  const updateField = async (path: string[], value: string) => {
    const newProfile = JSON.parse(JSON.stringify(profile))
    let obj = newProfile
    for (let i = 0; i < path.length - 1; i++) {
      if (!obj[path[i]] || typeof obj[path[i]] !== 'object') obj[path[i]] = {}
      obj = obj[path[i]]
    }
    obj[path[path.length - 1]] = value
    await saveRaw(newProfile)
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

      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', 'AI 返回格式异常，请重试'); return }

      let parsed: any
      try { parsed = JSON.parse(jm[0]) } catch {
        try { parsed = JSON.parse(jm[0].replace(/,\s*}/g, '}').replace(/[\x00-\x1f]/g, ' ')) } catch { showToast('error', 'JSON 解析失败'); return }
      }
      if (!parsed) { showToast('error', 'AI 返回格式异常'); return }

      await saveRaw(parsed)
      showToast('success', '5核行为替换图谱提取完成！')
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

  const isV2 = !!(profile.emotion || profile.imagery || profile.dialogue)
  const isV1 = !!(profile.private_imagery || profile.emotional_quirks || profile.dialogue_fingerprint)
  const hasData = (() => {
    if (isV2) {
      // V2有数据：至少一个替换器有实际的 author_uses
      const checkReplacer = (obj: any) => obj && Object.values(obj).some((d: any) => d?.author_uses?.length > 0)
      return checkReplacer(profile.emotion) || checkReplacer(profile.imagery) || checkReplacer(profile.dialogue) || checkReplacer(profile.rhythm) || checkReplacer(profile.observation)
    }
    return isV1
  })()

  const V2_SECTIONS: { title: string; key: string; subLabels: Record<string, string> }[] = [
    { title: '情绪替换器', key: 'emotion', subLabels: { anger: '愤怒', sadness: '悲伤', fear: '恐惧', joy: '喜悦' } },
    { title: '意象替换器', key: 'imagery', subLabels: { mystery: '未知/神秘', memory: '时间/记忆', danger: '危险/威胁' } },
    { title: '对话替换器', key: 'dialogue', subLabels: { revelation: '重要信息', conflict: '冲突/对峙', casual: '日常对话' } },
    { title: '节奏替换器', key: 'rhythm', subLabels: { accelerate: '加速', decelerate: '减速', silence: '沉默/空档' } },
    { title: '观察替换器', key: 'observation', subLabels: { notice_environment: '角色观察环境', emotion_through_object: '物件承载情绪' } },
  ]

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate('/personality')} className="px-3 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary hover:text-text-main mb-4 inline-flex items-center gap-1">← 返回人格库</button>

      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h1 className="text-xl">{project.name}</h1>
          {isV2 && <span className="px-1.5 py-0.5 text-xxs bg-success/10 text-success rounded">V2·行为替换图谱</span>}
          {isV1 && !isV2 && <span className="px-1.5 py-0.5 text-xxs bg-primary/10 text-primary rounded">V1·9维分析</span>}
        </div>
        <span className="text-xs text-text-placeholder">源文本 {(project.source_text || '').length.toLocaleString()} 字</span>
      </div>

      {/* 提取按钮 */}
      <div className="mb-6">
        {running ? (
          <div className="flex items-center gap-3 px-4 py-3 bg-primary-light/10 border border-primary/30 rounded-card">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <div>
              <p className="text-sm font-medium text-primary">AI 正在分析...</p>
              <p className="text-xs text-text-secondary mt-0.5">正在提取5核行为替换图谱</p>
            </div>
            <button onClick={() => { cancelledRef.current = true; window.electronAPI?.cancelAi() }}
              className="ml-auto px-3 py-1.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">
              ⏹ 取消
            </button>
          </div>
        ) : (
          <button onClick={handleExtract}
            className="w-full px-4 py-3 text-sm bg-primary text-white rounded-card hover:bg-primary-hover transition-colors">
            {hasData ? '🔄 重新提取（V2·5核行为替换图谱）' : '🤖 开始提取（V2·5核行为替换图谱）'}
          </button>
        )}
      </div>

      {/* ===== V2 替换图谱 ===== */}
      {isV2 && (
        <div className="space-y-4">
          {/* 全局模式 */}
          {profile.style_profile?.global_pattern && (
            <div className="bg-primary-light/10 border border-primary/20 rounded-card p-4">
              <h3 className="text-sm font-medium text-primary mb-1">全局行为模式</h3>
              <FieldDisplay value={profile.style_profile.global_pattern} path={['style_profile', 'global_pattern']} onSave={updateField} />
            </div>
          )}

          {/* 5核替换器 */}
          {V2_SECTIONS.map(section => {
            const obj = profile[section.key]
            if (!obj) return null
            const entries = Object.entries(obj).filter(([, dim]: any) => dim?.author_uses?.length > 0)
            if (!entries.length) return null

            return (
              <div key={section.key} className="bg-white rounded-card border border-border p-4">
                <h3 className="text-sm font-medium text-text-main mb-3">{section.title}</h3>
                {entries.map(([key, dim]: any) => (
                  <div key={key} className="mb-3 last:mb-0">
                    <h4 className="text-xs font-medium text-text-secondary mb-1.5">
                      {section.subLabels[key] || key}
                    </h4>
                    {dim.ai_defaults?.length > 0 && (
                      <div className="mb-1">
                        <span className="text-xs text-danger">❌ AI默认：</span>
                        <FieldDisplay
                          value={dim.ai_defaults.join('、')}
                          path={[section.key, key, 'ai_defaults']}
                          onSave={updateField}
                          arrayMode
                        />
                      </div>
                    )}
                    {dim.author_uses?.length > 0 && (
                      <div className="mb-1">
                        <span className="text-xs text-success">✅ 作者替代：</span>
                        <FieldDisplay
                          value={dim.author_uses.join('、')}
                          path={[section.key, key, 'author_uses']}
                          onSave={updateField}
                          arrayMode
                        />
                      </div>
                    )}
                    {dim.principle && (
                      <div>
                        <span className="text-xs text-text-placeholder">📏 规则：</span>
                        <FieldDisplay value={dim.principle} path={[section.key, key, 'principle']} onSave={updateField} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          })}

          {profile.raw_analysis && (
            <div className="bg-white rounded-card border border-border p-4">
              <h3 className="text-sm font-medium text-text-main mb-3">综合摘要</h3>
              <FieldDisplay value={profile.raw_analysis} path={['raw_analysis']} onSave={updateField} />
            </div>
          )}
        </div>
      )}

      {/* ===== V1 回退 ===== */}
      {!isV2 && (
        <div className="space-y-4">
          {[
            ['私人意象', 'private_imagery'],
            ['情绪怪癖', 'emotional_quirks'],
            ['节奏指纹', 'rhythm_fingerprint'],
            ['废话风格', 'nonsense_style'],
            ['私人修辞', 'private_rhetoric'],
            ['对话指纹', 'dialogue_fingerprint'],
            ['风景指纹', 'scenery_fingerprint'],
            ['叙事距离', 'narrative_distance'],
            ['信息释放', 'info_release'],
          ].map(([label, key]) => (
            <div key={key} className="bg-white rounded-card border border-border p-4">
              <h3 className="text-sm font-medium text-text-main mb-3">{label}</h3>
              <FieldDisplay value={profile[key] || ''} path={[key]} onSave={updateField} />
            </div>
          ))}
          {profile.raw_analysis && (
            <div className="bg-white rounded-card border border-border p-4">
              <h3 className="text-sm font-medium text-text-main mb-3">综合分析</h3>
              <FieldDisplay value={profile.raw_analysis} path={['raw_analysis']} onSave={updateField} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ========== 可编辑字段 ==========

function FieldDisplay({ value, path, onSave, arrayMode }: {
  value: string; path: string[]; onSave: (path: string[], value: string) => void; arrayMode?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')

  const startEdit = () => { setVal(value); setEditing(true) }
  const saveEdit = () => { onSave(path, val); setEditing(false) }

  return editing ? (
    <div className="flex-1 flex gap-1 mt-0.5">
      <textarea value={val} onChange={e => setVal(e.target.value)}
        rows={2}
        className="flex-1 text-xs border border-primary rounded px-2 py-1 focus:outline-none resize-y" autoFocus />
      <button onClick={saveEdit} className="text-xs text-primary shrink-0 px-1">保存</button>
      <button onClick={() => setEditing(false)} className="text-xs text-text-placeholder shrink-0 px-1">取消</button>
    </div>
  ) : (
    <span
      className="text-sm text-text-main cursor-pointer hover:text-primary whitespace-pre-wrap inline-block"
      onClick={startEdit}
      title="点击编辑"
    >
      {value || <span className="text-text-placeholder">点击添加...</span>}
    </span>
  )
}
