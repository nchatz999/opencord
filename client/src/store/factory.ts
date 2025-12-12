import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { fetchApi } from "../utils";
import { useConnection } from "./connection";

// ============================================================================
// Cascade Event System
// ============================================================================

export type CascadeEvent =
  | { type: "group:removed"; groupId: number }
  | { type: "channel:removed"; channelId: number }
  | { type: "voip:removed"; userId: number };

type CascadeHandler = (event: CascadeEvent) => void;

const cascadeHandlers = new Set<CascadeHandler>();

export function onCascade(handler: CascadeHandler): () => void {
  cascadeHandlers.add(handler);
  return () => cascadeHandlers.delete(handler);
}

export function emitCascade(event: CascadeEvent): void {
  cascadeHandlers.forEach((handler) => handler(event));
}

// ============================================================================
// API Helpers
// ============================================================================

function unwrapResult<T>(result: Result<T, { reason: string }>): Result<T, string> {
  return result.isErr() ? err(result.error.reason) : ok(result.value);
}

export const api = {
  get: <T>(endpoint: string, query?: Record<string, unknown>): Promise<Result<T, string>> =>
    fetchApi<T>(endpoint, { method: "GET", query }).then(unwrapResult),

  post: <T = void>(endpoint: string, body?: unknown): Promise<Result<T, string>> =>
    fetchApi<T>(endpoint, { method: "POST", body }).then(unwrapResult),

  put: <T = void>(endpoint: string, body?: unknown): Promise<Result<T, string>> =>
    fetchApi<T>(endpoint, { method: "PUT", body }).then(unwrapResult),

  del: <T = void>(endpoint: string): Promise<Result<T, string>> =>
    fetchApi<T>(endpoint, { method: "DELETE" }).then(unwrapResult),
};

export type ApiHelpers = typeof api;

// ============================================================================
// Key Utilities
// ============================================================================

type KeyConfig<T> = keyof T | (keyof T)[];

type KeyType<T, K extends KeyConfig<T>> = K extends keyof T
  ? T[K]
  : K extends (keyof T)[]
  ? Pick<T, K[number]>
  : never;

function getKeyValue<T, K extends KeyConfig<T>>(item: T, keyConfig: K): KeyType<T, K> {
  if (Array.isArray(keyConfig)) {
    const result = {} as Pick<T, (typeof keyConfig)[number]>;
    for (const key of keyConfig) {
      result[key] = item[key];
    }
    return result as KeyType<T, K>;
  }
  return item[keyConfig as keyof T] as KeyType<T, K>;
}

function matchesKey<T, K extends KeyConfig<T>>(item: T, key: KeyType<T, K>, keyConfig: K): boolean {
  if (Array.isArray(keyConfig)) {
    const compositeKey = key as Pick<T, (typeof keyConfig)[number]>;
    return keyConfig.every((k) => item[k] === compositeKey[k]);
  }
  return item[keyConfig as keyof T] === key;
}

// ============================================================================
// Base Actions Interface
// ============================================================================

export interface BaseActions<T, K extends KeyConfig<T>> {
  init: () => Promise<Result<void, string>>;
  list: () => T[];
  findById: (id: KeyType<T, K>) => T | undefined;
  findBy: <F extends keyof T>(field: F, value: T[F]) => T[];
  replaceAll: (items: T[]) => void;
  add: (item: T) => void;
  update: (item: T) => void;
  remove: (id: KeyType<T, K>) => void;
  removeBy: <F extends keyof T>(field: F, value: T[F]) => void;
}

// ============================================================================
// Store Config
// ============================================================================

export interface StoreConfig<T, K extends KeyConfig<T>, Custom = {}> {
  name: string;
  endpoint: string;
  stateKey: string;
  key: K;

  events?: {
    update?: string;
    delete?: string;
    custom?: Record<string, (event: unknown, actions: BaseActions<T, K>) => void>;
  };

  emitOnRemove?: (id: KeyType<T, K>) => CascadeEvent;
  cascadeOn?: Partial<Record<CascadeEvent["type"], (event: CascadeEvent, actions: BaseActions<T, K>) => void>>;

  skipInit?: boolean;

  custom?: (
    getState: () => T[],
    baseActions: BaseActions<T, K>,
    api: ApiHelpers
  ) => Custom;
}

// ============================================================================
// Store Factory
// ============================================================================

export function createEntityStore<T, K extends KeyConfig<T>, Custom = {}>(
  config: StoreConfig<T, K, Custom>
) {
  type State = { items: T[] };
  type Actions = BaseActions<T, K> & Custom;
  type Store = [State, Actions];

  function create(): Store {
    const [state, setState] = createStore<State>({ items: [] });
    const connection = useConnection();

    const getState = () => state.items;

    const baseActions: BaseActions<T, K> = {
      async init() {
        if (config.skipInit) {
          return ok(undefined);
        }

        const result = await api.get<T[]>(config.endpoint);
        if (result.isErr()) return result;
        baseActions.replaceAll(result.value);

        // Subscribe to server events
        connection.onServerEvent((event) => {
          const eventType = event.type as string;

          if (config.events?.update && eventType === config.events.update) {
            const item = event[config.stateKey.replace(/s$/, "")] as T;
            baseActions.update(item);
          } else if (config.events?.delete && eventType === config.events.delete) {
            const keyField = Array.isArray(config.key) ? config.key[0] : config.key;
            const id = event[keyField as string] as KeyType<T, K>;
            baseActions.remove(id);
          }

          // Custom event handlers
          if (config.events?.custom) {
            const customHandler = config.events.custom[eventType];
            if (customHandler) {
              customHandler(event, baseActions);
            }
          }
        });

        // Subscribe to cascade events
        if (config.cascadeOn) {
          onCascade((event) => {
            const handler = config.cascadeOn?.[event.type];
            if (handler) {
              handler(event, baseActions);
            }
          });
        }

        return ok(undefined);
      },

      list: () => state.items,

      findById: (id) => state.items.find((item) => matchesKey(item, id, config.key)),

      findBy: (field, value) => state.items.filter((item) => item[field] === value),

      replaceAll: (items) => setState("items", items),

      add: (item) =>
        setState(
          "items",
          produce((items) => {
            items.push(item);
          })
        ),

      update: (item) =>
        setState(
          "items",
          produce((items) => {
            const id = getKeyValue(item, config.key);
            const index = items.findIndex((i) => matchesKey(i, id, config.key));
            if (index !== -1) {
              items[index] = item;
            } else {
              items.push(item);
            }
          })
        ),

      remove: (id) => {
        // Emit cascade event before removing
        if (config.emitOnRemove) {
          emitCascade(config.emitOnRemove(id));
        }

        setState(
          "items",
          produce((items) => {
            const index = items.findIndex((i) => matchesKey(i, id, config.key));
            if (index !== -1) {
              items.splice(index, 1);
            }
          })
        );
      },

      removeBy: (field, value) => {
        const itemsToRemove = state.items.filter((item) => item[field] === value);
        for (const item of itemsToRemove) {
          const id = getKeyValue(item, config.key);
          baseActions.remove(id);
        }
      },
    };

    const customActions = config.custom?.(getState, baseActions, api) ?? ({} as Custom);
    const actions = { ...baseActions, ...customActions } as Actions;

    return [state, actions];
  }

  // Singleton instance
  let instance: Store | null = null;

  const useStore = (): Store => {
    if (!instance) {
      createRoot(() => {
        instance = create();
      });
    }
    return instance!;
  };

  return useStore;
}
