import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Group } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";
import { useChannel } from "./channel";

interface GroupState {
  groups: Group[];
}

interface GroupActions {
  init: () => Promise<Result<void, string>>;
  cleanup: () => void;
  list: () => Group[];
  findById: (id: number) => Group | undefined;
  replaceAll: (groups: Group[]) => void;
  add: (group: Group) => void;
  update: (group: Group) => void;
  remove: (id: number) => void;
  create: (name: string) => Promise<Result<{ groupId: number }, string>>;
  rename: (groupId: number, name: string) => Promise<Result<void, string>>;
  delete: (groupId: number) => Promise<Result<void, string>>;
}

export type GroupStore = [GroupState, GroupActions];

function createGroupStore(): GroupStore {
  const [state, setState] = createStore<GroupState>({
    groups: [],
  });

  const connection = useConnection();
  const [, channelActions] = useChannel();
  let cleanupFn: (() => void) | null = null;

  const actions: GroupActions = {
    async init() {
      actions.cleanup();

      const result = await request<Group[]>("/group", { method: "GET" });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      cleanupFn = connection.onServerEvent((event) => {
        if (event.type === "groupCreated") {
          actions.add(event.group as Group);
        } else if (event.type === "groupUpdated") {
          actions.update(event.group as Group);
        } else if (event.type === "groupDeleted") {
          actions.remove(event.groupId as number);
        }
      });

      return ok(undefined);
    },

    cleanup() {
      if (cleanupFn) {
        cleanupFn();
        cleanupFn = null;
      }
      setState("groups", []);
    },

    list() {
      return state.groups;
    },

    findById(id) {
      return state.groups.find((g) => g.groupId === id);
    },

    replaceAll(groups) {
      setState("groups", groups);
    },

    add(group) {
      setState("groups", (groups) => [...groups, group]);
    },

    update(group) {
      setState("groups", (groups) =>
        groups.map((g) => g.groupId === group.groupId ? group : g)
      );
    },

    remove(id) {
      channelActions.removeByGroup(id);
      setState("groups", (groups) => groups.filter((g) => g.groupId !== id));
    },

    async create(name) {
      const result = await request<{ groupId: number }>("/group", {
        method: "POST",
        body: { name },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(result.value);
    },

    async rename(groupId, name) {
      const result = await request(`/group/${groupId}`, {
        method: "PUT",
        body: { name },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async delete(groupId) {
      const result = await request(`/group/${groupId}`, {
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

let instance: GroupStore | null = null;

export function useGroup(): GroupStore {
  if (!instance) {
    createRoot(() => {
      instance = createGroupStore();
    });
  }
  return instance!;
}
