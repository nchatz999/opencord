import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { Hash, Volume2, Lock } from "lucide-solid";

import { VoipChannelMember } from "../voip/VoipChannelMember";
import { ChannelType, type Channel } from "../../model";
import { useContext, useModal, useVoip, usePlayback, useMicrophone, useScreenShare, useCamera, useOutput, useAcl, useAuth } from "../../store/index";
import { useToaster } from "../../components/Toaster";

export const ChannelEntry: Component<{
  channel: Channel;
}> = (props) => {
  const [, contextActions] = useContext();
  const hasUnread = () => props.channel.channelType === ChannelType.Text && contextActions.hasUnread("channel", props.channel.channelId);
  const [, modalActions] = useModal();
  const [, voipActions] = useVoip();
  const [, playbackActions] = usePlayback();
  const [microphoneState, microphoneActions] = useMicrophone();
  const [, outputActions] = useOutput()
  const [screenShareState, screenShareActions] = useScreenShare();
  const [cameraState, cameraActions] = useCamera();
  const [, aclActions] = useAcl();
  const [, authActions] = useAuth();

  const { addToast } = useToaster();

  const isReadOnly = () => aclActions.getChannelRights(props.channel.channelId, authActions.getUser().roleId) === 1;

  const handleChannelClick = async (channel: Channel) => {
    if (channel.channelType === ChannelType.Text) {
      contextActions.set({ type: "channel", id: channel.channelId });
    }

    if (channel.channelType === ChannelType.VoIP) {

      if (screenShareState.isRecording) {
        screenShareActions.stop();
      }
      if (cameraState.isRecording) {
        cameraActions.stop();
      }

      const result = await voipActions.joinChannel(
        channel.channelId,
        microphoneState.muted,
        outputActions.getDeafened()
      );
      if (result.isErr()) {
        addToast(`Failed to join channel: ${result.error}`, "error");
        return;
      }
      await microphoneActions.start();
      await playbackActions.resume();
    }
  };

  const joinedUsers = () => voipActions.findByChannel(props.channel.channelId);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    modalActions.open({ type: "channelSettings", channelId: props.channel.channelId });
  };

  return (
    <div>
      <button
        onClick={async () => await handleChannelClick(props.channel)}
        onContextMenu={handleContextMenu}
        class="flex items-center gap-2 w-full px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all group disabled:opacity-50 disabled:pointer-events-none"
        disabled={isReadOnly()}
      >
        <Show
          when={props.channel.channelType === "VoIP"}
          fallback={<Hash size={16} class="shrink-0" classList={{ "text-foreground": hasUnread() }} />}
        >
          <Volume2 size={16} class="shrink-0" classList={{ "text-foreground": hasUnread() }} />
        </Show>
        <span class="text-sm truncate" classList={{ "text-foreground font-medium": hasUnread() }}>
          {props.channel.channelName}
        </span>
        <Show when={isReadOnly()}>
          <Lock size={12} class="shrink-0 ml-auto" />
        </Show>
      </button>

      <Show
        when={props.channel.channelType === "VoIP" && joinedUsers().length > 0}
      >
        <div class="ml-6 mt-1 space-y-1">
          <For each={joinedUsers()}>
            {(user) => <VoipChannelMember participant={user} channelId={props.channel.channelId} />}
          </For>
        </div>
      </Show>
    </div>
  );
};
