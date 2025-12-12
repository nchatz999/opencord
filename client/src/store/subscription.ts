import { createStore, produce } from "solid-js/store";
import { createRoot } from "solid-js";
import type { Subscription, MediaType } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { fetchApi } from "../utils";
import { useConnection } from "./connection";
import { useAuth } from "./auth";

interface SubscriptionState {
  subscriptions: Subscription[];
}

interface SubscriptionActions {
  init: () => Promise<Result<void, string>>;
  list: () => Subscription[];
  isSubscribedToMedia: (publisherId: number, mediaType: MediaType) => boolean;
  replaceAll: (subscriptions: Subscription[]) => void;
  add: (subscription: Subscription) => void;
  remove: (userId: number, publisherId: number, mediaType: MediaType) => void;
  subscribe: (publisherId: number, mediaType: MediaType) => Promise<Result<void, string>>;
  unsubscribe: (publisherId: number, mediaType: MediaType) => Promise<Result<void, string>>;
}

export type SubscriptionStore = [SubscriptionState, SubscriptionActions];

function createSubscriptionStore(): SubscriptionStore {
  const [state, setState] = createStore<SubscriptionState>({
    subscriptions: [],
  });

  const connection = useConnection();

  const actions: SubscriptionActions = {
    async init() {
      const result = await fetchApi<Subscription[]>("/voip/subscriptions", {
        method: "GET",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      connection.onServerEvent((event) => {
        if (event.type === "mediaSubscription") {
          actions.add(event.subscription as Subscription);
        } else if (event.type === "mediaUnsubscription") {
          const sub = event.subscription as Subscription;
          actions.remove(sub.userId, sub.publisherId, sub.mediaType);
        }
      });

      return ok(undefined);
    },

    list() {
      return state.subscriptions;
    },

    isSubscribedToMedia(publisherId, mediaType) {
      const [authState] = useAuth();
      const currentUserId = authState.session?.userId;
      if (!currentUserId) return false;

      return (
        state.subscriptions?.some(
          (sub) =>
            sub.userId === currentUserId &&
            sub.publisherId === publisherId &&
            sub.mediaType === mediaType
        ) || false
      );
    },

    replaceAll(subscriptions) {
      setState("subscriptions", subscriptions);
    },

    add(subscription) {
      setState(
        "subscriptions",
        produce((subscriptions) => {
          const exists = subscriptions.some(
            (sub) =>
              sub.userId === subscription.userId &&
              sub.publisherId === subscription.publisherId &&
              sub.mediaType === subscription.mediaType
          );
          if (!exists) {
            subscriptions.push(subscription);
          }
        })
      );
    },

    remove(userId, publisherId, mediaType) {
      setState(
        "subscriptions",
        produce((subscriptions) => {
          const index = subscriptions.findIndex(
            (sub) =>
              sub.userId === userId &&
              sub.publisherId === publisherId &&
              sub.mediaType === mediaType
          );
          if (index !== -1) {
            subscriptions.splice(index, 1);
          }
        })
      );
    },

    async subscribe(publisherId, mediaType) {
      const result = await fetchApi("/voip/subscribe", {
        method: "POST",
        body: { publisherId, mediaType },
      });
      if (result.isErr()) return err(result.error.reason);
      return ok(undefined);
    },

    async unsubscribe(publisherId, mediaType) {
      const result = await fetchApi("/voip/unsubscribe", {
        method: "POST",
        body: { publisherId, mediaType },
      });
      if (result.isErr()) return err(result.error.reason);
      return ok(undefined);
    },
  };

  return [state, actions];
}

let instance: SubscriptionStore | null = null;

export function useSubscription(): SubscriptionStore {
  if (!instance) {
    createRoot(() => {
      instance = createSubscriptionStore();
    });
  }
  return instance!;
}
