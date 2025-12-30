import type { Component } from "solid-js";
import { Show } from "solid-js";
import { Hash } from "lucide-solid";
import { useAuth, useChannel, useGroup, useUser } from "../../store/index";
import { getStatusColor } from "../../utils";
import Avatar from "../../components/Avatar";


const ChatHeader: Component<{
  context: {
    type: "channel" | "dm";
    id: number;
  };
}> = (props) => {
  const [, authActions] = useAuth();
  const [, channelActions] = useChannel();
  const [, groupActions] = useGroup();
  const [, userActions] = useUser();
  const currentUser = () => authActions.getUser();

  return (
    <div>
      <Show when={props.context.type == "dm"}>
        <Show when={userActions.findById(props.context.id)}>
          {(user) => (
            <div class="flex h-16 min-h-16 items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
              <div class="relative flex items-center">
                <div class="relative">
                  <Avatar
                    avatarFileId={user().avatarFileId}
                    alt={user().username}
                    size="md"
                    class="border-2 border-background"
                  />
                  <div
                    class={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${getStatusColor(user().status, "bg")}`}
                  />
                </div>

                <div class="relative -ml-3 z-10">
                  <Avatar
                    avatarFileId={currentUser().avatarFileId}
                    alt="You"
                    size="sm"
                    class="border-2 border-background"
                  />
                </div>
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="text-foreground font-semibold truncate">
                    {user().username}
                  </h2>
                  <span class="text-xs text-muted-foreground capitalize">
                    {user().status}
                  </span>
                </div>
              </div>
              <div class="flex items-center gap-2">
                <div
                  class="w-2 h-2 bg-link rounded-full"
                  title="Direct Message"
                />
              </div>
            </div>
          )
          }
        </Show >
      </Show>
      <Show when={props.context.type == "channel"}>
        <Show when={channelActions.findById(props.context.id)}>
          {(channel) => (
            <div class="flex h-16 min-h-16 items-center gap-3 px-4 py-3 border-b border-border bg-background">
              {}
              <div class="text-muted-foreground">
                <Hash size={20} />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <h2 class="text-foreground font-semibold truncate">
                    {channel().channelName}
                  </h2>
                  <Show when={groupActions.findById(channel().groupId)}>
                    {(group) => (
                      <span class="text-xs text-muted-foreground bg-sidebar px-2 py-0.5 rounded">
                        {group().groupName}
                      </span>
                    )}
                  </Show>
                </div>
              </div>
              <div class="flex items-center gap-2">
              </div>
            </div>
          )}
        </Show>
      </Show>
    </div >
  );
};

export default ChatHeader;
