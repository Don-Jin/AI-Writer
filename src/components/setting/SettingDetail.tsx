import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { showToast } from '../common/Toast'
import { useSettingStore } from '../../store/settingStore'
import { SETTING_EXTRACTION_SYSTEM, SETTING_EXTRACTION_USER } from '../../services/settingExtractor'

export default function SettingDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { libraries, load, updateData } = useSettingStore()
  const [running, setRunning] = useState(false)
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const cancelledRef = useRef(false)

  const proj = libraries.find(l => l.id === Number(id))
  const data = proj?.setting_data || { characters: [], worlds: [], rules: [], relationships: [] }

  useEffect(() => { load() }, [])

  useEffect(() => { return () => { if (running) { cancelledRef.current = true; window.electronAPI?.cancelAi() } } }, [running])

  const handleExtract = async () => {
    if (!proj || !proj.source_text) { showToast('error', '暂无源文本'); return }
    setRunning(true)
    cancelledRef.current = false
    try {
      const reply = await window.electronAPI!.aiChat([
        { role: 'system', content: SETTING_EXTRACTION_SYSTEM },
        { role: 'user', content: SETTING_EXTRACTION_USER(proj.source_text) },
      ], '设定提取')
      if (cancelledRef.current) return
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', 'AI返回格式异常，请重试'); return }
      const parsed = JSON.parse(jm[0])
      await updateData(Number(id), {
        characters: parsed.characters || [],
        worlds: parsed.worlds || [],
        rules: parsed.rules || [],
        relationships: parsed.relationships || [],
      })
      showToast('success', `提取完成：${parsed.characters?.length || 0}个角色，${parsed.worlds?.length || 0}个世界观`)
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消提取')
      else showToast('error', '提取失败：' + (e.message || '未知'))
    } finally { setRunning(false) }
  }

  const handleCancel = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
  }

  const startEdit = (path: string, value: string) => {
    setEditField(path)
    setEditValue(value)
  }

  const saveEdit = () => {
    if (!editField || !proj) return
    const newData = JSON.parse(JSON.stringify(data))
    const keys = editField.split('.')
    let obj = newData
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
    obj[keys[keys.length - 1]] = editValue
    updateData(Number(id), newData)
    setEditField(null)
  }

  const deleteItem = (category: string, index: number) => {
    if (!proj) return
    const newData = JSON.parse(JSON.stringify(data))
    newData[category].splice(index, 1)
    updateData(Number(id), newData)
  }

  if (!proj) {
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div>
      {/* 头部 */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/setting-lib')}
          className="text-text-secondary hover:text-text-main transition-colors">← 返回</button>
        <h1 className="text-page-title text-text-main">{proj.name}</h1>
        <div className="flex-1" />
        {!running ? (
          <button onClick={handleExtract}
            className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover"
          >{data.characters.length > 0 ? '🔄 重新提取' : '🤖 开始提取'}</button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">⏳ AI分析中...</span>
            <button onClick={handleCancel}
              className="px-3 py-1.5 text-sm border border-danger text-danger rounded-btn hover:bg-danger/10">⏹ 取消</button>
          </div>
        )}
      </div>

      {data.characters.length === 0 && data.worlds.length === 0 ? (
        <div className="flex flex-col items-center py-24 text-text-secondary">
          <span className="text-5xl mb-4">📋</span>
          <p className="text-body mb-2">尚未提取设定</p>
          <p className="text-caption">点击「开始提取」，AI 将分析源文本提取角色/世界观/规则/关系</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* 角色 */}
          {data.characters.length > 0 && (
            <Section title="👤 角色" count={data.characters.length}>
              {data.characters.map((ch, i) => (
                <Card key={i}
                  fields={[
                    { label: '姓名', value: ch.name, path: `characters.${i}.name` },
                    { label: '身份', value: ch.info, path: `characters.${i}.info` },
                    { label: '能力', value: ch.abilities, path: `characters.${i}.abilities` },
                    { label: '定位', value: ch.role, path: `characters.${i}.role` },
                  ]}
                  editField={editField} editValue={editValue}
                  onEdit={startEdit} onSave={saveEdit}
                  onChange={setEditValue} onDelete={() => deleteItem('characters', i)}
                />
              ))}
            </Section>
          )}

          {/* 世界观 */}
          {data.worlds.length > 0 && (
            <Section title="🌍 世界观" count={data.worlds.length}>
              {data.worlds.map((w, i) => (
                <Card key={i}
                  fields={[
                    { label: '名称', value: w.name, path: `worlds.${i}.name` },
                    { label: '描述', value: w.description, path: `worlds.${i}.description` },
                    { label: '类别', value: w.category, path: `worlds.${i}.category` },
                  ]}
                  editField={editField} editValue={editValue}
                  onEdit={startEdit} onSave={saveEdit}
                  onChange={setEditValue} onDelete={() => deleteItem('worlds', i)}
                />
              ))}
            </Section>
          )}

          {/* 规则 */}
          {data.rules.length > 0 && (
            <Section title="📏 规则" count={data.rules.length}>
              {data.rules.map((r, i) => (
                <Card key={i}
                  fields={[
                    { label: '名称', value: r.name, path: `rules.${i}.name` },
                    { label: '描述', value: r.description, path: `rules.${i}.description` },
                  ]}
                  editField={editField} editValue={editValue}
                  onEdit={startEdit} onSave={saveEdit}
                  onChange={setEditValue} onDelete={() => deleteItem('rules', i)}
                />
              ))}
            </Section>
          )}

          {/* 关系 */}
          {data.relationships.length > 0 && (
            <Section title="🔗 关系" count={data.relationships.length}>
              {data.relationships.map((r, i) => (
                <Card key={i}
                  fields={[
                    { label: '角色A', value: r.char_a, path: `relationships.${i}.char_a` },
                    { label: '角色B', value: r.char_b, path: `relationships.${i}.char_b` },
                    { label: '关系', value: r.relation, path: `relationships.${i}.relation` },
                    { label: '描述', value: r.description, path: `relationships.${i}.description` },
                  ]}
                  editField={editField} editValue={editValue}
                  onEdit={startEdit} onSave={saveEdit}
                  onChange={setEditValue} onDelete={() => deleteItem('relationships', i)}
                />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-section-title text-text-main mb-3">{title} <span className="text-text-placeholder text-sm">({count})</span></h2>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2">{children}</div>
    </div>
  )
}

function Card({ fields, editField, editValue, onEdit, onSave, onChange, onDelete }: {
  fields: { label: string; value: string; path: string }[]
  editField: string | null; editValue: string
  onEdit: (path: string, value: string) => void
  onSave: () => void; onChange: (v: string) => void; onDelete: () => void
}) {
  return (
    <div className="bg-white rounded-card border border-border p-3 hover:border-primary/20 transition-colors group">
      {fields.map(f => (
        <div key={f.path} className="flex items-start gap-2 text-sm mb-1">
          <span className="text-text-placeholder shrink-0 w-10">{f.label}：</span>
          {editField === f.path ? (
            <div className="flex-1 flex gap-1">
              <input value={editValue} onChange={e => onChange(e.target.value)}
                className="flex-1 text-sm border-b border-primary px-1 py-0.5 focus:outline-none" autoFocus />
              <button onClick={onSave} className="text-xs text-primary">保存</button>
            </div>
          ) : (
            <span className="text-text-main cursor-pointer hover:text-primary flex-1"
              onClick={() => onEdit(f.path, f.value)}>{f.value || '—'}</span>
          )}
        </div>
      ))}
      <button onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-xs text-text-placeholder hover:text-danger transition-all mt-1">🗑 删除</button>
    </div>
  )
}
