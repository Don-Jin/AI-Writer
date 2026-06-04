import { useState, useRef, useEffect } from 'react'
import { showToast } from '../common/Toast'
import {
  localScan, buildStyledRewriteSystem, DESLOP_REWRITE_USER,
  getEffectivePatterns, loadCustomBannedPatterns, saveCustomBannedPatterns,
  DEFAULT_BANNED_PATTERNS, splitParagraphs,
  type DeslopLocalReport, type BannedPattern, type ParagraphScore,
} from '../../services/deslop'

interface DeslopPanelProps {
  content: string
  onApply: (newContent: string) => void
  styleContext?: string
  personalityContext?: string
  onMarksChange?: (scores: ParagraphScore[], selected: Set<number>) => void
}

export default function DeslopPanel({ content, onApply, styleContext, personalityContext, onMarksChange }: DeslopPanelProps) {
  const [scanning, setScanning] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [report, setReport] = useState<DeslopLocalReport | null>(null)
  const [rewrittenText, setRewrittenText] = useState('')
  const [showCompare, setShowCompare] = useState(false)
  const [step, setStep] = useState<'idle' | 'scanned' | 'rewritten'>('idle')
  const [selectedParagraphs, setSelectedParagraphs] = useState<Set<number>>(new Set())
  const [showPatternEditor, setShowPatternEditor] = useState(false)
  const [customPatterns, setCustomPatterns] = useState<BannedPattern[]>(loadCustomBannedPatterns)
  const [reScanReport, setReScanReport] = useState<DeslopLocalReport | null>(null)
  const cancelledRef = useRef(false)
  const rewritingRef = useRef(false)

  useEffect(() => {
    rewritingRef.current = rewriting
  }, [rewriting])

  useEffect(() => {
    return () => {
      if (rewritingRef.current) {
        cancelledRef.current = true
        window.electronAPI?.cancelAi()
      }
    }
  }, [])

  const handleCancel = () => {
    cancelledRef.current = true
    window.electronAPI?.cancelAi()
  }

  const handleScan = async () => {
    if (!content.trim()) { showToast('error', '章节内容为空'); return }
    setScanning(true)
    setReScanReport(null)
    await new Promise(r => setTimeout(r, 400))
    const r = localScan(content)
    setReport(r)
    // 默认选中所有有问题的段落
    const defaultSelected = new Set<number>()
    r.paragraphScores.forEach(p => { if (p.score > 0) defaultSelected.add(p.index) })
    setSelectedParagraphs(defaultSelected)
    setStep('scanned')
    setScanning(false)
    onMarksChange?.(r.paragraphScores, defaultSelected)
  }

  // 勾选变化时同步标记到父组件
  useEffect(() => {
    if (report && onMarksChange) {
      onMarksChange(report.paragraphScores, selectedParagraphs)
    }
  }, [selectedParagraphs])

  const toggleParagraph = (index: number) => {
    setSelectedParagraphs(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  const selectAllParagraphs = () => {
    if (!report) return
    setSelectedParagraphs(new Set(report.paragraphScores.map(p => p.index)))
  }

  const deselectAllParagraphs = () => {
    setSelectedParagraphs(new Set())
  }

  const handleRewrite = async () => {
    if (!report) return
    setRewriting(true)
    cancelledRef.current = false
    try {
      const systemPrompt = (styleContext || personalityContext)
        ? buildStyledRewriteSystem(styleContext, personalityContext)
        : buildStyledRewriteSystem()

      const targetParagraphs = selectedParagraphs.size < report.paragraphScores.length
        ? Array.from(selectedParagraphs).sort((a, b) => a - b)
        : undefined

      let textToRewrite = content
      if (targetParagraphs && targetParagraphs.length > 0) {
        const allParas = splitParagraphs(content)
        textToRewrite = targetParagraphs
          .map(i => allParas.find(p => p.index === i)?.text || '')
          .filter(Boolean)
          .join('\n\n')
      }

      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: DESLOP_REWRITE_USER(textToRewrite, report.severity, {
          styleContext, personalityContext, targetParagraphs,
        }) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '去AI味改写')
      if (cancelledRef.current) return

      // 定点改写：合并改写结果回原文
      let finalText = reply
      if (targetParagraphs && targetParagraphs.length > 0) {
        const allParas = splitParagraphs(content)
        const rewrittenParas = reply.split('[DESLOP_PARA_END]').map(s => s.trim()).filter(Boolean)

        // 按顺序替换目标段落
        const paraMap = new Map<number, string>()
        targetParagraphs.forEach((targetIdx, i) => {
          if (i < rewrittenParas.length) paraMap.set(targetIdx, rewrittenParas[i])
        })

        finalText = allParas
          .map(p => paraMap.has(p.index) ? paraMap.get(p.index)! : p.text)
          .join('\n\n')
      }

      setRewrittenText(finalText)
      setStep('rewritten')
      showToast('success', '去AI味改写完成！')

      // 改写后自动重新扫描
      const newReport = localScan(finalText)
      setReScanReport(newReport)
    } catch (e: any) {
      if (cancelledRef.current) showToast('info', '已取消改写')
      else showToast('error', '改写失败：' + (e.message || '未知错误'))
    } finally {
      setRewriting(false)
    }
  }

  const handleApply = () => {
    if (rewrittenText) {
      onApply(rewrittenText)
      showToast('success', '已应用改写结果')
      setReport(null); setRewrittenText(''); setStep('idle'); setShowCompare(false); setReScanReport(null)
    }
  }

  const handleReset = () => {
    setReport(null); setRewrittenText(''); setStep('idle'); setShowCompare(false); setReScanReport(null)
  }

  // === 禁用词管理 ===

  const effectivePatterns = getEffectivePatterns()

  const handleTogglePattern = (pattern: string) => {
    const newPatterns = effectivePatterns.map(p =>
      p.pattern === pattern ? { ...p, enabled: !p.enabled } : p
    )
    saveCustomBannedPatterns(newPatterns)
    setCustomPatterns(newPatterns)
  }

  const handleAddPattern = () => {
    const newPatterns = [
      ...effectivePatterns,
      { pattern: '', replacement: '', category: '自定义', level: 2, enabled: true },
    ]
    saveCustomBannedPatterns(newPatterns)
    setCustomPatterns(newPatterns)
  }

  const handleUpdatePattern = (index: number, field: keyof BannedPattern, value: string | number | boolean) => {
    const newPatterns = effectivePatterns.map((p, i) =>
      i === index ? { ...p, [field]: value } : p
    )
    saveCustomBannedPatterns(newPatterns)
    setCustomPatterns(newPatterns)
  }

  const handleDeletePattern = (index: number) => {
    const newPatterns = effectivePatterns.filter((_, i) => i !== index)
    saveCustomBannedPatterns(newPatterns)
    setCustomPatterns(newPatterns)
  }

  const handleImportFromStyle = () => {
    if (!styleContext) {
      showToast('info', '未选择风格库，无法导入')
      return
    }
    // 从风格上下文中提取 forbidden_words 类的规则
    const stylePatterns: BannedPattern[] = []
    // 尝试匹配风格上下文中常见的禁用词描述
    const forbiddenMatch = styleContext.match(/禁用词[类型]*[：:]\s*(.+?)(?:\n|$)/)
    if (forbiddenMatch) {
      const words = forbiddenMatch[1].split(/[、，,]/)
      words.forEach(w => {
        const trimmed = w.trim()
        if (trimmed && trimmed.length > 1) {
          stylePatterns.push({ pattern: trimmed, replacement: '（删掉或替换）', category: '风格导入', level: 3, enabled: true })
        }
      })
    }
    // 也检查词汇档位
    const vocabMatch = styleContext.match(/【词汇】(.+?)(?:\n|$)/)
    if (vocabMatch) {
      stylePatterns.push({ pattern: `[词汇档位] ${vocabMatch[1].trim()}`, replacement: '', category: '风格导入', level: 1, enabled: true })
    }

    if (stylePatterns.length === 0) {
      showToast('info', '风格上下文中未找到可导入的禁用词规则')
      return
    }

    const newPatterns = [...effectivePatterns, ...stylePatterns]
    saveCustomBannedPatterns(newPatterns)
    setCustomPatterns(newPatterns)
    showToast('success', `从风格库导入了 ${stylePatterns.length} 条规则`)
  }

  const handleResetPatterns = () => {
    saveCustomBannedPatterns([])
    setCustomPatterns([])
    showToast('success', '已恢复默认禁用词列表')
  }

  // === UI 辅助 ===

  const severityColor: Record<string, string> = {
    '轻度': 'bg-success',
    '中度': 'bg-warning',
    '重度': 'bg-danger',
  }

  const severityBg: Record<string, string> = {
    '轻度': 'bg-success/10',
    '中度': 'bg-warning/10',
    '重度': 'bg-danger/10',
  }

  const levelColors: Record<number, string> = {
    1: 'bg-gray-200 text-gray-600',
    2: 'bg-yellow-100 text-yellow-700',
    3: 'bg-orange-100 text-orange-700',
    4: 'bg-red-100 text-red-700',
    5: 'bg-red-200 text-red-800',
  }

  const selectedCount = selectedParagraphs.size
  const totalProblemParas = report?.paragraphScores.filter(p => p.score > 0).length || 0

  return (
    <div className="bg-white rounded-card border border-border overflow-hidden mb-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary border-b border-border">
        <div className="flex items-center gap-2 text-base">
          <span>🔍</span>
          <span className="text-text-main font-medium">去AI味</span>
          {(styleContext || personalityContext) && (
            <span className="text-xs text-primary bg-primary-light px-1.5 py-0.5 rounded">
              {[styleContext && '风格', personalityContext && '人格'].filter(Boolean).join('+')}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {step === 'idle' && (
            <button onClick={handleScan} disabled={scanning || !content.trim()}
              className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50">
              {scanning ? '⏳ 扫描中...' : '开始扫描'}
            </button>
          )}
          {step === 'scanned' && (
            <>
              <button onClick={handleReset} className="px-3 py-1 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary">
                取消
              </button>
              <button onClick={handleRewrite} disabled={rewriting || selectedCount === 0}
                className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50">
                {rewriting ? '⏳ 改写中...' : `🤖 AI 改写${selectedCount < totalProblemParas ? ` (${selectedCount}段)` : ''}`}
              </button>
            </>
          )}
          {step === 'rewritten' && (
            <>
              <button onClick={handleReset} className="px-3 py-1 text-xs border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary">
                放弃
              </button>
              <button onClick={() => setShowCompare(!showCompare)}
                className="px-3 py-1 text-xs border border-primary text-primary rounded-btn hover:bg-primary-light">
                {showCompare ? '只看结果' : '对比原文'}
              </button>
              <button onClick={handleApply}
                className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover">
                ✅ 应用改写
              </button>
            </>
          )}
        </div>
      </div>

      {/* 扫描报告 */}
      {report && step !== 'rewritten' && (
        <div className="px-4 py-3 space-y-3">
          {/* 等级 + 统计 */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-base text-text-main">AI味等级：</span>
            <span className={`px-2 py-0.5 rounded text-xs text-white ${severityColor[report.severity]}`}>
              {report.severity}
            </span>
            <span className="text-xs text-text-secondary">
              禁用词 {report.totalBannedHits} 处 · 密度 {report.bannedDensity.toFixed(1)}/千字
              · {report.paragraphs} 段 · 均 {report.avgSentencesPerParagraph} 句/段
            </span>
            {reScanReport && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${reScanReport.severity === '轻度' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}`}>
                改写后: {reScanReport.severity}
              </span>
            )}
          </div>

          {/* Gate 状态 */}
          <div className="grid grid-cols-3 gap-2 text-xs">
            <GateBadge label="A 禁用词" ok={report.totalBannedHits <= 5} detail={`${report.totalBannedHits}处`} />
            <GateBadge label="B 句式" ok={!report.hasParallelism && report.sentencePatternHits.length === 0} detail={report.sentencePatternHits.join(',') || '正常'} />
            <GateBadge label="C 心理描写" ok={!report.hasTelling} detail={report.hasTelling ? '有告知' : '正常'} />
            <GateBadge label="D 节奏" ok={!report.hasUniformRhythm} detail={report.hasUniformRhythm ? '偏均匀' : '自然'} />
            <GateBadge label="E 对话" ok={report.bannedHits.filter(h => h.category === '对话').length <= 2} detail="需AI判断" />
            <GateBadge label="F 结尾" ok={true} detail="需AI判断" />
          </div>

          {/* 段落评分 + 选择 */}
          {report.paragraphScores.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-xs text-text-secondary">
                  段落评分（{totalProblemParas} 段有问题，已选 {selectedCount} 段）
                </p>
                <div className="flex gap-2">
                  <button onClick={selectAllParagraphs} className="text-xs text-primary hover:underline">全选</button>
                  <button onClick={deselectAllParagraphs} className="text-xs text-text-secondary hover:underline">全不选</button>
                </div>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-auto">
                {report.paragraphScores.map((p) => (
                  <label
                    key={p.index}
                    className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs cursor-pointer hover:bg-bg-secondary ${
                      selectedParagraphs.has(p.index) ? 'bg-primary-light/30' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedParagraphs.has(p.index)}
                      onChange={() => toggleParagraph(p.index)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-text-main font-medium">第{p.index + 1}段</span>
                        {p.score > 0 && (
                          <span className={`px-1 rounded text-xxs ${p.score >= 8 ? 'bg-danger/10 text-danger' : p.score >= 3 ? 'bg-warning/10 text-warning' : 'bg-gray-100 text-text-secondary'}`}>
                            ⭐{p.score}
                          </span>
                        )}
                        {p.score === 0 && (
                          <span className="text-text-placeholder">正常</span>
                        )}
                      </div>
                      {p.hits.length > 0 && (
                        <div className="flex flex-wrap gap-0.5 mt-0.5">
                          {p.hits.map((h, i) => (
                            <span key={i} className="text-xxs px-1 py-0.5 rounded bg-danger/10 text-danger">{h}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* 禁用词命中汇总 */}
          {report.bannedHits.length > 0 && (
            <div>
              <p className="text-xs text-text-secondary mb-1.5">禁用词命中：</p>
              <div className="flex flex-wrap gap-1">
                {report.bannedHits.map((h, i) => (
                  <span key={i} className="text-xs px-1.5 py-0.5 rounded bg-danger/10 text-danger"
                    title={h.category}>
                    {h.pattern} ×{h.count}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 改写中 */}
      {rewriting && (
        <div className="flex items-center gap-3 px-4 py-8 justify-center">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-base text-text-secondary">
            AI 正在改写{selectedCount < totalProblemParas ? ` (${selectedCount}段)` : ''}...
          </span>
          <button onClick={handleCancel} className="px-3 py-1 text-xs border border-danger text-danger rounded hover:bg-danger/10">取消</button>
        </div>
      )}

      {/* 改写结果 */}
      {step === 'rewritten' && rewrittenText && (
        <div className="px-4 py-3">
          {showCompare ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-text-secondary mb-1 font-medium">📝 原文</p>
                <div className="text-xs text-text-main whitespace-pre-wrap max-h-80 overflow-auto bg-bg-secondary rounded p-2 leading-relaxed">
                  {content.slice(0, 2000)}
                  {content.length > 2000 && '\n\n...'}
                </div>
              </div>
              <div>
                <p className="text-xs text-text-secondary mb-1 font-medium">✨ 改写后</p>
                <div className="text-xs text-text-main whitespace-pre-wrap max-h-80 overflow-auto bg-primary-light/20 rounded p-2 leading-relaxed">
                  {rewrittenText.slice(0, 2000)}
                  {rewrittenText.length > 2000 && '\n\n...'}
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

          {/* 改写后验证 */}
          {reScanReport && (
            <div className={`mt-2 flex items-center gap-2 text-xs px-2 py-1.5 rounded ${severityBg[reScanReport.severity]}`}>
              <span>🔄 改写后重新扫描：</span>
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

          <p className="text-xs text-text-placeholder mt-2">
            💡 点击「对比原文」查看改动对比 · 确认无误后点击「应用改写」
          </p>
        </div>
      )}

      {/* 禁用词管理（可折叠） */}
      <div className="border-t border-border">
        <button
          onClick={() => setShowPatternEditor(!showPatternEditor)}
          className="flex items-center justify-between w-full px-4 py-2 text-xs text-text-secondary hover:bg-bg-secondary"
        >
          <span>⚙ 禁用词管理（{effectivePatterns.filter(p => p.enabled !== false).length}/{effectivePatterns.length} 启用）</span>
          <span className={`transform transition-transform ${showPatternEditor ? 'rotate-90' : ''}`}>▶</span>
        </button>

        {showPatternEditor && (
          <div className="px-4 py-2 space-y-2 border-t border-border bg-bg-secondary/50">
            {/* 操作按钮 */}
            <div className="flex gap-2">
              <button onClick={handleAddPattern}
                className="px-2 py-1 text-xs border border-primary text-primary rounded hover:bg-primary-light">
                ＋ 添加规则
              </button>
              <button onClick={handleImportFromStyle}
                className="px-2 py-1 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary"
                title={styleContext ? '从已选风格库导入禁用词' : '需要先在生成面板选择风格库'}>
                📥 从风格库导入
              </button>
              <button onClick={handleResetPatterns}
                className="px-2 py-1 text-xs border border-border-input text-text-secondary rounded hover:bg-bg-secondary">
                ↩ 恢复默认
              </button>
            </div>

            {/* 规则列表 */}
            <div className="space-y-1.5 max-h-64 overflow-auto">
              {effectivePatterns.map((p, i) => (
                <div key={i} className={`px-2 py-1.5 rounded text-xs ${
                  p.enabled === false ? 'opacity-40' : ''
                } ${p.category === '自定义' || p.category === '风格导入' ? 'bg-warning/5' : ''}`}>
                  {/* 第一行：checkbox + 匹配词 + 毒级 + 删除 */}
                  <div className="flex items-center gap-1.5 mb-1">
                    <input
                      type="checkbox"
                      checked={p.enabled !== false}
                      onChange={() => handleTogglePattern(p.pattern)}
                      className="shrink-0"
                    />
                    <input
                      type="text"
                      value={p.pattern}
                      onChange={(e) => handleUpdatePattern(i, 'pattern', e.target.value)}
                      className="flex-1 min-w-0 bg-white border border-border-input rounded px-1.5 py-0.5 text-text-main"
                      placeholder="匹配词"
                    />
                    <span className={`flex-none px-1 rounded text-xxs font-medium ${levelColors[p.level] || 'bg-gray-100'}`}>
                      L{p.level}
                    </span>
                    {(p.category === '自定义' || p.category === '风格导入') && (
                      <button onClick={() => handleDeletePattern(i)}
                        className="flex-none text-danger hover:bg-danger/10 px-1 rounded text-xxs">
                        ✕
                      </button>
                    )}
                  </div>
                  {/* 第二行：替换建议 + 分类 */}
                  <div className="flex items-center gap-1.5 pl-5">
                    <input
                      type="text"
                      value={p.replacement}
                      onChange={(e) => handleUpdatePattern(i, 'replacement', e.target.value)}
                      className="flex-1 min-w-0 bg-white border border-border-input rounded px-1.5 py-0.5 text-text-secondary"
                      placeholder="替换建议"
                    />
                    <select
                      value={p.category}
                      onChange={(e) => handleUpdatePattern(i, 'category', e.target.value)}
                      className="flex-none bg-white border border-border-input rounded px-1 py-0.5 text-text-secondary"
                    >
                      <option value="句式">句式</option>
                      <option value="心理">心理</option>
                      <option value="表情">表情</option>
                      <option value="动作">动作</option>
                      <option value="对话">对话</option>
                      <option value="比喻">比喻</option>
                      <option value="描写">描写</option>
                      <option value="副词">副词</option>
                      <option value="连接词">连接词</option>
                      <option value="判断">判断</option>
                      <option value="结尾">结尾</option>
                      <option value="自定义">自定义</option>
                      <option value="风格导入">风格导入</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>

            <p className="text-xxs text-text-placeholder">
              💡 关闭开关临时禁用规则 · 修改 pattern 即时生效 · 「自定义」和「风格导入」规则可删除
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function GateBadge({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded ${ok ? 'bg-success/10' : 'bg-danger/10'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-success' : 'bg-danger'}`} />
      <span className="text-text-main">{label}</span>
      <span className="text-text-placeholder">{detail}</span>
    </div>
  )
}
