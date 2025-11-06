import type { Component } from 'solid-js'
import { onMount, Show } from 'solid-js'

import LeftPanel from './containers/LeftPanel'
import MiddlePanel from './containers/MiddlePanel'
import RightPanel from './role/RightPanel'
import ModalManager from './containers/ModalManager'
import DebugOverlay from './components/DebugOverlay'


const App: Component = () => {

  
  onMount(async () => {
  })
  return (
    <div class="relative flex flex-row w-full h-screen w-screen">
      <LeftPanel />
      <MiddlePanel />
      <RightPanel />
      <ModalManager />
      <Show when={import.meta.env.VITE_DEBUG_OVERLAY === 'true'}>
        <DebugOverlay />
      </Show>
    </div>
  )
}

export default App
