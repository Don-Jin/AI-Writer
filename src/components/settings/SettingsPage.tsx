import { useState, useEffect } from 'react'
import { showToast } from '../common/Toast'

export default function SettingsPage() {
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [loaded, setLoaded] = useState(false)

  // 启动时从数据库加载已保存的 API Key
  useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.electronAPI) {
          const savedKey = await window.electronAPI.settings.get('api_key')
          if (savedKey) setApiKey(savedKey)
        }
      } catch {
        // 开发环境回退
      }
      setLoaded(true)
    }
    loadSettings()
  }, [])

  // 保存 API Key
  const handleSave = async () => {
    if (!apiKey.trim()) {
      showToast('error', '请先输入 API Key')
      return
    }
    setSaving(true)
    try {
      if (window.electronAPI) {
        await window.electronAPI.settings.set('api_key', apiKey.trim())
      }
      showToast('success', 'API Key 已保存')
    } catch (e: any) {
      showToast('error', '保存失败：' + (e.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  // 测试 API 连接
  const handleTest = async () => {
    if (!apiKey.trim()) {
      showToast('error', '请先输入 API Key')
      return
    }
    setTesting(true)
    try {
      if (window.electronAPI) {
        // 先保存 Key，确保测试使用最新值
        await window.electronAPI.settings.set('api_key', apiKey.trim())
        // 发送一条简单的测试消息
        const reply = await window.electronAPI.aiChat([
          { role: 'user', content: '你好，请回复"测试成功"' },
        ])
        if (reply) {
          showToast('success', 'API 连接测试通过！✓')
        } else {
          showToast('error', 'API 返回为空，请检查 Key 是否正确')
        }
      } else {
        // 开发环境：模拟测试
        await new Promise((r) => setTimeout(r, 1500))
        showToast('success', 'API 连接测试通过！（开发模式）')
      }
    } catch (e: any) {
      showToast('error', '连接失败：' + (e.message || '未知错误'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <div>
      <h1 className="text-page-title text-text-main mb-6">设置</h1>

      <div className="bg-white rounded-card border border-border p-5 max-w-lg">
        <h2 className="text-section-title text-text-main mb-4">🤖 DeepSeek API 配置</h2>

        {/* API Base URL */}
        <div className="mb-4">
          <label className="block text-body text-text-main mb-2">API 地址</label>
          <input
            type="text"
            value="https://api.deepseek.com"
            disabled
            className="w-full h-10 px-3 border border-border-input rounded-btn text-body bg-bg-secondary text-text-secondary"
          />
          <p className="text-caption text-text-secondary mt-1">默认使用 DeepSeek 官方 API</p>
        </div>

        {/* 模型 */}
        <div className="mb-4">
          <label className="block text-body text-text-main mb-2">模型</label>
          <input
            type="text"
            value="deepseek-chat"
            disabled
            className="w-full h-10 px-3 border border-border-input rounded-btn text-body bg-bg-secondary text-text-secondary"
          />
          <p className="text-caption text-text-secondary mt-1">128K 上下文窗口，适合长文本处理</p>
        </div>

        {/* API Key */}
        <div className="mb-4">
          <label className="block text-body text-text-main mb-2">API Key *</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
            disabled={!loaded}
            className="w-full h-10 px-3 border border-border-input rounded-btn text-body
                       focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                       placeholder:text-text-placeholder disabled:bg-bg-secondary disabled:text-text-placeholder"
          />
          <p className="text-caption text-text-secondary mt-1">
            🔒 API Key 仅存储在你的电脑本地，不会上传到任何第三方服务器
          </p>
        </div>

        {/* 按钮组 */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            disabled={!apiKey.trim() || saving || !loaded}
            className={`px-4 py-2 rounded-btn text-body transition-colors
              ${apiKey.trim() && loaded
                ? 'bg-primary text-white hover:bg-primary-hover'
                : 'bg-border text-text-placeholder cursor-not-allowed'
              }`}
          >
            {saving ? '⏳ 保存中...' : '💾 保存'}
          </button>
          <button
            onClick={handleTest}
            disabled={!apiKey.trim() || testing || !loaded}
            className={`px-4 py-2 rounded-btn text-body transition-colors
              ${apiKey.trim() && !testing && loaded
                ? 'border border-primary text-primary hover:bg-primary-light'
                : 'border border-border-input text-text-placeholder cursor-not-allowed'
              }`}
          >
            {testing ? '⏳ 测试中...' : '🔍 测试连接'}
          </button>
        </div>
      </div>

      {/* 使用说明 */}
      <div className="bg-white rounded-card border border-border p-5 max-w-lg mt-4">
        <h2 className="text-section-title text-text-main mb-3">📖 使用说明</h2>
        <ol className="text-body text-text-secondary space-y-2 list-decimal list-inside">
          <li>在 <a href="https://platform.deepseek.com" target="_blank" className="text-primary hover:underline">platform.deepseek.com</a> 注册并获取 API Key</li>
          <li>将 API Key 填入上方输入框，点击「测试连接」确认可用</li>
          <li>进入「风格库」页面，导入一本小说，AI 会分析其写作风格</li>
          <li>在首页新建项目，选择风格库，开始创作</li>
        </ol>
      </div>
    </div>
  )
}
