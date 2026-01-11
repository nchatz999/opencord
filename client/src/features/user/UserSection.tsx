import type { Component } from 'solid-js'
import { Show } from 'solid-js'
import { Mic, MicOff, Headphones, HeadphoneOff, Settings, Circle } from 'lucide-solid'
import Avatar from '../../components/Avatar'
import Button from '../../components/Button'
import { useAuth, useVoip, useModal, useSound } from '../../store/index'
import { getStatusColor } from '../../utils'
import { getLiveKitManager } from '../../lib/livekit'

const UserSection: Component = () => {
    const [, authActions] = useAuth()
    const [, voipActions] = useVoip()
    const [, modalActions] = useModal()
    const [, soundActions] = useSound();
    const livekit = getLiveKitManager();
    const currentUser = () => authActions.getUser()
    const isMuted = () => livekit.getMuted()

    const handleMuteToggle = async () => {
        const newMuted = !isMuted()
        await voipActions.setMuted(newMuted)
        soundActions.play(newMuted ? "/sounds/mute.ogg" : "/sounds/unmute.ogg");
    }

    const handleDeafenToggle = async () => {
        const newDeafened = !livekit.getDeafened()
        livekit.setDeafened(newDeafened)
        await voipActions.setDeafened(newDeafened)
        soundActions.play(newDeafened ? "/sounds/deafen.ogg" : "/sounds/undeafen.ogg");
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
                    variant={isMuted() ? "destructive" : "secondary"}
                    size="sm"
                    class="p-2"
                    title={isMuted() ? 'Unmute' : 'Mute'}
                >
                    <Show when={isMuted()} fallback={<Mic size={16} />}>
                        <MicOff size={16} />
                    </Show>
                </Button>

                <Button
                    onClick={handleDeafenToggle}
                    variant={livekit.getDeafened() ? "destructive" : "secondary"}
                    size="sm"
                    class="p-2"
                    title={livekit.getDeafened() ? 'Undeafen' : 'Deafen'}
                >
                    <Show when={livekit.getDeafened()} fallback={<Headphones size={16} />}>
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
