import { useState, useEffect, useCallback } from 'react'
import type { ForeshadowingItem, ForeshadowingStatus, ForeshadowingPriority } from '../../types'

const STATUS_LABELS: Record<ForeshadowingStatus, string> = {
  pending: '📋 待埋', active: '🌱 已埋', done: '✅ 已完结'
}

const STATUS_COLORS: Record<ForeshadowingStatus, string> = {
  pending: 'bg-gray-100 text-gray-600', active: 'bg-blue-100 text-blue-700',
  done: 'bg-green-100 text-green-700'
}

const PRIORITY_COLORS: Record<ForeshadowingPriority, string> = {
  critical: 'bg-red-500', high: 'bg-orange-400', normal: 'bg-blue-400', low: 'bg-gray-300'
}

const PRIORITY_LABELS: Record<ForeshadowingPriority, string> = {
  critical: '核心', high: '重要', normal: '普通', low: '点缀'
}

interface Props {
  projectId: number
  chapters: { chapter_number: number; title: string }[]
}

export default function ForeshadowingPanel({ projectId, chapters }: Props) {
  const [items, setItems] = useState<ForeshadowingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'active' | 'resolved'>('active')
  const [editing, setEditing] = useState<ForeshadowingItem | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [formData, setFormData] = useState({
    foreshadow_id: '', description: '', status: 'pending' as ForeshadowingStatus,
    priority: 'normal' as ForeshadowingPriority, planted_chapter: 0,
    target_chapter: 0, notes: '', related_characters: '',
    reveal_condition: '', reveal_ratio: 0,
  })

  const loadItems = useCallback(async () => {
    if (!window.electronAPI) return
    setLoading(true)
    try {
      const rows = await window.electronAPI.db.query(
        'SELECT * FROM foreshadowing_registry WHERE project_id = ? ORDER BY created_at ASC',
        [projectId]
      )
      setItems(rows.map((r: any) => ({
        ...r,
        related_characters: typeof r.related_characters === 'string'
          ? JSON.parse(r.related_characters || '[]') : (r.related_characters || [])
      })))
    } catch { /* table may not exist yet */ }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { loadItems() }, [loadItems])

  const updateStatus = async (id: number, status: ForeshadowingStatus) => {
    await window.electronAPI?.db.run(
      'UPDATE foreshadowing_registry SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
      [status, id]
    )
    loadItems()
  }

  const deleteItem = async (id: number) => {
    if (!window.electronAPI) return
    await window.electronAPI.db.run('DELETE FROM foreshadowing_registry WHERE id = ?', [id])
    loadItems()
  }

  const openEdit = (item: ForeshadowingItem) => {
    setEditing(item)
    setFormData({
      foreshadow_id: item.foreshadow_id, description: item.description,
      status: item.status, priority: item.priority,
      planted_chapter: item.planted_chapter || 0, target_chapter: item.target_chapter || 0,
      notes: item.notes || '', related_characters: (item.related_characters || []).join('、'),
      reveal_condition: (item as any).reveal_condition || '', reveal_ratio: (item as any).reveal_ratio || 0,
    })
  }

  const openAdd = () => {
    setEditing(null); setShowAdd(true)
    setFormData({
      foreshadow_id: '', description: '', status: 'pending', priority: 'normal',
      planted_chapter: 0, target_chapter: 0, notes: '', related_characters: '',
      reveal_condition: '', reveal_ratio: 0,
    })
  }

  const saveForm = async () => {
    if (!window.electronAPI || !formData.description.trim()) return
    const chars = formData.related_characters.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
    if (editing) {
      await window.electronAPI.db.run(
        `UPDATE foreshadowing_registry SET description=?, status=?, priority=?,
         planted_chapter=?, target_chapter=?, notes=?, related_characters=?,
         reveal_condition=?, reveal_ratio=?,
         updated_at=datetime('now','localtime') WHERE id=?`,
        [formData.description, formData.status, formData.priority,
         formData.planted_chapter || null, formData.target_chapter || null,
         formData.notes, JSON.stringify(chars),
         formData.reveal_condition, formData.reveal_ratio, editing.id]
      )
    } else {
      const fid = formData.foreshadow_id || `M-${Date.now().toString(36)}`
      await window.electronAPI.db.run(
        `INSERT OR IGNORE INTO foreshadowing_registry (project_id,foreshadow_id,description,status,priority,planted_chapter,target_chapter,notes,related_characters,reveal_condition,reveal_ratio)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [projectId, fid, formData.description, formData.status, formData.priority,
         formData.planted_chapter || null, formData.target_chapter || null,
         formData.notes, JSON.stringify(chars), formData.reveal_condition, formData.reveal_ratio]
      )
    }
    setShowAdd(false); setEditing(null); loadItems()
  }

  const filtered = items.filter(i => {
    if (filter === 'active') return i.status !== 'done'
    if (filter === 'resolved') return i.status === 'done'
    return true
  })

  const activeCount = items.filter(i => i.status !== 'done').length
  const resolvedCount = items.filter(i => i.status === 'done').length
  const recoveryRate = items.length > 0 ? Math.round((resolvedCount / items.length) * 100) : 0

  return (
    <div className="h-full overflow-auto">
      {/* 统计 + 操作 */}
      <div className="px-3 py-1.5 border-b border-border space-y-1">
        {/* 统计行 */}
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>{items.length}个 · {resolvedCount}已回收 · {recoveryRate}%</span>
          <button onClick={openAdd} className="px-2 py-0.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light">＋ 添加</button>
        </div>
        {/* 筛选行 */}
        <div className="flex gap-1">
          {(['active', 'resolved', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`flex-1 px-2 py-0.5 text-xs rounded-btn transition-colors text-center ${
                filter === f ? 'bg-primary text-white' : 'bg-bg-secondary text-text-secondary hover:bg-border'
              }`}
            >
              {f === 'active' ? '未回收' : f === 'resolved' ? '已回收' : '全部'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          {items.length === 0 ? '暂无伏笔数据，生成章节后将自动提取' : '没有匹配的伏笔'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {filtered.map(item => {
            const ch = chapters.find(c => c.chapter_number === item.planted_chapter)
            const targetCh = chapters.find(c => c.chapter_number === item.target_chapter)
            const resolvedCh = chapters.find(c => c.chapter_number === item.resolved_chapter)

            return (
              <div key={item.id} className="px-4 py-2.5 hover:bg-bg-secondary/50 transition-colors">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[item.priority]}`} title={item.priority} />
                    <span className="text-xs text-text-main font-medium">{item.foreshadow_id || `#${item.id}`}</span>
                    <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_COLORS[item.status]}`}>
                      {STATUS_LABELS[item.status]}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {item.status === 'active' && (
                      <button onClick={() => updateStatus(item.id, 'done')}
                        className="text-xxs px-1.5 py-0.5 rounded border border-green-300 text-green-600 hover:bg-green-50"
                      >标记回收</button>
                    )}
                    {item.status === 'done' && (
                      <button onClick={() => updateStatus(item.id, 'active')}
                        className="text-xxs px-1.5 py-0.5 rounded border border-blue-300 text-blue-600 hover:bg-blue-50"
                      >重新激活</button>
                    )}
                    <button onClick={() => openEdit(item)}
                      className="text-xs text-text-placeholder hover:text-primary px-0.5" title="编辑">✏️</button>
                    <button onClick={() => deleteItem(item.id)}
                      className="text-xs text-text-placeholder hover:text-danger transition-colors px-0.5"
                      title="删除"
                    >🗑</button>
                  </div>
                </div>
                <p className="text-xs text-text-main mb-1.5 line-clamp-2">{item.description}</p>
                <div className="flex flex-wrap gap-2 text-xs text-text-secondary">
                  {item.planted_chapter && (
                    <span>📍 第{item.planted_chapter}章{ch ? ` ${ch.title}` : ''}</span>
                  )}
                  {item.target_chapter && (
                    <span>🎯 目标：第{item.target_chapter}章{targetCh ? ` ${targetCh.title}` : ''}</span>
                  )}
                  {item.resolved_chapter && (
                    <span>✅ 回收：第{item.resolved_chapter}章{resolvedCh ? ` ${resolvedCh.title}` : ''}</span>
                  )}
                  {item.related_characters.length > 0 && (
                    <span>👤 {item.related_characters.join('、')}</span>
                  )}
                </div>
                {item.notes && <p className="text-xs text-text-placeholder mt-1">{item.notes}</p>}
              </div>
            )
          })}
        </div>
      )}

      {/* 编辑/添加弹窗 */}
      {(editing || showAdd) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setEditing(null); setShowAdd(false) }}>
          <div className="bg-white rounded-card shadow-card p-4 w-[400px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium mb-3">{editing ? '编辑伏笔' : '添加伏笔'}</h3>
            <div className="space-y-2.5">
              <div>
                <label className="text-xs text-text-secondary">ID</label>
                <input value={formData.foreshadow_id} onChange={e => setFormData({...formData, foreshadow_id: e.target.value})}
                  className="w-full text-xs border border-border-input rounded px-2 py-1" placeholder="如 F001-1，留空自动生成" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">描述 *</label>
                <textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                  className="w-full text-xs border border-border-input rounded px-2 py-1 h-16" placeholder="伏笔内容描述" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">状态</label>
                  <select value={formData.status} onChange={e => setFormData({...formData, status: e.target.value as ForeshadowingStatus})}
                    className="w-full text-xs border border-border-input rounded px-1.5 py-1">
                    {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">优先级</label>
                  <select value={formData.priority} onChange={e => setFormData({...formData, priority: e.target.value as ForeshadowingPriority})}
                    className="w-full text-xs border border-border-input rounded px-1.5 py-1">
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">埋设章节</label>
                  <input type="number" value={formData.planted_chapter || ''} onChange={e => setFormData({...formData, planted_chapter: Number(e.target.value)})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">目标章节</label>
                  <input type="number" value={formData.target_chapter || ''} onChange={e => setFormData({...formData, target_chapter: Number(e.target.value)})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" />
                </div>
              </div>
              <div>
                <label className="text-xs text-text-secondary">关联角色（、分隔）</label>
                <input value={formData.related_characters} onChange={e => setFormData({...formData, related_characters: e.target.value})}
                  className="w-full text-xs border border-border-input rounded px-2 py-1" placeholder="角色A、角色B" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">回收条件</label>
                <input value={formData.reveal_condition} onChange={e => setFormData({...formData, reveal_condition: e.target.value})}
                  className="w-full text-xs border border-border-input rounded px-2 py-1" placeholder="如：当主角发现XX证据时触发" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">揭示比例 (%)</label>
                  <input type="number" value={formData.reveal_ratio} onChange={e => setFormData({...formData, reveal_ratio: Number(e.target.value)})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" min={0} max={100} />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">备注</label>
                  <input value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => { setEditing(null); setShowAdd(false) }}
                className="px-3 py-1 text-xs border border-border-input text-text-secondary rounded-btn">取消</button>
              <button onClick={saveForm}
                className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50"
                disabled={!formData.description.trim()}>
                {editing ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
