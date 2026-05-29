import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../common/Modal'
import { showToast } from '../common/Toast'
import InlineEdit from '../common/InlineEdit'
import { useDisassemblyStore, DisassemblyProject } from '../../store/disassemblyStore'

const STAGE_LABELS: Record<number, string> = {
  0: '待开始', 1: '黄金三章', 2: '逐章摘要', 3: '聚合分析', 4: '文风分析', 5: '已完成',
}

export default function DisassemblyList() {
  const [modalOpen, setModalOpen] = useState(false)
  const [mode, setMode] = useState<'file' | 'paste'>('file')
  const [name, setName] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [filePath, setFilePath] = useState('')
  const [fileName, setFileName] = useState('')
  const [creating, setCreating] = useState(false)

  const navigate = useNavigate()
  const { projects, loaded, load, create, remove } = useDisassemblyStore()

  useEffect(() => { load() }, [])

  const handleSelectFile = async () => {
    try {
      const result = await window.electronAPI?.openFile({
        filters: [{ name: '文档文件', extensions: ['txt', 'docx', 'pdf'] }],
      })
      if (result) {
        setFilePath(result.filePath)
        setFileName(result.fileName)
        showToast('success', `已选择：${result.fileName}`)
      }
    } catch { showToast('error', '文件选择失败') }
  }

  const handleCreate = async () => {
    if (!name.trim()) { showToast('error', '请输入书名'); return }
    // 检查重名
    if (projects.some(p => p.name === name.trim())) { showToast('error', '已存在同名项目，请修改名称'); return }
    if (mode === 'paste' && !pastedText.trim()) { showToast('error', '请粘贴小说文本'); return }
    if (mode === 'file' && !filePath) { showToast('error', '请选择小说文件'); return }

    setCreating(true)
    try {
      let text = ''
      if (mode === 'file') {
        text = await window.electronAPI.parseFile(filePath)
      } else {
        text = pastedText
      }
      if (!text || text.trim().length < 500) {
        showToast('error', '文本太少（不足500字），无法拆解')
        setCreating(false)
        return
      }

      const newId = await create(name.trim(), text)
      if (newId !== null && newId !== undefined) {
        showToast('success', `拆解项目「${name}」创建成功！请点击卡片进入拆解。`)
        setModalOpen(false)
        setCreating(false)
        setName(''); setPastedText(''); setFilePath(''); setFileName(''); setMode('file')
        await load()
        return
      }
      showToast('error', '创建失败，请重试')
    } catch (e: any) {
      showToast('error', '创建失败：' + (e.message || '未知错误'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = (id: number, title: string) => {
    if (window.confirm(`确定要删除拆解项目「${title}」吗？`)) {
      remove(id)
      showToast('success', `「${title}」已删除`)
    }
  }

  const handleRename = async (rid: number, oldName: string) => {
    const newName = window.prompt('修改名称：', oldName)
    if (newName && newName.trim() && newName.trim() !== oldName) {
      try {
        if (window.electronAPI) {
          await window.electronAPI.db.run('UPDATE disassembly_projects SET name=? WHERE id=?', [newName.trim(), rid])
          await load()
          showToast('success', '名称已更新')
        }
      } catch { showToast('error', '改名失败') }
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-page-title text-text-main">拆文库</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors"
        >
          + 新建拆解
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-text-secondary">
          <span className="text-5xl mb-4">🔬</span>
          <p className="text-body mb-2">还没有拆解项目</p>
          <p className="text-caption">导入一本爆款小说，系统拆解它的套路和技巧</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((proj) => (
            <DisassemblyCard
              key={proj.id}
              project={proj}
              onClick={() => navigate(`/disassembly/${proj.id}`)}
              onDelete={() => handleDelete(proj.id, proj.name)}
            />
          ))}
        </div>
      )}

      {/* 新建弹窗（简化版，完整流程在详情页） */}
      <Modal
        open={modalOpen}
        title="新建拆解项目"
        onClose={() => { if (!creating) { setModalOpen(false); setName(''); setPastedText(''); setFileName(''); setFilePath('') } }}
        width="max-w-lg"
        footer={
          !creating ? (
            <>
              <button onClick={() => { setModalOpen(false); setName(''); setPastedText(''); setFileName(''); setFilePath('') }}
                className="px-4 py-2 border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary transition-colors">
                取消
              </button>
              <button onClick={handleCreate}
                className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors">
                创建并开始拆解
              </button>
            </>
          ) : undefined
        }
      >
        {creating ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-body text-text-main">正在读取文件...</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label className="block text-body text-text-main mb-2">书名 *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="例如：盘龙、斗破苍穹" autoFocus
                className="w-full h-10 px-3 border border-border-input rounded-btn text-body focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 placeholder:text-text-placeholder" />
            </div>
            <div>
              <label className="block text-body text-text-main mb-2">导入方式</label>
              <div className="flex gap-2">
                <button onClick={() => setMode('file')}
                  className={`px-4 py-2 rounded-btn text-body transition-colors ${mode === 'file' ? 'bg-primary text-white' : 'border border-border-input text-text-secondary hover:bg-bg-secondary'}`}>
                  📁 上传文件
                </button>
                <button onClick={() => setMode('paste')}
                  className={`px-4 py-2 rounded-btn text-body transition-colors ${mode === 'paste' ? 'bg-primary text-white' : 'border border-border-input text-text-secondary hover:bg-bg-secondary'}`}>
                  📋 粘贴文本
                </button>
              </div>
            </div>
            {mode === 'file' && (
              <div onClick={handleSelectFile}
                className="border-2 border-dashed border-border-input rounded-card p-8 text-center cursor-pointer hover:border-primary hover:bg-primary-light/30 transition-colors">
                <span className="text-3xl mb-2 block">📂</span>
                {fileName ? <p className="text-body text-text-main">{fileName}</p>
                  : <><p className="text-body text-text-secondary mb-1">点击选择文件</p>
                    <p className="text-caption text-text-placeholder">支持 TXT、Word、PDF</p></>}
              </div>
            )}
            {mode === 'paste' && (
              <textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)}
                placeholder="将小说全文粘贴到此处"
                rows={10}
                className="w-full px-3 py-2 border border-border-input rounded-btn text-body resize-none focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 placeholder:text-text-placeholder" />
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function DisassemblyCard({ project, onClick, onDelete }: {
  project: DisassemblyProject; onClick: () => void; onDelete: () => void
}) {
  let stageResults: any = {}
  try { stageResults = JSON.parse(project.stage_results || '{}') } catch {}

  const totalChapters = project.total_chapters || (
    stageResults.stage0?.total_chapters || '?'
  )

  return (
    <div onClick={onClick}
      className="bg-white rounded-card border border-border p-5 hover:shadow-md hover:border-primary/30 transition-all group cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-section-title text-text-main">
          <InlineEdit value={project.name} onSave={async (newName) => {
            if (window.electronAPI) { await window.electronAPI.db.run('UPDATE disassembly_projects SET name=? WHERE id=?', [newName, project.id]) }
          }} />
        </h3>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 text-text-placeholder hover:text-danger transition-all">🗑</button>
      </div>
      <div className="space-y-1.5 text-caption">
        <div className="flex justify-between">
          <span className="text-text-placeholder">章节数：</span>
          <span className="text-text-secondary">{totalChapters}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-placeholder">进度：</span>
          <span className="px-1.5 py-0.5 rounded bg-primary-light text-primary text-xs">
            {STAGE_LABELS[project.current_stage] || '待开始'}
          </span>
        </div>
        <div className="text-text-placeholder text-right">{project.created_at?.slice(0, 10)}</div>
      </div>
    </div>
  )
}
