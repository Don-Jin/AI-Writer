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
  const [showAddForm, setShowAddForm] = useState<string | null>(null)
  const [addForm, setAddForm] = useState<Record<string, string>>({})
  const cancelledRef = useRef(false)
  const runningRef = useRef(false)

  const proj = libraries.find(l => l.id === Number(id))
  const raw = proj?.setting_data || {}
  const data = {
    characters: (raw as any).characters || [],
    worlds: (raw as any).worlds || [],
    rules: (raw as any).rules || [],
    relationships: (raw as any).relationships || [],
  }

  useEffect(() => { load() }, [])
  useEffect(() => { runningRef.current = running }, [running])
  useEffect(() => { return () => { if (runningRef.current) { cancelledRef.current = true; window.electronAPI?.cancelAi() } } }, [])

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

  const startAdd = (category: string) => {
    setShowAddForm(category)
    setAddForm({})
  }

  const handleAdd = (category: string) => {
    if (!proj) return
    const newData = JSON.parse(JSON.stringify(data))
    if (category === 'characters') {
      if (!addForm.name?.trim()) return
      newData.characters.push({ name: addForm.name, info: addForm.info || '', abilities: addForm.abilities || '', role: addForm.role || 'support' })
    } else if (category === 'worlds') {
      if (!addForm.name?.trim()) return
      newData.worlds.push({ name: addForm.name, description: addForm.description || '', category: addForm.category || 'location' })
    } else if (category === 'rules') {
      if (!addForm.name?.trim()) return
      newData.rules.push({ name: addForm.name, description: addForm.description || '' })
    } else if (category === 'relationships') {
      if (!addForm.char_a?.trim() || !addForm.char_b?.trim()) return
      newData.relationships.push({ char_a: addForm.char_a, char_b: addForm.char_b, relation: addForm.relation || '', description: addForm.description || '' })
    }
    updateData(Number(id), newData)
    setShowAddForm(null)
    setAddForm({})
  }

  if (!proj) {
    if (libraries.length > 0) {
      return <div className="flex justify-center py-24 text-text-secondary">项目不存在或已被删除 (id={id})</div>
    }
    return <div className="flex justify-center py-24"><div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/setting-lib')} className="text-text-secondary hover:text-text-main">← 返回</button>
        <h1 className="text-page-title text-text-main">{proj.name}</h1>
        <div className="flex-1" />
        {!running ? (
          <button onClick={handleExtract} className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover">
            {data.characters.length > 0 ? '🔄 重新提取' : '🤖 开始提取'}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-primary">AI分析中...</span>
            <button onClick={handleCancel} className="px-3 py-1.5 text-sm border border-danger text-danger rounded-btn hover:bg-danger/10">取消</button>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <Section title="角色" count={data.characters.length} onAdd={() => startAdd('characters')}>
          {showAddForm === 'characters' && (
            <div className="col-span-full bg-bg-secondary/30 border border-border rounded-card p-3 mb-2 space-y-2">
              <input value={addForm.name || ''} onChange={e => setAddForm(p => ({...p, name: e.target.value}))} placeholder="角色名 *" autoFocus
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <input value={addForm.info || ''} onChange={e => setAddForm(p => ({...p, info: e.target.value}))} placeholder="身份描述"
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <div className="flex gap-2">
                <input value={addForm.abilities || ''} onChange={e => setAddForm(p => ({...p, abilities: e.target.value}))} placeholder="能力/特长"
                  className="flex-1 text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
                <select value={addForm.role || 'support'} onChange={e => setAddForm(p => ({...p, role: e.target.value}))}
                  className="text-sm border border-border-input rounded px-2 py-1">
                  <option value="main">主角</option><option value="support">配角</option><option value="antagonist">反派</option><option value="minor">次要</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleAdd('characters')} className="px-3 py-1 text-xs bg-primary text-white rounded">添加</button>
                <button onClick={() => setShowAddForm(null)} className="px-3 py-1 text-xs border rounded">取消</button>
              </div>
            </div>
          )}
          {data.characters.map((ch, i) => (
            <Card key={i}
              fields={[
                { label: '姓名', value: ch.name, path: `characters.${i}.name` },
                { label: '身份', value: ch.info, path: `characters.${i}.info` },
                { label: '能力', value: ch.abilities, path: `characters.${i}.abilities` },
                { label: '定位', value: ch.role, path: `characters.${i}.role` },
              ]}
              editField={editField} editValue={editValue}
              onEdit={startEdit} onSave={saveEdit} onChange={setEditValue}
              onDelete={() => deleteItem('characters', i)}
            />
          ))}
        </Section>

        <Section title="世界观" count={data.worlds.length} onAdd={() => startAdd('worlds')}>
          {showAddForm === 'worlds' && (
            <div className="col-span-full bg-bg-secondary/30 border border-border rounded-card p-3 mb-2 space-y-2">
              <input value={addForm.name || ''} onChange={e => setAddForm(p => ({...p, name: e.target.value}))} placeholder="名称 *" autoFocus
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <input value={addForm.description || ''} onChange={e => setAddForm(p => ({...p, description: e.target.value}))} placeholder="描述"
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <input value={addForm.category || ''} onChange={e => setAddForm(p => ({...p, category: e.target.value}))} placeholder="类别（location/faction/organization）"
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <div className="flex gap-2">
                <button onClick={() => handleAdd('worlds')} className="px-3 py-1 text-xs bg-primary text-white rounded">添加</button>
                <button onClick={() => setShowAddForm(null)} className="px-3 py-1 text-xs border rounded">取消</button>
              </div>
            </div>
          )}
          {data.worlds.map((w, i) => (
            <Card key={i}
              fields={[
                { label: '名称', value: w.name, path: `worlds.${i}.name` },
                { label: '描述', value: w.description, path: `worlds.${i}.description` },
                { label: '类别', value: w.category, path: `worlds.${i}.category` },
              ]}
              editField={editField} editValue={editValue}
              onEdit={startEdit} onSave={saveEdit} onChange={setEditValue}
              onDelete={() => deleteItem('worlds', i)}
            />
          ))}
        </Section>

        <Section title="规则" count={data.rules.length} onAdd={() => startAdd('rules')}>
          {showAddForm === 'rules' && (
            <div className="col-span-full bg-bg-secondary/30 border border-border rounded-card p-3 mb-2 space-y-2">
              <input value={addForm.name || ''} onChange={e => setAddForm(p => ({...p, name: e.target.value}))} placeholder="规则名 *" autoFocus
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <input value={addForm.description || ''} onChange={e => setAddForm(p => ({...p, description: e.target.value}))} placeholder="规则描述"
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <div className="flex gap-2">
                <button onClick={() => handleAdd('rules')} className="px-3 py-1 text-xs bg-primary text-white rounded">添加</button>
                <button onClick={() => setShowAddForm(null)} className="px-3 py-1 text-xs border rounded">取消</button>
              </div>
            </div>
          )}
          {data.rules.map((r, i) => (
            <Card key={i}
              fields={[
                { label: '名称', value: r.name, path: `rules.${i}.name` },
                { label: '描述', value: r.description, path: `rules.${i}.description` },
              ]}
              editField={editField} editValue={editValue}
              onEdit={startEdit} onSave={saveEdit} onChange={setEditValue}
              onDelete={() => deleteItem('rules', i)}
            />
          ))}
        </Section>

        <Section title="关系" count={data.relationships.length} onAdd={() => startAdd('relationships')}>
          {showAddForm === 'relationships' && (
            <div className="col-span-full bg-bg-secondary/30 border border-border rounded-card p-3 mb-2 space-y-2">
              <div className="flex gap-2">
                <input value={addForm.char_a || ''} onChange={e => setAddForm(p => ({...p, char_a: e.target.value}))} placeholder="角色A *" autoFocus
                  className="flex-1 text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
                <input value={addForm.char_b || ''} onChange={e => setAddForm(p => ({...p, char_b: e.target.value}))} placeholder="角色B *"
                  className="flex-1 text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              </div>
              <input value={addForm.relation || ''} onChange={e => setAddForm(p => ({...p, relation: e.target.value}))} placeholder="关系类型（师徒/敌对/爱慕/同盟）"
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <input value={addForm.description || ''} onChange={e => setAddForm(p => ({...p, description: e.target.value}))} placeholder="关系描述"
                className="w-full text-sm border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
              <div className="flex gap-2">
                <button onClick={() => handleAdd('relationships')} className="px-3 py-1 text-xs bg-primary text-white rounded">添加</button>
                <button onClick={() => setShowAddForm(null)} className="px-3 py-1 text-xs border rounded">取消</button>
              </div>
            </div>
          )}
          {data.relationships.map((r, i) => (
            <Card key={i}
              fields={[
                { label: '角色A', value: r.char_a, path: `relationships.${i}.char_a` },
                { label: '角色B', value: r.char_b, path: `relationships.${i}.char_b` },
                { label: '关系', value: r.relation, path: `relationships.${i}.relation` },
                { label: '描述', value: r.description, path: `relationships.${i}.description` },
              ]}
              editField={editField} editValue={editValue}
              onEdit={startEdit} onSave={saveEdit} onChange={setEditValue}
              onDelete={() => deleteItem('relationships', i)}
            />
          ))}
        </Section>
      </div>
    </div>
  )
}

function Section({ title, count, children, onAdd }: { title: string; count: number; children: React.ReactNode; onAdd?: () => void }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-section-title text-text-main">{title} <span className="text-text-placeholder text-sm">({count})</span></h2>
        {onAdd && (
          <button onClick={onAdd} className="text-xs px-2 py-0.5 border border-primary text-primary rounded hover:bg-primary/5">+ 手动添加</button>
        )}
      </div>
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
              onClick={() => onEdit(f.path, f.value)}>{f.value || '-'}</span>
          )}
        </div>
      ))}
      <button onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 text-xs text-text-placeholder hover:text-danger transition-all mt-1">删除</button>
    </div>
  )
}
