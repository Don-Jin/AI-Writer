import { useState, useRef, useEffect } from 'react'
import { showToast } from '../common/Toast'
import {
  localScan, deterministicFixParagraphs,
  buildBatchRewritePrompt, verifyParagraphRewrite,
  buildStyledRewriteSystem, DESLOP_REWRITE_USER,
  getEffectivePatterns, saveCustomBannedPatterns, DEFAULT_BANNED_PATTERNS, SENTENCE_PATTERNS,
  splitParagraphs, scoreParagraph, scoreAllParagraphs,
  type DeslopLocalReport, type BannedPattern, type ParagraphScore,
} from '../../services/deslop'

// ==================== State Machine ====================

type FixStatus =
  | 'unscanned'
  | 'scanned'
  | 'rule_fixed'
  | 'ai_rewritten'
  | 'verified_pass'
  | 'verified_fail'

interface ParagraphFixState {
  index: number
  originalText: string
  originalScore: number
  originalHits: string[]
  fixedText: string | null
  newScore: number | null
  status: FixStatus
}

// ==================== Props ====================

interface DeslopPanelProps {
  content: string
  onApply: (newContent: string) => void
  styleContext?: string
  personalityContext?: string
  onMarksChange?: (scores: ParagraphScore[], selected: Set<number>) => void
}

// ==================== Component ====================

export default function DeslopPanel({ content, onApply, styleContext, personalityContext, onMarksChange }: DeslopPanelProps) {
  // Core
  const [scanning, setScanning] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [report, setReport] = useState<DeslopLocalReport | null>(null)
  const [paraStates, setParaStates] = useState<ParagraphFixState[]>([])
  const [expanded, setExpanded] = useState(false)

  // Quick fix
  const [quickFixResult, setQuickFixResult] = useState<{
    text: string; replaced: { pattern: string; replacement: string; count: number }[]
  } | null>(null)

  // Full rewrite
  const [rewrittenText, setRewrittenText] = useState('')
  const [showCompare, setShowCompare] = useState(false)
  const [reScanReport, setReScanReport] = useState<DeslopLocalReport | null>(null)

  // Pattern editor
  const [showPatternEditor, setShowPatternEditor] = useState(false)

  const cancelledRef = useRef(false)
  const rewritingRef = useRef(false)

  useEffect(() => { rewritingRef.current = rewriting }, [rewriting])

  useEffect(() => {
    return () => {
      if (rewritingRef.current) window.electronAPI?.cancelAi()
    }
  }, [])

  // 展开规则编辑器时从 localStorage 重新加载（同步外部添加的规则）
  useEffect(() => {
    if (showPatternEditor) setPatterns(getEffectivePatterns())
  }, [showPatternEditor])

  const handleCancel = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
  }

  // ==================== Scan ====================

  const handleScan = async () => {
    if (!content.trim()) { showToast('error', '章节内容为空'); return }
    setScanning(true)
    setQuickFixResult(null)
    setRewrittenText('')
    setReScanReport(null)
    await new Promise(r => setTimeout(r, 400))

    const r = localScan(content)
    setReport(r)

    const allParas = splitParagraphs(content)
    const states: ParagraphFixState[] = allParas.map(p => {
      const { score, hits } = scoreParagraph(p.text)
      return {
        index: p.index,
        originalText: p.text,
        originalScore: score,
        originalHits: hits,
        fixedText: null,
        newScore: null,
        status: 'scanned' as FixStatus,
      }
    })
    setParaStates(states)
    setExpanded(true)
    setScanning(false)

    const badIndices = new Set(states.filter(s => s.originalScore > 0).map(s => s.index))
    onMarksChange?.(r.paragraphScores, badIndices)
  }

  // ==================== Mode 1: Quick Fix (rule-based) ====================

  const handleQuickFix = () => {
    const allParas = splitParagraphs(content)
    const { paragraphs: fixed, replaced } = deterministicFixParagraphs(allParas)

    if (replaced.length === 0) {
      showToast('info', '没有可自动替换的禁用词')
      return
    }

    const newText = fixed.map(p => p.text).join('\n\n')
    setQuickFixResult({ text: newText, replaced })

    setParaStates(prev => prev.map(s => {
      const fp = fixed.find(f => f.index === s.index)
      if (fp && fp.text !== s.originalText) {
        const { score, hits } = scoreParagraph(fp.text)
        return { ...s, fixedText: fp.text, newScore: score, originalHits: hits, status: 'rule_fixed' as FixStatus }
      }
      return s
    }))

    const totalChanges = replaced.reduce((sum, r) => sum + r.count, 0)
    showToast('success', `快速修复：${replaced.length} 种模式，${totalChanges} 处替换`)
  }

  const handleApplyQuickFix = () => {
    if (quickFixResult) {
      onApply(quickFixResult.text)
      showToast('success', '已应用快速修复')
      handleReset()
    }
  }

  // ==================== Mode 2: AI Batch Rewrite ====================

  const handleAiRewrite = async () => {
    const badParas = paraStates.filter(s => s.originalScore >= 3)
    if (badParas.length === 0) {
      showToast('info', '没有需要 AI 改写的段落（score≥3）')
      return
    }

    setRewriting(true)
    cancelledRef.current = false

    try {
      const systemPrompt = buildStyledRewriteSystem(styleContext, personalityContext)
      const BATCH_SIZE = 4
      const allBad = badParas.map(s => ({
        index: s.index,
        text: s.originalText,
        issues: s.originalHits,
      }))

      const updatedStates = [...paraStates]
      let totalPassed = 0
      let totalFailed = 0

      for (let batchStart = 0; batchStart < allBad.length; batchStart += BATCH_SIZE) {
        if (cancelledRef.current) break

        const batch = allBad.slice(batchStart, batchStart + BATCH_SIZE)
        const batchLabel = `AI改写 batch${Math.floor(batchStart / BATCH_SIZE) + 1}`
        const prompt = buildBatchRewritePrompt(batch)

        const messages = [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: prompt },
        ]

        const reply = await window.electronAPI!.aiChat(messages, batchLabel)
        if (cancelledRef.current) break

        const fixedParas = reply.split('[PARA_END]').map((s: string) => s.trim()).filter(Boolean)

        // Verify each paragraph in batch
        batch.forEach((bp, i) => {
          const stateIdx = updatedStates.findIndex(s => s.index === bp.index)
          if (stateIdx === -1) return

          if (i < fixedParas.length && fixedParas[i]) {
            const aiText = fixedParas[i]
            const integrity = verifyParagraphRewrite(bp.text, aiText)

            if (!integrity.changed) {
              // AI returned identical text
              updatedStates[stateIdx] = {
                ...updatedStates[stateIdx],
                fixedText: aiText,
                newScore: updatedStates[stateIdx].originalScore,
                status: 'verified_fail',
              }
              totalFailed++
            } else {
              const { score, hits } = scoreParagraph(aiText)
              const passed = score < updatedStates[stateIdx].originalScore
              updatedStates[stateIdx] = {
                ...updatedStates[stateIdx],
                fixedText: aiText,
                newScore: score,
                originalHits: hits,
                status: passed ? 'verified_pass' : 'verified_fail',
              }
              if (passed) totalPassed++
              else totalFailed++
            }
          } else {
            updatedStates[stateIdx] = { ...updatedStates[stateIdx], status: 'verified_fail' }
            totalFailed++
          }
        })

        setParaStates([...updatedStates])
      }

      if (cancelledRef.current) {
        showToast('info', '已取消 AI 改写')
      } else {
        showToast('success', `AI 改写：✅${totalPassed} 段通过 ❌${totalFailed} 段未修改`)
      }
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', 'AI 改写失败：' + (e.message || '未知错误'))
    } finally {
      setRewriting(false)
    }
  }

  const handleApplyAiFix = () => {
    const allParas = splitParagraphs(content)
    const merged = allParas.map(p => {
      const state = paraStates.find(s => s.index === p.index)
      if (state && state.status === 'verified_pass' && state.fixedText) return state.fixedText
      return p.text
    })
    const passCount = paraStates.filter(s => s.status === 'verified_pass').length
    onApply(merged.join('\n\n'))
    showToast('success', `已应用 ${passCount} 段 AI 修改`)
    handleReset()
  }

  // ==================== Mode 3: Full Rewrite (fallback) ====================

  const handleFullRewrite = async () => {
    if (!report) return
    setRewriting(true)
    cancelledRef.current = false

    try {
      const systemPrompt = buildStyledRewriteSystem(styleContext, personalityContext)
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: DESLOP_REWRITE_USER(content, report.severity, {
          styleContext, personalityContext,
          detectedPatterns: report.bannedHits.map(h => h.pattern),
        }) },
      ]

      const reply = await window.electronAPI!.aiChat(messages, '全文去AI味')
      if (cancelledRef.current) return

      setRewrittenText(reply)

      const newReport = localScan(reply)
      setReScanReport(newReport)

      const delta = report.totalBannedHits - newReport.totalBannedHits
      if (delta > 0) showToast('success', `全文改写完成，AI味 ↓${delta}`)
      else if (delta === 0) showToast('info', '全文改写完成，但 AI 味未减少——AI 可能未实际修改')
      else showToast('info', `⚠️ 改写后 AI 味反而增加 ${Math.abs(delta)} 处`)
    } catch (e: any) {
      if (!cancelledRef.current) showToast('error', '全文改写失败：' + (e.message || '未知错误'))
    } finally {
      setRewriting(false)
    }
  }

  const handleApplyFullRewrite = () => {
    if (rewrittenText) {
      onApply(rewrittenText)
      showToast('success', '已应用全文改写')
      handleReset()
    }
  }

  // ==================== Reset ====================

  const handleReset = () => {
    setReport(null); setParaStates([]); setExpanded(false)
    setQuickFixResult(null); setRewrittenText('')
    setReScanReport(null); setShowCompare(false)
  }

  // ==================== Pattern Management ====================

  // Use state to keep patterns stable across renders — NOT re-derived from localStorage each time
  const [patterns, setPatterns] = useState<BannedPattern[]>(() => getEffectivePatterns())

  const persistPatterns = (next: BannedPattern[]) => {
    saveCustomBannedPatterns(next)
    setPatterns(next)
  }

  const handleTogglePattern = (idx: number) => {
    setPatterns(prev => {
      const next = prev.map((p, i) => i === idx ? { ...p, enabled: !p.enabled } : p)
      saveCustomBannedPatterns(next)
      return next
    })
  }
  const handleAddPattern = () => {
    setPatterns(prev => {
      const next = [{ pattern: '新规则', replacement: '', category: '自定义', level: 2, enabled: true }, ...prev]
      saveCustomBannedPatterns(next)
      return next
    })
  }
  const handleUpdatePattern = (idx: number, field: keyof BannedPattern, value: string | number | boolean) => {
    setPatterns(prev => {
      const next = prev.map((p, i) => i === idx ? { ...p, [field]: value } : p)
      saveCustomBannedPatterns(next)
      return next
    })
  }
  const handleDeletePattern = (idx: number) => {
    setPatterns(prev => {
      const next = prev.filter((_, i) => i !== idx)
      saveCustomBannedPatterns(next)
      return next
    })
  }
  const handleResetPatterns = () => {
    const defaults = DEFAULT_BANNED_PATTERNS.map(p => ({ ...p, enabled: true }))
    saveCustomBannedPatterns([])
    setPatterns(defaults)
    showToast('success', '已恢复默认禁用词列表')
  }

  // ==================== UI Helpers ====================

  const severityColor: Record<string, string> = {
    '轻度': 'bg-success', '中度': 'bg-warning', '重度': 'bg-danger',
  }
  const severityBg: Record<string, string> = {
    '轻度': 'bg-success/10', '中度': 'bg-warning/10', '重度': 'bg-danger/10',
  }
  const levelColors: Record<number, string> = {
    1: 'bg-gray-200 text-gray-600', 2: 'bg-yellow-100 text-yellow-700',
    3: 'bg-orange-100 text-orange-700', 4: 'bg-red-100 text-red-700', 5: 'bg-red-200 text-red-800',
  }
  const statusMeta: Record<FixStatus, { icon: string; label: string; color: string }> = {
    unscanned:      { icon: '○',  label: '待扫描',  color: 'text-text-placeholder' },
    scanned:        { icon: '⏳', label: '待处理',  color: 'text-warning' },
    rule_fixed:     { icon: '🔧', label: '已替换',  color: 'text-primary' },
    ai_rewritten:   { icon: '🤖', label: 'AI已改写', color: 'text-primary' },
    verified_pass:  { icon: '✅', label: '已修复',  color: 'text-success' },
    verified_fail:  { icon: '❌', label: '未修改',  color: 'text-danger' },
  }

  const hasRewriteResult = !!(quickFixResult || rewrittenText || paraStates.some(s => s.status === 'verified_pass'))
  const verifiedCount = paraStates.filter(s => s.status === 'verified_pass').length
  const failedCount = paraStates.filter(s => s.status === 'verified_fail').length
  const ruleFixedCount = paraStates.filter(s => s.status === 'rule_fixed').length
  const totalProblemParas = paraStates.filter(s => s.originalScore > 0).length

  // ==================== Render ====================

  return (
    <div className="bg-white rounded-card border border-border overflow-hidden mb-4">
      {/* ===== Layer 1: Decision Bar ===== */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary border-b border-border">
        <div className="flex items-center gap-2 text-base min-w-0">
          <span className="shrink-0">🔍</span>
          <span className="text-text-main font-medium shrink-0">去AI味</span>
          {report && (
            <span className={`shrink-0 px-1.5 py-0.5 rounded text-xxs text-white ${severityColor[report.severity]}`}>
              {report.severity}
            </span>
          )}
          {report && (
            <span className="text-xs text-text-secondary truncate">
              {report.totalBannedHits}处 · {totalProblemParas}段有问题
            </span>
          )}
          {(styleContext || personalityContext) && (
            <span className="hidden sm:inline text-xs text-primary bg-primary-light px-1.5 py-0.5 rounded shrink-0">
              {[styleContext && '风格', personalityContext && '人格'].filter(Boolean).join('+')}
            </span>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          {!report && (
            <button onClick={handleScan} disabled={scanning || !content.trim()}
              className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50">
              {scanning ? '⏳ 扫描中...' : '开始扫描'}
            </button>
          )}

          {report && !hasRewriteResult && (
            <>
              <button onClick={handleReset}
                className="px-3 py-1 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary">
                取消
              </button>
              <button onClick={handleQuickFix} disabled={totalProblemParas === 0}
                className="px-3 py-1 text-xs bg-success text-white rounded-btn hover:bg-success/80 disabled:opacity-50"
                title="代码替换简单禁用词，100%可靠">
                🔧 快速修复
              </button>
              <button onClick={handleAiRewrite} disabled={rewriting || totalProblemParas === 0}
                className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50"
                title="只发送问题段落到AI，逐段验证">
                {rewriting ? '⏳ ...' : '🤖 AI改写'}
              </button>
              <button onClick={handleFullRewrite} disabled={rewriting}
                className="px-3 py-1 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light"
                title="全文发送AI改写（兜底方案）">
                📝 全文
              </button>
            </>
          )}

          {hasRewriteResult && (
            <>
              <button onClick={handleReset}
                className="px-3 py-1 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary">
                放弃
              </button>
              {quickFixResult && (
                <button onClick={handleApplyQuickFix}
                  className="px-3 py-1 text-xs bg-success text-white rounded-btn hover:bg-success/80">
                  ✅ 应用修复
                </button>
              )}
              {verifiedCount > 0 && !quickFixResult && (
                <button onClick={handleApplyAiFix}
                  className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
                  ✅ 应用({verifiedCount}段)
                </button>
              )}
              {rewrittenText && !quickFixResult && (
                <>
                  <button onClick={() => setShowCompare(!showCompare)}
                    className="px-3 py-1 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light">
                    {showCompare ? '只看结果' : '对比'}
                  </button>
                  <button onClick={handleApplyFullRewrite}
                    className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
                    ✅ 应用全文
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* ===== Layer 2: Execution Panel ===== */}
      {expanded && report && (
        <div className="px-4 py-3 space-y-3 border-b border-border">
          {/* Gates */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <GateBadge label="A 禁用词" ok={report.totalBannedHits <= 5} detail={`${report.totalBannedHits}处`} />
            <GateBadge label="B 句式" ok={report.sentencePatternHits.length === 0} detail={report.sentencePatternHits[0] || '正常'} />
            <GateBadge label="C 心理描写" ok={!report.hasTelling} detail={report.hasTelling ? '有告知' : '正常'} />
            <GateBadge label="D 节奏" ok={!report.hasUniformRhythm} detail={report.hasUniformRhythm ? '偏均匀' : '自然'} />
            <GateBadge label="E 对话" ok={report.bannedHits.filter(h => h.category === '对话').length <= 2} detail="需AI判断" />
            <GateBadge label="F 结尾" ok={true} detail="需AI判断" />
          </div>

          {/* Quick fix replacement list */}
          {quickFixResult && quickFixResult.replaced.length > 0 && (
            <div>
              <p className="text-xs text-text-secondary mb-1.5">🔧 代码替换清单：</p>
              <div className="flex flex-wrap gap-1.5">
                {quickFixResult.replaced.map((r, i) => (
                  <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-success/10 text-success">
                    "{r.pattern}" → "{r.replacement}" ×{r.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Paragraph states */}
          {paraStates.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1.5 text-xs text-text-secondary">
                <span>段落状态（{totalProblemParas} 段有问题）</span>
                {verifiedCount > 0 && <span className="text-success font-medium">✅{verifiedCount}</span>}
                {failedCount > 0 && <span className="text-danger font-medium">❌{failedCount}</span>}
                {ruleFixedCount > 0 && <span className="text-primary font-medium">🔧{ruleFixedCount}</span>}
              </div>
              <div className="space-y-1 max-h-64 overflow-auto">
                {paraStates
                  .filter(s => s.originalScore > 0 || s.status !== 'scanned')
                  .map((s) => {
                    const st = statusMeta[s.status]
                    const rowBg = s.status === 'verified_pass' ? 'bg-success/5' :
                      s.status === 'verified_fail' ? 'bg-danger/5' :
                      s.status === 'rule_fixed' ? 'bg-primary/5' : ''
                    const borderL = s.status === 'verified_pass' ? 'border-l-2 border-l-success' :
                      s.status === 'verified_fail' ? 'border-l-2 border-l-danger' : ''
                    return (
                      <div key={s.index} className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs ${borderL} ${rowBg}`}>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-text-main font-medium">第{s.index + 1}段</span>
                            {s.originalScore > 0 && (
                              <span className={`px-1 rounded text-xxs ${s.originalScore >= 8 ? 'bg-danger/10 text-danger' : s.originalScore >= 3 ? 'bg-warning/10 text-warning' : 'bg-gray-100 text-text-secondary'}`}>
                                ⭐{s.originalScore}
                              </span>
                            )}
                            {s.newScore != null && s.status === 'verified_pass' && (
                              <span className="px-1 rounded text-xxs bg-success/10 text-success">→{s.newScore}</span>
                            )}
                            {s.newScore != null && s.status === 'verified_fail' && (
                              <span className="px-1 rounded text-xxs bg-danger/10 text-danger">→{s.newScore}</span>
                            )}
                            <span className={`text-xxs ${st.color}`}>{st.icon} {st.label}</span>
                          </div>
                          {(s.status === 'scanned' || s.status === 'ai_rewritten') && s.originalHits.length > 0 && (
                            <div className="flex flex-wrap gap-0.5 mt-0.5">
                              {s.originalHits.slice(0, 5).map((h, i) => (
                                <span key={i} className="text-xxs px-1 py-0.5 rounded bg-danger/10 text-danger">{h}</span>
                              ))}
                              {s.originalHits.length > 5 && (
                                <span className="text-xxs text-text-placeholder">+{s.originalHits.length - 5}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {/* Banned hits summary (only before any fix) */}
          {report.bannedHits.length > 0 && !quickFixResult && !rewrittenText && (
            <div>
              <p className="text-xs text-text-secondary mb-1.5">禁用词详情：</p>
              <div className="flex flex-wrap gap-1">
                {report.bannedHits.map((h, i) => {
                  const alreadyExists = patterns.some(p => p.pattern === h.pattern)
                  return (
                    <span key={i} className="inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded bg-danger/10 text-danger" title={h.category}>
                      {h.pattern} ×{h.count}
                      {!alreadyExists && (
                        <button
                          onClick={() => {
                            const next = [...patterns, { pattern: h.pattern, replacement: '', category: h.category || '自定义', level: 2, enabled: true }]
                            saveCustomBannedPatterns(next)
                            setPatterns(next)
                            showToast('success', `已添加：${h.pattern}`)
                          }}
                          className="ml-0.5 text-xxs text-danger hover:bg-danger/20 rounded-full w-4 h-4 inline-flex items-center justify-center"
                          title="添加到禁用词列表">＋</button>
                      )}
                    </span>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Rewriting progress */}
      {rewriting && (
        <div className="flex items-center gap-3 px-4 py-6 justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-base text-text-secondary">AI 正在改写...</span>
          <button onClick={handleCancel}
            className="px-3 py-1 text-xs border border-danger text-danger rounded hover:bg-danger/10">取消</button>
        </div>
      )}

      {/* Full rewrite result display */}
      {rewrittenText && (
        <div className="px-4 py-3 border-b border-border">
          {showCompare ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-text-secondary mb-1 font-medium">📝 原文</p>
                <div className="text-xs text-text-main whitespace-pre-wrap max-h-80 overflow-auto bg-bg-secondary rounded p-2 leading-relaxed">
                  {content.slice(0, 2000)}{content.length > 2000 && '\n\n...'}
                </div>
              </div>
              <div>
                <p className="text-xs text-text-secondary mb-1 font-medium">✨ 改写后</p>
                <div className="text-xs text-text-main whitespace-pre-wrap max-h-80 overflow-auto bg-primary-light/20 rounded p-2 leading-relaxed">
                  {rewrittenText.slice(0, 2000)}{rewrittenText.length > 2000 && '\n\n...'}
                </div>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-text-secondary mb-1 font-medium">✨ 改写结果</p>
              <div className="text-sm text-text-main whitespace-pre-wrap max-h-96 overflow-auto rounded p-3 leading-relaxed bg-primary-light/10">
                {rewrittenText}
              </div>
            </div>
          )}

          {reScanReport && (
            <div className={`mt-2 flex items-center gap-2 text-xs px-2 py-1.5 rounded ${severityBg[reScanReport.severity]}`}>
              <span>🔄 改写后扫描：</span>
              <span className={`px-1.5 py-0.5 rounded text-white text-xxs ${severityColor[reScanReport.severity]}`}>
                {reScanReport.severity}
              </span>
              <span className="text-text-secondary">
                禁用词 {reScanReport.totalBannedHits} 处
                {report && reScanReport.totalBannedHits < report.totalBannedHits && (
                  <span className="text-success"> ↓{report.totalBannedHits - reScanReport.totalBannedHits}</span>
                )}
                {report && reScanReport.totalBannedHits >= report.totalBannedHits && (
                  <span className="text-text-placeholder">（未减少）</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ===== Pattern Editor (collapsible, always at bottom) ===== */}
      <div className="border-t border-border">
        <button
          onClick={() => setShowPatternEditor(!showPatternEditor)}
          className="flex items-center justify-between w-full px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary"
        >
          <span>⚙ 禁用词管理（{patterns.filter(p => p.enabled !== false).length}/{patterns.length} 启用）</span>
          <span className={`transform transition-transform ${showPatternEditor ? 'rotate-90' : ''}`}>▶</span>
        </button>

        {showPatternEditor && (
          <div className="px-4 py-2 space-y-2 border-t border-border bg-bg-secondary/50">
            <div className="flex gap-2">
              <button onClick={handleAddPattern}
                className="px-2 py-1 text-xs border border-primary text-primary rounded hover:bg-primary-light">＋ 添加规则</button>
              <button onClick={handleResetPatterns}
                className="px-2 py-1 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary">↩ 恢复默认</button>
            </div>

            <div className="space-y-1.5 max-h-64 overflow-auto">
              {patterns.map((p, i) => (
                <div key={`${p.pattern}-${i}`} className={`px-2 py-1.5 rounded text-xs ${p.enabled === false ? 'opacity-40' : ''} ${p.category === '自定义' || p.category === '风格导入' ? 'bg-warning/5' : ''}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <input type="checkbox" checked={p.enabled !== false}
                      onChange={() => handleTogglePattern(i)} className="shrink-0" />
                    <input type="text" value={p.pattern}
                      onChange={(e) => handleUpdatePattern(i, 'pattern', e.target.value)}
                      className="flex-1 min-w-0 bg-white border border-border-input rounded px-1.5 py-0.5 text-text-main" placeholder="匹配词" />
                    <select value={p.level}
                      onChange={(e) => handleUpdatePattern(i, 'level', Number(e.target.value))}
                      className={`flex-none px-1 rounded text-xxs font-medium border-0 ${levelColors[p.level] || 'bg-gray-100'}`}>
                      {[1,2,3,4,5].map(l => <option key={l} value={l}>L{l}</option>)}
                    </select>
                    {(p.category === '自定义' || p.category === '风格导入') && (
                      <button onClick={() => handleDeletePattern(i)} className="flex-none text-danger hover:bg-danger/10 px-1 rounded text-xxs">✕</button>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 pl-5">
                    <input type="text" value={p.replacement}
                      onChange={(e) => handleUpdatePattern(i, 'replacement', e.target.value)}
                      className="flex-1 min-w-0 bg-white border border-border-input rounded px-1.5 py-0.5 text-text-secondary" placeholder="替换建议" />
                    <select value={p.category}
                      onChange={(e) => handleUpdatePattern(i, 'category', e.target.value)}
                      className="flex-none bg-white border border-border-input rounded px-1 py-0.5 text-text-secondary">
                      <option value="句式">句式</option><option value="心理">心理</option>
                      <option value="表情">表情</option><option value="动作">动作</option>
                      <option value="对话">对话</option><option value="比喻">比喻</option>
                      <option value="描写">描写</option><option value="副词">副词</option>
                      <option value="连接词">连接词</option><option value="判断">判断</option>
                      <option value="结尾">结尾</option><option value="标点">标点</option>
                      <option value="总结">总结</option><option value="解释">解释</option>
                      <option value="自定义">自定义</option><option value="风格导入">风格导入</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xxs text-text-placeholder">💡 关闭开关临时禁用 · 修改即时生效 · 「自定义」和「风格导入」可删除</p>

            {/* 句式规则开关（正则检测，只能开关不能编辑） */}
            <div className="mt-3 pt-3 border-t border-border">
              <p className="text-xs text-text-secondary mb-2">句式检测规则（仅可开关）：</p>
              <div className="space-y-1 max-h-40 overflow-auto">
                {SENTENCE_PATTERNS.map((sp, i) => (
                  <label key={i} className="flex items-center gap-1.5 text-xs py-0.5 cursor-pointer hover:bg-bg-secondary/50 px-1 rounded">
                    <input
                      type="checkbox"
                      checked={(sp as any).enabled !== false}
                      onChange={() => { (sp as any).enabled = (sp as any).enabled === false }}
                      className="shrink-0"
                    />
                    <span className={`${(sp as any).enabled === false ? 'opacity-40 line-through' : ''}`}>
                      {sp.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ==================== Gate Badge ====================

function GateBadge({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${ok ? 'bg-success/10' : 'bg-danger/10'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-success' : 'bg-danger'}`} />
      <span className="text-text-main">{label}</span>
      <span className="text-text-placeholder truncate">{detail}</span>
    </div>
  )
}
