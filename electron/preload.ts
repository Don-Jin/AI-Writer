import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 数据库
  db: {
    query: (sql: string, params?: any[]) => ipcRenderer.invoke('db:query', sql, params),
    run: (sql: string, params?: any[]) => ipcRenderer.invoke('db:run', sql, params),
    get: (sql: string, params?: any[]) => ipcRenderer.invoke('db:get', sql, params),
  },

  // 设置
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  },

  // AI — 非流式（兼容旧代码）
  aiChat: (messages: { role: string; content: string }[], purpose?: string) =>
    ipcRenderer.invoke('ai:chat', messages, purpose),

  // AI — 流式
  aiChatStream: (messages: { role: string; content: string }[], purpose?: string) =>
    ipcRenderer.invoke('ai:chatStream', messages, purpose),

  // 监听流式数据块
  onStreamChunk: (callback: (data: { chunk: string; done: boolean; error?: string }) => void) => {
    const handler = (_event: any, data: { chunk: string; done: boolean; error?: string }) => {
      callback(data)
    }
    ipcRenderer.on('ai:stream-chunk', handler)
    // 返回取消监听的函数
    return () => {
      ipcRenderer.removeListener('ai:stream-chunk', handler)
    }
  },

  // 中断 AI
  cancelAi: () => ipcRenderer.send('ai:cancel'),

  // Token 用量
  tokens: {
    stats: () => ipcRenderer.invoke('tokens:stats'),
    history: () => ipcRenderer.invoke('tokens:history'),
  },

  // 文件
  openFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('file:open', options),
  readFile: (filePath: string) => ipcRenderer.invoke('file:read', filePath),
  saveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('file:save', options),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('file:write', filePath, content),
  writeBuffer: (filePath: string, base64Data: string) => ipcRenderer.invoke('file:writeBuffer', filePath, base64Data),
  parseFile: (filePath: string) => ipcRenderer.invoke('file:parse', filePath),

  // 应用
  app: {
    getPath: (name: string) => ipcRenderer.invoke('app:getPath', name),
    checkUpdate: () => ipcRenderer.invoke('app:checkUpdate'),
  },
})
