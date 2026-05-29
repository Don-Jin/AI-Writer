import type { ChapterPlan, Chapter } from '../../types'

interface ChapterListProps {
  chapterPlans: ChapterPlan[]
  generatedChapters: Chapter[]
  currentChapter: number
  onSelect: (chapterNumber: number) => void
}

export default function ChapterList({ chapterPlans, generatedChapters, currentChapter, onSelect }: ChapterListProps) {
  const getStatus = (num: number) => {
    const ch = generatedChapters.find(c => c.chapter_number === num)
    if (!ch) return 'pending'
    if (ch.status === 'generated' || ch.status === 'edited') return 'done'
    if (ch.status === 'generating') return 'generating'
    return 'pending'
  }

  const statusIcon: Record<string, string> = {
    pending: '○',
    generating: '⏳',
    done: '●',
  }
  const statusColor: Record<string, string> = {
    pending: 'text-text-placeholder',
    generating: 'text-warning',
    done: 'text-success',
  }

  return (
    <div className="w-56 shrink-0 bg-white rounded-card border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border bg-bg-secondary">
        <span className="text-caption font-medium text-text-secondary">
          目录 ({generatedChapters.filter(c => c.status !== 'draft').length}/{chapterPlans.length})
        </span>
      </div>
      <div className="overflow-auto max-h-[calc(100vh-200px)]">
        {chapterPlans.map((plan) => {
          const status = getStatus(plan.chapter_number)
          const isActive = plan.chapter_number === currentChapter
          return (
            <button
              key={plan.chapter_number}
              onClick={() => onSelect(plan.chapter_number)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-caption
                border-b border-border last:border-b-0 transition-colors
                ${isActive ? 'bg-primary-light text-primary' : 'hover:bg-bg-secondary text-text-secondary'}
              `}
            >
              <span className={`text-xs ${statusColor[status]}`}>{statusIcon[status]}</span>
              <span className="truncate flex-1">
                {plan.chapter_number}. {plan.title}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
