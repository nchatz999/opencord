import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { Video, VideoOff, Monitor, MonitorOff, PhoneOff } from 'lucide-solid'
import { useAuth, useVoip } from '../../store/index'
import Button from '../../components/Button'
import { useToaster } from '../../components/Toaster'

const VoiceVideoControls: Component = () => {
    const { addToast } = useToaster()
    const [, authActions] = useAuth()
    const [, voipActions] = useVoip()
    const user = () => authActions.getUser()

    const handleLeaveCall = async () => {
        const voipStatus = voipActions.findById(user().userId)
        if (!voipStatus) return

        const result = await voipActions.leave()
        if (result.isErr()) {
            addToast(`Failed to leave VoIP channel: ${result.error}`, 'error')
        }
    }

    const handleScreenShare = async (isPublishing: boolean) => {
        const result = await voipActions.publishScreen(!isPublishing)
        if (result.isErr()) {
            addToast(`Failed to ${isPublishing ? 'stop' : 'start'} screen sharing: ${result.error}`, 'error')
        }
    }

    const handleCamera = async (isPublishing: boolean) => {
        const result = await voipActions.publishCamera(!isPublishing)
        if (result.isErr()) {
            addToast(`Failed to ${isPublishing ? 'stop' : 'start'} camera: ${result.error}`, 'error')
        }
    }

    const currentVoip = () => voipActions.findById(user().userId)

    return (
        <div class="flex items-center gap-1">
            <Show when={currentVoip()}>
                {(voip) => (
                    <Button
                        variant={voip().publishScreen ? "success" : "secondary"}
                        size="sm"
                        class="p-2"
                        onClick={() => handleScreenShare(voip().publishScreen)}
                        title={voip().publishScreen ? 'Stop Screen Share' : 'Share Screen'}
                    >
                        <Show when={voip().publishScreen} fallback={<MonitorOff size={16} />}>
                            <Monitor size={16} />
                        </Show>
                    </Button>
                )}
            </Show>

            <Show when={currentVoip()}>
                {(voip) => (
                    <Button
                        variant={voip().publishCamera ? "success" : "secondary"}
                        size="sm"
                        class="p-2"
                        onClick={() => handleCamera(voip().publishCamera)}
                        title={voip().publishCamera ? 'Turn Off Camera' : 'Turn On Camera'}
                    >
                        <Show when={voip().publishCamera} fallback={<VideoOff size={16} />}>
                            <Video size={16} />
                        </Show>
                    </Button>
                )}
            </Show>

            <Show when={currentVoip()}>
                <Button
                    onClick={handleLeaveCall}
                    variant="destructive"
                    size="sm"
                    class="p-2"
                    title="Leave Voice Channel"
                >
                    <PhoneOff size={16} />
                </Button>
            </Show>
        </div>
    )
}

export default VoiceVideoControls
