import { useState, useMemo } from 'react'
import { showToast } from '../common/Toast'
import type { Chapter } from '../../types'
import type { CheckResult, NormalizedLeakScore, EventExtractionResult } from '../../services/checker'

// ===== 本地类型 =====

interface SuggestedAction {
  text: string
  target_chapter: number | null
  executable: false
}

interface NarrativeReport {
  narrative_state: string
  pacing: string
  characters: string
  risk: string
  suggested_actions: SuggestedAction[]
}

interface CrossLayerHint {
  type: 'event_leak' | 'violation_event' | 'foreshadowing_stale'
  severity: 'info' | 'warning'
  message: string
}

interface Props {
  // ── 机器运行层数据（纯渲染） ──
  lastCheckResult: CheckResult | null
  lastLeakScore: NormalizedLeakScore | null
  lastEventData: EventExtractionResult | null
  calibrationStats: { chapters: number; mean: number; std: number } | null

  // ── 叙事报告（AI 生成） ──
  narrativeReport: NarrativeReport | null
  narrativeReportLoading: boolean
  onGenerateReport: () => void
  onCancel: () => void

  // ── 跨层关联数据 ──
  chapters: Chapter[]
  foreshadowingItems: { foreshadow_id: string; status: string; target_chapter: number | null }[]
  currentChapter: number

  // ── 手动干预 ──
  fixingChapter: number | null
  autoFixChapter: (ch: number, issues: string[], prompt: string) => void
  onInjectHint: (text: string) => void
}

// ===== 跨层关联推导（纯计算，不调 AI） =====

function computeCrossLayerHints(
  checkResult: CheckResult | null,
  eventData: EventExtractionResult | null,
  foreshadowingItems: Props['foreshadowingItems'],
  currentChapter: number,
): CrossLayerHint[] {
  const hints: CrossLayerHint[] = []

  // event → leak: reveal 事件数 vs 信息配额
  if (eventData && checkResult?.leakScore) {
    const revealCount = eventData.events.filter(e => e.event_type === 'reveal').length
    const revealBudget = eventData.reveal_estimates?.world || 0
    if (revealCount > 2 && revealBudget > 20) {
      hints.push({
        type: 'event_leak',
        severity: revealCount > 4 ? 'warning' : 'info',
        message: `${revealCount} 个揭示事件，信息配额 world+${revealBudget}%。揭示密度偏高。`,
      })
    }
  }

  // violation → event 关联
  if (checkResult && eventData) {
    for (const v of checkResult.violations.filter(v => v.paragraphIndex != null)) {
      const nearbyEvent = eventData.events.find(e =>
        Math.abs((e.absolute_day_offset || 0) - (v.paragraphIndex || 0)) < 5
      )
      if (nearbyEvent) {
        hints.push({
          type: 'violation_event',
          severity: 'warning',
          message: `违规"${v.detail.slice(0, 40)}..."可能与事件"${nearbyEvent.subject}${nearbyEvent.action}"相关`,
        })
        break // only the first match
      }
    }
  }

  // 伏笔逾期
  for (const f of foreshadowingItems) {
    if (f.status === 'active' && f.target_chapter != null && f.target_chapter < currentChapter) {
      hints.push({
        type: 'foreshadowing_stale',
        severity: 'warning',
        message: `伏笔 ${f.foreshadow_id} 应在第${f.target_chapter}章回收，当前已逾期`,
      })
    }
  }

  return hints
}

// ===== 组件 =====

export default function ReviewPanel({
  lastCheckResult, lastLeakScore, lastEventData, calibrationStats,
  narrativeReport, narrativeReportLoading, onGenerateReport, onCancel,
  chapters, foreshadowingItems, currentChapter,
  fixingChapter, autoFixChapter, onInjectHint,
}: Props) {
  const [editFixTarget, setEditFixTarget] = useState<number | null>(null)
  const [editFixText, setEditFixText] = useState('')

  const crossLayerHints = useMemo(
    () => computeCrossLayerHints(lastCheckResult, lastEventData, foreshadowingItems, currentChapter),
    [lastCheckResult, lastEventData, foreshadowingItems, currentChapter],
  )

  // ── Threshold badge ──
  function thresholdBadge(t: string) {
    const colors: Record<string, string> = {
      safe: 'bg-green-100 text-green-700', watch: 'bg-blue-100 text-blue-700',
      elevated: 'bg-yellow-100 text-yellow-700', critical: 'bg-red-100 text-red-700',
    }
    return <span className={`text-xxs px-1.5 py-0 rounded-full ${colors[t] || 'bg-gray-100'}`}>{t}</span>
  }

  return (
    <div className="p-3 overflow-auto flex-1 space-y-3">

      {/* ═══════════ ② Constraint Health (from Checker) ═══════════ */}
      <section className="bg-white rounded-card border border-border p-3">
        <h3 className="text-xs font-medium text-text-main mb-2">📊 约束健康度</h3>
        {!lastCheckResult ? (
          <p className="text-xxs text-text-placeholder">生成章节后自动更新</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-text-secondary">硬违规</span>
              <span className={lastCheckResult.hardViolationCount > 0 ? 'text-danger font-medium' : 'text-success'}>
                {lastCheckResult.hardViolationCount === 0 ? '✓ 0' : `✗ ${lastCheckResult.hardViolationCount}`}
              </span>
            </div>
            {lastCheckResult.violations.filter(v => v.source !== 'ai_suggestion').slice(0, 3).map((v, i) => (
              <div key={i} className="text-xxs text-text-placeholder pl-2 border-l-2 border-danger/30">
                [{v.type}] {v.detail.slice(0, 80)}
              </div>
            ))}
            {lastLeakScore && (
              <div className="flex justify-between">
                <span className="text-text-secondary">语义泄露</span>
                <span className="flex items-center gap-1">
                  <span className="text-text-main">z={lastLeakScore.z}</span>
                  {thresholdBadge(lastLeakScore.threshold)}
                </span>
              </div>
            )}
            {calibrationStats && (
              <div className="flex justify-between text-text-placeholder">
                <span>校准基线</span>
                <span>{calibrationStats.chapters}章 μ={calibrationStats.mean} σ={calibrationStats.std}</span>
              </div>
            )}
            {lastCheckResult.concerns.length > 0 && (
              <div className="mt-1 pt-1 border-t border-border">
                <span className="text-text-placeholder">AI 建议：</span>
                {lastCheckResult.concerns.slice(0, 2).map((c, i) => (
                  <div key={i} className="text-xxs text-text-placeholder pl-2">⚠ {c.detail.slice(0, 80)}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ═══════════ ③ Structural Overview (from Events) ═══════════ */}
      <section className="bg-white rounded-card border border-border p-3">
        <h3 className="text-xs font-medium text-text-main mb-2">🔬 结构纵览</h3>
        {!lastEventData ? (
          <p className="text-xxs text-text-placeholder">生成章节后自动更新</p>
        ) : (
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-text-secondary">事件总数</span>
              <span className="text-text-main">{lastEventData.events.length}</span>
            </div>
            <div className="flex gap-1 flex-wrap">
              {(['action', 'reveal', 'interaction', 'world_change', 'emotion_shift'] as const).map(t => {
                const count = lastEventData.events.filter(e => e.event_type === t).length
                if (count === 0) return null
                const labels: Record<string, string> = { action: '动作', reveal: '揭示', interaction: '互动', world_change: '世界观', emotion_shift: '情绪' }
                return <span key={t} className="text-xxs bg-bg-secondary px-1.5 py-0 rounded">{labels[t]}:{count}</span>
              })}
            </div>
            {lastEventData.reveal_estimates && (
              <div className="flex justify-between">
                <span className="text-text-secondary">信息推进</span>
                <span className="text-text-main">
                  world+{lastEventData.reveal_estimates.world}% plot+{lastEventData.reveal_estimates.plot}% char+{lastEventData.reveal_estimates.character}%
                </span>
              </div>
            )}
            <div className="flex justify-between text-text-placeholder">
              <span>活跃伏笔 / 已回收</span>
              <span>{foreshadowingItems.filter(f => f.status === 'active').length} / {foreshadowingItems.filter(f => f.status === 'done').length}</span>
            </div>
          </div>
        )}
      </section>

      {/* ═══════════ ③.5 Cross-Layer Correlation ═══════════ */}
      {crossLayerHints.length > 0 && (
        <section className="bg-white rounded-card border border-border p-3">
          <h3 className="text-xs font-medium text-text-main mb-2">🔗 跨层关联</h3>
          <div className="space-y-1">
            {crossLayerHints.map((h, i) => (
              <div key={i} className={`text-xxs px-2 py-1 rounded flex items-start gap-1.5 ${
                h.severity === 'warning' ? 'bg-yellow-50 text-yellow-700' : 'bg-blue-50 text-blue-700'
              }`}>
                <span className="shrink-0 mt-0.5">{h.severity === 'warning' ? '⚠' : 'ℹ'}</span>
                <span>{h.message}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ═══════════ ① + ④ AI 叙事报告 ═══════════ */}
      <section className="bg-white rounded-card border border-border p-3">
        <h3 className="text-xs font-medium text-text-main mb-2">🧭 叙事控制台</h3>

        {narrativeReportLoading ? (
          <div className="flex items-center gap-2 mb-2">
            <span className="flex-1 px-2 py-1.5 text-xs text-warning flex items-center gap-1">
              <div className="w-3 h-3 border-2 border-warning border-t-transparent rounded-full animate-spin" /> 生成报告中...
            </span>
            <button onClick={onCancel} className="px-2 py-1.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10">⏹</button>
          </div>
        ) : (
          <button onClick={onGenerateReport}
            className="w-full px-3 py-2 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover mb-2">
            🔍 生成叙事报告
          </button>
        )}

        {!narrativeReport && !narrativeReportLoading && (
          <p className="text-xxs text-text-placeholder text-center py-4">
            点击生成后，AI 将基于约束数据 + 事件数据 + 章节摘要，生成人类可读的叙事状态报告和策略建议。<br />
            <span className="text-text-placeholder/70">报告不评估好坏，只描述状态。建议仅用于 UI 展示，不进入自动重写流程。</span>
          </p>
        )}

        {narrativeReport && (
          <div className="space-y-2 text-xs">
            {/* ① 叙事状态 */}
            <details className="bg-bg-secondary/50 rounded p-2" open>
              <summary className="font-medium text-text-main cursor-pointer">📖 叙事状态</summary>
              <p className="mt-1 text-text-secondary leading-relaxed">{narrativeReport.narrative_state}</p>
            </details>
            <details className="bg-bg-secondary/50 rounded p-2">
              <summary className="font-medium text-text-main cursor-pointer">⏱ 节奏</summary>
              <p className="mt-1 text-text-secondary leading-relaxed">{narrativeReport.pacing}</p>
            </details>
            <details className="bg-bg-secondary/50 rounded p-2">
              <summary className="font-medium text-text-main cursor-pointer">👤 人物</summary>
              <p className="mt-1 text-text-secondary leading-relaxed">{narrativeReport.characters}</p>
            </details>
            <details className="bg-bg-secondary/50 rounded p-2">
              <summary className="font-medium text-text-main cursor-pointer">⚠ 风险</summary>
              <p className="mt-1 text-text-secondary leading-relaxed">{narrativeReport.risk}</p>
            </details>

            {/* ④ Suggested Actions */}
            {narrativeReport.suggested_actions.length > 0 && (
              <div className="mt-2 pt-2 border-t border-border">
                <h4 className="text-xs font-medium text-text-main mb-1.5 flex items-center gap-1">
                  💡 策略建议 <span className="text-xxs text-text-placeholder font-normal">(advisory only)</span>
                </h4>
                <div className="space-y-1.5">
                  {narrativeReport.suggested_actions.map((sa, i) => (
                    <div key={i} className="flex items-start gap-1.5 bg-yellow-50 rounded p-2">
                      <span className="text-xxs text-yellow-600 shrink-0 mt-0.5">💡</span>
                      <span className="text-xs text-text-secondary flex-1">{sa.text}</span>
                      <button onClick={() => onInjectHint(sa.text)}
                        className="text-xxs text-primary hover:underline shrink-0 mt-0.5"
                        title="复制到额外提示框">采纳</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ═══════════ ⑤ Manual Override ═══════════ */}
      <section className="bg-white rounded-card border border-border p-3">
        <h3 className="text-xs font-medium text-text-main mb-2">✋ 手动干预</h3>
        <p className="text-xxs text-text-placeholder mb-2">
          选择章节，编辑修改提示，执行精准修改。适合处理 AI 自动重写无法解决的复杂问题。
        </p>

        {chapters.length === 0 ? (
          <p className="text-xxs text-text-placeholder text-center py-2">暂无章节</p>
        ) : (
          <div className="space-y-2">
            <div className="flex gap-1 flex-wrap">
              {chapters.map(ch => (
                <button key={ch.chapter_number}
                  onClick={() => {
                    if (editFixTarget === ch.chapter_number) { setEditFixTarget(null); setEditFixText('') }
                    else { setEditFixTarget(ch.chapter_number); setEditFixText('') }
                  }}
                  className={`text-xxs px-2 py-1 rounded-btn border ${
                    editFixTarget === ch.chapter_number
                      ? 'border-primary text-primary bg-primary/5'
                      : 'border-border text-text-secondary hover:border-primary/50'
                  }`}>
                  第{ch.chapter_number}章
                </button>
              ))}
            </div>

            {editFixTarget != null && (
              <div className="space-y-1.5">
                <textarea value={editFixText}
                  onChange={e => setEditFixText(e.target.value)}
                  placeholder="输入修改提示，描述你要 AI 如何修改这一章..."
                  rows={3}
                  className="w-full px-2 py-1 text-xs border border-border-input rounded resize-none focus:outline-none focus:border-primary"
                />
                <div className="flex gap-2">
                  <button onClick={() => {
                    if (!editFixText.trim()) { showToast('error', '请输入修改提示'); return }
                    navigator.clipboard.writeText(editFixText).then(
                      () => showToast('success', '已复制，可粘贴到生成面板的额外提示框'),
                      () => showToast('error', '复制失败')
                    )
                  }} className="flex-1 px-2 py-1.5 text-xs border border-primary text-primary rounded-btn hover:bg-primary/5">
                    📋 复制
                  </button>
                  <button onClick={() => autoFixChapter(editFixTarget, [editFixText], editFixText)}
                    disabled={fixingChapter === editFixTarget || !editFixText.trim()}
                    className="flex-1 px-2 py-1.5 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50">
                    {fixingChapter === editFixTarget ? '⏳ 修改中...' : '🤖 执行修改'}
                  </button>
                  {fixingChapter === editFixTarget && (
                    <button onClick={onCancel} className="px-2 py-1.5 text-xs border border-danger text-danger rounded-btn hover:bg-danger/10 shrink-0">⏹</button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  )
}
