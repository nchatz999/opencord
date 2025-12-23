import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { MicOff, Headphones, Video, Monitor } from 'lucide-solid'
import { useAuth, useUser, useVoip } from '../../store/index'
import Avatar from '../../components/Avatar'

const PrivateCallStatusPanel: Component = () => {
  const [, authActions] = useAuth()
  const [, userActions] = useUser()
  const [, voipActions] = useVoip()
  const currentUser = () => authActions.getUser()

  const privateCallInfo = () => {
    const user = currentUser();
    const isInPrivateCall = voipActions.findById(user.userId);
    if (!isInPrivateCall) return null
    if (!isInPrivateCall.recipientId) return null

    const currentUserVoip = voipActions.findById(user.userId);
    const otherUser = userActions.findById(isInPrivateCall.recipientId)
    if (!otherUser) return null
    const otherUserVoip = voipActions.findById(otherUser.userId)

    return {
      currentUser: user,
      currentUserVoip,
      otherUser,
      otherUserVoip,
      currentUserConnected: true,
      otherUserConnected: otherUserVoip
        && otherUserVoip.recipientId
        && otherUserVoip.recipientId == user.userId
    }
  }

  return (
    <Show when={privateCallInfo()}>
      {(info) => (
        <div class="bg-sidebar rounded-lg p-2 flex items-center gap-2">
          <div class="flex -space-x-2">
            <div class="relative z-10">
              <Avatar
                avatarFileId={info().currentUser.avatarFileId}
                alt={info().currentUser.username}
                size="xs"
                class="border-2 border-sidebar"
              />
            </div>
            <div class="relative">
              <Avatar
                avatarFileId={info().otherUser.avatarFileId}
                alt={info().otherUser.username}
                size="xs"
                class="border-2 border-sidebar"
              />
              <div class={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-sidebar ${info().otherUserConnected ? 'bg-status-online' : 'bg-status-away'}`} />
            </div>
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1">
              <span class="text-xs text-foreground truncate">
                {info().otherUser.username}
              </span>
              <span class={`text-[10px] ${info().otherUserConnected ? 'text-status-online' : 'text-status-away'}`}>
                {info().otherUserConnected ? 'Connected' : 'Waiting'}
              </span>
            </div>
          </div>

          <div class="flex items-center gap-0.5">
            <Show when={info().currentUserVoip?.localMute}>
              <MicOff size={12} class="text-destructive" />
            </Show>
            <Show when={info().currentUserVoip?.localDeafen}>
              <Headphones size={12} class="text-destructive" />
            </Show>
            <Show when={info().currentUserVoip?.publishCamera || info().otherUserVoip?.publishCamera}>
              <Video size={12} class="text-action-positive" />
            </Show>
            <Show when={info().currentUserVoip?.publishScreen || info().otherUserVoip?.publishScreen}>
              <Monitor size={12} class="text-action-positive" />
            </Show>
          </div>
        </div>
      )}
    </Show>
  )
}

export default PrivateCallStatusPanel
