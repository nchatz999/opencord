import type { Component } from "solid-js";
import { For, Show, createMemo } from "solid-js";
import { MessageSquare, ChevronDown, X, Volume2, VolumeX } from "lucide-solid";
import { useContext, useUser, useChannel, useMessage, useNotification } from "../store/index";
import { usePreference } from "../store/preference";
import type { Message } from "../model";

const MessageNotification: Component = () => {
  const [, contextActions] = useContext();
  const [, userActions] = useUser();
  const [, channelActions] = useChannel();
  const [, messageActions] = useMessage();
  const [, prefActions] = usePreference();
  const notification = useNotification();

  const savedCollapsed = prefActions.get<boolean>("notification:collapsed");
  const savedSound = prefActions.get<boolean>("notification:sound");
  if (savedCollapsed !== null) notification.setCollapsed(savedCollapsed);
  if (savedSound !== null) notification.setSound(savedSound);

  const validMessages = createMemo(() => {
    return notification.messages()
      .map((id) => messageActions.findById(id))
      .filter((m) => m !== undefined);
  });

  const toggleCollapsed = () => {
    notification.toggleCollapsed();
    prefActions.set("notification:collapsed", notification.collapsed());
  };

  const toggleSound = () => {
    notification.toggleSound();
    prefActions.set("notification:sound", notification.soundEnabled());
  };

  const handleClick = (msg: Message) => {
    if (msg.channelId) {
      contextActions.set({ type: "channel", id: msg.channelId });
      notification.clearChannel(msg.channelId);
    } else {
      contextActions.set({ type: "dm", id: msg.senderId });
      notification.clearDM(msg.senderId);
    }
  };

  const getSenderName = (senderId: number) => {
    return userActions.findById(senderId)?.username ?? "Unknown";
  };

  const getContextName = (msg: Message) => {
    if (msg.channelId) {
      return `#${channelActions.findById(msg.channelId)?.channelName ?? "unknown"}`;
    }
    return "DM";
  };

  return (
    <Show when={validMessages().length > 0}>
      <div class="absolute top-2 right-4 z-40">
        <Show
          when={!notification.collapsed()}
          fallback={
            <button
              onClick={toggleCollapsed}
              class="flex items-center gap-1 px-2 py-1 bg-popover border border-border-subtle rounded-lg shadow-lg text-sm text-foreground hover:bg-muted transition-colors"
            >
              <MessageSquare size={14} />
              <span>{validMessages().length}</span>
            </button>
          }
        >
          <div class="w-64 bg-popover border border-border-subtle rounded-lg shadow-lg overflow-hidden">
            <div class="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/30">
              <button
                onClick={toggleCollapsed}
                class="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronDown size={12} />
                <span>{validMessages().length} new</span>
              </button>
              <div class="flex items-center gap-1">
                <button
                  onClick={toggleSound}
                  class="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title={notification.soundEnabled() ? "Mute notifications" : "Unmute notifications"}
                >
                  <Show when={notification.soundEnabled()} fallback={<VolumeX size={12} />}>
                    <Volume2 size={12} />
                  </Show>
                </button>
                <button
                  onClick={() => notification.clearAll()}
                  class="p-1 text-muted-foreground hover:text-foreground transition-colors"
                  title="Dismiss all"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
            <div class="max-h-48 overflow-y-auto">
              <For each={validMessages()}>
                {(msg) => (
                  <div
                    onClick={() => handleClick(msg)}
                    class="px-3 py-2 border-b border-border-subtle last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <div class="flex items-center justify-between">
                      <span class="text-xs font-medium text-foreground truncate">
                        {getSenderName(msg.senderId)}
                      </span>
                      <span class="text-xs text-muted-foreground">
                        {getContextName(msg)}
                      </span>
                    </div>
                    <p class="text-xs text-muted-foreground truncate mt-0.5">
                      {msg.messageText?.slice(0, 50) || "[attachment]"}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export default MessageNotification;
