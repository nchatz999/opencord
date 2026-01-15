import type { Component } from 'solid-js'
import LeftPanel from './layouts/LeftPanel'
import MiddlePanel from './layouts/MiddlePanel'
import RightPanel from './features/role/RightPanel'
import ModalManager from './layouts/ModalManager'

const App: Component = () => {
  return (
    <div class="relative flex flex-row w-full h-screen w-screen">
      <LeftPanel />
      <MiddlePanel />
      <RightPanel />
      <ModalManager />
    </div>
  )
}

export default App
