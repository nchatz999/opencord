import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { MicOff, Headphones, Video, Monitor } from 'lucide-solid'
import { userDomain, voipDomain } from '../store'

const PrivateCallStatusPanel: Component = () => {
  const privateCallInfo = () => {
    const isInPrivateCall = voipDomain.getCurrent();
    if (!isInPrivateCall) return null
    if (!isInPrivateCall.recipientId) return null

    const currentUser = userDomain.getCurrent();
    const currentUserVoip = voipDomain.findById(currentUser.userId);
    const otherUser = userDomain.findById(isInPrivateCall.recipientId)
    if (!otherUser) return null
    const otherUserVoip = voipDomain.findById(otherUser.userId)

    return {
      currentUser,
      currentUserVoip,
      otherUser,
      otherUserVoip,
      currentUserConnected: true,
      otherUserConnected: otherUserVoip
        && otherUserVoip.recipientId
        && otherUserVoip.recipientId == currentUser.userId
    }
  }

  return (
    <Show when={privateCallInfo()}>
      {(info) => (
        <div class="bg-sidebar rounded-lg p-2 flex items-center gap-2">
          <div class="flex -space-x-2">
            <div class="relative z-10">
              <img
                src={`/user/${info().currentUser.avatarFileId}/avatar`}
                alt={info().currentUser.username}
                class="w-6 h-6 rounded-full border-2 border-sidebar"
              />
            </div>
            <div class="relative">
              <img
                src={`/user/${info().otherUser.avatarFileId}/avatar`}
                alt={info().otherUser.username}
                class="w-6 h-6 rounded-full border-2 border-sidebar"
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
              <MicOff size={12} class="text-red-400" />
            </Show>
            <Show when={info().currentUserVoip?.localDeafen}>
              <Headphones size={12} class="text-red-400" />
            </Show>
            <Show when={info().currentUserVoip?.publishCamera || info().otherUserVoip?.publishCamera}>
              <Video size={12} class="text-green-400" />
            </Show>
            <Show when={info().currentUserVoip?.publishScreen || info().otherUserVoip?.publishScreen}>
              <Monitor size={12} class="text-green-400" />
            </Show>
          </div>
        </div>
      )}
    </Show>
  )
}

export default PrivateCallStatusPanel
