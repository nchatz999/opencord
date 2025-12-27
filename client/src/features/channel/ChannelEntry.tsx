import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { Hash, Volume2 } from "lucide-solid";

import { VoipChannelMember } from "../voip/VoipChannelMember";
import { ChannelType, type Channel } from "../../model";
import { useContext, useModal, useVoip, usePlayback, useMicrophone, useScreenShare, useCamera } from "../../store/index";
import { useToaster } from "../../components/Toaster";

const UnreadBadge = () => (
  <span class="w-2 h-2 bg-primary rounded-full shrink-0" />
);

export const ChannelEntry: Component<{
  channel: Channel;
}> = (props) => {
  const [, contextActions] = useContext();
  const hasUnread = () => contextActions.hasUnread("channel", props.channel.channelId);
  const [, modalActions] = useModal();
  const [, voipActions] = useVoip();
  const [, playbackActions] = usePlayback();
  const [, microphoneActions] = useMicrophone();
  const [, screenShareActions] = useScreenShare();
  const [, cameraActions] = useCamera();

  const { addToast } = useToaster();

  const handleChannelClick = async (channel: Channel) => {
    if (channel.channelType === ChannelType.Text) {
      contextActions.set({ type: "channel", id: channel.channelId });
    }

    if (channel.channelType === ChannelType.VoIP) {

      if (screenShareActions.isRecording()) {
        screenShareActions.stop();
      }
      if (cameraActions.isRecording()) {
        cameraActions.stop();
      }

      const result = await voipActions.joinChannel(
        channel.channelId,
        microphoneActions.getMuted(),
        false
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
        class="flex items-center gap-2 w-full px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-all group"
      >
        <Show
          when={props.channel.channelType === "VoIP"}
          fallback={<Hash size={16} class="shrink-0" />}
        >
          <Volume2 size={16} class="shrink-0" />
        </Show>
        <span class="text-sm truncate">{props.channel.channelName}</span>
        <Show when={hasUnread()}>
          <UnreadBadge />
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
