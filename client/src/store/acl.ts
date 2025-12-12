import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import type { GroupRoleRights } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { fetchApi } from "../utils";
import { useConnection } from "./connection";
import { useChannel } from "./channel";
import { useGroup } from "./group";

interface AclState {
  groupRoleRights: GroupRoleRights[];
}

interface AclActions {
  init: () => Promise<Result<void, string>>;
  list: () => GroupRoleRights[];
  findByGroup: (groupId: number) => GroupRoleRights[];
  getGroupRights: (groupId: number, roleId: number) => number | undefined;
  getChannelRights: (channelId: number, roleId: number) => number;
  replaceAll: (rights: GroupRoleRights[]) => void;
  updateLocal: (right: GroupRoleRights) => void;
  grant: (right: GroupRoleRights) => Promise<Result<void, string>>;
  grantMany: (rights: GroupRoleRights[]) => Promise<Result<void, string>>;
}

export type AclStore = [AclState, AclActions];

function createAclStore(): AclStore {
  const [state, setState] = createStore<AclState>({
    groupRoleRights: [],
  });

  const connection = useConnection();

  const actions: AclActions = {
    async init() {
      const result = await fetchApi<GroupRoleRights[]>("/acl/group-role-rights", {
        method: "GET",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      connection.onServerEvent((event) => {
        if (event.type === "groupRoleRightUpdated") {
          actions.updateLocal(event.right as GroupRoleRights);
        }
      });

      return ok(undefined);
    },

    list() {
      return state.groupRoleRights;
    },

    findByGroup(groupId) {
      return state.groupRoleRights.filter((r) => r.groupId === groupId);
    },

    getGroupRights(groupId, roleId) {
      if ([0, 1].includes(roleId)) return 16;
      const groupRoleRight = state.groupRoleRights.find(
        (r) => r.groupId === groupId && r.roleId === roleId
      );
      if (!groupRoleRight) return undefined;
      return groupRoleRight.rights;
    },

    getChannelRights(channelId, roleId) {
      const [, channelActions] = useChannel();
      const [, groupActions] = useGroup();

      const channel = channelActions.findById(channelId);
      if (!channel) return 0;
      const group = groupActions.findById(channel.groupId);
      if (!group) return 0;
      return actions.getGroupRights(group.groupId, roleId) || 0;
    },

    replaceAll(rights) {
      setState("groupRoleRights", rights);
    },

    updateLocal(right) {
      setState(
        "groupRoleRights",
        produce((currentRights) => {
          const index = currentRights.findIndex(
            (r) => r.groupId === right.groupId && r.roleId === right.roleId
          );
          if (index !== -1) {
            currentRights[index] = right;
          } else {
            currentRights.push(right);
          }
        })
      );
    },

    async grant(right) {
      const result = await fetchApi<void>("/acl/group-role-rights", {
        method: "PUT",
        body: [right],
      });
      if (result.isErr()) return err(result.error.reason);
      actions.updateLocal(right);
      return ok(undefined);
    },

    async grantMany(rights) {
      if (rights.length === 0) return ok(undefined);

      const result = await fetchApi<void>("/acl/group-role-rights", {
        method: "PUT",
        body: rights,
      });
      if (result.isErr()) return err(result.error.reason);

      for (const right of rights) {
        actions.updateLocal(right);
      }
      return ok(undefined);
    },
  };

  return [state, actions];
}

let instance: AclStore | null = null;

export function useAcl(): AclStore {
  if (!instance) {
    createRoot(() => {
      instance = createAclStore();
    });
  }
  return instance!;
}
