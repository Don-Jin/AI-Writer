import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync } from 'fs'
import { initDatabase, query, run, get, closeDatabase } from './database'

let mainWindow: BrowserWindow | null = null

// ==================== 窗口创建 ====================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'AI 小说写作',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../dist/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ==================== IPC 处理器 ====================

function registerIpcHandlers() {
  // ---- 数据库操作 ----
  ipcMain.handle('db:query', (_event, sql: string, params?: any[]) => {
    return query(sql, params)
  })

  ipcMain.handle('db:run', (_event, sql: string, params?: any[]) => {
    return run(sql, params)
  })

  ipcMain.handle('db:get', (_event, sql: string, params?: any[]) => {
    return get(sql, params)
  })

  // ---- 设置操作（便捷方法） ----
  ipcMain.handle('settings:get', (_event, key: string) => {
    const row = get('SELECT value FROM settings WHERE key = ?', [key])
    return row?.value ?? ''
  })

  ipcMain.handle('settings:set', (_event, key: string, value: string) => {
    run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
    return true
  })

  // ---- AI API 调用 ----
  ipcMain.handle('ai:chat', async (_event, messages: any[], purpose?: string) => {
    const apiKey = get('SELECT value FROM settings WHERE key = ?', ['api_key'])?.value
    const baseUrl = get('SELECT value FROM settings WHERE key = ?', ['api_base_url'])?.value || 'https://api.deepseek.com'
    const model = get('SELECT value FROM settings WHERE key = ?', ['api_model'])?.value || 'deepseek-chat'

    if (!apiKey) {
      throw new Error('请先在设置页面配置 DeepSeek API Key')
    }

    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({
      apiKey,
      baseURL: baseUrl + '/v1',
    })

    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 4096,
    })

    // 记录 Token 用量
    if (response.usage) {
      run(
        'INSERT INTO token_usage (purpose, model, prompt_tokens, output_tokens, total_tokens) VALUES (?,?,?,?,?)',
        [purpose || '', model, response.usage.prompt_tokens, response.usage.completion_tokens, response.usage.total_tokens]
      )
    }

    return response.choices[0]?.message?.content || ''
  })

  // ---- Token 用量查询 ----
  ipcMain.handle('tokens:stats', () => {
    const today = new Date().toISOString().slice(0, 10)
    const todayRow = get(
      "SELECT COALESCE(SUM(total_tokens),0) as total, COALESCE(SUM(prompt_tokens),0) as prompt, COALESCE(SUM(output_tokens),0) as output, COUNT(*) as calls FROM token_usage WHERE created_at >= ?",
      [today]
    )
    const allRow = get(
      "SELECT COALESCE(SUM(total_tokens),0) as total, COALESCE(SUM(prompt_tokens),0) as prompt, COALESCE(SUM(output_tokens),0) as output, COUNT(*) as calls FROM token_usage"
    )

    return {
      today: { tokens: todayRow?.total || 0, prompt: todayRow?.prompt || 0, output: todayRow?.output || 0, calls: todayRow?.calls || 0 },
      total: { tokens: allRow?.total || 0, prompt: allRow?.prompt || 0, output: allRow?.output || 0, calls: allRow?.calls || 0 },
    }
  })

  ipcMain.handle('tokens:history', () => {
    return query(
      "SELECT purpose, model, prompt_tokens, output_tokens, total_tokens, created_at FROM token_usage ORDER BY created_at DESC LIMIT 50"
    )
  })

  // ---- 文件操作 ----
  ipcMain.handle('file:open', async (_event, options?: any) => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: options?.filters || [
        { name: '文档文件', extensions: ['txt', 'docx', 'pdf'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const fileName = filePath.split(/[/\\]/).pop() || filePath
    return { filePath, fileName }
  })

  ipcMain.handle('file:read', (_event, filePath: string) => {
    return readFileSync(filePath, 'utf-8')
  })

  ipcMain.handle('file:save', async (_event, options?: any) => {
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: options?.defaultPath,
      filters: options?.filters || [
        { name: '文本文档', extensions: ['txt'] },
        { name: 'Word 文档', extensions: ['docx'] },
        { name: 'PDF 文档', extensions: ['pdf'] },
      ],
    })
    if (result.canceled || !result.filePath) return null
    return { filePath: result.filePath }
  })

  ipcMain.handle('file:write', (_event, filePath: string, content: string) => {
    writeFileSync(filePath, content, 'utf-8')
  })

  ipcMain.handle('file:writeBuffer', (_event, filePath: string, base64Data: string) => {
    const buffer = Buffer.from(base64Data, 'base64')
    writeFileSync(filePath, buffer)
  })

  // ---- 文件解析（TXT/DOCX/PDF → 纯文本） ----
  ipcMain.handle('file:parse', async (_event, filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase()

    if (ext === 'txt') {
      return readFileSync(filePath, 'utf-8')
    }

    if (ext === 'docx') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      return result.value
    }

    if (ext === 'pdf') {
      const fs = await import('fs')
      const pdfParse = (await import('pdf-parse')).default
      const dataBuffer = fs.readFileSync(filePath)
      const data = await pdfParse(dataBuffer)
      return data.text
    }

    throw new Error(`不支持的文件格式: .${ext}`)
  })

  // ---- 应用信息 ----
  ipcMain.handle('app:getPath', (_event, name: string) => {
    return app.getPath(name as any)
  })
}

// ==================== 应用生命周期 ====================

app.whenReady().then(async () => {
  await initDatabase()
  registerIpcHandlers()
  createWindow()
})

app.on('window-all-closed', () => {
  closeDatabase()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
