// v4.0 DesignPanel — 设计台（四标签：设定/角色跟踪/事件跟踪/伏笔）
import { useState, useEffect, useCallback } from 'react'
import { showToast } from '../common/Toast'
import * as trackerService from '../../services/trackerService'

interface Props {
  projectId: number
  outlineContent?: string
  chapters?: { chapter_number: number; title: string; content: string }[]
  volumes?: { volume_number: number; title: string; chapter_range: [number, number] }[]
  refreshKey?: number
}

type SubTab = 'setting' | 'character' | 'event' | 'foreshadow'
type SettingCat = 'character' | 'world' | 'event_node'

const SETTING_CATS: { key: SettingCat; label: string; trackerType: string }[] = [
  { key: 'character', label: '角色', trackerType: 'character' },
  { key: 'world', label: '世界观', trackerType: 'rules' },
  { key: 'event_node', label: '事件节点', trackerType: 'event' },
]

export default function DesignPanel({ projectId, outlineContent, chapters, volumes, refreshKey }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('setting')
  const [masterItems, setMasterItems] = useState<any[]>([])
  const [volItems, setVolItems] = useState<any[]>([])
  const [chItems, setChItems] = useState<any[]>([])
  const [selectedChapter, setSelectedChapter] = useState(0)
  const [selectedVol, setSelectedVol] = useState(0)
  const [extracting, setExtracting] = useState(false)
  const [settingCat, setSettingCat] = useState<SettingCat>('character')
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editSummary, setEditSummary] = useState('')

  const SUB_TABS: { key: SubTab; label: string }[] = [
    { key: 'setting', label: '设定' },
    { key: 'character', label: '角色跟踪' },
    { key: 'event', label: '事件跟踪' },
    { key: 'foreshadow', label: '伏笔' },
  ]

  const loadMaster = useCallback(async () => {
    const items = await trackerService.getMasterTracker(projectId)
    setMasterItems(items)
  }, [projectId])

  const loadVol = useCallback(async () => {
    if (selectedVol > 0) {
      const items = await trackerService.getVolumeTracker(projectId, selectedVol)
      setVolItems(items)
    } else {
      setVolItems([])
    }
  }, [projectId, selectedVol])

  const loadCh = useCallback(async () => {
    if (selectedChapter > 0) {
      const items = await trackerService.getChapterTracker(projectId, selectedChapter)
      setChItems(items)
    } else {
      setChItems([])
    }
  }, [projectId, selectedChapter])

  useEffect(() => { loadMaster() }, [loadMaster, refreshKey])
  useEffect(() => { loadVol() }, [loadVol, refreshKey])
  useEffect(() => { loadCh() }, [loadCh, refreshKey])

  const extractMaster = async () => {
    if (!outlineContent) { showToast('error', '请先生成大纲'); return }
    setExtracting(true)
    try {
      const count = await trackerService.extractMasterFromOutline(projectId, outlineContent)
      if (count > 0) {
        showToast('success', `已提取 ${count} 项到总表`)
        loadMaster()
      } else {
        showToast('error', '提取失败')
      }
    } catch (e: any) { showToast('error', e.message) } finally { setExtracting(false) }
  }

  const items = subTab === 'setting' ? masterItems
    : subTab === 'character' ? [...volItems, ...chItems].filter(i => i.tracker_type === 'character')
    : subTab === 'event' ? [...volItems, ...chItems].filter(i => i.tracker_type === 'event')
    : [...volItems, ...chItems].filter(i => i.tracker_type === 'foreshadow')

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="shrink-0 border-b border-border flex items-center bg-gray-50/50">
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`flex-1 py-1.5 text-xs border-b-2 ${
              subTab === t.key ? 'text-primary border-primary font-semibold' : 'text-text-secondary border-transparent hover:text-text-main'
            }`}>
            {t.label}
          </button>
        ))}
        <button onClick={extractMaster} disabled={extracting || !outlineContent}
          className="px-2.5 py-1.5 text-xs text-text-secondary hover:text-primary border-l border-border disabled:opacity-50 shrink-0">
          {extracting ? '提取中' : '提取'}
        </button>
      </div>

      {/* 卷选择器 */}
      {subTab !== 'setting' && volumes && volumes.length > 0 && (
        <div className="shrink-0 border-b border-border/50 overflow-x-auto flex px-2 py-1 gap-0.5">
          <button onClick={() => { setSelectedVol(0); setSelectedChapter(0) }}
            className={`px-2 py-0.5 text-xs rounded ${selectedVol === 0 ? 'bg-primary/10 text-primary' : 'text-text-secondary'}`}>全部</button>
          {volumes.map(v => (
            <button key={v.volume_number} onClick={() => setSelectedVol(v.volume_number)}
              className={`px-2 py-0.5 text-xs rounded ${selectedVol === v.volume_number ? 'bg-primary/10 text-primary' : 'text-text-secondary'}`}>V{v.volume_number}</button>
          ))}
        </div>
      )}

      {/* 章选择器 */}
      {subTab !== 'setting' && chapters && chapters.length > 0 && (
        <div className="shrink-0 border-b border-border/50 overflow-x-auto flex px-2 py-1 gap-0.5">
          <button onClick={() => setSelectedChapter(0)}
            className={`px-2 py-0.5 text-xs rounded ${selectedChapter === 0 ? 'bg-primary/10 text-primary' : 'text-text-secondary'}`}>全部</button>
          {chapters.filter(c => selectedVol === 0 || true).slice(-20).map(c => (
            <button key={c.chapter_number} onClick={() => setSelectedChapter(c.chapter_number)}
              className={`px-2 py-0.5 text-xs rounded ${selectedChapter === c.chapter_number ? 'bg-primary/10 text-primary' : 'text-text-secondary'}`}>Ch{c.chapter_number}</button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {subTab === 'setting' ? (
          /* ====== 设定标签：按分类展示 ====== */
          <div className="h-full flex flex-col">
            {/* 分类按钮 */}
            <div className="shrink-0 flex border-b border-border/50 px-2 py-1 gap-0.5">
              {SETTING_CATS.map(cat => {
                const count = masterItems.filter(i => i.tracker_type === cat.trackerType).length
                return (
                  <button key={cat.key} onClick={() => setSettingCat(cat.key)}
                    className={`px-2 py-0.5 text-xs rounded ${settingCat === cat.key ? 'bg-primary/10 text-primary font-medium' : 'text-text-secondary hover:text-text-main'}`}>
                    {cat.label} {count > 0 && <span className="text-xxs ml-0.5 opacity-70">{count}</span>}
                  </button>
                )
              })}
            </div>
            {/* 分类内容 */}
            <div className="flex-1 overflow-auto p-2 space-y-1.5">
              {masterItems.filter(i => i.tracker_type === SETTING_CATS.find(c => c.key === settingCat)!.trackerType).length === 0 ? (
                <div className="text-center py-16 text-text-secondary text-xs">暂无{ SETTING_CATS.find(c => c.key === settingCat)!.label }数据</div>
              ) : (
                masterItems.filter(i => i.tracker_type === SETTING_CATS.find(c => c.key === settingCat)!.trackerType).map(item => {
                  const state = item.state || {}
                  const charFields = item.tracker_type === 'character' ? ['emotion', 'location', 'goal'] : []
                  const eventFields = item.tracker_type === 'event' ? ['phase', 'progress', 'next_milestone'] : []
                  const displayFields = [...charFields, ...eventFields]
                  return (
                    <div key={item.id} className="border border-border/60 rounded p-2 bg-white group">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-text-main">{item.tracker_key}</span>
                        <button onClick={() => { setEditingId(editingId === item.id ? null : item.id); setEditSummary(item.summary || '') }}
                          className="text-xxs text-text-placeholder hover:text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                          编辑
                        </button>
                      </div>
                      {editingId === item.id ? (
                        <div className="space-y-1">
                          <textarea value={editSummary} onChange={e => setEditSummary(e.target.value)}
                            className="w-full text-xs border border-border-input rounded px-1.5 py-0.5 resize-none h-14"
                            placeholder="摘要（AI可读）" />
                          <div className="flex gap-1 justify-end">
                            <button onClick={async () => {
                              await trackerService.upsertTracker({
                                project_id: projectId, tier: 'master', volume_number: 0, chapter_number: 0,
                                tracker_type: item.tracker_type, tracker_key: item.tracker_key,
                                summary: editSummary, state: item.state || {}, status: item.status || '',
                              })
                              setEditingId(null)
                              loadMaster()
                              showToast('success', '已保存')
                            }} className="px-2 py-0.5 text-xxs bg-primary text-white rounded">保存</button>
                            <button onClick={() => setEditingId(null)} className="px-2 py-0.5 text-xxs border border-border-input rounded">取消</button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-text-secondary">{item.summary || '(无描述)'}</p>
                      )}
                      {displayFields.some(f => state[f] != null) && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xxs">
                          {displayFields.map(f => state[f] != null ? (
                            <span key={f} className="text-text-placeholder">
                              <span className="text-text-secondary/70">{f}:</span> {String(state[f]).slice(0, 30)}
                            </span>
                          ) : null)}
                        </div>
                      )}
                      {/* 角色关系 */}
                      {item.tracker_type === 'character' && state.relationships && Object.keys(state.relationships).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xxs">
                          <span className="text-text-secondary/70">关系:</span>
                          {Object.entries(state.relationships as Record<string, number>).map(([name, val]) => (
                            <span key={name} className="text-text-placeholder">{name} <span className={val > 0 ? 'text-success' : val < 0 ? 'text-danger' : ''}>{val}</span></span>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          items.map(item => (
            <div key={item.id} className="border border-border/60 rounded p-2.5 bg-white">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium">{item.tracker_key}</span>
                <span className="text-xxs text-text-placeholder">{item.tier}·{item.tracker_type}</span>
              </div>
              <p className="text-xs text-text-secondary">{item.summary}</p>
              {Object.keys(item.state || {}).length > 0 && (
                <div className="mt-1 text-xxs text-text-placeholder">
                  {JSON.stringify(item.state).slice(0, 100)}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
