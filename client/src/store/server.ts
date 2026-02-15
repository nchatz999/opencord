import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { ServerConfig } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request, upload } from "../utils";
import { useConnection } from "./connection";

interface ServerState {
    config: ServerConfig | null;
}

interface ServerActions {
    init: () => Promise<Result<void, string>>;
    cleanup: () => void;
    get: () => ServerConfig | null;
    set: (config: ServerConfig) => void;
    updateName: (name: string) => Promise<Result<void, string>>;
    updateAvatar: (file: File) => Promise<Result<void, string>>;
}

export type ServerStore = [ServerState, ServerActions];

function createServerStore(): ServerStore {
    const [state, setState] = createStore<ServerState>({
        config: null,
    });

    const connection = useConnection();
    let cleanupFn: (() => void) | null = null;

    const actions: ServerActions = {
        async init() {
            actions.cleanup();

            const result = await request<ServerConfig>("/server/config", { method: "GET" });
            if (result.isErr()) {
                return err(result.error.reason);
            }
            actions.set(result.value);

            cleanupFn = connection.onServerEvent((event) => {
                if (event.type === "serverUpdated") {
                    actions.set(event.server as ServerConfig);
                }
            });

            return ok(undefined);
        },

        cleanup() {
            if (cleanupFn) {
                cleanupFn();
                cleanupFn = null;
            }
            setState("config", null);
        },

        get() {
            return state.config;
        },

        set(config) {
            setState("config", config);
        },

        async updateName(name) {
            const result = await request<ServerConfig>("/server/name", {
                method: "PUT",
                body: { serverName: name },
            });
            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },

        async updateAvatar(file: File) {
            const formData = new FormData();
            formData.append("file", file);
            const result = await upload("/server/avatar", formData);
            if (result.isErr()) {
                return err(result.error.reason);
            }
            return ok(undefined);
        },
    };

    return [state, actions];
}

let instance: ServerStore | null = null;

export function useServer(): ServerStore {
    if (!instance) {
        createRoot(() => {
            instance = createServerStore();
        });
    }
    return instance!;
}
