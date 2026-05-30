import { useState, useEffect, useCallback } from 'react'
import { showToast } from '../common/Toast'
import type { CharacterCard, WorldSetting, CharacterRoleType, WorldCategory } from '../../types'

const ROLE_LABELS: Record<CharacterRoleType, string> = {
  main: '主角', support: '配角', antagonist: '反派', minor: '次要'
}
const ROLE_COLORS: Record<CharacterRoleType, string> = {
  main: 'bg-warning/10 text-warning', support: 'bg-primary-light/50 text-primary',
  antagonist: 'bg-danger/10 text-danger', minor: 'text-text-placeholder'
}

const CATEGORY_LABELS: Record<WorldCategory, string> = {
  location: '地点', faction: '势力', rule: '规则', timeline: '时间线', general: '通用'
}

interface Props {
  projectId: number
  refreshTrigger?: number
}

export default function CardPanel({ projectId, refreshTrigger }: Props) {
  const [tab, setTab] = useState<'characters' | 'world'>('characters')
  const [characters, setCharacters] = useState<CharacterCard[]>([])
  const [worlds, setWorlds] = useState<WorldSetting[]>([])
  const [loaded, setLoaded] = useState(false)

  // 编辑弹窗
  const [editingChar, setEditingChar] = useState<CharacterCard | null>(null)
  const [editingWorld, setEditingWorld] = useState<WorldSetting | null>(null)
  const [showCharForm, setShowCharForm] = useState(false)
  const [showWorldForm, setShowWorldForm] = useState(false)

  // 展开状态
  const [expandedChar, setExpandedChar] = useState<number | null>(null)
  const [expandedWorld, setExpandedWorld] = useState<number | null>(null)

  const loadCards = useCallback(async () => {
    if (!window.electronAPI) { setLoaded(true); return }
    try {
      const chars = await window.electronAPI.db.query(
        'SELECT * FROM character_cards WHERE project_id = ? ORDER BY CASE role_type WHEN "main" THEN 1 WHEN "antagonist" THEN 2 WHEN "support" THEN 3 ELSE 4 END',
        [projectId]
      )
      setCharacters(chars.map((c: any) => ({
        ...c,
        relationships: safeJson(c.relationships, []),
        status_tracking: safeJson(c.status_tracking, {}),
      })))

      const ws = await window.electronAPI.db.query(
        'SELECT * FROM world_settings WHERE project_id = ? ORDER BY priority ASC, is_global DESC',
        [projectId]
      )
      setWorlds(ws)
    } catch (e) { /* ignore */ }
    setLoaded(true)
  }, [projectId])

  useEffect(() => { loadCards() }, [loadCards, refreshTrigger])

  const safeJson = (val: string, fallback: any) => { try { return JSON.parse(val) } catch { return fallback } }

  // ===== 角色卡片表单 =====
  const CharForm = ({ initial }: { initial?: CharacterCard }) => {
    const [name, setName] = useState(initial?.name || '')
    const [roleType, setRoleType] = useState<CharacterRoleType>(initial?.role_type || 'main')
    const [personality, setPersonality] = useState(initial?.personality || '')
    const [background, setBackground] = useState(initial?.background || '')
    const [appearance, setAppearance] = useState(initial?.appearance || '')
    const [abilities, setAbilities] = useState(initial?.abilities || '')
    const [relText, setRelText] = useState(
      initial?.relationships?.map(r => `${r.name}:${r.relation}:${r.description}`).join('\n') || ''
    )
    const [status, setStatus] = useState(initial?.status_tracking?.current_status || '')
    const [location, setLocation] = useState(initial?.status_tracking?.location || '')
    const [goal, setGoal] = useState(initial?.status_tracking?.goal || '')
    const [notes, setNotes] = useState(initial?.notes || '')

    const save = async () => {
      if (!name.trim()) { showToast('error', '请输入角色名称'); return }
      const rels = relText.trim().split('\n').filter(Boolean).map(line => {
        const [n, r, d] = line.split(':')
        return { name: n?.trim() || '', relation: r?.trim() || '', description: d?.trim() || '' }
      })
      const data = {
        name: name.trim(), role_type: roleType, personality, background, appearance, abilities,
        relationships: JSON.stringify(rels),
        status_tracking: JSON.stringify({ current_status: status, location, goal }),
        notes,
      }
      try {
        if (initial) {
          await window.electronAPI.db.run(
            `UPDATE character_cards SET name=?,role_type=?,personality=?,background=?,appearance=?,abilities=?,relationships=?,status_tracking=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?`,
            [data.name, data.role_type, data.personality, data.background, data.appearance, data.abilities, data.relationships, data.status_tracking, data.notes, initial.id]
          )
        } else {
          await window.electronAPI.db.run(
            `INSERT INTO character_cards (project_id,name,role_type,personality,background,appearance,abilities,relationships,status_tracking,notes) VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [projectId, data.name, data.role_type, data.personality, data.background, data.appearance, data.abilities, data.relationships, data.status_tracking, data.notes]
          )
        }
        loadCards()
        closeCharForm()
        showToast('success', initial ? '已更新' : '已创建')
      } catch (e: any) { showToast('error', '保存失败：' + (e.message || '')) }
    }

    const closeCharForm = () => { setShowCharForm(false); setEditingChar(null) }

    return (
      <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={closeCharForm}>
        <div className="bg-white rounded-card shadow-xl w-[480px] max-h-[75vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
            <h2 className="text-sm font-medium">{initial ? '编辑角色' : '新建角色'}</h2>
            <button onClick={closeCharForm} className="text-text-placeholder hover:text-text-main">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">角色名 *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="如：林辰" className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">角色类型</label>
                <select value={roleType} onChange={e => setRoleType(e.target.value as CharacterRoleType)} className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary">性格特点</label>
              <textarea value={personality} onChange={e => setPersonality(e.target.value)} rows={2} placeholder="如：冷酷果决、心思缜密、重情义..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">背景故事</label>
                <textarea value={background} onChange={e => setBackground(e.target.value)} rows={2} placeholder="角色的过去、动机..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-text-secondary">外貌特征</label>
                <textarea value={appearance} onChange={e => setAppearance(e.target.value)} rows={2} placeholder="身高、长相、标志性特征..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none" />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary">能力/金手指</label>
              <input value={abilities} onChange={e => setAbilities(e.target.value)} placeholder="如：灵根被废、医术传承、空间戒指..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">当前状态</label>
                <input value={status} onChange={e => setStatus(e.target.value)} placeholder="存活/受伤/失踪..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-text-secondary">当前位置</label>
                <input value={location} onChange={e => setLocation(e.target.value)} placeholder="如：青云宗" className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-text-secondary">当前目标</label>
                <input value={goal} onChange={e => setGoal(e.target.value)} placeholder="如：复仇、变强" className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary">人物关系 (每行一条：角色名:关系:描述)</label>
              <textarea value={relText} onChange={e => setRelText(e.target.value)} rows={3} placeholder={"林雪:盟友:青梅竹马\n张浩:对手:同门竞争"} className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none font-mono" />
            </div>
            <div>
              <label className="text-xs text-text-secondary">备注</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="任何补充说明..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
            </div>
          </div>
          <div className="px-4 py-3 border-t border-border flex justify-end gap-2 shrink-0">
            <button onClick={closeCharForm} className="px-4 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary">取消</button>
            <button onClick={save} className="px-4 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">保存</button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 世界设定卡片表单 =====
  const WorldForm = ({ initial }: { initial?: WorldSetting }) => {
    const [name, setName] = useState(initial?.name || '')
    const [category, setCategory] = useState<WorldCategory>(initial?.category || 'general')
    const [description, setDesc] = useState(initial?.description || '')
    const [details, setDetails] = useState(initial?.details || '')
    const [triggerKeywords, setKeywords] = useState(initial?.trigger_keywords || '')
    const [priority, setPriority] = useState(initial?.priority || 0)
    const [isGlobal, setIsGlobal] = useState(initial?.is_global === 1)
    const [notes, setNotes] = useState(initial?.notes || '')

    const save = async () => {
      if (!name.trim()) { showToast('error', '请输入设定名称'); return }
      const data = { name: name.trim(), category, description, details, trigger_keywords: triggerKeywords, priority, is_global: isGlobal ? 1 : 0, notes }
      try {
        if (initial) {
          await window.electronAPI.db.run(
            `UPDATE world_settings SET name=?,category=?,description=?,details=?,trigger_keywords=?,priority=?,is_global=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?`,
            [data.name, data.category, data.description, data.details, data.trigger_keywords, data.priority, data.is_global, data.notes, initial.id]
          )
        } else {
          await window.electronAPI.db.run(
            `INSERT INTO world_settings (project_id,name,category,description,details,trigger_keywords,priority,is_global,notes) VALUES (?,?,?,?,?,?,?,?,?)`,
            [projectId, data.name, data.category, data.description, data.details, data.trigger_keywords, data.priority, data.is_global, data.notes]
          )
        }
        loadCards()
        closeWorldForm()
        showToast('success', initial ? '已更新' : '已创建')
      } catch (e: any) { showToast('error', '保存失败') }
    }

    const closeWorldForm = () => { setShowWorldForm(false); setEditingWorld(null) }

    return (
      <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={closeWorldForm}>
        <div className="bg-white rounded-card shadow-xl w-[480px] max-h-[75vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
          <div className="px-4 py-3 border-b border-border flex items-center justify-between shrink-0">
            <h2 className="text-sm font-medium">{initial ? '编辑设定' : '新建设定'}</h2>
            <button onClick={closeWorldForm} className="text-text-placeholder hover:text-text-main">✕</button>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-3">
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">设定名称 *</label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="如：青云宗、灵气体系" className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">分类</label>
                <select value={category} onChange={e => setCategory(e.target.value as WorldCategory)} className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs">
                  {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-text-secondary">简述</label>
              <input value={description} onChange={e => setDesc(e.target.value)} placeholder="一句话描述..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
            </div>
            <div>
              <label className="text-xs text-text-secondary">详细内容</label>
              <textarea value={details} onChange={e => setDetails(e.target.value)} rows={4} placeholder="详细描述..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs resize-none" />
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-text-secondary">触发关键词 (逗号分隔)</label>
                <input value={triggerKeywords} onChange={e => setKeywords(e.target.value)} placeholder="青云宗,长老,修炼..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
              <div>
                <label className="text-xs text-text-secondary">优先级 (越小越高)</label>
                <input type="number" value={priority} onChange={e => setPriority(Number(e.target.value))} className="w-20 mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
              </div>
            </div>
            <div className="flex gap-3 items-center">
              <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                <input type="checkbox" checked={isGlobal} onChange={e => setIsGlobal(e.target.checked)} className="accent-primary" />
                全局注入（不依赖关键词触发）
              </label>
            </div>
            <div>
              <label className="text-xs text-text-secondary">备注</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="补充..." className="w-full mt-1 px-2 py-1.5 border border-border-input rounded-btn text-xs" />
            </div>
          </div>
          <div className="px-4 py-3 border-t border-border flex justify-end gap-2 shrink-0">
            <button onClick={closeWorldForm} className="px-4 py-1.5 text-xs border border-border-input rounded-btn text-text-secondary">取消</button>
            <button onClick={save} className="px-4 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">保存</button>
          </div>
        </div>
      </div>
    )
  }

  // ===== 删除角色 =====
  const deleteChar = async (char: CharacterCard) => {
    if (!window.confirm(`确定删除角色「${char.name}」吗？`)) return
    await window.electronAPI.db.run('DELETE FROM character_cards WHERE id = ?', [char.id])
    loadCards()
    showToast('success', `「${char.name}」已删除`)
  }

  // ===== 删除世界设定 =====
  const deleteWorld = async (ws: WorldSetting) => {
    if (!window.confirm(`确定删除设定「${ws.name}」吗？`)) return
    await window.electronAPI.db.run('DELETE FROM world_settings WHERE id = ?', [ws.id])
    loadCards()
    showToast('success', `「${ws.name}」已删除`)
  }

  if (!loaded) return <div className="p-4 text-xs text-text-placeholder">加载中...</div>

  return (
    <div className="flex flex-col h-full">
      {/* Sub tabs */}
      <div className="flex border-b border-border shrink-0">
        {[
          { key: 'characters' as const, label: `👤 角色 (${characters.length})` },
          { key: 'world' as const, label: `🌍 设定 (${worlds.length})` },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-1.5 text-xs font-medium transition-colors
              ${tab === t.key ? 'text-primary border-b-2 border-primary' : 'text-text-secondary hover:text-text-main'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {/* 角色卡片列表 */}
        {tab === 'characters' && (
          <div className="p-2 space-y-1.5">
            <button onClick={() => setShowCharForm(true)}
              className="w-full px-3 py-2 text-xs border border-dashed border-primary/30 rounded-card text-primary hover:bg-primary-light/30 transition-colors">
              ＋ 新建角色
            </button>
            {characters.length === 0 ? (
              <p className="text-xs text-text-placeholder text-center py-6">暂无角色卡片</p>
            ) : (
              characters.map(char => {
                const isExpanded = expandedChar === char.id
                return (
                  <div key={char.id} className="border border-border rounded-card overflow-hidden">
                    <button
                      onClick={() => setExpandedChar(isExpanded ? null : char.id)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${ROLE_COLORS[char.role_type]}`}>{ROLE_LABELS[char.role_type]}</span>
                        <span className="text-xs font-medium text-text-main truncate">{char.name}</span>
                      </div>
                      <span className="text-xs text-text-placeholder">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border px-3 py-2 space-y-1.5">
                        {char.personality && <div className="text-xs"><span className="text-text-placeholder">性格：</span>{char.personality}</div>}
                        {char.background && <div className="text-xs"><span className="text-text-placeholder">背景：</span>{char.background}</div>}
                        {char.appearance && <div className="text-xs"><span className="text-text-placeholder">外貌：</span>{char.appearance}</div>}
                        {char.abilities && <div className="text-xs"><span className="text-text-placeholder">能力：</span>{char.abilities}</div>}
                        {char.relationships && (char.relationships as any[]).length > 0 && (
                          <div className="text-xs">
                            <span className="text-text-placeholder">关系：</span>
                            {(char.relationships as any[]).map((r, i) => (
                              <span key={i} className="inline-block mr-2 bg-bg-secondary px-1 rounded">{r.name}（{r.relation}）</span>
                            ))}
                          </div>
                        )}
                        {char.status_tracking && Object.keys(char.status_tracking).length > 0 && (
                          <div className="text-xs">
                            <span className="text-text-placeholder">状态：</span>
                            {char.status_tracking.location && <span>📍{char.status_tracking.location} </span>}
                            {char.status_tracking.current_status && <span>{char.status_tracking.current_status} </span>}
                            {char.status_tracking.goal && <span>→ {char.status_tracking.goal}</span>}
                          </div>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => { setEditingChar(char); setShowCharForm(true) }}
                            className="text-xs text-primary hover:underline">编辑</button>
                          <button onClick={() => deleteChar(char)}
                            className="text-xs text-danger hover:underline">删除</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}

        {/* 世界设定列表 */}
        {tab === 'world' && (
          <div className="p-2 space-y-1.5">
            <button onClick={() => setShowWorldForm(true)}
              className="w-full px-3 py-2 text-xs border border-dashed border-primary/30 rounded-card text-primary hover:bg-primary-light/30 transition-colors">
              ＋ 新建设定
            </button>
            {worlds.length === 0 ? (
              <p className="text-xs text-text-placeholder text-center py-6">暂无世界设定</p>
            ) : (
              worlds.map(ws => {
                const isExpanded = expandedWorld === ws.id
                return (
                  <div key={ws.id} className="border border-border rounded-card overflow-hidden">
                    <button
                      onClick={() => setExpandedWorld(isExpanded ? null : ws.id)}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-bg-secondary text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs text-text-placeholder">{CATEGORY_LABELS[ws.category]}</span>
                        <span className="text-xs font-medium text-text-main truncate">{ws.name}</span>
                        {ws.is_global ? <span className="text-xs text-primary">🌐</span> : null}
                      </div>
                      <span className="text-xs text-text-placeholder">{isExpanded ? '▲' : '▼'}</span>
                    </button>
                    {isExpanded && (
                      <div className="border-t border-border px-3 py-2 space-y-1.5">
                        {ws.description && <div className="text-xs text-text-secondary">{ws.description}</div>}
                        {ws.details && <div className="text-xs text-text-secondary whitespace-pre-wrap">{ws.details}</div>}
                        {ws.trigger_keywords && (
                          <div className="text-xs">
                            <span className="text-text-placeholder">触发词：</span>
                            {ws.trigger_keywords.split(',').filter(Boolean).map((k, i) => (
                              <span key={i} className="inline-block mr-1 bg-bg-secondary px-1 rounded">{k.trim()}</span>
                            ))}
                          </div>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => { setEditingWorld(ws); setShowWorldForm(true) }}
                            className="text-xs text-primary hover:underline">编辑</button>
                          <button onClick={() => deleteWorld(ws)}
                            className="text-xs text-danger hover:underline">删除</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* 表单弹窗 */}
      {showCharForm && <CharForm initial={editingChar || undefined} />}
      {showWorldForm && <WorldForm initial={editingWorld || undefined} />}
    </div>
  )
}
