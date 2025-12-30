import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { MediaType, type Subscription } from "../model";
import type { Result } from "opencord-utils";
import { ok, err } from "opencord-utils";
import { request } from "../utils";
import { useConnection } from "./connection";
import { usePlayback } from "./playback";
import { useAuth } from "./auth";

interface SubscriptionState {
  subscriptions: Subscription[];
}

interface SubscriptionActions {
  init: () => Promise<Result<void, string>>;
  cleanup: () => void;
  list: () => Subscription[];
  isSubscribedToMedia: (subscriberId: number, publisherId: number, mediaType: MediaType) => boolean;
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
  const [, playbackActions] = usePlayback();
  const [, authActions] = useAuth();
  let cleanupFn: (() => void) | null = null;

  const actions: SubscriptionActions = {
    async init() {
      actions.cleanup();

      const result = await request<Subscription[]>("/voip/subscriptions", {
        method: "GET",
      });
      if (result.isErr()) {
        return err(result.error.reason);
      }
      actions.replaceAll(result.value);

      cleanupFn = connection.onServerEvent((event) => {
        if (event.type === "mediaSubscription") {
          actions.add(event.subscription as Subscription);
        } else if (event.type === "mediaUnsubscription") {
          const sub = event.subscription as Subscription;
          actions.remove(sub.userId, sub.publisherId, sub.mediaType);

          if (sub.userId === authActions.getUser().userId) {
            if (sub.mediaType === MediaType.Screen) {
              playbackActions.destroyPlayback(sub.publisherId, "screen");
              playbackActions.destroyPlayback(sub.publisherId, "screenSound");
            } else if (sub.mediaType === MediaType.Camera) {
              playbackActions.destroyPlayback(sub.publisherId, "camera");
            }
          }
        }
      });

      return ok(undefined);
    },

    cleanup() {
      if (cleanupFn) {
        cleanupFn();
        cleanupFn = null;
      }
      setState("subscriptions", []);
    },

    list() {
      return state.subscriptions;
    },

    isSubscribedToMedia(subscriberId, publisherId, mediaType) {
      return (
        state.subscriptions?.some(
          (sub) =>
            sub.userId === subscriberId &&
            sub.publisherId === publisherId &&
            sub.mediaType === mediaType
        ) || false
      );
    },

    replaceAll(subscriptions) {
      setState("subscriptions", subscriptions);
    },

    add(subscription) {
      setState("subscriptions", (subs) => {
        const exists = subs.some(
          (sub) =>
            sub.userId === subscription.userId &&
            sub.publisherId === subscription.publisherId &&
            sub.mediaType === subscription.mediaType
        );

        if (exists) {
          return subs;
        }

        return [...subs, subscription];
      });
    },

    remove(userId, publisherId, mediaType) {
      setState("subscriptions", (subs) =>
        subs.filter((sub) =>
          !(sub.userId === userId && sub.publisherId === publisherId && sub.mediaType === mediaType)
        )
      );
    },

    async subscribe(publisherId, mediaType) {
      const result = await request("/voip/subscribe", {
        method: "POST",
        body: { publisherId, mediaType },
      });
      if (result.isErr()) return err(result.error.reason);
      return ok(undefined);
    },

    async unsubscribe(publisherId, mediaType) {
      const result = await request("/voip/unsubscribe", {
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
