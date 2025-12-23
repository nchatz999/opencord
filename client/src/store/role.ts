import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Role } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";

interface RoleState {
  roles: Role[];
}

interface RoleActions {
  init: () => Promise<Result<void, string>>;
  cleanup: () => void;
  list: () => Role[];
  findById: (id: number) => Role | undefined;
  replaceAll: (roles: Role[]) => void;
  update: (role: Role) => void;
  remove: (id: number) => void;
  create: (name: string) => Promise<Result<{ roleId: number }, string>>;
  delete: (roleId: number) => Promise<Result<void, string>>;
  rename: (roleId: number, name: string) => Promise<Result<void, string>>;
}

export type RoleStore = [RoleState, RoleActions];

function createRoleStore(): RoleStore {
  const [state, setState] = createStore<RoleState>({
    roles: [],
  });

  const connection = useConnection();
  let cleanupFn: (() => void) | null = null;

  const actions: RoleActions = {
    async init() {
      actions.cleanup();

      const result = await request<Role[]>("/role", { method: "GET" });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      cleanupFn = connection.onServerEvent((event) => {
        if (event.type === "roleUpdated") {
          actions.update(event.role as Role);
        } else if (event.type === "roleDeleted") {
          actions.remove(event.roleId as number);
        }
      });

      return ok(undefined);
    },

    cleanup() {
      if (cleanupFn) {
        cleanupFn();
        cleanupFn = null;
      }
      setState("roles", []);
    },

    list() {
      return state.roles;
    },

    findById(id) {
      return state.roles.find((r) => r.roleId === id);
    },

    replaceAll(roles) {
      setState("roles", roles);
    },

    update(role) {
      setState(
        "roles",
        produce((roles) => {
          const index = roles.findIndex((r) => r.roleId === role.roleId);
          if (index !== -1) {
            roles[index] = role;
          } else {
            roles.push(role);
          }
        })
      );
    },

    remove(id) {
      setState(
        "roles",
        produce((roles) => {
          const index = roles.findIndex((r) => r.roleId === id);
          if (index !== -1) {
            roles.splice(index, 1);
          }
        })
      );
    },

    async create(name) {
      const result = await request<{ roleId: number }>("/role", {
        method: "POST",
        body: { name },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(result.value);
    },

    async delete(roleId) {
      const result = await request(`/role/${roleId}`, {
        method: "DELETE",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async rename(roleId, name) {
      const result = await request(`/role/${roleId}`, {
        method: "PUT",
        body: { name },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },
  };

  return [state, actions];
}

let instance: RoleStore | null = null;

export function useRole(): RoleStore {
  if (!instance) {
    createRoot(() => {
      instance = createRoleStore();
    });
  }
  return instance!;
}
