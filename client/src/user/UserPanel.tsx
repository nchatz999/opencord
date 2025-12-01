import type { Component } from 'solid-js'
import { createMemo, Show } from 'solid-js'

import {
  Mic,
  MicOff,
  Headphones,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  PhoneOff,
  Settings,
  Wifi,
  Circle,
} from 'lucide-solid'
import { microphone, screenShare, camera, modalDomain, userDomain, voipDomain, outputManager } from '../store'
import { fetchApi } from '../utils'
import { UserStatusType } from '../model'
import Button from '../components/Button'

const UserPanel: Component = () => {



  const PrivateCallStatusPanel: Component = () => {

    const privateCallInfo = () => {

      let isInPrivateCall = voipDomain.getCurrent();
      if (!isInPrivateCall) return null
      if (!isInPrivateCall.recipientId) return null

      let currentUser = userDomain.getCurrent();
      let currentUserVoip = voipDomain.findById(currentUser.userId);
      let otherUser = userDomain.findById(isInPrivateCall.recipientId)
      if (!otherUser) return null
      let otherUserVoip = voipDomain.findById(otherUser.userId)

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
          <div class="bg-[#2b2d31] rounded-lg p-2 flex items-center gap-2">
            {/* Avatars stacked */}
            <div class="flex -space-x-2">
              <div class="relative z-10">
                <img
                  src={`/api/user/${info().currentUser.avatarFileId}/avatar`}
                  alt={info().currentUser.username}
                  class="w-6 h-6 rounded-full border-2 border-[#2b2d31]"
                />
              </div>
              <div class="relative">
                <img
                  src={`/api/user/${info().otherUser.avatarFileId}/avatar`}
                  alt={info().otherUser.username}
                  class="w-6 h-6 rounded-full border-2 border-[#2b2d31]"
                />
                <div class={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[#2b2d31] ${info().otherUserConnected ? 'bg-green-500' : 'bg-yellow-500'}`} />
              </div>
            </div>

            {/* Call info */}
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1">
                <span class="text-xs text-[#DBDEE1] truncate">
                  {info().otherUser.username}
                </span>
                <span class={`text-[10px] ${info().otherUserConnected ? 'text-green-400' : 'text-yellow-400'}`}>
                  {info().otherUserConnected ? 'Connected' : 'Waiting'}
                </span>
              </div>
            </div>

            {/* Status indicators */}
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


  const ConnectionIndicator: Component = () => {


    const statusConfig = createMemo(() => {
      return {
        color: 'text-green-500',
        icon: Wifi,
        label: 'Connected',
        pulseColor: 'bg-green-500',
        showPulse: false,
      }
    })

    return (
      <div class="flex items-center gap-2 text-sm">
        <div class="relative">
          {(() => {
            const Icon = statusConfig().icon
            return <Icon size={16} class={statusConfig().color} />
          })()}
          <Show when={statusConfig().showPulse}>
            <div
              class={`absolute -inset-1 rounded-full ${statusConfig().pulseColor
                } opacity-25 animate-ping`}
            />
          </Show>
        </div>
        <span class={statusConfig().color}>{statusConfig().label}</span>
      </div>
    )
  }


  const VoiceVideoControls: Component = () => {

    const handleLeaveCall = async () => {
      const voipStatus = voipDomain.findById(userDomain.getCurrent().userId)
      if (!voipStatus) return

      try {

        if (microphone.isRecording()) {
          microphone.stop()
        }
        if (screenShare.isRecording()) {
          screenShare.stop()
        }
        if (camera.isRecording()) {
          camera.stop()
        }

        const result = await fetchApi('/voip/leave', { method: 'POST' })

        if (result.isOk()) {
          console.log('Successfully left VoIP channel')

        } else {
          console.error('Failed to leave VoIP channel:', result.error)
        }
      } catch (error) {
        console.error('Error leaving VoIP channel:', error)
      }
    }

    return (
      <div class="flex items-center gap-1">
        {}
        <Show when={voipDomain.getCurrent()}>
          {(voip) => (
            <Button
              variant='ghost'
              onClick={async () => {
                if (voip().publishScreen) {

                  try {
                    await screenShare.stop()
                  } catch (error) {
                    console.error('Failed to stop screen sharing:', error)
                  }

                  const result = await fetchApi('/voip/screen/publish', {
                    method: 'PUT',
                    body: { publish: false }
                  })
                  if (result.isErr()) {
                    console.error('Failed to unpublish screen stream:', result.error)
                  }
                  return
                }


                try {
                  await screenShare.start()
                  const result = await fetchApi('/voip/screen/publish', {
                    method: 'PUT',
                    body: { publish: true }
                  })
                  if (result.isErr()) {
                    console.error('Failed to publish screen stream:', result.error)
                  }
                } catch (error) {
                  console.error('Failed to start screen sharing:', error)
                }
              }}
              class={`p-2 rounded transition-colors ${voip().publishScreen
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-[#383a40] hover:bg-[#2e3035] text-[#DBDEE1]'
                }`}
              title={
                voip().publishScreen ? 'Stop Screen Share' : 'Share Screen'
              }
            >
              <Show
                when={voip().publishScreen}
                fallback={<MonitorOff size={16} />}
              >
                <Monitor size={16} />
              </Show>
            </Button>
          )}
        </Show>

        {}
        <Show when={voipDomain.getCurrent()}>
          {(voip) => (
            <button
              onClick={async () => {

                if (voip().publishCamera) {

                  try {
                    await camera.stop()
                  } catch (error) {
                    console.error('Failed to stop camera:', error)
                  }

                  const result = await fetchApi('/voip/camera/publish', {
                    method: 'PUT',
                    body: { publish: false }
                  })
                  if (result.isErr()) {
                    console.error('Failed to unpublish video stream:', result.error)
                  }
                  return
                }


                try {
                  await camera.start()
                  const result = await fetchApi('/voip/camera/publish', {
                    method: 'PUT',
                    body: { publish: true }
                  })
                  if (result.isErr()) {
                    console.error('Failed to publish video stream:', result.error)
                  }
                } catch (error) {
                  console.error('Failed to start camera:', error)
                }
              }}
              class={`p-2 rounded transition-colors ${voip().publishCamera
                ? 'bg-green-600 hover:bg-green-700 text-white'
                : 'bg-[#383a40] hover:bg-[#2e3035] text-[#DBDEE1]'
                }`}
              title={
                voip().publishCamera ? 'Turn Off Camera' : 'Turn On Camera'
              }
            >
              <Show
                when={voip().publishCamera}
                fallback={<VideoOff size={16} />}
              >
                <Video size={16} />
              </Show>
            </button>
          )}
        </Show>

        {}
        <Show when={voipDomain.getCurrent()}>
          <button
            onClick={handleLeaveCall}
            class="p-2 bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
            title="Leave Voice Channel"
          >
            <PhoneOff size={16} />
          </button>
        </Show>
      </div>
    )
  }


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
        {}
        <div class="flex items-center gap-2 flex-1 min-w-0">
          <div class="relative">
            <img
              src={`/api/user/${userDomain.getCurrent().avatarFileId
                }/avatar`}
              alt={userDomain.getCurrent().username}
              class="w-8 h-8 rounded-full object-cover"
            />
            {}
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

        {}
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
            title={microphone.getMuted() ? 'Undeafen' : 'Deafen'}
          >
            <Headphones size={16} />
          </button>
        </div>

        {}
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

  return (
    <div class="bg-[#232428] px-2 py-3 w-full flex flex-col gap-3 border-t border-[#1e1f22]">
      {}
      <PrivateCallStatusPanel />

      {}
      <ConnectionIndicator />

      {}
      <VoiceVideoControls />

      {}
      <UserSection />
    </div>
  )
}

export default UserPanel
