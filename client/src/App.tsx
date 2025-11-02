import type { Component } from 'solid-js'
import { onMount } from 'solid-js'

import LeftPanel from './containers/LeftPanel'
import MiddlePanel from './containers/MiddlePanel'
import RightPanel from './role/RightPanel'
import ModalManager from './containers/ModalManager'


const App: Component = () => {

  
  onMount(async () => {
  })
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
