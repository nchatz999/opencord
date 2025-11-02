import type { Component } from "solid-js";
import { Show } from "solid-js";
import { Hash } from "lucide-solid";
import { channelDomain, groupDomain, userDomain } from "../store";


const ChatHeader: Component<{
  context: {
    type: "channel" | "dm";
    id: number;
  };
}> = (props) => {


  return (
    <div>
      <Show when={props.context.type == "dm"}>
        <Show when={userDomain.getUserById(props.context.id)}>
          {(user) => (
            <div class="flex h-16 min-h-16 items-center gap-3 px-4 py-3 border-b border-[#1e1f22] bg-[#313338] shrink-0">
              {}
              <div class="relative flex items-center">
                {}
                <div class="relative">
                  <img
                    src={`/api/user/${user().avatarFileId}/avatar`}
                    alt={user().username}
                    class="w-10 h-10 rounded-full object-cover border-2 border-[#313338]"
                  />
                  <div
                    class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-[#313338] ${userDomain.getUserColorStatusById(user().userId)}`}
                  />
                </div>

                {}
                <Show when={user().avatarFileId}>
                  <div class="relative -ml-3 z-10">
                    <img
                      src={`/api/user/${user().avatarFileId}/avatar`}
                      alt="You"
                      class="w-8 h-8 rounded-full object-cover border-2 border-[#313338]"
                    />
                  </div>
                </Show>
              </div>

              {}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="text-[#DBDEE1] font-semibold truncate">
                    {user().username}
                  </h2>
                  <span class="text-xs text-[#949ba4] capitalize">
                    {user().status}
                  </span>
                </div>
                <p class="text-xs text-[#949ba4]">{user().status}</p>
              </div>

              {}
              <div class="flex items-center gap-2">
                <div
                  class="w-2 h-2 bg-[#00A8FC] rounded-full"
                  title="Direct Message"
                />
              </div>
            </div>
          )
          }
        </Show >
      </Show>
      <Show when={props.context.type == "channel"}>
        <Show when={channelDomain.getChannelById(props.context.id)}>
          {(channel) => (
            <div class="flex h-16 min-h-16 items-center gap-3 px-4 py-3 border-b border-[#1e1f22] bg-[#313338]">
              {}
              <div class="text-[#949ba4]">
                <Hash size={20} />
              </div>

              {}
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="text-[#DBDEE1] font-semibold truncate">
                    {channel().channelName}
                  </h2>
                  <Show when={groupDomain.getGroupById(channel().groupId)}>
                    {(group) => (
                      <span class="text-xs text-[#949ba4] bg-[#2b2d31] px-2 py-0.5 rounded">
                        {group().groupName}
                      </span>
                    )}
                  </Show>
                </div>
              </div>

              {}
              <div class="flex items-center gap-2">
                {}
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div >
  );
};

export default ChatHeader;
