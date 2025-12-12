import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Group } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { fetchApi } from "../utils";
import { useConnection } from "./connection";
import { useChannel } from "./channel";

interface GroupState {
  groups: Group[];
}

interface GroupActions {
  init: () => Promise<Result<void, string>>;
  list: () => Group[];
  findById: (id: number) => Group | undefined;
  replaceAll: (groups: Group[]) => void;
  add: (group: Group) => void;
  update: (group: Group) => void;
  remove: (id: number) => void;
  create: (name: string) => Promise<Result<number, string>>;
  delete: (groupId: number) => Promise<Result<void, string>>;
}

export type GroupStore = [GroupState, GroupActions];

function createGroupStore(): GroupStore {
  const [state, setState] = createStore<GroupState>({
    groups: [],
  });

  const connection = useConnection();
  const [, channelActions] = useChannel();

  const actions: GroupActions = {
    async init() {
      const result = await fetchApi<Group[]>("/group", { method: "GET" });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      connection.onServerEvent((event) => {
        if (event.type === "groupUpdated") {
          actions.update(event.group as Group);
        } else if (event.type === "groupDeleted") {
          actions.remove(event.groupId as number);
        } else if (event.type === "groupHide") {
          actions.remove(event.groupId as number);
        }
      });

      return ok(undefined);
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
      setState(
        "groups",
        produce((groups) => {
          groups.push(group);
        })
      );
    },

    update(group) {
      setState(
        "groups",
        produce((groups) => {
          const index = groups.findIndex((g) => g.groupId === group.groupId);
          if (index !== -1) {
            groups[index] = group;
          } else {
            groups.push(group);
          }
        })
      );
    },

    remove(id) {
      // Cascade: remove channels first (which cascades to messages and voip)
      channelActions.removeByGroup(id);

      setState(
        "groups",
        produce((groups) => {
          const index = groups.findIndex((g) => g.groupId === id);
          if (index !== -1) {
            groups.splice(index, 1);
          }
        })
      );
    },

    async create(name) {
      const result = await fetchApi<{ groupId: number }>("/group", {
        method: "POST",
        body: { name },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(result.value.groupId);
    },

    async delete(groupId) {
      const result = await fetchApi(`/group/${groupId}`, {
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
