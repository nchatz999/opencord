import type { Component } from "solid-js";
import { createSignal, For, Show, createMemo } from "solid-js";
import { MessageSquare, ChevronDown, X, Volume2, VolumeX } from "lucide-solid";
import { useContext, useUser, useChannel, useMessage } from "../store/index";
import { useSound } from "../store/sound";
import { usePreference } from "../store/preference";

const MAX_MESSAGES = 5;

const [messageIds, setMessageIds] = createSignal<number[]>([]);
const [collapsed, setCollapsed] = createSignal(false);
const [soundEnabled, setSoundEnabled] = createSignal(true);

export function pushNotification(messageId: number) {
  setMessageIds((prev) => {
    if (prev.includes(messageId)) return prev;
    return [messageId, ...prev].slice(0, MAX_MESSAGES);
  });

  if (soundEnabled()) {
    const [, soundActions] = useSound();
    soundActions.play("/sounds/message.ogg");
  }
}

const MessageNotification: Component = () => {
  const [, contextActions] = useContext();
  const [, userActions] = useUser();
  const [, channelActions] = useChannel();
  const [, messageActions] = useMessage();
  const [, prefActions] = usePreference();

  const savedCollapsed = prefActions.get<boolean>("notification:collapsed");
  const savedSound = prefActions.get<boolean>("notification:sound");
  if (savedCollapsed !== null) setCollapsed(savedCollapsed);
  if (savedSound !== null) setSoundEnabled(savedSound);

  const validMessages = createMemo(() => {
    return messageIds()
      .map((id) => messageActions.findById(id))
      .filter((m) => m !== undefined);
  });

  const toggleCollapsed = () => {
    const newVal = !collapsed();
    setCollapsed(newVal);
    prefActions.set("notification:collapsed", newVal);
  };

  const toggleSound = () => {
    const newVal = !soundEnabled();
    setSoundEnabled(newVal);
    prefActions.set("notification:sound", newVal);
  };

  const dismiss = (id: number) => {
    setMessageIds((prev) => prev.filter((mid) => mid !== id));
  };

  const dismissAll = () => {
    setMessageIds([]);
  };

  const handleClick = (msg: { id: number; channelId: number | null; senderId: number }) => {
    if (msg.channelId) {
      contextActions.set({ type: "channel", id: msg.channelId });
    } else {
      contextActions.set({ type: "dm", id: msg.senderId });
    }
    dismiss(msg.id);
  };

  const getSenderName = (senderId: number) => {
    return userActions.findById(senderId)?.username ?? "Unknown";
  };

  const getContextName = (msg: { channelId: number | null; senderId: number }) => {
    if (msg.channelId) {
      return `#${channelActions.findById(msg.channelId)?.channelName ?? "unknown"}`;
    }
    return "DM";
  };

  return (
    <Show when={validMessages().length > 0}>
      <div class="absolute top-2 right-4 z-40">
        <Show
          when={!collapsed()}
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
                  title={soundEnabled() ? "Mute notifications" : "Unmute notifications"}
                >
                  <Show when={soundEnabled()} fallback={<VolumeX size={12} />}>
                    <Volume2 size={12} />
                  </Show>
                </button>
                <button
                  onClick={dismissAll}
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
