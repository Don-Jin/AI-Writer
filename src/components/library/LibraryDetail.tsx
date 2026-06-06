import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLibraryStore } from '../../store/libraryStore'
import { showToast } from '../common/Toast'
import { STYLE_EXTRACTION_SYSTEM, STYLE_EXTRACTION_USER } from '../../services/extractor'
import type { StyleLibrary } from '../../types'

export default function LibraryDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { libraries, loaded, load } = useLibraryStore()
  const [library, setLibrary] = useState<StyleLibrary | null>(null)
  const [reextracting, setReextracting] = useState(false)
  const reextractCancelled = useRef(false)

  useEffect(() => {
    return () => {
      if (reextracting) {
        reextractCancelled.current = true
        window.electronAPI?.cancelAi()
      }
    }
  })

  useEffect(() => { if (!loaded) load() }, [])
  useEffect(() => {
    const found = libraries.find((l) => l.id === Number(id))
    setLibrary(found || null)
  }, [libraries, id])

  const updateField = async (path: string[], value: string) => {
    if (!library) return showToast('error', '数据未加载')
    if (!window.electronAPI) return showToast('error', '请在应用中操作')
    try {
      const currentProfile = typeof library.style_profile === 'string'
        ? JSON.parse(library.style_profile) : (library.style_profile || {})
      const newProfile = JSON.parse(JSON.stringify(currentProfile))
      let obj: any = newProfile
      for (let i = 0; i < path.length - 1; i++) {
        if (!obj[path[i]] || typeof obj[path[i]] !== 'object') obj[path[i]] = {}
        obj = obj[path[i]]
      }
      obj[path[path.length - 1]] = value
      const jsonStr = JSON.stringify(newProfile)
      await window.electronAPI.db.run('UPDATE style_libraries SET style_profile=? WHERE id=?', [jsonStr, library.id])
      setLibrary({ ...library, style_profile: newProfile })
      showToast('success', '已保存')
    } catch (e: any) {
      showToast('error', '保存失败：' + (e.message || '未知'))
    }
  }

  const handleReextract = async () => {
    if (!window.electronAPI || !library) return
    setReextracting(true)
    try {
      const file = await window.electronAPI.openFile({ filters: [{ name: '文档', extensions: ['txt', 'docx', 'pdf'] }] })
      if (!file) { setReextracting(false); return }
      const text = await window.electronAPI.parseFile(file.filePath)
      if (!text || text.length < 500) { showToast('error', '文件内容不足500字'); setReextracting(false); return }
      const reply = await window.electronAPI.aiChat([
        { role: 'system', content: STYLE_EXTRACTION_SYSTEM },
        { role: 'user', content: STYLE_EXTRACTION_USER(text) },
      ], '重新提取风格')
      const jm = reply.match(/```json\s*([\s\S]*?)\s*```/) || reply.match(/\{[\s\S]*\}/)
      const profile = jm ? JSON.parse(jm[1] || jm[0]) : { raw_analysis: reply }
      const jsonStr = JSON.stringify(profile)
      await window.electronAPI.db.run('UPDATE style_libraries SET style_profile=? WHERE id=?', [jsonStr, library.id])
      setLibrary({ ...library, style_profile: profile })
      showToast('success', '风格已重新提取')
    } catch (e: any) {
      if (reextractCancelled.current) showToast('info', '已取消提取')
      else showToast('error', '重新提取失败：' + (e.message || '未知'))
    }
    finally { setReextracting(false) }
  }

  if (!library) {
    return <div className="flex flex-col items-center justify-center py-24 text-text-secondary"><p className="text-base">加载中...</p></div>
  }

  // 防御性解析
  let p: any = {}
  try {
    const raw = (library as any).style_profile
    if (typeof raw === 'string') {
      p = JSON.parse(raw)
    } else if (raw && typeof raw === 'object') {
      p = raw
    }
    if (!p || typeof p !== 'object') p = {}
  } catch (e: any) {
    console.error('LibraryDetail: failed to parse style_profile:', e.message)
    p = {}
  }

  const isV4 = !!(p.replacements)
  const isV3 = !!(p.narrative)
  const isV1 = !!(p.writing_style)

  // V4 22类标签分组
  const V4_GROUPS: { label: string; keys: string[] }[] = [
    { label: '心理·表情·动作·对话', keys: ['心理', '表情', '动作', '对话'] },
    { label: '句式·副词·比喻·成语', keys: ['句式', '副词', '比喻', '成语'] },
    { label: '过渡·总结·结尾·收束', keys: ['过渡', '总结', '结尾', '收束'] },
    { label: '评判·煽情·描写·泛化', keys: ['评判', '煽情', '描写', '泛化'] },
    { label: '解释·逃避·猜测·连接词', keys: ['解释', '逃避', '猜测', '连接词'] },
    { label: '预告·句子·心理遗留', keys: ['预告', '句子', '心理遗留'] },
  ]

  return (
    <div className="max-w-3xl mx-auto">
      <button onClick={() => navigate('/library')} className="px-3 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary hover:text-text-main mb-4 inline-flex items-center gap-1">← 返回风格库</button>

      <div className="bg-white rounded-card border border-border p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-xl">{library.name}</h1>
            {isV4 && <span className="px-1.5 py-0.5 text-xxs bg-success/10 text-success rounded">V4·替换指南</span>}
            {isV3 && !isV4 && <span className="px-1.5 py-0.5 text-xxs bg-primary/10 text-primary rounded">V3·约束规则</span>}
            {isV1 && !isV3 && !isV4 && <span className="px-1.5 py-0.5 text-xxs bg-gray-100 text-text-placeholder rounded">V1·旧格式</span>}
          </div>
          {reextracting ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-warning flex items-center gap-1"><div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> 提取中...</span>
              <button onClick={() => { reextractCancelled.current = true; window.electronAPI?.cancelAi() }} className="px-2 py-1 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消</button>
            </div>
          ) : (
            <button onClick={handleReextract} className="px-3 py-1.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light/20">
              🔄 重新提取（V4·22类替换指南）
            </button>
          )}
        </div>
        <p className="text-xs text-text-placeholder mb-4">💡 点击任意字段直接编辑，失焦自动保存</p>

        {/* ===== V4 替换指南格式 ===== */}
        {isV4 && (
          <>
            {/* 概况 */}
            {p.style_profile && (
              <Section title="风格概况">
                <StyleField label="视角" path={['style_profile', 'perspective']} profile={p} onSave={updateField} />
                <StyleField label="句长范围" path={['style_profile', 'sentence_range']} profile={p} onSave={updateField} />
                <StyleField label="段落习惯" path={['style_profile', 'paragraph_habit']} profile={p} onSave={updateField} multiline />
                <StyleField label="词汇层级" path={['style_profile', 'vocab_level']} profile={p} onSave={updateField} multiline />
                <StyleField label="情绪基调" path={['style_profile', 'emotion_tone']} profile={p} onSave={updateField} />
              </Section>
            )}

            {/* 22类替换指南 — 按分组展示 */}
            {V4_GROUPS.map(group => {
              const hasContent = group.keys.some(k => p.replacements[k])
              if (!hasContent) return null
              return (
                <Section key={group.label} title={group.label}>
                  {group.keys.map(k => {
                    const dim = p.replacements[k]
                    if (!dim) return null
                    return (
                      <div key={k} className="mb-4 last:mb-0">
                        <h4 className="text-sm font-medium text-text-main mb-2">{k}</h4>
                        {/* rule */}
                        {dim.rule && (
                          <StyleField label="替换规则" path={['replacements', k, 'rule']} profile={p} onSave={updateField} multiline />
                        )}
                        {/* ai_uses */}
                        {dim.ai_uses?.length > 0 && (
                          <div className="mb-2">
                            <span className="text-xs text-danger">❌ AI会用：</span>
                            <StyleField label="" path={['replacements', k, 'ai_uses']} profile={p} onSave={updateField} multiline />
                          </div>
                        )}
                        {/* human_uses */}
                        {dim.human_uses?.length > 0 && (
                          <div className="mb-2">
                            <span className="text-xs text-success">✅ 人类写法：</span>
                            <StyleField label="" path={['replacements', k, 'human_uses']} profile={p} onSave={updateField} multiline />
                          </div>
                        )}
                      </div>
                    )
                  })}
                </Section>
              )
            })}
          </>
        )}

        {/* ===== V3 约束规则格式（回退） ===== */}
        {!isV4 && isV3 && <>
          <Section title="叙事视角与距离">
            <StyleField label="视角" path={['narrative', 'perspective']} profile={p} onSave={updateField} />
            <StyleField label="POV规则" path={['narrative', 'pov_rules']} profile={p} onSave={updateField} multiline />
            <StyleField label="叙述者插嘴" path={['narrative', 'narrator_intrusion']} profile={p} onSave={updateField} multiline />
          </Section>
          <Section title="句式与节奏">
            <StyleField label="短句上限(字)" path={['sentence_rhythm', 'short_max']} profile={p} onSave={updateField} />
            <StyleField label="长句下限(字)" path={['sentence_rhythm', 'long_min']} profile={p} onSave={updateField} />
            <StyleField label="破例条件" path={['sentence_rhythm', 'exception']} profile={p} onSave={updateField} multiline />
            <StyleField label="密度" path={['sentence_rhythm', 'density']} profile={p} onSave={updateField} multiline />
          </Section>
          <Section title="语言特点">
            <StyleField label="词汇档位" path={['language', 'vocab_level']} profile={p} onSave={updateField} multiline />
            <StyleField label="叙事vs对话" path={['language', 'dialogue_vs_narrative']} profile={p} onSave={updateField} multiline />
            <StyleField label="禁用词类型" path={['language', 'forbidden_words']} profile={p} onSave={updateField} multiline />
          </Section>
          <Section title="段落配比">
            <StyleField label="按场景类型" path={['paragraph', 'by_scene_type']} profile={p} onSave={updateField} multiline />
            <StyleField label="段落习惯" path={['paragraph', 'habit']} profile={p} onSave={updateField} multiline />
            <StyleField label="禁止模式" path={['paragraph', 'forbidden']} profile={p} onSave={updateField} multiline />
          </Section>
          <Section title="氛围基调">
            <StyleField label="情绪档位" path={['atmosphere', 'emotion_scale']} profile={p} onSave={updateField} multiline />
            <StyleField label="升档触发" path={['atmosphere', 'level_triggers']} profile={p} onSave={updateField} multiline />
            <StyleField label="降档条件" path={['atmosphere', 'must_downgrade']} profile={p} onSave={updateField} multiline />
          </Section>
        </>}

        {/* ===== V1 旧格式（回退） ===== */}
        {!isV4 && !isV3 && <>
          <Section title="写作风格">
            <StyleField label="叙事视角" path={['writing_style', 'narrative_perspective']} profile={p} onSave={updateField} multiline />
            <StyleField label="句式特点" path={['writing_style', 'sentence_characteristics']} profile={p} onSave={updateField} multiline />
            <StyleField label="段落配比" path={['writing_style', 'paragraph_ratio']} profile={p} onSave={updateField} multiline />
          </Section>
          <Section title="语言特点">
            <StyleField label="词汇偏好" path={['language_features', 'vocabulary_preference']} profile={p} onSave={updateField} multiline />
          </Section>
          <Section title="氛围基调">
            <StyleField label="主要氛围" path={['atmosphere', 'primary']} profile={p} onSave={updateField} />
            <StyleField label="情感基调" path={['atmosphere', 'emotional_tone']} profile={p} onSave={updateField} multiline />
          </Section>
        </>}

        <Section title="综合分析">
          <StyleField label="综合分析" path={['raw_analysis']} profile={p} onSave={updateField} multiline />
        </Section>
      </div>
    </div>
  )
}

// ========== 子组件（定义在外部，避免每次渲染重建导致 hooks 错乱） ==========

function StyleField({ label, path, profile, onSave, multiline }: {
  label: string; path: string[]; profile: any; onSave: (path: string[], value: string) => void; multiline?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  const inputRef = useRef<any>(null)

  const resolved = path.reduce((o: any, k) => (o && o[k] != null) ? o[k] : undefined, profile)
  const currentVal: string = resolved === undefined || resolved === null ? ''
    : typeof resolved === 'string' ? resolved
    : JSON.stringify(resolved, null, 2)

  const startEdit = () => { setVal(currentVal); setEditing(true); setTimeout(() => inputRef.current?.focus(), 50) }
  const save = () => { onSave(path, val); setEditing(false) }

  return (
    <div className="mb-2 group">
      <span className="text-xs text-text-placeholder">{label}</span>
      {editing ? (
        <div>
          {multiline ? (
            <textarea ref={inputRef} value={val} onChange={(e: any) => setVal(e.target.value)}
              onBlur={save} onKeyDown={(e: any) => { if (e.key === 'Escape') setEditing(false) }}
              rows={3} className="w-full px-2 py-1 mt-0.5 text-xs border border-primary rounded resize-y focus:outline-none" />
          ) : (
            <input ref={inputRef} value={val} onChange={(e: any) => setVal(e.target.value)}
              onBlur={save} onKeyDown={(e: any) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false) }}
              className="w-full px-2 py-1 mt-0.5 text-xs border border-primary rounded focus:outline-none" />
          )}
        </div>
      ) : (
        <p onClick={startEdit}
          className="text-base text-text-main cursor-pointer hover:bg-bg-secondary rounded px-1 -mx-1 py-0.5 min-h-[1.5rem]"
          title="点击编辑">
          {currentVal || <span className="text-text-placeholder">点击添加...</span>}
        </p>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 pb-5 border-b border-border last:border-b-0 last:mb-0 last:pb-0">
      <h3 className="text-sm font-medium text-text-main mb-3">{title}</h3>
      {children}
    </div>
  )
}
