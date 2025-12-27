import { createStore } from "solid-js/store";
import { createRoot } from "solid-js";
import { usePreference } from "./preference";

const UNREAD_KEY = "unread";

interface MessageContext {
  type: "channel" | "dm";
  id: number;
}

interface ContextState {
  context: MessageContext | null;
  unread: Set<ContextKey>;
}

type ContextKey = `${"channel" | "dm"}-${number}`;

interface ContextActions {
  get: () => MessageContext | null;
  set: (ctx: MessageContext) => void;
  clear: () => void;
  getScrollPosition: (ctx: MessageContext) => number | undefined;
  setScrollPosition: (ctx: MessageContext, position: number) => void;
  hasVisited: (ctx: MessageContext) => boolean;
  markVisited: (ctx: MessageContext) => void;
  hasUnread: (type: "channel" | "dm", id: number) => boolean;
  markUnread: (type: "channel" | "dm", id: number) => void;
}

export type ContextStore = [ContextState, ContextActions];

function createContextStore(): ContextStore {
  const [, prefActions] = usePreference();

  const loadUnread = (): Set<ContextKey> => {
    const saved = prefActions.get<string[]>(UNREAD_KEY);
    return saved ? new Set(saved as ContextKey[]) : new Set();
  };

  const saveUnread = (unread: Set<ContextKey>) => {
    prefActions.set(UNREAD_KEY, [...unread]);
  };

  const [state, setState] = createStore<ContextState>({
    context: null,
    unread: loadUnread(),
  });

  const scrollPositions = new Map<ContextKey, number>();
  const visitedContexts = new Set<ContextKey>();

  const getContextKey = (ctx: MessageContext): ContextKey =>
    `${ctx.type}-${ctx.id}`;

  const toKey = (type: "channel" | "dm", id: number): ContextKey =>
    `${type}-${id}`;

  const actions: ContextActions = {
    get() {
      return state.context;
    },

    set(ctx) {
      setState("context", ctx);
      const key = getContextKey(ctx);
      if (state.unread.has(key)) {
        const next = new Set(state.unread);
        next.delete(key);
        setState("unread", next);
        saveUnread(next);
      }
    },

    clear() {
      setState("context", null);
    },

    getScrollPosition(ctx) {
      return scrollPositions.get(getContextKey(ctx));
    },

    setScrollPosition(ctx, position) {
      scrollPositions.set(getContextKey(ctx), position);
    },

    hasVisited(ctx) {
      return visitedContexts.has(getContextKey(ctx));
    },

    markVisited(ctx) {
      visitedContexts.add(getContextKey(ctx));
    },

    hasUnread(type, id) {
      return state.unread.has(toKey(type, id));
    },

    markUnread(type, id) {
      const active = state.context;
      if (active?.type === type && active?.id === id) return;
      const next = new Set(state.unread).add(toKey(type, id));
      setState("unread", next);
      saveUnread(next);
    },
  };

  return [state, actions];
}

let instance: ContextStore | null = null;

export function useContext(): ContextStore {
  if (!instance) {
    createRoot(() => {
      instance = createContextStore();
    });
  }
  return instance!;
}
