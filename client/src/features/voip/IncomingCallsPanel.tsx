import type { Component } from 'solid-js'
import { Show, For } from 'solid-js'
import { ChevronDown, ChevronRight, Phone } from 'lucide-solid'
import { useAuth, useUser, useVoip, usePreference, usePlayback, useMicrophone, useScreenShare, useCamera } from '../../store/index'
import Avatar from '../../components/Avatar'
import { useToaster } from '../../components/Toaster'

const COLLAPSED_KEY = 'incomingCallsCollapsed'

const IncomingCallsPanel: Component = () => {
  const [, prefActions] = usePreference()
  const [, authActions] = useAuth()
  const [, userActions] = useUser()
  const [voipState, voipActions] = useVoip()
  const [, playbackActions] = usePlayback()
  const [microphoneState, microphoneActions] = useMicrophone()
  const [screenShareState, screenShareActions] = useScreenShare()
  const [cameraState, cameraActions] = useCamera()
  const { addToast } = useToaster()

  const isCollapsed = () => prefActions.get<boolean>(COLLAPSED_KEY) ?? false

  const toggleCollapsed = () => {
    prefActions.set(COLLAPSED_KEY, !isCollapsed())
  }

  const currentUserId = () => authActions.getUser().userId

  const incomingCallers = () => {
    const userId = currentUserId()
    const isInCall = voipState.voipState.some(p => p.userId === userId)
    return voipState.voipState
      .filter(p => p.recipientId === userId && !isInCall)
      .map(p => ({
        participant: p,
        user: userActions.findById(p.userId)
      }))
      .filter(c => c.user !== undefined)
  }

  const handleCallback = async (callerId: number) => {
    if (screenShareState.isRecording) {
      screenShareActions.stop()
    }
    if (cameraState.isRecording) {
      cameraActions.stop()
    }

    const result = await voipActions.joinPrivate(
      callerId,
      microphoneState.muted,
      false
    )

    if (result.isErr()) {
      addToast(`Failed to join call: ${result.error}`, 'error')
      return
    }

    await microphoneActions.start()
    await playbackActions.resume()
  }

  return (
    <Show when={incomingCallers().length > 0}>
      <div class="bg-background-dark border-t border-border">
        <button
          onClick={toggleCollapsed}
          class="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted transition-colors"
        >
          <Show when={isCollapsed()} fallback={<ChevronDown size={14} class="text-muted-foreground-dark" />}>
            <ChevronRight size={14} class="text-muted-foreground-dark" />
          </Show>
          <span class="text-xs font-medium text-foreground">
            Incoming Calls ({incomingCallers().length})
          </span>
        </button>

        <Show when={!isCollapsed()}>
          <div class="max-h-24 overflow-y-auto scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
            <For each={incomingCallers()}>
              {(caller) => (
                <div class="px-3 py-1.5 flex items-center gap-2 hover:bg-muted transition-colors group">
                  <Avatar
                    avatarFileId={caller.user!.avatarFileId}
                    alt={caller.user!.username}
                    size="xs"
                  />
                  <span class="flex-1 text-sm text-foreground truncate">
                    {caller.user!.username}
                  </span>
                  <button
                    onClick={() => handleCallback(caller.user!.userId)}
                    class="p-1 rounded hover:bg-action-positive/20 transition-colors"
                    title="Answer Call"
                  >
                    <Phone size={14} class="text-action-positive" />
                  </button>
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}

export default IncomingCallsPanel
