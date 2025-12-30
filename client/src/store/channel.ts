import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Channel, ChannelType } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";
import { useVoip } from "./voip";
import { useMessage } from "./message";

interface ChannelState {
  channels: Channel[];
}

interface ChannelActions {
  init: () => Promise<Result<void, string>>;
  cleanup: () => void;
  list: () => Channel[];
  findById: (id: number) => Channel | undefined;
  findByGroup: (groupId: number) => Channel[];
  replaceAll: (channels: Channel[]) => void;
  add: (channel: Channel) => void;
  update: (channel: Channel) => void;
  remove: (id: number) => void;
  removeByGroup: (groupId: number) => void;
  create: (
    groupId: number,
    name: string,
    type: ChannelType
  ) => Promise<Result<number, string>>;
  rename: (channelId: number, name: string) => Promise<Result<void, string>>;
  delete: (channelId: number) => Promise<Result<void, string>>;
}

export type ChannelStore = [ChannelState, ChannelActions];

function createChannelStore(): ChannelStore {
  const [state, setState] = createStore<ChannelState>({
    channels: [],
  });

  const connection = useConnection();
  const [, voipActions] = useVoip();
  const [, messageActions] = useMessage();
  let cleanupFn: (() => void) | null = null;

  const actions: ChannelActions = {
    async init() {
      actions.cleanup();

      const result = await request<Channel[]>("/channel", { method: "GET" });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      cleanupFn = connection.onServerEvent((event) => {
        if (event.type === "channelCreated") {
          actions.add(event.channel as Channel);
        } else if (event.type === "channelUpdated") {
          actions.update(event.channel as Channel);
        } else if (event.type === "channelDeleted") {
          actions.remove(event.channelId as number);
        }
      });

      return ok(undefined);
    },

    cleanup() {
      if (cleanupFn) {
        cleanupFn();
        cleanupFn = null;
      }
      setState("channels", []);
    },

    list() {
      return state.channels;
    },

    findById(id) {
      return state.channels.find((c) => c.channelId === id);
    },

    findByGroup(groupId) {
      return state.channels.filter((c) => c.groupId === groupId);
    },

    replaceAll(channels) {
      setState("channels", channels);
    },

    add(channel) {
      setState("channels", (channels) => [...channels, channel]);
    },

    update(channel) {
      setState("channels", (channels) =>
        channels.map((c) => c.channelId === channel.channelId ? channel : c)
      );
    },

    remove(id) {
      messageActions.removeByChannel(id);
      voipActions.removeByChannel(id);
      setState("channels", (channels) => channels.filter((c) => c.channelId !== id));
    },

    removeByGroup(groupId) {
      const channelIds = state.channels.filter((c) => c.groupId === groupId).map((c) => c.channelId);
      for (const id of channelIds) {
        messageActions.removeByChannel(id);
        voipActions.removeByChannel(id);
      }
      setState("channels", (channels) => channels.filter((c) => c.groupId !== groupId));
    },

    async create(groupId, name, type) {
      const result = await request<{ channelId: number }>("/channel", {
        method: "POST",
        body: { groupId, name, type },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(result.value.channelId);
    },

    async rename(channelId, name) {
      const result = await request(`/channel/${channelId}`, {
        method: "PUT",
        body: { name },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async delete(channelId) {
      const result = await request(`/channel/${channelId}`, {
        method: "DELETE",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },
  };

  return [state, actions];
}

let instance: ChannelStore | null = null;

export function useChannel(): ChannelStore {
  if (!instance) {
    createRoot(() => {
      instance = createChannelStore();
    });
  }
  return instance!;
}
