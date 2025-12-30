import type { Component } from "solid-js";
import { Show } from "solid-js";
import {
  MicOff,
  VolumeX,
  Volume2,
  Monitor,
  Video,
} from "lucide-solid";
import type { VoipParticipant } from "../../model";
import { useToaster } from "../../components/Toaster";
import { useAcl, useAuth, usePlayback, useUser, useVoip } from "../../store/index";
import type { ContextMenuItem } from "../../components/ContextMenu";
import Slider from "../../components/Slider";
import ContextMenu from "../../components/ContextMenu";
import Avatar from "../../components/Avatar";


const KickUserIcon: Component = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path
      d="M9 9l6 6M15 9l-6 6M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
  </svg>
);

const VolumeIcon: Component<{ volume: number }> = (props) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
    <path d="M3 9v6h4l5 5V4L7 9H3z" fill="currentColor" />
    <Show when={props.volume > 50}>
      <path
        d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </Show>
    <Show when={props.volume > 100}>
      <path
        d="M19 12c0 3.53-2.04 6.58-5 8.05"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </Show>
  </svg>
);

export const VoipChannelMember: Component<{ participant: VoipParticipant; channelId: number }> = (props) => {
  const [, aclActions] = useAcl();
  const [, authActions] = useAuth();
  const [, playbackActions] = usePlayback();
  const [, userActions] = useUser();
  const [, voipActions] = useVoip();

  const user = () => userActions.findById(props.participant.userId);
  const currentUser = () => authActions.getUser();
  const volume = () => Math.round(playbackActions.getVolume(props.participant.userId, "channel"));
  const isSpeaking = () => playbackActions.getSpeakingState(props.participant.userId);

  const canKick = () => {
    const myRights = aclActions.getChannelRights(props.channelId, currentUser().roleId);
    if (myRights < 8) return false;

    const targetRole = user()?.roleId ?? 999;
    const myRole = currentUser().roleId;

    if (targetRole === 1 && myRole > 1) return false;
    if (targetRole === 2 && myRole > 2) return false;

    return true;
  };

  const { addToast } = useToaster();
  const contextMenuItems = (): ContextMenuItem[] => [
    {
      id: "volume",
      label: `Volume: ${volume()}%`,
      onClick: () => { },
      customContent: (
        <div class="flex flex-col gap-2">
          <div class="flex items-center gap-2 text-sm text-foreground">
            <VolumeIcon volume={volume()} />
            <span>Volume: {volume()}%</span>
          </div>
          <Slider
            value={volume()}
            min={0}
            max={200}
            onChange={(value) => {
              playbackActions.adjustVolume(props.participant.userId, value, "channel")
            }}
          />
        </div>
      ),
    },
    {
      id: "mute-toggle",
      label: volume() === 0 ? "Unmute" : "Mute",
      icon: volume() === 0 ? <Volume2 size={14} /> : <VolumeX size={14} />,
      onClick: () => {
        playbackActions.adjustVolume(props.participant.userId, volume() === 0 ? 100 : 0, "channel");
      },
    },
    {
      id: "separator-1",
      label: "",
      separator: true,
      onClick: () => { },
    },
    {
      id: "kick",
      label: "Kick from Channel",
      icon: <KickUserIcon />,
      danger: true,
      disabled: !canKick(),
      onClick: async () => {
        const result = await voipActions.kick(props.participant.userId);
        if (result.isErr()) {
          addToast(result.error, "error");
        }
      },
    },
  ];

  return (
    <Show when={user()}>
      {(u) => (
        <ContextMenu items={contextMenuItems()}>
          <div class="flex items-center gap-2 px-2 py-1 text-muted-foreground hover:bg-muted rounded transition-all">
            <div class="relative shrink-0">
              <div class={`rounded-full p-0.5 transition-all duration-200 ${isSpeaking() ? 'bg-success shadow-lg shadow-success/50' : ''}`}>
                <Avatar
                  avatarFileId={u().avatarFileId}
                  alt={u().username}
                  size="xs"
                />
              </div>
              <div class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar bg-status-online" />
            </div>
            <div class="flex items-center gap-1 flex-1 min-w-0">
              <span class="text-xs truncate">{u().username}</span>

              <div class="flex items-center gap-1 shrink-0">
                <Show when={props.participant.localMute}>
                  <div class="p-0.5 bg-secondary rounded-full" title="User is muted">
                    <MicOff size={8} class="text-primary-foreground" />
                  </div>
                </Show>

                <Show when={props.participant.localDeafen}>
                  <div
                    class="p-0.5 bg-secondary rounded-full"
                    title="User is deafened"
                  >
                    <VolumeX size={8} class="text-primary-foreground" />
                  </div>
                </Show>

                <Show when={aclActions.getChannelRights(props.channelId, u().roleId) <= 2}>
                  <div class="p-0.5 bg-action-negative rounded-full" title="Server muted">
                    <MicOff size={8} class="text-primary-foreground" />
                  </div>
                </Show>

                <Show when={volume() === 0}>
                  <div class="p-0.5 bg-destructive rounded-full" title="Locally muted">
                    <VolumeX size={8} class="text-destructive-foreground" />
                  </div>
                </Show>

                <Show when={props.participant.publishScreen}>
                  <div class="p-0.5 bg-link rounded-full" title="Sharing screen">
                    <Monitor size={8} class="text-primary-foreground" />
                  </div>
                </Show>

                <Show when={props.participant.publishCamera}>
                  <div class="p-0.5 bg-action-positive rounded-full" title="Camera on">
                    <Video size={8} class="text-primary-foreground" />
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </ContextMenu>
      )}
    </Show>
  );
};
