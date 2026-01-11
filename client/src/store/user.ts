import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { User, UserStatusType } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";

interface UserState {
    users: User[];
}

interface UserActions {
    init: () => Promise<Result<void, string>>;
    cleanup: () => void;
    list: () => User[];
    findById: (id: number) => User | undefined;
    replaceAll: (users: User[]) => void;
    add: (user: User) => void;
    update: (user: User) => void;
    remove: (id: number) => void;
    updateStatus: (userId: number, status: UserStatusType) => Promise<Result<void, string>>;
    updateAvatar: (fileName: string, contentType: string, base64Data: string) => Promise<Result<void, string>>;
    delete: (userId: number) => Promise<Result<void, string>>;
}

export type UserStore = [UserState, UserActions];

function createUserStore(): UserStore {
    const [state, setState] = createStore<UserState>({
        users: [],
    });

    const connection = useConnection();
    let cleanupFn: (() => void) | null = null;

    const actions: UserActions = {
        async init() {
            actions.cleanup();

            const result = await request<User[]>("/user", { method: "GET" });
            if (result.isErr()) {
                return err(result.error.reason);
            }
            actions.replaceAll(result.value);

            cleanupFn = connection.onServerEvent((event) => {
                if (event.type === "userCreated") {
                    actions.add(event.user as User);
                } else if (event.type === "userUpdated") {
                    actions.update(event.user as User);
                } else if (event.type === "userDeleted") {
                    actions.remove(event.userId as number);
                }
            });

            return ok(undefined);
        },

        cleanup() {
            if (cleanupFn) {
                cleanupFn();
                cleanupFn = null;
            }
            setState("users", []);
        },

        list() {
            return state.users;
        },

        findById(id) {
            return state.users.find((u) => u.userId === id);
        },

        replaceAll(users) {
            setState("users", users);
        },

        add(user) {
            setState("users", (users) => [...users, user]);
        },

        update(user) {
            setState("users", (users) =>
                users.map((u) => u.userId === user.userId ? user : u)
            );
        },

        remove(id) {
            setState("users", (users) => users.filter((u) => u.userId !== id));
        },

        async updateStatus(userId, status) {
            const result = await request(`/user/${userId}/manual-status`, {
                method: "PUT",
                body: { manualStatus: status },
            });
            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },

        async updateAvatar(fileName, contentType, base64Data) {
            const result = await request("/user/avatar", {
                method: "PUT",
                body: { fileName, contentType, data: base64Data },
            });
            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },

        async delete(userId) {
            const result = await request(`/user/${userId}`, {
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

let instance: UserStore | null = null;

export function useUser(): UserStore {
    if (!instance) {
        createRoot(() => {
            instance = createUserStore();
        });
    }
    return instance!;
}
