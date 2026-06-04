import { useState, useEffect, useCallback } from 'react'
import type { TimelineEvent, TimelineEventType } from '../../types'

const TYPE_LABELS: Record<TimelineEventType, string> = {
  plot: '📖 剧情', character_development: '👤 角色发展', revelation: '💡 揭示',
  conflict: '⚔️ 冲突', resolution: '🏁 解决', world_building: '🌍 世界观'
}

const TYPE_COLORS: Record<TimelineEventType, string> = {
  plot: '#3B82F6', character_development: '#10B981', revelation: '#F59E0B',
  conflict: '#EF4444', resolution: '#8B5CF6', world_building: '#6B7280'
}

interface Props {
  projectId: number
  chapters: { chapter_number: number; title: string }[]
  volumes?: { volume_number: number; title: string; chapter_range: [number, number] }[]
}

export default function TimelinePanel({ projectId, chapters, volumes }: Props) {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [charFilter, setCharFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState<TimelineEventType | ''>('')
  const [volFilter, setVolFilter] = useState<number | ''>('')
  const [timelineFilter, setTimelineFilter] = useState('')
  const [editing, setEditing] = useState<TimelineEvent | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [formData, setFormData] = useState({
    chapter_number: 1, event_description: '', time_label: '',
    absolute_day: '' as number | '', location: '', characters_involved: '',
    event_type: 'plot' as TimelineEventType, is_major: false
  })

  const loadEvents = useCallback(async () => {
    if (!window.electronAPI) return
    setLoading(true)
    try {
      const rows = await window.electronAPI.db.query(
        'SELECT * FROM story_timeline WHERE project_id = ? ORDER BY absolute_day ASC, chapter_number ASC, event_order ASC',
        [projectId]
      )
      setEvents(rows.map((r: any) => ({
        ...r,
        characters_involved: typeof r.characters_involved === 'string'
          ? JSON.parse(r.characters_involved || '[]') : (r.characters_involved || [])
      })))
    } catch { }
    finally { setLoading(false) }
  }, [projectId])

  const deleteEvent = async (id: number) => {
    if (!window.electronAPI) return
    await window.electronAPI.db.run('DELETE FROM story_timeline WHERE id = ?', [id])
    loadEvents()
  }

  useEffect(() => { loadEvents() }, [loadEvents])

  const openEdit = (event: TimelineEvent) => {
    setEditing(event)
    setFormData({
      chapter_number: event.chapter_number, event_description: event.event_description,
      time_label: event.time_label || '', absolute_day: event.absolute_day ?? '',
      location: event.location || '', characters_involved: (event.characters_involved || []).join('、'),
      event_type: event.event_type as TimelineEventType, is_major: !!event.is_major
    })
  }

  const openAdd = () => {
    setEditing(null); setShowAdd(true)
    setFormData({
      chapter_number: 1, event_description: '', time_label: '',
      absolute_day: '', location: '', characters_involved: '',
      event_type: 'plot', is_major: false
    })
  }

  const saveForm = async () => {
    if (!window.electronAPI || !formData.event_description.trim()) return
    const chars = formData.characters_involved.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
    if (editing) {
      await window.electronAPI.db.run(
        `UPDATE story_timeline SET chapter_number=?, event_description=?, time_label=?,
         absolute_day=?, location=?, characters_involved=?, event_type=?, is_major=?
         WHERE id=?`,
        [formData.chapter_number, formData.event_description, formData.time_label,
         formData.absolute_day || null, formData.location, JSON.stringify(chars),
         formData.event_type, formData.is_major ? 1 : 0, editing.id]
      )
    } else {
      await window.electronAPI.db.run(
        `INSERT INTO story_timeline (project_id,chapter_number,event_order,event_description,time_label,absolute_day,location,characters_involved,event_type,is_major)
         VALUES (?,?,0,?,?,?,?,?,?,?)`,
        [projectId, formData.chapter_number, formData.event_description, formData.time_label,
         formData.absolute_day || null, formData.location, JSON.stringify(chars),
         formData.event_type, formData.is_major ? 1 : 0]
      )
    }
    setShowAdd(false); setEditing(null); loadEvents()
  }

  const allChars = [...new Set(events.flatMap(e => e.characters_involved))].sort()
  const allTimelines = [...new Set(events.map(e => (e as any).timeline_id || 'main'))].sort()

  const filtered = events.filter(e => {
    if (charFilter && !e.characters_involved.includes(charFilter)) return false
    if (typeFilter && e.event_type !== typeFilter) return false
    if (timelineFilter && ((e as any).timeline_id || 'main') !== timelineFilter) return false
    if (volFilter && volumes) {
      const vol = volumes.find(v => v.volume_number === volFilter)
      if (vol && (e.chapter_number < vol.chapter_range[0] || e.chapter_number > vol.chapter_range[1])) return false
    }
    return true
  })

  const timeConflicts: string[] = []
  for (let i = 1; i < events.length; i++) {
    if (events[i].absolute_day != null && events[i-1].absolute_day != null &&
        events[i].absolute_day! < events[i-1].absolute_day!) {
      timeConflicts.push(`⚠ 第${events[i-1].chapter_number}章(第${events[i-1].absolute_day}天) → 第${events[i].chapter_number}章(第${events[i].absolute_day}天)：时间倒退`)
    }
  }

  // 按卷统计事件密度
  const volStats = volumes?.map(v => {
    const cnt = events.filter(e => e.chapter_number >= v.chapter_range[0] && e.chapter_number <= v.chapter_range[1]).length
    const chCount = v.chapter_range[1] - v.chapter_range[0] + 1
    return { ...v, eventCount: cnt, density: chCount > 0 ? (cnt / chCount).toFixed(1) : '0' }
  })

  return (
    <div className="h-full overflow-auto">
      <div className="px-3 py-1.5 border-b border-border space-y-1">
        {/* 统计行 */}
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>{events.length} 事件</span>
          <button onClick={openAdd} className="px-2 py-0.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light">＋ 添加</button>
        </div>
        {/* 筛选行 */}
        <div className="flex gap-1">
          {volumes && volumes.length > 0 && (
            <select value={volFilter} onChange={e => setVolFilter(e.target.value ? Number(e.target.value) : '')}
              className="w-[70px] text-xxs border border-border-input rounded px-1 py-0.5 bg-white">
              <option value="">全部卷</option>
              {volumes.map(v => <option key={v.volume_number} value={v.volume_number}>第{v.volume_number}卷</option>)}
            </select>
          )}
          {allTimelines.length > 1 && (
            <select value={timelineFilter} onChange={e => setTimelineFilter(e.target.value)}
              className="w-[60px] text-xxs border border-border-input rounded px-1 py-0.5 bg-white">
              <option value="">全部线</option>
              {allTimelines.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TimelineEventType | '')}
            className="flex-1 min-w-0 text-xxs border border-border-input rounded px-1 py-0.5 bg-white">
            <option value="">全部类型</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={charFilter} onChange={e => setCharFilter(e.target.value)}
            className="flex-1 min-w-0 text-xxs border border-border-input rounded px-1 py-0.5 bg-white truncate">
            <option value="">全部角色</option>
            {allChars.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* 卷统计 */}
      {volStats && volFilter && (
        <div className="px-3 py-1.5 bg-bg-secondary/50 border-b border-border text-xs text-text-secondary">
          {volStats.filter(v => v.volume_number === volFilter).map(v => (
            <span key={v.volume_number}>第{v.volume_number}卷：{v.eventCount}事件 · 密度 {v.density}/章</span>
          ))}
        </div>
      )}

      {timeConflicts.length > 0 && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
          {timeConflicts.map((c, i) => <p key={i}>{c}</p>)}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          暂无时间线数据，生成章节后将自动提取
        </div>
      ) : (
        <div className="relative pl-8 pr-4 py-3">
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-border" style={{ left: '22px' }} />

          {filtered.map((event, idx) => {
            const ch = chapters.find(c => c.chapter_number === event.chapter_number)
            const color = TYPE_COLORS[event.event_type as TimelineEventType] || '#6B7280'
            const prevCh = idx > 0 ? filtered[idx-1].chapter_number : 0
            const showChapterMarker = event.chapter_number !== prevCh

            return (
              <div key={event.id}>
                {showChapterMarker && (
                  <div className="flex items-center gap-2 mb-2 mt-3 first:mt-0">
                    <div className="w-3 h-3 rounded-full bg-primary border-2 border-white absolute"
                      style={{ left: '17px', marginTop: '2px' }} />
                    <span className="text-xs font-medium text-primary">
                      📍 第{event.chapter_number}章 {ch?.title || ''}
                    </span>
                  </div>
                )}
                <div className="relative pb-3 ml-2 group">
                  <div className="w-2 h-2 rounded-full absolute border-2 border-white"
                    style={{ background: color, left: '-3px', top: '4px' }} />
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs text-text-secondary">
                      {event.time_label ? `🕐 ${event.time_label}` : ''}
                      {event.absolute_day != null ? ` · 第${event.absolute_day}天` : ''}
                    </span>
                    <span className={`px-1 py-0 rounded text-xs ${event.is_major ? 'bg-primary/10 text-primary' : 'text-text-placeholder'}`}>
                      {TYPE_LABELS[event.event_type as TimelineEventType] || event.event_type}
                    </span>
                  </div>
                  <p className="text-xs text-text-main">{event.event_description}</p>
                  <div className="flex gap-1.5 mt-0.5 text-xs text-text-placeholder">
                    {event.location && <span>📍 {event.location}</span>}
                    {event.characters_involved.length > 0 && (
                      <span>👤 {event.characters_involved.join('、')}</span>
                    )}
                  </div>
                  <div className="absolute right-0 top-0 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
                    <button onClick={() => openEdit(event)}
                      className="text-xs text-text-placeholder hover:text-primary" title="编辑">✏️</button>
                    <button onClick={() => deleteEvent(event.id)}
                      className="text-xs text-text-placeholder hover:text-danger" title="删除">🗑</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 编辑/添加弹窗 */}
      {(editing || showAdd) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={() => { setEditing(null); setShowAdd(false) }}>
          <div className="bg-white rounded-card shadow-card p-4 w-[400px] max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-medium mb-3">{editing ? '编辑事件' : '添加事件'}</h3>
            <div className="space-y-2.5">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">章节号 *</label>
                  <input type="number" value={formData.chapter_number} onChange={e => setFormData({...formData, chapter_number: Number(e.target.value)})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" min={1} />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">类型</label>
                  <select value={formData.event_type} onChange={e => setFormData({...formData, event_type: e.target.value as TimelineEventType})}
                    className="w-full text-xs border border-border-input rounded px-1.5 py-1">
                    {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-text-secondary">描述 *</label>
                <textarea value={formData.event_description} onChange={e => setFormData({...formData, event_description: e.target.value})}
                  className="w-full text-xs border border-border-input rounded px-2 py-1 h-14" placeholder="事件描述" />
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">时间标签</label>
                  <input value={formData.time_label} onChange={e => setFormData({...formData, time_label: e.target.value})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" placeholder="如 第三天" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">绝对天数</label>
                  <input type="number" value={formData.absolute_day} onChange={e => setFormData({...formData, absolute_day: e.target.value ? Number(e.target.value) : ''})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" placeholder="如 3" />
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">地点</label>
                  <input value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-text-secondary">关联角色（、分隔）</label>
                  <input value={formData.characters_involved} onChange={e => setFormData({...formData, characters_involved: e.target.value})}
                    className="w-full text-xs border border-border-input rounded px-2 py-1" />
                </div>
              </div>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={formData.is_major} onChange={e => setFormData({...formData, is_major: e.target.checked})} />
                标记为重大事件
              </label>
            </div>
            <div className="flex justify-end gap-2 mt-3">
              <button onClick={() => { setEditing(null); setShowAdd(false) }}
                className="px-3 py-1 text-xs border border-border-input text-text-secondary rounded-btn">取消</button>
              <button onClick={saveForm}
                className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50"
                disabled={!formData.event_description.trim()}>
                {editing ? '保存' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
