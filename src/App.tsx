import { useEffect } from 'react'
import { Routes, Route } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import ProjectList from './components/project/ProjectList'
import LibraryList from './components/library/LibraryList'
import LibraryDetail from './components/library/LibraryDetail'
import DisassemblyList from './components/disassembly/DisassemblyList'
import DisassemblyDetail from './components/disassembly/DisassemblyDetail'
import Workspace from './components/writing/Workspace'
import SettingsPage from './components/settings/SettingsPage'
import ToastContainer, { showTokenToast } from './components/common/Toast'

function TokenListener() {
  useEffect(() => {
    if (!window.electronAPI?.tokens?.onLastUsage) return
    const unsub = window.electronAPI.tokens.onLastUsage((data) => {
      showTokenToast(data.promptTokens, data.cachedTokens, data.outputTokens, data.purpose)
    })
    return unsub
  }, [])
  return null
}

function App() {
  return (
    <>
      <TokenListener />
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<ProjectList />} />
          <Route path="/library" element={<LibraryList />} />
          <Route path="/library/:id" element={<LibraryDetail />} />
          <Route path="/disassembly" element={<DisassemblyList />} />
          <Route path="/disassembly/:id" element={<DisassemblyDetail />} />
          <Route path="/project/:id/workspace" element={<Workspace />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <ToastContainer />
    </>
  )
}

export default App
