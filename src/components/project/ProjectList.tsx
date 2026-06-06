import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Modal from '../common/Modal'
import { showToast } from '../common/Toast'
import InlineEdit from '../common/InlineEdit'
import { useProjectStore } from '../../store/projectStore'
import { IDEA_SYSTEM, IDEA_USER, GOLDEN_THREE_SYSTEM, GOLDEN_THREE_USER, REVERSE_OUTLINE_SYSTEM, REVERSE_OUTLINE_USER } from '../../services/generator'
import * as trackerService from '../../services/trackerService'

export default function ProjectList() {
  const [modalOpen, setModalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)

  // 黄金三章速写
  const [goldenModalOpen, setGoldenModalOpen] = useState(false)
  const [goldenInput, setGoldenInput] = useState('')
  const [goldenLoading, setGoldenLoading] = useState(false)
  const [goldenStep, setGoldenStep] = useState('')

  const handleGoldenThree = async () => {
    if (!goldenInput.trim()) { showToast('error', '请输入灵感描述'); return }
    if (!window.electronAPI) { showToast('error', '请在桌面应用中运行'); return }
    setGoldenLoading(true)
    try {
      // Step 1: 生成脑洞
      setGoldenStep('正在生成创意概念...')
      const ideaReply = await window.electronAPI.aiChat([
        { role: 'system', content: IDEA_SYSTEM },
        { role: 'user', content: IDEA_USER(goldenInput.trim()) },
      ], '灵感脑洞')
      const jm = ideaReply.match(/\{[\s\S]*\}/)
      if (!jm) { showToast('error', '创意生成失败'); setGoldenLoading(false); return }
      const ideaData = JSON.parse(jm[0])

      // Step 2: 创建项目（用梗概作书名）
      const projectTitle = (ideaData.hook || goldenInput).slice(0, 30)
      const result = await window.electronAPI.db.run(
        'INSERT INTO novel_projects (title, description) VALUES (?, ?)',
        [projectTitle, `灵感：${goldenInput.trim().slice(0, 200)}`]
      )
      const projectId = result.lastInsertRowid
      await useProjectStore.getState().load()

      // Step 3: 生成黄金三章
      setGoldenStep('正在写黄金三章...')
      const goldenReply = await window.electronAPI.aiChat([
        { role: 'system', content: GOLDEN_THREE_SYSTEM },
        { role: 'user', content: GOLDEN_THREE_USER(ideaData) },
      ], '黄金三章')
      const parts = goldenReply.split(/===\s*第\d+章\s*===/).filter(Boolean)
      const chapterTexts: string[] = []
      for (let i = 0; i < Math.min(parts.length, 3); i++) {
        const content = parts[i].trim()
        if (content) {
          chapterTexts.push(content)
          await window.electronAPI.db.run(
            'INSERT INTO chapters (project_id, chapter_number, title, content, word_count, status) VALUES (?,?,?,?,?,?)',
            [projectId, i + 1, `第${i + 1}章`, content, content.length, 'generated']
          )
        }
      }

      // Step 4: 反向提取大纲
      setGoldenStep('正在反向提取大纲...')
      const outlineReply = await window.electronAPI.aiChat([
        { role: 'system', content: REVERSE_OUTLINE_SYSTEM },
        { role: 'user', content: REVERSE_OUTLINE_USER(ideaData, chapterTexts) },
      ], '反向大纲')
      await window.electronAPI.db.run(
        'INSERT INTO outlines (project_id, content, version) VALUES (?,?,?)',
        [projectId, outlineReply, 1]
      )

      // Step 5: 提取总表
      setGoldenStep('正在提取角色和事件...')
      await trackerService.extractMasterFromOutline(projectId, outlineReply)

      setGoldenModalOpen(false)
      setGoldenInput('')
      setGoldenStep('')
      showToast('success', '黄金三章已生成！')
      navigate(`/project/${projectId}/workspace`)
    } catch (e: any) {
      showToast('error', '生成失败：' + (e.message || '未知'))
    } finally { setGoldenLoading(false) }
  }

  const navigate = useNavigate()
  const { projects, loaded, load, create, remove } = useProjectStore()

  // 启动时加载项目列表
  useEffect(() => {
    load()
  }, [])

  const handleCreate = async () => {
    if (!title.trim()) {
      showToast('error', '请输入书名')
      return
    }
    setCreating(true)
    try {
      const newId = await create(title.trim(), description.trim())
      if (newId) {
        showToast('success', `项目「${title}」创建成功！`)
        setModalOpen(false)
        setTitle('')
        setDescription('')
        navigate(`/project/${newId}/workspace`)
      } else {
        showToast('info', `项目「${title}」已记录（开发模式）`)
        setModalOpen(false)
        setTitle('')
        setDescription('')
      }
    } catch (e: any) {
      showToast('error', '创建失败：' + (e.message || '未知错误'))
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = (id: number, title: string) => {
    if (window.confirm(`确定要删除「${title}」吗？此操作不可恢复。`)) {
      remove(id)
      showToast('success', `「${title}」已删除`)
    }
  }

  const statusLabel: Record<string, string> = {
    outline: '大纲阶段',
    detailed_outline: '细纲阶段',
    writing: '写作中',
    completed: '已完成',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl text-text-main">我的小说</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setGoldenModalOpen(true)}
            className="px-4 py-2 border border-primary text-primary rounded-btn hover:bg-primary/5 transition-colors"
          >
            ✨ 灵感速写
          </button>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors"
          >
            + 新建项目
          </button>
        </div>
      </div>

      {/* 项目列表 或 空状态 */}
      {projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-text-secondary">
          <span className="text-5xl mb-4">📝</span>
          <p className="text-base mb-2">还没有小说项目</p>
          <p className="text-sm">点击「新建项目」开始你的创作之旅</p>
        </div>
      ) : (
        <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => navigate(`/project/${project.id}/workspace`)}
              className="bg-white rounded-card border border-border p-5 cursor-pointer
                         hover:shadow-md hover:border-primary/30 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg text-text-main">
                  <InlineEdit value={project.title} onSave={async (newName) => {
                    if (window.electronAPI) { await window.electronAPI.db.run('UPDATE novel_projects SET title=? WHERE id=?', [newName, project.id]) }
                  }} />
                </h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    handleDelete(project.id, project.title)
                  }}
                  className="opacity-0 group-hover:opacity-100 text-text-placeholder hover:text-danger transition-all"
                >
                  🗑
                </button>
              </div>
              {project.description && (
                <p className="text-sm text-text-secondary mb-3 line-clamp-2">
                  {project.description}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm px-2 py-0.5 rounded bg-primary-light text-primary">
                  {statusLabel[project.status] || project.status}
                </span>
                <span className="text-sm text-text-placeholder">
                  {project.updated_at?.slice(0, 10)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 新建项目弹窗 */}
      <Modal
        open={modalOpen}
        title="新建小说项目"
        onClose={() => { setModalOpen(false); setTitle(''); setDescription('') }}
        footer={
          <>
            <button
              onClick={() => { setModalOpen(false); setTitle(''); setDescription('') }}
              className="px-4 py-2 border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {creating ? '⏳ 创建中...' : '创建'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-base text-text-main mb-2">书名 *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="请输入小说书名"
              autoFocus
              className="w-full h-10 px-3 border border-border-input rounded-btn text-base
                         focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                         placeholder:text-text-placeholder"
            />
          </div>

          <div>
            <label className="block text-base text-text-main mb-2">简介</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简单描述一下你想写的故事（可选）"
              rows={4}
              className="w-full px-3 py-2 border border-border-input rounded-btn text-base resize-none
                         focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                         placeholder:text-text-placeholder"
            />
          </div>

          <p className="text-sm text-text-secondary">
            💡 创建项目后，你可以选择风格库，然后按「大纲 → 细纲 → 章节」的顺序生成小说。
          </p>
        </div>
      </Modal>

      {/* 灵感速写弹窗 */}
      <Modal
        open={goldenModalOpen}
        title="✨ 灵感速写 — 一键生成黄金三章"
        onClose={() => { setGoldenModalOpen(false); setGoldenInput(''); setGoldenStep('') }}
        footer={
          <>
            <button
              onClick={() => { setGoldenModalOpen(false); setGoldenInput(''); setGoldenStep('') }}
              className="px-4 py-2 border border-border-input text-text-secondary rounded-btn hover:bg-bg-secondary transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleGoldenThree}
              disabled={goldenLoading}
              className="px-4 py-2 bg-primary text-white rounded-btn hover:bg-primary-hover transition-colors disabled:opacity-50"
            >
              {goldenLoading ? '⏳ 生成中...' : '📖 生成黄金三章'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-base text-text-main mb-2">灵感描述 *</label>
            <textarea
              value={goldenInput}
              onChange={(e) => setGoldenInput(e.target.value)}
              placeholder="输入一句话灵感，如：一个能看见死亡倒计时的程序员，某天发现自己的倒计时停了…"
              rows={4}
              autoFocus
              className="w-full px-3 py-2 border border-border-input rounded-btn text-base resize-none
                         focus:outline-none focus:border-primary focus:ring-[3px] focus:ring-primary/20
                         placeholder:text-text-placeholder"
            />
          </div>
          {goldenLoading && goldenStep && (
            <div className="flex items-center gap-2 text-sm text-text-secondary">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              {goldenStep}
            </div>
          )}
          <p className="text-sm text-text-secondary">
            💡 AI 将依次完成：创意概念 → 黄金三章正文 → 反向提取大纲。<br />
            完成后自动创建项目并进入工作台。
          </p>
        </div>
      </Modal>
    </div>
  )
}
