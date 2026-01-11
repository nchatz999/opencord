import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { GroupRoleRights } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";
import { useChannel } from "./channel";
import { useGroup } from "./group";

interface AclState {
    groupRoleRights: GroupRoleRights[];
}

interface AclActions {
    init: () => Promise<Result<void, string>>;
    cleanup: () => void;
    list: () => GroupRoleRights[];
    findByGroup: (groupId: number) => GroupRoleRights[];
    getGroupRights: (groupId: number, roleId: number) => number | undefined;
    getChannelRights: (channelId: number, roleId: number) => number;
    replaceAll: (rights: GroupRoleRights[]) => void;
    update: (right: GroupRoleRights) => void;
    grant: (right: GroupRoleRights) => Promise<Result<void, string>>;
    grantMany: (rights: GroupRoleRights[]) => Promise<Result<void, string>>;
    updateUserRole: (userId: number, roleId: number) => Promise<Result<void, string>>;
}

export type AclStore = [AclState, AclActions];

function createAclStore(): AclStore {
    const [state, setState] = createStore<AclState>({
        groupRoleRights: [],
    });

    const connection = useConnection();
    let cleanupFn: (() => void) | null = null;

    const actions: AclActions = {
        async init() {
            actions.cleanup();

            const result = await request<GroupRoleRights[]>("/acl/group-role-rights", {
                method: "GET",
            });
            if (result.isErr()) {
                return err(result.error.reason);
            }
            actions.replaceAll(result.value);

            cleanupFn = connection.onServerEvent((event) => {
                if (event.type === "groupRoleRightUpdated") {
                    actions.update(event.right as GroupRoleRights);
                }
            });

            return ok(undefined);
        },

        cleanup() {
            if (cleanupFn) {
                cleanupFn();
                cleanupFn = null;
            }
            setState("groupRoleRights", []);
        },

        list() {
            return state.groupRoleRights;
        },

        findByGroup(groupId) {
            return state.groupRoleRights.filter((r) => r.groupId === groupId);
        },

        getGroupRights(groupId, roleId) {
            if ([1, 2].includes(roleId)) return 8;
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

        update(right) {
            setState("groupRoleRights", (rights) => {
                const index = rights.findIndex((r) => r.groupId === right.groupId && r.roleId === right.roleId);

                if (index === -1) {
                    return [...rights, right];
                }

                return rights.map((r, i) => i === index ? right : r);
            });
        },

        async grant(right) {
            const result = await request<void>("/acl/group-role-rights", {
                method: "PUT",
                body: [right],
            });
            if (result.isErr()) return err(result.error.reason);
            actions.update(right);
            return ok(undefined);
        },

        async grantMany(rights) {
            if (rights.length === 0) return ok(undefined);

            const result = await request<void>("/acl/group-role-rights", {
                method: "PUT",
                body: rights,
            });
            if (result.isErr()) return err(result.error.reason);

            for (const right of rights) {
                actions.update(right);
            }
            return ok(undefined);
        },

        async updateUserRole(userId, roleId) {
            const result = await request(`/acl/user/${userId}/role`, {
                method: "PUT",
                body: { roleId },
            });
            if (result.isErr()) {
                return err(result.error.reason);
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
