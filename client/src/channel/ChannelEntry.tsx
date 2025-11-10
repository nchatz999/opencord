import type { Component } from "solid-js";
import { For, Show } from "solid-js";
import { Hash, Volume2 } from "lucide-solid";

import { VoipChannelMember } from "./VoipChannelMember";
import type { Channel } from "../model";
import { modalDomain, voipDomain } from "../store";

export const ChannelEntry: Component<{
  channel: Channel;
  onClick: () => void;
}> = (props) => {


  const joinedUsers = () => voipDomain.findByChannel(props.channel.channelId);

  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    modalDomain.open({ type: "channelSettings", id: props.channel.channelId })
  };

  return (
    <div>
      <button
        onClick={props.onClick}
        onContextMenu={handleContextMenu}
        class="flex items-center gap-2 w-full px-2 py-1 rounded text-[#949ba4] hover:text-[#DBDEE1] hover:bg-[#383a40] transition-all group"
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
