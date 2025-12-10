import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { Video, VideoOff, Monitor, MonitorOff, PhoneOff } from 'lucide-solid'
import { microphone, screenShare, camera, userDomain, voipDomain } from '../store'
import { fetchApi } from '../utils'
import Button from '../components/Button'
import { useToaster } from '../components/Toaster'

const VoiceVideoControls: Component = () => {
  const { addToast } = useToaster()

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

      if (result.isErr()) {
        addToast(`Failed to leave VoIP channel: ${result.error.reason}`, 'error')
      }
    } catch (error) {
      addToast('Error leaving VoIP channel', 'error')
    }
  }

  const handleScreenShare = async (isPublishing: boolean) => {
    if (isPublishing) {
      try {
        await screenShare.stop()
      } catch {
        addToast('Failed to stop screen sharing', 'error')
      }

      const result = await fetchApi('/voip/screen/publish', {
        method: 'PUT',
        body: { publish: false }
      })
      if (result.isErr()) {
        addToast(`Failed to unpublish screen stream: ${result.error.reason}`, 'error')
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
        addToast(`Failed to publish screen stream: ${result.error.reason}`, 'error')
      }
    } catch {
      addToast('Failed to start screen sharing', 'error')
    }
  }

  const handleCamera = async (isPublishing: boolean) => {
    if (isPublishing) {
      try {
        await camera.stop()
      } catch {
        addToast('Failed to stop camera', 'error')
      }

      const result = await fetchApi('/voip/camera/publish', {
        method: 'PUT',
        body: { publish: false }
      })
      if (result.isErr()) {
        addToast(`Failed to unpublish video stream: ${result.error.reason}`, 'error')
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
        addToast(`Failed to publish video stream: ${result.error.reason}`, 'error')
      }
    } catch {
      addToast('Failed to start camera', 'error')
    }
  }

  return (
    <div class="flex items-center gap-1">
      <Show when={voipDomain.getCurrent()}>
        {(voip) => (
          <Button
            variant='ghost'
            onClick={() => handleScreenShare(voip().publishScreen)}
            class={`p-2 rounded transition-colors ${voip().publishScreen
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-muted hover:bg-accent text-foreground'
              }`}
            title={voip().publishScreen ? 'Stop Screen Share' : 'Share Screen'}
          >
            <Show when={voip().publishScreen} fallback={<MonitorOff size={16} />}>
              <Monitor size={16} />
            </Show>
          </Button>
        )}
      </Show>

      <Show when={voipDomain.getCurrent()}>
        {(voip) => (
          <button
            onClick={() => handleCamera(voip().publishCamera)}
            class={`p-2 rounded transition-colors ${voip().publishCamera
              ? 'bg-green-600 hover:bg-green-700 text-white'
              : 'bg-muted hover:bg-accent text-foreground'
              }`}
            title={voip().publishCamera ? 'Turn Off Camera' : 'Turn On Camera'}
          >
            <Show when={voip().publishCamera} fallback={<VideoOff size={16} />}>
              <Video size={16} />
            </Show>
          </button>
        )}
      </Show>

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

export default VoiceVideoControls
