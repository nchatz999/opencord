import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { Video, VideoOff, Monitor, MonitorOff, PhoneOff } from 'lucide-solid'
import { useAuth, useVoip, useMicrophone, useScreenShare, useCamera } from '../../store/index'
import Button from '../../components/Button'
import { useToaster } from '../../components/Toaster'

const isChromiumBased = (): boolean => {
  const userAgent = navigator.userAgent.toLowerCase()
  return userAgent.includes('chrome') || userAgent.includes('chromium') || userAgent.includes('edg')
}

const VoiceVideoControls: Component = () => {
  const { addToast } = useToaster()
  const [, authActions] = useAuth()
  const [, voipActions] = useVoip()
  const [, microphoneActions] = useMicrophone()
  const [, screenShareActions] = useScreenShare()
  const [, cameraActions] = useCamera()
  const user = () => authActions.getUser()

  const handleLeaveCall = async () => {
    const voipStatus = voipActions.findById(user().userId)
    if (!voipStatus) return

    try {
      if (microphoneActions.isRecording()) {
        microphoneActions.stop()
      }
      if (screenShareActions.isRecording()) {
        screenShareActions.stop()
      }
      if (cameraActions.isRecording()) {
        cameraActions.stop()
      }

      const result = await voipActions.leave()

      if (result.isErr()) {
        addToast(`Failed to leave VoIP channel: ${result.error}`, 'error')
      }
    } catch (error) {
      addToast('Error leaving VoIP channel', 'error')
    }
  }

  const handleScreenShare = async (isPublishing: boolean) => {
    if (isPublishing) {
      try {
        await screenShareActions.stop()
      } catch {
        addToast('Failed to stop screen sharing', 'error')
      }

      const result = await voipActions.publishScreen(false)
      if (result.isErr()) {
        addToast(`Failed to unpublish screen stream: ${result.error}`, 'error')
      }
      return
    }

    try {
      await screenShareActions.start()
      const result = await voipActions.publishScreen(true)
      if (result.isErr()) {
        addToast(`Failed to publish screen stream: ${result.error}`, 'error')
      }
    } catch {
      addToast('Failed to start screen sharing', 'error')
    }
  }

  const handleCamera = async (isPublishing: boolean) => {
    if (isPublishing) {
      try {
        await cameraActions.stop()
      } catch {
        addToast('Failed to stop camera', 'error')
      }

      const result = await voipActions.publishCamera(false)
      if (result.isErr()) {
        addToast(`Failed to unpublish video stream: ${result.error}`, 'error')
      }
      return
    }

    try {
      await cameraActions.start()
      const result = await voipActions.publishCamera(true)
      if (result.isErr()) {
        addToast(`Failed to publish video stream: ${result.error}`, 'error')
      }
    } catch {
      addToast('Failed to start camera', 'error')
    }
  }

  const currentVoip = () => voipActions.findById(user().userId)

  return (
    <div class="flex items-center gap-1">
      <Show when={isChromiumBased()}>
        <Show when={currentVoip()}>
          {(voip) => (
            <Button
              variant='ghost'
              onClick={() => handleScreenShare(voip().publishScreen)}
              class={`p-2 rounded transition-colors ${voip().publishScreen
                ? 'bg-action-positive hover:bg-action-positive-hover text-primary-foreground'
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
      </Show>

      <Show when={isChromiumBased()}>
        <Show when={currentVoip()}>
          {(voip) => (
            <button
              onClick={() => handleCamera(voip().publishCamera)}
              class={`p-2 rounded transition-colors ${voip().publishCamera
                ? 'bg-action-positive hover:bg-action-positive-hover text-primary-foreground'
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
      </Show>

      <Show when={currentVoip()}>
        <button
          onClick={handleLeaveCall}
          class="p-2 bg-destructive hover:bg-destructive-hover text-destructive-foreground rounded transition-colors"
          title="Leave Voice Channel"
        >
          <PhoneOff size={16} />
        </button>
      </Show>
    </div>
  )
}

export default VoiceVideoControls
