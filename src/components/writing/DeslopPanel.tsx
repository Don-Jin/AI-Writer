import { useState, useRef, useEffect } from 'react'
import { showToast } from '../common/Toast'
import {
  localScan, DESLOP_REWRITE_SYSTEM, DESLOP_REWRITE_USER,
  BANNED_PATTERNS,
  type DeslopLocalReport,
} from '../../services/deslop'

interface DeslopPanelProps {
  content: string
  onApply: (newContent: string) => void
}

export default function DeslopPanel({ content, onApply }: DeslopPanelProps) {
  const [scanning, setScanning] = useState(false)
  const [rewriting, setRewriting] = useState(false)
  const [report, setReport] = useState<DeslopLocalReport | null>(null)
  const [rewrittenText, setRewrittenText] = useState('')
  const [showCompare, setShowCompare] = useState(false)
  const [step, setStep] = useState<'idle' | 'scanned' | 'rewritten'>('idle')
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
    // 本地扫秒很快，但加一点延迟让用户感知
    await new Promise(r => setTimeout(r, 400))
    const r = localScan(content)
    setReport(r)
    setStep('scanned')
    setScanning(false)
  }

  const handleRewrite = async () => {
    if (!report) return
    setRewriting(true)
    cancelledRef.current = false
    try {
      const messages = [
        { role: 'system' as const, content: DESLOP_REWRITE_SYSTEM },
        { role: 'user' as const, content: DESLOP_REWRITE_USER(content, report.severity) },
      ]
      const reply = await window.electronAPI.aiChat(messages, '去AI味改写')
      if (cancelledRef.current) return
      setRewrittenText(reply)
      setStep('rewritten')
      showToast('success', '去AI味改写完成！')
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
      // 重置
      setReport(null); setRewrittenText(''); setStep('idle'); setShowCompare(false)
    }
  }

  const handleReset = () => {
    setReport(null); setRewrittenText(''); setStep('idle'); setShowCompare(false)
  }

  const severityColor: Record<string, string> = {
    '轻度': 'bg-success',
    '中度': 'bg-warning',
    '重度': 'bg-danger',
  }

  return (
    <div className="bg-white rounded-card border border-border overflow-hidden mb-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-bg-secondary border-b border-border">
        <div className="flex items-center gap-2 text-body">
          <span>🔍</span>
          <span className="text-text-main font-medium">去AI味</span>
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
              <button onClick={handleRewrite} disabled={rewriting}
                className="px-3 py-1 text-xs bg-primary text-white rounded-btn hover:bg-primary-hover disabled:opacity-50">
                {rewriting ? '⏳ 改写中...' : '🤖 AI 改写'}
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
          {/* 等级 */}
          <div className="flex items-center gap-3">
            <span className="text-body text-text-main">AI味等级：</span>
            <span className={`px-2 py-0.5 rounded text-xs text-white ${severityColor[report.severity]}`}>
              {report.severity}
            </span>
            <span className="text-xs text-text-secondary">
              禁用词 {report.totalBannedHits} 处 · 密度 {report.bannedDensity.toFixed(1)}/千字
              · {report.paragraphs} 段 · 均 {report.avgSentencesPerParagraph} 句/段
            </span>
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

          {/* 命中列表 */}
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
          <span className="text-body text-text-secondary">AI 正在改写...</span>
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
          <p className="text-xs text-text-placeholder mt-2">
            💡 点击「对比原文」查看改动对比 · 确认无误后点击「应用改写」
          </p>
        </div>
      )}
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
