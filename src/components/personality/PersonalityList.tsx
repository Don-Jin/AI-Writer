import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../common/Modal'
import { showToast } from '../common/Toast'
import InlineEdit from '../common/InlineEdit'
import { usePersonalityStore } from '../../store/personalityStore'
import type { PersonalityProject } from '../../types'

export default function PersonalityList() {
  const [modalOpen, setModalOpen] = useState(false)
  const [mode, setMode] = useState<'file' | 'paste' | 'manual'>('file')
  const [name, setName] = useState('')
  const [pastedText, setPastedText] = useState('')
  const [filePath, setFilePath] = useState('')
  const [fileName, setFileName] = useState('')
  const [creating, setCreating] = useState(false)

  const navigate = useNavigate()
  const { projects, loaded, load, create, remove } = usePersonalityStore()

  useEffect(() => { load() }, [])

  const handleSelectFile = async () => {
    try {
      const result = await window.electronAPI?.openFile({
        filters: [{ name: '文档文件', extensions: ['txt', 'md'] }],
      })
      if (result) {
        setFilePath(result.filePath)
        setFileName(result.fileName)
        showToast('success', `已选择：${result.fileName}`)
      }
    } catch { showToast('error', '文件选择失败') }
  }

  const handleCreate = async () => {
    if (!name.trim()) { showToast('error', '请输入作者名'); return }
    if (projects.some(p => p.name === name.trim())) { showToast('error', '已存在同名项目'); return }
    if (mode === 'paste' && !pastedText.trim()) { showToast('error', '请粘贴访谈/随笔文本'); return }
    if (mode === 'file' && !filePath) { showToast('error', '请选择文件'); return }

    setCreating(true)
    try {
      let text = ''
      if (mode === 'file') {
        text = await window.electronAPI.parseFile(filePath)
      } else if (mode === 'paste') {
        text = pastedText
      }
      // manual 模式不需要源文本

      if (mode !== 'manual' && (!text || text.trim().length < 200)) {
        showToast('error', '文本太少（不足200字），无法提取人格')
        setCreating(false)
        return
      }

      const newId = await create(name.trim(), text)
      if (newId !== null && newId !== undefined) {
        showToast('success', `人格项目「${name}」创建成功！${mode === 'manual' ? '请点击卡片进入手动填写。' : '请点击卡片进入提取。'}`)
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
    if (window.confirm(`确定要删除人格项目「${title}」吗？`)) {
      remove(id)
      showToast('success', `「${title}」已删除`)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-page-title text-text-main">人格库</h1>
        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors"
        >
          + 新建人格
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-text-secondary">
          <span className="text-5xl mb-4">🧠</span>
          <p className="text-body mb-2">还没有人格项目</p>
          <p className="text-caption">导入作者的访谈、随笔或创作谈，AI 提取写作人格模板</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((proj) => (
            <PersonalityCard
              key={proj.id}
              project={proj}
              onClick={() => navigate(`/personality/${proj.id}`)}
              onDelete={() => handleDelete(proj.id, proj.name)}
            />
          ))}
        </div>
      )}

      <Modal
        open={modalOpen}
        title="新建人格项目"
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
                创建并开始提取
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
              <label className="block text-body text-text-main mb-2">作者名 *</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="例如：鲁迅、余华" autoFocus
                className="w-full h-10 px-3 border border-border-input rounded-btn text-body focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 placeholder:text-text-placeholder" />
            </div>
            <div>
              <label className="block text-body text-text-main mb-2">创建方式</label>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => setMode('file')}
                  className={`px-4 py-2 rounded-btn text-body transition-colors ${mode === 'file' ? 'bg-primary text-white' : 'border border-border-input text-text-secondary hover:bg-bg-secondary'}`}>
                  📁 上传文件
                </button>
                <button onClick={() => setMode('paste')}
                  className={`px-4 py-2 rounded-btn text-body transition-colors ${mode === 'paste' ? 'bg-primary text-white' : 'border border-border-input text-text-secondary hover:bg-bg-secondary'}`}>
                  📋 粘贴文本
                </button>
                <button onClick={() => setMode('manual')}
                  className={`px-4 py-2 rounded-btn text-body transition-colors ${mode === 'manual' ? 'bg-primary text-white' : 'border border-border-input text-text-secondary hover:bg-bg-secondary'}`}>
                  ✍️ 手动创建
                </button>
              </div>
            </div>
            {mode === 'file' && (
              <div onClick={handleSelectFile}
                className="border-2 border-dashed border-border-input rounded-card p-8 text-center cursor-pointer hover:border-primary hover:bg-primary-light/30 transition-colors">
                <span className="text-3xl mb-2 block">📂</span>
                {fileName ? <p className="text-body text-text-main">{fileName}</p>
                  : <><p className="text-body text-text-secondary mb-1">点击选择文件</p>
                    <p className="text-caption text-text-placeholder">支持 TXT、Markdown</p></>}
              </div>
            )}
            {mode === 'paste' && (
              <textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)}
                placeholder="将访谈/随笔/创作谈全文粘贴到此处"
                rows={10}
                className="w-full px-3 py-2 border border-border-input rounded-btn text-body resize-none focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20 placeholder:text-text-placeholder" />
            )}
            {mode === 'manual' && (
              <p className="text-sm text-text-secondary py-4 text-center">
                创建一个空白人格项目，之后在详情页手动填写 5 个维度的写作人格字段。
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function PersonalityCard({ project, onClick, onDelete }: {
  project: PersonalityProject; onClick: () => void; onDelete: () => void
}) {
  const hasData = !!(project.personality_data?.emotional_intensity)

  return (
    <div onClick={onClick}
      className="bg-white rounded-card border border-border p-5 hover:shadow-md hover:border-primary/30 transition-all group cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-section-title text-text-main">
          <InlineEdit value={project.name} onSave={async (newName) => {
            if (window.electronAPI) { await window.electronAPI.db.run('UPDATE personality_projects SET name=? WHERE id=?', [newName, project.id]) }
          }} />
        </h3>
        <button onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 text-text-placeholder hover:text-danger transition-all">🗑</button>
      </div>
      <div className="space-y-1.5 text-caption">
        <div className="flex justify-between">
          <span className="text-text-placeholder">文本量：</span>
          <span className="text-text-secondary">{(project.source_text || '').length.toLocaleString()} 字</span>
        </div>
        <div className="flex justify-between">
          <span className="text-text-placeholder">状态：</span>
          <span className={`px-1.5 py-0.5 rounded text-xs ${hasData ? 'bg-green-100 text-green-700' : 'bg-primary-light text-primary'}`}>
            {hasData ? '已提取' : '待提取'}
          </span>
        </div>
        <div className="text-text-placeholder text-right">{project.created_at?.slice(0, 10)}</div>
      </div>
    </div>
  )
}
