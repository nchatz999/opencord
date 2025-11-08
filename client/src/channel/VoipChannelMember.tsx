import type { Component } from "solid-js";
import { Show } from "solid-js";
import {
  MicOff,
  VolumeX,
  Monitor,
  Video,
} from "lucide-solid";
import type { VoipParticipantWithUser } from "../model";
import { useToaster } from "../components/Toaster";
import { aclDomain, voipDomain } from "../store";
import type { ContextMenuItem } from "../components/ContextMenu";
import Slider from "../components/Slider";
import ContextMenu from "../components/ContextMenu";


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

export const VoipChannelMember: Component<{ participant: VoipParticipantWithUser; channelId: number }> = (props) => {

  const volume = () => Math.round(voipDomain.getUserVolume(props.participant.user.userId));
  const isSpeaking = () => props.participant.playback?.getIsSpeaking() || false;

  const { addToast } = useToaster();

  const contextMenuItems = (): ContextMenuItem[] => {


    return [
      {
        id: "volume",
        label: `Volume: ${volume()}%`,
        onClick: () => { },
        customContent: (
          <div class="flex flex-col gap-2">
            <div class="flex items-center gap-2 text-sm text-[#DBDEE1]">
              <VolumeIcon volume={volume()} />
              <span>Volume: {volume()}%</span>
            </div>
            <Slider
              value={volume()}
              min={0}
              max={200}
              onChange={(value) => {
                voipDomain.setUserVolume(props.participant.user.userId, value)
              }}
            />
          </div>
        ),
      },
      {
        id: "separator-1",
        label: "",
        separator: true,
        onClick: () => { },
      },
      {
        id: "separator-2",
        label: "",
        separator: true,
        onClick: () => { },
      },
      {
        id: "kick",
        label: "Kick from Channel",
        icon: <KickUserIcon />,
        danger: true,
        onClick: () => {
          addToast("Kick from channel feature coming soon", "success");
        },
      },
    ];
  };

  return (

    <ContextMenu items={contextMenuItems()}>
      <div class="flex items-center gap-2 px-2 py-1 text-[#949ba4] hover:bg-[#383a40] rounded transition-all">
        <div class="relative shrink-0">
          <div class={`rounded-full p-0.5 transition-all duration-200 ${isSpeaking() ? 'bg-green-500 shadow-lg shadow-green-500/50' : ''}`}>
            <img
              src={`/api/user/${props.participant.user.avatarFileId}/avatar`}
              alt={props.participant.user.username}
              class="w-6 h-6 rounded-full"
            />
          </div>
          <div class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-[#2b2d31] bg-green-500" />
        </div>
        <div class="flex items-center gap-1 flex-1 min-w-0">
          <span class="text-xs truncate">{props.participant.user.username}</span>

          {}
          <div class="flex items-center gap-1 shrink-0">
            {}
            <Show when={props.participant.localMute}>
              <div class="p-0.5 bg-gray-600 rounded-full" title="User is muted">
                <MicOff size={8} class="text-white" />
              </div>
            </Show>

            {}
            <Show when={props.participant.localDeafen}>
              <div
                class="p-0.5 bg-gray-600 rounded-full"
                title="User is deafened"
              >
                <VolumeX size={8} class="text-white" />
              </div>
            </Show>

            {}
            <Show when={aclDomain.getRightsForChannelRole(props.channelId, props.participant.user.roleId) <= 2}>
              <div class="p-0.5 bg-red-800 rounded-full" title="Server muted">
                <MicOff size={8} class="text-white" />
              </div>
            </Show>

            <Show when={props.participant.publishScreen}>
              <div class="p-0.5 bg-blue-600 rounded-full" title="Sharing screen">
                <Monitor size={8} class="text-white" />
              </div>
            </Show>

            <Show when={props.participant.publishCamera}>
              <div class="p-0.5 bg-green-600 rounded-full" title="Camera on">
                <Video size={8} class="text-white" />
              </div>
            </Show>

          </div>

        </div>
      </div>
    </ContextMenu>

  );
};
