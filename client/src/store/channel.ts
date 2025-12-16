import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Channel, ChannelType } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { fetchApi } from "../utils";
import { useConnection } from "./connection";
import { useVoip } from "./voip";
import { useMessage } from "./message";

interface ChannelState {
  channels: Channel[];
}

interface ChannelActions {
  init: () => Promise<Result<void, string>>;
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
  updateChannel: (
    channelId: number,
    name: string,
    type: ChannelType
  ) => Promise<Result<void, string>>;
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

  const actions: ChannelActions = {
    async init() {
      const result = await fetchApi<Channel[]>("/channel", { method: "GET" });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      connection.onServerEvent((event) => {
        if (event.type === "channelUpdated") {
          actions.update(event.channel as Channel);
        } else if (event.type === "channelDeleted") {
          actions.remove(event.channelId as number);
        }
      });

      return ok(undefined);
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
      setState(
        "channels",
        produce((channels) => {
          channels.push(channel);
        })
      );
    },

    update(channel) {
      setState(
        "channels",
        produce((channels) => {
          const index = channels.findIndex((c) => c.channelId === channel.channelId);
          if (index !== -1) {
            channels[index] = channel;
          } else {
            channels.push(channel);
          }
        })
      );
    },

    remove(id) {
      messageActions.removeByChannel(id);
      voipActions.removeByChannel(id);

      setState(
        "channels",
        produce((channels) => {
          const index = channels.findIndex((c) => c.channelId === id);
          if (index !== -1) {
            channels.splice(index, 1);
          }
        })
      );
    },

    removeByGroup(groupId) {
      const groupChannels = state.channels.filter((c) => c.groupId === groupId);
      for (const channel of groupChannels) {
        actions.remove(channel.channelId);
      }
    },

    async create(groupId, name, type) {
      const result = await fetchApi<{ channelId: number }>("/channel", {
        method: "POST",
        body: { groupId, name, type },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(result.value.channelId);
    },

    async updateChannel(channelId, name, _type) {
      const result = await fetchApi(`/channel/${channelId}`, {
        method: "PUT",
        body: { name },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async delete(channelId) {
      const result = await fetchApi(`/channel/${channelId}`, {
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
