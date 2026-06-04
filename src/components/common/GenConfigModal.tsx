import { useState, useEffect } from 'react'
import type { StyleLibrary } from '../../types'
import type { DisassemblyProject } from '../../store/disassemblyStore'

interface GenConfigModalProps {
  open: boolean
  title: string
  desc: string
  onClose: () => void
  onConfirm: (config: { primaryStyleId: number | null; auxIds: number[]; dissIds: number[] }) => void
}

export default function GenConfigModal({ open, title, desc, onClose, onConfirm }: GenConfigModalProps) {
  const [styleLibraries, setStyleLibraries] = useState<StyleLibrary[]>([])
  const [disassemblies, setDisassemblies] = useState<DisassemblyProject[]>([])

  const [primaryStyleId, setPrimaryStyleId] = useState<number | null>(null)
  const [auxIds, setAuxIds] = useState<number[]>([])
  const [dissIds, setDissIds] = useState<number[]>([])

  useEffect(() => {
    if (!open) return
    const load = async () => {
      if (window.electronAPI) {
        const libs = await window.electronAPI.db.query('SELECT * FROM style_libraries ORDER BY created_at DESC')
        setStyleLibraries(libs.map((l: any) => ({ ...l, style_profile: typeof l.style_profile === 'string' ? JSON.parse(l.style_profile) : l.style_profile })))
        const diss = await window.electronAPI.db.query('SELECT * FROM disassembly_projects WHERE current_stage >= 1 ORDER BY updated_at DESC')
        setDisassemblies(diss)
      }
    }
    load()
  }, [open])

  const toggleAux = (id: number) => setAuxIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const toggleDiss = (id: number) => setDissIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-card shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-lg">{title}</h2>
          <button onClick={onClose} className="text-text-placeholder hover:text-text-main">✕</button>
        </div>

        <div className="px-5 py-3 space-y-3 max-h-[60vh] overflow-auto">
          <p className="text-xs text-text-secondary">{desc}</p>

          {/* 风格库 */}
          <div>
            <h4 className="text-xs font-medium text-text-main mb-1.5">🎨 选择风格库</h4>
            {styleLibraries.length === 0 ? (
              <p className="text-xs text-text-placeholder">暂无风格库</p>
            ) : (
              <div className="space-y-1">
                {styleLibraries.map(lib => (
                  <label key={lib.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="radio" name="primaryStyle" checked={primaryStyleId === lib.id}
                      onChange={() => setPrimaryStyleId(primaryStyleId === lib.id ? null : lib.id)} className="accent-primary" />
                    <span className="flex-1">{lib.name}</span>
                    <input type="checkbox" checked={auxIds.includes(lib.id)}
                      onChange={() => toggleAux(lib.id)} disabled={primaryStyleId === lib.id}
                      className="accent-primary" />
                    <span className="text-text-placeholder w-10">辅风格</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 拆文库 */}
          <div>
            <h4 className="text-xs font-medium text-text-main mb-1.5">📚 选择拆文库参考</h4>
            {disassemblies.length === 0 ? (
              <p className="text-xs text-text-placeholder">暂无已拆解的小说</p>
            ) : (
              <div className="space-y-1">
                {disassemblies.map(d => (
                  <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={dissIds.includes(d.id)}
                      onChange={() => toggleDiss(d.id)} className="accent-primary" />
                    <span>{d.name}</span>
                    <span className="text-text-placeholder">拆至 Stage {d.current_stage}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs border border-border-input rounded-btn text-text-secondary hover:bg-bg-secondary">取消</button>
          <button onClick={() => { onConfirm({ primaryStyleId, auxIds, dissIds }) }}
            className="px-4 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
            🤖 确定生成
          </button>
        </div>
      </div>
    </div>
  )
}
