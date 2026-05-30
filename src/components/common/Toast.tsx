import { useEffect, useState } from 'react'
import { create } from 'zustand'

type ToastType = 'success' | 'error' | 'info'

interface ToastMessage {
  id: number
  type: ToastType
  text: string
}

interface ToastStore {
  toasts: ToastMessage[]
  show: (type: ToastType, text: string, duration?: number) => void
  remove: (id: number) => void
}

let nextId = 0
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (type, text, duration = 5000) => {
    const id = nextId++
    set((state) => ({
      toasts: [...state.toasts, { id, type, text }],
    }))
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }))
    }, duration)
  },
  remove: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },
}))

export function showToast(type: ToastType, text: string, duration?: number) {
  useToastStore.getState().show(type, text, duration)
}

/** 显示 Token 用量通知弹窗（停留8秒，点击消失） */
export function showTokenToast(promptTokens: number, cachedTokens: number, outputTokens: number, purpose?: string) {
  const total = promptTokens + outputTokens
  const cost = (promptTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 6
  const fmt = (n: number) => n >= 1000 ? (n / 1000).toFixed(1) + 'K' : String(n)
  const text = `📊 ${purpose || 'AI调用'} | 输入 ${fmt(promptTokens)}${cachedTokens > 0 ? ` (缓存命中 ${fmt(cachedTokens)})` : ''} | 输出 ${fmt(outputTokens)} | 合计 ${fmt(total)} ≈ ¥${cost.toFixed(2)}`
  useToastStore.getState().show('info', text, 8000)
}

const colorMap: Record<ToastType, string> = {
  success: 'bg-success',
  error: 'bg-danger',
  info: 'bg-primary',
}

export default function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)
  const remove = useToastStore((s) => s.remove)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onClose={() => remove(toast.id)} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onClose }: { toast: ToastMessage; onClose: () => void }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  return (
    <div
      onClick={onClose}
      className={`px-4 py-2.5 rounded-btn text-white text-body shadow-lg cursor-pointer
        transition-all duration-300 ${colorMap[toast.type]}
        ${visible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-4'}`}
    >
      {toast.text}
    </div>
  )
}
