import { useState, useRef, useEffect } from 'react'

interface InlineEditProps {
  value: string
  onSave: (newValue: string) => Promise<void>
  className?: string
  inputClassName?: string
}

export default function InlineEdit({ value, onSave, className, inputClassName }: InlineEditProps) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (editing) inputRef.current?.focus() }, [editing])
  useEffect(() => { setText(value) }, [value])

  const handleSave = async () => {
    const trimmed = text.trim()
    if (trimmed && trimmed !== value) {
      await onSave(trimmed)
    } else {
      setText(value)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleSave}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') { setText(value); setEditing(false) }
        }}
        onClick={(e) => e.stopPropagation()}
        className={`border border-primary rounded px-1 py-0.5 text-sm ${inputClassName || ''}`}
      />
    )
  }

  return (
    <span
      onClick={(e) => { e.stopPropagation(); setEditing(true) }}
      className={`cursor-pointer hover:text-primary ${className || ''}`}
      title="点击改名"
    >
      {value}
    </span>
  )
}
