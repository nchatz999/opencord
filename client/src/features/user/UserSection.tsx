import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { Mic, MicOff, Headphones, HeadphoneOff, Settings, Circle } from 'lucide-solid'
import { useAuth, useVoip, useModal, useMicrophone, useOutput } from '../../store/index'
import { getStatusColor } from '../../utils'

const UserSection: Component = () => {
  const [, authActions] = useAuth()
  const [, voipActions] = useVoip()
  const [, modalActions] = useModal()
  const [, microphoneActions] = useMicrophone()
  const [, outputActions] = useOutput()
  const currentUser = () => authActions.getUser()

  const handleMuteToggle = async () => {
    const newMuted = !microphoneActions.getMuted()
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
        <div class="relative">
          <img
            src={`/user/${currentUser().avatarFileId}/avatar`}
            alt={currentUser().username}
            class="w-8 h-8 rounded-full object-cover"
          />
        </div>

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
        <button
          onClick={handleMuteToggle}
          class={`p-2 rounded transition-colors ${microphoneActions.getMuted()
            ? 'bg-destructive hover:bg-destructive-hover text-destructive-foreground'
            : 'bg-muted hover:bg-accent text-foreground'
            }`}
          title={microphoneActions.getMuted() ? 'Unmute' : 'Mute'}
        >
          <Show when={microphoneActions.getMuted()} fallback={<Mic size={16} />}>
            <MicOff size={16} />
          </Show>
        </button>

        <button
          onClick={handleDeafenToggle}
          class={`p-2 rounded transition-colors ${outputActions.getDeafened()
            ? 'bg-destructive hover:bg-destructive-hover text-destructive-foreground'
            : 'bg-muted hover:bg-accent text-foreground'
            }`}
          title={outputActions.getDeafened() ? 'Undeafen' : 'Deafen'}
        >
          <Show when={outputActions.getDeafened()} fallback={<Headphones size={16} />}>
            <HeadphoneOff size={16} />
          </Show>
        </button>
      </div>

      <button
        onClick={handleUserSettings}
        class="p-2 bg-muted hover:bg-accent text-foreground rounded transition-colors"
        title="User Settings"
      >
        <Settings size={16} />
      </button>
    </div>
  )
}

export default UserSection
