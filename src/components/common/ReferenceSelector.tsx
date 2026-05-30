import { useState, useEffect } from 'react'
import type { StyleLibrary } from '../../types'
import type { DisassemblyProject } from '../../store/disassemblyStore'

interface ReferenceSelectorProps {
  /** 当前已选的主风格库 ID */
  primaryStyleId: number | null
  /** 当前已选的辅风格库 ID 列表 */
  auxiliaryStyleIds: number[]
  /** 当前已选的拆文库 ID 列表 */
  disassemblyIds: number[]
  /** 变更回调 */
  onChange: (refs: {
    primaryStyleId: number | null
    auxiliaryStyleIds: number[]
    disassemblyIds: number[]
  }) => void
  /** 是否显示设置按钮 */
  collapsed?: boolean
}

export default function ReferenceSelector({
  primaryStyleId, auxiliaryStyleIds, disassemblyIds, onChange, collapsed: initialCollapsed,
}: ReferenceSelectorProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed ?? true)
  const [styleLibraries, setStyleLibraries] = useState<StyleLibrary[]>([])
  const [disassemblies, setDisassemblies] = useState<DisassemblyProject[]>([])

  useEffect(() => {
    const load = async () => {
      if (window.electronAPI) {
        const libs = await window.electronAPI.db.query('SELECT * FROM style_libraries ORDER BY created_at DESC')
        setStyleLibraries(libs.map((l: any) => ({
          ...l, style_profile: typeof l.style_profile === 'string' ? JSON.parse(l.style_profile) : l.style_profile,
        })))

        const diss = await window.electronAPI.db.query('SELECT * FROM disassembly_projects ORDER BY updated_at DESC')
        setDisassemblies(diss)
      }
    }
    load()
  }, [])

  const toggleAuxStyle = (id: number) => {
    const next = auxiliaryStyleIds.includes(id)
      ? auxiliaryStyleIds.filter(s => s !== id)
      : [...auxiliaryStyleIds, id]
    onChange({ primaryStyleId, auxiliaryStyleIds: next, disassemblyIds })
  }

  const toggleDisassembly = (id: number) => {
    const next = disassemblyIds.includes(id)
      ? disassemblyIds.filter(d => d !== id)
      : [...disassemblyIds, id]
    onChange({ primaryStyleId, auxiliaryStyleIds, disassemblyIds: next })
  }

  const setPrimaryStyle = (id: number | null) => {
    onChange({
      primaryStyleId: primaryStyleId === id ? null : id,
      auxiliaryStyleIds: id ? auxiliaryStyleIds.filter(s => s !== id) : auxiliaryStyleIds,
      disassemblyIds,
    })
  }

  const hasRefs = primaryStyleId || auxiliaryStyleIds.length > 0 || disassemblyIds.length > 0
  const primaryName = styleLibraries.find(l => l.id === primaryStyleId)?.name

  return (
    <div className="bg-white rounded-card border border-border overflow-hidden mb-4">
      {/* 折叠栏 */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-bg-secondary transition-colors"
      >
        <div className="flex items-center gap-2 text-body">
          <span>📖</span>
          <span className="text-text-main">写作参考</span>
          {hasRefs && !collapsed && (
            <span className="text-caption text-text-secondary">
              （已选 {[primaryStyleId, ...auxiliaryStyleIds].filter(Boolean).length + disassemblyIds.length} 项）
            </span>
          )}
        </div>
        <span className="text-caption text-text-secondary">
          {collapsed ? (
            <span>
              {hasRefs ? (
                <span className="text-primary">
                  主风格：{primaryName || '无'} | 共 {[primaryStyleId, ...auxiliaryStyleIds].filter(Boolean).length + disassemblyIds.length} 项参考
                </span>
              ) : (
                <span className="text-text-placeholder">未选择参考 → 点击展开</span>
              )}
            </span>
          ) : '▲ 收起'}
        </span>
      </button>

      {!collapsed && (
        <div className="px-4 py-3 border-t border-border space-y-4">
          {/* 风格库 */}
          <div>
            <h4 className="text-caption font-medium text-text-secondary mb-2">🎨 风格库（左右AI写作风格）</h4>
            {styleLibraries.length === 0 ? (
              <p className="text-caption text-text-placeholder">暂无风格库，先去「风格库」页面导入小说创建</p>
            ) : (
              <div className="space-y-1">
                  {styleLibraries.map(lib => {
                    const isPrimary = primaryStyleId === lib.id
                    return (
                    <div key={lib.id} className="flex items-center gap-2 py-1">
                      <span className="text-body text-text-main flex-1">{lib.name}</span>
                      <input
                        type="checkbox"
                        checked={isPrimary}
                        onChange={() => setPrimaryStyle(isPrimary ? null : lib.id)}
                        className="accent-primary"
                      />
                      <span className="text-caption text-text-placeholder">主风格</span>
                      <input
                        type="checkbox"
                        checked={auxiliaryStyleIds.includes(lib.id)}
                        onChange={() => {
                          if (isPrimary) setPrimaryStyle(null)
                          toggleAuxStyle(lib.id)
                        }}
                        className="accent-primary ml-2"
                      />
                      <span className="text-caption text-text-placeholder">辅风格</span>
                    </div>
                  )})}
                </div>
              )}
              <p className="text-caption text-text-placeholder mt-1">
                ☑ 主风格（单选）：AI 写作时以该风格为基调 &nbsp; ☑ 辅风格（多选）：作为点缀参考
              </p>
          </div>

          {/* 拆文库 */}
          <div>
            <h4 className="text-caption font-medium text-text-secondary mb-2">🔬 拆文库（AI 学习爆款套路和结构）</h4>
            {disassemblies.length === 0 ? (
              <p className="text-caption text-text-placeholder">暂无拆解项目，先去「拆文库」页面导入小说拆解</p>
            ) : (
              <div className="space-y-1">
                {disassemblies.map(d => (
                  <label key={d.id} className="flex items-center gap-2 py-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={disassemblyIds.includes(d.id)}
                      onChange={() => toggleDisassembly(d.id)}
                      className="accent-primary"
                    />
                    <span className="text-body text-text-main flex-1">{d.name}</span>
                    <span className="text-caption text-text-placeholder">
                      {d.current_stage >= 1 ? '已拆解' : '待拆解'}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-caption text-text-placeholder mt-1">
              ☑ 选中后，AI 会学习该书的黄金三章、人物设定、爽点套路和文风特征
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

/** 构建供 AI 使用的参考上下文文本 */
export function buildReferenceContext(
  primaryStyleId: number | null,
  auxiliaryStyleIds: number[],
  disassemblyIds: number[],
  styleLibraries: StyleLibrary[],
  disassemblies: DisassemblyProject[]
): { styleContext: string; disassemblyContext: string } {
  let styleContext = ''
  let disassemblyContext = ''

  // 风格上下文
  const allStyleIds = [primaryStyleId, ...auxiliaryStyleIds].filter(Boolean) as number[]
  const styles = styleLibraries.filter(l => allStyleIds.includes(l.id))
  if (styles.length > 0) {
    styleContext = styles.map((s, i) => {
      const p = s.style_profile
      const isPrimary = s.id === primaryStyleId
      return `${isPrimary ? '【主风格】' : '【辅风格】'}${s.name}
叙事视角：${p?.writing_style?.narrative_perspective || '未知'}
句式特点：${p?.writing_style?.sentence_characteristics || '未知'}
段落配比：${p?.writing_style?.paragraph_ratio || '未分析'}
语言特点：${p?.language_features?.vocabulary_preference || '未知'}，${p?.language_features?.colloquial_level || ''}
氛围基调：${p?.atmosphere?.primary || '未知'} / ${p?.atmosphere?.emotional_tone || ''}
${p?.raw_analysis ? '综合分析：' + p.raw_analysis.slice(0, 500) : ''}`
    }).join('\n\n')
  }

  // 拆文上下文
  const diss = disassemblies.filter(d => disassemblyIds.includes(d.id))
  if (diss.length > 0) {
    disassemblyContext = diss.map(d => {
      const results = JSON.parse(d.stage_results || '{}')
      const parts: string[] = [`【参考书】${d.name}`]

      if (results.stage0) {
        parts.push(`概要：${typeof results.stage0 === 'string' ? results.stage0.slice(0, 300) : JSON.stringify(results.stage0).slice(0, 300)}`)
      }
      if (results.stage1) {
        parts.push(`黄金三章分析：${typeof results.stage1 === 'string' ? results.stage1.slice(0, 500) : JSON.stringify(results.stage1).slice(0, 500)}`)
      }
      if (results.stage4) {
        parts.push(`文风特征：${typeof results.stage4 === 'string' ? results.stage4.slice(0, 400) : JSON.stringify(results.stage4).slice(0, 400)}`)
      }

      return parts.join('\n')
    }).join('\n\n---\n\n')
  }

  return { styleContext, disassemblyContext }
}
