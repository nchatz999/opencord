import type { Component } from 'solid-js'
import PrivateCallStatusPanel from '../voip/PrivateCallStatusPanel'
import ConnectionIndicator from './ConnectionIndicator'
import VoiceVideoControls from '../voip/VoiceVideoControls'
import UserSection from './UserSection'

const UserPanel: Component = () => {
    return (
        <div class="bg-bg-subtle px-2 py-3 w-full flex flex-col gap-3 border-t border-border-base">
            <PrivateCallStatusPanel />
            <ConnectionIndicator />
            <VoiceVideoControls />
            <UserSection />
        </div>
    )
}

export default UserPanel
