import { useState, useEffect } from 'react'
import * as trackerService from '../../services/trackerService'

interface Props {
  projectId: number
  volumes: Array<{
    volume_number: number
    title: string
    chapter_range: [number, number]
  }>
  refreshKey?: number
}

export default function CheckReportPanel({ projectId, volumes, refreshKey }: Props) {
  const [reports, setReports] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedVol, setSelectedVol] = useState<number>(0)

  const loadReports = async () => {
    setLoading(true)
    try {
      const all = await trackerService.getCheckReports(projectId)
      setReports(all)
      // 自动选中最新的卷
      if (all.length > 0 && selectedVol === 0) {
        setSelectedVol(all[all.length - 1].volume_number)
      }
    } catch {}
    setLoading(false)
  }

  // 每次 refreshKey / volumes 变化时重载
  useEffect(() => { loadReports() }, [projectId, refreshKey, volumes.length])

  // 自动选中最新卷
  useEffect(() => {
    if (volumes.length > 0) {
      setSelectedVol(volumes[volumes.length - 1].volume_number)
    }
  }, [volumes.length])

  const handleRunCheck = async (volNum: number) => {
    const vol = volumes.find(v => v.volume_number === volNum)
    if (!vol) return
    setLoading(true)
    try {
      const chNums: number[] = []
      for (let cn = vol.chapter_range[0]; cn <= vol.chapter_range[1]; cn++) chNums.push(cn)
      await trackerService.runVolumeCheck(projectId, volNum, chNums)
      await loadReports()
    } catch {}
    setLoading(false)
  }

  const selectedReport = selectedVol ? reports.find((r: any) => r.volume_number === selectedVol) : null

  return (
    <div className="h-full flex flex-col bg-white text-xs">
      {/* 卷选择器 */}
      <div className="shrink-0 p-2 border-b border-border flex gap-1 flex-wrap">
        {volumes.map(v => (
          <button key={v.volume_number}
            onClick={() => setSelectedVol(v.volume_number)}
            className={`px-2 py-0.5 rounded text-xxs ${selectedVol === v.volume_number ? 'bg-primary text-white' : 'bg-bg-secondary text-text-secondary hover:bg-primary/10'}`}
          >
            卷{v.volume_number}
          </button>
        ))}
        {selectedVol > 0 && (
          <button onClick={() => handleRunCheck(selectedVol)}
            disabled={loading}
            className="ml-auto px-2 py-0.5 rounded text-xxs bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {loading ? '检查中...' : '运行检查'}
          </button>
        )}
      </div>

      {/* 报告内容 */}
      <div className="flex-1 overflow-auto p-2">
        {!selectedReport ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-xs text-text-placeholder">
              {volumes.length === 0 ? '暂无卷数据' : '选择卷后点击"运行检查"生成报告'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {/* 总分 */}
            <div className="flex items-center gap-2">
              <span className={`text-lg font-bold ${selectedReport.score >= 80 ? 'text-success' : selectedReport.score >= 60 ? 'text-warning' : 'text-danger'}`}>
                {selectedReport.score ?? '-'}分
              </span>
              <span className="text-xxs text-text-placeholder">
                检查于 {new Date(selectedReport.checked_at).toLocaleString('zh-CN')}
              </span>
            </div>

            {/* 角色偏差 */}
            {selectedReport.character_deviations?.length > 0 && (
              <div>
                <h4 className="font-semibold text-text-main mb-1">角色弧线偏差</h4>
                {selectedReport.character_deviations.map((d: any, i: number) => (
                  <div key={i} className="p-2 bg-danger/5 border border-danger/20 rounded mb-1">
                    <span className="font-medium">{d.key}</span>
                    <span className="text-text-placeholder">.{d.field}: </span>
                    <span className="text-danger">预期 {JSON.stringify(d.expected)}</span>
                    <span className="text-text-placeholder"> → 实际 </span>
                    <span className="text-warning">{JSON.stringify(d.actual)}</span>
                    {d.delta && <span className="text-text-placeholder ml-1">(delta: {d.delta})</span>}
                  </div>
                ))}
              </div>
            )}

            {/* 事件偏差 */}
            {selectedReport.event_deviations?.length > 0 && (
              <div>
                <h4 className="font-semibold text-text-main mb-1">事件推进偏差</h4>
                {selectedReport.event_deviations.map((d: any, i: number) => (
                  <div key={i} className="p-2 bg-danger/5 border border-danger/20 rounded mb-1">
                    <span className="font-medium">{d.key}</span>
                    <span className="text-text-placeholder">.{d.field}: </span>
                    <span className="text-danger">预期 {JSON.stringify(d.expected)}</span>
                    <span className="text-text-placeholder"> → 实际 {JSON.stringify(d.actual)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 规则违规 */}
            {selectedReport.rule_violations?.length > 0 && (
              <div>
                <h4 className="font-semibold text-text-main mb-1">迁移规则违规</h4>
                {selectedReport.rule_violations.map((v: any, i: number) => (
                  <div key={i} className="p-2 bg-danger/5 border border-danger/20 rounded mb-1">
                    <span className="font-medium">{v.key}</span>
                    <span className="text-text-placeholder">: {v.rule}</span>
                    <div className="text-text-secondary text-xxs">{v.detail}</div>
                  </div>
                ))}
              </div>
            )}

            {/* 伏笔状态 */}
            {selectedReport.foreshadow_status && (
              <div>
                <h4 className="font-semibold text-text-main mb-1">伏笔统计</h4>
                <div className="flex gap-3 text-xxs">
                  <span>总计: {selectedReport.foreshadow_status.total}</span>
                  <span className="text-success">已回收: {selectedReport.foreshadow_status.resolved}</span>
                  <span className="text-danger">逾期: {selectedReport.foreshadow_status.overdue}</span>
                  {selectedReport.foreshadow_status.recovery_rate != null && (
                    <span>回收率: {(selectedReport.foreshadow_status.recovery_rate * 100).toFixed(0)}%</span>
                  )}
                </div>
              </div>
            )}

            {/* 全部通过 */}
            {(!selectedReport.character_deviations?.length && !selectedReport.event_deviations?.length && !selectedReport.rule_violations?.length) && (
              <div className="p-3 text-center text-success font-medium">
                本卷所有检查通过
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
