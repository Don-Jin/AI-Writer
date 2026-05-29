import { useState, useEffect } from 'react'

interface TokenStats {
  today: { tokens: number; prompt: number; output: number; calls: number }
  total: { tokens: number; prompt: number; output: number; calls: number }
}

export default function TokenMonitor() {
  const [stats, setStats] = useState<TokenStats | null>(null)
  const [expanded, setExpanded] = useState(false)

  const fetchStats = async () => {
    try {
      if (window.electronAPI?.tokens) {
        const s = await window.electronAPI.tokens.stats()
        setStats(s)
      }
    } catch {}
  }

  useEffect(() => {
    fetchStats()
    const timer = setInterval(fetchStats, 10000) // 每10秒刷新
    return () => clearInterval(timer)
  }, [])

  const formatTokens = (n: number) => {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
    return String(n)
  }

  // 成本估算 (DeepSeek 打折价: 输入 ¥3/M, 输出 ¥6/M tokens)
  const cost = stats
    ? (stats.total.prompt / 1_000_000) * 3 + (stats.total.output / 1_000_000) * 6
    : 0

  if (!stats) {
    return <div className="px-5 py-3 text-xs text-text-placeholder">⏳ 加载用量...</div>
  }

  return (
    <div className="border-t border-border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-5 py-2.5 hover:bg-white/50 transition-colors"
      >
        <div className="flex items-center gap-2 text-xs">
          <span>📊</span>
          <span className="text-text-secondary">Token</span>
        </div>
        <span className="text-xs text-text-placeholder">
          今日 {formatTokens(stats.today.tokens)}
        </span>
      </button>

      {expanded && (
        <div className="px-5 pb-3 space-y-2 text-xs">
          {/* 今日 */}
          <div className="bg-white rounded px-3 py-2 space-y-1">
            <div className="flex justify-between text-text-secondary">
              <span>今日</span>
              <span>{stats.today.calls} 次调用</span>
            </div>
            <div className="h-1.5 bg-border rounded-full overflow-hidden flex">
              <div className="bg-primary h-full" style={{ width: `${stats.today.prompt / Math.max(stats.today.tokens, 1) * 100}%` }} />
              <div className="bg-warning h-full" style={{ width: `${stats.today.output / Math.max(stats.today.tokens, 1) * 100}%` }} />
            </div>
            <div className="flex justify-between text-text-placeholder">
              <span>输入 {formatTokens(stats.today.prompt)}</span>
              <span>输出 {formatTokens(stats.today.output)}</span>
            </div>
          </div>

          {/* 累计 */}
          <div className="bg-white rounded px-3 py-2 space-y-1">
            <div className="flex justify-between text-text-secondary">
              <span>累计</span>
              <span>{formatTokens(stats.total.tokens)} Token</span>
            </div>
            <div className="flex justify-between text-text-placeholder">
              <span>调用 {stats.total.calls} 次</span>
              <span className="text-primary font-medium">≈ ¥{cost.toFixed(1)}</span>
            </div>
          </div>

          <p className="text-text-placeholder text-center">
            DeepSeek 打折价: 输入 ¥3/M · 输出 ¥6/M (缓存命中 ¥0.025/M)
          </p>
        </div>
      )}
    </div>
  )
}
