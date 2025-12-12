import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import type { ServerConfig } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { fetchApi } from "../utils";
import { useConnection } from "./connection";

interface ServerState {
  config: ServerConfig | null;
}

interface ServerActions {
  init: () => Promise<Result<void, string>>;
  get: () => ServerConfig | null;
  set: (config: ServerConfig) => void;
  updateName: (name: string) => Promise<Result<void, string>>;
  updateAvatar: (fileName: string, contentType: string, base64Data: string) => Promise<Result<void, string>>;
}

export type ServerStore = [ServerState, ServerActions];

function createServerStore(): ServerStore {
  const [state, setState] = createStore<ServerState>({
    config: null,
  });

  const connection = useConnection();

  const actions: ServerActions = {
    async init() {
      const result = await fetchApi<ServerConfig>("/server/config", { method: "GET" });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.set(result.value);

      connection.onServerEvent((event) => {
        if (event.type === "serverUpdated") {
          actions.set(event.server as ServerConfig);
        }
      });

      return ok(undefined);
    },

    get() {
      return state.config;
    },

    set(config) {
      setState("config", config);
    },

    async updateName(name) {
      const result = await fetchApi<ServerConfig>("/server/name", {
        method: "PUT",
        body: { serverName: name },
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      return ok(undefined);
    },

    async updateAvatar(fileName, contentType, base64Data) {
      const result = await fetchApi<ServerConfig>("/server/avatar", {
        method: "PUT",
        body: { fileName, contentType, data: base64Data },
      });
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
