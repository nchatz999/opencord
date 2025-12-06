import type { Component } from 'solid-js'
import PrivateCallStatusPanel from './PrivateCallStatusPanel'
import ConnectionIndicator from './ConnectionIndicator'
import VoiceVideoControls from './VoiceVideoControls'
import UserSection from './UserSection'

const UserPanel: Component = () => {
  return (
    <div class="bg-[#232428] px-2 py-3 w-full flex flex-col gap-3 border-t border-[#1e1f22]">
      <PrivateCallStatusPanel />
      <ConnectionIndicator />
      <VoiceVideoControls />
      <UserSection />
    </div>
  )
}

export default UserPanel
