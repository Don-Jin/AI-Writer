import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function AppLayout() {
  const location = useLocation()
  const isWorkspace = location.pathname.includes('/project/') && location.pathname.includes('/workspace')
  const [collapsed, setCollapsed] = useState(false)

  // 进入工作台自动收起，离开自动展开
  useEffect(() => {
    setCollapsed(isWorkspace)
  }, [isWorkspace])

  return (
    <div className="flex h-screen bg-bg-main">
      <Sidebar
        collapsed={collapsed}
        onToggle={collapsed ? () => setCollapsed(false) : () => setCollapsed(true)}
      />
      <main className={`flex-1 bg-bg-secondary flex flex-col ${isWorkspace ? 'overflow-hidden' : 'overflow-auto'}`}>
        <div className={isWorkspace ? 'flex-1 overflow-hidden' : 'p-8 overflow-auto'}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
