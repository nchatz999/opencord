import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { Hash, Volume2 } from "lucide-solid";

import { VoipChannelMember } from "./VoipChannelMember";
import { ChannelType, type Channel } from "../model";
import { messageDomain, microphone, modalDomain, voipDomain } from "../store";
import { fetchApi } from "../utils";
import { useToaster } from "../components/Toaster";

export const ChannelEntry: Component<{
  channel: Channel;
}> = (props) => {

  const { addToast } = useToaster();

  const handleChannelClick = async (channel: Channel) => {

    if (channel.channelType === ChannelType.Text) {
      messageDomain.setContext({ type: "channel", id: channel.channelId })
    }

    if (channel.channelType === ChannelType.VoIP) {

      await microphone.start()
      await voipDomain.resume()
      const result = await fetchApi(
        `/voip/channel/${channel.channelId}/join/${microphone.getMuted()}/false`,
        {
          method: "POST",
        }
      )
      if (result.isErr()) {
        addToast(`Failed to join channel: ${result.error.reason}`, "error");
        return
      }
    }
  };


  const joinedUsers = () => voipDomain.findByChannel(props.channel.channelId);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    modalDomain.open({ type: "channelSettings", id: props.channel.channelId })
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
      </button>

      {}
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
