import { Show, type Component } from 'solid-js'
import LeftPanel from './layouts/LeftPanel'
import MiddlePanel from './layouts/MiddlePanel'
import RightPanel from './features/role/RightPanel'
import ModalManager from './layouts/ModalManager'
import DebugOverlay from './components/DebugOverlay'
import EventDebugOverlay from './components/EventDebugOverlay'


const App: Component = () => {

  return (
    <div class="relative flex flex-row w-full h-screen w-screen">
      <LeftPanel />
      <MiddlePanel />
      <RightPanel />
      <ModalManager />
      <Show when={import.meta.env.VITE_DEBUG_OVERLAY === 'true'}>
        <DebugOverlay />
        <EventDebugOverlay />
      </Show>
    </div>
  )
}

export default App
