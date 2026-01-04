import { createSignal, createRoot } from "solid-js";
import { useSound } from "./sound";

const MAX_MESSAGES = 5;

interface Notification {
  messageId: number;
  channelId: number | null;
  senderId: number;
}

interface NotificationActions {
  pushChannel: (messageId: number, channelId: number) => void;
  pushDM: (messageId: number, senderId: number) => void;
  dismiss: (messageId: number) => void;
  clearChannel: (channelId: number) => void;
  clearDM: (senderId: number) => void;
  clearAll: () => void;

  messages: () => number[];
  hasChannel: (channelId: number) => boolean;
  hasDM: (senderId: number) => boolean;
  hasAnyChannel: () => boolean;
  hasAnyDM: () => boolean;

  soundEnabled: () => boolean;
  toggleSound: () => void;
  setSound: (value: boolean) => void;
  collapsed: () => boolean;
  toggleCollapsed: () => void;
  setCollapsed: (value: boolean) => void;
}

export type NotificationStore = NotificationActions;

function createNotificationStore(): NotificationStore {
  const [notifications, setNotifications] = createSignal<Notification[]>([]);
  const [collapsed, setCollapsed] = createSignal(false);
  const [soundEnabled, setSoundEnabled] = createSignal(true);
  const [, soundActions] = useSound();

  const push = (messageId: number, channelId: number | null, senderId: number) => {
    setNotifications((prev) => {
      if (prev.some((n) => n.messageId === messageId)) return prev;
      return [{ messageId, channelId, senderId }, ...prev].slice(0, MAX_MESSAGES);
    });
    if (soundEnabled()) {
      soundActions.play("/sounds/message.ogg");
    }
  };

  const actions: NotificationActions = {
    pushChannel: (messageId, channelId) => push(messageId, channelId, 0),
    pushDM: (messageId, senderId) => push(messageId, null, senderId),

    dismiss(messageId) {
      setNotifications((prev) => prev.filter((n) => n.messageId !== messageId));
    },

    clearChannel(channelId) {
      setNotifications((prev) => prev.filter((n) => n.channelId !== channelId));
    },

    clearDM(senderId) {
      setNotifications((prev) => prev.filter((n) => n.channelId === null && n.senderId !== senderId));
    },

    clearAll() {
      setNotifications([]);
    },

    messages: () => notifications().map((n) => n.messageId),
    hasChannel: (channelId) => notifications().some((n) => n.channelId === channelId),
    hasDM: (senderId) => notifications().some((n) => n.channelId === null && n.senderId === senderId),
    hasAnyChannel: () => notifications().some((n) => n.channelId !== null),
    hasAnyDM: () => notifications().some((n) => n.channelId === null),

    soundEnabled: () => soundEnabled(),
    toggleSound: () => setSoundEnabled((prev) => !prev),
    setSound: (value) => setSoundEnabled(value),
    collapsed: () => collapsed(),
    toggleCollapsed: () => setCollapsed((prev) => !prev),
    setCollapsed: (value) => setCollapsed(value),
  };

  return actions;
}

let instance: NotificationStore | null = null;

export function useNotification(): NotificationStore {
  if (!instance) {
    createRoot(() => {
      instance = createNotificationStore();
    });
  }
  return instance!;
}
