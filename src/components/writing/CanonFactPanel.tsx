import { useState, useEffect, useCallback } from 'react'
import { showToast } from '../common/Toast'
import { CANON_EXTRACTION_SYSTEM, CANON_EXTRACTION_USER } from '../../services/generator'
import type { CanonFact, FactCategory } from '../../types'

const CATEGORY_LABELS: Record<FactCategory, string> = {
  character: '👤 角色', setting: '🌍 设定', timeline: '⏱ 时间线',
  rule: '📏 规则', relationship: '🔗 关系', event: '📖 事件'
}

interface Props {
  projectId: number
  outlineContent?: string
}

export default function CanonFactPanel({ projectId, outlineContent }: Props) {
  const [facts, setFacts] = useState<CanonFact[]>([])
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState(false)
  const [catFilter, setCatFilter] = useState<FactCategory | ''>('')
  const [showAdd, setShowAdd] = useState(false)
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [newCat, setNewCat] = useState<FactCategory>('setting')
  const [newHard, setNewHard] = useState(false)

  const loadFacts = useCallback(async () => {
    if (!window.electronAPI) return
    setLoading(true)
    try {
      const rows = await window.electronAPI.db.query(
        'SELECT * FROM canon_facts WHERE project_id = ? ORDER BY fact_category, fact_key',
        [projectId]
      )
      setFacts(rows)
    } catch { }
    finally { setLoading(false) }
  }, [projectId])

  useEffect(() => { loadFacts() }, [loadFacts])

  const handleExtractFromOutline = async () => {
    if (!outlineContent || !window.electronAPI) {
      showToast('error', '请先生成大纲')
      return
    }
    setExtracting(true)
    try {
      // 先清除旧事实（保留手动添加的）
      await window.electronAPI.db.run(
        'DELETE FROM canon_facts WHERE project_id = ? AND source = ?',
        [projectId, '大纲']
      )
      const messages = [
        { role: 'system' as const, content: CANON_EXTRACTION_SYSTEM },
        { role: 'user' as const, content: CANON_EXTRACTION_USER(outlineContent) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '事实簿提取')
      const clean = reply.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const jm = clean.match(/\[[\s\S]*\]/)
      if (!jm) { showToast('error', 'AI 返回格式异常，请重试'); return }
      const arr = JSON.parse(jm[0])
      for (const f of arr) {
        await window.electronAPI.db.run(
          `INSERT INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source, established_chapter)
           VALUES (?, ?, ?, ?, ?, '大纲', 0)`,
          [projectId, f.fact_category, f.fact_key, f.fact_value, f.is_hard_rule ? 1 : 0]
        )
      }
      showToast('success', `已提取 ${arr.length} 条核心事实`)
      loadFacts()
    } catch (e: any) {
      showToast('error', '提取失败：' + (e.message || '未知错误'))
    } finally {
      setExtracting(false)
    }
  }

  const addFact = async () => {
    if (!newKey.trim() || !newValue.trim()) { showToast('error', '请填写事实名和事实值'); return }
    await window.electronAPI?.db.run(
      `INSERT INTO canon_facts (project_id, fact_category, fact_key, fact_value, is_hard_rule, source)
       VALUES (?, ?, ?, ?, ?, '手动添加')`,
      [projectId, newCat, newKey.trim(), newValue.trim(), newHard ? 1 : 0]
    )
    setShowAdd(false); setNewKey(''); setNewValue(''); setNewHard(false)
    showToast('success', '已添加')
    loadFacts()
  }

  const toggleHardRule = async (fact: CanonFact) => {
    const newVal = fact.is_hard_rule ? 0 : 1
    await window.electronAPI?.db.run(
      'UPDATE canon_facts SET is_hard_rule = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?',
      [newVal, fact.id]
    )
    loadFacts()
  }

  const deleteFact = async (id: number) => {
    await window.electronAPI?.db.run('DELETE FROM canon_facts WHERE id = ?', [id])
    loadFacts()
  }

  const filtered = catFilter ? facts.filter(f => f.fact_category === catFilter) : facts
  const hardCount = facts.filter(f => f.is_hard_rule).length

  return (
    <div className="h-full overflow-auto">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-bg-secondary border-b border-border flex-wrap">
        <span className="text-sm text-text-main font-medium">📖 事实簿</span>
        <span className="text-xs text-text-secondary">{facts.length}条 · {hardCount}硬规则</span>
        <div className="flex-1" />
        <button onClick={() => setShowAdd(!showAdd)}
          className="px-2 py-0.5 text-xs border border-primary text-primary rounded hover:bg-primary/5 transition-colors"
        >+ 手动添加</button>
        <button onClick={handleExtractFromOutline} disabled={extracting || !outlineContent}
          className="px-2 py-0.5 text-xs bg-primary text-white rounded hover:bg-primary-hover disabled:opacity-50 transition-colors"
        >{extracting ? '⏳ 提取中...' : '🔄 从大纲提取'}</button>
      </div>

      {showAdd && (
        <div className="px-4 py-2 border-b border-border bg-bg-secondary/30 space-y-2">
          <div className="flex gap-2">
            <select value={newCat} onChange={e => setNewCat(e.target.value as FactCategory)}
              className="text-xs border border-border-input rounded px-1.5 py-1"
            >
              {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <input value={newKey} onChange={e => setNewKey(e.target.value)}
              placeholder="事实名（如：主角姓名）" autoFocus
              className="flex-1 text-xs border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
          </div>
          <div className="flex gap-2">
            <input value={newValue} onChange={e => setNewValue(e.target.value)}
              placeholder="事实值（如：林辰）"
              className="flex-1 text-xs border border-border-input rounded px-2 py-1 focus:outline-none focus:border-primary" />
            <label className="flex items-center gap-1 text-xs text-text-secondary whitespace-nowrap">
              <input type="checkbox" checked={newHard} onChange={e => setNewHard(e.target.checked)} />
              硬规则
            </label>
            <button onClick={addFact} className="px-3 py-1 text-xs bg-primary text-white rounded">保存</button>
          </div>
        </div>
      )}

      <div className="flex gap-1 px-4 py-2 border-b border-border">
        {(['', 'character', 'setting', 'rule', 'relationship', 'event', 'timeline'] as const).map(c => (
          <button key={c} onClick={() => setCatFilter(c as FactCategory | '')}
            className={`px-1.5 py-0.5 text-xs rounded transition-colors ${
              catFilter === c ? 'bg-primary text-white' : 'text-text-secondary hover:bg-bg-secondary'
            }`}
          >{c === '' ? '全部' : CATEGORY_LABELS[c as FactCategory]}</button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-text-secondary text-sm">
          {facts.length === 0 ? '暂无事实簿数据，请先生成大纲然后点击「从大纲提取」' : '没有匹配的事实'}
        </div>
      ) : (
        <div className="divide-y divide-border">
          {filtered.map(f => (
            <div key={f.id} className="px-4 py-2.5 hover:bg-bg-secondary/30 transition-colors flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs text-text-placeholder">{CATEGORY_LABELS[f.fact_category as FactCategory] || f.fact_category}</span>
                  <span className="text-xs text-text-main font-medium truncate">{f.fact_key}</span>
                  {f.is_hard_rule ? (
                    <span className="px-1 py-0 rounded text-xs bg-red-100 text-red-700" title="硬规则 — 不可违反">S1</span>
                  ) : (
                    <span className="px-1 py-0 rounded text-xs bg-gray-100 text-gray-500" title="软设定">软</span>
                  )}
                  <span className="text-xs text-text-placeholder">{f.source}</span>
                </div>
                <p className="text-xs text-text-secondary">{f.fact_value}</p>
                {f.established_chapter != null && (
                  <span className="text-xs text-text-placeholder">📍 第{f.established_chapter}章确立</span>
                )}
              </div>
              <div className="flex gap-1 ml-2">
                <button onClick={() => toggleHardRule(f)}
                  className="text-xs px-1.5 py-0.5 rounded border border-border-input hover:bg-bg-secondary transition-colors"
                  title={f.is_hard_rule ? '降为软设定' : '升为硬规则'}
                >{f.is_hard_rule ? '🔓' : '🔒'}</button>
                <button onClick={() => deleteFact(f.id)}
                  className="text-xs px-1.5 py-0.5 rounded border border-border-input hover:bg-red-50 text-text-placeholder hover:text-danger transition-colors"
                >🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
