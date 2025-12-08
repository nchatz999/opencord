import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { Mic, MicOff, Headphones, Settings, Circle } from 'lucide-solid'
import { microphone, modalDomain, userDomain, outputManager, voipDomain } from '../store'
import { fetchApi } from '../utils'
import { UserStatusType } from '../model'

const UserSection: Component = () => {
  const getStatusColor = (status: UserStatusType) => {
    switch (status) {
      case UserStatusType.Online:
        return 'text-green-500'
      case UserStatusType.Away:
        return 'text-yellow-500'
      case UserStatusType.DoNotDisturb:
        return 'text-red-500'
      case UserStatusType.Offline:
        return 'text-gray-500'
      default:
        return 'text-gray-500'
    }
  }

  const handleMuteToggle = async () => {
    microphone.setMuted(!microphone.getMuted())
    if (!voipDomain.getCurrent()) return
    await fetchApi("/voip/mute", {
      method: "PUT",
      body: {
        mute: microphone.getMuted()
      }
    })
  }

  const handleDeafenToggle = async () => {
    outputManager.setDeafened(!outputManager.getDeafened())
    if (!voipDomain.getCurrent()) return
    await fetchApi("/voip/deafen", {
      method: "PUT",
      body: {
        deafen: outputManager.getDeafened()
      }
    })
  }

  const handleUserSettings = () => {
    modalDomain.open({ type: 'userSettings', id: 0 })
  }

  return (
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <div class="relative">
          <img
            src={`/user/${userDomain.getCurrent().avatarFileId}/avatar`}
            alt={userDomain.getCurrent().username}
            class="w-8 h-8 rounded-full object-cover"
          />
        </div>

        <div class="flex-1 min-w-0">
          <div class="text-sm text-[#DBDEE1] font-medium truncate">
            {userDomain.getCurrent().username}
          </div>
          <div class="flex items-center gap-1 text-xs text-[#949ba4] truncate">
            <Circle
              size={8}
              class={`${getStatusColor(userDomain.getCurrent().status)} fill-current`}
            />
            <span>{userDomain.getCurrent().status}</span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <button
          onClick={handleMuteToggle}
          class={`p-2 rounded transition-colors ${microphone.getMuted()
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-[#383a40] hover:bg-[#2e3035] text-[#DBDEE1]'
            }`}
          title={microphone.getMuted() ? 'Unmute' : 'Mute'}
        >
          <Show when={microphone.getMuted()} fallback={<Mic size={16} />}>
            <MicOff size={16} />
          </Show>
        </button>

        <button
          onClick={handleDeafenToggle}
          class={`p-2 rounded transition-colors ${outputManager.getDeafened()
            ? 'bg-red-600 hover:bg-red-700 text-white'
            : 'bg-[#383a40] hover:bg-[#2e3035] text-[#DBDEE1]'
            }`}
          title={outputManager.getDeafened() ? 'Undeafen' : 'Deafen'}
        >
          <Headphones size={16} />
        </button>
      </div>

      <button
        onClick={handleUserSettings}
        class="p-2 bg-[#383a40] hover:bg-[#2e3035] text-[#DBDEE1] rounded transition-colors"
        title="User Settings"
      >
        <Settings size={16} />
      </button>
    </div>
  )
}

export default UserSection
