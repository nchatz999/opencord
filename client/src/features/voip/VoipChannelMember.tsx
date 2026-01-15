import type { Component } from "solid-js";
import { Show } from "solid-js";
import {
    MicOff,
    VolumeX,
    Monitor,
    Video,
} from "lucide-solid";
import type { VoipParticipant } from "../../model";
import { useAcl, useAuth, useModal, useUser } from "../../store/index";
import { useLiveKit } from "../../lib/livekit";
import Avatar from "../../components/Avatar";


export const VoipChannelMember: Component<{ participant: VoipParticipant; channelId: number }> = (props) => {
    const [, aclActions] = useAcl();
    const [, modalActions] = useModal();
    const [, userActions] = useUser();
    const [, livekitActions] = useLiveKit();

    const user = () => userActions.findById(props.participant.userId);
    const volume = () => Math.round(livekitActions.getVolume(props.participant.userId));
    const isSpeaking = () => livekitActions.getSpeakingState(props.participant.userId);

    const openSettings = (e: MouseEvent) => {
        e.preventDefault();
        modalActions.open({ type: "voipUserSettings", publisherId: props.participant.userId, callType: "channel" });
    };

    return (
        <Show when={user()}>
            {(u) => (
                <div
                    class="flex items-center gap-2 px-2 py-1 text-fg-muted hover:bg-bg-overlay rounded transition-all cursor-pointer"
                    onContextMenu={openSettings}
                >
                    <div class="relative shrink-0">
                        <div class={`rounded-full p-0.5 transition-all duration-200 ${isSpeaking() ? 'bg-status-success shadow-lg shadow-status-success/50' : ''}`}>
                            <Avatar
                                avatarFileId={u().avatarFileId}
                                alt={u().username}
                                size="xs"
                            />
                        </div>
                        <div class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-bg-elevated bg-presence-online" />
                    </div>
                    <div class="flex items-center gap-1 flex-1 min-w-0">
                        <span class="text-xs truncate">{u().username}</span>

                        <div class="flex items-center gap-1 shrink-0">
                            <Show when={props.participant.localMute}>
                                <div class="p-0.5 bg-accent-secondary rounded-full" title="User is muted">
                                    <MicOff size={8} class="text-accent-primary-fg" />
                                </div>
                            </Show>

                            <Show when={props.participant.localDeafen}>
                                <div
                                    class="p-0.5 bg-accent-secondary rounded-full"
                                    title="User is deafened"
                                >
                                    <VolumeX size={8} class="text-accent-primary-fg" />
                                </div>
                            </Show>

                            <Show when={aclActions.getChannelRights(props.channelId, u().roleId) <= 2}>
                                <div class="p-0.5 bg-status-danger rounded-full" title="Server muted">
                                    <MicOff size={8} class="text-accent-primary-fg" />
                                </div>
                            </Show>

                            <Show when={volume() === 0}>
                                <div class="p-0.5 bg-status-danger rounded-full" title="Locally muted">
                                    <VolumeX size={8} class="text-status-danger-fg" />
                                </div>
                            </Show>

                            <Show when={props.participant.publishScreen}>
                                <div class="p-0.5 bg-accent-link rounded-full" title="Sharing screen">
                                    <Monitor size={8} class="text-accent-primary-fg" />
                                </div>
                            </Show>

                            <Show when={props.participant.publishCamera}>
                                <div class="p-0.5 bg-status-success rounded-full" title="Camera on">
                                    <Video size={8} class="text-accent-primary-fg" />
                                </div>
                            </Show>
                        </div>
                    </div>
                </div>
            )}
        </Show>
    );
};
