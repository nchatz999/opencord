import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { Mic, MicOff, Headphones, HeadphoneOff, Settings, Circle } from 'lucide-solid'
import Avatar from '../../components/Avatar'
import Button from '../../components/Button'
import { useAuth, useVoip, useModal, useMicrophone, useOutput } from '../../store/index'
import { getStatusColor } from '../../utils'

const UserSection: Component = () => {
  const [, authActions] = useAuth()
  const [, voipActions] = useVoip()
  const [, modalActions] = useModal()
  const [microphoneState, microphoneActions] = useMicrophone()
  const [, outputActions] = useOutput()
  const currentUser = () => authActions.getUser()

  const handleMuteToggle = async () => {
    const newMuted = !microphoneState.muted
    microphoneActions.setMuted(newMuted)
    if (!voipActions.findById(currentUser().userId)) return
    await voipActions.setMuted(newMuted)
  }

  const handleDeafenToggle = async () => {
    const newDeafened = !outputActions.getDeafened()
    outputActions.setDeafened(newDeafened)
    if (!voipActions.findById(currentUser().userId)) return
    await voipActions.setDeafened(newDeafened)
  }

  const handleUserSettings = async () => {
    modalActions.open({ type: 'userSettings' })
  }

  return (
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <Avatar
          avatarFileId={currentUser().avatarFileId}
          alt={currentUser().username}
          size="sm"
        />

        <div class="flex-1 min-w-0">
          <div class="text-sm text-foreground font-medium truncate">
            {currentUser().username}
          </div>
          <div class="flex items-center gap-1 text-xs text-muted-foreground truncate">
            <Circle
              size={8}
              class={`${getStatusColor(currentUser().status)} fill-current`}
            />
            <span>{currentUser().status}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <Button
          onClick={handleMuteToggle}
          variant={microphoneState.muted ? "destructive" : "secondary"}
          size="sm"
          class="p-2"
          title={microphoneState.muted ? 'Unmute' : 'Mute'}
        >
          <Show when={microphoneState.muted} fallback={<Mic size={16} />}>
            <MicOff size={16} />
          </Show>
        </Button>

        <Button
          onClick={handleDeafenToggle}
          variant={outputActions.getDeafened() ? "destructive" : "secondary"}
          size="sm"
          class="p-2"
          title={outputActions.getDeafened() ? 'Undeafen' : 'Deafen'}
        >
          <Show when={outputActions.getDeafened()} fallback={<Headphones size={16} />}>
            <HeadphoneOff size={16} />
          </Show>
        </Button>

        <Button
          onClick={handleUserSettings}
          variant="secondary"
          size="sm"
          class="p-2"
          title="User Settings"
        >
          <Settings size={16} />
        </Button>
      </div>
    </div>
  )
}

export default UserSection
